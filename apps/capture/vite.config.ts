import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'mark.png'],
      manifest: {
        name: 'Glazion Capture',
        short_name: 'Capture',
        description: 'Photograph and upload glaze test tiles for the Glazion library.',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#ffffff',
        // White, like the app's first screen, so an installed launch doesn't flash navy then white.
        background_color: '#ffffff',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,png,woff2}'],
      },
    }),
  ],
  server: {
    port: 3001,
  },
});
