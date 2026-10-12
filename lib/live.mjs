import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { decodeConfigAccount, decodeMint, decodePoolAccount, inspectAccounts, NotDbcError } from "./dbc.mjs";

export const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";
export const ICELAN_MINT = "Dxpt78DTyBv3USxqsFKhQsthTF1JnjdiXQXTPLGBK9m";
export const ICELAN_VAULT_TOKENS = "2rWTNKcH9wjcjTgSaktZgpviP6C3XWTwJ9V1EBVRDUVt";
export const ICELAN_VAULT_AUTHORITY = "HYrsR1jrwJXxP91Dr8mxgyMAW1upp8JFXJVZScD5391U";
const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export class RpcError extends Error {}

export function address(input) {
  if (typeof input !== "string" || input.length < 32 || input.length > 44) throw new Error("Enter a valid Solana address.");
  try { return new PublicKey(input).toBase58(); }
  catch { throw new Error("Enter a valid Solana address."); }
}

export function rpcClient(url = DEFAULT_RPC_URL, fetchImpl = fetch) {
  if (!/^https:\/\//.test(url) && !/^http:\/\/127\.0\.0\.1(?::\d+)?\//.test(url)) throw new Error("RPC URL must use HTTPS.");
  let id = 0;
  return async function rpc(method, params) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) { throw new RpcError(`Mainnet RPC unavailable: ${error.message}`); }
    if (!response.ok) throw new RpcError(`Mainnet RPC returned HTTP ${response.status}. Try again shortly.`);
    let body;
    try { body = await response.json(); } catch { throw new RpcError("Mainnet RPC returned invalid JSON."); }
    if (body.error) throw new RpcError(`Mainnet RPC: ${body.error.message ?? "request failed"}`);
    if (!body.result || typeof body.result.context?.slot !== "number") throw new RpcError("Mainnet RPC returned an incomplete response.");
    return body.result;
  };
}

function rawAccount(account) {
  if (!account || typeof account.owner !== "string" || !Array.isArray(account.data) || account.data[1] !== "base64")
    throw new RpcError("Mainnet RPC returned a missing or malformed account.");
  return { owner: account.owner, data_b64: account.data[0] };
}

function bytes(account) { return Buffer.from(rawAccount(account).data_b64, "base64"); }

export async function inspectLivePool(poolInput, rpc = rpcClient(process.env.DBC_RPC_URL || DEFAULT_RPC_URL)) {
  const poolAddress = address(poolInput);
  const options = { encoding: "base64", commitment: "confirmed" };
  const initial = await rpc("getAccountInfo", [poolAddress, options]);
  if (!initial.value) throw new NotDbcError(`no account at ${poolAddress}`);
  const pool = decodePoolAccount(initial.value.owner, bytes(initial.value));
  const configResult = await rpc("getAccountInfo", [pool.config, options]);
  if (!configResult.value) throw new NotDbcError(`missing DBC config ${pool.config}`);
  const config = decodeConfigAccount(configResult.value.owner, bytes(configResult.value));
  const keys = [poolAddress, pool.config, pool.base_mint, config.quote_mint];
  const snapshot = await rpc("getMultipleAccounts", [keys, options]);
  if (!Array.isArray(snapshot.value) || snapshot.value.length !== 4 || snapshot.value.some((item) => !item))
    throw new NotDbcError("pool, config or mint account is missing at the observation slot");
  const [pa, ca, ba, qa] = snapshot.value;
  const fixture = {
    captured_at_utc: new Date().toISOString(), slot: snapshot.context.slot, commitment: "confirmed", endpoint_label: "mainnet-rpc",
    pool_address: poolAddress,
    accounts: {
      pool: rawAccount(pa), config: { address: pool.config, ...rawAccount(ca) },
      base_mint: { address: pool.base_mint, ...rawAccount(ba) },
      quote_mint: { address: config.quote_mint, ...rawAccount(qa) },
    },
  };
  return inspectAccounts(fixture);
}

function formatUnits(amount, decimals) {
  const digits = amount.toString().padStart(decimals + 1, "0");
  if (decimals === 0) return digits;
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`.replace(/\.?0+$/, "");
}

export async function inspectIcelan(rpc = rpcClient(process.env.DBC_RPC_URL || DEFAULT_RPC_URL)) {
  const snapshot = await rpc("getMultipleAccounts", [[ICELAN_MINT, ICELAN_VAULT_TOKENS], { encoding: "base64", commitment: "confirmed" }]);
  if (!Array.isArray(snapshot.value) || snapshot.value.length !== 2 || snapshot.value.some((item) => !item))
    throw new RpcError("ICELAN mint or vault token account is unavailable.");
  const [mintAccount, vaultAccount] = snapshot.value;
  const mint = decodeMint(mintAccount.owner, bytes(mintAccount));
  const vault = bytes(vaultAccount);
  if (vaultAccount.owner !== SPL_TOKEN || vault.length < 165) throw new RpcError("ICELAN vault token account has an unexpected owner or length.");
  if (new PublicKey(vault.subarray(0, 32)).toBase58() !== ICELAN_MINT) throw new RpcError("ICELAN vault token account has the wrong mint.");
  const authority = new PublicKey(vault.subarray(32, 64)).toBase58();
  if (authority !== ICELAN_VAULT_AUTHORITY) throw new RpcError("ICELAN vault token account has the wrong authority.");
  return {
    kind: "existing SPL reward token", mint: ICELAN_MINT, observed: { slot: snapshot.context.slot, commitment: "confirmed", at_utc: new Date().toISOString() },
    decimals: mint.decimals, supply: formatUnits(mint.supply, mint.decimals), mint_authority: mint.mint_authority,
    freeze_authority: mint.freeze_authority,
    vault: { token_account: ICELAN_VAULT_TOKENS, authority, balance: formatUnits(vault.readBigUInt64LE(64), mint.decimals) },
    dbc_status: "This is a token and rewards-vault inspection. No Meteora DBC pool is asserted for ICELAN.",
  };
}
