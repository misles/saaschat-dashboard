import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, BehaviorSubject, Subscription } from 'rxjs';

// ✅ CORRECT LiveKit v1.13.0 imports
import { 
  Room, 
  LocalTrack, 
  LocalVideoTrack, 
  LocalAudioTrack, 
  RemoteParticipant,
  LocalParticipant,
  Track,
  TrackPublication,
  VideoPresets,
  RoomEvent,
  DisconnectReason,
  createLocalVideoTrack,  // ✅ Factory function
  createLocalAudioTrack,   // ✅ Factory function
  createLocalTracks        // ✅ Added for better track management
} from 'livekit-client';

import { 
  CanMakeCallResponse, 
  TokenResponse, 
  Participant,
  CallStats,
  CallState,
  TrackInfo,
  CallSettings
} from './livekit.types';

@Injectable({
  providedIn: 'root'
})
export class LivekitService implements OnDestroy {
  private room: Room | null = null;
  private apiBase = '/api/v1';
  private subs = new Subscription();
  
  // Observables
  public participants$ = new BehaviorSubject<Participant[]>([]);
  public isConnected$ = new BehaviorSubject<boolean>(false);
  public callState$ = new BehaviorSubject<CallState>(CallState.DISCONNECTED);
  public callStats$ = new BehaviorSubject<CallStats | null>(null);
  public localVideoEnabled$ = new BehaviorSubject<boolean>(false);
  public localAudioEnabled$ = new BehaviorSubject<boolean>(false);
  public isScreenSharing$ = new BehaviorSubject<boolean>(false);
  public activeTracks$ = new BehaviorSubject<TrackInfo[]>([]);
  
  // Events
  public onCallStarted = new Subject<TokenResponse>();
  public onCallEnded = new Subject<{ duration: number, reason: string }>();
  public onParticipantJoined = new Subject<Participant>();
  public onParticipantLeft = new Subject<string>();
  public onTrackSubscribed = new Subject<{track: any, participant: any}>();
  public onTrackUnsubscribed = new Subject<{track: any, participant: any}>();
  
  private callStartTime: Date | null = null;
  private statsInterval: any;
  private localTracks: LocalTrack[] = [];
  private screenTrack: LocalVideoTrack | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

  constructor(
    private http: HttpClient,
    private ngZone: NgZone
  ) {}

  // ==================== API METHODS ====================

  async canMakeCall(projectId: string, type: 'audio' | 'video'): Promise<CanMakeCallResponse> {
    try {
      const response = await this.http.post<CanMakeCallResponse>(
        `${this.apiBase}/livekit/can-make-call`,
        { 
          project_id: projectId,
          type: type,
          timestamp: new Date().toISOString()
        }
      ).toPromise();

      return response || {
        success: false,
        allowed: false,
        message: 'Invalid response from server'
      };
    } catch (error: any) {
      console.error('canMakeCall error:', error);
      return {
        success: false,
        allowed: false,
        message: error.message || 'Server error checking call permissions'
      };
    }
  }

  async getToken(
    projectId: string, 
    type: 'audio' | 'video', 
    participantName: string,
    roomName?: string
  ): Promise<TokenResponse> {
    try {
      const response = await this.http.post<TokenResponse>(
        `${this.apiBase}/livekit/token`,
        {
          project_id: projectId,
          type: type,
          participant_name: participantName,
          room_name: roomName || `room-${projectId}-${Date.now()}`,
          metadata: JSON.stringify({
            browser: navigator.userAgent,
            platform: navigator.platform,
            timestamp: new Date().toISOString()
          })
        }
      ).toPromise();

      if (!response || !response.token || !response.url) {
        throw new Error('Invalid token response from server');
      }

      return response;
    } catch (error: any) {
      console.error('Token request failed:', error);
      throw new Error(`Failed to get call token: ${error.message || 'Network error'}`);
    }
  }

