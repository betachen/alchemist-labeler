# Alchemist Labeler

Standalone UI for producing `manual_v1` label_set JSON for `signal-substrate-v1`
阶段 b. Browser-based, no server, no DB. Loads K-line + PL + HT_TRENDLINE,
walks a reviewer through a strict `unreviewed → human_prelabel →
overlay_revealed → terminal` state machine, gates export on coverage floors,
and hashes the output.

For architecture and conventions, see [CLAUDE.md](CLAUDE.md).
Parent task: [alchemist/docs/tasks/signal-substrate-v1-stage-a-labeler.md](../alchemist/docs/tasks/signal-substrate-v1-stage-a-labeler.md).

## Prerequisites

- Node ≥ 22 (`node -v`)
- The sibling `alchemist/` repo cloned at `../alchemist`
- `alchemist/tools/pl-export` built (opt-in CMake target — see "Build pl-export" below). Skip if you only want to verify the UI against the bundled test fixture.

## Quick start (~2 min) — bundled fixture

```bash
npm install
npm run dev
# Open http://localhost:5173/?manifest=test-v1&window_id=btcusdt-15m-2023-02
```

The bundled `public/manifests/test-v1.json` references a pre-baked
`public/precomputes/btcusdt-15m-2023-02.json` (BTCUSDT 15m, 2023-02-01 →
2023-03-01, 2689 bars, 36 PL segments). You can label segments end-to-end on
this fixture; on Export, the browser downloads
`btcusdt-15m-2023-02.manual_v1.json` to its default download directory (e.g.
`~/Downloads/`). Move it to `labels/` for local archiving.

## Full cookbook — your own IS window (target ≤10 min)

### 1. Build pl-export (one-time, ~2 min)

```bash
cd ../alchemist
mkdir -p build && cd build
cmake .. -DBUILD_PL_EXPORT=ON
make -j$(nproc) pl-export
# Binary: build/bin/pl-export
```

`-DBUILD_PL_EXPORT=ON` is OFF by default — `pl-export` is NOT in the alchemist
default build chain and must not change `StrategyTester` / `alchemyd`.

### 2. Generate the precompute (~1 min)

```bash
cd ../alchemist
./build/bin/pl-export \
  --market BTCUSDT \
  --interval 15m \
  --start-ms 1675209600000 \
  --end-ms   1677628800000 \
  --bars-dir <path/to/binance-csv-bars> \
  --sma-period 120 \
  --turning-point-period 10 \
  --out ../alchemist-labeler/public/precomputes/btcusdt-15m-2023-02.json
```

Bars are read line-by-line from `<bars-dir>/BTCUSDT-15m.csv` (Binance kline
JSON-array format). The output JSON contains `bars`, `pl_segments`,
`ht_trendline`, and `pl_proposal_version` (with the pl-export git SHA
embedded at build time).

`public/precomputes/` is gitignored — regenerate per IS window.

### 3. Register the window in a manifest (~1 min)

Either edit an existing manifest (e.g. `public/manifests/test-v1.json`) or
create a new one. Schema is in [CLAUDE.md §"window_manifest"](CLAUDE.md).

```json
{
  "manifest_version": "is-windows-2023-2024-v1",
  "pl_proposal_version": {
    "code_git_sha": "<paste from precompute>",
    "smaPeriod": 120,
    "turningPointPeriod": 10
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

- Press `U` (uptrend), `O` (oscillation), `P` (pullback), or `S` (sideways) to assign a tentative label
- Press `R` to reveal PL + HT_TRENDLINE overlay for this segment
- Press `A` to accept (committed) — or `E` then `←` / `→` then `Enter` to nudge the segment's end boundary by N bars (terminal state becomes `edited`)
- Press `D` to reject and re-label (sets `was_rejected` flag — on subsequent accept the export records `source: "rejected_then_relabeled"`)
- Press `→` to move to the next segment, `N` to jump to the next unreviewed
- `Space` shows ALL overlays at once for sanity-checking (debug peek — does NOT advance the state machine)

Full hotkey reference + state machine: [CLAUDE.md §"Segment state machine"](CLAUDE.md).

### 6. Export (~5 sec)

The right sidebar shows four floors:

| Floor | Threshold |
|---|---|
| `uptrend bars` | ≥ 100 |
| `oscillation bars` | ≥ 100 |
| `active coverage` | ≥ 30% of labelable bars |
| `all terminal` | every segment in `accepted` ∪ `edited` |

Once all four pass, the **Export label_set** button activates. Click it →
the canonical-serialized JSON is hashed, the hash is written back, and the
file downloads as `<window_id>.manual_v1.json`.

Two consecutive Export clicks with no intervening label edits produce
byte-identical files (deterministic via `reviewed_at_ms` tracking — see
[CLAUDE.md §"Export determinism"](CLAUDE.md)).

### 7. Feed 阶段 b (~10 sec)

The browser writes the file to its default download directory (e.g.
`~/Downloads/`). Move it locally and copy into the alchemist tree:

```bash
mv ~/Downloads/btcusdt-15m-2023-02.manual_v1.json labels/
cp labels/btcusdt-15m-2023-02.manual_v1.json \
   ../alchemist/tests/support/strategytester/manual_v1/
```

(or symlink — the calibrator just reads the JSON.)

## File layout

| Path | Purpose |
|---|---|
| `public/manifests/` | IS-window registry (checked into git, signed via `sign-manifest.mjs`) |
| `public/precomputes/` | Per-window bar + PL + HT data (gitignored — regenerated by `pl-export`) |
| `labels/` | Reviewer output (gitignored — `cp` to alchemist when ready for 阶段 b) |
| `src/` | TS/React source — see [CLAUDE.md §"Code map"](CLAUDE.md) |
| `scripts/sign-manifest.mjs` | Re-hash a manifest after editing |
| `CLAUDE.md` | Architecture, state machine, invariants, UX rules |

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
| Export button stays disabled | At least one of the four coverage floors is failing — sidebar shows which |

## Constraints

- `pl-export` writes `pl_proposal_version.code_git_sha`. The downstream
  calibrator (阶段 b) keys on this; if the PL algorithm changes, regenerate
  precomputes AND re-label affected windows.
- Inactive labels (`pullback`, `sideways`) are exported as `labeled_inactive`
  and do NOT contribute to `active_labeled_coverage`. Spamming them does
  not unblock the export gate (load-bearing invariant #5).
- Single labeler in v1 (`betachen` hard-coded). Multi-labeler / agreement
  tooling is deferred.
