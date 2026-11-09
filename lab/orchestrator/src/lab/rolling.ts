/**
 * Keeps a short demo claim available, so a visitor can predict, watch the rerun and collect within
 * minutes. It posts on a schedule and when someone presses "Try it now". Demo claims only: a published
 * paper's open claim must never be run before its forecasting closes.
 */

export const ROLLING_NAMES = ["reproduces", "misreported"] as const;
export type RollingName = (typeof ROLLING_NAMES)[number];

export interface RollingMarket {
  id: number;
  state: string;
  lock_time: number;
  created_at?: number;
  challenge_deadline: number | null;
  spec: { title: string };
}

export interface RollingDeps {
  list: () => Promise<RollingMarket[]>;
  post: (name: RollingName, lockTime: number) => Promise<number>;
  finalize: (id: number) => Promise<void>;
  /** Collects the posting account's position in a final demo, so its liquidity comes back. */
  collect?: (id: number) => Promise<void>;
  /** The posting account's points, in whole points. */
  balance?: () => Promise<number>;
  /** Adds points to the posting account (the owner's capped `grant_points`). */
  topUp?: (points: number) => Promise<void>;
  /** Called with a warning the operator should see, or null once it's resolved. */
  warn?: (message: string | null) => void;
  now?: () => number;
  log?: (message: string) => void;
}

export interface RollingOptions {
  /** Seconds visitors get to predict. */
  windowSecs: number;
  /** Seconds between scheduled claims. */
  everySecs: number;
  /** The most claims it may post in a day, so a stuck page or a bot can't drain the account. */
  maxPerDay: number;
  /** Below this many points the account is topped up before posting. Each demo needs 100. */
  lowPoints?: number;
  /** How many points one top-up adds (the contract allows at most 5,000). */
  topUpPoints?: number;
}

/** What one demo claim locks up: the creation bond, the Lab fee and the starting liquidity. */
export const POINTS_PER_DEMO = 100;

const isDemo = (m: RollingMarket) => /^(\[DEMO\]|Demo:)/.test(m.spec.title);
const DAY_SECS = 86_400;

export class RollingDemos {
  private posted: number[] = [];
  private next = 0;
  private lastScheduled = 0;

  constructor(
    private readonly deps: RollingDeps,
    private readonly opts: RollingOptions,
  ) {}

  private now() {
    return Math.floor((this.deps.now?.() ?? Date.now()) / 1000);
  }

  /** A short demo still open with time left. Older demos with days to run can't show the whole cycle. */
  private openOne(markets: RollingMarket[]) {
    const now = this.now();
    return markets.find((m) => isDemo(m) && m.state === "Open" && m.lock_time > now + 30 && m.lock_time <= now + this.opts.windowSecs);
  }

  /** Makes sure the account can pay for the next demo, topping it up when it runs low, and warns if it can't. */
  private async ensurePoints(): Promise<void> {
    if (!this.deps.balance) return;
    const low = this.opts.lowPoints ?? 1_000;
    let have = await this.deps.balance();
    if (have >= low) return this.deps.warn?.(null);
    const msg = `demo points are low: ${have.toFixed(2)} left, ${POINTS_PER_DEMO} per demo`;
    this.deps.log?.(`WARNING ${msg}`);
    if (this.deps.topUp) {
      try {
        await this.deps.topUp(this.opts.topUpPoints ?? 5_000);
        have = await this.deps.balance();
        this.deps.log?.(`topped up the demo account: ${have.toFixed(2)} points now`);
      } catch (e) {
        this.deps.log?.(`WARNING the points top-up failed: ${(e as Error).message}`);
      }
    }
    if (have < POINTS_PER_DEMO) {
      this.deps.warn?.(`${msg}, and the top-up didn't fix it. New demos are paused.`);
      throw new Error(`not enough points for a demo claim: ${have.toFixed(2)}`);
    }
    this.deps.warn?.(have < low ? msg : null);
  }

  private async post(): Promise<number> {
    const now = this.now();
    this.posted = this.posted.filter((t) => t > now - DAY_SECS);
    if (this.posted.length >= this.opts.maxPerDay) throw new Error("today's demo claims have all been used");
    await this.ensurePoints();
    const name = ROLLING_NAMES[this.next % ROLLING_NAMES.length]!;
    const id = await this.deps.post(name, now + this.opts.windowSecs);
    this.next++;
    this.posted.push(now);
    this.deps.log?.(`demo claim ${id} (${name}) is open for ${this.opts.windowSecs}s`);
    return id;
  }

  /** Gets the demo's liquidity back. A failure here never stops the next demo; the sweep at start-up retries. */
  async collect(id: number): Promise<void> {
    if (!this.deps.collect) return;
    try {
      await this.deps.collect(id);
      this.deps.log?.(`collected the demo account's share of claim ${id}`);
    } catch (e) {
      this.deps.log?.(`couldn't collect claim ${id} yet: ${(e as Error).message}`);
    }
  }

  /** For "Try it now": the open demo if there is one, otherwise a new one. */
  async tryNow(): Promise<number> {
    const open = this.openOne(await this.deps.list());
    return open ? open.id : this.post();
  }

  /** Finalizes demos whose challenge window has passed, and posts the scheduled one when it's due. */
  async tick(): Promise<void> {
    const markets = await this.deps.list();
    const now = this.now();
    for (const m of markets) {
      if (!isDemo(m) || m.state !== "Proposed" || m.challenge_deadline === null || m.challenge_deadline >= now) continue;
      await this.deps.finalize(m.id);
      this.deps.log?.(`demo claim ${m.id} is final`);
      await this.collect(m.id);
    }
    if (now - this.lastScheduled < this.opts.everySecs) return;
    this.lastScheduled = now;
    if (!this.openOne(markets)) await this.post();
  }
}
