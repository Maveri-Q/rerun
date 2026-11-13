import { LAB_URL } from "@/lib/config";

/**
 * A receipt's full report or log. The site's own copy (web/public/lab-files, from `pnpm site-snapshot`) comes
 * first, so the link works while the Lab is stopped; a file too new to be copied goes to the live Lab.
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string; hash: string }> }) {
  const { kind, hash } = await params;
  if ((kind !== "reports" && kind !== "logs") || !/^[0-9a-f]{64}$/.test(hash)) {
    return Response.json({ error: "Unknown file." }, { status: 404 });
  }
  const copy = new URL(`/lab-files/${kind}/${hash}.txt`, req.url);
  const head = await fetch(copy, { method: "HEAD" }).catch(() => null);
  if (head?.ok) return Response.redirect(copy, 307);
  if (LAB_URL) return Response.redirect(`${LAB_URL}/${kind}/${hash}`, 307);
  return Response.json({ error: "This file isn't available while the Lab is offline." }, { status: 404 });
}
