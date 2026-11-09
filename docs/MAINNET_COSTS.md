# What mainnet needs (Plan B)

Points mode for every claim, plus one money claim for the video. Worked out on 2026-11-09 from the current build. Nothing has been spent, and no mainnet transaction has been sent: each one waits for a yes.

## NEAR: 7.0

| What | NEAR | Comes back? |
|---|---|---|
| Contract code (505 KB of storage) | 5.1 | Only if the contract account is deleted later |
| Contract and Lab accounts, created under your account | 0.2 | Mostly locked as their storage |
| About 6 points claims, with their receipts | 0.5 | No, it pays for their storage |
| Gas: posting, runs, settling | 0.2 | No |
| Gas-free relayer for points mode | 1.0 | What it doesn't spend stays in its account |
| **Total** | **7.0** | |

The contract is already built small (size-optimised, link-time optimised). Turning off its overflow checks would save only 17 KB, about 0.17 NEAR, so it isn't worth the risk.

## USDC: 20

Before the money claim opens, the owner lowers money mode's bond and fee with `set_mode_params` (one transaction): a 2 USDC bond and a 0.5 USDC Lab fee, instead of 10 and 2.

| What | USDC | Comes back? |
|---|---|---|
| Starting prize pool | 12 | Yes, when the claim is final, give or take how the forecasts moved it |
| Creation bond | 2 | Yes, unless the claim itself was at fault |
| Lab fee | 0.5 | It goes to the Lab's fee account, which is yours |
| Two forecasts for the video, one each way | 5 | The winning side gets the pot. With both accounts yours, it all comes back |
| Spare | 0.5 | |
| **Total** | **20** | **Nearly all of it**, once the claim is final and both accounts collect |

The contract caps a prediction at 5 USDC and a claim at 50 USDC, with the prize pool counted. Fees: 1% of each forecast, 0.8% to the prize pool and 0.2% to the treasury, which is also yours.

## Getting USDC onto your mainnet account

USDC on NEAR is the token `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`. Its own mainnet metadata reads USDC with 6 decimals; compare the address with Circle's published list before funding.

1. Buy NEAR on an exchange and withdraw it to your mainnet account, choosing the NEAR network. Send about 0.1 first to check the address, then the rest.
2. Swap NEAR for USDC with NEAR Intents, inside a NEAR wallet that offers swaps. Check that the token you receive has the address above.
3. Or withdraw USDC straight to NEAR from an exchange that offers "USDC on NEAR" as a network, again checking the address.

NEAR for 20 USDC is about 20 USDC's worth plus a little for the swap. At the time you buy, add both totals in your wallet's currency.

## One thing mainnet waits on

The mainnet contract can't register a Lab without its secure-hardware attestation, by design: the owner-only shortcut is testnet-only, and mainnet has only `register_lab_attested`. So the Lab has to be running on Phala before mainnet claims can be settled. That's why Phala comes first (docs/PHALA.md).

## Before deploying

- [x] Limits in the contract: 5 USDC a prediction, 50 USDC a claim. Unit-tested, and the money cycle ran on testnet.
- [ ] Decide whether to remove the contract account's key after deploying. Next step instead: upgrades through a multisig with a time delay.
- [ ] You've read the Terms page. I wrote it in plain words; it isn't legal advice.
