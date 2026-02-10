-- CLST Initial Database Schema Migration
-- Version: 0.3.0
-- Based on CLST Specification Section 7: DATA MODEL & LOGGING
-- SQLite compatible

-- =============================================================================
-- SESSIONS TABLE
-- Core table storing one row per test session
-- =============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    config_snapshot TEXT NOT NULL, -- JSON: frozen copy of all settings at test time
    
    -- Layer Performance Indices (0-100 scores per layer)
    lpi_0 REAL CHECK(lpi_0 IS NULL OR (lpi_0 >= 0 AND lpi_0 <= 100)),
    lpi_1 REAL CHECK(lpi_1 IS NULL OR (lpi_1 >= 0 AND lpi_1 <= 100)),
    lpi_2 REAL CHECK(lpi_2 IS NULL OR (lpi_2 >= 0 AND lpi_2 <= 100)),
    lpi_3 REAL CHECK(lpi_3 IS NULL OR (lpi_3 >= 0 AND lpi_3 <= 100)),
    
    -- Composite scores
    degradation_coeff REAL CHECK(degradation_coeff IS NULL OR (degradation_coeff >= 0 AND degradation_coeff <= 2)),
    crs REAL CHECK(crs IS NULL OR (crs >= 0 AND crs <= 100)),
    
    -- User annotations
    notes TEXT,
    tags TEXT, -- JSON array of tag strings
    
    -- Foreign keys
    checkin_id TEXT,
    
    -- Configuration tracking
    profile_id TEXT DEFAULT 'balanced',
    system_stalls INTEGER DEFAULT 0,
    
    FOREIGN KEY (checkin_id) REFERENCES pre_session_checkin(id) ON DELETE SET NULL
);

-- =============================================================================
-- PRE-SESSION CHECK-IN TABLE
-- Captures subjective state before each test (Section 4)
-- =============================================================================
CREATE TABLE IF NOT EXISTS pre_session_checkin (
    id TEXT PRIMARY KEY,
    
    -- Q1: Sleep Quality (1=Terrible, 5=Great)
    sleep_quality INTEGER CHECK(sleep_quality IS NULL OR (sleep_quality >= 1 AND sleep_quality <= 5)),
    
    -- Q2: Current State (1=Terrible, 5=Excellent)
    current_state INTEGER CHECK(current_state IS NULL OR (current_state >= 1 AND current_state <= 5)),
    
    -- Q3: Symptoms (0=None, 3=Severe, plus optional label)
    symptom_severity INTEGER CHECK(symptom_severity IS NULL OR (symptom_severity >= 0 AND symptom_severity <= 3)),
    symptom_label TEXT, -- Freeform: "migraine", "brain fog", "headache", etc.
    
    -- Q4: Medication Status
    medication_status TEXT CHECK(medication_status IS NULL OR medication_status IN ('as_usual', 'late', 'missed', 'changed', 'na')),
    
    -- Q5: Stress Level (1=Relaxed, 5=Overwhelmed)
    stress_level INTEGER CHECK(stress_level IS NULL OR (stress_level >= 1 AND stress_level <= 5)),
    
    -- Q6: Substances (JSON array: ["caffeine", "alcohol", "cannabis", "other"])
    substances TEXT, -- JSON array of selected strings
    
    -- Free-text notes
    free_notes TEXT,
    
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- RAW EVENTS TABLE
-- High-resolution input events during test execution
-- All timestamps in microseconds (performance.now())
-- =============================================================================
CREATE TABLE IF NOT EXISTS raw_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    layer INTEGER NOT NULL CHECK(layer >= 0 AND layer <= 3),
    event_type TEXT NOT NULL CHECK(event_type IN (
        'stimulus_onset',
        'click',
        'keypress',
        'cursor_pos',
        'audio_cue',
        'cooldown_ready',
        'peripheral_flash'
    )),
    timestamp_us INTEGER NOT NULL, -- Microsecond timestamp from performance.now()
    data TEXT, -- JSON payload: event-specific data
    
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- =============================================================================
-- LAYER METRICS TABLE
-- Computed metrics per layer per session (Section 5)
-- One row per (session_id, layer) combination
-- =============================================================================
CREATE TABLE IF NOT EXISTS layer_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    layer INTEGER NOT NULL CHECK(layer >= 0 AND layer <= 3),
    
    -- Layer 0 metrics (Simple RT)
    mean_rt REAL,                    -- Mean reaction time (ms)
    rt_variance REAL,                -- RT variance (ms²)
    rt_std REAL,                     -- RT standard deviation (ms)
    anticipation_count INTEGER,      -- Clicks before stimulus (<100ms)
    lapse_count INTEGER,             -- Missed responses (>1500ms)
    
    -- Layer 1+ tracking metrics
    mean_tracking_error REAL,        -- Mean distance from target (pixels)
    tracking_error_variance REAL,    -- Tracking error variance
    mean_jerk REAL,                  -- Mean absolute jerk (smoothness)
    overshoot_rate REAL,             -- Overshoots per minute
    
    -- Layer 2+ audio metrics
    mean_audio_rt REAL,              -- Mean audio reaction time (ms)
    audio_accuracy REAL,             -- Correct responses / total cues (0-1)
    audio_false_positives INTEGER,   -- Incorrect distractor responses
    mean_prp_duration REAL,          -- Mean PRP duration (ms)
    
    -- Layer 3 specific metrics
    mean_cooldown_delay REAL,        -- Mean delay to press F (ms)
    cooldown_miss_count INTEGER,     -- Missed cooldown uses
    mean_peripheral_rt REAL,         -- Mean peripheral detection RT (ms)
    peripheral_miss_rate REAL,       -- Missed peripherals / total (0-1)
    
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE(session_id, layer)
);

