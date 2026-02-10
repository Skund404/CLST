/**
 * Historical Dashboard for CLST
 * Implements Section 8 (DASHBOARD & COMPARISON) - Historical View
 * Provides comprehensive analytics across sessions
 */

import * as d3 from 'd3';
import type { Session, BaselineStats } from '@/types';
import { Statistics } from '@/lib/statistics';
import { db } from '@/lib/database';

type DashboardTab = 'timeline' | 'comparison' | 'metrics' | 'distribution' | 'correlation';
type TimeRange = '7d' | '30d' | '90d' | 'all';

export interface DashboardOptions {
  initialTab?: DashboardTab;
  onSessionSelect?: (sessionId: string) => void;
}

export class Dashboard {
  private container: HTMLElement;
  private options: DashboardOptions;
  private currentTab: DashboardTab = 'timeline';
  private sessions: Session[] = [];
  private baselines: Map<string, BaselineStats> = new Map();
  private timeRange: TimeRange = '30d';
  private selectedTags: Set<string> = new Set();

  // Chart dimensions
  private readonly CHART_WIDTH = 900;
  private readonly CHART_HEIGHT = 400;
  private readonly MARGIN = { top: 20, right: 30, bottom: 60, left: 60 };

  constructor(container: HTMLElement, options: DashboardOptions = {}) {
    this.container = container;
    this.options = options;
    this.currentTab = options.initialTab || 'timeline';
  }

  /**
   * Render the dashboard
   */
  async render(): Promise<void> {
    // Load data
    await this.loadData();

    // Create dashboard structure
    this.createDashboardUI();

    // Render initial tab
    this.renderCurrentTab();
  }

  /**
   * Load session data and baselines
   */
  private async loadData(): Promise<void> {
    // Load all sessions
    this.sessions = await db.getAllSessions();

    // Load CRS baseline
    const crsBaseline = await db.getBaseline('rolling', 'crs', null);
    if (crsBaseline) {
      this.baselines.set('crs', crsBaseline);
    }
  }

