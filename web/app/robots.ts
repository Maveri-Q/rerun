import { BRAND } from "@rerun/shared/browser";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: "/api/" }], sitemap: `${BRAND.siteUrl}/sitemap.xml` };
}
