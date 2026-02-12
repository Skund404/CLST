/**
 * Test Engine for CLST
 * Implements Section 3 (TEST BATTERY DESIGN) with all timing and spacing requirements
 * 
 * FIXES from code review:
 * - All static properties accessed via TestEngine.X not this.X
 * - Frame-rate independent stimulus scheduling (pre-scheduled times, not per-frame random)
 * - Frame-rate independent target direction changes (probability scaled by deltaTime)
 * - Inter-layer transition support with cooldown + ready button
 * - Peripheral flash uses digit (number key) instead of arrow keys per spec
 * - Audio response uses SPACE key per spec  
 * - .bind(this) cached once instead of per-frame
 */

import type {
  RawEvent, SessionConfig, DifficultyParams, TestState, StimulusState, InterLayerInfo
} from '@/types';

type EventCallback = (event: RawEvent) => void;
type StateUpdateCallback = (state: TestState) => void;
type StimulusUpdateCallback = (state: StimulusState) => void;
type LayerCompleteCallback = (layer: number, info: InterLayerInfo) => void;
type TestCompleteCallback = () => void;
type TestAbortCallback = () => void;

export class TestEngine {
  // Layer durations from spec (Section 3)
  private static readonly LAYER_DURATIONS: Record<number, number> = {
    0: 30000,
    1: 45000,
    2: 45000,
    3: 60000
  };

  // Timing constants from spec
  private static readonly L0_STIMULUS_INTERVAL: [number, number] = [800, 2000];
  private static readonly MIN_AUDIO_INTERVAL = 1500;    // Section 11.4
  private static readonly AUDIO_PERIPHERAL_SPACING = 800; // Section 11.5
  private static readonly COOLDOWN_AUDIO_SPACING = 500;   // Section 11.5
  private static readonly SYSTEM_STALL_MULTIPLIER = 3;
  private static readonly INTER_LAYER_COOLDOWN_SECONDS = 5;

  // Target direction change rate: ~0.5 changes per second, frame-rate independent
  private static readonly TARGET_DIRECTION_CHANGE_RATE = 0.5;

  // Configuration
  private config: SessionConfig;
  private difficulty: DifficultyParams;
  private sessionId: string;

  // State
  private currentLayer: number = -1;
  private layerStartTime: number = 0;
  private testStartTime: number = 0;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private phase: TestState['phase'] = 'idle';
  private animationFrameId: number | null = null;

  // Stimulus state
  private stimulusState: StimulusState = {
    simpleStimulus: null,
    target: null,
    lastAudioCue: null,
    cooldownProgress: 0,
    cooldownReady: false,
    cooldownReadyTime: null,
    peripheralFlash: null
  };

  // Event collection — pre-allocated (Section 11.3)
  private events: RawEvent[];
  private eventIndex: number = 0;
  private readonly MAX_EVENTS = 50000;

  // Timing trackers
  private lastFrameTime: number = 0;
  private lastAudioCueTime: number = 0;
  private lastPeripheralTime: number = 0;
  private lastCooldownReadyTime: number = 0;
  private nextSimpleStimulusTime: number = 0;
  private nextAudioCueTime: number = 0;      // Pre-scheduled (fixes frame-rate bug)
  private nextPeripheralTime: number = 0;     // Pre-scheduled (fixes frame-rate bug)
  private systemStallCount: number = 0;

  // Tracking state (Layer 1+)
  private targetPosition = { x: 0, y: 0 };
  private targetVelocity = { vx: 0, vy: 0 };
  private targetRadius = 30;
  private targetSpeed = 200;

  // Smooth steering: target angle interpolation instead of instant direction snaps
  // This prevents artificial jerk spikes from instantaneous velocity discontinuities
  private currentAngle: number = 0;        // Current movement direction (radians)
  private goalAngle: number = 0;           // Target direction to steer toward
  private isSteeringToGoal: boolean = false;
  // Turn rate in radians/sec — controls how fast the target changes direction
  // ~3 rad/s means a full 180° turn takes ~1 second, producing smooth arcs
  private static readonly TARGET_TURN_RATE = 3.0;

