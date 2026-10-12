import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectAccounts, NotDbcError } from "../lib/dbc.mjs";
import { compareRules } from "../lib/compare.mjs";
import { address, inspectIcelan, inspectLivePool, RpcError } from "../lib/live.mjs";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(webRoot, "../fixtures");
const examples = {
  usdc: "pool-8QGizJP4.json",
  sol: "pool-29pLrU8Z.json",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function example(id) {
  const name = examples[id];
  if (!name) throw new Error("Example not found.");
  return inspectAccounts(JSON.parse(await fs.readFile(path.join(fixtureRoot, name), "utf8")));
}

export function createApp({ pool = inspectLivePool, icelan = inspectIcelan } = {}) {
  return http.createServer(async (req, res) => {
    if (req.method !== "GET") return send(res, 405, { error: "GET required." });
    let url;
    try { url = new URL(req.url, "http://localhost"); }
    catch { return send(res, 400, { error: "Invalid URL." }); }
    try {
      if (url.pathname === "/api/pool") return send(res, 200, await pool(address(url.searchParams.get("address"))));
      if (url.pathname === "/api/compare") {
        const [left, right] = await Promise.all([pool(address(url.searchParams.get("left"))), pool(address(url.searchParams.get("right")))]);
        return send(res, 200, compareRules(left, right));
      }
      if (url.pathname === "/api/icelan") return send(res, 200, await icelan());
      if (url.pathname === "/api/example") return send(res, 200, await example(url.searchParams.get("id")));
      const files = { "/": ["index.html", "text/html; charset=utf-8"], "/app.js": ["app.js", "text/javascript; charset=utf-8"], "/style.css": ["style.css", "text/css; charset=utf-8"], "/mark.svg": ["../assets/mark.svg", "image/svg+xml"] };
      if (!files[url.pathname]) return send(res, 404, { error: "Not found." });
      const [file, type] = files[url.pathname];
      return send(res, 200, await fs.readFile(path.resolve(webRoot, file), "utf8"), type);
    } catch (error) {
      const status = error instanceof NotDbcError ? 422 : error instanceof RpcError ? 503 : error.message === "Enter a valid Solana address." || error.message === "Example not found." ? 400 : 500;
      return send(res, status, { error: status === 500 ? "Unexpected inspection error." : error.message });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  createApp().listen(port, "127.0.0.1", () => console.log(`DBC Launch Review listening on http://127.0.0.1:${port}`));
}
