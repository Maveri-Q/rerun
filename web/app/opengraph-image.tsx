import { readFile } from "node:fs/promises";
import path from "node:path";
import { APP_LOGO_SVG, BRAND, logoFile } from "@rerun/shared/browser";
import { ImageResponse } from "next/og";

export const alt = `${BRAND.name}: ${BRAND.question} ${BRAND.example}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The share image for every page: the mark, the name, the question, and one real result. */
export default async function Image() {
  const font = (file: string) => readFile(path.join(process.cwd(), "assets", file));
  const [bold, regular] = await Promise.all([font("SpaceGrotesk-Bold.ttf"), font("SpaceGrotesk-Regular.ttf")]);
  const mark = `data:image/svg+xml;base64,${Buffer.from(logoFile(APP_LOGO_SVG)).toString("base64")}`;
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", gap: 56, padding: "0 72px", background: BRAND.colors.ink, color: BRAND.colors.paper, fontFamily: "Space Grotesk" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mark} width={330} height={330} alt="" />
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ fontSize: 112, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{BRAND.name}</div>
        <div style={{ fontSize: 42, marginTop: 20 }}>{BRAND.question}</div>
        <div style={{ fontSize: 34, marginTop: 44, color: BRAND.colors.mint }}>{BRAND.example}</div>
      </div>
    </div>,
    { ...size, fonts: [{ name: "Space Grotesk", data: bold, weight: 700, style: "normal" }, { name: "Space Grotesk", data: regular, weight: 400, style: "normal" }] },
  );
}
