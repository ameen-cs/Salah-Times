// Server-side CORS proxy for the masjid board data sources.
//
// The board endpoints (masjidboardlive.com, the premium HTML, the Chakaskraal
// site) send no Access-Control-Allow-Origin header, so the browser cannot fetch
// them directly. The app previously relied on third-party public CORS proxies
// (codetabs, allorigins) which silently broke — codetabs now rejects every
// request and allorigins returns 5xx — forcing the app onto stale database data
// and showing yesterday's (or Sunday's) prayer times as if current.
//
// This function runs on Netlify's servers (no browser CORS), fetches the target
// itself, and re-serves the body with permissive CORS headers. Same-origin and
// dependency-free, so it does not break when a public proxy goes down.

const ALLOWED_HOSTS = [
  "masjidboardlive.com",
  "premium.masjidboardlive.com",
  "chakaskraalmusjid.co.za",
  "www.chakaskraalmusjid.co.za",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const target = event.queryStringParameters && event.queryStringParameters.url;
  if (!target) return json(400, { error: "missing ?url parameter" });

  // Allowlist by host so this can't be abused as an open proxy.
  let host;
  try { host = new URL(target).hostname.toLowerCase(); }
  catch { return json(400, { error: "invalid url" }); }

  const allowed = ALLOWED_HOSTS.some(h => host === h || host.endsWith("." + h));
  if (!allowed) return json(403, { error: "host not allowed" });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (SalahTimes Netlify proxy)" },
    });
    const body = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: {
        ...CORS,
        "Content-Type": upstream.headers.get("content-type") || "text/plain; charset=utf-8",
        // Brief edge cache so rapid reloads don't hammer the board, while staying fresh.
        "Cache-Control": "public, max-age=60",
      },
      body,
    };
  } catch (e) {
    return json(502, { error: String((e && e.message) || e) });
  } finally {
    clearTimeout(timer);
  }
};

function json(statusCode, obj) {
  return { statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
