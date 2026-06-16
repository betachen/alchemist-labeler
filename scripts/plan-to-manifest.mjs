// Derive a UI window-manifest from the alchemist pilot window plan (the SSOT),
// validating the plan through a mirror of alchemist's pilot_plan.py before emitting.
// This is the labeler-side gate that proves the labels are produced against the
// exact frozen plan: it verifies the plan self-hash + an out-of-band --plan-hash
// anchor, the topology, and each period's precompute SHA-256, then writes a signed
// manifest + copies the precomputes into public/ for the Vite dev server.
//
// The emitted manifest carries `plan_sha256` (provenance) and `label_output_subdir`
// (so the UI writes to the pilot's label dir). window_id == the label_set filename
// stem, so a saved file lands at <output_dir>/<window_id>.manual_regime_audit_v1.json
// == the plan period's label_set_path.
//
// Usage: node scripts/plan-to-manifest.mjs <plan.json> <expected_plan_hash> [manifest_version]
//   then label via ?manifest=<version>&window_id=<stem>
//
// Canonical serialization MUST stay in lockstep with src/lib/canonicalJson.ts and
// scripts/sign-manifest.mjs (and alchemist's pilot_plan.plan_self_hash).

import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'

const DAY_MS = 86_400_000
const PUBLIC_PRECOMPUTES = 'public/precomputes'
const PUBLIC_MANIFESTS = 'public/manifests'

function canonical(o) {
  if (o === null) return 'null'
  if (typeof o === 'number' || typeof o === 'boolean' || typeof o === 'string') {
    return JSON.stringify(o)
  }
  if (Array.isArray(o)) return '[' + o.map(canonical).join(',') + ']'
  if (typeof o === 'object') {
    const keys = Object.keys(o).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}'
  }
  throw new Error('canonical: unsupported type ' + typeof o)
}

const sha256Hex = (s) => createHash('sha256').update(s).digest('hex')
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

function planSelfHash(plan) {
  return sha256Hex(canonical({ ...plan, plan_sha256: '' }))
}

// Mirror of alchemist pilot_plan.validate_pilot_plan (the structural + binding
// subset relevant to the labeler). Returns a list of error strings; empty = valid.
function validatePilotPlan(plan, { expectedHash, market, timeframe }) {
  const errs = []
  if (plan === null || typeof plan !== 'object') return ['plan_not_object']

  const recomputed = planSelfHash(plan)
  if (!plan.plan_sha256) errs.push('plan_sha256_missing')
  else if (plan.plan_sha256 !== recomputed) errs.push('plan_sha256_mismatch')
  if (expectedHash && recomputed !== expectedHash) errs.push('plan_hash!=expected')

  if (plan.kind !== 'pilot_window_plan') errs.push(`plan_kind=${plan.kind}!=pilot_window_plan`)
  const STATUSES = ['draft_labels_pending', 'frozen', 'synthetic_structural_rehearsal']
  if (!STATUSES.includes(plan.status)) errs.push(`plan_status=${plan.status}_invalid`)
  if (market && plan.market !== market) errs.push(`plan_market=${plan.market}!=${market}`)
  if (timeframe && plan.signal_timeframe !== timeframe)
    errs.push(`plan_timeframe=${plan.signal_timeframe}!=${timeframe}`)

  const periods = plan.periods ?? []
  const declared = plan.declared_windows ?? []
  if (periods.length === 0) errs.push('plan_periods_empty')
  if (declared.length === 0) errs.push('plan_declared_windows_empty')
  const ids = periods.map((p) => p.window_id)
  if (new Set(ids).size !== ids.length) errs.push('plan_periods_duplicate_window_id')

  const sp = [...periods].sort((a, b) => (a.is_range?.start_ms ?? 0) - (b.is_range?.start_ms ?? 0))
  sp.forEach((p, i) => {
    const r = p.is_range ?? {}
    if (r.start_ms == null || r.end_ms == null) { errs.push(`plan_period_${p.window_id}_range_missing`); return }
    if (r.end_ms <= r.start_ms) errs.push(`plan_period_${p.window_id}_non_positive_span`)
    if (i > 0 && (sp[i - 1].is_range?.end_ms) !== r.start_ms) errs.push(`plan_periods_gap_or_overlap_at_${p.window_id}`)
    const wantRole = i === 0 ? 'fit_only' : 'blind_scoring'
    if (p.role !== wantRole) errs.push(`plan_period_${p.window_id}_role=${p.role}!=${wantRole}`)
  })

  const idxById = new Map(sp.map((p, i) => [p.window_id, i]))
  const dids = declared.map((w) => w.window_id)
  if (new Set(dids).size !== dids.length) errs.push('plan_declared_duplicate_window_id')
  for (const w of declared) {
    const fi = idxById.get(w.fit_period); const si = idxById.get(w.score_period)
    if (fi === undefined) { errs.push(`${w.window_id}_fit_period_absent`); continue }
    const fr = sp[fi].is_range ?? {}
    if (fr.start_ms !== w.is_start_ms) errs.push(`${w.window_id}_is_start!=fit_period_start`)
    if ((fr.end_ms - fr.start_ms) !== (w.is_window_days ?? -1) * DAY_MS)
      errs.push(`${w.window_id}_is_window_days!=fit_period_span_days`)
    if (si === undefined) { errs.push(`${w.window_id}_score_period_absent`); continue }
    if (si !== fi + 1) errs.push(`${w.window_id}_score_period_not_consecutive`)
    const sr = sp[si].is_range ?? {}
    if (sr.start_ms !== w.oos_start_ms || sr.end_ms !== w.oos_end_ms) errs.push(`${w.window_id}_oos!=score_period_range`)
    if (sp[si].role !== 'blind_scoring') errs.push(`${w.window_id}_score_period_role!=blind_scoring`)
    if (!sp[si].label_set_path) errs.push(`${w.window_id}_score_period_label_path_missing`)
  }
  const expectedPairs = JSON.stringify(sp.slice(0, -1).map((_, i) => [i, i + 1]))
  const declaredPairs = JSON.stringify(
    declared.map((w) => [idxById.get(w.fit_period), idxById.get(w.score_period)])
      .filter(([a, b]) => a !== undefined && b !== undefined)
      .sort((x, y) => x[0] - y[0] || x[1] - y[1]))
  if (declaredPairs !== expectedPairs) errs.push('plan_declared_pairs!=full_tiling')

  if (periods.length && declared.length && declared.length !== periods.length - 1)
    errs.push('plan_declared_count!=periods-1')
  const span = plan.span ?? {}
  if (sp.length && (span.start_ms !== sp[0].is_range?.start_ms || span.end_ms !== sp[sp.length - 1].is_range?.end_ms))
    errs.push('plan_span!=[first_period_start,last_period_end]')
  return errs
}

