export type Label = 'uptrend' | 'oscillation' | 'pullback' | 'sideways'

export type SegmentState =
  | 'unreviewed'
  | 'human_prelabel'
  | 'overlay_revealed'
  | 'accepted'
  | 'edited'

export const ACTIVE_LABELS: ReadonlySet<Label> = new Set(['uptrend', 'oscillation'])
export const INACTIVE_LABELS: ReadonlySet<Label> = new Set(['pullback', 'sideways'])

export interface Segment {
  idx: number
  pl_start_ms: number
  pl_end_ms: number
  pl_slope: number
  pl_start_price: number
  pl_end_price: number
  end_ms_override: number | null
  label: Label | null
  state: SegmentState
  was_rejected: boolean
  reject_count: number
  // Set when the segment first reaches a terminal state (accepted | edited);
  // cleared on reject (back to unreviewed). Stable across exports so two
  // consecutive exports with no intervening mutation are byte-identical.
  reviewed_at_ms: number | null
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
