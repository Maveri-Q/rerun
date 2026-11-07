import { BRAND } from "@rerun/shared/browser";
import type { Metadata } from "next";
import { Seed } from "@/components/Seed";
import { chain } from "@/lib/chain";
import { pageMeta } from "@/lib/meta";
import { claimName, isListed, resultSentence } from "@/lib/provenance";
import { claimSeed } from "@/lib/seed";
import ReceiptClient from "./ReceiptClient";

export const revalidate = 60;
export const generateStaticParams = () => [];

export async function generateMetadata({ params }: { params: Promise<{ market: string; run: string }> }): Promise<Metadata> {
  const p = await params;
  const id = Number(p.market);
  const [m, receipts] = await Promise.all([chain.market(id).catch(() => null), chain.receipts(id).catch(() => [])]);
  if (!m || !isListed(m)) return pageMeta(`Claim ${id}`, BRAND.description, `/receipt/${id}/${p.run}`);
  return pageMeta(`Receipt: ${claimName(m)}`, resultSentence(m, receipts.at(-1)?.outcome) ?? BRAND.description, `/receipt/${id}/${p.run}`);
}

export default async function Page({ params }: { params: Promise<{ market: string; run: string }> }) {
  const { market } = await params;
  return (
    <Seed value={await claimSeed(Number(market))}>
      <ReceiptClient params={params} />
    </Seed>
  );
}
