/**
 * Canvas2D Fallback Renderer for CLST
 * Used when PixiJS WebGL initialization fails (e.g., WebView2 without GPU)
 */

import type { SessionConfig, StimulusState, TestState, InterLayerInfo } from '@/types';
import { TestEngine } from '@/lib/testEngine';
import { getAudioManager } from '@/lib/audioManager';

export class Canvas2DRenderer {
  private container: HTMLElement;
  private config: SessionConfig;
  private engine: TestEngine;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animId: number | null = null;
  private isPointerLocked = false;
  private cursorX: number;
  private cursorY: number;
  private lastStimulus: StimulusState | null = null;
  private lastState: TestState | null = null;
  private lastPlayedAudioCueTime: number = 0;  // Track last played audio cue to avoid replays
  private overlay: HTMLDivElement | null = null;

  private boundMouseMove: (e: MouseEvent) => void;
  private boundClick: (e: MouseEvent) => void;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundPointerLock: () => void;

  constructor(container: HTMLElement, config: SessionConfig, engine: TestEngine) {
    this.container = container;
    this.config = config;
    this.engine = engine;
    this.canvas = document.createElement('canvas');
    this.canvas.width = config.monitorResolution.width;
    this.canvas.height = config.monitorResolution.height;
    this.canvas.style.width = '100vw';
    this.canvas.style.height = '100vh';
    this.canvas.style.display = 'block';
    this.canvas.style.cursor = 'none';
    this.ctx = this.canvas.getContext('2d')!;
    this.cursorX = config.monitorResolution.width / 2;
    this.cursorY = config.monitorResolution.height / 2;

    this.boundMouseMove = this.onMouseMove.bind(this);
    this.boundClick = this.onClick.bind(this);
    this.boundKeyDown = this.onKeyDown.bind(this);
    this.boundPointerLock = this.onPointerLockChange.bind(this);
  }

  async initialize(): Promise<void> {
    this.container.appendChild(this.canvas);
    this.canvas.addEventListener('click', this.boundClick);
    document.addEventListener('keydown', this.boundKeyDown);
    document.addEventListener('pointerlockchange', this.boundPointerLock);
    document.addEventListener('mousemove', this.boundMouseMove);
    const loop = () => { this.render(); this.animId = requestAnimationFrame(loop); };
    this.animId = requestAnimationFrame(loop);
  }

  updateFromEngine(stim: StimulusState, state: TestState): void {
    this.lastStimulus = stim;
    this.lastState = state;

    // Play audio cue if a new one was emitted (same logic as PixiJS renderer)
    if (stim.lastAudioCue) {
      const cueAge = performance.now() - stim.lastAudioCue.onsetTime;
      if (cueAge < 50 && stim.lastAudioCue.onsetTime !== this.lastPlayedAudioCueTime) {
        this.lastPlayedAudioCueTime = stim.lastAudioCue.onsetTime;
        try {
          getAudioManager().play(stim.lastAudioCue.tone);
        } catch { /* audio not ready */ }
      }
    }
  }