  /**
   * Create dashboard UI structure
   */
  private createDashboardUI(): void {
    this.container.innerHTML = `
      <div class="dashboard">
        <div class="dashboard-header">
          <h2>Performance Dashboard</h2>
          <div class="dashboard-controls">
            <select id="time-range" class="dashboard-select">
              <option value="7d">Last 7 Days</option>
              <option value="30d" selected>Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              <option value="all">All Time</option>
            </select>
          </div>
        </div>

        <!-- Tab Navigation -->
        <nav class="dashboard-tabs">
          <button class="tab-button ${this.currentTab === 'timeline' ? 'active' : ''}" data-tab="timeline">
            Timeline
          </button>
          <button class="tab-button ${this.currentTab === 'comparison' ? 'active' : ''}" data-tab="comparison">
            Comparison
          </button>
          <button class="tab-button ${this.currentTab === 'metrics' ? 'active' : ''}" data-tab="metrics">
            Metrics
          </button>
          <button class="tab-button ${this.currentTab === 'distribution' ? 'active' : ''}" data-tab="distribution">
            Distribution
          </button>
          <button class="tab-button ${this.currentTab === 'correlation' ? 'active' : ''}" data-tab="correlation">
            Correlation
          </button>
        </nav>

        <!-- Tab Content -->
        <div class="dashboard-content" id="dashboard-content">
          <!-- Dynamic content loaded here -->
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  /**
   * Attach event listeners
   */
  private attachEventListeners(): void {
    // Tab buttons
    const tabButtons = this.container.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const tab = (e.target as HTMLElement).dataset.tab as DashboardTab;
        this.switchTab(tab);
      });
    });

    // Time range selector
    const timeRangeSelect = this.container.querySelector('#time-range') as HTMLSelectElement;
    if (timeRangeSelect) {
      timeRangeSelect.addEventListener('change', (e) => {
        this.timeRange = (e.target as HTMLSelectElement).value as TimeRange;
        this.renderCurrentTab();
      });
    }
  }

  /**
   * Switch to a different tab
   */
  private switchTab(tab: DashboardTab): void {
    this.currentTab = tab;

    // Update active tab button
    const tabButtons = this.container.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
      button.classList.remove('active');
      if (button.getAttribute('data-tab') === tab) {
        button.classList.add('active');
      }
    });

    this.renderCurrentTab();
  }

  /**
   * Render current tab content
   */
  private renderCurrentTab(): void {
    const content = this.container.querySelector('#dashboard-content');
    if (!content) return;

    // Clear content
    content.innerHTML = '';

    // Render appropriate tab
    switch (this.currentTab) {
      case 'timeline':
        this.renderTimelineTab(content as HTMLElement);
        break;
      case 'comparison':
        this.renderComparisonTab(content as HTMLElement);
        break;
      case 'metrics':
        this.renderMetricsTab(content as HTMLElement);
        break;
      case 'distribution':
        this.renderDistributionTab(content as HTMLElement);
        break;
      case 'correlation':
        this.renderCorrelationTab(content as HTMLElement);
        break;
    }
  }

  /**
   * Render Timeline Tab
   */
  private renderTimelineTab(container: HTMLElement): void {
    const filteredSessions = this.filterSessionsByTimeRange(this.sessions);

    if (filteredSessions.length === 0) {
      container.innerHTML = '<p class="no-data">No sessions in selected time range</p>';
      return;
    }

    container.innerHTML = '<div id="timeline-chart"></div>';
    const chartContainer = container.querySelector('#timeline-chart') as HTMLElement;

    // Prepare data
    const data = filteredSessions
      .filter(s => s.crs !== null)
      .map(s => ({
        date: s.timestamp,
        crs: s.crs!,
        session: s
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    // Create SVG
    const width = this.CHART_WIDTH;
    const height = this.CHART_HEIGHT;
    const margin = this.MARGIN;

    const svg = d3.select(chartContainer)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Scales
    const x = d3.scaleTime()
      .domain(d3.extent(data, d => d.date) as [Date, Date])
      .range([0, chartWidth]);

    const y = d3.scaleLinear()
      .domain([0, 100])
      .range([chartHeight, 0]);

    // Baseline bands
    const baseline = this.baselines.get('crs');
    if (baseline) {
      // IQR band (Q1 to Q3)
      g.append('rect')
        .attr('x', 0)
        .attr('y', y(baseline.q3))
        .attr('width', chartWidth)
        .attr('height', y(baseline.q1) - y(baseline.q3))
        .attr('fill', '#4caf50')
        .attr('opacity', 0.1);

      // ±1.5 MAD bands
      const upperBand = baseline.median + (1.5 * baseline.madScaled);
      const lowerBand = baseline.median - (1.5 * baseline.madScaled);

      g.append('rect')
        .attr('x', 0)
        .attr('y', y(Math.min(upperBand, 100)))
        .attr('width', chartWidth)
        .attr('height', y(lowerBand) - y(Math.min(upperBand, 100)))
        .attr('fill', '#ffc107')
        .attr('opacity', 0.05);

      // Median line
      g.append('line')
        .attr('x1', 0)
        .attr('x2', chartWidth)
        .attr('y1', y(baseline.median))
        .attr('y2', y(baseline.median))
        .attr('stroke', '#2196f3')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '5,5');
    }

    // Line
    const line = d3.line<typeof data[0]>()
      .x(d => x(d.date))
      .y(d => y(d.crs));

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#2196f3')
      .attr('stroke-width', 2)
      .attr('d', line);

    // Points
    const tooltip = d3.select('body')
      .append('div')
      .attr('class', 'chart-tooltip')
      .style('display', 'none');

    g.selectAll('.point')
      .data(data)
      .enter()
      .append('circle')
      .attr('class', 'point')
      .attr('cx', d => x(d.date))
      .attr('cy', d => y(d.crs))
      .attr('r', 5)
      .attr('fill', d => {
        if (!baseline) return '#2196f3';
        const z = (d.crs - baseline.median) / baseline.madScaled;
        if (z < -2) return '#f44336';
        if (z < -1.5) return '#ff9800';
        return '#2196f3';
      })
      .on('mouseover', (event, d) => {
        tooltip
          .style('display', 'block')
          .html(`
            <strong>CRS: ${d.crs.toFixed(1)}</strong><br>
            Date: ${d.date.toLocaleDateString()}<br>
            DC: ${d.session.degradationCoeff ? (d.session.degradationCoeff * 100).toFixed(1) + '%' : 'N/A'}
          `)
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY - 28) + 'px');
      })
      .on('mouseout', () => {
        tooltip.style('display', 'none');
      });

    // Axes
    g.append('g')
      .attr('transform', `translate(0, ${chartHeight})`)
      .call(d3.axisBottom(x).ticks(6))
      .selectAll('text')
      .style('font-size', '12px');

    g.append('g')
      .call(d3.axisLeft(y))
      .selectAll('text')
      .style('font-size', '12px');

    // Labels
    g.append('text')
      .attr('x', chartWidth / 2)
      .attr('y', chartHeight + 50)
      .attr('text-anchor', 'middle')
      .style('font-size', '14px')
      .text('Date');

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -50)
      .attr('x', -chartHeight / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '14px')
      .text('Cognitive Readiness Score (CRS)');
  }

  /**
   * Render Comparison Tab
   */
  private renderComparisonTab(container: HTMLElement): void {
    if (this.sessions.length < 2) {
      container.innerHTML = '<p class="no-data">Need at least 2 sessions for comparison</p>';
      return;
    }

    container.innerHTML = `
      <div class="comparison-container">
        <div class="comparison-selectors">
          <div class="selector-group">
            <label>Session A:</label>
            <select id="session-a" class="dashboard-select">
              ${this.sessions.map((s, i) => `
                <option value="${s.id}" ${i === 0 ? 'selected' : ''}>
                  ${s.timestamp.toLocaleDateString()} - CRS: ${s.crs?.toFixed(1) || 'N/A'}
                </option>
              `).join('')}
            </select>
          </div>
          <div class="selector-group">
            <label>Session B:</label>
            <select id="session-b" class="dashboard-select">
              ${this.sessions.map((s, i) => `
                <option value="${s.id}" ${i === 1 ? 'selected' : ''}>
                  ${s.timestamp.toLocaleDateString()} - CRS: ${s.crs?.toFixed(1) || 'N/A'}
                </option>
              `).join('')}
            </select>
          </div>
        </div>
        <div id="comparison-content"></div>
      </div>
    `;

    const renderComparison = () => {
      const sessionAId = (container.querySelector('#session-a') as HTMLSelectElement).value;
      const sessionBId = (container.querySelector('#session-b') as HTMLSelectElement).value;

      const sessionA = this.sessions.find(s => s.id === sessionAId);
      const sessionB = this.sessions.find(s => s.id === sessionBId);

      if (!sessionA || !sessionB) return;

      const comparisonContent = container.querySelector('#comparison-content') as HTMLElement;
      comparisonContent.innerHTML = this.generateComparisonHTML(sessionA, sessionB);
    };

    // Initial render
    renderComparison();

    // Update on selection change
    container.querySelector('#session-a')?.addEventListener('change', renderComparison);
    container.querySelector('#session-b')?.addEventListener('change', renderComparison);
  }

  /**
   * Generate comparison HTML
   */
  private generateComparisonHTML(sessionA: Session, sessionB: Session): string {
    const metrics = [
      { name: 'CRS', a: sessionA.crs, b: sessionB.crs },
      { name: 'DC', a: sessionA.degradationCoeff ? sessionA.degradationCoeff * 100 : null, b: sessionB.degradationCoeff ? sessionB.degradationCoeff * 100 : null },
      { name: 'L0', a: sessionA.lpi0, b: sessionB.lpi0 },
      { name: 'L1', a: sessionA.lpi1, b: sessionB.lpi1 },
      { name: 'L2', a: sessionA.lpi2, b: sessionB.lpi2 },
      { name: 'L3', a: sessionA.lpi3, b: sessionB.lpi3 }
    ];

    return `
      <table class="comparison-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Session A</th>
            <th>Session B</th>
            <th>Δ Absolute</th>
            <th>% Change</th>
          </tr>
        </thead>
        <tbody>
          ${metrics.map(m => {
            if (m.a === null || m.b === null) {
              return `
                <tr>
                  <td>${m.name}</td>
                  <td>N/A</td>
                  <td>N/A</td>
                  <td>N/A</td>
                  <td>N/A</td>
                </tr>
              `;
            }

            const delta = m.b - m.a;
            const pctChange = m.a !== 0 ? (delta / m.a) * 100 : 0;
            const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '—';
            const color = delta > 0 ? '#4caf50' : delta < 0 ? '#f44336' : '#666';

            return `
              <tr>
                <td><strong>${m.name}</strong></td>
                <td>${m.a.toFixed(1)}</td>
                <td>${m.b.toFixed(1)}</td>
                <td style="color: ${color}">
                  ${arrow} ${Math.abs(delta).toFixed(1)}
                </td>
                <td style="color: ${color}">
                  ${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  /**
   * Render Metrics Tab
   */
  private renderMetricsTab(container: HTMLElement): void {
    container.innerHTML = `
      <div class="metrics-container">
        <div class="metric-selector">
          <label>Select Metric:</label>
          <select id="metric-select" class="dashboard-select">
            <option value="crs">CRS (Cognitive Readiness)</option>
            <option value="dc">DC (Degradation Coefficient)</option>
            <option value="lpi0">L0 (Simple RT)</option>
            <option value="lpi1">L1 (Tracking)</option>
            <option value="lpi2">L2 (Tracking + Audio)</option>
            <option value="lpi3">L3 (Full Load)</option>
          </select>
        </div>
        <div id="metric-chart"></div>
        <div id="metric-stats"></div>
      </div>
    `;

    const renderMetric = () => {
      const metric = (container.querySelector('#metric-select') as HTMLSelectElement).value;
      this.renderMetricAnalysis(container, metric);
    };

    renderMetric();
    container.querySelector('#metric-select')?.addEventListener('change', renderMetric);
  }

  /**
   * Render metric analysis
   */
  private renderMetricAnalysis(container: HTMLElement, metric: string): void {
    const chartContainer = container.querySelector('#metric-chart') as HTMLElement;
    const statsContainer = container.querySelector('#metric-stats') as HTMLElement;

    chartContainer.innerHTML = '';
    statsContainer.innerHTML = '';

    // Extract values
    const data = this.sessions
      .map(s => ({
        date: s.timestamp,
        value: this.getMetricValue(s, metric)
      }))
      .filter(d => d.value !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (data.length < 3) {
      chartContainer.innerHTML = '<p class="no-data">Insufficient data for trend analysis</p>';
      return;
    }

    // Calculate trend (Theil-Sen estimator)
    const values = data.map(d => d.value!);
    const trend = this.calculateTheilSenTrend(values);
    const kendallTau = this.calculateKendallTau(values);

    // Determine trend direction
    let trendIndicator = '→ Stable';
    let trendColor = '#666';
    
    if (Math.abs(kendallTau) > 0.3) {
      if (trend > 0) {
        trendIndicator = '↑ Improving';
        trendColor = '#4caf50';
      } else {
        trendIndicator = '↓ Declining';
        trendColor = '#f44336';
      }
    }

    // Render stats
    statsContainer.innerHTML = `
      <div class="metric-stats-grid">
        <div class="stat-item">
          <span class="stat-label">Trend:</span>
          <span class="stat-value" style="color: ${trendColor}">
            ${trendIndicator}
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Kendall's τ:</span>
          <span class="stat-value">${kendallTau.toFixed(3)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Slope:</span>
          <span class="stat-value">${trend.toFixed(3)}/session</span>
        </div>
      </div>
    `;

    // Render chart (simple for now)
    chartContainer.innerHTML = '<p class="info-text">Trend line visualization</p>';
  }

  /**
   * Render Distribution Tab
   */
  private renderDistributionTab(container: HTMLElement): void {
    if (this.sessions.length < 5) {
      container.innerHTML = '<p class="no-data">Need at least 5 sessions for distribution analysis</p>';
      return;
    }

    container.innerHTML = `
      <div class="distribution-container">
        <div id="distribution-chart"></div>
        <div id="distribution-stats"></div>
      </div>
    `;

    const chartContainer = container.querySelector('#distribution-chart') as HTMLElement;
    const statsContainer = container.querySelector('#distribution-stats') as HTMLElement;

    // Extract CRS values
    const values = this.sessions
      .filter(s => s.crs !== null)
      .map(s => s.crs!);

    // Calculate statistics
    const mean = d3.mean(values) || 0;
    const median = d3.median(values) || 0;
    const std = d3.deviation(values) || 0;
    const skewness = this.calculateSkewness(values);
    const kurtosis = this.calculateKurtosis(values);

    // Latest session percentile
    const latestCRS = this.sessions[0]?.crs || 0;
    const percentile = this.calculatePercentile(latestCRS, values);

    // Render stats
    statsContainer.innerHTML = `
      <div class="distribution-stats-grid">
        <div class="stat-card">
          <h4>Mean</h4>
          <p class="stat-big">${mean.toFixed(1)}</p>
        </div>
        <div class="stat-card">
          <h4>Median</h4>
          <p class="stat-big">${median.toFixed(1)}</p>
        </div>
        <div class="stat-card">
          <h4>Std Dev</h4>
          <p class="stat-big">${std.toFixed(1)}</p>
        </div>
        <div class="stat-card">
          <h4>Skewness</h4>
          <p class="stat-big">${skewness.toFixed(2)}</p>
        </div>
        <div class="stat-card">
          <h4>Kurtosis</h4>
          <p class="stat-big">${kurtosis.toFixed(2)}</p>
        </div>
        <div class="stat-card">
          <h4>Latest Percentile</h4>
          <p class="stat-big">${percentile.toFixed(0)}th</p>
        </div>
      </div>
    `;

    chartContainer.innerHTML = '<p class="info-text">Histogram with KDE overlay</p>';
  }

  /**
   * Render Correlation Tab
   */
  private renderCorrelationTab(container: HTMLElement): void {
    if (this.sessions.length < 15) {
      container.innerHTML = `
        <p class="no-data">
          Need at least 15 sessions for correlation analysis.<br>
          Current: ${this.sessions.length} sessions
        </p>
      `;
      return;
    }

    container.innerHTML = `
      <div class="correlation-container">
        <h3>Metric Correlations</h3>
        <div id="correlation-matrix"></div>
        <h3>Check-in vs Performance</h3>
        <div id="checkin-correlation"></div>
      </div>
    `;

    const matrixContainer = container.querySelector('#correlation-matrix') as HTMLElement;
    const checkinContainer = container.querySelector('#checkin-correlation') as HTMLElement;

    matrixContainer.innerHTML = '<p class="info-text">Correlation matrix heatmap</p>';
    checkinContainer.innerHTML = '<p class="info-text">Scatter plots with correlation coefficients</p>';
  }

  /**
   * Filter sessions by time range
   */
  private filterSessionsByTimeRange(sessions: Session[]): Session[] {
    if (this.timeRange === 'all') {
      return sessions;
    }

    const now = new Date();
    const days = this.timeRange === '7d' ? 7 : this.timeRange === '30d' ? 30 : 90;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    return sessions.filter(s => s.timestamp >= cutoff);
  }

  /**
   * Get metric value from session
   */
  private getMetricValue(session: Session, metric: string): number | null {
    switch (metric) {
      case 'crs': return session.crs;
      case 'dc': return session.degradationCoeff ? session.degradationCoeff * 100 : null;
      case 'lpi0': return session.lpi0;
      case 'lpi1': return session.lpi1;
      case 'lpi2': return session.lpi2;
      case 'lpi3': return session.lpi3;
      default: return null;
    }
  }

  /**
   * Calculate Theil-Sen trend estimator
   */
  private calculateTheilSenTrend(values: number[]): number {
    const slopes: number[] = [];
    
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        const slope = (values[j] - values[i]) / (j - i);
        slopes.push(slope);
      }
    }

    return d3.median(slopes) || 0;
  }

  /**
   * Calculate Kendall's Tau
   */
  private calculateKendallTau(values: number[]): number {
    let concordant = 0;
    let discordant = 0;

    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        const diff = (values[j] - values[i]) * (j - i);
        if (diff > 0) concordant++;
        else if (diff < 0) discordant++;
      }
    }

    const n = values.length;
    const totalPairs = (n * (n - 1)) / 2;
    
    return (concordant - discordant) / totalPairs;
  }

  /**
   * Calculate skewness
   */
  private calculateSkewness(values: number[]): number {
    const mean = d3.mean(values) || 0;
    const std = d3.deviation(values) || 1;
    const n = values.length;

    const sum = values.reduce((acc, x) => acc + Math.pow((x - mean) / std, 3), 0);
    
    return (n / ((n - 1) * (n - 2))) * sum;
  }

  /**
   * Calculate kurtosis
   */
  private calculateKurtosis(values: number[]): number {
    const mean = d3.mean(values) || 0;
    const std = d3.deviation(values) || 1;
    const n = values.length;

    const sum = values.reduce((acc, x) => acc + Math.pow((x - mean) / std, 4), 0);
    
    return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum - 
           (3 * Math.pow(n - 1, 2)) / ((n - 2) * (n - 3));
  }

  /**
   * Calculate percentile rank
   */
  private calculatePercentile(value: number, values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const rank = sorted.filter(v => v <= value).length;
    return (rank / sorted.length) * 100;
  }

  /**
   * Update dashboard with new data
   */
  async update(): Promise<void> {
    await this.loadData();
    this.renderCurrentTab();
  }

  /**
   * Destroy dashboard
   */
  destroy(): void {
    this.container.innerHTML = '';
  }
}
