import { SimpleEventEmitter } from "./simple-event-emitter";
import { Call } from "./call";
import { ISession } from "./interfaces/session.interface";
import { ECallState } from "./enums/call-state.enum";
import { EClientEventName } from "./enums/client-event-name.enum";
import { EStorageKey } from "./enums/storage-key.enum";
import { IJwtPayload } from "./interfaces/jwt-payload.interface";
import { API_ENDPOINTS } from "./constants/api-endpoints";

const SDK_VERSION = "1.0.0";

/** Event-based Native WebSocket message shape */
export interface IWsEventMessage {
  event: string;
  data?: Record<string, unknown>;
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

/** Response from REST Make Call API */
export interface IMakeCallResponse {
  call_id: string;
  status: string;
  call_token: string;
  ws_url: string;
  expires_in: number;
}

/** Response from REST Supervision API */
export interface ISupervisionResponse {
  call_id: string;
  mode: "listen" | "whisper" | "barge";
  supervisor: string;
  status: string;
  call_token: string;
  expires_in: number;
}

export class FiretellClient {
  public readonly sdkVersion = SDK_VERSION;
  private baseUrl = "";
  private ws: WebSocket | null = null;
  private jwt: string = "";
  private jwtPayload: IJwtPayload | null = null;
  private wsServers: string[] = [];
  public iceServers: RTCIceServer[] = [];
  private session: ISession | null = null;
  private isReconnecting: boolean = false;
  private webRTCChecked: boolean = false;
  private eventSource: EventSource | null = null;

  /**
   * Event emitter for client events
   * @events session, incomingCall, error, reconnected, workspace.agent.state
   */
  public events = new SimpleEventEmitter();
  public isWebRTCSupport: boolean = false;
  public connected: boolean = false;

  /**
   * Promise that resolves when the client is fully initialized
   */
  public readonly ready: Promise<ISession>;
  private _resolveReady!: (session: ISession) => void;
  private _rejectReady!: (error: Error) => void;

  /**
   * Current active calls Map<call_id, Call>
   */
  public readonly activeCalls = new Map<string, Call>();

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
    if (domain.endsWith("/")) {
      domain = domain.slice(0, -1);
    }
    const domainRegex = /^(https?:\/\/)?([^\s/$.?#].[^\s]*)$/;
    if (!domainRegex.test(domain)) throw new Error("Invalid workspace domain");
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

      // Start SSE Realtime Events stream for background presence & workspace updates
      this._initEventStream();

      // Mark session ready
      const dummySession: ISession = {
        session_id: `ses_${Date.now()}`,
        username: this.jwtPayload?.sub || "",
        display_name: this.jwtPayload?.sub || "",
        domain: this.jwtPayload?.domain || "",
        expires_at: (this.jwtPayload?.exp || 0) * 1000,
      };
      this.session = dummySession;
      this._resolveReady(dummySession);
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
   * Connect to Server-Sent Events (SSE) Realtime Event Stream
   */
  private _initEventStream(): void {
    try {
      if (typeof window === "undefined" || !window.EventSource) return;

      const sseUrl = `${this.baseUrl}${API_ENDPOINTS.EVENT_STREAM}`;
      this.eventSource = new EventSource(sseUrl, {
        withCredentials: true,
      });

      this.eventSource.addEventListener("agent.state", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this.events.emit(EClientEventName.AGENT_STATE, data);
        } catch (err) {
          console.error("Error parsing agent.state event:", err);
        }
      });

      const forwardEvents = [
        { name: "contact.created", enumName: EClientEventName.CONTACT_CREATED },
        { name: "contact.updated", enumName: EClientEventName.CONTACT_UPDATED },
        { name: "contact.deleted", enumName: EClientEventName.CONTACT_DELETED },
        { name: "team.assigned", enumName: EClientEventName.TEAM_ASSIGNED },
        { name: "team.unassigned", enumName: EClientEventName.TEAM_UNASSIGNED },
      ];

      forwardEvents.forEach(({ name, enumName }) => {
        this.eventSource?.addEventListener(name, (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            this.events.emit(enumName, data);
          } catch (err) {
            console.error(`Error parsing ${name} event:`, err);
          }
        });
      });

      this.eventSource.addEventListener("call.ring", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as {
            call_id: string;
            call_token: string;
            ws_url?: string;
          };
          if (data.call_token) {
            const wsUrl =
              data.ws_url ||
              this.wsServers[0] ||
              `wss://${this.baseUrl.replace(/^https?:\/\//, "")}/ws`;
            this._connectCallWebSocket(wsUrl, data.call_token, data.call_id).catch(
              (err) => console.error("Error connecting call WebSocket from SSE ring:", err)
            );
          }
        } catch (err) {
          console.error("Error parsing call.ring event:", err);
        }
      });

