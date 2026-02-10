/**
 * Configuration Screen for CLST
 * Implements Section 6 (CONFIGURATION & SENSITIVITY)
 * First-run wizard and settings management
 */

import { db } from '@/lib/database';
import type { SessionConfig } from '@/types';

export interface ConfigurationOptions {
  isFirstRun?: boolean;
  existingConfig?: SessionConfig | null;
  onComplete?: (config: SessionConfig) => void;
  onCancel?: () => void;
}

export class ConfigurationScreen {
  private container: HTMLElement;
  private options: ConfigurationOptions;
  private config: Partial<SessionConfig> = {};
  private audioDevices: MediaDeviceInfo[] = [];

  // Default values
  private readonly DEFAULT_MOUSE_DPI = 800;
  private readonly DEFAULT_APP_SENS = 1.0;
  private readonly DEFAULT_VOLUME = 0.5;
  private readonly DEFAULT_DIFFICULTY = 'standard';

  // Alert thresholds
  private warningThreshold: number = 1.5;
  private criticalThreshold: number = 2.0;
  private minBaselineSessions: number = 10;

  constructor(container: HTMLElement, options: ConfigurationOptions = {}) {
    this.container = container;
    this.options = options;

    // Initialize from existing config
    if (options.existingConfig) {
      this.config = { ...options.existingConfig };
    } else {
      this.initializeDefaults();
    }
  }

  /**
   * Initialize default configuration
   */
  private initializeDefaults(): void {
    this.config = {
      mouseDPI: this.DEFAULT_MOUSE_DPI,
      applicationSens: this.DEFAULT_APP_SENS,
      eDPI: this.DEFAULT_MOUSE_DPI * this.DEFAULT_APP_SENS,
      monitorResolution: {
        width: window.screen.width,
        height: window.screen.height
      },
      monitorRefreshRate: this.detectRefreshRate(),
      audioDevice: 'default',
      audioVolume: this.DEFAULT_VOLUME,
      difficulty: this.DEFAULT_DIFFICULTY as 'casual' | 'standard' | 'intense' | 'custom'
    };
  }

  /**
   * Detect monitor refresh rate
   */
  private detectRefreshRate(): number {
    // Attempt to detect, default to 60Hz if unknown
    // Note: Real detection would use requestAnimationFrame timing
    return 60;
  }

