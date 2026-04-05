// ============================================================
// VERA GYM v2 — ui.js
// 공통 UI 컴포넌트 (토스트, 확인창, 모달, 탭 등)
// ============================================================

// ── Toast ──────────────────────────────────────────────────

let _toastTimer = null;

/**
 * 토스트 메시지 표시
 * @param {string} msg - 메시지
 * @param {number} [duration=2400] - 표시 시간(ms)
 */
function showToast(msg, duration = 2400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.opacity = '0'; }, duration);
}


// ── Confirm Dialog ─────────────────────────────────────────

/**
 * 확인 대화상자
 * @param {string} message - 메시지
 * @param {Object} [opts] - 옵션
 * @param {boolean} [opts.danger] - 위험 액션 스타일
 * @param {string} [opts.confirmText] - 확인 버튼 텍스트 (기본: '확인') — v1 호환: okText도 동작
 * @param {string} [opts.okText] - confirmText의 별칭 (v1 호환)
 * @param {string} [opts.cancelText] - 취소 버튼 텍스트 (기본: '취소')
 * @returns {Promise<boolean>}
 */
function showConfirm(message, opts = {}) {
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'confirm-bg open';
    bg.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-msg">${esc(message)}</div>
        <div class="btn-group">
          <button class="btn btn-lg btn-cancel" data-action="cancel">
            ${esc(opts.cancelText || '취소')}
          </button>
          <button class="btn btn-lg ${opts.danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">
            ${esc(opts.confirmText || opts.okText || '확인')}
          </button>
        </div>
      </div>`;

    const cleanup = (result) => {
      bg.remove();
      resolve(result);
    };

    bg.querySelector('[data-action="cancel"]').onclick = () => cleanup(false);
    bg.querySelector('[data-action="confirm"]').onclick = () => cleanup(true);
    bg.onclick = (e) => { if (e.target === bg) cleanup(false); };

    document.body.appendChild(bg);
  });
}


// ── Modal (Bottom Sheet) ───────────────────────────────────

/**
 * 모달 열기
 * @param {string} id - 모달 배경(.modal-bg) ID
 */
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
}

/**
 * 모달 닫기
 * @param {string} id - 모달 배경(.modal-bg) ID
 * @param {Event} [e] - 이벤트 (배경 클릭 감지용)
 */
function closeModal(id, e) {
  if (e && e.target !== e.currentTarget) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  document.body.style.overflow = '';
}


// ── Tab Switching ──────────────────────────────────────────

/**
 * 탭 전환
 * @param {string} tabId - 탭 콘텐츠 ID
 * @param {HTMLElement} btn - 클릭된 탭 버튼
 * @param {Function} [onSwitch] - 탭 전환 후 콜백
 */
function switchTab(tabId, btn, onSwitch) {
  // 모든 탭 버튼 비활성
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // 모든 탭 콘텐츠 숨기기
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  // tabId가 'tab-' 접두사 없이 전달되면 자동 매핑
  const target = document.getElementById(tabId) || document.getElementById('tab-' + tabId);
  if (target) target.classList.add('active');

  if (typeof onSwitch === 'function') onSwitch(tabId);
}


// ── Back Button Prevention (PWA) ───────────────────────────

function preventBackExit() {
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', () => {
    history.pushState(null, '', location.href);
  });
}


// ── 전역 에러 핸들러 ──────────────────────────────────────

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason);
  // 네트워크 에러 등 사용자에게 알림
  if (e.reason?.message?.includes('Failed to fetch')) {
    showToast('네트워크 오류. 인터넷 연결을 확인하세요.');
  }
});

window.onerror = (msg, src, line, col, err) => {
  console.error('Runtime error:', { msg, src, line, col, err });
};
