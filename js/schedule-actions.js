// ============================================================
// VERA GYM v2 — schedule-actions.js
// 일정 상태 전이 (완료/노쇼/취소/롤백) + 동시 탭 방어
// ============================================================

// ── 동시 탭 방어 ─────────────────────────────────────────

let _schedActionPending = false;

function _guardAction() {
  if (_schedActionPending) return false;
  _schedActionPending = true;
  setTimeout(() => { _schedActionPending = false; }, 3000);
  return true;
}


// ── 일정 완료 (scheduled → completed) ────────────────────

/**
 * PT 세션 완료 처리
 * - 서버 RPC: process_session (잔여횟수 차감 + 수업일지 생성)
 * @param {string} scheduleId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function completeSession(scheduleId) {
  if (!_guardAction()) return { ok: false, error: '처리 중입니다' };

  const confirmed = await showConfirm('수업을 완료 처리할까요?');
  if (!confirmed) { _schedActionPending = false; return { ok: false }; }

  const { data, error } = await db.rpc('process_session', {
    p_schedule_id: scheduleId,
    p_action: 'completed'
  });

  _schedActionPending = false;

  if (error || !data?.ok) {
    return { ok: false, error: error?.message || data?.message || '완료 처리 실패' };
  }
  return { ok: true, data };
}


// ── 노쇼 (scheduled → noshow) ────────────────────────────

/**
 * 노쇼 처리
 * - 서버 RPC: process_session (잔여횟수 차감)
 * @param {string} scheduleId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function noshowSession(scheduleId) {
  if (!_guardAction()) return { ok: false, error: '처리 중입니다' };

  const confirmed = await showConfirm('노쇼로 처리할까요? 잔여 횟수가 차감됩니다.', { danger: true });
  if (!confirmed) { _schedActionPending = false; return { ok: false }; }

  const { data, error } = await db.rpc('process_session', {
    p_schedule_id: scheduleId,
    p_action: 'noshow'
  });

  _schedActionPending = false;

  if (error || !data?.ok) {
    return { ok: false, error: error?.message || data?.message || '노쇼 처리 실패' };
  }
  return { ok: true, data };
}


// ── 취소 (scheduled → cancelled) ─────────────────────────

/**
 * 예약 취소 (잔여횟수 변동 없음 — 아직 차감 전이므로)
 * @param {string} scheduleId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function cancelScheduledSession(scheduleId) {
  if (!_guardAction()) return { ok: false, error: '처리 중입니다' };

  const confirmed = await showConfirm('예약을 취소할까요?');
  if (!confirmed) { _schedActionPending = false; return { ok: false }; }

  const { error } = await db.from('schedules')
    .update({ status: 'cancelled' })
    .eq('id', scheduleId)
    .eq('status', 'scheduled'); // 방어: scheduled 상태만 변경

  _schedActionPending = false;

  if (error) {
    console.error('Schedule action error:', error);
    return { ok: false, error: '처리에 실패했습니다. 다시 시도해주세요.' };
  }
  return { ok: true };
}


// ── 완료/노쇼 → 취소 (잔여횟수 복원) ────────────────────

/**
 * 완료/노쇼 상태의 세션을 취소 처리 (잔여횟수 복원)
 * - 서버 RPC: cancel_completed_session
 * @param {string} scheduleId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function cancelCompletedSession(scheduleId) {
  if (!_guardAction()) return { ok: false, error: '처리 중입니다' };

  const confirmed = await showConfirm(
    '수업을 취소하고 잔여 횟수를 복원할까요?',
    { danger: true, confirmText: '취소 및 복원' }
  );
  if (!confirmed) { _schedActionPending = false; return { ok: false }; }

  // 2차 확인 (더블 탭 방어)
  const doubleConfirm = await showConfirm(
    '정말로 취소할까요? 수업일지도 삭제됩니다.',
    { danger: true, confirmText: '확인' }
  );
  if (!doubleConfirm) { _schedActionPending = false; return { ok: false }; }

  const { data, error } = await db.rpc('cancel_completed_session', {
    p_schedule_id: scheduleId
  });

  _schedActionPending = false;

  if (error) {
    console.error('Schedule action error:', error);
    return { ok: false, error: '처리에 실패했습니다. 다시 시도해주세요.' };
  }
  return { ok: true, data };
}


// ── 롤백 (completed/noshow → scheduled) ──────────────────

/**
 * 완료/노쇼 상태를 예약으로 되돌림 (잔여횟수 복원)
 * - 서버 RPC: rollback_session
 * - 주로 관리자가 사용
 * @param {string} scheduleId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function rollbackSession(scheduleId) {
  if (!_guardAction()) return { ok: false, error: '처리 중입니다' };

  const confirmed = await showConfirm(
    '예약 상태로 되돌릴까요? 잔여 횟수가 복원됩니다.',
    { confirmText: '되돌리기' }
  );
  if (!confirmed) { _schedActionPending = false; return { ok: false }; }

  const { data, error } = await db.rpc('rollback_session', {
    p_schedule_id: scheduleId
  });

  _schedActionPending = false;

  if (error) {
    console.error('Schedule action error:', error);
    return { ok: false, error: '처리에 실패했습니다. 다시 시도해주세요.' };
  }
  return { ok: true, data };
}


// ── 완료 ↔ 노쇼 전환 ────────────────────────────────────

/**
 * 완료/노쇼 상태 토글 (잔여횟수 변동 없음)
 * - 서버 RPC: toggle_session_status
 * @param {string} scheduleId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function toggleSessionStatus(scheduleId) {
  if (!_guardAction()) return { ok: false, error: '처리 중입니다' };

  const { data, error } = await db.rpc('toggle_session_status', {
    p_schedule_id: scheduleId
  });

  _schedActionPending = false;

  if (error) {
    console.error('Schedule action error:', error);
    return { ok: false, error: '처리에 실패했습니다. 다시 시도해주세요.' };
  }
  return { ok: true, data };
}


// ── 관리자 전용: completed/noshow → cancelled ────────────

/**
 * 관리자가 완료/노쇼 상태에서 직접 취소 (2단계)
 * 1. rollback_session → 잔여횟수 복원 + 수업일지 삭제
 * 2. schedules.update → cancelled
 * @param {string} scheduleId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function adminCancelCompletedSession(scheduleId) {
  if (!_guardAction()) return { ok: false, error: '처리 중입니다' };

  const confirmed = await showConfirm(
    '관리자 권한으로 취소합니다. 잔여 횟수가 복원되고 수업일지가 삭제됩니다.',
    { danger: true, confirmText: '취소 및 복원' }
  );
  if (!confirmed) { _schedActionPending = false; return { ok: false }; }

  // 1단계: 롤백
  const { error: rbErr } = await db.rpc('rollback_session', {
    p_schedule_id: scheduleId
  });
  if (rbErr) {
    _schedActionPending = false;
    console.error('Rollback error:', rbErr); return { ok: false, error: '롤백에 실패했습니다.' };
  }

  // 2단계: 취소로 변경
  const { error: upErr } = await db.from('schedules')
    .update({ status: 'cancelled' })
    .eq('id', scheduleId);

  _schedActionPending = false;

  if (upErr) {
    console.error('Status update error:', upErr);
    return { ok: false, error: '상태 변경에 실패했습니다.' };
  }
  return { ok: true };
}
