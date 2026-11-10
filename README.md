<p><img src="web/public/brand/mark.svg" width="96" height="96" alt="Logo: two ticks, the paper's claim and the Lab's rerun"></p>

# RERUN

*Checked twice.*

**A forecasting market on whether published research holds up. People predict the result, then the Lab, an AI agent, reruns the result from public code and data and posts a receipt on NEAR that anyone can check.**

Other truth markets trust an AI's opinion. We run the researchers' own code.

**Live site:** https://rerun-silk.vercel.app (NEAR testnet, free points) · **Video:** _link coming_

## What the Lab found

Published results, rerun from public code and data. The forecast price never changes a verdict: plain code compares the Lab's number with the paper's, within a margin fixed before anyone forecast.

| Question | What happened | Proof |
|---|---|---|
| [Does high government debt kill growth?](https://rerun-silk.vercel.app/market/26) | The study said rich countries with very high government debt stop growing. The Lab reran it: ✗ different result. Paper -0.1, the Lab 2.168. _Critics' code on the authors' data._ | [Receipt](https://rerun-silk.vercel.app/receipt/26/0) |
| [Do referees give dark-skinned footballers more red cards?](https://rerun-silk.vercel.app/market/28) | The study gave 29 teams the same football data, and their middle answer was that dark-skinned players get red cards at 1.31 times the odds. The Lab reran it: ✓ same result. Paper 1.31, the Lab 1.31. _Independent rebuild._ | [Receipt](https://rerun-silk.vercel.app/receipt/28/0) |
| [Does the name on a CV change who gets a callback?](https://rerun-silk.vercel.app/market/29) | The study said CVs with white-sounding names got 50% more callbacks than similar CVs with Black-sounding names. The Lab reran it: ✓ same result. Paper 1.50, the Lab 1.497. _Independent rebuild._ | [Receipt](https://rerun-silk.vercel.app/receipt/29/0) |
| [How much psychology research holds up when it's repeated?](https://rerun-silk.vercel.app/market/30) | The study repeated about 100 psychology studies, and said only 36% got a significant result again. The Lab reran it: ✓ same result. Paper 36, the Lab 36.08. _Independent rebuild._ | [Receipt](https://rerun-silk.vercel.app/receipt/30/0) |
| [Does raising the minimum wage cost jobs?](https://rerun-silk.vercel.app/market/27) | The study said raising New Jersey's minimum wage didn't cost fast-food jobs. The Lab reran it: ✓ same result. Paper 2.76, the Lab 2.754. _Independent rebuild._ | [Receipt](https://rerun-silk.vercel.app/receipt/27/0) |
| [Do small classes help young children learn?](https://rerun-silk.vercel.app/market/33) | The study said first graders put in small classes scored about 8.6 percentile points higher. The Lab reran it: ✓ same result. Paper 8.57, the Lab 8.515. _Independent rebuild._ | [Receipt](https://rerun-silk.vercel.app/receipt/33/0) |
| [Do better-looking professors get better student ratings?](https://rerun-silk.vercel.app/market/31) | The study said better-looking professors get higher student ratings. The Lab reran it: ✓ same result. Paper 0.275, the Lab 0.2748. _Independent rebuild._ | [Receipt](https://rerun-silk.vercel.app/receipt/31/0) |
| [Does temperature explain how much water forests lose after a wildfire?](https://rerun-silk.vercel.app/market/20) | The study said temperature explains about 15% of how much water northern forests lose after a fire. The Lab reran it: ✓ same result. Paper 0.1495, the Lab 0.1495. _Authors' own code._ | [Receipt](https://rerun-silk.vercel.app/receipt/20/0) |
| [Does the brain's wiring predict where Parkinson's spreads? A separate rebuild](https://rerun-silk.vercel.app/market/21) | The study said the brain's wiring predicts where Parkinson's-like damage spreads in mice. The Lab reran it: ✓ same result. Paper 0.696, the Lab 0.6961. _Independent rebuild._ | [Receipt](https://rerun-silk.vercel.app/receipt/21/0) |
| [Does a 1991 model get the timing of a forest pest right?](https://rerun-silk.vercel.app/market/22) | A 1991 study gave one number for how a forest pest develops as the season warms. The Lab reran it: ✓ same result. Paper -0.0457, the Lab -0.0456. _Independent rebuild._ | [Receipt](https://rerun-silk.vercel.app/receipt/22/0) |
| [Does a 1986 figure for a forest pest's timing hold up?](https://rerun-silk.vercel.app/market/23) | A 1986 study gave one number for how spread out a forest pest's development is. The Lab couldn't get a fair rerun, so there's no verdict. _Independent rebuild._ | [Receipt](https://rerun-silk.vercel.app/receipt/23/0) |
| [Does the brain's wiring predict where Parkinson's spreads?](https://rerun-silk.vercel.app/market/24) | The study said the brain's wiring predicts where Parkinson's-like damage spreads in mice. The Lab reran it: ✓ same result. Paper 0.696, the Lab 0.6961. _Authors' own code._ | [Receipt](https://rerun-silk.vercel.app/receipt/24/0) |

Most of these are settled showcases: posted with the result already known, marked as such on their pages, and with no forecasting. Open claims for new papers ([37](https://rerun-silk.vercel.app/market/37), [38](https://rerun-silk.vercel.app/market/38)) lock on Nov 12 and Nov 16 and are rerun only after forecasting closes.

## How it works

1. A published result becomes a claim: the exact code commit, data fingerprints, the paper's number and the allowed margin, all hashed on-chain.
2. People forecast whether it holds up, with free points (or, on mainnet, a little USDC).
3. When forecasting closes, the Lab fetches the pinned code and data, checks every fingerprint, and runs it in a sealed container with the internet cut off. An AI may fix setup problems, like a missing package. Code guards stop it touching numbers, analysis or data, and every change goes in the receipt.
4. Plain code reads the number and compares it. The AI never decides a verdict, and the contract re-checks the comparison itself.
5. The receipt goes on NEAR. Anyone can challenge it for a while, which makes the Lab rerun it independently with a different AI. Then winners collect.

Outcomes: ✓ holds up (YES wins), ✗ doesn't hold up or the code didn't finish (NO wins), ⚠ inconclusive (every share pays back half).

## Why you can trust a verdict

**No one, not even us, can change a verdict or the payouts.** The contract has no method that alters a final result, and a result only becomes final through the receipt checks and the challenge window. One caveat, stated plainly: until the contract account's own key is removed, whoever holds it could deploy different code. That key is still there on testnet, because we're still building. Next: upgrades move to a multisig with a time delay.

- **Check it yourself:** [`pnpm verify-claim <id>`](scripts/verify-claim.ts) reruns a claim on your own computer and compares it with the receipt on NEAR.
- **The model is private and attested:** the Lab thinks with NEAR AI Cloud private models. It verifies the model's secure-hardware attestation before a run ([`attestation.ts`](lab/orchestrator/src/nearai/attestation.ts)), and every reply's signature after it ([`signature.ts`](lab/orchestrator/src/nearai/signature.ts)).
- **Other apps can settle on it:** `get_verdict(claim_id)` is a public view. [`contracts/verdict-bet`](contracts/verdict-bet/src/lib.rs) is a tiny contract that settles its own bet from it, with nobody telling it who won. [It ran on testnet](https://testnet.nearblocks.io/txns/BqzmVEaGC8Uucg6ac3Fh5Wp1AofBpXwT3GhhsPVNhHaY).
- **Forecasting costs no gas in points mode:** the wallet signs a NEP-366 delegate action and RERUN's relayer submits it, paying the gas and any storage, within a daily limit per account ([`relay.ts`](web/lib/relay.ts)). A brand-new account claimed its points and forecast without spending any NEAR: [claim points](https://testnet.nearblocks.io/txns/G5waPhuqZgPQhhYCsbmC52coq8Jt8pmzgS1ttvinnrrx), [forecast](https://testnet.nearblocks.io/txns/3RKCC9bRJCWk9T2KPqmTxRojvHMLCzAAr1wr5wT8oAge) (`pnpm relay:check`). Wallets that can't sign one fall back to an ordinary transaction.
- **Forecasters have a track record:** an accuracy score (Brier) per account, stored on-chain ([`accuracy.rs`](contracts/rerun/src/accuracy.rs), shown on the [leaderboard](https://rerun-silk.vercel.app/leaderboard)). Metaculus and Replication Markets score forecasters the same way.

**Deployed on testnet:** market contract [`rerun.rerun-43f5f2.testnet`](https://testnet.nearblocks.io/address/rerun.rerun-43f5f2.testnet), Lab [`rerun-lab-43f5f2.testnet`](https://testnet.nearblocks.io/address/rerun-lab-43f5f2.testnet), test collateral [`tusdc.rerun-43f5f2.testnet`](https://testnet.nearblocks.io/address/tusdc.rerun-43f5f2.testnet).

## Coming next

- The Lab runs inside secure hardware on Phala Cloud, with its code fingerprint and attestation registered on NEAR. Built and tested ([`tee/`](lab/orchestrator/src/tee), [`docs/PHALA.md`](docs/PHALA.md)); it goes live on Nov 12.
- Mainnet: points mode and one money claim, with the gas-free relayer ([`docs/MAINNET_COSTS.md`](docs/MAINNET_COSTS.md)).
- The Lab agent pays for its own compute via NEAR Intents.
- A research reputation on claim pages, such as "3 of 4 checked results held up" for a paper's authors.
- Upgrades move to a multisig with a time delay.

## Questions judges ask

**Is this reproducing the original code, or independently validating the claim?**
Reproducing, wherever the authors' code is available: it tests whether their code and data give their number. Each claim is labelled "Authors' own code" or "Independent rebuild". A number that checks out doesn't prove the method is right, and every page has a "What we didn't check" box.

**Who sets the success threshold, and can it change after predictions?**
The claim's creator sets it when the claim opens, a person reviews it, and it's hashed into the on-chain spec. It can't change afterwards.

**What if the code fails or the data is missing?**
⚠ Inconclusive, with the reason shown, and every share pays back half. First the Lab installs the software as it was on the date of the code, with no AI. If that fails, an AI may try setup repairs. Running out of tries, or the AI giving up, is still Inconclusive. The AI never decides a verdict.

**How is malicious code kept in the sandbox?**
Research code runs in its own container, as a non-root user, with no secrets, CPU, memory and time limits, a read-only root, and the network cut off during the run. Keys stay in a separate process.

**What exactly is on NEAR, and how do I verify a receipt?**
The claim's spec, its fingerprint, the trades, and a receipt with the number, the verdict, hashes of the logs and every change made. To check one without trusting us, run `pnpm verify-claim <id>` on your own computer, or read `get_verdict` directly.

**Can the AI change the experiment? How are changes disclosed?**
Plain code rejects edits touching numbers, analysis or data. Every change is in the receipt, labelled AI, system or human.

**Conflicts of interest, disputes, inconclusive outcomes?**
Claim creators are shown on the page. Anyone can challenge a result for a limited time with a bond, which triggers a second, independent run with a different AI model; if the runs disagree the claim is Inconclusive. The market price never changes the verdict.

**Does AI repair work?**
Not proven yet. See `docs/REPAIR_BENCHMARK.md` for the measured score.

Science already proved reproducibility markets work. We built the part that settles them.

A TEE receipt proves the AI ran. Our receipt proves the science was checked, and anyone can check it again.

---

The rest is technical detail.

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
- **Lifecycle:** `Draft → Open → Locked → Running → Proposed → (Challenged → rerun) → Final`, then `redeem`. A silent Lab triggers `refund_stale` (INVALID, 0.5 per share), so funds are never stuck.
- **The comparator runs on-chain too:** a receipt claiming REPRODUCED/NOT_REPRODUCED must carry a `measured_value` whose comparison with the spec's reported value and tolerance gives that same outcome, or it is rejected.
- **Only approved Labs propose:** registered Lab account + approved codehash; revoking the codehash blocks it immediately. Receipts must match the market's spec hash, commit, data hashes, reported value and tolerance.
- **Challenges:** anyone can bond and challenge during the window; the Lab's independent rerun must use a different model. Agreement keeps the result (bond forfeited); disagreement makes the market INVALID and rewards the challenger from the creation bond.
- **Accuracy score:** every forecast stores the odds it moved a claim to, and `get_accuracy` works out that account's Brier score from what happened (0 is perfect, always saying 50% scores 0.25; inconclusive claims don't count). Scoring forecasters on their track record has precedent in Metaculus and Replication Markets. It's on the leaderboard and never touches a verdict.
- **Money limits while in beta:** at most 5 USDC a prediction and 50 USDC in a claim, enforced by the contract, plus the owner's pause, which can't stop anyone collecting.
- **Events:** NEP-297, standard `rerun`. Storage is charged to the caller and the excess refunded.

## The Lab (`lab/`)

Each run follows the same stages: attest the private model → fetch the pinned commit → verify every data hash → install dependencies → decrypt private data if any → run with the network off → repair the environment if needed → extract the metric → compare in code → write the report and receipt.

- **Isolation:** research code runs in throwaway containers holding only the run's workspace: no secrets or environment passed in, non-root, all capabilities dropped, read-only system, CPU, memory, PID and time limits. `DOCKER_TESTS=1 pnpm --filter @rerun/orchestrator test` checks these against real containers.
- **The LLM cannot change the science.** It can propose environment patches (at most 3 rounds), which pass through code guards: no changed numbers, no analysis or output vocabulary, no data or output files, no packages from arbitrary sources. Every applied patch goes in the receipt; rejected ones are never applied. It can suggest where a metric lives, but code reads the value.
- **No attested model, no run.** The model's TEE is verified before work starts and each reply's signature afterwards. A failure stops the run.
- **Private data:** sealed to the Lab's X25519 key and decrypted only after setup has finished. Once it is in the workspace, the network stays off and no logs or outputs reach the LLM, the stream or the receipt. Only hashes and the result leave, and the workspace is deleted afterwards. Failures on private claims therefore get no AI repair.

Current limits: dependencies install with unrestricted network during setup (no secrets or private data are present yet; registry-only egress filtering is planned). Local runs have no TEE, so private-data confidentiality there is only as strong as the host, until the Phala deployment. Demo claims are labelled fixtures with `.invalid` URLs that resolve to local files, so the hosted Lab will need them published. Published papers have gone through the whole pipeline: see the table at the top.

## Evidence beyond the verdict

A verdict shows that the authors' code and data produce their number. That can't prove the science is true, so receipts also show how much evidence stands behind a result. **None of these extra checks can change who wins a market.**

| Check | What it does | Needs |
|---|---|---|
| **Paper-only check** | Recalculates p-values from the statistics printed in a paper, and flags averages impossible for whole-number data (the GRIM test). Runs entirely in the browser. | Only the paper's text |
| **Stress test** | The Lab reruns the unchanged code with shifted random seeds and on resampled CSV data, to see if the number depends on luck. | Public data |
| **Rebuilt from the description (experimental)** | An AI writes its own analysis from the methods section, in a fresh workspace with the data but not the authors' code and with the published number hidden. Plain code reads its result. | Python, public data, a methods section |

The evidence file's hash sits inside the written report, and the report's hash is on-chain, so neither can be changed later. A flag or a difference means someone should look, not that the paper is wrong. The rebuild is limited to simple analyses, and its success rate on real papers hasn't been measured. Replication on new data and requesting missing code from authors are not built.

The demos show why this matters: the `reproduces` claim gets 0.93 with the authors' seed, but mostly 0.88 to 0.90 with other random splits, so it reproduces and is flagged as partly luck.

## The web app (`web/`)

Next.js, reading directly from the contract, with wallets through NEAR Connect. Claims with live odds and a run feed; a market page with the odds chart, trading, the live rerun, challenges and redemption; a guide and glossary; a paper-only check; a create wizard where the AI drafts a claim from a GitHub repo and you confirm it, with technical fields folded away (private files are encrypted in the browser before upload); receipts with a panel that recomputes the checks in your browser; the Lab's attestation details; portfolio; and a points leaderboard.

The browser re-checks what it can itself: the claim hash, the data hashes, the patch kinds and the verdict arithmetic. The secure-hardware line for the Lab shows a note, not a pass, until the Lab runs in a TEE.

## Repo layout

```
contracts/rerun/    Rust market contract: specs, FPMM, lifecycle, receipts, points, lab registry
contracts/mock-ft/  tUSDC: testnet NEP-141 collateral with an open faucet
lab/orchestrator/   TypeScript Lab: reproduction pipeline, repair guards, NEAR AI client, attestation
lab/sandbox/        Sandbox images for untrusted research code (Python 3.11, R 4.4)
claims/demo/        Six labelled demo claims with synthetic data
web/                Next.js app: claims, trading, live reruns, receipts, create wizard
packages/shared/    APP_NAME, ClaimSpec/Receipt schemas, canonical JSON + sha256, comparator, sealing
scripts/            testnet accounts, deploy, seed, end-to-end, challenge, attack and judge demos
docs/               sources, mainnet costs, the repair benchmark, old claims
```

## NEAR tech used

- **NEAR AI Cloud** private inference, with model + gateway attestation and per-response signature verification.
- **NEP-141** collateral and **NEP-297** events in the market contract (near-sdk 5.29).
- **NEP-366** meta-transactions for gas-free forecasts, and **NEAR Connect** for wallets.
- See [Coming next](#coming-next) for the Lab on Phala's secure hardware and NEAR Intents funding.

## Limitations

Reproduction is not replication: RERUN checks that the published code and data produce the published number, not that the science is true.

The contract account's key isn't removed yet, so an upgrade is still possible on testnet, and we've used it: new features went in that way, and existing claims and receipts read back unchanged. The accuracy score only counts forecasts made after it was added. Verdict links go to the contract's history on the explorer rather than one transaction, because past verdict transactions aren't indexed by claim. Links after you sign something go to that exact transaction.

## Built with

near-sdk, near-contract-standards, uint, proptest, near-api-js, Next.js, React, near-connect-hooks, @noble/curves, zod, scikit-learn and the scientific Python/R stack in the sandbox, @phala/dcap-qvl, ethers, jose, dotenv, vitest, tsx. Code written with Claude Code during the hackathon window (from 2026-10-19).

## License

MIT, see [LICENSE](LICENSE).

## Settling on our results

Building an AI encyclopedia with prediction markets? Use this to settle claims with evidence: the contract's public `get_verdict(claim_id)` returns the verdict and a receipt reference, and `GET /api/verdict/<id>` on the site returns the same.

## Run it yourself

<details><summary>Commands to run every part on your own computer</summary>

**Fastest:** with only Node ≥ 22.22.2 and pnpm 12 (`npm i -g pnpm@12`), run `pnpm install`, then `pnpm judge-demo`. It makes a throwaway testnet account, claims free points, makes a real forecast, re-checks a finished receipt itself, and tries to cheat, printing PASS or BLOCKED for each. If a Lab is reachable, it also opens a claim and watches it get rerun. No wallet, keys or Docker.

Everything else: Contract tests need Rust (the pinned 1.93.0 toolchain installs itself) and, to build wasm, [cargo-near](https://github.com/near/cargo-near). The Lab needs Docker.

1. `pnpm install`
2. `pnpm test`: see all tests pass with no network, keys or Docker: about 370 TypeScript tests (comparator, private-data encryption, attestation checks against a recorded real NEAR AI report, repair guards, the reproduction pipeline, evidence checks, paper-only statistics against published tables, the Lab's HTTP server, browser sealing) and 93 contract tests (every market outcome, both challenge paths, attacks, stale refunds, points, money mode, FPMM property tests, and real Lab output replayed through the contract).
3. `pnpm nearai:hello`: see the NEAR AI Cloud attestation for the Lab's private model verified live:
   Intel TDX quote via DCAP, NVIDIA GPU evidence via NRAS (JWT verified against NVIDIA's keys), key + nonce binding in `report_data`, `MRCONFIGID` bound to the app compose, and the RTMR3 event-log replay, for both the gateway and the model TEE. Each line prints PASS/FAIL.
4. Optional: put `NEARAI_CLOUD_API_KEY` in `.env` (copy `.env.example`) and run `pnpm nearai:hello` again: it also sends one tiny private chat completion and verifies its ECDSA response signature against the attested model key.
5. `pnpm sandbox:build`, then `MOCK_LLM=1 pnpm lab:run all`: see six demo claims really execute in sandboxed containers, each printing its stages and a final table: `REPRODUCED`, `NOT_REPRODUCED` (deliberately misreported number), `REPRODUCED` after an environment repair (the diff is printed), `BROKEN` (unpublished dependency), `REPRODUCED` on encrypted private data, and `INVALID` (data swapped after creation). Takes about a minute and spends no credits.
6. With `NEARAI_CLOUD_API_KEY` set, `pnpm lab:run all`: the same claims, but NEAR AI's private model makes the repair decisions and writes the reports, and every reply is checked against an attested key. About $0.003.
7. With your own testnet accounts (`pnpm testnet:accounts`, `pnpm build:contracts`, `pnpm deploy:testnet`), `pnpm demo`: see every claim go through create → trade → lock → Lab run → receipt on-chain → finalize → redeem on testnet, with PASS/FAIL checks and explorer links. One market uses tUSDC through `ft_transfer_call` and ends with a withdrawal. Takes about 10 minutes. `pnpm lab:watch` runs the Lab as a loop against the contract.

8. `pnpm lab:watch` in one terminal and `pnpm web` in another, then open http://localhost:3000: see claims read live from testnet. Connect a testnet wallet, claim free points, and buy YES or NO on an open claim to see the odds move. Open a finished claim and its receipt to see the evidence ladder, and your browser re-checking the result in the "Verified" panel. Open **Check a paper** and click **Try an example** to see printed statistics checked with no code, wallet or AI. On a market about to lock, stay on the page to watch the Lab's stages stream live and the verdict stamp land.

9. `pnpm challenge-demo` (needs the testnet accounts and Docker, with the Lab stopped): see a result challenged, then rerun independently with a different AI. The runs agree, so the challenger loses the deposit.
10. `pnpm attack-demo` (same needs): see 18 attacks and failure cases on testnet, including fake results, a banned Lab, an AI changing the science, swapped data, two runs that disagree, and a silent Lab. The contract attacks use scripted receipts, because the contract's rules are what's being tested.

</details>
