/**
 * Read-only decoder and explainer for Meteora Dynamic Bonding Curve (DBC) pools.
 *
 * Decoding uses the IDL shipped in @meteora-ag/dynamic-bonding-curve-sdk@1.5.13 (no hand-written offsets). Every
 * explained field is either decoded from on-chain bytes or reported as unknown with a reason; nothing is guessed.
 * This inspects launch mechanics only. It does not judge token safety, rug risk, or counterparty reputation.
 */
import * as sdk from "@meteora-ag/dynamic-bonding-curve-sdk";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import BN from "bn.js";

export const DBC_PROGRAM_ID = sdk.DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58();
export const SDK_VERSION = "1.5.13";
export const FEE_DENOMINATOR = 1_000_000_000n; // sdk FEE_DENOMINATOR = 1e9
export const PROTOCOL_FEE_PERCENT = sdk.PROTOCOL_FEE_PERCENT; // share of the trading fee that goes to the protocol
const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const coder = new BorshAccountsCoder(sdk.DynamicBondingCurveIdl);
const discriminatorOf = (name) => Buffer.from(sdk.DynamicBondingCurveIdl.accounts.find((a) => a.name === name).discriminator);
const VIRTUAL_POOL_DISC = discriminatorOf("VirtualPool");
const POOL_CONFIG_DISC = discriminatorOf("PoolConfig");

export class NotDbcError extends Error {}

// Enum names from the SDK's exported enums. MigrationProgress is not exported by the SDK; its order is from the program
// source, MeteoraAg/dynamic-bonding-curve programs/dynamic-bonding-curve/src/state/virtual_pool.rs `enum MigrationProgress`
// (PreBondingCurve, PostBondingCurve, LockedVesting, CreatedPool). Out-of-range values are reported as unknown.
const ENUMS = {
  migration_option: { 0: "DAMM v1", 1: "DAMM v2" },
  activation_type: { 0: "slot", 1: "timestamp" },
  collect_fee_mode: { 0: "quote token only", 1: "output token" },
  base_fee_mode: { 0: "fee scheduler, linear", 1: "fee scheduler, exponential", 2: "rate limiter" },
  token_type: { 0: "SPL Token", 1: "Token-2022" },
  migration_fee_option: { 0: "fixed 0.25% tier", 1: "fixed 0.30% tier", 2: "fixed 1% tier", 3: "fixed 2% tier", 4: "fixed 4% tier", 5: "fixed 6% tier", 6: "customizable tier" },
  token_update_authority: { 0: "creator holds update authority", 1: "immutable", 2: "partner holds update authority", 3: "creator holds update and mint authority", 4: "partner holds update and mint authority" },
  migration_progress: { 0: "pre bonding curve (trading on the curve)", 1: "post bonding curve (threshold reached, awaiting migration)", 2: "locked vesting", 3: "migrated: AMM pool created" },
};
function named(field, value) {
  const name = ENUMS[field]?.[value];
  return name === undefined
    ? { value, name: null, unknown: `value ${value} is not in the ${field} set known to SDK ${SDK_VERSION}` }
    : { value, name };
}

const toBig = (bn) => BigInt(bn.toString());
const key = (pk) => pk.toBase58();

function decodeAs(name, disc, owner, data) {
  if (owner !== DBC_PROGRAM_ID) throw new NotDbcError(`account owner ${owner} is not the DBC program ${DBC_PROGRAM_ID}`);
  if (data.length < 8 || !data.subarray(0, 8).equals(disc)) throw new NotDbcError(`account is not a DBC ${name} (discriminator mismatch)`);
  if (data.length < coder.size(name)) throw new NotDbcError(`${name} account is ${data.length} bytes, IDL expects ${coder.size(name)}`);
  return coder.decode(name, data);
}

export function decodePoolAccount(owner, data) {
  const s = decodeAs("VirtualPool", VIRTUAL_POOL_DISC, owner, data).pool_state;
  return {
    config: key(s.config), creator: key(s.creator), base_mint: key(s.base_mint),
    base_vault: key(s.base_vault), quote_vault: key(s.quote_vault),
    base_reserve: toBig(s.base_reserve), quote_reserve: toBig(s.quote_reserve),
    sqrt_price: toBig(s.sqrt_price), activation_point: toBig(s.activation_point),
    is_migrated: s.is_migrated, migration_progress: s.migration_progress, has_swap: s.has_swap,
    finish_curve_timestamp: toBig(s.finish_curve_timestamp),
    fees_accrued: {
      protocol_base: toBig(s.protocol_base_fee), protocol_quote: toBig(s.protocol_quote_fee),
      partner_base: toBig(s.partner_base_fee), partner_quote: toBig(s.partner_quote_fee),
      creator_base: toBig(s.creator_base_fee), creator_quote: toBig(s.creator_quote_fee),
    },
    metrics: {
      total_trading_base_fee: toBig(s.metrics.total_trading_base_fee),
      total_trading_quote_fee: toBig(s.metrics.total_trading_quote_fee),
    },
  };
}