  /**
   * Render the configuration screen
   */
  async render(): Promise<void> {
    // Enumerate audio devices
    await this.enumerateAudioDevices();

    this.container.innerHTML = `
      <div class="config-screen">
        <div class="config-header">
          <h1>${this.options.isFirstRun ? 'Welcome to CLST' : 'Configuration'}</h1>
          <p class="config-subtitle">
            ${this.options.isFirstRun 
              ? 'Let\'s set up your hardware and test preferences' 
              : 'Adjust your settings and preferences'}
          </p>
        </div>

        <form id="config-form" class="config-form">
          <!-- Section 1: Input Settings -->
          <div class="config-section">
            <h2>1. Input Settings</h2>
            
            <div class="config-subsection">
              <h3>Mouse Configuration</h3>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="mouse-dpi">
                    Mouse DPI
                    <span class="help-text">Check your mouse software/settings</span>
                  </label>
                  <input 
                    type="number" 
                    id="mouse-dpi" 
                    value="${this.config.mouseDPI}" 
                    min="100" 
                    max="30000" 
                    step="50"
                    required
                  >
                </div>

                <div class="form-group">
                  <label for="app-sens">
                    Application Sensitivity
                    <span class="help-text">In-game or OS sensitivity multiplier</span>
                  </label>
                  <input 
                    type="number" 
                    id="app-sens" 
                    value="${this.config.applicationSens}" 
                    min="0.1" 
                    max="10.0" 
                    step="0.1"
                    required
                  >
                </div>

                <div class="form-group">
                  <label>
                    Effective DPI (eDPI)
                    <span class="help-text">Automatically calculated</span>
                  </label>
                  <div class="calculated-value" id="edpi-display">
                    ${this.config.eDPI?.toFixed(0) || 800}
                  </div>
                </div>
              </div>
            </div>

            <div class="config-subsection">
              <h3>Display Configuration</h3>
              
              <div class="form-row">
                <div class="form-group">
                  <label>
                    Monitor Resolution
                    <span class="help-text">Auto-detected</span>
                  </label>
                  <div class="calculated-value">
                    ${this.config.monitorResolution?.width} × ${this.config.monitorResolution?.height}
                  </div>
                </div>

                <div class="form-group">
                  <label for="refresh-rate">
                    Monitor Refresh Rate
                    <span class="help-text">Select your monitor's refresh rate</span>
                  </label>
                  <select id="refresh-rate">
                    <option value="60" ${this.config.monitorRefreshRate === 60 ? 'selected' : ''}>60 Hz</option>
                    <option value="75" ${this.config.monitorRefreshRate === 75 ? 'selected' : ''}>75 Hz</option>
                    <option value="90" ${this.config.monitorRefreshRate === 90 ? 'selected' : ''}>90 Hz</option>
                    <option value="120" ${this.config.monitorRefreshRate === 120 ? 'selected' : ''}>120 Hz</option>
                    <option value="144" ${this.config.monitorRefreshRate === 144 ? 'selected' : ''}>144 Hz</option>
                    <option value="165" ${this.config.monitorRefreshRate === 165 ? 'selected' : ''}>165 Hz</option>
                    <option value="240" ${this.config.monitorRefreshRate === 240 ? 'selected' : ''}>240 Hz</option>
                    <option value="360" ${this.config.monitorRefreshRate === 360 ? 'selected' : ''}>360 Hz</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="config-subsection">
              <h3>Audio Configuration</h3>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="audio-device">
                    Audio Output Device
                  </label>
                  <select id="audio-device">
                    ${this.renderAudioDeviceOptions()}
                  </select>
                </div>

                <div class="form-group">
                  <label for="audio-volume">
                    Audio Volume
                    <span id="volume-display">${Math.round((this.config.audioVolume || 0.5) * 100)}%</span>
                  </label>
                  <input 
                    type="range" 
                    id="audio-volume" 
                    min="0" 
                    max="100" 
                    step="5"
                    value="${Math.round((this.config.audioVolume || 0.5) * 100)}"
                  >
                </div>
              </div>
            </div>
          </div>

          <!-- Section 2: Test Difficulty -->
          <div class="config-section">
            <h2>2. Test Difficulty</h2>
            
            <div class="difficulty-options">
              <label class="difficulty-option">
                <input 
                  type="radio" 
                  name="difficulty" 
                  value="casual"
                  ${this.config.difficulty === 'casual' ? 'checked' : ''}
                >
                <div class="difficulty-card">
                  <h4>Casual</h4>
                  <p>Slower targets, longer response windows</p>
                  <ul>
                    <li>Target: 150 px/s</li>
                    <li>Audio: 2-4s intervals</li>
                    <li>Peripheral: 1500ms</li>
                  </ul>
                </div>
              </label>

              <label class="difficulty-option">
                <input 
                  type="radio" 
                  name="difficulty" 
                  value="standard"
                  ${this.config.difficulty === 'standard' ? 'checked' : ''}
                >
                <div class="difficulty-card">
                  <h4>Standard</h4>
                  <p>Balanced difficulty for most users</p>
                  <ul>
                    <li>Target: 200 px/s</li>
                    <li>Audio: 1.5-3.5s intervals</li>
                    <li>Peripheral: 1200ms</li>
                  </ul>
                </div>
              </label>

              <label class="difficulty-option">
                <input 
                  type="radio" 
                  name="difficulty" 
                  value="intense"
                  ${this.config.difficulty === 'intense' ? 'checked' : ''}
                >
                <div class="difficulty-card">
                  <h4>Intense</h4>
                  <p>Challenging for experienced users</p>
                  <ul>
                    <li>Target: 280 px/s</li>
                    <li>Audio: 1.5-2.5s intervals</li>
                    <li>Peripheral: 800ms</li>
                  </ul>
                </div>
              </label>

              <label class="difficulty-option">
                <input 
                  type="radio" 
                  name="difficulty" 
                  value="custom"
                  ${this.config.difficulty === 'custom' ? 'checked' : ''}
                >
                <div class="difficulty-card">
                  <h4>Custom</h4>
                  <p>Adjust individual parameters</p>
                </div>
              </label>
            </div>

            <div id="custom-difficulty" class="custom-difficulty" style="${this.config.difficulty === 'custom' ? '' : 'display: none;'}">
              <h3>Custom Parameters</h3>
              
              <div class="form-group">
                <label for="target-speed">
                  Target Speed (pixels/second)
                  <span id="target-speed-value">200</span>
                </label>
                <input 
                  type="range" 
                  id="target-speed" 
                  min="100" 
                  max="400" 
                  step="10"
                  value="${this.config.difficultyParams?.targetSpeed || 200}"
                >
              </div>

              <div class="form-group">
                <label for="audio-min">
                  Audio Interval Min (ms)
                  <span id="audio-min-value">1500</span>
                </label>
                <input 
                  type="range" 
                  id="audio-min" 
                  min="800" 
                  max="3000" 
                  step="100"
                  value="${this.config.difficultyParams?.audioIntervalMin || 1500}"
                >
              </div>

              <div class="form-group">
                <label for="audio-max">
                  Audio Interval Max (ms)
                  <span id="audio-max-value">3500</span>
                </label>
                <input 
                  type="range" 
                  id="audio-max" 
                  min="1500" 
                  max="5000" 
                  step="100"
                  value="${this.config.difficultyParams?.audioIntervalMax || 3500}"
                >
              </div>

              <div class="form-group">
                <label for="peripheral-duration">
                  Peripheral Display Duration (ms)
                  <span id="peripheral-duration-value">1200</span>
                </label>
                <input 
                  type="range" 
                  id="peripheral-duration" 
                  min="500" 
                  max="2000" 
                  step="50"
                  value="${this.config.difficultyParams?.peripheralDuration || 1200}"
                >
              </div>

              <div class="form-group">
                <label for="cooldown-interval">
                  Cooldown Interval (ms)
                  <span id="cooldown-interval-value">8000</span>
                </label>
                <input 
                  type="range" 
                  id="cooldown-interval" 
                  min="4000" 
                  max="12000" 
                  step="500"
                  value="${this.config.difficultyParams?.cooldownInterval || 8000}"
                >
              </div>
            </div>
          </div>

          <!-- Section 3: Alert Thresholds -->
          <div class="config-section">
            <h2>3. Alert Thresholds</h2>
            
            <div class="form-group">
              <label for="warning-threshold">
                CRS Warning Threshold (Standard Deviations Below Mean)
                <span class="help-text">Yellow alert when CRS drops below this threshold</span>
              </label>
              <input 
                type="number" 
                id="warning-threshold" 
                value="${this.warningThreshold}" 
                min="0.5" 
                max="3.0" 
                step="0.1"
              >
            </div>

            <div class="form-group">
              <label for="critical-threshold">
                CRS Critical Threshold (Standard Deviations Below Mean)
                <span class="help-text">Red alert when CRS drops below this threshold</span>
              </label>
              <input 
                type="number" 
                id="critical-threshold" 
                value="${this.criticalThreshold}" 
                min="1.0" 
                max="4.0" 
                step="0.1"
              >
            </div>

            <div class="form-group">
              <label for="min-baseline-sessions">
                Minimum Baseline Sessions
                <span class="help-text">Number of sessions before stable baseline</span>
              </label>
              <input 
                type="number" 
                id="min-baseline-sessions" 
                value="${this.minBaselineSessions}" 
                min="5" 
                max="30" 
                step="1"
              >
            </div>
          </div>

          <!-- Section 4: Calibration Info -->
          <div class="config-section calibration-info">
            <h2>4. Calibration Information</h2>
            
            <div class="info-panel">
              <h3>📊 Calibration Phase (Sessions 1-5)</h3>
              <p>
                Your first 5 sessions help the system learn your baseline performance.
                During this period:
              </p>
              <ul>
                <li>Scores are calculated but marked as calibration</li>
                <li>No alerts are generated</li>
                <li>Data is excluded from baseline statistics</li>
              </ul>
            </div>

            <div class="info-panel">
              <h3>📈 Baseline Building (Sessions 6-${this.minBaselineSessions})</h3>
              <p>
                After calibration, the system builds your personal baseline:
              </p>
              <ul>
                <li>Each session refines your baseline metrics</li>
                <li>Pre-baseline scoring uses linear normalization</li>
                <li>Alerts activate but may not be fully accurate</li>
              </ul>
            </div>

            <div class="info-panel">
              <h3>✅ Full Features (Session ${this.minBaselineSessions + 1}+)</h3>
              <p>
                Once you reach ${this.minBaselineSessions} sessions:
              </p>
              <ul>
                <li>Rolling baseline with robust statistics (median/MAD)</li>
                <li>Accurate alert thresholds</li>
                <li>Reliable trend analysis</li>
                <li>Full dashboard analytics</li>
              </ul>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="config-actions">
            ${this.options.isFirstRun 
              ? `<button type="submit" class="btn btn-primary">Start Testing</button>`
              : `
                <button type="button" id="cancel-button" class="btn btn-secondary">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Configuration</button>
              `
            }
          </div>
        </form>
      </div>
    `;

    this.attachEventListeners();
  }

