import { BRAND } from "@rerun/shared/browser";
import type { MetadataRoute } from "next";
import { chain } from "@/lib/chain";
import { isListed } from "@/lib/provenance";

export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = ["", "/how", "/facts", "/check", "/scout", "/lab", "/leaderboard", "/try", "/create"];
  const markets = await chain.markets().catch(() => []);
  const claims = markets.filter(isListed).flatMap((m) => {
    const paths = [`/market/${m.id}`];
    if (m.state === "Final") paths.push(`/facts/${m.id}`);
    if (m.state === "Final" || m.state === "Proposed") paths.push(`/receipt/${m.id}/0`);
    return paths;
  });
  return [...pages, ...claims].map((p) => ({ url: `${BRAND.siteUrl}${p}` }));
}
