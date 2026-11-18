import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { fixtureBase, installFixtureRoutes } from '../fixture-router'

/**
 * End-to-end verification of the glTF preview against the real Exo shell.
 *
 * The shell runs on GitHub Pages; the plugin under test is either the local
 * production build (default) or the deployed Pages build (EXO_MANIFEST_URL).
 * Plugin files and workspace fixtures are served through request
 * interception at a fake https origin, so the folder-picker flow is
 * exercised for real without interactive dialogs or local ports.
 */

declare global {
  interface Window {
    __EXO_E2E__: {
      reads: Record<string, number>
      writes: Record<string, number>
      hash(path: string): Promise<string>
      size(path: string): number
      touch(path: string): void
      write(path: string, content: string): void
      remove(path: string): void
      lastError?: string
    }
  }
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const fakeFsaSource = readFileSync(join(repoRoot, 'e2e', 'fake-fsa.js'), 'utf8')
const iframeSelector = 'iframe[title="glTF editor"]'

const deployed = process.env.EXO_EXPECT_DEPLOYED === '1'

/** Fails fast unless the deployed artifact is fully served for this checkout. */
async function waitForDeployedBuild(): Promise<void> {
  const manifestUrl = process.env.EXO_MANIFEST_URL
  if (!manifestUrl) throw new Error('EXO_EXPECT_DEPLOYED requires EXO_MANIFEST_URL')
  const pluginBase = manifestUrl.replace(/\/exo-manifest\.json$/, '')

  const expectedAssets = ['plugin.html', 'editor.html'].map((page) => {
    const html = readFileSync(join(repoRoot, 'plugin', 'dist', page), 'utf8')
    const match = html.match(/assets\/[a-z]+-[^"]+\.js/)
    if (!match) throw new Error(`Local plugin/dist/${page} has no hashed script asset.`)
    return { page, asset: match[0] }
  })

  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    try {
      const pages = await Promise.all(
        expectedAssets.map(async ({ page, asset }) => {
          const response = await fetch(`${pluginBase}/${page}`, { cache: 'no-store' })
          if (!response.ok) return false
          return (await response.text()).includes(asset)
        }),
      )
      if (pages.every(Boolean)) {
        const assets = await Promise.all(
          expectedAssets.map(({ asset }) => fetch(`${pluginBase}/${asset}`, { cache: 'no-store' })),
        )
        if (assets.every((response) => response.ok)) return
      }
    } catch {
      // Pages may still be propagating the new deployment; retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  throw new Error('Deployed plugin never served this build for plugin.html and editor.html.')
}

if (deployed) {
  test.beforeAll(waitForDeployedBuild)
}

async function gotoShell(page: Page): Promise<void> {
  // The shell deploys independently and briefly serves GitHub's 404 while a
  // deployment propagates; retry instead of failing the whole suite.
  let lastStatus = 0
  for (let attempt = 0; attempt < 8; attempt += 1) {
    // './' resolves against baseURL's path (`/exo-editor/`), unlike '/'.
    const response = await page.goto('./', { waitUntil: 'domcontentloaded' }).catch(() => null)
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
  await installFixtureRoutes(page)
  await page.addInitScript({ content: fakeFsaSource })
  await page.addInitScript({ content: `window.__EXO_E2E_CONFIG__ = ${JSON.stringify(config)};` })
  page.on('console', (message) => {
    if (message.text().includes('EXO_E2E')) console.log('[e2e console]', message.text())
  })
  page.on('requestfailed', (request) => {
    if (request.url().includes('exo-gltf-e2e.test')) {
      console.log('[e2e requestfailed]', request.url(), request.failure()?.errorText)
    }
  })
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
    if ((await row.getAttribute('aria-expanded')) !== 'true') {
      await row.dblclick()
    }
    await expect(row).toHaveAttribute('aria-expanded', 'true')
  }
  await treeRow(page, segments[segments.length - 1]).dblclick()
  return page.frameLocator(iframeSelector)
}

async function openFixture(page: Page, path: string): Promise<FrameLocator> {
  const frame = page.frameLocator(iframeSelector)
  // Registration is asynchronous: opening a matching file before the plugin
  // is ready yields the shell's text fallback, which never auto-switches.
  // Reopen like a user would until the plugin editor mounts.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await openFile(page, path)
    const mounted = await frame
      .locator('.app[data-phase]')
      .waitFor({ state: 'attached', timeout: attempt === 0 ? 15_000 : 30_000 })
      .then(() => true)
      .catch(() => false)
    if (mounted) {
      await expect(frame.locator('.app')).toHaveAttribute('data-phase', 'ready', {
        timeout: 60_000,
      })
      return frame
    }
    await page.locator('.tab-close').first().click({ timeout: 5_000 }).catch(() => undefined)
    await page.waitForTimeout(1_500)
  }
  throw new Error(`The plugin editor never mounted for ${path}.`)
}

function explorerGroup(frame: FrameLocator, id: string) {
  return frame.locator(`li[role="treeitem"][data-group="${id}"]`)
}

function explorerEntry(frame: FrameLocator, id: string) {
  return frame.locator(`li[role="treeitem"][data-entry-id="${id}"]`)
}

async function expectGroupCount(frame: FrameLocator, id: string, count: number): Promise<void> {
  await expect(explorerGroup(frame, id).locator('.tree-count')).toHaveText(String(count))
}

async function expandGroup(frame: FrameLocator, id: string): Promise<void> {
  const group = explorerGroup(frame, id)
  if ((await group.getAttribute('aria-expanded')) !== 'true') {
    await group.locator('.tree-group-row').click()
  }
  await expect(group).toHaveAttribute('aria-expanded', 'true')
}

function inspectorValue(frame: FrameLocator, label: string) {
  return frame.locator(`.inspector-row:has(dt:text-is("${label}")) dd`)
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

  // The shell and the plugin both touch the file while opening it; what
  // matters for the spec is that no idle polling keeps re-reading it.
  const readsAfterOpen = await page.evaluate((p) => window.__EXO_E2E__.reads[p], `/${documentPath}`)
  expect(readsAfterOpen).toBeGreaterThan(0)
  await page.waitForTimeout(1_500)
  expect(await page.evaluate((p) => window.__EXO_E2E__.reads[p], `/${documentPath}`)).toBe(
    readsAfterOpen,
  )

  await test.step('structure explorer and inspector', async () => {
    await expect(frame.getByRole('tree', { name: 'Document structure' })).toBeVisible()
    await expectGroupCount(frame, 'scenes', 1)
    await expectGroupCount(frame, 'nodes', 2)
    await expectGroupCount(frame, 'meshes', 1)
    await expectGroupCount(frame, 'materials', 1)
    await expectGroupCount(frame, 'textures', 1)
    await expectGroupCount(frame, 'resources', 2)

    // Groups are collapsed until the user expands them.
    await expect(frame.locator('[data-entry-id^="nodes:"]')).toHaveCount(0)
    await expandGroup(frame, 'nodes')
    await expect(frame.locator('[data-entry-id^="nodes:"]')).toHaveCount(2)

    await explorerEntry(frame, 'nodes:1').locator('.tree-row').click()
    await expect(explorerEntry(frame, 'nodes:1')).toHaveAttribute('aria-selected', 'true')
    await expect(inspectorValue(frame, 'Kind')).toHaveText('node')
    await expect(inspectorValue(frame, 'Name')).toHaveText('Node 1')
    await expect(inspectorValue(frame, 'Children')).toHaveText('0')
    await expect(inspectorValue(frame, 'Mesh')).toHaveText('#0 Mesh')
    await expect(frame.locator('canvas')).toBeVisible()
    await expect(frame.locator('.notice-error')).toHaveCount(0)
  })

  // Shell Save round-trips the exact bytes and never marks the tab dirty.
  await test.step('save round-trip', async () => {
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
  })

  await test.step('external change rebuilds the explorer', async () => {
    const readsBefore = await page.evaluate((p) => window.__EXO_E2E__.reads[p], `/${documentPath}`)
    const source = readFileSync(join(repoRoot, 'plugin', 'test-assets', documentPath), 'utf8')
    const json = JSON.parse(source) as { nodes: Array<Record<string, unknown>> }
    json.nodes.push({ name: 'Injected Node' })

    await page.evaluate(
      ({ p, content }) => {
        window.__EXO_E2E__.write(p, content)
        window.dispatchEvent(new Event('focus'))
      },
      { p: `/${documentPath}`, content: JSON.stringify(json) },
    )
    await page.waitForFunction(
      ({ p, previous }) => (window.__EXO_E2E__.reads[p] ?? 0) > previous,
      { p: `/${documentPath}`, previous: readsBefore },
      { timeout: 20_000 },
    )
    await expect(frame.locator('.app')).toHaveAttribute('data-phase', 'ready')

    // The new structure is shown, expansion reset, and the old selection gone.
    await expectGroupCount(frame, 'nodes', 3)
    await expect(explorerGroup(frame, 'nodes')).toHaveAttribute('aria-expanded', 'false')
    await expect(frame.locator('.inspector-body')).toHaveCount(0)
    await expect(frame.locator('.inspector')).toContainText('Select an entry')
  })

  await test.step('tab close disposes the handler', async () => {
    await page.locator('.tab-close').first().click()
    await expect(page.locator(iframeSelector)).toHaveCount(0, { timeout: 15_000 })
  })

  await test.step('reopening builds a fresh explorer', async () => {
    await openFixture(page, documentPath)
    await expect(frame.locator('canvas')).toBeVisible()
    await expectGroupCount(frame, 'nodes', 3)
    await expect(explorerGroup(frame, 'nodes')).toHaveAttribute('aria-expanded', 'false')
    await expect(frame.locator('.inspector-body')).toHaveCount(0)
  })

  await test.step('external delete notice', async () => {
    await page.evaluate((p) => {
      window.__EXO_E2E__.remove(p)
      window.dispatchEvent(new Event('focus'))
    }, `/${documentPath}`)
    await expect(frame.locator('.notice-error')).toContainText('was deleted from the workspace')
  })

  await test.step('final disposal', async () => {
    await page.locator('.tab-close').first().click()
    await expect(page.locator(iframeSelector)).toHaveCount(0, { timeout: 15_000 })
  })
})

test('texture selection shows the external URI and status', async ({ page }) => {
  await bootstrap(page, [
    'box-textured/BoxTextured.gltf',
    'box-textured/BoxTextured0.bin',
    'box-textured/CesiumLogoFlat.png',
  ])
  const frame = await openFixture(page, 'box-textured/BoxTextured.gltf')

  await expandGroup(frame, 'textures')
  await explorerEntry(frame, 'textures:0').locator('.tree-row').click()
  await expect(explorerEntry(frame, 'textures:0')).toHaveAttribute('aria-selected', 'true')
  await expect(inspectorValue(frame, 'Kind')).toHaveText('texture')
  await expect(inspectorValue(frame, 'URI')).toHaveText('CesiumLogoFlat.png')
  await expect(inspectorValue(frame, 'Status')).toHaveText('resolved')
  await expect(frame.locator('.status-resolved')).toBeVisible()
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

test('KTX2-textured mesh renders with vendored transcoders', async ({ page }) => {
  await bootstrap(page, [
    'chronograph-watch/ChronographWatch.gltf',
    'chronograph-watch/ChronographWatch.data.bin',
    'chronograph-watch/band_occlusion.ktx2',
    'chronograph-watch/carbonfiber_normal.ktx2',
    'chronograph-watch/dgg_basecolor.ktx2',
    'chronograph-watch/dgg_rm.ktx2',
    'chronograph-watch/khronos_basecolor.ktx2',
    'chronograph-watch/khronos_rm.ktx2',
    'chronograph-watch/watchface_basecolor.ktx2',
    'chronograph-watch/watchface_orm.ktx2',
  ])
  const frame = await openFixture(page, 'chronograph-watch/ChronographWatch.gltf')
  await expect(frame.locator('canvas')).toBeVisible()
  await expect(frame.locator('.notice-error')).toHaveCount(0)
})

test('missing texture renders a placeholder and is flagged in the explorer', async ({ page }) => {
  await bootstrap(page, [
    'box-missing-texture/BoxTextured.gltf',
    'box-missing-texture/BoxTextured0.bin',
  ])
  const frame = await openFixture(page, 'box-missing-texture/BoxTextured.gltf')
  await expect(frame.locator('canvas')).toBeVisible()
  await expect(frame.locator('.notice-warning')).toContainText('missing.png')

  await expectGroupCount(frame, 'resources', 2)
  await expect(explorerGroup(frame, 'resources').locator('.badge-missing')).toHaveCount(1)
  await expandGroup(frame, 'resources')
  const missing = explorerEntry(frame, 'resources:1')
  await expect(missing.locator('.tree-name')).toHaveText('missing.png')
  await expect(missing.locator('.tree-detail')).toHaveText('image · missing')
  await expect(missing.locator('.badge-missing')).toBeVisible()
  await missing.locator('.tree-row').click()
  await expect(inspectorValue(frame, 'Kind')).toHaveText('resource')
  await expect(inspectorValue(frame, 'Resource')).toHaveText('image')
  await expect(inspectorValue(frame, 'URI')).toHaveText('missing.png')
  await expect(inspectorValue(frame, 'Status')).toHaveText('missing')
  await expect(frame.locator('.status-missing')).toBeVisible()
})

test('missing buffer blocks the scene while the structure stays browsable', async ({ page }) => {
  await bootstrap(page, ['missing-buffer/scene.gltf'])
  const frame = await openFile(page, 'missing-buffer/scene.gltf')
  await expect(frame.locator('.notice-error')).toContainText('missing.bin', { timeout: 60_000 })
  await expect(frame.locator('canvas')).toHaveCount(0)

  await expectGroupCount(frame, 'scenes', 1)
  await expectGroupCount(frame, 'resources', 1)
  await expandGroup(frame, 'resources')
  const missing = explorerEntry(frame, 'resources:0')
  await expect(missing.locator('.tree-name')).toHaveText('missing.bin')
  await expect(missing.locator('.badge-missing')).toBeVisible()
  await missing.locator('.tree-row').click()
  await expect(inspectorValue(frame, 'Status')).toHaveText('missing')
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
