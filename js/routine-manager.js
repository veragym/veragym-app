// ============================================================
// VERA GYM v2 — routine-manager.js
// 루틴 CRUD + 공유 (v1 routine-utils.js 완전 이식)
// ============================================================

// ── 루틴 목록 ─────────────────────────────────────────────

/**
 * 트레이너의 루틴 목록 조회
 * @param {string} trainerId
 * @returns {Promise<Array>}
 */
async function routineList(trainerId) {
  const { data, error } = await db
    .from('trainer_routines')
    .select('id, name, created_at, share_code')
    .eq('trainer_id', trainerId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('routineList', error);
    showToast('루틴 목록을 불러오지 못했습니다');
    return [];
  }
  return data || [];
}

/**
 * 루틴의 운동 목록 조회
 * @param {string} routineId
 * @returns {Promise<Array>}
 */
async function routineExercises(routineId) {
  const { data, error } = await db
    .from('trainer_routine_exercises')
    .select('id, exercise_ref_id, name_ko, part, tool, weight_mode, order_index')
    .eq('routine_id', routineId)
    .order('order_index', { ascending: true });
  if (error) {
    console.error('routineExercises', error);
    showToast('루틴 운동 목록을 불러오지 못했습니다');
    return [];
  }
  return data || [];
}


// ── 루틴 CRUD ─────────────────────────────────────────────

/**
 * 루틴 저장 (폴더 생성 + 운동 목록 삽입)
 * @param {string} trainerId
 * @param {string} routineName
 * @param {Array} exercises - [{ refId, name, part, tool, weight_mode }]
 * @returns {Promise<boolean>}
 */
async function routineSave(trainerId, routineName, exercises) {
  // 1. 루틴 폴더 생성
  const { data: routine, error: rErr } = await db
    .from('trainer_routines')
    .insert({ trainer_id: trainerId, name: routineName })
    .select('id')
    .single();

  if (rErr || !routine) {
    console.error('routineSave folder', rErr);
    showToast('루틴 저장에 실패했습니다');
    return false;
  }

  // 2. 운동 목록 삽입
  const rows = exercises.map((ex, i) => ({
    routine_id:      routine.id,
    trainer_id:      trainerId,
    exercise_ref_id: ex.refId || null,
    name_ko:         ex.name || '운동',
    part:            ex.part || '',
    tool:            ex.tool || '',
    weight_mode:     ex.weight_mode || 'total',
    order_index:     i,
  }));

  const { error: eErr } = await db
    .from('trainer_routine_exercises')
    .insert(rows);

  if (eErr) {
    console.error('routineSave exercises', eErr);
    showToast('운동 목록 저장에 실패했습니다');
    // 빈 루틴 폴더 정리
    await db.from('trainer_routines').delete().eq('id', routine.id);
    return false;
  }
  return true;
}

/**
 * 기존 루틴에 운동 하나 추가
 */
async function routineExerciseAppend(routineId, trainerId, exercise, orderIndex) {
  const { error } = await db
    .from('trainer_routine_exercises')
    .insert({
      routine_id:      routineId,
      trainer_id:      trainerId,
      exercise_ref_id: exercise.refId || exercise.id || null,
      name_ko:         exercise.name_ko || exercise.name || '운동',
      part:            exercise.part || exercise.part_unified || '',
      tool:            exercise.tool || exercise.tool_unified || '',
      weight_mode:     exercise.weight_mode || defaultWeightMode(exercise.tool || exercise.tool_unified),
      order_index:     orderIndex,
    });
  if (error) { console.error('routineExerciseAppend', error); return false; }
  return true;
}

/**
 * 루틴 운동 하나 삭제
 */
async function routineExerciseRemove(rowId) {
  const { error } = await db
    .from('trainer_routine_exercises')
    .delete()
    .eq('id', rowId);
  if (error) { console.error('routineExerciseRemove', error); return false; }
  return true;
}

