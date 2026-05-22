import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createChart, ColorType, CrosshairMode } from 'lightweight-charts'
import type {
  IChartApi,
  ISeriesApi,
  MouseEventParams,
  SeriesMarker,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import { useKlines } from '../../hooks/useKlines'
import { useLabelSession } from '../../stores/labelSessionStore'
import type { Candle } from '../../types/market'
import type { PrimaryLabel } from '../../types/segment'
import type { Segment } from '../../types/segment'

const SPLIT_MIN = 0.35
const SPLIT_MAX = 0.88
const DIVIDER_HIT_PX = 8   // invisible hit area height
const GAP = 0.015           // gap between kline bottom and volume top

const LABEL_BADGE_COLOR: Record<PrimaryLabel, string> = {
  uptrend:     '#1D9E75',
  downtrend:   '#D85A30',
  oscillation: '#a78bfa',
  sideways:    '#94a3b8',
  transition:  '#f59e0b',
  ambiguous:   '#6b7280',
}

// Overlay-visible states (per-segment reveal advances at R; subsequent terminal
// states keep it visible).
const REVEALED_STATES: ReadonlySet<Segment['state']> = new Set([
  'overlay_revealed',
  'accepted',
  'edited',
])

interface EffectiveBoundary {
  start_ms: number
  end_ms:   number
}

interface LabelBadge {
  key: string
  label: PrimaryLabel
  left: number
  top: number
}

// Resolve effective boundaries across all segments in one pass, accounting for
// edit-mode pending override. Segment i's start = segment i-1's effective end.
function resolveBoundaries(
  segments: Segment[],
  editSegIdx: number | null,
  editPendingEndMs: number | null,
): EffectiveBoundary[] {
  const out: EffectiveBoundary[] = []
  let prevEnd: number | null = null
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const start = prevEnd ?? seg.pl_start_ms
    const committedEnd = seg.end_ms_override ?? seg.pl_end_ms
    const end = i === editSegIdx && editPendingEndMs !== null ? editPendingEndMs : committedEnd
    out.push({ start_ms: start, end_ms: end })
    prevEnd = end
  }
  return out
}

