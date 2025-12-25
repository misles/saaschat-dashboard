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
  DisconnectReason
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
      // ✅ RxJS 6.5.4: Use .toPromise()
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
      // ✅ RxJS 6.5.4: Use .toPromise()
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
      // ✅ RxJS 6.5.4: Use .toPromise()
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
      // ✅ RxJS 6.5.4: Use .toPromise()
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

  // ==================== LIVEKIT ROOM METHODS (v1.13.0 CORRECTED) ====================

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
      
      // 1. Create room instance (v1.13.0 syntax)
      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: VideoPresets.h720.resolution
        }
      });
      
      // 2. Setup event listeners with CORRECT RoomEvent enum
      this.setupRoomListeners();
      
      // 3. Connect to room
      await this.room.connect(url, token, {
        autoSubscribe: true
      });
      
      // 4. Set participant name
      if (options.participantName && this.room.localParticipant) {
        this.room.localParticipant.setName(options.participantName);
      }
      
      // 5. Setup local media (WITH CORRECT track creation)
      await this.setupLocalMedia(
        options.videoEnabled ?? true,
        options.audioEnabled ?? true
      );
      
      // 6. Update state
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
      
      // 7. Start stats collection
      this.startStatsCollection();
      
      return this.room;
      
    } catch (error: any) {
      console.error('Failed to join call:', error);
      this.callState$.next(CallState.DISCONNECTED);
      this.cleanup();
      
      // Don't retry on auth errors
      if (error?.message?.includes('token') || 
          error?.message?.includes('expired') ||
          error?.message?.includes('permission') ||
          error?.message?.includes('unauthorized')) {
        console.log('Auth error, not retrying');
        throw error;
      }
      
      // Auto-reconnect for network issues
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        return this.joinCall(token, url, options);
      }
      
      throw error;
    }
  }

  private setupRoomListeners(): void {
    if (!this.room) return;

    // ✅ Participant connected (CORRECT RoomEvent enum)
    this.room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      this.ngZone.run(() => {
        this.addParticipant(participant);
        this.onParticipantJoined.next(this.mapParticipant(participant));
      });
    });

    // ✅ Participant disconnected
    this.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      this.ngZone.run(() => {
        this.removeParticipant(participant.identity);
        this.onParticipantLeft.next(participant.identity);
      });
    });

    // ✅ Track subscribed
    this.room.on(RoomEvent.TrackSubscribed, (track: Track, publication: TrackPublication, participant: RemoteParticipant | LocalParticipant) => {
      this.ngZone.run(() => {
        this.updateParticipantTracks();
        this.onTrackSubscribed.next({ track, participant });
      });
    });

    // ✅ Track unsubscribed
    this.room.on(RoomEvent.TrackUnsubscribed, (track: Track, publication: TrackPublication, participant: RemoteParticipant | LocalParticipant) => {
      this.ngZone.run(() => {
        this.updateParticipantTracks();
        this.onTrackUnsubscribed.next({ track, participant });
      });
    });

    // ✅ Track muted/unmuted
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

    // ✅ Connection state changed (CORRECT RoomEvent enum)
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

    // ✅ Local track published/unpublished
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

    // Clean existing tracks
    this.cleanupLocalTracks();

    const tracks: LocalTrack[] = [];

    try {
      // Request camera/mic permissions
      if (enableVideo || enableAudio) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCamera = devices.some(d => d.kind === 'videoinput');
        const hasMicrophone = devices.some(d => d.kind === 'audioinput');

        // ✅ CORRECT: Create video track if enabled and available
        if (enableVideo && hasCamera) {
          try {
            const videoTrack = await this.createLocalVideoTrack({
              resolution: VideoPresets.h720.resolution,
              facingMode: 'user'
            });
            
            if (videoTrack) {
              tracks.push(videoTrack);
              await this.room.localParticipant.publishTrack(videoTrack);
              this.localVideoEnabled$.next(true);
            }
          } catch (error) {
            console.warn('Failed to create video track:', error);
            this.localVideoEnabled$.next(false);
          }
        }

        // ✅ CORRECT: Create audio track if enabled and available
        if (enableAudio && hasMicrophone) {
          try {
            const audioTrack = await this.createLocalAudioTrack();
            if (audioTrack) {
              tracks.push(audioTrack);
              await this.room.localParticipant.publishTrack(audioTrack);
              this.localAudioEnabled$.next(true);
            }
          } catch (error) {
            console.warn('Failed to create audio track:', error);
            this.localAudioEnabled$.next(false);
          }
        }

        this.localTracks = tracks;
      }
    } catch (error) {
      console.error('Failed to setup local media:', error);
      throw error;
    }
  }

  // ✅ CORRECT track creation helper methods for v1.13.0
  private async createLocalVideoTrack(options?: any): Promise<LocalVideoTrack | null> {
    try {
      // ✅ CORRECT: Try the factory function first (v1.13.0 style)
      const livekitModule = await import('livekit-client');
      
      if (typeof livekitModule.createLocalVideoTrack === 'function') {
        return await livekitModule.createLocalVideoTrack(options);
      } else {
        // Fallback for older import style
        console.warn('createLocalVideoTrack not found, using LocalVideoTrack.create');
        return await LocalVideoTrack.create(options);
      }
    } catch (error) {
      console.error('Failed to create video track:', error);
      return null;
    }
  }

  private async createLocalAudioTrack(): Promise<LocalAudioTrack | null> {
    try {
      // ✅ CORRECT: Try the factory function first
      const livekitModule = await import('livekit-client');
      
      if (typeof livekitModule.createLocalAudioTrack === 'function') {
        return await livekitModule.createLocalAudioTrack();
      } else {
        // Fallback for older import style
        console.warn('createLocalAudioTrack not found, using LocalAudioTrack.create');
        return await LocalAudioTrack.create();
      }
    } catch (error) {
      console.error('Failed to create audio track:', error);
      return null;
    }
  }

  private cleanupLocalTracks(): void {
    // Stop all local tracks
    this.localTracks.forEach(track => {
      track.stop();
      this.room?.localParticipant.unpublishTrack(track);
    });
    
    if (this.screenTrack) {
      this.screenTrack.stop();
      this.room?.localParticipant.unpublishTrack(this.screenTrack);
    }
    
    this.localTracks = [];
    this.screenTrack = null;
    this.localVideoEnabled$.next(false);
    this.localAudioEnabled$.next(false);
    this.isScreenSharing$.next(false);
  }

  private updateParticipantTracks(): void {
    if (!this.room) return;

    const participants: Participant[] = [];
    
    // Add local participant
    if (this.room.localParticipant) {
      participants.push(this.mapParticipant(this.room.localParticipant));
    }
    
    // Add remote participants
    this.room.participants.forEach((participant: RemoteParticipant) => {
      participants.push(this.mapParticipant(participant));
    });

    this.participants$.next(participants);
  }

  private updateActiveTracks(): void {
    if (!this.room) return;

    const trackInfos: TrackInfo[] = [];
    
    // Local tracks
    this.room.localParticipant.tracks.forEach((publication: TrackPublication) => {
      if (publication.track) {
        trackInfos.push({
          sid: publication.trackSid || '',
          type: publication.track.kind as 'audio' | 'video',
          isMuted: publication.isMuted,
          // ✅ FIXED: Use !track.isMuted instead of track.isEnabled
          isEnabled: !publication.track.isMuted,
          source: publication.track.source?.toString() || 'unknown'
        });
      }
    });

    this.activeTracks$.next(trackInfos);
  }

  // ✅ FIXED: mapParticipant method without Array.from issues
  private mapParticipant(livekitParticipant: LocalParticipant | RemoteParticipant): Participant {
    // ✅ CORRECT: Manually collect tracks instead of using Array.from
    const videoTracks: TrackPublication[] = [];
    const audioTracks: TrackPublication[] = [];
    
    // Collect video tracks
    livekitParticipant.videoTracks.forEach((publication: TrackPublication) => {
      videoTracks.push(publication);
    });
    
    // Collect audio tracks
    livekitParticipant.audioTracks.forEach((publication: TrackPublication) => {
      audioTracks.push(publication);
    });
    
    const isLocal = livekitParticipant instanceof LocalParticipant;
    
    // Find camera track
    const cameraPublication = videoTracks.find(p => 
      p.isSubscribed && p.track?.source === Track.Source.Camera
    );
    
    // ✅ CORRECT: Use Track.Source.ScreenShare enum
    const screenPublication = videoTracks.find(p => 
      p.isSubscribed && p.track?.source === Track.Source.ScreenShare
    );
    
    return {
      identity: livekitParticipant.identity,
      name: livekitParticipant.name || livekitParticipant.identity,
      isSpeaking: livekitParticipant.isSpeaking,
      isCameraEnabled: !!cameraPublication,
      isMicrophoneEnabled: audioTracks.some(p => p.isSubscribed),
      isScreenSharing: !!screenPublication,
      isLocal: isLocal,
      elementId: `participant-${livekitParticipant.identity}`,
      videoTrack: cameraPublication?.track,
      audioTrack: audioTracks.find(p => p.isSubscribed)?.track
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

  // ==================== CONTROL METHODS (v1.13.0 CORRECTED) ====================

  async toggleVideo(): Promise<void> {
    if (!this.room) return;

    try {
      if (this.localVideoEnabled$.value) {
        // Find and unpublish video track
        const videoTrack = this.localTracks.find(t => t.kind === Track.Kind.Video) as LocalVideoTrack;
        if (videoTrack) {
          await this.room.localParticipant.unpublishTrack(videoTrack);
          videoTrack.stop();
          this.localTracks = this.localTracks.filter(t => t !== videoTrack);
        }
        this.localVideoEnabled$.next(false);
      } else {
        // ✅ CORRECT: Create and publish new video track
        const videoTrack = await this.createLocalVideoTrack({
          resolution: VideoPresets.h720.resolution
        });
        
        if (videoTrack) {
          await this.room.localParticipant.publishTrack(videoTrack);
          this.localTracks.push(videoTrack);
          this.localVideoEnabled$.next(true);
        }
      }
    } catch (error) {
      console.error('Failed to toggle video:', error);
      throw error;
    }
  }

  async toggleAudio(): Promise<void> {
    if (!this.room) return;

    try {
      if (this.localAudioEnabled$.value) {
        // Find and unpublish audio track
        const audioTrack = this.localTracks.find(t => t.kind === Track.Kind.Audio) as LocalAudioTrack;
        if (audioTrack) {
          await this.room.localParticipant.unpublishTrack(audioTrack);
          audioTrack.stop();
          this.localTracks = this.localTracks.filter(t => t !== audioTrack);
        }
        this.localAudioEnabled$.next(false);
      } else {
        // ✅ CORRECT: Create and publish new audio track
        const audioTrack = await this.createLocalAudioTrack();
        if (audioTrack) {
          await this.room.localParticipant.publishTrack(audioTrack);
          this.localTracks.push(audioTrack);
          this.localAudioEnabled$.next(true);
        }
      }
    } catch (error) {
      console.error('Failed to toggle audio:', error);
      throw error;
    }
  }

  async startScreenShare(): Promise<void> {
    if (!this.room) return;

    try {
      // Stop current screen share if exists
      if (this.screenTrack) {
        await this.stopScreenShare();
      }

      // ✅ CORRECT: v1.13.0 screen sharing
      const displayMediaOptions: any = {
        video: {
          displaySurface: 'monitor',
          logicalSurface: true,
          cursor: 'always',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false // ✅ CORRECT: No audio for screen share (prevents echo)
      };

      // Get screen capture stream
      const screenStream = await (navigator.mediaDevices as any).getDisplayMedia(displayMediaOptions);
      
      // Create video track from stream
      const screenVideoTrack = screenStream.getVideoTracks()[0];
      if (!screenVideoTrack) {
        throw new Error('No video track found in screen share');
      }
      
      // ✅ FIXED: v1.13.0 compatible screen track creation
      // LiveKit v1.13.0 doesn't support createLocalVideoTrack with mediaStreamTrack
      // Use the constructor directly
      this.screenTrack = new LocalVideoTrack(screenVideoTrack, {
        name: 'screen-share',
        source: Track.Source.ScreenShare
      });

      // Publish screen track
      await this.room.localParticipant.publishTrack(this.screenTrack, {
        source: Track.Source.ScreenShare
      });
      
      this.isScreenSharing$.next(true);
      
      // Handle when user stops screen sharing via browser UI
      screenVideoTrack.onended = () => {
        this.stopScreenShare();
      };
      
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
    // Clear existing interval
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

      // ✅ CORRECT: Handle optional getStats() safely
      try {
        if (typeof (this.room as any).getStats === 'function') {
          const roomStats = await (this.room as any).getStats();
          if (roomStats) {
            // Process stats if available (implementation specific to v1.13.0)
            // This is optional - not all deployments have stats enabled
          }
        }
      } catch (error) {
        console.debug('Could not fetch detailed stats:', error);
        // Not a critical error - continue without detailed stats
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
    // Clear intervals
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    
    // Cleanup local tracks
    this.cleanupLocalTracks();
    
    // Reset room
    this.room = null;
    this.callStartTime = null;
    this.reconnectAttempts = 0;
    
    // Reset observables
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