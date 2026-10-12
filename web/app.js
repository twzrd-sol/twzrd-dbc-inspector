const $ = (selector) => document.querySelector(selector);
const POOLS = {
  usdc: "8QGizJP4ebiJbMKnbqWNDBjN3XSbZQMgEpA3mjhBFvK8",
  sol: "29pLrU8ZKefyKuRQ1mUcba91qPzP9zFjrgCLmCNFm5io",
};
let currentReport;

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined && value !== null) element.textContent = String(value);
  return element;
}
function fieldCard(label, value, detail = "", accent = false) {
  const card = node("div", `card${accent ? " accent" : ""}`);
  card.append(node("div", "label", label), node("div", "value", value ?? "Unknown"));
  if (detail) card.append(node("div", "detail", detail));
  return card;
}
function explorer(address, label) {
  const a = node("a", "mono", label ?? address);
  a.href = `https://explorer.solana.com/address/${encodeURIComponent(address)}`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}
function stack(...children) { const el = node("div", "grid"); el.append(...children); return el; }
function status(id, message) { $(`#${id}-message`).textContent = message; }
async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body;
}
function metadata(title, sub, report) {
  const box = node("div", "result-meta");
  const identity = node("div");
  identity.append(node("strong", "", title), node("small", "", sub));
  box.append(identity);
  if (report) {
    const download = node("button", "", "Download JSON ↓");
    download.type = "button";
    download.addEventListener("click", () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = `dbc-${report.pool.address}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    box.append(download);
  }
  return box;
}
function renderReport(report, source) {
  currentReport = report;
  const container = $("#inspect-result");
  container.replaceChildren();
  const { pool, status: state, fees, migration, token, observed } = report;
  container.append(metadata(`DBC pool ${pool.address}`, `${source} · ${observed.commitment} slot ${observed.slot} · observed ${observed.at_utc}`, report));
  container.append(stack(
    fieldCard("Curve progress", state.curve_progress === null ? "Unknown" : `${(state.curve_progress * 100).toFixed(1)}%`, `${state.quote_reserve} / ${state.migration_quote_threshold} ${pool.quote_symbol ?? "quote units"}`, true),
    fieldCard("Current price", `${state.price_now} ${pool.quote_symbol ?? "quote"}`, `Starts ${state.price_start} · migrates ${state.price_at_migration}`),
    fieldCard("Launch state", state.migration_progress.name, state.is_migrated ? "Migration recorded" : "On-chain pool state"),
    fieldCard("Base fee", `${fees.base_fee.starting_fee_bps} bps`, `${fees.base_fee.mode.name ?? "Unknown mode"} · dynamic fee ${fees.dynamic_fee.enabled ? "on" : "off"}`),
    fieldCard("Migration", migration.target.name, `Graduated pool fee ${migration.post_migration_pool_fee.bps ?? "unknown"} bps`),
    fieldCard("Liquidity locks", `${migration.liquidity_after_migration.partner_permanently_locked_percent}% partner`, `${migration.liquidity_after_migration.creator_permanently_locked_percent}% creator permanently locked`),
    fieldCard("Token authorities", token.mint_authority ? "Mint authority present" : "Mint authority revoked", token.freeze_authority ? "Freeze authority present" : "Freeze authority revoked"),
    fieldCard("Token supply", token.supply_now, `${token.program} · ${token.decimals} decimals`),
    fieldCard("Curve", `${report.curve.length} segment${report.curve.length === 1 ? "" : "s"}`, `${fees.collect_fee_mode.name ?? "Unknown collection mode"} · ${fees.split.of_remainder.creator_percent}% creator share of remainder`),
  ));
  const addressBox = node("div", "result-meta");
  const addressContent = node("div");
  addressContent.append(node("strong", "", "Accounts behind this review"), node("small", "", "Pool · configuration · base mint · quote mint"));
  const links = node("div", "detail");
  [pool.address, pool.config, pool.base_mint, pool.quote_mint].forEach((key, i) => {
    if (i) links.append(document.createTextNode(" · "));
    links.append(explorer(key, ["Pool ↗", "Config ↗", "Base ↗", "Quote ↗"][i]));
  });
  addressContent.append(links); addressBox.append(addressContent); container.append(addressBox);
  if (report.unknowns.length) container.append(node("div", "unknown-box", `Unknown fields: ${report.unknowns.join("; ")}`));
  else container.append(node("div", "unknown-box", "Unknown fields: none in this report. Token safety and reputation are outside this inspection."));
}

function renderComparison(result) {
  const container = $("#compare-result"); container.replaceChildren();
  container.append(metadata(`${result.different} rule differences`, `${result.left.address} ↔ ${result.right.address} · slots ${result.left.slot} / ${result.right.slot}`));
  container.append(node("p", "compare-summary", `${result.note} ${result.unknown} fields have an unknown value. Each column was observed at its own slot.`));
  const table = node("table", "compare-table");
  const head = node("thead"); const hr = node("tr");
  ["Launch rule", "First pool", "Second pool"].forEach((label) => hr.append(node("th", "", label)));
  head.append(hr); table.append(head);
  const body = node("tbody");
  result.fields.forEach((field) => {
    const row = node("tr", field.result);
    [field.label, field.left ?? "Unknown", field.right ?? "Unknown"].forEach((value) => row.append(node("td", "", value)));
    body.append(row);
  });
  table.append(body); container.append(table);
  const unknowns = [...result.left.unknowns, ...result.right.unknowns];
  if (unknowns.length) container.append(node("div", "unknown-box", `Decoder unknowns: ${unknowns.join("; ")}`));
}

function renderIcelan(report) {
  const container = $("#icelan-result"); container.replaceChildren();
  container.append(metadata("ICELAN · existing SPL reward token", `Mainnet · ${report.observed.commitment} slot ${report.observed.slot} · observed ${report.observed.at_utc}`));
  container.append(stack(
    fieldCard("Total minted supply", report.supply, `${report.decimals} decimals`, true),
    fieldCard("Rewards vault balance", report.vault.balance, "Tokens held in the recorded vault account"),
    fieldCard("Authorities", "Revoked", `Mint: ${report.mint_authority ?? "none"} · Freeze: ${report.freeze_authority ?? "none"}`),
  ));
  const accounts = node("div", "result-meta"); const content = node("div");
  content.append(node("strong", "", "On-chain sources"), node("small", "", "Mint and vault token account, read at one slot"));
  content.append(explorer(report.mint, "Mint ↗"), document.createTextNode(" · "), explorer(report.vault.token_account, "Vault tokens ↗"));
  accounts.append(content); container.append(accounts);
  container.append(node("div", "unknown-box", report.dbc_status));
}

function showView(name) {
  document.querySelectorAll(".view").forEach((view) => { view.hidden = view.id !== name; view.classList.toggle("active", view.id === name); });
  document.querySelectorAll(".tab").forEach((tab) => { const selected = tab.dataset.view === name; tab.classList.toggle("active", selected); if (selected) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current"); });
}
document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$("#inspect-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const address = $("#pool-address").value.trim();
  status("inspect", "Reading mainnet accounts…");
  try {
    const report = await getJson(`/api/pool?address=${encodeURIComponent(address)}`);
    renderReport(report, "Live mainnet read"); status("inspect", "Live inspection complete.");
    const url = new URL(window.location.href); url.searchParams.set("pool", address); history.replaceState(null, "", url);
  } catch (error) { $("#inspect-result").replaceChildren(); status("inspect", error.message); }
});
document.querySelectorAll("[data-example]").forEach((button) => button.addEventListener("click", async () => {
  status("inspect", "Loading recorded mainnet bytes…");
  try { renderReport(await getJson(`/api/example?id=${button.dataset.example}`), "Recorded example"); status("inspect", "Recorded example loaded. Use an address above for a fresh read."); }
  catch (error) { status("inspect", error.message); }
}));
$("#compare-form").addEventListener("submit", async (event) => {
  event.preventDefault(); status("compare", "Reading both pools on mainnet…");
  const left = $("#left-address").value.trim(), right = $("#right-address").value.trim();
  try { renderComparison(await getJson(`/api/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`)); status("compare", "Comparison complete."); }
  catch (error) { $("#compare-result").replaceChildren(); status("compare", error.message); }
});
$("#sample-compare").addEventListener("click", () => {
  $("#left-address").value = POOLS.usdc; $("#right-address").value = POOLS.sol;
  $("#compare-form").requestSubmit();
});
$("#inspect-icelan").addEventListener("click", async () => {
  status("icelan", "Reading ICELAN mint and rewards vault…");
  try { renderIcelan(await getJson("/api/icelan")); status("icelan", "ICELAN accounts read at one mainnet slot."); }
  catch (error) { $("#icelan-result").replaceChildren(); status("icelan", error.message); }
});
const initialPool = new URLSearchParams(location.search).get("pool");
if (initialPool) { $("#pool-address").value = initialPool; $("#inspect-form").requestSubmit(); }
