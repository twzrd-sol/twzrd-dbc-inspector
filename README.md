# twzrd-dbc-inspector

Read-only inspector for **Meteora Dynamic Bonding Curve (DBC)** pools. Give it a pool address and it decodes the pool
and its config straight from mainnet bytes, then explains the launch in plain terms:

- **Status and progress:** where the pool is (on the curve, awaiting migration, migrated) and how far its quote reserve
  is toward the migration threshold.
- **Price:** the current price, the starting price, and the price at which it migrates.
- **Fees:** the base fee schedule (flat, linear or exponential scheduler, or rate limiter), the dynamic fee, which token
  fees are collected in, and the split between protocol, partner and creator.
- **Migration:** the target (DAMM v1 or v2), the post-migration pool fee tier, any migration fee, how LP is divided and
  locked after migration, and any locked vesting.
- **Token:** program (SPL or Token-2022), decimals, supply, mint and freeze authority, and who can update metadata.
- **Curve:** each segment's price boundary.

Anything it cannot decode is reported under `unknowns` with the reason; it never guesses. Built during Crypto World's Fair in October 2026.

The browser review adds three workflows: inspect a live DBC pool, compare the configured rules of two pools, and read
the existing ICELAN mint and rewards vault as a clearly separate SPL-token example. Reports include the mainnet slot
and links to the accounts behind them. JSON can be downloaded from the pool view.

## Use

```bash
npm ci
npm test                                   # offline: decodes recorded mainnet fixtures
npm start                                  # browser review at http://127.0.0.1:4173
npm run build:site                         # build the standalone Sites Worker artifact

DBC_RPC_URL=<solana mainnet rpc> node bin/dbc-inspect.mjs <pool-address>          # readable card
DBC_RPC_URL=<solana mainnet rpc> node bin/dbc-inspect.mjs <pool-address> --json   # full JSON report
node bin/dbc-inspect.mjs --fixture fixtures/pool-8QGizJP4.json                     # no RPC needed
node bin/dbc-inspect.mjs --fixture fixtures/not-dbc-token-mint.json                # refusal path, no RPC needed
```

`DBC_RPC_URL` optionally overrides the public Solana mainnet RPC. The browser API keeps RPC requests server-side and
times them out after 12 seconds. Public RPCs may rate-limit bursts. The example buttons use recorded mainnet bytes and
work without an RPC key; live inspections and comparisons make fresh mainnet reads.

The browser API exposes `GET /api/pool?address=<DBC pool>`, `GET /api/compare?left=<pool>&right=<pool>`,
`GET /api/icelan`, and `GET /api/example?id=usdc|sol`. The comparison reports configured terms, with their quote units,
and leaves current price, reserves, and trading activity out of the difference count. Each pool has its own observation
slot. An unknown value stays unknown rather than being counted as a match.

ICELAN's mint is `Dxpt78DTyBv3USxqsFKhQsthTF1JnjdiXQXTPLGBK9m`. The ICELAN view checks the recorded vault token
account and authority before reporting its balance. It does not claim that ICELAN launched on Meteora DBC or use its
reward balance as a pool reserve.

Exit codes: `0` decoded, `1` not a DBC pool (wrong owner, wrong account type, truncated, or mismatched accounts), `2`
usage or RPC error.

### Example (live, mainnet, slot 455904786)

```
DBC pool 8QGizJP4ebiJbMKnbqWNDBjN3XSbZQMgEpA3mjhBFvK8  (slot 455904786, confirmed)
  token     6RV4ke1DZbMHoD3SeGZD75CFDxWcK8YKowwdL9NVg7B  SPL Token, 6 decimals, supply 1000000000 (fixed)
            mint authority: none; freeze authority: none; metadata: immutable
  quote     USDC (EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)
  status    pre bonding curve (trading on the curve)
  progress  17.8% of the 9234.832035 USDC migration threshold (1645.200256 USDC in reserve)
  price     now 0.00000685703 USDC; started 0.00000300007; migrates at 0.0000450011
  fees      flat 200 bps (no decay periods); dynamic fee off; collected in quote token only
            split: protocol 20%, then partner 100% / creator 0%
  migrates  to DAMM v2; post-migration pool fee 200 bps (fixed 2% tier); migration fee 0% of quote (creator share 0%)
            LP after migration: partner 0% (+100% locked), creator 0% (+0% locked)
  curve     2 segment(s); config version 0
  unknowns  none
  not checked: token safety or rug risk, creator or partner reputation, off-chain metadata, Token-2022 extension contents, whether the fee claimer is trustworthy
```

A `bigint: Failed to load bindings, pure JS will be used` line on stderr may come from a transitive dependency of the
Solana SDK; it falls back to JavaScript.

A non-DBC account is refused:

```
$ node bin/dbc-inspect.mjs EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
not a DBC pool: account owner TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA is not the DBC program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN
```

## How it decodes

- Program `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` (Meteora DBC, mainnet), as exported by
  `@meteora-ag/dynamic-bonding-curve-sdk@1.5.13` (pinned exactly) and listed in that package's README.
- Accounts are decoded with the SDK's own IDL through Anchor's `BorshAccountsCoder`, not hand-written offsets. The owner,
  the 8-byte account discriminator, and the minimum size are checked before decoding.
- The pool, its config, and both mints are read at one slot, so the report is internally consistent.
- `migration_fee_option` is the graduated DAMM pool's fee tier, per the SDK's "Graduated DAMM Pool Config Keys". Only
  the customizable tier uses `migrated_pool_fee_bps`. The migration fee (`migration_fee_percentage`) is reported
  separately.
- Fixtures under `fixtures/` are raw finalized account bytes (base64) for two live mainnet pools, one quoted in SOL and
  one in USDC, with the slot and an endpoint label; no endpoint URL is stored. Recapture with
  `DBC_RPC_URL=... node bin/capture-fixture.mjs <pool> <out.json> <label>`.
- The opt-in live test (`DBC_LIVE=1 DBC_RPC_URL=... npm test`) checks the inspector's curve progress against the SDK's
  own `getPoolQuoteTokenCurveProgress` on the live pool.

## What has been checked against real data

| Behaviour | Evidence |
|---|---|
| Pool, config and mint decoding | Two live mainnet pools (SOL- and USDC-quoted) decode with nothing unknown |
| Curve progress | Matches the SDK's `getPoolQuoteTokenCurveProgress` on the live USDC pool (opt-in live test) |
| Prices | Match the SDK's `getPriceFromSqrtPrice` for both pools (offline test) |
| Migration progress names | Order from the program source, `state/virtual_pool.rs` `enum MigrationProgress`; only state 0 (on the curve) is present in the fixtures |
| Flat base fee | Both live pools |
| Linear and exponential fee schedules | The ending fee is computed by the SDK's own scheduler; tested on synthetic configs, not on a live pool |
| Rate limiter | Parameter names follow the SDK's `FeeRateLimiter` constructor; not exercised on a live pool |
| Refusals | Token mint, DBC config passed as a pool, truncated bytes, mismatched config, out-of-range enum |

## What it does not check

Token safety or rug risk, creator or partner reputation, off-chain metadata, Token-2022 extension contents, or whether
the fee claimer is trustworthy. It explains launch mechanics; it does not rate a token, and it uses none of TWZRD's
x402 counterparty scoring.

Lookup by base mint is not implemented: that needs `getProgramAccounts`, which many RPC tiers refuse. Pass the pool
address.
