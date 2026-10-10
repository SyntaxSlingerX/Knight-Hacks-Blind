export type UrgencyLevel = 'immediate_hazard' | 'caution' | 'clear' | 'informational';

export type SpatialDirection =
  | 'straight'
  | 'slight_left'
  | 'slight_right'
  | 'stop'
  | 'detour_left'
  | 'detour_right';

export type SoundCueType = 'hazard_alarm' | 'caution_ping' | 'clear_chime' | 'none';

export interface DetectedObject {
  label: string;
  position: string;
  distance: string;
  hazardLevel: 'high' | 'medium' | 'low' | 'none';
}

export interface RememberedObject {
  label: string;
  position: string;
  distance: string;
  landmarkContext: string;
  headingDeg?: number | null;
  timestamp: number;
}

export interface MemoryFrameSnapshot {
  image: string;
  timestamp: number;
  headingDeg?: number | null;
}

export interface NavigationAnalysis {
  urgency: UrgencyLevel;
  immediateAlert?: string;
  spokenGuidance: string;
  spatialDirection: SpatialDirection;
  confidenceScore: number;
  detectedObjects: DetectedObject[];
  soundCue: SoundCueType;
  uncertaintyWarning?: string;
  sceneSummary: string;
  timestamp: number;
}

export interface VoiceQueryResponse {
  spokenAnswer: string;
  followUpDirection?: string;
  isObjectFound: boolean;
  isFromMemory?: boolean;
  safetyNote?: string;
  observedObjects?: {
    label: string;
    position: string;
    distance: string;
    landmarkContext: string;
  }[];
}

export type CameraSourceType = 'webcam' | 'aria_stream' | 'simulation';

export interface AriaConnectionConfig {
  streamUrl: string;
  connected: boolean;
  deviceModel: string;
  fps: number;
  latencyMs: number;
  batteryLevel?: number;
}

export type ThemeMode = 'standard-dark' | 'ultra-contrast-yellow' | 'high-contrast-cyan';
export type TextSize = 'normal' | 'large' | 'xlarge';

export interface UserVoiceSettings {
  rate: number;
  pitch: number;
  volume: number;
  voiceURI?: string;
  soundEffectsEnabled: boolean;
}
