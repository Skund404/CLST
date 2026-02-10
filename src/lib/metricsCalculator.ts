/**
 * Metrics Calculator for CLST
 * Implements Section 10.1 (RAW METRIC COMPUTATION)
 *
 * FIXES from code review:
 * - Audio response uses SPACE key (not Q/E)
 * - Peripheral detection uses digit keys (not arrow keys)
 * - Downsampling uses sliding index O(n+m) instead of O(n*m)
 */

import type { RawEvent, LayerMetrics } from '@/types';

export class MetricsCalculator {
  private static readonly RT_MIN_MS = 100;
  private static readonly RT_MAX_MS = 1500;
  private static readonly PRP_WINDOW_PRE_MS = 500;
  private static readonly PRP_WINDOW_POST_MS = 100;
  private static readonly PRP_MAX_MS = 2000;
  private static readonly PRP_THRESHOLD_MULTIPLIER = 1.2;
  private static readonly PERIPHERAL_TIMEOUT_MS = 2000;
  private static readonly CANONICAL_SAMPLE_RATE = 60;
  private static readonly SYSTEM_STALL_MULTIPLIER = 3;

  // =========================================================================
  // LAYER 0: SIMPLE REACTION TIME
  // =========================================================================

  static reactionTime(events: RawEvent[]): {
    meanRT: number;
    rtVariance: number;
    rtStd: number;
    anticipationCount: number;
    lapseCount: number;
  } {
    const validRTs: number[] = [];
    let anticipationCount = 0;
    let lapseCount = 0;

    const stimuli = events
      .filter(e => e.eventType === 'stimulus_onset')
      .sort((a, b) => a.timestampUs - b.timestampUs);

    const responses = events
      .filter(e => e.eventType === 'click')
      .sort((a, b) => a.timestampUs - b.timestampUs);

    for (const response of responses) {
      let matchedStimulus = null;
      for (let i = stimuli.length - 1; i >= 0; i--) {
        if (stimuli[i].timestampUs < response.timestampUs) {
          matchedStimulus = stimuli[i];
          break;
        }
      }
      if (matchedStimulus) {
        const rtMs = (response.timestampUs - matchedStimulus.timestampUs) / 1000;
        if (rtMs < MetricsCalculator.RT_MIN_MS) {
          anticipationCount++;
        } else if (rtMs > MetricsCalculator.RT_MAX_MS) {
          lapseCount++;
        } else {
          validRTs.push(rtMs);
        }
      }
    }

    if (validRTs.length === 0) {
      return { meanRT: 0, rtVariance: 0, rtStd: 0, anticipationCount, lapseCount };
    }

    const meanRT = validRTs.reduce((sum, rt) => sum + rt, 0) / validRTs.length;
    const variance = validRTs.reduce((sum, rt) => sum + (rt - meanRT) ** 2, 0) / validRTs.length;

    return { meanRT, rtVariance: variance, rtStd: Math.sqrt(variance), anticipationCount, lapseCount };
  }

  // =========================================================================
  // LAYER 1+: TRACKING METRICS
  // =========================================================================

  static trackingError(events: RawEvent[]): {
    meanTrackingError: number;
    trackingErrorVariance: number;
  } {
    const errors: number[] = [];
    for (const event of events) {
      if (event.eventType !== 'cursor_pos') continue;
      const d = event.data;
      if (d.cursorX != null && d.cursorY != null && d.targetX != null && d.targetY != null) {
        errors.push(Math.sqrt((d.cursorX - d.targetX) ** 2 + (d.cursorY - d.targetY) ** 2));
      }
    }
    if (errors.length === 0) return { meanTrackingError: 0, trackingErrorVariance: 0 };
    const mean = errors.reduce((s, e) => s + e, 0) / errors.length;
    const variance = errors.length > 1
      ? errors.reduce((s, e) => s + (e - mean) ** 2, 0) / (errors.length - 1)
      : 0;
    return { meanTrackingError: mean, trackingErrorVariance: variance };
  }

