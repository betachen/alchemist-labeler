import { create } from 'zustand'
import type { Manifest, Precompute, WindowEntry } from '../types/manifest'
import type { AuditMode, LabelConfidence, PrimaryLabel, Segment, StructureTag } from '../types/segment'
import { coerceSamplingReason } from '../types/segment'

export type SessionStatus = 'idle' | 'loading' | 'ready' | 'error'

// Minimum gap between adjacent segment boundaries (1 bar of the precompute's
// interval). Filled in at setReady time from precompute.bars[1].ms - bars[0].ms.
interface BoundaryEditState {
  active: boolean
  // The segment being edited (mirrors currentIdx at the time E was pressed;
  // navigating while active is blocked).
  segIdx: number | null
  // Working override; null until user presses arrow at least once.
  pendingEndMs: number | null
}

interface LabelSessionState {
  status: SessionStatus
  errorMessage: string | null

  manifestVersion: string | null
  windowId: string | null
  manifest: Manifest | null
  window: WindowEntry | null
  precompute: Precompute | null

  // Step 5: global overlay debug peek (does NOT advance the state machine).
  overlayVisible: boolean

  // Step 6: segment state machine.
  segments: Segment[]
  currentIdx: number
  barStepMs: number          // 1-bar duration in ms (e.g. 900_000 for 15m)
  edit: BoundaryEditState
  reviewerId: string
  savedWindowIds: string[]

  beginLoading: (manifestVersion: string, windowId: string) => void
  setReady: (manifest: Manifest, window: WindowEntry, precompute: Precompute) => void
  setError: (msg: string) => void
  setSavedWindowIds: (windowIds: string[]) => void
  markWindowSaved: (windowId: string) => void
  toggleOverlay: () => void

  // Navigation
  setCurrentIdx: (idx: number) => void
  nextSegment: () => void
  prevSegment: () => void
  nextUnreviewed: () => void

  // Audit mode (session-level; captured per-segment at label time)
  sessionAuditMode: AuditMode
  toggleSessionAuditMode: () => void

  // Per-segment label metadata
  setLabelConfidence: (confidence: LabelConfidence) => void
  cycleConfidence: () => void
  toggleStructureTag: (tag: StructureTag) => void

  // State machine
  assignPrimaryLabel: (label: PrimaryLabel) => void
  revealCurrent: () => void
  acceptCurrent: () => void
  rejectCurrent: () => void

  // Edit-boundary
  enterEdit: () => void
  exitEdit: () => void
  shiftEditEnd: (deltaBars: number) => void
  setEditEnd: (endMs: number) => void
  commitEdit: () => void
}

function deriveSegments(precompute: Precompute): Segment[] {
  return precompute.pl_segments.map((s, idx) => ({
    idx,
    pl_start_ms:    s.start_ms,
    pl_end_ms:      s.end_ms,
    pl_slope:       s.slope,
    pl_start_price: s.start_price,
    pl_end_price:   s.end_price,
    end_ms_override: null,
    primary_label:   null,
    structure_tags:  [],
    label_confidence: 'high',
    audit_mode:       'blind',
    // Sourced from the weak-label layer when the precompute carries one;
    // pl_segments[idx] and system_opinions[idx] are 1:1 by construction.
    // candidate_primary_label is the canonical field (alchemist-weaklabel ≥ V0.2);
    // suggested_label is the legacy fallback for older precomputes.
    sampling_reason:  coerceSamplingReason(precompute.system_opinions?.[idx]?.sampling_bucket),
    suggested_label:  precompute.system_opinions?.[idx]?.candidate_primary_label
                      ?? precompute.system_opinions?.[idx]?.suggested_label
                      ?? null,
    state:           'unreviewed',
    was_rejected:    false,
    reject_count:    0,
    reviewed_at_ms:  null,
  }))
}

function effectiveEnd(seg: Segment): number {
  return seg.end_ms_override ?? seg.pl_end_ms
}

const EMPTY_EDIT: BoundaryEditState = { active: false, segIdx: null, pendingEndMs: null }

function clampEditableEnd(segments: Segment[], idx: number, proposed: number, barStepMs: number): number | null {
  const seg = segments[idx]
  const next = segments[idx + 1]
  if (!seg || !next || barStepMs <= 0) return null
  const segStart = idx === 0
    ? seg.pl_start_ms
    : effectiveEnd(segments[idx - 1])
  const nextEnd = effectiveEnd(next)
  const lo = segStart + barStepMs
  const hi = nextEnd - barStepMs
  if (proposed < lo || proposed > hi) return null
  return proposed
}

