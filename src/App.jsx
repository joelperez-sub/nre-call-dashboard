import { useState, useMemo, useEffect } from "react";

/* ============================================================================
   CALL ACTIVITY EXECUTIVE DASHBOARD  ·  NEW REACH EDUCATION  ·  LIVE
   ----------------------------------------------------------------------------
   Reads real rows from your Supabase `call_activity` table.
   FILL IN the two values just below (Project URL + anon key), then it's live.
   Auto-refreshes every 2 minutes.
   ========================================================================== */

// 👇 PASTE YOUR TWO VALUES HERE
const SUPABASE_URL = "https://npzzsdqmqpdbtiacafhw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_OcP2Dk_rfPQMRphCJw3pcQ_RXJD0Uzn";

const REFRESH_MS = 120000; // auto-refresh every 2 min
const LOOKBACK_DAYS = 7;   // how much history to chart
const STALE_MIN = 15;      // refresh line turns amber if last pull older than this (minutes)

// ---- THEME ----------------------------------------------------------------
const C = {
  bg: "#0a0e1a", panel: "#0f1626", panelHi: "#131c30", line: "#1d2942",
  text: "#e8edf7", dim: "#5d6b87", dimmer: "#3a4660",
  lime: "#c4f042", cyan: "#4fd6e8", amber: "#f0b429", red: "#f0556d", violet: "#a78bfa",
  subtoSky: "#5bc2f0",
};

// ---- LIVE DATA FETCH ------------------------------------------------------
// PostgREST caps each response at 1000 rows regardless of &limit, so we page
// through with the Range header until we've pulled everything in the window.
async function loadRows() {
  const sinceISO = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString();
  const base =
    `${SUPABASE_URL}/rest/v1/call_activity` +
    `?select=rep_name,ts,direction,duration_sec,connected` +
    `&ts=gte.${encodeURIComponent(sinceISO)}` +
    `&order=ts.desc`;

  const PAGE = 1000;
  let from = 0;
  let all = [];
  // safety ceiling: 7 days * ~5k/day ≈ 35k; allow up to 200 pages (200k rows)
  for (let page = 0; page < 200; page++) {
    const to = from + PAGE - 1;
    const resp = await fetch(base, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Range: `${from}-${to}`,
        "Range-Unit": "items",
      },
    });
    if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${await resp.text()}`);
    const chunk = await resp.json();
    all = all.concat(chunk);
    if (chunk.length < PAGE) break; // last page reached
    from += PAGE;
  }

  // normalize field name to `rep` for the rest of the UI
  return all.map((r) => ({
    rep: r.rep_name, ts: r.ts, direction: r.direction,
    duration_sec: r.duration_sec, connected: r.connected,
  }));
}

// ---- HELPERS --------------------------------------------------------------
// All day/hour math is done in Arizona time (Phoenix = UTC-7, no daylight saving).
const AZ_OFFSET_MS = 7 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, "0");
// shift a UTC timestamp back 7h, then read the date/hour as if local
const azDate = (iso) => new Date(new Date(iso).getTime() - AZ_OFFSET_MS);
const dayKey = (iso) => azDate(iso).toISOString().slice(0, 10);
const azHour = (iso) => azDate(iso).getUTCHours();
const fmtHM = (sec) => { const h = Math.floor(sec / 3600); const m = Math.round((sec % 3600) / 60); return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`; };
const fmtClock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const todayKey = () => dayKey(new Date().toISOString());
// format an epoch ms into AZ wall-clock like "12:14P"
const fmtRefresh = (ms) =>
  new Date(ms)
    .toLocaleTimeString("en-US", { timeZone: "America/Phoenix", hour: "numeric", minute: "2-digit" })
    .replace(/\s/g, "")
    .replace("PM", "P")
    .replace("AM", "A");

