/**
 * Keeps a short demo claim available, so a visitor can predict, watch the re-run and collect within
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
}

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

  private async post(): Promise<number> {
    const now = this.now();
    this.posted = this.posted.filter((t) => t > now - DAY_SECS);
    if (this.posted.length >= this.opts.maxPerDay) throw new Error("today's demo claims have all been used");
    const name = ROLLING_NAMES[this.next % ROLLING_NAMES.length]!;
    const id = await this.deps.post(name, now + this.opts.windowSecs);
    this.next++;
    this.posted.push(now);
    this.deps.log?.(`demo claim ${id} (${name}) is open for ${this.opts.windowSecs}s`);
    return id;
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
    }
    if (now - this.lastScheduled < this.opts.everySecs) return;
    this.lastScheduled = now;
    if (!this.openOne(markets)) await this.post();
  }
}
