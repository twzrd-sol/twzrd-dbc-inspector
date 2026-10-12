#!/usr/bin/env node
/**
 * Record a DBC pool's raw on-chain accounts as a deterministic test fixture.
 *
 *   DBC_RPC_URL=... node bin/capture-fixture.mjs <pool-address> <out.json> [rpc-label]
 *
 * Reads the pool, its config, and both mints at one finalized slot. Writes base64 account data plus owner, slot and an
 * endpoint *label* (never the URL, which may carry a key). Read-only: no transactions.
 */
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { decodePoolAccount } from "../lib/dbc.mjs";

const [pool, out, label = "unnamed-rpc"] = process.argv.slice(2);
const url = process.env.DBC_RPC_URL;
if (!pool || !out || !url) {
  console.error("usage: DBC_RPC_URL=... node bin/capture-fixture.mjs <pool> <out.json> [rpc-label]");
  process.exit(2);
}
const conn = new Connection(url, "finalized");
const enc = (acct) => acct && { owner: acct.owner.toBase58(), lamports: acct.lamports, data_b64: Buffer.from(acct.data).toString("base64") };

const first = await conn.getMultipleAccountsInfoAndContext([new PublicKey(pool)]);
const poolAcct = first.value[0];
if (!poolAcct) throw new Error("pool account not found");
const decoded = decodePoolAccount(poolAcct.owner.toBase58(), Buffer.from(poolAcct.data));
const config = decoded.config;
const keys = [pool, config, decoded.base_mint];
const cfgFirst = await conn.getMultipleAccountsInfo([new PublicKey(config)]);
const { decodeConfigAccount } = await import("../lib/dbc.mjs");
const cfg = decodeConfigAccount(cfgFirst[0].owner.toBase58(), Buffer.from(cfgFirst[0].data));
keys.push(cfg.quote_mint);
const all = await conn.getMultipleAccountsInfoAndContext(keys.map((k) => new PublicKey(k)));
const [p, c, base, quote] = all.value;
fs.writeFileSync(out, JSON.stringify({
  captured_at_utc: new Date().toISOString(),
  slot: all.context.slot,
  commitment: "finalized",
  endpoint_label: label,
  pool_address: pool,
  accounts: {
    pool: enc(p),
    config: { address: config, ...enc(c) },
    base_mint: { address: decoded.base_mint, ...enc(base) },
    quote_mint: { address: cfg.quote_mint, ...enc(quote) },
  },
}, null, 1));
console.log(`captured ${pool} at slot ${all.context.slot} -> ${out}`);