  // Cooldown state (Layer 3)
  private cooldownInterval = 8000;
  private cooldownStartTime = 0;

  // Bound update function (cached to avoid per-frame allocation)
  private boundUpdate: (timestamp: number) => void;

  // Callbacks
  private onEvent: EventCallback | null = null;
  private onStateUpdate: StateUpdateCallback | null = null;
  private onStimulusUpdate: StimulusUpdateCallback | null = null;
  private onLayerComplete: LayerCompleteCallback | null = null;
  private onTestComplete: TestCompleteCallback | null = null;
  private onAbort: TestAbortCallback | null = null;

  constructor(sessionId: string, config: SessionConfig) {
    this.sessionId = sessionId;
    this.config = config;
    this.difficulty = this.loadDifficultyParams(config.difficulty, config.difficultyParams);
    this.boundUpdate = this.update.bind(this);

    // Pre-allocate event array (Section 11.3)
    this.events = new Array(this.MAX_EVENTS);
    for (let i = 0; i < this.MAX_EVENTS; i++) {
      this.events[i] = {
        sessionId,
        layer: 0,
        eventType: 'cursor_pos',
        timestampUs: 0,
        data: {}
      };
    }
  }

  private loadDifficultyParams(
    preset: 'casual' | 'standard' | 'intense' | 'custom',
    custom?: DifficultyParams
  ): DifficultyParams {
    if (preset === 'custom' && custom) return custom;
    const presets: Record<string, DifficultyParams> = {
      casual: {
        targetSpeed: 150,
        audioInterval: [2000, 4000],
        peripheralDuration: 2200,
        cooldownInterval: 10000
      },
      standard: {
        targetSpeed: 200,
        audioInterval: [1500, 3500],
        peripheralDuration: 1800,
        cooldownInterval: 8000
      },
      intense: {
        targetSpeed: 280,
        audioInterval: [1500, 2500],
        peripheralDuration: 800,
        cooldownInterval: 6000
      }
    };
    return presets[preset] || presets.standard;
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  setCallbacks(callbacks: {
    onEvent?: EventCallback;
    onStateUpdate?: StateUpdateCallback;
    onStimulusUpdate?: StimulusUpdateCallback;
    onLayerComplete?: LayerCompleteCallback;
    onTestComplete?: TestCompleteCallback;
    onAbort?: TestAbortCallback;
  }): void {
    this.onEvent = callbacks.onEvent || null;
    this.onStateUpdate = callbacks.onStateUpdate || null;
    this.onStimulusUpdate = callbacks.onStimulusUpdate || null;
    this.onLayerComplete = callbacks.onLayerComplete || null;
    this.onTestComplete = callbacks.onTestComplete || null;
    this.onAbort = callbacks.onAbort || null;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.testStartTime = performance.now();
    this.eventIndex = 0;
    this.systemStallCount = 0;
    await this.startLayer(0);
  }

  /**
   * Called by the UI when user clicks "Ready" on inter-layer screen.
   * Advances to the next layer.
   */
  advanceToNextLayer(): void {
    if (this.phase !== 'inter-layer') return;
    const nextLayer = this.currentLayer + 1;
    if (nextLayer <= 3) {
      this.startLayer(nextLayer);
    }
  }

  handleClick(x: number, y: number): void {
    if (this.phase !== 'running') return;
    const currentTime = performance.now();

    // Layer 0: Response to simple stimulus via click
    if (this.currentLayer === 0 && this.stimulusState.simpleStimulus) {
      this.recordEvent({
        layer: 0,
        eventType: 'click',
        timestampUs: currentTime * 1000,
        data: { x, y }
      });
      this.hideSimpleStimulus(currentTime);
    }
  }

  handleKeyPress(key: string): void {
    if (this.phase !== 'running') return;
    const currentTime = performance.now();
    const lowerKey = key.toLowerCase();

    this.recordEvent({
      layer: this.currentLayer,
      eventType: 'keypress',
      timestampUs: currentTime * 1000,
      data: { key: lowerKey }
    });

    // Layer 2+: SPACE responds to audio cues
    // (MetricsCalculator will match SPACE presses to audio cue onsets)

    // Layer 3: F key for cooldown management
    if (this.currentLayer === 3 && lowerKey === 'f' && this.stimulusState.cooldownReady) {
      this.useCooldown(currentTime);
    }

    // Layer 3: Digit keys for peripheral response
    if (this.currentLayer === 3 && /^[0-9]$/.test(lowerKey)) {
      // MetricsCalculator will match digit to expected digit
    }

    // ESC: abort test
    if (key === 'Escape') {
      this.stop();
    }
  }

  handleCursorPosition(x: number, y: number): void {
    if (this.phase !== 'running' || this.currentLayer < 1) return;
    const currentTime = performance.now();
    this.recordEvent({
      layer: this.currentLayer,
      eventType: 'cursor_pos',
      timestampUs: currentTime * 1000,
      data: {
        cursorX: x,
        cursorY: y,
        targetX: this.targetPosition.x,
        targetY: this.targetPosition.y,
        targetRadius: this.targetRadius
      }
    });
  }

  pause(): void {
    this.isPaused = true;
    this.emitStateUpdate();
  }

  resume(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.lastFrameTime = performance.now();
    this.animationFrameId = requestAnimationFrame(this.boundUpdate);
    this.emitStateUpdate();
  }

  stop(): void {
    const wasRunning = this.isRunning;
    this.isRunning = false;
    this.isPaused = false;
    this.phase = 'idle';
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    document.exitPointerLock?.();
    this.emitStateUpdate();
    // Notify UI that test was aborted (not completed normally)
    if (wasRunning && this.onAbort) {
      this.onAbort();
    }
  }

  getEvents(): RawEvent[] {
    return this.events.slice(0, this.eventIndex);
  }

  getSystemStallCount(): number {
    return this.systemStallCount;
  }

  getState(): TestState {
    return {
      currentLayer: this.currentLayer,
      layerStartTime: this.layerStartTime,
      layerDuration: TestEngine.LAYER_DURATIONS[this.currentLayer] || 0,
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      phase: this.phase
    };
  }

  getStimulusState(): StimulusState {
    return this.stimulusState;
  }

  // =========================================================================
  // LAYER LIFECYCLE
  // =========================================================================

  private async startLayer(layer: number): Promise<void> {
    this.currentLayer = layer;
    this.layerStartTime = performance.now();
    this.lastFrameTime = this.layerStartTime;
    this.phase = 'running';

    this.resetLayerState(layer);
    this.emitStateUpdate();

    // Start animation loop
    this.animationFrameId = requestAnimationFrame(this.boundUpdate);
  }

  private resetLayerState(layer: number): void {
    // Layer 0: Simple RT
    if (layer === 0) {
      this.nextSimpleStimulusTime = this.layerStartTime + this.randomInterval(
        TestEngine.L0_STIMULUS_INTERVAL[0],
        TestEngine.L0_STIMULUS_INTERVAL[1]
      );
    }

    // Layer 1+: Tracking
    if (layer >= 1) {
      if (layer === 1) this.initializeTarget(); // Only init on first tracking layer
      this.targetSpeed = this.difficulty.targetSpeed;
    }

    // Layer 2+: Audio — pre-schedule first cue
    if (layer >= 2) {
      this.lastAudioCueTime = this.layerStartTime;
      const [minI, maxI] = this.difficulty.audioInterval;
      this.nextAudioCueTime = this.layerStartTime + this.randomInterval(
        Math.max(minI, TestEngine.MIN_AUDIO_INTERVAL), maxI
      );
    }

    // Layer 3: Full load — pre-schedule first peripheral
    if (layer === 3) {
      this.cooldownStartTime = this.layerStartTime;
      this.cooldownInterval = this.difficulty.cooldownInterval;
      this.lastPeripheralTime = this.layerStartTime;
      this.lastCooldownReadyTime = this.layerStartTime;
      this.nextPeripheralTime = this.layerStartTime + this.randomInterval(3000, 6000);
    }

    // Reset stimulus state for this layer
    this.stimulusState = {
      simpleStimulus: null,
      target: layer >= 1 ? {
        x: this.targetPosition.x,
        y: this.targetPosition.y,
        vx: this.targetVelocity.vx,
        vy: this.targetVelocity.vy,
        radius: this.targetRadius
      } : null,
      lastAudioCue: null,
      cooldownProgress: 0,
      cooldownReady: false,
      cooldownReadyTime: null,
      peripheralFlash: null
    };
    this.emitStimulusUpdate();
  }

  private initializeTarget(): void {
    const centerX = this.config.monitorResolution.width / 2;
    const centerY = this.config.monitorResolution.height / 2;
    this.targetPosition = { x: centerX, y: centerY };
    const angle = Math.random() * 2 * Math.PI;
    this.currentAngle = angle;
    this.goalAngle = angle;
    this.isSteeringToGoal = false;
    this.targetVelocity = {
      vx: Math.cos(angle) * this.targetSpeed,
      vy: Math.sin(angle) * this.targetSpeed
    };
  }

  // =========================================================================
  // MAIN UPDATE LOOP
  // =========================================================================

  private update(_timestamp: number): void {
    if (!this.isRunning || this.isPaused || this.phase !== 'running') return;

    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastFrameTime) / 1000; // seconds
    const layerElapsed = currentTime - this.layerStartTime;

    // Section 11.3: Detect system stalls
    const expectedFrameTime = 1000 / this.config.monitorRefreshRate;
    if ((currentTime - this.lastFrameTime) > expectedFrameTime * TestEngine.SYSTEM_STALL_MULTIPLIER) {
      this.systemStallCount++;
    }
    this.lastFrameTime = currentTime;

    // Check if layer completed
    const layerDuration = TestEngine.LAYER_DURATIONS[this.currentLayer];
    if (layerDuration !== undefined && layerElapsed >= layerDuration) {
      this.completeLayer();
      return;
    }

    // Layer-specific updates
    switch (this.currentLayer) {
      case 0: this.updateLayer0(currentTime); break;
      case 1: this.updateLayer1(currentTime, deltaTime); break;
      case 2: this.updateLayer2(currentTime, deltaTime); break;
      case 3: this.updateLayer3(currentTime, deltaTime); break;
    }

    this.animationFrameId = requestAnimationFrame(this.boundUpdate);
  }