  /**
   * Tracking jerk with 60Hz normalization (Section 10.1 + 11.6)
   */
  static trackingJerk(events: RawEvent[], _monitorRefreshRate: number): number {
    const cursorPositions = events
      .filter(e => e.eventType === 'cursor_pos')
      .sort((a, b) => a.timestampUs - b.timestampUs);

    if (cursorPositions.length < 4) return 0;

    const interpolated = this.downsampleTo60Hz(cursorPositions);
    if (interpolated.length < 4) return 0;

    const dt = 1 / MetricsCalculator.CANONICAL_SAMPLE_RATE;
    const jerkMagnitudes: number[] = [];

    for (let i = 3; i < interpolated.length; i++) {
      const vx1 = (interpolated[i - 2].x - interpolated[i - 3].x) / dt;
      const vy1 = (interpolated[i - 2].y - interpolated[i - 3].y) / dt;
      const vx2 = (interpolated[i - 1].x - interpolated[i - 2].x) / dt;
      const vy2 = (interpolated[i - 1].y - interpolated[i - 2].y) / dt;
      const vx3 = (interpolated[i].x - interpolated[i - 1].x) / dt;
      const vy3 = (interpolated[i].y - interpolated[i - 1].y) / dt;

      const ax1 = (vx2 - vx1) / dt, ay1 = (vy2 - vy1) / dt;
      const ax2 = (vx3 - vx2) / dt, ay2 = (vy3 - vy2) / dt;
      const jerkX = (ax2 - ax1) / dt, jerkY = (ay2 - ay1) / dt;

      jerkMagnitudes.push(Math.sqrt(jerkX * jerkX + jerkY * jerkY));
    }

    return jerkMagnitudes.reduce((s, j) => s + j, 0) / jerkMagnitudes.length;
  }

  /**
   * Downsample to 60Hz — O(n+m) sliding index
   */
  private static downsampleTo60Hz(
    positions: RawEvent[]
  ): Array<{ x: number; y: number; time: number }> {
    if (positions.length < 2) return [];

    const startTime = positions[0].timestampUs;
    const endTime = positions[positions.length - 1].timestampUs;
    const durationMs = (endTime - startTime) / 1000;
    const frameIntervalMs = 1000 / MetricsCalculator.CANONICAL_SAMPLE_RATE;
    const numFrames = Math.floor(durationMs / frameIntervalMs);
    const result: Array<{ x: number; y: number; time: number }> = [];

    let searchIndex = 0;
    for (let i = 0; i < numFrames; i++) {
      const targetTimeUs = startTime + (i * frameIntervalMs * 1000);

      while (searchIndex < positions.length - 2 &&
             positions[searchIndex + 1].timestampUs < targetTimeUs) {
        searchIndex++;
      }

      const before = positions[searchIndex];
      const after = positions[Math.min(searchIndex + 1, positions.length - 1)];
      const delta = after.timestampUs - before.timestampUs;
      const frac = delta === 0 ? 0 : (targetTimeUs - before.timestampUs) / delta;

      result.push({
        x: before.data.cursorX! + frac * (after.data.cursorX! - before.data.cursorX!),
        y: before.data.cursorY! + frac * (after.data.cursorY! - before.data.cursorY!),
        time: targetTimeUs
      });
    }
    return result;
  }

  /**
   * Overshoot detection (Layer 1+)
   */
  static overshootRate(events: RawEvent[], layerDurationSeconds: number): number {
    const cursorPositions = events
      .filter(e => e.eventType === 'cursor_pos')
      .sort((a, b) => a.timestampUs - b.timestampUs);

    if (cursorPositions.length < 3) return 0;

    let overshootCount = 0;
    let lastError = Infinity;
    let wasApproaching = false;

    for (const event of cursorPositions) {
      const d = event.data;
      if (d.cursorX == null || d.targetX == null) continue;

      const error = Math.sqrt((d.cursorX - d.targetX) ** 2 + (d.cursorY! - d.targetY!) ** 2);
      const targetRadius = d.targetRadius || 20;

      if (error < lastError) {
        wasApproaching = true;
      } else if (wasApproaching && lastError < targetRadius && error > lastError) {
        overshootCount++;
        wasApproaching = false;
      } else if (error > lastError) {
        wasApproaching = false;
      }

      lastError = error;
    }

    return layerDurationSeconds > 0 ? (overshootCount / layerDurationSeconds) * 60 : 0;
  }

  // =========================================================================
  // LAYER 2+: AUDIO RESPONSE
  // =========================================================================

