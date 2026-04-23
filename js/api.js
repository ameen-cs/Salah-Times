// Data sources (in priority order):
// 1. Live board  — board.php JSON API and premium theInfo HTML fetched IN PARALLEL
// 2. localStorage cache — 2-hour TTL, used for instant loads on repeat visits
// 3. Supabase DB  — auto-synced from live, used when live is unreachable
// 4. Hardcoded defaults — last resort

const LS_PREFIX    = "salah_v1_";
const LS_TTL       = 2 * 60 * 60 * 1000;  // 2 hours
const MEM_TTL      = 30 * 60 * 1000;       // 30 minutes (in-tab memory cache)
const TIMEOUT_API  = 5000;                  // board.php — short, it often fails
const TIMEOUT_HTML = 9000;                  // premium HTML — longer, usually works
const SHARED_MAG_KEY = "salah_shared_mag";
const SHARED_MAG_TTL = 12 * 60 * 60 * 1000; // 12 hours — Maghrib shifts ~1 min/day

class SalahTimesAPI {
  constructor() {
    this.mem = {};   // in-memory cache {[mosqueId]: {data, timestamp}}
    // Proactively load Jamia — populates shared Maghrib + reference prayer for all mosques
    this._probeJamia();
  }

  // ── Public entry point ───────────────────────────────────────────────────

  async getTimes(mosque) {
    const id = mosque.id;

    // 1. In-memory cache (fastest, 30-min TTL)
    const mem = this.mem[id];
    if (mem && Date.now() - mem.timestamp < MEM_TTL) {
      this._applySharedMaghrib(mem.data);
      return mem.data;
    }

    // 2. localStorage cache — return instantly, refresh in background
    const ls = this._lsRead(id);
    if (ls) {
      this._bgRefresh(mosque);   // fire-and-forget
      this._memSet(id, ls.data, ls.timestamp);
      this._applySharedMaghrib(ls.data);
      return ls.data;
    }

    // 3. Full fetch (first visit or cache expired)
    return this._fetchAndCache(mosque);
  }

  async _fetchAndCache(mosque) {
    const id = mosque.id;
    let data = null;

    if (mosque.boardId) {
      data = await this._fetchLive(mosque.boardId);
      if (data) {
        data.special_times = mosque.defaults.special_times || {};
        this._saveToSupabase(mosque, data);
      }
    }

    if (!data) data = await this._fetchFromSupabase(id);
    if (!data) data = this._getDefaults(mosque);

    if (!data.special_times || !Object.keys(data.special_times).length) {
      data.special_times = mosque.defaults.special_times || {};
    }

    // Save Maghrib to shared store so all mosques benefit, or fill from shared
    if (this._isValidTime(data.maghrib)) {
      this._saveMaghrib(data.maghrib, data.adhan?.maghrib);
    } else {
      data.maghrib = null; // strip invalid strings like "After Adhān"
      this._applySharedMaghrib(data);
    }

    this._memSet(id, data);
    this._lsWrite(id, data);
    return data;
  }

  // Background refresh: updates cache silently, doesn't block UI
  async _bgRefresh(mosque) {
    if (!mosque.boardId) return;
    const data = await this._fetchLive(mosque.boardId);
    if (!data) return;
    data.special_times = mosque.defaults.special_times || {};
    this._memSet(mosque.id, data);
    this._lsWrite(mosque.id, data);
    this._saveToSupabase(mosque, data);
  }

  clearCache(mosqueId) {
    if (mosqueId) {
      delete this.mem[mosqueId];
      this._lsDel(mosqueId);
    } else {
      this.mem = {};
      Object.keys(localStorage)
        .filter(k => k.startsWith(LS_PREFIX))
        .forEach(k => localStorage.removeItem(k));
    }
  }

  // Normalises ambiguous 12-h PM times stored in defaults e.g. "1:15" → "13:15".
  // Fajr is always AM; all other prayers with h < 7 are treated as PM.
  normalizeTime(timeStr, prayer) {
    if (!timeStr) return timeStr;
    const [h, m] = timeStr.split(":").map(Number);
    if (prayer !== "fajr" && h < 7) return `${h + 12}:${String(m).padStart(2, "0")}`;
    return timeStr;
  }

