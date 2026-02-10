/**
 * Test Renderer for CLST using PixiJS
 * Implements Section 3 visual presentation + inter-layer transitions
 *
 * FIXES from code review:
 * - Removed redundant rAF loop (PixiJS ticker handles rendering)
 * - Pointer lock uses movementX/Y accumulation (not clientX/Y which freezes)
 * - Layer instruction overlay is non-blocking (no opaque background during test)
 * - Inter-layer transition screen with cooldown + description + Ready button
 * - Audio playback delegated to AudioManager (not raw oscillator)
 */

import * as PIXI from 'pixi.js';
import type { SessionConfig, StimulusState, TestState, InterLayerInfo } from '@/types';
import { TestEngine } from './testEngine';
import { getAudioManager } from './audioManager';

export class TestRenderer {
  private app: PIXI.Application;
  private container: HTMLElement;
  private config: SessionConfig;
  private engine: TestEngine;

  // Graphics objects
  private targetGraphic: PIXI.Graphics | null = null;
  private simpleStimulusGraphic: PIXI.Graphics | null = null;
  private cooldownBarBg: PIXI.Graphics | null = null;
  private cooldownBarFill: PIXI.Graphics | null = null;
  private peripheralContainer: PIXI.Container | null = null;
  private layerInfoText: PIXI.Text | null = null;
  private progressText: PIXI.Text | null = null;

  // Cursor tracking (accumulated from movementX/Y under pointer lock)
  private cursorX: number = 0;
  private cursorY: number = 0;
  private isPointerLocked: boolean = false;

  // Visual constants
  private readonly TARGET_RADIUS = 40;
  private readonly TARGET_COLOR = 0x2196f3;
  private readonly SIMPLE_STIM_RADIUS = 30;
  private readonly SIMPLE_STIM_COLOR = 0xff5722;
  private readonly PERIPHERAL_SIZE = 50;
  private readonly PERIPHERAL_COLOR = 0xffc107;
  private readonly COOLDOWN_HEIGHT = 20;
  private readonly COOLDOWN_BG_COLOR = 0x424242;
  private readonly COOLDOWN_FILL_COLOR = 0x4caf50;
  private readonly COOLDOWN_READY_COLOR = 0xffeb3b;

  // State
  private currentLayer: number = -1;

  // Inter-layer overlay (HTML-based for button support)
  private interLayerOverlay: HTMLDivElement | null = null;

  // Bound event handlers (for cleanup)
  private boundOnMouseMove: (e: MouseEvent) => void;
  private boundOnClick: (e: MouseEvent) => void;
  private boundOnKeyDown: (e: KeyboardEvent) => void;
  private boundOnPointerLockChange: () => void;

  constructor(container: HTMLElement, config: SessionConfig, engine: TestEngine) {
    this.container = container;
    this.config = config;
    this.engine = engine;
    this.app = new PIXI.Application();

    // Bind handlers once
    this.boundOnMouseMove = this.onMouseMove.bind(this);
    this.boundOnClick = this.onClick.bind(this);
    this.boundOnKeyDown = this.onKeyDown.bind(this);
    this.boundOnPointerLockChange = this.onPointerLockChange.bind(this);
  }

  async initialize(): Promise<void> {
    try {
      await this.app.init({
        width: this.config.monitorResolution.width,
        height: this.config.monitorResolution.height,
        backgroundColor: 0x1a1a1a,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        preferWebGLVersion: 2,
      });
    } catch (e) {
      console.error('PixiJS WebGL init failed, trying without preferences:', e);
      try {
        await this.app.init({
          width: this.config.monitorResolution.width,
          height: this.config.monitorResolution.height,
          backgroundColor: 0x1a1a1a,
          antialias: false,
          resolution: 1,
        });
      } catch (e2) {
        console.error('PixiJS init completely failed:', e2);
        throw new Error('Graphics initialization failed. Your browser may not support WebGL.');
      }
    }

    this.app.canvas.style.width = '100vw';
    this.app.canvas.style.height = '100vh';
    this.app.canvas.style.display = 'block';
    this.container.appendChild(this.app.canvas);

    this.cursorX = this.config.monitorResolution.width / 2;
    this.cursorY = this.config.monitorResolution.height / 2;

    this.setupInputHandlers();

    // Create persistent progress text
    this.progressText = new PIXI.Text({
      text: '',
      style: { fontFamily: 'Arial', fontSize: 16, fill: 0x666666, align: 'right' }
    });
    this.progressText.anchor.set(1, 0);
    this.progressText.x = this.config.monitorResolution.width - 20;
    this.progressText.y = 10;
    this.app.stage.addChild(this.progressText);
  }

