# RERUN

**A forecasting market on whether published research results reproduce, settled by an AI agent that actually re-runs the authors' code and data inside a TEE and posts a verifiable receipt on NEAR.**

> Status: early build (NEAR Hackathon 2026, step 1 of 10: setup + verified NEAR AI hello-world). Sections marked _planned_ do not exist yet.

## The problem

The replication crisis: many published results don't hold up, and checking them takes humans months, so mostly nobody checks. AI coding agents can now reproduce a large share of computational papers. RERUN turns that into a live, trust-minimised market: people forecast whether a claim reproduces, and an attested AI Lab settles it by re-running the code.

## How it works

1. A research claim with pinned code + data becomes a market: _"Will 'Model X scores 91.2% on dataset Y' reproduce within ±1%?"_
2. People forecast YES/NO with collateral or free points.
3. At lock time the **Lab** (an agent in a Phala TEE, thinking with NEAR AI Cloud private models) fetches the exact commit and data, verifies hashes, repairs only environment problems, runs it in a sandbox, extracts the metric, and compares it to the claim **in deterministic code**.
4. The Lab posts a **Reproduction Receipt** on NEAR. A challenge window follows; then winners redeem.

Outcomes: `REPRODUCED` (YES wins), `NOT_REPRODUCED` and `BROKEN` (NO wins), `INVALID` (both sides redeem at 0.5).

## Try it

Requires Node ≥ 22.22.2 and pnpm 12 (`npm i -g pnpm@12`).

1. `pnpm install`
2. `pnpm test`: see 23 passing tests (canonical JSON hashing, attestation checks against a recorded real NEAR AI report, signature checks, LLM cost caps). No network or keys needed.
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

## Repo layout

```
contracts/          Rust NEAR contracts (planned: rerun market + lab registry, mock-ft)
lab/orchestrator/   TypeScript Lab agent: NEAR AI client (single capped LLM wrapper), attestation
lab/sandbox/        planned: sandbox container for untrusted research code
web/                planned: Next.js app
packages/shared/    APP_NAME, canonical JSON + sha256 (spec_hash)
scripts/            testnet-accounts.ts (planned: deploy, seed, demo, judge-demo, attack-demo)
docs/               planned: ARCHITECTURE, MECHANISM, THREAT_MODEL, SOURCES, ADOPTION
```

## NEAR tech used

- **NEAR AI Cloud** private inference, with model + gateway attestation and per-response signature verification.
- _Planned:_ Shade Agents on Phala Cloud (TEE Lab), NEP-141 collateral, NEP-297 events, NEAR Intents funding.

## Limitations

Reproduction is not replication: RERUN checks that the published code and data produce the published number, not that the science is true.

## Built with

near-api-js, @phala/dcap-qvl, ethers, jose, dotenv, vitest, tsx. Code written with Claude Code during the hackathon window (from 2026-10-19).

## License

MIT, see [LICENSE](LICENSE).
