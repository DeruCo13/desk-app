"use strict";
// Hand-drawn charts on <canvas> (no chart library). devicePixelRatio aware.
(function () {
  const COL = { green: "#00d35a", red: "#ff453a", orange: "#ff9f0a", cyan: "#64d2ff", blue: "#0a84ff", yellow: "#ffd60a", pink: "#ff6b9a",
    sec: "rgba(235,235,245,0.6)", ter: "rgba(235,235,245,0.3)", sep: "rgba(84,84,88,0.55)", c1: "#1c1c1e", c2: "#2c2c2e" };
  const FONT = '-apple-system,"SF Pro Text",system-ui,sans-serif', MONO = 'ui-monospace,"SF Mono",Menlo,monospace';
  const motion = () => !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const prev = {};           // per chart key: what was drawn last (for the slide-in / fade-in)

  function fit(canvas, h) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(100, (canvas.parentElement ? canvas.parentElement.clientWidth : 0) || 340);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    const x = canvas.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [x, w, h];
  }
  function pill(x, px, py, text, color, font) {
    x.font = font || ("600 12px " + FONT);
    const w = Math.ceil(x.measureText(text).width) + 14, hh = 20;
    return { w, h: hh, draw(left, top, alpha) {
      x.save(); x.globalAlpha = alpha;
      x.fillStyle = color; x.globalAlpha = alpha * 0.18; rr(x, left, top, w, hh, 10); x.fill();
      x.globalAlpha = alpha; x.fillStyle = color; x.textBaseline = "middle"; x.textAlign = "left"; x.font = font || ("600 12px " + FONT);
      x.fillText(text, left + 7, top + hh / 2 + 0.5); x.restore();
    } };
  }
  function rr(x, l, t, w, h, r) { x.beginPath(); x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r); x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath(); }

  // ---------- Home line chart: line + gradient fill + dashed start line + marks above the line
  function line(canvas, d, key) {
    const H = 230, [x, W] = fit(canvas, H);
    const padL = 10, padR = 10, top = 78, bot = 14;
    const empty = !d || !d.points || d.points.length < 1 || !d.hasTrades;
    const P = (prev[key] = prev[key] || { n: 0, last: null, marks: new Set() });
    let pts = d && d.points ? d.points.slice() : [];
    const start = d && d.start != null ? d.start : (pts[0] ? pts[0].v : 0);
    const markList = (d && d.marks) || [];
    let t0 = performance.now(), dur = 250;
    const newLast = pts.length ? pts[pts.length - 1] : null;
    const slide = motion() && P.last && newLast && (P.last.t !== newLast.t || P.last.v !== newLast.v) && pts.length >= 2;
    const fromLast = slide ? P.last : null;
    const newMarks = markList.filter((m) => !P.marks.has(m.t + "|" + m.label));
    const fade = motion() && newMarks.length > 0 && P.n > 0;
    function frame(now) {
      const pr = slide ? Math.min(1, (now - t0) / 250) : 1;
      const pf = fade ? Math.min(1, (now - t0) / 200) : 1;
      draw(slide ? ease(pr) : 1, fade ? pf : 1);
      if ((slide && pr < 1) || (fade && pf < 1)) requestAnimationFrame(frame);
    }
    function draw(sp, mp) {
      x.clearRect(0, 0, W, H);
      let p = pts.map((q) => ({ t: q.t, v: q.v }));
      if (fromLast && p.length >= 2) { const l = p[p.length - 1]; p[p.length - 1] = { t: fromLast.t + (l.t - fromLast.t) * sp, v: fromLast.v + (l.v - fromLast.v) * sp }; }
      let vmin = start, vmax = start;
      p.forEach((q) => { vmin = Math.min(vmin, q.v); vmax = Math.max(vmax, q.v); });
      const padv = Math.max((vmax - vmin) * 0.12, Math.abs(start) * 0.002, 0.01);
      vmin -= padv; vmax += padv;
      const yOf = (v) => top + (1 - (v - vmin) / (vmax - vmin)) * (H - top - bot);
      x.strokeStyle = COL.ter; x.lineWidth = 1; x.setLineDash([5, 5]);
      if (empty) {
        const y = top + (H - top - bot) / 2;
        x.beginPath(); x.moveTo(padL, y); x.lineTo(W - padR, y); x.stroke(); x.setLineDash([]);
        x.fillStyle = COL.sec; x.font = "500 15px " + FONT; x.textAlign = "center"; x.textBaseline = "alphabetic";
        x.fillText("Waiting for the first trade", W / 2, y + 34);
        return;
      }
      const ys = yOf(start);
      x.beginPath(); x.moveTo(padL, ys); x.lineTo(W - padR, ys); x.stroke(); x.setLineDash([]);
      if (p.length < 2) return;
      const ta = p[0].t, tb = p[p.length - 1].t, xOf = (t) => padL + (tb === ta ? 0 : (t - ta) / (tb - ta)) * (W - padL - padR);
      const path = () => { x.beginPath(); p.forEach((q, i) => { const X = xOf(q.t), Y = yOf(q.v); i ? x.lineTo(X, Y) : x.moveTo(X, Y); }); };
      path(); x.lineTo(xOf(tb), H - bot); x.lineTo(xOf(ta), H - bot); x.closePath();
      const g = x.createLinearGradient(0, top, 0, H - bot); g.addColorStop(0, "rgba(0,211,90,0.28)"); g.addColorStop(1, "rgba(0,211,90,0)");
      x.fillStyle = g; x.fill();
      path(); x.strokeStyle = COL.green; x.lineWidth = 2.5; x.lineJoin = "round"; x.lineCap = "round"; x.stroke();
      // marks: never overlap, a later mark moves up a row
      const placed = [];
      const yAt = (t) => { for (let i = 1; i < p.length; i++) if (t <= p[i].t) { const a = p[i - 1], b = p[i], f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t); return yOf(a.v + (b.v - a.v) * f); } return yOf(p[p.length - 1].v); };
      markList.slice().sort((a, b) => a.t - b.t).forEach((m) => {
        if (m.t < ta || m.t > tb) return;
        const col = m.kind === "bought" ? COL.blue : m.kind === "stopped" || m.neg ? COL.red : COL.green;
        const pl = pill(x, 0, 0, m.label, col);
        const mx = xOf(m.t), my = yAt(m.t);
        let left = Math.min(Math.max(mx - pl.w / 2, 2), W - pl.w - 2);
        let row = 0;
        for (;; row++) { const t = my - 16 - pl.h - row * 24; if (t < 2 || row > 4) break; if (!placed.some((r) => r.row === row && left < r.l + r.w + 4 && left + pl.w + 4 > r.l)) break; }
        placed.push({ row, l: left, w: pl.w });
        const topY = Math.max(2, my - 16 - pl.h - row * 24);
        const isNew = fade && !P.marks.has(m.t + "|" + m.label), al = isNew ? mp : 1;
        x.save(); x.globalAlpha = al; x.strokeStyle = col; x.lineWidth = 1; x.beginPath(); x.moveTo(mx, my - 4); x.lineTo(mx, topY + pl.h); x.stroke();
        x.fillStyle = col; x.beginPath(); x.arc(mx, my, 4, 0, 7); x.fill(); x.restore();
        pl.draw(left, topY, al);
      });
    }
    if (slide || fade) requestAnimationFrame(frame); else draw(1, 1);
    P.n = pts.length; P.last = newLast ? { t: newLast.t, v: newLast.v } : null; P.marks = new Set(markList.map((m) => m.t + "|" + m.label));
  }

  // ---------- Coin candles + volume + the orange dashed "Risk trailing stop" line
  function candles(canvas, d) {
    const H = 280, [x, W] = fit(canvas, H);
    const cs = (d.candles || []).slice(-90);
    x.clearRect(0, 0, W, H);
    const padR = 54, padL = 6, volH = 52, top = 14, bot = 8;
    if (!cs.length) return false;
    let lo = Math.min(...cs.map((c) => c.l)), hi = Math.max(...cs.map((c) => c.h));
    if (d.riskLine) { lo = Math.min(lo, d.riskLine); hi = Math.max(hi, d.riskLine); }
    const pv = (hi - lo) * 0.1 || hi * 0.05; lo -= pv; hi += pv;
    const ph = H - top - bot - volH - 10, yOf = (v) => top + (1 - (v - lo) / (hi - lo)) * ph;
    const n = cs.length, cw = (W - padL - padR) / n, bw = Math.max(2, cw * 0.62);
    const vmax = Math.max(...cs.map((c) => c.v), 1e-9);
    x.font = "11px " + FONT; x.fillStyle = COL.ter; x.textAlign = "left"; x.textBaseline = "middle";
    [0, 0.5, 1].forEach((f) => { const v = lo + (hi - lo) * (1 - f), y = top + f * ph; x.strokeStyle = "rgba(84,84,88,0.35)"; x.lineWidth = 0.5; x.beginPath(); x.moveTo(padL, y); x.lineTo(W - padR + 4, y); x.stroke(); x.fillText(fmtP(v), W - padR + 8, y); });
    cs.forEach((c, i) => {
      const cx = padL + cw * i + cw / 2, up = c.c >= c.o, col = up ? COL.green : COL.red;
      x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 1;
      x.beginPath(); x.moveTo(cx, yOf(c.h)); x.lineTo(cx, yOf(c.l)); x.stroke();
      const y1 = yOf(Math.max(c.o, c.c)), y2 = yOf(Math.min(c.o, c.c)); x.fillRect(cx - bw / 2, y1, bw, Math.max(1.5, y2 - y1));
      const vh = (c.v / vmax) * volH; x.fillStyle = "rgba(235,235,245,0.22)"; x.fillRect(cx - bw / 2, H - bot - vh, bw, vh);
    });
    if (d.riskLine) {
      const y = yOf(d.riskLine);
      x.strokeStyle = COL.orange; x.lineWidth = 1.5; x.setLineDash([6, 4]); x.beginPath(); x.moveTo(padL, y); x.lineTo(W - padR + 4, y); x.stroke(); x.setLineDash([]);
      const pl = pill(x, 0, 0, "Risk trailing stop", COL.orange); pl.draw(padL + 4, Math.min(y + 4, top + ph - pl.h), 1);
      x.fillStyle = COL.orange; x.font = "600 11px " + FONT; x.textAlign = "left"; x.fillText(fmtP(d.riskLine), W - padR + 8, y);
    }
    return true;
  }
  function fmtP(p) { return p >= 1 ? p.toFixed(3) : p >= 0.01 ? p.toFixed(5) : p.toPrecision(3); }

  // ---------- score ring 0-100, green from `min`
  function ring(canvas, score, min, key) {
    const S = 84, dpr = window.devicePixelRatio || 1;
    canvas.width = S * dpr; canvas.height = S * dpr; canvas.style.width = S + "px"; canvas.style.height = S + "px";
    const x = canvas.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const from = prev[key] != null && motion() ? prev[key] : (motion() ? 0 : score), t0 = performance.now();
    function draw(v) {
      x.clearRect(0, 0, S, S);
      x.lineWidth = 9; x.lineCap = "round";
      x.strokeStyle = COL.c2; x.beginPath(); x.arc(S / 2, S / 2, 34, 0, Math.PI * 2); x.stroke();
      if (score == null) return;
      x.strokeStyle = v >= min ? COL.green : COL.yellow;
      x.beginPath(); x.arc(S / 2, S / 2, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, v / 100)); x.stroke();
      x.fillStyle = "#fff"; x.font = "700 24px -apple-system,'SF Pro Display',system-ui"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(String(Math.round(v)), S / 2, S / 2 + 1);
    }
    if (score == null) { draw(0); return; }
    if (from === score || !motion()) { draw(score); } else {
      (function f(now) { const p = Math.min(1, (now - t0) / 600); draw(from + (score - from) * ease(p)); if (p < 1) requestAnimationFrame(f); })(performance.now());
    }
    prev[key] = score;
  }

  // ---------- Auditor: the coin as a stack of 8 discs, a cyan beam reads them top to bottom
  // st = { states: [8 x "idle"|"pass"|"fail"], beamY: layer-index float or null, mix: [8 x 0..1 progress to the result colour] }
  const DISC_H = 34;
  function discs(canvas, st) {
    const H = 8 * DISC_H + 52, [x, W] = fit(canvas, H);
    x.clearRect(0, 0, W, H);
    const cx = W / 2, rx = Math.min(96, W * 0.28), ry = 12, th = 14, y0 = 34;
    const mixc = (a, b, t) => { const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16)), pb = b.match(/\w\w/g).map((h) => parseInt(h, 16)); return "rgb(" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(",") + ")"; };
    for (let i = 7; i >= 0; i--) {                       // draw bottom up so upper discs overlap correctly
      const cy = y0 + i * DISC_H, s = st.states[i], m = st.mix ? st.mix[i] : (s === "idle" ? 0 : 1);
      const topC = s === "pass" ? mixc("2c2c2e", "00d35a", m) : s === "fail" ? mixc("2c2c2e", "ff453a", m) : "#2c2c2e";
      const sideC = s === "pass" ? mixc("1c1c1e", "00a047", m) : s === "fail" ? mixc("1c1c1e", "c0342b", m) : "#1c1c1e";
      x.fillStyle = sideC; x.beginPath(); x.ellipse(cx, cy + th, rx, ry, 0, 0, Math.PI); x.lineTo(cx - rx, cy); x.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true); x.closePath(); x.fill();
      x.fillRect(cx - rx, cy, rx * 2, th);
      x.fillStyle = sideC; x.beginPath(); x.ellipse(cx, cy + th, rx, ry, 0, 0, Math.PI); x.fill();
      x.fillStyle = topC; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); x.fill();
      x.font = "600 13px " + FONT; x.textBaseline = "middle"; x.textAlign = "center";
      x.fillStyle = COL.ter; x.fillText(String(i + 1), cx - rx - 22, cy + th / 2);
      if (s !== "idle" && m > 0.6) { x.fillStyle = s === "pass" ? COL.green : COL.red; x.font = "700 16px " + FONT; x.fillText(s === "pass" ? "✓" : "✕", cx + rx + 24, cy + th / 2); }
    }
    if (st.beamY != null) {
      const y = y0 + st.beamY * DISC_H + th / 2;
      x.fillStyle = "rgba(100,210,255,0.14)"; x.fillRect(cx - rx - 40, y - 9, rx * 2 + 80, 18);
      x.fillStyle = COL.cyan; x.fillRect(cx - rx - 40, y - 1, rx * 2 + 80, 2);
    }
  }
  window.Charts = { line, candles, ring, discs, COL, motion, ease };
})();
