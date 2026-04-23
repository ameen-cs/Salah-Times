class SupabaseClient {
  constructor(url, key) {
    this.url = url;
    this.key = key;
    this.headers = {
      "Content-Type": "application/json",
      "apikey": key,
      "Authorization": `Bearer ${key}`
    };
  }

  async query(table, filters = {}) {
    let url = `${this.url}/rest/v1/${table}?select=*`;
    for (const [k, v] of Object.entries(filters)) {
      url += `&${k}=eq.${encodeURIComponent(v)}`;
    }
    try {
      const res = await fetch(url, { headers: this.headers });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async upsert(table, data, conflictColumn = "mosque_id") {
    const url = `${this.url}/rest/v1/${table}?on_conflict=${conflictColumn}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { ...this.headers, "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const err = await res.text();
        console.error("Supabase upsert error:", err);
        return null;
      }
      return await res.json();
    } catch (e) {
      console.error("Supabase upsert exception:", e);
      return null;
    }
  }

  async delete(table, id) {
    const url = `${this.url}/rest/v1/${table}?id=eq.${id}`;
    try {
      const res = await fetch(url, { method: "DELETE", headers: this.headers });
      return res.ok;
    } catch {
      return false;
    }
  }

  async ensureTable() {
    // Attempt to query the table; if it fails, the table doesn't exist yet.
    const result = await this.query(TABLE_NAME, {});
    return result !== null;
  }
}

const db = new SupabaseClient(SUPABASE_URL, SUPABASE_KEY);
