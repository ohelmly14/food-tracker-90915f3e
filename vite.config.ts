import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
const base = process.env.BASE_PATH || '/';
export default defineConfig({
  base,
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon-v2.png', 'apple-touch-icon-v2.png'],
    manifest: { name: 'Food Tracker', short_name: 'Food', description: 'Local-only food tracker', theme_color: '#2f7d4f', background_color: '#f6f7f4', display: 'standalone', start_url: base, scope: base,
      icons: [{ src: 'icon-192-v2.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512-v2.png', sizes: '512x512', type: 'image/png' }, { src: 'icon-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] },
    workbox: { globPatterns: ['**/*.{js,css,html,svg,png,json}'], navigateFallback: base + 'index.html', maximumFileSizeToCacheInBytes: 4_000_000 },
  })],
  test: { environment: 'node' },
} as any);