function main() {
  const [planPath, expectedHash, manifestVersion = 'pilot_2023h2'] = process.argv.slice(2)
  if (!planPath || !expectedHash) {
    console.error('usage: node scripts/plan-to-manifest.mjs <plan.json> <expected_plan_hash> [manifest_version]')
    process.exit(2)
  }
  const plan = JSON.parse(readFileSync(planPath, 'utf8'))
  const market = plan.market
  const timeframe = plan.signal_timeframe
  const errs = validatePilotPlan(plan, { expectedHash, market, timeframe })
  if (errs.length) {
    console.error('invalid pilot plan (fail-closed):')
    for (const e of errs) console.error('  ' + e)
    process.exit(1)
  }

  mkdirSync(PUBLIC_PRECOMPUTES, { recursive: true })
  const windows = []
  for (const per of plan.periods) {
    // Verify + copy the precompute the plan pins.
    const srcSha = sha256File(per.precompute_path)
    if (srcSha !== per.precompute_sha256) {
      console.error(`precompute SHA mismatch for ${per.window_id}:\n  file ${srcSha}\n  plan ${per.precompute_sha256}`)
      process.exit(1)
    }
    const pc = JSON.parse(readFileSync(per.precompute_path, 'utf8'))
    const fail = (msg) => { console.error(`${per.window_id}: ${msg}`); process.exit(1) }
    if (pc.is_range.start_ms !== per.is_range.start_ms || pc.is_range.end_ms !== per.is_range.end_ms)
      fail('precompute is_range != period is_range')
    if (pc.market !== market) fail(`precompute market ${pc.market} != plan ${market}`)
    if (pc.interval !== timeframe) fail(`precompute interval ${pc.interval} != plan ${timeframe}`)
    if (canonical(pc.pl_proposal_version) !== canonical(plan.pl_proposal_version))
      fail('precompute pl_proposal_version != plan pl_proposal_version')
    // segment_census must reproduce precompute.pl_segments under the frozen
    // convention: census[i] = {idx:i, start_ms: pl[i].start_ms, end_ms: pl[i].end_ms+STEP}.
    // Without this a re-signed plan could carry a tampered census the labeler would
    // trust. STEP is the precompute's own bar step.
    const step = pc.bars.length >= 2 ? pc.bars[1].ms - pc.bars[0].ms : null
    if (step === null) fail('precompute has too few bars to derive a step')
    const census = per.segment_census ?? []
    const pls = pc.pl_segments ?? []
    if (census.length !== pls.length) fail(`segment_census length ${census.length} != pl_segments ${pls.length}`)
    for (let i = 0; i < pls.length; i++) {
      if (census[i].idx !== i || census[i].start_ms !== pls[i].start_ms ||
          census[i].end_ms !== pls[i].end_ms + step)
        fail(`segment_census[${i}] {${census[i].idx},${census[i].start_ms},${census[i].end_ms}} != ` +
             `pl_segments[${i}] {${i},${pls[i].start_ms},${pls[i].end_ms + step}}`)
    }
    // window_id = label_set filename stem (so a save lands at the plan's label_set_path).
    const stem = basename(per.label_set_path).replace(/\.manual_regime_audit_v1\.json$/, '')
    copyFileSync(per.precompute_path, `${PUBLIC_PRECOMPUTES}/${stem}.json`)
    windows.push({
      window_id: stem,
      market,
      interval: timeframe,
      is_range: { start_ms: per.is_range.start_ms, end_ms: per.is_range.end_ms },
      precompute_path: `precomputes/${stem}.json`,
    })
  }

  // Sign exactly like scripts/sign-manifest.mjs / the UI bootstrap: hash the
  // object WITHOUT content_hash_sha256, then attach it.
  const unsigned = {
    manifest_version: manifestVersion,
    pl_proposal_version: plan.pl_proposal_version,
    windows,
    label_output_subdir: basename(plan.labeling.output_dir),
    plan_sha256: plan.plan_sha256,
  }
  const manifest = { ...unsigned, content_hash_sha256: sha256Hex(canonical(unsigned)) }

  mkdirSync(PUBLIC_MANIFESTS, { recursive: true })
  const outPath = `${PUBLIC_MANIFESTS}/${manifestVersion}.json`
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`wrote ${outPath}  content_hash=${manifest.content_hash_sha256.slice(0, 16)}  plan_sha256=${plan.plan_sha256.slice(0, 16)}`)
  console.log(`windows=${windows.length}  output_subdir=${manifest.label_output_subdir}`)
  console.log('launch each period with:')
  for (const w of windows) console.log(`  ?manifest=${manifestVersion}&window_id=${w.window_id}`)
}

main()
