import { defineConfig } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 4173)

/**
 * End-to-end verification against the deployed Exo shell. The plugin under
 * test is either the local production build (served by fixtures-server.mjs at
 * /exo-gltf/) or the deployed Pages build, selected via EXO_MANIFEST_URL.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.EXO_SHELL_URL ?? 'https://mode777.github.io/exo-editor/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
    },
  },
  webServer: {
    command: 'node fixtures-server.mjs',
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    env: {
      E2E_PORT: String(PORT),
      EXO_MANIFEST_URL:
        process.env.EXO_MANIFEST_URL ?? `http://localhost:${PORT}/exo-gltf/exo-manifest.json`,
    },
  },
})
