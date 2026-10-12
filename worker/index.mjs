import { inspectAccounts, NotDbcError } from "../lib/dbc.mjs";
import { compareRules } from "../lib/compare.mjs";
import { address, DEFAULT_RPC_URL, inspectIcelan, inspectLivePool, rpcClient, RpcError } from "../lib/live.mjs";
import usdc from "../fixtures/pool-8QGizJP4.json";
import sol from "../fixtures/pool-29pLrU8Z.json";
import { html, css, app, mark } from "./assets.generated.mjs";

const headers = {
  "cache-control": "no-store", "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
const asset = (body, type) => new Response(body, { headers: { ...headers, "content-type": type } });

export default {
  async fetch(request, env) {
    if (request.method !== "GET") return json({ error: "GET required." }, 405);
    const url = new URL(request.url);
    const rpc = rpcClient(env?.DBC_RPC_URL || DEFAULT_RPC_URL, fetch);
    try {
      if (url.pathname === "/api/pool") return json(await inspectLivePool(address(url.searchParams.get("address")), rpc));
      if (url.pathname === "/api/compare") {
        const [left, right] = await Promise.all([
          inspectLivePool(address(url.searchParams.get("left")), rpc),
          inspectLivePool(address(url.searchParams.get("right")), rpc),
        ]);
        return json(compareRules(left, right));
      }
      if (url.pathname === "/api/icelan") return json(await inspectIcelan(rpc));
      if (url.pathname === "/api/example") {
        const id = url.searchParams.get("id");
        if (id !== "usdc" && id !== "sol") return json({ error: "Example not found." }, 400);
        return json(inspectAccounts(id === "usdc" ? usdc : sol));
      }
      if (url.pathname === "/") return asset(html, "text/html; charset=utf-8");
      if (url.pathname === "/style.css") return asset(css, "text/css; charset=utf-8");
      if (url.pathname === "/app.js") return asset(app, "text/javascript; charset=utf-8");
      if (url.pathname === "/mark.svg") return asset(mark, "image/svg+xml");
      return json({ error: "Not found." }, 404);
    } catch (error) {
      const status = error instanceof NotDbcError ? 422 : error instanceof RpcError ? 503 : error.message === "Enter a valid Solana address." ? 400 : 500;
      return json({ error: status === 500 ? "Unexpected inspection error." : error.message }, status);
    }
  },
};
