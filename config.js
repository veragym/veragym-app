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
    try { await db.auth.signOut(); } catch (_) { localStorage.removeItem('vg_session'); }
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
  // 4시간: 관리자가 트레이너 비활성화/정보변경 시 최대 4시간 내 반영
  const _TRAINER_CACHE_TTL = 4 * 60 * 60 * 1000; // 4시간
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
    try { await db.auth.signOut(); } catch (_) { localStorage.removeItem('vg_session'); }
    localStorage.removeItem('vg_trainer');
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

// ── 커스텀 확인 모달 ────────────────────────────────────────
function showConfirm(message, { okText = '확인', cancelText = '취소', danger = false } = {}) {
  return new Promise(resolve => {
    const existing = document.getElementById('_confirmBg');
    if (existing) existing.remove();

    const bg = document.createElement('div');
    bg.id = '_confirmBg';
    bg.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px';

    const lines = message.split('\n').map(l => `<p style="margin:0 0 4px">${esc(l)}</p>`).join('');
    const okColor = danger ? '#ef4444' : '#3b82f6';
    bg.innerHTML = `
      <div style="background:#1a2a3a;border-radius:14px;padding:24px 20px 18px;max-width:320px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.5)">
        <div style="font-size:14px;color:#c8daea;line-height:1.6;margin-bottom:20px">${lines}</div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="_confirmCancel" style="flex:1;padding:10px;border:1px solid #2a4a6a;border-radius:8px;background:transparent;color:#7a9ab8;font-size:14px;cursor:pointer">${esc(cancelText)}</button>
          <button id="_confirmOk" style="flex:1;padding:10px;border:none;border-radius:8px;background:${okColor};color:#fff;font-size:14px;font-weight:600;cursor:pointer">${esc(okText)}</button>
        </div>
      </div>`;

    const cleanup = (result) => { bg.remove(); resolve(result); };
    bg.querySelector('#_confirmOk').addEventListener('click', () => cleanup(true));
    bg.querySelector('#_confirmCancel').addEventListener('click', () => cleanup(false));
    bg.addEventListener('click', e => { if (e.target === bg) cleanup(false); });

    document.body.appendChild(bg);
    bg.querySelector('#_confirmOk').focus();
  });
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

// ── PT 회차 계산 (통일 함수) ────────────────────────────────
// schedule: 단일 일정 객체 (pt_products, status, pt_product_id, sched_date, start_time, session_number 필요)
// allSchedules: 전체 일정 배열 (offset 계산용)
// 반환: { num: 표시할 회차 (null이면 ?), total: 총 회차 }
function calcPtSession(schedule, allSchedules) {
  const pt = schedule.pt_products;
  if (!pt) return { num: null, total: 0 };
  const total = pt.total_sessions || 0;
  const used = total - (pt.remaining_sessions || 0);

  // 완료/노쇼: DB에 기록된 session_number 사용, 없으면 used
  if (schedule.status === 'completed' || schedule.status === 'noshow') {
    return { num: schedule.session_number ?? used, total };
  }

  // 취소: used만 표시
  if (schedule.status === 'cancelled') {
    return { num: used, total };
  }

  // 예약(scheduled): 같은 상품의 예약들 중 몇 번째인지 계산
  const today = new Date();
  const todayYMD = today.getFullYear() + '-'
    + String(today.getMonth() + 1).padStart(2, '0') + '-'
    + String(today.getDate()).padStart(2, '0');

  // 과거 미완료 예약은 회차 확정 불가
  if (schedule.sched_date < todayYMD) {
    return { num: null, total };
  }

  // 오늘 이후 scheduled 중 같은 pt_product_id만 추출, 날짜+시간순 정렬
  const sameProd = allSchedules
    .filter(s => s.type === 'PT'
      && s.status === 'scheduled'
      && s.pt_product_id === schedule.pt_product_id
      && s.sched_date >= todayYMD)
    .sort((a, b) => (a.sched_date + a.start_time) < (b.sched_date + b.start_time) ? -1 : 1);

  const idx = sameProd.findIndex(s => s.id === schedule.id);
  const offset = idx >= 0 ? idx : 0;

  return { num: used + offset + 1, total };
}

// ── XSS 방어 이스케이프 유틸 ────────────────────────────────
function esc(str) {
  if (str == null) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

// ── 서비스워커 업데이트 감지 → 자동 리로드 ──────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (nw) nw.addEventListener('statechange', () => {
        if (nw.state === 'activated' && navigator.serviceWorker.controller) {
          showToast('앱이 업데이트되었습니다. 새로고침합니다.');
          setTimeout(() => location.reload(), 1500);
        }
      });
    });
  }).catch(() => {});
}

// ── 전역 에러 핸들러 ────────────────────────────────────────
window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled rejection:', e.reason);
  if (window.showToast) showToast('오류가 발생했습니다. 새로고침해주세요.');
});
window.onerror = (msg, src, line) => {
  console.error(`Error: ${msg} at ${src}:${line}`);
};
