import type { Precompute, WindowEntry } from '../types/manifest'
import type { Label, Segment } from '../types/segment'
import { terminalDisplayState } from '../types/segment'
import { computeCoverage } from './coverage'
import { canonicalJson } from './canonicalJson'
import { sha256Hex } from './sha256'

const LABEL_SET_VERSION = 'manual_v1'
const VOCABULARY: readonly Label[] = ['uptrend', 'oscillation', 'pullback', 'sideways']

interface ExportSegment {
  start_ms: number
  end_ms: number
  label: Label
  source: 'accepted' | 'edited' | 'rejected_then_relabeled'
  pl_slope: number
  ht_trendline_slope: number
  reviewer_id: string
  reviewed_at_utc: string
  reviewer_note: string
}

export interface LabelSet {
  label_set_version: string
  labeler_id: string
  market: string
  timeframe: string
  is_range: { start_ms: number; end_ms: number }
  vocabulary: readonly Label[]
  pl_proposal_version: Precompute['pl_proposal_version']
  ht_trendline_overlay_used: boolean
  segments: ExportSegment[]
  coverage: {
    labelable_bars: number
    active_labeled_bars: number
    active_labeled_coverage: number
    active_per_state_counts:   { uptrend: number; oscillation: number }
    inactive_per_state_counts: { pullback: number; sideways: number }
  }
  content_hash_sha256: string
  created_at_utc: string
}

function effectiveEnd(seg: Segment): number {
  return seg.end_ms_override ?? seg.pl_end_ms
}

function effectiveStart(segs: Segment[], i: number): number {
  if (i === 0) return segs[0].pl_start_ms
  return effectiveEnd(segs[i - 1])
}

// Per-segment HT_TRENDLINE slope: first-to-last linear slope of HT values
// falling within [start_ms, end_ms]. Returns 0 if fewer than 2 entries
// (segments entirely inside the HT warmup zone — early segments only).
function htSlopeForRange(precompute: Precompute, startMs: number, endMs: number): number {
  let first: { ms: number; value: number } | null = null
  let last:  { ms: number; value: number } | null = null
  for (const e of precompute.ht_trendline) {
    if (e.ms < startMs) continue
    if (e.ms > endMs)   break
    if (first === null) first = e
    last = e
  }
  if (!first || !last || last.ms === first.ms) return 0
  return (last.value - first.value) / (last.ms - first.ms)
}

function toIso(ms: number): string {
  // Deterministic UTC ISO with millisecond precision. Z suffix.
  return new Date(ms).toISOString()
}

export interface BuildLabelSetInput {
  window: WindowEntry
  precompute: Precompute
  segments: Segment[]
  barStepMs: number
  reviewerId: string
}

