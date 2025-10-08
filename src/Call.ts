import { ECallEventName } from "./enums/ECallEventName.enum";
import { ECallState } from "./enums/ECallState.enum";
import { CallOptions } from "./interfaces/ICallOptions";
import { Listener, SimpleEventEmitter } from "./SimpleEventEmitter";
import  { TelcheapClient }  from "./TelcheapClient";


export class Call extends SimpleEventEmitter {
  public callId: string;
  public number: string;
  public callee: string;
  public caller: string;
  public active: boolean = false;
  private client: TelcheapClient | null;
  private state: ECallState;
  private peerConnection = new RTCPeerConnection();
  public remoteDescription: RTCSessionDescription | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  public isVideo: boolean | MediaTrackConstraints;
  public isMuted: boolean;
  public isTransfer: boolean;
  constructor(client: TelcheapClient, options: CallOptions) {
    super();
    if (!(client instanceof TelcheapClient)) throw new Error(`Missing or invalid client instance`);
    if (!options.callee) throw new Error(`callee is required in options`);
    this.client = client;
    this.number = options.number;
    this.callee = options.callee;
    this.caller = options.caller;
    this.isVideo = options.isVideo || false;
    this.isTransfer = options.isTransfer || false;
  }

  public async start() {
    this.active = true;
    this.state = ECallState.INITIATED;
    try {
      await this.setupWebrtcMedia({video: this.isVideo, audio: true });
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      // chờ thu thập đủ ICE
      const sdp = await this.getSDPFull();
      
      const callId = await this.client.makeCall(this, sdp);
      this.callId = callId;
      this.active = true;
    } catch (error) {
      this.active = false;
      this.state = ECallState.ERROR;
      this.destroy();
      throw new Error(error.message);
    }
  }
  /**
   * hang up this call
   * @returns 
   */
  async hangup() {
    if (!this.active) return;
    this.client.sendHangup(this.callId);
    this.active = false;
    this.destroy();
  }

  async accept(): Promise<void> {
    this.state = ECallState.ANSWERED;
    if(!this.remoteDescription) {
      throw new Error(`remoteDescription is missing`);
    }
    await this.setupWebrtcMedia({video: this.isVideo, audio: true });
    await this.setRemoteDescription(this.remoteDescription);
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    const sdp = await this.getSDPFull();
    await this.client.sendAccept(this.callId, sdp);
    this.active = true;
  }

  public async reject(): Promise<void> {

    await this.client.sendReject(this.callId);
    this.destroy();

  }

  public async transfer(callee: string): Promise<void> {
    await this.onhold();
    await this.client.sendTransfer(this.callId, callee);
    this.destroy();

  }

  public setSignalState(state: ECallState, params: {}) {
    this.state = state === ECallState.ANSWERED ? ECallState.ACTIVE : state;
    this.emit(ECallEventName.state, params);
  }
  /**
   * report destroy
   */
  async destroy() {
    if(this.active) await this.hangup();
    this.active = false;
    this.client = null;
    this.cleanupPeerConnection();
    this.offAll();
  }
  /**
   * setRemoteDescription
   * @param sdp 
   * @returns 
   */
  public async setRemoteDescription(sdp: RTCSessionDescription) {
    try {
     // if (this.peerConnection.remoteDescription) return;
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch (error) {
      console.error('setRemoteDescription', error);
    }

  }
  /**
   * setup Webrtc Media
   * @param constraints 
   */
  private async setupWebrtcMedia(constraints: MediaStreamConstraints): Promise<boolean> {

    return new Promise(async (resolve, reject) => {

      try {
        this.cleanupPeerConnection();
        this.peerConnection = new RTCPeerConnection({
          iceServers: this.client.iceServers.length ? this.client.iceServers : [{ urls: "stun:stun.l.google.com:19302" }],
        });

        this.peerConnection.oniceconnectionstatechange = () => {
          this.emit(ECallEventName.mediaState, this.peerConnection.iceConnectionState);
        };
        this.localStream = await navigator.mediaDevices.getUserMedia(
          constraints
        );
        //process local stream
        this.localStream
          .getTracks()
          .forEach((track) =>
            this.peerConnection.addTrack(track, this.localStream)
          );
        this.emit(ECallEventName.localStream, this.localStream);

        // process remote stream
        this.peerConnection.ontrack = (event) => {
          const remoteStream = event.streams[0];
          this.remoteStream = remoteStream;
          this.emit(ECallEventName.remoteStream, remoteStream);
        };
        resolve(true);

      } catch (error) {
        reject(new Error(error.message));
      }

    })

  }
  /**
   * Get RTCSessionDescription
   * @returns 
   */
  private async getSDPFull(): Promise<RTCSessionDescription> {
    return new Promise(async (resolve, reject) => {
      try {
        
        this.peerConnection.onicecandidate = (event) => {
          if (event.candidate) {

          }
          if (!event.candidate) {
            // ICE gathering complete
            this.peerConnection.onicecandidate = null;
            resolve(this.peerConnection.localDescription);
          }
        };
      } catch (error) {
        reject(new Error(error.message));
      }
    });
  }
  public async onhold() {
    this.peerConnection.getTransceivers().forEach(t => {
      if (t.sender.track) {
        t.direction = "sendonly"; // or "inactive"
      }
    });

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    const sdp = await this.client.sendHold(this.callId, offer);
    this.setRemoteDescription(sdp);
    this.state = ECallState.ONHOLD;
  }

  public async unhold() {
    if (this.state !== ECallState.ONHOLD) {
      throw new Error(`call state not ONHOLD`);
    }
    this.peerConnection.getTransceivers().forEach(t => {
      if (t.sender.track) {
        t.direction = "sendrecv";
      }
    });

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    
    const sdp = await this.client.sendUnHold(this.callId, offer);
    this.setRemoteDescription(sdp);
    
    this.state = ECallState.ACTIVE;
  }

  public get isHold(): boolean {
    return this.state === ECallState.ONHOLD; 
  }
  /**
   * cleanup Peer Connection
   */
  private cleanupPeerConnection() {
    this.isMuted = false;
    this.active = false;
    if (this.peerConnection) {
      this.peerConnection.onicecandidate = null;
      this.peerConnection.oniceconnectionstatechange = null;
      this.peerConnection.onicegatheringstatechange = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.close();
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
      this.emit(ECallEventName.localStream, null);
    }
    if (this.remoteStream) {
      this.remoteStream = null;
      this.emit(ECallEventName.remoteStream, null);
    }
  }
}
