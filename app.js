"use strict";
const CFG = window.DESK_CONFIG, LS = window.localStorage, $app = document.getElementById("app");
const QS = new URLSearchParams(location.search);
const LOCAL = QS.get("local"), FAIL = QS.get("fail"), DELAY = +QS.get("delay") || 0;
const S = { state: null, charts: {}, range: "LIVE", activity: null, actAll: null, actShown: 30, coins: {}, coinErr: {}, err: null, lastOk: 0, nextRetry: 0,
  tab: "home", screen: null, stack: [], loading: true, report: null, rate: null, delayed: false, focus: null, okOnce: false, toast: null, q: "" };
const reduce = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

// ---------- helpers. Coin names come from outside: text nodes only, and only https://fomo.family/ links
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;                       // constants only (icons)
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "href") { if (/^https:\/\/fomo\.family\//.test(v)) { e.setAttribute("href", v); e.setAttribute("target", "_blank"); e.setAttribute("rel", "noopener"); } }
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const usd = (v, d = 2) => (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const sgn = (v, d = 2) => (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
const hm = (t) => new Date(t * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
const fmtP = (p) => p == null ? "n/a" : p >= 1 ? "$" + p.toFixed(3) : p >= 0.01 ? "$" + p.toFixed(5) : "$" + p.toPrecision(3);
const big = (v) => v == null ? "n/a" : v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + Math.round(v);
const age = (m) => m == null ? "" : m >= 60 ? Math.floor(m / 60) + "h old" : Math.max(0, m) + "m old";
const IC = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/></svg>',
  agents: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>',
  activity: '<svg viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
  account: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4-6.5 8-6.5s7 2 8 6.5"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
};
const AGENT = { scanner: ["Scanner", "#64d2ff"], auditor: ["Auditor", "#0a84ff"], analyst: ["Analyst", "#ffd60a"], executor: ["Executor", "#00d35a"], risk: ["Risk", "#ff6b9a"] };
const ago1 = (a) => a; // placeholder for symmetry

// ---------- credentials: the fragment is stored, then removed from the address bar
(function readHash() {
  const p = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  if (p.get("d")) LS.setItem("desk.d", p.get("d"));
  if (p.get("t")) LS.setItem("desk.t", p.get("t"));
  if (p.get("view")) S.tab = p.get("view") === "report" ? "account" : p.get("view");
  if (p.get("view") === "report") S.screen = { type: "report" };
  const v = QS.get("view");
  if (v) {
    if (["home", "agents", "activity", "account"].includes(v)) S.tab = v;
    else if (v === "coin" || v === "auditor") S.screen = { type: v, mint: QS.get("coin") };
    else if (v === "report") { S.tab = "account"; S.screen = { type: "report" }; }
    else if (v === "search" || v === "bell") S.screen = { type: v };
  }
  if (QS.get("range")) S.range = QS.get("range");
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
})();

// ---------- data layer (plan A: same-origin /api with the token. plan B: AES-GCM files on the data branch)
const enc = new TextEncoder();
async function sha256hex(s) { const b = await crypto.subtle.digest("SHA-256", enc.encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
async function aesKey(d) { const b = await crypto.subtle.digest("SHA-256", enc.encode("desk-key:" + d)); return crypto.subtle.importKey("raw", b, "AES-GCM", false, ["decrypt"]); }
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decrypt(d, text) {
  const j = JSON.parse(text);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(j.iv) }, await aesKey(d), b64(j.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function load(name, planA) {
  if (DELAY) await new Promise((r) => setTimeout(r, DELAY));
  if (LOCAL) {
    if (FAIL && S.okOnce) throw new Error("offline");
    const r = await fetch("testdata-" + LOCAL + "/" + name + "?x=" + Date.now());
    if (!r.ok) throw new Error("local " + r.status);
    return r.json();
  }
  const t = LS.getItem("desk.t"), d = LS.getItem("desk.d");
  if (t && !d) {
    const r = await fetch("api/" + planA, { headers: { Authorization: "Bearer " + t }, cache: "no-store" });
    if (r.status === 401) throw new Error("This device has no valid access token");
    if (!r.ok) throw new Error("api " + r.status);
    return r.json();
  }
  if (!d) throw new Error("This device is not linked yet");
  const slug = (await sha256hex("desk-slug:" + d)).slice(0, 32), base = CFG.owner + "/" + CFG.repo, gh = LS.getItem("desk.gh");
  let text = null;
  const hdr = { Accept: "application/vnd.github.raw+json" };
  if (gh) hdr.Authorization = "Bearer " + gh;
  if (!(S.rate && Date.now() < S.rate)) {
    const r = await fetch("https://api.github.com/repos/" + base + "/contents/d/" + slug + "/" + name + "?ref=" + CFG.branch, { headers: hdr, cache: "no-cache" });
    if (r.ok) { text = await r.text(); S.delayed = false; }
    else if (r.status === 403 || r.status === 429) S.rate = Date.now() + 10 * 60 * 1000;
    else if (r.status === 404) throw new Error("No data yet (404)");
    else throw new Error("GitHub " + r.status);
  }
  if (text === null) {   // rate limited: raw copy, a few minutes old
    const r = await fetch("https://raw.githubusercontent.com/" + base + "/" + CFG.branch + "/d/" + slug + "/" + name + "?t=" + Math.floor(Date.now() / 60000));
    if (!r.ok) throw new Error("GitHub raw " + r.status);
    text = await r.text(); S.delayed = true;
  }
  return decrypt(d, text);
}
const planA = () => !!(LS.getItem("desk.t") && !LS.getItem("desk.d") && !LOCAL);
const writable = () => planA() && S.state && S.state.account && S.state.account.settings_writable;
async function api(path, body) {
  const r = await fetch("api/" + path, { method: "POST", headers: { Authorization: "Bearer " + LS.getItem("desk.t"), "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  return { ok: r.ok, j: await r.json().catch(() => ({})) };
}
const sig = (o) => JSON.stringify(o, (k, v) => (k === "ts" || k === "iso" || k === "heartbeats" || k === "heartbeat") ? undefined : v);

async function refreshState() {
  try {
    const d = await load("state.json", "state");
    const changed = sig(d) !== sig(S.state);
    S.state = d; S.okOnce = true; S.err = null; S.lastOk = Date.now(); S.loading = false;
    S.charts.LIVE = Object.assign({ start: d.chart.start, hasTrades: d.chart.has_trades }, d.chart.ranges.LIVE);
    S.activity = d.activity;
    if (changed || !S.rendered) render(); else paintErr();
    if (planA() && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  } catch (e) {
    S.err = e.message || "offline"; S.loading = S.state ? false : S.loading; render();
  }
  S.due.state = Date.now() + stateEvery();
  S.nextRetry = S.due.state;
}
async function loadRange(r) {
  try {
    const d = await load("chart.json", "chart?range=" + r);
    const o = d.ranges ? d.ranges[r] : d;
    S.charts[r] = { start: d.start, hasTrades: d.has_trades != null ? d.has_trades : (o.marks || []).length > 0, points: o.points, marks: o.marks };
    S.err = null;
  } catch (e) { S.err = e.message; }
  S.due.chart = Date.now() + 300000; render();
}
async function loadActivity() {
  try { const d = await load("activity.json", "activity"); S.actAll = d.rows; S.err = null; } catch (e) { S.err = e.message; }
  S.due.activity = Date.now() + 300000; render();
}
async function loadCoin(m) {
  try { S.coins[m] = await load("coin/" + m + ".json", "coin/" + m); delete S.coinErr[m]; }
  catch (e) { S.coinErr[m] = e.message; if (!/404/.test(e.message)) S.err = e.message; }
  S.due.coin = Date.now() + 65000; render();
}
async function loadReport() {
  try { S.report = await load("report.json", "report"); S.err = null; } catch (e) { S.report = S.report || null; S.reportErr = e.message; }
  render();
}
const fast = () => !!LS.getItem("desk.gh") || planA();
const stateEvery = () => (fast() ? CFG.pollFastMs : CFG.pollMs) * (S.screen && (S.screen.type === "coin") ? 3 : 1);
S.due = { state: 0, chart: 0, activity: 0, coin: 0 };
function tick() {
  const now = Date.now();
  if (S.due.state <= now) { S.due.state = now + 1e9; refreshState(); }
  if (!S.screen && S.tab === "home" && S.range !== "LIVE" && S.due.chart <= now) { S.due.chart = now + 1e9; loadRange(S.range); }
  if (!S.screen && S.tab === "activity" && S.due.activity <= now) { S.due.activity = now + 1e9; loadActivity(); }
  if (S.screen && (S.screen.type === "coin" || S.screen.type === "auditor") && S.screen.mint && S.due.coin <= now) { S.due.coin = now + 1e9; loadCoin(S.screen.mint); }
  paintErr();
}

// ---------- odometer: each changed digit rolls 600ms ease-out, 30ms stagger right to left
const ODO = (function () {
  const el = h("span", { class: "odo", role: "text" });
  let text = "", cols = [];
  function build(s) {
    el.textContent = ""; cols = [];
    [...s].forEach((ch) => {
      if (/\d/.test(ch)) {
        const strip = h("span", { class: "strip" }, ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => h("span", null, n)));
        strip.style.transform = "translateY(" + -(+ch) + "em)";
        el.append(h("span", { class: "dg" }, strip)); cols.push(strip);
      } else { el.append(h("span", { class: "ch" }, ch)); cols.push(null); }
    });
  }
  return { el, set(s) {
    el.setAttribute("aria-label", s);
    if (s === text) return;
    if (text === "" || s.length !== text.length) { build(s); text = s; return; }
    const changed = []; for (let i = 0; i < s.length; i++) if (s[i] !== text[i]) changed.push(i);
    changed.sort((a, b) => b - a).forEach((i, rank) => {
      if (!cols[i]) { el.children[i].textContent = s[i]; return; }
      cols[i].style.transition = reduce() ? "none" : "transform 600ms ease-out " + rank * 30 + "ms";
      cols[i].style.transform = "translateY(" + -(+s[i]) + "em)";
    });
    text = s;
  } };
})();

// ---------- shared pieces
const sk = (hgt, extra) => h("div", { class: "sk", style: "height:" + hgt + "px;" + (extra || "") });
function nav() {
  const st = S.state, sub = !!S.screen;
  const handle = (st && st.account && st.account.fomo_handle) || "";
  const unread = st && st.pushes && st.pushes.some((p) => p.ts > +(LS.getItem("desk.seen") || 0));
  if (sub) {
    const title = { coin: "", auditor: "Auditor", search: "Search", bell: "Notifications", report: "Morning report" }[S.screen.type];
    return h("div", { class: "nav" }, h("div", { class: "l" }, h("button", { class: "ib", "aria-label": "Back", html: IC.back, onclick: back })),
      h("div", { class: "title" }, title), h("div", { class: "r" }));
  }
  return h("div", { class: "nav" },
    h("div", { class: "l" }, h("button", { class: "ib", "aria-label": "Account", onclick: () => go("account") }, h("span", { class: "avatar" }, (handle[0] || "G").toUpperCase()))),
    h("button", { class: "title", onclick: () => go("home") }, "Grok Bot ›"),
    h("div", { class: "r" }, h("button", { class: "ib", "aria-label": "Search", html: IC.search, onclick: () => open({ type: "search" }) }),
      h("button", { class: "ib", "aria-label": "Notifications", onclick: () => open({ type: "bell" }) }, h("span", { html: IC.bell }), unread ? h("span", { class: "dot" }) : null)));
}
function errRow() { return h("div", { class: "err", id: "errrow", style: S.err ? "" : "display:none" }, errText()); }
function errText() {
  const n = Math.max(0, Math.round((S.nextRetry - Date.now()) / 1000));
  return "Desk offline · retrying in " + n + "s · last update " + (S.lastOk ? hm(S.lastOk / 1000) : "never");
}
function paintErr() {
  const e = document.getElementById("errrow"); if (!e) return;
  e.style.display = S.err ? "" : "none"; if (S.err) e.textContent = errText();
}
function tabs() {
  const T = [["home", "Home"], ["agents", "Agents"], ["activity", "Activity"], ["account", "Account"]];
  return h("div", { class: "tabs" }, h("div", { class: "in" }, T.map(([k, l]) => h("button", { class: !S.screen && S.tab === k ? "on" : "", onclick: () => go(k) }, h("span", { html: IC[k] }), l))));
}
function go(tab) { S.tab = tab; S.screen = null; S.stack = []; window.scrollTo(0, 0); if (tab === "activity") S.due.activity = 0; render(); }
function open(scr) { S.stack.push({ tab: S.tab, screen: S.screen, y: window.scrollY }); S.screen = scr; window.scrollTo(0, 0); if (scr.type === "auditor" || scr.type === "coin") S.due.coin = 0; if (scr.type === "report" && !S.report) loadReport(); if (scr.type === "bell" && S.state) LS.setItem("desk.seen", Math.max(0, ...S.state.pushes.map((p) => p.ts), 0)); render(); tick(); }
function back() { const p = S.stack.pop(); if (p) { S.tab = p.tab; S.screen = p.screen; } else { S.screen = null; } A.stop(); render(); }
function toast(t) { S.toast = t; render(); setTimeout(() => { S.toast = null; render(); }, 1800); }
const opens = (r) => () => open({ type: r.opens === "auditor" ? "auditor" : "coin", mint: r.mint });

function actRow(r) {
  const cls = r.kind === "sold" ? "green" : r.kind === "stopped" ? "red" : r.kind === "rejected" ? "sec" : "";
  return h("button", { class: "row", onclick: r.mint ? opens(r) : null }, h("div", { class: "grow" }, h("div", { class: "t" }, r.title), h("div", { class: "s" }, r.subtitle)), h("div", { class: "v " + cls }, r.value));
}
function emptyBox(t) { return h("div", { class: "empty" }, t); }

// ---------- HOME
function agentCard(a) {
  const [nm, col] = AGENT[a.name], c = a.card, run = !a.paused;
  const hd = h("div", { class: "hd" }, h("span", { style: "color:" + col }, nm), h("span", { class: "st" + (run ? "" : " off"), title: run ? "running" : "paused" }));
  const card = h("button", { class: "ac", onclick: () => { S.focus = a.name; go("agents"); } }, hd);
  const body = h("div", { class: "body" }), foot = h("div", { class: "ft" });
  let bigEl;
  if (a.name === "scanner") {
    bigEl = h("div", { class: "big" }, c.count, h("small", null, "pools"));
    if (!c.feed.length) body.append(h("div", { class: "sec" }, "Listening for graduations"));
    else body.append(h("div", { class: "feed" }, c.feed.slice(0, 4).map((f) => h("div", { class: f.verdict === "killed" ? "k" : "p" }, h("b", null, f.name), h("i", null, f.verdict === "killed" ? f.reason : "→ auditor")))));
    foot.textContent = c.room + " in the waiting room";
  } else if (a.name === "auditor") {
    bigEl = h("div", { class: "big" }, c.count, h("small", null, "taken apart"));
    const cur = c.current, ls = cur ? cur.layers : [];
    body.append(h("div", { class: "strips" }, [...Array(8)].map((_, i) => h("i", { class: ls[i] && ls[i].pass === true ? "p" : ls[i] && ls[i].pass === false ? "f" : (c.running && ls.findIndex((x) => x.pass == null) === i ? "r" : "") }))));
    body.append(h("div", { class: "sec" }, !cur ? "No coin taken apart yet" : c.running ? "taking apart..." : cur.status === "passed" ? "8/8 → Executor" : cur.reason || "…"));
    foot.textContent = c.rejected + " rejected";
  } else if (a.name === "analyst") {
    bigEl = h("div", { class: "big" }, "Scoring");
    const cv = h("canvas", { width: 84, height: 84 });
    S.after.push(() => Charts.ring(cv, c.ring ? c.ring.score : null, c.min_score, "ring"));
    body.append(h("div", { class: "ringbox" }, cv, h("div", { class: "rt" }, c.ring ? c.ring.name : "No coin scored yet", h("br"), c.ring ? (c.ring.status === "pass" ? "→ Executor" : "rejected") : "")));
    foot.textContent = c.count + " scored" + (c.mode === "rules" ? " · rules mode" : "");
  } else if (a.name === "executor") {
    bigEl = h("div", { class: "big" }, c.count, h("small", null, "trades"));
    const l = c.last, b = c.bar;
    body.append(h("div", { class: "t" }, l ? usd(l.size) + " · " + Math.round(l.pct) + "% of stack" : "Waiting for a signal"));
    if (b && b.status === "filled") body.append(h("div", { class: "bar" }, h("i", { style: "width:100%" })), h("div", { class: "sec" }, "✓ Filled"));
    else if (b && b.status === "executing") { const p = Math.min(100, Math.round((Date.now() / 1000 - b.ts) / 1.2 * 100)); body.append(h("div", { class: "bar" }, h("i", { style: "width:" + p + "%" })), h("div", { class: "sec" }, "Executing... " + p + "%")); }
    else if (b) body.append(h("div", { class: "sec" }, "Skipped · " + (b.reason || "")));
    foot.textContent = c.last ? "last ticket" : "";
  } else {
    bigEl = h("div", { class: "big" }, c.guarding ? "Guarding" : (c.last_exit || "Idle"));
    body.append(h("div", { class: "sec" }, c.guarding ? c.count + " open · last exit " + (c.last_exit || "none yet") : (c.last_exit ? "Nothing open" : "Nothing open yet")),
      h("div", { class: "pills" }, h("span", { class: "pill stop" }, "stop -" + c.stop_pct + "%"), h("span", { class: "pill trail" }, "trail " + c.trail_pct + "%")));
  }
  card.append(bigEl, body, foot);
  return card;
}
function homeView() {
  const st = S.state;
  if (!st) return h("div", null, h("div", { class: "hero" }, sk(66, "width:62%;margin:6px 0 8px"), sk(30, "width:40%")), sk(230, "margin:8px 16px"), sk(44, "margin:0 16px"), sk(200, "margin:26px 16px 0;border-radius:42px"));
  const root = h("div");
  ODO.set(usd(st.balance));
  root.append(h("div", { class: "hero" },
    h("div", { class: "balrow" }, ODO.el, st.mode === "PAPER" ? h("span", { class: "pill paper" }, "PAPER") : null),
    h("div", { class: "subrow" }, h("span", { class: st.today_pct >= 0 ? "green" : "red" }, sgn(st.today_pct)), h("span", { class: "sec", style: "font-weight:500" }, "today"),
      h("span", { class: "pill mult" + (st.multiplier < 1 ? " neg" : "") }, st.multiplier.toFixed(2) + "×"))));
  const wrap = h("div", { class: "chartwrap" });
  const ch = S.charts[S.range];
  if (ch) { const cv = h("canvas"); wrap.append(cv); S.after.push(() => Charts.line(cv, ch, "home-" + S.range)); } else wrap.append(sk(230, "margin:0 16px"));
  root.append(wrap, h("div", { class: "ranges" }, ["LIVE", "1H", "4H", "1D", "1W", "ALL"].map((r) => h("button", { class: r === S.range ? "on" : "", onclick: () => { S.range = r; if (r !== "LIVE" && !S.charts[r]) loadRange(r); render(); } }, r))));
  const run = st.agents.filter((a) => !a.paused).length;
  root.append(h("h2", { class: "sh" }, "Agents · " + run + " running"), h("div", { class: "car", id: "car" }, st.agents.map(agentCard)));
  root.append(h("div", { class: "shrow" }, h("h2", null, "Activity"), h("button", { onclick: () => go("activity") }, "See all")));
  root.append(S.activity && S.activity.length ? h("div", { class: "card list" }, S.activity.slice(0, 5).map(actRow)) : h("div", { class: "card" }, emptyBox("Nothing yet tonight")));
  return root;
}

// ---------- AGENTS
const VCOL = { passed: "green", cleared: "green", bought: "green", sent: "green", sold: "green", killed: "red", rejected: "red", stopped: "red", skipped: "red", missed: "red", running: "sec" };
function agentsView() {
  const st = S.state;
  if (!st) return h("div", null, h("h1", { class: "big" }, "Agents"), [...Array(3)].map(() => sk(190, "margin:0 16px 12px;border-radius:18px")));
  const root = h("div", null, h("h1", { class: "big" }, "Agents"));
  st.agents.forEach((a) => {
    const [nm, col] = AGENT[a.name], c = a.card, run = !a.paused;
    const cnt = { scanner: c.count + " pools today", auditor: c.count + " taken apart · " + c.rejected + " rejected", analyst: c.count + " scored today", executor: c.count + " trades today", risk: c.count + " open" }[a.name];
    const locked = a.locked, can = writable() && !locked;
    const sw = h("button", { class: "swbox", "aria-label": (run ? "Pause " : "Resume ") + nm, disabled: !can, onclick: async () => { if (!can) return; const r = await api("agents/" + a.name + "/" + (run ? "pause" : "resume")); if (!r.ok) toast(r.j.reply || "Not allowed"); refreshState(); } }, h("span", { class: "sw" + (run ? " on" : ""), disabled: !can }));
    const box = h("div", { class: "ag", id: "ag-" + a.name },
      h("div", { class: "top" }, h("span", { class: "st", style: "width:10px;height:10px;border-radius:50%;background:" + (run ? "var(--green)" : "var(--ter)") }), h("span", { class: "nm", style: "color:" + col }, nm), h("span", { class: "sec", style: "font-size:14px" }, run ? "running" : "paused"), sw),
      h("div", { class: "cnt" }, cnt + (locked ? " · locked while a position is open" : (!can && !locked ? " · pause from Telegram: pause " + nm : ""))));
    const dec = h("div", { class: "dec" });
    if (!a.decisions.length) dec.append(h("div", { class: "empty", style: "padding:16px" }, { scanner: "Listening for graduations", auditor: "No coin taken apart yet", analyst: "Nothing scored yet", executor: "No signals yet", risk: "Nothing to guard yet" }[a.name]));
    a.decisions.forEach((d) => dec.append(h("div", { class: "r" }, h("span", { class: "ter", style: "font-size:13px" }, d.time),
      h("div", { class: "c" }, h("a", { href: d.link }, d.name), " ", h("span", null, d.reason)), h("span", { class: "vd " + (VCOL[d.verdict] || "") }, d.verdict))));
    box.append(dec, h("div", { style: "padding:6px 16px 10px" }, h("button", { class: "btn small", onclick: () => { S.focus = "set-" + a.name; go("account"); } }, "Settings")));
    root.append(box);
  });
  return root;
}

// ---------- ACTIVITY
function activityView() {
  const rows = S.actAll || S.activity;
  if (!rows) return h("div", null, h("h1", { class: "big" }, "Activity"), sk(280, "margin:0 16px;border-radius:18px"));
  const root = h("div", null, h("h1", { class: "big" }, "Activity"));
  if (!rows.length) { root.append(h("div", { class: "card" }, emptyBox("Nothing yet tonight"))); return root; }
  root.append(h("div", { class: "card list" }, rows.slice(0, S.actShown).map(actRow)));
  if (rows.length > S.actShown) root.append(h("button", { class: "more", onclick: () => { S.actShown += 30; render(); } }, "Show more"));
  return root;
}

// ---------- AUDITOR screen (beam: 350ms per layer, 150ms to green or red, waits for the server)
const A = (function () {
  let mint = null, raf = 0, m = null;
  const stop = () => { cancelAnimationFrame(raf); raf = 0; mint = null; m = null; };
  function layersOf(doc) { return doc && doc.audit ? doc.audit.layers : null; }
  function begin(mm, doc) {
    if (mint === mm && m) { m.doc = doc; paint(); if (!m.finished && !raf) loop(performance.now()); return; }
    cancelAnimationFrame(raf); mint = mm;
    m = { doc, idx: 0, phase: "travel", t0: performance.now(), from: -1, beam: -1, mix: Array(8).fill(0), states: Array(8).fill("idle"), settled: 0, finished: false };
    loop(performance.now());
  }
  function loop(now) {
    if (!m) return;
    const L = layersOf(m.doc);
    if (!L) { raf = requestAnimationFrame(loop); return; }
    if (reduce()) { L.forEach((r, i) => { m.states[i] = r.pass === true ? "pass" : r.pass === false ? "fail" : "idle"; m.mix[i] = 1; }); m.settled = L.filter((r) => r.pass !== null).length; m.finished = m.doc.audit.status !== "running"; m.beam = null; paint(); return; }
    if (m.idx < 8) {
      if (m.phase === "travel") { const p = Math.min(1, (now - m.t0) / 350); m.beam = m.from + (m.idx - m.from) * p; if (p >= 1) m.phase = "wait"; }
      if (m.phase === "wait") { const r = L[m.idx]; if (r && r.pass !== null) { m.phase = "settle"; m.t0 = now; m.states[m.idx] = r.pass ? "pass" : "fail"; } }
      if (m.phase === "settle") {
        const p = Math.min(1, (now - m.t0) / 150); m.mix[m.idx] = p;
        if (p >= 1) { m.settled = m.idx + 1; if (!L[m.idx].pass) { m.idx = 8; m.finished = true; } else { m.from = m.idx; m.idx++; m.phase = "travel"; m.t0 = now; if (m.idx >= 8) m.finished = true; } }
      }
    }
    paint();
    if (!m.finished || m.idx < 8) raf = requestAnimationFrame(loop); else raf = 0;
  }
  function paint() {
    const cv = document.getElementById("discs"); if (!cv || !m) return;
    Charts.discs(cv, { states: m.states, mix: m.mix, beamY: m.idx < 8 && !m.finished ? m.beam : null });
    const L = layersOf(m.doc) || [];
    document.querySelectorAll("[data-layer]").forEach((row) => {
      const i = +row.dataset.layer, r = L[i], show = i < m.settled || (m.finished && r);
      row.classList.toggle("hid", !show);
      const ic = row.querySelector(".ic"), vl = row.querySelector(".vl");
      if (show && r) { ic.className = "ic " + (r.pass === true ? "p" : r.pass === false ? "f" : ""); ic.textContent = r.pass === true ? "✓" : r.pass === false ? "✕" : "–"; vl.textContent = r.value; }
      else { ic.className = "ic"; ic.textContent = ""; vl.textContent = "…"; }
    });
    const msg = document.getElementById("amsg"); if (!msg) return;
    const au = m.doc.audit; msg.textContent = "";
    if (m.finished && au.status === "rejected") msg.append(h("div", { class: "h red" }, "Rejected · " + au.reason), h("div", { class: "s" }, "Grok Bot won't buy " + (m.doc.name || m.doc.symbol || "this coin")));
    else if (m.finished && au.status === "passed") msg.append(h("div", { class: "h green" }, "Cleared · 8/8 parts"),
      h("div", { class: "s" }, au.sent ? "Sent to Executor · " + usd(au.sent.size) : (m.doc.analyst && !m.doc.analyst.pass ? "Analyst said no · " + m.doc.analyst.reason : "Sent on to Analyst")));
    else msg.append(h("div", { class: "h" }, "Taking apart..."));
  }
  return { begin, stop, paint };
})();
function auditorView() {
  let mint = S.screen.mint;
  if (!mint && S.state) { const a = S.state.agents.find((x) => x.name === "auditor"); mint = a && a.card.current && a.card.current.mint; }
  if (!mint) return h("div", null, S.state ? h("div", { class: "card", style: "margin-top:24px" }, emptyBox("No coin taken apart yet")) : sk(300, "margin:16px"));
  const doc = S.coins[mint];
  if (!doc) return S.coinErr[mint] ? h("div", { class: "card", style: "margin-top:24px" }, emptyBox("No audit for this coin yet")) : h("div", null, sk(60, "margin:8px 16px"), sk(300, "margin:12px 16px"), sk(300, "margin:12px 16px"));
  if (!doc.audit || !doc.audit.status) return h("div", { class: "card", style: "margin-top:24px" }, emptyBox("No coin taken apart yet"));
  const root = h("div", { class: "cn" }, h("div", { class: "nm" }, doc.name || doc.symbol || "Coin"), h("div", { class: "sub" }, (doc.symbol || "") + " · Solana"));
  const cv = h("canvas", { id: "discs" });
  root.append(h("div", { style: "margin:8px -16px 0" }, cv));
  root.append(h("div", { class: "msg", id: "amsg" }));
  const card = h("div", { class: "card" });
  doc.audit.layers.forEach((l, i) => card.append(h("div", { class: "layer hid", "data-layer": i }, h("div", { class: "ic" }), h("div", { class: "nm" }, l.name), h("div", { class: "vl" }, "…"))));
  root.append(card);
  const on = S.state && S.state.settings["auditor.enabled"].value;
  const can = writable();
  const tg = h("button", { class: "toggle", disabled: !can, onclick: async () => {
      if (!can) return;
      if (on && !(confirm("Turn off the Auditor? Coins would go on to Analyst without being taken apart.") && confirm("Really turn it off? Nothing will be checked before buying."))) return;
      const r = await api("settings", { key: "auditor.enabled", value: on ? "false" : "true" }); if (!r.ok) toast(r.j.reply || "Not allowed"); refreshState();
    } }, h("span", null, "Take apart before buying"), h("span", { class: "sw" + (on ? " on" : ""), disabled: !can }));
  root.append(h("div", { class: "card", style: "margin-bottom:8px" }, tg));
  root.append(h("div", { class: "foot" }, can ? "Turning it off asks twice." : "Read-only here. Change it in Telegram: set auditor enabled off"));
  root.append(h("a", { class: "btn blue", href: doc.link }, "Open on FOMO"));
  S.after.push(() => A.begin(mint, doc));
  return root;
}

// ---------- COIN screen
function coinView() {
  const mint = S.screen.mint, doc = S.coins[mint];
  if (!doc) {
    if (S.coinErr[mint]) return h("div", { class: "card", style: "margin-top:24px" }, emptyBox("No data for this coin yet"));
    return h("div", null, sk(40, "width:55%;margin:8px 16px"), sk(56, "width:60%;margin:12px 16px"), sk(280, "margin:12px 16px"), sk(130, "margin:12px 16px"));
  }
  const pos = doc.position, root = h("div");
  const paper = S.state && S.state.mode === "PAPER";
  root.append(h("div", { class: "cn" }, h("div", { class: "nm" }, doc.name || doc.symbol || "Coin", paper ? h("span", { class: "pill paper" }, "PAPER") : null),
    h("div", { class: "sub" }, (doc.symbol || "?") + " · " + doc.chain + " · " + age(doc.age_min), h("span", { class: "chip " + (doc.shield.rejected ? "bad" : "ok") }, doc.shield.ok + "/" + doc.shield.total)),
    h("div", { class: "price" }, fmtP(doc.price)),
    pos && pos.since_entry_pct != null ? h("div", { style: "font-weight:600;font-size:17px", class: pos.since_entry_pct >= 0 ? "green" : "red" }, (pos.since_entry_pct >= 0 ? "▲ " : "▼ ") + Math.abs(pos.since_entry_pct).toFixed(1) + "% since entry") : h("div", { style: "min-height:22px" })));
  const cw = h("div", { class: "chartwrap", style: "margin-top:10px" });
  if (doc.candles && doc.candles.length) { const cv = h("canvas"); cw.append(cv); S.after.push(() => Charts.candles(cv, { candles: doc.candles, riskLine: doc.lines ? doc.lines.risk_line : null })); }
  else cw.append(h("div", { class: "card" }, emptyBox("No price history yet")));
  root.append(cw);
  const st = doc.stats;
  root.append(h("div", { class: "stats", style: "margin-top:12px" }, h("div", null, h("div", { class: "k" }, "Market cap"), h("div", { class: "v" }, big(st.mcap))), h("div", null, h("div", { class: "k" }, "Liquidity"), h("div", { class: "v" }, big(st.liquidity))),
    h("div", null, h("div", { class: "k" }, "24h volume"), h("div", { class: "v" }, big(st.volume24))), h("div", null, h("div", { class: "k" }, "Holders"), h("div", { class: "v" }, st.holders == null ? "n/a" : st.holders))));
  const L = doc.lines;
  if (pos && pos.open && L) {
    const left = L.timeout_left_s, lt = left == null ? "n/a" : Math.floor(left / 3600) + "h " + String(Math.floor((left % 3600) / 60)).padStart(2, "0") + "m";
    root.append(h("div", { class: "shrow" }, h("h2", null, "Your position · " + usd(pos.size) + " in · Executor")));
    root.append(h("div", { class: "card kv" }, h("div", { class: "row" }, h("span", null, "Stop line"), h("span", { class: "v red" }, fmtP(L.stop) + " · -" + pos.stop_pct + "%")),
      h("div", { class: "row" }, h("span", null, "Trail line"), h("span", { class: "v green" }, L.trail != null ? fmtP(L.trail) : "starts at " + fmtP(L.trail_start))),
      h("div", { class: "row" }, h("span", null, "Time left to timeout"), h("span", { class: "v" }, lt))));
  }
  const sell = pos && pos.open;
  root.append(h("a", { class: "btn " + (sell ? "red" : "green"), href: doc.link, style: "margin-top:6px" }, sell ? "Sell on FOMO" : "Buy on FOMO"));
  root.append(h("div", { class: "foot" }, "Audit and score: " + (doc.audit.status ? doc.audit.status : "not audited") + (doc.analyst ? " · score " + doc.analyst.score : "")));
  return root;
}

// ---------- ACCOUNT
const GROUPS = [
  ["Scanner", "scanner", ["min_liquidity_usd", "max_top10_pct", "max_h1_change_pct", "poll_s", "min_pool_age_min", "max_wait_min", "runner_h24_pct"]],
  ["Auditor", "auditor", ["enabled", "max_dev_pct", "max_top10_pct", "min_lp_locked_pct", "min_pool_age_min", "max_bundled", "max_delegated_accounts", "retries"]],
  ["Analyst", "analyst", ["mode", "min_alive_6h", "min_organic", "max_chase", "min_score", "timeout_s"]],
  ["Analyst (rules)", "analyst", ["alive_volume_h1", "organic_buys_h1", "bundled_penalty", "flush_drop_m5_pct", "chase_h1_pct"]],
  ["Executor", "executor", ["stack_pct", "max_pool_pct", "min_ticket_usd", "below_min", "recheck_liq_drop_pct", "recheck_price_up_pct", "confirm_window_min"]],
  ["Risk", "risk", ["poll_s", "stop_pct", "trail_start_pct", "trail_pct", "timeout_h", "timeout_min_gain_pct", "confirm_window_min"]],
  ["Desk", "desk", ["paper_start_stack", "report_time", "notifier", "rpc_url", "push_rejects", "fees_ref_discount", "fomo_handle"]],
];
function settingRow(key, m) {
  const can = writable(), t = m.type, note = h("div", { class: "note" }, "");
  const send = async (v) => { const r = await api("settings", { key, value: String(v) }); note.textContent = r.j.reply || ""; note.style.color = r.ok ? "" : "var(--red)"; if (r.ok) refreshState(); };
  const lab = h("span", { class: "lb" }, m.label);
  if (t === "bool") return h("div", { class: "set" }, h("div", { class: "top" }, lab, h("button", { class: "swbox", disabled: !can, onclick: () => can && send(!m.value) }, h("span", { class: "sw" + (m.value ? " on" : ""), disabled: !can }))), note);
  if (String(t).startsWith("choice:")) return h("div", { class: "set" }, h("div", { class: "top" }, lab), h("div", { class: "seg", style: "margin-top:6px" }, t.split(":")[1].split("|").map((o) => h("button", { class: o === m.value ? "on" : "", disabled: !can, onclick: () => can && send(o) }, o))), note);
  if (t === "str" || t === "time") { const inp = h("input", { type: "text", value: m.value, disabled: !can, style: "width:200px" }); inp.addEventListener("change", () => send(inp.value)); return h("div", { class: "set" }, h("div", { class: "top" }, lab, inp), note); }
  const lo = m.min, hi = m.max, smax = hi <= m.default * 20 ? hi : m.default * 5;
  const step = (smax - lo) <= 1 ? 0.01 : (smax - lo) <= 20 ? 0.1 : (smax - lo) <= 1000 ? 1 : Math.round((smax - lo) / 200);
  const num = h("input", { type: "number", inputmode: "decimal", value: m.value, min: lo, max: hi, step: "any", disabled: !can });
  const rg = h("input", { type: "range", min: lo, max: smax, step, value: Math.min(m.value, smax), disabled: !can });
  rg.addEventListener("input", () => { num.value = rg.value; });
  rg.addEventListener("change", () => send(rg.value)); num.addEventListener("change", () => send(num.value));
  return h("div", { class: "set" }, h("div", { class: "top" }, lab, num), rg, note);
}
function accountView() {
  const st = S.state;
  if (!st) return h("div", null, h("h1", { class: "big" }, "Account"), [...Array(4)].map(() => sk(120, "margin:0 16px 12px;border-radius:18px")));
  const ac = st.account, can = writable(), root = h("div", null, h("h1", { class: "big" }, "Account"));
  // mode + stack
  root.append(h("div", { class: "card", style: "padding:12px 16px" },
    h("div", { class: "seg" }, ["PAPER", "LIVE"].map((m) => h("button", { class: (ac.mode === m ? "on " : "") + (m === "LIVE" ? "live" : ""), disabled: !can && ac.mode !== m ? false : false, onclick: async () => {
      if (!can) { toast("Switch in Telegram: " + m.toLowerCase()); return; }
      if (m === ac.mode) return;
      let body = { mode: m }; if (m === "LIVE") { const t = prompt("Type LIVE to confirm. Money moves only when you tap Buy on FOMO."); if (t !== "LIVE") return; body.confirm = "LIVE"; }
      const r = await api("mode", body); toast(r.j.reply || r.j.error || "done"); refreshState();
    } }, m))),
    h("div", { class: "foot", style: "margin:8px 0 0" }, can ? "LIVE needs a full PAPER night first and typing LIVE." : "Read-only here (no public port). Switch with Telegram: paper | live"),
    h("div", { class: "row", style: "padding:6px 0;min-height:56px" }, h("span", null, "Stack"), can && ac.mode === "LIVE"
      ? h("input", { class: "fld", type: "number", value: ac.stack, onchange: async (e) => { const r = await api("settings", { key: "desk.live_stack", value: e.target.value }); toast(r.j.reply || "saved"); refreshState(); } })
      : h("span", { class: "v" }, usd(ac.stack)))));
  root.append(h("div", { class: "card" },
    h("a", { class: "row", href: ac.profile_url }, h("span", null, "Your FOMO profile"), h("span", { class: "sec" }, "@" + ac.fomo_handle + " ›")),
    h("button", { class: "row", onclick: async () => { const u = ac.signup_url; if (navigator.share) { try { await navigator.share({ url: u, title: "FOMO" }); } catch (_) {} } else { try { await navigator.clipboard.writeText(u); } catch (_) {} toast("Link copied"); } } }, h("span", null, "Invite a friend"), h("span", { class: "sec" }, "Share ›")),
    h("button", { class: "row", onclick: () => open({ type: "report" }) }, h("span", null, "Last morning report"), h("span", { class: "sec" }, "›"))));
  // telegram + push
  root.append(h("div", { class: "card" },
    h("div", { class: "row" }, h("span", null, "Telegram"), h("span", { class: "v " + (ac.telegram.connected ? "green" : "red") }, ac.telegram.connected ? "connected" : "not connected")),
    h("button", { class: "row", onclick: async () => { if (!can) { toast("Send test push in Telegram"); return; } const r = await api("push", { test: true }); toast(r.j.sent ? "Test push sent" : "Push failed"); } }, h("span", null, "Send test push"), h("span", { class: "sec" }, can ? "›" : "via Telegram")),
    h("div", { class: "row" }, h("span", null, "Web push"), h("span", { class: "sec" }, ac.web_push ? "on" : "off · Telegram only on this setup"))));
  if (st.ticket_note) root.append(h("div", { class: "foot" }, st.ticket_note));
  // settings
  root.append(h("div", { class: "shrow" }, h("h2", null, "Settings")));
  if (!can) root.append(h("div", { class: "foot", style: "margin-top:-6px" }, "Read-only on this setup. Change settings in Telegram, e.g. set stop to -8%."));
  const shown = new Set();
  GROUPS.forEach(([title, sec, keys]) => {
    const card = h("div", { class: "card", id: "set-" + sec + (title.includes("rules") ? "-rules" : "") });
    card.append(h("div", { class: "row", style: "min-height:48px" }, h("span", { style: "font-weight:700;font-size:17px" }, title)));
    keys.forEach((k) => { const key = sec + "." + k, m = st.settings[key]; if (m) { shown.add(key); card.append(settingRow(key, m)); } });
    root.append(card);
  });
  const adv = Object.keys(st.settings).filter((k) => !shown.has(k) && k !== "desk.mode");
  if (adv.length) root.append(h("details", { class: "card" }, h("summary", null, "Advanced", h("span", { class: "sec", style: "font-weight:400" }, adv.length + " more")), adv.map((k) => settingRow(k, st.settings[k]))));
  return root;
}

// ---------- REPORT, SEARCH, BELL
function reportView() {
  const r = S.report;
  if (!r) return S.reportErr ? h("div", { class: "card", style: "margin-top:24px" }, emptyBox("No morning report yet")) : h("div", null, sk(60, "margin:8px 16px"), sk(220, "margin:12px 16px"));
  const root = h("div", null, h("h1", { class: "big" }, "Night " + r.night));
  root.append(h("div", { class: "foot", style: "margin-top:-6px" }, r.mode + " · P&L " + usd(r.pnl) + " · fees " + usd(r.fees_usd) + " · " + r.coins_seen + " coins seen · Jev " + r.jev_tokens + " tokens"));
  const trades = (title, ts) => { root.append(h("div", { class: "shrow" }, h("h2", null, title))); root.append(ts.length ? h("div", { class: "card" }, ts.map((t) => h("a", { class: "row", href: t.link }, h("div", { class: "grow" }, h("div", { class: "t" }, t.name), h("div", { class: "s" }, t.rule + " · " + fmtP(t.entry) + " → " + fmtP(t.exit))), h("div", { class: "v " + (t.pnl >= 0 ? "green" : "red") }, usd(t.pnl) + " · " + sgn(t.pct, 1))))) : h("div", { class: "card" }, emptyBox("None"))); };
  trades("Red trades", r.red); trades("Green trades", r.green);
  root.append(h("div", { class: "shrow" }, h("h2", null, "Scanner kills")), h("div", { class: "card" }, Object.keys(r.scanner_kills).length ? Object.entries(r.scanner_kills).map(([k, v]) => h("div", { class: "row" }, h("span", null, k), h("span", { class: "v" }, v))) : emptyBox("None")));
  root.append(h("div", { class: "shrow" }, h("h2", null, "Auditor refusals")), h("div", { class: "card" }, r.auditor_refusals.length ? r.auditor_refusals.map((x) => h("a", { class: "row", href: x.link }, h("div", { class: "grow" }, h("div", { class: "t" }, x.name || "?"), h("div", { class: "s" }, "layer " + x.layer + " " + x.layerName + " · " + x.value)), h("span", { class: "sec" }, x.time))) : emptyBox("None")));
  root.append(h("div", { class: "shrow" }, h("h2", null, "Analyst rejects")), h("div", { class: "card" }, r.analyst_rejects.length ? r.analyst_rejects.map((x) => h("a", { class: "row", href: x.link }, h("div", { class: "grow" }, h("div", { class: "t" }, x.name || "?"), h("div", { class: "s" }, x.rule)), h("span", { class: "sec" }, x.time))) : emptyBox("None")));
  root.append(h("div", { class: "foot" }, r.footer));
  return root;
}
function searchView() {
  const st = S.state, root = h("div");
  const inp = h("input", { type: "search", placeholder: "Name, symbol or mint", value: S.q, autofocus: true });
  const list = h("div", { class: "card list" });
  const fill = () => {
    list.textContent = ""; const q = (inp.value || "").trim().toLowerCase(); S.q = inp.value;
    const rs = (st ? st.search : []).filter((c) => !q || [c.name, c.symbol, c.mint].some((x) => (x || "").toLowerCase().includes(q))).slice(0, 30);
    if (!rs.length) list.append(emptyBox(q && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(inp.value.trim()) ? "Open this mint" : (st ? "No coin found" : "Loading…")));
    rs.forEach((c) => list.append(h("button", { class: "row", onclick: () => { S.screen = null; S.stack.pop(); open({ type: "coin", mint: c.mint }); } }, h("div", { class: "grow" }, h("div", { class: "t" }, c.name || c.symbol), h("div", { class: "s" }, (c.symbol || "") + " · " + c.mint.slice(0, 4) + "…" + c.mint.slice(-4))))));
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(inp.value.trim()) && !rs.length) list.append(h("button", { class: "row", onclick: () => { S.screen = null; S.stack.pop(); open({ type: "coin", mint: inp.value.trim() }); } }, h("span", null, "Open " + inp.value.trim().slice(0, 8) + "…")));
  };
  inp.addEventListener("input", fill); fill();
  root.append(h("div", { class: "search" }, inp), list);
  return root;
}
function bellView() {
  const st = S.state;
  if (!st) return sk(240, "margin:16px");
  return st.pushes.length ? h("div", { class: "card list", style: "margin-top:12px" }, st.pushes.map((p) => h("button", { class: "row", onclick: () => p.mint && open({ type: "coin", mint: p.mint }) }, h("div", { class: "grow" }, h("div", { class: "t" }, p.text), h("div", { class: "s" }, "Grok Bot · " + p.time))))) : h("div", { class: "card", style: "margin-top:12px" }, emptyBox("No pushes yet"));
}

// ---------- shell
S.after = [];
function render() {
  S.rendered = true;
  const y = window.scrollY, car = document.getElementById("car"), cl = car ? car.scrollLeft : 0;
  S.after = [];
  let body;
  const t = S.screen ? S.screen.type : S.tab;
  try {
    body = { home: homeView, agents: agentsView, activity: activityView, account: accountView, coin: coinView, auditor: auditorView, report: reportView, search: searchView, bell: bellView }[t]();
  } catch (e) { body = h("div", { class: "card", style: "margin-top:24px" }, emptyBox("Something went wrong drawing this screen")); console.error(e); }
  if (t !== "auditor") A.stop();
  $app.textContent = "";
  $app.append(nav(), errRow(), body, tabs());
  if (S.toast) $app.append(h("div", { class: "toast" }, S.toast));
  S.after.forEach((f) => f());
  const nc = document.getElementById("car"); if (nc) nc.scrollLeft = cl;
  if (S.focus) { const id = S.focus.startsWith("set-") ? S.focus + (S.focus === "set-analyst" ? "" : "") : "ag-" + S.focus; const el = document.getElementById(id); S.focus = null; if (el) el.scrollIntoView(); else window.scrollTo(0, y); }
  else window.scrollTo(0, y);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) S.due.state = 0; });
render(); setInterval(tick, 1000); tick();
if (S.screen && S.screen.type === "report") loadReport();
if (!S.screen && S.range !== "LIVE") loadRange(S.range);
if (!S.screen && S.tab === "activity") loadActivity();
if (FAIL) setTimeout(refreshState, 1200);
// auditor without ?coin=: pick the latest audited coin once the state arrives
(function pick() { if (S.screen && S.screen.type === "auditor" && !S.screen.mint) { const iv = setInterval(() => { if (S.state) { clearInterval(iv); const a = S.state.agents.find((x) => x.name === "auditor"); const m = a && a.card.current && a.card.current.mint; if (m) { S.screen.mint = m; loadCoin(m); } else render(); } }, 300); } })();