// Constructs the LabelSet object WITH content_hash_sha256 empty. Hash is
// filled in by signLabelSet so the hashing input excludes itself.
function buildUnsignedLabelSet(input: BuildLabelSetInput): LabelSet {
  const { window, precompute, segments, barStepMs, reviewerId } = input

  // Only export terminal-state segments (accepted | edited). Caller is
  // expected to gate on can_export — but be defensive.
  const exportSegments: ExportSegment[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg.state !== 'accepted' && seg.state !== 'edited') continue
    if (!seg.label) continue
    if (seg.reviewed_at_ms === null) continue
    const start = effectiveStart(segments, i)
    const end   = effectiveEnd(seg)
    const display = terminalDisplayState(seg)
    // Display state is 'rejected_then_relabeled' when (accepted && was_rejected).
    // Edited+was_rejected stays 'edited' per Step 6 design — was_rejected is a
    // separate signal preserved via the source field's rejected_then_relabeled
    // mapping only on plain accepted.
    const source: ExportSegment['source'] =
      display === 'rejected_then_relabeled' ? 'rejected_then_relabeled' :
      seg.state === 'edited'                ? 'edited' : 'accepted'
    exportSegments.push({
      start_ms: start,
      end_ms:   end,
      label:    seg.label,
      source,
      pl_slope: seg.pl_slope,
      ht_trendline_slope: htSlopeForRange(precompute, start, end),
      reviewer_id:     reviewerId,
      reviewed_at_utc: toIso(seg.reviewed_at_ms),
      reviewer_note:   '',
    })
  }

  const cov = computeCoverage(segments, barStepMs)

  // created_at_utc tracks the latest review timestamp. Stable across two
  // consecutive exports with no intervening mutation; flips when any segment
  // is re-labeled (its reviewed_at_ms updates).
  let createdAtMs = 0
  for (const seg of segments) {
    if (seg.reviewed_at_ms !== null && seg.reviewed_at_ms > createdAtMs) {
      createdAtMs = seg.reviewed_at_ms
    }
  }

  return {
    label_set_version: LABEL_SET_VERSION,
    labeler_id: reviewerId,
    market: window.market,
    timeframe: window.interval,
    is_range: { start_ms: window.is_range.start_ms, end_ms: window.is_range.end_ms },
    vocabulary: VOCABULARY,
    pl_proposal_version: precompute.pl_proposal_version,
    ht_trendline_overlay_used: precompute.ht_trendline.length > 0,
    segments: exportSegments,
    coverage: {
      labelable_bars:      cov.bars_total_labelable,
      active_labeled_bars: cov.bars_by_label.uptrend + cov.bars_by_label.oscillation,
      active_labeled_coverage: cov.active_coverage,
      active_per_state_counts: {
        uptrend:     cov.bars_by_label.uptrend,
        oscillation: cov.bars_by_label.oscillation,
      },
      inactive_per_state_counts: {
        pullback:    cov.bars_by_label.pullback,
        sideways:    cov.bars_by_label.sideways,
      },
    },
    content_hash_sha256: '',
    created_at_utc: toIso(createdAtMs),
  }
}

export async function buildAndSignLabelSet(input: BuildLabelSetInput): Promise<LabelSet> {
  const unsigned = buildUnsignedLabelSet(input)
  // Hash input is canonical-serialized object with content_hash_sha256 set
  // to the empty string. Mirrors the manifest convention from Step 3 and the
  // calibrator's verification side.
  const hash = await sha256Hex(canonicalJson(unsigned))
  return { ...unsigned, content_hash_sha256: hash }
}

export function labelSetFilename(windowId: string): string {
  return `${windowId}.manual_v1.json`
}

export function labelSetPrettyJson(labelSet: LabelSet): string {
  return JSON.stringify(labelSet, null, 2) + '\n'
}

// Triggers a browser download of the signed LabelSet. Filename derived from
// the window id so multi-window output stays unambiguous.
export function downloadLabelSet(labelSet: LabelSet, windowId: string): void {
  // Pretty-print at the download layer (2-space indent) — humans read these
  // diffs. Hash was computed over the CANONICAL form, not this pretty form,
  // so re-serializing here doesn't affect hash validation downstream as long
  // as the consumer also canonical-serializes before hashing.
  const text = labelSetPrettyJson(labelSet)
  const blob = new Blob([text], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = labelSetFilename(windowId)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export interface SaveLabelSetResult {
  path: string
}

export async function saveLabelSetToData(labelSet: LabelSet, windowId: string): Promise<SaveLabelSetResult> {
  const res = await fetch('/api/label-set', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: labelSetFilename(windowId),
      content: labelSetPrettyJson(labelSet),
    }),
  })
  const payload = (await res.json().catch(() => null)) as { path?: string; error?: string } | null
  if (!res.ok) {
    throw new Error(payload?.error ?? `HTTP ${res.status}`)
  }
  if (!payload?.path) {
    throw new Error('local save response did not include a path')
  }
  return { path: payload.path }
}

// Exposed for tests / verification: returns the canonical string used to
// compute the hash. Useful for diff-debugging non-deterministic exports.
export function canonicalLabelSetString(unsignedOrSigned: LabelSet): string {
  const withEmpty: LabelSet = { ...unsignedOrSigned, content_hash_sha256: '' }
  return canonicalJson(withEmpty)
}