  async recordCallUsage(projectId: string, duration: number, type: 'audio' | 'video'): Promise<any> {
    try {
      return await this.http.post(
        `${this.apiBase}/livekit/record-usage`,
        {
          project_id: projectId,
          duration: Math.floor(duration),
          type: type,
          participants: this.participants$.value.length,
          timestamp: new Date().toISOString()
        }
      ).toPromise();
    } catch (error) {
      console.warn('Failed to record call usage:', error);
      throw error;
    }
  }

  async getCallUsage(projectId: string): Promise<CallSettings> {
    try {
      const response = await this.http.get<CallSettings>(
        `${this.apiBase}/livekit/usage?project_id=${projectId}`
      ).toPromise();

      return response || {
        enabled: false,
        audio_calls: false,
        video_calls: false,
        screen_sharing: false,
        max_participants: 0,
        max_duration: 0
      };
    } catch (error) {
      console.warn('Failed to get call usage:', error);
      return {
        enabled: false,
        audio_calls: false,
        video_calls: false,
        screen_sharing: false,
        max_participants: 0,
        max_duration: 0
      };
    }
  }

  // ==================== LIVEKIT ROOM METHODS ====================

  async joinCall(
    token: string,
    url: string,
    options: {
      videoEnabled?: boolean;
      audioEnabled?: boolean;
      participantName?: string;
    } = {}
  ): Promise<Room> {
    try {
      this.callState$.next(CallState.CONNECTING);
      
      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: VideoPresets.h720.resolution
        }
      });
      
      this.setupRoomListeners();
      await this.room.connect(url, token, { autoSubscribe: true });
      
      if (options.participantName && this.room.localParticipant) {
        this.room.localParticipant.setName(options.participantName);
      }
      
      await this.setupLocalMedia(
        options.videoEnabled ?? true,
        options.audioEnabled ?? true
      );
      
      this.callState$.next(CallState.CONNECTED);
      this.isConnected$.next(true);
      this.callStartTime = new Date();
      this.reconnectAttempts = 0;
      
      this.onCallStarted.next({ 
        token, 
        url, 
        room: this.room.name, 
        participant: { 
          identity: this.room.localParticipant?.identity || '', 
          name: options.participantName || 'User' 
        } 
      });
      
      this.startStatsCollection();
      return this.room;
      
    } catch (error: any) {
      console.error('Failed to join call:', error);
      this.callState$.next(CallState.DISCONNECTED);
      this.cleanup();
      
      if (error?.message?.includes('token') || 
          error?.message?.includes('expired') ||
          error?.message?.includes('permission')) {
        throw error;
      }
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.joinCall(token, url, options);
      }
      
      throw error;
    }
  }

  private setupRoomListeners(): void {
    if (!this.room) return;

    this.room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      this.ngZone.run(() => {
        this.addParticipant(participant);
        this.onParticipantJoined.next(this.mapParticipant(participant));
      });
    });

    this.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      this.ngZone.run(() => {
        this.removeParticipant(participant.identity);
        this.onParticipantLeft.next(participant.identity);
      });
    });

    this.room.on(RoomEvent.TrackSubscribed, (track: Track, publication: TrackPublication, participant: RemoteParticipant | LocalParticipant) => {
      this.ngZone.run(() => {
        this.updateParticipantTracks();
        this.onTrackSubscribed.next({ track, participant });
      });
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track: Track, publication: TrackPublication, participant: RemoteParticipant | LocalParticipant) => {
      this.ngZone.run(() => {
        this.updateParticipantTracks();
        this.onTrackUnsubscribed.next({ track, participant });
      });
    });

    this.room.on(RoomEvent.TrackMuted, (publication: TrackPublication, participant: RemoteParticipant | LocalParticipant) => {
      this.ngZone.run(() => {
        this.updateParticipantTracks();
      });
    });

    this.room.on(RoomEvent.TrackUnmuted, (publication: TrackPublication, participant: RemoteParticipant | LocalParticipant) => {
      this.ngZone.run(() => {
        this.updateParticipantTracks();
      });
    });

    this.room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      this.ngZone.run(() => {
        this.callState$.next(CallState.DISCONNECTED);
        this.cleanup();
        const duration = this.callStartTime 
          ? (new Date().getTime() - this.callStartTime.getTime()) / 1000
          : 0;
        
        this.onCallEnded.next({ 
          duration, 
          reason: reason ? reason.toString() : 'disconnected' 
        });
      });
    });

    this.room.on(RoomEvent.Reconnecting, () => {
      this.ngZone.run(() => {
        this.callState$.next(CallState.RECONNECTING);
      });
    });

    this.room.on(RoomEvent.Reconnected, () => {
      this.ngZone.run(() => {
        this.callState$.next(CallState.CONNECTED);
      });
    });

    this.room.on(RoomEvent.LocalTrackPublished, (publication: TrackPublication, participant: LocalParticipant) => {
      this.ngZone.run(() => {
        this.updateActiveTracks();
      });
    });

    this.room.on(RoomEvent.LocalTrackUnpublished, (publication: TrackPublication, participant: LocalParticipant) => {
      this.ngZone.run(() => {
        this.updateActiveTracks();
      });
    });
  }

  private async setupLocalMedia(
    enableVideo: boolean,
    enableAudio: boolean
  ): Promise<void> {
    if (!this.room) return;

    this.cleanupLocalTracks();
    
    try {
      const constraints: any = {};
      
      if (enableVideo) {
        constraints.video = {
          resolution: VideoPresets.h720.resolution,
          facingMode: 'user'
        };
      }
      
      if (enableAudio) {
        constraints.audio = true;
      }
      
      // ✅ FIXED: Use createLocalTracks for better compatibility
      if (enableVideo || enableAudio) {
        const tracks = await createLocalTracks(constraints);
        
        for (const track of tracks) {
          await this.room.localParticipant.publishTrack(track);
          this.localTracks.push(track);
          
          if (track.kind === Track.Kind.Video) {
            this.localVideoEnabled$.next(true);
          } else if (track.kind === Track.Kind.Audio) {
            this.localAudioEnabled$.next(true);
          }
        }
      }
    } catch (error: any) {
      console.error('Failed to setup local media:', error);
      
      // Handle specific permission errors
      if (error.name === 'NotAllowedError') {
        throw new Error('Microphone/camera permission denied');
      } else if (error.name === 'NotFoundError') {
        throw new Error('No microphone/camera found');
      } else {
        throw error;
      }
    }
  }

  private cleanupLocalTracks(): void {
    // ✅ FIXED: Cleanup in correct order
    this.localTracks.forEach(track => {
      try {
        // Unpublish from room
        this.room?.localParticipant.unpublishTrack(track);
        // Stop the track
        track.stop();
      } catch (error) {
        console.warn('Error cleaning up track:', error);
      }
    });
    
    this.localTracks = [];
    
    // Cleanup screen track
    if (this.screenTrack) {
      try {
        this.room?.localParticipant.unpublishTrack(this.screenTrack);
        this.screenTrack.stop();
      } catch (error) {
        console.warn('Error cleaning up screen track:', error);
      }
      this.screenTrack = null;
      this.isScreenSharing$.next(false);
    }
    
    this.localVideoEnabled$.next(false);
    this.localAudioEnabled$.next(false);
  }

  private updateParticipantTracks(): void {
    if (!this.room) return;

    const participants: Participant[] = [];
    
    if (this.room.localParticipant) {
      participants.push(this.mapParticipant(this.room.localParticipant));
    }
    
    this.room.participants.forEach((participant: RemoteParticipant) => {
      participants.push(this.mapParticipant(participant));
    });

    this.participants$.next(participants);
  }

  private updateActiveTracks(): void {
    if (!this.room) return;

    const trackInfos: TrackInfo[] = [];
    
    this.room.localParticipant.tracks.forEach((publication: TrackPublication) => {
      if (publication.track) {
        trackInfos.push({
          sid: publication.trackSid || '',
          type: publication.track.kind as 'audio' | 'video',
          isMuted: publication.isMuted,
          isEnabled: !publication.track.isMuted,
          source: publication.track.source?.toString() || 'unknown'
        });
      }
    });

    this.activeTracks$.next(trackInfos);
  }

  private mapParticipant(livekitParticipant: LocalParticipant | RemoteParticipant): Participant {
    const isLocal = livekitParticipant instanceof LocalParticipant;
    
    let cameraPublication: TrackPublication | null = null;
    livekitParticipant.videoTracks.forEach((publication: TrackPublication) => {
      if (publication.isSubscribed && publication.track?.source === Track.Source.Camera) {
        cameraPublication = publication;
      }
    });
    
    let screenPublication: TrackPublication | null = null;
    livekitParticipant.videoTracks.forEach((publication: TrackPublication) => {
      if (publication.isSubscribed && publication.track?.source === Track.Source.ScreenShare) {
        screenPublication = publication;
      }
    });
    
    let audioTrack: any = undefined;
    let hasAudio = false;
    
    livekitParticipant.audioTracks.forEach((publication: TrackPublication) => {
      if (publication.isSubscribed && publication.track) {
        audioTrack = publication.track;
        hasAudio = true;
      }
    });
    
    return {
      identity: livekitParticipant.identity,
      name: livekitParticipant.name || livekitParticipant.identity,
      isSpeaking: livekitParticipant.isSpeaking,
      isCameraEnabled: !!cameraPublication,
      isMicrophoneEnabled: hasAudio,
      isScreenSharing: !!screenPublication,
      isLocal: isLocal,
      elementId: `participant-${livekitParticipant.identity}`,
      videoTrack: cameraPublication?.track,
      audioTrack: audioTrack
    };
  }

  private addParticipant(participant: RemoteParticipant): void {
    const current = this.participants$.value;
    if (!current.find(p => p.identity === participant.identity)) {
      const newParticipants = [...current, this.mapParticipant(participant)];
      this.participants$.next(newParticipants);
    }
  }

  private removeParticipant(identity: string): void {
    const current = this.participants$.value;
    const filtered = current.filter(p => p.identity !== identity);
    this.participants$.next(filtered);
  }

  // ==================== CONTROL METHODS ====================

  async toggleVideo(): Promise<void> {
    if (!this.room) return;

    try {
      if (this.localVideoEnabled$.value) {
        // Turn video off
        const videoTrack = this.localTracks.find(t => t.kind === Track.Kind.Video);
        if (videoTrack) {
          await this.room.localParticipant.unpublishTrack(videoTrack);
          videoTrack.stop();
          this.localTracks = this.localTracks.filter(t => t !== videoTrack);
        }
        this.localVideoEnabled$.next(false);
      } else {
        // Turn video on
        const videoTrack = await createLocalVideoTrack({
          resolution: VideoPresets.h720.resolution
        });
        
        await this.room.localParticipant.publishTrack(videoTrack);
        this.localTracks.push(videoTrack);
        this.localVideoEnabled$.next(true);
      }
    } catch (error: any) {
      console.error('Failed to toggle video:', error);
      throw error;
    }
  }

  async toggleAudio(): Promise<void> {
    if (!this.room) return;

    try {
      if (this.localAudioEnabled$.value) {
        // Turn audio off
        const audioTrack = this.localTracks.find(t => t.kind === Track.Kind.Audio);
        if (audioTrack) {
          await this.room.localParticipant.unpublishTrack(audioTrack);
          audioTrack.stop();
          this.localTracks = this.localTracks.filter(t => t !== audioTrack);
        }
        this.localAudioEnabled$.next(false);
      } else {
        // Turn audio on
        const audioTrack = await createLocalAudioTrack();
        await this.room.localParticipant.publishTrack(audioTrack);
        this.localTracks.push(audioTrack);
        this.localAudioEnabled$.next(true);
      }
    } catch (error: any) {
      console.error('Failed to toggle audio:', error);
      throw error;
    }
  }

  async startScreenShare(): Promise<void> {
    if (!this.room) return;

    try {
      // If already sharing, stop first
      if (this.screenTrack) {
        await this.stopScreenShare();
      }

      const displayMediaOptions: any = {
        video: {
          displaySurface: 'monitor',
          logicalSurface: true,
          cursor: 'always',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };

      const screenStream = await (navigator.mediaDevices as any).getDisplayMedia(displayMediaOptions);
      const screenVideoTrack = screenStream.getVideoTracks()[0];
      
      if (!screenVideoTrack) {
        throw new Error('No video track found in screen share');
      }
      
      // ✅ FIXED: Create screen track properly
      this.screenTrack = new LocalVideoTrack(screenVideoTrack);
      
      // ✅ FIXED: Removed duplicate publishTrack call
      await this.room.localParticipant.publishTrack(this.screenTrack, {
        source: Track.Source.ScreenShare
      });
      
      this.isScreenSharing$.next(true);
      
      // Handle when user stops screen sharing via browser UI
      screenVideoTrack.onended = () => {
        this.stopScreenShare();
      };
      
      // Also listen for track stopping
      this.screenTrack.on(LocalVideoTrack.Event.Ended, () => {
        this.stopScreenShare();
      });
      
    } catch (error: any) {
      console.error('Failed to start screen share:', error);
      
      if (error.name === 'NotAllowedError') {
        throw new Error('Screen sharing permission denied');
      } else if (error.name === 'NotFoundError') {
        throw new Error('No screen sharing source found');
      } else {
        throw error;
      }
    }
  }

  async stopScreenShare(): Promise<void> {
    if (!this.room || !this.screenTrack) return;

    try {
      await this.room.localParticipant.unpublishTrack(this.screenTrack);
      this.screenTrack.stop();
      this.screenTrack = null;
      this.isScreenSharing$.next(false);
    } catch (error) {
      console.error('Failed to stop screen share:', error);
      throw error;
    }
  }

  async leaveCall(): Promise<void> {
    if (this.room) {
      await this.room.disconnect();
    }
    this.cleanup();
  }

  // ==================== UTILITY METHODS ====================

  private startStatsCollection(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    this.statsInterval = setInterval(async () => {
      if (!this.room) return;

      const duration = this.callStartTime 
        ? Math.floor((new Date().getTime() - this.callStartTime.getTime()) / 1000)
        : 0;

      const stats: CallStats = {
        duration,
        participants: this.participants$.value.length,
        bytesSent: 0,
        bytesReceived: 0,
        packetLoss: 0
      };

      try {
        if (typeof (this.room as any).getStats === 'function') {
          await (this.room as any).getStats();
        }
      } catch (error) {
        console.debug('Could not fetch detailed stats:', error);
      }

      this.callStats$.next(stats);
    }, 5000);
  }

  getCurrentRoom(): Room | null {
    return this.room;
  }

  getLocalParticipant(): LocalParticipant | null {
    return this.room ? this.room.localParticipant : null;
  }

  isLiveKitAvailable(): boolean {
    try {
      return typeof Room !== 'undefined';
    } catch {
      return false;
    }
  }

  private cleanup(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    
    this.cleanupLocalTracks();
    
    this.room = null;
    this.callStartTime = null;
    this.reconnectAttempts = 0;
    
    this.callState$.next(CallState.DISCONNECTED);
    this.isConnected$.next(false);
    this.participants$.next([]);
    this.callStats$.next(null);
    this.activeTracks$.next([]);
  }

  ngOnDestroy(): void {
    this.cleanup();
    this.subs.unsubscribe();
  }
}