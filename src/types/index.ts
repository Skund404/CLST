/**
 * CLST Type Definitions
 * Complete TypeScript interfaces matching the CLST specification
 * 
 * References:
 * - Section 4: PRE-SESSION CHECK-IN
 * - Section 5: METRICS & SCORING MODEL
 * - Section 6: CONFIGURATION & SENSITIVITY
 * - Section 7: DATA MODEL & LOGGING
 * - Section 10: MATHEMATICAL SPECIFICATION
 */

// =============================================================================
// CONFIGURATION TYPES (Section 6)
// =============================================================================

export interface SessionConfig {
  mouseDPI: number;
  applicationSens: number;
  eDPI: number;
  monitorResolution: { width: number; height: number };
  monitorRefreshRate: number;
  audioDevice: string;
  audioVolume: number;
  difficulty: 'casual' | 'standard' | 'intense' | 'custom';
  difficultyParams?: DifficultyParams;
}

export interface DifficultyParams {
  targetSpeed: number;
  audioInterval: [number, number];
  audioIntervalMin: number;
  audioIntervalMax: number;
  peripheralDuration: number;
  cooldownInterval: number;
}

// =============================================================================
// PRE-SESSION CHECK-IN (Section 4)
// =============================================================================

export interface PreSessionCheckin {
  id: string;
  sleepQuality: number | null;
  currentState: number | null;
  symptomSeverity: number | null;
  symptomLabel: string | null;
  medicationStatus: 'as_usual' | 'late' | 'missed' | 'changed' | 'na' | null;
  stressLevel: number | null;
  substances: string[];
  freeNotes: string | null;
}

// =============================================================================
// RAW EVENT DATA (Section 7)
// =============================================================================

export interface RawEvent {
  sessionId: string;
  layer: number;
  eventType:
    | 'stimulus_onset'
    | 'click'
    | 'keypress'
    | 'cursor_pos'
    | 'audio_cue'
    | 'cooldown_ready'
    | 'peripheral_flash';
  timestampUs: number;
  data: {
    x?: number;
    y?: number;
    stimulusType?: 'simple' | 'target';
    button?: number;
    key?: string;
    expectedKey?: string;
    cursorX?: number;
    cursorY?: number;
    targetX?: number;
    targetY?: number;
    targetRadius?: number;
    tone?: 'high' | 'low' | 'distractor';
    direction?: 'up' | 'down' | 'left' | 'right';
    digit?: number;
    [key: string]: any;
  };
}

// =============================================================================
// COMPUTED METRICS (Section 5 / Section 10.1)
// =============================================================================

export interface LayerMetrics {
  sessionId: string;
  layer: number;

  // Layer 0: Simple RT
  meanRT?: number;
  rtVariance?: number;
  rtStd?: number;
  anticipationCount?: number;
  lapseCount?: number;

  // Layer 1+: Tracking
  meanTrackingError?: number;
  trackingErrorVariance?: number;
  meanJerk?: number;
  overshootRate?: number;

  // Layer 2+: Audio
  meanAudioRT?: number;
  audioAccuracy?: number;
  audioFalsePositives?: number;
  meanPRPDuration?: number;

  // Layer 3: Full load
  meanCooldownDelay?: number;
  cooldownMissCount?: number;
  meanPeripheralRT?: number;
  peripheralMissRate?: number;
}

// =============================================================================
// SESSION DATA (Section 7)
// =============================================================================

export interface Session {
  id: string;
  timestamp: Date;
  configSnapshot: SessionConfig;
  lpi0: number | null;
  lpi1: number | null;
  lpi2: number | null;
  lpi3: number | null;
  degradationCoeff: number | null;
  crs: number | null;
  notes: string | null;
  tags: string[];
  checkinId: string | null;
  profileId: string;
  systemStalls: number;
}

// =============================================================================
// BASELINE STATISTICS (Section 10.2)
// =============================================================================

export interface BaselineStats {
  median: number;
  madScaled: number;
  q1: number;
  q3: number;
  iqr: number;
  minVal: number;
  maxVal: number;
  windowSize: number;
}

// =============================================================================
// WEIGHT PROFILES (Section 10.8)
// =============================================================================

export interface WeightProfile {
  id: string;
  name: string;
  isCustom: boolean;
  weights: {
    alpha: number;
    L0: { rt: number; rt_variance: number };
    L1: { track_error: number; track_variance: number; jerk: number; overshoot: number };
    L2: { track_error: number; audio_rt: number; audio_accuracy: number; prp: number };
    L3: {
      track_error: number;
      audio_rt: number;
      prp: number;
      cooldown: number;
      periph_rt: number;
      periph_miss: number;
    };
  };
}

// =============================================================================
// RUNTIME STATE TYPES
// =============================================================================

export interface TestState {
  currentLayer: number;
  layerStartTime: number;
  layerDuration: number;
  isRunning: boolean;
  isPaused: boolean;
  /** Phase within a layer lifecycle */
  phase: 'countdown' | 'running' | 'inter-layer' | 'complete' | 'idle';
}

export interface StimulusState {
  simpleStimulus: {
    visible: boolean;
    x: number;
    y: number;
    onsetTime: number;
  } | null;

  target: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
  } | null;

  lastAudioCue: {
    tone: 'high' | 'low' | 'distractor';
    onsetTime: number;
  } | null;

  cooldownProgress: number;
  cooldownReady: boolean;
  cooldownReadyTime: number | null;

  peripheralFlash: {
    direction: 'up' | 'down' | 'left' | 'right';
    digit: number;
    onsetTime: number;
  } | null;
}

/**
 * Inter-layer transition screen content
 */
export interface InterLayerInfo {
  completedLayer: number;
  nextLayer: number;
  description: string;
  newElements: string[];
  controls: { key: string; action: string }[];
  cooldownSeconds: number;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

export interface DbResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AlertThresholds {
  warningThreshold: number;
  criticalThreshold: number;
  minBaselineSessions: number;
}

export interface CalibrationStatus {
  sessionsCompleted: number;
  sessionsRequired: number;
  isComplete: boolean;
  totalSessions: number;
  baselineReady: boolean;
}
