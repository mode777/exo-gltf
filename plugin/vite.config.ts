import { defineConfig } from 'vitest/config'

// GitHub Pages serves the built plugin from the exo-gltf project path.
// Development keeps the root base so the second-origin server is simple.
export default defineConfig(({ command }) => ({
  base:
    process.env.EXO_PLUGIN_BASE_PATH ?? (command === 'build' ? '/exo-gltf/' : '/'),
  server: {
    port: 5175,
    strictPort: true,
    cors: true,
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: ['plugin.html', 'editor.html'],
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
}))
