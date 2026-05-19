import type { ReactNode } from 'react'
import { useSessionBootstrap } from './hooks/useSessionBootstrap'
import { useLabelHotkeys } from './hooks/useLabelHotkeys'
import { useLabelSession } from './stores/labelSessionStore'
import { KlineChart } from './components/chart/KlineChart'
import { StatusStrip } from './components/StatusStrip'
import { CoverageGate } from './components/CoverageGate'

function fmtUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace('.000Z', 'Z')
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
      {children}
    </div>
  )
}

function Refusal({ message }: { message: string }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
      <div className="text-[#D85A30] font-semibold text-base mb-3">Session refused</div>
      <pre className="text-xs text-gray-300 whitespace-pre-wrap max-w-2xl mb-4">{message}</pre>
      <div className="text-xs text-gray-500 max-w-2xl">
        Expected URL form: <code className="text-gray-300">?manifest=&lt;id&gt;&amp;window_id=&lt;id&gt;</code><br />
        Manifests live at <code className="text-gray-300">public/manifests/&lt;id&gt;.json</code> and must list the
        requested <code className="text-gray-300">window_id</code>.
      </div>
    </div>
  )
}

function App() {
  useSessionBootstrap()
  useLabelHotkeys()
  const status         = useLabelSession((s) => s.status)
  const errorMessage   = useLabelSession((s) => s.errorMessage)
  const windowId       = useLabelSession((s) => s.windowId)
  const currentWindow  = useLabelSession((s) => s.window)
  const overlayVisible = useLabelSession((s) => s.overlayVisible)

  return (
    <div className="flex flex-col h-full bg-[#0b0e11] text-white">
      <header className="flex items-center h-12 px-4 bg-[#161a1e] border-b border-[#2b3139] shrink-0 gap-3">
        <span className="font-bold text-lg tracking-tight">Alchemist Labeler</span>
        {currentWindow && (
          <span className="text-xs text-gray-400">
            {currentWindow.market} {currentWindow.interval} ·{' '}
            {fmtUtc(currentWindow.is_range.start_ms)} → {fmtUtc(currentWindow.is_range.end_ms)} · {windowId}
          </span>
        )}
        {status === 'error' && (
          <span className="text-xs text-[#D85A30]">refused</span>
        )}
        {status === 'ready' && (
          <span className="ml-auto text-xs text-gray-500">
            peek:{' '}
            <span className={overlayVisible ? 'text-[#f97316] font-medium' : 'text-gray-600'}>
              {overlayVisible ? 'on' : 'off'}
            </span>{' '}
            <span className="opacity-50">(space)</span>
          </span>
        )}
      </header>
      <StatusStrip />
      <main className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 p-3">
          <div className="w-full h-full rounded-lg overflow-hidden border border-[#2b3139]">
            {(status === 'idle' || status === 'loading') && <Centered>Loading…</Centered>}
            {status === 'error' && <Refusal message={errorMessage ?? 'Unknown error'} />}
            {status === 'ready' && <KlineChart />}
          </div>
        </div>
        <CoverageGate />
      </main>
    </div>
  )
}

export default App
