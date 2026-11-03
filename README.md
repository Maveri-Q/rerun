# RERUN

**A forecasting market on whether published research results reproduce, settled by an AI agent that actually re-runs the authors' code and data inside a TEE and posts a verifiable receipt on NEAR.**

> Status: early build (NEAR Hackathon 2026, step 2 of 10: market contract with full lifecycle and tests). Sections marked _planned_ do not exist yet.

## The problem

The replication crisis: many published results don't hold up, and checking them takes humans months, so mostly nobody checks. AI coding agents can now reproduce a large share of computational papers. RERUN turns that into a live, trust-minimised market: people forecast whether a claim reproduces, and an attested AI Lab settles it by re-running the code.

## How it works

1. A research claim with pinned code + data becomes a market: _"Will 'Model X scores 91.2% on dataset Y' reproduce within ±1%?"_
2. People forecast YES/NO with collateral or free points.
3. At lock time the **Lab** (an agent in a Phala TEE, thinking with NEAR AI Cloud private models) fetches the exact commit and data, verifies hashes, repairs only environment problems, runs it in a sandbox, extracts the metric, and compares it to the claim **in deterministic code**.
4. The Lab posts a **Reproduction Receipt** on NEAR. A challenge window follows; then winners redeem.

Outcomes: `REPRODUCED` (YES wins), `NOT_REPRODUCED` and `BROKEN` (NO wins), `INVALID` (both sides redeem at 0.5).

## Try it

Requires Node ≥ 22.22.2 and pnpm 12 (`npm i -g pnpm@12`). Contract tests need Rust (the pinned 1.93.0 toolchain installs itself) and, to build wasm, [cargo-near](https://github.com/near/cargo-near).

1. `pnpm install`
2. `pnpm test`: see all tests pass with no network or keys: 25 TypeScript tests (canonical JSON hashing, attestation checks against a recorded real NEAR AI report, signature checks, LLM cost caps) and 55 contract tests (every market outcome, both challenge paths, the attacks the contract must block, stale refunds, pause, storage, points, money mode, and 2,000-case FPMM property tests).
3. `pnpm nearai:hello`: see the NEAR AI Cloud attestation for the Lab's private model verified live:
   Intel TDX quote via DCAP, NVIDIA GPU evidence via NRAS (JWT verified against NVIDIA's keys), key + nonce binding in `report_data`, `MRCONFIGID` bound to the app compose, and the RTMR3 event-log replay, for both the gateway and the model TEE. Each line prints PASS/FAIL.
4. Optional: put `NEARAI_CLOUD_API_KEY` in `.env` (copy `.env.example`) and run `pnpm nearai:hello` again: it also sends one tiny private chat completion and verifies its ECDSA response signature against the attested model key.

_Planned:_ hosted site in points mode, `pnpm judge-demo` (zero-setup testnet lifecycle + attack demo).

## What is verified today

| Check | Where |
|---|---|
| Model is NEAR-hosted private TEE model (`owned_by: nearai`) | `lab/orchestrator/scripts/nearai-hello.ts` |
| Intel TDX quote + TCB status (DCAP, `@phala/dcap-qvl`), debug TDs rejected | `lab/orchestrator/src/nearai/attestation.ts` |
| `report_data` = signing address ‖ our fresh 32-byte nonce | same |
| `MRCONFIGID` = 0x01 ‖ sha256(app_compose) ‖ zeros | same |
| RTMR3 replayed from the event log | same |
| NVIDIA H100/H200 GPU evidence via NRAS, JWT signature checked | same |
| Response signature: `model:sha256(request):sha256(response)` signed by the attested key | `lab/orchestrator/src/nearai/signature.ts` |

## The contract (`contracts/rerun`)

- **Claims:** the ClaimSpec is stored on-chain as canonical JSON (sorted keys, no whitespace); `spec_hash = sha256` of those bytes. The contract rejects non-canonical input, so the stored bytes are exactly the hashed bytes. Metric values are decimal strings, never floats.
- **Markets:** binary FPMM (Gnosis/Omen style), integer maths with every rounding in the pool's favour. 1% fee: 0.8% to LPs through a per-share accumulator (so fees never move the price), 0.2% to the treasury. Slippage guards on every trade.
- **Two modes:** money (NEP-141 collateral via `ft_transfer_call`; tUSDC on testnet) and points (1,000 free, non-transferable points per account; leaderboard = forecaster reputation).
- **Lifecycle:** `Draft → Open → Locked → Running → Proposed → (Challenged → re-run) → Final`, then `redeem`. A silent Lab triggers `refund_stale` (INVALID, 0.5 per share), so funds are never stuck.
- **The comparator runs on-chain too:** a receipt claiming REPRODUCED/NOT_REPRODUCED must carry a `measured_value` whose comparison with the spec's reported value and tolerance gives that same outcome, or it is rejected.
- **Only approved Labs propose:** registered Lab account + approved codehash; revoking the codehash blocks it immediately. Receipts must match the market's spec hash, commit, data hashes, reported value and tolerance.
- **Challenges:** anyone can bond and challenge during the window; the Lab's independent re-run must use a different model. Agreement keeps the result (bond forfeited); disagreement makes the market INVALID and rewards the challenger from the creation bond.
- **Events:** NEP-297, standard `rerun`. Storage is charged to the caller and the excess refunded.

## Repo layout

```
contracts/rerun/    Rust market contract: specs, FPMM, lifecycle, receipts, points, lab registry
contracts/mock-ft/  tUSDC: testnet NEP-141 collateral with an open faucet
lab/orchestrator/   TypeScript Lab agent: NEAR AI client (single capped LLM wrapper), attestation
lab/sandbox/        planned: sandbox container for untrusted research code
web/                planned: Next.js app
packages/shared/    APP_NAME, canonical JSON + sha256 (spec_hash)
scripts/            testnet-accounts.ts (planned: deploy, seed, demo, judge-demo, attack-demo)
docs/               planned: ARCHITECTURE, MECHANISM, THREAT_MODEL, SOURCES, ADOPTION
```

## NEAR tech used

- **NEAR AI Cloud** private inference, with model + gateway attestation and per-response signature verification.
- **NEP-141** collateral and **NEP-297** events in the market contract (near-sdk 5.29).
- _Planned:_ Shade Agents on Phala Cloud (TEE Lab), NEAR Intents funding.

## Limitations

Reproduction is not replication: RERUN checks that the published code and data produce the published number, not that the science is true.

## Built with

near-sdk, near-contract-standards, uint, proptest, near-api-js, @phala/dcap-qvl, ethers, jose, dotenv, vitest, tsx. Code written with Claude Code during the hackathon window (from 2026-10-19).

## License

MIT, see [LICENSE](LICENSE).
