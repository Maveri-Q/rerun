# What mainnet needs

Points mode for every claim, ONE money claim with a 5 USDC prize pool, and the gas-free relayer. Worked out on 2026-11-10 from the current mainnet build (`contracts/target/near/rerun-mainnet/rerun.wasm`, 507,750 bytes, sha256 `588aa60a…5f93`). Nothing has been spent, and no mainnet transaction has been sent: each one waits for your yes.

`<you>.near` below is your mainnet account. Storage on NEAR costs 1 NEAR per 100 KB.

## NEAR: 7.2

| What | NEAR | Comes back? |
|---|---|---|
| Contract code (507,750 bytes of storage) | 5.08 | Only if the contract account is deleted later |
| Contract account `rerun.<you>.near`, its state and margin | 0.22 | Mostly locked as storage |
| Lab account `lab.<you>.near`, with the secure hardware's key as its only key | 0.30 | What it doesn't spend on gas stays in it |
| Gas-free relayer account `relay.<you>.near` | 1.00 | What it doesn't spend stays in it |
| About 5 points claims, with their receipts | 0.40 | No, it pays for their storage |
| USDC registrations (the contract and a second forecasting account) | 0.01 | No |
| Second forecasting account, for the money video (`fan.<you>.near`) | 0.10 | What it doesn't spend stays in it |
| Your own gas: deploying, posting, settling, collecting | 0.09 | No |
| **Total** | **7.20** | Up to 1.4 stays spendable in the Lab, relayer and second accounts |

The contract is already built small (size- and link-time optimised). Turning off its overflow checks would save only about 17 KB, 0.17 NEAR, so it isn't worth the risk.

## USDC: 10

The contract's default money settings ask for a 10 USDC prize pool, a 10 USDC bond and a 2 USDC Lab fee. Before the money claim opens, one owner transaction (`set_mode_params`) lowers them to a 5 USDC prize pool minimum, a 2 USDC bond, a 0.5 USDC Lab fee and a 1 USDC minimum challenge bond.

| What | USDC | Comes back? |
|---|---|---|
| Prize pool (liquidity) | 5.00 | Yes, when the claim is final, give or take how the forecasts moved it |
| Creation bond | 2.00 | Yes, unless the claim itself was at fault |
| Lab fee | 0.50 | It goes to the Lab's fee account, which is yours |
| Two forecasts for the video, 1 USDC each way, from your account and the second one | 2.00 | The winning side takes the pot. Both accounts are yours, so it comes back |
| Spare | 0.50 | Yes, unused |
| **Total** | **10.00** | **All but cents**: each forecast pays a 1% fee, 0.8% into the prize pool (yours) and 0.2% to the treasury (also yours) |

The contract caps a prediction at 5 USDC and a claim at 50 USDC, with the prize pool counted.

## Phala for mainnet: about $1 more

The mainnet contract registers a Lab only with its secure-hardware attestation (there's no owner shortcut on mainnet), and the testnet CVM is tied to testnet by its compose file. So mainnet needs its own CVM, from `lab/deploy/docker-compose.mainnet.yml` (same images, `NEAR_NETWORK=mainnet`, so its own codehash).

It only has to run while mainnet claims are being rerun. Plan: lock the money claim and the mainnet points claims within one afternoon, start the mainnet CVM that morning, and delete it once they're settled. 8 hours on `tdx.medium` is $0.93. Keeping it running through judging instead would add about $17.

## Getting USDC onto your mainnet account

USDC on NEAR is the token `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (6 decimals). Compare that address with Circle's published list before funding.

1. Buy about 8 NEAR on an exchange and withdraw it to `<you>.near`, choosing the NEAR network. Send about 0.1 first to check the address, then the rest.
2. Then either withdraw 10 USDC from an exchange that offers "USDC on NEAR" as a network, or buy about 3 more NEAR and swap it for 10 USDC with NEAR Intents in a NEAR wallet that offers swaps. Either way, check the token's address matches the one above.

Prices move, so add both totals in your own currency when you buy.

## In order, each with your yes

1. Create `rerun.<you>.near` and deploy the mainnet build, calling `new` with you as owner, USDC as the token, you as treasury and Lab fee recipient.
2. Start the mainnet CVM. On first start it prints its public key and stops; create `lab.<you>.near` with that key as its only key, then restart it. Check its attestation and register it (`register_lab_attested`).
3. Create `relay.<you>.near`, fund it with 1 NEAR, and put its key in Vercel's server environment (`RELAYER_ACCOUNT`, `RELAYER_PRIVATE_KEY`), next to `NEXT_PUBLIC_NETWORK=mainnet`.
4. `set_mode_params` for money mode, register the contract with USDC, post the points claims, then post and fund the money claim.
5. The two forecasts for the video. After the verdict and its challenge window: finalize, then collect from both accounts.

## Before deploying

- [x] Limits in the contract: 5 USDC a prediction, 50 USDC a claim. Unit-tested, and the money cycle ran on testnet.
- [x] Gas-free relayer: checked end to end on testnet (`pnpm relay:check`).
- [ ] Decide whether to remove the contract account's key after deploying. The next step instead: upgrades through a multisig with a time delay.
- [ ] You've read the Terms page. I wrote it in plain words; it isn't legal advice.
