import type { Metadata } from 'next'
import {
  Geist,
  Geist_Mono,
  Bricolage_Grotesque,
  Onest,
  IBM_Plex_Sans,
  Hanken_Grotesk,
  Public_Sans,
  JetBrains_Mono,
} from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-jarvis-sans',
  display: 'swap',
})
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-jarvis-mono',
  display: 'swap',
})
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-jarvis-display',
  display: 'swap',
  axes: ['opsz', 'wdth'],
})
// Selectable body faces (Settings → Display). Onest is the default.
const onest = Onest({ subsets: ['latin'], variable: '--font-onest', display: 'swap' })
const ibmPlex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex',
  display: 'swap',
})
const hanken = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-hanken', display: 'swap' })
const publicSans = Public_Sans({ subsets: ['latin'], variable: '--font-public-sans', display: 'swap' })
// Accent / instrument face — wordmark, dates, times, numerals (the `.num` class).
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' })

const FONT_VARS = [
  geistSans,
  geistMono,
  bricolage,
  onest,
  ibmPlex,
  hanken,
  publicSans,
  jetbrainsMono,
]
  .map((font) => font.variable)
  .join(' ')

// Restore the device's saved font choice before first paint to avoid a flash.
// Mirrors the data-font defaults on <html> so unconfigured devices stay on Onest.
const FONT_INIT_SCRIPT = `(function(){try{var d=document.documentElement;d.setAttribute('data-font',localStorage.getItem('jarvis-font')||'onest');d.setAttribute('data-font-weight',localStorage.getItem('jarvis-font-weight')||'medium');}catch(e){}})();`

export const metadata: Metadata = {
  title: 'JARVIS',
  description: 'Secretary scheduler',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      data-font="onest"
      data-font-weight="medium"
      suppressHydrationWarning
      className={`dark ${FONT_VARS}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: FONT_INIT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased bg-background text-foreground">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
