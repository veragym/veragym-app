// ============================================================
// VERA GYM v2 — exlib-app.js
// 운동 라이브러리 페이지
// ============================================================

(function () {
  'use strict';

  initDb();
  preventBackExit();

  let me = null;
  let _view = 'all'; // 'all' | 'mine' | 'routine'
  let _toolFilter = '';
  let _partFilter = '';
  let _showCount = 50;
  let _myLib = [];      // [{exercise_ref_id, is_favorite, use_count}]
  let _myIds = [];
  let _favIds = [];
  let _searchDebounce = null;
  const _returnTo = new URLSearchParams(location.search).get('returnTo');

  async function init() {
    me = await requireTrainer();
    if (!me) return;
    document.getElementById('trainerInfo').textContent = `${me.name} · ${me.gym_location}`;

    if (_returnTo) {
      document.getElementById('returnBar').style.display = '';
    }

    await Promise.all([loadExerciseDb(), loadMyLib()]);
    buildFilters();
    renderList();
  }

  init();

  // returnTo 바
  document.getElementById('btnReturn')?.addEventListener('click', () => {
    if (_returnTo) {
      // 같은 오리진만 허용 (오픈 리다이렉트 방지)
      try {
        const url = new URL(decodeURIComponent(_returnTo), location.origin);
        if (url.origin === location.origin) { location.href = url.href; return; }
      } catch (_) {}
      location.href = 'session-write.html';
    }
  });

  // 로그아웃
  document.getElementById('btnLogout').addEventListener('click', () => doLogout('trainer-login.html'));

  // ── 내 라이브러리 ──────────────────────────────────────
  async function loadMyLib() {
    const { data } = await db.from('trainer_exercise_library')
      .select('exercise_ref_id, is_favorite, use_count')
      .eq('trainer_id', me.id);
    _myLib = data || [];
    _myIds = _myLib.map(e => e.exercise_ref_id);
    _favIds = _myLib.filter(e => e.is_favorite).map(e => e.exercise_ref_id);
    document.getElementById('myCount').textContent = `(${_myIds.length})`;
  }

  // ── 뷰 전환 ───────────────────────────────────────────
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _view = btn.dataset.view;
      _showCount = 50;

      const isRoutine = _view === 'routine';
      document.querySelector('.ex-search-area').style.display = isRoutine ? 'none' : '';
      document.getElementById('statBar').style.display = isRoutine ? 'none' : '';
      document.getElementById('exList').style.display = isRoutine ? 'none' : '';
      document.getElementById('routineSection').style.display = isRoutine ? '' : 'none';

      if (isRoutine) renderRoutines();
      else renderList();
    });
  });

  // ── 필터 ───────────────────────────────────────────────
  function buildFilters() {
    const tools = [...new Set(_allExerciseDb.map(e => e.tool_unified).filter(Boolean))].sort();
    const parts = [...new Set(_allExerciseDb.map(e => e.part_unified).filter(Boolean))].sort();

    document.getElementById('toolChips').innerHTML =
      `<button class="chip ${!_toolFilter ? 'active' : ''}" data-ft="">전체</button>` +
      tools.map(t => `<button class="chip ${_toolFilter === t ? 'active' : ''}" data-ft="${escAttr(t)}">${esc(t)}</button>`).join('');

    document.getElementById('partChips').innerHTML =
      `<button class="chip ${!_partFilter ? 'active' : ''}" data-fp="">전체</button>` +
      parts.map(p => `<button class="chip ${_partFilter === p ? 'active' : ''}" data-fp="${escAttr(p)}">${esc(p)}</button>`).join('');

    document.querySelectorAll('[data-ft]').forEach(b => b.addEventListener('click', () => { _toolFilter = b.dataset.ft; _showCount = 50; buildFilters(); renderList(); }));
    document.querySelectorAll('[data-fp]').forEach(b => b.addEventListener('click', () => { _partFilter = b.dataset.fp; _showCount = 50; buildFilters(); renderList(); }));
  }

  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(() => { _showCount = 50; renderList(); }, 150);
  });
  document.getElementById('btnX').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    _showCount = 50;
    renderList();
  });

  // ── 리스트 렌더 ────────────────────────────────────────
  function renderList() {
    const q = (document.getElementById('searchInput').value || '').trim().toLowerCase().replace(/\s/g, '');
    let list = _allExerciseDb;

    if (_view === 'mine') list = list.filter(e => _myIds.includes(e.id));
    if (_toolFilter) list = list.filter(e => (e.tool_unified || '') === _toolFilter);
    if (_partFilter) list = list.filter(e => (e.part_unified || '').includes(_partFilter));
    if (q) list = list.filter(e => {
      const ko = (e.name_ko || '').toLowerCase().replace(/\s/g, '');
      const en = (e.name_en || '').toLowerCase().replace(/\s/g, '');
      return ko.includes(q) || en.includes(q);
    });

    // 정렬: 즐겨찾기 → 내 운동 → 전체
    list.sort((a, b) => {
      const af = _favIds.includes(a.id) ? 0 : _myIds.includes(a.id) ? 1 : 2;
      const bf = _favIds.includes(b.id) ? 0 : _myIds.includes(b.id) ? 1 : 2;
      return af - bf;
    });

    document.getElementById('statBar').textContent = `${list.length}개 / 전체 ${_allExerciseDb.length}개`;

    const shown = list.slice(0, _showCount);
    let html = '';
    shown.forEach(ex => {
      const isMine = _myIds.includes(ex.id);
      const isFav = _favIds.includes(ex.id);
      html += `<div class="ex-card" data-ex-id="${escAttr(ex.id)}">
        <div class="ex-card-row">
          ${ex.image_url ? `<img class="ex-thumb" src="${esc(ex.image_url)}" loading="lazy" onerror="this.style.display='none'">` : ''}
          <div style="flex:1;min-width:0;">
            <div class="ex-name">${esc(ex.name_ko || ex.name_en)}</div>
            <div class="ex-en-name" style="font-size:var(--text-xs);color:var(--text-tertiary);">${esc(ex.name_en || '')}</div>
            <div class="chips gap-1 mt-2">
              ${ex.tool_unified ? `<span class="tag tag-accent">${esc(ex.tool_unified)}</span>` : ''}
              ${ex.part_unified ? `<span class="tag tag-muted">${esc(ex.part_unified)}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;align-items:center;">
            <span style="font-size:18px;cursor:pointer;color:${isFav ? '#f5c518' : 'var(--gray-300)'};" data-fav="${escAttr(ex.id)}" data-is-fav="${isFav}">★</span>
            <button class="btn btn-sm ${isMine ? 'btn-danger' : 'btn-secondary'}" data-toggle-use="${escAttr(ex.id)}" data-is-mine="${isMine}" style="font-size:10px;padding:2px 6px;">${isMine ? '−' : '+'}</button>
          </div>
        </div>
      </div>`;
    });

    if (list.length > _showCount) {
      html += `<button class="ex-btn-more" id="loadMoreBtn">더보기 (+50)</button>`;
    }

    document.getElementById('exList').innerHTML = html || '<div class="empty">운동이 없습니다</div>';
    document.getElementById('loadMoreBtn')?.addEventListener('click', () => { _showCount += 50; renderList(); });
  }

  // 이벤트 위임
  document.getElementById('exList').addEventListener('click', async (e) => {
    const favBtn = e.target.closest('[data-fav]');
    if (favBtn) {
      e.stopPropagation();
      const exId = favBtn.dataset.fav;
      const isFav = favBtn.dataset.isFav === 'true';
      // 즐겨찾기는 내 운동에 있어야 함
      if (!_myIds.includes(exId)) {
        // 먼저 내 운동에 추가
        await db.from('trainer_exercise_library').insert({ trainer_id: me.id, exercise_ref_id: exId, is_favorite: true });
      } else {
        await db.from('trainer_exercise_library')
          .update({ is_favorite: !isFav })
          .eq('trainer_id', me.id)
          .eq('exercise_ref_id', exId);
      }
      await loadMyLib();
      renderList();
      return;
    }

    const useBtn = e.target.closest('[data-toggle-use]');
    if (useBtn) {
      e.stopPropagation();
      const exId = useBtn.dataset.toggleUse;
      const isMine = useBtn.dataset.isMine === 'true';
      if (isMine) {
        await db.from('trainer_exercise_library').delete().eq('trainer_id', me.id).eq('exercise_ref_id', exId);
      } else {
        await db.from('trainer_exercise_library').insert({ trainer_id: me.id, exercise_ref_id: exId });
      }
      await loadMyLib();
      renderList();
      return;
    }

    const card = e.target.closest('.ex-card');
    if (card) openExDetail(card.dataset.exId);
  });

  // ── 운동 상세 ──────────────────────────────────────────
  function openExDetail(id) {
    const ex = _allExerciseDb.find(e => e.id === id);
    if (!ex) return;

    let html = `<button class="ex-modal-close" id="exCloseBtn">&times;</button>`;
    if (ex.image_url) html += `<img class="ex-modal-img" src="${esc(ex.image_url)}" onerror="this.style.display='none'">`;
    html += `<div class="ex-modal-name">${esc(ex.name_ko || ex.name_en)}</div>`;
    html += `<div style="font-size:var(--text-sm);color:var(--text-tertiary);margin-bottom:var(--space-3);">${esc(ex.name_en || '')}</div>`;
    html += `<div class="chips gap-1 mb-3">
      ${ex.tool_unified ? `<span class="tag tag-accent">${esc(ex.tool_unified)}</span>` : ''}
      ${ex.part_unified ? `<span class="tag tag-muted">${esc(ex.part_unified)}</span>` : ''}
    </div>`;
    if (ex.primary_muscle) {
      html += `<div style="font-size:var(--text-sm);font-weight:var(--font-semibold);margin-bottom:var(--space-2);">근육 정보</div><div class="chips gap-1">`;
      html += `<span class="tag tag-accent">${esc(ex.primary_muscle)}</span>`;
      if (ex.synergist_1) html += `<span class="tag tag-muted">${esc(ex.synergist_1)}</span>`;
      if (ex.synergist_2) html += `<span class="tag tag-muted">${esc(ex.synergist_2)}</span>`;
      html += `</div>`;
    }

    document.getElementById('exModalBody').innerHTML = html;
    document.getElementById('exModal').classList.add('open');
    document.getElementById('exCloseBtn').addEventListener('click', () => document.getElementById('exModal').classList.remove('open'));
  }

  document.getElementById('exModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('exModal')) document.getElementById('exModal').classList.remove('open');
  });

  // ── 루틴 ───────────────────────────────────────────────
  async function renderRoutines() {
    const routines = await routineList(me.id);
    if (!routines.length) {
      document.getElementById('routineList').innerHTML = '<div class="empty">저장된 루틴이 없습니다</div>';
      return;
    }

    let html = '';
    for (const r of routines) {
      const exs = await routineExercises(r.id);
      html += `<div class="rt-card">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div class="rt-card-name">${esc(r.name)}</div>
          <div style="display:flex;gap:var(--space-1);">
            <button class="btn btn-sm btn-ghost" data-rt-copy="${escAttr(r.id)}">링크</button>
            <button class="btn btn-sm btn-danger" data-rt-del="${escAttr(r.id)}" data-rt-name="${escAttr(r.name)}">삭제</button>
          </div>
        </div>
        <div class="chips gap-1 mt-2">
          ${exs.map(e => `<span class="tag tag-muted">${esc(e.name_ko)}</span>`).join('')}
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:var(--space-2);">
          <span style="font-size:var(--text-xs);color:var(--text-tertiary);">${exs.length}개 · ${(r.created_at || '').slice(0, 10)}</span>
          <button class="btn btn-sm btn-secondary" data-rt-add="${escAttr(r.id)}" data-rt-rname="${escAttr(r.name)}" data-rt-count="${exs.length}">운동 추가</button>
        </div>
      </div>`;
    }

    document.getElementById('routineList').innerHTML = html;
  }

  document.getElementById('routineList').addEventListener('click', async (e) => {
    const delBtn = e.target.closest('[data-rt-del]');
    if (delBtn) {
      if (!await showConfirm(`"${delBtn.dataset.rtName}" 루틴을 삭제할까요?`, { danger: true })) return;
      await routineDelete(delBtn.dataset.rtDel);
      showToast('삭제 완료');
      await renderRoutines();
      return;
    }

    const copyBtn = e.target.closest('[data-rt-copy]');
    if (copyBtn) { await copyShareLink(copyBtn.dataset.rtCopy); return; }

    const addBtn = e.target.closest('[data-rt-add]');
    if (addBtn) {
      routinePickerOpen({
        trainerId: me.id,
        onSelect: async (exList) => {
          for (let i = 0; i < exList.length; i++) {
            await routineExerciseAppend(addBtn.dataset.rtAdd, me.id, exList[i], parseInt(addBtn.dataset.rtCount) + i);
          }
          showToast('운동 추가 완료');
          await renderRoutines();
        }
      });
    }
  });

  document.getElementById('btnNewRoutine').addEventListener('click', () => {
    routineSaveModalOpen(me.id, []);
  });

  // bfcache 대응
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) init();
  });

})();
