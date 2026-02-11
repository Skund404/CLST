/**
 * Main Application View for CLST
 * Features: notes, tags, export-all, correlation insights, dark/light mode, session comparison, trend chart
 */

import * as d3 from 'd3';
import { TestEngine } from '@/lib/testEngine';
import { getAudioManager } from '@/lib/audioManager';
import { db } from '@/lib/database';
import { MetricsCalculator } from '@/lib/metricsCalculator';
import { ScoringEngine } from '@/lib/scoringEngine';
import { Statistics } from '@/lib/statistics';
import type { SessionConfig, Session, LayerMetrics, BaselineStats, WeightProfile, InterLayerInfo } from '@/types';

type AppState = 'config' | 'checkin' | 'ready' | 'test' | 'results' | 'dashboard';

export class MainApp {
  private container: HTMLElement;
  private currentState: AppState = 'config';
  private contentContainer: HTMLElement | null = null;
  private testEngine: TestEngine | null = null;
  private testRenderer: any = null;
  private currentSessionId: string | null = null;
  private currentCheckinId: string | null = null;
  private sessionConfig: SessionConfig | null = null;
  private injectedStyles: HTMLStyleElement[] = [];
  private darkMode = false;
  private comparisonIds = new Set<string>();

  constructor(container: HTMLElement) { this.container = container; }

  async init(): Promise<void> {
    this.darkMode = (await db.getConfig('dark_mode')) === 'true';
    this.applyTheme();
    this.createMainUI();
    await this.showState((await db.getSessionCount()) === 0 ? 'config' : 'checkin');
  }

  private applyTheme(): void { document.documentElement.classList.toggle('dark', this.darkMode); }

  private async toggleTheme(): Promise<void> {
    this.darkMode = !this.darkMode; this.applyTheme();
    await db.setConfig('dark_mode', this.darkMode.toString());
    const b = document.getElementById('theme-toggle'); if (b) b.textContent = this.darkMode ? '\u2600\ufe0f Light' : '\ud83c\udf19 Dark';
  }

  private createMainUI(): void {
    this.container.innerHTML = `<div class="clst-app">
      <header class="app-header"><div class="app-title"><h1>CLST</h1><span class="app-subtitle">Cognitive Load Stress Test</span></div>
        <nav class="app-nav"><button id="nav-dashboard" class="nav-button">\ud83d\udcca Dashboard</button><button id="nav-settings" class="nav-button">\u2699\ufe0f Settings</button><button id="theme-toggle" class="nav-button">${this.darkMode?'\u2600\ufe0f Light':'\ud83c\udf19 Dark'}</button></nav>
      </header><main class="app-content" id="app-content"></main>
      <footer class="app-footer"><span class="app-version">v0.3.0</span></footer></div>`;
    this.contentContainer = document.getElementById('app-content');
    document.getElementById('nav-dashboard')?.addEventListener('click', () => this.showState('dashboard'));
    document.getElementById('nav-settings')?.addEventListener('click', () => this.showState('config'));
    document.getElementById('theme-toggle')?.addEventListener('click', () => this.toggleTheme());
  }

  async showState(state: AppState): Promise<void> {
    this.cleanupCurrentState(); this.currentState = state;
    switch (state) {
      case 'config': await this.showConfiguration(); break;
      case 'checkin': await this.showCheckin(); break;
      case 'ready': await this.showReadyScreen(); break;
      case 'test': await this.startTest(); break;
      case 'results': await this.showResults(); break;
      case 'dashboard': await this.showDashboard(); break;
    }
  }

  private cleanupCurrentState(): void {
    if (this.testRenderer) { this.testRenderer.destroy(); this.testRenderer = null; }
    if (this.testEngine) { this.testEngine.stop(); this.testEngine = null; }
    for (const s of this.injectedStyles) s.remove(); this.injectedStyles = [];
    if (this.contentContainer) this.contentContainer.innerHTML = '';
  }