// ============================================================================
export default function App() {
  const [rows, setRows] = useState([]);
  const [scope, setScope] = useState("day");
  const [now, setNow] = useState(new Date());
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [errMsg, setErrMsg] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null); // epoch ms of last GOOD pull

  const refresh = () => {
    loadRows()
      .then((r) => { setRows(r); setStatus("ok"); setLastRefresh(Date.now()); })
      .catch((e) => { setStatus("error"); setErrMsg(String(e.message || e)); });
  };

  useEffect(() => { refresh(); const t = setInterval(refresh, REFRESH_MS); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  // staleness recomputes every second because `now` ticks the component
  const refreshStale = lastRefresh != null && (now.getTime() - lastRefresh) / 60000 > STALE_MIN;

  const tKey = todayKey();
  const scoped = useMemo(
    () => (scope === "day" ? rows.filter((r) => dayKey(r.ts) === tKey) : rows),
    [rows, scope, tKey]
  );

  const byRep = useMemo(() => {
    const m = {};
    scoped.forEach((r) => {
      const o = (m[r.rep] ||= { rep: r.rep, dials: 0, talk: 0, conn: 0 });
      o.dials++; o.talk += r.duration_sec || 0; if (r.connected) o.conn++;
    });
    return Object.values(m).map((o) => ({ ...o, rate: o.dials ? o.conn / o.dials : 0 }))
      .sort((a, b) => b.dials - a.dials);
  }, [scoped]);

  const team = useMemo(() => {
    const dials = scoped.length;
    const talk = scoped.reduce((s, r) => s + (r.duration_sec || 0), 0);
    const conn = scoped.filter((r) => r.connected).length;
    return { dials, talk, conn, rate: dials ? conn / dials : 0 };
  }, [scoped]);

  const byHour = useMemo(() => {
    const h = Array.from({ length: 24 }, (_, i) => ({ hour: i, dials: 0, conn: 0 }));
    scoped.forEach((r) => { const hr = azHour(r.ts); h[hr].dials++; if (r.connected) h[hr].conn++; });
    return h.filter((x) => x.hour >= 6 && x.hour <= 20);
  }, [scoped]);

  // DIAL RACE: cumulative dials per rep by AZ hour — always TODAY only.
  // All reps included; top 10 by day total get color + labels, rest are grey pack.
  const race = useMemo(() => {
    const todays = rows.filter((r) => dayKey(r.ts) === tKey && r.direction !== "inbound");
    const HOURS = Array.from({ length: 15 }, (_, i) => i + 6); // 6..20
    const perRep = {};
    todays.forEach((r) => {
      const hr = azHour(r.ts);
      const rep = (perRep[r.rep] ||= { rep: r.rep, total: 0, byHour: {} });
      rep.total++;
      rep.byHour[hr] = (rep.byHour[hr] || 0) + 1;
    });
    const reps = Object.values(perRep).map((rp) => {
      let run = 0;
      const cum = HOURS.map((h) => { run += rp.byHour[h] || 0; return run; });
      return { rep: rp.rep, total: rp.total, cum };
    }).sort((a, b) => b.total - a.total);
    const maxTotal = Math.max(1, ...reps.map((r) => r.total));
    return { reps, hours: HOURS, maxTotal };
  }, [rows, tKey]);

  const weekTrend = useMemo(() => {
    const m = {};
    rows.forEach((r) => { const k = dayKey(r.ts); (m[k] ||= { k, dials: 0, conn: 0 }); m[k].dials++; if (r.connected) m[k].conn++; });
    return Object.values(m).sort((a, b) => a.k.localeCompare(b.k)).slice(-7)
      .map((d) => ({ ...d, rate: d.dials ? d.conn / d.dials : 0 }));
  }, [rows]);

  const ticker = useMemo(() => [...scoped].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 14), [scoped]);

  const maxDials = Math.max(1, ...byRep.map((r) => r.dials));
  const maxTalk = Math.max(1, ...byRep.map((r) => r.talk));
  const bestHour = [...byHour].sort((a, b) => (b.conn / Math.max(1, b.dials)) - (a.conn / Math.max(1, a.dials)))[0];
  const peakHour = [...byHour].sort((a, b) => b.dials - a.dials)[0];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text,
      fontFamily: "'DM Mono', ui-monospace, Menlo, monospace", padding: "18px 22px 40px", boxSizing: "border-box" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Archivo:wght@600;700;800;900&display=swap');
        * { box-sizing: border-box; }
        .disp { font-family:'Archivo',sans-serif; }
        .bar { transition: width .8s cubic-bezier(.2,.8,.2,1); }
        @keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:1} }
        .live-dot { width:7px;height:7px;border-radius:50%;animation:pulse 1.6s infinite; }
        .seg { cursor:pointer; transition:all .15s; }
        .lb-scroll::-webkit-scrollbar { width:6px; }
        .lb-scroll::-webkit-scrollbar-track { background:transparent; }
        .lb-scroll::-webkit-scrollbar-thumb { background:#2a3957; border-radius:3px; }
        .lb-scroll::-webkit-scrollbar-thumb:hover { background:#3a4d72; }
        .lb-scroll { scrollbar-width:thin; scrollbar-color:#2a3957 transparent; }
      `}</style>

      {status === "error" && (
        <div style={{ background: "#2a1620", border: `1px solid ${C.red}`, color: C.red,
          padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 12 }}>
          Couldn't load data: {errMsg}. Check the URL/anon key at the top of the file and that the read policy is set.
        </div>
      )}

      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          <span className="disp" style={{ fontWeight: 900, fontSize: 24, letterSpacing: 1 }}>NEW REACH</span>
          <span style={{ width: 1, height: 30, background: C.line, margin: "0 18px" }} />
          <span className="disp" style={{ fontWeight: 800, fontSize: 22, letterSpacing: 0.5, color: C.subtoSky }}>SubTo</span>
          <span style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginLeft: 14, textTransform: "uppercase" }}>
            Call Activity · {now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Segmented scope={scope} setScope={setScope} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="disp" style={{ fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>{fmtClock(now)}</span>
              <span className="live-dot" style={{ background: status === "ok" ? C.lime : status === "error" ? C.red : C.amber }} />
            </div>
            <div style={{ fontSize: 10, letterSpacing: 1.5, marginTop: 2, textTransform: "uppercase",
              color: refreshStale ? C.amber : C.dimmer }}>
              {lastRefresh
                ? `${refreshStale ? "⚠ " : ""}Refreshed ${fmtRefresh(lastRefresh)}`
                : "Refreshing…"}
            </div>
          </div>
        </div>
      </div>

      {/* TOP TILES */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Tile label="TEAM DIALS" value={team.dials.toLocaleString()} sub={scope === "day" ? "today" : `last ${LOOKBACK_DAYS} days`} color={C.lime} />
        <Tile label="TEAM TALK TIME" value={fmtHM(team.talk)} sub={`${(team.talk / Math.max(1, team.conn) / 60).toFixed(1)}m avg / connect`} color={C.cyan} />
        <Tile label="CONNECT RATE" value={`${(team.rate * 100).toFixed(0)}%`} sub={`${team.conn.toLocaleString()} connects · 60s+`} color={C.amber} pct={team.rate} />
        <Tile label="BEST HOUR TO DIAL" value={bestHour ? `${pad(bestHour.hour)}:00` : "—"} sub={bestHour ? `${((bestHour.conn / Math.max(1, bestHour.dials)) * 100).toFixed(0)}% connect` : ""} color={C.violet} />
      </div>

      {/* HERO: DIAL RACE */}
      <DialRace race={race} />

      {/* LEADERBOARDS + TICKER */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 260px", gap: 14, marginBottom: 14 }}>
        <Leaderboard title="LEADERBOARD · DIALS" rows={byRep} max={maxDials} metric={(r) => r.dials} fmt={(v) => v} color={C.lime} />
        <Leaderboard title="LEADERBOARD · TALK TIME" rows={[...byRep].sort((a, b) => b.talk - a.talk)} max={maxTalk} metric={(r) => r.talk} fmt={fmtHM} color={C.cyan} />
        <Ticker rows={ticker} />
      </div>

      {/* CONNECT RATE + TIME OF DAY */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 14, marginBottom: 14 }}>
        <ConnectPanel rows={byRep} />
        <TimeOfDayPanel byHour={byHour} peak={peakHour} best={bestHour} />
      </div>

      <WeekTrend trend={weekTrend} />
    </div>
  );
}

function DialRace({ race }) {
  const PALETTE = [C.lime, C.cyan, C.violet, C.amber, C.red, "#5ad19a", "#e879c9", "#7aa2f7", "#f4a261", "#9ece6a"];
  const W = 1400, H = 300, padL = 48, padR = 188, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const hours = race.hours;
  const maxX = hours.length - 1;
  const ceilY = Math.max(50, Math.ceil(race.maxTotal / 50) * 50);
  const x = (i) => padL + (i / maxX) * plotW;
  const y = (v) => padT + plotH - (v / ceilY) * plotH;
  const hLabel = (h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;

  const top = race.reps.slice(0, 10);
  const pack = race.reps.slice(10);

  const gridVals = [];
  const step = Math.max(50, Math.round(ceilY / 6 / 50) * 50);
  for (let v = 0; v <= ceilY; v += step) gridVals.push(v);

  // stagger end labels so they don't overlap
  const labelMin = 13;
  const placed = top.map((r, idx) => ({ idx, yEnd: y(r.cum[r.cum.length - 1]) }))
    .sort((a, b) => a.yEnd - b.yEnd);
  const labelY = {};
  let prev = -Infinity;
  placed.forEach((p) => { const ly = Math.max(p.yEnd, prev + labelMin); labelY[p.idx] = ly; prev = ly; });

  const pathFor = (cum) => cum.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 18px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 2 }}>
        <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2 }}>DIAL RACE · CUMULATIVE DIALS BY HOUR</div>
        <div style={{ fontSize: 10, color: C.dimmer, letterSpacing: 1 }}>today · top 10 highlighted · all reps shown</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block", width: "100%", height: "auto" }}>
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={padL} y1={y(v)} x2={padL + plotW} y2={y(v)} stroke={C.line} strokeWidth="1" />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fill={C.dimmer} fontSize="10" fontFamily="'DM Mono',monospace">{v}</text>
          </g>
        ))}
        {hours.map((h, i) => (
          <text key={h} x={x(i)} y={padT + plotH + 20} textAnchor="middle" fill={C.dim} fontSize="10" fontFamily="'DM Mono',monospace">{hLabel(h)}</text>
        ))}
        {pack.map((r) => (
          <path key={r.rep} d={pathFor(r.cum)} fill="none" stroke={C.dimmer} strokeWidth="1" opacity="0.4" strokeLinejoin="round" />
        ))}
        {top.map((r, i) => {
          const col = PALETTE[i % PALETTE.length];
          const lastX = x(maxX), lastY = y(r.cum[r.cum.length - 1]);
          return (
            <g key={r.rep}>
              <path d={pathFor(r.cum)} fill="none" stroke={col} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.95" />
              <circle cx={lastX} cy={lastY} r="3.5" fill={col} />
              <line x1={lastX} y1={lastY} x2={lastX + 8} y2={labelY[i]} stroke={col} strokeWidth="1" opacity="0.5" />
              <text x={lastX + 11} y={labelY[i] - 1} fill={col} fontSize="11" fontFamily="'DM Mono',monospace" fontWeight="500">{r.rep}</text>
              <text x={lastX + 11} y={labelY[i] + 11} fill={col} fontSize="11" fontFamily="'Archivo',sans-serif" fontWeight="700">{r.total}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Segmented({ scope, setScope }) {
  const opt = (key, label) => (
    <div className="seg disp" onClick={() => setScope(key)}
      style={{ padding: "6px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 1, borderRadius: 4,
        background: scope === key ? C.panelHi : "transparent", color: scope === key ? C.text : C.dim,
        border: `1px solid ${scope === key ? C.line : "transparent"}` }}>{label}</div>
  );
  return <div style={{ display: "flex", gap: 4, background: C.panel, padding: 4, borderRadius: 6, border: `1px solid ${C.line}` }}>
    {opt("day", "TODAY")}{opt("week", "WEEK")}</div>;
}

function Tile({ label, value, sub, color, pct }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "16px 18px" }}>
      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 8 }}>{label}</div>
      <div className="disp" style={{ fontSize: 42, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {pct != null && (
        <div style={{ display: "flex", gap: 3, marginTop: 10 }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < Math.round(pct * 10) ? color : C.line }} />
          ))}
        </div>
      )}
      <div style={{ fontSize: 10, color: C.dimmer, marginTop: pct != null ? 8 : 10, letterSpacing: 1 }}>{sub}</div>
    </div>
  );
}

function Leaderboard({ title, rows, max, metric, fmt, color }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2 }}>{title}</div>
        <div style={{ fontSize: 9, color: C.dimmer, letterSpacing: 1 }}>{rows.length} reps · scroll</div>
      </div>
      <div
        className="lb-scroll"
        style={{ maxHeight: 290, overflowY: "auto", paddingRight: 6, position: "relative", maskImage: "linear-gradient(to bottom, black calc(100% - 18px), transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, black calc(100% - 18px), transparent 100%)" }}
      >
        {rows.map((r, i) => {
          const v = metric(r);
          return (
            <div key={r.rep} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
              <div className="disp" style={{ width: 16, fontSize: 11, color: i < 3 ? color : C.dimmer, fontWeight: 700 }}>{i + 1}</div>
              <div style={{ width: 88, fontSize: 11, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.rep}</div>
              <div style={{ flex: 1, height: 14, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
                <div className="bar" style={{ width: `${(v / max) * 100}%`, height: "100%", background: `linear-gradient(90deg, ${color}cc, ${color})`, borderRadius: 3 }} />
              </div>
              {i === 0 && <span style={{ fontSize: 12 }}>🔥</span>}
              <div className="disp" style={{ width: 56, textAlign: "right", fontSize: 12, color: C.text, fontWeight: 600 }}>{fmt(v)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Ticker({ rows }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px", overflow: "hidden" }}>
      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 12 }}>LIVE TICKER</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: r.connected ? C.lime : C.dimmer }} />
            <span style={{ fontSize: 11, color: r.connected ? C.text : C.dim }}>{r.rep}</span>
          </div>
          <span className="disp" style={{ fontSize: 11, color: C.dim }}>
            {r.duration_sec ? `${Math.floor(r.duration_sec / 60)}:${pad(r.duration_sec % 60)}` : "0:00"}
          </span>
        </div>
      ))}
    </div>
  );
}

function ConnectPanel({ rows }) {
  const sorted = [...rows].sort((a, b) => b.dials - a.dials).slice(0, 10);
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 12 }}>CONNECT RATE · BY REP <span style={{ color: C.dimmer }}>(dials shown)</span></div>
      {sorted.map((r) => (
        <div key={r.rep} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
          <div style={{ width: 96, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.rep}</div>
          <div style={{ width: 38, fontSize: 10, color: C.dim, textAlign: "right" }}>{r.dials}</div>
          <div style={{ flex: 1, height: 14, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
            <div className="bar" style={{ width: `${r.rate * 100}%`, height: "100%", background: `linear-gradient(90deg, ${C.amber}aa, ${C.amber})`, borderRadius: 3 }} />
          </div>
          <div className="disp" style={{ width: 42, textAlign: "right", fontSize: 12, fontWeight: 600 }}>{(r.rate * 100).toFixed(0)}%</div>
        </div>
      ))}
    </div>
  );
}

function TimeOfDayPanel({ byHour, peak, best }) {
  const max = Math.max(1, ...byHour.map((h) => h.dials));
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2 }}>DIALS BY HOUR · CONNECT-RATE TINT</div>
        <div style={{ fontSize: 10, color: C.dimmer }}>peak {peak ? pad(peak.hour) + ":00" : "—"} · best {best ? pad(best.hour) + ":00" : "—"}</div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 130 }}>
        {byHour.map((h) => {
          const rate = h.dials ? h.conn / h.dials : 0;
          const col = rate > 0.12 ? C.lime : rate > 0.06 ? C.amber : C.red;
          const px = Math.round((h.dials / max) * 120);
          return (
            <div key={h.hour} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 5 }}>
              <div className="bar" style={{ width: "100%", height: `${h.dials > 0 ? Math.max(px, 4) : 0}px`, background: col, opacity: 0.7 + rate * 0.3, borderRadius: "2px 2px 0 0" }} />
              <div style={{ fontSize: 8, color: C.dimmer }}>{pad(h.hour)}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 9, color: C.dimmer, marginTop: 8 }}>bar height = dial volume · color = connect rate (green high → red low)</div>
    </div>
  );
}

function WeekTrend({ trend }) {
  const maxD = Math.max(1, ...trend.map((d) => d.dials));
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 10, color: C.dim, letterSpacing: 2, marginBottom: 14 }}>7-DAY ROLLUP · DIALS & CONNECT RATE</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 18, height: 120, paddingLeft: 4 }}>
        {trend.map((d) => (
          <div key={d.k} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div className="disp" style={{ fontSize: 10, color: C.cyan }}>{(d.rate * 100).toFixed(0)}%</div>
            <div className="bar" style={{ width: "60%", height: `${(d.dials / maxD) * 80}px`, minHeight: 3, background: `linear-gradient(180deg, ${C.lime}, ${C.lime}55)`, borderRadius: "3px 3px 0 0" }} />
            <div style={{ fontSize: 10, color: C.dim }}>{d.dials}</div>
            <div style={{ fontSize: 9, color: C.dimmer }}>{new Date(d.k + "T12:00").toLocaleDateString("en-US", { weekday: "short" })}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
