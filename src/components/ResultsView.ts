/**
 * Post-Session Results View Component for CLST
 * Implements Section 8 (DASHBOARD & COMPARISON) - Post-Session View
 * Displays immediate feedback after test completion
 */

import * as d3 from 'd3';
import type { Session, BaselineStats } from '@/types';

export interface ResultsViewOptions {
  session: Session;
  previousSession: Session | null;
  baselines: Map<string, BaselineStats>;
  layerMetrics: Array<{
    layer: number;
    meanRT?: number;
    meanTrackingError?: number;
    meanAudioRT?: number;
    meanPRPDuration?: number;
    meanPeripheralRT?: number;
  }>;
  onViewDetails?: () => void;
  onNewSession?: () => void;
  onExport?: () => void;
}

export class ResultsView {
  private container: HTMLElement;
  private options: ResultsViewOptions;

  constructor(container: HTMLElement, options: ResultsViewOptions) {
    this.container = container;
    this.options = options;
  }

  /**
   * Render the results view
   */
  render(): void {
    this.container.innerHTML = `
      <div class="results-container">
        <div class="results-header">
          <h1>Session Complete!</h1>
          <p class="session-date">${this.formatDate(this.options.session.timestamp)}</p>
        </div>

        <!-- CRS Gauge -->
        <div class="crs-section">
          <h2>Cognitive Readiness Score</h2>
          <div id="crs-gauge"></div>
          <div class="crs-interpretation"></div>
        </div>

        <!-- Layer Breakdown -->
        <div class="layers-section">
          <h2>Performance by Layer</h2>
          <div id="layer-breakdown"></div>
        </div>

        <!-- Degradation Curve -->
        <div class="degradation-section">
          <h2>Degradation Curve</h2>
          <div id="degradation-curve"></div>
        </div>

        <!-- Comparison Metrics -->
        <div class="comparison-section">
          <h2>Performance Comparison</h2>
          <div class="comparison-grid">
            <div class="comparison-card">
              <h3>vs. Last Session</h3>
              <div id="vs-last"></div>
            </div>
            <div class="comparison-card">
              <h3>vs. Baseline</h3>
              <div id="vs-baseline"></div>
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="results-actions">
          <button id="btn-details" class="btn btn-primary">View Details</button>
          <button id="btn-new-session" class="btn btn-secondary">Start New Session</button>
          <button id="btn-export" class="btn btn-tertiary">Export Data</button>
        </div>
      </div>
    `;

    // Render visualizations
    this.renderCRSGauge();
    this.renderLayerBreakdown();
    this.renderDegradationCurve();
    this.renderComparisons();

    // Attach event listeners
    this.attachEventListeners();
  }

  /**
   * Render CRS gauge
   */
  private renderCRSGauge(): void {
    const container = d3.select('#crs-gauge');
    const crs = this.options.session.crs ?? 0;
    
    // Calculate z-score for color coding
    const crsBaseline = this.options.baselines.get('crs');
    const zScore = crsBaseline 
      ? this.calculateZScore(crs, crsBaseline)
      : 0;

    // Determine color based on thresholds
    const color = this.getAlertColor(zScore);

    // Create semi-circular gauge
    const width = 400;
    const height = 250;
    const radius = 150;

    const svg = container.append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('class', 'crs-gauge-svg');

    const g = svg.append('g')
      .attr('transform', `translate(${width / 2}, ${height - 30})`);

    // Background arc
    const backgroundArc = d3.arc()
      .innerRadius(radius - 40)
      .outerRadius(radius)
      .startAngle(-Math.PI / 2)
      .endAngle(Math.PI / 2);

    g.append('path')
      .attr('d', backgroundArc as any)
      .attr('fill', '#e0e0e0');

    // Foreground arc (CRS value)
    const angle = -Math.PI / 2 + (Math.PI * (crs / 100));
    
    const foregroundArc = d3.arc()
      .innerRadius(radius - 40)
      .outerRadius(radius)
      .startAngle(-Math.PI / 2)
      .endAngle(angle);

    g.append('path')
      .attr('d', foregroundArc as any)
      .attr('fill', color)
      .attr('class', 'crs-arc');

    // CRS value text
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', -40)
      .attr('class', 'crs-value')
      .style('font-size', '72px')
      .style('font-weight', 'bold')
      .style('fill', color)
      .text(Math.round(crs));

    // Label
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', 20)
      .attr('class', 'crs-label')
      .style('font-size', '18px')
      .style('fill', '#666')
      .text('CRS');

    // Interpretation text
    const interpretation = this.getInterpretation(zScore, crs);
    d3.select('.crs-interpretation')
      .html(`<p class="interpretation-text">${interpretation}</p>`);
  }

