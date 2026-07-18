import { SimpleEventEmitter } from "./simple-event-emitter";
import { Call } from "./call";
import { ISession } from "./interfaces/session.interface";
import { IRPCMessageError } from "./interfaces/rpc-message.interface";
import { IActiveCall } from "./interfaces/active-call.interface";
import { EMessageNotification } from "./enums/message-notification.enum";
import { ECallState } from "./enums/call-state.enum";
import { EClientEventName } from "./enums/client-event-name.enum";
import { EStorageKey } from "./enums/storage-key.enum";
import { IJwtPayload } from "./interfaces/jwt-payload.interface";
import { API_ENDPOINTS } from "./constants/api-endpoints";

const SDK_VERSION = "1.0.0";

/** JSON-RPC 2.0 request shape */
interface IRPCRequest {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
  id?: number;
}

/** Params for a call.state notification */
interface ICallStateParams {
  call_id: string;
  state: ECallState;
  sdp?: RTCSessionDescriptionInit;
  reason?: string;
}

/** Params for a call.offer (incoming call) notification */
interface ICallOfferParams {
  call_id: string;
  number: string;
  sdp: RTCSessionDescriptionInit;
  is_transfer?: boolean;
  caller: string;
}

/** Params for a call.mute notification */
interface ICallMuteParams {
  call_id: string;
  username: string;
  muted: boolean;
}

export class FiretellClient {
  public readonly sdkVersion = SDK_VERSION;
  private baseUrl = "";
  private ws: WebSocket | null = null;
  private jwt: string = "";
  private jwtPayload: IJwtPayload | null = null;
  private wsServers: string[] = [];
  public iceServers: RTCIceServer[] = [];
  private transactionId: number = 1;
  private pendingTransactions = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();
  private session: ISession | null = null;
  private keepAliveTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private heartbeatMissCount: number = 0;
  private static readonly MAX_HEARTBEAT_MISS = 3;
  private retryWebsocket: number = 0;
  private retryWebsocketTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isReconnecting: boolean = false;
  private webRTCChecked: boolean = false;

  /**
   * @event session, incomingCall, error, reconnected, workspace.agent.state
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
  public readonly activeCalls = new Map<string, Call>();

  /** Notification handler map — eliminates if-else chain */
  private readonly notificationHandlers = new Map<
    EMessageNotification,
    (params: Record<string, unknown>) => void
  >([
    [EMessageNotification.PING, (p) => this._keepAlive(p as { timestamp?: number })],
    [EMessageNotification.CALL_STATE, (p) => this._handleCallState(p as unknown as ICallStateParams)],
    [EMessageNotification.CALL_OFFER, (p) => this._handleIncomingCall(p as unknown as ICallOfferParams)],
    [EMessageNotification.CALL_MUTE, (p) => this._handleCallMute(p as unknown as ICallMuteParams)],
    [EMessageNotification.AGENT_STATE, (p) => this.events.emit(EClientEventName.AGENT_STATE, p)],
  ]);

  /**
   * FiretellClient constructor
   * @param jwt Json Web Token
   * @param domain Workspace API domain
   */
  constructor(jwt: string, domain: string) {
    if (!jwt) throw new Error("jwt is required in constructor");
    const payload = this._parseJwt(jwt);
    if (!payload) throw new Error("Invalid JWT");
    this.jwt = jwt;
    this.jwtPayload = payload;
    this.ready = new Promise<ISession>((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    this.baseUrl = this._checkWorkspaceDomain(domain);
    this._fetchWorkspaceMetadata();
  }

  private _checkWorkspaceDomain(domain: string): string {
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

  private async _fetchWorkspaceMetadata(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}${API_ENDPOINTS.WORKSPACE_METADATA}`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.jwt}`,
        },
        method: "GET",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
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
      this._rejectReady(
        error instanceof Error
          ? error
          : new Error("Failed to fetch workspace metadata")
      );
    }
  }