export const useLabelSession = create<LabelSessionState>((set) => ({
  status: 'idle',
  errorMessage: null,
  manifestVersion: null,
  windowId: null,
  manifest: null,
  window: null,
  precompute: null,

  overlayVisible: false,
  sessionAuditMode: 'blind',

  segments:    [],
  currentIdx:  0,
  barStepMs:   0,
  edit:        EMPTY_EDIT,
  reviewerId:  'betachen',
  savedWindowIds: [],

  beginLoading: (manifestVersion, windowId) =>
    set({
      status: 'loading',
      errorMessage: null,
      manifestVersion,
      windowId,
      manifest: null,
      window: null,
      precompute: null,
      overlayVisible: false,
      segments:   [],
      currentIdx: 0,
      barStepMs:  0,
      edit:       EMPTY_EDIT,
    }),
  setReady: (manifest, window, precompute) => {
    const bars = precompute.bars
    // Bar step derived from the first two bars; uniform interval is required
    // by the manifest contract (15m precompute → 900_000ms).
    const barStepMs = bars.length >= 2 ? bars[1].ms - bars[0].ms : 0
    set({
      status: 'ready',
      manifest,
      window,
      precompute,
      errorMessage: null,
      segments:   deriveSegments(precompute),
      currentIdx: 0,
      barStepMs,
      edit:       EMPTY_EDIT,
    })
  },
  setError: (errorMessage) => set({ status: 'error', errorMessage }),
  setSavedWindowIds: (savedWindowIds) => set({ savedWindowIds }),
  markWindowSaved: (windowId) =>
    set((s) => s.savedWindowIds.includes(windowId)
      ? s
      : { savedWindowIds: [...s.savedWindowIds, windowId] }),
  toggleOverlay: () => set((s) => ({ overlayVisible: !s.overlayVisible })),
  toggleSessionAuditMode: () =>
    set((s) => ({ sessionAuditMode: s.sessionAuditMode === 'blind' ? 'assisted' : 'blind' })),

  setLabelConfidence: (confidence) =>
    set((s) => {
      if (s.edit.active) return s
      const seg = s.segments[s.currentIdx]
      if (!seg || (seg.state !== 'accepted' && seg.state !== 'edited')) return s
      const next = s.segments.slice()
      next[s.currentIdx] = { ...seg, label_confidence: confidence }
      return { segments: next }
    }),
  cycleConfidence: () =>
    set((s) => {
      if (s.edit.active) return s
      const seg = s.segments[s.currentIdx]
      if (!seg || (seg.state !== 'accepted' && seg.state !== 'edited')) return s
      const ORDER: LabelConfidence[] = ['high', 'medium', 'low']
      const nxt = ORDER[(ORDER.indexOf(seg.label_confidence) + 1) % ORDER.length]
      const next = s.segments.slice()
      next[s.currentIdx] = { ...seg, label_confidence: nxt }
      return { segments: next }
    }),
  toggleStructureTag: (tag) =>
    set((s) => {
      if (s.edit.active) return s
      const seg = s.segments[s.currentIdx]
      if (!seg || (seg.state !== 'accepted' && seg.state !== 'edited')) return s
      const tags = seg.structure_tags.includes(tag)
        ? seg.structure_tags.filter((t) => t !== tag)
        : [...seg.structure_tags, tag]
      const next = s.segments.slice()
      next[s.currentIdx] = { ...seg, structure_tags: tags }
      return { segments: next }
    }),

  setCurrentIdx: (idx) =>
    set((s) => {
      if (s.edit.active) return s            // navigation blocked in edit mode
      if (idx < 0 || idx >= s.segments.length) return s
      return { currentIdx: idx }
    }),
  nextSegment: () =>
    set((s) => {
      if (s.edit.active) return s
      if (s.currentIdx >= s.segments.length - 1) return s
      return { currentIdx: s.currentIdx + 1 }
    }),
  prevSegment: () =>
    set((s) => {
      if (s.edit.active) return s
      if (s.currentIdx <= 0) return s
      return { currentIdx: s.currentIdx - 1 }
    }),
  nextUnreviewed: () =>
    set((s) => {
      if (s.edit.active) return s
      const n = s.segments.length
      for (let i = 1; i <= n; i++) {
        const j = (s.currentIdx + i) % n
        if (s.segments[j].state === 'unreviewed') return { currentIdx: j }
      }
      return s
    }),

  assignPrimaryLabel: (label) =>
    set((s) => {
      if (s.edit.active) return s
      const seg = s.segments[s.currentIdx]
      if (!seg) return s
      const next = s.segments.slice()
      next[s.currentIdx] = {
        ...seg,
        primary_label: label,
        audit_mode: s.sessionAuditMode,
        state: seg.state === 'edited' ? 'edited' : 'accepted',
        reviewed_at_ms: Date.now(),
      }
      return {
        segments: next,
        currentIdx: s.currentIdx >= s.segments.length - 1 ? s.currentIdx : s.currentIdx + 1,
      }
    }),
  revealCurrent: () =>
    set((s) => {
      if (s.edit.active) return s
      const seg = s.segments[s.currentIdx]
      if (!seg) return s
      // Only meaningful from human_prelabel.
      if (seg.state !== 'human_prelabel') return s
      const next = s.segments.slice()
      next[s.currentIdx] = { ...seg, state: 'overlay_revealed' }
      return { segments: next }
    }),
  acceptCurrent: () =>
    set((s) => {
      if (s.edit.active) return s
      const seg = s.segments[s.currentIdx]
      if (!seg) return s
      if (seg.state !== 'overlay_revealed') return s
      const next = s.segments.slice()
      next[s.currentIdx] = { ...seg, state: 'accepted', reviewed_at_ms: Date.now() }
      return { segments: next }
    }),
  rejectCurrent: () =>
    set((s) => {
      if (s.edit.active) return s
      const seg = s.segments[s.currentIdx]
      if (!seg) return s
      // Reject is only meaningful after the overlay has been revealed.
      if (seg.state !== 'overlay_revealed') return s
      const next = s.segments.slice()
      next[s.currentIdx] = {
        ...seg,
        state:          'unreviewed',
        primary_label:  null,
        was_rejected:   true,
        reject_count:   seg.reject_count + 1,
        reviewed_at_ms: null,
      }
      return { segments: next }
    }),

  enterEdit: () =>
    set((s) => {
      const seg = s.segments[s.currentIdx]
      if (!seg) return s
      // Edit allowed after a segment has been marked.
      if (seg.state !== 'accepted' && seg.state !== 'edited') return s
      // Last segment's end is the IS-range end; not editable (would push past
      // the manifest boundary).
      if (s.currentIdx === s.segments.length - 1) return s
      return {
        edit: { active: true, segIdx: s.currentIdx, pendingEndMs: effectiveEnd(seg) },
      }
    }),
  exitEdit: () => set({ edit: EMPTY_EDIT }),
  shiftEditEnd: (deltaBars) =>
    set((s) => {
      if (!s.edit.active || s.edit.segIdx === null) return s
      const idx  = s.edit.segIdx
      const seg  = s.segments[idx]
      if (!seg) return s
      const pending = s.edit.pendingEndMs ?? effectiveEnd(seg)
      const proposed = pending + deltaBars * s.barStepMs
      const clamped = clampEditableEnd(s.segments, idx, proposed, s.barStepMs)
      if (clamped === null) return s
      return { edit: { ...s.edit, pendingEndMs: clamped } }
    }),
  setEditEnd: (endMs) =>
    set((s) => {
      if (!s.edit.active || s.edit.segIdx === null) return s
      const clamped = clampEditableEnd(s.segments, s.edit.segIdx, endMs, s.barStepMs)
      if (clamped === null) return s
      return { edit: { ...s.edit, pendingEndMs: clamped } }
    }),
  commitEdit: () =>
    set((s) => {
      if (!s.edit.active || s.edit.segIdx === null) return s
      const idx = s.edit.segIdx
      const seg = s.segments[idx]
      if (!seg) return s
      const pending = s.edit.pendingEndMs
      // No movement → treat as plain accept; do NOT mark edited.
      const moved = pending !== null && pending !== effectiveEnd(seg)
      const newState = moved ? 'edited' : 'accepted'
      const newOverride = moved ? pending : seg.end_ms_override
      const next = s.segments.slice()
      next[idx] = {
        ...seg,
        state:           newState,
        end_ms_override: newOverride,
        reviewed_at_ms:  Date.now(),
      }
      return { segments: next, edit: EMPTY_EDIT }
    }),
}))
