export interface Segmenter {
  algo: string
  version: string
  params_hash: string
  code_git_sha: string
}

export interface IsRange {
  start_ms: number
  end_ms: number
}

export interface WindowEntry {
  window_id: string
  market: string
  interval: string
  is_range: IsRange
  precompute_path: string
}

export interface Manifest {
  manifest_version: string
  segmenter: Segmenter
  windows: WindowEntry[]
  // Pilot-plan-derived manifests (scripts/plan-to-manifest.mjs) carry these so
  // the UI routes output to the pilot's label dir and provenance traces back to
  // the frozen plan. Absent on hand-authored manifests (default labels/ dir).
  label_output_subdir?: string
  plan_sha256?: string
  content_hash_sha256: string
}

export interface Bar {
  ms: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface PLSegment {
  start_ms: number
  end_ms: number
  slope: number
  start_price: number
  end_price: number
}

export interface HTEntry {
  ms: number
  value: number
}

// ── Opt-in weak-label layer ────────────────────────────────────────────────
// Emitted by alchemist-weaklabel's full (non-blind) precompute. Present only
// when the precompute carries opinions; the blind pilot precompute omits this
// layer entirely. In v1 the labeler consumes this
// layer SOLELY to source each segment's `sampling_reason` — it is NOT shown in
// the UI and is NOT the human label. system_opinion / candidate labels stay
// distinguishable from the reviewer's `primary_label` (see
// docs/labeling-regime-strategy.md Step 2 / Step 4).

export interface WeakLabelVersion {
  name: string
  code_git_sha: string
  scope: string
  feature_inputs: string[]
  candidate_primary_vocabulary: string[]
  candidate_structure_tag_vocabulary: string[]
  sampling_buckets: string[]
  thresholds: Record<string, unknown>
}

export interface SegmentFeature {
  start_ms: number
  end_ms: number
  duration_bars: number
  pl_slope: number
  ema60_slope_atr: number
  close_above_ema60_ratio: number
  close_below_ema60_ratio: number
  range_width_atr: number
  atr_normalized_return: number
  max_drawdown_atr: number
  max_runup_atr: number
  hh_hl_score: number
  ll_lh_score: number
  center_cross_count: number
  upper_boundary_touched: boolean
  lower_boundary_touched: boolean
  volume_zscore: number
}

export interface SystemOpinion {
  start_ms: number
  end_ms: number
  sampling_bucket: string
  // Slope-derived weak label from alchemist-weaklabel's weak-label layer.
  // Only uptrend/downtrend are derivable from segment slope; richer fields below
  // are reserved for future assisted-mode extensions (阶段 2b).
  suggested_label?: string
  candidate_primary_label?: string
  candidate_structure_tags?: string[]
  confidence?: number
  rule_id?: string
  evidence_metrics?: Record<string, number>
}

export interface Precompute {
  market: string
  interval: string
  is_range: IsRange
  segmenter: Segmenter
  bars: Bar[]
  pl_segments: PLSegment[]
  ht_trendline: HTEntry[]
  // Optional weak-label layer — see WeakLabelVersion above. Indexed 1:1 with
  // `pl_segments`. The certification-blind pilot precompute omits this layer.
  weak_label_version?: WeakLabelVersion
  segment_features?: SegmentFeature[]
  system_opinions?: SystemOpinion[]
}
