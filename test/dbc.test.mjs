import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { DBC_PROGRAM_ID, NotDbcError, inspectAccounts, priceFromSqrt, renderCard } from "../lib/dbc.mjs";

const require = createRequire(import.meta.url);
const sdk = require("@meteora-ag/dynamic-bonding-curve-sdk");
const { BorshAccountsCoder } = require("@coral-xyz/anchor");
const coder = new BorshAccountsCoder(sdk.DynamicBondingCurveIdl);

const load = (name) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
const SOL_POOL = load("pool-29pLrU8Z.json");
const USDC_POOL = load("pool-8QGizJP4.json");
const clone = (x) => JSON.parse(JSON.stringify(x));

test("the program id is Meteora's mainnet DBC program", () => {
  assert.equal(DBC_PROGRAM_ID, "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
});

test("a real USDC-quoted mainnet pool decodes with nothing unknown", () => {
  const r = inspectAccounts(USDC_POOL);
  assert.equal(r.pool.address, "8QGizJP4ebiJbMKnbqWNDBjN3XSbZQMgEpA3mjhBFvK8");
  assert.equal(r.pool.quote_symbol, "USDC");
  assert.equal(r.status.migration_progress.name, "pre bonding curve (trading on the curve)");
  assert.equal(r.status.is_migrated, false);
  assert.ok(r.status.curve_progress > 0 && r.status.curve_progress < 1);
  assert.equal(r.migration.target.name, "DAMM v2");
  assert.equal(r.migration.post_migration_pool_fee.bps, 200);
  assert.equal(r.fees.base_fee.starting_fee_bps, 200);
  assert.equal(r.fees.split.protocol_percent, 20);
  assert.equal(r.token.mint_authority, null);
  assert.equal(r.token.decimals, 6);
  assert.deepEqual(r.unknowns, []);
  assert.equal(r.observed.slot, USDC_POOL.slot);
});

test("a real SOL-quoted pool on a customizable tier reports its custom post-migration fee", () => {
  const r = inspectAccounts(SOL_POOL);
  assert.equal(r.pool.quote_symbol, "SOL");
  assert.equal(r.migration.post_migration_pool_fee.tier.name, "customizable tier");
  assert.equal(r.migration.post_migration_pool_fee.bps, 250);
  assert.deepEqual(r.unknowns, []);
  assert.match(renderCard(r), /flat 250 bps/);
});

test("both real pools report the 20 bps protocol liquidity migration fee, not a zero migration fee", () => {
  for (const fx of [SOL_POOL, USDC_POOL]) {
    const raw = Buffer.from(fx.accounts.pool.data_b64, "base64");
    const bps = coder.decode("VirtualPool", raw).pool_state.protocol_liquidity_migration_fee_bps;
    assert.equal(bps, 20);
    const r = inspectAccounts(fx);
    assert.equal(r.migration.migration_fee.percent_of_quote, 0);
    assert.equal(r.migration.migration_fee.protocol_liquidity_fee_bps, 20);
    assert.equal(r.migration.migration_fee.protocol_liquidity_base_taken, "0");
    assert.equal(r.migration.migration_fee.protocol_liquidity_quote_taken, "0");
    const card = renderCard(r);
    assert.match(card, /protocol liquidity migration fee 20 bps/);
    assert.doesNotMatch(card, /migration fee 0%/);
    assert.equal(r.migration.locked_vesting, null);
    assert.equal(r.migration.partner_liquidity_vesting, null);
    assert.equal(r.migration.creator_liquidity_vesting, null);
    assert.doesNotMatch(card, /vesting/);
  }
});

test("locked vesting keeps its cliff, including a cliff with no periods", () => {
  // LockedVestingConfig in PoolConfig: amount u64 @296, cliff u64 @304, frequency u64 @312, periods u64 @320, unlock u64 @328.
  const withSchedule = clone(USDC_POOL);
  const scheduled = Buffer.from(withSchedule.accounts.config.data_b64, "base64");
  scheduled.writeBigUInt64LE(1_000_000n, 296);
  scheduled.writeBigUInt64LE(3600n, 304);
  scheduled.writeBigUInt64LE(60n, 312);
  scheduled.writeBigUInt64LE(4n, 320);
  scheduled.writeBigUInt64LE(2_000_000n, 328);
  const decoded = coder.decode("PoolConfig", scheduled).locked_vesting_config;
  assert.equal(decoded.cliff_duration_from_migration_time.toString(), "3600");
  assert.equal(decoded.number_of_period.toString(), "4");
  withSchedule.accounts.config.data_b64 = scheduled.toString("base64");
  const full = inspectAccounts(withSchedule);
  assert.equal(full.migration.locked_vesting.amount_per_period, "1");
  assert.equal(full.migration.locked_vesting.periods, "4");
  assert.equal(full.migration.locked_vesting.frequency, "60");
  assert.equal(full.migration.locked_vesting.cliff_duration_from_migration_time, "3600");
  assert.equal(full.migration.locked_vesting.cliff_unlock, "2");
  assert.match(renderCard(full), /cliff 3600/);

  const cliffOnly = clone(USDC_POOL);
  const cliff = Buffer.from(cliffOnly.accounts.config.data_b64, "base64");
  cliff.writeBigUInt64LE(86400n, 304);
  const cliffDecoded = coder.decode("PoolConfig", cliff).locked_vesting_config;
  assert.equal(cliffDecoded.number_of_period.toString(), "0");
  assert.equal(cliffDecoded.cliff_unlock_amount.toString(), "0");
  cliffOnly.accounts.config.data_b64 = cliff.toString("base64");
  const only = inspectAccounts(cliffOnly);
  assert.equal(only.migration.locked_vesting.cliff_duration_from_migration_time, "86400");
  assert.equal(only.migration.locked_vesting.periods, "0");
  assert.match(renderCard(only), /cliff 86400/);
});

test("partner and creator liquidity vesting surface when percentage or initialized is set", () => {
  // LiquidityVestingInfo is 16 bytes: partner @184, creator @200.
  // init u8, percentage u8, pad 2, bps u16, periods u16, frequency u32, cliff u32.
  const fx = clone(USDC_POOL);
  const raw = Buffer.from(fx.accounts.config.data_b64, "base64");
  raw[185] = 25;
  raw.writeUInt16LE(500, 188);
  raw.writeUInt16LE(10, 190);
  raw.writeUInt32LE(3600, 192);
  raw.writeUInt32LE(7200, 196);
  raw[200] = 1;
  const partner = coder.decode("PoolConfig", raw).partner_liquidity_vesting_info;
  const creator = coder.decode("PoolConfig", raw).creator_liquidity_vesting_info;
  assert.equal(partner.is_initialized, 0);
  assert.equal(partner.vesting_percentage, 25);
  assert.equal(partner.cliff_duration_from_migration_time, 7200);
  assert.equal(creator.is_initialized, 1);
  assert.equal(creator.vesting_percentage, 0);
  fx.accounts.config.data_b64 = raw.toString("base64");
  const r = inspectAccounts(fx);
  assert.equal(r.migration.partner_liquidity_vesting.initialized, false);
  assert.equal(r.migration.partner_liquidity_vesting.vesting_percentage, 25);
  assert.equal(r.migration.partner_liquidity_vesting.bps_per_period, 500);
  assert.equal(r.migration.partner_liquidity_vesting.number_of_periods, 10);
  assert.equal(r.migration.partner_liquidity_vesting.frequency, 3600);
  assert.equal(r.migration.partner_liquidity_vesting.cliff_duration_from_migration_time, 7200);
  assert.equal(r.migration.creator_liquidity_vesting.initialized, true);
  assert.equal(r.migration.creator_liquidity_vesting.vesting_percentage, 0);
  const card = renderCard(r);
  assert.match(card, /partner LP uninitialized, 25%/);
  assert.match(card, /creator LP initialized, 0%/);
});

test("a token mint is refused as not a DBC pool", () => {
  const fx = clone(USDC_POOL);
  fx.accounts.pool = fx.accounts.quote_mint;
  assert.throws(() => inspectAccounts(fx), NotDbcError);
});

test("the offline refusal fixture is a captured non-DBC token mint", () => {
  const fx = load("not-dbc-token-mint.json");
  assert.throws(() => inspectAccounts(fx), /is not the DBC program/);
});

test("a DBC config account passed as the pool is refused by discriminator", () => {
  const fx = clone(USDC_POOL);
  fx.accounts.pool = { owner: fx.accounts.config.owner, data_b64: fx.accounts.config.data_b64 };
  assert.throws(() => inspectAccounts(fx), /discriminator mismatch/);
});

test("truncated pool bytes are refused", () => {
  const fx = clone(USDC_POOL);
  fx.accounts.pool.data_b64 = Buffer.from(fx.accounts.pool.data_b64, "base64").subarray(0, 100).toString("base64");
  assert.throws(() => inspectAccounts(fx), NotDbcError);
});

test("a config that is not the pool's config is refused", () => {
  const fx = clone(USDC_POOL);
  fx.accounts.config = clone(SOL_POOL.accounts.config);
  assert.throws(() => inspectAccounts(fx), /does not match the pool's config/);
});

test("an out-of-range enum is reported as unknown instead of guessed", () => {
  const fx = clone(USDC_POOL);
  const raw = Buffer.from(fx.accounts.config.data_b64, "base64");
  // PoolConfig layout (IDL): 8 discriminator + 3 pubkeys (96) + pool_fees (80) + 2 vesting infos (32) + 16 padding
  // + collect_fee_mode (1) = 233 for migration_option. Confirm against the decoder before mutating.
  const OFFSET = 233;
  assert.equal(raw[OFFSET], coder.decode("PoolConfig", raw).migration_option);
  raw[OFFSET] = 9;
  assert.equal(coder.decode("PoolConfig", raw).migration_option, 9);
  fx.accounts.config.data_b64 = raw.toString("base64");
  const r = inspectAccounts(fx);
  assert.equal(r.migration.target.name, null);
  assert.ok(r.unknowns.some((u) => /migration_option/.test(u)));
  assert.match(renderCard(r), /UNKNOWN/);
});

test("Q64.64 sqrt price converts to a human price with decimal adjustment", () => {
  const ONE = 2n ** 64n;
  assert.equal(priceFromSqrt(ONE, 6, 6), "1");
  assert.equal(priceFromSqrt(ONE * 2n, 6, 6), "4");
  assert.equal(priceFromSqrt(ONE, 9, 6), "1000");
  assert.equal(priceFromSqrt(ONE, 6, 9), "0.001");
  assert.equal(priceFromSqrt(0n, 6, 6), "0");
});

test("prices match the SDK's own getPriceFromSqrtPrice on both real pools", () => {
  for (const fx of [SOL_POOL, USDC_POOL]) {
    const raw = Buffer.from(fx.accounts.pool.data_b64, "base64");
    const s = coder.decode("VirtualPool", raw).pool_state;
    const r = inspectAccounts(fx);
    const quoteDecimals = Buffer.from(fx.accounts.quote_mint.data_b64, "base64")[44];
    const sdkPrice = sdk.getPriceFromSqrtPrice(s.sqrt_price, r.token.decimals, quoteDecimals);
    const rel = Math.abs(Number(r.status.price_now) - sdkPrice.toNumber()) / sdkPrice.toNumber();
    assert.ok(rel < 1e-5, `${fx.pool_address}: ours ${r.status.price_now} vs sdk ${sdkPrice.toString()}`);
  }
});

test("linear and exponential fee schedules end where the SDK's scheduler says", () => {
  // BaseFeeConfig sits at offset 104 in PoolConfig: cliff u64 @104, second_factor u64 @112, third_factor u64 @120,
  // first_factor u16 @128, base_fee_mode u8 @130. Confirmed against the decoder before each mutation.
  for (const mode of [0, 1]) {
    const fx = clone(USDC_POOL);
    const raw = Buffer.from(fx.accounts.config.data_b64, "base64");
    raw.writeBigUInt64LE(100_000_000n, 104); // 1000 bps start
    raw.writeBigUInt64LE(60n, 112);          // period length
    raw.writeBigUInt64LE(mode === 0 ? 5_000_000n : 1000n, 120); // linear: -50 bps/period; exponential: -10%/period
    raw.writeUInt16LE(10, 128);              // 10 periods
    raw[130] = mode;
    const d = coder.decode("PoolConfig", raw).pool_fees.base_fee;
    assert.equal(d.base_fee_mode, mode);
    assert.equal(d.first_factor, 10);
    fx.accounts.config.data_b64 = raw.toString("base64");
    const r = inspectAccounts(fx);
    assert.equal(r.fees.base_fee.starting_fee_bps, 1000);
    assert.equal(r.fees.base_fee.number_of_periods, 10);
    // linear: 1000 - 10*50 = 500 bps; exponential: 1000 * 0.9^10 ~= 348.68 bps
    if (mode === 0) assert.equal(r.fees.base_fee.ending_fee_bps, 500);
    else assert.ok(Math.abs(r.fees.base_fee.ending_fee_bps - 348.67) < 0.05, String(r.fees.base_fee.ending_fee_bps));
    assert.doesNotMatch(renderCard(r), /flat/);
  }
});

test("live: curve progress matches the SDK's own calculation (opt-in: DBC_RPC_URL and DBC_LIVE=1)", { skip: !(process.env.DBC_LIVE === "1" && process.env.DBC_RPC_URL) }, async () => {
  const { Connection, PublicKey } = require("@solana/web3.js");
  const conn = new Connection(process.env.DBC_RPC_URL, "confirmed");
  const client = new sdk.DynamicBondingCurveClient(conn, "confirmed");
  const pool = new PublicKey(USDC_POOL.pool_address);
  const sdkProgress = await client.state.getPoolQuoteTokenCurveProgress(pool);
  const acct = await conn.getAccountInfo(pool);
  const { decodePoolAccount, decodeConfigAccount } = await import("../lib/dbc.mjs");
  const p = decodePoolAccount(acct.owner.toBase58(), Buffer.from(acct.data));
  const c = await conn.getAccountInfo(new PublicKey(p.config));
  const cfg = decodeConfigAccount(c.owner.toBase58(), Buffer.from(c.data));
  const ours = Number(p.quote_reserve) / Number(cfg.migration.quote_threshold);
  assert.ok(Math.abs(Math.min(1, ours) - sdkProgress) < 0.002, `ours ${ours} vs sdk ${sdkProgress}`);
});
