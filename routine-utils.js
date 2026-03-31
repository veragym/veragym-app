/**
 * routine-utils.js
 * 루틴 폴더 공유 유틸리티
 * session-write.html, image-card.html 에서 공통 사용
 *
 * 의존: window.db (Supabase client), window.showToast(msg)
 */

/* ─────────────────────────────────────────────
   루틴 목록 불러오기
   반환: [{ id, name, created_at }]
───────────────────────────────────────────── */
async function routineList(trainerId) {
  const { data, error } = await db
    .from('trainer_routines')
    .select('id, name, created_at')
    .eq('trainer_id', trainerId)
    .order('created_at', { ascending: false });
  if (error) { console.error('routineList', error); if (window.showToast) showToast('루틴 목록을 불러오지 못했습니다'); return []; }
  return data || [];
}

/* ─────────────────────────────────────────────
   루틴 운동 목록 불러오기
   반환: [{ exercise_ref_id, name_ko, part, tool, weight_mode, order_index }]
───────────────────────────────────────────── */
async function routineExercises(routineId) {
  const { data, error } = await db
    .from('trainer_routine_exercises')
    .select('id, exercise_ref_id, name_ko, part, tool, weight_mode, order_index')
    .eq('routine_id', routineId)
    .order('order_index', { ascending: true });
  if (error) { console.error('routineExercises', error); if (window.showToast) showToast('루틴 운동 목록을 불러오지 못했습니다'); return []; }
  return data || [];
}

/* ─────────────────────────────────────────────
   루틴 저장
   exercises: [{ refId, name, part, tool, weight_mode }]
───────────────────────────────────────────── */
async function routineSave(trainerId, routineName, exercises) {
  // 1. 루틴 폴더 생성
  const { data: routine, error: rErr } = await db
    .from('trainer_routines')
    .insert({ trainer_id: trainerId, name: routineName })
    .select('id')
    .single();
  if (rErr || !routine) { console.error('routineSave folder', rErr); if (window.showToast) showToast('루틴 저장에 실패했습니다'); return false; }

  // 2. 운동 목록 삽입
  const rows = exercises.map((ex, i) => ({
    routine_id:      routine.id,
    trainer_id:      trainerId,
    exercise_ref_id: ex.refId || null,
    name_ko:         ex.name  || '운동',
    part:            ex.part  || '',
    tool:            ex.tool  || '',
    weight_mode:     ex.weight_mode || 'total',
    order_index:     i,
  }));

  const { error: eErr } = await db
    .from('trainer_routine_exercises')
    .insert(rows);
  if (eErr) { console.error('routineSave exercises', eErr); if (window.showToast) showToast('운동 목록 저장에 실패했습니다'); return false; }
  return true;
}

/* ─────────────────────────────────────────────
   기존 루틴에 운동 하나 추가
   exercise: { refId, name_ko, part, tool, weight_mode }
   orderIndex: 삽입 순서 (현재 운동 수)
───────────────────────────────────────────── */
async function routineExerciseAppend(routineId, trainerId, exercise, orderIndex) {
  const { error } = await db
    .from('trainer_routine_exercises')
    .insert({
      routine_id:      routineId,
      trainer_id:      trainerId,
      exercise_ref_id: exercise.refId || exercise.id || null,
      name_ko:         exercise.name_ko || exercise.name || '운동',
      part:            exercise.part    || exercise.part_unified || '',
      tool:            exercise.tool    || exercise.tool_unified || '',
      weight_mode:     exercise.weight_mode || (exercise.tool_unified === '덤벨' || exercise.tool === '덤벨' ? 'single' : 'total'),
      order_index:     orderIndex,
    });
  if (error) { console.error('routineExerciseAppend', error); return false; }
  return true;
}

/* ─────────────────────────────────────────────
   루틴 운동 하나 삭제
───────────────────────────────────────────── */
async function routineExerciseRemove(rowId) {
  const { error } = await db
    .from('trainer_routine_exercises')
    .delete()
    .eq('id', rowId);
  if (error) { console.error('routineExerciseRemove', error); return false; }
  return true;
}

/* ─────────────────────────────────────────────
   루틴 삭제 (CASCADE로 운동 목록도 자동 삭제)
───────────────────────────────────────────── */
async function routineDelete(routineId) {
  const { error } = await db
    .from('trainer_routines')
    .delete()
    .eq('id', routineId);
  if (error) { console.error('routineDelete', error); return false; }
  return true;
}

