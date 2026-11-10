import { deserialize } from "borsh";
import { SCHEMA } from "near-api-js";

/**
 * Gas-free forecasts in points mode. The person's wallet signs a NEP-366 delegate action (a transaction
 * that someone else submits), and RERUN's relayer account submits it and pays the gas. When the person
 * has no prepaid storage on the contract, the relayer tops it up first, so the call itself attaches nothing.
 *
 * Only a few points-mode calls qualify, each account gets a daily allowance, and anything else is refused
 * before a transaction exists, so the site can fall back to the ordinary signed call.
 */

/** Calls the relayer pays for. Anything that moves money or needs a bond is left to the person's own wallet. */
export const RELAYED_METHODS = ["claim_points", "buy", "sell", "redeem"] as const;
export const MAX_RELAYED_TGAS = 200n;
export const RELAYS_PER_ACCOUNT_PER_DAY = 40;
export const RELAYS_PER_DAY = 1_000;
export const TOP_UPS_PER_DAY = 50;
/** Below this prepaid storage (0.01 NEAR) the relayer tops the account up by `TOP_UP`. */
export const MIN_STORAGE = 10n ** 22n;
export const TOP_UP = 2n * 10n ** 22n;

export interface DecodedDelegate {
  delegateAction: {
    senderId: string;
    receiverId: string;
    actions: Array<Record<string, unknown>>;
    nonce: bigint;
    maxBlockHeight: bigint;
    publicKey: unknown;
  };
  signature: unknown;
}

export class RelayRefusal extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** A wallet's base64 borsh `SignedDelegate`. */
export function decodeDelegate(base64: string): DecodedDelegate {
  try {
    return deserialize(SCHEMA.SignedDelegate, Buffer.from(base64, "base64")) as DecodedDelegate;
  } catch {
    throw new RelayRefusal("That isn't a signed delegate action.");
  }
}

export interface RelayedCall {
  sender: string;
  method: (typeof RELAYED_METHODS)[number];
  args: Record<string, unknown>;
}

/** What the delegate asks for, if the relayer will pay for it. Says why not otherwise. */
export function checkDelegate(sd: DecodedDelegate, contract: string): RelayedCall {
  const { senderId, receiverId, actions } = sd.delegateAction;
  if (receiverId !== contract) throw new RelayRefusal("The relayer only pays for calls to the RERUN contract.");
  if (actions.length !== 1) throw new RelayRefusal("The relayer pays for one call at a time.");
  const call = actions[0]!.functionCall as { methodName: string; args: Uint8Array; gas: bigint; deposit: bigint } | undefined;
  if (!call) throw new RelayRefusal("The relayer only pays for contract calls.");
  if (!(RELAYED_METHODS as readonly string[]).includes(call.methodName)) throw new RelayRefusal(`The relayer doesn't pay for ${call.methodName}.`);
  if (BigInt(call.deposit) !== 0n) throw new RelayRefusal("A gas-free call can't attach NEAR.");
  if (BigInt(call.gas) > MAX_RELAYED_TGAS * 10n ** 12n) throw new RelayRefusal("That call asks for too much gas.");
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(Buffer.from(call.args).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new RelayRefusal("The call's arguments aren't JSON.");
  }
  if (call.methodName !== "claim_points" && typeof args.market_id !== "number") throw new RelayRefusal("The call names no claim.");
  return { sender: senderId, method: call.methodName as RelayedCall["method"], args };
}

/** Daily allowances, counted per server instance (UTC days). */
export class DailyCaps {
  private day = "";
  private perAccount = new Map<string, number>();
  private toppedUp = new Set<string>();
  private total = 0;
  private topUps = 0;

  constructor(private readonly today: () => string = () => new Date().toISOString().slice(0, 10)) {}

  private roll() {
    const day = this.today();
    if (day === this.day) return;
    this.day = day;
    this.perAccount.clear();
    this.toppedUp.clear();
    this.total = 0;
    this.topUps = 0;
  }

  /** Throws if the account or the relayer has used today's allowance; otherwise counts this relay. */
  take(account: string) {
    this.roll();
    const used = this.perAccount.get(account) ?? 0;
    if (used >= RELAYS_PER_ACCOUNT_PER_DAY) throw new RelayRefusal(`You've had ${RELAYS_PER_ACCOUNT_PER_DAY} gas-free calls today.`, 429);
    if (this.total >= RELAYS_PER_DAY) throw new RelayRefusal("The relayer has used today's allowance.", 429);
    this.perAccount.set(account, used + 1);
    this.total += 1;
  }

  /** Whether the relayer may prepay this account's storage today (once per account). */
  takeTopUp(account: string): boolean {
    this.roll();
    if (this.toppedUp.has(account) || this.topUps >= TOP_UPS_PER_DAY) return false;
    this.toppedUp.add(account);
    this.topUps += 1;
    return true;
  }
}

export interface RelayDeps {
  marketMode(marketId: number): Promise<string | null>;
  storageBalance(account: string): Promise<bigint>;
  topUp(account: string, yocto: bigint): Promise<void>;
  send(sd: DecodedDelegate): Promise<{ hash: string; failure?: string }>;
}

export type RelayResult = { submitted: true; hash: string; failure?: string };

/**
 * Checks, tops up storage if needed, and submits. A refusal (thrown `RelayRefusal`) means nothing was sent,
 * so the site may fall back to the ordinary call; once `send` starts, the result is reported as submitted.
 */
export async function relay(base64: string, contract: string, caps: DailyCaps, deps: RelayDeps): Promise<RelayResult> {
  const sd = decodeDelegate(base64);
  const call = checkDelegate(sd, contract);
  if (call.method !== "claim_points") {
    const mode = await deps.marketMode(call.args.market_id as number);
    if (mode === null) throw new RelayRefusal("There's no claim with that number.");
    if (mode !== "points") throw new RelayRefusal("Gas-free calls are for points claims only.");
  }
  caps.take(call.sender);
  if ((await deps.storageBalance(call.sender)) < MIN_STORAGE) {
    if (!caps.takeTopUp(call.sender)) throw new RelayRefusal("The relayer has already prepaid your storage today.", 429);
    await deps.topUp(call.sender, TOP_UP);
  }
  return { submitted: true, ...(await deps.send(sd)) };
}
