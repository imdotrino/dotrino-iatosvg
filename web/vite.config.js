import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import prerender from '@dotrino/prerender/vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Hash del commit del build → <meta name="commit"> (CONVENCIONES §3).
let commit = 'dev'
try { commit = execSync('git rev-parse --short HEAD').toString().trim() } catch { /* sin git */ }
const commitMeta = {
  name: 'commit-meta',
  transformIndexHtml: html => html.replace('</head>', `  <meta name="commit" content="${commit}" />\n  </head>`),
}

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // La librería vive en ../src (la misma que usa el CLI): Vite la sirve desde fuera de web/.
  server: { port: 3310, host: true, fs: { allow: ['..'] } },
  worker: { format: 'es' },
  plugins: [
    prerender(),
    commitMeta,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'og.jpg', 'robots.txt', 'sitemap.xml'],
      manifest: {
        name: 'iatosvg — Dotrino',
        short_name: 'iatosvg',
        description: 'Convierte archivos de Illustrator (.ai) a SVG en tu equipo, sin subirlos a ningún lado.',
        lang: 'es',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#120c04',
        theme_color: '#f59e0b',
        launch_handler: { client_mode: 'focus-existing' },
        // Abrir un .ai con la app instalada (Chrome/Edge de escritorio).
        file_handlers: [{ action: './', accept: { 'application/illustrator': ['.ai'], 'application/pdf': ['.ai'] } }],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
})