export function decodeConfigAccount(owner, data) {
  const c = decodeAs("PoolConfig", POOL_CONFIG_DISC, owner, data);
  const bf = c.pool_fees.base_fee, df = c.pool_fees.dynamic_fee;
  return {
    quote_mint: key(c.quote_mint), fee_claimer: key(c.fee_claimer), leftover_receiver: key(c.leftover_receiver),
    version: c.version,
    base_fee: {
      mode: bf.base_fee_mode, cliff_fee_numerator: toBig(bf.cliff_fee_numerator),
      first_factor: bf.first_factor, second_factor: toBig(bf.second_factor), third_factor: toBig(bf.third_factor),
    },
    dynamic_fee: { initialized: df.initialized === 1, bin_step: df.bin_step, max_volatility_accumulator: df.max_volatility_accumulator, variable_fee_control: df.variable_fee_control },
    collect_fee_mode: c.collect_fee_mode, migration_option: c.migration_option, activation_type: c.activation_type,
    token_decimal: c.token_decimal, token_type: c.token_type, quote_token_flag: c.quote_token_flag,
    fixed_token_supply_flag: c.fixed_token_supply_flag, token_update_authority: c.token_update_authority,
    creator_trading_fee_percentage: c.creator_trading_fee_percentage,
    migration: {
      quote_threshold: toBig(c.migration_quote_threshold), base_threshold: toBig(c.migration_base_threshold),
      sqrt_price: toBig(c.migration_sqrt_price), fee_option: c.migration_fee_option,
      fee_percentage: c.migration_fee_percentage, creator_fee_percentage: c.creator_migration_fee_percentage,
      partner_liquidity_percentage: c.partner_liquidity_percentage,
      partner_permanent_locked_liquidity_percentage: c.partner_permanent_locked_liquidity_percentage,
      creator_liquidity_percentage: c.creator_liquidity_percentage,
      creator_permanent_locked_liquidity_percentage: c.creator_permanent_locked_liquidity_percentage,
      migrated_pool_fee_bps: c.migrated_pool_fee_bps, migrated_collect_fee_mode: c.migrated_collect_fee_mode,
      migrated_dynamic_fee: c.migrated_dynamic_fee,
    },
    swap_base_amount: toBig(c.swap_base_amount),
    supply: { pre_migration: toBig(c.pre_migration_token_supply), post_migration: toBig(c.post_migration_token_supply) },
    locked_vesting: {
      amount_per_period: toBig(c.locked_vesting_config.amount_per_period),
      cliff_duration_from_migration_time: toBig(c.locked_vesting_config.cliff_duration_from_migration_time),
      frequency: toBig(c.locked_vesting_config.frequency),
      number_of_period: toBig(c.locked_vesting_config.number_of_period),
      cliff_unlock_amount: toBig(c.locked_vesting_config.cliff_unlock_amount),
    },
    pool_creation_fee: toBig(c.pool_creation_fee),
    sqrt_start_price: toBig(c.sqrt_start_price),
    curve: c.curve.map((p) => ({ sqrt_price: toBig(p.sqrt_price), liquidity: toBig(p.liquidity) })).filter((p) => p.sqrt_price > 0n),
  };
}

/** SPL / Token-2022 mint base layout (the first 82 bytes are shared). */
export function decodeMint(owner, data) {
  if (owner !== SPL_TOKEN && owner !== TOKEN_2022) throw new NotDbcError(`mint owner ${owner} is not a token program`);
  if (data.length < 82) throw new NotDbcError("mint account too short");
  const opt = (off) => (data.readUInt32LE(off) === 1 ? new PublicKey(data.subarray(off + 4, off + 36)).toBase58() : null);
  return {
    program: owner === TOKEN_2022 ? "Token-2022" : "SPL Token",
    mint_authority: opt(0), supply: data.readBigUInt64LE(36), decimals: data[44],
    freeze_authority: opt(46), has_extensions: owner === TOKEN_2022 && data.length > 165,
  };
}

