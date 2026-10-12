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

const args = process.argv.slice(2);
const json = args.includes("--json");
const fixtureAt = args.indexOf("--fixture");
const target = args.find((a, i) => !a.startsWith("--") && !(fixtureAt >= 0 && i === fixtureAt + 1));

async function liveFixture(pool) {
  const url = process.env.DBC_RPC_URL;
  if (!url) throw Object.assign(new Error("set DBC_RPC_URL to a Solana mainnet RPC endpoint"), { code: 2 });
  const { Connection, PublicKey } = await import("@solana/web3.js");
  const { decodePoolAccount, decodeConfigAccount } = await import("../lib/dbc.mjs");
  const conn = new Connection(url, "confirmed");
  const enc = (a) => a && { owner: a.owner.toBase58(), data_b64: Buffer.from(a.data).toString("base64") };
  const p = await conn.getAccountInfo(new PublicKey(pool));
  if (!p) throw new NotDbcError(`no account at ${pool}`);
  const pd = decodePoolAccount(p.owner.toBase58(), Buffer.from(p.data));
  const c = await conn.getAccountInfo(new PublicKey(pd.config));
  const cd = decodeConfigAccount(c.owner.toBase58(), Buffer.from(c.data));
  const res = await conn.getMultipleAccountsInfoAndContext([pool, pd.config, pd.base_mint, cd.quote_mint].map((k) => new PublicKey(k)));
  const [pa, ca, ba, qa] = res.value;
  return {
    captured_at_utc: new Date().toISOString(), slot: res.context.slot, commitment: "confirmed", endpoint_label: "DBC_RPC_URL",
    pool_address: pool,
    accounts: { pool: enc(pa), config: { address: pd.config, ...enc(ca) }, base_mint: { address: pd.base_mint, ...enc(ba) }, quote_mint: { address: cd.quote_mint, ...enc(qa) } },
  };
}

try {
  let fx;
  if (fixtureAt >= 0) fx = JSON.parse(fs.readFileSync(args[fixtureAt + 1], "utf8"));
  else if (target) fx = await liveFixture(target);
  else { console.error("usage: dbc-inspect.mjs <pool-address> [--json] | --fixture <file> [--json]"); process.exit(2); }
  const report = inspectAccounts(fx);
  console.log(json ? JSON.stringify(report, null, 2) : renderCard(report));
} catch (e) {
  if (e instanceof NotDbcError) { console.error(`not a DBC pool: ${e.message}`); process.exit(1); }
  console.error(`error: ${e.message}`); process.exit(2);
}
