import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { LivekitService } from '../../livekit.service';
import { CanMakeCallResponse } from '../../livekit.types';

@Component({
  selector: 'app-call-controls',
  templateUrl: './call-controls.component.html',
  styleUrls: ['./call-controls.component.scss']
})
export class CallControlsComponent implements OnInit, OnDestroy {
  @Input() projectId!: string;
  @Input() conversationId?: string;
  @Input() participantName = 'User';
  @Input() showAudio = true;
  @Input() showVideo = true;
  @Input() showScreenShare = true;
  
  @Output() callStarted = new EventEmitter<{
    type: 'audio' | 'video';
    token: string;
    url: string;
  }>();
  @Output() callEnded = new EventEmitter<void>();

  isLoading = false;
  errorMessage = '';
  audioEnabled = true;
  videoEnabled = true;
  settings: any = null;
  
  private subs = new Subscription();

  constructor(private livekitService: LivekitService) {}

  ngOnInit(): void {
    this.loadSettings();
  }

  async loadSettings(): Promise<void> {
    try {
      // Load call settings for this project
      const settings = await this.livekitService.getCallUsage(this.projectId);
      this.settings = settings;
      this.audioEnabled = settings?.audio_calls ?? true;
      this.videoEnabled = settings?.video_calls ?? true;
    } catch (error) {
      console.warn('Failed to load call settings:', error);
    }
  }

  async startAudioCall(): Promise<void> {
    await this.startCall('audio');
  }

  async startVideoCall(): Promise<void> {
    await this.startCall('video');
  }

  private async startCall(type: 'audio' | 'video'): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      // 1. Check if call is allowed
      const canCall = await this.livekitService.canMakeCall(this.projectId, type);
      
      if (!canCall.allowed) {
        this.errorMessage = canCall.message || 'Call not allowed';
        this.isLoading = false;
        return;
      }

      // 2. Validate media permissions
      if (type === 'video' && !(await this.checkCameraPermission())) {
        this.errorMessage = 'Camera access is required for video calls';
        this.isLoading = false;
        return;
      }

      if (!(await this.checkMicrophonePermission())) {
        this.errorMessage = 'Microphone access is required for calls';
        this.isLoading = false;
        return;
      }

      // 3. Get LiveKit token
      const tokenData = await this.livekitService.getToken(
        this.projectId,
        type,
        this.participantName,
        this.conversationId ? `conv-${this.conversationId}` : undefined
      );

      // 4. Emit event to parent to open call room
      this.callStarted.emit({
        type,
        token: tokenData.token,
        url: tokenData.url
      });

    } catch (error: any) {
      console.error('Start call failed:', error);
      this.errorMessage = error.message || 'Failed to start call. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  private async checkCameraPermission(): Promise<boolean> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasCamera = devices.some(d => d.kind === 'videoinput');
      
      if (!hasCamera) {
        this.errorMessage = 'No camera detected on this device';
        return false;
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 640 }, height: { ideal: 480 } } 
      });
      
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (error: any) {
      console.warn('Camera permission check failed:', error);
      
      if (error.name === 'NotFoundError') {
        this.errorMessage = 'No camera found on this device';
      } else if (error.name === 'NotAllowedError') {
        this.errorMessage = 'Camera access denied. Please enable camera permissions.';
      } else if (error.name === 'NotReadableError') {
        this.errorMessage = 'Camera is in use by another application';
      } else {
        this.errorMessage = 'Unable to access camera';
      }
      
      return false;
    }
  }

  private async checkMicrophonePermission(): Promise<boolean> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasMic = devices.some(d => d.kind === 'audioinput');
      
      if (!hasMic) {
        this.errorMessage = 'No microphone detected on this device';
        return false;
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true 
      });
      
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (error: any) {
      console.warn('Microphone permission check failed:', error);
      
      if (error.name === 'NotFoundError') {
        this.errorMessage = 'No microphone found on this device';
      } else if (error.name === 'NotAllowedError') {
        this.errorMessage = 'Microphone access denied. Please enable microphone permissions.';
      } else if (error.name === 'NotReadableError') {
        this.errorMessage = 'Microphone is in use by another application';
      } else {
        this.errorMessage = 'Unable to access microphone';
      }
      
      return false;
    }
  }

  toggleAudio(): void {
    this.audioEnabled = !this.audioEnabled;
  }

  toggleVideo(): void {
    this.videoEnabled = !this.videoEnabled;
  }

  getButtonClass(type: 'audio' | 'video'): string {
    const base = 'call-btn';
    const disabled = type === 'audio' ? !this.audioEnabled : !this.videoEnabled;
    return `${base} ${type} ${disabled ? 'disabled' : ''}`;
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }
}