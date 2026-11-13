/**
 * Switches the mainnet Lab's Phala machine off between runs, so it only costs money while claims need it.
 * Uses Phala Cloud's API (https://docs.phala.com/api-reference/cvms/start-cvm) with PHALA_API_KEY from .env.
 * It never stops the Lab while a mainnet claim is closing, being retraced, or waiting to be finalized.
 *
 *   pnpm phala:window status            what Phala and the chain say now; changes nothing
 *   pnpm phala:window stop              shuts the Lab down cleanly, if no claim needs it in the next 24 hours
 *   pnpm phala:window start             starts it, then waits until its /health answers
 *   pnpm phala:window stop-when-final   checks every 15 minutes, for up to 12 hours, and shuts down once no claim needs it
 *   pnpm phala:window schedule          adds the Windows tasks for Nov 15 (start 11:00 UTC, stop-when-final 20:30 UTC)
 *
 * Starting the machine costs money; run `start` and `schedule` only with the owner's yes.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { Chain } from "../lab/orchestrator/src/chain/near.ts";
import { loadEnv } from "../lab/orchestrator/src/env.ts";

loadEnv();

const API = "https://cloud-api.phala.com/api/v1";
const APP_ID = process.env.PHALA_MAINNET_APP_ID || "47f3ffaaef76565862bec5ad4b18ceb4fd68489e";
const LAB_URL = process.env.MAINNET_LAB_URL || `https://${APP_ID}-8787.dstack-pha1-prod5.phala.network`;
const CONTRACT = process.env.MAINNET_CONTRACT_ACCOUNT || "market.rerun-app.near";
const RPC = process.env.NEAR_MAINNET_RPC_URL || "https://free.rpc.fastnear.com";
const NEEDS_LAB_WITHIN = 24 * 3600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
const log = (msg: string) => console.log(`${stamp()}  ${msg}`);

async function phala<T>(method: "GET" | "POST", route: string): Promise<T> {
  const key = process.env.PHALA_API_KEY;
  if (!key) throw new Error("PHALA_API_KEY isn't set. Create one in Phala Cloud (Settings, API Keys) and put it in .env.");
  let last: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(API + route, { method, headers: { "X-API-Key": key, accept: "application/json" } });
      const text = await res.text();
      if (!res.ok) throw new Error(`Phala answered ${res.status} to ${method} ${route}: ${text.slice(0, 300)}`);
      return (text ? JSON.parse(text) : {}) as T;
    } catch (e) {
      last = e;
      if (e instanceof Error && /answered 4\d\d/.test(e.message)) throw e;
      await sleep(5000);
    }
  }
  throw last;
}

interface Cvm { id?: string; app_id?: string; name?: string; status?: string; hosted?: { id?: string; app_id?: string; status?: string } }

/** Phala's list format has varied between versions, so accept either shape and match on the app id. */
async function findCvm(): Promise<{ id: string; status: string; name: string }> {
  const raw = await phala<unknown>("GET", "/cvms");
  const list: Cvm[] = Array.isArray(raw) ? raw : ((raw as { items?: Cvm[] }).items ?? []);
  for (const c of list) {
    const app = c.app_id ?? c.hosted?.app_id ?? "";
    if (app.replace(/^app_/, "") === APP_ID) {
      return { id: c.id ?? c.hosted?.id ?? `app_${APP_ID}`, status: c.status ?? c.hosted?.status ?? "unknown", name: c.name ?? "" };
    }
  }
  throw new Error(`No Phala machine with app id ${APP_ID} on this account (found ${list.length}).`);
}

interface Market { id: number; state: string; lock_time: number }

/** Claims that still need the mainnet Lab: anything not Final whose forecasting closes within a day, or already closed. */
async function claimsNeedingLab(): Promise<Market[]> {
  const chain = new Chain(RPC, CONTRACT);
  const markets = await chain.view<Market[]>("list_markets", { limit: 200 });
  const now = Date.now() / 1000;
  return markets.filter((m) => m.state !== "Final" && m.state !== "Draft" && m.lock_time < now + NEEDS_LAB_WITHIN);
}

