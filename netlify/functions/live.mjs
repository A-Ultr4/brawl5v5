import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

// Tournament-day features for the public page:
//   live results (ライブ速報) set by the organizer, みんなの勝敗予想, MVP投票.
// Keys are ASCII only (round as hex):
//   s/<round>               live state JSON {on, results:{n:"blue"|"red"}, cur, head, mvp, at}
//   p/<round>/<n>/<cid>     a prediction for match n ("blue" | "red")
//   m/<round>/<cid>         an MVP vote (player tag)
// The organizer's key is never stored here, only its SHA-256.
const ADMIN_HASH = "633d8e984f045c7aa4799788c45d32df8a45ce094d05434dc6a3ec4e7e138052";
const DATA_URL = "https://raw.githubusercontent.com/A-Ultr4/brawl5v5/data/state.json";
const CID = /^[a-z0-9]{12,40}$/;
const TAG = /^[A-Z0-9]{3,20}$/;
const MAXN = 40;

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const hex = (s) => Buffer.from(s, "utf8").toString("hex");
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");

// results already written into the published data (matches[].winner), cached briefly per instance
let dataCache = { at: 0, d: null };
async function published() {
  if (Date.now() - dataCache.at < 60000) return dataCache.d;
  try { const d = await fetch(DATA_URL + "?t=" + Math.floor(Date.now() / 6e4)).then((r) => r.json()); dataCache = { at: Date.now(), d }; } catch {}
  return dataCache.d;
}
const blank = () => ({ on: false, results: {}, cur: null, head: "", mvp: "off", at: null, auto: false, autoSince: null, autoAt: 0, seen: [], details: {}, autoLog: null });

// ---- automatic results from the official battle log (friendly battles with our players) ----
const tagOf = (t) => String(t || "").replace(/^#/, "").toUpperCase();
const btime = (t) => { const m = String(t || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/); return m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) : NaN; };
async function battlelog(tag) {
  const key = process.env.BS_API_KEY;
  if (!key) throw new Error("no api key");
  const r = await fetch("https://bsproxy.royaleapi.dev/v1/players/%23" + tag + "/battlelog", { headers: { authorization: "Bearer " + key, accept: "application/json" } });
  if (!r.ok) throw new Error("battlelog http " + r.status);
  const j = await r.json();
  return Array.isArray(j.items) ? j.items : [];
}
async function autoCheck(st, round) {
  const d = await published();
  if (!d || !d.teams) throw new Error("no data");
  const blue = new Set((d.teams.blue.members || []).map((m) => tagOf(m.tag)).filter(Boolean));
  const red = new Set((d.teams.red.members || []).map((m) => tagOf(m.tag)).filter(Boolean));
  const since = st.autoSince ? Date.parse(st.autoSince) : 0;
  const found = new Map(), recent = [];
  for (const who of [[...blue][0], [...red][0]].filter(Boolean)) {
    const items = await battlelog(who);
    for (const it of items.slice(0, 6)) recent.push([it.battle && it.battle.type, (it.event && it.event.mode) || (it.battle && it.battle.mode), it.battle && Array.isArray(it.battle.teams) ? it.battle.teams.map((t) => t.length).join("v") : "-"].join("/"));
    for (const it of items) {
      const b = it.battle || {}, t = btime(it.battleTime);
      if (!(t >= since) || !Array.isArray(b.teams) || b.teams.length !== 2) continue;
      const sides = b.teams.map((team) => team.map((p) => tagOf(p.tag)));
      const ours = sides.flat().filter((x) => blue.has(x) || red.has(x)).length;
      if (ours < 6) continue;
      const blueSide = sides[0].filter((x) => blue.has(x)).length >= sides[1].filter((x) => blue.has(x)).length ? 0 : 1;
      const mySide = sides[0].includes(who) ? 0 : 1;
      if (b.result !== "victory" && b.result !== "defeat") continue;
      const iWon = b.result === "victory";
      const winner = (mySide === blueSide) === iWon ? "blue" : "red";
      const star = b.starPlayer ? { tag: tagOf(b.starPlayer.tag), name: b.starPlayer.name, brawler: b.starPlayer.brawler && b.starPlayer.brawler.name } : null;
      found.set(it.battleTime, { time: t, winner, map: (it.event && it.event.map) || "", mode: (it.event && it.event.mode) || b.mode || "", star, type: b.type || "" });
    }
  }
  const res = await decided(st, round);
  let added = 0;
  for (const [bt, x] of [...found.entries()].sort((a, b) => a[1].time - b[1].time)) {
    if (st.seen.includes(bt)) continue;
    let n = 1; while (res[n] && n < MAXN) n++;
    st.results = { ...(st.results || {}), [n]: x.winner }; res[n] = x.winner;
    st.details = { ...(st.details || {}), [n]: { map: x.map, mode: x.mode, star: x.star, auto: true } };
    if (st.cur === n) st.cur = null;
    st.seen = [...st.seen, bt].slice(-60);
    added++;
  }
  return { at: new Date().toISOString(), ok: true, found: found.size, added, recent: recent.slice(0, 8) };
}

async function readState(store, r) {
  let s = null;
  try { s = await store.get(`s/${r}`, { type: "json" }); } catch {}
  return { ...blank(), ...(s || {}) };
}
async function decided(st, round) {
  const out = {};
  const d = await published();
  if (d && d.meta && (d.meta.rateRound || d.meta.title) === round) {
    (d.matches || []).forEach((m, i) => { if (m && (m.winner === "blue" || m.winner === "red")) out[i + 1] = m.winner; });
  }
  for (const [n, w] of Object.entries(st.results || {})) if (w === "blue" || w === "red") out[n] = w;
  return out;
}
const openMatch = (res, st) => {
  let n = 1;
  while (res[n] && n < MAXN) n++;
  return st.cur === n ? null : n;
};

