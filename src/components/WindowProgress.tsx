import { useEffect, useMemo, useState } from 'react'
import { useLabelSession } from '../stores/labelSessionStore'
import type { WindowEntry } from '../types/manifest'

function fmtUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace('.000Z', 'Z')
}

interface BarsRange {
  start_ms: number
  end_ms: number
}

interface Chunk {
  start_ms: number
  end_ms: number
}

function isUtcMonthBoundary(ms: number): boolean {
  const d = new Date(ms)
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0 &&
    d.getUTCDate() === 1
  )
}

function monthDiff(startMs: number, endMs: number): number {
  const start = new Date(startMs)
  const end = new Date(endMs)
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth())
  )
}

function addUtcMonths(ms: number, months: number): number {
  const d = new Date(ms)
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() + months,
    1,
    0,
    0,
    0,
    0,
  )
}

function windowStep(window: WindowEntry): { kind: 'months'; months: number } | { kind: 'ms'; ms: number } {
  const start = window.is_range.start_ms
  const end = window.is_range.end_ms
  if (isUtcMonthBoundary(start) && isUtcMonthBoundary(end)) {
    const months = monthDiff(start, end)
    if (months > 0) return { kind: 'months', months }
  }
  return { kind: 'ms', ms: Math.max(1, end - start) }
}

function nextChunkStart(startMs: number, step: ReturnType<typeof windowStep>): number {
  return step.kind === 'months'
    ? addUtcMonths(startMs, step.months)
    : startMs + step.ms
}

function buildChunks(range: BarsRange, step: ReturnType<typeof windowStep>): Chunk[] {
  const chunks: Chunk[] = []
  let start = range.start_ms
  while (start <= range.end_ms) {
    const next = nextChunkStart(start, step)
    chunks.push({ start_ms: start, end_ms: Math.min(next - 1, range.end_ms) })
    if (next <= start) break
    start = next
  }
  return chunks
}

function chunkIndexForRange(chunks: Chunk[], startMs: number): number {
  const idx = chunks.findIndex((c) => startMs >= c.start_ms && startMs <= c.end_ms)
  return idx >= 0 ? idx : 0
}

export function WindowProgress() {
  const manifest = useLabelSession((s) => s.manifest)
  const windowId = useLabelSession((s) => s.windowId)
  const currentWindow = useLabelSession((s) => s.window)
  const savedWindowIds = useLabelSession((s) => s.savedWindowIds)
  const [barsRange, setBarsRange] = useState<BarsRange | null>(null)

  useEffect(() => {
    if (!currentWindow) return
    let cancelled = false
    void (async () => {
      try {
        const params = new URLSearchParams({
          market: currentWindow.market,
          interval: currentWindow.interval,
        })
        const res = await fetch(`/api/bars-range?${params}`)
        if (!res.ok) return
        const payload = (await res.json()) as Partial<BarsRange>
        if (
          !cancelled &&
          typeof payload.start_ms === 'number' &&
          typeof payload.end_ms === 'number'
        ) {
          setBarsRange({ start_ms: payload.start_ms, end_ms: payload.end_ms })
        }
      } catch {
        // Fall back to the manifest range when running outside the local Vite
        // helper server.
      }
    })()
    return () => { cancelled = true }
  }, [currentWindow])

  const chunks = useMemo(() => {
    if (!currentWindow || !manifest) return []
    const fallbackRange = {
      start_ms: Math.min(...manifest.windows.map((w) => w.is_range.start_ms)),
      end_ms: Math.max(...manifest.windows.map((w) => w.is_range.end_ms)),
    }
    return buildChunks(barsRange ?? fallbackRange, windowStep(currentWindow))
  }, [barsRange, currentWindow, manifest])

  if (!currentWindow || chunks.length === 0) return null

  const currentChunkIdx = chunkIndexForRange(chunks, currentWindow.is_range.start_ms)
  const saved = new Set(savedWindowIds)
  const savedChunkIndexes = new Set(
    (manifest?.windows ?? [])
      .filter((w) => saved.has(w.window_id))
      .map((w) => chunkIndexForRange(chunks, w.is_range.start_ms)),
  )
  const step = windowStep(currentWindow)
  const stepText = step.kind === 'months' ? `${step.months}mo` : `${Math.round(step.ms / 86_400_000)}d`

  return (
    <div className="flex-1 min-w-0 flex items-center gap-3">
      <div className="min-w-[9rem] text-[11px] font-mono text-gray-500 whitespace-nowrap">
        Part <span className="text-gray-300">{currentChunkIdx + 1}</span>
        <span className="text-gray-600">/{chunks.length}</span>
        <span className="ml-2 text-gray-600">{stepText}</span>
      </div>
      <div className="flex-1 min-w-0 h-4 px-1 py-1 rounded bg-[#0a1220] border border-[#243244] flex gap-1 overflow-hidden">
        {chunks.map((chunk, index) => {
          const isCurrent = index === currentChunkIdx
          const isSaved = savedChunkIndexes.has(index)
          const color = isCurrent
            ? 'bg-[#38bdf8] shadow-[0_0_0_1px_rgba(56,189,248,0.4),0_0_10px_rgba(56,189,248,0.25)]'
            : isSaved
              ? 'bg-[#475569]'
              : 'bg-[#1d4ed8]'
          return (
            <div
              key={chunk.start_ms}
              className={`${color} h-full min-w-[3px] flex-1 rounded-[1px] transition-colors`}
              title={`Part ${index + 1}/${chunks.length} · ${fmtUtc(chunk.start_ms)} -> ${fmtUtc(chunk.end_ms)}`}
            />
          )
        })}
      </div>
      <div className="hidden xl:block max-w-[18rem] truncate text-[11px] font-mono text-gray-500">
        {windowId}
      </div>
    </div>
  )
}
