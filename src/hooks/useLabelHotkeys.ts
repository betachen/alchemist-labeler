import { useEffect } from 'react'
import { useLabelSession } from '../stores/labelSessionStore'
import type { PrimaryLabel, StructureTag } from '../types/segment'
import { STRUCTURE_TAG_ORDER } from '../types/segment'

// manual_regime_audit_v1 primary-label hotkeys.
const LABEL_KEY: Record<string, PrimaryLabel> = {
  KeyU: 'uptrend',
  KeyD: 'downtrend',
  KeyO: 'oscillation',
  KeyS: 'sideways',
  KeyT: 'transition',
  KeyA: 'ambiguous',
}

// 阶段 2b: structure-tag hotkeys. Digit1–4 map to STRUCTURE_TAG_ORDER indices.
const TAG_KEY: Record<string, StructureTag> = {
  Digit1: STRUCTURE_TAG_ORDER[0],
  Digit2: STRUCTURE_TAG_ORDER[1],
  Digit3: STRUCTURE_TAG_ORDER[2],
  Digit4: STRUCTURE_TAG_ORDER[3],
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

      // Primary labels
      const lbl = LABEL_KEY[code]
      if (lbl) { s.assignPrimaryLabel(lbl); return }

      if (code === 'KeyE') { s.enterEdit(); return }

      // 阶段 2b: structure tags (1–4), confidence cycle (C), audit mode toggle (M)
      const structTag = TAG_KEY[code] as StructureTag | undefined
      if (structTag) { s.toggleStructureTag(structTag); return }
      if (code === 'KeyC') { s.cycleConfidence(); return }
      if (code === 'KeyM') { s.toggleSessionAuditMode(); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
