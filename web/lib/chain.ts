import { JsonRpcProvider } from "near-api-js";
import { CONTRACT, RPC } from "./config";
import type { Config, Lab, Market, Mode, Position, Receipt, State, Stats } from "./market";

const provider = new JsonRpcProvider({ url: RPC });

async function view<T>(method: string, args: Record<string, unknown> = {}, contractId = CONTRACT): Promise<T> {
  let lastError: unknown;
  for (const delay of [0, 800, 2000, 5000]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      return (await provider.callFunction<never>({ contractId, method, args })) as T;
    } catch (e) {
      lastError = e;
      // A contract error will not change on retry; only retry network trouble.
      if (!/fetch|network|timeout|failed to/i.test(String((e as Error).message))) break;
    }
  }
  throw lastError;
}

export const chain = {
  view,
  config: () => view<Config>("get_config"),
  stats: () => view<Stats>("get_stats"),
  market: (id: number) => view<Market | null>("get_market", { market_id: id }),
  markets: (filter: { state?: State; mode?: Mode } = {}, limit = 100) => view<Market[]>("list_markets", { ...filter, limit }),
  spec: (id: number) => view<string | null>("get_spec", { market_id: id }),
  receipts: (id: number) => view<Receipt[]>("get_receipts", { market_id: id }),
  priceHistory: (id: number) => view<{ t: number; yes_ppm: number }[]>("get_price_history", { market_id: id }),
  position: (account: string, id: number) => view<Position | null>("get_position", { account_id: account, market_id: id }),
  accountMarkets: (account: string) => view<number[]>("get_account_markets", { account_id: account }),
  balance: (account: string, mode: Mode) => view<string>("get_balance", { account_id: account, mode }),
  storageBalance: (account: string) => view<string>("storage_balance_of", { account_id: account }),
  leaderboard: (limit = 50) => view<{ account_id: string; points: string }[]>("get_points_leaderboard", { limit }),
  lab: (account: string) => view<Lab | null>("get_lab", { lab_account: account }),
  labs: () => view<[string, Lab][]>("list_labs"),
  codehashApproved: (codehash: string) => view<boolean>("is_codehash_approved", { codehash }),
};
