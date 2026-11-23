import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, Spline_Sans_Mono } from 'next/font/google';
import './globals.css';

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-instrument-sans',
  display: 'swap',
});

const splineSansMono = Spline_Sans_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-spline-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://apm.iqbalfa.my.id'),
  title: 'SENTINEL: AIOps Monitoring & Auto-Incident Platform',
  description:
    'Autonomous service dependency observability, cascading fault injection, 120-second time-travel replay, and automated Dynatrace-to-BMC Helix P1 incident orchestration.',
  openGraph: {
    url: 'https://apm.iqbalfa.my.id/',
    title: 'SENTINEL: AIOps Monitoring & Auto-Incident Platform',
    description:
      'Autonomous service dependency observability, cascading fault injection, 120-second time-travel replay, and automated Dynatrace-to-BMC Helix P1 incident orchestration.',
    type: 'website',
    siteName: 'SENTINEL',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SENTINEL: AIOps Monitoring & Auto-Incident Platform',
    description:
      'Autonomous service dependency observability, cascading fault injection, 120-second time-travel replay, and automated Dynatrace-to-BMC Helix P1 incident orchestration.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#06080D',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${instrumentSans.variable} ${splineSansMono.variable} dark`}>
      <body className="bg-[var(--bg-ground)] text-[var(--text-primary)] antialiased selection:bg-[var(--telemetry-tint)] selection:text-[var(--telemetry-bright)]">
        {children}
      </body>
    </html>
  );
}
