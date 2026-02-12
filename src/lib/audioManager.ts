/**
 * Audio Manager for CLST
 * Handles precise audio playback using Web Audio API
 */

export type ToneType = 'high' | 'low' | 'distractor';

export interface AudioConfig {
  volume?: number;
  sampleRate?: number;
}

export interface PlaybackInfo {
  scheduledTime: number;  // When tone was scheduled (AudioContext time)
  actualTime: number;     // Estimated actual output time (compensated for latency)
  type: ToneType;
}

export class AudioManager {
  private audioContext: AudioContext | null = null;
  private audioBuffers: Map<ToneType, AudioBuffer> = new Map();
  private masterGain: GainNode | null = null;
  private currentSources: Set<AudioBufferSourceNode> = new Set();
  private isInitialized: boolean = false;
  private lastPlaybackTime: number = 0;

  // Audio file paths (relative to assets)
  private readonly AUDIO_FILES: Record<ToneType, string> = {
    high: '/assets/audio/tone_high.wav',
    low: '/assets/audio/tone_low.wav',
    distractor: '/assets/audio/tone_distractor.wav'
  };

  // Tone frequencies — wide separation for easy discrimination under load
  // High: bright, high pitch. Low: deep, unmistakable. Distractor: mid-range buzz.
  private readonly TONE_FREQUENCIES: Record<ToneType, number> = {
    high: 1000,     // Hz - clearly high pitched
    low: 300,       // Hz - clearly low pitched
    distractor: 550 // Hz - mid-range, different character (uses square wave)
  };

  // Configuration
  private volume: number = 0.5;
  private readonly TONE_DURATION = 0.25; // seconds (was 0.15 — longer for better perception under load)
  private readonly MIN_TONE_SPACING = 0.05; // Prevent overlapping tones (50ms)

  /**
   * Initialize audio system
   */
  async init(config: AudioConfig = {}): Promise<void> {
    if (this.isInitialized) {
      console.warn('AudioManager already initialized');
      return;
    }

    try {
      // Create AudioContext
      this.audioContext = new AudioContext({
        sampleRate: config.sampleRate || 48000
      });

      // Resume context if suspended (browser autoplay policy)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Create master gain node
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
      this.masterGain.gain.value = config.volume ?? this.volume;
      this.volume = this.masterGain.gain.value;

      // Pre-synthesize all tone buffers during init (no file loading needed)
      // This is more reliable than loading files (no codec/path issues)
      // and has lower latency (buffers ready immediately)
      this.preSynthesizeBuffers();

      this.isInitialized = true;
      console.log('AudioManager initialized with synthesized tones');
    } catch (error) {
      console.error('Failed to initialize AudioManager:', error);
      throw error;
    }
  }

