import { SimpleEventEmitter } from "./simple-event-emitter";
import { Call } from "./call";
import { ISession } from "./interfaces/session.interface";
import { ECallState } from "./enums/call-state.enum";
import { ECallEventName } from "./enums/call-event-name.enum";
import { EClientEventName } from "./enums/client-event-name.enum";
import { EStorageKey } from "./enums/storage-key.enum";
import { IJwtPayload } from "./interfaces/jwt-payload.interface";
import { API_ENDPOINTS } from "./constants/api-endpoints";
import { DEFAULT_ICE_SERVERS } from "./constants/ice-servers";

declare const __SDK_VERSION__: string;
const SDK_VERSION = typeof __SDK_VERSION__ !== "undefined" ? __SDK_VERSION__ : "1.0.1";

/** Params for a call.ring notification */
export interface ICallRingParams {
  call_id: string;
  call_token: string;
  ws_url?: string;
  from?: {
    number: string;
    name?: string;
  };
  to?: {
    number: string;
    name?: string;
  };
  is_transfer?: boolean;
  timestamp?: string;
}

/** Params for a call.offer (incoming call) notification */
interface ICallOfferParams {
  call_id: string;
  from: string;
  from_name?: string;
  to: string;
  sdp: RTCSessionDescriptionInit;
  is_transfer?: boolean;
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
  ws_url: string;
  expires_in: number;
}

export class FiretellClient {
  public readonly sdkVersion = SDK_VERSION;
  private baseUrl = "";
  private jwt: string = "";
  private jwtPayload: IJwtPayload | null = null;
  private wsServers: string[] = [];
  public iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS;
  private session: ISession | null = null;
  private isReconnecting: boolean = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 3000;
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
      this.wsServers = data.ws_servers || [];
      this.iceServers = data.ice_servers && data.ice_servers.length ? data.ice_servers : DEFAULT_ICE_SERVERS;

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
      this.events.emit(EClientEventName.SESSION, dummySession);
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

      const sseUrl = `${this.baseUrl}${API_ENDPOINTS.EVENT_STREAM}?token=${encodeURIComponent(this.jwt)}`;
      this.eventSource = new EventSource(sseUrl, {
        withCredentials: false,
      });

      const forwardEvents = [
        { name: "call.created", enumName: EClientEventName.CALL_CREATED },
        { name: "call.started", enumName: EClientEventName.CALL_STARTED },
        { name: "agent.state", enumName: EClientEventName.AGENT_STATE },
        { name: "agent.state.forced", enumName: EClientEventName.AGENT_STATE_FORCED },
        { name: "agent.created", enumName: EClientEventName.AGENT_CREATED },
        { name: "agent.updated", enumName: EClientEventName.AGENT_UPDATED },
        { name: "agent.deleted", enumName: EClientEventName.AGENT_DELETED },
        { name: "contact.created", enumName: EClientEventName.CONTACT_CREATED },
        { name: "contact.updated", enumName: EClientEventName.CONTACT_UPDATED },
        { name: "contact.deleted", enumName: EClientEventName.CONTACT_DELETED },
        { name: "team.created", enumName: EClientEventName.TEAM_CREATED },
        { name: "team.updated", enumName: EClientEventName.TEAM_UPDATED },
        { name: "team.deleted", enumName: EClientEventName.TEAM_DELETED },
        { name: "team.assigned", enumName: EClientEventName.TEAM_ASSIGNED },
        { name: "team.unassigned", enumName: EClientEventName.TEAM_UNASSIGNED },
      ];

      const seenEventSignatures = new Map<string, number>();

      const isDuplicateEvent = (payload: any): boolean => {
        if (!payload || typeof payload !== "object") return false;
        const eventName = payload.event || "";
        const callId =
          payload.data?.call_id ||
          payload.data?.id ||
          payload.call_id ||
          payload.id ||
          "";
        const status = payload.data?.status || payload.status || "";
        const timestamp = payload.timestamp || payload.data?.timestamp || "";

        let sig = "";
        if (eventName && callId) {
          sig = `${eventName}:${callId}:${status || timestamp}`;
        } else if (payload.id || payload.event_id) {
          sig = `${eventName}:${payload.id || payload.event_id}`;
        } else {
          return false;
        }

        const now = Date.now();
        if (seenEventSignatures.size > 100) {
          for (const [k, ts] of seenEventSignatures.entries()) {
            if (now - ts > 5000) seenEventSignatures.delete(k);
          }
        }

        const lastSeen = seenEventSignatures.get(sig);
        if (lastSeen && now - lastSeen < 3000) {
          return true; // Duplicate event
        }
        seenEventSignatures.set(sig, now);
        return false;
      };

