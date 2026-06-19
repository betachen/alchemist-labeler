// manual_regime_audit_v1 two-layer label model.
// Layer 1: exactly one `primary_label` per segment.
// Layer 2: optional `structure_tags` (analysis metadata, not the classifier
// target in v1). See docs/labeling-regime-strategy.md for the constitution.

export type PrimaryLabel =
  | 'uptrend'
  | 'downtrend'
  | 'oscillation'
  | 'sideways'
  | 'transition'
  | 'ambiguous'

export type StructureTag =
  | 'bullish_pullback'
  | 'bearish_rebound'
  | 'bottom_absorption'
  | 'top_absorption'

// Reviewer-self-reported at label time. v1 training starts with `high` only.
export type LabelConfidence = 'high' | 'medium' | 'low'

// Per segment: blind hides the system candidate label (taxonomy QA); assisted
// shows it to reduce reviewer labor. Session-level toggle added in 阶段 2b.
export type AuditMode = 'blind' | 'assisted'

// Why the segment was selected for audit. Sourced from the weak-label rules'
// sampling bucket (alchemist-weaklabel's weak-label layer); falls back to
// `random_baseline_samples` when the precompute carries no system opinions
// (the blind pilot precompute always falls back).
export type SamplingReason =
  | 'high_confidence_rule_samples'
  | 'low_confidence_or_disagreement_samples'
  | 'rare_structure_samples'
  | 'random_baseline_samples'

// Who produced the label and under what visibility — the §5b certifying axis.
// `human_blind`: labeled without seeing any model/candidate output (audit_mode
// blind) — the ONLY provenance the analyzer accepts into the certifying set.
// `ai_proposed_human_confirmed`: the reviewer saw the AI candidate first
// (audit_mode assisted) — usable for fit/diagnostics, never for certification.
export type AnnotatorProvenance = 'human_blind' | 'ai_proposed_human_confirmed'

// Provenance follows audit_mode 1:1: a blind audit is human_blind; an assisted
// audit means the human confirmed an AI proposal. Derived at export time so the
// certifying axis can never disagree with the recorded audit_mode.
export function annotatorProvenanceForMode(mode: AuditMode): AnnotatorProvenance {
  return mode === 'blind' ? 'human_blind' : 'ai_proposed_human_confirmed'
}

export type SegmentState =
  | 'unreviewed'
  | 'human_prelabel'
  | 'overlay_revealed'
  | 'accepted'
  | 'edited'

// Export vocabulary, fixed order — mirrors the label_set JSON schema in
// signal-substrate-v1.md. Used for the `primary_vocabulary` export field.
export const PRIMARY_VOCABULARY: readonly PrimaryLabel[] = [
  'uptrend',
  'downtrend',
  'oscillation',
  'sideways',
  'transition',
  'ambiguous',
]

// Canonical enum order for `structure_tags`. Export MUST sort tags by this
// order so two equivalent labels produce the same content hash. v1 ships these
// 4; reserved future tags (impulse, failed_breakout, rejection, compression,
// exhaustion) would extend the tail. Also serves as `structure_tag_vocabulary`.
export const STRUCTURE_TAG_ORDER: readonly StructureTag[] = [
  'bullish_pullback',
  'bearish_rebound',
  'bottom_absorption',
  'top_absorption',
]

// core_regime axis — primary labels that feed (or will feed) regime training.
// v1 cc-v1 emission fit consumes only {uptrend, oscillation}; `downtrend` is
// counted for the future state-space expansion but inactive for the v1 fit.
export const CORE_REGIME_LABELS: ReadonlySet<PrimaryLabel> = new Set<PrimaryLabel>([
  'uptrend',
  'downtrend',
  'oscillation',
])

// risk_filter axis — excluded from core regime training; available to a later
// risk/no-trade diagnostic.
export const RISK_FILTER_LABELS: ReadonlySet<PrimaryLabel> = new Set<PrimaryLabel>([
  'transition',
])

// excluded_low_weight — counted for audit visibility, excluded from training.
export const EXCLUDED_LOW_WEIGHT_LABELS: ReadonlySet<PrimaryLabel> = new Set<PrimaryLabel>([
  'sideways',
  'ambiguous',
])

