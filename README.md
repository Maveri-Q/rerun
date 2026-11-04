# RERUN

**A forecasting market on whether published research results reproduce, settled by an AI agent that actually re-runs the authors' code and data inside a TEE and posts a verifiable receipt on NEAR.**

> Status: early build (NEAR Hackathon 2026, step 5 of 10: a web app over the full testnet lifecycle, with extra evidence checks). The Lab does not run in a TEE yet and the site is not hosted yet. Sections marked _planned_ do not exist yet.

**Deployed on testnet:** market contract [`rerun.rerun-43f5f2.testnet`](https://testnet.nearblocks.io/address/rerun.rerun-43f5f2.testnet), collateral token [`tusdc.rerun-43f5f2.testnet`](https://testnet.nearblocks.io/address/tusdc.rerun-43f5f2.testnet), Lab `rerun-lab-43f5f2.testnet` (registered without TEE attestation, testnet only).

## The problem

The replication crisis: many published results don't hold up, and checking them takes humans months, so mostly nobody checks. AI coding agents can now reproduce a large share of computational papers. RERUN turns that into a live, trust-minimised market: people forecast whether a claim reproduces, and an attested AI Lab settles it by re-running the code.

## How it works

1. A research claim with pinned code + data becomes a market: _"Will 'Model X scores 91.2% on dataset Y' reproduce within ±1%?"_
2. People forecast YES/NO with collateral or free points.
3. At lock time the **Lab** (an agent in a Phala TEE, thinking with NEAR AI Cloud private models) fetches the exact commit and data, verifies hashes, repairs only environment problems, runs it in a sandbox, extracts the metric, and compares it to the claim **in deterministic code**.
4. The Lab posts a **Reproduction Receipt** on NEAR. A challenge window follows; then winners redeem.

Outcomes: `REPRODUCED` (YES wins), `NOT_REPRODUCED` and `BROKEN` (NO wins), `INVALID` (both sides redeem at 0.5).

## Try it

Requires Node ≥ 22.22.2 and pnpm 12 (`npm i -g pnpm@12`). Contract tests need Rust (the pinned 1.93.0 toolchain installs itself) and, to build wasm, [cargo-near](https://github.com/near/cargo-near). The Lab needs Docker.

1. `pnpm install`
2. `pnpm test`: see all tests pass with no network, keys or Docker: 193 TypeScript tests (comparator, private-data encryption, attestation checks against a recorded real NEAR AI report, repair guards, the reproduction pipeline, evidence checks, paper-only statistics against published tables, the Lab's HTTP server, browser sealing) and 56 contract tests (every market outcome, both challenge paths, attacks, stale refunds, points, money mode, FPMM property tests, and real Lab output replayed through the contract).
3. `pnpm nearai:hello`: see the NEAR AI Cloud attestation for the Lab's private model verified live:
   Intel TDX quote via DCAP, NVIDIA GPU evidence via NRAS (JWT verified against NVIDIA's keys), key + nonce binding in `report_data`, `MRCONFIGID` bound to the app compose, and the RTMR3 event-log replay, for both the gateway and the model TEE. Each line prints PASS/FAIL.
4. Optional: put `NEARAI_CLOUD_API_KEY` in `.env` (copy `.env.example`) and run `pnpm nearai:hello` again: it also sends one tiny private chat completion and verifies its ECDSA response signature against the attested model key.
5. `pnpm sandbox:build`, then `MOCK_LLM=1 pnpm lab:run all`: see six demo claims really execute in sandboxed containers, each printing its stages and a final table: `REPRODUCED`, `NOT_REPRODUCED` (deliberately misreported number), `REPRODUCED` after an environment repair (the diff is printed), `BROKEN` (unpublished dependency), `REPRODUCED` on encrypted private data, and `INVALID` (data swapped after creation). Takes about a minute and spends no credits.
6. With `NEARAI_CLOUD_API_KEY` set, `pnpm lab:run all`: the same claims, but NEAR AI's private model makes the repair decisions and writes the reports, and every reply is checked against an attested key. About $0.003.
7. With your own testnet accounts (`pnpm testnet:accounts`, `pnpm build:contracts`, `pnpm deploy:testnet`), `pnpm demo`: see every claim go through create → trade → lock → Lab run → receipt on-chain → finalize → redeem on testnet, with PASS/FAIL checks and explorer links. One market uses tUSDC through `ft_transfer_call` and ends with a withdrawal. Takes about 10 minutes. `pnpm lab:watch` runs the Lab as a loop against the contract.

8. `pnpm lab:watch` in one terminal and `pnpm web` in another, then open http://localhost:3000: see claims read live from testnet. Connect a testnet wallet, claim free points, and buy YES or NO on an open claim to see the odds move. Open a finished claim and its receipt to see the evidence ladder, and your browser re-checking the result in the "Verified" panel. Open **Check a paper** and click **Try an example** to see printed statistics checked with no code, wallet or AI. On a market about to lock, stay on the page to watch the Lab's stages stream live and the verdict stamp land.

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

## The Lab (`lab/`)

Each run follows the same stages: attest the private model → fetch the pinned commit → verify every data hash → install dependencies → decrypt private data if any → run with the network off → repair the environment if needed → extract the metric → compare in code → write the report and receipt.

- **Isolation:** research code runs in throwaway containers holding only the run's workspace: no secrets or environment passed in, non-root, all capabilities dropped, read-only system, CPU, memory, PID and time limits. `DOCKER_TESTS=1 pnpm --filter @rerun/orchestrator test` checks these against real containers.
- **The LLM cannot change the science.** It can propose environment patches (at most 3 rounds), which pass through code guards: no changed numbers, no analysis or output vocabulary, no data or output files, no packages from arbitrary sources. Every applied patch goes in the receipt; rejected ones are never applied. It can suggest where a metric lives, but code reads the value.
- **No attested model, no run.** The model's TEE is verified before work starts and each reply's signature afterwards. A failure stops the run.
- **Private data:** sealed to the Lab's X25519 key and decrypted only after setup has finished. Once it is in the workspace, the network stays off and no logs or outputs reach the LLM, the stream or the receipt. Only hashes and the result leave, and the workspace is deleted afterwards. Failures on private claims therefore get no AI repair.

Current limits: dependencies install with unrestricted network during setup (no secrets or private data are present yet; registry-only egress filtering is planned). Local runs have no TEE, so private-data confidentiality there is only as strong as the host, until the Phala deployment. Demo claims are labelled fixtures with `.invalid` URLs that resolve to local files, so the hosted Lab will need them published. The real-claim fetcher is tested against a public GitHub repo, but no real paper has gone through the whole pipeline yet.

## Evidence beyond the verdict

A verdict shows that the authors' code and data produce their number. That can't prove the science is true, so receipts also show how much evidence stands behind a result. **None of these extra checks can change who wins a market.**

| Check | What it does | Needs |
|---|---|---|
| **Paper-only check** | Recalculates p-values from the statistics printed in a paper, and flags averages impossible for whole-number data (the GRIM test). Runs entirely in the browser. | Only the paper's text |
| **Stress test** | Re-runs the unchanged code with shifted random seeds and on resampled CSV data, to see if the number depends on luck. | Public data |
| **Rebuilt from the description (experimental)** | An AI writes its own analysis from the methods section, in a fresh workspace with the data but not the authors' code and with the published number hidden. Plain code reads its result. | Python, public data, a methods section |

The evidence file's hash sits inside the written report, and the report's hash is on-chain, so neither can be changed later. A flag or a difference means someone should look, not that the paper is wrong. The rebuild is limited to simple analyses, and its success rate on real papers hasn't been measured. Replication on new data and requesting missing code from authors are not built.

The demos show why this matters: the `reproduces` claim gets 0.93 with the authors' seed, but mostly 0.88 to 0.90 with other random splits, so it reproduces and is flagged as partly luck.

## The web app (`web/`)

Next.js, reading directly from the contract, with wallets through NEAR Connect. Claims with live odds and a run feed; a market page with the odds chart, trading, the live re-run, challenges and redemption; a guide and glossary; a paper-only check; a create wizard where the AI drafts a claim from a GitHub repo and you confirm it, with technical fields folded away (private files are encrypted in the browser before upload); receipts with a panel that recomputes the checks in your browser; the Lab's attestation details; portfolio; and a points leaderboard.

The browser re-checks what it can itself: the claim hash, the data hashes, the patch kinds and the verdict arithmetic. The secure-hardware line for the Lab shows a note, not a pass, until the Lab runs in a TEE.

## Repo layout

```
contracts/rerun/    Rust market contract: specs, FPMM, lifecycle, receipts, points, lab registry
contracts/mock-ft/  tUSDC: testnet NEP-141 collateral with an open faucet
lab/orchestrator/   TypeScript Lab: reproduction pipeline, repair guards, NEAR AI client, attestation
lab/sandbox/        Sandbox images for untrusted research code (Python 3.11, R 4.4)
claims/demo/        Six labelled demo claims with synthetic data
web/                Next.js app: claims, trading, live re-runs, receipts, create wizard
packages/shared/    APP_NAME, ClaimSpec/Receipt schemas, canonical JSON + sha256, comparator, sealing
scripts/            testnet accounts, deploy, seed, end-to-end demo (planned: judge-demo, attack-demo)
docs/               planned: ARCHITECTURE, MECHANISM, THREAT_MODEL, SOURCES, ADOPTION
```

## NEAR tech used

- **NEAR AI Cloud** private inference, with model + gateway attestation and per-response signature verification.
- **NEP-141** collateral and **NEP-297** events in the market contract (near-sdk 5.29).
- _Planned:_ Shade Agents on Phala Cloud (TEE Lab), NEAR Intents funding.

## Limitations

Reproduction is not replication: RERUN checks that the published code and data produce the published number, not that the science is true.

## Built with

near-sdk, near-contract-standards, uint, proptest, near-api-js, Next.js, React, near-connect-hooks, @noble/curves, zod, scikit-learn and the scientific Python/R stack in the sandbox, @phala/dcap-qvl, ethers, jose, dotenv, vitest, tsx. Code written with Claude Code during the hackathon window (from 2026-10-19).

## License

MIT, see [LICENSE](LICENSE).
