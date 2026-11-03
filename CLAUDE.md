# CLAUDE.md

RERUN: NEAR Hackathon 2026 entry. The full spec is the human's build plan (`RERUN_BUILD_PLAN.md`; a local copy may sit at the repo root, untracked); follow its build order. Rules: https://nearhackathon.com/HACKATHON.md (re-read before submitting).

## Commands

- `pnpm install`, `pnpm test` (all packages, offline, `MOCK_LLM`-safe), `pnpm typecheck`
- `pnpm nearai:hello`: live NEAR AI attestation (+ chat and signature with an API key)
- `pnpm testnet:accounts`: creates faucet-funded testnet accounts into `.env.testnet`

## Conventions

- pnpm 12 workspace; TypeScript runs directly via `tsx`/`vitest` (`.ts` import specifiers, no build step).
- Pin exact dependency versions. pnpm enforces a minimum release age; prefer an older release to excluding a fresh one.
- App name lives only in `packages/shared/src/config.ts` (`APP_NAME`).
- Every LLM call goes through `LlmClient` in `lab/orchestrator/src/nearai/client.ts` (token/call/daily caps, spend log, `MOCK_LLM=1`).
- Only NEAR-hosted private models (`owned_by: "nearai"` in `/v1/models`). Default `z-ai/glm-5.3-flash`; re-runs use a different one.
- The deterministic comparator decides outcomes, never the LLM.
- Secrets only in `.env` / `.env.testnet` (gitignored). Check history for keys before any push.

## Verified facts (2026-11-03)

- NEAR AI: base `https://cloud-api.near.ai`; `/v1/attestation/report` and `/v1/models` need no key. Send `provider=near`, `signing_algo=ecdsa`, `x-no-aliasing: true`. Run DCAP/NRAS checks sequentially and through `withNetworkRetry` (DNS here is intermittently flaky: ENOTFOUND).
- `z-ai/glm-5.3-flash` is a reasoning model: hidden reasoning tokens count against `max_tokens`, so a tight cap returns an empty answer. Check `finishReason`/`usage.reasoningTokens` and leave headroom.
- Testnet RPC `https://test.rpc.fastnear.com`; faucet `POST https://helper.nearprotocol.com/account {newAccountId, newAccountPublicKey}`.
- near-api-js 7.4.0 (single package); near-sdk 5.30.0 (Rust 1.95+), cargo-near 0.22.0 stable, near-workspaces (Rust) 0.24.0.

## Ask the human first

Spending money, paid cloud resources (Phala CVM), mainnet deploys, creating NEAR accounts or signing transactions, pushing / making the repo public, posting on X, submitting the form.