export interface Segment {
  idx: number
  pl_start_ms: number
  pl_end_ms: number
  pl_slope: number
  pl_start_price: number
  pl_end_price: number
  end_ms_override: number | null
  // Layer 1: the human regime label. null until the reviewer marks the segment.
  primary_label: PrimaryLabel | null
  // Layer 2: optional analysis tags. Stored in click order; exporter sorts to
  // STRUCTURE_TAG_ORDER before hashing.
  structure_tags: StructureTag[]
  label_confidence: LabelConfidence
  audit_mode: AuditMode
  // v1: sourced from the precompute's weak-label sampling bucket, or
  // `random_baseline_samples` when absent.
  sampling_reason: SamplingReason
  // Weak-label suggestion from system_opinions (alchemist-weaklabel's weak-label layer).
  // null when the precompute was generated without weak labels (e.g. the blind pilot).
  // Displayed in the StatusStrip and chart only when sessionAuditMode === 'assisted'.
  suggested_label: string | null
  state: SegmentState
  was_rejected: boolean
  reject_count: number
  // Set when the segment first reaches a terminal state (accepted | edited);
  // cleared on reject (back to unreviewed). Stable across exports so two
  // consecutive exports with no intervening mutation are byte-identical.
  reviewed_at_ms: number | null
}

const SAMPLING_REASONS: ReadonlySet<string> = new Set<SamplingReason>([
  'high_confidence_rule_samples',
  'low_confidence_or_disagreement_samples',
  'rare_structure_samples',
  'random_baseline_samples',
])

// Coerce a precompute weak-label sampling bucket into a SamplingReason. Unknown
// or missing values fall back to `random_baseline_samples` (the no-selection
// bucket — v1 reviews every PL segment).
export function coerceSamplingReason(value: string | undefined): SamplingReason {
  return value !== undefined && SAMPLING_REASONS.has(value)
    ? (value as SamplingReason)
    : 'random_baseline_samples'
}

// Sort + de-duplicate structure tags into canonical enum order. Export uses
// this so equivalent tag sets hash identically regardless of click order.
export function sortStructureTags(tags: readonly StructureTag[]): StructureTag[] {
  return [...new Set(tags)].sort(
    (a, b) => STRUCTURE_TAG_ORDER.indexOf(a) - STRUCTURE_TAG_ORDER.indexOf(b),
  )
}

// Canonical HALF-OPEN export boundaries — these MUST match the pre-declared
// plan `segment_census`, which is the SSOT for segment identity end-to-end
// (signal-substrate-v1.md §5b: blind set "declared + content-hashed BEFORE
// labeling"; §8.1 label loader "retains … segment identity end-to-end").
//
// The precompute's `pl_end_ms` is the INCLUSIVE last-bar timestamp of a segment
// (consecutive segments satisfy `pl[i+1].start_ms == pl[i].end_ms + barStep`).
// The census expresses the same partition as half-open intervals
// `[start, end)` where `end == pl_end_ms + barStep` (uniformly, including the
// final segment → `is_range.end_ms + barStep`). Treating the inclusive
// `pl_end_ms` directly as a half-open boundary drops one bar per segment and
// shifts every segment back by a bar — the off-by-one that made exported
// ranges disagree with the census.
//
// An edit `end_ms_override` is stored in INCLUSIVE-bar (display) space, same as
// `pl_end_ms`, so it gets the same `+ barStep` conversion here.
export function effectiveEndMs(seg: Segment, barStepMs: number): number {
  return (seg.end_ms_override ?? seg.pl_end_ms) + barStepMs
}

export function effectiveStartMs(seg: Segment, prev: Segment | null, barStepMs: number): number {
  // Segment 0 starts at its own precompute start (== census start). Every later
  // segment shares the previous segment's half-open end (the editable boundary),
  // keeping the partition gap-free and census-aligned.
  if (!prev) return seg.pl_start_ms
  return effectiveEndMs(prev, barStepMs)
}

export function terminalDisplayState(seg: Segment): SegmentState | 'rejected_then_relabeled' {
  if (seg.state === 'accepted' && seg.was_rejected) return 'rejected_then_relabeled'
  return seg.state
}