  // =========================================================================
  // INPUT HANDLING
  // =========================================================================

  private setupInputHandlers(): void {
    this.app.canvas.addEventListener('click', this.boundOnClick);
    document.addEventListener('keydown', this.boundOnKeyDown);
    document.addEventListener('pointerlockchange', this.boundOnPointerLockChange);
    document.addEventListener('mousemove', this.boundOnMouseMove);
  }

  private onClick(e: MouseEvent): void {
    // Request pointer lock on first click for tracking layers
    if (this.currentLayer >= 1 && !this.isPointerLocked) {
      this.app.canvas.requestPointerLock?.();
    }

    if (this.currentLayer === 0) {
      const rect = this.app.canvas.getBoundingClientRect();
      const scaleX = this.config.monitorResolution.width / rect.width;
      const scaleY = this.config.monitorResolution.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      this.engine.handleClick(x, y);
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.engine.handleKeyPress(e.key);
  }

  private onPointerLockChange(): void {
    this.isPointerLocked = document.pointerLockElement === this.app.canvas;
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.currentLayer < 1) return;

    if (this.isPointerLocked) {
      // Under pointer lock: accumulate movement deltas
      // This gives raw, unaccelerated input per spec
      const rect = this.app.canvas.getBoundingClientRect();
      const scaleX = this.config.monitorResolution.width / rect.width;
      const scaleY = this.config.monitorResolution.height / rect.height;

      this.cursorX += e.movementX * scaleX;
      this.cursorY += e.movementY * scaleY;
    } else {
      // Fallback: use absolute position
      const rect = this.app.canvas.getBoundingClientRect();
      const scaleX = this.config.monitorResolution.width / rect.width;
      const scaleY = this.config.monitorResolution.height / rect.height;
      this.cursorX = (e.clientX - rect.left) * scaleX;
      this.cursorY = (e.clientY - rect.top) * scaleY;
    }

    // Clamp to bounds
    this.cursorX = Math.max(0, Math.min(this.config.monitorResolution.width, this.cursorX));
    this.cursorY = Math.max(0, Math.min(this.config.monitorResolution.height, this.cursorY));

    this.engine.handleCursorPosition(this.cursorX, this.cursorY);
  }

  // =========================================================================
  // UPDATE FROM ENGINE
  // =========================================================================

  updateFromEngine(stimulusState: StimulusState, testState: TestState): void {
    if (testState.currentLayer !== this.currentLayer) {
      this.handleLayerChange(testState.currentLayer);
    }

    if (testState.phase !== 'running') return;

    // Update progress indicator
    if (this.progressText) {
      const elapsed = (performance.now() - testState.layerStartTime) / 1000;
      const total = testState.layerDuration / 1000;
      const remaining = Math.max(0, total - elapsed);
      this.progressText.text = `L${testState.currentLayer} — ${remaining.toFixed(0)}s`;
    }

    switch (testState.currentLayer) {
      case 0: this.updateLayer0(stimulusState); break;
      case 1: this.updateLayer1(stimulusState); break;
      case 2: this.updateLayer2(stimulusState); break;
      case 3: this.updateLayer3(stimulusState); break;
    }

    // Play audio if a new cue was emitted
    if (stimulusState.lastAudioCue) {
      const cueAge = performance.now() - stimulusState.lastAudioCue.onsetTime;
      if (cueAge < 50) { // Only play if very recent (avoid replaying on subsequent frames)
        try {
          getAudioManager().play(stimulusState.lastAudioCue.tone);
        } catch { /* audio not ready */ }
      }
    }
  }

  // =========================================================================
  // LAYER TRANSITIONS
  // =========================================================================

  private handleLayerChange(newLayer: number): void {
    this.cleanupLayerGraphics();
    this.currentLayer = newLayer;
    this.setupLayerGraphics(newLayer);
  }

