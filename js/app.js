const PRAYER_ARABIC = {
  fajr:    "الفجر",
  zohr:    "الظهر",
  asar:    "العصر",
  maghrib: "المغرب",
  esha:    "العشاء",
};

class SalahTimesApp {
  constructor() {
    this.selectedMosqueId = localStorage.getItem("selectedMosque") || MOSQUES[0].id;
    this.currentTimes = null;
    this.today = new Date();
    this.todayStr = localDateStr(this.today);
    this.init();
  }

  init() {
    this.renderMosqueTabs();
    this.renderMosqueList();
    this.bindEvents();
    this.updateFooterDate();
    this.startClock();
    this.selectMosque(this.selectedMosqueId);
  }

  renderMosqueTabs() {
    const bar = document.getElementById("mosque-tabs-bar");
    bar.innerHTML = MOSQUES.map(m => `
      <button type="button" class="mosque-tab ${m.id === this.selectedMosqueId ? "active" : ""}"
        data-id="${m.id}" aria-pressed="${m.id === this.selectedMosqueId}">${m.shortName}</button>
    `).join("");
    bar.addEventListener("click", e => {
      const tab = e.target.closest(".mosque-tab");
      if (tab) this.selectMosque(tab.dataset.id);
    });
  }

  renderMosqueList() {
    const list = document.getElementById("mosque-list");
    list.innerHTML = MOSQUES.map(m => `
      <li><button type="button" class="mosque-item ${m.id === this.selectedMosqueId ? "active" : ""}"
        data-id="${m.id}" aria-pressed="${m.id === this.selectedMosqueId}">${m.shortName}</button></li>
    `).join("");
    list.addEventListener("click", e => {
      const item = e.target.closest(".mosque-item");
      if (item) this.selectMosque(item.dataset.id);
    });
  }

  bindEvents() {
    document.getElementById("refresh-btn").addEventListener("click", () => {
      api.clearCache(this.selectedMosqueId);
      this.selectMosque(this.selectedMosqueId);
    });
    // Keep the "next" highlight and countdown fresh while the page stays open
    setInterval(() => {
      const mosque = MOSQUES.find(m => m.id === this.selectedMosqueId);
      if (mosque && this.currentTimes) this.renderTimes(mosque, this.currentTimes);
    }, 30000);
  }

  async selectMosque(mosqueId) {
    this.selectedMosqueId = mosqueId;
    localStorage.setItem("selectedMosque", mosqueId);

    document.querySelectorAll(".mosque-tab").forEach(el => {
      const isActive = el.dataset.id === mosqueId;
      el.classList.toggle("active", isActive);
      el.setAttribute("aria-pressed", isActive);
      if (isActive) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    });
    document.querySelectorAll(".mosque-item").forEach(el => {
      const isActive = el.dataset.id === mosqueId;
      el.classList.toggle("active", isActive);
      el.setAttribute("aria-pressed", isActive);
    });

    const mosque = MOSQUES.find(m => m.id === mosqueId);
    if (!mosque) return;

    // Instant paint from the hardcoded defaults (zero network), then upgrade to
    // live/cached data the moment it resolves. Avoids a blank loading spinner.
    this.currentTimes = mosque.defaults;
    this.renderTimes(mosque, mosque.defaults);

    const times = await api.getTimes(mosque);
    // Guard against a race: if the user tapped another mosque while this was
    // fetching, don't clobber their current selection with stale data.
    if (this.selectedMosqueId !== mosqueId) return;
    this.currentTimes = times;
    this.renderTimes(mosque, times);
  }

  // ── Main render ───────────────────────────────────────────────────────────

  placeOf(mosque) {
    return { ballito: "Ballito", blythedale: "Blythedale Beach", glenhills: "Glen Hills", chakaskraal: "Chakas Kraal" }[mosque.id]
      || "KwaDukuza (Stanger)";
  }

  fmt(t) {
    return t && t !== "—" ? String(t).replace(/^(\d):/, "0$1:") : "—";
  }

  untilLabel(timeStr, tomorrow) {
    const t = this.parseTime(timeStr);
    if (tomorrow) t.setDate(t.getDate() + 1);
    const mins = Math.max(0, Math.round((t - new Date()) / 60000));
    const h = Math.floor(mins / 60), m = mins % 60;
    return h ? `${h}h ${m}m` : `${m} min`;
  }

