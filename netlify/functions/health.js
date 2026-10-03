// Health check for the live prayer-time pipeline, meant to be polled by an
// external uptime monitor (e.g. UptimeRobot) that emails the owner on failure.
//
//   200 + {"status":"ok"}   → every live source family is reachable and returning
//                             valid times. Nothing to do.
//   503 + {"status":"down"} → at least one family is unreachable / returning junk,
//                             so some masājid are serving stale database rows.
//                             This is the signal the monitor turns into an email.
//
// Because the monitor reaches this endpoint over HTTP, a total site or functions
// outage makes the endpoint itself unreachable — which the monitor also reports as
// "down". So a single monitor on this URL covers both "the site is down" and
// "live data isn't being pulled".
//
// This checks live-source REACHABILITY, not Supabase freshness. Since there is no
// scheduled refresh, Supabase naturally goes stale on zero-traffic days even when
// everything is healthy, so alerting on that would be a false alarm.
//
// The app draws on two independent source families, each serving a DIFFERENT set
// of masājid, so we probe both and fail if either dies. The previous version
// probed only board.php — which has since 404'd platform-wide — and so reported a
// total outage while most of the site was in fact live, while having no way to
// notice that the free-tier masājid had gone stale.

const isTime = s => /^\d{1,2}:\d{2}$/.test(String(s ?? "").trim());

// Premium theInfo HTML — serves Jamia, Noor, Darul Uloom, Ballito.
const premiumUrl = id => `https://premium.masjidboardlive.com/v2/index.php?mid=${id}`;
const premiumOk  = body => body.includes("let theInfo");

// Free-tier board page — serves Munawwar, Manor, Blythedale. Note it answers 200
// with a "This masjid does not exist" body for unknown ids, so check for a real
// Fajr Iqāmah rather than trusting the status code.
const freeUrl = id => `https://masjidboardlive.com/boards/?${id}`;
const freeOk  = body => {
  const m = /id=["']fajrJamaah["'][^>]*>([^<]*)</.exec(body);
  return !!m && isTime(m[1]);
};

// Two boards per family: if the platform is down they fail together, while a
// single failure is board-specific rather than an outage. So a family counts as
// healthy if ANY of its boards still responds.
const FAMILIES = [
  {
    family: "premium HTML",
    boards: [
      { id: "kwadukuza-jamia", name: "Stanger Jamia" },
      { id: "ballito-jamia",   name: "Ballito Jamia" },
    ],
    url: premiumUrl,
    valid: premiumOk,
  },
  {
    family: "free board page",
    boards: [
      { id: "stanger-manor-musallah",     name: "Manor Musallah" },
      { id: "blythedale-beach-musallah",  name: "Blythedale Beach" },
    ],
    url: freeUrl,
    valid: freeOk,
  },
];

async function probe(board, url, valid) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url(board.id), {
      signal: controller.signal,
      headers: { "User-Agent": "SalahTimes health check" },
    });
    if (!res.ok) return { ...board, ok: false, reason: `HTTP ${res.status}` };
    if (!valid(await res.text())) return { ...board, ok: false, reason: "no valid times in payload" };
    return { ...board, ok: true };
  } catch (e) {
    return { ...board, ok: false, reason: String((e && e.message) || e).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async () => {
  const checked = await Promise.all(FAMILIES.map(async f => {
    const results = await Promise.all(f.boards.map(b => probe(b, f.url, f.valid)));
    return { family: f.family, ok: results.some(r => r.ok), results };
  }));

  // Either family dying means some masājid have gone stale, so both must be up.
  const healthy = checked.every(f => f.ok);

  const body = {
    status: healthy ? "ok" : "down",
    checked_at: new Date().toISOString(),
    sources: checked.map(f => ({
      family: f.family,
      ok: f.ok,
      boards: f.results.map(r => ({
        name: r.name,
        ok: r.ok,
        ...(r.ok ? {} : { reason: r.reason }),
      })),
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
