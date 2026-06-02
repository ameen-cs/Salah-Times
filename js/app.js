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
      <button class="mosque-tab ${m.id === this.selectedMosqueId ? "active" : ""}"
        data-id="${m.id}" role="tab"
        aria-selected="${m.id === this.selectedMosqueId}">${m.shortName}</button>
    `).join("");
    bar.addEventListener("click", e => {
      const tab = e.target.closest(".mosque-tab");
      if (tab) this.selectMosque(tab.dataset.id);
    });
  }

  renderMosqueList() {
    const list = document.getElementById("mosque-list");
    list.innerHTML = MOSQUES.map(m => `
      <li class="mosque-item ${m.id === this.selectedMosqueId ? "active" : ""}" data-id="${m.id}">
        <span class="mosque-item-dot" aria-hidden="true"></span>
        <span class="mosque-item-name">${m.shortName}</span>
      </li>
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
  }

  async selectMosque(mosqueId) {
    this.selectedMosqueId = mosqueId;
    localStorage.setItem("selectedMosque", mosqueId);

    document.querySelectorAll(".mosque-tab").forEach(el => {
      const isActive = el.dataset.id === mosqueId;
      el.classList.toggle("active", isActive);
      el.setAttribute("aria-selected", isActive);
      if (isActive) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    });
    document.querySelectorAll(".mosque-item").forEach(el => {
      el.classList.toggle("active", el.dataset.id === mosqueId);
    });

    this.showLoading();
    const mosque = MOSQUES.find(m => m.id === mosqueId);
    if (!mosque) return;

    const times = await api.getTimes(mosque);
    this.currentTimes = times;
    this.renderTimes(mosque, times);
  }

  showLoading() {
    document.getElementById("mosque-header").innerHTML = "";
    document.getElementById("prayer-cards").innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading prayer times…</p>
      </div>`;
    document.getElementById("mosque-links").innerHTML = "";
  }

  // ── Main render ───────────────────────────────────────────────────────────

  renderTimes(mosque, times) {
    const date       = new Date();
    const dateStr    = this.todayStr;
    const dateDisplay = date.toLocaleDateString("en-ZA", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
    const nextPrayer = this.getNextPrayer(times, dateStr);
    const nextTime   = api.getEffectiveTime(times, nextPrayer, dateStr);

    const hijriDate = this.getHijriDate(date);

    // ── Header ──────────────────────────────────────────────────────────────
    document.getElementById("mosque-header").innerHTML = `
      <div class="mosque-title-row">
        <h1 class="mosque-title">${mosque.name}</h1>
      </div>
      ${hijriDate ? `<p class="hijri-date">${hijriDate}</p>` : ""}
      <p class="current-date">${dateDisplay}</p>
      ${times.updated_at ? `<p class="last-updated">Updated ${this.relativeTime(times.updated_at)}</p>` : ""}
    `;

    // ── Prayer cards ─────────────────────────────────────────────────────────
    const adhan   = times.adhan || {};
    const prayers = ["fajr", "zohr", "asar", "maghrib", "esha"];
    const isJuma  = date.getDay() === 5;

    const cards = prayers.map(prayer => {
      // On Friday, the Zohr slot becomes the Jumu'ah card — unless this mosque
      // has no Jumu'ah, in which case fall through to the normal Zohr card
      if (isJuma && prayer === "zohr") {
        const juma = this.renderJumaCard(times, { highlight: nextPrayer === "zohr", asZohrSlot: true });
        if (juma) return juma;
      }

      const jamaat = api.getEffectiveTime(times, prayer, dateStr);

      const adhanTime = adhan[prayer] || null;
      const isNext    = nextPrayer === prayer;
      const chips     = this.getSpecialChips(times.special_times, prayer, dateStr);

      // Early Zohr row — hidden for Jamia & Noor because their early time is already
      // shown as a day-specific chip at the top of the card
      const earlyRow = prayer === "zohr" && times.early_zohr
        && !["jamia", "nur"].includes(mosque.id) ? `
        <div class="time-row">
          <span class="time-label">Early</span>
          <span class="adhan-time">${times.early_zohr}</span>
        </div>` : "";

      return `
        <div class="prayer-card ${isNext ? "next-prayer" : ""}" data-arabic="${PRAYER_ARABIC[prayer] || ""}">
          <div class="card-header">
            <div class="card-meta">
              <div class="prayer-name">${PRAYER_LABELS[prayer]}<span class="prayer-name-arabic">${PRAYER_ARABIC[prayer] || ""}</span></div>
              ${chips.length ? `
                <div class="special-chips">${chips.map(c =>
                  `<span class="special-chip${c.today ? " chip-today" : ""}">${c.label}</span>`
                ).join("")}</div>` : ""}
            </div>
          </div>
          <div class="card-times">
            ${adhanTime ? `
              <div class="time-row">
                <span class="time-label">Adhān</span>
                <span class="adhan-time">${adhanTime}</span>
              </div>` : ""}
            ${earlyRow}
            <div class="time-row">
              <span class="time-label">Jamaat</span>
              <span class="jamaat-time">${jamaat || "—"}</span>
            </div>
          </div>
        </div>`;
    }).join("");

    // ── Jumu'ah card — shown below on non-Fridays; on Friday it replaces the Zohr slot above
    const hasJuma = times.juma_khutbah || times.juma_adhan;
    const jumaCard = (hasJuma && !isJuma) ? this.renderJumaCard(times, { highlight: false, asZohrSlot: false }) : "";

    document.getElementById("prayer-cards").innerHTML = cards + jumaCard;

    // ── Extra info sections + links ──────────────────────────────────────────
    document.getElementById("mosque-links").innerHTML =
      this.renderNextChange(times) +
      this.renderAnnouncements(times) +
      this.renderExtendedTimes(times) +
      this.renderLinks(mosque);
  }

  renderJumaCard(times, { highlight = false, asZohrSlot = false } = {}) {
    const hasJuma = times.juma_khutbah || times.juma_adhan;
    if (!hasJuma) return "";
    const classes = ["prayer-card", "juma-card"];
    if (!asZohrSlot) classes.push("juma-full");
    if (highlight)  classes.push("next-prayer");
    return `
      <div class="${classes.join(" ")}" data-arabic="الجمعة">
        <div class="card-header">
          <div class="card-meta">
            <div class="prayer-name">Jumu'ah<span class="prayer-name-arabic">الجمعة</span></div>
            ${asZohrSlot ? '<div class="special-chips"><span class="special-chip chip-today">Today</span></div>' : ""}
          </div>
        </div>
        <div class="card-times">
          ${times.juma_adhan ? `
            <div class="time-row">
              <span class="time-label">Adhān</span>
              <span class="adhan-time">${times.juma_adhan}</span>
            </div>` : ""}
          ${times.juma_sunan ? `
            <div class="time-row">
              <span class="time-label">Sunan</span>
              <span class="adhan-time">${times.juma_sunan}</span>
            </div>` : ""}
          ${times.juma_khutbah ? `
            <div class="time-row">
              <span class="time-label">Khutbah</span>
              <span class="jamaat-time">${times.juma_khutbah}</span>
            </div>` : ""}
          ${times.juma_speaker ? `
            <div class="time-row speaker-row">
              <span class="time-label">Khateeb</span>
              <span class="speaker-name">${times.juma_speaker}</span>
            </div>` : ""}
        </div>
      </div>`;
  }

  // ── Info sections ─────────────────────────────────────────────────────────

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
        <div class="change-times-grid">
          ${breakdownRows.map(([name, time]) => `
            <div class="change-time-item">
              <span class="change-time-label">${name}</span>
              <span class="change-time-value">${time}</span>
            </div>`).join("")}
        </div>`;
    } else if (list.length) {
      body = `
        <ul class="change-list">
          ${list.map(c => {
            const label = PRAYER_LABELS[c.prayer] || c.prayer || "";
            const dateStr = c.date && c.date !== nc.date ? `<span class="change-list-date">${this._escHtml(String(c.date))}</span>` : "";
            return `
              <li class="change-list-item">
                <span class="change-list-prayer">${this._escHtml(label)}</span>
                ${dateStr}
                <span class="change-list-time">${this._escHtml(String(c.time))}</span>
              </li>`;
          }).join("")}
        </ul>`;
    } else {
      const prayerLabel = nc.prayer ? (PRAYER_LABELS[nc.prayer] || nc.prayer) : "";
      body = `<div class="change-simple-time">${prayerLabel ? `<span class="change-simple-prayer">${prayerLabel}</span> ` : ""}${nc.time}</div>`;
    }

    const headerDate = nc.date ? this._escHtml(String(nc.date)) : "";
    return `
      <div class="info-section next-change-section">
        <div class="info-section-header">
          <span class="info-section-icon" aria-hidden="true"></span>
          <div class="info-section-title-wrap">
            <span class="info-section-title">Next Salāh Change</span>
            ${headerDate ? `<span class="info-section-date">${headerDate}</span>` : ""}
          </div>
        </div>
        ${body}
      </div>`;
  }

  renderAnnouncements(times) {
    const ann = times.announcements;
    if (!ann || !ann.length) return "";
    return `
      <div class="info-section announcements-section">
        <div class="info-section-header">
          <span class="info-section-icon" aria-hidden="true"></span>
          <div class="info-section-title-wrap">
            <span class="info-section-title">Announcements</span>
          </div>
        </div>
        <ul class="announcements-list">
          ${ann.map(a => `<li class="announcement-item">${this._escHtml(a)}</li>`).join("")}
        </ul>
      </div>`;
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
      .map(([key, label]) => `
        <div class="ext-time-item">
          <span class="ext-time-label">${label}</span>
          <span class="ext-time-value">${et[key]}</span>
        </div>`);

    if (!entries.length) return "";

    return `
      <div class="info-section extended-section">
        <details class="extended-details">
          <summary class="extended-summary">
            <span class="info-section-icon" aria-hidden="true"></span>
            <span class="info-section-title">Extended Prayer Times</span>
            <span class="extended-arrow">▸</span>
          </summary>
          <div class="ext-times-grid">
            ${entries.join("")}
          </div>
        </details>
      </div>`;
  }

  renderLinks(mosque) {
    const links = [];
    if (mosque.boardUrl) links.push(
      `<a href="${mosque.boardUrl}" target="_blank" rel="noopener" class="link-btn board-link">Live Board</a>`
    );
    if (mosque.liveUrl) links.push(
      `<a href="${mosque.liveUrl}" target="_blank" rel="noopener" class="link-btn live-link">Live Stream</a>`
    );
    return links.length ? `<div class="links-row">${links.join("")}</div>` : "";
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

  getHijriDate(date) {
    const isValidHijri = (str) => str && !str.includes("BC") && /\b1[34]\d{2}\b/.test(str);
    try {
      const formatted = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
        day: "numeric", month: "long", year: "numeric"
      }).format(date);
      const result = formatted.replace(/\s*AH\s*$/, "").trim();
      if (isValidHijri(result)) return result;
    } catch {}
    try {
      const formatted = new Intl.DateTimeFormat("en-US-u-ca-islamic", {
        day: "numeric", month: "long", year: "numeric"
      }).format(date);
      const result = formatted.replace(/\s*AH\s*$/, "").trim();
      if (isValidHijri(result)) return result;
    } catch {}
    return this._hijriFromJD(date);
  }

  _hijriFromJD(date) {
    const HIJRI_MONTHS = [
      "Muharram","Safar","Rabi' al-Awwal","Rabi' al-Thani",
      "Jumada al-Ula","Jumada al-Thani","Rajab","Sha'ban",
      "Ramadan","Shawwal","Dhu'l-Qi'dah","Dhu'l-Hijjah"
    ];
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
    return `${HIJRI_MONTHS[month - 1]} ${day}, ${year}`;
  }

  _escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
}

document.addEventListener("DOMContentLoaded", () => new SalahTimesApp());