  private setupLayerGraphics(layer: number): void {
    if (layer >= 1) {
      this.targetGraphic = new PIXI.Graphics();
      this.app.stage.addChild(this.targetGraphic);
    }

    if (layer === 3) {
      this.createCooldownBar();
      this.peripheralContainer = new PIXI.Container();
      this.app.stage.addChild(this.peripheralContainer);
    }
  }

  private cleanupLayerGraphics(): void {
    for (const g of [
      this.simpleStimulusGraphic, this.targetGraphic,
      this.cooldownBarBg, this.cooldownBarFill, this.peripheralContainer
    ]) {
      if (g) {
        try { this.app.stage.removeChild(g); } catch {}
        g.destroy({ children: true });
      }
    }
    this.simpleStimulusGraphic = null;
    this.targetGraphic = null;
    this.cooldownBarBg = null;
    this.cooldownBarFill = null;
    this.peripheralContainer = null;
  }

  // =========================================================================
  // LAYER RENDERING
  // =========================================================================

  private updateLayer0(state: StimulusState): void {
    if (state.simpleStimulus?.visible) {
      if (!this.simpleStimulusGraphic) {
        this.simpleStimulusGraphic = new PIXI.Graphics();
        this.app.stage.addChild(this.simpleStimulusGraphic);
      }
      this.simpleStimulusGraphic.clear();
      this.simpleStimulusGraphic.circle(
        state.simpleStimulus.x, state.simpleStimulus.y, this.SIMPLE_STIM_RADIUS
      );
      this.simpleStimulusGraphic.fill(this.SIMPLE_STIM_COLOR);
    } else if (this.simpleStimulusGraphic) {
      this.app.stage.removeChild(this.simpleStimulusGraphic);
      this.simpleStimulusGraphic.destroy();
      this.simpleStimulusGraphic = null;
    }
  }

  private updateLayer1(state: StimulusState): void {
    if (state.target && this.targetGraphic) {
      this.targetGraphic.clear();
      this.targetGraphic.circle(state.target.x, state.target.y, this.TARGET_RADIUS);
      this.targetGraphic.fill(this.TARGET_COLOR);
      // Crosshair
      this.targetGraphic.moveTo(state.target.x - this.TARGET_RADIUS, state.target.y);
      this.targetGraphic.lineTo(state.target.x + this.TARGET_RADIUS, state.target.y);
      this.targetGraphic.stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
      this.targetGraphic.moveTo(state.target.x, state.target.y - this.TARGET_RADIUS);
      this.targetGraphic.lineTo(state.target.x, state.target.y + this.TARGET_RADIUS);
      this.targetGraphic.stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
    }
  }

  private updateLayer2(state: StimulusState): void {
    this.updateLayer1(state);
  }

  private updateLayer3(state: StimulusState): void {
    this.updateLayer2(state);
    this.updateCooldownBar(state.cooldownProgress, state.cooldownReady);
    this.updatePeripheral(state.peripheralFlash);
  }

  // =========================================================================
  // COOLDOWN BAR
  // =========================================================================

  private createCooldownBar(): void {
    const w = 300, h = this.COOLDOWN_HEIGHT;
    const x = (this.config.monitorResolution.width - w) / 2;
    const y = this.config.monitorResolution.height - 60;

    this.cooldownBarBg = new PIXI.Graphics();
    this.cooldownBarBg.rect(x, y, w, h);
    this.cooldownBarBg.fill(this.COOLDOWN_BG_COLOR);
    this.app.stage.addChild(this.cooldownBarBg);

    this.cooldownBarFill = new PIXI.Graphics();
    this.app.stage.addChild(this.cooldownBarFill);
  }

  private updateCooldownBar(progress: number, ready: boolean): void {
    if (!this.cooldownBarFill) return;
    const w = 300, h = this.COOLDOWN_HEIGHT;
    const x = (this.config.monitorResolution.width - w) / 2;
    const y = this.config.monitorResolution.height - 60;

    this.cooldownBarFill.clear();
    this.cooldownBarFill.rect(x, y, w * progress, h);
    this.cooldownBarFill.fill(ready ? this.COOLDOWN_READY_COLOR : this.COOLDOWN_FILL_COLOR);
  }

  // =========================================================================
  // PERIPHERAL INDICATORS
  // =========================================================================

