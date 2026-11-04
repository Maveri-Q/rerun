import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

/** Test signing key for automated browser tests. Local dev server only; a 404 everywhere else. */
export function GET(request: Request) {
  const host = request.headers.get("host") ?? "";
  if (process.env.NODE_ENV !== "development" || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    return new Response(null, { status: 404 });
  }
  try {
    const env = parse(readFileSync(path.resolve(process.cwd(), "../.env.testnet")));
    return Response.json({ accountId: env.TESTNET_FT_ACCOUNT, privateKey: env.TESTNET_FT_PRIVATE_KEY });
  } catch {
    return new Response(null, { status: 404 });
  }
}
