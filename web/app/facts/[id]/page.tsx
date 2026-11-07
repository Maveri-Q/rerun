import { BRAND } from "@rerun/shared/browser";
import type { Metadata } from "next";
import { Seed } from "@/components/Seed";
import { chain } from "@/lib/chain";
import { pageMeta } from "@/lib/meta";
import { claimName, isListed, resultSentence } from "@/lib/provenance";
import { claimSeed } from "@/lib/seed";
import FactClient from "./FactClient";

export const revalidate = 60;
export const generateStaticParams = () => [];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const p = await params;
  const id = Number(p.id);
  const [m, receipts] = await Promise.all([chain.market(id).catch(() => null), chain.receipts(id).catch(() => [])]);
  if (!m || !isListed(m)) return pageMeta(`Claim ${id}`, BRAND.description, `/facts/${id}`);
  return pageMeta(`Verified fact: ${claimName(m)}`, resultSentence(m, receipts.at(-1)?.outcome) ?? BRAND.description, `/facts/${id}`);
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Seed value={await claimSeed(Number(id))}>
      <FactClient params={params} />
    </Seed>
  );
}
