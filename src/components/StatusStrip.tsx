import { useLabelSession } from '../stores/labelSessionStore'
import { STRUCTURE_TAG_ORDER, terminalDisplayState } from '../types/segment'
import type { LabelConfidence, PrimaryLabel, SegmentState } from '../types/segment'

function fmtUtc(ms: number): string {
  const d = new Date(ms)
  const yyyy = d.getUTCFullYear()
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd   = String(d.getUTCDate()).padStart(2, '0')
  const hh   = String(d.getUTCHours()).padStart(2, '0')
  const mi   = String(d.getUTCMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

const LABEL_COLOR: Record<PrimaryLabel, string> = {
  uptrend:     'text-[#1D9E75]',
  downtrend:   'text-[#D85A30]',
  oscillation: 'text-[#a78bfa]',
  sideways:    'text-[#94a3b8]',
  transition:  'text-[#f59e0b]',
  ambiguous:   'text-gray-500',
}

const STATE_COLOR: Record<SegmentState | 'rejected_then_relabeled', string> = {
  unreviewed:              'text-gray-500',
  human_prelabel:          'text-amber-300',
  overlay_revealed:        'text-sky-300',
  accepted:                'text-[#1D9E75]',
  edited:                  'text-[#f97316]',
  rejected_then_relabeled: 'text-[#a78bfa]',
}

const LEGEND: { key: string; label: string }[] = [
  { key: 'U/D/O/S/T/A', label: 'primary label' },
  { key: 'E',           label: 'edit' },
  { key: '←/→',        label: 'nav' },
  { key: 'N',           label: 'next unreviewed' },
  { key: 'Space',       label: 'peek all' },
  { key: '1-4',         label: 'tags' },
  { key: 'C',           label: 'confidence' },
  { key: 'M',           label: 'mode' },
]

const EDIT_LEGEND: { key: string; label: string }[] = [
  { key: 'click',   label: 'set end' },
  { key: '←/→',    label: '±1 bar' },
  { key: 'Enter',   label: 'commit' },
  { key: 'Esc',     label: 'cancel' },
]

function workflowHint(state: SegmentState): string {
  switch (state) {
    case 'unreviewed':
      return 'current: press U/D/O/S/T/A to mark'
    case 'human_prelabel':
    case 'overlay_revealed':
      return 'current: press U/D/O/S/T/A to mark'
    case 'accepted':
    case 'edited':
      return 'current: marked; press U/D/O/S/T/A to change'
  }
}

export function StatusStrip() {
  const status              = useLabelSession((s) => s.status)
  const segments            = useLabelSession((s) => s.segments)
  const currentIdx          = useLabelSession((s) => s.currentIdx)
  const editActive          = useLabelSession((s) => s.edit.active)
  const editPendingEnd      = useLabelSession((s) => s.edit.pendingEndMs)
  const reviewerId          = useLabelSession((s) => s.reviewerId)
  const precompute          = useLabelSession((s) => s.precompute)
  const barStepMs           = useLabelSession((s) => s.barStepMs)
  const sessionAuditMode    = useLabelSession((s) => s.sessionAuditMode)
  const setLabelConfidence  = useLabelSession((s) => s.setLabelConfidence)
  const toggleStructureTag  = useLabelSession((s) => s.toggleStructureTag)

  if (status !== 'ready' || segments.length === 0) return null

  const seg  = segments[currentIdx]
  const prev = segments[currentIdx - 1] ?? null
  const firstBarMs = precompute?.bars[0]?.ms ?? null
  const prefixBars = firstBarMs !== null && barStepMs > 0
    ? Math.max(0, Math.round((segments[0].pl_start_ms - firstBarMs) / barStepMs))
    : 0
  const startMs = prev ? (prev.end_ms_override ?? prev.pl_end_ms) : seg.pl_start_ms
  const effectiveEnd = seg.end_ms_override ?? seg.pl_end_ms
  const displayEnd = editActive && editPendingEnd !== null ? editPendingEnd : effectiveEnd

  const n        = segments.length
  const labeled  = segments.filter((s) => s.state !== 'unreviewed').length
  const accepted = segments.filter((s) => s.state === 'accepted' || s.state === 'edited').length
  const displayState = terminalDisplayState(seg)
  const labelText = seg.primary_label ?? '—'
  const legend = editActive ? EDIT_LEGEND : LEGEND
  const suggestedLabel = seg.suggested_label

  return (
    <div className="flex flex-col bg-[#0f1318] border-b border-[#2b3139] shrink-0">
      {/* Row 1 — segment info */}
      <div className="flex items-center px-4 py-2 text-xs gap-4 min-h-[36px]">
        <span className="font-mono text-gray-300">
          Seg <span className="text-white font-semibold">{currentIdx}</span>
          <span className="text-gray-600"> / {n}</span>
        </span>

        <span className="font-mono text-gray-400">
          {fmtUtc(startMs)} → {fmtUtc(displayEnd)}
          {editActive && editPendingEnd !== null && editPendingEnd !== effectiveEnd && (
            <span className="ml-2 text-[#ef4444]">
              (Δ {((editPendingEnd - effectiveEnd) / 60000).toFixed(0)}min)
            </span>
          )}
        </span>

        {currentIdx === 0 && prefixBars > 0 && (
          <span className="font-mono text-[11px] text-gray-500">
            prefix context: {prefixBars} bars before Seg 0
          </span>
        )}

        <span className="text-gray-500">primary:</span>
        <span className={`font-semibold ${seg.primary_label ? LABEL_COLOR[seg.primary_label] : 'text-gray-600'}`}>
          {labelText}
        </span>

        {suggestedLabel && sessionAuditMode === 'assisted' && (
          <span className="font-mono text-[11px] text-amber-400/80">
            sys: <span className="text-amber-300/80">{suggestedLabel}</span>
          </span>
        )}

        <span className="text-gray-500">state:</span>
        <span className={`font-semibold ${STATE_COLOR[displayState]}`}>
          {displayState}
          {seg.was_rejected && seg.state !== 'accepted' && (
            <span className="ml-1 text-gray-500 font-normal">(rejected {seg.reject_count}×)</span>
          )}
        </span>

        <span className="text-gray-500">slope:</span>
        <span className="font-mono text-gray-300">{seg.pl_slope.toFixed(2)}</span>

        <span className="ml-auto flex items-center gap-3">
          <span className="text-gray-500 font-mono">
            {accepted}/{n} done · {labeled - accepted} pending
          </span>
          <span className="text-gray-500">reviewer: <span className="text-gray-300">{reviewerId}</span></span>
        </span>
      </div>

      {/* Row 2 — structure tags + confidence (only when segment is labeled) */}
      {seg.primary_label !== null && !editActive && (
        <div className="flex items-center px-4 py-1 text-[10px] gap-2 flex-wrap border-t border-[#1e2329]">
          <span className="text-gray-600">tags:</span>
          {STRUCTURE_TAG_ORDER.map((tag, i) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleStructureTag(tag)}
              className={
                'px-1.5 py-0.5 rounded font-mono border transition-colors ' +
                (seg.structure_tags.includes(tag)
                  ? 'bg-[#a78bfa]/20 border-[#a78bfa]/60 text-[#a78bfa]'
                  : 'bg-[#1e2329] border-[#2b3139] text-gray-500 hover:border-gray-500')
              }
            >
              {i + 1} {tag}
            </button>
          ))}
          <span className="text-gray-600 ml-2">conf:</span>
          {(['high', 'medium', 'low'] as LabelConfidence[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setLabelConfidence(c)}
              className={
                'px-1.5 py-0.5 rounded font-mono border transition-colors ' +
                (seg.label_confidence === c
                  ? 'bg-[#f59e0b]/20 border-[#f59e0b]/60 text-[#f59e0b]'
                  : 'bg-[#1e2329] border-[#2b3139] text-gray-500 hover:border-gray-500')
              }
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Row 3 — hotkey legend */}
      <div className="flex items-center px-4 pb-1.5 text-[10px] text-gray-600 gap-3 flex-wrap">
        <span className="font-mono text-amber-300/80 whitespace-nowrap">
          {editActive ? 'current: click target candle, then Enter' : workflowHint(seg.state)}
        </span>
        {legend.map((k) => (
          <span key={k.key} className="whitespace-nowrap">
            <kbd className="px-1 rounded bg-[#1e2329] text-gray-400 font-mono">{k.key}</kbd>
            <span className="ml-1">{k.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
