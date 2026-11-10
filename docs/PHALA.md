# The Lab on Phala Cloud

The Lab runs in an Intel TDX confidential VM (a dstack CVM) on Phala Cloud. Its NEAR key is made inside that hardware and never exists anywhere else, and a hardware quote ties that key to the exact code running. The owner checks the quote and registers the Lab on NEAR with the code's fingerprint and the attestation's fingerprint. Anyone can fetch the same attestation and check it again.

## How it fits together

| Piece | Where |
|---|---|
| Lab image (Node, the orchestrator, the docker CLI, no secrets) | `lab/deploy/Dockerfile.lab` |
| What the CVM runs; its sha256 is the Lab's codehash | `lab/deploy/docker-compose.phala.yml` |
| Start-up inside the CVM: derives keys, gets the quote, pulls pinned sandboxes, runs the Lab | `lab/orchestrator/scripts/tee-start.ts` (`pnpm lab:tee`) |
| Keys and quote from the guest agent (`/var/run/dstack.sock`) | `lab/orchestrator/src/tee/dstack.ts` |
| The published attestation | `GET <lab url>/tee/attestation` |
| Checking it: DCAP quote, key binding, measured compose hash, images pinned by digest | `lab/orchestrator/src/tee/verify.ts` |
| Registering it on NEAR | `pnpm phala:register <lab url> [--send]` → `approve_codehash`, `register_lab_attested` |
| On-chain record | `get_lab(lab)` (codehash) and `get_lab_attestation(lab)` (attestation fingerprint) |
| Images, built by GitHub Actions | `.github/workflows/images.yml` |

**Sandboxed reruns inside the CVM.** The Lab container mounts the CVM's Docker socket and starts one sandbox container per run, as it does on a PC: no environment passed in, files through named volumes and stdin, the network off while research code runs. Phala's own examples mount the Docker socket the same way. The sandbox images are pinned by digest in the compose file, so the codehash covers them too.

**Why the quote is checked off-chain.** Verifying a TDX quote inside the contract would multiply its size and its storage cost. The owner checks it with the same DCAP verifier the Lab already uses for NEAR AI's attestations, then records both fingerprints on-chain, where anyone can compare them with the Lab's live attestation.

## What it costs

Plan: `tdx.medium`, 2 vCPU and 4 GB, at $0.116 an hour, running non-stop from Nov 12, 08:00 Lagos through judging. Phala gives $5 of credit (their docs saying $20 were out of date), and the rest goes on your card:

| Runs until | Hours | Cost | On your card |
|---|---|---|---|
| Nov 19, 00:00 UTC (end of judging, Nov 18) | 161 | $18.70 | $13.70 |
| Nov 19, 23:59 Lagos (end of Nov 19) | 184 | $21.30 | $16.30 |

Deleting the CVM stops the charges at once. Turn off Auto-topup in Phala's billing page: with it on, Phala charges $20 whenever the balance drops below $5. Post-paid charges your card each time $5 of usage builds up, which keeps the Lab running past the credit. The default 20 GB disk is enough: the three images come to about 6 GB.

A claim's sandbox is capped at 3 GB of memory and 2 CPUs on this machine (`SANDBOX_MAX_MEM_GB`, `SANDBOX_MAX_CPUS` in the compose file), so a big run can't starve the Lab. Most claims ask for 4 GB. If a run fails for lack of memory (exit code 137 in the Lab's log), I'll tell you, and we size up to `tdx.large` ($0.232 an hour). That changes only the machine, not the codehash.

There's no test run on Nov 11 in this budget. The first start on Nov 12 is the test: deploy by 08:00 Lagos, register by 10:00, and claim 37 locks at 15:00 Lagos.

## What you click

Nothing here is paid until step 5, and I'll ask before that.

1. **Images.** Done Nov 9: the Images workflow (run #1, commit `e18100e`) built all three.
2. **Make the images pullable.** Done Nov 9: all three packages are public, and each pulls anonymously by digest.
3. Done: the digests are in `lab/deploy/docker-compose.phala.yml`. Rebuilding an image changes its digest, so the compose file (and the codehash) changes with it.
4. **Phala account.** Sign in at https://cloud.phala.network, add your card under billing, and complete their verification.
5. **Deploy** (paid from here). CVMs page → **Deploy** (top right) → paste `lab/deploy/docker-compose.phala.yml` → KMS provider **Phala** → instance `tdx.medium` (2 vCPU, 4 GB), default 20 GB disk → under **Encrypted Secrets**, add:

   | Secret | Value |
   |---|---|
   | `TEE_LAB_ACCOUNT` | `rerun-tee-lab-43f5f2.testnet` (created from the faucet on first start, with the CVM's key as its only key) |
   | `TESTNET_CONTRACT_ACCOUNT` | `rerun.rerun-43f5f2.testnet` |
   | `NEARAI_CLOUD_API_KEY` | from your `.env` |
   | `LAB_PUBLIC_URL` | leave empty for now; set it after step 6 |
   | `ROLLING_DEMOS` | `1` to post the hourly demos from the CVM, empty to keep them on your PC |
   | `TESTNET_OWNER_ACCOUNT`, `TESTNET_OWNER_PRIVATE_KEY` | from `.env.testnet`, only if `ROLLING_DEMOS` is `1` (testnet key, encrypted to the CVM) |

   Click **Deploy**. It's running in 1 to 2 minutes.
6. **Public URL.** The CVM page shows `https://<app-id>-8787.dstack-pha-<node>.phala.network`. Set `LAB_PUBLIC_URL` to it (Encrypted Secrets → update; the codehash doesn't change), and in Vercel set `NEXT_PUBLIC_LAB_URL` to it.
7. I run `pnpm phala:register <url>` (signs nothing, prints every check), show you the output, then `--send` on testnet with your yes. The site's Lab page then shows the secure-hardware status, and your PC's Lab can stop.

Mainnet uses the same image with `NEAR_NETWORK=mainnet` and its own compose file, so its own codehash, registered by the mainnet owner after the same check. Every mainnet transaction waits for your yes.

## If something fails

- **The CVM can't start sandbox containers** (no Docker socket on that image): the fallback is to run the sandbox in the Lab container itself under a separate unprivileged user with no network namespace access. Weaker isolation from the Lab's keys, so I'd tell you before switching.
- **Quote check fails** on the TCB status: Phala's hardware is sometimes `OutOfDate` for a while after an Intel update. `phala:register` stops and says why; nothing is registered.
- **Logs:** CVM page → **Logs**, or `GET <lab url>/health`.