const Q64 = 2n ** 64n;
/** Human price (quote per base) from a Q64.64 sqrt price, as a decimal string with `digits` significant digits. */
export function priceFromSqrt(sqrt, baseDecimals, quoteDecimals, digits = 6) {
  if (sqrt === 0n) return "0";
  const scale = 10n ** 30n;
  let num = sqrt * sqrt * scale; // (sqrt/2^64)^2 * scale
  let den = Q64 * Q64;
  const shift = baseDecimals - quoteDecimals;
  if (shift >= 0) num *= 10n ** BigInt(shift); else den *= 10n ** BigInt(-shift);
  const v = num / den; // price * 1e30
  return toSig(v, 30, digits);
}
function toSig(v, decimals, digits) {
  if (v === 0n) return "0";
  const s = v.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals).replace(/^0+(?=\d)/, "");
  const frac = s.slice(s.length - decimals);
  const all = (int + frac).replace(/^0+/, "");
  const lead = int === "0" ? frac.length - frac.replace(/^0+/, "").length : 0;
  const sig = all.slice(0, digits).padEnd(digits, "0");
  if (int !== "0") {
    const intDigits = int.length;
    return intDigits >= digits ? int : `${sig.slice(0, intDigits)}.${sig.slice(intDigits)}`.replace(/\.?0+$/, "");
  }
  return `0.${"0".repeat(lead)}${sig}`.replace(/0+$/, "");
}
const units = (raw, decimals) => toSig(raw * 10n ** 6n, decimals + 6, 12).replace(/\.$/, "");
const bps = (numerator) => Number((numerator * 10_000n * 100n) / FEE_DENOMINATOR) / 100;
// migrationFeeOption selects the graduated DAMM pool's fee tier (SDK README, "Graduated DAMM Pool Config Keys");
// only the customizable tier (6) uses migratedPoolFee.poolFeeBps.
const TIER_BPS = { 0: 25, 1: 30, 2: 100, 3: 200, 4: 400, 5: 600 };
function migratedPoolFee(option, customBps, unknowns) {
  if (option in TIER_BPS) return { bps: TIER_BPS[option], source: "fixed tier from migration_fee_option" };
  if (option === 6) {
    if (customBps > 0) return { bps: customBps, source: "customizable tier: migrated_pool_fee_bps" };
    unknowns.push("customizable post-migration fee tier with migrated_pool_fee_bps = 0");
    return { bps: null, source: "customizable tier, fee not set" };
  }
  return { bps: null, source: "unknown migration_fee_option" };
}
const quoteSymbol = (mint) => (mint === WSOL ? "SOL" : mint === USDC ? "USDC" : null);