      forwardEvents.forEach(({ name, enumName }) => {
        this.eventSource?.addEventListener(name, (e: MessageEvent) => {
          try {
            const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
            if (isDuplicateEvent(data)) return;
            this.events.emit(enumName, data);
            if (name !== enumName) {
              this.events.emit(name, data);
            }
          } catch (err) {
            console.error(`Error parsing ${name} event:`, err);
          }
        });
      });

      // General fallback onmessage listener for any dynamic SSE event
      this.eventSource.onmessage = (e: MessageEvent) => {
        try {
          const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
          const eventName = data?.event || e.type || "message";
          if (eventName !== "call.ring" && eventName !== "system.ping") {
            this.events.emit(eventName, data);
          }
        } catch (err) {
          // Ignore unparseable ping/raw string messages
        }
      };

      /**
       * Inbound Call Notification (SSE):
       * In Firetell's architecture, WebSocket signaling connections are created on-demand per call (not kept alive while idle).
       * When an incoming call arrives, the backend dispatches a 'call.ring' event over the persistent SSE event stream
       * containing a short-lived call_token and the target signaling WebSocket URL.
       * The SDK emits CALL_RING to trigger incoming call UI/ringtones, and automatically connects the dedicated
       * per-call WebSocket via _createCallSession().
       */
      this.eventSource.addEventListener("call.ring", (e: MessageEvent) => {
        try {
          const data = (typeof e.data === "string" ? JSON.parse(e.data) : e.data) as ICallRingParams;
          if (isDuplicateEvent(data)) return;
          this.events.emit(EClientEventName.CALL_RING, data);
          if (data.call_token) {
            const wsUrl =
              data.ws_url ||
              this.wsServers[0] ||
              `wss://${this.baseUrl.replace(/^https?:\/\//, "")}/ws`;
            this.createCallSession(data.call_token, wsUrl, data.call_id, {
              to: data.to?.number || "",
              from: data.from?.number || "",
              from_name: data.from?.name || "",
              isTransfer: data.is_transfer || false,
            }).catch((err) =>
              console.error("Error connecting call WebSocket from SSE ring:", err)
            );
          }
        } catch (err) {
          console.error("Error parsing call.ring event:", err);
        }
      });

      /**
       * Call Answered (SSE):
       * Server broadcasts 'call.answered' when call is picked up.
       */
      this.eventSource.addEventListener("call.answered", (e: MessageEvent) => {
        try {
          const payload = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
          if (isDuplicateEvent(payload)) return;
          const callId = payload?.data?.call_id || payload?.data?.id || payload?.call_id || payload?.id;
          if (callId) {
            const call = this.activeCalls.get(callId);
            if (call && call.callState !== ECallState.ACTIVE) {
              call.emit(ECallEventName.STATE, {
                state: ECallState.ACTIVE,
                reason: "Answered",
                data: payload?.data || payload,
              });
            }
          }
          this.events.emit(EClientEventName.CALL_ANSWERED, payload);
          this.events.emit("call.answered", payload);
        } catch (err) {
          console.error("Error parsing call.answered event:", err);
        }
      });

      /**
       * Call Canceled / Ringing Revocation (SSE):
       * Why is this handled over SSE in addition to WebSocket?
       * 1. Team / Ring-All Distribution: When a call rings multiple agents, as soon as one agent answers
       *    or when the dialplan leg times out, the server broadcasts 'call.canceled' over SSE to all other agents.
       * 2. Race Condition Prevention: The remaining agents might still be opening their per-call WebSocket or
       *    have not finished WebSocket handshaking. Handling 'call.canceled' over SSE guarantees that the ringing
       *    modal and ringtone are dismissed immediately on all agents' screens without relying on WebSocket state.
       */
      this.eventSource.addEventListener("call.canceled", (e: MessageEvent) => {
        try {
          const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
          if (isDuplicateEvent(data)) return;
          const callId = data?.data?.call_id || data?.data?.id || data?.call_id || data?.id;
          if (callId) {
            const call = this.activeCalls.get(callId);
            if (call) {
              call.emit(ECallEventName.STATE, {
                state: ECallState.ENDED,
                reason: data?.data?.hangup_cause || data?.reason || "Canceled",
                data: data?.data || data,
              });
              call.destroy(false);
            }
            this.activeCalls.delete(callId);
          }
          this.events.emit(EClientEventName.CALL_CANCELED, data);
          this.events.emit("call.canceled", data);
          this.events.emit("call.ended", data);
        } catch (err) {
          console.error("Error parsing call.canceled event:", err);
        }
      });

