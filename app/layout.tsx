import type { Metadata, Viewport } from 'next';
import { Outfit, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-display',
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const viewport: Viewport = {
  themeColor: '#0F172A',
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'GlassChess Tactician',
  description:
    'Chess.com and Lichess strategy analyzer with Google Drive PGN archival, opening blunder heatmaps, tactical pattern detection, trend analytics, real-time AI coaching, and offline Elo bot practice.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'GlassChess',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'GlassChess Tactician',
    description:
      'Chess.com and Lichess strategy analyzer with Google Drive PGN archival, opening blunder heatmaps, tactical pattern detection, trend analytics, real-time AI coaching, and offline Elo bot practice.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GlassChess Tactician',
    description:
      'Chess.com and Lichess strategy analyzer with Google Drive PGN archival, opening blunder heatmaps, tactical pattern detection, trend analytics, real-time AI coaching, and offline Elo bot practice.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} dark`}
      suppressHydrationWarning
    >
      <body
        className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100 font-sans selection:bg-sky-500 selection:text-white transition-colors duration-150"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