  private render(): void {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    if (!this.lastStimulus || !this.lastState) return;
    const stim = this.lastStimulus;
    const state = this.lastState;

    // Progress text
    const elapsed = (performance.now() - state.layerStartTime) / 1000;
    const remaining = Math.max(0, state.layerDuration - elapsed);
    ctx.fillStyle = '#666';
    ctx.font = '14px Arial';
    ctx.textAlign = 'right';
    ctx.fillText(`Layer ${state.currentLayer} | ${Math.ceil(remaining)}s`, W - 20, 24);

    // Layer 0: Simple stimulus (green circle)
    if (stim.simpleStimulus?.visible) {
      ctx.beginPath();
      ctx.arc(stim.simpleStimulus.x, stim.simpleStimulus.y, 30, 0, Math.PI * 2);
      ctx.fillStyle = '#4caf50';
      ctx.fill();
    }

    // Layer 1+: Target (blue circle)
    if (stim.target) {
      ctx.beginPath();
      ctx.arc(stim.target.x, stim.target.y, stim.target.radius || 20, 0, Math.PI * 2);
      ctx.fillStyle = '#2196f3';
      ctx.fill();

      // Cursor (white dot)
      ctx.beginPath();
      ctx.arc(this.cursorX, this.cursorY, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();

      // Tracking line
      ctx.beginPath();
      ctx.moveTo(this.cursorX, this.cursorY);
      ctx.lineTo(stim.target.x, stim.target.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Audio cue indicator
    if (stim.lastAudioCue) {
      const age = performance.now() - stim.lastAudioCue.onsetTime;
      if (age < 500) {
        const tone = stim.lastAudioCue.tone;
        ctx.fillStyle = tone === 'high' ? '#ff9800' : tone === 'low' ? '#9c27b0' : '#f44336';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`♪ ${tone.toUpperCase()}`, W / 2, 40);
      }
    }

    // Peripheral flash (digit in corner — "down" pushed up to avoid cooldown bar overlap)
    if (stim.peripheralFlash) {
      const pf = stim.peripheralFlash;
      const dir = pf.direction;
      const px = dir === 'left' ? 60 : dir === 'right' ? W - 60 : W / 2;
      // "down" uses H - 120 instead of H - 60 to stay clear of cooldown bar area
      const py = dir === 'up' ? 60 : dir === 'down' ? H - 130 : H / 2;

      // Pulsing glow effect to draw attention
      const age = performance.now() - pf.onsetTime;
      const pulse = 0.7 + 0.3 * Math.sin(age / 80); // Fast pulse

      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ff9800';
      ctx.font = 'bold 48px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(pf.digit), px, py);
      ctx.restore();
      ctx.textBaseline = 'alphabetic';
    }

    // Cooldown bar (with pulse/flash when ready to draw attention)
    if (stim.cooldownProgress != null && stim.cooldownProgress > 0) {
      const barW = 300, barH = 16;
      const barX = (W - barW) / 2, barY = H - 50;

      // Background
      ctx.fillStyle = '#333';
      ctx.fillRect(barX, barY, barW, barH);

      // Fill
      const fill = Math.min(stim.cooldownProgress, 1);
      if (stim.cooldownReady) {
        // Pulsing green when ready — much more visible
        const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 150);
        ctx.fillStyle = `rgba(76, 175, 80, ${pulse})`;
        ctx.fillRect(barX, barY, barW, barH);

        // Bright border pulse
        ctx.strokeStyle = `rgba(76, 175, 80, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(barX - 2, barY - 2, barW + 4, barH + 4);
      } else {
        ctx.fillStyle = '#ff9800';
        ctx.fillRect(barX, barY, barW * fill, barH);
      }

      // Label
      ctx.fillStyle = stim.cooldownReady ? '#4caf50' : '#888';
      ctx.font = stim.cooldownReady ? 'bold 14px Arial' : '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(stim.cooldownReady ? '▶ PRESS F ◀' : 'Cooldown...', W / 2, barY - 8);
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.isPointerLocked) {
      this.cursorX = Math.max(0, Math.min(this.canvas.width, this.cursorX + e.movementX));
      this.cursorY = Math.max(0, Math.min(this.canvas.height, this.cursorY + e.movementY));
    } else {
      const rect = this.canvas.getBoundingClientRect();
      this.cursorX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      this.cursorY = (e.clientY - rect.top) * (this.canvas.height / rect.height);
    }
    this.engine.handleCursorPosition(this.cursorX, this.cursorY);
  }

  private onClick(_e: MouseEvent): void {
    if (!this.isPointerLocked && this.lastState?.currentLayer && this.lastState.currentLayer >= 1) {
      this.canvas.requestPointerLock();
    }
    this.engine.handleClick(this.cursorX, this.cursorY);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (document.pointerLockElement) document.exitPointerLock();
      this.engine.stop();
      return;
    }
    this.engine.handleKeyPress(e.key);
  }

  private onPointerLockChange(): void {
    this.isPointerLocked = document.pointerLockElement === this.canvas;
  }

  showCountdown(seconds: number): Promise<void> {
    return new Promise(resolve => {
      let remaining = seconds;
      const draw = () => {
        const ctx = this.ctx;
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 96px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(remaining), this.canvas.width / 2, this.canvas.height / 2);
        ctx.textBaseline = 'alphabetic';
      };
      draw();
      const iv = setInterval(() => {
        remaining--;
        if (remaining > 0) draw();
        else { clearInterval(iv); resolve(); }
      }, 1000);
    });
  }

  showInterLayerScreen(info: InterLayerInfo, onReady: () => void): void {
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position:'fixed',top:'0',left:'0',width:'100vw',height:'100vh',
      background:'rgba(26,26,46,0.95)',display:'flex',alignItems:'center',
      justifyContent:'center',zIndex:'10000',color:'#fff',flexDirection:'column',
      gap:'1.5rem',padding:'2rem',textAlign:'center',overflowY:'auto'
    });

    // Build practice section based on next layer
    let practiceHTML = '';
    if (info.nextLayer === 2) {
      practiceHTML = `
        <div style="background:rgba(255,255,255,0.08);border-radius:12px;padding:1.25rem;margin:0.5rem 0;max-width:450px;width:100%">
          <p style="color:#90caf9;font-weight:600;margin-bottom:0.75rem;font-size:.95rem">🎧 Practice: Listen to the tones</p>
          <p style="color:#999;font-size:.82rem;margin-bottom:1rem">Press SPACE for the high or low tone. Ignore the distractor (buzzy sound).</p>
          <div style="display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap">
            <button class="practice-tone-btn" data-tone="high" style="padding:.5rem 1.25rem;background:#1565c0;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.9rem">▶ High (respond)</button>
            <button class="practice-tone-btn" data-tone="low" style="padding:.5rem 1.25rem;background:#6a1b9a;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.9rem">▶ Low (respond)</button>
            <button class="practice-tone-btn" data-tone="distractor" style="padding:.5rem 1.25rem;background:#c62828;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:.9rem">▶ Distractor (ignore)</button>
          </div>
        </div>`;
    } else if (info.nextLayer === 3) {
      practiceHTML = `
        <div style="background:rgba(255,255,255,0.08);border-radius:12px;padding:1.25rem;margin:0.5rem 0;max-width:450px;width:100%">
          <p style="color:#90caf9;font-weight:600;margin-bottom:0.75rem;font-size:.95rem">🎯 Practice: New mechanics</p>
          <div style="margin-bottom:.75rem">
            <p style="color:#ff9800;font-size:.95rem;margin-bottom:.25rem">Peripheral numbers</p>
            <p style="color:#999;font-size:.82rem">Numbers flash at screen edges. Press the matching number key (0-9).</p>
            <div id="practice-periph" style="margin-top:.5rem;height:50px;display:flex;align-items:center;justify-content:center">
              <button id="show-periph" style="padding:.4rem 1rem;background:#e65100;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:.85rem">Show example</button>
            </div>
          </div>
          <div>
            <p style="color:#4caf50;font-size:.95rem;margin-bottom:.25rem">Cooldown bar</p>
            <p style="color:#999;font-size:.82rem">A bar fills at the bottom of the screen. Press F when it turns green and pulses.</p>
          </div>
        </div>`;
    }

    this.overlay.innerHTML = `
      <h2 style="color:#4caf50">✓ Layer ${info.completedLayer} Complete</h2>
      <h3>Next: Layer ${info.nextLayer}</h3>
      <p style="color:#ccc;max-width:500px">${info.description}</p>
      ${info.newElements.length ? `<p style="color:#ff9800;font-size:.9rem">New: ${info.newElements.join(', ')}</p>` : ''}
      <p style="color:#888;font-size:.85rem">${info.controls.map((c: any) => `<kbd style="background:rgba(255,255,255,0.15);padding:.15rem .4rem;border-radius:4px;font-family:monospace;color:#ffeb3b">${c.key}</kbd> ${c.action}`).join(' · ')}</p>
      ${practiceHTML}
      <div id="il-cd" style="font-size:1.5rem;color:#ff9800"></div>
      <button id="il-go" style="padding:.75rem 2rem;background:#2196f3;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:1.1rem;opacity:0.5;pointer-events:none">Waiting...</button>`;
    document.body.appendChild(this.overlay);

    // Wire up practice buttons
    if (info.nextLayer === 2) {
      this.overlay.querySelectorAll('.practice-tone-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const tone = (btn as HTMLElement).dataset.tone as 'high' | 'low' | 'distractor';
          try { getAudioManager().play(tone); } catch {}
        });
      });
    } else if (info.nextLayer === 3) {
      const showPeriphBtn = this.overlay.querySelector('#show-periph');
      const periphArea = this.overlay.querySelector('#practice-periph');
      if (showPeriphBtn && periphArea) {
        showPeriphBtn.addEventListener('click', () => {
          const digit = Math.floor(Math.random() * 10);
          periphArea.innerHTML = `<span style="font-size:2.5rem;font-weight:700;color:#ff9800">${digit}</span><span style="color:#999;margin-left:.75rem;font-size:.85rem">← Press ${digit} on your keyboard</span>`;
          setTimeout(() => {
            periphArea.innerHTML = `<button id="show-periph-2" style="padding:.4rem 1rem;background:#e65100;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:.85rem">Show another</button>`;
            periphArea.querySelector('#show-periph-2')?.addEventListener('click', () => {
              const d2 = Math.floor(Math.random() * 10);
              periphArea.innerHTML = `<span style="font-size:2.5rem;font-weight:700;color:#ff9800">${d2}</span><span style="color:#999;margin-left:.75rem;font-size:.85rem">← Press ${d2}</span>`;
            });
          }, 2000);
        });
      }
    }

    let cd = info.cooldownSeconds || 5;
    const cdEl = document.getElementById('il-cd')!;
    const btn = document.getElementById('il-go')!;
    cdEl.textContent = String(cd);
    const iv = setInterval(() => {
      cd--;
      if (cd > 0) { cdEl.textContent = String(cd); }
      else {
        clearInterval(iv); cdEl.textContent = '';
        btn.textContent = `Start Layer ${info.nextLayer}`;
        btn.style.opacity = '1'; btn.style.pointerEvents = 'auto';
        btn.addEventListener('click', () => { this.overlay?.remove(); this.overlay = null; onReady(); });
      }
    }, 1000);
  }

  showComplete(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#4caf50';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Test Complete!', this.canvas.width / 2, this.canvas.height / 2);
  }

  destroy(): void {
    if (this.animId) cancelAnimationFrame(this.animId);
    this.canvas.removeEventListener('click', this.boundClick);
    document.removeEventListener('keydown', this.boundKeyDown);
    document.removeEventListener('pointerlockchange', this.boundPointerLock);
    document.removeEventListener('mousemove', this.boundMouseMove);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.overlay?.remove();
    try { this.canvas.remove(); } catch {}
  }
}