async function snapshot(store, round, cid) {
  const r = hex(round);
  const st = await readState(store, r);
  if (st.on && st.auto && Date.now() - (st.autoAt || 0) > 60000) {
    st.autoAt = Date.now();
    await store.setJSON(`s/${r}`, st);
    try { st.autoLog = await autoCheck(st, round); } catch (e) { st.autoLog = { at: new Date().toISOString(), ok: false, error: String((e && e.message) || e).slice(0, 120) }; }
    if (st.autoLog.added) st.at = new Date().toISOString();
    await store.setJSON(`s/${r}`, st);
  }
  const res = await decided(st, round);
  const [pl, ml] = await Promise.all([store.list({ prefix: `p/${r}/` }), store.list({ prefix: `m/${r}/` })]);
  const votes = {}, mine = {}, people = {};
  await Promise.all(
    pl.blobs.map(async (b) => {
      const [, , n, who] = b.key.split("/");
      const v = await store.get(b.key);
      if (v !== "blue" && v !== "red") return;
      (votes[n] ||= { blue: 0, red: 0 })[v]++;
      if (who === cid) mine[n] = v;
      const p = (people[who] ||= { hit: 0, n: 0 });
      if (res[n]) { p.n++; if (res[n] === v) p.hit++; }
    })
  );
  const mvp = {};
  let myMvp = null;
  if (st.mvp !== "off") {
    await Promise.all(
      ml.blobs.map(async (b) => {
        const who = b.key.split("/")[2];
        const v = await store.get(b.key);
        if (!TAG.test(v || "")) return;
        mvp[v] = (mvp[v] || 0) + 1;
        if (who === cid) myMvp = v;
      })
    );
  }
  const board = Object.entries(people)
    .filter(([, p]) => p.n > 0)
    .map(([who, p]) => ({ me: who === cid, id: sha(who).slice(0, 6), hit: p.hit, n: p.n }))
    .sort((a, b) => b.hit - a.hit || a.n - b.n);
  const top = board.slice(0, 10);
  const mi = board.findIndex((x) => x.me);
  if (mi >= 10) top.push({ ...board[mi], rank: mi + 1 });
  return {
    on: !!st.on, cur: st.cur, head: st.head || "", mvp: st.mvp, at: st.at, auto: !!st.auto, autoLog: st.autoLog || null, details: st.details || {},
    results: res, open: openMatch(res, st), votes, mine, board: top, players: board.length,
    mvpVotes: mvp, myMvp,
  };
}

export default async (req) => {
  const store = getStore({ name: "live", consistency: "strong" });
  const url = new URL(req.url);
  if (req.method === "GET") {
    const round = String(url.searchParams.get("round") || "").trim().slice(0, 40);
    const cid = String(url.searchParams.get("cid") || "");
    if (!round) return json({ error: "bad_request" }, 400);
    return json(await snapshot(store, round, CID.test(cid) ? cid : "-"));
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const round = String((b && b.round) || "").trim().slice(0, 40);
  const cid = String((b && b.cid) || "");
  if (!round) return json({ error: "bad_request" }, 400);
  const r = hex(round);

  if (b.action === "admin") {
    if (sha(b.key || "") !== ADMIN_HASH) return json({ error: "key" }, 403);
    const st = await readState(store, r);
    if (typeof b.on === "boolean") st.on = b.on;
    if (typeof b.head === "string") st.head = b.head.slice(0, 80);
    if (b.mvp === "off" || b.mvp === "open" || b.mvp === "closed") st.mvp = b.mvp;
    if (typeof b.auto === "boolean") { st.auto = b.auto; if (b.auto) { st.autoSince = new Date(Date.now() - 10 * 60000).toISOString(); st.autoAt = 0; } }
    if (b.autoNow) st.autoAt = 0;
    if ("cur" in b) { const n = Number(b.cur); st.cur = n >= 1 && n <= MAXN ? n : null; }
    if (b.result && typeof b.result === "object") {
      const n = Number(b.result.n), w = b.result.winner;
      if (n >= 1 && n <= MAXN) {
        st.results = { ...(st.results || {}) };
        if (w === "blue" || w === "red") { st.results[n] = w; if (st.cur === n) st.cur = null; } else { delete st.results[n]; if (st.details) { st.details = { ...st.details }; delete st.details[n]; } }
      }
    }
    st.at = new Date().toISOString();
    await store.setJSON(`s/${r}`, st);
    return json({ ok: true, ...(await snapshot(store, round, CID.test(cid) ? cid : "-")) });
  }

  if (!CID.test(cid)) return json({ error: "bad_request" }, 400);
  if (b.action === "predict") {
    const n = Number(b.n), pick = b.pick;
    if (!(pick === "blue" || pick === "red") || !(n >= 1 && n <= MAXN)) return json({ error: "bad_request" }, 400);
    const st = await readState(store, r);
    const res = await decided(st, round);
    if (openMatch(res, st) !== n) return json({ ok: false, closed: true, ...(await snapshot(store, round, cid)) });
    await store.set(`p/${r}/${n}/${cid}`, pick);
    return json({ ok: true, ...(await snapshot(store, round, cid)) });
  }
  if (b.action === "mvp") {
    const tag = String(b.tag || "").toUpperCase();
    if (!TAG.test(tag)) return json({ error: "bad_request" }, 400);
    const st = await readState(store, r);
    if (st.mvp !== "open") return json({ ok: false, closed: true, ...(await snapshot(store, round, cid)) });
    await store.set(`m/${r}/${cid}`, tag);
    return json({ ok: true, ...(await snapshot(store, round, cid)) });
  }
  return json({ error: "bad_request" }, 400);
};

export const config = { path: "/api/live" };
