/** Runs the Lab against testnet: `pnpm lab:watch`. Polls the contract and processes one market at a time. */
import { testnetWorker } from "../src/lab/setup.ts";

const POLL_MS = 5_000;

const worker = testnetWorker({
  log: (m) => console.log(m),
  onEvent: (id, e) => console.log(`  market ${id} [${e.stage}] ${e.message}`),
});
console.log("Lab watching testnet. Ctrl+C to stop.");
while (true) {
  await worker.tick().catch((e: Error) => console.error(`tick failed: ${e.message}`));
  await new Promise((r) => setTimeout(r, POLL_MS));
}
