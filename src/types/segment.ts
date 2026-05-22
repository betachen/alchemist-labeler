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
// shows it to reduce labor. v1 has no assisted UI, so every segment is `blind`.
export type AuditMode = 'blind' | 'assisted'

// Why the segment was selected for audit. Sourced from the weak-label rules'
// sampling bucket (pl-export --emit-system-opinions); falls back to
// `random_baseline_samples` when the precompute carries no system opinions.
export type SamplingReason =
  | 'high_confidence_rule_samples'
  | 'low_confidence_or_disagreement_samples'
  | 'rare_structure_samples'
  | 'random_baseline_samples'

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
  // v1: fixed `high` (no confidence picker yet — see 阶段 2b).
  label_confidence: LabelConfidence
  // v1: fixed `blind` (no assisted-mode UI yet — see 阶段 2b).
  audit_mode: AuditMode
  // v1: sourced from the precompute's weak-label sampling bucket, or
  // `random_baseline_samples` when absent.
  sampling_reason: SamplingReason
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

export function effectiveEndMs(seg: Segment): number {
  return seg.end_ms_override ?? seg.pl_end_ms
}

export function effectiveStartMs(seg: Segment, prev: Segment | null): number {
  if (!prev) return seg.pl_start_ms
  return effectiveEndMs(prev)
}

export function terminalDisplayState(seg: Segment): SegmentState | 'rejected_then_relabeled' {
  if (seg.state === 'accepted' && seg.was_rejected) return 'rejected_then_relabeled'
  return seg.state
}
