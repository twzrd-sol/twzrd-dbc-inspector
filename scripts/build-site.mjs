import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const assets = {
  html: await fs.readFile(path.join(root, "web/index.html"), "utf8"),
  css: await fs.readFile(path.join(root, "web/style.css"), "utf8"),
  app: await fs.readFile(path.join(root, "web/app.js"), "utf8"),
  mark: await fs.readFile(path.join(root, "assets/mark.svg"), "utf8"),
};
await fs.writeFile(path.join(root, "worker/assets.generated.mjs"), Object.entries(assets).map(([key, value]) => `export const ${key} = ${JSON.stringify(value)};`).join("\n"));
await fs.mkdir(path.join(root, "dist/server"), { recursive: true });
await fs.mkdir(path.join(root, "dist/.openai"), { recursive: true });
await build({
  entryPoints: [path.join(root, "worker/index.mjs")], outfile: path.join(root, "dist/server/index.js"),
  bundle: true, platform: "browser", format: "esm", target: "es2022", minify: true,
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
});
await fs.copyFile(path.join(root, ".openai/hosting.json"), path.join(root, "dist/.openai/hosting.json"));
const stat = await fs.stat(path.join(root, "dist/server/index.js"));
console.log(`Built Sites Worker (${stat.size} bytes)`);
