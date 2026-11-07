# What mainnet needs

Worked out on 2026-11-07 from the current build. Nothing here has been spent, and no mainnet transaction has been sent.

## NEAR

| What | NEAR | Notes |
|---|---|---|
| Deploy the contract | 5.0 | 499 KB of code at 0.01 NEAR per KB of storage |
| Accounts: owner, contract, Lab, treasury | 0.5 | Named accounts and their storage |
| 15 claims | 2.3 | About 0.15 each: the claim text and its receipt |
| Gas: posting, runs, settling | 1.0 | Well above what the testnet runs burnt, to leave room |
| Spare | 1.2 | |
| **Total** | **10** | About 5 of it is locked for as long as the contract stays deployed |

A gas relayer isn't included, because none exists yet. It would need its own funded account: 5 NEAR would be a sensible first limit.

## USDC

Each money claim takes a bond, a Lab fee and a starting prize pool, using today's settings:

| Per claim | USDC | What happens to it |
|---|---|---|
| Creation bond | 10 | Comes back at the end, unless the claim itself was at fault |
| Lab fee | 2 | Goes to the Lab's fee account, which is yours |
| Starting prize pool (minimum) | 10 | Comes back at the end, less any change from forecasters' trades |
| **Total** | **22** | |

So 3 money claims need **66 USDC**, and most of it comes back. Forecasters then add at most 5 USDC a prediction, and each claim stops at 50 USDC including its prize pool.

Testing a full cycle yourself (fund, predict, win, collect) adds about 10 USDC.

**Budget: 80 USDC.**

## Getting USDC onto your mainnet account

USDC on NEAR is the token `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`. Its own mainnet metadata reads USDC with 6 decimals; compare the address with Circle's published list before funding. Swap NEAR for it through NEAR Intents, or withdraw USDC to NEAR from an exchange that supports it. Send a small amount first.

## Checked or still to check before deploying

- [x] Limits are in the contract: 5 USDC a prediction, 50 USDC a claim. Tested in the unit tests, not yet on a live chain.
- [ ] Decide whether to remove the contract account's key after deploying. It's what makes "no one, not even us" fully true, and it also means bugs can't be fixed.
- [ ] Reduce the contract's size if possible: each KB saved frees 0.01 NEAR.
- [ ] Terms page read by you. It's plain words I wrote, not legal advice.
