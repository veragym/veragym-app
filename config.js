// ============================================================
// VERA GYM APP - config.js
// Supabase 클라이언트 초기화 + 공통 유틸리티
// ============================================================

const SUPABASE_URL      = 'https://lrzffwawpoidimlrbfxe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyemZmd2F3cG9pZGltbHJiZnhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDc0MjAsImV4cCI6MjA4OTcyMzQyMH0._AIkOKdjtOHC-igxg9toc-rq10KM3HVkjrgr1LOw-OI';
const SUPER_ADMIN_EMAIL = 'veragym@naver.com';
const EDGE_BASE         = 'https://lrzffwawpoidimlrbfxe.supabase.co/functions/v1';

let db;
function init_db() {
  db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, storageKey: 'vg_session' }
  });
}

// ── 관리자 인증 (admin.html용) ──────────────────────────────
async function requireAdmin() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.replace('admin-login.html'); return null; }

  const isSuperAdmin = session.user.email === SUPER_ADMIN_EMAIL;
  if (isSuperAdmin) {
    return { name: 'VERA GYM', gym_location: '전체', is_admin: true, is_super: true };
  }

  const { data: trainer, error } = await db.from('trainers')
    .select('id, name, gym_location, is_admin, is_active')
    .eq('auth_id', session.user.id)
    .single();

  if (error || !trainer || !trainer.is_admin || !trainer.is_active) {
    await db.auth.signOut();
    location.replace('admin-login.html');
    return null;
  }
  return { ...trainer, is_super: false };
}

// ── 트레이너 인증 (trainer-dash.html 등) ────────────────────
async function requireTrainer() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.replace('trainer-login.html'); return null; }

  let saved = localStorage.getItem('vg_trainer');
  if (!saved) {
    const { data: trainer, error } = await db.from('trainers')
      .select('id, name, gym_location, is_active, is_admin')
      .eq('auth_id', session.user.id).single();
    if (error || !trainer || !trainer.is_active) {
      await db.auth.signOut();
      location.replace('trainer-login.html');
      return null;
    }
    saved = JSON.stringify({ id: trainer.id, name: trainer.name, gym_location: trainer.gym_location });
    localStorage.setItem('vg_trainer', saved);
  }
  return JSON.parse(saved);
}

// ── 토스트 메시지 ───────────────────────────────────────────
function showToast(msg, duration = 2400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, duration);
}

// ── 모달 열기/닫기 ─────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id, e) {
  if (e && e.target !== document.getElementById(id)) return;
  document.getElementById(id).classList.remove('open');
}

// ── PWA 뒤로가기 앱 종료 방지 ────────────────────────────────
function preventBackExit() {
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', () => {
    history.pushState(null, '', location.href);
  });
}