/** Explain a captured fixture (or live accounts in the same shape). Throws NotDbcError on non-DBC input. */
export function inspectAccounts(fx) {
  const a = fx.accounts;
  const pool = decodePoolAccount(a.pool.owner, Buffer.from(a.pool.data_b64, "base64"));
  if (a.config.address !== pool.config) throw new NotDbcError(`config account ${a.config.address} does not match the pool's config ${pool.config}`);
  const cfg = decodeConfigAccount(a.config.owner, Buffer.from(a.config.data_b64, "base64"));
  const base = decodeMint(a.base_mint.owner, Buffer.from(a.base_mint.data_b64, "base64"));
  const quote = decodeMint(a.quote_mint.owner, Buffer.from(a.quote_mint.data_b64, "base64"));
  if (a.base_mint.address !== pool.base_mint) throw new NotDbcError("base mint account does not match the pool");
  if (a.quote_mint.address !== cfg.quote_mint) throw new NotDbcError("quote mint account does not match the config");

  const unknowns = [];
  const enumField = (field, value) => { const n = named(field, value); if (n.unknown) unknowns.push(n.unknown); return n; };
  const qd = quote.decimals, bd = base.decimals;
  if (bd !== cfg.token_decimal) unknowns.push(`config token_decimal ${cfg.token_decimal} differs from the base mint's ${bd}`);
  const progress = cfg.migration.quote_threshold > 0n
    ? Math.min(1, Number((pool.quote_reserve * 10_000n) / cfg.migration.quote_threshold) / 10_000)
    : null;
  if (progress === null) unknowns.push("migration quote threshold is zero; progress undefined");

  const activation = enumField("activation_type", cfg.activation_type);
  const feeMode = enumField("base_fee_mode", cfg.base_fee.mode);
  const baseFee = { mode: feeMode, starting_fee_bps: bps(cfg.base_fee.cliff_fee_numerator) };
  if (cfg.base_fee.mode === 0 || cfg.base_fee.mode === 1) {
    Object.assign(baseFee, {
      number_of_periods: cfg.base_fee.first_factor,
      period_length: cfg.base_fee.second_factor.toString(),
      reduction_factor: cfg.base_fee.third_factor.toString(),
      period_unit: activation.name,
      // The SDK's own scheduler math (FeeScheduler: numberOfPeriod, periodFrequency, reductionFactor).
      ending_fee_bps: bps(BigInt(sdk.getFeeSchedulerMinBaseFeeNumerator(
        new BN(cfg.base_fee.cliff_fee_numerator.toString()), cfg.base_fee.first_factor,
        new BN(cfg.base_fee.third_factor.toString()), cfg.base_fee.mode).toString())),
      note: cfg.base_fee.mode === 1 ? "exponential decay: each period multiplies the fee by (1 - reduction_factor / 10000)" : "linear decay: each period subtracts reduction_factor from the fee numerator",
    });
  } else if (cfg.base_fee.mode === 2) {
    Object.assign(baseFee, {
      fee_increment_bps: cfg.base_fee.first_factor,
      max_limiter_duration: cfg.base_fee.second_factor.toString(),
      reference_amount: cfg.base_fee.third_factor.toString(),
      note: "rate limiter: the fee rises with trade size above the reference amount during the limiter window",
    });
  }

  const partnerShare = 100 - cfg.creator_trading_fee_percentage;
  return {
    tool: "twzrd-dbc-inspector", sdk: `@meteora-ag/dynamic-bonding-curve-sdk@${SDK_VERSION}`,
    program: DBC_PROGRAM_ID, observed: { slot: fx.slot, commitment: fx.commitment, endpoint: fx.endpoint_label, at_utc: fx.captured_at_utc },
    pool: { address: fx.pool_address, config: pool.config, creator: pool.creator, base_mint: pool.base_mint, quote_mint: cfg.quote_mint, quote_symbol: quoteSymbol(cfg.quote_mint) },
    status: {
      migration_progress: enumField("migration_progress", pool.migration_progress),
      is_migrated: pool.is_migrated === 1, has_swap: pool.has_swap === 1,
      activation: { type: activation.name, point: pool.activation_point.toString() },
      curve_progress: progress,
      quote_reserve: units(pool.quote_reserve, qd), migration_quote_threshold: units(cfg.migration.quote_threshold, qd),
      base_reserve: units(pool.base_reserve, bd),
      price_now: priceFromSqrt(pool.sqrt_price, bd, qd), price_start: priceFromSqrt(cfg.sqrt_start_price, bd, qd),
      price_at_migration: priceFromSqrt(cfg.migration.sqrt_price, bd, qd),
    },
    fees: {
      base_fee: baseFee,
      dynamic_fee: cfg.dynamic_fee.initialized ? { enabled: true, bin_step: cfg.dynamic_fee.bin_step, variable_fee_control: cfg.dynamic_fee.variable_fee_control, max_volatility_accumulator: cfg.dynamic_fee.max_volatility_accumulator } : { enabled: false },
      collect_fee_mode: enumField("collect_fee_mode", cfg.collect_fee_mode),
      split: { protocol_percent: PROTOCOL_FEE_PERCENT, of_remainder: { partner_percent: partnerShare, creator_percent: cfg.creator_trading_fee_percentage } },
      fee_claimer: cfg.fee_claimer,
      accrued_quote: { protocol: units(pool.fees_accrued.protocol_quote, qd), partner: units(pool.fees_accrued.partner_quote, qd), creator: units(pool.fees_accrued.creator_quote, qd) },
      pool_creation_fee_lamports: cfg.pool_creation_fee.toString(),
    },
    migration: {
      target: enumField("migration_option", cfg.migration_option),
      post_migration_pool_fee: { tier: enumField("migration_fee_option", cfg.migration.fee_option), ...migratedPoolFee(cfg.migration.fee_option, cfg.migration.migrated_pool_fee_bps, unknowns) },
      migration_fee: { percent_of_quote: cfg.migration.fee_percentage, creator_share_percent: cfg.migration.creator_fee_percentage },
      liquidity_after_migration: {
        partner_percent: cfg.migration.partner_liquidity_percentage, partner_permanently_locked_percent: cfg.migration.partner_permanent_locked_liquidity_percentage,
        creator_percent: cfg.migration.creator_liquidity_percentage, creator_permanently_locked_percent: cfg.migration.creator_permanent_locked_liquidity_percentage,
      },
      locked_vesting: cfg.locked_vesting.number_of_period > 0n || cfg.locked_vesting.cliff_unlock_amount > 0n
        ? { amount_per_period: units(cfg.locked_vesting.amount_per_period, bd), periods: cfg.locked_vesting.number_of_period.toString(), frequency_seconds: cfg.locked_vesting.frequency.toString(), cliff_unlock: units(cfg.locked_vesting.cliff_unlock_amount, bd) }
        : null,
      leftover_receiver: cfg.leftover_receiver,
    },
    token: {
      program: base.program, config_token_type: enumField("token_type", cfg.token_type).name, decimals: bd,
      supply_now: units(base.supply, bd),
      supply_pre_migration: cfg.supply.pre_migration > 0n ? units(cfg.supply.pre_migration, bd) : null,
      supply_post_migration: cfg.supply.post_migration > 0n ? units(cfg.supply.post_migration, bd) : null,
      fixed_supply: cfg.fixed_token_supply_flag === 1,
      mint_authority: base.mint_authority, freeze_authority: base.freeze_authority,
      update_authority_option: enumField("token_update_authority", cfg.token_update_authority),
      token_2022_extensions_present: base.has_extensions,
    },
    curve: cfg.curve.map((p, i) => ({ segment: i + 1, up_to_price: priceFromSqrt(p.sqrt_price, bd, qd), liquidity: p.liquidity.toString() })),
    config_version: cfg.version,
    unknowns,
    does_not_check: ["token safety or rug risk", "creator or partner reputation", "off-chain metadata", "Token-2022 extension contents", "whether the fee claimer is trustworthy"],
  };
}