-- =============================================================================
-- BASELINES TABLE
-- Rolling statistical summaries for performance comparison (Section 10.2)
-- Stores both 'rolling' (last N sessions) and 'first' (initial baseline)
-- =============================================================================
CREATE TABLE IF NOT EXISTS baselines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    baseline_type TEXT NOT NULL CHECK(baseline_type IN ('rolling', 'first')),
    metric_name TEXT NOT NULL,       -- e.g., 'crs', 'mean_rt', 'degradation_coeff'
    layer INTEGER CHECK(layer IS NULL OR (layer >= 0 AND layer <= 3)),
    
    -- Robust statistics (median/MAD instead of mean/SD)
    median REAL,                     -- Median value
    mad_scaled REAL,                 -- Median Absolute Deviation × 1.4826
    q1 REAL,                         -- First quartile
    q3 REAL,                         -- Third quartile
    iqr REAL,                        -- Interquartile range (Q3 - Q1)
    min_val REAL,                    -- Minimum observed value
    max_val REAL,                    -- Maximum observed value
    
    window_size INTEGER,             -- Number of sessions in baseline
    last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(baseline_type, metric_name, layer)
);

-- =============================================================================
-- USER CONFIGURATION TABLE
-- Key-value store for application settings (Section 6)
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- SESSION TAGS TABLE
-- User-defined tags for filtering and analysis (Section 8)
-- =============================================================================
CREATE TABLE IF NOT EXISTS session_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    tag TEXT NOT NULL,               -- e.g., 'post-seizure', 'caffeinated', 'tired'
    
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE(session_id, tag)
);

-- =============================================================================
-- WEIGHT PROFILES TABLE
-- Scoring weight configurations (Section 10.8)
-- Stores both default presets and user-created custom profiles
-- =============================================================================
CREATE TABLE IF NOT EXISTS weight_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_custom INTEGER NOT NULL DEFAULT 0 CHECK(is_custom IN (0, 1)),
    weights TEXT NOT NULL,           -- JSON object containing all layer weights
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- INDICES FOR PERFORMANCE
-- =============================================================================

