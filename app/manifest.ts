import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'GlassChess Tactician',
    short_name: 'GlassChess',
    description:
      'Chess.com and Lichess strategy analyzer with Google Drive PGN storage, opening blunder heatmaps, AI coaching, and offline Elo bot practice.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0B1120',
    theme_color: '#0F172A',
    icons: [
      {
        src: '/pwa-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-maskable-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
