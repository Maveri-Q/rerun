import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { Account, actions, JsonRpcProvider, type KeyPairString } from "near-api-js";
import { chain } from "@/lib/chain";
import { CONTRACT, RPC } from "@/lib/config";
import { DailyCaps, relay, RelayRefusal, type DecodedDelegate } from "@/lib/relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const caps = new DailyCaps();

/** The hosted site sets these in its server environment; a local dev server reads the repo's .env.testnet. */
function relayerEnv(): { id?: string; key?: string } {
  if (process.env.RELAYER_ACCOUNT || process.env.NODE_ENV !== "development") return { id: process.env.RELAYER_ACCOUNT, key: process.env.RELAYER_PRIVATE_KEY };
  try {
    const env = parse(readFileSync(path.resolve(process.cwd(), "../.env.testnet")));
    return { id: env.RELAYER_ACCOUNT, key: env.RELAYER_PRIVATE_KEY };
  } catch {
    return {};
  }
}

function relayer(): Account | null {
  const { id, key } = relayerEnv();
  if (!id || !key) return null;
  return new Account(id, new JsonRpcProvider({ url: RPC }), key as KeyPairString);
}

interface Outcome {
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
  status?: { Failure?: unknown };
  receipts_outcome?: Array<{ outcome?: { status?: { Failure?: unknown } } }>;
}

function failureOf(o: Outcome): string | undefined {
  const failed = [o.status?.Failure, ...(o.receipts_outcome ?? []).map((r) => r.outcome?.status?.Failure)].find(Boolean);
  return failed ? JSON.stringify(failed) : undefined;
}

/** Whether gas-free calls are on, and which account pays. */
export function GET() {
  const account = relayer();
  return Response.json({ enabled: account !== null, account: account?.accountId ?? null });
}

export async function POST(request: Request) {
  const account = relayer();
  if (!account) return Response.json({ submitted: false, reason: "Gas-free calls are off." }, { status: 503 });
  let body: { signedDelegate?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ submitted: false, reason: "Send JSON." }, { status: 400 });
  }
  if (typeof body.signedDelegate !== "string" || body.signedDelegate.length > 8_000) {
    return Response.json({ submitted: false, reason: "Send one signed delegate action." }, { status: 400 });
  }
  let sending = false;
  try {
    const result = await relay(body.signedDelegate, CONTRACT, caps, {
      marketMode: async (id) => (await chain.market(id))?.mode ?? null,
      storageBalance: async (who) => BigInt(await chain.view<string>("storage_balance_of", { account_id: who })),
      topUp: async (who, yocto) => {
        const o = (await account.callFunctionRaw({ contractId: CONTRACT, methodName: "storage_deposit", args: { account_id: who }, deposit: yocto, gas: 30n * 10n ** 12n })) as Outcome;
        const failure = failureOf(o);
        if (failure) throw new RelayRefusal(`Couldn't prepay storage: ${failure.slice(0, 200)}`, 502);
      },
      send: async (sd: DecodedDelegate) => {
        sending = true;
        const o = (await account.signAndSendTransaction({
          receiverId: sd.delegateAction.senderId,
          actions: [actions.signedDelegate(sd as unknown as Parameters<typeof actions.signedDelegate>[0])],
        })) as Outcome;
        return { hash: o.transaction?.hash ?? o.transaction_outcome?.id ?? "", failure: failureOf(o) };
      },
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof RelayRefusal) return Response.json({ submitted: false, reason: e.message }, { status: e.status });
    // Once the delegate is on its way it may have landed, so the site must not resend the call itself.
    return Response.json({ submitted: sending, hash: "", failure: (e as Error).message.slice(0, 300), reason: "The relayer hit an error." }, { status: 502 });
  }
}