-- Sessions indices
CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON sessions(timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_profile ON sessions(profile_id);
CREATE INDEX IF NOT EXISTS idx_sessions_checkin ON sessions(checkin_id);

-- Raw events indices (critical for query performance)
CREATE INDEX IF NOT EXISTS idx_raw_events_session ON raw_events(session_id, layer);
CREATE INDEX IF NOT EXISTS idx_raw_events_type ON raw_events(event_type);
CREATE INDEX IF NOT EXISTS idx_raw_events_timestamp ON raw_events(timestamp_us);

-- Layer metrics indices
CREATE INDEX IF NOT EXISTS idx_layer_metrics_session ON layer_metrics(session_id);
CREATE INDEX IF NOT EXISTS idx_layer_metrics_layer ON layer_metrics(layer);

-- Session tags indices (for filtering)
CREATE INDEX IF NOT EXISTS idx_session_tags_session ON session_tags(session_id);
CREATE INDEX IF NOT EXISTS idx_session_tags_tag ON session_tags(tag);

-- Baselines indices
CREATE INDEX IF NOT EXISTS idx_baselines_type_metric ON baselines(baseline_type, metric_name);

-- =============================================================================
-- DEFAULT WEIGHT PROFILES
-- Section 10.8: SCORING WEIGHT PROFILES
-- =============================================================================

-- Balanced Profile (Default)
-- General use, suitable for most users
INSERT OR IGNORE INTO weight_profiles (id, name, is_custom, weights) VALUES (
    'balanced',
    'Balanced',
    0,
    '{
        "alpha": 0.35,
        "L0": {
            "rt": 0.6,
            "rt_variance": 0.4
        },
        "L1": {
            "track_error": 0.35,
            "track_variance": 0.25,
            "jerk": 0.20,
            "overshoot": 0.20
        },
        "L2": {
            "track_error": 0.25,
            "audio_rt": 0.25,
            "audio_accuracy": 0.20,
            "prp": 0.30
        },
        "L3": {
            "track_error": 0.15,
            "audio_rt": 0.15,
            "prp": 0.20,
            "cooldown": 0.15,
            "periph_rt": 0.15,
            "periph_miss": 0.20
        }
    }'
);

-- Precision-Heavy Profile
-- For tasks demanding fine motor accuracy (e.g., precision aiming, surgery simulation)
-- Weights tracking precision higher, deprioritizes peripheral and resource management
INSERT OR IGNORE INTO weight_profiles (id, name, is_custom, weights) VALUES (
    'precision',
    'Precision-Heavy',
    0,
    '{
        "alpha": 0.35,
        "L0": {
            "rt": 0.6,
            "rt_variance": 0.4
        },
        "L1": {
            "track_error": 0.40,
            "track_variance": 0.30,
            "jerk": 0.20,
            "overshoot": 0.10
        },
        "L2": {
            "track_error": 0.35,
            "audio_rt": 0.15,
            "audio_accuracy": 0.15,
            "prp": 0.35
        },
        "L3": {
            "track_error": 0.25,
            "audio_rt": 0.10,
            "prp": 0.25,
            "cooldown": 0.10,
            "periph_rt": 0.10,
            "periph_miss": 0.20
        }
    }'
);

-- Awareness-Heavy Profile
-- For tasks demanding broad situational awareness (e.g., MOBA games, air traffic control)
-- Weights peripheral detection and resource management higher
INSERT OR IGNORE INTO weight_profiles (id, name, is_custom, weights) VALUES (
    'awareness',
    'Awareness-Heavy',
    0,
    '{
        "alpha": 0.35,
        "L0": {
            "rt": 0.6,
            "rt_variance": 0.4
        },
        "L1": {
            "track_error": 0.30,
            "track_variance": 0.20,
            "jerk": 0.20,
            "overshoot": 0.30
        },
        "L2": {
            "track_error": 0.15,
            "audio_rt": 0.30,
            "audio_accuracy": 0.25,
            "prp": 0.30
        },
        "L3": {
            "track_error": 0.10,
            "audio_rt": 0.15,
            "prp": 0.15,
            "cooldown": 0.20,
            "periph_rt": 0.15,
            "periph_miss": 0.25
        }
    }'
);

-- =============================================================================
-- INITIAL CONFIGURATION DEFAULTS
-- =============================================================================

-- Set default values for configuration keys
INSERT OR IGNORE INTO user_config (key, value) VALUES ('baseline_window_size', '20');
INSERT OR IGNORE INTO user_config (key, value) VALUES ('calibration_sessions', '5');
INSERT OR IGNORE INTO user_config (key, value) VALUES ('minimum_baseline_sessions', '10');
INSERT OR IGNORE INTO user_config (key, value) VALUES ('warning_threshold_z', '-1.5');
INSERT OR IGNORE INTO user_config (key, value) VALUES ('critical_threshold_z', '-2.0');
INSERT OR IGNORE INTO user_config (key, value) VALUES ('current_profile', 'balanced');
INSERT OR IGNORE INTO user_config (key, value) VALUES ('difficulty', 'standard');

-- =============================================================================
-- SCHEMA VERSION TRACKING
-- =============================================================================
INSERT OR IGNORE INTO user_config (key, value) VALUES ('schema_version', '1');
INSERT OR IGNORE INTO user_config (key, value) VALUES ('app_version', '0.3.0');

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
