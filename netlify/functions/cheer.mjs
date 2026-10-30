import { getStore } from "@netlify/blobs";

// Daily cheers with a Duolingo-style streak.
// Key: k/<hex(round)>/<day>/<cid>/<t_blue|p_TAG>  (one cheer per browser per Japan day)
//   round  = tournament key (changing it resets everything)
//   target = t:blue | t:red | p:<PLAYERTAG>
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const fmtDay = (ms) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const dayMs = (d) => Date.parse(d + "T12:00:00+09:00");
const shift = (d, n) => fmtDay(dayMs(d) + n * 864e5);

const TARGET = /^(t:(blue|red)|p:[A-Z0-9]{3,20})$/;
const CID = /^[a-z0-9]{12,40}$/;

// Keys are ASCII only: listing with a prefix that contains "%" never matches,
// so the round is stored as hex and the target as t_blue / p_TAG.
const hex = (str) => Buffer.from(str, "utf8").toString("hex");
const roundOf = (seg) => {
  if (/^[0-9a-f]+$/.test(seg) && seg.length % 2 === 0) { try { return Buffer.from(seg, "hex").toString("utf8"); } catch {} }
  try { return decodeURIComponent(seg); } catch { return null; }
};
const targetOf = (seg) => {
  let t = seg;
  try { t = decodeURIComponent(seg); } catch {}
  return t.replace(/^([tp])_/, "$1:");
};

async function snapshot(store, round, cid) {
  const { blobs } = await store.list({ prefix: "k/" });
  const today = fmtDay(Date.now());
  const totals = {}, fanSets = {}, mine = {};
  const perDay = {}, users = {}; // users[cid] = { days: {day: target}, tg: {target: n} }
  let all = 0, todayAll = 0;
  for (const b of blobs) {
    const parts = b.key.split("/");
    if (parts.length !== 5) continue;
    const [, rseg, day, who, tseg] = parts;
    if (roundOf(rseg) !== round) continue;
    const target = targetOf(tseg);
    if (!TARGET.test(target)) continue;
    totals[target] = (totals[target] || 0) + 1;
    (fanSets[target] ||= new Set()).add(who);
    all++;
    if (day === today) todayAll++;
    if (who === cid) mine[day] = target;
    perDay[day] = (perDay[day] || 0) + 1;
    const u = (users[who] ||= { days: {}, tg: {} });
    u.days[day] = target;
    u.tg[target] = (u.tg[target] || 0) + 1;
  }
  const fans = {};
  for (const k in fanSets) fans[k] = fanSets[k].size;

  // streak: consecutive days ending today (or yesterday if today not yet done)
  const streakOf = (days) => {
    let n = 0, d = days[today] ? today : shift(today, -1);
    while (days[d]) { n++; d = shift(d, -1); }
    let best = 0, run = 0, prev = null;
    for (const day of Object.keys(days).sort()) {
      run = prev && shift(prev, 1) === day ? run + 1 : 1;
      best = Math.max(best, run);
      prev = day;
    }
    return { streak: n, best };
  };
  const { streak, best } = streakOf(mine);
  const week = [];
  for (let i = 6; i >= 0; i--) { const w = shift(today, -i); week.push({ day: w, on: !!mine[w], n: perDay[w] || 0 }); }
  // everyone together: a day counts when anyone cheered
  const group = streakOf(perDay);
  const people = Object.entries(users).map(([who, u]) => {
    const s = streakOf(u.days);
    const fav = Object.entries(u.tg).sort((a, b) => b[1] - a[1])[0][0];
    return { me: who === cid, streak: s.streak, best: s.best, days: Object.keys(u.days).length, today: !!u.days[today], fav };
  }).sort((a, b) => b.streak - a.streak || b.best - a.best || b.days - a.days);
  const top = people.slice(0, 8);
  const meRow = people.findIndex((x) => x.me);
  if (meRow >= 8) top.push({ ...people[meRow], rank: meRow + 1 });
  return {
    day: today,
    nextAt: dayMs(shift(today, 1)) - 12 * 36e5, // next Japan midnight (ms)
    total: all,
    todayTotal: todayAll,
    totals,
    fans,
    me: { streak, best, today: mine[today] || null, days: Object.keys(mine).length, week },
    all: { streak: group.streak, best: group.best, days: Object.keys(perDay).length, people: people.length, today: todayAll, list: top },
  };
}

export default async (req) => {
  const store = getStore({ name: "cheers", consistency: "strong" });
  const url = new URL(req.url);
  if (req.method === "GET") {
    const round = String(url.searchParams.get("round") || "").trim().slice(0, 40);
    const cid = String(url.searchParams.get("cid") || "");
    if (!round) return json({ error: "bad_request" }, 400);
    return json(await snapshot(store, round, CID.test(cid) ? cid : "-"));
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const round = String((body && body.round) || "").trim().slice(0, 40);
  const cid = String((body && body.cid) || "");
  const target = String((body && body.target) || "");
  if (!round || !CID.test(cid) || !TARGET.test(target)) return json({ error: "bad_request" }, 400);

  const before = await snapshot(store, round, cid);
  if (before.me.today) return json({ ok: false, already: true, ...before });
  await store.set(`k/${hex(round)}/${before.day}/${cid}/${target.replace(":", "_")}`, new Date().toISOString());
  return json({ ok: true, ...(await snapshot(store, round, cid)) });
};

export const config = { path: "/api/cheer" };
