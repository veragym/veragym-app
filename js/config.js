// ============================================================
// VERA GYM v2 — config.js
// Supabase 연결 + 상수
// ============================================================

const SUPABASE_URL      = 'https://lrzffwawpoidimlrbfxe.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_BpDPrt2x48OiZNKuGWlBig_-DtnqepE';
const EDGE_BASE         = `${SUPABASE_URL}/functions/v1`;

// APP_URL: 배포 환경에 맞춰 변경
const APP_URL = location.origin + location.pathname.replace(/\/[^/]*$/, '');

let db;

function initDb() {
  db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, storageKey: 'vg_session' }
  });
}
