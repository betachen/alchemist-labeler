import { useMemo } from 'react'
import type { UTCTimestamp } from 'lightweight-charts'
import { useLabelSession } from '../stores/labelSessionStore'
import type { Candle } from '../types/market'

export function useKlines(): Candle[] {
  const precompute = useLabelSession((s) => s.precompute)
  return useMemo(() => {
    if (!precompute) return []
    return precompute.bars.map((b) => ({
      // lightweight-charts UTCTimestamp is seconds.
      time: Math.floor(b.ms / 1000) as UTCTimestamp,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v,
    }))
  }, [precompute])
}
