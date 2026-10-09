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
  safetyNote?: string;
}

export type CameraSourceType = 'webcam' | 'aria_stream' | 'simulation';

export interface AriaConnectionConfig {
  streamUrl: string; // e.g. ws://192.168.1.100:7000 or http://192.168.1.100:8080/stream
  connected: boolean;
  deviceModel: string;
  fps: number;
  latencyMs: number;
  batteryLevel?: number;
}

export type ThemeMode = 'standard-dark' | 'ultra-contrast-yellow' | 'high-contrast-cyan';
export type TextSize = 'normal' | 'large' | 'xlarge';

export interface UserVoiceSettings {
  rate: number; // 0.8 to 2.0
  pitch: number; // 0.8 to 1.3
  volume: number; // 0 to 1
  voiceURI?: string;
  soundEffectsEnabled: boolean;
}
