import { chain } from "@/lib/chain";

/** The contract's get_verdict, over HTTP, for anything that settles on these results. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 0) return Response.json({ error: "A claim id is a whole number." }, { status: 400 });
  const verdict = await chain.view<unknown>("get_verdict", { claim_id: id });
  if (!verdict) return Response.json({ error: `There is no claim ${id}.` }, { status: 404 });
  return Response.json(verdict, { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=30" } });
}
