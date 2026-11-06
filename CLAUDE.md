# CLAUDE.md

RERUN: NEAR Hackathon 2026 entry. The full spec is the human's build plan (`RERUN_BUILD_PLAN.md`; a local copy may sit at the repo root, untracked); follow its build order. Rules: https://nearhackathon.com/HACKATHON.md (re-read before submitting).

## Commands

- `pnpm install`, `pnpm test` (all packages, offline, `MOCK_LLM`-safe), `pnpm typecheck`
- `pnpm nearai:hello`: live NEAR AI attestation (+ chat and signature with an API key)
- `pnpm testnet:accounts`: creates faucet-funded testnet accounts into `.env.testnet`
- `pnpm sandbox:build` (Docker images), `MOCK_LLM=1 pnpm lab:run all` (demo claims, no credits), `pnpm lab:run <name> [--rerun]` (real private model), `MOCK_LLM=1 pnpm lab:run real` (published papers in `claims/real`, sources in `docs/SOURCES.md`)
- `DOCKER_TESTS=1 pnpm --filter @rerun/orchestrator test` adds real-container isolation tests
- After changing specs, receipts or demo claims: `MOCK_LLM=1 pnpm lab:run all && pnpm --filter @rerun/orchestrator export:vectors`, then `pnpm test:contracts`
- `pnpm deploy:testnet` (idempotent; `pnpm deploy` is pnpm's own command), `pnpm demo [names] [--resume]` (end to end on testnet), `pnpm lab:watch` (Lab loop)
- `pnpm repair-benchmark [names]` (real AI repair on `claims/benchmark`, writes `docs/REPAIR_BENCHMARK.md`; no claim about AI repair until it covers 5 papers), `pnpm scout` (one scan by the scout agent: reads metadata, drafts with the AI, never runs code or posts; review at `/scout`), `pnpm post-real` (posts `claims/real` to testnet, idempotent), `pnpm web` (site on :3000), `pnpm site-snapshot` (copies write-ups and the scout log for finished claims into `web/public`, so the hosted site shows them with no Lab; rerun after new verdicts), `pnpm seed` (open markets with odds), `pnpm facts` (writes `web/lib/facts.json`: AI entries for settled published claims plus citation counts; signs nothing). `ROLLING_DEMOS=1 pnpm lab:watch` also posts short demo claims hourly and powers "Try it now" (signs with the owner key). `pnpm lab:watch` also serves the Lab's API on :8787
- `pnpm judge-demo [--skip-live]` (Node only), `pnpm challenge-demo`, `pnpm attack-demo` (both refuse to run while a Lab is up, because it would race them for markets)
- `pnpm test:contracts` (cargo unit + property tests), `pnpm build:contracts` (testnet wasm into `contracts/target/near/`)
- Mainnet contract build: `cd contracts/rerun && cargo near build non-reproducible-wasm --no-abi --no-default-features` (drops `register_lab_local`)

## Conventions

- pnpm 12 workspace; TypeScript runs directly via `tsx`/`vitest` (`.ts` import specifiers, no build step).
- Pin exact dependency versions. pnpm enforces a minimum release age; prefer an older release to excluding a fresh one.
- Every LLM call goes through `LlmClient` in `lab/orchestrator/src/nearai/client.ts` (token/call/daily caps, spend log, `MOCK_LLM=1`).
- Only NEAR-hosted private models (`owned_by: "nearai"` in `/v1/models`). Default `z-ai/glm-5.3-flash`; re-runs use a different one.
- The deterministic comparator decides outcomes, never the LLM. It exists twice and must stay identical: `contracts/rerun/src/math.rs` and `packages/shared/src/decimal.ts`.
- ClaimSpec metric values are decimal strings (`"0.912"`), never JSON floats; the contract rejects floats and non-canonical JSON.
- Contracts: Cargo workspace in `contracts/`, scaffolded with `cargo near new`, Rust pinned to 1.93.0 by `contracts/rust-toolchain.toml`, near-sdk 5.29.1. Unit tests use near-sdk's mocked chain (`testing_env!`).
- Research code never shares a container with keys. `Sandbox` (`lab/orchestrator/src/sandbox/`) passes no environment in; the network is off during the run phase.
- A run that fails first tries `dateInstall` (uv, packages as of the commit date), then AI repair. Running out of tries, or the AI concluding it can't be fixed, is INVALID with ENV_SETUP_FAILED. The AI never decides a verdict. BROKEN only comes from a time limit, or a private-data run failing. An AI with no usable reply, or a failed install, posts no verdict.
- `glm-5.3-flash` writes its thinking into the answer unless `responseFormat` is set, so every request must pass one (`REPAIR_FORMAT`, `JSON_OBJECT_FORMAT`), and the prompt must ask for JSON too: with a format but no mention of JSON it returned noise.
- A scout draft needs its number near the claim's wording in the paper (`numberNearWording`) and a second AI on a different model picking the same number without seeing the first (`pickNumber`). A paper with no readable free copy isn't drafted.
- The scout's relatability score only orders the review queue, and papers below 4 are skipped. It never touches a verdict, and the safety filters apply whatever the score. Citations (OpenAlex) stand in for public attention unless `ALTMETRIC_KEY` is set.
- Never run an open claim before its forecasting closes. Only settled showcase claims (`pnpm settle-claim`) may be run early. Before the TEE is live, set lock times between 10am and 6pm Lagos time, grouped so one Lab session covers several claims.
- A mismatch on an independent rebuild is INVALID with REBUILD_MISMATCH, never NOT_REPRODUCED. A BROKEN market isn't required any more.
- The product name and logo live only in `packages/shared/src/config.ts`.
- Repair edits go through `checkEdit` in `lab/orchestrator/src/pipeline/guards.ts`; when loosening it, add a test showing science still cannot change.
- Private-data claims: nothing derived from the run may reach the LLM, stream, stored logs or receipt tail. `pipeline.test.ts` greps for leaks.
- Web: `@rerun/shared/browser` is the browser-safe entry point (no `node:crypto`). Design rules ("printed proof"): black stage, white receipt paper, a trace of mint (`--mint`) only for what is live or rising; falling values are grey with an arrow, coral only for real errors. Funnel Display and Funnel Sans, Geist Mono for figures, sentence case. The printed receipt is the one loud element; it slides out of its slot on the home, claim and receipt pages. The human asked for a lively site: the scroll-driven machine on `/how`, the sliding receipts and the paper tape are wanted. Every animation must respect reduced motion.
- Automated UI tests sign via `localStorage["rerun.test-wallet"]="1"` and `/api/dev-test-wallet`, which is dev-only and localhost-only. Never put a private key in a browser tool call.
- Evidence checks (`lab/orchestrator/src/pipeline/evidence.ts`) run after the verdict is fixed and must never settle a market. A failure there only marks the check incomplete. The re-implementation prompt must never contain the reported number or data values.
- Site copy: plain words. Say claim, forecast, holds up, allowed margin, fingerprint, collect, secure hardware; keep the technical terms for the technical sections. Terms and meanings are listed on `/how`.
- Community notes and conflict-of-interest declarations live on the contract (`contracts/rerun/src/notes.rs`) under their own storage keys, so they keep the state layout and show when the Lab is off. The poster pays storage. They never reach the AI, a run, a receipt or a verdict.
- NEAR Intents in `web/lib/intents.ts` only asks for dry quotes, so nothing can move. Real deposits wait for the real-money decision.
- Open claims in `claims/benchmark` carry `not_before`, so the repair benchmark can't run them before forecasting closes.
- Demo scripts must not count a transaction failing for the wrong reason as an attack blocked: `Scoreboard.blocked` requires the exact rejection text, and retries only passing network errors.
- Secrets only in `.env` / `.env.testnet` (gitignored). Check history for keys before any push.

## Verified facts (2026-11-03)

- NEAR AI: base `https://cloud-api.near.ai`; `/v1/attestation/report` and `/v1/models` need no key. Send `provider=near`, `signing_algo=ecdsa`, `x-no-aliasing: true`. Run DCAP/NRAS checks sequentially and through `withNetworkRetry` (DNS here is intermittently flaky: ENOTFOUND).
- `z-ai/glm-5.3-flash` is a reasoning model: hidden reasoning tokens count against `max_tokens`, so a tight cap returns an empty answer. Check `finishReason`/`usage.reasoningTokens` and leave headroom.
- Testnet deployment: contract `rerun.rerun-43f5f2.testnet`, token `tusdc.rerun-43f5f2.testnet`, owner `rerun-43f5f2.testnet`, Lab `rerun-lab-43f5f2.testnet`. Keys in `.env.testnet`, which loads before `.env` so empty template lines cannot hide them. A contract state-layout change needs a fresh account or a migration.
- DNS outages here can last over a minute. Views retry through `withNetworkRetry`; transactions retry only on DNS failures, because a timed-out call may have landed.
- NEAR Connect's testnet list offers Meteor, Intear, Ledger, Nightly, Ethereum wallets and NEAR CLI; NEAR Mobile, HOT and MyNearWallet are not listed on testnet. Recheck on mainnet.
- zod 4 runs later refinements even after an earlier one fails, so a refinement must not throw on invalid input.
- In heredoc Python and printf, `\n` and `\r` can become real control characters. Use a Write-tool file for scripts that contain them.
- `/v1/models` has no TEE flag; `owned_by: "nearai"` plus a passing attestation is what counts. `Qwen/Qwen3.8-27B` (re-run model) attests fine.
- jose's default JWKS timeout (5 s) is too short on this network; use `timeoutDuration`.
- If `docker` is not found in a session started before the install, its binary is in `C:\Program Files\Docker\Docker\resources\bin`.
- Testnet RPC `https://test.rpc.fastnear.com`; faucet `POST https://helper.nearprotocol.com/account {newAccountId, newAccountPublicKey}`.
- near-api-js 7.4.0 (single package); near-sdk 5.29.1 used (5.30.0 exists, Rust 1.95+); cargo-near 0.22.0.
- Windows limits: near-sandbox does not run (Linux/macOS only) and cargo-near's ABI step fails to link, so build with `--no-abi`. `aws-lc-sys` (via near-sdk unit-testing) needs the `prebuilt-nasm` feature, set as a dev-dependency.
- In `require!(cond, format!(..))` the message is built even when `cond` holds: never do arithmetic in it that can overflow.
- `rerun.wasm` is ~475 KB, about 4.75 NEAR of storage to deploy. Reduce before mainnet.

## Ask the human first

Spending money, paid cloud resources (Phala CVM), mainnet deploys, creating NEAR accounts or signing transactions, pushing / making the repo public, posting on X, submitting the form.
