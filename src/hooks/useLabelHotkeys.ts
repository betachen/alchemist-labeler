import { useEffect } from 'react'
import { useLabelSession } from '../stores/labelSessionStore'
import type { Label } from '../types/segment'

const LABEL_KEY: Record<string, Label> = {
  KeyU: 'uptrend',
  KeyO: 'oscillation',
  KeyP: 'pullback',
  KeyS: 'sideways',
}

// Keys we always preventDefault to keep the chart pane from scrolling.
const PREVENT_DEFAULT_CODES = new Set([
  'Space',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
])

export function useLabelHotkeys() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const s = useLabelSession.getState()
      if (s.status !== 'ready') return

      const code = e.code

      // Space — global debug peek; does NOT advance the per-segment state machine.
      if (code === 'Space') {
        e.preventDefault()
        s.toggleOverlay()
        return
      }

      // Edit-boundary mode swallows arrows / Enter / Escape; everything else is ignored.
      if (s.edit.active) {
        if (code === 'ArrowLeft') {
          e.preventDefault(); s.shiftEditEnd(-1); return
        }
        if (code === 'ArrowRight') {
          e.preventDefault(); s.shiftEditEnd(+1); return
        }
        if (code === 'Enter') {
          e.preventDefault(); s.commitEdit(); return
        }
        if (code === 'Escape') {
          e.preventDefault(); s.exitEdit(); return
        }
        if (PREVENT_DEFAULT_CODES.has(code)) e.preventDefault()
        return
      }

      // Navigation
      if (code === 'ArrowLeft')  { e.preventDefault(); s.prevSegment(); return }
      if (code === 'ArrowRight') { e.preventDefault(); s.nextSegment(); return }
      if (code === 'KeyN')       { s.nextUnreviewed(); return }

      // Labels
      const lbl = LABEL_KEY[code]
      if (lbl) { s.assignLabel(lbl); return }

      if (code === 'KeyE') { s.enterEdit(); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