  /**
   * Audio RT and accuracy.
   * FIX: Uses SPACE key for audio response (not Q/E).
   * Tone discrimination (high vs low) is not key-mapped — any SPACE press
   * within the window counts as a response. Accuracy = correct detection
   * (responded to signal, did not respond to distractor).
   */
  static audioMetrics(events: RawEvent[]): {
    meanAudioRT: number;
    audioAccuracy: number;
    audioFalsePositives: number;
  } {
    const signalCues = events
      .filter(e => e.eventType === 'audio_cue' && e.data.tone !== 'distractor')
      .sort((a, b) => a.timestampUs - b.timestampUs);

    const distractorCues = events
      .filter(e => e.eventType === 'audio_cue' && e.data.tone === 'distractor')
      .sort((a, b) => a.timestampUs - b.timestampUs);

    const spaceResponses = events
      .filter(e => e.eventType === 'keypress' && e.data.key === ' ')
      .sort((a, b) => a.timestampUs - b.timestampUs);

    const audioRTs: number[] = [];
    let hits = 0;

    for (const cue of signalCues) {
      const response = spaceResponses.find(r =>
        r.timestampUs > cue.timestampUs &&
        r.timestampUs < cue.timestampUs + (MetricsCalculator.RT_MAX_MS * 1000)
      );
      if (response) {
        const rt = (response.timestampUs - cue.timestampUs) / 1000;
        if (rt >= MetricsCalculator.RT_MIN_MS) {
          audioRTs.push(rt);
          hits++;
        }
      }
    }

    // False positives: SPACE pressed during distractor window
    let falsePositives = 0;
    for (const dist of distractorCues) {
      const falseResp = spaceResponses.find(r =>
        r.timestampUs > dist.timestampUs &&
        r.timestampUs < dist.timestampUs + (MetricsCalculator.RT_MAX_MS * 1000)
      );
      if (falseResp) falsePositives++;
    }

    const totalSignals = signalCues.length;
    return {
      meanAudioRT: audioRTs.length > 0
        ? audioRTs.reduce((s, r) => s + r, 0) / audioRTs.length
        : 0,
      audioAccuracy: totalSignals > 0 ? hits / totalSignals : 0,
      audioFalsePositives: falsePositives
    };
  }

  // =========================================================================
  // LAYER 2+: PRP DURATION
  // =========================================================================

  static prpDuration(events: RawEvent[]): number {
    const audioCues = events
      .filter(e => e.eventType === 'audio_cue' && e.data.tone !== 'distractor')
      .sort((a, b) => a.timestampUs - b.timestampUs);

    const keypresses = events
      .filter(e => e.eventType === 'keypress' && e.data.key === ' ')
      .sort((a, b) => a.timestampUs - b.timestampUs);

    const cursorPositions = events
      .filter(e => e.eventType === 'cursor_pos')
      .sort((a, b) => a.timestampUs - b.timestampUs);

    const prpDurations: number[] = [];

    for (const cue of audioCues) {
      const response = keypresses.find(k =>
        k.timestampUs > cue.timestampUs &&
        k.timestampUs < cue.timestampUs + MetricsCalculator.RT_MAX_MS * 1000
      );
      if (!response) continue;

      // Pre-cue tracking error (500ms window)
      const preStart = cue.timestampUs - (MetricsCalculator.PRP_WINDOW_PRE_MS * 1000);
      const preCursor = cursorPositions.filter(p =>
        p.timestampUs >= preStart && p.timestampUs < cue.timestampUs
      );
      if (preCursor.length === 0) continue;

      const preError = this.computeMeanError(preCursor);
      const threshold = preError * MetricsCalculator.PRP_THRESHOLD_MULTIPLIER;

      // Post-response recovery (start 100ms after response)
      const recoveryStart = response.timestampUs + (MetricsCalculator.PRP_WINDOW_POST_MS * 1000);
      const recoveryEnd = response.timestampUs + (MetricsCalculator.PRP_MAX_MS * 1000);

      let prp = MetricsCalculator.PRP_MAX_MS;

      for (let time = recoveryStart; time <= recoveryEnd; time += 100000) {
        const windowPos = cursorPositions.filter(p =>
          p.timestampUs >= time && p.timestampUs < time + 100000
        );
        if (windowPos.length > 0 && this.computeMeanError(windowPos) <= threshold) {
          prp = (time - response.timestampUs) / 1000;
          break;
        }
      }

      prpDurations.push(prp);
    }

    return prpDurations.length > 0
      ? prpDurations.reduce((s, d) => s + d, 0) / prpDurations.length
      : 0;
  }

  private static computeMeanError(positions: RawEvent[]): number {
    if (positions.length === 0) return 0;
    let total = 0;
    for (const p of positions) {
      const d = p.data;
      total += Math.sqrt((d.cursorX! - d.targetX!) ** 2 + (d.cursorY! - d.targetY!) ** 2);
    }
    return total / positions.length;
  }

  // =========================================================================
  // LAYER 3: COOLDOWN
  // =========================================================================

  static cooldownDelay(events: RawEvent[]): {
    meanCooldownDelay: number;
    cooldownMissCount: number;
  } {
    const readyEvents = events
      .filter(e => e.eventType === 'cooldown_ready')
      .sort((a, b) => a.timestampUs - b.timestampUs);

    const fPresses = events
      .filter(e => e.eventType === 'keypress' && e.data.key === 'f')
      .sort((a, b) => a.timestampUs - b.timestampUs);

    const delays: number[] = [];
    let missCount = 0;

    for (let i = 0; i < readyEvents.length; i++) {
      const ready = readyEvents[i];
      const nextReady = readyEvents[i + 1];
      const response = fPresses.find(k => k.timestampUs > ready.timestampUs);

      if (response && (!nextReady || response.timestampUs < nextReady.timestampUs)) {
        delays.push((response.timestampUs - ready.timestampUs) / 1000);
      } else {
        missCount++;
      }
    }

    return {
      meanCooldownDelay: delays.length > 0
        ? delays.reduce((s, d) => s + d, 0) / delays.length
        : 0,
      cooldownMissCount: missCount
    };
  }

