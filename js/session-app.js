// ============================================================
// VERA GYM v2 — session-app.js
// 수업일지 작성 (사진 촬영/업로드 포함)
// 의존: config, auth, ui, utils, image-utils, exercise-picker, routine-manager
// ============================================================

(function () {
  'use strict';

  initDb();
  preventBackExit();

  // ── 상태 ─────────────────────────────────────────────────
  let me = null;
  let logId = null;
  let memberId = null;
  let memberName = '';
  let scheduleId = null;
  let logDate = '';
  let exercises = []; // [{ refId, name, part, tool, weight_mode, sets, comment, photos }]

  // PT 노트 사진
  let _notePhotoPath = null;
  let _notePhotoFile = null;
  let _notePhotoRemoved = false;
  let _notePhotoRotatedBlob = null;

  // 사진 모달
  let _photoExIdx = null;
  let _photoPoseType = null; // 'start' | 'end'

  // 검색
  let _searchFilter = '';
  let _searchDebounce = null;

  // 드래프트
  const DRAFT_KEY = 'vg_session_draft';
  const DRAFT_TTL = 24 * 60 * 60 * 1000;


  // ================================================================
  // INIT
  // ================================================================

  async function init() {
    me = await requireTrainer();
    if (!me) return;

    const params = new URLSearchParams(location.search);
    logId      = params.get('log');
    memberId   = params.get('member');
    scheduleId = params.get('schedule');
    logDate    = params.get('date') || formatDate(new Date());

    // 라이브러리 & 빈도 로드
    await Promise.all([
      loadMyLibrary(me.id),
      loadFreqMap(me.id),
      loadExerciseDb()
    ]);

    if (logId) {
      await loadExistingLog();
    } else {
      await initNewLog();
    }

    renderExercises();
    updateMetaUI();
  }

  init();


  // ================================================================
  // LOAD / INIT LOG
  // ================================================================

  async function loadExistingLog() {
    const { data: log, error } = await db.from('workout_logs')
      .select('id, member_id, session_date, notes, note_photo_path, schedule_id')
      .eq('id', logId)
      .single();

    if (error || !log) { showToast('수업일지를 찾을 수 없습니다'); return; }

    memberId = log.member_id;
    logDate = log.session_date || log.log_date;
    scheduleId = log.schedule_id;
    _notePhotoPath = log.note_photo_path;

    document.getElementById('notesInput').value = log.notes || '';

    // 노트 사진 표시
    if (_notePhotoPath) {
      const url = await getSignedUrl(_notePhotoPath);
      if (url) showNotePhotoPreview(url);
    }

    // 운동 목록 로드
    const { data: exs } = await db.from('workout_log_exercises')
      .select('id, exercise_ref_id, exercise_name, part, tool, weight_mode, sets_data, photo_urls, comment, order_index')
      .eq('log_id', logId)
      .order('order_index');

    exercises = (exs || []).map(e => ({
      refId: e.exercise_ref_id,
      name: e.exercise_name,
      part: e.part || '',
      tool: e.tool || '',
      weight_mode: e.weight_mode || 'total',
      sets: e.sets_data || [{ weight: 0, reps: 0 }],
      comment: e.comment || '',
      photos: e.photo_urls || { start: null, end: null }
    }));

    // 회원 이름
    const { data: mem } = await db.from('members').select('name').eq('id', memberId).single();
    memberName = mem?.name || '';
  }

  async function initNewLog() {
    // 회원 이름
    if (memberId) {
      const { data: mem } = await db.from('members').select('name').eq('id', memberId).single();
      memberName = mem?.name || '';
    }

    // 드래프트 복원
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft.memberId === memberId && Date.now() - draft.ts < DRAFT_TTL) {
          exercises = draft.exercises || [];
          logDate = draft.logDate || logDate;
          document.getElementById('notesInput').value = draft.notes || '';
          sessionStorage.removeItem(DRAFT_KEY);
          showToast('이전 작성 내용을 복원했습니다');
          return;
        }
      }
    } catch (_) {}

    exercises = [];
  }

  function updateMetaUI() {
    document.getElementById('hdrMember').textContent = memberName;
    document.getElementById('metaDateChip').textContent = formatDateShort(logDate);
    document.getElementById('hdrMeta').textContent = logDate;
    document.getElementById('metaDate').value = logDate;
  }

  // 날짜 변경
  document.getElementById('metaDateChip').addEventListener('click', () => {
    const inp = document.getElementById('metaDate');
    inp.style.display = inp.style.display === 'none' ? '' : 'none';
    if (inp.style.display !== 'none') inp.focus();
  });

  document.getElementById('metaDate').addEventListener('change', (e) => {
    logDate = e.target.value;
    updateMetaUI();
    e.target.style.display = 'none';
  });


  // ================================================================
  // RENDER EXERCISES
  // ================================================================

  function renderExercises() {
    if (!exercises.length) {
      document.getElementById('exList').innerHTML = '<div class="empty" style="padding:var(--space-8);">운동을 추가해주세요</div>';
      return;
    }

    let html = '';
    exercises.forEach((ex, i) => {
      const wmLabel = ex.weight_mode === 'single' ? '한손' : '총중량';
      const hasStart = !!ex.photos?.start;
      const hasEnd = !!ex.photos?.end;

      html += `<div class="sw-ex-card">
        <div class="sw-ex-head">
          <div class="sw-ex-num">${i + 1}</div>
          <div style="flex:1;">
            <div class="sw-ex-name">${esc(ex.name)}</div>
            <div class="sw-ex-sub">${esc(ex.part)} · ${esc(ex.tool)}</div>
          </div>
          <button class="sw-wm-chip" data-wm="${i}">${wmLabel}</button>
          <button class="sw-ex-del" data-remove="${i}">삭제</button>
        </div>
        <div class="sw-set-header"><span>#</span><span>kg</span><span>횟수</span><span></span></div>`;

      ex.sets.forEach((s, si) => {
        html += `<div class="sw-set-row">
          <div class="sw-set-num">${si + 1}</div>
          <input class="sw-set-input" type="number" step="0.5" min="0" value="${s.weight}" data-set="${i}-${si}-weight">
          <input class="sw-set-input" type="number" min="0" max="999" value="${s.reps}" data-set="${i}-${si}-reps">
          ${ex.sets.length > 1 ? `<button style="background:none;border:none;color:var(--text-tertiary);font-size:16px;cursor:pointer;" data-delset="${i}-${si}">×</button>` : '<div></div>'}
        </div>`;
      });

      html += `<button class="sw-add-set" data-addset="${i}">+ 세트 추가</button>`;

      // 코멘트
      html += `<div class="sw-comment">
        <textarea rows="1" placeholder="코멘트" data-comment="${i}">${esc(ex.comment)}</textarea>
      </div>`;

      // 사진 버튼
      html += `<div class="sw-photo-btns">
        <button class="sw-photo-btn capture" data-photo="${i}">
          <span class="sw-photo-dot ${hasStart ? 'taken' : 'empty'}"></span>시작
          <span class="sw-photo-dot ${hasEnd ? 'taken' : 'empty'}"></span>끝
          사진 촬영
        </button>
        ${hasStart || hasEnd ? `<button class="sw-photo-btn view" data-view-photo="${i}">보기</button>` : ''}
      </div>`;

      html += `</div>`;
    });

    document.getElementById('exList').innerHTML = html;
    bindExerciseEvents();
  }

  function bindExerciseEvents() {
    // 세트 입력
    document.querySelectorAll('[data-set]').forEach(inp => {
      inp.addEventListener('change', () => {
        const [i, si, field] = inp.dataset.set.split('-');
        const val = Math.max(0, parseFloat(inp.value) || 0);
        exercises[parseInt(i)].sets[parseInt(si)][field] = val;
      });
    });

    // 세트 추가
    document.querySelectorAll('[data-addset]').forEach(b => b.addEventListener('click', () => {
      const idx = parseInt(b.dataset.addset);
      const last = exercises[idx].sets.at(-1) || { weight: 0, reps: 0 };
      exercises[idx].sets.push({ ...last });
      renderExercises();
    }));

    // 세트 삭제
    document.querySelectorAll('[data-delset]').forEach(b => b.addEventListener('click', () => {
      const [i, si] = b.dataset.delset.split('-').map(Number);
      if (exercises[i].sets.length > 1) { exercises[i].sets.splice(si, 1); renderExercises(); }
    }));

    // 운동 삭제
    document.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
      const idx = parseInt(b.dataset.remove);
      if (exercises.length > 1 || await showConfirm('운동을 삭제할까요?')) {
        exercises.splice(idx, 1);
        renderExercises();
      }
    }));

    // 중량 모드 토글
    document.querySelectorAll('[data-wm]').forEach(b => b.addEventListener('click', () => {
      const idx = parseInt(b.dataset.wm);
      exercises[idx].weight_mode = exercises[idx].weight_mode === 'single' ? 'total' : 'single';
      renderExercises();
    }));

    // 코멘트
    document.querySelectorAll('[data-comment]').forEach(ta => {
      ta.addEventListener('input', () => { exercises[parseInt(ta.dataset.comment)].comment = ta.value; });
    });

    // 사진 촬영
    document.querySelectorAll('[data-photo]').forEach(b => b.addEventListener('click', () => {
      openPhotoModal(parseInt(b.dataset.photo));
    }));

    // 사진 보기
    document.querySelectorAll('[data-view-photo]').forEach(b => b.addEventListener('click', () => {
      viewPhotos(parseInt(b.dataset.viewPhoto));
    }));
  }


  // ================================================================
  // EXERCISE SEARCH MODAL
  // ================================================================

  document.getElementById('btnAddEx').addEventListener('click', () => openSearch());

  function openSearch() {
    _searchFilter = '';
    document.getElementById('searchInput').value = '';
    buildFilterTabs();
    renderSearchResults();
    openModal('searchModal');
    document.getElementById('searchInput').focus();
  }

  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(renderSearchResults, 150);
  });

  function buildFilterTabs() {
    const parts = [...new Set(_allExerciseDb.map(e => e.part_unified).filter(Boolean))].sort();
    document.getElementById('filterTabs').innerHTML =
      `<button class="chip ${!_searchFilter ? 'active' : ''}" data-sfilter="">전체</button>` +
      parts.map(p => `<button class="chip ${_searchFilter === p ? 'active' : ''}" data-sfilter="${escAttr(p)}">${esc(p)}</button>`).join('');

    document.querySelectorAll('[data-sfilter]').forEach(b => b.addEventListener('click', () => {
      _searchFilter = b.dataset.sfilter;
      buildFilterTabs();
      renderSearchResults();
    }));
  }

  function renderSearchResults() {
    const q = (document.getElementById('searchInput').value || '').trim().toLowerCase().replace(/\s/g, '');

    let list = _allExerciseDb;
    if (_searchFilter) list = list.filter(e => (e.part_unified || '').includes(_searchFilter));
    if (q) list = list.filter(e => {
      const ko = (e.name_ko || '').toLowerCase().replace(/\s/g, '');
      const en = (e.name_en || '').toLowerCase().replace(/\s/g, '');
      return ko.includes(q) || en.includes(q);
    });

    // 그룹: 즐겨찾기 → 내 라이브러리 → 자주 사용 → 전체
    const favs = list.filter(e => _myLibrary.includes(e.id) && _freqMap[e.id]);
    const mine = list.filter(e => _myLibrary.includes(e.id) && !_freqMap[e.id]);
    const freq = list.filter(e => !_myLibrary.includes(e.id) && _freqMap[e.id])
      .sort((a, b) => (_freqMap[b.id] || 0) - (_freqMap[a.id] || 0));
    const rest = list.filter(e => !_myLibrary.includes(e.id) && !_freqMap[e.id]);

    let html = '';
    const renderGroup = (label, items) => {
      if (!items.length) return '';
      let h = `<div class="sr-group-label">${label}</div>`;
      items.slice(0, 30).forEach(ex => {
        const isFav = _myLibrary.includes(ex.id);
        const cnt = _freqMap[ex.id];
        h += `<div class="sr-item" data-select-ex="${escAttr(ex.id)}"
              data-ex-name="${escAttr(ex.name_ko || ex.name_en)}"
              data-ex-part="${escAttr(ex.part_unified || '')}"
              data-ex-tool="${escAttr(ex.tool_unified || '')}">
          <div style="flex:1;min-width:0;">
            <div class="sr-name">${esc(ex.name_ko || ex.name_en)}</div>
            <div class="sr-sub">${esc(ex.part_unified || '')} · ${esc(ex.tool_unified || '')}${cnt ? ` · ${cnt}회 사용` : ''}</div>
          </div>
          <span class="sr-fav ${isFav ? 'active' : ''}" data-fav-id="${escAttr(ex.id)}" data-is-fav="${isFav}">★</span>
        </div>`;
      });
      return h;
    };

    html += renderGroup('내 라이브러리', favs);
    html += renderGroup('내 운동', mine);
    html += renderGroup('자주 사용', freq);
    html += renderGroup('전체', rest);

    document.getElementById('searchResults').innerHTML = html || '<div class="empty">검색 결과가 없습니다</div>';

    // 운동 선택 이벤트
    document.querySelectorAll('[data-select-ex]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.sr-fav')) return; // 즐겨찾기 클릭은 무시
        selectExFromSearch(el);
      });
    });

    // 즐겨찾기 토글
    document.querySelectorAll('.sr-fav').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const exId = el.dataset.favId;
        const isFav = el.dataset.isFav === 'true';
        await toggleFavorite(me.id, exId, isFav);
        renderSearchResults();
      });
    });
  }

  function selectExFromSearch(el) {
    exercises.push({
      refId: el.dataset.selectEx,
      name: el.dataset.exName,
      part: el.dataset.exPart,
      tool: el.dataset.exTool,
      weight_mode: defaultWeightMode(el.dataset.exTool),
      sets: [{ weight: 0, reps: 0 }],
      comment: '',
      photos: { start: null, end: null }
    });
    closeModal('searchModal');
    renderExercises();
    // 스크롤 to bottom
    setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 100);
  }


  // ================================================================
  // PHOTO CAPTURE
  // ================================================================

  function openPhotoModal(exIdx) {
    _photoExIdx = exIdx;
    _photoPoseType = null;
    const ex = exercises[exIdx];

    document.getElementById('photoModalTitle').textContent = `${ex.name} 자세 사진`;
    document.getElementById('photoStep1').style.display = '';
    document.getElementById('photoStep2').style.display = 'none';

    document.getElementById('capStartStatus').textContent = ex.photos?.start ? '촬영 완료' : '미촬영';
    document.getElementById('capStartStatus').className = `photo-pose-status ${ex.photos?.start ? 'taken' : ''}`;
    document.getElementById('capEndStatus').textContent = ex.photos?.end ? '촬영 완료' : '미촬영';
    document.getElementById('capEndStatus').className = `photo-pose-status ${ex.photos?.end ? 'taken' : ''}`;

    openModal('photoModal');
  }

  // Step 1: 시작/끝 선택
  document.querySelectorAll('[data-pose]').forEach(btn => {
    btn.addEventListener('click', () => {
      _photoPoseType = btn.dataset.pose;
      document.getElementById('photoStep1').style.display = 'none';
      document.getElementById('photoStep2').style.display = '';
      document.getElementById('photoSourceLabel').textContent =
        `${_photoPoseType === 'start' ? '시작' : '끝'} 자세`;
    });
  });

  // Step 2: 카메라/갤러리 선택
  document.querySelectorAll('[data-source]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.source === 'camera' ? 'photoInputCamera' : 'photoInputGallery');
      input.click();
    });
  });

  document.getElementById('btnBackToStep1').addEventListener('click', () => {
    document.getElementById('photoStep1').style.display = '';
    document.getElementById('photoStep2').style.display = 'none';
  });

  document.getElementById('photoModalClose').addEventListener('click', () => closeModal('photoModal'));

  // 파일 선택 처리
  ['photoInputCamera', 'photoInputGallery'].forEach(inputId => {
    document.getElementById(inputId).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;

      closeModal('photoModal');
      showToast('사진 업로드 중...');

      // 로그가 없으면 먼저 생성
      if (!logId) {
        const ok = await ensureLog();
        if (!ok) return;
      }

      const ex = exercises[_photoExIdx];
      const exKey = ex.refId || `ex${_photoExIdx}`;
      const path = `member_photos/${memberId}/${logId}/${exKey}/${_photoPoseType}.jpg`;

      // image-utils.js의 압축 + 업로드
      const result = await uploadImage(file, path);

      if (result.error) {
        showToast(result.error);
        return;
      }

      // 상태 업데이트
      if (!ex.photos) ex.photos = { start: null, end: null };
      ex.photos[_photoPoseType] = result.path;

      showToast('사진 업로드 완료');
      renderExercises();
    });
  });


  // ================================================================
  // PHOTO VIEWER
  // ================================================================

  async function viewPhotos(exIdx) {
    const ex = exercises[exIdx];
    if (!ex.photos) return;

    document.getElementById('viewerTitle').textContent = ex.name;

    let html = '';
    for (const [type, label] of [['start', '시작'], ['end', '끝']]) {
      const path = ex.photos[type];
      if (!path) {
        html += `<div style="text-align:center;"><div style="width:160px;height:240px;background:var(--gray-800);border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;color:var(--text-tertiary);">미촬영</div><div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-top:4px;">${label}</div></div>`;
      } else {
        const url = await getSignedUrl(path);
        html += `<div style="text-align:center;"><div style="width:160px;height:240px;border-radius:var(--radius-md);overflow:hidden;">${url ? `<img src="${esc(url)}" style="width:100%;height:100%;object-fit:cover;">` : '<div style="width:100%;height:100%;background:var(--gray-800);display:flex;align-items:center;justify-content:center;color:var(--color-danger);">로드 실패</div>'}</div><div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-top:4px;">${label}</div></div>`;
      }
    }

    document.getElementById('viewerImgs').innerHTML = html;
    document.getElementById('photoViewer').classList.add('open');
  }

  document.getElementById('viewerClose').addEventListener('click', () => {
    document.getElementById('photoViewer').classList.remove('open');
  });


  // ================================================================
  // PT NOTE PHOTO
  // ================================================================

  document.getElementById('btnNotePhoto').addEventListener('click', () => {
    document.getElementById('notePhotoInput').click();
  });

  document.getElementById('notePhotoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    const check = validateImageFile(file);
    if (!check.valid) { showToast(check.error); return; }

    _notePhotoFile = file;
    _notePhotoRemoved = false;
    _notePhotoRotatedBlob = null;

    const url = URL.createObjectURL(file);
    showNotePhotoPreview(url);
  });

  function showNotePhotoPreview(url) {
    document.getElementById('notePhotoImg').src = url;
    document.getElementById('notePhotoPreview').style.display = '';
    document.getElementById('notePhotoUpload').style.display = 'none';
  }

  document.getElementById('btnRemoveNote').addEventListener('click', () => {
    _notePhotoFile = null;
    _notePhotoRemoved = true;
    _notePhotoRotatedBlob = null;
    document.getElementById('notePhotoPreview').style.display = 'none';
    document.getElementById('notePhotoUpload').style.display = '';
    const img = document.getElementById('notePhotoImg');
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  });

  document.getElementById('btnRotateNote').addEventListener('click', async () => {
    const img = document.getElementById('notePhotoImg');
    try {
      const blob = await rotateImageLeft(img.src);
      _notePhotoRotatedBlob = blob;
      const oldUrl = img.src;
      img.src = URL.createObjectURL(blob);
      if (oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
    } catch (e) {
      showToast('회전 실패');
    }
  });


  // ================================================================
  // SAVE SESSION
  // ================================================================

  document.getElementById('btnSave').addEventListener('click', saveSession);

  async function saveSession() {
    // 입력값 동기화
    document.querySelectorAll('[data-set]').forEach(inp => {
      const [i, si, field] = inp.dataset.set.split('-');
      exercises[parseInt(i)].sets[parseInt(si)][field] = Math.max(0, parseFloat(inp.value) || 0);
    });

    if (!exercises.length) { showToast('운동을 추가해주세요'); return; }
    if (!memberId) { showToast('회원 정보가 없습니다'); return; }

    const btn = document.getElementById('btnSave');
    btn.disabled = true;
    btn.textContent = '저장 중...';

    try {
      const notes = document.getElementById('notesInput').value.trim();

      // 1. 로그 저장
      if (logId) {
        const { error } = await db.from('workout_logs').update({
          session_date: logDate,
          notes: notes || null
        }).eq('id', logId);
        if (error) { console.error('Log update error:', error); throw new Error('수업일지 저장에 실패했습니다'); }
      } else {
        const { data: newLog, error } = await db.from('workout_logs').insert({
          trainer_id: me.id,
          member_id: memberId,
          session_date: logDate,
          notes: notes || null,
          schedule_id: scheduleId || null,
          is_noshow: false,
          is_deleted: false
        }).select('id').single();
        if (error) { console.error('Log create error:', error); throw new Error('수업일지 생성에 실패했습니다'); }
        logId = newLog.id;
      }

      // 2. PT 노트 사진 업로드
      await uploadNotePhoto();

      // 3. 운동 목록 (DELETE + INSERT)
      await db.from('workout_log_exercises').delete().eq('log_id', logId);

      const rows = exercises.map((ex, i) => ({
        log_id: logId,
        exercise_ref_id: ex.refId || null,
        exercise_name: ex.name,
        part: ex.part || null,
        tool: ex.tool || null,
        weight_mode: ex.weight_mode || 'total',
        sets_data: ex.sets,
        photo_urls: ex.photos || null,
        comment: ex.comment || null,
        order_index: i
      }));

      const { error: exErr } = await db.from('workout_log_exercises').insert(rows);
      if (exErr) throw new Error('운동 저장 실패: ' + exErr.message);

      // 드래프트 삭제
      sessionStorage.removeItem(DRAFT_KEY);

      showToast('저장 완료');
      setTimeout(() => { location.href = 'trainer-dash.html'; }, 800);

    } catch (e) {
      showToast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '저장';
    }
  }

  async function uploadNotePhoto() {
    // 삭제
    if (_notePhotoRemoved && _notePhotoPath) {
      await deleteImage(_notePhotoPath);
      await db.from('workout_logs').update({ note_photo_path: null }).eq('id', logId);
      _notePhotoPath = null;
      return;
    }

    // 새 파일 또는 회전된 파일
    const fileOrBlob = _notePhotoRotatedBlob || _notePhotoFile;
    if (!fileOrBlob) return;

    const path = `${me.id}/pt-notes/${logId}.jpg`;

    // 기존 삭제
    if (_notePhotoPath) await deleteImage(_notePhotoPath);

    // 압축 + 업로드
    let blob;
    if (fileOrBlob instanceof File) {
      blob = await compressImage(fileOrBlob);
    } else {
      blob = fileOrBlob; // 이미 회전으로 압축된 blob
    }

    const { error } = await db.storage.from('session-photos').upload(path, blob, {
      upsert: true,
      contentType: 'image/jpeg'
    });

    if (error) {
      showToast('노트 사진 업로드 실패');
      return;
    }

    await db.from('workout_logs').update({ note_photo_path: path }).eq('id', logId);
    _notePhotoPath = path;
    _notePhotoFile = null;
    _notePhotoRotatedBlob = null;
  }

  async function ensureLog() {
    if (logId) return true;
    const { data, error } = await db.from('workout_logs').insert({
      trainer_id: me.id,
      member_id: memberId,
      session_date: logDate,
      schedule_id: scheduleId || null,
      is_noshow: false,
      is_deleted: false
    }).select('id').single();

    if (error) { showToast('로그 생성 실패'); return false; }
    logId = data.id;
    return true;
  }


  // ================================================================
  // ROUTINE INTEGRATION
  // ================================================================

  document.getElementById('btnRoutine').addEventListener('click', () => {
    routinePickerOpen({
      trainerId: me.id,
      onSelect: async (exList) => {
        exList.forEach(ex => {
          exercises.push({
            refId: ex.refId,
            name: ex.name,
            part: ex.part,
            tool: ex.tool,
            weight_mode: ex.weight_mode || defaultWeightMode(ex.tool),
            sets: [{ weight: 0, reps: 0 }],
            comment: '',
            photos: { start: null, end: null }
          });
        });
        renderExercises();
        showToast('루틴 불러오기 완료');
      }
    });
  });

  // 운동DB 이동 (드래프트 저장)
  document.getElementById('btnLibrary').addEventListener('click', () => {
    // 현재 상태 드래프트 저장
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      memberId,
      logDate,
      exercises,
      notes: document.getElementById('notesInput').value,
      ts: Date.now()
    }));
    location.href = `exercise-library.html?returnTo=${encodeURIComponent(location.href)}`;
  });

  // 루틴 링크 가져오기
  document.getElementById('btnImportRoutine')?.addEventListener('click', async () => {
    const input = document.getElementById('trainerLinkInput').value.trim();
    if (!input) { showToast('링크를 입력해주세요'); return; }

    const result = await lookupByShareLink(input);
    if (!result) { showToast('유효하지 않은 링크입니다'); return; }

    (result.exercises || []).forEach(ex => {
      exercises.push({
        refId: ex.exercise_ref_id,
        name: ex.name_ko || '운동',
        part: ex.part || '',
        tool: ex.tool || '',
        weight_mode: ex.weight_mode || 'total',
        sets: [{ weight: 0, reps: 0 }],
        comment: '',
        photos: { start: null, end: null }
      });
    });

    document.getElementById('trainerLinkInput').value = '';
    renderExercises();
    showToast('루틴 가져오기 완료');
  });

})();
