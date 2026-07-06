import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Dompet Saya — Buku Kas Digital',
        short_name: 'Dompet Saya',
        description: 'Catat keuangan pribadi dengan grafik, anggaran, dan penasihat AI',
        theme_color: '#181820',
        background_color: '#14141c',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache semua asset statis (JS, CSS, HTML, font) — ini yang membuat app
        // masih bisa DIBUKA saat offline, walau data baru tidak bisa disinkronkan
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],

        // Cache Google Fonts supaya tetap tampil offline
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],

        // JANGAN cache request ke Supabase/Gemini — data harus selalu fresh,
        // dan request yang gagal saat offline ditangani manual di app
        // (lihat OfflineQueue di App.jsx) bukan lewat service worker cache.
        navigateFallbackDenylist: [/^\/rest\/v1\//, /generativelanguage/],
      },
      devOptions: {
        enabled: false, // PWA hanya aktif di build production, tidak di npm run dev
      },
    }),
  ],
})