export function KlineChart() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)
  const candleRef    = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef       = useRef<ISeriesApi<'Histogram'>   | null>(null)
  // Per-segment line series (one entry per PL segment). Arrays are rebuilt on
  // window switch, never mutated piecemeal.
  const plRefsRef    = useRef<ISeriesApi<'Line'>[]>([])
  const htRefsRef    = useRef<ISeriesApi<'Line'>[]>([])

  // `split` = fraction of chart height given to the kline pane
  const [split, setSplit] = useState(0.72)
  const [labelBadges, setLabelBadges] = useState<LabelBadge[]>([])
  const splitRef = useRef(split)
  splitRef.current = split

  const isDragging     = useRef(false)
  const dragStartY     = useRef(0)
  const dragStartSplit = useRef(0)

  const klines    = useKlines()
  const klinesRef = useRef<Candle[]>(klines)
  klinesRef.current = klines

  const precompute       = useLabelSession((s) => s.precompute)
  const overlayVisible   = useLabelSession((s) => s.overlayVisible)
  const segments         = useLabelSession((s) => s.segments)
  const currentIdx       = useLabelSession((s) => s.currentIdx)
  const editActive       = useLabelSession((s) => s.edit.active)
  const editSegIdx       = useLabelSession((s) => s.edit.segIdx)
  const editPendingEndMs = useLabelSession((s) => s.edit.pendingEndMs)
  const setEditEnd       = useLabelSession((s) => s.setEditEnd)

  const boundaries = useMemo(
    () => resolveBoundaries(segments, editActive ? editSegIdx : null, editPendingEndMs),
    [segments, editActive, editSegIdx, editPendingEndMs],
  )

  const recomputeLabelBadges = useCallback(() => {
    const chart = chartRef.current
    const candle = candleRef.current
    if (!chart || !candle) return

    const next: LabelBadge[] = []
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const b = boundaries[i]
      if (!seg.primary_label || !b) continue

      const startX = chart.timeScale().timeToCoordinate(Math.floor(b.start_ms / 1000) as UTCTimestamp)
      const endX = chart.timeScale().timeToCoordinate(Math.floor(b.end_ms / 1000) as UTCTimestamp)
      const startY = candle.priceToCoordinate(seg.pl_start_price)
      const endY = candle.priceToCoordinate(seg.pl_end_price)
      if (startX === null || endX === null || startY === null || endY === null) continue
      const left = (startX + endX) / 2
      const top = (startY + endY) / 2

      next.push({
        key: `${seg.idx}-${seg.primary_label}`,
        label: seg.primary_label,
        left,
        top,
      })
    }
    setLabelBadges(next)
  }, [boundaries, segments])

  // ── Init chart once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0b0e11' },
        textColor: '#848e9c',
      },
      // Pin locale explicitly. Default falls back to navigator.language which
      // some headless browser locales (e.g. Playwright defaults) reject with
      // "Incorrect locale information provided", leaving the chart blank.
      localization: { locale: 'en-US' },
      grid: {
        vertLines: { color: '#1e2329' },
        horzLines: { color: '#1e2329' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2b3139' },
      timeScale: {
        borderColor: '#2b3139',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 4,
        // IS-range hard-block (Step 4 / load-bearing invariant #4):
        // refuse to render any bar outside the manifest is_range. Bars are
        // already scoped at fetch time; these flags prevent the user from
        // scrolling/zooming past the data edges into empty OOS area.
        rightOffset: 0,
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
      },
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    })

    // ── Candlestick series — occupies top `split` fraction ──
    const candle = chart.addCandlestickSeries({
      upColor:         '#1D9E75',
      downColor:       '#D85A30',
      borderUpColor:   '#1D9E75',
      borderDownColor: '#D85A30',
      wickUpColor:     '#1D9E75',
      wickDownColor:   '#D85A30',
      priceScaleId:    'right',
    })
    chart.priceScale('right').applyOptions({
      scaleMargins: klineMargins(splitRef.current),
    })

    // ── Volume histogram — occupies the bottom `1 - split` fraction ──
    const vol = chart.addHistogramSeries({
      priceFormat:  { type: 'volume' },
      priceScaleId: 'vol',
    })
    chart.priceScale('vol').applyOptions({
      scaleMargins: volMargins(splitRef.current),
      visible: false,
    })

    chartRef.current  = chart
    candleRef.current = candle
    volRef.current    = vol

    const initial = klinesRef.current
    if (initial.length > 0) {
      candle.setData(initial)
      vol.setData(toVolumeData(initial))
      chart.timeScale().fitContent()
    }

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return
      chartRef.current.applyOptions({
        width:  containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      })
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current  = null
      candleRef.current = null
      volRef.current    = null
      plRefsRef.current = []
      htRefsRef.current = []
    }
  }, [])

  // ── Update scale margins when split changes ────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return
    chartRef.current.priceScale('right').applyOptions({ scaleMargins: klineMargins(split) })
    chartRef.current.priceScale('vol').applyOptions({ scaleMargins: volMargins(split) })
    requestAnimationFrame(recomputeLabelBadges)
  }, [split, recomputeLabelBadges])

  // ── Reset prevLenRef when window_id changes ──────────────────────────────
  const windowId    = useLabelSession((s) => s.windowId)
  const chartKeyRef = useRef(windowId)

  useEffect(() => {
    if (chartKeyRef.current !== windowId) {
      chartKeyRef.current = windowId
      prevLenRef.current  = 0   // force full setData() on next klines update
      setLabelBadges([])
    }
  }, [windowId])

  // ── Sync klines data ───────────────────────────────────────────────────────
  const prevLenRef = useRef(0)

  useEffect(() => {
    if (!candleRef.current || !volRef.current || !chartRef.current) return

    if (klines.length === 0) {
      if (prevLenRef.current !== 0) {
        candleRef.current.setData([])
        volRef.current.setData([])
      }
      prevLenRef.current = 0
      return
    }

    if (klines.length !== prevLenRef.current) {
      // Count changed: initial load, snapshot arrival, or new candle — full sync
      candleRef.current.setData(klines)
      volRef.current.setData(toVolumeData(klines))
      if (prevLenRef.current === 0) {
        chartRef.current.timeScale().fitContent()
      }
      requestAnimationFrame(recomputeLabelBadges)
    } else {
      // Same count: in-place update of the last (current) candle
      const last = klines[klines.length - 1]
      candleRef.current.update(last)
      volRef.current.update(toVolumeDatum(last))
      requestAnimationFrame(recomputeLabelBadges)
    }
    prevLenRef.current = klines.length
  }, [klines, recomputeLabelBadges])

  // ── (Re)create per-segment line series whenever the window/segment count changes ──
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    // Tear down any previous per-segment series before creating the new set.
    for (const s of plRefsRef.current) chart.removeSeries(s)
    for (const s of htRefsRef.current) chart.removeSeries(s)
    plRefsRef.current = []
    htRefsRef.current = []

    const n = segments.length
    if (n === 0) return

    const newPls: ISeriesApi<'Line'>[] = []
    const newHts: ISeriesApi<'Line'>[] = []
    for (let i = 0; i < n; i++) {
      newPls.push(chart.addLineSeries({
        color:                  '#ff4fd8',
        lineWidth:              2,
        priceScaleId:           'right',
        lastValueVisible:       false,
        priceLineVisible:       false,
        crosshairMarkerVisible: false,
        visible:                false,
      }))
      newHts.push(chart.addLineSeries({
        color:                  '#06b6d4',
        lineWidth:              1,
        priceScaleId:           'right',
        lastValueVisible:       false,
        priceLineVisible:       false,
        crosshairMarkerVisible: false,
        visible:                false,
      }))
    }
    plRefsRef.current = newPls
    htRefsRef.current = newHts
  }, [windowId, segments.length])

  // ── Sync per-segment line data (PL endpoints + HT slice) ────────────────
  useEffect(() => {
    if (!precompute) return
    const pls = plRefsRef.current
    const hts = htRefsRef.current
    if (pls.length !== segments.length) return

    const ht = precompute.ht_trendline
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const b   = boundaries[i]
      pls[i].setData([
        { time: Math.floor(b.start_ms / 1000) as UTCTimestamp, value: seg.pl_start_price },
        { time: Math.floor(b.end_ms   / 1000) as UTCTimestamp, value: seg.pl_end_price },
      ])
      const slice: { time: UTCTimestamp; value: number }[] = []
      for (const e of ht) {
        if (e.ms < b.start_ms) continue
        if (e.ms > b.end_ms)   break
        slice.push({ time: Math.floor(e.ms / 1000) as UTCTimestamp, value: e.value })
      }
      hts[i].setData(slice)
    }
    requestAnimationFrame(recomputeLabelBadges)
  }, [precompute, segments, boundaries, recomputeLabelBadges])

  // ── Sync per-segment visibility ────────────────────────────────────────
  useEffect(() => {
    const pls = plRefsRef.current
    const hts = htRefsRef.current
    if (pls.length !== segments.length) return
    for (let i = 0; i < segments.length; i++) {
      const v = overlayVisible || REVEALED_STATES.has(segments[i].state)
      pls[i].applyOptions({ visible: v })
      hts[i].applyOptions({ visible: v })
    }
  }, [segments, overlayVisible])

  // ── Current-segment markers (boundary arrows on the candle series) ─────
  useEffect(() => {
    const candle = candleRef.current
    if (!candle) return
    const b = boundaries[currentIdx]
    if (!b) { candle.setMarkers([]); return }
    const endColor = editActive ? '#ef4444' : '#fbbf24'
    const startTime = Math.floor(b.start_ms / 1000) as UTCTimestamp
    const endTime   = Math.floor(b.end_ms   / 1000) as UTCTimestamp
    const markers: SeriesMarker<UTCTimestamp>[] = [
      { time: startTime, position: 'aboveBar', color: '#fbbf24', shape: 'arrowDown', text: `[${currentIdx}` },
      { time: endTime,   position: 'aboveBar', color: endColor,  shape: 'arrowDown', text: editActive ? `${currentIdx}*` : `${currentIdx}]` },
    ]
    candle.setMarkers(markers)
  }, [currentIdx, boundaries, editActive])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const handler = () => recomputeLabelBadges()
    chart.timeScale().subscribeVisibleTimeRangeChange(handler)
    return () => chart.timeScale().unsubscribeVisibleTimeRangeChange(handler)
  }, [recomputeLabelBadges])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !editActive) return
    const handler = (param: MouseEventParams<Time>) => {
      if (typeof param.time !== 'number') return
      setEditEnd(param.time * 1000)
    }
    chart.subscribeClick(handler)
    return () => chart.unsubscribeClick(handler)
  }, [editActive, setEditEnd])

  // ── Drag logic ─────────────────────────────────────────────────────────────
  function onDividerMouseDown(e: React.MouseEvent) {
    isDragging.current     = true
    dragStartY.current     = e.clientY
    dragStartSplit.current = splitRef.current
    e.preventDefault()
    e.stopPropagation()
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current || !containerRef.current) return
      const rect  = containerRef.current.getBoundingClientRect()
      const newSplit = (e.clientY - rect.top) / rect.height
      setSplit(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, newSplit)))
    }
    function onMouseUp() { isDragging.current = false }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }
  }, [])

  return (
    <div ref={containerRef} className="relative w-full h-full select-none">
      {/* Draggable divider — overlaid on the chart at the split point */}
      <div
        className="absolute left-0 right-0 z-10 cursor-ns-resize group"
        style={{
          top:       `calc(${split * 100}% - ${DIVIDER_HIT_PX / 2}px)`,
          height:    DIVIDER_HIT_PX,
        }}
        onMouseDown={onDividerMouseDown}
      >
        {/* Visible line at vertical center of hit area */}
        <div
          className="absolute inset-x-0 bg-[#2b3139] group-hover:bg-[#474d57] transition-colors duration-150"
          style={{ top: '50%', height: 1, transform: 'translateY(-50%)' }}
        />
      </div>

      {klines.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ bottom: `${(1 - split) * 100}%` }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="mb-3 opacity-20">
            <path d="M3 17l4-8 4 4 4-6 4 4" stroke="#848e9c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <p className="text-gray-600 text-sm">No candlestick data</p>
        </div>
      )}
      {labelBadges.map((badge) => (
        <div
          key={badge.key}
          className="absolute z-20 pointer-events-none rounded bg-[#0b0e11]/85 px-1.5 py-0.5 font-semibold text-[10px] leading-none border border-[#2b3139]"
          style={{
            left: badge.left,
            top: badge.top,
            color: LABEL_BADGE_COLOR[badge.label],
            transform: 'translate(-50%, -140%)',
          }}
        >
          {badge.label}
        </div>
      ))}
    </div>
  )
}

// ── Scale margin helpers ──────────────────────────────────────────────────────

function klineMargins(split: number) {
  return { top: 0.03, bottom: 1 - split + GAP }
}

function volMargins(split: number) {
  return { top: split + GAP, bottom: 0 }
}

// ── Data helpers ─────────────────────────────────────────────────────────────

function toVolumeDatum(c: Candle) {
  return {
    time:  c.time,
    value: c.volume,
    color: c.close >= c.open ? '#1D9E7566' : '#D85A3066',
  }
}

function toVolumeData(candles: Candle[]) {
  return candles.map(toVolumeDatum)
}
