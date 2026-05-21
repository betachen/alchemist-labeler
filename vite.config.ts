// @ts-nocheck
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const LABEL_OUTPUT_DIR = '/data/alchemist-labeler/labels'
const MAX_LABEL_SET_BYTES = 25 * 1024 * 1024

function localLabelSetWriter() {
  return {
    name: 'local-label-set-writer',
    configureServer(server) {
      server.middlewares.use('/api/label-set', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }

        try {
          const { mkdir, writeFile } = await import('node:fs/promises')
          const path = await import('node:path')
          const bodyText = await readRequestBody(req, MAX_LABEL_SET_BYTES)
          const body = JSON.parse(bodyText)
          const filename = body?.filename
          const content = body?.content

          if (typeof filename !== 'string' || !/^[a-zA-Z0-9._-]+\.manual_v1\.json$/.test(filename)) {
            throw new Error('invalid label_set filename')
          }
          if (typeof content !== 'string') {
            throw new Error('invalid label_set content')
          }

          const parsed = JSON.parse(content)
          if (parsed?.label_set_version !== 'manual_v1' || typeof parsed?.content_hash_sha256 !== 'string') {
            throw new Error('content is not a signed manual_v1 label_set')
          }

          await mkdir(LABEL_OUTPUT_DIR, { recursive: true })
          const outPath = path.join(LABEL_OUTPUT_DIR, filename)
          await writeFile(outPath, content, 'utf8')
          sendJson(res, 200, { path: outPath })
        } catch (e) {
          sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) })
        }
      })
      server.middlewares.use('/api/label-set-progress', async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }

        try {
          const { readdir } = await import('node:fs/promises')
          const names = await readdir(LABEL_OUTPUT_DIR).catch((e) => {
            if (e && e.code === 'ENOENT') return []
            throw e
          })
          const windowIds = names
            .filter((name) => name.endsWith('.manual_v1.json'))
            .map((name) => name.replace(/\.manual_v1\.json$/, ''))
          sendJson(res, 200, { window_ids: windowIds })
        } catch (e) {
          sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) })
        }
      })
      server.middlewares.use('/api/bars-range', async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }

        try {
          const url = new URL(req.url ?? '', 'http://localhost')
          const market = url.searchParams.get('market')
          const interval = url.searchParams.get('interval')
          if (!market || !interval || !/^[a-zA-Z0-9._-]+$/.test(market) || !/^[a-zA-Z0-9._-]+$/.test(interval)) {
            throw new Error('invalid market or interval')
          }
          const path = await import('node:path')
          const filePath = path.resolve(process.cwd(), 'bars-formatted', `${market}-${interval}.csv`)
          const { firstLine, lastLine } = await readFirstLastLine(filePath)
          const first = JSON.parse(firstLine)
          const last = JSON.parse(lastLine)
          if (!Array.isArray(first) || !Array.isArray(last)) {
            throw new Error('bars file is not Binance JSON-array CSV')
          }
          sendJson(res, 200, { start_ms: Number(first[0]), end_ms: Number(last[6] ?? last[0]) })
        } catch (e) {
          sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) })
        }
      })
    },
  }
}

async function readFirstLastLine(filePath) {
  const { open } = await import('node:fs/promises')
  const file = await open(filePath, 'r')
  try {
    const stat = await file.stat()
    const chunkSize = Math.min(64 * 1024, stat.size)
    const firstBuffer = Buffer.alloc(chunkSize)
    await file.read(firstBuffer, 0, chunkSize, 0)
    const firstLine = firstBuffer.toString('utf8').split(/\r?\n/).find(Boolean)

    const lastBuffer = Buffer.alloc(chunkSize)
    await file.read(lastBuffer, 0, chunkSize, stat.size - chunkSize)
    const lines = lastBuffer.toString('utf8').trim().split(/\r?\n/)
    const lastLine = lines[lines.length - 1]

    if (!firstLine || !lastLine) throw new Error('bars file is empty')
    return { firstLine, lastLine }
  } finally {
    await file.close()
  }
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('label_set payload is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

export default defineConfig({
  plugins: [react(), localLabelSetWriter()],
  server: {
    host: '0.0.0.0',
  },
})