/* ─────────────────────────────────────────────
   루틴 선택 모달 (공통 UI)
   options:
     - trainerId: string
     - onSelect: async (exercises) => void
       exercises: [{ refId, name, part, tool }]
     - withImageUrl: bool  (image-card용: exercise_refs.image_url도 fetch)
───────────────────────────────────────────── */
async function routinePickerOpen(options) {
  const { trainerId, onSelect, withImageUrl = false } = options;

  // 기존 모달 제거
  document.getElementById('routinePickerOverlay')?.remove();

  const routines = await routineList(trainerId);

  const overlay = document.createElement('div');
  overlay.id = 'routinePickerOverlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.6);
    z-index:9999;display:flex;align-items:flex-end;
  `;

  const sheet = document.createElement('div');
  sheet.style.cssText = `
    background:#1a2636;width:100%;max-height:70vh;
    border-radius:16px 16px 0 0;overflow:hidden;display:flex;flex-direction:column;
  `;

  // 헤더
  const header = document.createElement('div');
  header.style.cssText = `
    padding:16px 20px;border-bottom:1px solid #2a3a4a;
    display:flex;align-items:center;justify-content:space-between;flex-shrink:0;
  `;
  header.innerHTML = `
    <span style="font-size:15px;font-weight:700;color:#e0eaf4;">루틴 불러오기</span>
    <button onclick="document.getElementById('routinePickerOverlay').remove()"
      style="background:none;border:none;color:#8aa8c4;font-size:20px;cursor:pointer;line-height:1;">✕</button>
  `;

  // 목록
  const list = document.createElement('div');
  list.style.cssText = 'overflow-y:auto;flex:1;padding:8px 0;';

  if (routines.length === 0) {
    list.innerHTML = `
      <div style="padding:32px;text-align:center;color:#8aa8c4;font-size:14px;">
        저장된 루틴이 없습니다.<br>수업일지에서 운동 구성 후 루틴으로 저장해 보세요.
      </div>`;
  } else {
    // DocumentFragment로 DOM 삽입 1회만 (리플로우 최소화)
    const routineMap = {};
    const fragment = document.createDocumentFragment();
    routines.forEach(r => {
      routineMap[r.id] = r;
      const item = document.createElement('div');
      item.style.cssText = `
        padding:14px 20px;cursor:pointer;border-bottom:1px solid #1e2e3e;
        display:flex;align-items:center;gap:12px;
      `;
      item.dataset.rid = r.id;
      item.innerHTML = `
        <span style="flex:1;font-size:14px;color:#e0eaf4;">${r.name}</span>
        <span style="font-size:11px;color:#8aa8c4;">${r.created_at.slice(0,10)}</span>
      `;
      fragment.appendChild(item);
    });
    list.appendChild(fragment); // 단 1회 DOM 삽입

    // 이벤트 위임: list에 리스너 1개만 (overlay 제거 시 자동 해제)
    list.addEventListener('click', async (e) => {
      const item = e.target.closest('[data-rid]');
      if (!item) return;
      const r = routineMap[item.dataset.rid];
      if (!r) return;

      overlay.remove();
      const exList = await routineExercises(r.id);
      if (exList.length === 0) {
        if (window.showToast) showToast('루틴에 운동이 없습니다');
        return;
      }

      let result = exList.map(ex => ({
        refId:       ex.exercise_ref_id,
        name:        ex.name_ko,
        part:        ex.part,
        tool:        ex.tool,
        weight_mode: ex.weight_mode || 'total',
        image_url:   null,
      }));

      // image-card용: image_url 추가 fetch
      if (withImageUrl) {
        const refIds = result.map(ex => ex.refId).filter(Boolean);
        if (refIds.length > 0) {
          const { data: refs } = await db
            .from('exercise_refs')
            .select('id, image_url')
            .in('id', refIds);
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

/* ─────────────────────────────────────────────
   루틴 저장 모달 (공통 UI)
   exercises: 현재 exercises 배열
   trainerId: string
───────────────────────────────────────────── */
function routineSaveModalOpen(trainerId, exercises) {
  if (!exercises || exercises.length === 0) {
    if (window.showToast) showToast('운동을 먼저 추가해 주세요');
    return;
  }

  document.getElementById('routineSaveOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'routineSaveOverlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.6);
    z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;
  `;

  overlay.innerHTML = `
    <div style="background:#1a2636;border-radius:14px;padding:24px;width:100%;max-width:360px;">
      <div style="font-size:15px;font-weight:700;color:#e0eaf4;margin-bottom:16px;">루틴으로 저장</div>
      <div style="font-size:12px;color:#8aa8c4;margin-bottom:8px;">
        운동 ${exercises.length}개가 포함됩니다
      </div>
      <input id="routineNameInput" type="text" placeholder="루틴 이름을 입력하세요"
        style="width:100%;box-sizing:border-box;padding:10px 12px;
               background:#0d1b2a;border:1px solid #2a3a4a;border-radius:8px;
               color:#e0eaf4;font-size:14px;outline:none;margin-bottom:16px;"
        maxlength="30" />
      <div style="display:flex;gap:10px;">
        <button onclick="document.getElementById('routineSaveOverlay').remove()"
          style="flex:1;padding:11px;background:#1e2e3e;border:none;border-radius:8px;
                 color:#8aa8c4;font-size:14px;cursor:pointer;">취소</button>
        <button id="routineSaveConfirmBtn"
          style="flex:1;padding:11px;background:#3b82f6;border:none;border-radius:8px;
                 color:#fff;font-size:14px;font-weight:600;cursor:pointer;">저장</button>
      </div>
    </div>
  `;

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  document.body.appendChild(overlay);
  document.getElementById('routineNameInput').focus();

  document.getElementById('routineSaveConfirmBtn').addEventListener('click', async () => {
    const name = document.getElementById('routineNameInput').value.trim();
    if (!name) {
      document.getElementById('routineNameInput').style.borderColor = '#ef4444';
      return;
    }
    const btn = document.getElementById('routineSaveConfirmBtn');
    btn.textContent = '저장 중...';
    btn.disabled = true;

    const ok = await routineSave(trainerId, name, exercises);
    overlay.remove();
    if (window.showToast) showToast(ok ? `"${name}" 루틴 저장 완료` : '저장 실패, 다시 시도해 주세요');
  });
}
