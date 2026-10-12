#!/usr/bin/env node
/**
 * Inspect a Meteora Dynamic Bonding Curve pool. Read-only.
 *
 *   DBC_RPC_URL=<solana rpc> node bin/dbc-inspect.mjs <pool-address> [--json]
 *   node bin/dbc-inspect.mjs --fixture fixtures/pool-29pLrU8Z.json [--json]
 *
 * Exit 0 = decoded, 1 = not a DBC pool (or a mismatched account), 2 = usage or RPC error.
 */
import fs from "node:fs";
import { inspectAccounts, renderCard, NotDbcError } from "../lib/dbc.mjs";
import { inspectLivePool } from "../lib/live.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const fixtureAt = args.indexOf("--fixture");
const target = args.find((a, i) => !a.startsWith("--") && !(fixtureAt >= 0 && i === fixtureAt + 1));

try {
  let report;
  if (fixtureAt >= 0) report = inspectAccounts(JSON.parse(fs.readFileSync(args[fixtureAt + 1], "utf8")));
  else if (target) report = await inspectLivePool(target);
  else { console.error("usage: dbc-inspect.mjs <pool-address> [--json] | --fixture <file> [--json]"); process.exit(2); }
  console.log(json ? JSON.stringify(report, null, 2) : renderCard(report));
} catch (e) {
  if (e instanceof NotDbcError) { console.error(`not a DBC pool: ${e.message}`); process.exit(1); }
  console.error(`error: ${e.message}`); process.exit(2);
}
