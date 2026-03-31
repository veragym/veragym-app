// ============================================================
// VERA GYM APP - config.js [운영 환경]
// ✅ 운영 DB 연결
// ============================================================

const SUPABASE_URL      = 'https://lrzffwawpoidimlrbfxe.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_BpDPrt2x48OiZNKuGWlBig_-DtnqepE';
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

  // 캐시가 있고, auth_id + TTL 이내면 그대로 사용
  const _TRAINER_CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간
  const raw = localStorage.getItem('vg_trainer');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const isRecent = Date.now() - (parsed._ts || 0) < _TRAINER_CACHE_TTL;
      if (parsed.auth_id === session.user.id && isRecent) return parsed;
    } catch (_) {}
    // 불일치 또는 만료 → 캐시 무효화
    localStorage.removeItem('vg_trainer');
  }

  // DB에서 재조회
  const { data: trainer, error } = await db.from('trainers')
    .select('id, name, gym_location, is_active, is_admin')
    .eq('auth_id', session.user.id).single();
  if (error || !trainer || !trainer.is_active) {
    await db.auth.signOut();
    location.replace('trainer-login.html');
    return null;
  }
  // auth_id + 타임스탬프 포함해서 저장 (세션 검증 + TTL 만료 판단에 사용)
  const trainerData = {
    id: trainer.id,
    name: trainer.name,
    gym_location: trainer.gym_location,
    is_admin: trainer.is_admin || false,
    auth_id: session.user.id,
    _ts: Date.now()
  };
  localStorage.setItem('vg_trainer', JSON.stringify(trainerData));
  return trainerData;
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
function openModal(id) {
  const bg = document.getElementById(id);
  if (!bg) return;
  const modal = bg.querySelector('.modal');
  if (modal && !modal.querySelector('.modal-close-x')) {
    modal.style.position = 'relative';
    const btn = document.createElement('button');
    btn.className = 'modal-close-x';
    btn.textContent = '✕';
    btn.setAttribute('aria-label', '닫기');
    btn.onclick = (e) => { e.stopPropagation(); closeModal(id); };
    modal.appendChild(btn);
  }
  bg.classList.add('open');
}
function closeModal(id, e) {
  if (e && e.target !== document.getElementById(id)) return;
  document.getElementById(id).classList.remove('open');
}

// ── PWA 뒤로가기 앱 종료 방지 ────────────────────────────────
function preventBackExit() {
  history.pushState(null, '', location.href);
  const handler = () => history.pushState(null, '', location.href);
  window.addEventListener('popstate', handler);
  window.addEventListener('beforeunload', () => {
    window.removeEventListener('popstate', handler);
  }, { once: true });
}
