# What mainnet needs

Points mode for every claim, ONE money claim with a 5 USDC prize pool, and the gas-free relayer. Worked out on 2026-11-10 from the current mainnet build (`contracts/target/near/rerun-mainnet/rerun.wasm`, 507,750 bytes, sha256 `588aa60a…5f93`). Nothing has been spent, and no mainnet transaction has been sent: each one waits for your yes.

## Accounts

| Account | What it is |
|---|---|
| `949cfd9f7fc89f982907b1d634508fa002949e5b06509147c799e56ef6556bfd` | Funding address: send the NEAR you buy here, on the NEAR network. Its key is in `.env` (`MAINNET_OWNER_PRIVATE_KEY`). |
| `rerun-app.near` | Home: owner, treasury and Lab fee recipient, same key. Created from the funding address, which moves its NEAR here. |
| `market.rerun-app.near` | The contract |
| `lab.rerun-app.near`, `relay.rerun-app.near`, `fan.rerun-app.near` | The Lab, the gas-free relayer, the second forecasting account |

`pnpm mainnet <step>` prints each transaction and sends it only with `--send` (steps at the top of `scripts/mainnet.ts`). Storage on NEAR costs 1 NEAR per 100 KB.

## NEAR: 7.2

| What | NEAR | Comes back? |
|---|---|---|
| Contract code (507,750 bytes of storage) | 5.08 | Only if the contract account is deleted later |
| Contract account `market.rerun-app.near`, its state and margin | 0.22 | Mostly locked as storage |
| Lab account `lab.rerun-app.near`, with the secure hardware's key as its only key | 0.30 | What it doesn't spend on gas stays in it |
| Gas-free relayer account `relay.rerun-app.near` | 1.00 | What it doesn't spend stays in it |
| About 5 points claims, with their receipts | 0.40 | No, it pays for their storage |
| USDC registrations (the contract and a second forecasting account) | 0.01 | No |
| Second forecasting account, for the money video (`fan.rerun-app.near`) | 0.10 | What it doesn't spend stays in it |
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

Buy **11 NEAR**: 7.2 for the table above, about 3 to swap for the 10 USDC (at today's price, 3 NEAR gets about 10.6 USDC, and at least 10.5), and a little for exchange and swap fees. Withdraw it to the funding address above on the NEAR network. Send about 0.2 first and check it arrives, then the rest.

Then swap on the site: import the owner key into a NEAR wallet (Meteor or Intear), connect it to the mainnet site, open **My forecasts**, and use **Swap NEAR for USDC**. Try 0.2 NEAR first. The USDC is Circle's token `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (check it on https://developers.circle.com/stablecoins/usdc-contract-addresses, under NEAR).

If the site's swap doesn't work for any reason, the same swap by hand:

1. Open https://near-intents.org and connect the same wallet.
2. Swap NEAR to USDC, both on NEAR. Before confirming, check that the USDC's contract is the address above.
3. Confirm in the wallet. The USDC shows up in the wallet within a minute or two.

## In order, each with your yes

1. `pnpm mainnet home`, then `pnpm mainnet contract`: create `market.rerun-app.near` and deploy the mainnet build, calling `new` with you as owner, USDC as the token, you as treasury and Lab fee recipient.
2. Start the mainnet CVM. On first start it prints its public key and stops; create `lab.rerun-app.near` with that key as its only key, then restart it. Check its attestation and register it (`register_lab_attested`).
3. Create `relay.rerun-app.near`, fund it with 1 NEAR, and put its key in Vercel's server environment (`RELAYER_ACCOUNT`, `RELAYER_PRIVATE_KEY`), next to `NEXT_PUBLIC_NETWORK=mainnet`.
4. `set_mode_params` for money mode, register the contract with USDC, post the points claims, then post and fund the money claim.
5. The two forecasts for the video. After the verdict and its challenge window: finalize, then collect from both accounts.

## Before deploying

- [x] Limits in the contract: 5 USDC a prediction, 50 USDC a claim. Unit-tested, and the money cycle ran on testnet.
- [x] Gas-free relayer: checked end to end on testnet (`pnpm relay:check`).
- [ ] Decide whether to remove the contract account's key after deploying. The next step instead: upgrades through a multisig with a time delay.
- [ ] You've read the Terms page. I wrote it in plain words; it isn't legal advice.
