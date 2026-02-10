/**
 * Database Manager for CLST
 * Interfaces with Tauri's SQL plugin for local data persistence
 *
 * FIXES from code review:
 * - layer_metrics schema matches insert columns
 * - weight_profiles schema has is_custom and weights (JSON) columns
 * - baselines schema uses consistent column name (scope)
 * - Removed DROP TABLE checkins on startup
 * - getAllSessions uses JOIN for tags instead of N+1 queries
 * - saveRawEvents uses batched inserts
 * - updateRollingBaseline skips calibration sessions correctly (chronological)
 */

import Database from '@tauri-apps/plugin-sql';
import type {
  Session, PreSessionCheckin, RawEvent, LayerMetrics,
  BaselineStats, WeightProfile
} from '@/types';

export class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private db: Database | null = null;
  private dbPath: string = 'sqlite:clst.db';

  private constructor() {}

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  async initialize(dbPath?: string): Promise<void> {
    if (dbPath) this.dbPath = dbPath;
    try {
      this.db = await Database.load(this.dbPath);
      await this.createTables();
      console.log('Database initialized:', this.dbPath);
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  // =========================================================================
  // SCHEMA
  // =========================================================================

  private async createTables(): Promise<void> {
    const db = this.ensureDB();

    // Enable WAL mode for better concurrent read/write
    await db.execute('PRAGMA journal_mode=WAL');
    await db.execute('PRAGMA foreign_keys=ON');

    // Migration: drop old tables with incompatible schemas
    // Safe because v0.2 data isn't compatible with v0.3 scoring anyway
    const version = await this.getSchemaVersion(db);
    if (version < 3) {
      console.log(`Schema migration: v${version} → v3, recreating tables`);
      await db.execute('DROP TABLE IF EXISTS layer_metrics');
      await db.execute('DROP TABLE IF EXISTS raw_events');
      await db.execute('DROP TABLE IF EXISTS session_tags');
      await db.execute('DROP TABLE IF EXISTS baselines');
      await db.execute('DROP TABLE IF EXISTS weight_profiles');
      await db.execute('DROP TABLE IF EXISTS sessions');
      await db.execute('DROP TABLE IF EXISTS checkins');
      await db.execute('DROP TABLE IF EXISTS user_config');
    }

    await db.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        config_snapshot TEXT,
        lpi_0 REAL,
        lpi_1 REAL,
        lpi_2 REAL,
        lpi_3 REAL,
        degradation_coeff REAL,
        crs REAL,
        notes TEXT,
        checkin_id TEXT,
        profile_id TEXT,
        system_stalls INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS session_tags (
        session_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (session_id, tag),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS raw_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        layer INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        timestamp_us REAL NOT NULL,
        data TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);

    // FIX: Schema matches the columns used in saveLayerMetrics
    await db.execute(`
      CREATE TABLE IF NOT EXISTS layer_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        layer INTEGER NOT NULL,
        mean_rt REAL,
        rt_variance REAL,
        rt_std REAL,
        anticipation_count INTEGER,
        lapse_count INTEGER,
        mean_tracking_error REAL,
        tracking_error_variance REAL,
        mean_jerk REAL,
        overshoot_rate REAL,
        mean_audio_rt REAL,
        audio_accuracy REAL,
        audio_false_positives INTEGER,
        mean_prp_duration REAL,
        mean_cooldown_delay REAL,
        cooldown_miss_count INTEGER,
        mean_peripheral_rt REAL,
        peripheral_miss_rate REAL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        UNIQUE(session_id, layer)
      )
    `);

    // FIX: Consistent column name 'scope', matching save/get methods
    await db.execute(`
      CREATE TABLE IF NOT EXISTS baselines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        layer INTEGER,
        median REAL,
        mad_scaled REAL,
        q1 REAL,
        q3 REAL,
        iqr REAL,
        min_val REAL,
        max_val REAL,
        window_size INTEGER,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(scope, metric_name, layer)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS checkins (
        id TEXT PRIMARY KEY,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        sleep_quality INTEGER,
        current_state INTEGER,
        symptom_severity INTEGER,
        symptom_label TEXT,
        medication_status TEXT,
        stress_level INTEGER,
        substances TEXT,
        free_notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // FIX: Schema has is_custom and weights JSON columns
    await db.execute(`
      CREATE TABLE IF NOT EXISTS weight_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_custom INTEGER DEFAULT 0,
        weights TEXT NOT NULL DEFAULT '{}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default weight profile if not exists
    const defaultWeights = JSON.stringify({
      alpha: 0.35,
      L0: { rt: 0.6, rt_variance: 0.4 },
      L1: { track_error: 0.35, track_variance: 0.25, jerk: 0.20, overshoot: 0.20 },
      L2: { track_error: 0.25, audio_rt: 0.25, audio_accuracy: 0.20, prp: 0.30 },
      L3: { track_error: 0.15, audio_rt: 0.15, prp: 0.20, cooldown: 0.15, periph_rt: 0.15, periph_miss: 0.20 }
    });

    await db.execute(
      `INSERT OR IGNORE INTO weight_profiles (id, name, is_custom, weights)
       VALUES ('balanced', 'Balanced', 0, ?)`,
      [defaultWeights]
    );

    // Set schema version
    await db.execute(
      `INSERT OR REPLACE INTO user_config (key, value, updated_at) VALUES ('schema_version', '3', CURRENT_TIMESTAMP)`
    );
  }

  private async getSchemaVersion(database: Database): Promise<number> {
    try {
      // Check if user_config table exists
      const tables = await database.select<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='user_config'"
      );
      if (tables.length === 0) return 0;

      const results = await database.select<Array<{ value: string }>>(
        "SELECT value FROM user_config WHERE key = 'schema_version'"
      );
      return results.length > 0 ? parseInt(results[0].value) || 0 : 0;
    } catch {
      return 0;
    }
  }

  private ensureDB(): Database {
    if (!this.db) throw new Error('Database not initialized. Call initialize() first.');
    return this.db;
  }

  // =========================================================================
  // SESSIONS
  // =========================================================================

  async saveSession(session: Session): Promise<string> {
    const db = this.ensureDB();
    await db.execute(
      `INSERT INTO sessions (
        id, timestamp, config_snapshot, lpi_0, lpi_1, lpi_2, lpi_3,
        degradation_coeff, crs, notes, checkin_id, profile_id, system_stalls
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id, session.timestamp.toISOString(),
        JSON.stringify(session.configSnapshot),
        session.lpi0, session.lpi1, session.lpi2, session.lpi3,
        session.degradationCoeff, session.crs, session.notes,
        session.checkinId, session.profileId, session.systemStalls
      ]
    );

    if (session.tags?.length) {
      for (const tag of session.tags) {
        await db.execute('INSERT INTO session_tags (session_id, tag) VALUES (?, ?)', [session.id, tag]);
      }
    }
    return session.id;
  }

  async getSession(id: string): Promise<Session | null> {
    const db = this.ensureDB();
    const results = await db.select<any[]>('SELECT * FROM sessions WHERE id = ?', [id]);
    if (results.length === 0) return null;
    const row = results[0];
    const tags = await db.select<Array<{ tag: string }>>(
      'SELECT tag FROM session_tags WHERE session_id = ?', [id]
    );
    return this.rowToSession(row, tags.map(t => t.tag));
  }

  // FIX: Uses LEFT JOIN to avoid N+1 tag queries
  async getAllSessions(limit?: number): Promise<Session[]> {
    const db = this.ensureDB();
    const query = limit
      ? 'SELECT s.*, GROUP_CONCAT(st.tag) as tags_csv FROM sessions s LEFT JOIN session_tags st ON s.id = st.session_id GROUP BY s.id ORDER BY s.timestamp DESC LIMIT ?'
      : 'SELECT s.*, GROUP_CONCAT(st.tag) as tags_csv FROM sessions s LEFT JOIN session_tags st ON s.id = st.session_id GROUP BY s.id ORDER BY s.timestamp DESC';
    const params = limit ? [limit] : [];
    const results = await db.select<any[]>(query, params);
    return results.map(row => this.rowToSession(row, row.tags_csv ? row.tags_csv.split(',') : []));
  }

  async getSessionCount(): Promise<number> {
    const db = this.ensureDB();
    const results = await db.select<Array<{ count: number }>>('SELECT COUNT(*) as count FROM sessions');
    return results[0]?.count ?? 0;
  }

  private rowToSession(row: any, tags: string[]): Session {
    return {
      id: row.id,
      timestamp: new Date(row.timestamp),
      configSnapshot: JSON.parse(row.config_snapshot || '{}'),
      lpi0: row.lpi_0,
      lpi1: row.lpi_1,
      lpi2: row.lpi_2,
      lpi3: row.lpi_3,
      degradationCoeff: row.degradation_coeff,
      crs: row.crs,
      notes: row.notes,
      tags,
      checkinId: row.checkin_id,
      profileId: row.profile_id || 'balanced',
      systemStalls: row.system_stalls || 0
    };
  }

  // =========================================================================
  // CHECK-INS
  // =========================================================================

  async saveCheckin(checkin: PreSessionCheckin): Promise<string> {
    const db = this.ensureDB();
    await db.execute(
      `INSERT INTO checkins (id, sleep_quality, current_state, symptom_severity,
        symptom_label, medication_status, stress_level, substances, free_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        checkin.id, checkin.sleepQuality, checkin.currentState,
        checkin.symptomSeverity, checkin.symptomLabel, checkin.medicationStatus,
        checkin.stressLevel, JSON.stringify(checkin.substances), checkin.freeNotes
      ]
    );
    return checkin.id;
  }

  async getCheckin(id: string): Promise<PreSessionCheckin | null> {
    const db = this.ensureDB();
    const results = await db.select<any[]>('SELECT * FROM checkins WHERE id = ?', [id]);
    if (results.length === 0) return null;
    const r = results[0];
    return {
      id: r.id,
      sleepQuality: r.sleep_quality,
      currentState: r.current_state,
      symptomSeverity: r.symptom_severity,
      symptomLabel: r.symptom_label,
      medicationStatus: r.medication_status,
      stressLevel: r.stress_level,
      substances: JSON.parse(r.substances || '[]'),
      freeNotes: r.free_notes
    };
  }

  // FIX: Single query instead of N+1
  async getSymptomHistory(): Promise<string[]> {
    const db = this.ensureDB();
    const results = await db.select<Array<{ symptom_label: string }>>(
      'SELECT DISTINCT symptom_label FROM checkins WHERE symptom_label IS NOT NULL AND symptom_label != "" ORDER BY symptom_label'
    );
    return results.map(r => r.symptom_label);
  }

  // =========================================================================
  // RAW EVENTS — batched insert
  // =========================================================================

  async saveRawEvents(events: RawEvent[]): Promise<void> {
    const db = this.ensureDB();
    if (events.length === 0) return;

    await db.execute('BEGIN TRANSACTION');
    try {
      // Batch in groups of 200
      const batchSize = 200;
      for (let i = 0; i < events.length; i += batchSize) {
        const batch = events.slice(i, i + batchSize);
        const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
        const params: any[] = [];
        for (const event of batch) {
          params.push(
            event.sessionId, event.layer, event.eventType,
            event.timestampUs, JSON.stringify(event.data)
          );
        }
        await db.execute(
          `INSERT INTO raw_events (session_id, layer, event_type, timestamp_us, data) VALUES ${placeholders}`,
          params
        );
      }
      await db.execute('COMMIT');
    } catch (error) {
      await db.execute('ROLLBACK');
      throw error;
    }
  }

  // =========================================================================
  // LAYER METRICS
  // =========================================================================

  async saveLayerMetrics(metrics: LayerMetrics): Promise<void> {
    const db = this.ensureDB();
    await db.execute(
      `INSERT INTO layer_metrics (
        session_id, layer,
        mean_rt, rt_variance, rt_std, anticipation_count, lapse_count,
        mean_tracking_error, tracking_error_variance, mean_jerk, overshoot_rate,
        mean_audio_rt, audio_accuracy, audio_false_positives, mean_prp_duration,
        mean_cooldown_delay, cooldown_miss_count,
        mean_peripheral_rt, peripheral_miss_rate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        metrics.sessionId, metrics.layer,
        metrics.meanRT ?? null, metrics.rtVariance ?? null, metrics.rtStd ?? null,
        metrics.anticipationCount ?? null, metrics.lapseCount ?? null,
        metrics.meanTrackingError ?? null, metrics.trackingErrorVariance ?? null,
        metrics.meanJerk ?? null, metrics.overshootRate ?? null,
        metrics.meanAudioRT ?? null, metrics.audioAccuracy ?? null,
        metrics.audioFalsePositives ?? null, metrics.meanPRPDuration ?? null,
        metrics.meanCooldownDelay ?? null, metrics.cooldownMissCount ?? null,
        metrics.meanPeripheralRT ?? null, metrics.peripheralMissRate ?? null
      ]
    );
  }

  async getLayerMetrics(sessionId: string): Promise<LayerMetrics[]> {
    const db = this.ensureDB();
    const results = await db.select<any[]>(
      'SELECT * FROM layer_metrics WHERE session_id = ? ORDER BY layer', [sessionId]
    );
    return results.map(r => ({
      sessionId: r.session_id,
      layer: r.layer,
      meanRT: r.mean_rt ?? undefined,
      rtVariance: r.rt_variance ?? undefined,
      rtStd: r.rt_std ?? undefined,
      anticipationCount: r.anticipation_count ?? undefined,
      lapseCount: r.lapse_count ?? undefined,
      meanTrackingError: r.mean_tracking_error ?? undefined,
      trackingErrorVariance: r.tracking_error_variance ?? undefined,
      meanJerk: r.mean_jerk ?? undefined,
      overshootRate: r.overshoot_rate ?? undefined,
      meanAudioRT: r.mean_audio_rt ?? undefined,
      audioAccuracy: r.audio_accuracy ?? undefined,
      audioFalsePositives: r.audio_false_positives ?? undefined,
      meanPRPDuration: r.mean_prp_duration ?? undefined,
      meanCooldownDelay: r.mean_cooldown_delay ?? undefined,
      cooldownMissCount: r.cooldown_miss_count ?? undefined,
      meanPeripheralRT: r.mean_peripheral_rt ?? undefined,
      peripheralMissRate: r.peripheral_miss_rate ?? undefined,
    }));
  }

  // =========================================================================
  // BASELINES — FIX: consistent 'scope' column
  // =========================================================================

  async saveBaseline(scope: string, metricName: string, layer: number | null, stats: BaselineStats): Promise<void> {
    const db = this.ensureDB();
    await db.execute(
      `INSERT OR REPLACE INTO baselines (scope, metric_name, layer,
        median, mad_scaled, q1, q3, iqr, min_val, max_val, window_size, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [scope, metricName, layer, stats.median, stats.madScaled,
       stats.q1, stats.q3, stats.iqr, stats.minVal, stats.maxVal, stats.windowSize]
    );
  }

  async getBaseline(scope: string, metricName: string, layer: number | null): Promise<BaselineStats | null> {
    const db = this.ensureDB();
    const results = await db.select<any[]>(
      'SELECT * FROM baselines WHERE scope = ? AND metric_name = ? AND layer IS ?',
      [scope, metricName, layer]
    );
    if (results.length === 0) return null;
    const r = results[0];
    return {
      median: r.median, madScaled: r.mad_scaled,
      q1: r.q1, q3: r.q3, iqr: r.iqr,
      minVal: r.min_val, maxVal: r.max_val, windowSize: r.window_size
    };
  }

  // FIX: Skips calibration sessions correctly (first 5 chronologically, not most recent)
  async updateRollingBaseline(metricName: string, layer: number, windowSize: number = 20): Promise<void> {
    const db = this.ensureDB();
    const allSessions = await this.getAllSessions();
    // getAllSessions returns DESC — reverse to get chronological order
    const chronological = [...allSessions].reverse();
    // Skip first 5 (calibration)
    const postCalibration = chronological.slice(5);
    // Take the most recent W from post-calibration
    const recent = postCalibration.slice(-windowSize);

    if (recent.length === 0) return;

    const values: number[] = [];
    for (const session of recent) {
      const metrics = await this.getLayerMetrics(session.id);
      const layerMetric = metrics.find(m => m.layer === layer);
      if (layerMetric) {
        const value = this.extractMetricValue(layerMetric, metricName);
        if (value !== null) values.push(value);
      }
    }
    if (values.length === 0) return;

    // Compute stats
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const median = n % 2 === 1 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const q1Index = Math.floor(n / 4);
    const q3Index = Math.floor(3 * n / 4);
    const q1 = sorted[q1Index], q3 = sorted[q3Index], iqr = q3 - q1;
    const deviations = values.map(v => Math.abs(v - median)).sort((a, b) => a - b);
    const madMedian = deviations[Math.floor(deviations.length / 2)];

    await this.saveBaseline('rolling', metricName, layer, {
      median, madScaled: 1.4826 * madMedian, q1, q3, iqr,
      minVal: sorted[0], maxVal: sorted[n - 1], windowSize: values.length
    });
  }

  private extractMetricValue(metrics: LayerMetrics, metricName: string): number | null {
    const map: Record<string, keyof LayerMetrics> = {
      'rt': 'meanRT', 'rt_variance': 'rtVariance',
      'track_error': 'meanTrackingError', 'track_variance': 'trackingErrorVariance',
      'jerk': 'meanJerk', 'overshoot': 'overshootRate',
      'audio_rt': 'meanAudioRT', 'audio_accuracy': 'audioAccuracy',
      'prp': 'meanPRPDuration', 'cooldown': 'meanCooldownDelay',
      'periph_rt': 'meanPeripheralRT', 'periph_miss': 'peripheralMissRate'
    };
    const key = map[metricName];
    if (!key) return null;
    const value = metrics[key];
    return typeof value === 'number' ? value : null;
  }

  // =========================================================================
  // CONFIG
  // =========================================================================

  async getConfig(key: string): Promise<string | null> {
    const db = this.ensureDB();
    const results = await db.select<Array<{ value: string }>>(
      'SELECT value FROM user_config WHERE key = ?', [key]
    );
    return results.length > 0 ? results[0].value : null;
  }

  async setConfig(key: string, value: string): Promise<void> {
    const db = this.ensureDB();
    await db.execute(
      'INSERT OR REPLACE INTO user_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [key, value]
    );
  }

  // =========================================================================
  // WEIGHT PROFILES
  // =========================================================================

  async getWeightProfile(id: string): Promise<WeightProfile | null> {
    const db = this.ensureDB();
    const results = await db.select<any[]>('SELECT * FROM weight_profiles WHERE id = ?', [id]);
    if (results.length === 0) return null;
    const r = results[0];
    return { id: r.id, name: r.name, isCustom: r.is_custom === 1, weights: JSON.parse(r.weights) };
  }

  async saveCustomWeightProfile(profile: WeightProfile): Promise<void> {
    const db = this.ensureDB();
    await db.execute(
      'INSERT OR REPLACE INTO weight_profiles (id, name, is_custom, weights) VALUES (?, ?, ?, ?)',
      [profile.id, profile.name, profile.isCustom ? 1 : 0, JSON.stringify(profile.weights)]
    );
  }

  // =========================================================================
  // CLEANUP
  // =========================================================================

  async deleteSession(sessionId: string): Promise<void> {
    const db = this.ensureDB();
    await db.execute('DELETE FROM sessions WHERE id = ?', [sessionId]);
  }

  async updateSessionNotes(sessionId: string, notes: string): Promise<void> {
    const db = this.ensureDB();
    await db.execute('UPDATE sessions SET notes = ? WHERE id = ?', [notes, sessionId]);
  }

  async addSessionTag(sessionId: string, tag: string): Promise<void> {
    const db = this.ensureDB();
    await db.execute('INSERT OR IGNORE INTO session_tags (session_id, tag) VALUES (?, ?)', [sessionId, tag]);
  }

  async removeSessionTag(sessionId: string, tag: string): Promise<void> {
    const db = this.ensureDB();
    await db.execute('DELETE FROM session_tags WHERE session_id = ? AND tag = ?', [sessionId, tag]);
  }

  async getAllTags(): Promise<string[]> {
    const db = this.ensureDB();
    const results = await db.select<Array<{ tag: string }>>('SELECT DISTINCT tag FROM session_tags ORDER BY tag');
    return results.map(r => r.tag);
  }

  async exportAllSessions(): Promise<string> {
    const sessions = await this.getAllSessions();
    if (sessions.length === 0) return '';
    const headers = ['Session ID','Timestamp','CRS','DC','LPI L0','LPI L1','LPI L2','LPI L3','System Stalls','Tags','Notes'];
    const rows = sessions.map(s => [
      s.id, s.timestamp.toISOString(),
      s.crs?.toString() ?? '', s.degradationCoeff?.toString() ?? '',
      s.lpi0?.toString() ?? '', s.lpi1?.toString() ?? '',
      s.lpi2?.toString() ?? '', s.lpi3?.toString() ?? '',
      s.systemStalls.toString(), s.tags.join(';'),
      (s.notes || '').replace(/,/g, ';').replace(/\n/g, ' ')
    ]);
    return [headers, ...rows].map(r => r.join(',')).join('\n');
  }

  /** Get all checkins with their linked session CRS for correlation analysis */
  async getCheckinsWithScores(): Promise<Array<{
    sleepQuality: number | null; currentState: number | null;
    stressLevel: number | null; substances: string[]; crs: number | null;
  }>> {
    const db = this.ensureDB();
    const results = await db.select<any[]>(
      `SELECT c.sleep_quality, c.current_state, c.stress_level, c.substances, s.crs
       FROM checkins c INNER JOIN sessions s ON s.checkin_id = c.id
       ORDER BY s.timestamp`
    );
    return results.map(r => ({
      sleepQuality: r.sleep_quality, currentState: r.current_state,
      stressLevel: r.stress_level, substances: JSON.parse(r.substances || '[]'),
      crs: r.crs
    }));
  }

  async deleteAllData(): Promise<void> {
    const db = this.ensureDB();
    await db.execute('DELETE FROM raw_events');
    await db.execute('DELETE FROM layer_metrics');
    await db.execute('DELETE FROM session_tags');
    await db.execute('DELETE FROM baselines');
    await db.execute('DELETE FROM sessions');
    await db.execute('DELETE FROM checkins');
  }

  async close(): Promise<void> {
    if (this.db) { await this.db.close(); this.db = null; }
  }
}

export const db = DatabaseManager.getInstance();