  // =========================================================================
  // LAYER UPDATE LOGIC
  // =========================================================================

  private updateLayer0(currentTime: number): void {
    if (currentTime >= this.nextSimpleStimulusTime && !this.stimulusState.simpleStimulus) {
      this.showSimpleStimulus(currentTime);
    }
  }

  private updateLayer1(currentTime: number, deltaTime: number): void {
    this.updateTargetPosition(deltaTime);
  }

  private updateLayer2(currentTime: number, deltaTime: number): void {
    this.updateTargetPosition(deltaTime);

    // Audio cue at pre-scheduled time (fixes frame-rate bug)
    if (currentTime >= this.nextAudioCueTime) {
      this.playAudioCue(currentTime);
      // Schedule next
      const [minI, maxI] = this.difficulty.audioInterval;
      this.nextAudioCueTime = currentTime + this.randomInterval(
        Math.max(minI, TestEngine.MIN_AUDIO_INTERVAL), maxI
      );
    }
  }

  private updateLayer3(currentTime: number, deltaTime: number): void {
    this.updateTargetPosition(deltaTime);

    const timeSinceLastPeripheral = currentTime - this.lastPeripheralTime;
    const timeSinceLastCooldown = currentTime - this.lastCooldownReadyTime;

    // Audio cue with spacing enforcement (Section 11.5)
    if (currentTime >= this.nextAudioCueTime) {
      const canPlayAudio =
        timeSinceLastPeripheral >= TestEngine.AUDIO_PERIPHERAL_SPACING &&
        timeSinceLastCooldown >= TestEngine.COOLDOWN_AUDIO_SPACING;

      if (canPlayAudio) {
        this.playAudioCue(currentTime);
        const [minI, maxI] = this.difficulty.audioInterval;
        this.nextAudioCueTime = currentTime + this.randomInterval(
          Math.max(minI, TestEngine.MIN_AUDIO_INTERVAL), maxI
        );
      } else {
        // Defer by a small amount
        this.nextAudioCueTime = currentTime + 100;
      }
    }

    // Cooldown management
    const cooldownElapsed = currentTime - this.cooldownStartTime;
    this.stimulusState.cooldownProgress = Math.min(1, cooldownElapsed / this.cooldownInterval);

    if (cooldownElapsed >= this.cooldownInterval && !this.stimulusState.cooldownReady) {
      this.markCooldownReady(currentTime);
    }

    // Peripheral flash at pre-scheduled time with spacing enforcement
    if (currentTime >= this.nextPeripheralTime && !this.stimulusState.peripheralFlash) {
      const timeSinceAudio = currentTime - this.lastAudioCueTime;
      const canShow = timeSinceAudio >= TestEngine.AUDIO_PERIPHERAL_SPACING;

      if (canShow) {
        this.showPeripheralFlash(currentTime);
        this.nextPeripheralTime = currentTime + this.randomInterval(3000, 6000);
      } else {
        this.nextPeripheralTime = currentTime + 100;
      }
    }

    // Remove peripheral flash after duration
    if (this.stimulusState.peripheralFlash) {
      const flashElapsed = currentTime - this.stimulusState.peripheralFlash.onsetTime;
      if (flashElapsed >= this.difficulty.peripheralDuration) {
        this.stimulusState.peripheralFlash = null;
        this.emitStimulusUpdate();
      }
    }
  }