  private updatePeripheral(flash: StimulusState['peripheralFlash']): void {
    if (!this.peripheralContainer) return;
    this.peripheralContainer.removeChildren();

    if (!flash) return;

    const { width, height } = this.config.monitorResolution;
    const margin = 80;
    let x = width / 2, y = height / 2;

    switch (flash.direction) {
      case 'up': y = margin; break;
      case 'down': y = height - margin; break;
      case 'left': x = margin; break;
      case 'right': x = width - margin; break;
    }

    // Draw the digit as text (not an arrow — per spec, peripheral shows a number)
    const digitText = new PIXI.Text({
      text: flash.digit.toString(),
      style: {
        fontFamily: 'Arial',
        fontSize: 64,
        fontWeight: 'bold',
        fill: this.PERIPHERAL_COLOR,
        align: 'center'
      }
    });
    digitText.anchor.set(0.5);
    digitText.x = x;
    digitText.y = y;
    this.peripheralContainer.addChild(digitText);
  }

  // =========================================================================
  // INTER-LAYER TRANSITION SCREEN
  // =========================================================================

  showInterLayerScreen(info: InterLayerInfo, onReady: () => void): void {
    // Release pointer lock during transition
    document.exitPointerLock?.();

    // Hide canvas content
    if (this.progressText) this.progressText.text = '';

    // Create HTML overlay for the inter-layer screen
    this.interLayerOverlay = document.createElement('div');
    this.interLayerOverlay.className = 'inter-layer-overlay';
    this.interLayerOverlay.innerHTML = `
      <div class="inter-layer-content">
        <div class="inter-layer-complete">
          <span class="check-icon">✓</span>
          Layer ${info.completedLayer} complete
        </div>
        
        <h2>Up Next: Layer ${info.nextLayer}</h2>
        <p class="inter-layer-desc">${info.description}</p>

        <div class="inter-layer-new">
          <h3>What's new:</h3>
          <ul>
            ${info.newElements.map(e => `<li>${e}</li>`).join('')}
          </ul>
        </div>

        <div class="inter-layer-controls">
          <h3>Controls:</h3>
          <div class="control-list">
            ${info.controls.map(c =>
              `<div class="control-item"><kbd>${c.key}</kbd><span>${c.action}</span></div>`
            ).join('')}
          </div>
        </div>

        <div class="inter-layer-timer" id="inter-layer-timer">
          Take a breath... <span id="cooldown-countdown">${info.cooldownSeconds}</span>s
        </div>
        
        <button class="inter-layer-ready-btn" id="inter-layer-ready" disabled>
          Please wait...
        </button>
      </div>
    `;

    // Inject styles
    const style = document.createElement('style');
    style.id = 'inter-layer-styles';
    style.textContent = `
      .inter-layer-overlay {
        position: fixed; inset: 0; z-index: 10000;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        display: flex; align-items: center; justify-content: center;
        color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .inter-layer-content {
        max-width: 700px; width: 90%; padding: 3rem;
        background: rgba(255,255,255,0.05); border-radius: 20px;
        backdrop-filter: blur(10px);
      }
      .inter-layer-complete {
        font-size: 1.1rem; color: #4caf50; margin-bottom: 1.5rem;
        display: flex; align-items: center; gap: 0.5rem;
      }
      .check-icon { font-size: 1.5rem; }
      .inter-layer-content h2 {
        font-size: 2rem; color: #64b5f6; margin-bottom: 1rem;
      }
      .inter-layer-desc {
        font-size: 1.05rem; line-height: 1.6; color: #b0b0b0; margin-bottom: 1.5rem;
      }
      .inter-layer-new h3, .inter-layer-controls h3 {
        font-size: 1rem; color: #90caf9; margin-bottom: 0.75rem; text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .inter-layer-new ul {
        list-style: none; padding: 0; margin: 0 0 1.5rem 0;
      }
      .inter-layer-new li {
        padding: 0.4rem 0 0.4rem 1.5rem; position: relative; color: #ccc;
      }
      .inter-layer-new li::before {
        content: '+'; position: absolute; left: 0; color: #4caf50; font-weight: bold;
      }
      .control-list {
        display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 2rem;
      }
      .control-item {
        display: flex; align-items: center; gap: 0.5rem;
        background: rgba(255,255,255,0.08); padding: 0.5rem 1rem; border-radius: 8px;
      }
      .control-item kbd {
        background: rgba(255,255,255,0.15); padding: 0.25rem 0.5rem; border-radius: 4px;
        font-family: monospace; font-size: 0.9rem; color: #ffeb3b; font-weight: bold;
      }
      .control-item span { color: #ccc; font-size: 0.9rem; }
      .inter-layer-timer {
        text-align: center; color: #999; font-size: 1rem; margin-bottom: 1.5rem;
      }
      .inter-layer-ready-btn {
        display: block; width: 100%; padding: 1.25rem; font-size: 1.2rem; font-weight: 600;
        background: #2196f3; color: #fff; border: none; border-radius: 12px;
        cursor: pointer; transition: all 0.2s;
      }
      .inter-layer-ready-btn:hover:not(:disabled) { background: #1976d2; }
      .inter-layer-ready-btn:disabled {
        background: #555; color: #999; cursor: not-allowed;
      }
    `;
    document.head.appendChild(style);
    this.container.appendChild(this.interLayerOverlay);

    // Countdown timer
    let remaining = info.cooldownSeconds;
    const countdownEl = document.getElementById('cooldown-countdown');
    const readyBtn = document.getElementById('inter-layer-ready') as HTMLButtonElement;
    const timerEl = document.getElementById('inter-layer-timer');

    const interval = setInterval(() => {
      remaining--;
      if (countdownEl) countdownEl.textContent = remaining.toString();

      if (remaining <= 0) {
        clearInterval(interval);
        if (timerEl) timerEl.textContent = 'Ready when you are';
        if (readyBtn) {
          readyBtn.disabled = false;
          readyBtn.textContent = 'Start Layer ' + info.nextLayer;
        }
      }
    }, 1000);

    // Ready button handler
    if (readyBtn) {
      readyBtn.addEventListener('click', () => {
        this.hideInterLayerScreen();
        onReady();
      });
    }
  }

