// ============================================================
// VERA GYM v2 — utils.js
// 공통 유틸리티 함수
// ============================================================

// ── XSS 이스케이프 ─────────────────────────────────────────

const _escDiv = document.createElement('div');

/**
 * HTML 이스케이프 (XSS 방어)
 * @param {*} s - 이스케이프할 값
 * @returns {string}
 */
function esc(s) {
  if (s == null) return '';
  _escDiv.textContent = String(s);
  return _escDiv.innerHTML;
}

/**
 * onclick 속성용 이스케이프 (작은따옴표 포함)
 * @param {*} s
 * @returns {string}
 */
function escAttr(s) {
  return esc(s).replace(/'/g, '&#39;');
}


// ── 날짜/시간 포맷 ────────────────────────────────────────

/**
 * Date → 'YYYY-MM-DD'
 */
function formatDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Date → 'YYYY.MM.DD'
 */
function formatDateDot(d) {
  return formatDate(d).replace(/-/g, '.');
}

/**
 * Date → 'M/D (요일)'
 */
function formatDateShort(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${dt.getMonth() + 1}/${dt.getDate()} (${days[dt.getDay()]})`;
}

/**
 * 'HH:MM' → 'HH:MM' (24h, 변환 없이 반환)
 */
function formatTime(t) {
  if (!t) return '';
  return t.slice(0, 5);
}


// ── 숫자 포맷 ─────────────────────────────────────────────

/**
 * 천 단위 콤마
 */
function formatNumber(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString('ko-KR');
}

/**
 * 금액 표시 (원)
 */
function formatWon(n) {
  return formatNumber(n) + '원';
}


// ── PT 세션 계산 ──────────────────────────────────────────

/**
 * PT 일정의 현재 회차 계산 (v1 로직 완전 이식)
 * @param {Object} sched - 현재 일정 레코드
 * @param {Array} allScheds - 해당 PT 상품의 전체 일정
 * @returns {Object} { num, total } — num은 null 가능 (회차 미확정)
 */
function calcPtSession(sched, allScheds) {
  if (!sched || !allScheds || !sched.pt_product_id) return { num: null, total: 0 };

  const total = sched.pt_products?.total_sessions || 0;
  const remaining = sched.pt_products?.remaining_sessions;
  const used = (total && remaining != null) ? total - remaining : null;

  // 같은 PT 상품의 PT/SPT 일정만 (cancelled 제외)
  const ptScheds = allScheds
    .filter(s =>
      s.pt_product_id === sched.pt_product_id &&
      (s.type === 'PT' || s.type === 'SPT') &&
      s.status !== 'cancelled'
    )
    .sort((a, b) => {
      const d = (a.sched_date || '').localeCompare(b.sched_date || '');
      return d !== 0 ? d : (a.start_time || '').localeCompare(b.start_time || '');
    });

  const status = sched.status;

  // 완료/노쇼: session_number가 있으면 사용, 없으면 used 기반 계산
  if (status === 'completed' || status === 'noshow') {
    if (sched.session_number) return { num: sched.session_number, total };
    return { num: used, total };
  }

  // 예약 상태: used + 이 일정 앞의 scheduled 개수 + 1
  if (status === 'scheduled') {
    if (used == null) return { num: null, total };
    const today = formatDate(new Date());
    const isPast = sched.sched_date < today;
    if (isPast) return { num: null, total }; // 과거 미완료 → 회차 미확정

    // 이 일정 앞의 scheduled 개수
    const idx = ptScheds.findIndex(s => s.id === sched.id);
    let scheduledBefore = 0;
    for (let i = 0; i < idx; i++) {
      if (ptScheds[i].status === 'scheduled') scheduledBefore++;
    }
    return { num: used + scheduledBefore + 1, total };
  }

  return { num: null, total };
}


// ── 기본 중량 모드 ────────────────────────────────────────

/**
 * 도구에 따른 기본 중량 모드 반환
 * @param {string} tool - 운동 도구명
 * @returns {'total'|'single'}
 */
function defaultWeightMode(tool) {
  if (!tool) return 'total';
  const t = tool.toLowerCase();
  if (t.includes('덤벨') || t.includes('dumbbell') || t.includes('케틀벨') || t.includes('kettlebell')) {
    return 'single';
  }
  return 'total';
}

/**
 * 실질 중량 계산
 * @param {number} weight - 입력 중량
 * @param {'total'|'single'} mode - 중량 모드
 * @returns {number}
 */
function effectiveWeight(weight, mode) {
  return mode === 'single' ? weight * 2 : weight;
}


// ── 클립보드 ──────────────────────────────────────────────

/**
 * 클립보드에 텍스트 복사
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}


// ── 디바운스 ──────────────────────────────────────────────

/**
 * @param {Function} fn
 * @param {number} ms
 * @returns {Function}
 */
function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
