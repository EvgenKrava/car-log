import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { rekeyIndexHtml } from './src/lib/rename-index';

// The marketing site owns `/index.html`; the SPA shell ships as `/app.html` (CloudFront's
// 403/404 fallback). Runs in generateBundle so VitePWA — which globs dist/ in closeBundle —
// precaches app.html, not a file that no longer exists.
const renameIndexToApp = (): Plugin => ({
  name: 'carlog-rename-index-to-app',
  apply: 'build',
  // Vite's own html plugin emits `index.html` into the bundle from its generateBundle
  // hook; enforce: 'post' guarantees ours runs after it, so the key actually exists to
  // rename by the time this fires.
  enforce: 'post',
  generateBundle(_options, bundle) { rekeyIndexHtml(bundle); },
});

export default defineConfig({
  build: {
    // The AudioWorklet processor (`pcm-capture-worklet.js?url`) is ~1.5KB, so the default
    // 4KB inline limit would turn it into a `data:text/javascript,...` URL. It MUST stay a
    // real same-origin file: `audioWorklet.addModule()` support for data:/blob: URLs is
    // undocumented on Safari, and iOS is the only platform that path exists for — trading a
    // verified fetch for an unverified one would reintroduce the bug it fixes. Everything
    // else keeps the default behaviour.
    assetsInlineLimit: (filePath) => (filePath.includes('pcm-capture-worklet') ? false : undefined),
    rollupOptions: {
      output: {
        // Vendor code changes far less often than app code. Keeping the big libraries in
        // their own chunks gives them stable hashes across deploys, so the service worker
        // only re-downloads what actually changed.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](@mui|@emotion|@popperjs)[\\/]/.test(id)) return 'mui';
          if (/[\\/](aws-amplify|@aws-amplify|@aws-sdk|@aws-crypto|@smithy)[\\/]/.test(id)) return 'amplify';
          if (/[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run)[\\/]/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  plugins: [
    react(),
    renameIndexToApp(),
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
        start_url: '/garage',
        scope: '/',
        display: 'standalone',
        theme_color: '#5B5BD6',
        background_color: '#F2F2F7',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // heic2any (1.35 MB) is a dynamic import used only for HEIC scans — fetch on
        // demand, never precache it on install.
        globIgnores: ['**/heic2any-*.js'],
      },
      devOptions: { enabled: false },
    }),
  ],
});
