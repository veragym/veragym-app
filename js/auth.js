// ============================================================
// VERA GYM v2 — auth.js
// 인증 + 권한 검증
// ============================================================

// 슈퍼 관리자 판별은 서버(RLS/RPC)에서 수행.
// 클라이언트에서는 세션 유무 + trainers 테이블 조회만.

const _TRAINER_CACHE_KEY = 'vg_trainer';
const _TRAINER_CACHE_TTL = 30 * 60 * 1000; // 30분 (v1: 4시간 → 보안 강화)

/**
 * 관리자 권한 검증
 * @returns {Object|null} 관리자 정보 또는 null (리다이렉트)
 */
async function requireAdmin() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    location.replace('admin-login.html');
    return null;
  }

  // 서버 RPC로 관리자 권한 확인 (클라이언트 이메일 비교 제거)
  const { data: admin, error } = await db.rpc('check_admin_role', {
    p_auth_id: session.user.id
  });

  if (error || !admin) {
    await safeSignOut();
    location.replace('admin-login.html');
    return null;
  }

  return admin;
}

/**
 * 트레이너 권한 검증 (캐시 30분)
 * @returns {Object|null} 트레이너 정보 또는 null (리다이렉트)
 */
async function requireTrainer() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    location.replace('trainer-login.html');
    return null;
  }

  // 캐시 확인
  const cached = _getTrainerCache(session.user.id);
  if (cached) return cached;

  // DB 조회
  const { data: trainer, error } = await db.from('trainers')
    .select('id, name, gym_location, is_admin, is_active')
    .eq('auth_id', session.user.id)
    .single();

  if (error || !trainer || !trainer.is_active) {
    await safeSignOut();
    location.replace('trainer-login.html');
    return null;
  }

  // 캐시 저장
  const info = { ...trainer, auth_id: session.user.id, _ts: Date.now() };
  localStorage.setItem(_TRAINER_CACHE_KEY, JSON.stringify(info));
  return info;
}

/**
 * 안전한 로그아웃
 */
async function safeSignOut() {
  try {
    await db.auth.signOut();
  } catch (_) {
    localStorage.removeItem('vg_session');
  }
}

/**
 * 로그아웃 + 리다이렉트
 * @param {string} redirectTo - 리다이렉트 URL
 */
async function doLogout(redirectTo) {
  await safeSignOut();
  localStorage.removeItem(_TRAINER_CACHE_KEY);
  localStorage.removeItem('vg_exdb_cache_v2');
  localStorage.removeItem('vg_session_draft');
  location.replace(redirectTo);
}

// ── 내부 헬퍼 ────────────────────────────────────────────────

function _getTrainerCache(authId) {
  try {
    const raw = localStorage.getItem(_TRAINER_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.auth_id !== authId) return null;
    if (Date.now() - data._ts > _TRAINER_CACHE_TTL) return null;
    return data;
  } catch (_) {
    return null;
  }
}
