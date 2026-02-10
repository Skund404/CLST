/**
 * Scoring Engine for CLST
 * Implements Section 10.3 (COMPOSITE SCORING)
 *
 * FIXES from code review:
 * - Weight profile is actually applied via getWeightsForLayer (not hardcoded)
 * - extractMetricsForLayer gets weights from profile parameter
 */

import type { LayerMetrics, WeightProfile, BaselineStats, Session } from '@/types';
import { Statistics } from './statistics';

interface MetricValue {
  name: string;
  value: number;
  weight: number;
  higherIsBetter: boolean;
}

export class ScoringEngine {
  private static readonly DEFAULT_WINDOW_SIZE = 20;
  private static readonly CALIBRATION_SESSIONS = 5;
  private static readonly MIN_BASELINE_SESSIONS = 10;
  private static readonly DEFAULT_ALPHA = 0.35;
  private static readonly DC_VALIDITY_THRESHOLD = 15;

  // =========================================================================
  // LPI COMPUTATION
  // =========================================================================

  static computeLPI(
    layer: number,
    metrics: LayerMetrics,
    baselines: Map<string, BaselineStats>,
    weightProfile: WeightProfile
  ): number | null {
    const metricValues = this.extractMetricsForLayer(layer, metrics, weightProfile);
    if (metricValues.length === 0) return null;

    const scores: number[] = [];
    const appliedWeights: number[] = [];

    for (const metric of metricValues) {
      const baselineKey = `${metric.name}_L${layer}`;
      const baseline = baselines.get(baselineKey);

      if (!baseline || baseline.windowSize < ScoringEngine.MIN_BASELINE_SESSIONS) {
        const score = this.linearNormalization(
          metric.value,
          baseline?.minVal ?? metric.value,
          baseline?.maxVal ?? metric.value,
          metric.higherIsBetter
        );
        scores.push(score);
      } else {
        const percentile = this.estimatePercentileFromStats(
          metric.value, baseline, metric.higherIsBetter
        );
        scores.push(percentile);
      }
      appliedWeights.push(metric.weight);
    }

    const weightSum = appliedWeights.reduce((s, w) => s + w, 0);
    if (weightSum === 0) return null;

    const normalizedWeights = appliedWeights.map(w => w / weightSum);
    const lpi = scores.reduce((s, score, i) => s + score * normalizedWeights[i], 0) * 100;

    return Math.max(0, Math.min(100, lpi));
  }

  private static estimatePercentileFromStats(
    value: number,
    baseline: BaselineStats,
    higherIsBetter: boolean
  ): number {
    const { median, q1, q3, minVal, maxVal } = baseline;

    if (value <= minVal) return higherIsBetter ? 0 : 1;
    if (value >= maxVal) return higherIsBetter ? 1 : 0;

    let percentile: number;
    if (value <= q1) {
      percentile = q1 === minVal ? 0.125 : 0.25 * (value - minVal) / (q1 - minVal);
    } else if (value <= median) {
      percentile = median === q1 ? 0.375 : 0.25 + 0.25 * (value - q1) / (median - q1);
    } else if (value <= q3) {
      percentile = q3 === median ? 0.625 : 0.5 + 0.25 * (value - median) / (q3 - median);
    } else {
      percentile = maxVal === q3 ? 0.875 : 0.75 + 0.25 * (value - q3) / (maxVal - q3);
    }

    return higherIsBetter ? percentile : (1 - percentile);
  }

  private static linearNormalization(
    value: number, minVal: number, maxVal: number, higherIsBetter: boolean
  ): number {
    if (maxVal === minVal) return 0.5;
    const normalized = (value - minVal) / (maxVal - minVal);
    const score = higherIsBetter ? normalized : (1 - normalized);
    return Math.max(0, Math.min(1, score));
  }

  // =========================================================================
  // METRIC EXTRACTION (uses weight profile, not hardcoded values)
  // =========================================================================

  private static extractMetricsForLayer(
    layer: number,
    metrics: LayerMetrics,
    profile: WeightProfile
  ): MetricValue[] {
    const values: MetricValue[] = [];

    // Define which metrics belong to which layer and their directionality
    const layerMetricDefs: Record<number, Array<{
      name: string;
      key: keyof LayerMetrics;
      higherIsBetter: boolean;
    }>> = {
      0: [
        { name: 'rt', key: 'meanRT', higherIsBetter: false },
        { name: 'rt_variance', key: 'rtVariance', higherIsBetter: false },
      ],
      1: [
        { name: 'track_error', key: 'meanTrackingError', higherIsBetter: false },
        { name: 'track_variance', key: 'trackingErrorVariance', higherIsBetter: false },
        { name: 'jerk', key: 'meanJerk', higherIsBetter: false },
        { name: 'overshoot', key: 'overshootRate', higherIsBetter: false },
      ],
      2: [
        { name: 'track_error', key: 'meanTrackingError', higherIsBetter: false },
        { name: 'audio_rt', key: 'meanAudioRT', higherIsBetter: false },
        { name: 'audio_accuracy', key: 'audioAccuracy', higherIsBetter: true },
        { name: 'prp', key: 'meanPRPDuration', higherIsBetter: false },
      ],
      3: [
        { name: 'track_error', key: 'meanTrackingError', higherIsBetter: false },
        { name: 'audio_rt', key: 'meanAudioRT', higherIsBetter: false },
        { name: 'prp', key: 'meanPRPDuration', higherIsBetter: false },
        { name: 'cooldown', key: 'meanCooldownDelay', higherIsBetter: false },
        { name: 'periph_rt', key: 'meanPeripheralRT', higherIsBetter: false },
        { name: 'periph_miss', key: 'peripheralMissRate', higherIsBetter: false },
      ],
    };

    const defs = layerMetricDefs[layer];
    if (!defs) return values;

    // Get weights from the profile
    const layerKey = `L${layer}` as 'L0' | 'L1' | 'L2' | 'L3';
    const layerWeights = profile.weights[layerKey] as Record<string, number>;

    for (const def of defs) {
      const value = metrics[def.key];
      if (value !== undefined && typeof value === 'number') {
        values.push({
          name: def.name,
          value,
          weight: layerWeights[def.name] ?? 0,
          higherIsBetter: def.higherIsBetter
        });
      }
    }

    return values;
  }

