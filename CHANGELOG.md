# CLST v0.3 — Code Review Fix Pass

## Critical Bug Fixes

### testEngine.ts (rewritten)
1. **Static property access** — All `this.MIN_AUDIO_INTERVAL` etc. replaced with `TestEngine.MIN_AUDIO_INTERVAL`. Audio cues now actually play.
2. **Frame-rate independent scheduling** — Audio cues and peripheral flashes now use pre-scheduled timestamps (`nextAudioCueTime`, `nextPeripheralTime`) set once when the previous event fires, instead of per-frame random rolls. Test is now identical on 60Hz vs 144Hz vs 240Hz.
3. **Frame-rate independent direction changes** — Target direction change probability scaled by deltaTime: `1 - (1 - rate)^dt`.
4. **Cached .bind(this)** — `boundUpdate` stored once in constructor, not allocated per frame.
5. **Inter-layer transitions** — New `completeLayer()` → `onLayerComplete` callback → `advanceToNextLayer()` flow. Engine pauses between layers, waits for UI signal to proceed.

### database.ts (rewritten)
6. **layer_metrics schema** — Table columns now match insert columns exactly (mean_rt, rt_variance, etc.).
7. **weight_profiles schema** — Table has `is_custom INTEGER` and `weights TEXT` columns.
8. **baselines schema** — Consistent `scope` column name everywhere (was `baseline_type` in some queries).
9. **Removed `DROP TABLE checkins`** — No longer destroys check-in data on startup.
10. **Baseline calibration skip** — `updateRollingBaseline` now reverses to chronological order and skips the first 5 sessions, not the most recent 5.
11. **N+1 tag queries** — `getAllSessions` uses `LEFT JOIN` + `GROUP_CONCAT` instead of per-session tag query.
12. **Batched event inserts** — `saveRawEvents` inserts 200 rows per statement in a transaction.
13. **Symptom history** — Single `SELECT DISTINCT` query instead of N+1.

### testRenderer.ts (rewritten)
14. **Pointer lock cursor handling** — Under pointer lock, uses `movementX/Y` accumulation. Falls back to `clientX/Y` when not locked.
15. **Removed redundant rAF loop** — PixiJS ticker handles rendering; removed empty `startRenderLoop`.
16. **Layer overlay removed** — No more opaque overlay that corrupts first 2 seconds of tracking data.
17. **Inter-layer screen** — Full HTML overlay with description, new elements, controls, cooldown timer, and Ready button.
18. **Peripheral shows digits** — Displays a number (0-9) at screen edge instead of an arrow, matching spec.

### metricsCalculator.ts (rewritten)
19. **Audio response key** — Uses SPACE (`' '`) instead of Q/E.
20. **Peripheral response key** — Uses digit keys (`0-9`) matching displayed digit instead of arrow keys.
21. **Optimized downsample** — `downsampleTo60Hz` uses sliding index O(n+m) instead of O(n×m) full scan.

### scoringEngine.ts (rewritten)
22. **Weight profile applied** — `extractMetricsForLayer` reads weights from the `WeightProfile` parameter via `profile.weights[layerKey][metricName]` instead of hardcoding values.

## New Features

### Inter-layer transitions
- After each layer completes, the engine enters `'inter-layer'` phase
- Renderer shows a full-screen transition with:
  - ✓ Layer N complete confirmation
  - Description of what the next layer adds
  - List of new elements
  - Controls reminder with key badges
  - 5-second cooldown countdown (non-skippable)
  - "Start Layer N" button (enabled after cooldown)
- Engine waits for `advanceToNextLayer()` call before proceeding

### Updated test flow
```
Config → Checkin → Ready Screen → Countdown 3-2-1
  → L0 (30s) → Inter-layer → L1 (45s) → Inter-layer
  → L2 (45s) → Inter-layer → L3 (60s)
  → "Test Complete" → Results → Dashboard
```

### Other improvements
- `tauri.conf.json` now has a basic CSP instead of null
- `lib.rs` has proper plugin registration and devtools in debug mode
- UUID generation uses `crypto.randomUUID()`
- MainApp tracks and cleans up injected style elements
- Test completion uses callback instead of polling
- Default weight profile seeded into database on first run

## Files Modified (vs original)
| File | Status |
|------|--------|
| src/lib/testEngine.ts | **Rewritten** — all critical bugs fixed |
| src/lib/testRenderer.ts | **Rewritten** — pointer lock, inter-layer UI |
| src/lib/metricsCalculator.ts | **Rewritten** — key mappings, performance |
| src/lib/scoringEngine.ts | **Rewritten** — weight profile integration |
| src/lib/database.ts | **Rewritten** — schema fixes, performance |
| src/lib/statistics.ts | Cleaned up (no bugs) |
| src/lib/audioManager.ts | Copied as-is (no bugs) |
| src/types/index.ts | Added InterLayerInfo, phase to TestState |
| src/views/MainApp.ts | **Rewritten** — flow, inter-layer, cleanup |
| src/main.ts | Simplified bootstrap |
| index.html | Cleaned up |
| src/components/* | Copied as-is (UI components) |
| src/assets/styles/* | Copied as-is (CSS) |
| Build configs | Minor updates (CSP, version) |
