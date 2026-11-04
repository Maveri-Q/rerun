import { Account, JsonRpcProvider, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { NETWORK_RETRY_DELAYS_MS, withNetworkRetry } from "../nearai/attestation.ts";

/** Thin wrapper over near-api-js for the market contract: views, signed calls, and readable failures. */

export const EXPLORER_TX = "https://testnet.nearblocks.io/txns/";

export interface CallOptions {
  /** Attached NEAR, as a decimal string. */
  deposit?: string;
  /** Attached yoctoNEAR, for methods that require exactly 1. */
  yocto?: bigint;
  tgas?: number;
}

export interface CallResult {
  txHash: string;
  logs: string[];
  /** Parsed return value of the first function call, if any. */
  value: unknown;
  gasBurnt: bigint;
}

export class ChainCallError extends Error {}

export class Chain {
  readonly provider: JsonRpcProvider;

  constructor(
    rpcUrl: string,
    readonly contractId: string,
  ) {
    this.provider = new JsonRpcProvider({ url: rpcUrl });
  }

  account(accountId: string, privateKey?: string): Account {
    return new Account(accountId, this.provider, privateKey as KeyPairString | undefined);
  }

  view<T>(method: string, args: Record<string, unknown> = {}, contractId = this.contractId): Promise<T> {
    return withNetworkRetry(() => this.provider.callFunction<never>({ contractId, method, args })) as Promise<T>;
  }

  /**
   * Signs one function call. Only DNS failures are retried: then the request never reached the
   * network. A timeout could mean it did, and repeating a trade would be worse than failing.
   */
  async call(signer: Account, method: string, args: Record<string, unknown>, opts: CallOptions = {}, contractId = this.contractId): Promise<CallResult> {
    const deposit = opts.yocto ?? (opts.deposit ? nearToYocto(opts.deposit as `${number}`) : 0n);
    let attempt = 0;
    while (true) {
      try {
        const res = await signer.callFunctionRaw({
          contractId,
          methodName: method,
          args,
          deposit,
          gas: teraToGas(opts.tgas ?? 100),
        });
        return toResult(res);
      } catch (e) {
        if (attempt < NETWORK_RETRY_DELAYS_MS.length && /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(describe(e))) {
          await new Promise((r) => setTimeout(r, NETWORK_RETRY_DELAYS_MS[attempt++]));
          continue;
        }
        throw new ChainCallError(`${method} failed: ${describe(e).slice(0, 600)}`);
      }
    }
  }
}

function toResult(res: Awaited<ReturnType<Account["callFunctionRaw"]>>): CallResult {
  const logs = res.receipts_outcome.flatMap((r) => r.outcome.logs);
  const gasBurnt =
    BigInt(res.transaction_outcome.outcome.gas_burnt) + res.receipts_outcome.reduce((sum, r) => sum + BigInt(r.outcome.gas_burnt), 0n);
  const success = res.status && typeof res.status === "object" && "SuccessValue" in res.status ? res.status.SuccessValue : undefined;
  let value: unknown;
  if (success) {
    const text = Buffer.from(success, "base64").toString("utf8");
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
  }
  return { txHash: res.transaction_outcome.id, logs, value, gasBurnt };
}

function describe(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause instanceof Error ? ` (${e.cause.message})` : "";
  return `${e.message}${cause}`;
}
