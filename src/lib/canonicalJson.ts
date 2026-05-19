// Deterministic JSON serialization for content_hash_sha256.
// MUST stay in lockstep with scripts/sign-manifest.mjs.

export function canonicalJson(o: unknown): string {
  if (o === null) return 'null'
  if (typeof o === 'number' || typeof o === 'boolean' || typeof o === 'string') {
    return JSON.stringify(o)
  }
  if (Array.isArray(o)) {
    return '[' + o.map(canonicalJson).join(',') + ']'
  }
  if (typeof o === 'object') {
    const keys = Object.keys(o as Record<string, unknown>).sort()
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalJson((o as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    )
  }
  throw new Error('canonicalJson: unsupported type ' + typeof o)
}