  // =========================================================================
  // TARGET MOVEMENT (frame-rate independent, smooth steering)
  // =========================================================================

  /**
   * Normalize angle to [-PI, PI] range
   */
  private normalizeAngle(a: number): number {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  private updateTargetPosition(deltaTime: number): void {
    // --- Smooth steering: interpolate current angle toward goal angle ---
    if (this.isSteeringToGoal) {
      let angleDiff = this.normalizeAngle(this.goalAngle - this.currentAngle);
      const maxTurn = TestEngine.TARGET_TURN_RATE * deltaTime;

      if (Math.abs(angleDiff) <= maxTurn) {
        // Close enough — snap to goal and stop steering
        this.currentAngle = this.goalAngle;
        this.isSteeringToGoal = false;
      } else {
        // Steer toward goal at constant angular velocity
        this.currentAngle += Math.sign(angleDiff) * maxTurn;
        this.currentAngle = this.normalizeAngle(this.currentAngle);
      }

      // Update velocity from current angle
      this.targetVelocity.vx = Math.cos(this.currentAngle) * this.targetSpeed;
      this.targetVelocity.vy = Math.sin(this.currentAngle) * this.targetSpeed;
    }

    // --- Move target ---
    this.targetPosition.x += this.targetVelocity.vx * deltaTime;
    this.targetPosition.y += this.targetVelocity.vy * deltaTime;

    // --- Bounce off edges: cancel any active steering and reflect cleanly ---
    const { width, height } = this.config.monitorResolution;
    const margin = this.targetRadius;

    if (this.targetPosition.x <= margin || this.targetPosition.x >= width - margin) {
      this.targetVelocity.vx *= -1;
      this.currentAngle = Math.atan2(this.targetVelocity.vy, this.targetVelocity.vx);
      this.isSteeringToGoal = false; // Cancel steering — let reflected direction play out
      this.targetPosition.x = Math.max(margin, Math.min(width - margin, this.targetPosition.x));
    }
    if (this.targetPosition.y <= margin || this.targetPosition.y >= height - margin) {
      this.targetVelocity.vy *= -1;
      this.currentAngle = Math.atan2(this.targetVelocity.vy, this.targetVelocity.vx);
      this.isSteeringToGoal = false;
      this.targetPosition.y = Math.max(margin, Math.min(height - margin, this.targetPosition.y));
    }

    // --- Trigger new direction changes (frame-rate independent) ---
    // When triggered, set a new goal angle — steering handles the smooth transition
    const changeProbability = 1 - Math.pow(
      1 - TestEngine.TARGET_DIRECTION_CHANGE_RATE, deltaTime
    );
    if (Math.random() < changeProbability && !this.isSteeringToGoal) {
      this.goalAngle = Math.random() * 2 * Math.PI;
      this.isSteeringToGoal = true;
    }

    // Update stimulus state
    if (this.stimulusState.target) {
      this.stimulusState.target.x = this.targetPosition.x;
      this.stimulusState.target.y = this.targetPosition.y;
      this.stimulusState.target.vx = this.targetVelocity.vx;
      this.stimulusState.target.vy = this.targetVelocity.vy;
      this.emitStimulusUpdate();
    }
  }

  // =========================================================================
  // STIMULUS EVENTS
  // =========================================================================

  private showSimpleStimulus(currentTime: number): void {
    const { width, height } = this.config.monitorResolution;
    const margin = 100;
    const x = margin + Math.random() * (width - 2 * margin);
    const y = margin + Math.random() * (height - 2 * margin);

    this.stimulusState.simpleStimulus = { visible: true, x, y, onsetTime: currentTime };

    this.recordEvent({
      layer: 0,
      eventType: 'stimulus_onset',
      timestampUs: currentTime * 1000,
      data: { x, y }
    });
    this.emitStimulusUpdate();
  }

  private hideSimpleStimulus(currentTime: number): void {
    this.stimulusState.simpleStimulus = null;
    this.nextSimpleStimulusTime = currentTime + this.randomInterval(
      TestEngine.L0_STIMULUS_INTERVAL[0],
      TestEngine.L0_STIMULUS_INTERVAL[1]
    );
    this.emitStimulusUpdate();
  }

  private playAudioCue(currentTime: number): void {
    // 70% signal, 30% distractor per spec
    const isDistractor = Math.random() < 0.3;
    const tone: 'high' | 'low' | 'distractor' = isDistractor
      ? 'distractor'
      : (Math.random() < 0.5 ? 'high' : 'low');

    this.recordEvent({
      layer: this.currentLayer,
      eventType: 'audio_cue',
      timestampUs: currentTime * 1000,
      data: { tone }
    });

    this.stimulusState.lastAudioCue = { tone, onsetTime: currentTime };
    this.lastAudioCueTime = currentTime;
    this.emitStimulusUpdate();

    // Actual audio playback is handled by the renderer/audioManager
    // The engine just records the event and emits state
  }

  private markCooldownReady(currentTime: number): void {
    this.stimulusState.cooldownReady = true;
    this.stimulusState.cooldownReadyTime = currentTime;
    this.lastCooldownReadyTime = currentTime;

    this.recordEvent({
      layer: 3,
      eventType: 'cooldown_ready',
      timestampUs: currentTime * 1000,
      data: {}
    });
    this.emitStimulusUpdate();
  }

  private useCooldown(currentTime: number): void {
    this.stimulusState.cooldownReady = false;
    this.stimulusState.cooldownProgress = 0;
    this.cooldownStartTime = currentTime;
    this.emitStimulusUpdate();
  }

  private showPeripheralFlash(currentTime: number): void {
    const directions: Array<'up' | 'down' | 'left' | 'right'> = ['up', 'down', 'left', 'right'];
    const direction = directions[Math.floor(Math.random() * directions.length)];
    const digit = Math.floor(Math.random() * 10); // 0-9

    this.stimulusState.peripheralFlash = { direction, digit, onsetTime: currentTime };
    this.lastPeripheralTime = currentTime;

    this.recordEvent({
      layer: 3,
      eventType: 'peripheral_flash',
      timestampUs: currentTime * 1000,
      data: { direction, digit }
    });
    this.emitStimulusUpdate();
  }

  // =========================================================================
  // LAYER COMPLETION & TRANSITIONS
  // =========================================================================

  private completeLayer(): void {
    // Stop animation loop
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.currentLayer < 3) {
      // Transition to inter-layer screen
      this.phase = 'inter-layer';
      this.emitStateUpdate();

      const info = this.buildInterLayerInfo(this.currentLayer, this.currentLayer + 1);
      if (this.onLayerComplete) {
        this.onLayerComplete(this.currentLayer, info);
      }
    } else {
      // Test complete
      this.phase = 'complete';
      this.isRunning = false;
      document.exitPointerLock?.();
      this.emitStateUpdate();

      if (this.onTestComplete) {
        this.onTestComplete();
      }
    }
  }

