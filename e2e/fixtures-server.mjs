/**
 * Fixture + plugin server for the e2e suite.
 *
 * Serves three things on localhost (the deployed shell's CSP allows
 * http://localhost:* frames for exactly this kind of testing):
 *   /exo-gltf/*       the local production build (plugin/dist)
 *   /fixtures/*       workspace fixture files the page's fake FSA seeds from
 *   /health           readiness probe for Playwright's webServer
 *
 * `exo.json` is generated per run so EXO_MANIFEST_URL selects whether the
 * shell under test loads the local build or the deployed plugin.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(repoRoot, 'plugin', 'dist')
const assetsDir = join(repoRoot, 'plugin', 'test-assets')
const port = Number(process.env.E2E_PORT ?? 4173)
const manifestUrl =
  process.env.EXO_MANIFEST_URL ?? `http://localhost:${port}/exo-gltf/exo-manifest.json`

const FIXTURE_PATHS = [
  'box-textured/BoxTextured.gltf',
  'box-textured/BoxTextured0.bin',
  'box-textured/CesiumLogoFlat.png',
  'box-missing-texture/BoxTextured.gltf',
  'box-missing-texture/BoxTextured0.bin',
  'missing-buffer/scene.gltf',
  'box-draco/Box.gltf',
  'box-draco/Box.bin',
  'damaged-helmet/DamagedHelmet.glb',
  'large/oversized.glb',
]

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.bin': 'application/octet-stream',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
}

const oversizeCache = (() => {
  let cached = null
  return () => {
    if (!cached) {
      cached = Buffer.alloc(17 * 1024 * 1024)
      cached.write('glTF', 0, 'ascii')
    }
    return cached
  }
})()

function send(response, status, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'content-type': type,
    'access-control-allow-origin': '*',
    // Chromium's Private Network Access: a public HTTPS page fetching
    // http://localhost requires this opt-in from the local server.
    'access-control-allow-private-network': 'true',
    'cache-control': 'no-store',
  })
  response.end(body)
}

function safeJoin(root, requestPath) {
  const clean = normalize(requestPath).replace(/^([/\\])+/, '')
  const target = join(root, clean)
  return target === root || target.startsWith(root + sep) ? target : null
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`)
  const path = decodeURIComponent(url.pathname)

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': '*',
      'access-control-allow-private-network': 'true',
      'access-control-max-age': '600',
    })
    response.end()
    return
  }

  if (path === '/health') return send(response, 200, 'ok')

  if (path === '/fixtures/index.json') {
    return send(
      response,
      200,
      JSON.stringify({ paths: ['exo.json', ...FIXTURE_PATHS] }),
      'application/json; charset=utf-8',
    )
  }

  if (path === '/fixtures/files/exo.json') {
    const exoJson = { schemaVersion: 1, plugins: [{ manifest: manifestUrl, enabled: true }] }
    return send(response, 200, JSON.stringify(exoJson), 'application/json; charset=utf-8')
  }

  if (path === '/fixtures/files/large/oversized.glb') {
    return send(response, 200, oversizeCache(), 'model/gltf-binary')
  }

  if (path.startsWith('/fixtures/files/')) {
    const file = safeJoin(assetsDir, path.slice('/fixtures/files/'.length))
    if (!file) return send(response, 403, 'forbidden')
    try {
      const body = readFileSync(file)
      return send(response, 200, body, MIME[extname(file)] ?? 'application/octet-stream')
    } catch {
      return send(response, 404, 'not found')
    }
  }

  if (path.startsWith('/exo-gltf/')) {
    const file = safeJoin(distDir, path.slice('/exo-gltf/'.length))
    if (!file) return send(response, 403, 'forbidden')
    try {
      const body = readFileSync(file)
      return send(response, 200, body, MIME[extname(file)] ?? 'application/octet-stream')
    } catch {
      return send(response, 404, 'not found')
    }
  }

  return send(response, 404, 'not found')
})

server.listen(port, () => {
  console.log(`[e2e] fixtures on http://localhost:${port} (manifest: ${manifestUrl})`)
})