  renderTimes(mosque, times) {
    const date       = new Date();
    const dateStr    = this.todayStr;
    const nextPrayer = this.getNextPrayer(times, dateStr);
    const hijriDate = this.formatHijri(times.hijri_date || this.getHijriDate(date));

    // ── Header ──────────────────────────────────────────────────────────────
    const PIN = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
    document.getElementById("mosque-header").innerHTML = `
      <h1 class="mosque-title">${mosque.name}</h1>
      <p class="dates">
        <span class="current-date">${date.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })}</span>
        ${hijriDate ? `<span class="sep" aria-hidden="true">·</span><span class="hijri-date">${hijriDate}</span>` : ""}
      </p>
      <p class="where">
        <span class="loc">${PIN}${this.placeOf(mosque)}</span>
        ${times.updated_at ? `<span class="sep" aria-hidden="true">·</span><span>Updated ${this.relativeTime(times.updated_at)}</span>` : ""}
      </p>`;

    // ── Timeline ─────────────────────────────────────────────────────────────
    const adhan   = times.adhan || {};
    const prayers = ["fajr", "zohr", "asar", "maghrib", "esha"];
    const isJuma  = date.getDay() === 5;
    const hasJuma = !!(times.juma_khutbah || times.juma_adhan);

    const rows = prayers.map(prayer => {
      const asJuma  = isJuma && prayer === "zohr" && hasJuma;
      const jamaat  = asJuma
        ? (times.juma_khutbah || times.juma_adhan)
        : api.getEffectiveTime(times, prayer, dateStr);
      const adhanTime = asJuma ? times.juma_adhan : (adhan[prayer] || null);
      const isNext  = nextPrayer === prayer;
      const hasTime = jamaat && jamaat !== "—";
      const past    = !isNext && hasTime && this.isPast(jamaat);
      const tomorrow = isNext && hasTime && this.isPast(jamaat);
      const chips   = this.getSpecialChips(times.special_times, prayer, dateStr);

      // Early Zohr — hidden for Jamia & Noor because their early time is already
      // shown as a day-specific chip
      const early = prayer === "zohr" && times.early_zohr && !["jamia", "nur"].includes(mosque.id)
        ? `<span class="tag">Early ${this.fmt(times.early_zohr)}</span>` : "";

      const tags = [
        isNext && hasTime ? `<span class="tag next">${tomorrow ? "Next · tomorrow" : "Next · in " + this.untilLabel(jamaat, false)}</span>` : "",
        asJuma ? '<span class="tag ok">Jumu\'ah today</span>' : "",
        early,
        ...chips.map(c => `<span class="tag${c.today ? " warn" : ""}">${c.label}</span>`),
      ].filter(Boolean).join("");

      const name = asJuma ? "Jumu'ah" : PRAYER_LABELS[prayer];
      const arabic = asJuma ? "الجمعة" : (PRAYER_ARABIC[prayer] || "");

      return `
        <li class="row${past ? " past" : ""}${isNext ? " is-next" : ""}">
          <div class="nm">${name}<span class="ar">${arabic}</span></div>
          <div class="j">${hasTime ? this.fmt(jamaat) : "—"}</div>
          <div class="sub">${adhanTime ? `Adhān ${this.fmt(adhanTime)}` : "Jamaat time"}</div>
          ${tags ? `<div class="st">${tags}</div>` : ""}
        </li>`;
    }).join("");

    document.getElementById("prayer-cards").innerHTML = rows;
    document.getElementById("next-cap").textContent = `Next: ${PRAYER_LABELS[nextPrayer] || ""}`;

    // ── Jumu'ah panel ────────────────────────────────────────────────────────
    document.getElementById("juma-wrap").innerHTML = this.renderJumaCard(times, isJuma);

    // ── Side panels + links ──────────────────────────────────────────────────
    document.getElementById("mosque-links").innerHTML =
      this.renderNextChange(times) +
      this.renderAnnouncements(times) +
      this.renderExtendedTimes(times) +
      this.renderLinks(mosque);
  }

  renderJumaCard(times, isJuma) {
    const hasJuma = times.juma_khutbah || times.juma_adhan;
    if (!hasJuma) return "";
    const tile = (label, val, cls = "") => `<div><dt>${label}</dt><dd${cls ? ` class="${cls}"` : ""}>${val}</dd></div>`;
    return `
      <div class="sec-h"><h2>Jumu'ah <span class="ar" style="font-family:var(--font-ar);font-size:1.15rem;color:var(--brand);font-weight:400">الجمعة</span></h2><span>${isJuma ? "Today" : "Fridays"}</span></div>
      <div class="panel">
        <dl class="kv cols4">
          ${times.juma_adhan   ? tile("Adhān", this.fmt(times.juma_adhan)) : ""}
          ${times.juma_sunan   ? tile("Sunan", this.fmt(times.juma_sunan)) : ""}
          ${times.juma_khutbah ? tile("Khutbah", this.fmt(times.juma_khutbah)) : ""}
          ${times.juma_speaker ? tile("Khateeb", this._escHtml(times.juma_speaker), "txt") : ""}
        </dl>
        ${!times.juma_speaker && times.juma_note ? `<p class="juma-note">${this._escHtml(times.juma_note)}</p>` : ""}
      </div>`;
  }

