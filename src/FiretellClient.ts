import { SimpleEventEmitter } from "./SimpleEventEmitter";
import { Call } from "./Call";
import { ISession } from "./interfaces/ISession";
import { IRPCMessageError, IRPCMessageResult } from "./interfaces/IRPCMessageResult";
import { EMessageNotification } from "./enums/EMessageNotification.enum";
import { ECallState } from "./enums/ECallState.enum";
import { EClientEventName } from "./enums/EClientEventName.enum";
import { EStorageKey } from "./enums/ELocalStorageKey.enum";
import { name as packageId, version as packageVersion } from '../package.json';
import { IJwtPayload } from "./interfaces/IJwtPayload";

export class FiretellClient {
  public sdkVersion = packageVersion;
  private baseUrl = "";
  private ws: WebSocket | null;
  private jwt: string = "";
  private wsServers: string[] = [];
  public iceServers: RTCIceServer[] = [];
  private transactionId: number = 1;
  private pendingTransactions = new Map();
  private session: ISession | null = null;
  private keepAliveTimeoutId: number;
  private retryWebsocket: number = 0;
  private retryWebsocketTimeoutId: any;
  /**
   * @event
   * session, incommingCall, error
   */
  public events = new SimpleEventEmitter();
  public isWebRTCSupport: boolean = false;
  public connected: boolean = false;
  /**
   * Current active calls Map<call_id, Call>
   */
  activeCalls = new Map<string, Call>();
  /**
   * FiretellClient constructor
   * @param jwt Json Web Token
   */
  constructor(jwt: string, baseUrl: string = "https://api.firetell.com/1.0") {
    if (!jwt) throw new Error('jwt is required in constructor');
    if (!this.parseJwt(jwt)) throw new Error('Invalid JWT');
    this.jwt = jwt;
    this.ws = null;
    this.baseUrl = baseUrl;
    this.fetchWorkspaceMetadata();
  }
  private async fetchWorkspaceMetadata() {
    try {
      const response = await fetch(`${this.baseUrl}/api`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.jwt}`
        },
        method: 'GET',
      });
      const data = await response.json() as { ws_servers: string[], ice_servers: RTCIceServer[] };
      this.wsServers = data.ws_servers;
      this.iceServers = data.ice_servers;
      this.initWebSocket();
    } catch (error) {
      console.error("fetchWorkspaceDataCenter::Error fetching workspace config:", error);
    }
  }
  private initWebSocket(): void {
    this.checkWebRTCSupport().then(
      (isSupport) => (this.isWebRTCSupport = isSupport)
    );

    // Select random wsServers
    const randomIndex = Math.floor(Math.random() * this.wsServers.length);
    const wsUrl = `${this.wsServers[randomIndex]}`;
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      console.debug("initWebSocket::WebSocket connected to:", this.wsServers[randomIndex]);
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
      }
      this.reconnect();

    };

    this.ws.onerror = (error) => {
      console.error("initWebSocket::WebSocket onerror:", error);
      this.connected = false;

    };

    this.ws.onmessage = (event) => {
      this.handleWebSocketMessage(event.data);
    };
  }

  connect() {

    return new Promise(async (resolve, reject) => {
      const deviceId = localStorage.getItem(EStorageKey.deviceId) || this.generateDeviceId();
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
        const session = await this.sendRPCMessage<ISession>(EMessageNotification.CONNECT, {
          token: this.jwt,
          device: device,
        });
        this.session = session;
        this.events.emit(EClientEventName.SESSION, session);
        this.subscribeNotificationServerEvents();
        resolve(session);

      } catch (error) {
        this.events.emit(EClientEventName.ERROR, { code: 401, message: error.message });
        this.cleanupSession();
        reject(error);
      }
    });

  }

  /**
   * Send login with username, password, domain
   * This will return JWT with Audience client-api
   * @param username Agent username
   * @param password Agent password
   * @param domain Workspace domain. Example: yourworkspace.telcheap.com
   * @returns 
   */
  public async login(username: string, password: string, domain: string) {

    if (!username || !password) {
      return Promise.reject(new Error("Username and password are required"));
    }
    if (!domain) {
      return Promise.reject(new Error("domain are required"));
    }
    if (!this.connected) {
      return Promise.reject(new Error("Cannot login: WebSocket not connected"));
    }
    try {
      const result = await this.sendRPCMessage<{ access_token: string, refresh_token: string }>(EMessageNotification.AUTH, { username, password, domain });
      this.jwt = result.access_token;
      this.connect();
      Promise.resolve(null);
    } catch (error) {
      this.cleanupSession();
      Promise.reject(error);
    }
  }

  /**
   * Make a new call
   * @param call Call instance
   * @param sdp RTCSessionDescription
   * @returns call_id if success
   */
  public async makeCall(call: Call, sdp: RTCSessionDescription): Promise<string> {
    if (!(call instanceof Call)) {
      return Promise.reject(new Error(`Missing or invalid call instance'`));
    }
    if (!sdp) {
      return Promise.reject(new Error(`Missing or invalid sdp'`));
    }
    if (this.activeCalls.size > 0) {
      return Promise.reject(new Error("Cannot make a new call while another call is active. Please hang up or reject the current call."));
    }
    if (!this.isWebRTCSupport) {
      return Promise.reject(new Error(`WebRTC is not supported in this environment.`));
    }
    try {
      const result = await this.sendRPCMessage<{ call_id: string }>(EMessageNotification.CALL_OFFER, { number: call.number, callee: call.calleeId, sdp: sdp });
      call.callId = result.call_id;
      this.activeCalls.set(result.call_id, call);
      return Promise.resolve(result.call_id);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Send Hold a Call
   * @param callId call_id
   * @param sdp RTCSessionDescriptionInit
   * @returns 
   */
  async sendHold(callId: string, sdp: RTCSessionDescriptionInit): Promise<RTCSessionDescription> {
    try {
      const result = await this.sendRPCMessage<RTCSessionDescription>(EMessageNotification.CALL_HOLD, {
        call_id: callId,
        sdp: sdp
      });
      return Promise.resolve(result);
    } catch (error) {
      return Promise.reject(error);
    }
  }
  /**
   * Send UnHold
   * @param callId call_id
   * @param sdp RTCSessionDescriptionInit
   * @returns 
   */
  async sendUnHold(callId: string, sdp: RTCSessionDescriptionInit): Promise<RTCSessionDescription> {
    try {
      const result = await this.sendRPCMessage<RTCSessionDescription>(EMessageNotification.CALL_UNHOLD, {
        call_id: callId,
        sdp: sdp
      });
      return Promise.resolve(result);
    } catch (error) {
      return Promise.reject(error);
    }
  }
  /**
   * Send Hangup
   * @param callId call_id
   * @returns 
   */
  async sendHangup(callId: string) {

    try {
      await this.sendRPCMessage(EMessageNotification.CALL_HANGUP, { call_id: callId });
      this.activeCalls.delete(callId);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async sendAccept(callId: string, sdp: RTCSessionDescription) {
    if (this.activeCalls.size > 0) {
      // return Promise.reject(new Error(`Cannot accept a new call while another call is active. Please hang up the current call first.`));
      // hang up the current call
      this.activeCalls.forEach(call => {
        call.hangup();
      });
    }
    try {
      const call = this.activeCalls.get(callId);
      if (!call) return Promise.reject(`Call not in session`);
      const answer = await this.sendRPCMessage(EMessageNotification.CALL_ANSWER, { call_id: callId, sdp: sdp, is_transfer: call.isTransfer });
      console.log("answer response", answer);
      return Promise.resolve();
    } catch (error) {
      this.activeCalls.delete(callId);
      return Promise.reject(error);
    }
  }

  async sendReject(callId: string) {
    try {
      await this.sendRPCMessage(EMessageNotification.CALL_REJECT, { call_id: callId });
      this.activeCalls.delete(callId);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async sendTransfer(callId: string, callee: string) {
    try {
      await this.sendRPCMessage(EMessageNotification.CALL_TRANSFER, { call_id: callId, callee: callee });
      this.activeCalls.delete(callId);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Send a message JSON-RPC 2.0 to telcheap signaling via WebSocket
   */
  sendRPCMessage<T>(method: string, params = {}, callback = true): Promise<T> {
    // Check session
    if (!['connect', 'auth', 'session'].includes(method)) {
      if (!this.checkSessionValidity()) {
        return Promise.reject(new Error("Session expired. Please login again."));
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
        ...(callback ? { id: this.generateTransactionId() } : {}),
      };

      if (callback) {
        const timeoutMs = 30000; // Timeout 30s
        const timeoutId = setTimeout(() => {
          this.pendingTransactions.delete(request.id);
          reject(new Error(`Request method ${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        this.pendingTransactions.set(request.id, {
          resolve: (result: T) => {
            clearTimeout(timeoutId);
            resolve(result);
          },
          reject: (error: IRPCMessageError) => {
            clearTimeout(timeoutId);
            reject(error);
          },
        });

        this.sendWebsocket(request).catch((err) => {
          clearTimeout(timeoutId);
          this.pendingTransactions.delete(request.id);
          reject(err);
        });
      } else {
        // is Notification message event from server (fire-and-forget)
        this.sendWebsocket(request)
          .then(() => resolve(null))
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
  private checkSessionValidity() {
    if (!this.session.expires_at || this.session.expires_at === 0) return false;
    if (Date.now() > this.session.expires_at) return false;
    return true;
  }

  /**
   * Cleanup session
   */
  private cleanupSession(): void {
    this.session = null;
    this.events.emit(EClientEventName.SESSION, null);
    this.events.offAll();
  }

  /**
   * Send WebSocket request
   * @param request Request
   * @returns Promise
   */
  private sendWebsocket(request: any) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(request));
      return Promise.resolve(request.id);
    } else {
      return Promise.reject(new Error("WebSocket is not connected"));
    }
  }
  private generateTransactionId() {
    return this.transactionId++;
  }
  private generateDeviceId() {
    const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
    localStorage.setItem(EStorageKey.deviceId, uuid);
    return uuid;
  }
  private isVideoCall(sdp: RTCSessionDescription) {
    return /m=video/.test(sdp.sdp);
  }
  private checkWebRTCSupport() {
    const hasRTCPeerConnection = !!window.RTCPeerConnection;
    const hasGetUserMedia = !!(
      navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    );
    if (!hasRTCPeerConnection || !hasGetUserMedia) {
      const errorMsg = "WebRTC is not supported in this environment.";
      console.error(errorMsg);
      this.events.emit(EClientEventName.ERROR, { code: 606, message: errorMsg });
      return Promise.resolve(false);
    }
    return Promise.resolve(true);
  }

  private handleMessageNotification(message: { notification: EMessageNotification, params: any }) {
    const { notification, params } = message;
    if (notification === EMessageNotification.PING) {
      // send keep alive
      this.keepAlive(params);
    }
    if (notification === EMessageNotification.CALL_STATE) {
      const { call_id, state, sdp, reason } = params;
      const call = this.activeCalls.get(call_id);
      if (call) {
        call.setSignalState(state, params);
        if ([ECallState.ENDED, ECallState.ERROR].includes(state)) {
          this.activeCalls.delete(call_id);
          call.active = false;
          call.destroy();
        }
        if (state === ECallState.CANCEL) {
          this.activeCalls.delete(call_id);
          call.destroy();
          console.debug(`call ${call_id} state is CANCEL with reason ${reason}`)
        }
        if (sdp) {
          call.setRemoteDescription(sdp as RTCSessionDescription);
        }

      } else {
        console.debug(`call ${call_id} with state ${state} no found in this session`);
      }
    }
    if (notification === EMessageNotification.CALL_OFFER) {
      const { call_id, number, sdp, is_transfer, caller } = params;
      const call = new Call(this, {
        number: number,
        caller: caller,
        calleeId: this.getSessionInfo().username,
        isVideo: this.isVideoCall(sdp),
        isTransfer: is_transfer || false,
      });
      call.callId = call_id;
      call.remoteDescription = sdp;
      this.events.emit(EClientEventName.CALL_OFFER, call);

      this.activeCalls.set(call_id, call);
      if (this.activeCalls.size > 1) {

        // TODO: active a call, notify in popup

      }
    }
  }
  handleWebSocketMessage(event: string) {
    try {
      const message = JSON.parse(event);

      if (message["notification"]) {
        this.handleMessageNotification(message);
        return;
      }

      if (!message.jsonrpc || message.jsonrpc !== "2.0") {
        const error = new Error("Invalid JSON-RPC message");
        this.events.emit(EClientEventName.ERROR, { code: 400, message: error.message });
        console.error(error.message);
        return;
      }
      if (
        message.id &&
        message.id !== undefined &&
        this.pendingTransactions.has(message.id)
      ) {
        const { resolve, reject } = this.pendingTransactions.get(message.id);
        const { error, result } = message;
        if (error) {
          reject(new Error(typeof message.error.data === "string" ? message.error.data : message.error.message));
        } else if (result && result.data) {

          resolve(typeof result.data === "object" ? result.data : result);

        } else {
          reject(
            new Error(message.result.message || message.code || "Unknown error")
          );
        }

        // processed Transaction. delete id
        this.pendingTransactions.delete(message.id);
      } else if (
        (message.method && !message.id) ||
        (message.id && message.id === 0)
      ) {
        // if no id, this is message server send to client
      }
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
      this.events.emit(EClientEventName.ERROR, {
        code: 500,
        message: "Failed to parse WebSocket message",
      });
      return Promise.reject(error);
    }
  }
  subscribeNotificationServerEvents() {
    const params = [EMessageNotification.PING];
    this.sendRPCMessage("rpc.on", params, false);
  }
  keepAlive(paramsFromServer: {}) {
    if (!this.connected || !this.ws || !this.getSessionInfo()) {
      console.debug("Skipping keep-alive: not connected or no session");
      return;
    }
    this.sendRPCMessage(EMessageNotification.PONG, { timestamp: new Date().getTime() }, false);
  }

  public logout() {
    this.cleanupSession();
  }

  private reconnect() {
    if (this.connected && this.ws) {
      console.debug("#reconnect::Already connected, no need to reconnect");
      return;
    }
    if (!this.getSessionInfo()) {
      console.debug("#reconnect::User not login, no need to reconnect");
      return;
    }

    this.disconnect();

    this.retryWebsocket = (this.retryWebsocket || 0) + 1;
    const maxRetries = 30; // Limit retry attempts
    if (this.retryWebsocket > maxRetries) {
      console.error("#reconnect::Max reconnect attempts reached:", this.retryWebsocket);
      clearInterval(this.retryWebsocketTimeoutId);
      this.retryWebsocketTimeoutId = null;
      this.events.emit(EClientEventName.ERROR, {
        code: 500,
        message: "Failed to reconnect after max retries",
      });
      return;
    }

    const delay = Math.min(3000 * Math.pow(1.5, this.retryWebsocket), 25000); // Exponential backoff, max 30s
    console.log(`#reconnect::Reconnecting in ${delay}ms (attempt ${this.retryWebsocket})`);
    clearInterval(this.retryWebsocketTimeoutId);
    this.retryWebsocketTimeoutId = setTimeout(() => {
      const randomIndex = Math.floor(Math.random() * this.wsServers.length);
      const wsUrl = `${this.wsServers[randomIndex]}`;
      this.ws = new WebSocket(wsUrl);

      if (this.connected && this.ws) {
        console.debug("#reconnect::Already connected, no need to reconnect");
        clearInterval(this.retryWebsocketTimeoutId);
        return;
      }

      this.ws.onopen = async () => {
        console.debug("#reconnect::WebSocket reconnected to:", this.wsServers[randomIndex]);
        this.connected = true;
        clearInterval(this.retryWebsocketTimeoutId);
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
        this.reconnect();
      };

      this.ws.onerror = (error) => {
        console.error("#reconnect::WebSocket error:", error);
        this.connected = false;
      };
      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event.data);
      };

    }, delay);
  }

  private disconnect() {
    if (this.ws) {
      this.ws.close();
      this.connected = false;
      this.pendingTransactions.clear();
    }
  }
  /**
   * Parse JWT
   * @param jwt JWT token
   * @returns IJwtPayload
   */
  private parseJwt(jwt: string): IJwtPayload | null {
    try {
      const parts = jwt.split('.');
      if (parts.length < 2) {
        console.error('parseJwt::Invalid token format');
        return null;
      }

      // Convert base64url → base64
      const base64 = parts[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(parts[1].length + (4 - parts[1].length % 4) % 4, '=');

      // Decode base64 safe for Node & Browser, support UTF-8
      let jsonString: string;

      if (typeof window === 'undefined') {
        // Node.js environment
        jsonString = Buffer.from(base64, 'base64').toString('utf-8');
      } else {
        // Browser environment
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const decoder = new TextDecoder('utf-8');
        jsonString = decoder.decode(bytes);
      }

      const decoded: IJwtPayload = JSON.parse(jsonString);

      if (decoded.username && decoded.domain) {
        return decoded;
      } else {
        console.error('parseJwt::Invalid payload structure', decoded);
        return null;
      }
    } catch (e) {
      console.error('parseJwt::Error parsing JWT:', e);
      return null;
    }
  }
}