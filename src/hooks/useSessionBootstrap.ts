import { useEffect } from 'react'
import { useLabelSession } from '../stores/labelSessionStore'
import { canonicalJson } from '../lib/canonicalJson'
import { sha256Hex } from '../lib/sha256'
import type { Manifest, Precompute } from '../types/manifest'

// Allow alnum, dash, underscore, dot — covers expected manifest_version and
// window_id forms (e.g. "btcusdt-15m-2023-02") and refuses path traversal.
const ID_RE = /^[a-zA-Z0-9._-]+$/

// Vite dev returns the SPA fallback (index.html) for any missing path, so a
// 200 status alone does not mean the asset exists. Discriminate by
// Content-Type and surface a clear error for missing JSON files.
async function fetchJson<T>(url: string, label: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`fetch ${label} failed: ${url} -> HTTP ${res.status}`)
  }
  const ctype = res.headers.get('content-type') ?? ''
  if (!ctype.toLowerCase().includes('application/json')) {
    throw new Error(
      `fetch ${label} did not return JSON (got Content-Type "${ctype}"). ` +
        `Most likely the file does not exist at ${url}.`,
    )
  }
  return (await res.json()) as T
}

export function useSessionBootstrap(): void {
  const beginLoading = useLabelSession((s) => s.beginLoading)
  const setReady = useLabelSession((s) => s.setReady)
  const setError = useLabelSession((s) => s.setError)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const manifestVersion = params.get('manifest')
    const windowId = params.get('window_id')

    if (!manifestVersion || !ID_RE.test(manifestVersion)) {
      setError(
        'Missing or invalid URL parameter: manifest. ' +
          'Expected ?manifest=<id>&window_id=<id>',
      )
      return
    }
    if (!windowId || !ID_RE.test(windowId)) {
      setError(
        'Missing or invalid URL parameter: window_id. ' +
          'Expected ?manifest=<id>&window_id=<id>',
      )
      return
    }

    beginLoading(manifestVersion, windowId)

    void (async () => {
      try {
        // 1. Fetch + validate manifest.
        const manifestUrl = `/manifests/${manifestVersion}.json`
        const manifest = await fetchJson<Manifest>(manifestUrl, `manifest '${manifestVersion}'`)

        const { content_hash_sha256: declared, ...rest } = manifest
        const computed = await sha256Hex(canonicalJson(rest))
        if (computed !== declared) {
          throw new Error(
            `Manifest hash mismatch:\n  declared ${declared}\n  computed ${computed}`,
          )
        }

        // 2. Resolve window_id strictly against manifest.
        const window = manifest.windows.find((w) => w.window_id === windowId)
        if (!window) {
          const available = manifest.windows.map((w) => w.window_id).join(', ')
          throw new Error(
            `window_id '${windowId}' not found in manifest '${manifestVersion}'. ` +
              `Available: ${available || '(none)'}`,
          )
        }

        // 3. Fetch precompute strictly via manifest's precompute_path.
        const precomputeUrl = '/' + window.precompute_path.replace(/^\/+/, '')
        const precompute = await fetchJson<Precompute>(
          precomputeUrl,
          `precompute for '${windowId}'`,
        )

        // 4. Cross-check precompute is_range against manifest window.
        if (
          precompute.is_range.start_ms !== window.is_range.start_ms ||
          precompute.is_range.end_ms !== window.is_range.end_ms
        ) {
          throw new Error(
            `Precompute is_range does not match manifest window:\n` +
              `  manifest [${window.is_range.start_ms}, ${window.is_range.end_ms}]\n` +
              `  precompute [${precompute.is_range.start_ms}, ${precompute.is_range.end_ms}]`,
          )
        }

        // 5. Defense-in-depth: every bar must be within is_range. Guards
        //    against a tampered precompute slipping OOS bars past the
        //    range-equality check above.
        const { start_ms, end_ms } = window.is_range
        const oob = precompute.bars.find((b) => b.ms < start_ms || b.ms > end_ms)
        if (oob) {
          throw new Error(
            `Precompute contains a bar outside is_range: ms=${oob.ms} not in [${start_ms}, ${end_ms}]`,
          )
        }

        // 6. If the opt-in weak-label layer is present, it MUST align 1:1 with
        //    pl_segments — deriveSegments indexes system_opinions[idx] to
        //    source the load-bearing `sampling_reason` export field. A
        //    misaligned upstream JSON would otherwise silently export the
        //    wrong sampling bucket. Refuse rather than mislabel.
        const opinions = precompute.system_opinions
        if (opinions) {
          const pl = precompute.pl_segments
          if (opinions.length !== pl.length) {
            throw new Error(
              `Precompute system_opinions length (${opinions.length}) does not ` +
                `match pl_segments length (${pl.length}).`,
            )
          }
          for (let i = 0; i < pl.length; i++) {
            if (opinions[i].start_ms !== pl[i].start_ms || opinions[i].end_ms !== pl[i].end_ms) {
              throw new Error(
                `Precompute system_opinions[${i}] range ` +
                  `[${opinions[i].start_ms}, ${opinions[i].end_ms}] does not align ` +
                  `with pl_segments[${i}] [${pl[i].start_ms}, ${pl[i].end_ms}].`,
              )
            }
          }
        }

        setReady(manifest, window, precompute)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [beginLoading, setReady, setError])
}
