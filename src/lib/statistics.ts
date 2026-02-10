/**
 * CLST Statistics Library
 * Complete implementation of robust statistical methods
 * 
 * Section 10: MATHEMATICAL SPECIFICATION
 * Section 11: IMPLEMENTATION WATCH-OUTS
 * 
 * Uses robust statistics (median/MAD) instead of mean/SD to resist outliers.
 */

export class Statistics {

  // ===========================================================================
  // SECTION 10.2: ROBUST STATISTICS FOR BASELINES
  // ===========================================================================

  static median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    if (n % 2 === 1) return sorted[Math.floor(n / 2)];
    return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }

  static iqr(values: number[]): { q1: number; q3: number; iqr: number } {
    if (values.length < 4) return { q1: 0, q3: 0, iqr: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const lowerHalf = sorted.slice(0, Math.floor(n / 2));
    const upperHalf = sorted.slice(Math.ceil(n / 2));
    const q1 = this.median(lowerHalf);
    const q3 = this.median(upperHalf);
    return { q1, q3, iqr: q3 - q1 };
  }

  /** MAD scaled by 1.4826 to approximate SD for normal distributions */
  static mad(values: number[]): number {
    if (values.length === 0) return 0;
    const med = this.median(values);
    const deviations = values.map(v => Math.abs(v - med));
    return 1.4826 * this.median(deviations);
  }

  static modifiedZScore(
    value: number,
    baseline: number[],
    median?: number,
    madScaled?: number
  ): number {
    if (baseline.length === 0) return 0;
    const med = median ?? this.median(baseline);
    const madS = madScaled ?? this.mad(baseline);
    if (madS === 0) return 0;
    return (value - med) / madS;
  }

  // ===========================================================================
  // SECTION 10.3 & 11.8: EMPIRICAL CDF WITH LINEAR INTERPOLATION
  // ===========================================================================

  static empiricalCDF(value: number, baseline: number[]): number {
    if (baseline.length === 0) return 0.5;
    const sorted = [...baseline].sort((a, b) => a - b);
    const n = sorted.length;
    if (value < sorted[0]) return 0;
    if (value > sorted[n - 1]) return 1;
    for (let i = 0; i < n - 1; i++) {
      if (value >= sorted[i] && value < sorted[i + 1]) {
        const fraction = (value - sorted[i]) / (sorted[i + 1] - sorted[i]);
        return (i + fraction) / n;
      }
    }
    return (n - 1) / n;
  }

  // ===========================================================================
  // SECTION 10.11: NORMAL CDF (Abramowitz & Stegun)
  // ===========================================================================

  static normalCDF(z: number): number {
    if (z < 0) return 1 - this.normalCDF(-z);
    const t = 1 / (1 + 0.2316419 * z);
    const phi = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-z * z / 2);
    return 1 - phi * (
      0.319381530 * t -
      0.356563782 * t * t +
      1.781477937 * t * t * t -
      1.821255978 * t * t * t * t +
      1.330274429 * t * t * t * t * t
    );
  }

  // ===========================================================================
  // SECTION 10.5: CORRELATION ANALYSIS
  // ===========================================================================

  static spearmanCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 3) return 0;
    const n = x.length;
    const rankX = this.rankWithTies(x);
    const rankY = this.rankWithTies(y);
    const meanRankX = rankX.reduce((a, b) => a + b, 0) / n;
    const meanRankY = rankY.reduce((a, b) => a + b, 0) / n;
    let num = 0, denomX = 0, denomY = 0;
    for (let i = 0; i < n; i++) {
      const dx = rankX[i] - meanRankX;
      const dy = rankY[i] - meanRankY;
      num += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }
    if (denomX === 0 || denomY === 0) return 0;
    return num / Math.sqrt(denomX * denomY);
  }

  static pearsonCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 2) return 0;
    const n = x.length;
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    let num = 0, denomX = 0, denomY = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }
    if (denomX === 0 || denomY === 0) return 0;
    return num / Math.sqrt(denomX * denomY);
  }

  // ===========================================================================
  // SECTION 10.9: TREND DETECTION
  // ===========================================================================

  static theilSenSlope(
    indices: number[],
    values: number[]
  ): { slope: number; intercept: number } {
    if (indices.length !== values.length || indices.length < 2) {
      return { slope: 0, intercept: 0 };
    }
    const slopes: number[] = [];
    const n = indices.length;
    const maxPairs = 2000;
    const totalPairs = n * (n - 1) / 2;

    if (totalPairs <= maxPairs) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (indices[j] !== indices[i]) {
            const slope = (values[j] - values[i]) / (indices[j] - indices[i]);
            if (isFinite(slope)) slopes.push(slope);
          }
        }
      }
    } else {
      for (let k = 0; k < maxPairs; k++) {
        const i = Math.floor(Math.random() * n);
        let j = Math.floor(Math.random() * n);
        while (j === i) j = Math.floor(Math.random() * n);
        const [a, b] = i < j ? [i, j] : [j, i];
        if (indices[b] !== indices[a]) {
          const slope = (values[b] - values[a]) / (indices[b] - indices[a]);
          if (isFinite(slope)) slopes.push(slope);
        }
      }
    }

    const slope = this.median(slopes);
    const intercepts = indices.map((x, i) => values[i] - slope * x);
    const intercept = this.median(intercepts);
    return { slope, intercept };
  }

  static kendallTau(
    indices: number[],
    values: number[]
  ): { tau: number; pValue: number } {
    if (indices.length !== values.length || indices.length < 3) {
      return { tau: 0, pValue: 1 };
    }
    const n = indices.length;
    let concordant = 0, discordant = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const signX = Math.sign(indices[j] - indices[i]);
        const signY = Math.sign(values[j] - values[i]);
        if (signX * signY > 0) concordant++;
        else if (signX * signY < 0) discordant++;
      }
    }
    const tau = (concordant - discordant) / (n * (n - 1) / 2);
    if (n > 10) {
      const variance = (2 * (2 * n + 5)) / (9 * n * (n - 1));
      const z = tau / Math.sqrt(variance);
      const pValue = 2 * (1 - this.normalCDF(Math.abs(z)));
      return { tau, pValue };
    }
    return { tau, pValue: 1 };
  }

  static mannWhitneyU(
    group1: number[],
    group2: number[]
  ): { u: number; pValue: number } {
    if (group1.length === 0 || group2.length === 0) return { u: 0, pValue: 1 };
    const n1 = group1.length;
    const n2 = group2.length;
    const combined = [
      ...group1.map((v, i) => ({ value: v, group: 1, index: i })),
      ...group2.map((v, i) => ({ value: v, group: 2, index: i }))
    ];
    combined.sort((a, b) => a.value - b.value);
    const ranks = new Array(combined.length);
    let i = 0;
    while (i < combined.length) {
      let j = i;
      while (j < combined.length && combined[j].value === combined[i].value) j++;
      const avgRank = (i + j + 1) / 2;
      for (let k = i; k < j; k++) ranks[k] = avgRank;
      i = j;
    }
    let r1 = 0;
    combined.forEach((item, idx) => { if (item.group === 1) r1 += ranks[idx]; });
    const u1 = r1 - (n1 * (n1 + 1)) / 2;
    const u2 = n1 * n2 - u1;
    const u = Math.min(u1, u2);
    if (n1 > 20 && n2 > 20) {
      const meanU = (n1 * n2) / 2;
      const stdU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
      const z = (u - meanU) / stdU;
      const pValue = 2 * (1 - this.normalCDF(Math.abs(z)));
      return { u, pValue };
    }
    return { u, pValue: NaN };
  }

  // ===========================================================================
  // SECTION 10.7: DISTRIBUTION ANALYSIS
  // ===========================================================================

  static kde(data: number[], points: number[]): number[] {
    if (data.length < 2) return points.map(() => 0);
    const n = data.length;
    const { iqr } = this.iqr(data);
    const madScaled = this.mad(data);
    const h = 0.9 * Math.min(madScaled || Infinity, iqr / 1.34 || Infinity) * Math.pow(n, -1 / 5);
    if (h === 0 || !isFinite(h)) return points.map(() => 0);
    return points.map(x => {
      let density = 0;
      for (const xi of data) {
        const u = (x - xi) / h;
        density += (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-u * u / 2);
      }
      return density / (n * h);
    });
  }

  static shapeStatistics(values: number[]): { skewness: number; kurtosis: number } {
    if (values.length < 4) return { skewness: 0, kurtosis: 0 };
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1);
    const std = Math.sqrt(variance);
    if (std === 0) return { skewness: 0, kurtosis: 0 };
    const m3 = values.reduce((a, v) => a + ((v - mean) / std) ** 3, 0);
    const skewness = (n / ((n - 1) * (n - 2))) * m3;
    const m4 = values.reduce((a, v) => a + ((v - mean) / std) ** 4, 0);
    const kurtosis = ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * m4 -
      (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
    return { skewness, kurtosis };
  }

  // ===========================================================================
  // UTILITY
  // ===========================================================================

  static clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  static weightedMean(values: number[], weights: number[]): number {
    if (values.length !== weights.length || values.length === 0) return 0;
    const sumWeights = weights.reduce((a, b) => a + b, 0);
    if (sumWeights === 0) return 0;
    return values.reduce((sum, v, i) => sum + v * weights[i], 0) / sumWeights;
  }

  private static rankWithTies(values: number[]): number[] {
    const indexed = values.map((v, i) => ({ value: v, index: i }));
    indexed.sort((a, b) => a.value - b.value);
    const ranks = new Array(values.length);
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j < indexed.length && indexed[j].value === indexed[i].value) j++;
      const avgRank = (i + j + 1) / 2;
      for (let k = i; k < j; k++) ranks[indexed[k].index] = avgRank;
      i = j;
    }
    return ranks;
  }
}
