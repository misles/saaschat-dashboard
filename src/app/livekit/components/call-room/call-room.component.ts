import { 
  Component, 
  OnInit, 
  OnDestroy, 
  ViewChild, 
  ElementRef,
  AfterViewInit,
  Inject,
  ChangeDetectorRef
} from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Subscription } from 'rxjs';
import { LivekitService } from '../../livekit.service';
import { Participant, CallStats, CallState } from '../../livekit.types';

// ✅ Import Track for source enum
import { Track } from 'livekit-client';

interface DialogData {
  token: string;
  url: string;
  type: 'audio' | 'video';
  projectId?: string;
  participantName: string;
}

@Component({
  selector: 'app-call-room',
  templateUrl: './call-room.component.html',
  styleUrls: ['./call-room.component.scss']
})
export class CallRoomComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('videoContainer') videoContainerRef!: ElementRef<HTMLDivElement>;

  token!: string;
  url!: string;
  type: 'audio' | 'video' = 'video';
  projectId?: string;
  participantName = 'User';
  
  participants: Participant[] = [];
  isConnected = false;
  isVideoEnabled = false;
  isAudioEnabled = false;
  isScreenSharing = false;
  callStats: CallStats | null = null;
  callDuration = 0;
  callState: CallState = CallState.DISCONNECTED;
  
  private subs = new Subscription();
  private videoElements = new Map<string, { 
    element: HTMLVideoElement, 
    container: HTMLDivElement,
    nameOverlay: HTMLDivElement,
    speakingIndicator: HTMLDivElement 
  }>();

  constructor(
    private livekitService: LivekitService,
    private cdr: ChangeDetectorRef,
    public dialogRef: MatDialogRef<CallRoomComponent>,
    @Inject(MAT_DIALOG_DATA) public data: DialogData
  ) {
    // Get data from dialog
    this.token = data.token;
    this.url = data.url;
    this.type = data.type || 'video';
    this.projectId = data.projectId;
    this.participantName = data.participantName || 'User';
  }

  async ngOnInit(): Promise<void> {
    // Subscribe to observables
    this.subs.add(
      this.livekitService.participants$.subscribe(participants => {
        this.participants = participants;
        this.updateVideoElements(participants);
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.livekitService.isConnected$.subscribe(connected => {
        this.isConnected = connected;
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.livekitService.callState$.subscribe(state => {
        this.callState = state;
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.livekitService.localVideoEnabled$.subscribe(enabled => {
        this.isVideoEnabled = enabled;
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.livekitService.localAudioEnabled$.subscribe(enabled => {
        this.isAudioEnabled = enabled;
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.livekitService.isScreenSharing$.subscribe(sharing => {
        this.isScreenSharing = sharing;
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.livekitService.callStats$.subscribe(stats => {
        this.callStats = stats;
        if (stats) {
          this.callDuration = stats.duration;
        }
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.livekitService.onTrackSubscribed.subscribe(({ track, participant }) => {
        this.handleTrackSubscribed(track, participant);
      })
    );

    this.subs.add(
      this.livekitService.onTrackUnsubscribed.subscribe(({ track, participant }) => {
        this.handleTrackUnsubscribed(track, participant);
      })
    );

    // Connect to the room
    try {
      await this.livekitService.joinCall(
        this.token,
        this.url,
        {
          videoEnabled: this.type === 'video',
          audioEnabled: true,
          participantName: this.participantName
        }
      );

    } catch (error: any) {
      console.error('Failed to join call room:', error);
      
      // Show error message
      this.showErrorMessage(`Failed to join call: ${error.message || 'Unknown error'}`);
      this.leaveCall();
    }
  }

  ngAfterViewInit(): void {
    // Initial render of video elements
    this.updateVideoElements(this.participants);
  }

  ngOnDestroy(): void {
    this.leaveCall();
    this.cleanup();
    this.subs.unsubscribe();
  }

  private handleTrackSubscribed(track: any, participant: any): void {
    // Skip for audio-only calls or non-video tracks
    if (this.type === 'audio') return;
    if (track.kind !== 'video') return;
    
    this.attachVideoTrack(track, participant);
  }

  private handleTrackUnsubscribed(track: any, participant: any): void {
    if (track.kind === 'video') {
      this.detachVideoTrack(participant.identity);
    }
  }

  private attachVideoTrack(track: any, participant: any): void {
    const elementId = `video-${participant.identity}`;
    const containerId = `container-${participant.identity}`;
    
    // Check if element already exists
    if (this.videoElements.has(participant.identity)) {
      return;
    }
    
    // Create video element
    const video = document.createElement('video');
    video.id = elementId;
    video.autoplay = true;
    video.playsInline = true;
    
    // Check if this is local participant
    const localParticipant = this.livekitService.getLocalParticipant();
    const isLocal = localParticipant && participant.identity === localParticipant.identity;
    video.muted = isLocal;
    
    // Add CSS classes
    video.className = 'participant-video';
    if (isLocal) {
      video.classList.add('mirror'); // Only mirror local video
    }
    
    // ✅ CORRECT: Use Track.Source.ScreenShare enum instead of string
    const isScreenShare = track.source === Track.Source.ScreenShare;
    if (isScreenShare) {
      video.classList.add('screen-share');
    }
    
    // Set video source
    if (track.mediaStream) {
      video.srcObject = track.mediaStream;
    } else if (track.mediaStreamTrack) {
      const stream = new MediaStream([track.mediaStreamTrack]);
      video.srcObject = stream;
    } else if (track instanceof MediaStreamTrack) {
      const stream = new MediaStream([track]);
      video.srcObject = stream;
    }
    
    // Create container
    const container = document.createElement('div');
    container.className = 'video-participant-container';
    if (isScreenShare) {
      container.classList.add('screen-share');
    }
    container.id = containerId;
    
    // Add name overlay
    const nameOverlay = document.createElement('div');
    nameOverlay.className = 'participant-name';
    nameOverlay.textContent = participant.name || participant.identity;
    
    // Add speaking indicator
    const speakingIndicator = document.createElement('div');
    speakingIndicator.className = 'speaking-indicator';
    
    container.appendChild(video);
    container.appendChild(nameOverlay);
    container.appendChild(speakingIndicator);
    
    // Add to video container
    if (this.videoContainerRef?.nativeElement) {
      this.videoContainerRef.nativeElement.appendChild(container);
    }
    
    this.videoElements.set(participant.identity, { 
      element: video, 
      container,
      nameOverlay,
      speakingIndicator 
    });
  }

  private detachVideoTrack(participantIdentity: string): void {
    const videoData = this.videoElements.get(participantIdentity);
    if (videoData) {
      // Stop tracks
      if (videoData.element.srcObject) {
        const tracks = (videoData.element.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
      
      // Remove elements
      videoData.element.remove();
      videoData.container.remove();
      
      this.videoElements.delete(participantIdentity);
    }
  }

  private updateVideoElements(participants: Participant[]): void {
    if (!this.videoContainerRef?.nativeElement) return;
    
    // Update speaking indicators and names
    participants.forEach(participant => {
      const videoData = this.videoElements.get(participant.identity);
      if (videoData) {
        // Update speaking indicator
        if (participant.isSpeaking) {
          videoData.speakingIndicator.classList.add('active');
          videoData.container.classList.add('speaking');
        } else {
          videoData.speakingIndicator.classList.remove('active');
          videoData.container.classList.remove('speaking');
        }
        
        // Update name if changed
        if (videoData.nameOverlay.textContent !== participant.name) {
          videoData.nameOverlay.textContent = participant.name || participant.identity;
        }
        
        // Update screen share class
        if (participant.isScreenSharing) {
          videoData.container.classList.add('screen-share');
          videoData.element.classList.add('screen-share');
        } else {
          videoData.container.classList.remove('screen-share');
          videoData.element.classList.remove('screen-share');
        }
      }
    });
    
    // Remove video elements for participants who left
    const currentParticipantIds = new Set(participants.map(p => p.identity));
    this.videoElements.forEach((_, identity) => {
      if (!currentParticipantIds.has(identity)) {
        this.detachVideoTrack(identity);
      }
    });
  }

  async toggleVideo(): Promise<void> {
    try {
      await this.livekitService.toggleVideo();
    } catch (error: any) {
      console.error('Failed to toggle video:', error);
      this.showErrorMessage(`Failed to toggle video: ${error.message}`);
    }
  }

  async toggleAudio(): Promise<void> {
    try {
      await this.livekitService.toggleAudio();
    } catch (error: any) {
      console.error('Failed to toggle audio:', error);
      this.showErrorMessage(`Failed to toggle audio: ${error.message}`);
    }
  }

  async toggleScreenShare(): Promise<void> {
    try {
      if (this.isScreenSharing) {
        await this.livekitService.stopScreenShare();
      } else {
        await this.livekitService.startScreenShare();
      }
    } catch (error: any) {
      console.error('Failed to toggle screen share:', error);
      this.showErrorMessage(`Failed to toggle screen share: ${error.message}`);
    }
  }

  async leaveCall(): Promise<void> {
    // Record usage before leaving (for display only - actual billing on server)
    if (this.projectId && this.callDuration > 0) {
      try {
        await this.livekitService.recordCallUsage(
          this.projectId, 
          this.callDuration, 
          this.type
        );
      } catch (error) {
        console.warn('Failed to record call usage:', error);
      }
    }
    
    await this.livekitService.leaveCall();
    this.dialogRef.close({
      duration: this.callDuration,
      participants: this.participants.length,
      type: this.type
    });
  }

  private showErrorMessage(message: string): void {
    // In production, replace with toast service
    console.error('Call Error:', message);
    alert(message);
  }

  private cleanup(): void {
    // Cleanup video elements
    this.videoElements.forEach((videoData, identity) => {
      if (videoData.element.srcObject) {
        const tracks = (videoData.element.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
      videoData.element.remove();
      videoData.container.remove();
    });
    
    this.videoElements.clear();
    
    if (this.videoContainerRef?.nativeElement) {
      this.videoContainerRef.nativeElement.innerHTML = '';
    }
  }

  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  getParticipantCount(): number {
    return this.participants.length;
  }

  getGridClass(): string {
    const count = this.getParticipantCount();
    if (count <= 1) return 'grid-1';
    if (count <= 2) return 'grid-2';
    if (count <= 4) return 'grid-4';
    return 'grid-many';
  }

  isConnecting(): boolean {
    return this.callState === CallState.CONNECTING || this.callState === CallState.RECONNECTING;
  }

  getConnectionStatus(): string {
    switch (this.callState) {
      case CallState.CONNECTING: return 'Connecting...';
      case CallState.RECONNECTING: return 'Reconnecting...';
      case CallState.CONNECTED: return 'Connected';
      default: return 'Disconnected';
    }
  }
}