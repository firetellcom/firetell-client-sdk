import { SimpleEventEmitter } from "./SimpleEventEmitter";
import { Call } from "./Call";
import { ISession } from "./interfaces/ISession";
import { IRPCMessageError } from "./interfaces/IRPCMessageResult";
import { IActiveCall } from "./interfaces/IActiveCall";
import { EMessageNotification } from "./enums/EMessageNotification.enum";
import { ECallState } from "./enums/ECallState.enum";
import { EClientEventName } from "./enums/EClientEventName.enum";
import { EStorageKey } from "./enums/ELocalStorageKey.enum";
import { IJwtPayload } from "./interfaces/IJwtPayload";

const SDK_VERSION = "1.0.0";

export class FiretellClient {
  public sdkVersion = SDK_VERSION;
  private baseUrl = "";
  private ws: WebSocket | null;
  private jwt: string = "";
  private wsServers: string[] = [];
  public iceServers: RTCIceServer[] = [];
  private transactionId: number = 1;
  private pendingTransactions = new Map<
    number,
    { resolve: (value: any) => void; reject: (reason: any) => void }
  >();
  private session: ISession | null = null;
  private keepAliveTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private heartbeatMissCount: number = 0;
  private static readonly MAX_HEARTBEAT_MISS = 3;
  private retryWebsocket: number = 0;
  private retryWebsocketTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isReconnecting: boolean = false;
  /**
   * @event
   * session, incomingCall, error, reconnected, workspace.agent.state
   */
  public events = new SimpleEventEmitter();
  public isWebRTCSupport: boolean = false;
  public connected: boolean = false;
  /**
   * Promise that resolves when the client is fully initialized
   * (metadata fetched + WebSocket connected + session authenticated)
   */
  public readonly ready: Promise<ISession>;
  private _resolveReady!: (session: ISession) => void;
  private _rejectReady!: (error: Error) => void;
  /**
   * Current active calls Map<call_id, Call>
   */
  activeCalls = new Map<string, Call>();

