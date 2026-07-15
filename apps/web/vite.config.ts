import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'CarLog',
        short_name: 'CarLog',
        description: 'Your vehicle maintenance log',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#1565c0',
        background_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        // Activate a new SW immediately and take control of open pages, so a deploy never
        // leaves a client on a stale cached index.html pointing at a deleted bundle (which
        // renders as a white screen until every tab is closed). `cleanupOutdatedCaches`
        // removes precaches from prior SW versions.
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        // No runtimeCaching: API (execute-api) and Cognito always hit the network.
      },
      devOptions: { enabled: false },
    }),
  ],
});