  /**
   * Render layer breakdown bar chart
   */
  private renderLayerBreakdown(): void {
    const container = d3.select('#layer-breakdown');
    const session = this.options.session;

    const data = [
      { layer: 0, lpi: session.lpi0 ?? 0, label: 'L0: Reaction Time' },
      { layer: 1, lpi: session.lpi1 ?? 0, label: 'L1: Tracking' },
      { layer: 2, lpi: session.lpi2 ?? 0, label: 'L2: + Audio' },
      { layer: 3, lpi: session.lpi3 ?? 0, label: 'L3: Full Load' }
    ];

    const margin = { top: 20, right: 30, bottom: 60, left: 60 };
    const width = 600 - margin.left - margin.right;
    const height = 300 - margin.top - margin.bottom;

    const svg = container.append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const x = d3.scaleBand()
      .domain(data.map(d => d.label))
      .range([0, width])
      .padding(0.2);

    const y = d3.scaleLinear()
      .domain([0, 100])
      .range([height, 0]);

    // Baseline range (if available)
    const crsBaseline = this.options.baselines.get('crs');
    if (crsBaseline) {
      const baselineY = y(crsBaseline.median);
      const iqrTop = y(crsBaseline.q3);
      const iqrBottom = y(crsBaseline.q1);

      svg.append('rect')
        .attr('x', 0)
        .attr('y', iqrTop)
        .attr('width', width)
        .attr('height', iqrBottom - iqrTop)
        .attr('fill', '#e3f2fd')
        .attr('opacity', 0.5);

      svg.append('line')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', baselineY)
        .attr('y2', baselineY)
        .attr('stroke', '#2196f3')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '5,5');
    }

    // Bars
    svg.selectAll('.bar')
      .data(data)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', d => x(d.label)!)
      .attr('y', d => y(d.lpi))
      .attr('width', x.bandwidth())
      .attr('height', d => height - y(d.lpi))
      .attr('fill', d => {
        const baseline = this.options.baselines.get('crs');
        if (!baseline) return '#2196f3';
        
        const z = this.calculateZScore(d.lpi, baseline);
        return this.getAlertColor(z);
      });

    // Value labels
    svg.selectAll('.label')
      .data(data)
      .enter()
      .append('text')
      .attr('class', 'value-label')
      .attr('x', d => x(d.label)! + x.bandwidth() / 2)
      .attr('y', d => y(d.lpi) - 5)
      .attr('text-anchor', 'middle')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .text(d => Math.round(d.lpi));

    // Axes
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

    svg.append('g')
      .call(d3.axisLeft(y));

