import { useMemo, useState } from 'react'
import { useLabelSession } from '../stores/labelSessionStore'
import {
  computeCoverage,
  MIN_ACTIVE_COVERAGE,
  MIN_BARS_PER_ACTIVE_STATE,
} from '../lib/coverage'
import { buildAndSignLabelSet, saveLabelSetToData } from '../lib/exporter'

interface FloorRowProps {
  label: string
  ok: boolean
  current: string
  threshold: string
}

function FloorRow({ label, ok, current, threshold }: FloorRowProps) {
  return (
    <div className="flex items-baseline justify-between py-1 border-b border-[#1e2329] last:border-b-0">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="font-mono text-xs">
        <span className={ok ? 'text-[#1D9E75]' : 'text-[#D85A30]'}>{current}</span>
        <span className="text-gray-600"> / {threshold}</span>
      </span>
    </div>
  )
}

export function CoverageGate() {
  const status     = useLabelSession((s) => s.status)
  const segments   = useLabelSession((s) => s.segments)
  const barStepMs  = useLabelSession((s) => s.barStepMs)
  const precompute    = useLabelSession((s) => s.precompute)
  const currentWindow = useLabelSession((s) => s.window)
  const windowId      = useLabelSession((s) => s.windowId)
  const reviewerId    = useLabelSession((s) => s.reviewerId)
  const manifest      = useLabelSession((s) => s.manifest)
  const markWindowSaved = useLabelSession((s) => s.markWindowSaved)

  const [exportState, setExportState] = useState<
    | { kind: 'idle' }
    | { kind: 'busy' }
    | { kind: 'done'; hash: string; path: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const report = useMemo(
    () => computeCoverage(segments, barStepMs),
    [segments, barStepMs],
  )

  if (status !== 'ready') return null

  const inactiveTotal = report.bars_by_label.pullback + report.bars_by_label.sideways
  const windowIndex = manifest && windowId
    ? manifest.windows.findIndex((w) => w.window_id === windowId)
    : -1
  const previousWindowId = manifest && windowIndex > 0
    ? manifest.windows[windowIndex - 1].window_id
    : null
  const nextWindowId = manifest && windowIndex >= 0 && windowIndex < manifest.windows.length - 1
    ? manifest.windows[windowIndex + 1].window_id
    : null

  async function saveCurrentLabelSet(): Promise<boolean> {
    if (!precompute || !currentWindow || !windowId) return false
    setExportState({ kind: 'busy' })
    try {
      const signed = await buildAndSignLabelSet({
        window: currentWindow, precompute, segments, barStepMs, reviewerId,
      })
      const saved = await saveLabelSetToData(signed, windowId)
      markWindowSaved(windowId)
      setExportState({ kind: 'done', hash: signed.content_hash_sha256, path: saved.path })
      return true
    } catch (e) {
      setExportState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      return false
    }
  }

  async function onExportClick() {
    await saveCurrentLabelSet()
  }

  async function onNextWindowClick() {
    if (!nextWindowId || !report.can_export) return
    const ok = await saveCurrentLabelSet()
    if (ok) navigateToWindow(nextWindowId)
  }

  return (
    <aside className="w-72 shrink-0 flex flex-col bg-[#0f1318] border-l border-[#2b3139] text-sm">
      <div className="px-4 py-3 border-b border-[#2b3139]">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Export Gate</div>
        <div className={`font-semibold text-sm ${report.can_export ? 'text-[#1D9E75]' : 'text-[#D85A30]'}`}>
          {report.can_export ? 'all floors passing' : 'blocked'}
        </div>
      </div>

      <div className="px-4 py-3 border-b border-[#2b3139]">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Floors</div>
        <FloorRow
          label="uptrend bars"
          ok={report.floors.uptrend_ok}
          current={String(report.bars_by_label.uptrend)}
          threshold={`≥ ${MIN_BARS_PER_ACTIVE_STATE}`}
        />
        <FloorRow
          label="oscillation bars"
          ok={report.floors.oscillation_ok}
          current={String(report.bars_by_label.oscillation)}
          threshold={`≥ ${MIN_BARS_PER_ACTIVE_STATE}`}
        />
        <FloorRow
          label="active coverage"
          ok={report.floors.active_coverage_ok}
          current={(report.active_coverage * 100).toFixed(1) + '%'}
          threshold={`≥ ${(MIN_ACTIVE_COVERAGE * 100).toFixed(0)}%`}
        />
        <FloorRow
          label="all terminal"
          ok={report.floors.all_terminal_ok}
          current={`${report.segments_terminal}/${report.segments_total}`}
          threshold={`= ${report.segments_total}`}
        />
      </div>

      <div className="px-4 py-3 border-b border-[#2b3139]">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Tally</div>
        <div className="space-y-1 font-mono text-xs">
          <div className="flex justify-between">
            <span className="text-[#1D9E75]">uptrend</span>
            <span className="text-gray-300">{report.bars_by_label.uptrend} bars</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#a78bfa]">oscillation</span>
            <span className="text-gray-300">{report.bars_by_label.oscillation} bars</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#f59e0b]">pullback</span>
            <span className="text-gray-300">{report.bars_by_label.pullback} bars</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">sideways</span>
            <span className="text-gray-500">{report.bars_by_label.sideways} bars</span>
          </div>
          <div className="flex justify-between pt-1 mt-1 border-t border-[#1e2329]">
            <span className="text-gray-500">labeled_inactive</span>
            <span className="text-gray-500">{inactiveTotal} bars (excl. coverage)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">total labelable</span>
            <span className="text-gray-300">{report.bars_total_labelable} bars</span>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-[#2b3139]">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Segments</div>
        <div className="space-y-1 font-mono text-xs">
          <div className="flex justify-between">
            <span className="text-[#1D9E75]">terminal</span>
            <span className="text-gray-300">{report.segments_terminal}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-amber-300">in_progress</span>
            <span className="text-gray-300">{report.segments_in_progress}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">unreviewed</span>
            <span className={report.segments_unreviewed === 0 ? 'text-gray-500' : 'text-[#D85A30]'}>
              {report.segments_unreviewed}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-auto px-4 py-3">
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            type="button"
            disabled={!previousWindowId}
            onClick={() => previousWindowId && navigateToWindow(previousWindowId)}
            className={
              'py-2 rounded-md font-semibold text-xs transition-colors ' +
              (previousWindowId
                ? 'bg-[#1e2329] hover:bg-[#2b3139] text-gray-200'
                : 'bg-[#11161c] text-gray-600 cursor-not-allowed')
            }
          >
            上一段
          </button>
          <button
            type="button"
            disabled={!nextWindowId || !report.can_export || exportState.kind === 'busy'}
            onClick={onNextWindowClick}
            className={
              'py-2 rounded-md font-semibold text-xs transition-colors ' +
              (nextWindowId && report.can_export && exportState.kind !== 'busy'
                ? 'bg-[#1e2329] hover:bg-[#2b3139] text-gray-200'
                : 'bg-[#11161c] text-gray-600 cursor-not-allowed')
            }
          >
            {exportState.kind === 'busy' ? '保存中' : '下一段'}
          </button>
        </div>
        <button
          type="button"
          disabled={!report.can_export || exportState.kind === 'busy'}
          onClick={onExportClick}
          className={
            'w-full py-2 rounded-md font-semibold text-sm transition-colors ' +
            (report.can_export && exportState.kind !== 'busy'
              ? 'bg-[#1D9E75] hover:bg-[#178a64] text-white'
              : 'bg-[#1e2329] text-gray-500 cursor-not-allowed')
          }
        >
          {exportState.kind === 'busy' ? 'Signing…' :
           report.can_export ? 'Save label_set' : 'Export disabled'}
        </button>
        {!report.can_export && exportState.kind === 'idle' && (
          <p className="mt-2 text-[10px] text-gray-600 leading-relaxed">
            All four floors must pass. Hover or scroll to see which is failing.
          </p>
        )}
        {exportState.kind === 'done' && (
          <p className="mt-2 text-[10px] text-gray-500 leading-relaxed font-mono break-all">
            hash: <span className="text-gray-400">{exportState.hash.slice(0, 16)}…</span>
            <br />saved to <span className="text-gray-400">{exportState.path}</span>
          </p>
        )}
        {exportState.kind === 'error' && (
          <p className="mt-2 text-[10px] text-[#D85A30] leading-relaxed">
            export failed: {exportState.message}
          </p>
        )}
      </div>
    </aside>
  )
}

function navigateToWindow(windowId: string): void {
  const url = new URL(window.location.href)
  url.searchParams.set('window_id', windowId)
  window.location.assign(url.toString())
}
