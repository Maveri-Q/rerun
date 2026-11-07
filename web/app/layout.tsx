import type { Metadata } from "next";
import { Funnel_Display, Funnel_Sans, Geist_Mono, Space_Grotesk } from "next/font/google";
import { BigFoot } from "@/components/BigFoot";
import { Providers } from "@/components/Providers";
import { Topbar } from "@/components/Topbar";
import { BRAND } from "@rerun/shared/browser";
import { pageMeta } from "@/lib/meta";
import "./globals.css";

const display = Funnel_Display({ subsets: ["latin"], variable: "--font-funnel-display", display: "swap" });
const sans = Funnel_Sans({ subsets: ["latin"], variable: "--font-funnel-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const wordmark = Space_Grotesk({ subsets: ["latin"], weight: "700", variable: "--font-wordmark", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.siteUrl),
  ...pageMeta(`${BRAND.name}: ${BRAND.question}`, BRAND.description, "/"),
  applicationName: BRAND.name,
  icons: {
    icon: [
      { url: BRAND.files.favicon, type: "image/svg+xml" },
      { url: BRAND.files.png16, sizes: "16x16", type: "image/png" },
      { url: BRAND.files.png32, sizes: "32x32", type: "image/png" },
      { url: BRAND.files.png512, sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: BRAND.files.appleTouch, sizes: "180x180" }],
  },
};

/** The brand's colours come from the config, so a change there is a change everywhere. */
const BRAND_COLORS = `html:root{--black:${BRAND.colors.ink};--paper:${BRAND.colors.paper};--mint:${BRAND.colors.mint}}`;
/** Animations start hidden and need JavaScript to appear, so without it everything just shows. */
const NO_SCRIPT_STYLE = '[style*="opacity:0"]{opacity:1!important;transform:none!important}';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} ${wordmark.variable}`}>
      <body>
        <style dangerouslySetInnerHTML={{ __html: BRAND_COLORS }} />
        <noscript>
          <style dangerouslySetInnerHTML={{ __html: NO_SCRIPT_STYLE }} />
          <p className="noscript-note">You can read every claim and verdict here without JavaScript. Connecting a wallet and making a forecast need it.</p>
        </noscript>
        <Providers>
          <div className="shell">
            <Topbar />
            <main>{children}</main>
          </div>
          <BigFoot />
        </Providers>
      </body>
    </html>
  );
}