export function renderCard(r) {
  const s = r.status, f = r.fees, m = r.migration, t = r.token;
  const q = r.pool.quote_symbol ?? "quote";
  const pct = s.curve_progress === null ? "unknown" : `${(s.curve_progress * 100).toFixed(1)}%`;
  const fee = f.base_fee;
  const flat = (fee.mode.value === 0 || fee.mode.value === 1) && fee.number_of_periods === 0;
  const feeLine = !fee.mode.name
    ? `unknown base fee mode (${fee.mode.value})`
    : flat
      ? `flat ${fee.starting_fee_bps} bps (no decay periods)`
      : `${fee.mode.name}: starts ${fee.starting_fee_bps} bps${fee.ending_fee_bps != null ? `, ends ${fee.ending_fee_bps} bps after ${fee.number_of_periods} periods` : ""}`;
  return [
    `DBC pool ${r.pool.address}  (slot ${r.observed.slot}, ${r.observed.commitment})`,
    `  token     ${r.pool.base_mint}  ${t.program}, ${t.decimals} decimals, supply ${t.supply_now}${t.fixed_supply ? " (fixed)" : ""}`,
    `            mint authority: ${t.mint_authority ?? "none"}; freeze authority: ${t.freeze_authority ?? "none"}; metadata: ${t.update_authority_option.name ?? "unknown"}`,
    `  quote     ${q} (${r.pool.quote_mint})`,
    `  status    ${s.migration_progress.name ?? `unknown (${s.migration_progress.value})`}`,
    `  progress  ${pct} of the ${s.migration_quote_threshold} ${q} migration threshold (${s.quote_reserve} ${q} in reserve)`,
    `  price     now ${s.price_now} ${q}; started ${s.price_start}; migrates at ${s.price_at_migration}`,
    `  fees      ${feeLine}; dynamic fee ${f.dynamic_fee.enabled ? "on" : "off"}; collected in ${f.collect_fee_mode.name ?? "unknown"}`,
    `            split: protocol ${f.split.protocol_percent}%, then partner ${f.split.of_remainder.partner_percent}% / creator ${f.split.of_remainder.creator_percent}%`,
    `  migrates  to ${m.target.name ?? "unknown"}; post-migration pool fee ${m.post_migration_pool_fee.bps ?? "unknown"} bps (${m.post_migration_pool_fee.tier.name ?? "unknown tier"}); migration fee ${m.migration_fee.percent_of_quote}% of quote (creator share ${m.migration_fee.creator_share_percent}%)`,
    `            LP after migration: partner ${m.liquidity_after_migration.partner_percent}% (+${m.liquidity_after_migration.partner_permanently_locked_percent}% locked), creator ${m.liquidity_after_migration.creator_percent}% (+${m.liquidity_after_migration.creator_permanently_locked_percent}% locked)`,
    `  curve     ${r.curve.length} segment(s); config version ${r.config_version}`,
    r.unknowns.length ? `  UNKNOWN   ${r.unknowns.join("; ")}` : "  unknowns  none",
    `  not checked: ${r.does_not_check.join(", ")}`,
  ].join("\n");
}
