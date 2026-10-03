import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site at /<repo-name>/.
const base = process.env.GITHUB_ACTIONS ? '/starfall/' : '/';

export default defineConfig({
  base,
  build: {
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    VitePWA({
      // The game asks before switching versions, so an update never lands mid-fight.
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Starfall',
        short_name: 'Starfall',
        description: 'A single-player isometric action RPG that runs in your browser.',
        theme_color: '#2f5d3a',
        background_color: '#2f5d3a',
        display: 'fullscreen',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Phaser alone is ~1.3 MB, above Workbox's 2 MB default only once maps and audio land.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,png,svg,webp,json,ogg,opus,woff2}'],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