  // =========================================================================
  // DC & CRS
  // =========================================================================

  static computeDC(lpi0: number | null, lpi3: number | null): number | null {
    if (lpi0 === null || lpi3 === null) return null;
    if (lpi0 < ScoringEngine.DC_VALIDITY_THRESHOLD) return null;
    return Math.max(0, Math.min(1, lpi3 / lpi0));
  }

  static computeCRS(
    lpis: (number | null)[],
    dc: number | null,
    alpha: number = ScoringEngine.DEFAULT_ALPHA
  ): number | null {
    const validLPIs = lpis.filter((lpi): lpi is number => lpi !== null);
    if (validLPIs.length === 0) return null;

    const meanLPI = validLPIs.reduce((s, l) => s + l, 0) / validLPIs.length;
    const normLPI = meanLPI / 100;

    if (dc === null) return meanLPI; // Section 11.2: α=1.0 fallback

    return Math.max(0, Math.min(100, 100 * (alpha * normLPI + (1 - alpha) * dc)));
  }

  // =========================================================================
  // SESSION SCORING ORCHESTRATION
  // =========================================================================

  static computeSessionScores(
    layerMetrics: LayerMetrics[],
    baselines: Map<string, BaselineStats>,
    weightProfile: WeightProfile
  ): {
    lpi0: number | null;
    lpi1: number | null;
    lpi2: number | null;
    lpi3: number | null;
    dc: number | null;
    crs: number | null;
    alert: 'critical' | 'warning' | null;
  } {
    const lpi0 = layerMetrics[0] ? this.computeLPI(0, layerMetrics[0], baselines, weightProfile) : null;
    const lpi1 = layerMetrics[1] ? this.computeLPI(1, layerMetrics[1], baselines, weightProfile) : null;
    const lpi2 = layerMetrics[2] ? this.computeLPI(2, layerMetrics[2], baselines, weightProfile) : null;
    const lpi3 = layerMetrics[3] ? this.computeLPI(3, layerMetrics[3], baselines, weightProfile) : null;

    const dc = this.computeDC(lpi0, lpi3);
    const crs = this.computeCRS([lpi0, lpi1, lpi2, lpi3], dc, weightProfile.weights.alpha);

    let alert: 'critical' | 'warning' | null = null;
    const crsBaseline = baselines.get('crs');
    if (crs !== null && crsBaseline && crsBaseline.windowSize >= ScoringEngine.MIN_BASELINE_SESSIONS) {
      const zScore = this.computeModifiedZScore(crs, crsBaseline);
      alert = this.checkAlertThreshold(zScore);
    }

    return { lpi0, lpi1, lpi2, lpi3, dc, crs, alert };
  }

  // =========================================================================
  // BASELINE UTILITIES
  // =========================================================================

  static computeStatsFromValues(values: number[]): BaselineStats {
    if (values.length === 0) {
      return { median: 0, madScaled: 0, q1: 0, q3: 0, iqr: 0, minVal: 0, maxVal: 0, windowSize: 0 };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const { q1, q3, iqr } = Statistics.iqr(values);
    return {
      median: Statistics.median(values),
      madScaled: Statistics.mad(values),
      q1, q3, iqr,
      minVal: sorted[0],
      maxVal: sorted[sorted.length - 1],
      windowSize: values.length
    };
  }

  static updateRollingWindow(
    currentValues: number[], newValue: number, windowSize: number = ScoringEngine.DEFAULT_WINDOW_SIZE
  ): number[] {
    const updated = [...currentValues, newValue];
    return updated.length > windowSize ? updated.slice(updated.length - windowSize) : updated;
  }

  static isCalibrationSession(sessionIndex: number): boolean {
    return sessionIndex < ScoringEngine.CALIBRATION_SESSIONS;
  }

  static isBaselineReady(totalSessions: number): boolean {
    return totalSessions >= (ScoringEngine.CALIBRATION_SESSIONS + ScoringEngine.MIN_BASELINE_SESSIONS);
  }

  static computeModifiedZScore(value: number, baseline: BaselineStats): number {
    if (baseline.madScaled === 0) return 0;
    return (value - baseline.median) / baseline.madScaled;
  }

  static checkAlertThreshold(zScore: number): 'critical' | 'warning' | null {
    if (zScore < -2.0) return 'critical';
    if (zScore < -1.5) return 'warning';
    return null;
  }

  static validateWeightProfile(profile: WeightProfile): boolean {
    const layers: Array<'L0' | 'L1' | 'L2' | 'L3'> = ['L0', 'L1', 'L2', 'L3'];
    for (const layer of layers) {
      const weights = Object.values(profile.weights[layer] as Record<string, number>);
      const sum = weights.reduce((s, w) => s + w, 0);
      if (Math.abs(sum - 1.0) > 0.01) return false;
    }
    if (profile.weights.alpha < 0 || profile.weights.alpha > 1) return false;
    return true;
  }
}