  /**
   * FiretellClient constructor
   * @param jwt Json Web Token
   * @param domain Workspace API domain
   */
  constructor(jwt: string, domain: string) {
    if (!jwt) throw new Error("jwt is required in constructor");
    if (!this._parseJwt(jwt)) throw new Error("Invalid JWT");
    this.jwt = jwt;
    this.ws = null;
    this.ready = new Promise<ISession>((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    this.baseUrl = this._checkWorkspaceDomain(domain);
    this._fetchWorkspaceMetadata();
  }

  private _checkWorkspaceDomain(domain: string) {
    if (!domain) throw new Error("Workspace domain is required");
    // validate domain can start https:// or http:// or without protocol
    // domain can't end with /    
    if (domain.endsWith("/")) {
      domain = domain.slice(0, -1);
    }
    const domainRegex = /^(https?:\/\/)?([^\s/$.?#].[^\s]*)$/;
    if (!domainRegex.test(domain)) throw new Error("Invalid workspace domain");
    // if domain not start with https:// or http://, add https://
    if (!domain.startsWith("https://") && !domain.startsWith("http://")) {
      domain = `https://${domain}`;
    }
    return domain;
  }

  private async _fetchWorkspaceMetadata() {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.jwt}`,
        },
        method: "GET",
      });
      const data = (await response.json()) as {
        ws_servers: string[];
        ice_servers: RTCIceServer[];
      };
      this.wsServers = data.ws_servers;
      this.iceServers = data.ice_servers;
      this._initWebSocket();
    } catch (error) {
      console.error(
        "fetchWorkspaceMetadata::Error fetching workspace config:",
        error
      );
    }
  }

  private _initWebSocket(): void {
    this._checkWebRTCSupport().then(
      (isSupport) => (this.isWebRTCSupport = isSupport)
    );

    // Select random wsServer
    const randomIndex = Math.floor(Math.random() * this.wsServers.length);
    const wsUrl = `${this.wsServers[randomIndex]}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.debug(
        "initWebSocket::WebSocket connected to:",
        this.wsServers[randomIndex]
      );
      this.connected = true;
      if (this.jwt) {
        this.connect();
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      console.debug("initWebSocket::WebSocket closed");
      if (this.keepAliveTimeoutId) {
        clearTimeout(this.keepAliveTimeoutId);
        this.keepAliveTimeoutId = null;
      }
      this._reconnect();
    };

    this.ws.onerror = (error) => {
      console.error("initWebSocket::WebSocket onerror:", error);
      this.connected = false;
    };

    this.ws.onmessage = (event) => {
      this._handleWebSocketMessage(event.data);
    };
  }

  /**
   * Authenticate the WebSocket session with session.connect
   * Must be called within 5 seconds of connecting per server spec.
   */
  async connect(): Promise<ISession> {
    const deviceId =
      localStorage.getItem(EStorageKey.deviceId) || this._generateDeviceId();
    const device = {
      sdk_version: this.sdkVersion,
      user_agent: navigator.userAgent || "Unknown",
      language: navigator.language || "en-US",
      device_id: deviceId,
      capabilities: {
        webrtc: this.isWebRTCSupport,
        video: true,
        audio: true,
      },
    };

    try {
      const session = await this.sendRPCMessage<ISession>(
        EMessageNotification.CONNECT,
        {
          token: this.jwt,
          device: device,
        }
      );
      this.session = session;
      this.events.emit(EClientEventName.SESSION, session);
      this._resolveReady(session);

      // After successful reconnection, restore active calls
      if (this.isReconnecting) {
        this.isReconnecting = false;
        await this._reconnectCalls();
      }

      return session;
    } catch (error: any) {
      this.events.emit(EClientEventName.ERROR, {
        code: 401,
        message: error.message,
      });
      this._rejectReady(error);
      this._cleanupSession();
      throw error;
    }
  }

  /**
   * Send login with username, password, domain
   * This will return JWT with Audience agent-api
   * @param username Agent username
   * @param password Agent password
   * @param domain Workspace domain. Example: yourworkspace.firetell.com
   */
  public async login(
    username: string,
    password: string,
    domain: string
  ): Promise<void> {
    if (!username || !password) {
      return Promise.reject(new Error("Username and password are required"));
    }
    if (!domain) {
      return Promise.reject(new Error("domain is required"));
    }

    // login with http call
    const response = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username,
        password,
        domain,
      }),
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    this.jwt = data.access_token;
    await this.connect();
    if (!this.connected) {
      return Promise.reject(
        new Error("Cannot login: WebSocket not connected")
      );
    }
    return Promise.resolve();
  }

  /**
   * Make a new outbound call.
   * Sends call.offer with { to, sdp, number } per server spec.
   * @param call Call instance
   * @param sdp RTCSessionDescription (full SDP with ICE candidates)
   * @returns call_id if success
   */
  public async makeCall(
    call: Call,
    sdp: RTCSessionDescription
  ): Promise<string> {
    if (!(call instanceof Call)) {
      return Promise.reject(new Error("Missing or invalid call instance"));
    }
    if (!sdp) {
      return Promise.reject(new Error("Missing or invalid sdp"));
    }
    if (this.activeCalls.size > 0) {
      return Promise.reject(
        new Error(
          "Cannot make a new call while another call is active. Please hang up or reject the current call."
        )
      );
    }
    if (!this.isWebRTCSupport) {
      return Promise.reject(
        new Error("WebRTC is not supported in this environment.")
      );
    }
    try {
      const result = await this.sendRPCMessage<{ call_id: string }>(
        EMessageNotification.CALL_OFFER,
        {
          to: call.calleeId,
          sdp: sdp.sdp,
          number: call.number,
        }
      );
      call.callId = result.call_id;
      this.activeCalls.set(result.call_id, call);
      return result.call_id;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Send Hold a Call
   * @param callId call_id
   * @param sdp RTCSessionDescriptionInit
   */
  async sendHold(
    callId: string,
    sdp: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescription> {
    try {
      const result = await this.sendRPCMessage<RTCSessionDescription>(
        EMessageNotification.CALL_HOLD,
        {
          call_id: callId,
          sdp: sdp,
        }
      );
      return result;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Send UnHold
   * @param callId call_id
   * @param sdp RTCSessionDescriptionInit
   */
  async sendUnHold(
    callId: string,
    sdp: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescription> {
    try {
      const result = await this.sendRPCMessage<RTCSessionDescription>(
        EMessageNotification.CALL_UNHOLD,
        {
          call_id: callId,
          sdp: sdp,
        }
      );
      return result;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Send Hangup
   * @param callId call_id
   */
  async sendHangup(callId: string): Promise<void> {
    try {
      await this.sendRPCMessage(EMessageNotification.CALL_HANGUP, {
        call_id: callId,
      });
      this.activeCalls.delete(callId);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Send Accept (answer an incoming call)
   * @param callId call_id
   * @param sdp RTCSessionDescription (answer SDP)
   */
  async sendAccept(
    callId: string,
    sdp: RTCSessionDescription
  ): Promise<void> {
    try {
      const call = this.activeCalls.get(callId);
      if (!call) return Promise.reject(new Error("Call not in session"));
      await this.sendRPCMessage(EMessageNotification.CALL_ANSWER, {
        call_id: callId,
        sdp: sdp,
        is_internal: call.isInternal || false,
        is_transfer: call.isTransfer || false,
      });
    } catch (error) {
      this.activeCalls.delete(callId);
      return Promise.reject(error);
    }
  }

  /**
   * Send Reject (reject an incoming call)
   * @param callId call_id
   */
  async sendReject(callId: string): Promise<void> {
    try {
      await this.sendRPCMessage(EMessageNotification.CALL_REJECT, {
        call_id: callId,
      });
      this.activeCalls.delete(callId);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Send Transfer — transfer the call to another agent
   * @param callId call_id
   * @param callee Username of the target agent
   */
  async sendTransfer(callId: string, callee: string): Promise<void> {
    try {
      await this.sendRPCMessage(EMessageNotification.CALL_TRANSFER, {
        call_id: callId,
        callee: callee,
      });
      this.activeCalls.delete(callId);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Send DTMF tone via SIP INFO
   * @param callId call_id
   * @param digit Single digit: 0-9, *, #, A-D
   * @param duration Duration in ms (default: 250)
   */
  async sendDTMF(
    callId: string,
    digit: string,
    duration: number = 250
  ): Promise<void> {
    if (!/^[0-9A-D*#]$/.test(digit)) {
      return Promise.reject(
        new Error("Invalid DTMF digit. Must be 0-9, A-D, *, or #")
      );
    }
    try {
      await this.sendRPCMessage(EMessageNotification.CALL_DTMF, {
        call_id: callId,
        digit: digit,
        duration: duration,
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Notify the server about mute/unmute state.
   * Server broadcasts this to other participants.
   * @param callId call_id
   * @param muted Whether the microphone is muted
   */
  async sendMute(callId: string, muted: boolean): Promise<void> {
    try {
      await this.sendRPCMessage(EMessageNotification.CALL_MUTE, {
        call_id: callId,
        muted: muted,
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Retrieve active calls after a WebSocket reconnection.
   * The server auto-swaps old socketId → new socketId during connect().
   */
  private async _reconnectCalls(): Promise<void> {
    try {
      const result = await this.sendRPCMessage<{
        active_calls: IActiveCall[];
      }>(EMessageNotification.CALL_RECONNECT, {});
      const activeCalls = result.active_calls || [];

      if (activeCalls.length > 0) {
        console.debug(
          `reconnectCalls::Restoring ${activeCalls.length} active call(s)`
        );
        this.events.emit(EClientEventName.RECONNECTED, activeCalls);
      } else {
        console.debug("reconnectCalls::No active calls to restore");
        // Clear any stale local calls
        this.activeCalls.forEach((call) => call.destroy());
        this.activeCalls.clear();
      }
    } catch (error) {
      console.error("reconnectCalls::Error:", error);
    }
  }

  /**
   * Send a JSON-RPC 2.0 message via WebSocket
   */
  sendRPCMessage<T>(
    method: string,
    params = {},
    callback = true
  ): Promise<T> {
    // Only session.connect is allowed without a valid session
    if (method !== EMessageNotification.CONNECT) {
      if (!this._checkSessionValidity()) {
        return Promise.reject(
          new Error("Session expired. Please login again.")
        );
      }
      if (!this.getSessionInfo()) {
        return Promise.reject(new Error("User not connected"));
      }
    }
    return new Promise((resolve, reject) => {
      const request = {
        jsonrpc: "2.0",
        method,
        params,
        ...(callback ? { id: this._generateTransactionId() } : {}),
      };

      if (callback) {
        const timeoutMs = 30000;
        const timeoutId = setTimeout(() => {
          this.pendingTransactions.delete(request.id!);
          reject(
            new Error(
              `Request method ${method} timed out after ${timeoutMs}ms`
            )
          );
        }, timeoutMs);

        this.pendingTransactions.set(request.id!, {
          resolve: (result: T) => {
            clearTimeout(timeoutId);
            resolve(result);
          },
          reject: (error: IRPCMessageError) => {
            clearTimeout(timeoutId);
            reject(error);
          },
        });

        this._sendWebsocket(request).catch((err) => {
          clearTimeout(timeoutId);
          this.pendingTransactions.delete(request.id!);
          reject(err);
        });
      } else {
        // Notification (fire-and-forget)
        this._sendWebsocket(request)
          .then(() => resolve(null as T))
          .catch(reject);
      }
    });
  }

  public getSessionInfo(): ISession | null {
    return this.session;
  }

  /**
   * Check session validity
   * @returns boolean
   */
  private _checkSessionValidity(): boolean {
    if (!this.session) return false;
    if (!this.session.expires_at || this.session.expires_at === 0) return false;
    if (Date.now() > this.session.expires_at) return false;
    return true;
  }

  /**
   * Cleanup session and remove all event listeners
   */
  private _cleanupSession(): void {
    this.session = null;
    this.events.emit(EClientEventName.SESSION, null);
    this.events.offAll();
  }

  /**
   * Send WebSocket request
   */
  private _sendWebsocket(request: any): Promise<number | undefined> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(request));
      return Promise.resolve(request.id);
    } else {
      return Promise.reject(new Error("WebSocket is not connected"));
    }
  }

  private _generateTransactionId(): number {
    return this.transactionId++;
  }

  private _generateDeviceId(): string {
    const uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }
    );
    localStorage.setItem(EStorageKey.deviceId, uuid);
    return uuid;
  }

  private isVideoCall(sdp: RTCSessionDescriptionInit): boolean {
    return /m=video/.test(sdp.sdp || "");
  }

  private _checkWebRTCSupport(): Promise<boolean> {
    const hasRTCPeerConnection = !!window.RTCPeerConnection;
    const hasGetUserMedia = !!(
      navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    );
    if (!hasRTCPeerConnection || !hasGetUserMedia) {
      const errorMsg = "WebRTC is not supported in this environment.";
      console.error(errorMsg);
      this.events.emit(EClientEventName.ERROR, {
        code: 606,
        message: errorMsg,
      });
      return Promise.resolve(false);
    }
    return Promise.resolve(true);
  }

  /**
   * Handle server notification messages
   */
  private _handleMessageNotification(message: {
    notification: EMessageNotification;
    params: any;
  }) {
    const { notification, params } = message;

    // Heartbeat: session.ping → respond with session.pong
    if (notification === EMessageNotification.PING) {
      this._keepAlive(params);
      return;
    }

    // Call state change notification
    if (notification === EMessageNotification.CALL_STATE) {
      const { call_id, state, sdp, reason } = params;
      const call = this.activeCalls.get(call_id);
      if (call) {
        // Set remote SDP BEFORE processing terminal states,
        // because destroy() closes the peerConnection
        if (sdp) {
          call.setRemoteDescription(sdp as RTCSessionDescription);
        }
        call.setSignalState(state, params);
        if (
          [ECallState.ENDED, ECallState.ERROR, ECallState.CANCEL].includes(
            state
          )
        ) {
          this.activeCalls.delete(call_id);
          call.active = false;
          call.destroy();
          if (state === ECallState.CANCEL) {
            console.debug(
              `call ${call_id} state is CANCEL with reason ${reason}`
            );
          }
        }
      } else {
        console.debug(
          `call ${call_id} with state ${state} not found in this session`
        );
      }
      return;
    }

    // Incoming call notification
    if (notification === EMessageNotification.CALL_OFFER) {
      const { call_id, number, sdp, is_transfer, caller } = params;
      const call = new Call(this, {
        number: number,
        caller: caller,
        calleeId: this.getSessionInfo()?.username || "",
        isVideo: this.isVideoCall(sdp),
        isTransfer: is_transfer || false,
      });
      call.callId = call_id;
      call.remoteDescription = sdp;

      this.activeCalls.set(call_id, call);
      this.events.emit(EClientEventName.CALL_OFFER, call);
      return;
    }

    // Mute notification from another participant
    if (notification === EMessageNotification.CALL_MUTE) {
      const { call_id, username, muted } = params;
      const call = this.activeCalls.get(call_id);
      if (call) {
        call.emit("mute", { username, muted });
      }
      this.events.emit(EClientEventName.CALL_MUTE, params);
      return;
    }

    // Agent online/offline status
    if (notification === EMessageNotification.AGENT_STATE) {
      this.events.emit(EClientEventName.AGENT_STATE, params);
      return;
    }
  }

  /**
   * Parse incoming WebSocket messages (JSON-RPC 2.0)
   */
  private _handleWebSocketMessage(event: string) {
    try {
      const message = JSON.parse(event);

      // Server notification (no jsonrpc field, has notification field)
      if (message["notification"]) {
        this._handleMessageNotification(message);
        return;
      }

      if (!message.jsonrpc || message.jsonrpc !== "2.0") {
        const error = new Error("Invalid JSON-RPC message");
        this.events.emit(EClientEventName.ERROR, {
          code: 400,
          message: error.message,
        });
        console.error(error.message);
        return;
      }

      // Response to a pending transaction
      if (
        message.id !== undefined &&
        message.id !== null &&
        this.pendingTransactions.has(message.id)
      ) {
        const { resolve, reject } = this.pendingTransactions.get(message.id)!;
        const { error, result } = message;

        if (error) {
          reject(
            new Error(
              typeof error.data === "string" ? error.data : error.message
            )
          );
        } else if (result && result.data !== undefined) {
          resolve(
            typeof result.data === "object" ? result.data : result
          );
        } else {
          reject(
            new Error(
              result?.message || message.code || "Unknown error"
            )
          );
        }

        this.pendingTransactions.delete(message.id);
      }
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
      this.events.emit(EClientEventName.ERROR, {
        code: 500,
        message: "Failed to parse WebSocket message",
      });
    }
  }

  /**
   * Respond to server heartbeat ping with session.pong.
   * Tracks missed heartbeats — if MAX_HEARTBEAT_MISS consecutive
   * pongs fail, triggers reconnection.
   */
  private _keepAlive(paramsFromServer: { timestamp?: number }) {
    if (!this.connected || !this.ws || !this.getSessionInfo()) {
      console.debug("Skipping keep-alive: not connected or no session");
      return;
    }

    // Reset miss counter on every received ping
    this.heartbeatMissCount = 0;

    // Clear previous heartbeat timeout
    if (this.keepAliveTimeoutId) {
      clearTimeout(this.keepAliveTimeoutId);
    }

    // Set a watchdog: if no ping arrives within 90s (server sends every 60s),
    // consider connection stale
    this.keepAliveTimeoutId = setTimeout(() => {
      this.heartbeatMissCount++;
      console.warn(
        `keepAlive::Missed heartbeat #${this.heartbeatMissCount}`
      );
      if (this.heartbeatMissCount >= FiretellClient.MAX_HEARTBEAT_MISS) {
        console.error("keepAlive::Too many missed heartbeats, reconnecting");
        this.ws?.close(); // triggers onclose → reconnect
      }
    }, 90000);

    this.sendRPCMessage(
      EMessageNotification.PONG,
      { timestamp: paramsFromServer.timestamp || Date.now() },
      false
    );
  }

  public logout() {
    // Destroy all active calls
    this.activeCalls.forEach((call) => call.destroy());
    this.activeCalls.clear();
    this._cleanupSession();
    this._disconnect();
  }

  /**
   * Reconnect WebSocket with exponential backoff.
   * After reconnection, calls connect() then reconnectCalls() per ws-signaling spec.
   */
  private _reconnect() {
    if (this.connected && this.ws) {
      console.debug("#reconnect::Already connected, no need to reconnect");
      return;
    }
    if (!this.session && !this.jwt) {
      console.debug("#reconnect::User not logged in, no need to reconnect");
      return;
    }

    this._disconnect();
    this.isReconnecting = true;

    this.retryWebsocket = (this.retryWebsocket || 0) + 1;
    const maxRetries = 30;
    if (this.retryWebsocket > maxRetries) {
      console.error(
        "#reconnect::Max reconnect attempts reached:",
        this.retryWebsocket
      );
      if (this.retryWebsocketTimeoutId) {
        clearTimeout(this.retryWebsocketTimeoutId);
        this.retryWebsocketTimeoutId = null;
      }
      this.events.emit(EClientEventName.ERROR, {
        code: 500,
        message: "Failed to reconnect after max retries",
      });
      return;
    }

    const delay = Math.min(
      3000 * Math.pow(1.5, this.retryWebsocket),
      25000
    );
    console.log(
      `#reconnect::Reconnecting in ${delay}ms (attempt ${this.retryWebsocket})`
    );

    if (this.retryWebsocketTimeoutId) {
      clearTimeout(this.retryWebsocketTimeoutId);
    }

    this.retryWebsocketTimeoutId = setTimeout(() => {
      if (this.connected && this.ws) {
        console.debug("#reconnect::Already connected, skipping");
        return;
      }

      const randomIndex = Math.floor(Math.random() * this.wsServers.length);
      const wsUrl = `${this.wsServers[randomIndex]}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = async () => {
        console.debug(
          "#reconnect::WebSocket reconnected to:",
          this.wsServers[randomIndex]
        );
        this.connected = true;
        if (this.retryWebsocketTimeoutId) {
          clearTimeout(this.retryWebsocketTimeoutId);
          this.retryWebsocketTimeoutId = null;
        }
        this.retryWebsocket = 0;
        if (this.jwt) {
          this.connect();
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        console.debug("#reconnect::WebSocket disconnected");
        if (this.keepAliveTimeoutId) {
          clearTimeout(this.keepAliveTimeoutId);
          this.keepAliveTimeoutId = null;
        }
        this._reconnect();
      };

      this.ws.onerror = (error) => {
        console.error("#reconnect::WebSocket error:", error);
        this.connected = false;
      };

      this.ws.onmessage = (event) => {
        this._handleWebSocketMessage(event.data);
      };
    }, delay);
  }

  private _disconnect() {
    if (this.keepAliveTimeoutId) {
      clearTimeout(this.keepAliveTimeoutId);
      this.keepAliveTimeoutId = null;
    }
    this.heartbeatMissCount = 0;

    if (this.ws) {
      // Remove handlers to prevent reconnect loop during intentional disconnect
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
      this.connected = false;
      this.pendingTransactions.clear();
    }
  }

  /**
   * Parse JWT token
   * @param jwt JWT token string
   * @returns Decoded payload or null if invalid
   */
  private _parseJwt(jwt: string): IJwtPayload | null {
    try {
      const parts = jwt.split(".");
      if (parts.length < 2) {
        console.error("parseJwt::Invalid token format");
        return null;
      }

      // Convert base64url → base64
      const base64 = parts[1]
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(
          parts[1].length + ((4 - (parts[1].length % 4)) % 4),
          "="
        );

      // Decode base64 safe for Node & Browser, support UTF-8
      let jsonString: string;

      if (typeof window === "undefined") {
        // Node.js environment
        jsonString = Buffer.from(base64, "base64").toString("utf-8");
      } else {
        // Browser environment
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const decoder = new TextDecoder("utf-8");
        jsonString = decoder.decode(bytes);
      }

      const decoded: IJwtPayload = JSON.parse(jsonString);

      if (decoded.username && decoded.domain) {
        return decoded;
      } else {
        console.error("parseJwt::Invalid payload structure", decoded);
        return null;
      }
    } catch (e) {
      console.error("parseJwt::Error parsing JWT:", e);
      return null;
    }
  }
}