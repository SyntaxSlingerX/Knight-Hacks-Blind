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
  hazardLevel?: 'high' | 'medium' | 'low' | 'none';
}

export interface RememberedObject {
  label: string;
  position: string;
  distance: string;
  landmarkContext: string;
  headingDeg?: number | null;
  /** Set when the glasses' SLAM was tracking at the time. */
  observedFrom?: ObservedFrom | null;
  timestamp: number;
}

export interface MemoryFrameSnapshot {
  image: string;
  timestamp: number;
  headingDeg?: number | null;
  observedFrom?: ObservedFrom | null;
}

export interface NavigationAnalysis {
  urgency: UrgencyLevel;
  immediateAlert?: string;
  spokenGuidance: string;
  spatialDirection: SpatialDirection;
  confidenceScore?: number;
  detectedObjects: DetectedObject[];
  soundCue?: SoundCueType;
  uncertaintyWarning?: string;
  /** Spoken request to move the camera when the view is too limited to judge the path. Empty when the view is fine. */
  viewRequest?: string;
  /** Progress toward the place the user asked to be guided to. "none" when there is no destination. */
  goalStatus?: 'none' | 'not_visible' | 'in_view' | 'arrived';
  sceneSummary: string;
  timestamp: number;
}

/** The part of a hazard scan that is spoken. It arrives before the rest of the result. */
export type EarlyNavigationAnalysis = Pick<
  NavigationAnalysis,
  'urgency' | 'spokenGuidance' | 'viewRequest' | 'goalStatus'
>;

export interface VoiceQueryResponse {
  spokenAnswer: string;
  followUpDirection?: string;
  isObjectFound: boolean;
  isFromMemory?: boolean;
  safetyNote?: string;
  /** The place or object the user asked to be guided to. Empty when they did not ask for guidance. */
  navigationGoal?: string;
  /** True when the user asked to stop being guided to the destination. */
  cancelNavigation?: boolean;
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
  /** True only while fresh camera frames are arriving from the glasses bridge. */
  connected: boolean;
  deviceModel: string;
  /** Camera frames shown per second. */
  fps: number;
  /** Time a frame spends inside the bridge before it is sent, in milliseconds. */
  latencyMs: number;
  batteryLevel?: number;
}

/** Sent by aria_bridge.py once a second (and on every change of state). */
export interface AriaBridgeStatus {
  type: 'status';
  source: 'aria' | 'webcam' | 'test';
  interface: 'usb' | 'wifi' | null;
  profile: string | null;
  state: 'starting' | 'connecting' | 'streaming' | 'stalled' | 'reconnecting' | 'error';
  detail: string;
  /** Frames per second arriving from the camera. */
  rxFps: number;
  /** Frames per second sent to this browser. */
  txFps: number;
  frameAgeMs: number;
  width: number;
  height: number;
  restarts: number;
  battery: number | null;
  thermal: boolean | null;
  skinTempC: number | null;
  slam: 'off' | 'starting' | 'tracking' | 'lost' | 'stopped';
}

/**
 * Live head pose from the glasses' SLAM cameras, sent by aria_bridge.py --slam.
 * The map is level with gravity. Its origin and "north" are where the wearer stood and
 * faced when tracking started, so it is only meaningful within one sessionId.
 */
export interface AriaPose {
  type: 'pose';
  sessionId: string;
  /** Metres to the right of the starting point. */
  x: number;
  /** Metres ahead of the starting point. */
  y: number;
  /** Metres above the starting point. */
  z: number;
  /** Heading in degrees, clockwise from the starting direction, 0 to 360. */
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  /** 'tracking': position and heading are live. 'lost': heading only, position is on hold. */
  status: 'starting' | 'tracking' | 'lost';
  /** Landmarks currently tracked. */
  tracked: number;
}

/** Where the wearer stood (and in which SLAM session) when something was seen. */
export interface ObservedFrom {
  sessionId: string;
  x: number;
  y: number;
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
