export interface PLProposalVersion {
  code_git_sha: string
  smaPeriod: number
  turningPointPeriod: number
}

export interface IsRange {
  start_ms: number
  end_ms: number
}

export interface WindowEntry {
  window_id: string
  market: string
  interval: string
  is_range: IsRange
  precompute_path: string
}

export interface Manifest {
  manifest_version: string
  pl_proposal_version: PLProposalVersion
  windows: WindowEntry[]
  content_hash_sha256: string
}

export interface Bar {
  ms: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface PLSegment {
  start_ms: number
  end_ms: number
  slope: number
  start_price: number
  end_price: number
}

export interface HTEntry {
  ms: number
  value: number
}

export interface Precompute {
  market: string
  interval: string
  is_range: IsRange
  pl_proposal_version: PLProposalVersion
  bars: Bar[]
  pl_segments: PLSegment[]
  ht_trendline: HTEntry[]
}
