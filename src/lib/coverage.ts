import type { Segment, StructureTag } from '../types/segment'
import { STRUCTURE_TAG_ORDER } from '../types/segment'

// manual_regime_audit_v1 audit completeness, replacing the legacy manual_v1
// single `active_coverage` gate. Per signal-substrate-v1.md §"Load-bearing
// labeling decisions" #6: the audit workflow does NOT require per-window
// active coverage. Export requires only a non-empty audit set with every
// selected segment terminal; coverage is reported as multi-axis diagnostics.
//
// In v1 the "selected audit set" is every PL segment in the window (no real
// sample-selection step yet — see 阶段 2b). reviewed_coverage therefore
// measures audit completion, not a training-pool ratio.

export type CoreRegimeLabel = 'uptrend' | 'downtrend' | 'oscillation'

export interface CoverageReport {
  // Audit completeness (segment-level). `reviewed_segments` counts terminal
  // segments that also carry the load-bearing fields (primary_label +
  // reviewed_at_ms) — i.e. segments the exporter will actually emit.
  selected_audit_segments: number
  reviewed_segments: number
  reviewed_coverage: number

  // Multi-axis bar counts. Primary-label and structure-tag counts may overlap
  // (a segment contributes to its primary axis AND to each of its tags).
  core_regime_high_confidence_bars: Record<CoreRegimeLabel, number>
  tradable_structure_bars_all_confidence: Record<StructureTag, number>
  tradable_structure_bars_high_confidence: Record<StructureTag, number>
  risk_filter_bars_all_confidence: { transition: number }
  risk_filter_bars_high_confidence: { transition: number }
  excluded_low_weight_bars: { sideways: number; ambiguous: number }

  // Informational tally for the audit panel.
  bars_total_labelable: number
  segments_total: number
  segments_terminal: number
  segments_unreviewed: number
  segments_in_progress: number // human_prelabel | overlay_revealed

  // Export gate: non-empty audit set where every segment is exportable
  // (terminal + primary_label + reviewed_at_ms). label_confidence / audit_mode
  // / sampling_reason are satisfied structurally by the schema defaults.
  can_export: boolean
}

function effectiveEnd(seg: Segment): number {
  return seg.end_ms_override ?? seg.pl_end_ms
}

function effectiveStart(segments: Segment[], i: number): number {
  if (i === 0) return segments[0].pl_start_ms
  return effectiveEnd(segments[i - 1])
}

function emptyTagRecord(): Record<StructureTag, number> {
  const record = {} as Record<StructureTag, number>
  for (const tag of STRUCTURE_TAG_ORDER) record[tag] = 0
  return record
}

export function computeCoverage(segments: Segment[], barStepMs: number): CoverageReport {
  const core: Record<CoreRegimeLabel, number> = { uptrend: 0, downtrend: 0, oscillation: 0 }
  const tagsAll  = emptyTagRecord()
  const tagsHigh = emptyTagRecord()
  const riskAll  = { transition: 0 }
  const riskHigh = { transition: 0 }
  const excluded = { sideways: 0, ambiguous: 0 }

  let bars_total_labelable = 0
  let segments_terminal    = 0
  let segments_exportable  = 0
  let segments_unreviewed  = 0
  let segments_in_progress = 0

  for (let i = 0; i < segments.length; i++) {
    const seg   = segments[i]
    const start = effectiveStart(segments, i)
    const end   = effectiveEnd(seg)
    // Half-open: a 100-bar segment spans [t, t + 100*step). Adjacent segments
    // share boundaries so this is the only way to avoid double-counting.
    const bars = barStepMs > 0 ? Math.max(0, Math.round((end - start) / barStepMs)) : 0
    bars_total_labelable += bars

    const high = seg.label_confidence === 'high'
    switch (seg.primary_label) {
      case 'uptrend':
      case 'downtrend':
      case 'oscillation':
        // core_regime is high-confidence only — it is the initial training pool.
        if (high) core[seg.primary_label] += bars
        break
      case 'transition':
        riskAll.transition += bars
        if (high) riskHigh.transition += bars
        break
      case 'sideways':
      case 'ambiguous':
        excluded[seg.primary_label] += bars
        break
      default:
        break // null — unlabeled, contributes only to bars_total_labelable
    }
    for (const tag of seg.structure_tags) {
      tagsAll[tag] += bars
      if (high) tagsHigh[tag] += bars
    }

    const terminal = seg.state === 'accepted' || seg.state === 'edited'
    if      (terminal)                    segments_terminal++
    else if (seg.state === 'unreviewed')  segments_unreviewed++
    else                                  segments_in_progress++
    // A segment is exportable only if terminal AND it carries the load-bearing
    // fields. The normal hotkey path sets primary_label + reviewed_at_ms
    // together with the terminal state; this stricter test also guards the
    // defensive acceptCurrent path (overlay_revealed → accepted without a
    // primary_label), so the export gate cannot pass a segment the exporter
    // would have to drop.
    if (terminal && seg.primary_label !== null && seg.reviewed_at_ms !== null) {
      segments_exportable++
    }
  }

  const selected = segments.length
  const reviewed_coverage = selected > 0 ? segments_exportable / selected : 0
  const can_export = selected > 0 && segments_exportable === selected

  return {
    selected_audit_segments: selected,
    reviewed_segments: segments_exportable,
    reviewed_coverage,
    core_regime_high_confidence_bars: core,
    tradable_structure_bars_all_confidence: tagsAll,
    tradable_structure_bars_high_confidence: tagsHigh,
    risk_filter_bars_all_confidence: riskAll,
    risk_filter_bars_high_confidence: riskHigh,
    excluded_low_weight_bars: excluded,
    bars_total_labelable,
    segments_total: segments.length,
    segments_terminal,
    segments_unreviewed,
    segments_in_progress,
    can_export,
  }
}