  private injectStyle(css: string): void {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); this.injectedStyles.push(s);
  }

  // === CONFIGURATION ===
  private async showConfiguration(): Promise<void> {
    if (!this.contentContainer) return;
    const ex = await this.loadConfig();
    this.contentContainer.innerHTML = `<div class="config-container"><h2>Configuration</h2>
      <form id="config-form" class="config-form"><div class="config-section"><h3>Hardware</h3>
        <div class="form-group"><label>Mouse DPI</label><input type="number" id="mouse-dpi" value="${ex?.mouseDPI||800}" min="100" max="25600" step="100" required></div>
        <div class="form-group"><label>Sensitivity</label><input type="number" id="app-sens" value="${ex?.applicationSens||1.0}" min="0.1" max="10" step="0.1" required></div>
        <div class="form-group"><label>Width (px)</label><input type="number" id="monitor-width" value="${ex?.monitorResolution?.width||screen.width}" required></div>
        <div class="form-group"><label>Height (px)</label><input type="number" id="monitor-height" value="${ex?.monitorResolution?.height||screen.height}" required></div>
        <div class="form-group"><label>Refresh Rate</label><select id="refresh-rate">${[60,75,120,144,165,240].map(r=>`<option value="${r}" ${ex?.monitorRefreshRate===r?'selected':''}>${r}Hz</option>`).join('')}</select></div>
        <div class="form-group"><label>Volume</label><input type="range" id="audio-volume" min="0" max="1" step="0.1" value="${ex?.audioVolume??0.5}"><span id="vol-d">${((ex?.audioVolume??0.5)*100).toFixed(0)}%</span>
          <button type="button" id="test-sound" class="btn btn-secondary" style="margin-top:.5rem;padding:.4rem .8rem;font-size:.8rem">🔊 Test Sound</button></div></div>
        <div class="config-section"><h3>Difficulty</h3><div class="form-group"><select id="difficulty">
          <option value="casual">Casual</option><option value="standard" ${(ex?.difficulty||'standard')==='standard'?'selected':''}>Standard</option><option value="intense">Intense</option></select></div></div>
        <div class="config-actions"><button type="submit" class="btn btn-primary">Save & Continue</button>${ex?'<button type="button" id="cancel-cfg" class="btn btn-secondary">Cancel</button>':''}</div>
      </form></div>`;
    const sl = document.getElementById('audio-volume') as HTMLInputElement;
    sl?.addEventListener('input', () => { document.getElementById('vol-d')!.textContent = `${(parseFloat(sl.value)*100).toFixed(0)}%`; getAudioManager().setVolume(parseFloat(sl.value)); });
    document.getElementById('test-sound')?.addEventListener('click', async () => {
      const am = getAudioManager();
      try {
        if (am.getState() !== 'running') await am.init({ volume: parseFloat(sl?.value || '0.5') });
        am.setVolume(parseFloat(sl?.value || '0.5'));
        am.play('high');
        setTimeout(() => am.play('low'), 300);
        setTimeout(() => am.play('distractor'), 600);
      } catch (e) { console.error('Test sound failed:', e); }
    });
    document.getElementById('config-form')!.addEventListener('submit', async e => { e.preventDefault(); await this.saveConfig(); });
    document.getElementById('cancel-cfg')?.addEventListener('click', () => this.showState('checkin'));
  }
  private async loadConfig(): Promise<SessionConfig|null> { const j = await db.getConfig('session_config'); return j ? JSON.parse(j) : null; }
  private async saveConfig(): Promise<void> {
    const v = (id:string) => (document.getElementById(id) as HTMLInputElement).value;
    const d = parseInt(v('mouse-dpi')), s = parseFloat(v('app-sens'));
    this.sessionConfig = { mouseDPI:d, applicationSens:s, eDPI:d*s, monitorResolution:{width:parseInt(v('monitor-width')),height:parseInt(v('monitor-height'))},
      monitorRefreshRate:parseInt(v('refresh-rate')), audioDevice:'default', audioVolume:parseFloat(v('audio-volume')), difficulty:v('difficulty') as any };
    await db.setConfig('session_config', JSON.stringify(this.sessionConfig)); await this.showState('checkin');
  }

  // === CHECK-IN ===
  private async showCheckin(): Promise<void> {
    if (!this.contentContainer) return;
    const { CheckinComponent } = await import('@/components/PreSessionCheckin');
    const ss = await db.getAllSessions(1);
    const last = ss[0]?.checkinId ? await db.getCheckin(ss[0].checkinId) : null;
    this.contentContainer.innerHTML = '<div id="checkin-c"></div>';
    new CheckinComponent(document.getElementById('checkin-c')!, {
      previousCheckin:last, symptomHistory: await db.getSymptomHistory(),
      onComplete: async (c: any) => { this.currentCheckinId = c ? await db.saveCheckin(c) : null; await this.showState('ready'); }
    }).render();
  }

  // === READY SCREEN ===
  private async showReadyScreen(): Promise<void> {
    if (!this.contentContainer) return;
    if (!this.sessionConfig) { this.sessionConfig = await this.loadConfig(); if (!this.sessionConfig) { await this.showState('config'); return; } }
    this.injectStyle(`.ready-screen{display:flex;align-items:center;justify-content:center;min-height:80vh;padding:2rem}.ready-content{max-width:800px;width:100%;background:var(--surface,#fff);border-radius:16px;padding:3rem;box-shadow:0 4px 24px rgba(0,0,0,.1)}.test-layers{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:1.5rem 0}.layer-card{background:var(--surface-alt,#f5f5f5);border-radius:12px;padding:1.25rem}.layer-card h4{color:var(--primary,#2196f3);margin-bottom:.5rem}.controls-grid{display:grid;grid-template-columns:auto 1fr;gap:.5rem 1rem;margin:1rem 0}.controls-grid kbd{background:#e3e3e3;padding:.2rem .6rem;border-radius:4px;font-family:monospace;font-weight:bold}.ready-actions{display:flex;gap:1rem;margin-top:2rem}.ready-actions .btn{flex:1;padding:1rem;font-size:1.1rem;border:none;border-radius:10px;cursor:pointer;font-weight:600}`);
    this.contentContainer.innerHTML = `<div class="ready-screen"><div class="ready-content"><h1 style="font-size:2rem;margin-bottom:1.5rem">Ready to Begin</h1>
      <p>~3 minutes, 4 progressive layers with breaks between each.</p>
      <div class="test-layers"><div class="layer-card"><h4>L0 - 30s</h4><p>Click stimulus</p></div><div class="layer-card"><h4>L1 - 45s</h4><p>Track target</p></div><div class="layer-card"><h4>L2 - 45s</h4><p>Track + audio</p></div><div class="layer-card"><h4>L3 - 60s</h4><p>Full load</p></div></div>
      <h3>Controls</h3><div class="controls-grid"><kbd>Click</kbd><span>L0</span><kbd>Mouse</kbd><span>Track (L1-3)</span><kbd>SPACE</kbd><span>Audio (L2-3)</span><kbd>0-9</kbd><span>Peripheral (L3)</span><kbd>F</kbd><span>Cooldown (L3)</span><kbd>ESC</kbd><span>Abort</span></div>
      <div class="ready-actions"><button class="btn btn-primary" id="go">Start Test</button><button class="btn btn-secondary" id="nogo">Cancel</button></div></div></div>`;
    document.getElementById('go')?.addEventListener('click', () => this.showState('test'));
    document.getElementById('nogo')?.addEventListener('click', () => this.showState('dashboard'));
  }

  // === TEST EXECUTION ===
  private async startTest(): Promise<void> {
    if (!this.contentContainer || !this.sessionConfig) return;
    this.currentSessionId = crypto.randomUUID();
    this.contentContainer.innerHTML = '<div id="tc"></div>';
    const tc = document.getElementById('tc')!;
    Object.assign(tc.style, {position:'fixed',top:'0',left:'0',width:'100vw',height:'100vh',zIndex:'9999',background:'#1a1a2e'});

    this.testEngine = new TestEngine(this.currentSessionId, this.sessionConfig);
    let renderer: any = null;

    // Try PixiJS (WebGL) first
    try {
      const { TestRenderer } = await import('@/lib/testRenderer');
      const pixiRenderer = new TestRenderer(tc, this.sessionConfig, this.testEngine);
      await pixiRenderer.initialize();
      renderer = pixiRenderer;
      console.log('Using PixiJS WebGL renderer');
    } catch (e) {
      console.warn('PixiJS WebGL failed, falling back to Canvas2D:', e);
      tc.innerHTML = ''; // Clear any partial PixiJS DOM
      try {
        const { Canvas2DRenderer } = await import('@/lib/canvas2dRenderer');
        const c2d = new Canvas2DRenderer(tc, this.sessionConfig, this.testEngine);
        await c2d.initialize();
        renderer = c2d;
        console.log('Using Canvas2D fallback renderer');
      } catch (e2) {
        console.error('Both renderers failed:', e2);
        tc.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#fff;flex-direction:column;gap:1rem;padding:2rem;text-align:center">
          <h2 style="color:#f44336">Test Failed to Start</h2>
          <p style="color:#ccc">Neither WebGL nor Canvas2D could initialize.</p>
          <p style="color:#888;font-size:.85rem">${e2 instanceof Error ? e2.message : 'Unknown error'}</p>
          <button onclick="window.location.reload()" style="padding:.75rem 2rem;background:#2196f3;color:#fff;border:none;border-radius:8px;cursor:pointer">Reload</button>
        </div>`;
        return;
      }
    }

    this.testRenderer = renderer;
    this.testEngine.setCallbacks({
      onStimulusUpdate: (s: any) => renderer?.updateFromEngine(s, this.testEngine!.getState()),
      onLayerComplete: (_: any, info: InterLayerInfo) => renderer?.showInterLayerScreen(info, () => this.testEngine!.advanceToNextLayer()),
      onTestComplete: () => { renderer?.showComplete(); this.processResults().then(() => setTimeout(() => this.showState('results'), 2000)); }
    });
    await renderer.showCountdown(3);
    await this.testEngine.start();
  }

  private async processResults(): Promise<void> {
    if (!this.testEngine || !this.currentSessionId || !this.sessionConfig) return;
    const ev = this.testEngine.getEvents(), st = this.testEngine.getSystemStallCount(), dur = [30,45,45,60];
    const lm: LayerMetrics[] = [];
    for (let l=0;l<=3;l++) lm.push(MetricsCalculator.computeLayerMetrics(this.currentSessionId,l,ev.filter(e=>e.layer===l),dur[l],this.sessionConfig.monitorRefreshRate));

    // Check session count to determine calibration status
    const sessionCount = await db.getSessionCount(); // count BEFORE saving this one
    const isCalibrating = sessionCount < 5; // sessions 0-4 (this will be sessions 1-5)

    let sc: { lpi0: number|null; lpi1: number|null; lpi2: number|null; lpi3: number|null; dc: number|null; crs: number|null; alert: 'critical'|'warning'|null };

    if (isCalibrating) {
      // Section 11.1: During calibration, don't compute composite scores
      // They're meaningless without a baseline and mislead the user
      sc = { lpi0: null, lpi1: null, lpi2: null, lpi3: null, dc: null, crs: null, alert: null };
    } else {
      const bl = new Map<string,BaselineStats>();
      const mn = ['rt','rt_variance','track_error','track_variance','jerk','overshoot','audio_rt','audio_accuracy','prp','cooldown','periph_rt','periph_miss'];
      for (const n of mn) for (let l=0;l<=3;l++) { const b = await db.getBaseline('rolling',n,l); if (b) bl.set(`${n}_L${l}`,b); }
      const cb = await db.getBaseline('rolling','crs',null); if (cb) bl.set('crs',cb);
      const wp = await db.getWeightProfile('balanced') || this.defaultWP();
      sc = ScoringEngine.computeSessionScores(lm,bl,wp);
    }

    const sess: Session = {id:this.currentSessionId,timestamp:new Date(),configSnapshot:this.sessionConfig,
      lpi0:sc.lpi0,lpi1:sc.lpi1,lpi2:sc.lpi2,lpi3:sc.lpi3,degradationCoeff:sc.dc,crs:sc.crs,
      notes:null,tags:[],checkinId:this.currentCheckinId,profileId:'balanced',systemStalls:st};
    await db.saveSession(sess); for (const m of lm) await db.saveLayerMetrics(m); await db.saveRawEvents(ev);

    // Only update baselines for non-calibration sessions
    if (!isCalibrating) {
      const mn = ['rt','rt_variance','track_error','track_variance','jerk','overshoot','audio_rt','audio_accuracy','prp','cooldown','periph_rt','periph_miss'];
      for (const n of mn) for (let l=0;l<=3;l++) await db.updateRollingBaseline(n,l);
    }
  }

  // === RESULTS VIEW ===
  private async showResults(): Promise<void> {
    if (!this.contentContainer || !this.currentSessionId) return;
    const s = await db.getSession(this.currentSessionId);
    if (!s) { await this.showState('dashboard'); return; }
    const cb = await db.getBaseline('rolling','crs',null);
    const z = cb && s.crs!=null ? (s.crs-cb.median)/(cb.madScaled||1) : null;
    const al = z!=null ? ScoringEngine.checkAlertThreshold(z) : null;
    this.injectStyle(`.results-container{max-width:800px;margin:2rem auto;padding:2rem}.crs-big{font-size:4rem;font-weight:700;text-align:center;margin:1rem 0}.crs-big.normal{color:#4caf50}.crs-big.warning{color:#ff9800}.crs-big.critical{color:#f44336}.score-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;margin:2rem 0}.score-card{background:var(--surface-alt,#f5f5f5);border-radius:12px;padding:1.25rem;text-align:center}.score-card .label{font-size:.85rem;color:#888}.score-card .value{font-size:1.5rem;font-weight:600;margin-top:.5rem}.results-actions{display:flex;gap:1rem;margin-top:2rem;justify-content:center}.results-actions .btn{padding:.75rem 2rem;border:none;border-radius:8px;cursor:pointer;font-weight:600}`);
    const cc = al === 'critical' ? 'critical' : al === 'warning' ? 'warning' : 'normal';
    const sessionCount = await db.getSessionCount();
    const isCalibrating = sessionCount <= 5;
    const isPreBaseline = sessionCount > 5 && sessionCount <= 15;
    const hasScores = s.crs != null;

    const statusNote = isCalibrating
      ? `<p style="text-align:center;color:#ff9800;font-size:.9rem;margin-top:.5rem">⏳ Calibrating — Session ${sessionCount} of 5. Collecting baseline data — scores will appear after 5 sessions.</p>`
      : isPreBaseline
      ? `<p style="text-align:center;color:#2196f3;font-size:.9rem;margin-top:.5rem">📊 Building baseline — ${sessionCount - 5} of 10 sessions toward full accuracy. Scores are preliminary.</p>`
      : '';

    this.contentContainer.innerHTML = `<div class="results-container">
      <h1 style="text-align:center">Session Complete</h1>
      <p style="text-align:center;color:#888">${s.timestamp.toLocaleString()}</p>
      ${hasScores ? `
        <div class="crs-big ${cc}">${s.crs!.toFixed(1)}</div>
        <p style="text-align:center;color:#888">Cognitive Readiness Score${isPreBaseline ? ' (Preliminary)' : ''}</p>
      ` : `
        <div style="text-align:center;margin:1.5rem 0;padding:1.5rem;background:var(--surface-alt,#f5f5f5);border-radius:12px">
          <p style="font-size:1.1rem;color:#666;margin-bottom:.5rem">Calibration Session ${sessionCount}</p>
          <p style="font-size:.9rem;color:#999">Raw measurements recorded below. Composite scores require at least 5 sessions.</p>
        </div>
      `}
      ${statusNote}
      ${al ? `<p style="text-align:center;color:${al==='critical'?'#f44336':'#ff9800'};font-weight:600">\u26a0 ${al.toUpperCase()} \u2014 Below baseline</p>` : ''}
      ${hasScores ? `<div class="score-grid">
        <div class="score-card"><div class="label">Reaction Time (Layer 0)</div><div class="value">${s.lpi0?.toFixed(1)??'\u2014'}</div></div>
        <div class="score-card"><div class="label">Tracking (Layer 1)</div><div class="value">${s.lpi1?.toFixed(1)??'\u2014'}</div></div>
        <div class="score-card"><div class="label">Track + Audio (Layer 2)</div><div class="value">${s.lpi2?.toFixed(1)??'\u2014'}</div></div>
        <div class="score-card"><div class="label">Full Load (Layer 3)</div><div class="value">${s.lpi3?.toFixed(1)??'\u2014'}</div></div>
        <div class="score-card"><div class="label">Load Tolerance</div><div class="value">${s.degradationCoeff!=null?(s.degradationCoeff*100).toFixed(0)+'%':'\u2014'}</div></div>
        <div class="score-card"><div class="label">System Stalls</div><div class="value">${s.systemStalls}</div></div>
      </div>` : ''}
      <div class="results-actions">
        <button class="btn btn-primary" id="res-new">New Session</button>
        <button class="btn btn-secondary" id="res-dash">Dashboard</button>
      </div></div>`;

    // Load and display raw layer metrics for this session
    if (this.currentSessionId) {
      const lms = await db.getLayerMetrics(this.currentSessionId);
      const l0 = lms.find(m => m.layer === 0), l1 = lms.find(m => m.layer === 1);
      const l2 = lms.find(m => m.layer === 2), l3 = lms.find(m => m.layer === 3);
      const f = (v: number|undefined, u='') => v != null ? `${v.toFixed(1)}${u}` : '\u2014';

      const rawSection = document.createElement('div');
      rawSection.style.cssText = 'margin-top:1.5rem';
      rawSection.innerHTML = `
        <h3 style="text-align:center;margin-bottom:1rem;font-size:1rem;color:#666">Raw Measurements</h3>
        ${l0?`<div style="margin-bottom:.75rem"><strong style="font-size:.85rem;color:#555">Layer 0 — Reaction Time</strong><div class="score-grid" style="margin-top:.5rem">
          <div class="score-card"><div class="label">Mean Reaction Time</div><div class="value">${f(l0.meanRT,'ms')}</div></div>
          <div class="score-card"><div class="label">RT Std Dev</div><div class="value">${f(l0.rtStd,'ms')}</div></div></div></div>`:''}
        ${l1?`<div style="margin-bottom:.75rem"><strong style="font-size:.85rem;color:#555">Layer 1 — Tracking</strong><div class="score-grid" style="margin-top:.5rem">
          <div class="score-card"><div class="label">Tracking Error</div><div class="value">${f(l1.meanTrackingError,'px')}</div></div>
          <div class="score-card"><div class="label">Overshoots/min</div><div class="value">${f(l1.overshootRate)}</div></div></div></div>`:''}
        ${l2?`<div style="margin-bottom:.75rem"><strong style="font-size:.85rem;color:#555">Layer 2 — Track + Audio</strong><div class="score-grid" style="margin-top:.5rem">
          <div class="score-card"><div class="label">Tracking Error</div><div class="value">${f(l2.meanTrackingError,'px')}</div></div>
          <div class="score-card"><div class="label">Audio Response</div><div class="value">${f(l2.meanAudioRT,'ms')}</div></div>
          <div class="score-card"><div class="label">Audio Accuracy</div><div class="value">${l2.audioAccuracy!=null?(l2.audioAccuracy*100).toFixed(0)+'%':'\u2014'}</div></div>
          <div class="score-card"><div class="label">Recovery Period</div><div class="value">${f(l2.meanPRPDuration,'ms')}</div></div></div></div>`:''}
        ${l3?`<div style="margin-bottom:.75rem"><strong style="font-size:.85rem;color:#555">Layer 3 — Full Load</strong><div class="score-grid" style="margin-top:.5rem">
          <div class="score-card"><div class="label">Tracking Error</div><div class="value">${f(l3.meanTrackingError,'px')}</div></div>
          <div class="score-card"><div class="label">Audio Response</div><div class="value">${f(l3.meanAudioRT,'ms')}</div></div>
          <div class="score-card"><div class="label">Cooldown Delay</div><div class="value">${f(l3.meanCooldownDelay,'ms')}</div></div>
          <div class="score-card"><div class="label">Peripheral Response</div><div class="value">${f(l3.meanPeripheralRT,'ms')}</div></div>
          <div class="score-card"><div class="label">Peripheral Missed</div><div class="value">${l3.peripheralMissRate!=null?(l3.peripheralMissRate*100).toFixed(0)+'%':'\u2014'}</div></div></div></div>`:''}
      `;
      const resultsContainer = this.contentContainer.querySelector('.results-container');
      const actionsDiv = this.contentContainer.querySelector('.results-actions');
      if (resultsContainer && actionsDiv) resultsContainer.insertBefore(rawSection, actionsDiv);
    }
    document.getElementById('res-new')?.addEventListener('click', () => this.showState('checkin'));
    document.getElementById('res-dash')?.addEventListener('click', () => this.showState('dashboard'));
  }

  // === DASHBOARD ===
  private async showDashboard(): Promise<void> {
    if (!this.contentContainer) return;
    const sessions = await db.getAllSessions(100);
    const allTags = await db.getAllTags();
    this.comparisonIds.clear();

    this.injectStyle(`
      .dash{max-width:1200px;margin:2rem auto;padding:0 2rem}.dash h2{margin-bottom:.25rem}.dash-sub{color:#888;margin-bottom:1rem}
      .session-table{width:100%;border-collapse:collapse}.session-table th{text-align:left;padding:.6rem .8rem;border-bottom:2px solid var(--border,#e0e0e0);font-size:.78rem;color:#888;text-transform:uppercase;letter-spacing:.03em}
      .session-table td{padding:.5rem .8rem;border-bottom:1px solid var(--border-light,#f0f0f0);font-size:.9rem}
      .session-table tr.clickable{cursor:pointer;transition:background .15s}.session-table tr.clickable:hover{background:rgba(33,150,243,.06)}.session-table tr.selected{background:rgba(33,150,243,.1)}
      .crs-pill{display:inline-block;padding:.15rem .55rem;border-radius:20px;font-weight:600;font-size:.82rem}.crs-pill.good{background:#e8f5e9;color:#2e7d32}.crs-pill.ok{background:#fff3e0;color:#e65100}.crs-pill.bad{background:#ffebee;color:#c62828}.crs-pill.none{background:#f5f5f5;color:#999}
      .btn{padding:.6rem 1.2rem;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:.88rem}.btn-primary{background:#2196f3;color:#fff}.btn-primary:hover{background:#1976d2}.btn-danger{background:#f44336;color:#fff}.btn-danger:hover{background:#d32f2f}.btn-secondary{background:var(--btn-sec,#e0e0e0);color:var(--text,#333)}.btn-secondary:hover{background:#bdbdbd}.btn-sm{padding:.3rem .65rem;font-size:.78rem}
      .dash-actions{display:flex;gap:.6rem;margin-top:2rem;flex-wrap:wrap}
      .detail-panel{background:var(--surface-alt,#f8f9fa);border-radius:16px;padding:1.75rem;margin-top:1.5rem}.detail-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;flex-wrap:wrap;gap:.5rem}.detail-header h3{margin:0}
      .detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.85rem}.detail-card{background:var(--card,#fff);border-radius:10px;padding:.9rem;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.06)}.detail-card .label{font-size:.75rem;color:#888;margin-bottom:.35rem}.detail-card .value{font-size:1.25rem;font-weight:600}
      .detail-metrics{margin-top:1.25rem}.detail-metrics h4{margin:.85rem 0 .4rem;color:#555;font-size:.9rem}.metrics-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:.5rem}
      .metric-item{background:var(--card,#fff);border-radius:8px;padding:.6rem;font-size:.8rem;box-shadow:0 1px 3px rgba(0,0,0,.04)}.metric-item .m-label{color:#888}.metric-item .m-val{font-weight:600;margin-top:.15rem}
      .detail-actions{display:flex;gap:.5rem;margin-top:1.25rem;flex-wrap:wrap}
      .empty-state{text-align:center;padding:4rem 2rem;color:#888}
      .trend-section{background:var(--surface-alt,#f8f9fa);border-radius:16px;padding:1.5rem;margin-bottom:1.5rem}.trend-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:.75rem}.trend-header h3{margin:0;font-size:1rem}
      .trend-toggles{display:flex;gap:.3rem;flex-wrap:wrap}.trend-btn{padding:.25rem .6rem;border:1px solid #ddd;border-radius:6px;background:var(--card,#fff);cursor:pointer;font-size:.75rem;font-weight:500;color:#666;transition:all .15s}.trend-btn:hover{border-color:#2196f3;color:#2196f3}.trend-btn.active{background:#2196f3;color:#fff;border-color:#2196f3}
      #trend-chart{width:100%;height:230px;position:relative}#trend-chart svg{width:100%;height:100%}.chart-line{fill:none;stroke-width:2.5}.chart-dot{stroke:#fff;stroke-width:2;cursor:pointer}.chart-area{opacity:.08}.chart-grid line{stroke:#e0e0e0;stroke-dasharray:3,3}.chart-axis text{font-size:10px;fill:#888}.chart-axis path,.chart-axis line{stroke:#ddd}.chart-tooltip{position:absolute;background:#333;color:#fff;padding:.3rem .6rem;border-radius:6px;font-size:.75rem;pointer-events:none;white-space:nowrap;z-index:100}
      .tag-bar{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:1rem;align-items:center}.tag-chip{display:inline-flex;align-items:center;gap:.25rem;padding:.15rem .5rem;border-radius:12px;background:rgba(33,150,243,.1);color:#1976d2;font-size:.78rem;cursor:pointer;transition:all .15s}.tag-chip:hover,.tag-chip.active{background:#2196f3;color:#fff}.tag-chip .rm-tag{font-size:.68rem;opacity:.7;cursor:pointer}
      .notes-area{width:100%;min-height:55px;border:1px solid var(--border,#ddd);border-radius:8px;padding:.5rem;font-family:inherit;font-size:.85rem;resize:vertical;background:var(--card,#fff);color:var(--text,#333)}.notes-area:focus{outline:none;border-color:#2196f3}
      .insight-card{background:var(--surface-alt,#f8f9fa);border:1px solid var(--border-light,#eee);border-radius:12px;padding:1rem;margin-bottom:.75rem}.insight-card h4{margin:0 0 .4rem;font-size:.9rem}.insight-val{font-size:1.05rem;font-weight:600}.insight-sub{font-size:.78rem;color:#888;margin-top:.2rem}
      .compare-panel{background:var(--surface-alt,#f8f9fa);border-radius:16px;padding:1.75rem;margin-top:1.5rem}.compare-row{display:flex;justify-content:space-between;padding:.35rem 0;border-bottom:1px solid var(--border-light,#f0f0f0);font-size:.82rem}.compare-better{color:#2e7d32;font-weight:600}.compare-worse{color:#c62828;font-weight:600}
      .cb-compare{width:15px;height:15px;cursor:pointer;accent-color:#2196f3}
    `);

    this.contentContainer.innerHTML = `<div class="dash">
      <h2>Session History</h2>
      <p class="dash-sub">${sessions.length} session${sessions.length!==1?'s':''} recorded</p>
      ${allTags.length > 0 ? `<div class="tag-bar" id="tag-bar"><span style="font-size:.82rem;color:#888;margin-right:.25rem">Filter:</span><span class="tag-chip active" data-tag="">All</span>${allTags.map(t => `<span class="tag-chip" data-tag="${t}">${t}</span>`).join('')}</div>` : ''}
      ${sessions.length >= 2 ? `<div class="trend-section"><div class="trend-header"><h3>Performance Trend</h3><div class="trend-toggles" id="trend-toggles"><button class="trend-btn active" data-metric="crs">Readiness</button><button class="trend-btn" data-metric="lpi0">Reaction</button><button class="trend-btn" data-metric="lpi1">Tracking</button><button class="trend-btn" data-metric="lpi2">Audio</button><button class="trend-btn" data-metric="lpi3">Full Load</button><button class="trend-btn" data-metric="dc">Tolerance</button></div></div><div id="trend-chart"></div></div>` : ''}
      <div id="insights-target"></div>
      ${sessions.length === 0 ? '<div class="empty-state"><p style="font-size:2rem">\ud83d\udcca</p><p>No sessions yet.</p></div>' :
        `<table class="session-table"><thead><tr><th style="width:28px"></th><th>Date</th><th>Readiness</th><th>Reaction</th><th>Tracking</th><th>Audio</th><th>Full Load</th><th>Tolerance</th><th>Tags</th></tr></thead>
        <tbody id="session-tbody">${sessions.map(s => {
          const isCal = s.crs == null;
          return `<tr class="clickable" data-sid="${s.id}"><td><input type="checkbox" class="cb-compare" data-id="${s.id}"></td><td>${s.timestamp.toLocaleDateString()} ${s.timestamp.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td><td>${isCal ? '<span class="crs-pill none">Cal.</span>' : `<span class="crs-pill ${this.crsClass(s.crs)}">${s.crs?.toFixed(1)??'\u2014'}</span>`}</td><td>${isCal?'—':s.lpi0?.toFixed(0)??'\u2014'}</td><td>${isCal?'—':s.lpi1?.toFixed(0)??'\u2014'}</td><td>${isCal?'—':s.lpi2?.toFixed(0)??'\u2014'}</td><td>${isCal?'—':s.lpi3?.toFixed(0)??'\u2014'}</td><td>${isCal?'—':s.degradationCoeff!=null?(s.degradationCoeff*100).toFixed(0)+'%':'\u2014'}</td><td>${s.tags.map(t=>`<span class="tag-chip" style="font-size:.68rem;padding:.1rem .35rem">${t}</span>`).join(' ')}</td></tr>`;
        }).join('')}</tbody></table>`}
      <div id="compare-target"></div><div id="detail-target"></div>
      <div class="dash-actions"><button class="btn btn-primary" id="dash-new">New Session</button><button class="btn btn-secondary" id="dash-cmp" style="display:none">Compare Selected</button><button class="btn btn-secondary" id="dash-exp">Export All CSV</button>${sessions.length>0?'<button class="btn btn-danger" id="dash-rst">Delete All</button>':''}</div></div>`;

    // Trend
    if (sessions.length >= 2) {
      this.renderTrendChart(sessions, 'crs');
      document.getElementById('trend-toggles')?.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest('.trend-btn'); if (!b) return;
        document.querySelectorAll('.trend-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active'); this.renderTrendChart(sessions, b.getAttribute('data-metric')!);
      });
    }
    this.renderInsights();
    // Tag filter
    document.getElementById('tag-bar')?.addEventListener('click', e => {
      const c = (e.target as HTMLElement).closest('.tag-chip') as HTMLElement; if (!c) return;
      const tag = c.dataset.tag || '';
      document.querySelectorAll('#tag-bar .tag-chip').forEach(x => x.classList.remove('active')); c.classList.add('active');
      document.querySelectorAll('#session-tbody tr').forEach(tr => {
        const s = sessions.find(x => x.id === (tr as HTMLElement).dataset.sid);
        (tr as HTMLElement).style.display = (!tag || s?.tags.includes(tag)) ? '' : 'none';
      });
    });
    // Row clicks
    document.getElementById('session-tbody')?.addEventListener('click', e => {
      if ((e.target as HTMLElement).classList.contains('cb-compare')) return;
      const row = (e.target as HTMLElement).closest('tr[data-sid]');
      if (row) this.showSessionDetail(row.getAttribute('data-sid')!, sessions);
    });
    // Compare checkboxes
    const cmpBtn = document.getElementById('dash-cmp')!;
    document.querySelectorAll('.cb-compare').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = (cb as HTMLInputElement).dataset.id!;
        if ((cb as HTMLInputElement).checked) this.comparisonIds.add(id); else this.comparisonIds.delete(id);
        cmpBtn.style.display = this.comparisonIds.size === 2 ? '' : 'none';
      });
    });
    cmpBtn.addEventListener('click', () => this.showComparison(sessions));
    document.getElementById('dash-new')?.addEventListener('click', () => this.showState('checkin'));
    document.getElementById('dash-exp')?.addEventListener('click', () => this.exportAll());
    document.getElementById('dash-rst')?.addEventListener('click', () => this.resetAll(sessions));
  }

  // === SESSION DETAIL (notes + tags) ===
  private async showSessionDetail(sid: string, sessions: Session[]): Promise<void> {
    const session = sessions.find(s => s.id === sid);
    if (!session) return;
    const lms = await db.getLayerMetrics(sid);
    const checkin = session.checkinId ? await db.getCheckin(session.checkinId) : null;
    const target = document.getElementById('detail-target')!;
    document.querySelectorAll('.session-table tr.selected').forEach(r => r.classList.remove('selected'));
    document.querySelector(`tr[data-sid="${sid}"]`)?.classList.add('selected');
    const f = (v: number|undefined, u='') => v != null ? `${v.toFixed(1)}${u}` : '\u2014';
    const l0=lms.find(m=>m.layer===0),l1=lms.find(m=>m.layer===1),l2=lms.find(m=>m.layer===2),l3=lms.find(m=>m.layer===3);

    target.innerHTML = `<div class="detail-panel"><div class="detail-header"><h3>Session Details</h3><span style="color:#888;font-size:.82rem">${session.timestamp.toLocaleString()} \u00b7 ${session.id.slice(0,8)}</span></div>
      ${checkin ? `<div style="margin-bottom:1rem;padding:.7rem;background:var(--card,#fff);border-radius:10px;font-size:.82rem;color:#666"><strong>Check-in:</strong> Sleep ${checkin.sleepQuality??'?'}/5 \u00b7 State ${checkin.currentState??'?'}/5 \u00b7 Stress ${checkin.stressLevel??'?'}/5${checkin.symptomLabel?` \u00b7 ${checkin.symptomLabel} (${checkin.symptomSeverity}/3)`:''}${checkin.substances?.length?` \u00b7 ${checkin.substances.join(', ')}`:''}${checkin.freeNotes?` \u00b7 "${checkin.freeNotes}"`:''}</div>` : ''}
      ${session.crs != null ? `<div class="detail-grid">
        <div class="detail-card"><div class="label">Cognitive Readiness</div><div class="value" style="color:${session.crs!=null&&session.crs>=70?'#2e7d32':session.crs!=null&&session.crs>=40?'#e65100':'#c62828'}">${session.crs?.toFixed(1)??'\u2014'}</div></div>
        <div class="detail-card"><div class="label">Reaction Time (L0)</div><div class="value">${session.lpi0?.toFixed(1)??'\u2014'}</div></div>
        <div class="detail-card"><div class="label">Tracking (L1)</div><div class="value">${session.lpi1?.toFixed(1)??'\u2014'}</div></div>
        <div class="detail-card"><div class="label">Track + Audio (L2)</div><div class="value">${session.lpi2?.toFixed(1)??'\u2014'}</div></div>
        <div class="detail-card"><div class="label">Full Load (L3)</div><div class="value">${session.lpi3?.toFixed(1)??'\u2014'}</div></div>
        <div class="detail-card"><div class="label">Load Tolerance</div><div class="value">${session.degradationCoeff!=null?(session.degradationCoeff*100).toFixed(0)+'%':'\u2014'}</div></div>
      </div>` : `<div style="padding:.6rem;background:var(--card,#fff);border-radius:10px;margin-bottom:.75rem;text-align:center;color:#ff9800;font-size:.85rem">⏳ Calibration session — raw measurements only</div>`}
      <div class="detail-metrics">
        ${l0?`<h4>Layer 0 — Reaction Time</h4><div class="metrics-row"><div class="metric-item"><div class="m-label">Mean Reaction Time</div><div class="m-val">${f(l0.meanRT,'ms')}</div></div><div class="metric-item"><div class="m-label">RT Std Dev</div><div class="m-val">${f(l0.rtStd,'ms')}</div></div><div class="metric-item"><div class="m-label">Anticipations</div><div class="m-val">${l0.anticipationCount??0}</div></div><div class="metric-item"><div class="m-label">Lapses</div><div class="m-val">${l0.lapseCount??0}</div></div></div>`:''}
        ${l1?`<h4>Layer 1 — Visual Tracking</h4><div class="metrics-row"><div class="metric-item"><div class="m-label">Tracking Error</div><div class="m-val">${f(l1.meanTrackingError,'px')}</div></div><div class="metric-item"><div class="m-label">Movement Jerk</div><div class="m-val">${f(l1.meanJerk)}</div></div><div class="metric-item"><div class="m-label">Overshoots/min</div><div class="m-val">${f(l1.overshootRate)}</div></div></div>`:''}
        ${l2?`<h4>Layer 2 — Tracking + Audio</h4><div class="metrics-row"><div class="metric-item"><div class="m-label">Tracking Error</div><div class="m-val">${f(l2.meanTrackingError,'px')}</div></div><div class="metric-item"><div class="m-label">Audio Response</div><div class="m-val">${f(l2.meanAudioRT,'ms')}</div></div><div class="metric-item"><div class="m-label">Audio Accuracy</div><div class="m-val">${l2.audioAccuracy!=null?(l2.audioAccuracy*100).toFixed(0)+'%':'\u2014'}</div></div><div class="metric-item"><div class="m-label">Recovery Period</div><div class="m-val">${f(l2.meanPRPDuration,'ms')}</div></div></div>`:''}
        ${l3?`<h4>Layer 3 — Full Cognitive Load</h4><div class="metrics-row"><div class="metric-item"><div class="m-label">Tracking Error</div><div class="m-val">${f(l3.meanTrackingError,'px')}</div></div><div class="metric-item"><div class="m-label">Audio Response</div><div class="m-val">${f(l3.meanAudioRT,'ms')}</div></div><div class="metric-item"><div class="m-label">Recovery Period</div><div class="m-val">${f(l3.meanPRPDuration,'ms')}</div></div><div class="metric-item"><div class="m-label">Cooldown Delay</div><div class="m-val">${f(l3.meanCooldownDelay,'ms')}</div></div><div class="metric-item"><div class="m-label">Peripheral Response</div><div class="m-val">${f(l3.meanPeripheralRT,'ms')}</div></div><div class="metric-item"><div class="m-label">Peripheral Missed</div><div class="m-val">${l3.peripheralMissRate!=null?(l3.peripheralMissRate*100).toFixed(0)+'%':'\u2014'}</div></div></div>`:''}
      </div>
      <div style="margin-top:1.1rem"><div id="degradation-chart-${sid}" style="width:100%;height:200px"></div></div>
      <div style="margin-top:1.1rem"><label style="font-size:.82rem;font-weight:600;color:#555;display:block;margin-bottom:.35rem">Notes</label>
        <textarea class="notes-area" id="d-notes" placeholder="Add notes...">${session.notes||''}</textarea>
        <button class="btn btn-sm btn-secondary" id="save-notes" style="margin-top:.3rem">Save Notes</button></div>
      <div style="margin-top:.9rem"><label style="font-size:.82rem;font-weight:600;color:#555;display:block;margin-bottom:.35rem">Tags</label>
        <div style="display:flex;gap:.35rem;flex-wrap:wrap;align-items:center" id="d-tags">
          ${session.tags.map(t=>`<span class="tag-chip">${t} <span class="rm-tag" data-tag="${t}">\u00d7</span></span>`).join('')}
          <input type="text" id="add-tag" placeholder="Add tag..." style="border:1px solid #ddd;border-radius:6px;padding:.2rem .45rem;font-size:.8rem;width:95px;background:var(--card,#fff);color:var(--text,#333)">
        </div></div>
      <div style="margin-top:.6rem;font-size:.78rem;color:#999">Stalls: ${session.systemStalls}</div>
      <div class="detail-actions"><button class="btn btn-secondary btn-sm" id="d-exp">Export</button><button class="btn btn-danger btn-sm" id="d-del">Delete</button><button class="btn btn-secondary btn-sm" id="d-close">Close</button></div></div>`;

    document.getElementById('save-notes')?.addEventListener('click', async () => {
      const n = (document.getElementById('d-notes') as HTMLTextAreaElement).value;
      await db.updateSessionNotes(sid, n); session.notes = n;
    });

    // Render degradation curve chart
    this.renderDegradationCurve(sid, session);
    document.getElementById('d-tags')?.addEventListener('click', async e => {
      const rm = (e.target as HTMLElement).closest('.rm-tag') as HTMLElement;
      if (rm) { await db.removeSessionTag(sid, rm.dataset.tag!); session.tags = session.tags.filter(t=>t!==rm.dataset.tag); this.showSessionDetail(sid, sessions); }
    });
    document.getElementById('add-tag')?.addEventListener('keydown', async (e: Event) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        const inp = e.target as HTMLInputElement; const tag = inp.value.trim().toLowerCase();
        if (tag && !session.tags.includes(tag)) { await db.addSessionTag(sid, tag); session.tags.push(tag); this.showSessionDetail(sid, sessions); }
        inp.value = '';
      }
    });
    document.getElementById('d-exp')?.addEventListener('click', () => this.exportSession(session));
    document.getElementById('d-del')?.addEventListener('click', () => this.confirmDel(session));
    document.getElementById('d-close')?.addEventListener('click', () => { target.innerHTML = ''; document.querySelectorAll('.session-table tr.selected').forEach(r=>r.classList.remove('selected')); });
    target.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }

  // === INSIGHTS (correlation analysis) ===
  private async renderInsights(): Promise<void> {
    const target = document.getElementById('insights-target'); if (!target) return;
    const data = await db.getCheckinsWithScores();
    const valid = data.filter(d => d.crs != null);
    if (valid.length < 8) return;
    const insights: string[] = [];

    const sleepPairs = valid.filter(d => d.sleepQuality != null);
    if (sleepPairs.length >= 8) {
      const rho = Statistics.spearmanCorrelation(sleepPairs.map(d=>d.sleepQuality!), sleepPairs.map(d=>d.crs!));
      if (Math.abs(rho) >= 0.25) {
        const dir = rho > 0 ? 'better' : 'worse';
        insights.push(`<div class="insight-card"><h4>\ud83d\udca4 Sleep \u2192 Performance</h4><div class="insight-val">\u03c1 = ${rho.toFixed(2)}</div><div class="insight-sub">Higher sleep quality correlates with ${dir} CRS (n=${sleepPairs.length})</div></div>`);
      }
    }
    const stressPairs = valid.filter(d => d.stressLevel != null);
    if (stressPairs.length >= 8) {
      const rho = Statistics.spearmanCorrelation(stressPairs.map(d=>d.stressLevel!), stressPairs.map(d=>d.crs!));
      if (Math.abs(rho) >= 0.25) {
        const dir = rho > 0 ? 'better' : 'worse';
        insights.push(`<div class="insight-card"><h4>\ud83d\ude30 Stress \u2192 Performance</h4><div class="insight-val">\u03c1 = ${rho.toFixed(2)}</div><div class="insight-sub">Higher stress correlates with ${dir} CRS (n=${stressPairs.length})</div></div>`);
      }
    }
    const cafPairs = valid.filter(d => d.substances?.length > 0);
    const noCafPairs = valid.filter(d => !d.substances?.length || d.substances.every(s => s === 'none'));
    if (cafPairs.length >= 4 && noCafPairs.length >= 4) {
      const cafM = cafPairs.reduce((s,d) => s + d.crs!, 0) / cafPairs.length;
      const noM = noCafPairs.reduce((s,d) => s + d.crs!, 0) / noCafPairs.length;
      const diff = cafM - noM;
      if (Math.abs(diff) >= 2) insights.push(`<div class="insight-card"><h4>\u2615 Substances Effect</h4><div class="insight-val">${diff>0?'+':''}${diff.toFixed(1)} CRS</div><div class="insight-sub">With vs without substances (${cafPairs.length} vs ${noCafPairs.length} sessions)</div></div>`);
    }
    if (insights.length > 0) target.innerHTML = `<div style="margin-bottom:1.5rem"><h3 style="font-size:1rem;margin-bottom:.6rem">\ud83d\udcc8 Insights</h3>${insights.join('')}</div>`;
  }

  // === SESSION COMPARISON ===
  private async showComparison(sessions: Session[]): Promise<void> {
    const ids = [...this.comparisonIds]; if (ids.length !== 2) return;
    const s1 = sessions.find(s => s.id === ids[0])!, s2 = sessions.find(s => s.id === ids[1])!;
    const m1 = await db.getLayerMetrics(ids[0]), m2 = await db.getLayerMetrics(ids[1]);
    const target = document.getElementById('compare-target')!;

    const cmp = (label: string, v1: number|undefined|null, v2: number|undefined|null, unit='', lowerBetter=true) => {
      if (v1 == null && v2 == null) return '';
      const f1 = v1 != null ? v1.toFixed(1)+unit : '\u2014', f2 = v2 != null ? v2.toFixed(1)+unit : '\u2014';
      let c1='', c2='';
      if (v1 != null && v2 != null) {
        const better = lowerBetter ? v1 < v2 : v1 > v2;
        c1 = better ? 'compare-better' : v1===v2 ? '' : 'compare-worse';
        c2 = !better ? 'compare-better' : v1===v2 ? '' : 'compare-worse';
      }
      return `<div class="compare-row"><span class="${c1}">${f1}</span><span style="color:#888;font-size:.78rem">${label}</span><span class="${c2}">${f2}</span></div>`;
    };
    const l0a=m1.find(m=>m.layer===0),l0b=m2.find(m=>m.layer===0),l1a=m1.find(m=>m.layer===1),l1b=m2.find(m=>m.layer===1);
    const l2a=m1.find(m=>m.layer===2),l2b=m2.find(m=>m.layer===2),l3a=m1.find(m=>m.layer===3),l3b=m2.find(m=>m.layer===3);
    const dt = (s: Session) => `${s.timestamp.toLocaleDateString()} ${s.timestamp.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;

    target.innerHTML = `<div class="compare-panel"><div class="detail-header"><h3>Session Comparison</h3><button class="btn btn-sm btn-secondary" id="close-cmp">Close</button></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem">
        <div><h4 style="text-align:center;margin-bottom:.6rem;font-size:.9rem">${dt(s1)}</h4>
          ${cmp('Readiness',s1.crs,s2.crs,'',false)}${cmp('Tolerance',s1.degradationCoeff!=null?s1.degradationCoeff*100:null,s2.degradationCoeff!=null?s2.degradationCoeff*100:null,'%',false)}
          ${cmp('Reaction (L0)',s1.lpi0,s2.lpi0,'',false)}${cmp('Full Load (L3)',s1.lpi3,s2.lpi3,'',false)}
          ${cmp('Mean RT',l0a?.meanRT,l0b?.meanRT,'ms')}${cmp('Track Error',l1a?.meanTrackingError,l1b?.meanTrackingError,'px')}
          ${cmp('Audio Response',l2a?.meanAudioRT,l2b?.meanAudioRT,'ms')}${cmp('Recovery Period',l2a?.meanPRPDuration,l2b?.meanPRPDuration,'ms')}
          ${cmp('Peripheral RT',l3a?.meanPeripheralRT,l3b?.meanPeripheralRT,'ms')}</div>
        <div><h4 style="text-align:center;margin-bottom:.6rem;font-size:.9rem">${dt(s2)}</h4>
          ${cmp('Readiness',s2.crs,s1.crs,'',false)}${cmp('Tolerance',s2.degradationCoeff!=null?s2.degradationCoeff*100:null,s1.degradationCoeff!=null?s1.degradationCoeff*100:null,'%',false)}
          ${cmp('Reaction (L0)',s2.lpi0,s1.lpi0,'',false)}${cmp('Full Load (L3)',s2.lpi3,s1.lpi3,'',false)}
          ${cmp('Mean RT',l0b?.meanRT,l0a?.meanRT,'ms')}${cmp('Track Error',l1b?.meanTrackingError,l1a?.meanTrackingError,'px')}
          ${cmp('Audio Response',l2b?.meanAudioRT,l2a?.meanAudioRT,'ms')}${cmp('Recovery Period',l2b?.meanPRPDuration,l2a?.meanPRPDuration,'ms')}
          ${cmp('Peripheral RT',l3b?.meanPeripheralRT,l3a?.meanPeripheralRT,'ms')}</div>
      </div></div>`;
    document.getElementById('close-cmp')?.addEventListener('click', () => { target.innerHTML = ''; });
    target.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }

  // === DEGRADATION CURVE (per-session detail) ===
  private renderDegradationCurve(sid: string, session: Session): void {
    const container = document.getElementById(`degradation-chart-${sid}`);
    if (!container) return;
    container.innerHTML = '';

    // Skip chart if session has no computed scores (calibration period)
    if (session.lpi0 == null && session.lpi1 == null && session.lpi2 == null && session.lpi3 == null) {
      return;
    }

    const data = [
      { layer: 0, lpi: session.lpi0 ?? 0, label: 'Reaction' },
      { layer: 1, lpi: session.lpi1 ?? 0, label: 'Tracking' },
      { layer: 2, lpi: session.lpi2 ?? 0, label: 'Audio' },
      { layer: 3, lpi: session.lpi3 ?? 0, label: 'Full Load' }
    ];

    const rect = container.getBoundingClientRect();
    const W = rect.width || 500, H = 200;
    const mg = { top: 20, right: 25, bottom: 35, left: 42 };
    const iW = W - mg.left - mg.right, iH = H - mg.top - mg.bottom;

    const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${W} ${H}`);
    const g = svg.append('g').attr('transform', `translate(${mg.left},${mg.top})`);

    const xS = d3.scalePoint<string>().domain(data.map(d => d.label)).range([0, iW]).padding(0.3);
    const yS = d3.scaleLinear().domain([0, 100]).range([iH, 0]);

    // Grid
    g.append('g').attr('class', 'chart-grid').call(d3.axisLeft(yS).ticks(4).tickSize(-iW).tickFormat(() => ''));

    // Area fill
    const area = d3.area<typeof data[0]>()
      .x(d => xS(d.label)!)
      .y0(iH)
      .y1(d => yS(d.lpi))
      .curve(d3.curveMonotoneX);
    g.append('path').datum(data).attr('fill', '#2196f3').attr('opacity', 0.08).attr('d', area);

    // Line
    const line = d3.line<typeof data[0]>()
      .x(d => xS(d.label)!)
      .y(d => yS(d.lpi))
      .curve(d3.curveMonotoneX);
    g.append('path').datum(data).attr('fill', 'none').attr('stroke', '#2196f3').attr('stroke-width', 2.5).attr('d', line);

    // Points with values
    g.selectAll('.deg-dot').data(data).join('circle')
      .attr('cx', d => xS(d.label)!).attr('cy', d => yS(d.lpi)).attr('r', 4.5)
      .attr('fill', d => d.lpi >= 60 ? '#4caf50' : d.lpi >= 30 ? '#ff9800' : '#f44336')
      .attr('stroke', '#fff').attr('stroke-width', 2);

    g.selectAll('.deg-val').data(data).join('text')
      .attr('x', d => xS(d.label)!).attr('y', d => yS(d.lpi) - 10)
      .attr('text-anchor', 'middle').style('font-size', '11px').style('font-weight', '600')
      .style('fill', 'var(--text, #333)')
      .text(d => d.lpi.toFixed(0));

    // Axes
    g.append('g').attr('transform', `translate(0,${iH})`).call(d3.axisBottom(xS)).selectAll('text').style('font-size', '10px');
    g.append('g').call(d3.axisLeft(yS).ticks(4)).selectAll('text').style('font-size', '10px');

    // Title
    g.append('text').attr('x', iW / 2).attr('y', -6).attr('text-anchor', 'middle')
      .style('font-size', '11px').style('fill', '#888').text('Performance Degradation Under Load');
  }

  // === TREND CHART (D3) ===
  private renderTrendChart(sessions: Session[], metric: string): void {
    const container = document.getElementById('trend-chart'); if (!container) return;
    container.innerHTML = '';
    const chrono = [...sessions].reverse();
    const data: Array<{date:Date;value:number}> = [];
    for (const s of chrono) {
      let v: number|null = null;
      switch(metric) { case 'crs':v=s.crs;break;case 'lpi0':v=s.lpi0;break;case 'lpi1':v=s.lpi1;break;case 'lpi2':v=s.lpi2;break;case 'lpi3':v=s.lpi3;break;
        case 'dc':v=s.degradationCoeff!=null?s.degradationCoeff*100:null;break; }
      if (v != null) data.push({date:s.timestamp,value:v});
    }
    if (data.length < 1) { container.innerHTML = '<p style="text-align:center;color:#999;padding:2rem">No data.</p>'; return; }
    const labels: Record<string,string> = {crs:'Cognitive Readiness',lpi0:'Reaction Time (L0)',lpi1:'Tracking (L1)',lpi2:'Track + Audio (L2)',lpi3:'Full Load (L3)',dc:'Load Tolerance %'};
    const color = metric === 'dc' ? '#ff9800' : '#2196f3';
    const rect = container.getBoundingClientRect();
    const W = rect.width||800, H = 230, mg = {top:18,right:25,bottom:32,left:42};
    const iW = W-mg.left-mg.right, iH = H-mg.top-mg.bottom;
    const svg = d3.select(container).append('svg').attr('viewBox',`0 0 ${W} ${H}`);
    const g = svg.append('g').attr('transform',`translate(${mg.left},${mg.top})`);
    const xS = d3.scaleTime().domain(d3.extent(data,d=>d.date) as [Date,Date]).range([0,iW]);
    const yMin = Math.min(d3.min(data,d=>d.value)!*0.9,0), yMax = Math.max(d3.max(data,d=>d.value)!*1.1,100);
    const yS = d3.scaleLinear().domain([yMin,yMax]).range([iH,0]);
    g.append('g').attr('class','chart-grid').call(d3.axisLeft(yS).ticks(5).tickSize(-iW).tickFormat(()=>''));
    g.append('g').attr('class','chart-axis').attr('transform',`translate(0,${iH})`).call(d3.axisBottom(xS).ticks(Math.min(data.length,7)).tickFormat(d=>{const dt=d as Date;return`${dt.getMonth()+1}/${dt.getDate()}`;}));
    g.append('g').attr('class','chart-axis').call(d3.axisLeft(yS).ticks(5));
    g.append('path').datum(data).attr('class','chart-area').attr('fill',color).attr('d',d3.area<typeof data[0]>().x(d=>xS(d.date)).y0(iH).y1(d=>yS(d.value)).curve(d3.curveMonotoneX));
    g.append('path').datum(data).attr('class','chart-line').attr('stroke',color).attr('d',d3.line<typeof data[0]>().x(d=>xS(d.date)).y(d=>yS(d.value)).curve(d3.curveMonotoneX));
    const tip = d3.select(container).append('div').attr('class','chart-tooltip').style('opacity',0);
    g.selectAll('.chart-dot').data(data).join('circle').attr('class','chart-dot').attr('cx',d=>xS(d.date)).attr('cy',d=>yS(d.value)).attr('r',3.5).attr('fill',color)
      .on('mouseover',(ev,d)=>{tip.transition().duration(80).style('opacity',1);tip.html(`<strong>${d.value.toFixed(1)}</strong> ${labels[metric]}<br>${d.date.toLocaleDateString()}`).style('left',(ev.offsetX+10)+'px').style('top',(ev.offsetY-28)+'px');})
      .on('mouseout',()=>{tip.transition().duration(150).style('opacity',0);});
    if (data.length >= 5 && chrono.length >= 5) {
      const ce = chrono[4].timestamp;
      if (xS(ce)>0) { g.append('rect').attr('x',0).attr('y',0).attr('width',Math.min(xS(ce),iW)).attr('height',iH).attr('fill','#ff9800').attr('opacity',.04);
        g.append('text').attr('x',Math.min(xS(ce),iW)/2).attr('y',11).attr('text-anchor','middle').style('font-size','9px').style('fill','#ff9800').text('Calibration'); }
    }
  }

  // === UTILITIES ===
  private crsClass(crs:number|null):string { if(crs==null)return'none';if(crs>=70)return'good';if(crs>=40)return'ok';return'bad'; }

  private async confirmDel(s: Session): Promise<void> {
    if (!confirm(`Delete session from ${s.timestamp.toLocaleString()}?`)) return;
    await db.deleteSession(s.id); await this.showState('dashboard');
  }
  private async resetAll(sessions: Session[]): Promise<void> {
    if (!confirm(`Delete ALL ${sessions.length} sessions? Cannot be undone.`)) return;
    if (!confirm('Absolutely sure?')) return;
    await db.deleteAllData(); await this.showState('dashboard');
  }
  private exportSession(s: Session): void {
    const rows = [['Metric','Value'],['ID',s.id],['Time',s.timestamp.toISOString()],['CRS',s.crs?.toString()??''],['DC',s.degradationCoeff?.toString()??''],
      ['LPI0',s.lpi0?.toString()??''],['LPI1',s.lpi1?.toString()??''],['LPI2',s.lpi2?.toString()??''],['LPI3',s.lpi3?.toString()??''],
      ['Stalls',s.systemStalls.toString()],['Tags',s.tags.join(';')],['Notes',(s.notes||'').replace(/,/g,';')]];
    this.dlCSV(rows.map(r=>r.join(',')).join('\n'), `clst-${s.id.slice(0,8)}.csv`);
  }
  private async exportAll(): Promise<void> { const csv = await db.exportAllSessions(); if (csv) this.dlCSV(csv, `clst-all-${new Date().toISOString().slice(0,10)}.csv`); }
  private dlCSV(csv:string, fn:string): void {
    const b = new Blob([csv],{type:'text/csv'}), u = URL.createObjectURL(b), a = document.createElement('a');
    a.href = u; a.download = fn; a.click(); URL.revokeObjectURL(u);
  }
  private defaultWP(): WeightProfile {
    return {id:'balanced',name:'Balanced',isCustom:false,weights:{alpha:0.35,
      L0:{rt:0.6,rt_variance:0.4},L1:{track_error:0.35,track_variance:0.25,jerk:0.20,overshoot:0.20},
      L2:{track_error:0.25,audio_rt:0.25,audio_accuracy:0.20,prp:0.30},
      L3:{track_error:0.15,audio_rt:0.15,prp:0.20,cooldown:0.15,periph_rt:0.15,periph_miss:0.20}}};
  }
  destroy(): void { this.cleanupCurrentState(); }
}
