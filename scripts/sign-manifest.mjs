// Compute content_hash_sha256 for a manifest and write it back in-place.
// Canonical serialization rules MUST stay in lockstep with src/lib/canonicalJson.ts.
//
// Usage: node scripts/sign-manifest.mjs public/manifests/<file>.json

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

function canonical(o) {
  if (o === null) return 'null'
  if (typeof o === 'number' || typeof o === 'boolean' || typeof o === 'string') {
    return JSON.stringify(o)
  }
  if (Array.isArray(o)) {
    return '[' + o.map(canonical).join(',') + ']'
  }
  if (typeof o === 'object') {
    const keys = Object.keys(o).sort()
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}'
  }
  throw new Error('canonical: unsupported type ' + typeof o)
}

const path = process.argv[2]
if (!path) {
  console.error('usage: node scripts/sign-manifest.mjs <manifest.json>')
  process.exit(1)
}

const m = JSON.parse(readFileSync(path, 'utf8'))
delete m.content_hash_sha256
const hex = createHash('sha256').update(canonical(m)).digest('hex')
m.content_hash_sha256 = hex
writeFileSync(path, JSON.stringify(m, null, 2) + '\n')
console.log(`signed ${path} -> ${hex}`)
