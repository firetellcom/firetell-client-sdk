import { SimpleEventEmitter, SseStreamClient, SseMessageEvent } from "./utils";
import { Call } from "./call";
import { ISession } from "./interfaces/session.interface";
import { ECallState } from "./enums/call-state.enum";
import { ECallEventName } from "./enums/call-event-name.enum";
import { EClientEventName } from "./enums/client-event-name.enum";
import { EStorageKey } from "./enums/storage-key.enum";
import { CallOptions } from "./interfaces/call-options.interface";
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
  private sseClient: SseStreamClient | null = null;
  private knownCallStates = new Map<string, { status: string; weight: number; timestamp: number }>();

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
   * using SseStreamClient with Authorization Bearer header.
   */
  private _initEventStream(): void {
    try {
      const sseUrl = `${this.baseUrl}${API_ENDPOINTS.EVENT_STREAM}`;

      const CALL_STATE_WEIGHT: Record<string, number> = {
        created: 1,
        initiated: 1,
        pending: 1,
        started: 2,
        ringing: 2,
        progress: 2,
        answered: 3,
        active: 3,
        held: 3,
        ended: 4,
        completed: 4,
        canceled: 4,
        missed: 4,
        failed: 4,
        busy: 4,
        rejected: 4,
      };

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

      const guardCallState = (eventName: string, payload: any): void => {
        if (!payload || typeof payload !== "object") return;
        const callId =
          payload.data?.call_id ||
          payload.data?.id ||
          payload.call_id ||
          payload.id;
        if (!callId) return;

        const rawStatus = (payload.data?.status || payload.status || "").toLowerCase();
        let eventWeight = CALL_STATE_WEIGHT[rawStatus] || 0;

        if (eventName === "call.created" && eventWeight < 1) eventWeight = 1;
        else if ((eventName === "call.started" || eventName === "call.ring") && eventWeight < 2) eventWeight = 2;
        else if (eventName === "call.answered" && eventWeight < 3) eventWeight = 3;
        else if ((eventName === "call.ended" || eventName === "call.canceled") && eventWeight < 4) eventWeight = 4;

        const now = Date.now();
        if (this.knownCallStates.size > 200) {
          for (const [k, v] of this.knownCallStates.entries()) {
            if (now - v.timestamp > 600000) this.knownCallStates.delete(k);
          }
        }

        const existing = this.knownCallStates.get(callId);
        if (existing && eventWeight < existing.weight) {
          // Late or out-of-order event arriving after higher-ranked state:
          // Preserve the higher status in payload to prevent UI state regression
          if (payload.data && typeof payload.data === "object") {
            payload.data.status = existing.status;
            payload.data.is_late_event = true;
          }
          if (payload.status) {
            payload.status = existing.status;
          }
          return;
        }

        const newStatus = rawStatus || (
          eventWeight === 1 ? "created" :
          eventWeight === 2 ? "started" :
          eventWeight === 3 ? "active" :
          eventWeight === 4 ? "ended" : "created"
        );

        this.knownCallStates.set(callId, {
          status: newStatus,
          weight: Math.max(existing?.weight || 0, eventWeight),
          timestamp: now,
        });
      };

      const handleIncomingSseEvent = (msg: SseMessageEvent) => {
        const { event, data } = msg;
        if (isDuplicateEvent(data)) return;
        guardCallState(event, data);

        switch (event) {
          case "call.ring": {
            const ringData = (data || {}) as ICallRingParams;
            this.events.emit(EClientEventName.CALL_RING, ringData);
            if (ringData.call_token) {
              const wsUrl =
                ringData.ws_url ||
                this.wsServers[0] ||
                `wss://${this.baseUrl.replace(/^https?:\/\//, "")}/ws`;
              this.createCallSession(ringData.call_token, wsUrl, ringData.call_id, {
                to: ringData.to?.number || "",
                from: ringData.from?.number || "",
                from_name: ringData.from?.name || "",
                isTransfer: ringData.is_transfer || false,
              }).catch((err) =>
                console.error("Error connecting call WebSocket from SSE ring:", err)
              );
            }
            break;
          }
          case "call.answered": {
            const payload = data;
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
            break;
          }
          case "call.canceled": {
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
            break;
          }
          case "call.ended": {
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
            break;
          }
          case "system.error": {
            console.error("SSE system error received:", data);
            if (data?.code === "SSE_LIMIT_EXCEEDED") {
              this.sseClient?.close();
              this.session = null;
              this.events.emit("error", new Error(data.message || "SSE connection limit exceeded"));
              this.events.emit(EClientEventName.SESSION, null);
            }
            break;
          }
          case "call.created": {
            this.events.emit(EClientEventName.CALL_CREATED, data);
            break;
          }
          case "call.started": {
            this.events.emit(EClientEventName.CALL_STARTED, data);
            break;
          }
          case "agent.state": {
            this.events.emit(EClientEventName.AGENT_STATE, data);
            break;
          }
          case "agent.state.forced": {
            this.events.emit(EClientEventName.AGENT_STATE_FORCED, data);
            break;
          }
          case "agent.created": {
            this.events.emit(EClientEventName.AGENT_CREATED, data);
            break;
          }
          case "agent.updated": {
            this.events.emit(EClientEventName.AGENT_UPDATED, data);
            break;
          }
          case "agent.deleted": {
            this.events.emit(EClientEventName.AGENT_DELETED, data);
            break;
          }
          case "contact.created": {
            this.events.emit(EClientEventName.CONTACT_CREATED, data);
            break;
          }
          case "contact.updated": {
            this.events.emit(EClientEventName.CONTACT_UPDATED, data);
            break;
          }
          case "contact.deleted": {
            this.events.emit(EClientEventName.CONTACT_DELETED, data);
            break;
          }
          case "team.created": {
            this.events.emit(EClientEventName.TEAM_CREATED, data);
            break;
          }
          case "team.updated": {
            this.events.emit(EClientEventName.TEAM_UPDATED, data);
            break;
          }
          case "team.deleted": {
            this.events.emit(EClientEventName.TEAM_DELETED, data);
            break;
          }
          case "team.assigned": {
            this.events.emit(EClientEventName.TEAM_ASSIGNED, data);
            break;
          }
          case "team.unassigned": {
            this.events.emit(EClientEventName.TEAM_UNASSIGNED, data);
            break;
          }
          case "call.recording.ready": {
            this.events.emit(EClientEventName.CALL_RECORDING_READY, data);
            break;
          }
          default: {
            if (event !== "system.ping") {
              this.events.emit(event, data);
            }
            break;
          }
        }
      };

      if (this.sseClient) {
        this.sseClient.close();
        this.sseClient = null;
      }

      this.sseClient = new SseStreamClient({
        url: sseUrl,
        token: this.jwt,
        onOpen: () => {
          this.connected = true;
        },
        onMessage: handleIncomingSseEvent,
        onConnectionStateChange: (state) => {
          this.connected = state === "connected";
          this.events.emit(EClientEventName.CONNECTION_STATE, state);
        },
        onError: (err) => {
          console.warn("SSE Stream Client error:", err);
        },
      });

      this.sseClient.connect();
    } catch (err) {
      console.warn("SseStreamClient initialization skipped or unsupported:", err);
    }
  }

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
    call.connectCallEventStream(callToken);
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
    call.connectCallEventStream(res.call_token);
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
    options?: CallOptions
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
   * Helper to stop an active call supervision session.
   * Closes WebRTC call session and calls the REST API DELETE /api/v1/call-center/calls/:call_id/supervision.
   */
  public async stopSupervision(callId: string): Promise<void> {
    // 1. Destroy and cleanup active supervision Call session if present
    const call = this.activeCalls.get(callId);
    if (call) {
      call.destroy();
      this.activeCalls.delete(callId);
    }

    // 2. Call REST API DELETE /api/v1/call-center/calls/:call_id/supervision
    const url = `${this.baseUrl}${API_ENDPOINTS.SUPERVISION_STOP(callId)}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.jwt}`,
      },
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(
        errData.message || `HTTP ${response.status}: Failed to stop supervision`
      );
    }
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
    if (this.sseClient) {
      this.sseClient.close();
      this.sseClient = null;
    }
    this._initEventStream();
  }

  public getSessionInfo(): ISession | null {
    return this.session;
  }

  public getJwtPayload(): IJwtPayload | null {
    return this.jwtPayload;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getJwt(): string {
    return this.jwt;
  }

  /**
   * Helper to generate or retrieve a unique, persistent Device ID for browser environment.
   * Uses localStorage when available, or falls back to random UUID.
   * @param storageKey Key to store device ID in localStorage (default: "firetell_device_id")
   * @returns Persistent unique device ID string
   */
  public static getOrCreateDeviceId(storageKey: string = EStorageKey.DEVICE_ID): string {
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
    if (this.sseClient) {
      this.sseClient.close();
      this.sseClient = null;
    }
    this.knownCallStates.clear();
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
    if (this.sseClient) {
      this.sseClient.close();
      this.sseClient = null;
    }
    this.knownCallStates.clear();
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