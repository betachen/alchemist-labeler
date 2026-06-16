import { useMemo, useState } from 'react'
import { useLabelSession } from '../stores/labelSessionStore'
import { computeCoverage } from '../lib/coverage'
import { buildAndSignLabelSet, saveLabelSetToData } from '../lib/exporter'

// manual_regime_audit_v1 audit completeness panel. Replaces the legacy
// manual_v1 single 30%-active-coverage gate (see docs/labeling-regime-strategy
// .md "Export gate decision"). The export gate is now: non-empty audit set
// with every selected segment terminal. Bar counts are multi-axis diagnostics,
// NOT a single pass/fail numerator.

interface StatRowProps {
  label: string
  value: string
  labelTone?: string
  valueTone?: string
}

function StatRow({ label, value, labelTone, valueTone }: StatRowProps) {
  return (
    <div className="flex justify-between">
      <span className={labelTone ?? 'text-gray-500'}>{label}</span>
      <span className={valueTone ?? 'text-gray-300'}>{value}</span>
    </div>
  )
}

interface SectionProps {
  title: string
  children: React.ReactNode
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="px-4 py-3 border-b border-[#2b3139]">
      <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">{title}</div>
      <div className="space-y-1 font-mono text-xs">{children}</div>
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

  const core = report.core_regime_high_confidence_bars
  const tags = report.tradable_structure_bars_all_confidence
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
      const saved = await saveLabelSetToData(signed, windowId, manifest?.label_output_subdir)
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
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
          Audit Export Gate
        </div>
        <div className={`font-semibold text-sm ${report.can_export ? 'text-[#1D9E75]' : 'text-[#D85A30]'}`}>
          {report.can_export ? 'audit set complete' : 'blocked'}
        </div>
        <div className="text-[10px] text-gray-600 mt-1">manual_regime_audit_v1</div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title="Audit Completeness">
          <StatRow
            label="reviewed / selected"
            value={`${report.reviewed_segments} / ${report.selected_audit_segments}`}
            valueTone={report.can_export ? 'text-[#1D9E75]' : 'text-[#D85A30]'}
          />
          <StatRow
            label="reviewed coverage"
            value={(report.reviewed_coverage * 100).toFixed(1) + '%'}
          />
        </Section>

        <Section title="Core Regime (high-conf bars)">
          <StatRow label="uptrend"     labelTone="text-[#1D9E75]" value={`${core.uptrend} bars`} />
          <StatRow label="downtrend"   labelTone="text-[#D85A30]" value={`${core.downtrend} bars`} />
          <StatRow label="oscillation" labelTone="text-[#a78bfa]" value={`${core.oscillation} bars`} />
          <div className="text-[10px] text-gray-600 pt-1 leading-relaxed">
            v1 cc-v1 fit consumes only uptrend + oscillation; downtrend counted
            for the future state-space.
          </div>
        </Section>

        <Section title="Tradable Structure (all-conf bars)">
          <StatRow label="bullish_pullback"  value={`${tags.bullish_pullback} bars`} />
          <StatRow label="bearish_rebound"   value={`${tags.bearish_rebound} bars`} />
          <StatRow label="bottom_absorption" value={`${tags.bottom_absorption} bars`} />
          <StatRow label="top_absorption"    value={`${tags.top_absorption} bars`} />
          <div className="text-[10px] text-gray-600 pt-1 leading-relaxed">
            structure-tag picker lands in 阶段 2b — 0 expected for now.
          </div>
        </Section>

        <Section title="Risk Filter / Excluded">
          <StatRow label="transition" labelTone="text-[#f59e0b]"
            value={`${report.risk_filter_bars_all_confidence.transition} bars`} />
          <StatRow label="sideways"
            value={`${report.excluded_low_weight_bars.sideways} bars`} />
          <StatRow label="ambiguous"
            value={`${report.excluded_low_weight_bars.ambiguous} bars`} />
        </Section>

        <Section title="Segments">
          <StatRow label="terminal"    labelTone="text-[#1D9E75]" value={String(report.segments_terminal)} />
          <StatRow label="in_progress" labelTone="text-amber-300" value={String(report.segments_in_progress)} />
          <StatRow
            label="unreviewed"
            value={String(report.segments_unreviewed)}
            valueTone={report.segments_unreviewed === 0 ? 'text-gray-500' : 'text-[#D85A30]'}
          />
          <StatRow label="total labelable" value={`${report.bars_total_labelable} bars`} />
        </Section>
      </div>

      <div className="px-4 py-3 border-t border-[#2b3139]">
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
            {report.selected_audit_segments - report.reviewed_segments} segment(s)
            not yet exportable. Every segment must be terminal with a primary label.
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
