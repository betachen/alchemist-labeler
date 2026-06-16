import type { Precompute, WindowEntry } from '../types/manifest'
import type {
  AnnotatorProvenance,
  AuditMode,
  LabelConfidence,
  PrimaryLabel,
  SamplingReason,
  Segment,
  StructureTag,
} from '../types/segment'
import {
  PRIMARY_VOCABULARY,
  STRUCTURE_TAG_ORDER,
  annotatorProvenanceForMode,
  sortStructureTags,
  terminalDisplayState,
} from '../types/segment'
import type { CoverageReport } from './coverage'
import { computeCoverage } from './coverage'
import { canonicalJson } from './canonicalJson'
import { sha256Hex } from './sha256'

// manual_regime_audit_v1 — the active audit-sample label-set contract. This is
// a BREAKING change from legacy `manual_v1`; downstream consumers must
// hard-reject unknown versions. Schema mirrors signal-substrate-v1.md
// §"label_set JSON schema (manual_regime_audit_v1 draft)".
const LABEL_SET_VERSION = 'manual_regime_audit_v1'

const COVERAGE_DOC =
  'Coverage metrics are multi-axis and count all labeled primary classes/tags ' +
  'for audit visibility. Primary-label and structure-tag counts may overlap. ' +
  'v1 cc-v1 emission fit consumes only high-confidence {uptrend, oscillation}; ' +
  'do not collapse coverage into one active_coverage numerator.'

interface ExportSegment {
  start_ms: number
  end_ms: number
  primary_label: PrimaryLabel
  structure_tags: StructureTag[]
  label_confidence: LabelConfidence
  audit_mode: AuditMode
  annotator_provenance: AnnotatorProvenance
  sampling_reason: SamplingReason
  source: 'accepted' | 'edited' | 'rejected_then_relabeled'
  pl_slope: number
  ht_trendline_slope: number
  reviewer_id: string
  reviewed_at_utc: string
  reviewer_note: string
}

interface CoverageBlock {
  selected_audit_segments: number
  reviewed_segments: number
  reviewed_coverage: number
  core_regime_high_confidence_bars: CoverageReport['core_regime_high_confidence_bars']
  tradable_structure_bars_all_confidence: CoverageReport['tradable_structure_bars_all_confidence']
  tradable_structure_bars_high_confidence: CoverageReport['tradable_structure_bars_high_confidence']
  risk_filter_bars_all_confidence: CoverageReport['risk_filter_bars_all_confidence']
  risk_filter_bars_high_confidence: CoverageReport['risk_filter_bars_high_confidence']
  excluded_low_weight_bars: CoverageReport['excluded_low_weight_bars']
  _doc: string
}

export interface LabelSet {
  label_set_version: string
  labeler_id: string
  market: string
  timeframe: string
  is_range: { start_ms: number; end_ms: number }
  primary_vocabulary: readonly PrimaryLabel[]
  structure_tag_vocabulary: readonly StructureTag[]
  pl_proposal_version: Precompute['pl_proposal_version']
  ht_trendline_overlay_used: boolean
  segments: ExportSegment[]
  coverage: CoverageBlock
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
// filled in by buildAndSignLabelSet so the hashing input excludes itself.
function buildUnsignedLabelSet(input: BuildLabelSetInput): LabelSet {
  const { window, precompute, segments, barStepMs, reviewerId } = input

  // can_export (coverage.ts) guarantees every segment is exportable before a
  // Save is allowed. A non-exportable segment reaching the exporter is a
  // gating bug — fail loud rather than silently emit a label_set with
  // dropped segments. This also catches the defensive acceptCurrent path
  // (overlay_revealed → accepted without a primary_label).
  const exportSegments: ExportSegment[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const terminal = seg.state === 'accepted' || seg.state === 'edited'
    if (!terminal || seg.primary_label === null || seg.reviewed_at_ms === null) {
      throw new Error(
        `exporter: segment ${i} is not exportable ` +
          `(state=${seg.state}, primary_label=${seg.primary_label ?? 'null'}, ` +
          `reviewed_at_ms=${seg.reviewed_at_ms ?? 'null'}). ` +
          `Caller must gate on can_export.`,
      )
    }
    const start = effectiveStart(segments, i)
    const end   = effectiveEnd(seg)
    const display = terminalDisplayState(seg)
    // Display state is 'rejected_then_relabeled' when (accepted && was_rejected).
    // Edited+was_rejected stays 'edited' — was_rejected is a separate signal
    // surfaced via the source field's rejected_then_relabeled mapping only on
    // plain accepted.
    const source: ExportSegment['source'] =
      display === 'rejected_then_relabeled' ? 'rejected_then_relabeled' :
      seg.state === 'edited'                ? 'edited' : 'accepted'
    exportSegments.push({
      start_ms: start,
      end_ms:   end,
      primary_label:    seg.primary_label,
      // Canonical-sorted so equivalent tag sets hash identically (Step 6).
      structure_tags:   sortStructureTags(seg.structure_tags),
      label_confidence: seg.label_confidence,
      audit_mode:       seg.audit_mode,
      // Certifying axis — derived 1:1 from audit_mode so it can never disagree.
      annotator_provenance: annotatorProvenanceForMode(seg.audit_mode),
      sampling_reason:  seg.sampling_reason,
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
    primary_vocabulary: PRIMARY_VOCABULARY,
    structure_tag_vocabulary: STRUCTURE_TAG_ORDER,
    pl_proposal_version: precompute.pl_proposal_version,
    ht_trendline_overlay_used: precompute.ht_trendline.length > 0,
    segments: exportSegments,
    coverage: {
      selected_audit_segments: cov.selected_audit_segments,
      reviewed_segments:       cov.reviewed_segments,
      reviewed_coverage:       cov.reviewed_coverage,
      core_regime_high_confidence_bars:        cov.core_regime_high_confidence_bars,
      tradable_structure_bars_all_confidence:  cov.tradable_structure_bars_all_confidence,
      tradable_structure_bars_high_confidence: cov.tradable_structure_bars_high_confidence,
      risk_filter_bars_all_confidence:         cov.risk_filter_bars_all_confidence,
      risk_filter_bars_high_confidence:        cov.risk_filter_bars_high_confidence,
      excluded_low_weight_bars:                cov.excluded_low_weight_bars,
      _doc: COVERAGE_DOC,
    },
    content_hash_sha256: '',
    created_at_utc: toIso(createdAtMs),
  }
}

export async function buildAndSignLabelSet(input: BuildLabelSetInput): Promise<LabelSet> {
  const unsigned = buildUnsignedLabelSet(input)
  // Hash input is canonical-serialized object with content_hash_sha256 set
  // to the empty string. Mirrors the manifest convention and the calibrator's
  // verification side.
  const hash = await sha256Hex(canonicalJson(unsigned))
  return { ...unsigned, content_hash_sha256: hash }
}

export function labelSetFilename(windowId: string): string {
  return `${windowId}.manual_regime_audit_v1.json`
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

export async function saveLabelSetToData(
  labelSet: LabelSet,
  windowId: string,
  subdir?: string,
): Promise<SaveLabelSetResult> {
  const res = await fetch('/api/label-set', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: labelSetFilename(windowId),
      content: labelSetPrettyJson(labelSet),
      // Optional output subdir under /data/alchemist-labeler/ (e.g. the pilot's
      // labels_pilot_2023h2). Omitted → the default labels/ dir.
      ...(subdir ? { subdir } : {}),
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