      this.eventSource.onerror = (err) => {
        console.warn("SSE EventSource error:", err);
      };
    } catch (err) {
      console.warn("EventSource initialization skipped or unsupported:", err);
    }
  }

  /**
   * Initiate a new outbound call via REST API, then open native WebSocket per call.
   * @param call Call instance
   * @param sdp RTCSessionDescription (full SDP)
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

    // 1. Call REST API POST /call-center/calls
    const response = await fetch(`${this.baseUrl}${API_ENDPOINTS.MAKE_CALL}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.jwt}`,
      },
      body: JSON.stringify({
        to: call.to,
        number: call.number,
        type: call.isVideo ? "video" : "audio",
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || `HTTP ${response.status}: Failed to make call`);
    }

    const data = (await response.json()) as IMakeCallResponse;
    call.callId = data.call_id;
    this.activeCalls.set(data.call_id, call);

    // 2. Open Native WebSocket per call using call_token
    await this._connectCallWebSocket(data.ws_url, data.call_token, data.call_id, sdp);

    return data.call_id;
  }

  /**
   * Initiate Call Supervision (listen / whisper / barge) via REST API.
   */
  public async superviseCall(
    callId: string,
    mode: "listen" | "whisper" | "barge"
  ): Promise<ISupervisionResponse> {
    const url = `${this.baseUrl}${API_ENDPOINTS.SUPERVISION(callId, mode)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.jwt}`,
      },
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || `HTTP ${response.status}: Failed to supervise call`);
    }

    const data = (await response.json()) as ISupervisionResponse;

    // Connect WebSocket using call_token
    const defaultWsUrl = this.wsServers[0] || `wss://${this.baseUrl.replace(/^https?:\/\//, "")}/ws`;
    await this._connectCallWebSocket(defaultWsUrl, data.call_token, callId);

    return data;
  }

  /**
   * Send Call Transfer request via REST API.
   * Leaders and supervisors can transfer calls to another agent in the team.
   */
  public async sendTransfer(
    callId: string,
    targetUsername: string,
    teamId: string = ""
  ): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendWsEvent("call.transfer", {
        call_id: callId,
        to: targetUsername,
        team_id: teamId || undefined,
      });
      return;
    }

    const url = `${this.baseUrl}${API_ENDPOINTS.TRANSFER(callId)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.jwt}`,
      },
      body: JSON.stringify({
        target_username: targetUsername,
        team_id: teamId || undefined,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || `HTTP ${response.status}: Failed to transfer call`);
    }

    this.activeCalls.delete(callId);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Connect native WebSocket for a specific call session.
   * Sends session.connect with call_token within 3 seconds per server spec.
   */
  private _connectCallWebSocket(
    wsUrl: string,
    callToken: string,
    callId: string,
    sdp?: RTCSessionDescription
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      const connectTimeout = setTimeout(() => {
        if (this.ws) {
          this.ws.close();
          reject(new Error("Call WebSocket authentication timed out (3s)"));
        }
      }, 5000);

      this.ws.onopen = () => {
        this.connected = true;
        // In-band session.connect event within 3 seconds
        this.sendWsEvent("session.connect", { token: callToken });
      };

      this.ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.event === "session.connected") {
            clearTimeout(connectTimeout);

            // Send call.offer if sdp is provided
            if (sdp) {
              this.sendWsEvent("call.offer", {
                call_id: callId,
                sdp: sdp.sdp,
              });
            }

            resolve();
          } else {
            this._handleWebSocketMessage(event.data);
          }
        } catch (err) {
          console.error("Error parsing WS message:", err);
        }
      };

      this.ws.onerror = (err) => {
        clearTimeout(connectTimeout);
        this.connected = false;
        reject(err);
      };

      this.ws.onclose = () => {
        clearTimeout(connectTimeout);
        this.connected = false;
      };
    });
  }

  /**
   * Send Native Event-Based JSON message over WebSocket
   */
  public sendWsEvent(event: string, data: Record<string, unknown> = {}): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }));
    } else {
      console.warn("WebSocket is not open. Event skipped:", event);
    }
  }

  /**
   * Hang up active call
   */
  public async sendHangup(callId: string): Promise<void> {
    this.sendWsEvent("call.hangup", { call_id: callId });
    this.activeCalls.delete(callId);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Accept an incoming call
   */
  public async sendAccept(
    callId: string,
    sdp: RTCSessionDescription
  ): Promise<void> {
    this.sendWsEvent("call.answer", {
      call_id: callId,
      sdp: sdp.sdp,
    });
  }

  /**
   * Reject an incoming call
   */
  public async sendReject(callId: string): Promise<void> {
    this.sendWsEvent("call.reject", { call_id: callId });
    this.activeCalls.delete(callId);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Send Hold a Call
   */
  public async sendHold(
    callId: string,
    sdp: RTCSessionDescriptionInit
  ): Promise<void> {
    this.sendWsEvent("call.hold", { call_id: callId, sdp });
  }

  /**
   * Send UnHold
   */
  public async sendUnHold(
    callId: string,
    sdp: RTCSessionDescriptionInit
  ): Promise<void> {
    this.sendWsEvent("call.unhold", { call_id: callId, sdp });
  }

  /**
   * Send DTMF tone
   */
  public async sendDTMF(
    callId: string,
    digit: string,
    duration: number = 250
  ): Promise<void> {
    if (!/^[0-9A-D*#]$/.test(digit)) {
      throw new Error("Invalid DTMF digit. Must be 0-9, A-D, *, or #");
    }
    this.sendWsEvent("call.dtmf", { call_id: callId, digit, duration });
  }

  /**
   * Send Mute state
   */
  public async sendMute(callId: string, muted: boolean): Promise<void> {
    this.sendWsEvent("call.mute", { call_id: callId, muted });
  }

  /**
   * Send login with username, password, domain.
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

    // Re-initialize SSE event stream
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this._initEventStream();
  }

  public getSessionInfo(): ISession | null {
    return this.session;
  }

  public getJwtPayload(): IJwtPayload | null {
    return this.jwtPayload;
  }

  private _cleanupSession(): void {
    this.session = null;
    this.events.emit(EClientEventName.SESSION, null);
    this.events.offAll();
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private isVideoCall(sdp: RTCSessionDescriptionInit): boolean {
    return /m=video/.test(sdp.sdp || "");
  }

  private _checkWebRTCSupport(): boolean {
    const hasRTCPeerConnection = typeof window !== "undefined" && !!window.RTCPeerConnection;
    const hasGetUserMedia =
      typeof navigator !== "undefined" &&
      !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
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

  private _handleIncomingCall(params: ICallOfferParams): void {
    const { call_id, number, sdp, is_transfer, caller } = params;
    const call = new Call(this, {
      number,
      from: caller,
      to: this.getSessionInfo()?.username || "",
      isVideo: this.isVideoCall(sdp),
      isTransfer: is_transfer || false,
    });
    call.callId = call_id;
    call.remoteDescription = sdp;

    this.activeCalls.set(call_id, call);
    this.events.emit(EClientEventName.CALL_OFFER, call);
  }

  private _handleWebSocketMessage(eventData: string): void {
    try {
      const message = JSON.parse(eventData);
      const eventName = message.event;
      const data = message.data || {};

      switch (eventName) {
        case "call.offer":
          this._handleIncomingCall({
            call_id: data.call_id,
            number: data.number || data.caller || "",
            caller: data.caller || data.from || "",
            sdp: data.sdp,
            is_transfer: data.is_transfer || false,
          });
          break;
        case "call.answered":
        case "call.held":
        case "call.unheld":
        case "call.ended":
        case "call.rejected":
          this._handleCallState({
            call_id: data.call_id,
            state: eventName === "call.answered" ? ECallState.ANSWERED : ECallState.ENDED,
            sdp: data.sdp,
            reason: data.reason,
          });
          break;
        case "call.candidate_ack":
          break;
        case "session.error":
          console.error("WebSocket Session Error:", data.message);
          this.events.emit(EClientEventName.ERROR, {
            code: 400,
            message: data.message,
          });
          break;
        default:
          console.debug(`Received Event '${eventName}':`, data);
      }
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
    }
  }

  private _handleCallState(params: ICallStateParams): void {
    const { call_id, state, sdp } = params;
    const call = this.activeCalls.get(call_id);
    if (!call) return;

    if (sdp) {
      call.setRemoteDescription(sdp as RTCSessionDescription);
    }
    call.setSignalState(state, params as unknown as Record<string, unknown>);

    if ([ECallState.ENDED, ECallState.ERROR, ECallState.CANCEL].includes(state)) {
      this.activeCalls.delete(call_id);
      call.active = false;
      call.destroy();
    }
  }

  public logout(): void {
    this.activeCalls.forEach((call) => call.destroy());
    this.activeCalls.clear();
    this._cleanupSession();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public destroy(): void {
    this.activeCalls.forEach((call) => call.destroy());
    this.activeCalls.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.session = null;
    this.jwtPayload = null;
    this.jwt = "";
    this.events.offAll();
  }

  private _parseJwt(jwt: string): IJwtPayload | null {
    try {
      const parts = jwt.split(".");
      if (parts.length < 2) return null;

      const base64 = parts[1]
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(parts[1].length + ((4 - (parts[1].length % 4)) % 4), "=");

      let jsonString: string;
      if (typeof window === "undefined") {
        jsonString = Buffer.from(base64, "base64").toString("utf-8");
      } else {
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
      }
      return null;
    } catch {
      return null;
    }
  }
}