  // Returns the effective prayer time for a given day, respecting day/date overrides.
  // Output is always normalised to 24-h format.
  getEffectiveTime(times, prayer, dateStr) {
    const prayerSpecial = (times.special_times || {})[prayer];
    let raw;
    if (!prayerSpecial) {
      raw = times[prayer];
    } else if (prayerSpecial[dateStr]) {
      raw = prayerSpecial[dateStr];
    } else {
      const dayName = new Date(dateStr)
        .toLocaleDateString("en-ZA", { weekday: "long" }).toLowerCase();
      raw = prayerSpecial[dayName] ?? times[prayer];
    }
    return this.normalizeTime(raw, prayer);
  }

  // Returns which prayer is currently "next" based on Jamia's live data.
  // Used as the authoritative reference so all mosque cards highlight the same prayer.
  getReferencePrayer(dateStr) {
    const jamiaData = this.mem["jamia"]?.data;
    if (!jamiaData) return null;
    const now = new Date();
    for (const prayer of ["fajr", "zohr", "asar", "maghrib", "esha"]) {
      const t = this.getEffectiveTime(jamiaData, prayer, dateStr);
      if (t && this._parseTimeStr(t) > now) return prayer;
    }
    return "fajr";
  }

  _parseTimeStr(timeStr) {
    const [h, m] = timeStr.split(":").map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0); return d;
  }

  // ── Live fetch — board.php and premium HTML in PARALLEL ─────────────────

  async _fetchLive(boardId) {
    // Race both sources concurrently; return first non-null result
    const rejectNull = async (p) => {
      const r = await p;
      if (!r) throw new Error("no data");
      return r;
    };
    try {
      return await Promise.any([
        rejectNull(this._fetchBoardApi(boardId)),
        rejectNull(this._fetchPremiumHtml(boardId)),
      ]);
    } catch {
      return null;
    }
  }

  // ── board.php JSON API ───────────────────────────────────────────────────

  async _fetchBoardApi(boardId) {
    if (!boardId) return null;
    const proxied = `https://api.codetabs.com/v1/proxy?quest=https://masjidboardlive.com/boards/api/board.php%3F${boardId}`;
    try {
      const res = await fetch(proxied, { signal: AbortSignal.timeout(TIMEOUT_API) });
      if (!res.ok) { console.warn("[BAPI]", res.status); return null; }
      const json = await res.json();
      if (!json || typeof json !== "object") return null;
      const result = this._normalizeBoardApi(json);
      if (result) console.log("[BAPI] OK:", boardId);
      return result;
    } catch (e) {
      console.warn("[BAPI] fail:", e.message?.slice(0, 50));
      return null;
    }
  }

  _normalizeBoardApi(d) {
    const isTime = s => /^\d{1,2}:\d{2}$/.test(String(s ?? "").trim());
    const t      = s => { const v = String(s ?? "").trim(); return isTime(v) ? v : null; };

    const fajr    = t(d.fajrJamaah);
    const zohr    = t(d.dhuhrJamaah);
    const asar    = t(d.asrJamaah);
    const maghrib = t(d.maghribJamaah);
    const esha    = t(d.eshaJamaah);

    if (!fajr) return null;

    const adhan = {
      fajr:    t(d.fajrAthan),
      zohr:    t(d.dhuhrAthan),
      asar:    t(d.asrAthan),
      maghrib: t(d.maghribAthan),
      esha:    t(d.eshaAthan),
    };

    const juma_adhan   = t(d.jumuahTime1);
    const juma_khutbah = t(d.jumuahTime2);
    const rawSpeaker   = String(d.jumuah_khateeb ?? "").trim();
    const isNameLike   = s => s && s.length > 2 && !/^\d|^enter|^please|^tbc|^tba/i.test(s);
    const juma_speaker = isNameLike(rawSpeaker) ? rawSpeaker : null;

    const early_zohr = t(d.dhuhrJamaah2) || t(d.earlyDhuhr) || null;

    const ext = {
      suhur_end:  t(d.sehriEnds),
      fajr_start: t(d.fajrStarts),
      sunrise:    t(d.sunrise),
      ishraq:     t(d.ishraaq),
      duha:       t(d.duha),
      zawwal:     t(d.istiwa),
      asr_shafi:  t(d.asrShafi),
      asr_hanafi: t(d.asrHanafi),
      sunset:     t(d.sunset),
    };
    Object.keys(ext).forEach(k => { if (!ext[k]) delete ext[k]; });
    const extended_times = Object.keys(ext).length ? ext : null;

    const next_change = this._extractNextChangeBoardApi(d);
    const announcements = this._extractAnnouncementsBoardApi(d);

    return {
      fajr, zohr, asar, maghrib, esha,
      adhan,
      juma_adhan, juma_khutbah, juma_sunan: null, juma_speaker,
      early_zohr,
      next_change,
      extended_times,
      announcements: announcements.length ? announcements : null,
      source: "api"
    };
  }

  _extractNextChangeBoardApi(d) {
    const isTime = s => /^\d{1,2}:\d{2}$/.test(String(s ?? "").trim());
    const now    = Date.now() / 1000;
    const candidates = [];
    const add = (dateStr, unix, timeStr) => {
      if (!dateStr || !timeStr || !isTime(timeStr)) return;
      const ts = Number(unix) || 0;
      if (ts > now) candidates.push({ date: String(dateStr).trim(), time: timeStr, ts });
    };
    add(d.fajrNextDate,  d.fajrChangeUnix,  d.fajrNextTime);
    add(d.asrNextDate,   d.asrChangeUnix,   d.asrNextTime);
    add(d.eshaNextDate,  d.eshaChangeUnix,  d.eshaNextTime);
    add(d.dhuhrNextDate, d.dhuhrChangeUnix, d.dhuhrNextTime);
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.ts - b.ts);
    const { date, time } = candidates[0];
    return { date, time };
  }

  _extractAnnouncementsBoardApi(d) {
    const results = [];
    const raw = d?.meta?.announcement_info ?? d?.announcement_info ?? null;
    if (!raw) return results;
    const items = Array.isArray(raw) ? raw : [raw];
    for (const item of items) {
      if (!item) continue;
      const text = typeof item === "string" ? item : (item.content ?? item.text ?? item.message ?? "");
      const plain = String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (plain) results.push(plain);
    }
    return results;
  }

  // ── Premium theInfo HTML ─────────────────────────────────────────────────

  async _fetchPremiumHtml(boardId) {
    if (!boardId) return null;
    const urls = [
      `https://api.codetabs.com/v1/proxy?quest=https://premium.masjidboardlive.com/v2/index.php%3Fmid%3D${boardId}`,
      `https://api.codetabs.com/v1/proxy?quest=https://premium.masjidboardlive.com/v2/%3Fmid%3D${boardId}`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_HTML) });
        if (!res.ok) continue;
        const html = await res.text();
        if (!html.includes("let theInfo")) continue;
        const result = this._parseBoard(html);
        if (result) { console.log("[MBL] OK:", boardId); return result; }
      } catch { /* try next */ }
    }
    return null;
  }

  _parseBoard(html) {
    const marker = "let theInfo = ";
    const start  = html.indexOf(marker);
    if (start === -1) return null;
    const jsonStart = start + marker.length;
    const scriptEnd = html.indexOf("</script>", jsonStart);
    if (scriptEnd === -1) return null;
    let jsonStr = html.slice(jsonStart, scriptEnd).trim();
    if (jsonStr.endsWith(";")) jsonStr = jsonStr.slice(0, -1);
    try {
      const theInfo = JSON.parse(jsonStr);
      if (!Array.isArray(theInfo) || theInfo.length < 4) return null;
      return this._parseTheInfo(theInfo);
    } catch { return null; }
  }

  _parseTheInfo(ti) {
    const isTime  = s => /^\d{1,2}:\d{2}$/.test(String(s ?? "").trim());
    const clean   = s => isTime(s) ? String(s).trim() : null;
    const isDate  = s => /^\d{1,2}\s+[A-Za-z]{3,}/.test(String(s ?? ""));

    const changeRow = ti[0] || [];
    const jumaRow   = ti[1] || [];
    const timesRow  = ti[3] || [];

    let extRow = [];
    for (const row of ti) {
      if (Array.isArray(row) && row.length >= 25 &&
          isTime(row[14]) && isTime(row[16]) && isTime(row[22]) && isTime(row[24])) {
        extRow = row; break;
      }
    }

    let annRow = [];
    for (const row of ti) {
      if (Array.isArray(row) && row[0] === "Masjid Announcement") { annRow = row; break; }
    }

    const fajr_adhan   = clean(timesRow[0]);
    const fajr_jamaat  = clean(timesRow[1]);
    const zohr_adhan   = clean(timesRow[2]);
    const zohr_jamaat  = clean(timesRow[3]);
    const asr_adhan    = clean(timesRow[4]);
    const asr_jamaat   = clean(timesRow[5]);
    const magh_adhan   = clean(timesRow[6]);
    const magh_jamaat  = clean(timesRow[7]);
    const esha_adhan   = clean(timesRow[8]);
    const esha_jamaat  = clean(timesRow[9]);
    const alt_zohr     = (clean(timesRow[10]) !== zohr_jamaat) ? clean(timesRow[10]) : null;

    const juma_adhan   = clean(jumaRow[1]);
    const juma_sunan   = clean(jumaRow[3]);
    const juma_khutbah = clean(jumaRow[5]);
    const rawSpeaker   = String(jumaRow[6] ?? "").trim();
    const juma_speaker = (!isTime(rawSpeaker) && rawSpeaker) ? rawSpeaker : null;

    let next_change = null;
    for (let i = 0; i < changeRow.length; i++) {
      if (isDate(changeRow[i])) {
        const t = clean(changeRow[i + 1]) || clean(changeRow[i - 1]);
        if (t) { next_change = { date: String(changeRow[i]), time: t }; break; }
      }
    }

    let extended_times = null;
    if (extRow.length >= 25) {
      const et = {
        suhur_end:  clean(extRow[14]), fajr_start: clean(extRow[15]),
        sunrise:    clean(extRow[16]), ishraq:     clean(extRow[17]),
        duha:       clean(extRow[18]), zawwal:     clean(extRow[19]),
        asr_shafi:  clean(extRow[22]), asr_hanafi: clean(extRow[23]),
        sunset:     clean(extRow[24]),
      };
      Object.keys(et).forEach(k => { if (!et[k]) delete et[k]; });
      if (Object.keys(et).length) extended_times = et;
    }

    const announcements = [];
    for (let i = 0; i + 2 < annRow.length; i += 3) {
      const title   = String(annRow[i]     ?? "").trim();
      const content = String(annRow[i + 1] ?? "").trim();
      const visible = String(annRow[i + 2] ?? "").trim();
      if (visible === "Hide" || !content) continue;
      const plain = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (plain) announcements.push(title ? `${title}: ${plain}` : plain);
    }

    return {
      fajr: fajr_jamaat, zohr: zohr_jamaat, asar: asr_jamaat,
      maghrib: magh_jamaat, esha: esha_jamaat,
      adhan: { fajr: fajr_adhan, zohr: zohr_adhan, asar: asr_adhan, maghrib: magh_adhan, esha: esha_adhan },
      juma_adhan, juma_khutbah, juma_sunan, juma_speaker,
      early_zohr: alt_zohr,
      next_change, extended_times,
      announcements: announcements.length ? announcements : null,
      source: "api"
    };
  }

  _toMinutes(timeStr) {
    const [h, m] = String(timeStr).split(":").map(Number);
    return h * 60 + (m || 0);
  }

  // ── localStorage cache ───────────────────────────────────────────────────

  _lsRead(mosqueId) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + mosqueId);
      if (!raw) return null;
      const { data, timestamp } = JSON.parse(raw);
      if (Date.now() - timestamp > LS_TTL) { this._lsDel(mosqueId); return null; }
      return { data, timestamp };
    } catch { return null; }
  }

  _lsWrite(mosqueId, data) {
    try {
      localStorage.setItem(LS_PREFIX + mosqueId, JSON.stringify({ data, timestamp: Date.now() }));
    } catch { /* storage full / private mode */ }
  }

  _lsDel(mosqueId) {
    try { localStorage.removeItem(LS_PREFIX + mosqueId); } catch {}
  }

  _memSet(mosqueId, data, timestamp = Date.now()) {
    this.mem[mosqueId] = { data, timestamp };
  }

  // ── Supabase (fallback / auto-sync) ──────────────────────────────────────

  async _fetchFromSupabase(mosqueId) {
    const rows = await db.query(TABLE_NAME, { mosque_id: mosqueId });
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      fajr: r.fajr, zohr: r.zohr, asar: r.asar, maghrib: r.maghrib, esha: r.esha,
      adhan:          r.adhan          || {},
      juma_khutbah:   r.juma_khutbah   || null,
      juma_adhan:     r.juma_adhan     || null,
      juma_sunan:     r.juma_sunan     || null,
      juma_speaker:   r.juma_speaker   || null,
      early_zohr:     r.early_zohr     || null,
      next_change:    r.next_change    || null,
      extended_times: r.extended_times || null,
      announcements:  r.announcements  || null,
      special_times:  r.special_times  || {},
      source:         "database",
      updated_at:     r.updated_at
    };
  }

  async _saveToSupabase(mosque, data) {
    try {
      await db.upsert(TABLE_NAME, {
        mosque_id:      mosque.id,
        mosque_name:    mosque.name,
        fajr:           data.fajr,
        zohr:           data.zohr,
        asar:           data.asar,
        maghrib:        data.maghrib,
        esha:           data.esha,
        adhan:          data.adhan          || {},
        juma_khutbah:   data.juma_khutbah   || null,
        juma_adhan:     data.juma_adhan     || null,
        juma_sunan:     data.juma_sunan     || null,
        juma_speaker:   data.juma_speaker   || null,
        early_zohr:     data.early_zohr     || null,
        next_change:    data.next_change    || null,
        extended_times: data.extended_times || null,
        announcements:  data.announcements  || null,
        special_times:  mosque.defaults.special_times || {},
        updated_at:     new Date().toISOString(),
        updated_by:     "api-sync"
      }, "mosque_id");
    } catch { /* silent — DB is a fallback only */ }
  }

  // ── Shared Maghrib — same sunset time for the whole area ────────────────

  _saveMaghrib(time, adhanTime) {
    if (!time) return;
    try {
      localStorage.setItem(SHARED_MAG_KEY, JSON.stringify({
        time, adhan: adhanTime || null, timestamp: Date.now()
      }));
    } catch {}
  }

  _getSharedMaghrib() {
    try {
      const raw = localStorage.getItem(SHARED_MAG_KEY);
      if (!raw) return null;
      const { time, adhan, timestamp } = JSON.parse(raw);
      if (Date.now() - timestamp > SHARED_MAG_TTL) return null;
      return { time, adhan };
    } catch { return null; }
  }

  _isValidTime(t) {
    return t && /^\d{1,2}:\d{2}$/.test(String(t).trim());
  }

  _applySharedMaghrib(data) {
    // Only override if no valid HH:MM time — catches null AND non-time strings like "After Adhān"
    if (this._isValidTime(data.maghrib)) return;
    const shared = this._getSharedMaghrib();
    if (!shared) return;
    data.maghrib = shared.time;
    if (shared.adhan) {
      if (!data.adhan) data.adhan = {};
      data.adhan.maghrib = this._isValidTime(data.adhan?.maghrib)
        ? data.adhan.maghrib
        : shared.adhan;
    }
  }

  // Fetch and cache Jamia's full data — provides shared Maghrib + reference prayer for all mosques
  async _probeJamia() {
    const jamia = (typeof MOSQUES !== "undefined")
      ? MOSQUES.find(m => m.id === "jamia")
      : null;
    if (!jamia?.boardId) return;
    try {
      await this._fetchAndCache(jamia);
    } catch {}
  }

  _getDefaults(mosque) {
    return { ...mosque.defaults, source: "default" };
  }
}

const api = new SalahTimesAPI();
