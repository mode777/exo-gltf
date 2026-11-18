import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type FrameLocator, type Page } from '@playwright/test'

/**
 * End-to-end verification of the glTF preview against the real Exo shell.
 *
 * The shell runs on GitHub Pages; the plugin under test is either the local
 * production build served from localhost (default) or the deployed Pages
 * build (EXO_MANIFEST_URL overrides the manifest). The workspace is a fake
 * File System Access handle seeded from the fixture server, so the folder
 * picker flow is exercised for real without interactive dialogs.
 */

declare global {
  interface Window {
    __EXO_E2E__: {
      reads: Record<string, number>
      writes: Record<string, number>
      hash(path: string): Promise<string>
      size(path: string): number
      touch(path: string): void
      remove(path: string): void
    }
  }
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const fixtureBase = process.env.E2E_FIXTURE_BASE ?? 'http://localhost:4173/fixtures'
const fakeFsaSource = readFileSync(join(repoRoot, 'e2e', 'fake-fsa.js'), 'utf8')
const iframeSelector = 'iframe[title="glTF editor"]'

const deployed = process.env.EXO_EXPECT_DEPLOYED === '1'

/** Fails fast unless the deployed artifact is the build from this checkout. */
async function waitForDeployedBuild(): Promise<void> {
  const manifestUrl = process.env.EXO_MANIFEST_URL
  if (!manifestUrl) throw new Error('EXO_EXPECT_DEPLOYED requires EXO_MANIFEST_URL')
  const editorHtml = readFileSync(join(repoRoot, 'plugin', 'dist', 'editor.html'), 'utf8')
  const match = editorHtml.match(/assets\/editor-[^"]+\.js/)
  if (!match) throw new Error('Local plugin/dist/editor.html has no hashed editor asset.')
  const expected = match[0]
  const pluginBase = manifestUrl.replace(/\/exo-manifest\.json$/, '')
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${pluginBase}/editor.html`, { cache: 'no-store' })
      if (response.ok && (await response.text()).includes(expected)) return
    } catch {
      // Pages may still be propagating the new deployment; retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  throw new Error(`Deployed plugin never served this build (${expected}).`)
}

if (deployed) {
  test.beforeAll(waitForDeployedBuild)
}

async function gotoShell(page: Page): Promise<void> {
  // The shell deploys independently and briefly serves GitHub's 404 while a
  // deployment propagates; retry instead of failing the whole suite.
  let lastStatus = 0
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' }).catch(() => null)
    lastStatus = response?.status() ?? 0
    const missing = await page
      .evaluate(() => document.body.textContent?.includes("There isn't a GitHub Pages site here") ?? true)
      .catch(() => true)
    if (!missing) return
    await page.waitForTimeout(10_000)
  }
  throw new Error(`Exo shell did not become available (last navigation status ${lastStatus}).`)
}

async function bootstrap(page: Page, fixturePaths: string[]): Promise<void> {
  const config = {
    base: fixtureBase,
    name: 'e2e-workspace',
    paths: ['exo.json', ...fixturePaths],
  }
  await page.addInitScript({ content: fakeFsaSource })
  await page.addInitScript({ content: `window.__EXO_E2E_CONFIG__ = ${JSON.stringify(config)};` })
  await gotoShell(page)

  await page.getByRole('button', { name: 'Open Folder…' }).click()

  // The workspace exo.json names the plugin manifest; consent gates its load.
  const consentTitle = page.locator('#exo-consent-title')
  await expect(consentTitle).toBeVisible({ timeout: 60_000 })
  await expect(consentTitle).toContainText('glTF Viewer')
  await expect(page.getByText('**/*.{gltf,glb}')).toBeVisible()
  await page.getByRole('button', { name: 'Allow plugin' }).click()

  await expect(page.getByText('e2e-workspace · folder')).toBeVisible({ timeout: 30_000 })
}

function treeRow(page: Page, name: string) {
  return page
    .locator('[role="treeitem"]')
    .filter({ has: page.locator('.exo-tree-name', { hasText: new RegExp(`^${escapeRegExp(name)}$`) }) })
    .first()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function openFile(page: Page, path: string): Promise<FrameLocator> {
  const segments = path.split('/')
  for (const directory of segments.slice(0, -1)) {
    const row = treeRow(page, directory)
    await row.dblclick()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
  }
  await treeRow(page, segments[segments.length - 1]).dblclick()
  return page.frameLocator(iframeSelector)
}

async function openFixture(page: Page, path: string): Promise<FrameLocator> {
  const frame = await openFile(page, path)
  await expect(frame.locator('.chrome-phase')).toHaveText('ready', { timeout: 60_000 })
  return frame
}

test('external references, pass-through save, external change, delete and disposal', async ({
  page,
}) => {
  const documentPath = 'box-textured/BoxTextured.gltf'
  await bootstrap(page, [
    'box-textured/BoxTextured.gltf',
    'box-textured/BoxTextured0.bin',
    'box-textured/CesiumLogoFlat.png',
  ])
  const frame = await openFixture(page, documentPath)

  // The visible-frame editor actually rendered.
  await expect(frame.locator('canvas')).toBeVisible()
  await expect(frame.locator('.notice-error')).toHaveCount(0)

  // Exactly one read on open (no optimistic pre-reads).
  expect(await page.evaluate((p) => window.__EXO_E2E__.reads[p], `/${documentPath}`)).toBe(1)

  // Shell Save round-trips the exact bytes and never marks the tab dirty.
  const before = await page.evaluate((p) => window.__EXO_E2E__.hash(p), `/${documentPath}`)
  await page.locator('.tab-title').first().click()
  await page.keyboard.press('Control+S')
  await page.waitForFunction(
    (p) => (window.__EXO_E2E__.writes[p] ?? 0) > 0,
    `/${documentPath}`,
    { timeout: 20_000 },
  )
  const after = await page.evaluate((p) => window.__EXO_E2E__.hash(p), `/${documentPath}`)
  expect(after).toBe(before)
  await expect(page.locator('.tab-close.is-dirty')).toHaveCount(0)

  // External edit: focus polling notices a version change and the preview reloads.
  const readsBefore = await page.evaluate((p) => window.__EXO_E2E__.reads[p], `/${documentPath}`)
  await page.evaluate((p) => {
    window.__EXO_E2E__.touch(p)
    window.dispatchEvent(new Event('focus'))
  }, `/${documentPath}`)
  await page.waitForFunction(
    ({ p, previous }) => (window.__EXO_E2E__.reads[p] ?? 0) > previous,
    { p: `/${documentPath}`, previous: readsBefore },
    { timeout: 20_000 },
  )
  await expect(frame.locator('.chrome-phase')).toHaveText('ready')

  // External delete: an explicit notice, no retry loop.
  await page.evaluate((p) => {
    window.__EXO_E2E__.remove(p)
    window.dispatchEvent(new Event('focus'))
  }, `/${documentPath}`)
  await expect(frame.locator('.notice-error')).toContainText(
    'was deleted from the workspace',
  )

  // Closing the tab disposes the handler frame.
  await page.locator('.tab-close').first().click()
  await expect(page.locator(iframeSelector)).toHaveCount(0, { timeout: 15_000 })
})

test('self-contained GLB renders', async ({ page }) => {
  await bootstrap(page, ['damaged-helmet/DamagedHelmet.glb'])
  const frame = await openFixture(page, 'damaged-helmet/DamagedHelmet.glb')
  await expect(frame.locator('canvas')).toBeVisible()
  await expect(frame.locator('.notice-error')).toHaveCount(0)
})

test('Draco-compressed mesh renders with vendored decoders', async ({ page }) => {
  await bootstrap(page, ['box-draco/Box.gltf', 'box-draco/Box.bin'])
  const frame = await openFixture(page, 'box-draco/Box.gltf')
  await expect(frame.locator('canvas')).toBeVisible()
  await expect(frame.locator('.notice-error')).toHaveCount(0)
})

test('missing texture renders a placeholder and a named warning', async ({ page }) => {
  await bootstrap(page, [
    'box-missing-texture/BoxTextured.gltf',
    'box-missing-texture/BoxTextured0.bin',
  ])
  const frame = await openFixture(page, 'box-missing-texture/BoxTextured.gltf')
  await expect(frame.locator('canvas')).toBeVisible()
  await expect(frame.locator('.notice-warning')).toContainText('missing.png')
})

test('missing buffer blocks the scene with an explicit error', async ({ page }) => {
  await bootstrap(page, ['missing-buffer/scene.gltf'])
  const frame = await openFile(page, 'missing-buffer/scene.gltf')
  await expect(frame.locator('.notice-error')).toContainText('missing.bin', { timeout: 60_000 })
  await expect(frame.locator('canvas')).toHaveCount(0)
})

test('oversized file shows the too-large state', async ({ page }) => {
  await bootstrap(page, ['large/oversized.glb'])
  const frame = await openFile(page, 'large/oversized.glb')
  await expect(frame.locator('.notice-error')).toContainText('exceeds the editor size limit', {
    timeout: 60_000,
  })
  await expect(frame.locator('canvas')).toHaveCount(0)
})

test('theme follows the shell', async ({ page }) => {
  await bootstrap(page, [
    'box-textured/BoxTextured.gltf',
    'box-textured/BoxTextured0.bin',
    'box-textured/CesiumLogoFlat.png',
  ])
  const frame = await openFixture(page, 'box-textured/BoxTextured.gltf')
  await expect(frame.locator('canvas')).toBeVisible()

  await page.locator('button[aria-label="Settings"]').click()
  await expect(page.locator('#exo-settings-title')).toBeVisible()
  await page.locator('input[name="exo-theme"][value="light"]').check()
  await page.locator('[aria-label="Close settings"]').click()

  await expect(page.getByText('Theme: light')).toBeVisible()
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light')
})