      /**
       * Call Ended / Early Termination (SSE):
       * Why is this handled over SSE in addition to WebSocket?
       * If the caller hangs up before the agent answers (or while the per-call WebSocket is connecting),
       * the server broadcasts 'call.ended' over SSE. This guarantees that the incoming call notification
       * is closed immediately, preventing the ringing modal from lingering on screen indefinitely.
       */
      this.eventSource.addEventListener("call.ended", (e: MessageEvent) => {
        try {
          const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
          if (isDuplicateEvent(data)) return;
          const callId = data?.data?.call_id || data?.data?.id || data?.call_id || data?.id;
          if (callId) {
            const call = this.activeCalls.get(callId);
            if (call) {
              call.emit(ECallEventName.STATE, {
                state: ECallState.ENDED,
                reason: data?.data?.hangup_cause || data?.reason || "Call Ended",
                data: data?.data || data,
              });
              call.destroy(false);
            }
            this.activeCalls.delete(callId);
          }
          this.events.emit(EClientEventName.CALL_ENDED, data);
          this.events.emit("call.ended", data);
        } catch (err) {
          console.error("Error parsing call.ended event:", err);
        }
      });

      this.eventSource.addEventListener("system.error", (e: MessageEvent) => {
        try {
          const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
          console.error("SSE system error received:", data);
          if (data?.code === "SSE_LIMIT_EXCEEDED") {
            // Close connection, clear session, and stop reconnecting
            if (this.eventSource) {
              this.eventSource.close();
              this.eventSource = null;
            }
            this.session = null;
            this.events.emit("error", new Error(data.message || "SSE connection limit exceeded"));
            this.events.emit(EClientEventName.SESSION, null);
          }
        } catch (err) {
          console.error("Error handling system.error event:", err);
        }
      });

      this.eventSource.onopen = () => {
        console.log("SSE EventSource connected.");
        this.connected = true;
        this.reconnectDelay = 3000; // Reset backoff delay on successful connection
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.events.emit(EClientEventName.CONNECTION_STATE, "connected");
      };

      this.eventSource.onerror = (err) => {
        console.warn("SSE EventSource error:", err);
        
        this.connected = false;
        this.events.emit(EClientEventName.CONNECTION_STATE, "disconnected");

        if (this.eventSource && this.eventSource.readyState === EventSource.CLOSED) {
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
          }

          // Calculate next backoff delay with random jitter (max 60 seconds)
          const currentDelay = this.reconnectDelay;
          const jitter = Math.random() * 1000;
          const nextDelay = currentDelay + jitter;

          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);

