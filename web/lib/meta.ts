import { BRAND } from "@rerun/shared/browser";
import type { Metadata } from "next";

/** Title, description and link-preview tags for a page. The preview image comes from app/opengraph-image.tsx. */
export function pageMeta(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, siteName: BRAND.name, type: "website", images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${BRAND.name}: ${BRAND.question} ${BRAND.example}` }] },
    twitter: { card: "summary_large_image", title, description, images: ["/twitter-image"] },
  };
}