async function healthy(): Promise<boolean> {
  const res = await fetch(`${LAB_URL}/health`).catch(() => null);
  const body = res?.ok ? ((await res.json().catch(() => null)) as { ok?: boolean; account?: string } | null) : null;
  return body?.ok === true && body.account === "lab.rerun-app.near";
}

async function stop(): Promise<boolean> {
  const busy = await claimsNeedingLab();
  if (busy.length) {
    log(`Not stopping: claim ${busy.map((m) => `${m.id} (${m.state})`).join(", ")} still needs the Lab.`);
    return false;
  }
  const cvm = await findCvm();
  if (/stop|exit/i.test(cvm.status)) {
    log(`Already ${cvm.status}.`);
    return true;
  }
  await phala("POST", `/cvms/${cvm.id}/shutdown`);
  log(`Shutting down the mainnet Lab (${cvm.name || cvm.id}). Its key and registration stay; \`start\` brings it back.`);
  return true;
}

async function start(): Promise<void> {
  if (await healthy()) return log("The mainnet Lab is already up and healthy.");
  const cvm = await findCvm();
  if (!/run|start/i.test(cvm.status)) {
    await phala("POST", `/cvms/${cvm.id}/start`);
    log(`Starting the mainnet Lab (${cvm.name || cvm.id}).`);
  }
  for (let i = 0; i < 60; i++) {
    await sleep(30_000);
    if (await healthy()) return log(`Healthy at ${LAB_URL}/health, signing as lab.rerun-app.near.`);
    if (i === 30) {
      const again = await findCvm();
      if (!/run|start/i.test(again.status)) await phala("POST", `/cvms/${again.id}/start`).catch(() => null);
    }
  }
  throw new Error("The Lab didn't report healthy within 30 minutes. Open it in Phala Cloud and check its logs.");
}

function schedule(): void {
  const repo = path.resolve(import.meta.dirname, "..");
  const task = (name: string, when: string, cmd: string) =>
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c cd /d "${repo}" && pnpm phala:window ${cmd} >> "${repo}\\phala-window.log" 2>&1';` +
          `$t = New-ScheduledTaskTrigger -Once -At ([DateTime]::Parse('${when}').ToLocalTime());` +
          `$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 13);` +
          `Register-ScheduledTask -TaskName '${name}' -Action $a -Trigger $t -Settings $s -Force | Out-Null`,
      ],
      { stdio: "inherit" },
    );
  task("RERUN mainnet Lab start", "2026-11-15T11:00:00Z", "start");
  task("RERUN mainnet Lab stop", "2026-11-15T20:30:00Z", "stop-when-final");
  log("Scheduled: start on Nov 15 at 11:00 UTC, and stop once claims 2 and 3 are final (checked from 20:30 UTC).");
  log(`Output goes to ${path.join(repo, "phala-window.log")}. If the computer is off then, each task runs as soon as it's back on.`);
}

const cmd = process.argv[2];
if (cmd === "status") {
  const busy = await claimsNeedingLab();
  log(`Claims that need the mainnet Lab within a day: ${busy.length ? busy.map((m) => `${m.id} (${m.state})`).join(", ") : "none"}`);
  log(`Lab health: ${(await healthy()) ? "up" : "not answering"}`);
  if (process.env.PHALA_API_KEY) {
    const cvm = await findCvm();
    log(`Phala: ${cvm.name || cvm.id} is ${cvm.status}`);
  } else log("Phala: no PHALA_API_KEY, so the machine's own status wasn't read.");
} else if (cmd === "stop") {
  await stop();
} else if (cmd === "start") {
  await start();
} else if (cmd === "stop-when-final") {
  for (let i = 0; i < 48 && !(await stop()); i++) await sleep(15 * 60_000);
} else if (cmd === "schedule") {
  schedule();
} else {
  console.log("Usage: pnpm phala:window status | stop | start | stop-when-final | schedule");
  process.exitCode = 1;
}