  private hideInterLayerScreen(): void {
    if (this.interLayerOverlay) {
      this.interLayerOverlay.remove();
      this.interLayerOverlay = null;
    }
    document.getElementById('inter-layer-styles')?.remove();
  }

  // =========================================================================
  // COUNTDOWN & COMPLETION
  // =========================================================================

  showCountdown(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      const text = new PIXI.Text({
        text: seconds.toString(),
        style: { fontFamily: 'Arial', fontSize: 96, fill: 0xffffff, align: 'center' }
      });
      text.anchor.set(0.5);
      text.x = this.config.monitorResolution.width / 2;
      text.y = this.config.monitorResolution.height / 2;
      this.app.stage.addChild(text);

      let remaining = seconds;
      const interval = setInterval(() => {
        remaining--;
        if (remaining > 0) {
          text.text = remaining.toString();
        } else {
          clearInterval(interval);
          this.app.stage.removeChild(text);
          text.destroy();
          resolve();
        }
      }, 1000);
    });
  }

  showComplete(): void {
    this.cleanupLayerGraphics();
    const text = new PIXI.Text({
      text: 'Test Complete!',
      style: { fontFamily: 'Arial', fontSize: 48, fill: 0x4caf50, align: 'center' }
    });
    text.anchor.set(0.5);
    text.x = this.config.monitorResolution.width / 2;
    text.y = this.config.monitorResolution.height / 2;
    this.app.stage.addChild(text);
  }

  // =========================================================================
  // CLEANUP
  // =========================================================================

  destroy(): void {
    this.hideInterLayerScreen();
    document.exitPointerLock?.();

    // Remove event listeners
    this.app.canvas?.removeEventListener('click', this.boundOnClick);
    document.removeEventListener('keydown', this.boundOnKeyDown);
    document.removeEventListener('pointerlockchange', this.boundOnPointerLockChange);
    document.removeEventListener('mousemove', this.boundOnMouseMove);

    this.cleanupLayerGraphics();

    if (this.progressText) {
      try { this.app.stage.removeChild(this.progressText); } catch {}
      this.progressText.destroy();
      this.progressText = null;
    }

    // Guard: PixiJS may already be destroyed
    try {
      const canvas = this.app.canvas;
      this.app.destroy(true, { children: true, texture: true });
      canvas?.parentElement?.removeChild(canvas);
    } catch {
      // Already destroyed or partially torn down
    }
  }
}