  // ── Info panels ───────────────────────────────────────────────────────────

  renderNextChange(times) {
    const nc = times.next_change;
    if (!nc) return "";

    // Same-day breakdown (Chakaskraal-style: {date, fajr, zohr, asar, maghrib, esha})
    const breakdownRows = [
      ["Fajr",    nc.fajr],
      ["Zohr",    nc.zohr],
      ["Asr",     nc.asar],
      ["Maghrib", nc.maghrib],
      ["Esha",    nc.esha],
    ].filter(([, v]) => v);

    // Multi-change list from live API: [{prayer, date, time}, ...]
    const list = Array.isArray(nc.changes) ? nc.changes.filter(c => c && c.time) : [];

    if (!breakdownRows.length && !list.length && !nc.time) return "";

    let body;
    if (breakdownRows.length) {
      body = `
        <dl class="kv">
          ${breakdownRows.map(([name, time]) => `<div><dt>${name}</dt><dd>${this._escHtml(String(time))}</dd></div>`).join("")}
        </dl>`;
    } else if (list.length) {
      body = `
        <ul class="change">
          ${list.map(c => {
            const label = PRAYER_LABELS[c.prayer] || c.prayer || "";
            const dateStr = c.date && c.date !== nc.date ? `<small>${this._escHtml(String(c.date))}</small>` : "";
            return `<li><span>${this._escHtml(label)}${dateStr}</span><b>${this._escHtml(String(c.time))}</b></li>`;
          }).join("")}
        </ul>`;
    } else {
      const prayerLabel = nc.prayer ? (PRAYER_LABELS[nc.prayer] || nc.prayer) : "";
      body = `<ul class="change"><li><span>${prayerLabel}</span><b>${this._escHtml(String(nc.time))}</b></li></ul>`;
    }

    const headerDate = nc.date ? this._escHtml(String(nc.date)) : "";
    return `
      <section class="panel">
        <h3>Next Salāh change</h3>
        <p class="cap">${headerDate ? `Applies from ${headerDate}` : "Upcoming change"}</p>
        ${body}
      </section>`;
  }

  renderAnnouncements(times) {
    const ann = times.announcements;
    if (!ann || !ann.length) return "";
    return `
      <section class="panel">
        <h3>Announcements</h3>
        <p class="cap">From the masjid</p>
        <ul class="ann">
          ${ann.map(a => `<li>${this._escHtml(a)}</li>`).join("")}
        </ul>
      </section>`;
  }

  renderExtendedTimes(times) {
    const et = times.extended_times;
    if (!et) return "";

    const LABELS = {
      suhur_end:  "Suhūr Ends",
      fajr_start: "Fajr Begins",
      sunrise:    "Sunrise",
      ishraq:     "Ishrāq",
      duha:       "Duhā",
      zawwal:     "Zawwāl",
      asr_shafi:  "Asr (Shāfi'ī)",
      asr_hanafi: "Asr (Hanafī)",
      sunset:     "Sunset",
    };

    const entries = Object.entries(LABELS)
      .filter(([key]) => et[key])
      .map(([key, label]) => `<div><dt>${label}</dt><dd>${this._escHtml(String(et[key]))}</dd></div>`);

    if (!entries.length) return "";

    return `
      <section class="panel">
        <details class="ext">
          <summary>Extended prayer times
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
          </summary>
          <dl class="kv">${entries.join("")}</dl>
        </details>
      </section>`;
  }

