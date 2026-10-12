import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { inspectAccounts } from "../lib/dbc.mjs";
import { compareRules } from "../lib/compare.mjs";
import { ICELAN_MINT, ICELAN_VAULT_AUTHORITY, ICELAN_VAULT_TOKENS, inspectIcelan, inspectLivePool } from "../lib/live.mjs";
import { createApp } from "../web/server.mjs";

const load = (name) => JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, `../fixtures/${name}`), "utf8"));
const usdc = load("pool-8QGizJP4.json"), sol = load("pool-29pLrU8Z.json");
const rpcAccount = ({ owner, data_b64 }) => ({ owner, data: [data_b64, "base64"] });

test("live reader uses a single final snapshot and preserves its slot", async () => {
  const calls = [];
  const accounts = [usdc.accounts.pool, usdc.accounts.config, usdc.accounts.base_mint, usdc.accounts.quote_mint].map(rpcAccount);
  const rpc = async (method, params) => {
    calls.push([method, params[0]]);
    if (calls.length === 1) return { context: { slot: 1 }, value: accounts[0] };
    if (calls.length === 2) return { context: { slot: 2 }, value: accounts[1] };
    return { context: { slot: 455999999 }, value: accounts };
  };
  const report = await inspectLivePool(usdc.pool_address, rpc);
  assert.equal(report.observed.slot, 455999999);
  assert.deepEqual(calls.map(([method]) => method), ["getAccountInfo", "getAccountInfo", "getMultipleAccounts"]);
  assert.deepEqual(calls[2][1], [usdc.pool_address, usdc.accounts.config.address, usdc.accounts.base_mint.address, usdc.accounts.quote_mint.address]);
});

test("comparison labels quote units and excludes mutable price and reserves", () => {
  const left = inspectAccounts(usdc), right = inspectAccounts(sol);
  const result = compareRules(left, right);
  assert.equal(result.fields.find((field) => field.label === "Quote asset").result, "different");
  assert.match(result.fields.find((field) => field.label === "Start price").left, /USDC$/);
  assert.match(result.fields.find((field) => field.label === "Start price").right, /SOL$/);
  assert.ok(!result.fields.some((field) => /current price|reserve/i.test(field.label)));
});

test("ICELAN reader verifies the vault mint and authority", async () => {
  const mint = Buffer.alloc(82), vault = Buffer.alloc(165);
  mint.writeBigUInt64LE(6_665_498_680_204_183n, 36); mint[44] = 6;
  new PublicKey(ICELAN_MINT).toBuffer().copy(vault, 0);
  new PublicKey(ICELAN_VAULT_AUTHORITY).toBuffer().copy(vault, 32);
  vault.writeBigUInt64LE(100_000_000_000n, 64);
  const token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const rpc = async (_method, params) => {
    assert.deepEqual(params[0], [ICELAN_MINT, ICELAN_VAULT_TOKENS]);
    return { context: { slot: 455999999 }, value: [mint, vault].map((bytes) => ({ owner: token, data: [bytes.toString("base64"), "base64"] })) };
  };
  const report = await inspectIcelan(rpc);
  assert.equal(report.supply, "6665498680.204183");
  assert.equal(report.vault.balance, "100000");
  vault[0] = 0;
  await assert.rejects(() => inspectIcelan(rpc), /wrong mint/);
});

test("HTTP app serves the page and separates valid, invalid and ICELAN routes", async (t) => {
  const app = createApp({ pool: async () => inspectAccounts(usdc), icelan: async () => ({ mint: ICELAN_MINT }) });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.address().port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200); assert.match(await page.text(), /DBC Launch Review/);
  const pool = await fetch(`${base}/api/pool?address=${usdc.pool_address}`);
  assert.equal(pool.status, 200); assert.equal((await pool.json()).pool.quote_symbol, "USDC");
  const invalid = await fetch(`${base}/api/pool?address=not-an-address`);
  assert.equal(invalid.status, 400);
  const icelan = await fetch(`${base}/api/icelan`);
  assert.equal((await icelan.json()).mint, ICELAN_MINT);
});