  private buildInterLayerInfo(completed: number, next: number): InterLayerInfo {
    const descriptions: Record<number, string> = {
      1: 'Track the moving target with your cursor. Keep the crosshair as close to the blue circle as possible.',
      2: 'Continue tracking. Audio tones will now play — press SPACE when you hear a HIGH or LOW tone. Ignore the distractor tone.',
      3: 'Full cognitive load. Continue tracking + audio. Watch for numbers in your peripheral vision and press the matching number key. A cooldown bar fills at the bottom — press F when it turns yellow.'
    };

    const newElements: Record<number, string[]> = {
      1: ['Moving target to track with cursor'],
      2: ['Audio tones (high/low/distractor)', 'Press SPACE for high or low tones', 'Ignore distractor tones'],
      3: ['Peripheral number flashes', 'Cooldown bar management (F key)', 'All previous tasks continue']
    };

    const controls: Record<number, { key: string; action: string }[]> = {
      1: [
        { key: 'Mouse', action: 'Track the target' }
      ],
      2: [
        { key: 'Mouse', action: 'Track the target' },
        { key: 'SPACE', action: 'Respond to high/low tones' }
      ],
      3: [
        { key: 'Mouse', action: 'Track the target' },
        { key: 'SPACE', action: 'Respond to high/low tones' },
        { key: '0-9', action: 'Match peripheral number' },
        { key: 'F', action: 'Use cooldown when ready' }
      ]
    };

    return {
      completedLayer: completed,
      nextLayer: next,
      description: descriptions[next] || '',
      newElements: newElements[next] || [],
      controls: controls[next] || [],
      cooldownSeconds: TestEngine.INTER_LAYER_COOLDOWN_SECONDS
    };
  }

  // =========================================================================
  // EVENT RECORDING (pre-allocated array)
  // =========================================================================

  private recordEvent(eventData: Omit<RawEvent, 'sessionId'>): void {
    if (this.eventIndex >= this.MAX_EVENTS) {
      console.warn('Event buffer full — some events may be lost');
      return;
    }
    const event = this.events[this.eventIndex];
    event.sessionId = this.sessionId;
    event.layer = eventData.layer;
    event.eventType = eventData.eventType;
    event.timestampUs = eventData.timestampUs;
    event.data = eventData.data;
    this.eventIndex++;

    if (this.onEvent) this.onEvent(event);
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  private emitStateUpdate(): void {
    if (this.onStateUpdate) this.onStateUpdate(this.getState());
  }

  private emitStimulusUpdate(): void {
    if (this.onStimulusUpdate) this.onStimulusUpdate(this.stimulusState);
  }

  private randomInterval(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
}