          console.log(`SSE EventSource disconnected. Reconnecting in ${Math.round(nextDelay)}ms...`);
          this.events.emit(EClientEventName.CONNECTION_STATE, "connecting");

          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            // Only reconnect if we haven't logged out or initialized another connection
            if (!this.eventSource || this.eventSource.readyState === EventSource.CLOSED) {
              this._initEventStream();
            }
          }, nextDelay);
        }
      };
    } catch (err) {
      console.warn("EventSource initialization skipped or unsupported:", err);
    }
  }

  /**
   * Initiate a new outbound call via REST API, then open native WebSocket per call.
   * @param call Call instance
   * @param sdp RTCSessionDescription (full SDP)
  /**
   * Call REST API POST /v1/call-center/calls to initiate call creation
   */
  public async initiateCallRest(
    to: string,
    from?: string,
    isVideo?: boolean
  ): Promise<IMakeCallResponse> {
    const response = await fetch(`${this.baseUrl}${API_ENDPOINTS.MAKE_CALL}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.jwt}`,
      },
      body: JSON.stringify({
        to,
        from,
        type: isVideo ? "video" : "audio",
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || `HTTP ${response.status}: Failed to make call`);
    }

    return (await response.json()) as IMakeCallResponse;
  }

  /**
   * Helper to create a Call instance and connect its dedicated per-call WebSocket
   */
  public async createCallSession(
    callToken: string,
    wsUrl: string,
    callId: string,
    options: import("./interfaces/call-options.interface").CallOptions
  ): Promise<Call> {
    const call = new Call(this, options);
    call.callId = callId;
    this.activeCalls.set(callId, call);
    await call.connectSignaling(wsUrl, callToken);
    return call;
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
    const res = await this.initiateCallRest(call.to, call.from, Boolean(call.isVideo));
    call.callId = res.call_id;
    this.activeCalls.set(res.call_id, call);
    await call.connectSignaling(res.ws_url, res.call_token);
    call.sendWsEvent("call.offer", { sdp: sdp.sdp });
    return res.call_id;
  }

  /**
   * Initiate Call Supervision (listen / whisper / barge) via REST API.
   */
  private async _superviseCall(
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

    return (await response.json()) as ISupervisionResponse;
  }

  /**
   * Helper to start supervision (listen / whisper / barge) and automatically
   * establish the WebRTC audio session.
   */
  public async startSupervision(
    callId: string,
    mode: "listen" | "whisper" | "barge",
    options?: import("./interfaces/call-options.interface").CallOptions
  ): Promise<Call> {
    const res = await this._superviseCall(callId, mode);
    if (!res.ws_url) {
      throw new Error("Server did not return ws_url for supervision session");
    }
    const call = new Call(this, options);
    call.callId = res.call_id;
    this.activeCalls.set(res.call_id, call);
    await call.joinSession(res.ws_url, res.call_token, mode);
    return call;
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
    const call = this.activeCalls.get(callId);
    if (call) {
      await call.transfer(targetUsername, teamId);
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

  /**
   * Helper to generate or retrieve a unique, persistent Device ID for browser environment.
   * Uses localStorage when available, or falls back to random UUID.
   * @param storageKey Key to store device ID in localStorage (default: "firetell_device_id")
   * @returns Persistent unique device ID string
   */
  public static getOrCreateDeviceId(storageKey: string = "firetell_device_id"): string {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      try {
        const existingId = localStorage.getItem(storageKey);
        if (existingId && existingId.trim().length > 0) {
          return existingId;
        }
      } catch {
        // Handle private browsing or restricted storage
      }
    }

    let newDeviceId: string;
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      newDeviceId = `web_${crypto.randomUUID()}`;
    } else {
      const rand = Math.random().toString(36).substring(2, 11) + Math.random().toString(36).substring(2, 11);
      newDeviceId = `web_${Date.now().toString(36)}_${rand}`;
    }

    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(storageKey, newDeviceId);
      } catch {
        // Ignore quota errors
      }
    }

    return newDeviceId;
  }

  /**
   * Helper instance method to get or generate persistent browser Device ID.
   * @param storageKey Custom key for localStorage (default: "firetell_device_id")
   */
  public getDeviceId(storageKey?: string): string {
    return FiretellClient.getOrCreateDeviceId(storageKey);
  }

  private _cleanupSession(): void {
    this.session = null;
    this.events.emit(EClientEventName.SESSION, null);
    this.events.offAll();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectDelay = 3000;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private _isVideoCall(sdp: RTCSessionDescriptionInit): boolean {
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
    const { call_id, from, from_name, to, sdp, is_transfer } = params;
    const call = new Call(this, {
      from,
      from_name,
      to: to || this.getSessionInfo()?.username || "",
      isVideo: this._isVideoCall(sdp),
      isTransfer: is_transfer || false,
    });
    call.callId = call_id;
    call.remoteDescription = sdp;

    this.activeCalls.set(call_id, call);
    this.events.emit(EClientEventName.CALL_OFFER, call);
  }

  public logout(): void {
    this.activeCalls.forEach((call) => call.destroy());
    this.activeCalls.clear();
    this._cleanupSession();
  }

  public destroy(): void {
    this.activeCalls.forEach((call) => call.destroy());
    this.activeCalls.clear();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectDelay = 3000;
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