  /**
   * Enumerate audio devices
   */
  private async enumerateAudioDevices(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.audioDevices = devices.filter(d => d.kind === 'audiooutput');
    } catch (error) {
      console.error('Failed to enumerate audio devices:', error);
      this.audioDevices = [];
    }
  }

  /**
   * Render audio device options
   */
  private renderAudioDeviceOptions(): string {
    if (this.audioDevices.length === 0) {
      return '<option value="default">Default Audio Device</option>';
    }

    return this.audioDevices.map(device => `
      <option value="${device.deviceId}" ${device.deviceId === this.config.audioDevice ? 'selected' : ''}>
        ${device.label || 'Audio Device'}
      </option>
    `).join('');
  }

  /**
   * Attach event listeners
   */
  private attachEventListeners(): void {
    const form = document.getElementById('config-form') as HTMLFormElement;

    // Form submission
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit();
    });

    // Cancel button
    const cancelBtn = document.getElementById('cancel-button');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        if (this.options.onCancel) {
          this.options.onCancel();
        }
      });
    }

    // Mouse DPI / App Sens - update eDPI
    const mouseDPI = document.getElementById('mouse-dpi') as HTMLInputElement;
    const appSens = document.getElementById('app-sens') as HTMLInputElement;
    const edpiDisplay = document.getElementById('edpi-display') as HTMLElement;

    const updateEDPI = () => {
      const dpi = parseFloat(mouseDPI.value);
      const sens = parseFloat(appSens.value);
      const edpi = dpi * sens;
      edpiDisplay.textContent = edpi.toFixed(0);
    };

    mouseDPI.addEventListener('input', updateEDPI);
    appSens.addEventListener('input', updateEDPI);

    // Audio volume slider
    const volumeSlider = document.getElementById('audio-volume') as HTMLInputElement;
    const volumeDisplay = document.getElementById('volume-display') as HTMLElement;

    volumeSlider.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value);
      volumeDisplay.textContent = `${value}%`;
    });

    // Difficulty radio buttons
    const difficultyRadios = document.querySelectorAll('input[name="difficulty"]');
    const customSection = document.getElementById('custom-difficulty') as HTMLElement;

    difficultyRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        const value = (e.target as HTMLInputElement).value;
        customSection.style.display = value === 'custom' ? 'block' : 'none';
      });
    });

    // Custom difficulty sliders
    this.attachSliderListeners('target-speed', 'target-speed-value', (v) => `${v}`);
    this.attachSliderListeners('audio-min', 'audio-min-value', (v) => `${v}`);
    this.attachSliderListeners('audio-max', 'audio-max-value', (v) => `${v}`);
    this.attachSliderListeners('peripheral-duration', 'peripheral-duration-value', (v) => `${v}`);
    this.attachSliderListeners('cooldown-interval', 'cooldown-interval-value', (v) => `${v}`);
  }

  /**
   * Attach slider listeners with live update
   */
  private attachSliderListeners(sliderId: string, displayId: string, formatter: (v: number) => string): void {
    const slider = document.getElementById(sliderId) as HTMLInputElement;
    const display = document.getElementById(displayId) as HTMLElement;

    if (slider && display) {
      slider.addEventListener('input', (e) => {
        const value = parseInt((e.target as HTMLInputElement).value);
        display.textContent = formatter(value);
      });
    }
  }

  /**
   * Handle form submission
   */
  private async handleSubmit(): Promise<void> {
    // Gather all form values
    const mouseDPI = parseInt((document.getElementById('mouse-dpi') as HTMLInputElement).value);
    const appSens = parseFloat((document.getElementById('app-sens') as HTMLInputElement).value);
    const refreshRate = parseInt((document.getElementById('refresh-rate') as HTMLSelectElement).value);
    const audioDevice = (document.getElementById('audio-device') as HTMLSelectElement).value;
    const audioVolume = parseInt((document.getElementById('audio-volume') as HTMLInputElement).value) / 100;
    
    const difficulty = (document.querySelector('input[name="difficulty"]:checked') as HTMLInputElement).value as 'casual' | 'standard' | 'intense' | 'custom';

    // Build config
    const config: SessionConfig = {
      mouseDPI,
      applicationSens: appSens,
      eDPI: mouseDPI * appSens,
      monitorResolution: {
        width: window.screen.width,
        height: window.screen.height
      },
      monitorRefreshRate: refreshRate,
      audioDevice,
      audioVolume,
      difficulty
    };

    // Add custom difficulty params if needed
    if (difficulty === 'custom') {
      config.difficultyParams = {
        targetSpeed: parseInt((document.getElementById('target-speed') as HTMLInputElement).value),
        audioIntervalMin: parseInt((document.getElementById('audio-min') as HTMLInputElement).value),
        audioIntervalMax: parseInt((document.getElementById('audio-max') as HTMLInputElement).value),
        peripheralDuration: parseInt((document.getElementById('peripheral-duration') as HTMLInputElement).value),
        cooldownInterval: parseInt((document.getElementById('cooldown-interval') as HTMLInputElement).value)
      };
    }

    // Save alert thresholds
    const warningThreshold = parseFloat((document.getElementById('warning-threshold') as HTMLInputElement).value);
    const criticalThreshold = parseFloat((document.getElementById('critical-threshold') as HTMLInputElement).value);
    const minBaselineSessions = parseInt((document.getElementById('min-baseline-sessions') as HTMLInputElement).value);

    await db.setConfig('alert_warning_threshold', warningThreshold.toString());
    await db.setConfig('alert_critical_threshold', criticalThreshold.toString());
    await db.setConfig('min_baseline_sessions', minBaselineSessions.toString());

    // Save session config
    await db.setConfig('session_config', JSON.stringify(config));

    // Call completion callback
    if (this.options.onComplete) {
      this.options.onComplete(config);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): SessionConfig | null {
    return this.config as SessionConfig;
  }

  /**
   * Destroy component
   */
  destroy(): void {
    this.container.innerHTML = '';
  }
}
