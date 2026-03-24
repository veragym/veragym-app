// ============================================================
// VERA GYM APP - config.js
// Supabase 클라이언트 초기화 + 공통 유틸리티
//
// ★ Supabase 프로젝트 구분
//   실 DB  : veragym-app   → lrzffwawpoidimlrbfxe  ← 현재 연결
//   테스트 DB : veragym-test → jpfgcwlhitzwjoppszzl
//
// ★ 관리자 계정
//   슈퍼관리자 : veragym  / (비밀번호는 별도 보관)
//   서브관리자 : admin    / 1234
// ============================================================

// ── 실 DB (veragym-app) ──────────────────────────────────────
const SUPABASE_URL      = 'https://lrzffwawpoidimlrbfxe.supabase.co'; // 실 DB
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyemZmd2F3cG9pZGltbHJiZnhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDc0MjAsImV4cCI6MjA4OTcyMzQyMH0._AIkOKdjtOHC-igxg9toc-rq10KM3HVkjrgr1LOw-OI'; // 만료: 2036-03-21
const SUPER_ADMIN_EMAIL = 'veragym@naver.com'; // 슈퍼관리자 이메일 (id: veragym)
const EDGE_BASE         = 'https://lrzffwawpoidimlrbfxe.supabase.co/functions/v1'; // Edge Functions 베이스 URL

// ── Supabase 클라이언트 초기화 ───────────────────────────────
// 모든 HTML 파일에서 init_db() 호출 후 db 변수로 사용
let db;
function init_db() {
  db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, storageKey: 'vg_session' }
  });
}

// ── 관리자 인증 (admin.html 전용) ───────────────────────────
// - 슈퍼관리자(veragym@naver.com): trainers 테이블 조회 없이 바로 통과
// - 서브관리자: trainers 테이블에서 is_admin=true 확인
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

// ── 트레이너 인증 (trainer-dash.html 등 트레이너 앱 전용) ────
// - localStorage 캐시 우선 사용 (auth_id 검증)
// - 캐시 없거나 불일치 시 DB 재조회 후 캐시 갱신
async function requireTrainer() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.replace('trainer-login.html'); return null; }

  const raw = localStorage.getItem('vg_trainer');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.auth_id === session.user.id) return parsed; // 캐시 유효
    } catch (_) {}
    localStorage.removeItem('vg_trainer'); // 손상된 캐시 제거
  }

  const { data: trainer, error } = await db.from('trainers')
    .select('id, name, gym_location, is_active, is_admin')
    .eq('auth_id', session.user.id).single();
  if (error || !trainer || !trainer.is_active) {
    await db.auth.signOut();
    location.replace('trainer-login.html');
    return null;
  }
  const trainerData = {
    id: trainer.id,
    name: trainer.name,
    gym_location: trainer.gym_location,
    auth_id: session.user.id // 다음 호출 시 세션 검증용
  };
  localStorage.setItem('vg_trainer', JSON.stringify(trainerData));
  return trainerData;
}

// ── 토스트 메시지 ────────────────────────────────────────────
// HTML에 <div id="toast"> 요소 필요
function showToast(msg, duration = 2400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, duration);
}

// ── 모달 열기/닫기 ───────────────────────────────────────────
// CSS: .modal-bg { display:none } / .modal-bg.open { display:flex }
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id, e) {
  if (e && e.target !== document.getElementById(id)) return; // 모달 내부 클릭 시 닫힘 방지
  document.getElementById(id).classList.remove('open');
}

// ── PWA 뒤로가기 앱 종료 방지 ────────────────────────────────
// 로그인 완료 후 뒤로가기 버튼으로 로그인 화면 재접근 방지
function preventBackExit() {
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', () => {
    history.pushState(null, '', location.href);
  });
}
