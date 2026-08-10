import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Custom sw.ts (push + notificationclick handlers) replaces the generated worker.
      // injectManifest hands us the precache manifest via self.__WB_MANIFEST; everything
      // else the old generateSW config did (skipWaiting, clientsClaim, cleanupOutdatedCaches,
      // SPA nav fallback, no API caching) is replicated by hand in sw.ts.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'CarLog',
        short_name: 'CarLog',
        description: 'Your vehicle maintenance log',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#5B5BD6',
        background_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      devOptions: { enabled: false },
    }),
  ],
});