    // Y-axis label
    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -50)
      .attr('x', -height / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '14px')
      .text('Layer Performance Index (LPI)');
  }

  /**
   * Render degradation curve
   */
  private renderDegradationCurve(): void {
    const container = d3.select('#degradation-curve');
    const session = this.options.session;

    const data = [
      { layer: 0, lpi: session.lpi0 ?? 0 },
      { layer: 1, lpi: session.lpi1 ?? 0 },
      { layer: 2, lpi: session.lpi2 ?? 0 },
      { layer: 3, lpi: session.lpi3 ?? 0 }
    ];

    const margin = { top: 20, right: 30, bottom: 50, left: 60 };
    const width = 600 - margin.left - margin.right;
    const height = 250 - margin.top - margin.bottom;

    const svg = container.append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const x = d3.scaleLinear()
      .domain([0, 3])
      .range([0, width]);

    const y = d3.scaleLinear()
      .domain([0, 100])
      .range([height, 0]);

    // Line generator
    const line = d3.line<{ layer: number; lpi: number }>()
      .x(d => x(d.layer))
      .y(d => y(d.lpi))
      .curve(d3.curveMonotoneX);

    // Draw line
    svg.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#2196f3')
      .attr('stroke-width', 3)
      .attr('d', line);

    // Draw points
    svg.selectAll('.dot')
      .data(data)
      .enter()
      .append('circle')
      .attr('class', 'dot')
      .attr('cx', d => x(d.layer))
      .attr('cy', d => y(d.lpi))
      .attr('r', 6)
      .attr('fill', '#2196f3')
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);

    // Value labels
    svg.selectAll('.value-label')
      .data(data)
      .enter()
      .append('text')
      .attr('class', 'value-label')
      .attr('x', d => x(d.layer))
      .attr('y', d => y(d.lpi) - 15)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .style('font-weight', 'bold')
      .text(d => Math.round(d.lpi));

    // Axes
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x)
        .tickValues([0, 1, 2, 3])
        .tickFormat(d => `L${d}`));

    svg.append('g')
      .call(d3.axisLeft(y));

    // Labels
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height + 40)
      .attr('text-anchor', 'middle')
      .style('font-size', '14px')
      .text('Test Layer');

    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -50)
      .attr('x', -height / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '14px')
      .text('Performance (LPI)');
  }

  /**
   * Render comparison metrics
   */
  private renderComparisons(): void {
    this.renderVsLast();
    this.renderVsBaseline();
  }

  /**
   * Render vs. Last Session comparison
   */
  private renderVsLast(): void {
    const container = d3.select('#vs-last');
    const { session, previousSession } = this.options;

    if (!previousSession) {
      container.html('<p class="no-data">No previous session for comparison</p>');
      return;
    }

    const comparisons = [
      {
        metric: 'CRS',
        current: session.crs ?? 0,
        previous: previousSession.crs ?? 0
      },
      {
        metric: 'DC',
        current: (session.degradationCoeff ?? 0) * 100,
        previous: (previousSession.degradationCoeff ?? 0) * 100
      },
      {
        metric: 'L0 (RT)',
        current: session.lpi0 ?? 0,
        previous: previousSession.lpi0 ?? 0
      },
      {
        metric: 'L3 (Load)',
        current: session.lpi3 ?? 0,
        previous: previousSession.lpi3 ?? 0
      }
    ];

    const html = comparisons.map(comp => {
      const delta = comp.current - comp.previous;
      const pctChange = comp.previous !== 0 
        ? (delta / comp.previous) * 100 
        : 0;

      const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '—';
      const color = delta > 0 ? '#4caf50' : delta < 0 ? '#f44336' : '#666';

      return `
        <div class="comparison-item">
          <span class="metric-name">${comp.metric}</span>
          <span class="metric-value">
            <span style="color: ${color}">
              ${arrow} ${Math.abs(delta).toFixed(1)}
            </span>
            <span class="metric-pct">(${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%)</span>
          </span>
        </div>
      `;
    }).join('');

    container.html(html);
  }

  /**
   * Render vs. Baseline comparison
   */
  private renderVsBaseline(): void {
    const container = d3.select('#vs-baseline');
    const { session, baselines } = this.options;

    if (baselines.size === 0) {
      container.html('<p class="no-data">No baseline data available</p>');
      return;
    }

    const crsBaseline = baselines.get('crs');
    
    const metrics = [
      { name: 'Overall (CRS)', value: session.crs ?? 0, baseline: crsBaseline },
      { name: 'L0 (RT)', value: session.lpi0 ?? 0, baseline: baselines.get('rt') },
      { name: 'L1 (Track)', value: session.lpi1 ?? 0, baseline: baselines.get('track_error') },
      { name: 'L3 (Load)', value: session.lpi3 ?? 0, baseline: crsBaseline }
    ];

    const html = metrics.map(metric => {
      if (!metric.baseline) {
        return `
          <div class="comparison-item">
            <span class="metric-name">${metric.name}</span>
            <span class="metric-value">No baseline</span>
          </div>
        `;
      }

      const z = this.calculateZScore(metric.value, metric.baseline);
      const interpretation = this.getZScoreInterpretation(z);
      const color = this.getAlertColor(z);

      return `
        <div class="comparison-item">
          <span class="metric-name">${metric.name}</span>
          <span class="metric-value" style="color: ${color}">
            ${interpretation} (z = ${z.toFixed(2)})
          </span>
        </div>
      `;
    }).join('');

    container.html(html);
  }

  /**
   * Attach event listeners
   */
  private attachEventListeners(): void {
    const detailsBtn = this.container.querySelector('#btn-details');
    const newSessionBtn = this.container.querySelector('#btn-new-session');
    const exportBtn = this.container.querySelector('#btn-export');

    if (detailsBtn) {
      detailsBtn.addEventListener('click', () => {
        if (this.options.onViewDetails) {
          this.options.onViewDetails();
        }
      });
    }

    if (newSessionBtn) {
      newSessionBtn.addEventListener('click', () => {
        if (this.options.onNewSession) {
          this.options.onNewSession();
        }
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        if (this.options.onExport) {
          this.options.onExport();
        }
      });
    }
  }

  /**
   * Calculate z-score
   */
  private calculateZScore(value: number, baseline: BaselineStats): number {
    if (baseline.madScaled === 0) return 0;
    return (value - baseline.median) / baseline.madScaled;
  }

  /**
   * Get alert color based on z-score
   */
  private getAlertColor(zScore: number): string {
    if (zScore < -2.0) return '#f44336'; // Red - Critical
    if (zScore < -1.5) return '#ff9800'; // Orange - Warning
    return '#4caf50'; // Green - Normal
  }

  /**
   * Get interpretation text
   */
  private getInterpretation(zScore: number, crs: number): string {
    if (zScore < -2.0) {
      return `<strong>Significant impairment detected.</strong> Your CRS of ${Math.round(crs)} is well below your baseline. Consider delaying competitive play.`;
    } else if (zScore < -1.5) {
      return `<strong>Performance below normal.</strong> Your CRS of ${Math.round(crs)} is lower than usual. Proceed with caution.`;
    } else if (zScore > 1.5) {
      return `<strong>Excellent performance!</strong> Your CRS of ${Math.round(crs)} is above your typical baseline.`;
    } else {
      return `<strong>Normal performance.</strong> Your CRS of ${Math.round(crs)} is within your typical range.`;
    }
  }

  /**
   * Get z-score interpretation
   */
  private getZScoreInterpretation(z: number): string {
    if (z < -2.0) return 'Well below baseline';
    if (z < -1.5) return 'Below baseline';
    if (z < -0.5) return 'Slightly below';
    if (z < 0.5) return 'Normal range';
    if (z < 1.5) return 'Above baseline';
    return 'Well above baseline';
  }

  /**
   * Format date
   */
  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'short'
    }).format(date);
  }

  /**
   * Destroy view
   */
  destroy(): void {
    this.container.innerHTML = '';
  }
}
