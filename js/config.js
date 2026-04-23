const SUPABASE_URL = "https://api.supabase.superbbulk.co.za";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE";
const ADMIN_PASSWORD = "78661";
const TABLE_NAME = "salah_times";

const PRAYER_LABELS = { fajr: "Fajr", zohr: "Zohr", asar: "Asr", maghrib: "Maghrib", esha: "Esha" };
const PRAYER_ICONS  = { fajr: "🌙", zohr: "☀️", asar: "🌤️", maghrib: "🌅", esha: "🌃" };

// adhan: Azān (call to prayer) times — null means not provided; enter via Admin panel
const MOSQUES = [
  {
    id: "jamia",
    name: "Jamia Masjid",
    shortName: "Jamia",
    boardId: "kwadukuza-jamia",
    livemasjidId: "stangermasjid",
    boardUrl: "https://masjidboardlive.com/boards?kwadukuza-jamia",
    liveUrl: "https://www.livemasjid.com/stangermasjid",
    defaults: {
      fajr: "5:50", zohr: "1:15", asar: "4:30", maghrib: null, esha: "7:15",
      juma_khutbah: "12:45",
      adhan: { fajr: null, zohr: null, asar: null, maghrib: null, esha: null },
      special_times: { zohr: { sunday: "12:45" } }
    }
  },
  {
    id: "nur",
    name: "Noor Masjid",
    shortName: "Nur",
    boardId: "kwadukuza-noor",
    livemasjidId: "noorstanger",
    boardUrl: "https://masjidboardlive.com/boards/?kwadukuza-noor",
    liveUrl: "https://www.livemasjid.com/noorstanger",
    defaults: {
      fajr: "5:50", zohr: "1:15", asar: "4:30", maghrib: null, esha: "7:15",
      juma_khutbah: "12:45",
      adhan: { fajr: null, zohr: null, asar: null, maghrib: null, esha: null },
      special_times: { zohr: { saturday: "1:30", sunday: "12:30" } }
    }
  },
  {
    id: "munawar",
    name: "Munawar Masjid",
    shortName: "Munawar",
    boardId: "kwadukuza-munawwar",
    livemasjidId: null,
    boardUrl: "https://masjidboardlive.com/boards/?kwadukuza-munawwar",
    liveUrl: null,
    defaults: {
      fajr: "5:30", zohr: "1:15", asar: "4:30", maghrib: null, esha: "7:10",
      juma_khutbah: "12:50",
      adhan: { fajr: null, zohr: null, asar: null, maghrib: null, esha: null },
      special_times: { zohr: { sunday: "12:30" } }
    }
  },
  {
    id: "darul-uloom",
    name: "Darul Uloom",
    shortName: "Darul Uloom",
    boardId: "kwadukuza-darul-uloom",
    livemasjidId: "jai",
    boardUrl: "https://masjidboardlive.com/boards/?kwadukuza-darul-uloom",
    liveUrl: "https://www.livemasjid.com/jai",
    defaults: {
      fajr: "5:30", zohr: "12:20", asar: "4:20", maghrib: null, esha: "7:20",
      juma_khutbah: "12:30",
      adhan: { fajr: null, zohr: null, asar: null, maghrib: null, esha: null },
      special_times: { esha: { "2026-04-20": "7:10" } }
    }
  },
  {
    id: "manor",
    name: "Manor Musallah",
    shortName: "Manor",
    boardId: "stanger-manor-musallah",
    livemasjidId: null,
    boardUrl: "https://masjidboardlive.com/boards/?stanger-manor-musallah",
    liveUrl: null,
    defaults: {
      fajr: "5:40", zohr: "12:30", asar: "4:30", maghrib: null, esha: "7:15",
      juma_khutbah: "12:40",
      adhan: { fajr: null, zohr: null, asar: null, maghrib: null, esha: null },
      special_times: {}
    }
  },
  {
    id: "blythedale",
    name: "Blythedale Beach Musallah",
    shortName: "Blythedale",
    boardId: "blythedale-beach-musallah",
    livemasjidId: null,
    boardUrl: "https://masjidboardlive.com/boards/?blythedale-beach-musallah",
    liveUrl: null,
    defaults: {
      fajr: "5:50", zohr: "12:45", asar: "4:30", maghrib: null, esha: "7:15",
      juma_khutbah: null,
      adhan: { fajr: null, zohr: null, asar: null, maghrib: null, esha: null },
      special_times: {}
    }
  },
  {
    id: "sunnypark",
    name: "Sunnypark Musallah",
    shortName: "Sunnypark",
    boardId: null,
    livemasjidId: null,
    boardUrl: null,
    liveUrl: null,
    defaults: {
      fajr: "5:50", zohr: "12:35", asar: "4:30", maghrib: null, esha: "7:15",
      juma_khutbah: null,
      adhan: { fajr: null, zohr: null, asar: null, maghrib: null, esha: null },
      special_times: {}
    }
  },
  {
    id: "glenhills",
    name: "Glenhills Musallah",
    shortName: "Glenhills",
    boardId: null,
    livemasjidId: null,
    boardUrl: null,
    liveUrl: null,
    defaults: {
      fajr: "5:45", zohr: "1:15", asar: "4:30", maghrib: null, esha: "7:15",
      juma_khutbah: "12:50",
      adhan: { fajr: null, zohr: null, asar: null, maghrib: null, esha: null },
      special_times: { zohr: { sunday: "12:45" } }
    }
  },
  {
    id: "ballito",
    name: "Ballito Musallah",
    shortName: "Ballito",
    boardId: null,
    livemasjidId: "ballito",
    boardUrl: null,
    liveUrl: "https://www.livemasjid.com/ballito",
    defaults: {
      fajr: "5:45", zohr: "1:15", asar: "4:45", maghrib: null, esha: "7:15",
      juma_khutbah: "12:30",
      adhan: { fajr: null, zohr: null, asar: null, maghrib: null, esha: null },
      special_times: { zohr: { sunday: "12:30" } }
    }
  }
];
