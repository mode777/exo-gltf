/**
 * Serves the plugin build and workspace fixtures through Playwright request
 * interception at a fake https origin.
 *
 * Why not a localhost server: current Chromium enforces Local Network Access
 * (formerly Private Network Access) for public pages fetching private/local
 * addresses, and the deployed shell is a public page. A routed https origin
 * avoids the permission gate entirely, needs no port, and lets the browser
 * treat the plugin as a normal cross-origin site (sandbox `allow-same-origin`,
 * real storage, blob URLs), which is exactly the production shape.
 */
import { readFileSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

export const FAKE_ORIGIN = 'https://exo-gltf-e2e.test'
export const fakeManifestUrl = `${FAKE_ORIGIN}/exo-gltf/exo-manifest.json`
export const fixtureBase = `${FAKE_ORIGIN}/fixtures`

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(repoRoot, 'plugin', 'dist')
const assetsDir = join(repoRoot, 'plugin', 'test-assets')

const MIME: Record<string, string> = {
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

let oversize: Buffer | null = null

function safeJoin(root: string, requestPath: string): string | null {
  const clean = normalize(requestPath).replace(/^([/\\])+/, '')
  const target = join(root, clean)
  return target === root || target.startsWith(root + sep) ? target : null
}

export async function installFixtureRoutes(page: Page): Promise<void> {
  await page.route(`${FAKE_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url())
    const path = decodeURIComponent(url.pathname)
    const headers = {
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    }

    if (path === '/fixtures/files/exo.json') {
      const manifest = process.env.EXO_MANIFEST_URL ?? fakeManifestUrl
      await route.fulfill({
        status: 200,
        headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ schemaVersion: 1, plugins: [{ manifest, enabled: true }] }),
      })
      return
    }

    if (path === '/fixtures/files/large/oversized.glb') {
      if (!oversize) {
        oversize = Buffer.alloc(17 * 1024 * 1024)
        oversize.write('glTF', 0, 'ascii')
      }
      await route.fulfill({
        status: 200,
        headers: { ...headers, 'content-type': 'model/gltf-binary' },
        body: oversize,
      })
      return
    }

    const source = path.startsWith('/fixtures/files/')
      ? safeJoin(assetsDir, path.slice('/fixtures/files/'.length))
      : path.startsWith('/exo-gltf/')
        ? safeJoin(distDir, path.slice('/exo-gltf/'.length))
        : null
    if (!source) {
      await route.fulfill({ status: 404, body: 'not found' })
      return
    }
    try {
      const body = readFileSync(source)
      await route.fulfill({
        status: 200,
        headers: {
          ...headers,
          'content-type': MIME[extname(source)] ?? 'application/octet-stream',
        },
        body,
      })
    } catch {
      await route.fulfill({ status: 404, body: 'not found' })
    }
  })
}
