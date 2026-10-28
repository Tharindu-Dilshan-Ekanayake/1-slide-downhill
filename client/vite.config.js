import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

import { LOCAL_ENV, PROD_ENV } from './src/bloxity/env.js'

/**
 * Dev server only: tells the SDK which Boxity environment this standalone page is in,
 * as Boxity itself does for the pages it serves. Never part of a production build -
 * there the platform tells the game.
 *
 * `BLOXITY_DEV_ENV=local` (the default) is a Boxity platform running on this machine;
 * `BLOXITY_DEV_ENV=prod` logs in against the real bloxity.io instead.
 */
function bloxityDevEnv() {
  const env = process.env.BLOXITY_DEV_ENV === 'prod' ? PROD_ENV : LOCAL_ENV
  return {
    name: 'bloxity-dev-env',
    apply: 'serve',
    transformIndexHtml: () => [{ tag: 'script', children: `window.BLOXITY_ENV = ${JSON.stringify(env)};`, injectTo: 'head-prepend' }],
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), bloxityDevEnv()],
  resolve: {
    alias: {
      // Game rules and world layout, shared with the server.
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    // ../shared lives outside the client root.
    fs: { allow: ['..'] },
  },
  optimizeDeps: {
    // Dev-only perf overlay, imported lazily; pre-bundle it so the first ?perf load
    // doesn't hit a mid-session dependency re-optimisation.
    include: ['r3f-perf'],
  },
})