/**
 * 루틴 삭제 (CASCADE로 운동 목록도 자동 삭제)
 */
async function routineDelete(routineId) {
  const { error } = await db
    .from('trainer_routines')
    .delete()
    .eq('id', routineId);
  if (error) { console.error('routineDelete', error); return false; }
  return true;
}


// ── 루틴 공유 ─────────────────────────────────────────────

/**
 * URL에서 share_code 추출
 */
function shareCodeFromUrl(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('r') || null;
  } catch {
    const trimmed = url.trim();
    if (/^[A-Z0-9]{8}$/i.test(trimmed)) return trimmed.toUpperCase();
    return null;
  }
}

/**
 * 루틴의 공유 링크 생성
 */
async function getShareLink(routineId, table = 'trainer_routines') {
  const { data, error } = await db.from(table).select('share_code').eq('id', routineId).single();
  if (error || !data?.share_code) return null;
  return `${location.origin}/share?r=${data.share_code}`;
}

/**
 * 공유 코드로 루틴 조회
 */
async function lookupByShareLink(urlOrCode) {
  const code = shareCodeFromUrl(urlOrCode);
  if (!code) return null;
  const { data, error } = await db.rpc('lookup_routine_by_share_code', { p_code: code });
  if (error) { console.error('lookupByShareLink', error); return null; }
  return data || null;
}

/**
 * 클립보드에 공유 링크 복사
 */
async function copyShareLink(routineId, table = 'trainer_routines') {
  const link = await getShareLink(routineId, table);
  if (!link) { showToast('링크 생성에 실패했습니다'); return; }
  const ok = await copyToClipboard(link);
  showToast(ok ? '링크가 복사되었습니다' : '복사 실패');
}


// ── 루틴 선택 모달 (공통 UI) ──────────────────────────────

/**
 * 루틴 선택 모달 열기
 * @param {Object} options
 * @param {string} options.trainerId
 * @param {Function} options.onSelect - async (exercises) => void
 * @param {boolean} [options.withImageUrl] - image_url도 가져올지
 */
async function routinePickerOpen(options) {
  const { trainerId, onSelect, withImageUrl = false } = options;

  document.getElementById('routinePickerOverlay')?.remove();

  const routines = await routineList(trainerId);

  const overlay = document.createElement('div');
  overlay.id = 'routinePickerOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--bg-overlay);z-index:9999;display:flex;align-items:flex-end;justify-content:center;';

  const sheet = document.createElement('div');
  sheet.style.cssText = 'background:var(--bg-elevated);width:100%;max-width:480px;max-height:70vh;border-radius:var(--radius-lg) var(--radius-lg) 0 0;overflow:hidden;display:flex;flex-direction:column;animation:slideUp 0.25s ease;';

  // 헤더
  const header = document.createElement('div');
  header.style.cssText = 'padding:var(--space-4) var(--space-5);border-bottom:1px solid var(--border-default);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
  header.innerHTML = `<span style="font-size:var(--text-base);font-weight:var(--font-bold);">루틴 불러오기</span>
    <button style="background:none;border:none;color:var(--text-tertiary);font-size:20px;cursor:pointer;">✕</button>`;
  header.querySelector('button').addEventListener('click', () => overlay.remove());

  // 목록
  const list = document.createElement('div');
  list.style.cssText = 'overflow-y:auto;flex:1;padding:var(--space-2) 0;';

  if (!routines.length) {
    list.innerHTML = '<div style="padding:var(--space-8);text-align:center;color:var(--text-tertiary);font-size:var(--text-sm);">저장된 루틴이 없습니다</div>';
  } else {
    const routineMap = {};
    routines.forEach(r => {
      routineMap[r.id] = r;
      const item = document.createElement('div');
      item.style.cssText = 'padding:var(--space-3) var(--space-5);cursor:pointer;border-bottom:1px solid var(--border-light);display:flex;align-items:center;gap:var(--space-3);';
      item.dataset.rid = r.id;
      item.innerHTML = `<span style="flex:1;font-size:var(--text-sm);font-weight:var(--font-semibold);">${esc(r.name)}</span>
        <span style="font-size:var(--text-xs);color:var(--text-tertiary);">${(r.created_at || '').slice(0, 10)}</span>`;
      list.appendChild(item);
    });

    list.addEventListener('click', async (e) => {
      const item = e.target.closest('[data-rid]');
      if (!item) return;
      overlay.remove();
      document.body.style.overflow = '';

      const exList = await routineExercises(item.dataset.rid);
      if (!exList.length) { showToast('루틴에 운동이 없습니다'); return; }

      let result = exList.map(ex => ({
        refId: ex.exercise_ref_id,
        name: ex.name_ko,
        part: ex.part,
        tool: ex.tool,
        weight_mode: ex.weight_mode || 'total',
        image_url: null,
      }));

      if (withImageUrl) {
        const refIds = result.map(e => e.refId).filter(Boolean);
        if (refIds.length) {
          const { data: refs } = await db.from('exercise_refs').select('id, image_url').in('id', refIds);
          if (refs) {
            const imgMap = {};
            refs.forEach(rf => { imgMap[rf.id] = rf.image_url; });
            result = result.map(ex => ({ ...ex, image_url: imgMap[ex.refId] || null }));
          }
        }
      }

      await onSelect(result);
    });
  }

  sheet.appendChild(header);
  sheet.appendChild(list);
  overlay.appendChild(sheet);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}


