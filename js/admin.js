class AdminPanel {
  constructor() {
    this.authenticated = sessionStorage.getItem("adminAuth") === "true";
    this.editingMosqueId = null;
    this.dbRows = {};   // {[mosque_id]: row} — what's actually stored in Supabase
    this.init();
  }

  init() {
    if (this.authenticated) this.showDashboard();
    else this.showLogin();
    this.bindEvents();
  }

  showLogin() {
    document.getElementById("login-section").style.display = "flex";
    document.getElementById("dashboard-section").style.display = "none";
  }

  async showDashboard() {
    document.getElementById("login-section").style.display = "none";
    document.getElementById("dashboard-section").style.display = "block";
    this.renderMosqueTable();
    await this.loadDbRows();   // pull the live rows, then re-render with real values
    this.renderMosqueTable();
    this.checkDbTable();
  }

  // The table and the edit modal used to read `mosque.defaults` — the hardcoded
  // config — so saved times were invisible here and it looked like nothing saved.
  // Load the actual rows once and render from those instead.
  async loadDbRows() {
    const rows = await db.query(TABLE_NAME, {});
    if (!rows) return;
    this.dbRows = {};
    for (const r of rows) this.dbRows[r.mosque_id] = r;
  }

  // Effective view of a masjid: DB row where a value exists, config default otherwise.
  effective(mosque) {
    const d = mosque.defaults || {};
    const r = this.dbRows[mosque.id];
    if (!r) return { ...d, adhan: d.adhan || {}, special_times: d.special_times || {}, _fromDb: false };
    const pick = (key) => (r[key] != null && r[key] !== "") ? r[key] : (d[key] ?? null);
    return {
      fajr: pick("fajr"), zohr: pick("zohr"), asar: pick("asar"),
      maghrib: pick("maghrib"), esha: pick("esha"),
      juma_khutbah: pick("juma_khutbah"),
      juma_speaker: r.juma_speaker || null,
      adhan: r.adhan || d.adhan || {},
      special_times: r.special_times || d.special_times || {},
      _fromDb: true
    };
  }

  async checkDbTable() {
    const ok = await db.ensureTable();
    const banner = document.getElementById("db-setup-banner");
    if (!ok && banner) {
      banner.style.display = "block";
      const sqlEl = document.getElementById("setup-sql-display");
      if (sqlEl) {
        try {
          const res = await fetch("setup.sql");
          sqlEl.textContent = await res.text();
        } catch { sqlEl.textContent = "See setup.sql in the project folder."; }
      }
    }
  }

  bindEvents() {
    document.getElementById("login-form").addEventListener("submit", e => {
      e.preventDefault();
      const pw = document.getElementById("password").value;
      if (pw === ADMIN_PASSWORD) {
        sessionStorage.setItem("adminAuth", "true");
        this.authenticated = true;
        this.showDashboard();
        this.showAlert("login-alert", "Login successful!", "success");
      } else {
        this.showAlert("login-alert", "Incorrect password. Please try again.", "error");
      }
    });

    document.getElementById("logout-btn").addEventListener("click", () => {
      sessionStorage.removeItem("adminAuth");
      window.location.reload();
    });

    document.getElementById("parse-btn").addEventListener("click", () => this.parseTextInput());
    document.getElementById("save-parsed-btn").addEventListener("click", () => this.saveParsedTimes());

    document.getElementById("edit-form").addEventListener("submit", e => {
      e.preventDefault();
      this.saveEditForm();
    });

    document.getElementById("cancel-edit-btn").addEventListener("click", () => {
      document.getElementById("edit-modal").style.display = "none";
    });

    document.getElementById("edit-modal").addEventListener("click", e => {
      if (e.target === document.getElementById("edit-modal")) {
        document.getElementById("edit-modal").style.display = "none";
      }
    });
  }

  renderMosqueTable() {
    const tbody = document.getElementById("mosque-tbody");
    tbody.innerHTML = MOSQUES.map(m => {
      const e = this.effective(m);
      const badge = e._fromDb
        ? ""
        : ` <span title="No database row yet — showing config defaults" style="font-size:0.7rem;opacity:0.6">(default)</span>`;
      return `
      <tr>
        <td><strong>${m.name}</strong>${badge}</td>
        <td>${e.fajr || "—"}</td>
        <td>${e.zohr || "—"}</td>
        <td>${e.asar || "—"}</td>
        <td>${e.esha || "—"}</td>
        <td>${e.juma_khutbah || "—"}</td>
        <td>
          <button class="btn-sm btn-edit" onclick="admin.openEditModal('${m.id}')">Edit</button>
          <button class="btn-sm btn-save" onclick="admin.saveToDb('${m.id}')">Save to DB</button>
        </td>
      </tr>`;
    }).join("");
  }

  // Reads the stored row (falling back to config defaults) so the form shows what
  // is actually live, not what config.js happens to contain.
  async openEditModal(mosqueId) {
    const mosque = MOSQUES.find(m => m.id === mosqueId);
    if (!mosque) return;
    this.editingMosqueId = mosqueId;

    const fresh = await db.query(TABLE_NAME, { mosque_id: mosqueId });
    if (fresh && fresh[0]) this.dbRows[mosqueId] = fresh[0];

    const d = this.effective(mosque);
    const adhan = d.adhan || {};
    document.getElementById("edit-mosque-name").textContent = mosque.name;
    document.getElementById("edit-fajr").value = d.fajr || "";
    document.getElementById("edit-zohr").value = d.zohr || "";
    document.getElementById("edit-asar").value = d.asar || "";
    document.getElementById("edit-maghrib").value = d.maghrib || "";
    document.getElementById("edit-esha").value = d.esha || "";
    document.getElementById("edit-juma").value = d.juma_khutbah || "";
    document.getElementById("edit-speaker").value = d.juma_speaker || "";
    document.getElementById("edit-adhan-fajr").value = adhan.fajr || "";
    document.getElementById("edit-adhan-zohr").value = adhan.zohr || "";
    document.getElementById("edit-adhan-asar").value = adhan.asar || "";
    document.getElementById("edit-adhan-maghrib").value = adhan.maghrib || "";
    document.getElementById("edit-adhan-esha").value = adhan.esha || "";
    document.getElementById("edit-special").value = JSON.stringify(d.special_times || {}, null, 2);
    document.getElementById("edit-modal").style.display = "flex";
  }

  async saveEditForm() {
    const mosque = MOSQUES.find(m => m.id === this.editingMosqueId);
    if (!mosque) return;

    let special_times = {};
    try {
      special_times = JSON.parse(document.getElementById("edit-special").value || "{}");
    } catch {
      this.showAlert("edit-alert", "Invalid JSON in special times field.", "error");
      return;
    }

    const adhan = {
      fajr:    document.getElementById("edit-adhan-fajr").value    || null,
      zohr:    document.getElementById("edit-adhan-zohr").value    || null,
      asar:    document.getElementById("edit-adhan-asar").value    || null,
      maghrib: document.getElementById("edit-adhan-maghrib").value || null,
      esha:    document.getElementById("edit-adhan-esha").value    || null,
    };

    const data = {
      mosque_id: mosque.id,
      mosque_name: mosque.name,
      fajr: document.getElementById("edit-fajr").value || null,
      zohr: document.getElementById("edit-zohr").value || null,
      asar: document.getElementById("edit-asar").value || null,
      maghrib: document.getElementById("edit-maghrib").value || null,
      esha: document.getElementById("edit-esha").value || null,
      juma_khutbah: document.getElementById("edit-juma").value || null,
      juma_speaker: document.getElementById("edit-speaker").value.trim() || null,
      adhan,
      special_times,
      updated_at: new Date().toISOString(),
      // Mark as admin-set so the live api-sync won't overwrite the Khateeb
      updated_by: "admin"
    };

    const result = await db.upsert(TABLE_NAME, data);
    if (result) {
      api.clearCache(mosque.id);
      // Track the saved row rather than mutating config.js in memory, so the table
      // reflects the database and a page reload shows the same thing.
      this.dbRows[mosque.id] = { ...data };
      this.showAlert("edit-alert", "Saved successfully to database!", "success");
      setTimeout(() => document.getElementById("edit-modal").style.display = "none", 1200);
      this.renderMosqueTable();
    } else {
      this.showAlert("edit-alert", "Failed to save to database. Check connection.", "error");
    }
  }

  // Writes the row shown in the table. That's the stored row where one exists and
  // the config default otherwise — so this seeds new masājid without stomping an
  // existing admin edit with stale config values.
  _rowPayload(mosque) {
    const d = this.effective(mosque);
    const existing = this.dbRows[mosque.id];
    return {
      mosque_id: mosque.id,
      mosque_name: mosque.name,
      fajr: d.fajr, zohr: d.zohr, asar: d.asar,
      maghrib: d.maghrib, esha: d.esha,
      juma_khutbah: d.juma_khutbah,
      adhan: d.adhan || {},
      special_times: d.special_times || {},
      updated_at: new Date().toISOString(),
      // Preserve the admin marker — dropping it would silently disable the row's
      // override for mirror masājid (see api.js `_applyDbOverrides`).
      ...(existing?.updated_by ? { updated_by: existing.updated_by } : {})
    };
  }

  async saveToDb(mosqueId) {
    const mosque = MOSQUES.find(m => m.id === mosqueId);
    if (!mosque) return;
    const payload = this._rowPayload(mosque);
    const result = await db.upsert(TABLE_NAME, payload);
    if (result) {
      this.dbRows[mosque.id] = { ...this.dbRows[mosque.id], ...payload };
      this.showAlert("table-alert", `${mosque.name} saved to database.`, "success");
      api.clearCache(mosqueId);
      this.renderMosqueTable();
    } else {
      this.showAlert("table-alert", "Failed to save. Check database connection.", "error");
    }
  }

  async saveAllToDb() {
    let success = 0, fail = 0;
    for (const mosque of MOSQUES) {
      const payload = this._rowPayload(mosque);
      const result = await db.upsert(TABLE_NAME, payload);
      if (result) this.dbRows[mosque.id] = { ...this.dbRows[mosque.id], ...payload };
      result ? success++ : fail++;
    }
    this.renderMosqueTable();
    this.showAlert("table-alert",
      fail === 0 ? `All ${success} mosques saved to database!` : `Saved ${success}, failed ${fail}.`,
      fail === 0 ? "success" : "error"
    );
    api.clearCache();
  }

  parseTextInput() {
    const text = document.getElementById("paste-input").value.trim();
    if (!text) {
      this.showAlert("parse-alert", "Please paste prayer times text first.", "error");
      return;
    }

    const results = this.parseFormat(text);
    this.parsedResults = results;

    if (results.length === 0) {
      this.showAlert("parse-alert", "Could not parse any times. Check the format.", "error");
      return;
    }

    // Preview
    let html = '<div class="parse-preview"><h3>Parsed Results:</h3>';
    for (const r of results) {
      const mosque = MOSQUES.find(m =>
        m.name.toLowerCase().includes(r.name.toLowerCase()) ||
        m.shortName.toLowerCase().includes(r.name.toLowerCase()) ||
        r.name.toLowerCase().includes(m.shortName.toLowerCase())
      );
      html += `
        <div class="parse-item ${mosque ? "matched" : "unmatched"}">
          <strong>${r.name}</strong> ${mosque ? `→ <em>${mosque.name}</em>` : `⚠️ No match found`}
          <div class="parse-times">
            Fajr: ${r.fajr || "—"} | Zohr: ${r.zohr || "—"} | Asr: ${r.asar || "—"} | Esha: ${r.esha || "—"}
            ${r.juma_khutbah ? ` | Jumu'ah: ${r.juma_khutbah}` : ""}
          </div>
        </div>`;
    }
    html += '</div>';
    document.getElementById("parse-result").innerHTML = html;
    document.getElementById("save-parsed-btn").style.display = "inline-block";
    this.showAlert("parse-alert", `Parsed ${results.length} mosque(s).`, "success");
  }

  parseFormat(text) {
    const results = [];
    // Split by mosque sections (lines that look like a mosque name — short, no time pattern)
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    let current = null;

    const timePattern = /(\d{1,2}:\d{2})/;
    const prayerPatterns = {
      fajr: /fajr/i,
      zohr: /zohr|zuhr|dhuhr|zohar/i,
      asar: /asar|asr/i,
      maghrib: /maghrib/i,
      esha: /esha|isha/i,
      juma_khutbah: /juma|jummah|jumu|khutbah/i
    };

    for (const line of lines) {
      if (line.startsWith("-") || line.startsWith("http") || line.startsWith("//")) continue;

      const hasTime = timePattern.test(line);
      const hasPrayer = Object.values(prayerPatterns).some(p => p.test(line));

      if (!hasTime && !hasPrayer && line.length > 0 && line.length < 40 && !line.includes(":")) {
        if (current) results.push(current);
        current = { name: line, fajr: null, zohr: null, asar: null, maghrib: null, esha: null, juma_khutbah: null, special_times: {} };
        continue;
      }

      if (!current) continue;

      // Day-specific override (e.g. "- Sunday - 12:45")
      const dayMatch = line.match(/^-?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday|monday)/i);
      if (dayMatch && hasTime) {
        const day = dayMatch[1].toLowerCase();
        const time = line.match(timePattern)?.[1];
        // Apply to last prayer set
        const lastPrayer = current._lastPrayer;
        if (lastPrayer && time) {
          if (!current.special_times[lastPrayer]) current.special_times[lastPrayer] = {};
          current.special_times[lastPrayer][day] = time;
        }
        continue;
      }

      for (const [prayer, pattern] of Object.entries(prayerPatterns)) {
        if (pattern.test(line)) {
          const time = line.match(timePattern)?.[1];
          if (time) current[prayer] = time;
          current._lastPrayer = prayer;
          break;
        }
      }
    }

    if (current) results.push(current);
    return results.map(r => { delete r._lastPrayer; return r; });
  }

  async saveParsedTimes() {
    if (!this.parsedResults || this.parsedResults.length === 0) return;
    let saved = 0;
    for (const r of this.parsedResults) {
      const mosque = MOSQUES.find(m =>
        m.name.toLowerCase().includes(r.name.toLowerCase()) ||
        m.shortName.toLowerCase().includes(r.name.toLowerCase()) ||
        r.name.toLowerCase().includes(m.shortName.toLowerCase())
      );
      if (!mosque) continue;
      const payload = {
        mosque_id: mosque.id, mosque_name: mosque.name,
        fajr: r.fajr, zohr: r.zohr, asar: r.asar,
        maghrib: r.maghrib, esha: r.esha,
        juma_khutbah: r.juma_khutbah,
        special_times: r.special_times,
        updated_at: new Date().toISOString(),
        // Pasted times are a deliberate edit, so they outrank a mirrored source
        updated_by: "admin"
      };
      const result = await db.upsert(TABLE_NAME, payload);
      if (result) {
        this.dbRows[mosque.id] = { ...this.dbRows[mosque.id], ...payload };
        api.clearCache(mosque.id);
        saved++;
      }
    }
    this.showAlert("parse-alert", `Saved ${saved} mosque(s) to database.`, saved > 0 ? "success" : "error");
    this.renderMosqueTable();
  }

  showAlert(containerId, message, type) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
    setTimeout(() => { el.innerHTML = ""; }, 4000);
  }
}

let admin;
document.addEventListener("DOMContentLoaded", () => { admin = new AdminPanel(); });
