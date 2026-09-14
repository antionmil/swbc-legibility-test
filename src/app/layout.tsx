import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Bricolage_Grotesque, Figtree, Martian_Mono } from "next/font/google";
import "./globals.css";

/* Bricolage Grotesque, Figtree and Martian Mono: none of them appears on
   days 6 to 11, and this is a cool grey page after a dark one and a paper one. */
const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "700", "800"], variable: "--font-display-loaded", display: "swap" });
const body = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body-loaded", display: "swap" });
const mono = Martian_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono-loaded", display: "swap" });

const SITE = "https://legibilitytest.onedaybuilt.com";
const TITLE = "Do three AIs agree on what you sell?";
const DESC =
  "Paste your landing page. GPT, Gemini and Claude each say in one sentence what you sell and who it is for. If they disagree, your copy is unclear.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Legibility test", template: "%s · Legibility test" },
  description: DESC,
  openGraph: { title: TITLE, description: DESC, url: SITE, siteName: "Legibility test", type: "website", images: [{ url: "/api/og", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
