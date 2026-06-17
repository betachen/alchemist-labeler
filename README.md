# Alchemist Labeler

Standalone UI for producing `manual_regime_audit_v1` audit label_set JSON for
`signal-substrate-v1` 阶段 b. Loads K-line + PL + HT_TRENDLINE, lets the
reviewer mark each PL segment directly with a primary regime label, gates
export on audit completeness, and hashes the output.

For architecture and conventions, see [CLAUDE.md](CLAUDE.md).
Parent task: [alchemist/docs/tasks/signal-substrate-v1-stage-a-labeler.md](../alchemist/docs/tasks/signal-substrate-v1-stage-a-labeler.md).

## Prerequisites

- Node ≥ 22 (`node -v`)
- The sibling `alchemist/` repo cloned at `../alchemist`
- For your own windows: the sibling `alchemist-weaklabel/` repo (Python, the precompute producer — see "Generate the precompute" below). Skip if you only want to verify the UI against the bundled test fixture.

## Quick start (~2 min) — bundled fixture

```bash
npm install
npm run dev
# Open http://localhost:5173/?manifest=test-v1&window_id=btcusdt-15m-2023-02
```

The bundled `public/manifests/test-v1.json` references a pre-baked
`public/precomputes/btcusdt-15m-2023-02.json` (BTCUSDT 15m, 2023-02-01 →
2023-03-01, 2689 bars, 36 PL segments). You can label segments end-to-end on
this fixture; on Save, the dev server writes
`/data/alchemist-labeler/labels/btcusdt-15m-2023-02.manual_regime_audit_v1.json`.

## Full cookbook — your own IS window (target ≤10 min)

### 1. Set up alchemist-weaklabel (one-time)

```bash
cd ../alchemist-weaklabel
pip install -e '.[research]'   # numpy, pandas, ruptures
```

The precompute producer is the Python `alchemist-weaklabel` repo (ATR-ZigZag
segmenter). The legacy opt-in C++ `alchemist/tools/pl-export` was removed — its
SMA-smoothed PL segmentation merged deep V/Λ moves into one unlabelable segment.

### 2. Generate the precompute (~1 min)

```bash
cd ../alchemist-weaklabel
python3 scripts/export_blind_pilot_precompute.py \
  --input ../alchemist-labeler/bars-formatted/BTCUSDT-15m.csv \
  --start 1675209600000 \
  --end   1677628800000 \
  --window-id btcusdt-15m-2023-02 \
  --out ../alchemist-labeler/public/precomputes/btcusdt-15m-2023-02.json
```

`--end` is the inclusive period boundary (the boundary bar is included). Bars
are read from the Binance kline JSON-array CSV. The output JSON contains
`bars`, `pl_segments` (ATR-ZigZag swing legs), `ht_trendline`, and the
self-describing `segmenter` block (`algo` / `version` / `params_hash` /
`code_git_sha`). This blind precompute carries **no** weak-label opinions or
per-segment features. (For the §5b pilot the manifest is derived from the
frozen plan via `scripts/plan-to-manifest.mjs` instead of hand-authored.)

`public/precomputes/` is gitignored — regenerate per IS window.

### 3. Register the window in a manifest (~1 min)

Either edit an existing manifest (e.g. `public/manifests/test-v1.json`) or
create a new one. Schema is in [CLAUDE.md §"window_manifest"](CLAUDE.md).

```json
{
  "manifest_version": "is-windows-2023-2024-v1",
  "segmenter": {
    "algo": "zigzag_ruptures",
    "version": "zigzag_ruptures_v1",
    "params_hash": "<paste from precompute>",
    "code_git_sha": "<paste from precompute>"
  },
  "windows": [
    {
      "window_id": "btcusdt-15m-2023-02",
      "market": "BTCUSDT",
      "interval": "15m",
      "is_range": { "start_ms": 1675209600000, "end_ms": 1677628800000 },
      "precompute_path": "precomputes/btcusdt-15m-2023-02.json"
    }
  ],
  "content_hash_sha256": ""
}
```

Then sign:

```bash
node scripts/sign-manifest.mjs public/manifests/is-windows-2023-2024-v1.json
```

This recomputes `content_hash_sha256`. The UI startup contract verifies this
hash and refuses to load a tampered manifest.

### 4. Run the UI (~10 sec)

```bash
npm install   # first time only
npm run dev
```

Open:

```
http://localhost:5173/?manifest=is-windows-2023-2024-v1&window_id=btcusdt-15m-2023-02
```

The startup pipeline:

1. URL params parsed + shape-validated
2. Manifest fetched, hash recomputed, compared
3. `window_id` resolved against `manifest.windows[]`
4. Precompute fetched, `is_range` cross-checked
5. Chart renders with time-axis locked to `is_range`

