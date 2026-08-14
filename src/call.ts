import { ECallEventName } from "./enums/call-event-name.enum";
import { EClientEventName } from "./enums/client-event-name.enum";
import { ECallState } from "./enums/call-state.enum";
import { CallOptions } from "./interfaces/call-options.interface";
import { SimpleEventEmitter } from "./simple-event-emitter";
import { FiretellClient } from "./firetell-client";
import { DEFAULT_ICE_SERVERS } from "./constants";

/** Event-based Native WebSocket message shape */
export interface IWsEventMessage {
  event: string;
  data?: Record<string, unknown>;
}

export class Call extends SimpleEventEmitter {
  public callId: string | null = null;
  public from: string;
  public from_name: string;
  public to: string;
  public active: boolean = false;
  private client: FiretellClient | null;
  private ws: WebSocket | null = null;
  private state: ECallState = ECallState.NONE;
  private peerConnection: RTCPeerConnection;
  public remoteDescription: RTCSessionDescriptionInit | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  public isVideo: boolean | MediaTrackConstraints;
  public isMuted: boolean = false;
  public isTransfer: boolean;
  public isInternal: boolean;
  private _destroying: boolean = false;
  private currentRemoteSetupRole: string | null = null;

  constructor(client: FiretellClient, options: CallOptions) {
    super();
    if (!(client instanceof FiretellClient))
      throw new Error("Missing or invalid client instance");
    if (!options.to) throw new Error("destination (to) is required in options");
    this.client = client;
    this.to = options.to;
    this.from = options.from || "";
    this.from_name = options.from_name || "";
    this.isVideo = options.isVideo || false;
    this.isTransfer = options.isTransfer || false;
    this.isInternal = options.isInternal || false;
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.client?.iceServers?.length
        ? this.client.iceServers
        : DEFAULT_ICE_SERVERS,
    });
  }

  /**
   * Open dedicated Native WebSocket signaling connection for this call session
   * and authenticate with call_token within 3s.
   */
  public async connectSignaling(wsUrl: string, callToken: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);

        const authTimeout = setTimeout(() => {
          if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
            this.ws.close();
            this.ws = null;
          }
          reject(new Error("Call WebSocket authentication timed out after 3s"));
        }, 3000);

        this.ws.onopen = () => {
          // Send session.connect with call_token
          this.sendWsEvent("session.connect", { call_token: callToken });
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            const parsed = JSON.parse(event.data) as IWsEventMessage;
            this.handleWsMessage(parsed, () => {
              clearTimeout(authTimeout);
              resolve();
            });
          } catch (err) {
            console.error("Call.connectSignaling::JSON parse error:", err);
          }
        };

        this.ws.onerror = (err) => {
          clearTimeout(authTimeout);
          this.emit(ECallEventName.STATE, { state: ECallState.ERROR, reason: "WebSocket error" });
          reject(err);
        };

        this.ws.onclose = () => {
          clearTimeout(authTimeout);
          this.ws = null;
          if (this.active && !this._destroying) {
            this.destroy(false);
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Helper to send JSON event message over this call's WebSocket
   */
  public sendWsEvent(event: string, data?: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }));
    }
  }

  /**
   * Helper to extract a valid RTCSessionDescriptionInit from WS event data.
   * Handles object formats { type, sdp }, nested { sdp: { type, sdp } }, or raw SDP strings.
   */
  private extractSdpInit(data: unknown): RTCSessionDescriptionInit | null {
    if (!data || typeof data !== "object") return null;
    const obj = data as Record<string, unknown>;

    if (obj.sdp && typeof obj.sdp === "object") {
      const sdpObj = obj.sdp as Record<string, unknown>;
      if (typeof sdpObj.sdp === "string") {
        return {
          type: (sdpObj.type as RTCSessionDescriptionInit["type"]) || "answer",
          sdp: sdpObj.sdp,
        };
      }
    }

    if (typeof obj.sdp === "string") {
      return {
        type: (obj.type as RTCSessionDescriptionInit["type"]) || "answer",
        sdp: obj.sdp,
      };
    }

    if (typeof obj.type === "string" && typeof obj.sdp === "string") {
      return {
        type: obj.type as RTCSessionDescriptionInit["type"],
        sdp: obj.sdp,
      };
    }

    return null;
  }

  /**
   * Process incoming WebSocket signaling messages for this call
   */
  private handleWsMessage(msg: IWsEventMessage, onConnectSuccess: () => void): void {
    const { event, data } = msg;

    switch (event) {
      case "session.connected": {
        onConnectSuccess();
        break;
      }
      case "session.error": {
        console.error("Call.handleWsMessage::session.error:", data);
        this.emit(ECallEventName.STATE, {
          state: ECallState.ERROR,
          reason: (data?.message as string) || "Session error",
        });
        break;
      }
      case "call.offer": {
        if (data) {
          const sdpInit = this.extractSdpInit(data);
          if (sdpInit) {
            this.remoteDescription = sdpInit;
            void this.setRemoteDescription(this.remoteDescription);
          }
          if (data.from) this.from = (data.from as { number?: string })?.number || String(data.from);
          if (data.from_name) this.from_name = String(data.from_name);
          if (data.is_transfer !== undefined) this.isTransfer = Boolean(data.is_transfer);
        }
        this.state = ECallState.RINGING;
        this.emit(ECallEventName.STATE, { state: ECallState.RINGING, data });
        if (this.client) {
          this.client.events.emit(EClientEventName.CALL_OFFER, this);
        }
        break;
      }
      case "call.answered": {
        const sdpInit = this.extractSdpInit(data);
        if (sdpInit) {
          void this.setRemoteDescription(sdpInit);
        }
        this.state = ECallState.ACTIVE;
        this.active = true;
        this.emit(ECallEventName.STATE, { state: ECallState.ANSWERED, data });
        break;
      }
      case "call.held": {
        const sdpInit = this.extractSdpInit(data);
        if (sdpInit) {
          void this.setRemoteDescription(sdpInit);
        }
        this.state = ECallState.ONHOLD;
        this.emit(ECallEventName.STATE, { state: ECallState.ONHOLD, data });
        break;
      }
      case "call.unheld": {
        const sdpInit = this.extractSdpInit(data);
        if (sdpInit) {
          void this.setRemoteDescription(sdpInit);
        }
        this.state = ECallState.ACTIVE;
        this.emit(ECallEventName.STATE, { state: ECallState.ACTIVE, data });
        break;
      }
      case "call.ended":
      case "call.rejected":
      case "call.canceled": {
        this.state = ECallState.ENDED;
        const reason = (data?.reason as string) || event;
        this.emit(ECallEventName.STATE, {
          state: ECallState.ENDED,
          reason,
          data,
        });
        if (this.client) {
          const clientEvent =
            event === "call.canceled"
              ? EClientEventName.CALL_CANCELED
              : EClientEventName.CALL_ENDED;
          this.client.events.emit(clientEvent, {
            call: this,
            call_id: this.callId,
            event,
            reason,
            data,
          });
          this.client.events.emit("call.ended", {
            call: this,
            call_id: this.callId,
            event,
            reason,
            data,
          });
          if (event === "call.canceled") {
            this.client.events.emit("call.canceled", {
              call: this,
              call_id: this.callId,
              event,
              reason,
              data,
            });
          }
        }
        this.destroy(false);
        break;
      }
      case "call.sdp": {
        const sdpInit = this.extractSdpInit(data);
        if (sdpInit) {
          void this.setRemoteDescription(sdpInit);
        }
        break;
      }
      case "call.state": {
        const sdpInit = this.extractSdpInit(data);
        if (sdpInit) {
          void this.setRemoteDescription(sdpInit);
        }
        if (data?.state) {
          const nextState = (data.state as ECallState) || ECallState.RINGING;
          this.state = nextState === ECallState.ANSWERED ? ECallState.ACTIVE : nextState;
        }
        this.emit(ECallEventName.STATE, data || {});
        break;
      }
    }
  }

  /**
   * Start an outbound call.
   * Initiates REST call creation, connects dedicated WS signaling,
   * gathers full ICE candidates, and sends call.offer.
   */
  public async start(): Promise<void> {
    if (!this.client) throw new Error("Client is not attached to Call");
    this.active = true;
    this.state = ECallState.INITIATED;
    try {
      await this.setupWebrtcMedia({ video: this.isVideo, audio: true });
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      // Wait for all ICE candidates to be gathered (Full ICE, not Trickle)
      const sdp = await this.getSDPFull();
      const res = await this.client.initiateCallRest(this.to, this.from, Boolean(this.isVideo));
      this.callId = res.call_id;

      // Connect dedicated WS for this call session
      await this.connectSignaling(res.ws_url, res.call_token);

      // Send call.offer over WebSocket
      this.sendWsEvent("call.offer", { sdp: sdp.sdp });
      this.active = true;
    } catch (error: unknown) {
      this.active = false;
      this.state = ECallState.ERROR;
      this.destroy(false);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Hang up this call
   */
  public async hangup(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    if (this.callId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendWsEvent("call.hangup", { call_id: this.callId });
    }
    this.destroy(false);
  }

  /**
   * Accept an incoming call.
   * Sets up WebRTC media, sets remote description, creates answer,
   * gathers full ICE, then sends call.answer over WebSocket.
   */
  public async accept(): Promise<void> {
    if (!this.callId) throw new Error("callId is missing");
    if (!this.remoteDescription) throw new Error("remoteDescription is missing");
    try {
      await this.setupWebrtcMedia({ video: this.isVideo, audio: true });
      await this.setRemoteDescription(this.remoteDescription);
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      const sdp = await this.getSDPFull();

      this.sendWsEvent("call.answer", {
        call_id: this.callId,
        sdp: sdp.sdp,
      });
      this.active = true;
      this.state = ECallState.ANSWERED;
    } catch (error: unknown) {
      this.active = false;
      this.state = ECallState.ERROR;
      this.destroy(false);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Reject an incoming call
   */
  public async reject(): Promise<void> {
    if (this.callId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendWsEvent("call.reject", { call_id: this.callId });
    }
    this.destroy(false);
  }

  /**
   * Transfer the call to another agent in the team.
   * Leaders and supervisors can transfer active calls.
   * @param targetUsername Username of the target agent
   * @param teamId Team ID
   */
  public async transfer(targetUsername: string, teamId: string = ""): Promise<void> {
    if (!this.callId) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendWsEvent("call.transfer", {
        call_id: this.callId,
        to: targetUsername,
        team_id: teamId || undefined,
      });
    }
    this.active = false;
    this.cleanupPeerConnection();
    if (this.client && this.callId) {
      this.client.activeCalls.delete(this.callId);
    }
    this.state = ECallState.ENDED;
    this.emit(ECallEventName.STATE, { state: ECallState.ENDED, reason: "Transferred" });
  }

  /**
   * Send a DTMF tone
   * @param digit Single digit: 0-9, *, #, A-D
   * @param duration Duration in ms (default: 250)
   */
  public async sendDTMF(digit: string, duration?: number): Promise<void> {
    if (!this.active) {
      throw new Error("Cannot send DTMF: call is not active");
    }
    if (!this.callId) return;
    this.sendWsEvent("call.dtmf", {
      call_id: this.callId,
      digit,
      duration: duration || 250,
    });
  }

  /**
   * Mute the microphone.
   * Stops local audio tracks and notifies the server.
   */
  public async mute(): Promise<void> {
    if (!this.active) {
      throw new Error("Cannot mute: call is not active");
    }
    if (!this.callId) return;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
    }
    this.isMuted = true;
    this.sendWsEvent("call.mute", { call_id: this.callId, muted: true });
    this.emit(ECallEventName.MUTE, { muted: true });
  }

  /**
   * Unmute the microphone.
   * Resumes local audio tracks and notifies the server.
   */
  public async unmute(): Promise<void> {
    if (!this.active) {
      throw new Error("Cannot unmute: call is not active");
    }
    if (!this.callId) return;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
    }
    this.isMuted = false;
    this.sendWsEvent("call.mute", { call_id: this.callId, muted: false });
    this.emit(ECallEventName.MUTE, { muted: false });
  }

  /**
   * Toggle mute state
   */
  public async toggleMute(): Promise<void> {
    if (this.isMuted) {
      await this.unmute();
    } else {
      await this.mute();
    }
  }

  /**
   * Put the call on hold
   */
  public async onhold(): Promise<void> {
    if (!this.callId) return;
    this.peerConnection.getTransceivers().forEach((t) => {
      if (t.sender.track) {
        t.direction = "sendonly";
      }
    });

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    const sdp = await this.getSDPFull();
    this.sendWsEvent("call.hold", { call_id: this.callId, sdp: sdp.sdp });
    this.state = ECallState.ONHOLD;
    this.emit(ECallEventName.STATE, { state: ECallState.ONHOLD });
  }

  /**
   * Resume a held call
   */
  public async unhold(): Promise<void> {
    if (this.state !== ECallState.ONHOLD) {
      throw new Error("Call is not on hold");
    }
    if (!this.callId) return;
    this.peerConnection.getTransceivers().forEach((t) => {
      if (t.sender.track) {
        t.direction = "sendrecv";
      }
    });

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    const sdp = await this.getSDPFull();
    this.sendWsEvent("call.unhold", { call_id: this.callId, sdp: sdp.sdp });
    this.state = ECallState.ACTIVE;
    this.emit(ECallEventName.STATE, { state: ECallState.ACTIVE });
  }

  /**
   * Update call signaling state from server notification
   */
  public setSignalState(state: ECallState, params: Record<string, unknown>): void {
    this.state = state === ECallState.ANSWERED ? ECallState.ACTIVE : state;
    this.emit(ECallEventName.STATE, params);
  }

  /**
   * Get current call state
   */
  public get callState(): ECallState {
    return this.state;
  }

  /**
   * Whether the call is currently on hold
   */
  public get isHold(): boolean {
    return this.state === ECallState.ONHOLD;
  }

  /**
   * Destroy/cleanup this call instance.
   * Closes WebRTC PeerConnection, stops local/remote media tracks,
   * closes dedicated WebSocket connection, and clears event listeners.
   * @param sendHangup Whether to send call.hangup event to server (default: true, set to false for transfers)
   */
  public async destroy(sendHangup: boolean = true): Promise<void> {
    if (this._destroying) return;
    this._destroying = true;

    if (sendHangup && this.active && this.callId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendWsEvent("call.hangup", { call_id: this.callId });
    }
    this.active = false;

    // Close dedicated Call WebSocket
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    if (this.client && this.callId) {
      this.client.activeCalls.delete(this.callId);
    }
    this.client = null;

    this.cleanupPeerConnection();

    if (this.state !== ECallState.ENDED && this.state !== ECallState.ERROR) {
      this.state = ECallState.ENDED;
      this.emit(ECallEventName.STATE, { state: ECallState.ENDED, reason: "Local Hangup" });
    }

    this.offAll();
  }

  /**
   * Set the remote SDP description on the peer connection
   */
  public async setRemoteDescription(
    sdp: RTCSessionDescriptionInit
  ): Promise<void> {
    try {
      if (sdp.type === "answer" && this.peerConnection.signalingState === "stable") {
        return;
      }

      let sdpText = sdp.sdp || "";

      // Extract DTLS setup role (active/passive/actpass) from SDP
      const setupMatch = sdpText.match(/a=setup:(active|passive|actpass)/);

      if (setupMatch) {
        if (!this.currentRemoteSetupRole) {
          // Record initial established DTLS role from server (must be 'active' or 'passive')
          if (setupMatch[1] === "active" || setupMatch[1] === "passive") {
            this.currentRemoteSetupRole = setupMatch[1];
          }
        } else if (
          (setupMatch[1] === "active" || setupMatch[1] === "passive") &&
          setupMatch[1] !== this.currentRemoteSetupRole
        ) {
          // Preserve established DTLS role during renegotiation (hold/unhold) to prevent 'Failed to set SSL role for the transport'
          sdpText = sdpText.replace(
            /a=setup:(active|passive|actpass)/g,
            `a=setup:${this.currentRemoteSetupRole}`
          );
        }
      }

      const finalSdp: RTCSessionDescriptionInit = {
        type: sdp.type,
        sdp: sdpText,
      };

      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription(finalSdp)
      );
    } catch (error) {
      console.error("setRemoteDescription:", error);
    }
  }

  /**
   * Setup WebRTC media (getUserMedia + peerConnection)
   */
  private async setupWebrtcMedia(
    constraints: MediaStreamConstraints
  ): Promise<boolean> {
    try {
      this.cleanupPeerConnection();
      this.peerConnection = new RTCPeerConnection({
        iceServers: this.client?.iceServers?.length
          ? this.client.iceServers
          : DEFAULT_ICE_SERVERS,
      });

      this.peerConnection.oniceconnectionstatechange = () => {
        this.emit(
          ECallEventName.MEDIA_STATE,
          this.peerConnection.iceConnectionState
        );
      };

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Add local tracks to peer connection
      this.localStream.getTracks().forEach((track) =>
        this.peerConnection.addTrack(track, this.localStream!)
      );
      this.emit(ECallEventName.LOCAL_STREAM, this.localStream);

      // Process remote stream
      this.peerConnection.ontrack = (event) => {
        const remoteStream = event.streams[0];
        this.remoteStream = remoteStream;
        this.emit(ECallEventName.REMOTE_STREAM, remoteStream);
      };

      return true;
    } catch (error: unknown) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Wait for ICE candidates to be gathered and return full SDP.
   * Firetell media servers do not support Trickle ICE.
   */
  private async getSDPFull(): Promise<RTCSessionDescription> {
    return new Promise((resolve, reject) => {
      const pc = this.peerConnection;

      let isFinished = false;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = () => {
        if (isFinished) return;
        isFinished = true;
        if (pc) {
          pc.onicecandidate = null;
          pc.onicegatheringstatechange = null;
        }
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (fallbackTimer) clearTimeout(fallbackTimer);

        if (pc && pc.localDescription) {
          resolve(pc.localDescription);
        } else {
          reject(new Error("No local description after ICE gathering"));
        }
      };

      // Check if ICE gathering is already complete
      if (pc.iceGatheringState === "complete") {
        finish();
        return;
      }

      // Hard safety timeout of 6 seconds
      timeoutTimer = setTimeout(() => {
        if (pc.localDescription) {
          finish();
        } else {
          if (pc) {
            pc.onicecandidate = null;
            pc.onicegatheringstatechange = null;
          }
          reject(new Error("ICE gathering timed out after 6s"));
        }
      }, 6000);

      // Fallback: If 3 seconds pass and STUN Public IP candidate (typ srflx) or Relay (typ relay) is present
      fallbackTimer = setTimeout(() => {
        if (
          pc.localDescription &&
          (/typ srflx/.test(pc.localDescription.sdp) || /typ relay/.test(pc.localDescription.sdp))
        ) {
          finish();
        }
      }, 3000);

      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          // ICE gathering complete (null candidate signals end)
          finish();
        }
      };

      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") {
          finish();
        }
      };
    });
  }

  /**
   * Cleanup the peer connection and streams
   */
  private cleanupPeerConnection(): void {
    this.isMuted = false;
    this.currentRemoteSetupRole = null;
    if (this.peerConnection) {
      this.peerConnection.onicecandidate = null;
      this.peerConnection.oniceconnectionstatechange = null;
      this.peerConnection.onicegatheringstatechange = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.ontrack = null;
      this.peerConnection.close();
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
      this.emit(ECallEventName.LOCAL_STREAM, null);
    }
    if (this.remoteStream) {
      this.remoteStream = null;
      this.emit(ECallEventName.REMOTE_STREAM, null);
    }
  }
}