/**
 * 루틴 저장 모달 열기
 * @param {string} trainerId
 * @param {Array} exercises - [{ refId, name, part, tool, weight_mode }]
 */
function routineSaveModalOpen(trainerId, exercises) {
  document.getElementById('routineSaveOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'routineSaveOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--bg-overlay);z-index:9999;display:flex;align-items:center;justify-content:center;padding:var(--space-6);';

  overlay.innerHTML = `<div style="background:var(--bg-elevated);border-radius:var(--radius-md);padding:var(--space-5);width:100%;max-width:360px;box-shadow:var(--shadow-xl);">
    <div style="font-size:var(--text-base);font-weight:var(--font-bold);margin-bottom:var(--space-4);">루틴으로 저장</div>
    <div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-bottom:var(--space-2);">
      운동 ${exercises.length}개가 포함됩니다
    </div>
    <input id="routineNameInput" type="text" placeholder="루틴 이름을 입력하세요"
      style="width:100%;box-sizing:border-box;padding:var(--space-3);
             background:var(--bg-inset);border:1.5px solid var(--border-default);border-radius:var(--radius-md);
             color:var(--text-primary);font-size:var(--text-sm);outline:none;margin-bottom:var(--space-4);font-family:inherit;"
      maxlength="30">
    <div style="display:flex;gap:var(--space-2);">
      <button id="routineSaveCancelBtn" class="btn btn-lg btn-cancel" style="flex:1;">취소</button>
      <button id="routineSaveConfirmBtn" class="btn btn-lg btn-primary" style="flex:1;">저장</button>
    </div>
  </div>`;

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  document.body.appendChild(overlay);
  document.getElementById('routineNameInput').focus();

  document.getElementById('routineSaveCancelBtn').addEventListener('click', () => overlay.remove());

  document.getElementById('routineSaveConfirmBtn').addEventListener('click', async () => {
    const name = document.getElementById('routineNameInput').value.trim();
    if (!name) {
      document.getElementById('routineNameInput').style.borderColor = 'var(--color-danger)';
      return;
    }
    const btn = document.getElementById('routineSaveConfirmBtn');
    btn.textContent = '저장 중...';
    btn.disabled = true;

    const ok = await routineSave(trainerId, name, exercises);
    overlay.remove();
    showToast(ok ? `"${name}" 루틴 저장 완료` : '저장 실패');
  });
}
