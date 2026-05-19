import type { Label, Segment } from '../types/segment'

// Coverage floors. Sourced from signal-substrate-v1.md §"label_set JSON schema"
// (per_state_count >= 100, active_labeled_coverage >= 0.30). Constants here so
// the gate stays in lockstep if the parent task tightens them.
export const MIN_BARS_PER_ACTIVE_STATE = 100
export const MIN_ACTIVE_COVERAGE       = 0.30

export interface CoverageReport {
  bars_total_labelable: number
  bars_by_label: Record<Label, number>
  active_coverage: number
  segments_total: number
  segments_terminal: number
  segments_unreviewed: number
  segments_in_progress: number       // human_prelabel | overlay_revealed
  floors: {
    uptrend_ok:        boolean
    oscillation_ok:    boolean
    active_coverage_ok: boolean
    all_terminal_ok:   boolean
  }
  can_export: boolean
}

function effectiveEnd(seg: Segment): number {
  return seg.end_ms_override ?? seg.pl_end_ms
}

function effectiveStart(segments: Segment[], i: number): number {
  if (i === 0) return segments[0].pl_start_ms
  return effectiveEnd(segments[i - 1])
}

export function computeCoverage(segments: Segment[], barStepMs: number): CoverageReport {
  const bars_by_label: Record<Label, number> = {
    uptrend:     0,
    oscillation: 0,
    pullback:    0,
    sideways:    0,
  }
  let bars_total_labelable = 0
  let segments_terminal    = 0
  let segments_unreviewed  = 0
  let segments_in_progress = 0

  if (barStepMs <= 0) {
    return {
      bars_total_labelable: 0,
      bars_by_label,
      active_coverage: 0,
      segments_total: segments.length,
      segments_terminal,
      segments_unreviewed: segments.length,
      segments_in_progress,
      floors: {
        uptrend_ok:        false,
        oscillation_ok:    false,
        active_coverage_ok: false,
        all_terminal_ok:   false,
      },
      can_export: false,
    }
  }

  for (let i = 0; i < segments.length; i++) {
    const seg   = segments[i]
    const start = effectiveStart(segments, i)
    const end   = effectiveEnd(seg)
    // Half-open: a 100-bar segment spans [t, t + 100*step). Adjacent segments
    // share boundaries so this is the only way to avoid double-counting.
    const bars = Math.max(0, Math.round((end - start) / barStepMs))
    bars_total_labelable += bars
    if (seg.label) bars_by_label[seg.label] += bars

    if      (seg.state === 'accepted' || seg.state === 'edited') segments_terminal++
    else if (seg.state === 'unreviewed')                          segments_unreviewed++
    else                                                          segments_in_progress++
  }

  const active_labeled = bars_by_label.uptrend + bars_by_label.oscillation
  const active_coverage = bars_total_labelable > 0
    ? active_labeled / bars_total_labelable
    : 0

  const floors = {
    uptrend_ok:        bars_by_label.uptrend     >= MIN_BARS_PER_ACTIVE_STATE,
    oscillation_ok:    bars_by_label.oscillation >= MIN_BARS_PER_ACTIVE_STATE,
    active_coverage_ok: active_coverage          >= MIN_ACTIVE_COVERAGE,
    all_terminal_ok:   segments.length > 0 && segments_terminal === segments.length,
  }
  const can_export = floors.uptrend_ok && floors.oscillation_ok && floors.active_coverage_ok && floors.all_terminal_ok

  return {
    bars_total_labelable,
    bars_by_label,
    active_coverage,
    segments_total: segments.length,
    segments_terminal,
    segments_unreviewed,
    segments_in_progress,
    floors,
    can_export,
  }
}
