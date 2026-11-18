// Browser client for the site's database, via the /api/db Netlify Function.
//
// Same surface as the old Supabase client (query / upsert / ensureTable) so api.js and
// admin.js keep working unchanged. The browser never holds database credentials: reads
// are public, and writes need the admin password, which the server checks.
//
// Visitors have no admin password, so their upserts are skipped without a network call.
// The scheduled sync-times function keeps the stored times fresh instead.

class DbClient {
  constructor(endpoint) {
    this.endpoint = endpoint;
    // A page reload (F5 / Ctrl+F5 / pull-to-refresh) skips the CDN cache so the visitor
    // sees the latest stored data at once. The Refresh button sets this too.
    this.bypassCache = false;
    try {
      const nav = performance.getEntriesByType("navigation")[0];
      this.bypassCache = nav?.type === "reload";
    } catch { /* older browsers: normal cached reads */ }
  }

  // The password is kept only for this tab's session, after a successful login
  _password() {
    try { return sessionStorage.getItem("adminPw"); } catch { return null; }
  }

  // The `table` argument is kept for call-site compatibility; there is one table.
  async query(table, filters = {}) {
    // Visitors get CDN-cached reads; a logged-in admin bypasses the cache to see live data.
    const params = new URLSearchParams(filters);
    if (this._password() || this.bypassCache) params.set("nocache", "1");
    const qs = params.toString();
    try {
      const res = await fetch(qs ? `${this.endpoint}?${qs}` : this.endpoint);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async upsert(table, data) {
    const pw = this._password();
    if (!pw) return null; // not an admin: nothing to save
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": pw },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        console.error("Database save failed:", res.status, await res.text());
        return null;
      }
      return await res.json();
    } catch (e) {
      console.error("Database save error:", e);
      return null;
    }
  }

  // Checks the password with the server. On success it is kept for later saves.
  async login(password) {
    try {
      const res = await fetch(`${this.endpoint}?action=login`, {
        method: "POST",
        headers: { "x-admin-password": password },
      });
      if (!res.ok) return false;
      try { sessionStorage.setItem("adminPw", password); } catch { /* private mode */ }
      return true;
    } catch {
      return false;
    }
  }

  logout() {
    try { sessionStorage.removeItem("adminPw"); } catch { /* ignore */ }
  }

  // A failed query means the table (or the database itself) isn't set up yet
  async ensureTable() {
    return (await this.query(TABLE_NAME, {})) !== null;
  }
}

const db = new DbClient("/api/db");