  /**
   * Pre-synthesize all tone buffers so they're ready for instant playback
   * Each tone uses a different waveform for easier discrimination:
   * - High: sine wave (clean, bright)
   * - Low: sine wave (clean, deep)
   * - Distractor: square wave (buzzy, harsh — easy to recognize as "ignore this")
   */
  private preSynthesizeBuffers(): void {
    if (!this.audioContext) return;

    for (const [type, frequency] of Object.entries(this.TONE_FREQUENCIES)) {
      const sampleRate = this.audioContext.sampleRate;
      const numSamples = Math.floor(this.TONE_DURATION * sampleRate);
      const buffer = this.audioContext.createBuffer(1, numSamples, sampleRate);
      const data = buffer.getChannelData(0);

      const fadeInDuration = 0.005;
      const fadeOutDuration = 0.015;
      const isDistractor = type === 'distractor';

      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;

        // Waveform: sine for signals, square for distractor
        let value: number;
        if (isDistractor) {
          // Square wave — harsh buzz, instantly recognizable as different
          value = Math.sin(2 * Math.PI * frequency * t) >= 0 ? 1.0 : -1.0;
          value *= 0.6; // Reduce amplitude since square wave is perceptually louder
        } else {
          value = Math.sin(2 * Math.PI * frequency * t);
        }

        let envelope = 1.0;
        if (t < fadeInDuration) {
          envelope = t / fadeInDuration;
        } else if (t > this.TONE_DURATION - fadeOutDuration) {
          envelope = (this.TONE_DURATION - t) / fadeOutDuration;
        }

        data[i] = value * envelope * 0.3;
      }

      this.audioBuffers.set(type as ToneType, buffer);
    }
  }

  /**
   * Play a tone
   */
  play(type: ToneType): PlaybackInfo {
    if (!this.isInitialized || !this.audioContext || !this.masterGain) {
      throw new Error('AudioManager not initialized. Call init() first.');
    }

    // Resume context if suspended (can happen on first user interaction)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    // Calculate timing with spacing enforcement
    const now = this.audioContext.currentTime;
    const scheduledTime = Math.max(now, this.lastPlaybackTime + this.MIN_TONE_SPACING);
    
    // Create source and connect to master gain
    const source = this.createToneSource(type);
    source.connect(this.masterGain);

    // Schedule playback
    source.start(scheduledTime);
    source.stop(scheduledTime + this.TONE_DURATION);

    // Track active source
    this.currentSources.add(source);
    source.onended = () => {
      this.currentSources.delete(source);
    };

    // Update last playback time
    this.lastPlaybackTime = scheduledTime;

    // Calculate actual output time with latency compensation
    const latency = this.getLatency();
    const actualTime = scheduledTime + latency;

    return {
      scheduledTime,
      actualTime,
      type
    };
  }

  /**
   * Create tone source (from buffer or synthesized)
   */
  private createToneSource(type: ToneType): AudioBufferSourceNode {
    if (!this.audioContext) {
      throw new Error('AudioContext not initialized');
    }

    const buffer = this.audioBuffers.get(type);

    if (buffer) {
      // Use loaded audio buffer
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      return source;
    } else {
      // Synthesize tone as fallback
      return this.synthesizeTone(type);
    }
  }

  /**
   * Synthesize a tone using oscillator
   */
  private synthesizeTone(type: ToneType): AudioBufferSourceNode {
    if (!this.audioContext) {
      throw new Error('AudioContext not initialized');
    }

    const frequency = this.TONE_FREQUENCIES[type];
    const sampleRate = this.audioContext.sampleRate;
    const numSamples = Math.floor(this.TONE_DURATION * sampleRate);
    const isDistractor = type === 'distractor';

    // Create audio buffer
    const buffer = this.audioContext.createBuffer(1, numSamples, sampleRate);
    const data = buffer.getChannelData(0);

    // Generate waveform with envelope
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;

      let value: number;
      if (isDistractor) {
        value = Math.sin(2 * Math.PI * frequency * t) >= 0 ? 0.6 : -0.6;
      } else {
        value = Math.sin(2 * Math.PI * frequency * t);
      }

      // Apply envelope (fade in/out to prevent clicks)
      const fadeInDuration = 0.005; // 5ms
      const fadeOutDuration = 0.015; // 15ms
      let envelope = 1.0;

      if (t < fadeInDuration) {
        envelope = t / fadeInDuration;
      } else if (t > this.TONE_DURATION - fadeOutDuration) {
        envelope = (this.TONE_DURATION - t) / fadeOutDuration;
      }

      data[i] = value * envelope * 0.3; // Scale to prevent clipping
    }

    // Create buffer source
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    return source;
  }

  /**
   * Set master volume
   */
  setVolume(volume: number): void {
    // Clamp to valid range
    const clampedVolume = Math.max(0, Math.min(1, volume));

    if (this.masterGain) {
      // Use exponential ramp for smooth volume changes
      const now = this.audioContext!.currentTime;
      this.masterGain.gain.setTargetAtTime(clampedVolume, now, 0.01);
      this.volume = clampedVolume;
    } else {
      this.volume = clampedVolume;
    }
  }

  /**
   * Get current volume
   */
  getVolume(): number {
    return this.volume;
  }

  /**
   * Get audio output latency
   * Returns estimated latency in seconds
   */
  getLatency(): number {
    if (!this.audioContext) {
      return 0;
    }

    // BaseLatency: Inherent delay from audio graph to output
    // OutputLatency: Additional delay from hardware/driver
    const baseLatency = this.audioContext.baseLatency || 0;
    const outputLatency = this.audioContext.outputLatency || 0;

    return baseLatency + outputLatency;
  }

  /**
   * Get latency in milliseconds
   */
  getLatencyMs(): number {
    return this.getLatency() * 1000;
  }

  /**
   * Stop all currently playing tones
   */
  stopAll(): void {
    this.currentSources.forEach(source => {
      try {
        source.stop();
      } catch (error) {
        // Source might already be stopped
      }
    });
    this.currentSources.clear();
  }

  /**
   * Check if a tone is currently playing
   */
  isPlaying(): boolean {
    return this.currentSources.size > 0;
  }

  /**
   * Get AudioContext state
   */
  getState(): AudioContextState | null {
    return this.audioContext?.state || null;
  }

  /**
   * Get sample rate
   */
  getSampleRate(): number {
    return this.audioContext?.sampleRate || 0;
  }

  /**
   * Resume AudioContext (for handling autoplay policy)
   */
  async resume(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * Destroy audio manager and clean up resources
   */
  async destroy(): Promise<void> {
    // Stop all active tones
    this.stopAll();

    // Disconnect master gain
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }

    // Close audio context
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    // Clear buffers
    this.audioBuffers.clear();

    this.isInitialized = false;
  }
}

// Export singleton instance
let audioManagerInstance: AudioManager | null = null;

export function getAudioManager(): AudioManager {
  if (!audioManagerInstance) {
    audioManagerInstance = new AudioManager();
  }
  return audioManagerInstance;
}

export function destroyAudioManager(): void {
  if (audioManagerInstance) {
    audioManagerInstance.destroy();
    audioManagerInstance = null;
  }
}