Any failure surfaces as a "Session refused" page with the specific reason.

### 5. Label one segment (~30 sec)

- Press `U` (uptrend), `D` (downtrend), `O` (oscillation), `S` (sideways), `T` (transition), or `A` (ambiguous) to set the current segment's `primary_label` and mark it `accepted`; the UI immediately advances to the next segment.
- Press the same label keys again on an already marked segment to change its `primary_label`; this updates `reviewed_at_ms`.
- Press `E`, then `←` / `→`, then `Enter` to nudge the segment's end boundary by N bars; a real boundary move marks the segment as `edited`.
- Press `←` / `→` to navigate, `N` to jump to the next unreviewed segment.
- `Space` shows or hides all PL + HT_TRENDLINE overlays at once for chart context.

Full hotkey reference + label workflow: [CLAUDE.md §"Segment Label Workflow"](CLAUDE.md).

### 6. Export (~5 sec)

The right sidebar is an audit completeness panel. The export gate is:

```text
can_export = non-empty audit set AND every segment exportable
             (terminal + primary_label + reviewed_at_ms)
```

There is no per-window active-coverage floor — that legacy `manual_v1` gate is
removed. Coverage is shown as multi-axis diagnostics (core regime / tradable
structure / risk filter / excluded), never collapsed into one pass/fail number.

Once the gate passes, the **Save label_set** button activates. Click it →
the canonical-serialized JSON is hashed, the hash is written back, and the
file is written as
`/data/alchemist-labeler/labels/<window_id>.manual_regime_audit_v1.json`.

Two consecutive Save clicks with no intervening label edits produce
byte-identical files (deterministic via `reviewed_at_ms` tracking — see
[CLAUDE.md §"Export determinism"](CLAUDE.md)).

### 7. Feed 阶段 b (~10 sec)

Copy the saved file into the alchemist tree:

```bash
cp /data/alchemist-labeler/labels/btcusdt-15m-2023-02.manual_regime_audit_v1.json \
   ../alchemist/tests/support/strategytester/manual_regime_audit_v1/
```

(or symlink — the calibrator just reads the JSON.)

## File layout

| Path | Purpose |
|---|---|
| `public/manifests/` | IS-window registry (checked into git, signed via `sign-manifest.mjs`) |
| `public/precomputes/` | Per-window bar + segment + HT data (gitignored — regenerated by `alchemist-weaklabel`) |
| `/data/alchemist-labeler/labels/` | Signed reviewer output (`cp` to alchemist when ready for 阶段 b) |
| `src/` | TS/React source — see [CLAUDE.md §"Code map"](CLAUDE.md) |
| `scripts/sign-manifest.mjs` | Re-hash a manifest after editing |
| `CLAUDE.md` | Architecture, label workflow, invariants, UX rules |

## npm scripts

```
npm run dev       # Vite dev server on :5173 (HMR)
npm run build     # tsc strict + vite build → dist/
npm run preview   # serve the built dist/ — sanity check pre-release
```

## Failure modes you may hit

| Symptom | Cause | Fix |
|---|---|---|
| "Manifest content_hash_sha256 mismatch" | Manifest edited without re-signing | `node scripts/sign-manifest.mjs <path>` |
| "Precompute is_range mismatch" | Manifest `is_range` ≠ precompute `is_range` | Regenerate precompute with matching `--start-ms` / `--end-ms`, or edit manifest to match |
| "Session refused: window_id not found" | Typo, or you signed a new manifest but loaded an old one | Check the `?manifest=` param |
| "file does not exist" for `.json` | Vite SPA fallback caught (Content-Type guard) | Confirm the precompute / manifest file is actually in `public/` |
| Bars render but chart pans into empty area | `fixLeftEdge` / `fixRightEdge` should prevent this — file a bug if it slips |
| Export button stays disabled | A segment is not yet terminal — every segment must be `accepted`/`edited`; the sidebar shows the unreviewed count |

## Constraints

- The precompute carries a self-describing `segmenter` block (`algo` /
  `version` / `params_hash` / `code_git_sha`). The downstream calibrator
  (阶段 b) keys on this; if the segmenter or its params change, regenerate
  precomputes AND re-label affected windows.
- Coverage is multi-axis (core regime / tradable structure / risk filter /
  excluded), never one `active_coverage` number — the export gate is audit
  completeness, so it cannot be gamed by spamming one label (load-bearing
  invariant #5).
- `structure_tags`, `label_confidence`, and `audit_mode` ship as fixed
  defaults in 阶段 2a — the tag picker, confidence input, and blind/assisted
  toggle land in 阶段 2b. See [CLAUDE.md §"阶段 2a scope"](CLAUDE.md).
- Single labeler in v1 (`betachen` hard-coded). Multi-labeler / agreement
  tooling is deferred.
