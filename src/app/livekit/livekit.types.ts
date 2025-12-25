export type CallType = 'audio' | 'video' | 'screen';

export interface CallSettings {
  enabled: boolean;
  audio_calls: boolean;
  video_calls: boolean;
  screen_sharing: boolean;
  max_participants: number;
  max_duration: number;
  monthly_limit_minutes?: number;
  used_minutes?: number;
  plan_tier?: string;
}

export interface CanMakeCallResponse {
  success: boolean;
  allowed: boolean;
  reason?: string;
  message?: string;
  limits?: {
    max_participants?: number;
    max_duration?: number;
    monthly_limit?: number;
    used_this_month?: number;
  };
  test_call?: {
    type: CallType;
    duration: number;
    simulated: boolean;
    timestamp: string;
  };
}

export interface TokenResponse {
  token: string;
  url: string;
  room: string;
  participant: {
    identity: string;
    name: string;
    metadata?: string;
  };
  expires_at?: string;
}

export interface Participant {
  identity: string;
  name: string;
  isSpeaking: boolean;
  isCameraEnabled: boolean;
  isMicrophoneEnabled: boolean;
  isScreenSharing: boolean;
  isLocal?: boolean;
  // For video rendering
  elementId?: string;
  videoTrack?: any;
  audioTrack?: any;
}

export interface CallStats {
  duration: number;
  participants: number;
  bytesSent: number;
  bytesReceived: number;
  packetLoss: number;
}

// LiveKit room states
export enum CallState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
}

// Track types
export interface TrackInfo {
  sid: string;
  type: 'audio' | 'video' | 'screen';
  isMuted: boolean;
  isEnabled: boolean;
  source: string;
}

// Usage reporting for billing (server-side validation)
export interface UsageReport {
  project_id: string;
  call_id?: string;
  room_name: string;
  type: CallType;
  duration_seconds: number;
  participant_count: number;
  start_time: string;
  end_time: string;
  metadata?: {
    user_agent?: string;
    platform?: string;
    quality_metrics?: {
      packet_loss?: number;
      jitter?: number;
      latency?: number;
    };
  };
}