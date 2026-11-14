"use strict";
const CFG = window.DESK_CONFIG;
const $app = document.getElementById("app");
const LS = window.localStorage;
let S = { data: null, err: null, view: "home", coin: null, tab: "home", coinData: null, coinErr: null, activity: null, chart: null, report: null, delayed: false, lastOk: 0, rate: null };

// ---------- helpers (textContent only: coin names come from outside)
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "href") { if (/^https:\/\/fomo\.family\//.test(v)) { e.setAttribute("href", v); e.setAttribute("target", "_blank"); e.setAttribute("rel", "noopener"); } }
    else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const usd = (v, d = 2) => (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const sgn = (v, d = 1) => (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
const tcls = (v) => (v >= 0 ? "green" : "red");
const ago = (t) => { const s = Math.max(0, Date.now() / 1000 - t); return s < 90 ? Math.round(s) + "s" : s < 5400 ? Math.round(s / 60) + "m" : Math.round(s / 3600) + "h"; };
const hm = (t) => new Date(t * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
const fmtPrice = (p) => p >= 1 ? p.toFixed(4) : p >= 0.001 ? p.toFixed(6) : p.toPrecision(3);

// ---------- credentials (the fragment is stored, then removed from the address bar)
(function readHash() {
  const p = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  if (p.get("d")) LS.setItem("desk.d", p.get("d"));
  if (p.get("t")) LS.setItem("desk.t", p.get("t"));
  if (p.get("view")) S.view = p.get("view");
  const q = new URLSearchParams(location.search);
  if (q.get("view")) { S.view = q.get("view"); if (["home", "agents", "account"].includes(S.view)) S.tab = S.view; }
  if (q.get("coin")) S.coin = q.get("coin");
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
})();

// ---------- data layer
const enc = new TextEncoder();
async function sha256hex(s) { const b = await crypto.subtle.digest("SHA-256", enc.encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
async function aesKey(d) { const b = await crypto.subtle.digest("SHA-256", enc.encode("desk-key:" + d)); return crypto.subtle.importKey("raw", b, "AES-GCM", false, ["decrypt"]); }
const b64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function decrypt(d, text) {
  const j = JSON.parse(text);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(j.iv) }, await aesKey(d), b64(j.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function load(name) {
  const qs = new URLSearchParams(location.search);
  if (qs.get("local")) { const r = await fetch("testdata-" + qs.get("local") + "/" + name + "?x=" + Date.now()); if (!r.ok) throw new Error("local " + r.status); return r.json(); }
  const t = LS.getItem("desk.t"), d = LS.getItem("desk.d");
  if (t && !d) {   // plan A: same-origin API with the token
    const path = name.replace(".json", "").replace(/^coin\//, "coin/");
    const r = await fetch("api/" + path, { headers: { Authorization: "Bearer " + t }, cache: "no-store" });
    if (r.status === 401) throw new Error("This device has no valid access token. Open the app link again.");
    if (!r.ok) throw new Error("api " + r.status);
    return r.json();
  }
  if (!d) throw new Error("This device is not linked yet. Open the private app link once.");
  const slug = (await sha256hex("desk-slug:" + d)).slice(0, 32);
  const base = `${CFG.owner}/${CFG.repo}`;
  const gh = LS.getItem("desk.gh");
  let text = null;
  const hdr = { Accept: "application/vnd.github.raw+json" };
  if (gh) hdr.Authorization = "Bearer " + gh;
  if (!(S.rate && Date.now() < S.rate)) {
    const r = await fetch(`https://api.github.com/repos/${base}/contents/d/${slug}/${name}?ref=${CFG.branch}`, { headers: hdr, cache: "no-cache" });
    if (r.ok) { text = await r.text(); S.delayed = false; }
    else if (r.status === 403 || r.status === 429) { S.rate = Date.now() + 10 * 60 * 1000; }
    else if (r.status === 404) throw new Error("No data yet for this link (404).");
    else throw new Error("GitHub " + r.status);
  }
  if (text === null) {   // rate limited: cached copy, up to 5 min old
    const r = await fetch(`https://raw.githubusercontent.com/${base}/${CFG.branch}/d/${slug}/${name}?t=${Math.floor(Date.now() / 60000)}`);
    if (!r.ok) throw new Error("GitHub raw " + r.status);
    text = await r.text(); S.delayed = true;
  }
  return decrypt(d, text);
}

async function refresh() {
  try {
    S.data = await load("state.json"); S.err = null; S.lastOk = Date.now();
    S.n = (S.n || 0) + 1; if (S.n % 5 === 1) { try { S.chart = await load("chart.json"); } catch (e) {} }
    if (S.view === "coin" && S.coin) loadCoin(S.coin, true);
  } catch (e) { S.err = String(e.message || e); }
  render();
}
async function loadCoin(m, quiet) {
  try { S.coinData = await load("coin/" + m + ".json"); S.coinErr = null; }
  catch (e) { S.coinErr = String(e.message || e); S.coinData = null; }
  if (!quiet || S.view === "coin") render();
}
async function loadExtra(kind) {
  try { S[kind] = await load(kind === "activity" ? "activity.json" : kind === "chart" ? "chart.json" : "report.json"); } catch (e) { S[kind + "Err"] = String(e.message || e); }
  render();
}

// ---------- canvases (hand-drawn)
function fit(c, hgt) { const dpr = window.devicePixelRatio || 1, pw = c.parentElement ? c.parentElement.clientWidth : 0, w = c.parentElement && c.parentElement.classList.contains("card") ? pw - 24 : (pw || 340); c.width = w * dpr; c.height = hgt * dpr; c.style.height = hgt + "px"; c.style.width = w + "px"; const x = c.getContext("2d"); x.scale(dpr, dpr); return [x, w, hgt]; }
function drawEquity(c, pts) {
  const [x, w, H] = fit(c, 90);
  if (!pts || pts.length < 2) return;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const vs = pts.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.2 || 1;
  const X = t => 6 + (w - 12) * (t - t0) / Math.max(1, t1 - t0), Y = v => H - 8 - (H - 16) * (v - (lo - pad)) / (hi - lo + 2 * pad);
  x.strokeStyle = "#232c40"; x.lineWidth = 1; x.beginPath(); x.moveTo(0, Y(pts[0].v)); x.lineTo(w, Y(pts[0].v)); x.setLineDash([3, 4]); x.stroke(); x.setLineDash([]);
  const up = pts[pts.length - 1].v >= pts[0].v;
  x.strokeStyle = up ? "#2fd18b" : "#ff5d6c"; x.lineWidth = 2; x.beginPath();
  pts.forEach((p, i) => i ? x.lineTo(X(p.t), Y(p.v)) : x.moveTo(X(p.t), Y(p.v))); x.stroke();
}
function drawRing(c, score) {
  const [x, w, H] = fit(c, 84), cx = w / 2, cy = H / 2, r = 32;
  x.lineWidth = 8; x.strokeStyle = "#232c40"; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke();
  if (score !== null && score !== undefined) {
    x.strokeStyle = score >= 70 ? "#2fd18b" : "#38d6f5"; x.lineCap = "round"; x.beginPath(); x.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * score / 100); x.stroke();
  }
  x.fillStyle = "#e8ecf4"; x.font = "700 20px -apple-system,sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(score === null || score === undefined ? "–" : String(score), cx, cy);
}
let discAnim = null;
function drawDisc(c, layers, running) {
  cancelAnimationFrame(discAnim);
  const frame = (ts) => {
    const [x, w, H] = fit(c, 260), cx = w / 2, cy = H / 2, R = 96, r = 52, n = 8;
    x.clearRect(0, 0, w, H);
    const next = layers.findIndex(l => l.pass === null || l.pass === undefined);
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + i * 2 * Math.PI / n + 0.03, a1 = a0 + 2 * Math.PI / n - 0.06, l = layers[i] || {};
      let col = "#1a2132", edge = "#232c40";
      if (l.pass === true) { col = "#103f2f"; edge = "#2fd18b"; } else if (l.pass === false) { col = "#4a1a22"; edge = "#ff5d6c"; }
      x.beginPath(); x.arc(cx, cy, R, a0, a1); x.arc(cx, cy, r, a1, a0, true); x.closePath(); x.fillStyle = col; x.fill(); x.strokeStyle = edge; x.lineWidth = 1.5; x.stroke();
      const am = (a0 + a1) / 2, tx = cx + Math.cos(am) * (R + r) / 2, ty = cy + Math.sin(am) * (R + r) / 2;
      x.fillStyle = l.pass === true ? "#2fd18b" : l.pass === false ? "#ff5d6c" : "#8b96ad"; x.font = "700 15px -apple-system,sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(l.pass === true ? "✓" : l.pass === false ? "✗" : String(i + 1), tx, ty);
    }
    if (running && next >= 0) {   // cyan beam on the layer being taken apart
      const am = -Math.PI / 2 + (next + 0.5) * 2 * Math.PI / n, sweep = 0.5 + 0.5 * Math.sin(ts / 180);
      x.strokeStyle = `rgba(56,214,245,${0.35 + sweep * 0.6})`; x.lineWidth = 3; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(am) * (R + 8), cy + Math.sin(am) * (R + 8)); x.stroke();
    }
    x.fillStyle = "#e8ecf4"; x.font = "700 13px -apple-system,sans-serif"; x.textAlign = "center";
    const done = layers.filter(l => l.pass === true).length, bad = layers.some(l => l.pass === false);
    x.fillText(running ? "taking apart..." : bad ? "rejected" : done === 8 ? "8/8" : "idle", cx, cy);
    if (running && c.isConnected) discAnim = requestAnimationFrame(frame);
  };
  frame(performance.now());
}
function drawCandles(c, d) {
  const [x, w, H] = fit(c, 280), cs = d.candles || [];
  if (!cs.length) return;
  const volH = 46, ph = H - volH - 14, left = 4, right = 58;
  let lo = Math.min(...cs.map(k => k.l)), hi = Math.max(...cs.map(k => k.h));
  const L = d.lines;
  if (L) for (const v of [L.entry, L.stop, L.risk_line]) if (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const pad = (hi - lo) * 0.08 || hi * 0.05; lo -= pad; hi += pad;
  const Y = v => 6 + ph * (1 - (v - lo) / (hi - lo)), cw = (w - left - right) / Math.max(cs.length, 18), vmax = Math.max(...cs.map(k => k.v || 0), 1);
  x.strokeStyle = "#1c2437"; x.lineWidth = 1; x.fillStyle = "#8b96ad"; x.font = "10px -apple-system,sans-serif"; x.textAlign = "left";
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, y = Y(v); x.beginPath(); x.moveTo(left, y); x.lineTo(w - right, y); x.stroke(); x.fillText(fmtPrice(v), w - right + 4, y + 3); }
  cs.forEach((k, i) => {
    const cx = left + cw * (i + 0.5), up = k.c >= k.o, col = up ? "#2fd18b" : "#ff5d6c";
    x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 1; x.beginPath(); x.moveTo(cx, Y(k.h)); x.lineTo(cx, Y(k.l)); x.stroke();
    const y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c)); x.fillRect(cx - cw * 0.35, y1, cw * 0.7, Math.max(1.5, y2 - y1));
    x.globalAlpha = 0.45; const vh = volH * (k.v || 0) / vmax; x.fillRect(cx - cw * 0.35, H - vh - 2, cw * 0.7, vh); x.globalAlpha = 1;
  });
  const line = (v, col, label, dash) => { if (!v) return; x.strokeStyle = col; x.lineWidth = 1.5; x.setLineDash(dash); x.beginPath(); x.moveTo(left, Y(v)); x.lineTo(w - right, Y(v)); x.stroke(); x.setLineDash([]); x.fillStyle = col; x.font = "600 10px -apple-system,sans-serif"; x.fillText(label, left + 2, Y(v) - 3); };
  if (L) { line(L.entry, "#8b96ad", "entry", [2, 4]); if (L.status !== "closed") line(L.risk_line, "#ff9f43", "Risk trailing stop", [6, 4]); else line(L.stop, "#ff5d6c", "stop", [4, 4]); }
}

// ---------- screens
function layerStrips(layers, running) {
  const first = (layers || []).findIndex(l => l.pass === null || l.pass === undefined);
  return h("div", { class: "strips" }, (layers && layers.length ? layers : Array.from({ length: 8 }, (_, i) => ({ n: i + 1, name: "", pass: null }))).map((l, i) =>
    h("div", { class: "strip " + (l.pass === true ? "ok" : l.pass === false ? "bad" : (running && i === first ? "run" : "")) }, l.pass === true ? "✓" : l.pass === false ? "✗" : String(l.n), h("div", {}, (l.name || "").split(" ")[0]))));
}
function openBtn(link, label) { return link ? h("a", { class: "btn", href: link }, label || "Open on FOMO") : null; }
function banner() {
  const out = [];
  if (S.err) out.push(h("div", { class: "banner" }, "Can't read the desk data: " + S.err + " ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); refresh(); }, style: "color:#fff;text-decoration:underline" }, "Retry")));
  else if (S.delayed) out.push(h("div", { class: "banner info" }, "GitHub is rate-limiting this connection: showing a copy up to 5 minutes old."));
  if (S.data && S.data.ticket_note) out.push(h("div", { class: "banner info" }, S.data.ticket_note));
  return out;
}
function header() {
  const d = S.data;
  return h("div", { class: "top" }, h("h1", {}, "Desk"), d ? h("span", { class: "pill " + (d.mode === "LIVE" ? "live" : "paper") }, d.mode) : h("span", { class: "pill" }, "…"));
}
function activityList(rows, empty) {
  if (!rows || !rows.length) return h("div", { class: "empty" }, empty || "No activity yet. The scanner is watching PumpSwap graduations; rows appear here when the agents act.");
  return h("div", {}, rows.map(r => h("div", { class: "act", onclick: () => r.mint && openCoin(r.mint) },
    h("div", {}, h("div", { class: "t" }, r.title), h("div", { class: "sub" }, r.sub)),
    h("div", { class: "r" }, h("div", { class: r.tone === "green" ? "green" : r.tone === "red" ? "red" : "" }, r.amount || ""), h("div", { class: "sub" }, [r.pct, r.time].filter(Boolean).join(" · "))))));
}
function homeView() {
  const d = S.data, kids = [header(), ...banner()];
  if (!d) { kids.push(S.err ? h("div", { class: "empty" }, "No data yet.") : h("div", { class: "empty" }, "Loading…")); return kids; }
  const eq = h("canvas", { id: "eq" });
  kids.push(h("div", { class: "card" }, h("div", { class: "sub" }, d.mode + " stack"), h("div", { class: "big" }, usd(d.stack)),
    h("div", { class: "row" }, h("span", { class: tcls(d.pnl_night) }, "tonight " + (d.pnl_night >= 0 ? "+" : "") + usd(d.pnl_night)), h("span", { class: "sub" }, "free " + usd(d.free) + " · " + (S.lastOk ? "updated " + ago(d.ts) + " ago" : ""))), eq));
  setTimeout(() => drawEquity(document.getElementById("eq"), S.chart ? S.chart.equity : null), 0);
  if (!S.chart) loadExtra("chart");
  kids.push(h("h2", {}, "Open positions"));
  if (!d.positions.length) kids.push(h("div", { class: "card empty" }, "Nothing open. The desk sends a Buy on FOMO button when a coin clears all four agents."));
  for (const p of d.positions) kids.push(h("div", { class: "card", onclick: () => openCoin(p.mint) }, h("div", { class: "row" }, h("b", {}, p.name), h("b", { class: tcls(p.pct) }, sgn(p.pct))),
    h("div", { class: "sub" }, usd(p.size) + " · stop -" + p.stop_pct + "%" + (p.trail_active ? " · trailing" : "") + (p.status === "exiting" ? " · exiting" : "")),
    h("div", { style: "margin-top:8px" }, openBtn(p.link, "Sell on FOMO"))));
  kids.push(h("h2", {}, "Agents"));
  const a = d.agents, mini = (n, v, ok) => h("div", { class: "mini", onclick: () => go("agents") }, h("b", {}, h("i", { class: "dot" + (ok === false ? " off" : "") }), n), h("span", {}, v));
  const hb = d.heartbeats || {}, alive = (k) => !hb[k] || (d.ts - hb[k]) < 150;
  kids.push(h("div", { class: "agents" }, mini("Scanner", a.scanner.pools + " pools", alive("scanner_poll")), mini("Auditor", a.auditor.taken_apart + " apart", alive("auditor")),
    mini("Analyst", a.analyst.scored + " scored", alive("analyst")), mini("Executor", a.executor.trades + " trades", alive("executor")), mini("Risk", a.risk.guarding ? "Guarding" : "Idle", alive("risk"))));
  kids.push(h("h2", {}, "Activity"), h("div", { class: "card" }, activityList(d.activity.slice(0, 12))));
  return kids;
}
function agentsView() {
  const d = S.data, kids = [header(), ...banner()];
  if (!d) return kids.concat(h("div", { class: "empty" }, "No data yet."));
  const a = d.agents, cur = a.auditor.current;
  const sc = h("div", { class: "card" }, h("div", { class: "row" }, h("b", {}, "Scanner"), h("span", { class: "pill " + (a.scanner.ws ? "green" : "red") }, a.scanner.ws ? "listening" : "reconnecting")),
    h("div", { class: "big" }, a.scanner.pools + " pools"), h("div", { class: "sub" }, a.scanner.passed + " passed · " + a.scanner.killed + " killed · " + a.scanner.room + " waiting"),
    a.scanner.feed.length ? h("div", { class: "feed" }, a.scanner.feed.slice(0, 8).map(f => h("div", { class: "f " + f.verdict }, h("span", { class: "n" }, f.verdict === "pass" ? `${f.name} · liq $${Math.round((f.liq || 0) / 1000)}K · → auditor` : f.name), h("span", { class: f.verdict === "pass" ? "green" : "red" }, f.verdict === "pass" ? "✓" : f.reason)))) : h("div", { class: "empty" }, "No graduations seen yet."));
  const au = h("div", { class: "card", onclick: () => go("auditor") }, h("div", { class: "row" }, h("b", {}, "Auditor"), h("span", { class: "sub" }, a.auditor.rejected + " rejected")),
    h("div", { class: "big" }, a.auditor.taken_apart + " taken apart"), layerStrips(cur ? cur.layers : null, a.auditor.running),
    h("div", { class: "sub" }, a.auditor.running ? "taking apart..." : cur ? (cur.status === "passed" ? "8/8 → Executor" : (cur.reason || "")) : "waiting for a coin from Scanner"));
  const an = h("div", { class: "card" }, h("div", { class: "row" }, h("b", {}, "Analyst"), h("span", { class: "tag" }, a.analyst.mode === "rules" ? "rules" : "Jev")), h("div", { class: "sub" }, "Scoring"), h("canvas", { id: "ring" }),
    h("div", { class: "sub" }, a.analyst.ring && a.analyst.ring.name ? a.analyst.ring.name + " · " + a.analyst.ring.status : "no coin scored yet · green from " + a.analyst.min_score));
  setTimeout(() => drawRing(document.getElementById("ring"), a.analyst.ring ? a.analyst.ring.score : null), 0);
  const bar = a.executor.bar, ex = h("div", { class: "card" }, h("div", { class: "row" }, h("b", {}, "Executor"), h("span", { class: "sub" }, d.mode)), h("div", { class: "big" }, a.executor.trades + " trades"),
    h("div", { class: "sub" }, a.executor.last_size ? "$" + a.executor.last_size.toFixed(2) + " · " + a.executor.last_pct.toFixed(1) + "% of stack" : "no trades yet"),
    bar ? h("div", {}, h("div", { class: "bar" }, h("i", { class: bar.status === "filled" ? "full" : bar.status === "executing" ? "go" : "" })), h("div", { class: "sub" }, bar.status === "filled" ? "✓ Filled" : bar.status === "executing" ? "Executing..." : (bar.name + " · " + (bar.reason || bar.status)))) : null);
  const le = a.risk.last_exit, rk = h("div", { class: "card" }, h("div", { class: "row" }, h("b", {}, "Risk"), h("span", { class: "sub" }, le ? (le.reason === "trail" ? "Trailed out" : le.reason === "stop" ? "Stopped" : le.reason) : "")),
    h("div", { class: "big" }, a.risk.guarding ? "Guarding" : "Idle"), h("div", { class: "row", style: "justify-content:flex-start;margin-top:6px" }, h("span", { class: "pill red" }, "stop -" + a.risk.stop_pct + "%"), h("span", { class: "pill green" }, "trail " + a.risk.trail_pct + "%")));
  kids.push(sc, au, an, ex, rk);
  return kids;
}
function auditorView() {
  const d = S.data, kids = [h("button", { class: "back", onclick: () => go("agents") }, "‹ Agents"), ...banner()];
  const cur = d && d.agents.auditor.current;
  if (!cur) return kids.concat(h("div", { class: "empty" }, "No coin audited yet. Scanner passes a coin here after it clears the waiting room."));
  const running = d.agents.auditor.running;
  kids.push(h("div", { class: "row" }, h("h1", {}, cur.name || cur.mint.slice(0, 6)), openBtn(cur.link)), h("canvas", { id: "disc" }));
  setTimeout(() => drawDisc(document.getElementById("disc"), cur.layers, running), 0);
  kids.push(h("div", { class: "card" }, cur.layers.map(l => h("div", { class: "layer " + (l.pass === true ? "ok" : l.pass === false ? "bad" : "") }, h("div", { class: "n" }, l.pass === true ? "✓" : l.pass === false ? "✗" : l.n),
    h("div", {}, h("div", {}, l.name), h("div", { class: "sub " + (l.pass === false ? "red" : "") }, l.value || "not checked"))))));
  return kids;
}
function coinView() {
  const kids = [h("button", { class: "back", onclick: () => go("home") }, "‹ Back"), ...banner()];
  if (S.coinErr) return kids.concat(h("div", { class: "banner" }, "Can't load this coin: " + S.coinErr));
  const c = S.coinData;
  if (!c || c.mint !== S.coin) { loadCoin(S.coin, true); return kids.concat(h("div", { class: "empty" }, "Loading…")); }
  kids.push(h("div", { class: "row" }, h("div", {}, h("h1", {}, c.name || "?"), h("div", { class: "sub" }, (c.symbol || "") + " · " + c.status + (c.reason ? " · " + c.reason : ""))), openBtn(c.link)));
  kids.push(h("div", { class: "card" }, c.candles.length ? h("canvas", { id: "cc" }) : h("div", { class: "empty" }, "No price data yet for this coin."),
    h("div", { class: "sub" }, c.candles.length ? `${c.bucket / 60}-min candles · volume m5 bars` + (c.lines && c.lines.status !== "closed" ? " · orange dashed = Risk trailing stop" : "") : "")));
  setTimeout(() => { const e = document.getElementById("cc"); if (e) drawCandles(e, c); }, 0);
  const L = c.lines;
  if (L) kids.push(h("div", { class: "card" }, kv("Entry", fmtPrice(L.entry)), kv("Size", usd(L.size)), kv("Stop", "-" + L.stop_pct + "% · " + fmtPrice(L.stop)), L.trail ? kv("Trail line", fmtPrice(L.trail)) : null,
    kv("Status", L.status), L.pct !== null && L.pct !== undefined && L.status === "closed" ? kv("Result", sgn(L.pct) + " · " + usd(L.pnl)) : null));
  if (c.holders !== null && c.holders !== undefined) kids.push(h("div", { class: "card" }, kv("Holders", String(c.holders))));
  if (c.audit) kids.push(h("div", { class: "card" }, h("div", { class: "sub" }, "Auditor"), c.audit.layers.map(l => kv(l.n + " " + l.name, (l.pass === true ? "✓ " : l.pass === false ? "✗ " : "– ") + (l.value || "")))));
  if (c.analyst) kids.push(h("div", { class: "card" }, h("div", { class: "sub" }, "Analyst · score " + c.analyst.score + (c.analyst.passed ? " ✓" : " ✗" + (c.analyst.failed && c.analyst.failed[0] ? " " + c.analyst.failed[0] : "")))));
  return kids;
}
const kv = (a, b) => h("div", { class: "kv" }, h("span", { class: "mut" }, a), h("span", {}, b));
function accountView() {
  const d = S.data, kids = [header(), ...banner()];
  if (!d) return kids.concat(h("div", { class: "empty" }, "No data yet."));
  const writable = d.settings_writable;
  kids.push(h("div", { class: "card" }, kv("FOMO handle", "@" + d.fomo_handle), kv("Mode", d.mode), kv("Desk plan", d.plan === "A" ? "A · own server" : "B · GitHub Pages"),
    kv("Web push", d.web_push ? "on" : "Not available on GitHub Pages"), kv("Alerts", "Telegram")));
  kids.push(h("div", { class: "banner info" }, d.plan === "A" ? "Settings are editable here." : "Read-only here (GitHub Pages is static). Change settings from Telegram, e.g. “set stop to -8%”. Web push is not available on GitHub Pages: alerts come through Telegram."));
  kids.push(h("div", { class: "card" }, h("button", { class: "btn alt", onclick: () => { S.report = null; go("report"); } }, "Last morning report")));
  kids.push(h("div", { class: "card" }, h("div", { class: "sub" }, "New to FOMO?"), h("a", { class: "btn alt", href: d.links.signup }, "Invite link")));
  kids.push(h("div", { class: "card" }, h("div", { class: "sub" }, "Faster refresh (optional): a read-only GitHub token raises the limit so this page can poll every 15 s. Stored only on this device."),
    h("input", { class: "tok", type: "password", placeholder: "GitHub token (optional)", value: LS.getItem("desk.gh") || "", onchange: (e) => { const v = e.target.value.trim(); v ? LS.setItem("desk.gh", v) : LS.removeItem("desk.gh"); schedule(); } })));
  const groups = {};
  for (const [k, s] of Object.entries(d.settings)) (groups[k.split(".")[0]] = groups[k.split(".")[0]] || []).push([k, s]);
  for (const [g, items] of Object.entries(groups)) {
    kids.push(h("h2", {}, g + (g === "analyst" ? " (jev / rules)" : "")));
    kids.push(h("div", { class: "card" }, items.map(([k, s]) => settingRow(k, s, writable))));
  }
  kids.push(h("button", { class: "btn alt", onclick: () => { LS.removeItem("desk.d"); LS.removeItem("desk.t"); LS.removeItem("desk.gh"); location.reload(); } }, "Forget this device"));
  return kids;
}
function settingRow(k, s, writable) {
  const num = typeof s.value === "number";
  const label = h("label", {}, s.label, h("span", { class: "mut" }, "  " + k));
  const send = (v) => { if (!writable) return; fetch("api/settings", { method: "POST", headers: { Authorization: "Bearer " + LS.getItem("desk.t"), "Content-Type": "application/json" }, body: JSON.stringify({ key: k, value: String(v) }) }).then(refresh); };
  let ctl;
  if (num && s.min !== null && s.max !== null && s.max - s.min <= 1e7) {
    const step = s.max - s.min <= 1 ? 0.01 : s.max - s.min <= 100 ? 0.5 : 1;
    const out = h("input", { type: "number", value: s.value, step: "any", disabled: !writable ? "" : null, onchange: (e) => send(e.target.value) });
    const rng = h("input", { type: "range", min: s.min, max: s.max, step, value: s.value, disabled: !writable ? "" : null, oninput: (e) => { out.value = e.target.value; }, onchange: (e) => send(e.target.value) });
    ctl = h("div", { class: "ctl" }, rng, out);
  } else ctl = h("div", { class: "ctl" }, h("input", { type: "text", value: String(s.value), disabled: !writable ? "" : null, style: "width:100%", onchange: (e) => send(e.target.value) }));
  return h("div", { class: "set" }, label, ctl);
}
function reportView() {
  const kids = [h("button", { class: "back", onclick: () => go("account") }, "‹ Back"), ...banner()];
  if (S.report === null) { loadExtra("report"); return kids.concat(h("div", { class: "empty" }, "Loading…")); }
  if (S.reportErr || !S.report) return kids.concat(h("div", { class: "empty" }, "No morning report yet."));
  const r = S.report, tbl = (ts) => ts.length ? ts.map(t => h("div", { class: "kv" }, h("a", { href: t.link, style: "color:var(--cyan)" }, t.name || "?"), h("span", { class: tcls(t.pnl) }, `${t.pnl >= 0 ? "+" : ""}${t.pnl} (${t.pct}%) ${t.rule}`))) : h("div", { class: "sub" }, "none");
  kids.push(h("h1", {}, "Night " + r.night), h("div", { class: "sub" }, `${r.mode} · P&L ${r.pnl} · fees $${r.fees_usd} · ${r.coins_seen} coins`));
  kids.push(h("h2", {}, "Red trades"), h("div", { class: "card" }, tbl(r.red)), h("h2", {}, "Green trades"), h("div", { class: "card" }, tbl(r.green)));
  kids.push(h("h2", {}, "Scanner kills"), h("div", { class: "card" }, Object.entries(r.scanner_kills).map(([k, v]) => kv(k, String(v)))));
  kids.push(h("h2", {}, "Auditor refusals"), h("div", { class: "card" }, r.auditor_refusals.map(x => h("div", { class: "kv" }, h("a", { href: x.link, style: "color:var(--cyan)" }, (x.name || "?") + " " + x.time), h("span", {}, `L${x.layer} ${x.value}`)))));
  kids.push(h("h2", {}, "Analyst rejects"), h("div", { class: "card" }, r.analyst_rejects.map(x => h("div", { class: "kv" }, h("a", { href: x.link, style: "color:var(--cyan)" }, (x.name || "?") + " " + x.time), h("span", {}, x.rule)))));
  kids.push(h("div", { class: "sub", style: "margin-top:14px" }, "New to FOMO? ", h("a", { href: (S.data && S.data.links.signup) || "", style: "color:var(--cyan)" }, "Join")));
  return kids;
}

// ---------- shell
function go(v) { S.view = v; if (["home", "agents", "account"].includes(v)) S.tab = v; render(); window.scrollTo(0, 0); }
function openCoin(m) { S.coin = m; S.coinData = null; S.coinErr = null; S.view = "coin"; render(); window.scrollTo(0, 0); }
function render() {
  const v = S.view, body = v === "home" ? homeView() : v === "agents" ? agentsView() : v === "auditor" ? auditorView() : v === "coin" ? coinView() : v === "account" ? accountView() : v === "report" ? reportView() : homeView();
  const nav = h("nav", {}, h("div", { class: "in" }, ["home", "agents", "account"].map(t => h("button", { class: S.tab === t ? "on" : "", onclick: () => go(t) }, t[0].toUpperCase() + t.slice(1)))));
  $app.replaceChildren(...body, nav);
}
let timer = null;
function schedule() { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) refresh(); }, LS.getItem("desk.gh") ? CFG.pollFastMs : CFG.pollMs); }
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
render(); refresh(); schedule();
