// Health check for the live prayer-time pipeline, meant to be polled by an
// external uptime monitor (e.g. UptimeRobot) that emails the owner on failure.
//
//   200 + {"status":"ok"}   → the live board source is reachable and returning
//                             valid times. Nothing to do.
//   503 + {"status":"down"} → the board source is unreachable / returning junk.
//                             This is the signal the monitor turns into an email.
//
// Because the monitor reaches this endpoint over HTTP, a total site or functions
// outage makes the endpoint itself unreachable — which the monitor also reports as
// "down". So a single monitor on this URL covers both "the site is down" and
// "live data isn't being pulled".
//
// Note: this checks live-source REACHABILITY, not Supabase freshness. Since there
// is no scheduled refresh, Supabase naturally goes stale on zero-traffic days even
// when everything is healthy, so alerting on that would be a false alarm.

const BOARD_API = id => `https://masjidboardlive.com/boards/api/board.php?${id}`;

// Representative boards on the masjidboardlive platform. If the platform is down
// they fail together; a single failure is treated as board-specific, not an
// outage, so the pipeline is considered healthy if ANY of these still responds.
const PROBE_BOARDS = [
  { id: "kwadukuza-jamia", name: "Stanger Jamia" },
  { id: "ballito-jamia",   name: "Ballito Jamia" },
];

const isTime = s => /^\d{1,2}:\d{2}$/.test(String(s ?? "").trim());

async function probe(board) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(BOARD_API(board.id), {
      signal: controller.signal,
      headers: { "User-Agent": "SalahTimes health check" },
    });
    if (!res.ok) return { ...board, ok: false, reason: `HTTP ${res.status}` };
    const json = await res.json();
    const d = json && json.data ? json.data : json;
    // A valid live payload always carries a real Fajr jamaat time.
    if (!d || !isTime(d.fajrJamaah)) return { ...board, ok: false, reason: "no valid times in payload" };
    return { ...board, ok: true, zohr: d.dhuhrJamaah || null };
  } catch (e) {
    return { ...board, ok: false, reason: String((e && e.message) || e).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async () => {
  const results = await Promise.all(PROBE_BOARDS.map(probe));
  const healthy = results.some(r => r.ok);
  const body = {
    status: healthy ? "ok" : "down",
    checked_at: new Date().toISOString(),
    boards: results.map(r => ({
      name: r.name,
      ok: r.ok,
      ...(r.ok ? { zohr: r.zohr } : { reason: r.reason }),
    })),
  };
  return {
    statusCode: healthy ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body, null, 2),
  };
};
