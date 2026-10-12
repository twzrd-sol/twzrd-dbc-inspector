const unit = (r) => r.pool.quote_symbol ?? `quote ${r.pool.quote_mint}`;

const FIELDS = [
  ["Quote asset", (r) => r.pool.quote_symbol ?? r.pool.quote_mint],
  ["Token program", (r) => r.token.program],
  ["Token decimals", (r) => r.token.decimals],
  ["Mint authority", (r) => r.token.mint_authority ?? "revoked"],
  ["Freeze authority", (r) => r.token.freeze_authority ?? "revoked"],
  ["Metadata authority", (r) => r.token.update_authority_option?.name],
  ["Start price", (r) => `${r.status.price_start} ${unit(r)}`],
  ["Migration price", (r) => `${r.status.price_at_migration} ${unit(r)}`],
  ["Graduation quote threshold", (r) => `${r.status.migration_quote_threshold} ${unit(r)}`],
  ["Base fee mode", (r) => r.fees.base_fee.mode?.name],
  ["Starting fee (bps)", (r) => r.fees.base_fee.starting_fee_bps],
  ["Ending fee (bps)", (r) => r.fees.base_fee.ending_fee_bps],
  ["Dynamic fee", (r) => r.fees.dynamic_fee.enabled ? "enabled" : "off"],
  ["Fee collection", (r) => r.fees.collect_fee_mode?.name],
  ["Creator share of fee remainder (%)", (r) => r.fees.split.of_remainder.creator_percent],
  ["Migration destination", (r) => r.migration.target?.name],
  ["Graduated pool fee (bps)", (r) => r.migration.post_migration_pool_fee.bps],
  ["Quote-threshold migration fee (%)", (r) => r.migration.migration_fee.percent_of_quote],
  ["Protocol liquidity migration fee (bps)", (r) => r.migration.migration_fee.protocol_liquidity_fee_bps],
  ["Partner liquidity (%)", (r) => r.migration.liquidity_after_migration.partner_percent],
  ["Partner liquidity locked (%)", (r) => r.migration.liquidity_after_migration.partner_permanently_locked_percent],
  ["Creator liquidity (%)", (r) => r.migration.liquidity_after_migration.creator_percent],
  ["Creator liquidity locked (%)", (r) => r.migration.liquidity_after_migration.creator_permanently_locked_percent],
  ["Locked vesting", (r) => r.migration.locked_vesting ? JSON.stringify(r.migration.locked_vesting) : "none"],
  ["Partner LP vesting", (r) => r.migration.partner_liquidity_vesting ? JSON.stringify(r.migration.partner_liquidity_vesting) : "none"],
  ["Creator LP vesting", (r) => r.migration.creator_liquidity_vesting ? JSON.stringify(r.migration.creator_liquidity_vesting) : "none"],
  ["Curve segments", (r) => r.curve?.length],
];

export function compareRules(left, right) {
  const fields = FIELDS.map(([label, read]) => {
    const a = read(left), b = read(right);
    const unknown = a === null || a === undefined || b === null || b === undefined;
    return { label, left: a ?? null, right: b ?? null, result: unknown ? "unknown" : a === b ? "same" : "different" };
  });
  return {
    left: { address: left.pool.address, slot: left.observed.slot, unknowns: left.unknowns },
    right: { address: right.pool.address, slot: right.observed.slot, unknowns: right.unknowns },
    fields,
    different: fields.filter((field) => field.result === "different").length,
    unknown: fields.filter((field) => field.result === "unknown").length,
    note: "Configuration terms only. Changing reserves, current price and trading activity are excluded.",
  };
}
