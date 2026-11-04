import type { Metadata } from "next";
import { Funnel_Display, Funnel_Sans, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";
import { Topbar } from "@/components/Topbar";
import { APP_NAME } from "@rerun/shared/browser";
import "./globals.css";

const display = Funnel_Display({ subsets: ["latin"], variable: "--font-funnel-display", display: "swap" });
const sans = Funnel_Sans({ subsets: ["latin"], variable: "--font-funnel-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: `${APP_NAME}: will this research hold up?`,
  description: "Predict whether published research holds up. An AI lab re-runs the authors' code and data and posts public proof on NEAR.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <div className="shell">
            <Topbar />
            <main>{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
