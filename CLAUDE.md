# CLAUDE.md

RERUN: NEAR Hackathon 2026 entry. The full spec is the human's build plan (`RERUN_BUILD_PLAN.md`; a local copy may sit at the repo root, untracked); follow its build order. Rules: https://nearhackathon.com/HACKATHON.md (re-read before submitting).

## Commands

- `pnpm install`, `pnpm test` (all packages, offline, `MOCK_LLM`-safe), `pnpm typecheck`
- `pnpm nearai:hello`: live NEAR AI attestation (+ chat and signature with an API key)
- `pnpm testnet:accounts`: creates faucet-funded testnet accounts into `.env.testnet`
- `pnpm sandbox:build` (Docker images), `MOCK_LLM=1 pnpm lab:run all` (demo claims, no credits), `pnpm lab:run <name> [--rerun]` (real private model)
- `DOCKER_TESTS=1 pnpm --filter @rerun/orchestrator test` adds real-container isolation tests
- After changing specs, receipts or demo claims: `MOCK_LLM=1 pnpm lab:run all && pnpm --filter @rerun/orchestrator export:vectors`, then `pnpm test:contracts`
- `pnpm deploy:testnet` (idempotent; `pnpm deploy` is pnpm's own command), `pnpm demo [names] [--resume]` (end to end on testnet), `pnpm lab:watch` (Lab loop)
- `pnpm web` (site on :3000), `pnpm seed` (open markets with odds). `pnpm lab:watch` also serves the Lab's API on :8787
- `pnpm test:contracts` (cargo unit + property tests), `pnpm build:contracts` (testnet wasm into `contracts/target/near/`)
- Mainnet contract build: `cd contracts/rerun && cargo near build non-reproducible-wasm --no-abi --no-default-features` (drops `register_lab_local`)

## Conventions

- pnpm 12 workspace; TypeScript runs directly via `tsx`/`vitest` (`.ts` import specifiers, no build step).
- Pin exact dependency versions. pnpm enforces a minimum release age; prefer an older release to excluding a fresh one.
- App name lives only in `packages/shared/src/config.ts` (`APP_NAME`).
- Every LLM call goes through `LlmClient` in `lab/orchestrator/src/nearai/client.ts` (token/call/daily caps, spend log, `MOCK_LLM=1`).
- Only NEAR-hosted private models (`owned_by: "nearai"` in `/v1/models`). Default `z-ai/glm-5.3-flash`; re-runs use a different one.
- The deterministic comparator decides outcomes, never the LLM. It exists twice and must stay identical: `contracts/rerun/src/math.rs` and `packages/shared/src/decimal.ts`.
- ClaimSpec metric values are decimal strings (`"0.912"`), never JSON floats; the contract rejects floats and non-canonical JSON.
- Contracts: Cargo workspace in `contracts/`, scaffolded with `cargo near new`, Rust pinned to 1.93.0 by `contracts/rust-toolchain.toml`, near-sdk 5.29.1. Unit tests use near-sdk's mocked chain (`testing_env!`).
- Research code never shares a container with keys. `Sandbox` (`lab/orchestrator/src/sandbox/`) passes no environment in; the network is off during the run phase.
- Repair edits go through `checkEdit` in `lab/orchestrator/src/pipeline/guards.ts`; when loosening it, add a test showing science still cannot change.
- Private-data claims: nothing derived from the run may reach the LLM, stream, stored logs or receipt tail. `pipeline.test.ts` greps for leaks.
- Web: `@rerun/shared/browser` is the browser-safe entry point (no `node:crypto`). Design rules: quadrille paper, Besley for claims, Spline Sans Mono for readings, sentence case; the stamp is the one loud element. Bar any new animation that isn't a response to the user or the verdict.
- Automated UI tests sign via `localStorage["rerun.test-wallet"]="1"` and `/api/dev-test-wallet`, which is dev-only and localhost-only. Never put a private key in a browser tool call.
- Evidence checks (`lab/orchestrator/src/pipeline/evidence.ts`) run after the verdict is fixed and must never settle a market. A failure there only marks the check incomplete. The re-implementation prompt must never contain the reported number or data values.
- Site copy: plain words. Say claim, forecast, holds up, allowed margin, fingerprint, collect, secure hardware; keep the technical terms for the technical sections. Terms and meanings are listed on `/how`.
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
