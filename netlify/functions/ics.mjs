// "Add to calendar" for iPhone / iPad / Mac: the tournament date as an .ics event.
const DATA_URL = "https://raw.githubusercontent.com/A-Ultr4/brawl5v5/data/state.json";
const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export default async (req) => {
  let st;
  try { st = await fetch(DATA_URL + "?t=" + Math.floor(Date.now() / 6e4)).then((r) => r.json()); } catch { return new Response("unavailable", { status: 502 }); }
  const m = (st && st.meta) || {};
  const local = String(m.date || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return new Response("date not set", { status: 404 });
  const start = new Date(local + ":00+09:00");
  let end = new Date(start.getTime() + 2 * 36e5);
  for (const x of st.schedule || []) {
    const t = String(x.end || x.time || "").match(/^(\d{1,2}):(\d{2})$/);
    if (t) { const e = new Date(local.slice(0, 10) + "T" + t[1].padStart(2, "0") + ":" + t[2] + ":00+09:00"); if (e > end) end = e; }
  }
  const site = new URL(req.url).origin + "/";
  const body = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//brawl5v5//JA", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:" + local.replace(/\D/g, "") + "@brawl5v5",
    "DTSTAMP:" + stamp(new Date()),
    "DTSTART:" + stamp(start), "DTEND:" + stamp(end),
    "SUMMARY:" + esc(m.title || "ブロスタ5v5大会"),
    "LOCATION:" + esc(m.place || ""),
    "DESCRIPTION:" + esc("大会ページ：" + site),
    "URL:" + site,
    "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:" + esc((m.title || "大会") + " まであと30分"), "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'inline; filename="brawl5v5.ics"', "cache-control": "no-store" } });
};
export const config = { path: "/api/ics" };