  renderLinks(mosque) {
    const ICON_BOARD = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;
    const ICON_LIVE  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M5.6 5.6a8 8 0 0 0 0 12.8M18.4 5.6a8 8 0 0 1 0 12.8M8.5 8.5a4 4 0 0 0 0 7M15.5 8.5a4 4 0 0 1 0 7"/></svg>`;
    const ICON_PIN   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>`;

    const links = [];
    if (mosque.boardUrl) links.push(
      `<a href="${mosque.boardUrl}" target="_blank" rel="noopener" class="btn pri">${ICON_BOARD}Live Board</a>`
    );
    if (mosque.liveUrl) links.push(
      `<a href="${mosque.liveUrl}" target="_blank" rel="noopener" class="btn">${ICON_LIVE}Live Stream</a>`
    );
    const mapsUrl = mosque.mapsUrl
      || (mosque.mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mosque.mapsQuery)}` : null);
    if (mapsUrl) links.push(
      `<a href="${mapsUrl}" target="_blank" rel="noopener" class="btn">${ICON_PIN}Directions</a>`
    );
    return links.length ? `<div class="links">${links.join("")}</div>` : "";
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  getSpecialChips(specialTimes, prayer, dateStr) {
    if (!specialTimes || !specialTimes[prayer]) return [];
    const sp       = specialTimes[prayer];
    const todayDay = new Date(dateStr).toLocaleDateString("en-ZA", { weekday: "long" }).toLowerCase();
    return Object.entries(sp).flatMap(([key, val]) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
        if (key < dateStr) return [];
        const label = new Date(key).toLocaleDateString("en-ZA", { month: "short", day: "numeric" });
        return [{ label: `${label}: ${val}`, today: key === dateStr }];
      }
      return [{ label: `${key.charAt(0).toUpperCase() + key.slice(1, 3)}: ${val}`, today: key.toLowerCase() === todayDay }];
    });
  }

  getNextPrayer(times, dateStr) {
    // Jamia's live data is the authoritative source for which prayer period we're in
    const ref = api.getReferencePrayer(dateStr);
    if (ref) return ref;
    // Fallback: determine from this mosque's own times
    const now = new Date();
    for (const prayer of ["fajr", "zohr", "asar", "maghrib", "esha"]) {
      const t = api.getEffectiveTime(times, prayer, dateStr);
      if (t && this.parseTime(t) > now) return prayer;
    }
    return "fajr";
  }

  isPast(timeStr) {
    return timeStr ? this.parseTime(timeStr) < new Date() : false;
  }

  parseTime(timeStr) {
    const [h, m] = timeStr.split(":").map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0); return d;
  }

  startClock() {
    const tick = () => {
      const el = document.getElementById("live-clock");
      if (el) el.textContent = new Date().toLocaleTimeString("en-ZA", {
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
    };
    tick();
    setInterval(tick, 1000);
  }

  updateFooterDate() {
    const el = document.getElementById("footer-date");
    if (el) el.textContent = `All times are Jamaat times · ${
      new Date().toLocaleDateString("en-ZA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    }`;
  }

  relativeTime(iso) {
    const diff = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (diff < 1)    return "just now";
    if (diff < 60)   return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return new Date(iso).toLocaleDateString("en-ZA");
  }

  sourceLabel(source) {
    return { api: "Live API", database: "Database", default: "Default" }[source] || source;
  }

  // ── Hijri date ────────────────────────────────────────────────────────────
  // Always shown as "2nd Jumada al-Akhira 1448 AH", whether it came from the live
  // board ("2 Jumada al-Thani 1448") or from the local calculation below.

  static HIJRI_MONTHS = [
    "Muharram", "Safar", "Rabi' al-Awwal", "Rabi' al-Akhir",
    "Jumada al-Ula", "Jumada al-Akhira", "Rajab", "Sha'ban",
    "Ramadan", "Shawwal", "Dhul Qa'dah", "Dhul Hijjah"
  ];

  ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // Accepts "2 Jumada al-Thani 1448" (board) or "2 Jumada al-Akhira 1448" (calculated)
  formatHijri(str) {
    if (!str) return "";
    const m = String(str).trim().match(/^([0-9]{1,2}) +(.+?) +([0-9]{4})(?: *AH)?$/i);
    if (!m) return String(str);
    let name = m[2];
    // Normalise the board's wording to the one used across the site
    name = name.replace(/Jumada al-Thani/i, "Jumada al-Akhira").replace(/Rabi' al-Thani/i, "Rabi' al-Akhir");
    return `${this.ordinal(parseInt(m[1], 10))} ${name} ${m[3]} AH`;
  }

  getHijriDate(date) {
    const names = SalahTimesApp.HIJRI_MONTHS;
    for (const cal of ["islamic-umalqura", "islamic"]) {
      try {
        const parts = new Intl.DateTimeFormat(`en-u-ca-${cal}-nu-latn`, { day: "numeric", month: "numeric", year: "numeric" }).formatToParts(date);
        const get = t => parseInt(parts.find(p => p.type === t)?.value, 10);
        const d = get("day"), mo = get("month"), y = get("year");
        if (d && mo >= 1 && mo <= 12 && y >= 1300 && y < 1500) return `${d} ${names[mo - 1]} ${y}`;
      } catch {}
    }
    return this._hijriFromJD(date);
  }

  _hijriFromJD(date) {
    const jd = Math.floor((date.getTime() / 86400000) + 2440587.5);
    const l = jd - 1948440 + 10632;
    const n = Math.floor((l - 1) / 10631);
    const l2 = l - 10631 * n + 354;
    const j = Math.floor((10985 - l2) / 5316) * Math.floor((50 * l2) / 17719)
            + Math.floor(l2 / 5670) * Math.floor((43 * l2) / 15238);
    const l3 = l2 - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50)
             - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
    const month = Math.floor((24 * l3) / 709);
    const day = l3 - Math.floor((709 * month) / 24);
    const year = 30 * n + j - 30;
    return `${day} ${SalahTimesApp.HIJRI_MONTHS[month - 1]} ${year}`;
  }

  _escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
}

document.addEventListener("DOMContentLoaded", () => new SalahTimesApp());
