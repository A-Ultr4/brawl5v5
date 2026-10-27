import { getStore } from "@netlify/blobs";

// Daily cheers with a Duolingo-style streak.
// Key: k/<round>/<day>/<cid>/<target>  (one cheer per browser per Japan day)
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

async function snapshot(store, round, cid) {
  const r = encodeURIComponent(round);
  const { blobs } = await store.list({ prefix: `k/${r}/` });
  const today = fmtDay(Date.now());
  const totals = {}, fanSets = {}, mine = {};
  let all = 0, todayAll = 0;
  for (const b of blobs) {
    const parts = b.key.split("/");
    if (parts.length !== 5) continue;
    const [, , day, who, enc] = parts;
    let target;
    try { target = decodeURIComponent(enc); } catch { continue; }
    if (!TARGET.test(target)) continue;
    totals[target] = (totals[target] || 0) + 1;
    (fanSets[target] ||= new Set()).add(who);
    all++;
    if (day === today) todayAll++;
    if (who === cid) mine[day] = target;
  }
  const fans = {};
  for (const k in fanSets) fans[k] = fanSets[k].size;

  // streak: consecutive days ending today (or yesterday if today not yet done)
  let streak = 0;
  let d = mine[today] ? today : shift(today, -1);
  while (mine[d]) { streak++; d = shift(d, -1); }
  // best streak this tournament
  let best = 0, run = 0, prev = null;
  for (const day of Object.keys(mine).sort()) {
    run = prev && shift(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  const week = [];
  for (let i = 6; i >= 0; i--) { const w = shift(today, -i); week.push({ day: w, on: !!mine[w] }); }
  return {
    day: today,
    nextAt: dayMs(shift(today, 1)) - 12 * 36e5, // next Japan midnight (ms)
    total: all,
    todayTotal: todayAll,
    totals,
    fans,
    me: { streak, best, today: mine[today] || null, days: Object.keys(mine).length, week },
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

  const r = encodeURIComponent(round);
  const today = fmtDay(Date.now());
  const done = await store.list({ prefix: `k/${r}/${today}/${cid}/` });
  if (done.blobs.length) return json({ ok: false, already: true, ...(await snapshot(store, round, cid)) });
  await store.set(`k/${r}/${today}/${cid}/${encodeURIComponent(target)}`, new Date().toISOString());
  return json({ ok: true, ...(await snapshot(store, round, cid)) });
};

export const config = { path: "/api/cheer" };
