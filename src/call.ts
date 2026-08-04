import { ECallEventName } from "./enums/call-event-name.enum";
import { ECallState } from "./enums/call-state.enum";
import { CallOptions } from "./interfaces/call-options.interface";
import { SimpleEventEmitter } from "./simple-event-emitter";
import { FiretellClient } from "./firetell-client";

export class Call extends SimpleEventEmitter {
  public callId: string | null = null ;
  public from: string;
  public from_name: string;
  public to: string;
  public active: boolean = false;
  private client: FiretellClient | null;
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
    this.peerConnection = new RTCPeerConnection();
  }

  /**
   * Start an outbound call.
   * Sets up WebRTC media, creates offer, gathers full ICE candidates,
   * then sends call.offer via the client.
   */
  public async start(): Promise<void> {
    this.active = true;
    this.state = ECallState.INITIATED;
    try {
      await this.setupWebrtcMedia({ video: this.isVideo, audio: true });
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      // Wait for all ICE candidates to be gathered (Full ICE, not Trickle)
      const sdp = await this.getSDPFull();
      const callId = await this.client!.makeCall(this, sdp);
      this.callId = callId;
      this.active = true;
    } catch (error: unknown) {
      this.active = false;
      this.state = ECallState.ERROR;
      this.destroy();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Hang up this call
   */
  public async hangup(): Promise<void> {
    if (!this.active || !this.client) return;
    this.active = false;
    try {
      if (!this.callId) return;
      await this.client.sendHangup(this.callId);
    } catch (error) {
      console.error("hangup::Error:", error);
    }
    this.destroy();
  }

  /**
   * Accept an incoming call.
   * Sets up WebRTC media, sets remote description, creates answer,
   * gathers full ICE, then sends call.answer via the client.
   */
  public async accept(): Promise<void> {
    if (!this.callId) throw new Error("callId is missing");
    if (!this.remoteDescription) throw new Error("remoteDescription is missing");
    await this.setupWebrtcMedia({ video: this.isVideo, audio: true });
    await this.setRemoteDescription(this.remoteDescription);
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    const sdp = await this.getSDPFull();
    await this.client!.sendAccept(this.callId, sdp);
    this.active = true;
    this.state = ECallState.ANSWERED;
  }

  /**
   * Reject an incoming call
   */
  public async reject(): Promise<void> {
    if (!this.callId) return;
    await this.client?.sendReject(this.callId);
    this.destroy();
  }

  /**
   * Transfer the call to another agent in the team.
   * Leaders and supervisors can transfer active calls.
   * @param targetUsername Username of the target agent
   * @param teamId Team ID
   */
  public async transfer(targetUsername: string, teamId: string = ""): Promise<void> {
    if (!this.callId) return;
    await this.client?.sendTransfer(this.callId, targetUsername, teamId);
    await this.destroy(false);
  }

  /**
   * Send a DTMF tone
   * @param digit Single digit: 0-9, *, #, A-D
   * @param duration Duration in ms (default: 250)
   */
  public async sendDTMF(digit: string, duration?: number): Promise<void> {
    if (!this.active || !this.client) {
      throw new Error("Cannot send DTMF: call is not active");
    }
    if (!this.callId) return;
    await this.client.sendDTMF(this.callId, digit, duration);
  }

  /**
   * Mute the microphone.
   * Stops local audio tracks and notifies the server.
   */
  public async mute(): Promise<void> {
    if (!this.active || !this.client) {
      throw new Error("Cannot mute: call is not active");
    }
    if (!this.callId) return;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
    }
    this.isMuted = true;
    await this.client.sendMute(this.callId, true);
    this.emit(ECallEventName.MUTE, { muted: true });
  }

  /**
   * Unmute the microphone.
   * Resumes local audio tracks and notifies the server.
   */
  public async unmute(): Promise<void> {
    if (!this.active || !this.client) {
      throw new Error("Cannot unmute: call is not active");
    }
    if (!this.callId) return;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
    }
    this.isMuted = false;
    await this.client.sendMute(this.callId, false);
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
   * Destroy/cleanup this call instance.
   * Uses _destroying flag to prevent infinite loop with hangup().
   * @param sendHangup Whether to send call.hangup event to server (default: true, set to false for transfers)
   */
  public async destroy(sendHangup: boolean = true): Promise<void> {
    if (this._destroying) return;
    this._destroying = true;

    if (sendHangup && this.active && this.client) {
      this.active = false;
      try {
        if (!this.callId) return;
        await this.client.sendHangup(this.callId);
      } catch {
        // Best-effort hangup during destroy
      }
    }
    this.active = false;
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
      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription(sdp)
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
        iceServers: this.client!.iceServers.length
          ? this.client!.iceServers
          : [{ urls: "stun:stun.l.google.com:19302" }],
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
   * Wait for all ICE candidates to be gathered and return the full SDP.
   * Media servers does not support Trickle ICE.
   */
  private async getSDPFull(): Promise<RTCSessionDescription> {
    return new Promise((resolve, reject) => {
      // Check if ICE gathering already complete
      if (this.peerConnection.iceGatheringState === "complete") {
        if (this.peerConnection.localDescription) {
          resolve(this.peerConnection.localDescription);
        } else {
          reject(new Error("No local description after ICE gathering"));
        }
        return;
      }

      const timeout = setTimeout(() => {
        this.peerConnection.onicecandidate = null;
        reject(new Error("ICE gathering timed out after 10s"));
      }, 10000);

      this.peerConnection.onicecandidate = (event) => {
        if (!event.candidate) {
          // ICE gathering complete (null candidate signals end)
          clearTimeout(timeout);
          this.peerConnection.onicecandidate = null;
          if (this.peerConnection.localDescription) {
            resolve(this.peerConnection.localDescription);
          } else {
            reject(new Error("No local description after ICE gathering"));
          }
        }
      };
    });
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
    await this.client!.sendHold(this.callId, offer);
    this.state = ECallState.ONHOLD;
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
    await this.client!.sendUnHold(this.callId, offer);
    this.state = ECallState.ANSWERED;
  }

  /**
   * Whether the call is currently on hold
   */
  public get isHold(): boolean {
    return this.state === ECallState.ONHOLD;
  }

  /**
   * Cleanup the peer connection and streams
   */
  private cleanupPeerConnection(): void {
    this.isMuted = false;
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
