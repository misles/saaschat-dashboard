export interface CallFeatures {
  audio: boolean;
  video: boolean;
  screen_share: boolean;
  image_share: boolean;
  file_share: boolean;
  max_participants: number;
  max_call_minutes: number;
}

export interface CallFeaturesResponse {
  agent_id: string;
  plan: string;
  features: CallFeatures;
  source: string;
  synced_at: string;
  cache_status: string;
}

export interface CallFeaturesUpdateRequest {
  agent_id: string;
  features: CallFeatures;
  plan?: string;
}

export interface PermissionCheckResponse {
  agent_id: string;
  permission: string;
  allowed: boolean;
  checked_at: string;
}