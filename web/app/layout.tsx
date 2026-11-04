import type { Metadata } from "next";
import { Besley, Spline_Sans_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";
import { Topbar } from "@/components/Topbar";
import { APP_NAME } from "@rerun/shared/browser";
import "./globals.css";

const besley = Besley({ subsets: ["latin"], variable: "--font-besley", display: "swap" });
const splineMono = Spline_Sans_Mono({ subsets: ["latin"], variable: "--font-spline-mono", display: "swap" });

export const metadata: Metadata = {
  title: `${APP_NAME}: will this research hold up?`,
  description: "Predict whether published research holds up. An AI lab re-runs the authors' code and data and posts public proof on NEAR.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${besley.variable} ${splineMono.variable}`}>
      <body>
        {/* Roughens the stamp's edges like ink on paper. */}
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
          <filter id="stamp-ink">
            <feTurbulence type="fractalNoise" baseFrequency="0.035 0.05" numOctaves="3" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" result="rough" />
            <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="3" result="speck" />
            <feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -7 5.2" result="mask" />
            <feComposite in="rough" in2="mask" operator="in" />
          </filter>
        </svg>
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