  // =========================================================================
  // LAYER 3: PERIPHERAL DETECTION
  // FIX: Uses digit keys (0-9) matching the displayed digit, not arrow keys
  // =========================================================================

  static peripheralDetection(events: RawEvent[]): {
    meanPeripheralRT: number;
    peripheralMissRate: number;
  } {
    const flashes = events
      .filter(e => e.eventType === 'peripheral_flash')
      .sort((a, b) => a.timestampUs - b.timestampUs);

    const keypresses = events
      .filter(e => e.eventType === 'keypress')
      .sort((a, b) => a.timestampUs - b.timestampUs);

    const rts: number[] = [];
    let missCount = 0;

    for (const flash of flashes) {
      const expectedDigit = flash.data.digit?.toString();
      if (expectedDigit == null) { missCount++; continue; }

      const response = keypresses.find(k =>
        k.data.key === expectedDigit &&
        k.timestampUs > flash.timestampUs &&
        k.timestampUs < flash.timestampUs + (MetricsCalculator.PERIPHERAL_TIMEOUT_MS * 1000)
      );

      if (response) {
        rts.push((response.timestampUs - flash.timestampUs) / 1000);
      } else {
        missCount++;
      }
    }

    return {
      meanPeripheralRT: rts.length > 0
        ? rts.reduce((s, r) => s + r, 0) / rts.length
        : 0,
      peripheralMissRate: flashes.length > 0 ? missCount / flashes.length : 0
    };
  }

  // =========================================================================
  // SYSTEM STALLS (Section 11.3)
  // =========================================================================

  static detectSystemStalls(events: RawEvent[], expectedFrameTimeMs: number): number {
    const cursorPositions = events
      .filter(e => e.eventType === 'cursor_pos')
      .sort((a, b) => a.timestampUs - b.timestampUs);

    if (cursorPositions.length < 2) return 0;

    let stallCount = 0;
    const maxGapUs = expectedFrameTimeMs * 1000 * MetricsCalculator.SYSTEM_STALL_MULTIPLIER;
    for (let i = 1; i < cursorPositions.length; i++) {
      if (cursorPositions[i].timestampUs - cursorPositions[i - 1].timestampUs > maxGapUs) {
        stallCount++;
      }
    }
    return stallCount;
  }

  // =========================================================================
  // MAIN ENTRY POINT
  // =========================================================================

  static computeLayerMetrics(
    sessionId: string,
    layer: number,
    events: RawEvent[],
    layerDurationSeconds: number,
    monitorRefreshRate: number
  ): LayerMetrics {
    const metrics: LayerMetrics = { sessionId, layer };

    // Layer 0: Simple RT
    if (layer === 0) {
      const rt = this.reactionTime(events);
      metrics.meanRT = rt.meanRT;
      metrics.rtVariance = rt.rtVariance;
      metrics.rtStd = rt.rtStd;
      metrics.anticipationCount = rt.anticipationCount;
      metrics.lapseCount = rt.lapseCount;
    }

    // Layer 1+: Tracking
    if (layer >= 1) {
      const tracking = this.trackingError(events);
      metrics.meanTrackingError = tracking.meanTrackingError;
      metrics.trackingErrorVariance = tracking.trackingErrorVariance;
      metrics.meanJerk = this.trackingJerk(events, monitorRefreshRate);
      metrics.overshootRate = this.overshootRate(events, layerDurationSeconds);
    }

    // Layer 2+: Audio
    if (layer >= 2) {
      const audio = this.audioMetrics(events);
      metrics.meanAudioRT = audio.meanAudioRT;
      metrics.audioAccuracy = audio.audioAccuracy;
      metrics.audioFalsePositives = audio.audioFalsePositives;
      metrics.meanPRPDuration = this.prpDuration(events);
    }

    // Layer 3: Full load
    if (layer === 3) {
      const cooldown = this.cooldownDelay(events);
      metrics.meanCooldownDelay = cooldown.meanCooldownDelay;
      metrics.cooldownMissCount = cooldown.cooldownMissCount;

      const peripheral = this.peripheralDetection(events);
      metrics.meanPeripheralRT = peripheral.meanPeripheralRT;
      metrics.peripheralMissRate = peripheral.peripheralMissRate;
    }

    return metrics;
  }
}