  /**
   * Initialize or re-initialize the WebSocket connection.
   * Used by both initial connect and reconnect flows — single source of truth.
   */
  private _initWebSocket(): void {
    if (!this.webRTCChecked) {
      this.webRTCChecked = true;
      this.isWebRTCSupport = this._checkWebRTCSupport();
    }

    const randomIndex = Math.floor(Math.random() * this.wsServers.length);
    const wsUrl = this.wsServers[randomIndex];
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.debug("WebSocket connected to:", wsUrl);
      this.connected = true;
      this.retryWebsocket = 0;
      if (this.retryWebsocketTimeoutId) {
        clearTimeout(this.retryWebsocketTimeoutId);
        this.retryWebsocketTimeoutId = null;
      }
      if (this.jwt) {
        this.connect();
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      console.debug("WebSocket closed");
      if (this.keepAliveTimeoutId) {
        clearTimeout(this.keepAliveTimeoutId);
        this.keepAliveTimeoutId = null;
      }
      this._reconnect();
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      this.connected = false;
    };

    this.ws.onmessage = (event) => {
      this._handleWebSocketMessage(event.data);
    };
  }

  /**
   * Authenticate the WebSocket session with session.connect.
   * Must be called within 5 seconds of connecting per server spec.
   */
  public async connect(): Promise<ISession> {
    const deviceId =
      localStorage.getItem(EStorageKey.DEVICE_ID) || this._generateDeviceId();
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
    } catch (error: unknown) {
      const err =
        error instanceof Error ? error : new Error(String(error));
      this.events.emit(EClientEventName.ERROR, {
        code: 401,
        message: err.message,
      });
      this._rejectReady(err);
      this._cleanupSession();
      throw err;
    }
  }

  /**
   * Send login with username, password, domain.
   * Returns JWT with Audience agent-api.
   * Automatically reconnects the WebSocket with the new token.
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
      throw new Error("Username and password are required");
    }
    if (!domain) {
      throw new Error("domain is required");
    }

    const response = await fetch(`${this.baseUrl}${API_ENDPOINTS.AUTH_LOGIN}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password, domain }),
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }

    this.jwt = data.access_token;
    const payload = this._parseJwt(this.jwt);
    if (!payload) throw new Error("Invalid JWT received from login");
    this.jwtPayload = payload;

    // Reconnect WebSocket with new JWT — _initWebSocket will call connect() on open
    this._disconnect();
    this._initWebSocket();
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
      throw new Error("Missing or invalid call instance");
    }
    if (!sdp) {
      throw new Error("Missing or invalid sdp");
    }
    if (this.activeCalls.size > 0) {
      throw new Error(
        "Cannot make a new call while another call is active. Please hang up or reject the current call."
      );
    }
    if (!this.isWebRTCSupport) {
      throw new Error("WebRTC is not supported in this environment.");
    }

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
  }

  /**
   * Send Hold a Call
   * @param callId call_id
   * @param sdp RTCSessionDescriptionInit
   */
  public async sendHold(
    callId: string,
    sdp: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescription> {
    return this.sendRPCMessage<RTCSessionDescription>(
      EMessageNotification.CALL_HOLD,
      { call_id: callId, sdp }
    );
  }

  /**
   * Send UnHold
   * @param callId call_id
   * @param sdp RTCSessionDescriptionInit
   */
  public async sendUnHold(
    callId: string,
    sdp: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescription> {
    return this.sendRPCMessage<RTCSessionDescription>(
      EMessageNotification.CALL_UNHOLD,
      { call_id: callId, sdp }
    );
  }

  /**
   * Send Hangup
   * @param callId call_id
   */
  public async sendHangup(callId: string): Promise<void> {
    await this.sendRPCMessage(EMessageNotification.CALL_HANGUP, {
      call_id: callId,
    });
    this.activeCalls.delete(callId);
  }

  /**
   * Send Accept (answer an incoming call)
   * @param callId call_id
   * @param sdp RTCSessionDescription (answer SDP)
   */
  public async sendAccept(
    callId: string,
    sdp: RTCSessionDescription
  ): Promise<void> {
    const call = this.activeCalls.get(callId);
    if (!call) throw new Error("Call not in session");
    try {
      await this.sendRPCMessage(EMessageNotification.CALL_ANSWER, {
        call_id: callId,
        sdp,
        is_internal: call.isInternal || false,
        is_transfer: call.isTransfer || false,
      });
    } catch (error) {
      this.activeCalls.delete(callId);
      throw error;
    }
  }

  /**
   * Send Reject (reject an incoming call)
   * @param callId call_id
   */
  public async sendReject(callId: string): Promise<void> {
    await this.sendRPCMessage(EMessageNotification.CALL_REJECT, {
      call_id: callId,
    });
    this.activeCalls.delete(callId);
  }

  /**
   * Send Transfer — transfer the call to another agent
   * @param callId call_id
   * @param callee Username of the target agent
   */
  public async sendTransfer(callId: string, callee: string): Promise<void> {
    await this.sendRPCMessage(EMessageNotification.CALL_TRANSFER, {
      call_id: callId,
      callee,
    });
    this.activeCalls.delete(callId);
  }

  /**
   * Send DTMF tone via SIP INFO
   * @param callId call_id
   * @param digit Single digit: 0-9, *, #, A-D
   * @param duration Duration in ms (default: 250)
   */
  public async sendDTMF(
    callId: string,
    digit: string,
    duration: number = 250
  ): Promise<void> {
    if (!/^[0-9A-D*#]$/.test(digit)) {
      throw new Error("Invalid DTMF digit. Must be 0-9, A-D, *, or #");
    }
    await this.sendRPCMessage(EMessageNotification.CALL_DTMF, {
      call_id: callId,
      digit,
      duration,
    });
  }

  /**
   * Notify the server about mute/unmute state.
   * Server broadcasts this to other participants.
   * @param callId call_id
   * @param muted Whether the microphone is muted
   */
  public async sendMute(callId: string, muted: boolean): Promise<void> {
    await this.sendRPCMessage(EMessageNotification.CALL_MUTE, {
      call_id: callId,
      muted,
    });
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
  public sendRPCMessage<T>(
    method: string,
    params: Record<string, unknown> = {},
    callback = true
  ): Promise<T> {
    // Only session.connect is allowed without a valid session
    if (method !== EMessageNotification.CONNECT) {
      if (!this._checkSessionValidity()) {
        throw new Error("Session expired. Please login again.");
      }
      if (!this.getSessionInfo()) {
        throw new Error("User not connected");
      }
    }
    return new Promise((resolve, reject) => {
      const request: IRPCRequest = {
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
          resolve: (result: unknown) => {
            clearTimeout(timeoutId);
            resolve(result as T);
          },
          reject: (error: unknown) => {
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
   * Get the decoded JWT payload
   */
  public getJwtPayload(): IJwtPayload | null {
    return this.jwtPayload;
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
  private _sendWebsocket(request: IRPCRequest): Promise<number | undefined> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(request));
      return Promise.resolve(request.id);
    }
    return Promise.reject(new Error("WebSocket is not connected"));
  }

  private _generateTransactionId(): number {
    // Reset to prevent overflow beyond Number.MAX_SAFE_INTEGER
    if (this.transactionId >= Number.MAX_SAFE_INTEGER) {
      this.transactionId = 1;
    }
    return this.transactionId++;
  }

  private _generateDeviceId(): string {
    const uuid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
            /[xy]/g,
            function (c) {
              const r = (Math.random() * 16) | 0;
              const v = c === "x" ? r : (r & 0x3) | 0x8;
              return v.toString(16);
            }
          );
    localStorage.setItem(EStorageKey.DEVICE_ID, uuid);
    return uuid;
  }

  private isVideoCall(sdp: RTCSessionDescriptionInit): boolean {
    return /m=video/.test(sdp.sdp || "");
  }

  /**
   * Check WebRTC support synchronously
   */
  private _checkWebRTCSupport(): boolean {
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
      return false;
    }
    return true;
  }

  // ─── Notification handlers ────────────────────────────────────────────

  /**
   * Handle call.state notification
   */
  private _handleCallState(params: ICallStateParams): void {
    const { call_id, state, sdp, reason } = params;
    const call = this.activeCalls.get(call_id);
    if (!call) {
      console.debug(
        `call ${call_id} with state ${state} not found in this session`
      );
      return;
    }

    // Set remote SDP BEFORE processing terminal states,
    // because destroy() closes the peerConnection
    if (sdp) {
      call.setRemoteDescription(sdp as RTCSessionDescription);
    }
    call.setSignalState(state, params as unknown as Record<string, unknown>);

    if (
      [ECallState.ENDED, ECallState.ERROR, ECallState.CANCEL].includes(state)
    ) {
      this.activeCalls.delete(call_id);
      call.active = false;
      call.destroy();
      if (state === ECallState.CANCEL) {
        console.debug(`call ${call_id} state is CANCEL with reason ${reason}`);
      }
    }
  }

  /**
   * Handle incoming call.offer notification
   */
  private _handleIncomingCall(params: ICallOfferParams): void {
    const { call_id, number, sdp, is_transfer, caller } = params;
    const call = new Call(this, {
      number,
      caller,
      calleeId: this.getSessionInfo()?.username || "",
      isVideo: this.isVideoCall(sdp),
      isTransfer: is_transfer || false,
    });
    call.callId = call_id;
    call.remoteDescription = sdp;

    this.activeCalls.set(call_id, call);
    this.events.emit(EClientEventName.CALL_OFFER, call);
  }

  /**
   * Handle call.mute notification from another participant
   */
  private _handleCallMute(params: ICallMuteParams): void {
    const { call_id, username, muted } = params;
    const call = this.activeCalls.get(call_id);
    if (call) {
      call.emit("mute", { username, muted });
    }
    this.events.emit(EClientEventName.CALL_MUTE, params);
  }

  // ─── Message routing ──────────────────────────────────────────────────

  /**
   * Handle server notification messages using handler map
   */
  private _handleMessageNotification(message: {
    notification: EMessageNotification;
    params: Record<string, unknown>;
  }): void {
    const { notification, params } = message;
    const handler = this.notificationHandlers.get(notification);
    if (handler) {
      handler(params);
    } else {
      console.debug(`Unhandled notification: ${notification}`);
    }
  }

  /**
   * Parse incoming WebSocket messages (JSON-RPC 2.0)
   */
  private _handleWebSocketMessage(event: string): void {
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

  // ─── Heartbeat ────────────────────────────────────────────────────────

  /**
   * Respond to server heartbeat ping with session.pong.
   * Tracks missed heartbeats — if MAX_HEARTBEAT_MISS consecutive
   * pongs fail, triggers reconnection.
   */
  private _keepAlive(paramsFromServer: { timestamp?: number }): void {
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

  // ─── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Logout and cleanup all resources.
   * Destroys active calls, clears session, and disconnects WebSocket.
   */
  public logout(): void {
    this.activeCalls.forEach((call) => call.destroy());
    this.activeCalls.clear();
    this._cleanupSession();
    this._disconnect();
  }

  /**
   * Fully destroy the client instance.
   * Cleans up all timers, connections, calls and listeners.
   * Use this when you want to dispose of the SDK without sending logout to the server.
   */
  public destroy(): void {
    // Clear reconnect timer
    if (this.retryWebsocketTimeoutId) {
      clearTimeout(this.retryWebsocketTimeoutId);
      this.retryWebsocketTimeoutId = null;
    }

    // Destroy all active calls
    this.activeCalls.forEach((call) => call.destroy());
    this.activeCalls.clear();

    // Disconnect WebSocket
    this._disconnect();

    // Clear session & auth state
    this.session = null;
    this.jwtPayload = null;
    this.jwt = "";

    // Remove all event listeners
    this.events.offAll();
  }

  /**
   * Reconnect WebSocket with exponential backoff.
   * Reuses _initWebSocket() to avoid handler duplication.
   */
  private _reconnect(): void {
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
      this._initWebSocket();
    }, delay);
  }

  private _disconnect(): void {
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

      if (decoded.sub && decoded.domain) {
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