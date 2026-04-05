// ============================================================
// VERA GYM v2 — member-app.js
// 회원 뷰 로직 (토큰 기반, 로그인 없음)
// ============================================================

(function () {
  'use strict';

  initDb();

  // ── 상태 ─────────────────────────────────────────────────
  let _memberToken = null;
  let _memberInfo = null;

  // 수업일지 (트레이너 작성)
  let _sessLogs = [];

  // 운동DB
  let _allExerciseDb = [];
  let _myExercises = [];
  let _myFavorites = [];
  let _exToolFilter = '';
  let _exPartFilter = '';
  let _exShowCount = 50;
  let _exSubView = 'exercise';
  let _exLoaded = false;

  // 루틴
  let _routines = [];

  // 운동일지 (회원 작성)
  let _wlogList = [];
  let _wlogExs = [];
  let _wlogEditId = null;
  let _wlogInitialized = false;

  // 피커
  let _pkPartFilter = '';
  let _pkToolFilter = '';
  let _pkMode = 'wlog'; // 'wlog' | 'routine'
  let _pkRoutineId = null;
  let _pkRoutineExCount = 0;

  // 통계
  let _statsLoaded = false;


  // ================================================================
  // INIT
  // ================================================================

  async function init() {
    // 토큰 읽기
    const params = new URLSearchParams(location.search);
    _memberToken = params.get('token') || params.get('t');
    if (_memberToken) {
      sessionStorage.setItem('vg_member_token', _memberToken);
      // URL에서 토큰 제거 (보안: 브라우저 히스토리에 남지 않도록)
      history.replaceState(null, '', location.pathname);
    } else {
      _memberToken = sessionStorage.getItem('vg_member_token');
    }

    if (!_memberToken) { showError(); return; }

    // 회원 정보 조회
    const { data: info, error } = await db.rpc('member_get_by_token', { p_token: _memberToken });
    if (error || !info) { showError(); return; }

    _memberInfo = info;

    // 토큰 만료 체크
    if (info.token_expires_at) {
      const days = Math.ceil((new Date(info.token_expires_at) - Date.now()) / 86400000);
      if (days <= 0) {
        showError();
        return;
      }
      document.getElementById('tokenDaysHdr').textContent = `${days}일 남음`;
      if (days <= 7) document.getElementById('tokenDaysHdr').style.color = 'var(--color-danger)';
    }

    // UI 표시
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('mainContent').style.display = '';

    document.getElementById('memberNameHdr').textContent = `${info.name} 회원님`;
    document.getElementById('trainerInfoHdr').textContent = info.trainer_name ? `트레이너 ${info.trainer_name}` : '';

    // PWA manifest 동적 생성 (토큰 포함 start_url)
    setupManifest();

    // 데이터 로드
    await Promise.all([
      loadPtBanner(),
      loadLogs(),
      loadSchedules()
    ]);
  }

  init();

  function showError() {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('errorScreen').style.display = '';
  }

  function setupManifest() {
    const manifest = {
      name: `베라짐 - ${_memberInfo.name}`,
      short_name: '베라짐',
      start_url: `${location.pathname}?t=${_memberToken}`,
      display: 'standalone',
      background_color: '#f9fafb',
      theme_color: '#22c55e',
      icons: [
        { src: '../icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '../icons/icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = URL.createObjectURL(blob);
    document.head.appendChild(link);
  }


  // ================================================================
  // TAB SWITCHING
  // ================================================================

  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab, btn, onTabSwitch));
  });

  function onTabSwitch(tabId) {
    if (tabId === 'exlib' && !_exLoaded) lazyLoadEx();
    if (tabId === 'wlog' && !_wlogInitialized) wlogInit();
    if (tabId === 'stats' && !_statsLoaded) statsInit();
  }


  // ================================================================
  // PT BANNER
  // ================================================================

  async function loadPtBanner() {
    const { data } = await db.rpc('member_get_pt_products', { p_token: _memberToken });
    if (!data?.length) { document.getElementById('ptBanner').innerHTML = ''; return; }

    const active = data.find(p => p.is_active && p.remaining_sessions > 0);
    if (!active) { document.getElementById('ptBanner').innerHTML = ''; return; }

    const pct = Math.round(((active.total_sessions - active.remaining_sessions) / active.total_sessions) * 100);
    document.getElementById('ptBanner').innerHTML = `
      <div class="pt-banner">
        <div class="pt-banner-row">
          <span class="pt-banner-label">PT 진행률</span>
          <span class="pt-banner-val">${active.total_sessions - active.remaining_sessions} / ${active.total_sessions}회</span>
        </div>
        <div class="pt-bar-track"><div class="pt-bar-fill" style="width:${pct}%;"></div></div>
      </div>`;
  }


  // ================================================================
  // SESSION LOGS (트레이너 작성)
  // ================================================================

  async function loadLogs() {
    const { data, error } = await db.rpc('member_get_logs', { p_token: _memberToken });
    if (error) { showToast('수업 기록을 불러올 수 없습니다'); return; }
    _sessLogs = data || [];

    // 통계
    const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const monthLogs = _sessLogs.filter(l => (l.log_date || '').startsWith(thisMonth));
    const exTypes = new Set();
    _sessLogs.forEach(l => { if (l.exercises) l.exercises.forEach(e => exTypes.add(e.exercise_name)); });

    document.getElementById('statTotal').textContent = _sessLogs.length;
    document.getElementById('statMonth').textContent = monthLogs.length;
    document.getElementById('statExTypes').textContent = exTypes.size;
    document.getElementById('logCount').textContent = `(${_sessLogs.length}건)`;

    // 렌더
    let html = '';
    _sessLogs.forEach((l, i) => {
      const exTags = (l.exercises || []).slice(0, 3)
        .map(e => `<span class="tag tag-accent">${esc(e.exercise_name)}</span>`).join('');
      const moreCount = (l.exercises || []).length - 3;

      html += `<div class="sess-card">
        <div class="sess-head" data-sess-idx="${i}" data-log-id="${escAttr(l.id)}">
          <div style="flex:1;">
            <div class="sess-date">${formatDateShort(l.log_date)}</div>
            <div class="sess-sub">${esc(l.trainer_name || '')}${l.session_number ? ` · ${l.session_number}회차` : ''}</div>
          </div>
          ${l.session_number ? `<span class="sess-num-badge">${l.session_number}회차</span>` : ''}
          <span class="chevron" id="chevron-${i}">›</span>
        </div>
        <div class="sess-body" id="sessBody-${i}">
          ${l.notes ? `<div class="sess-notes">${esc(l.notes)}</div>` : ''}
          <div class="chips gap-1 mb-2">${exTags}${moreCount > 0 ? `<span class="tag tag-muted">+${moreCount}</span>` : ''}</div>
          <div id="sessDetail-${i}"><div class="loading"><div class="spinner"></div></div></div>
        </div>
      </div>`;
    });

    document.getElementById('sessList').innerHTML = html || '<div class="empty">수업 기록이 없습니다</div>';

    // 이벤트
    document.querySelectorAll('.sess-head').forEach(el => {
      el.addEventListener('click', () => toggleSess(parseInt(el.dataset.sessIdx), el.dataset.logId));
    });
  }

  async function toggleSess(i, logId) {
    const body = document.getElementById(`sessBody-${i}`);
    const chevron = document.getElementById(`chevron-${i}`);
    const detail = document.getElementById(`sessDetail-${i}`);

    body.classList.toggle('open');
    chevron.classList.toggle('open');

    if (body.classList.contains('open') && detail.querySelector('.spinner')) {
      // 운동 상세 + 사진 로드
      const [detailRes, photoRes] = await Promise.all([
        db.rpc('member_get_log_detail', { p_token: _memberToken, p_log_id: logId }),
        db.rpc('member_get_log_photos', { p_token: _memberToken, p_log_id: logId })
      ]);

      const exercises = detailRes.data || [];
      const photoMap = {};
      (photoRes.data || []).forEach(p => { photoMap[p.order_index] = p; });

      let html = '';
      exercises.forEach((ex, ei) => {
        const photo = photoMap[ex.order_index];
        html += `<div class="ex-item">
          <div class="ex-item-name">${esc(ex.exercise_name)}</div>
          <div class="ex-item-cat">${esc(ex.part || '')} · ${esc(ex.tool || '')}${ex.weight_mode === 'single' ? ' · 한손' : ''}</div>
          ${ex.sets_data?.length ? `
            <table class="sets-table">
              <thead><tr><th>세트</th><th>중량(kg)</th><th>횟수</th></tr></thead>
              <tbody>${ex.sets_data.map((s, si) => `<tr><td>${si + 1}</td><td>${s.weight || 0}</td><td>${s.reps || 0}</td></tr>`).join('')}</tbody>
            </table>` : ''}
          ${ex.comment ? `<div class="sess-notes" style="margin-top:var(--space-2);">${esc(ex.comment)}</div>` : ''}
          ${photo?.start_path || photo?.end_path ? `
            <button class="mv-photo-btn" data-start="${escAttr(photo.start_path || '')}" data-end="${escAttr(photo.end_path || '')}" data-ex-name="${escAttr(ex.exercise_name)}">자세 사진 보기</button>` : ''}
        </div>`;
      });

      // PT 노트 사진
      const log = _sessLogs[i];
      if (log?.note_photo_path) {
        html += `<div style="margin-top:var(--space-3);">
          <button class="btn btn-sm btn-secondary" data-note-photo="${escAttr(log.note_photo_path)}" data-note-idx="${i}">PT 노트 사진</button>
          <div id="notePhotoArea-${i}" style="margin-top:var(--space-2);"></div>
        </div>`;
      }

      detail.innerHTML = html;

      // 사진 뷰어 이벤트
      detail.querySelectorAll('.mv-photo-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          viewMemberPhotos(btn.dataset.start, btn.dataset.end, btn.dataset.exName);
        });
      });

      // PT 노트 사진 이벤트
      detail.querySelectorAll('[data-note-photo]').forEach(btn => {
        btn.addEventListener('click', () => toggleNotePhotoInline(btn.dataset.noteIdx, btn.dataset.notePhoto));
      });
    }
  }


  // ================================================================
  // PHOTO VIEWER
  // ================================================================

  async function viewMemberPhotos(startPath, endPath, exName) {
    document.getElementById('memberViewerTitle').textContent = exName;

    let html = '';
    const paths = [
      { path: startPath, label: '시작' },
      { path: endPath, label: '끝' }
    ];

    for (const { path, label } of paths) {
      if (!path) {
        html += `<div><div class="mv-photo-slot"><span style="color:var(--text-tertiary);">미촬영</span></div><div class="mv-photo-label">${label}</div></div>`;
        continue;
      }
      const url = await getSignedUrl(path);
      if (url) {
        html += `<div><div class="mv-photo-slot"><img src="${esc(url)}" alt="${esc(label)}"></div><div class="mv-photo-label">${label}</div></div>`;
      } else {
        html += `<div><div class="mv-photo-slot"><span style="color:var(--color-danger);font-size:var(--text-xs);">로드 실패</span></div><div class="mv-photo-label">${label}</div></div>`;
      }
    }

    document.getElementById('memberViewerImgs').innerHTML = html;
    document.getElementById('memberPhotoViewer').classList.add('open');
  }

  document.getElementById('viewerCloseBtn').addEventListener('click', () => {
    document.getElementById('memberPhotoViewer').classList.remove('open');
  });

  async function toggleNotePhotoInline(idx, path) {
    const area = document.getElementById(`notePhotoArea-${idx}`);
    if (area.innerHTML) { area.innerHTML = ''; return; }

    const url = await getSignedUrl(path);
    if (url) {
      area.innerHTML = `<img src="${esc(url)}" style="width:100%;max-height:55dvh;object-fit:contain;border-radius:var(--radius-md);">
        <button class="btn btn-sm btn-ghost mt-2" onclick="document.getElementById('notePhotoArea-${idx}').innerHTML=''">닫기</button>`;
    } else {
      area.innerHTML = '<div class="card-sub">사진을 불러올 수 없습니다</div>';
    }
  }


  // ================================================================
  // SCHEDULES
  // ================================================================

  async function loadSchedules() {
    const { data } = await db.rpc('member_get_schedules', { p_token: _memberToken });
    const scheds = data || [];

    const now = new Date();
    const todayStr = formatDate(now);
    const upcoming = scheds.filter(s => s.sched_date >= todayStr && s.status === 'scheduled')
      .sort((a, b) => a.sched_date.localeCompare(b.sched_date));
    const past = scheds.filter(s => s.sched_date < todayStr || s.status !== 'scheduled')
      .sort((a, b) => b.sched_date.localeCompare(a.sched_date));

    const days = ['일','월','화','수','목','금','토'];
    const renderSched = (s) => {
      const d = new Date(s.sched_date + 'T00:00:00');
      const isDone = s.status === 'completed' || s.status === 'noshow';
      return `<div class="sched-card">
        <div class="sched-date-block">
          <div class="sched-month">${d.getMonth()+1}월</div>
          <div class="sched-day">${d.getDate()}</div>
          <div class="sched-weekday">${days[d.getDay()]}</div>
        </div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:2px;">
            <span class="sched-type-badge sched-type-${esc(s.type)}">${esc(s.type)}</span>
            <span class="sched-status ${isDone ? 'done' : 'upcoming'}">${isDone ? (s.status === 'noshow' ? '노쇼' : '완료') : '예정'}</span>
          </div>
          <div class="sched-time">${formatTime(s.start_time)}${s.end_time ? ' - ' + formatTime(s.end_time) : ''}</div>
          <div class="sched-trainer">${esc(s.trainer_name || '')}</div>
        </div>
      </div>`;
    };

    let html = '';
    if (upcoming.length) {
      html += `<div class="sec-header"><span class="sec-title" style="font-size:var(--text-sm)">예정</span></div>`;
      upcoming.forEach(s => html += renderSched(s));
    }
    if (past.length) {
      html += `<div class="sec-header mt-3"><span class="sec-title" style="font-size:var(--text-sm);color:var(--text-tertiary);">지난 일정</span></div>`;
      past.slice(0, 20).forEach(s => html += renderSched(s));
    }

    document.getElementById('schedList').innerHTML = html || '<div class="empty">일정이 없습니다</div>';
  }


  // ================================================================
  // EXERCISE DB
  // ================================================================

  async function lazyLoadEx() {
    _exLoaded = true;
    await Promise.all([_loadAllExercises(), _loadMyExercises()]);
    exBuildFilters();
    exRenderList();
  }

  async function _loadAllExercises() {
    // sessionStorage 캐시
    try {
      const raw = sessionStorage.getItem('vg_exdb_cache_v2');
      if (raw) {
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts < 5 * 60 * 1000 && data?.length) { _allExerciseDb = data; return; }
      }
    } catch (_) {}

    const { data } = await db.rpc('get_all_exercise_refs');
    _allExerciseDb = data || [];
    try { sessionStorage.setItem('vg_exdb_cache_v2', JSON.stringify({ ts: Date.now(), data: _allExerciseDb })); } catch (_) {}
  }

  async function _loadMyExercises() {
    const { data } = await db.rpc('member_get_my_exercises', { p_token: _memberToken });
    if (!data) return;
    _myExercises = (data.my_exercises || []).map(e => e.exercise_ref_id);
    _myFavorites = (data.favorites || []).map(e => e.exercise_ref_id);
    document.getElementById('myExCount').textContent = `(${_myExercises.length})`;
  }

  // 서브탭
  document.querySelectorAll('[data-ex-sub]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-ex-sub]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _exSubView = btn.dataset.exSub;

      document.getElementById('exSubExercise').style.display = (_exSubView === 'exercise' || _exSubView === 'mine') ? '' : 'none';
      document.getElementById('exSubRoutine').style.display = _exSubView === 'routine' ? '' : 'none';

      if (_exSubView === 'routine') rtLoadRoutines();
      else { _exShowCount = 50; exRenderList(); }
    });
  });

  function exBuildFilters() {
    const tools = [...new Set(_allExerciseDb.map(e => e.tool_unified).filter(Boolean))].sort();
    const parts = [...new Set(_allExerciseDb.map(e => e.part_unified).filter(Boolean))].sort();

    document.getElementById('exToolChips').innerHTML =
      `<button class="chip ${!_exToolFilter ? 'active' : ''}" data-extool="">전체</button>` +
      tools.map(t => `<button class="chip ${_exToolFilter === t ? 'active' : ''}" data-extool="${escAttr(t)}">${esc(t)}</button>`).join('');

    document.getElementById('exPartChips').innerHTML =
      `<button class="chip ${!_exPartFilter ? 'active' : ''}" data-expart="">전체</button>` +
      parts.map(p => `<button class="chip ${_exPartFilter === p ? 'active' : ''}" data-expart="${escAttr(p)}">${esc(p)}</button>`).join('');

    document.querySelectorAll('[data-extool]').forEach(b => b.addEventListener('click', () => { _exToolFilter = b.dataset.extool; _exShowCount = 50; exBuildFilters(); exRenderList(); }));
    document.querySelectorAll('[data-expart]').forEach(b => b.addEventListener('click', () => { _exPartFilter = b.dataset.expart; _exShowCount = 50; exBuildFilters(); exRenderList(); }));
  }

  document.getElementById('exSearchInput').addEventListener('input', debounce(() => { _exShowCount = 50; exRenderList(); }, 200));
  document.getElementById('exBtnX').addEventListener('click', () => { document.getElementById('exSearchInput').value = ''; _exShowCount = 50; exRenderList(); });

  function exRenderList() {
    const q = (document.getElementById('exSearchInput').value || '').trim().toLowerCase().replace(/\s/g, '');
    let list = _allExerciseDb;

    // mine 필터
    if (_exSubView === 'mine') list = list.filter(e => _myExercises.includes(e.id));

    if (_exToolFilter) list = list.filter(e => (e.tool_unified || '') === _exToolFilter);
    if (_exPartFilter) list = list.filter(e => (e.part_unified || '').includes(_exPartFilter));
    if (q) list = list.filter(e => {
      const ko = (e.name_ko || '').toLowerCase().replace(/\s/g, '');
      const en = (e.name_en || '').toLowerCase().replace(/\s/g, '');
      return ko.includes(q) || en.includes(q);
    });

    // 즐겨찾기 우선
    list.sort((a, b) => {
      const af = _myFavorites.includes(a.id) ? 0 : 1;
      const bf = _myFavorites.includes(b.id) ? 0 : 1;
      return af - bf;
    });

    document.getElementById('exStatBar').textContent = `${list.length}개`;

    const shown = list.slice(0, _exShowCount);
    let html = '';
    shown.forEach(ex => {
      const isMine = _myExercises.includes(ex.id);
      html += `<div class="ex-card" data-ex-id="${escAttr(ex.id)}">
        <div class="ex-card-row">
          ${ex.image_url ? `<img class="ex-thumb" src="${esc(ex.image_url)}" loading="lazy" onerror="this.style.display='none'">` : ''}
          <div style="flex:1;min-width:0;">
            <div class="ex-name">${esc(ex.name_ko || ex.name_en)}</div>
            <div class="ex-en-name">${esc(ex.name_en || '')}</div>
            <div class="chips gap-1 mt-2">
              ${ex.tool_unified ? `<span class="tag tag-accent">${esc(ex.tool_unified)}</span>` : ''}
              ${ex.part_unified ? `<span class="tag tag-muted">${esc(ex.part_unified)}</span>` : ''}
              ${isMine ? `<span class="tag tag-accent" style="font-weight:var(--font-bold);">MY</span>` : ''}
            </div>
          </div>
          <button class="ex-btn-add ${isMine ? 'added' : ''}" data-toggle-my="${escAttr(ex.id)}">${isMine ? '−' : '+'}</button>
        </div>
      </div>`;
    });

    if (list.length > _exShowCount) {
      html += `<button class="ex-btn-more" id="exMoreBtn">더보기 (+50)</button>`;
    }

    document.getElementById('exList').innerHTML = html || '<div class="empty">운동이 없습니다</div>';

    document.getElementById('exMoreBtn')?.addEventListener('click', () => { _exShowCount += 50; exRenderList(); });
  }

  // 이벤트 위임
  document.getElementById('exList').addEventListener('click', async (e) => {
    const toggleBtn = e.target.closest('[data-toggle-my]');
    if (toggleBtn) {
      e.stopPropagation();
      const exId = toggleBtn.dataset.toggleMy;
      const isMine = _myExercises.includes(exId);
      await db.rpc('member_toggle_my_exercise', { p_token: _memberToken, p_exercise_ref_id: exId });
      if (isMine) _myExercises = _myExercises.filter(id => id !== exId);
      else _myExercises.push(exId);
      document.getElementById('myExCount').textContent = `(${_myExercises.length})`;
      exRenderList();
      return;
    }

    const card = e.target.closest('.ex-card');
    if (card) exOpenDetail(card.dataset.exId);
  });

  function exOpenDetail(id) {
    const ex = _allExerciseDb.find(e => e.id === id);
    if (!ex) return;

    let html = `<button class="ex-modal-close" id="exModalCloseBtn">&times;</button>`;
    if (ex.image_url) html += `<img class="ex-modal-img" src="${esc(ex.image_url)}" onerror="this.style.display='none'">`;
    html += `<div class="ex-modal-name">${esc(ex.name_ko || ex.name_en)}</div>`;
    html += `<div class="ex-modal-en">${esc(ex.name_en || '')}</div>`;
    html += `<div class="chips gap-1 mb-3">
      ${ex.tool_unified ? `<span class="tag tag-accent">${esc(ex.tool_unified)}</span>` : ''}
      ${ex.part_unified ? `<span class="tag tag-muted">${esc(ex.part_unified)}</span>` : ''}
    </div>`;

    if (ex.primary_muscle) {
      html += `<div style="font-size:var(--text-sm);font-weight:var(--font-semibold);margin-bottom:var(--space-2);">근육 정보</div>`;
      html += `<div class="chips gap-1">`;
      html += `<span class="tag tag-accent">${esc(ex.primary_muscle)}</span>`;
      if (ex.synergist_1) html += `<span class="tag tag-muted">${esc(ex.synergist_1)}</span>`;
      if (ex.synergist_2) html += `<span class="tag tag-muted">${esc(ex.synergist_2)}</span>`;
      html += `</div>`;
    }

    document.getElementById('exModalBody').innerHTML = html;
    document.getElementById('exModalBg').classList.add('open');

    document.getElementById('exModalCloseBtn').addEventListener('click', () => {
      document.getElementById('exModalBg').classList.remove('open');
    });
  }

  document.getElementById('exModalBg').addEventListener('click', (e) => {
    if (e.target === document.getElementById('exModalBg')) {
      document.getElementById('exModalBg').classList.remove('open');
    }
  });


  // ================================================================
  // ROUTINES
  // ================================================================

  async function rtLoadRoutines() {
    const { data } = await db.rpc('member_get_routines', { p_token: _memberToken });
    _routines = data || [];
    rtRenderRoutines();
  }

  async function rtRenderRoutines() {
    if (!_routines.length) {
      document.getElementById('routineList').innerHTML = '<div class="empty">저장된 루틴이 없습니다</div>';
      return;
    }

    // 각 루틴의 운동 목록 로드
    const enriched = await Promise.all(_routines.map(async r => {
      const { data } = await db.rpc('member_get_routine_detail', { p_token: _memberToken, p_routine_id: r.id });
      return { ...r, exs: data || [] };
    }));

    let html = '';
    enriched.forEach(r => {
      html += `<div class="rt-card">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div class="rt-card-name">${esc(r.name)}</div>
          <button class="btn btn-sm btn-danger" data-rt-del="${escAttr(r.id)}" data-rt-name="${escAttr(r.name)}">삭제</button>
        </div>
        <div class="rt-card-exs">
          ${r.exs.map(e => `<span class="rt-card-ex-chip">${esc(e.name_ko || e.exercise_name || '운동')}</span>`).join('')}
        </div>
        <div class="rt-card-info">${r.exs.length}개 운동 · ${formatDateDot(r.created_at)}</div>
        <div style="display:flex;gap:var(--space-2);margin-top:var(--space-2);">
          <button class="btn btn-sm btn-secondary" data-rt-add-ex="${escAttr(r.id)}" data-rt-name="${escAttr(r.name)}" data-rt-count="${r.exs.length}">운동 추가</button>
          ${r.share_code ? `<button class="btn btn-sm btn-ghost" data-rt-copy="${escAttr(r.id)}">링크 복사</button>` : ''}
        </div>
      </div>`;
    });

    document.getElementById('routineList').innerHTML = html;
  }

  document.getElementById('routineList').addEventListener('click', async (e) => {
    const delBtn = e.target.closest('[data-rt-del]');
    if (delBtn) {
      if (!await showConfirm(`"${delBtn.dataset.rtName}" 루틴을 삭제할까요?`, { danger: true })) return;
      await db.rpc('member_delete_routine', { p_token: _memberToken, p_routine_id: delBtn.dataset.rtDel });
      _routines = _routines.filter(r => r.id !== delBtn.dataset.rtDel);
      rtRenderRoutines();
      showToast('삭제 완료');
      return;
    }

    const addBtn = e.target.closest('[data-rt-add-ex]');
    if (addBtn) {
      _pkMode = 'routine';
      _pkRoutineId = addBtn.dataset.rtAddEx;
      _pkRoutineExCount = parseInt(addBtn.dataset.rtCount) || 0;
      document.getElementById('pkHeaderTitle').textContent = `"${addBtn.dataset.rtName}" 운동 추가`;
      wlogOpenExPicker();
      return;
    }

    const copyBtn = e.target.closest('[data-rt-copy]');
    if (copyBtn) {
      await copyShareLink(copyBtn.dataset.rtCopy, 'member_routines');
    }
  });

  document.getElementById('rtNewBtn').addEventListener('click', async () => {
    const name = prompt('루틴 이름을 입력하세요');
    if (!name?.trim()) return;
    const { data } = await db.rpc('member_save_routine', {
      p_token: _memberToken,
      p_name: name.trim(),
      p_exercises: []
    });
    if (data) {
      showToast('루틴 생성 완료');
      await rtLoadRoutines();
    }
  });

  // 루틴 가져오기
  document.getElementById('btnMemberImport')?.addEventListener('click', async () => {
    const input = document.getElementById('memberLinkInput').value.trim();
    if (!input) { showToast('링크를 입력해주세요'); return; }

    const result = await lookupByShareLink(input);
    if (!result) { showToast('유효하지 않은 링크입니다'); return; }

    const exs = (result.exercises || []).map(e => ({
      refId: e.exercise_ref_id,
      name: e.name_ko,
      part: e.part,
      tool: e.tool,
      weight_mode: e.weight_mode
    }));

    const { data } = await db.rpc('member_save_routine', {
      p_token: _memberToken,
      p_name: result.routine_name || '가져온 루틴',
      p_exercises: exs
    });

    if (data) {
      showToast('루틴 가져오기 완료');
      document.getElementById('memberLinkInput').value = '';
      await rtLoadRoutines();
    }
  });


  // ================================================================
  // WORKOUT LOG (회원 작성)
  // ================================================================

  function wlogInit() {
    _wlogInitialized = true;
    wlogLoadList();
  }

  async function wlogLoadList() {
    const { data } = await db.rpc('member_get_workout_logs', { p_token: _memberToken });
    _wlogList = data || [];
    document.getElementById('wlogCount').textContent = `(${_wlogList.length}건)`;
    wlogRenderList();
  }

  function wlogRenderList() {
    let html = '';
    _wlogList.forEach((l, i) => {
      html += `<div class="wlog-card" data-wlog-idx="${i}" data-wlog-id="${escAttr(l.id)}">
        <div class="wlog-card-date">${formatDateShort(l.log_date)}</div>
        <div class="wlog-card-title">${esc(l.title || '운동일지')}</div>
        <div class="wlog-card-sub">${l.exercise_count || 0}개 운동</div>
        <span class="wlog-card-arrow" id="wlogArrow-${i}">›</span>
        <div class="wlog-detail" id="wlogDetail-${i}"></div>
      </div>`;
    });
    document.getElementById('wlogList').innerHTML = html || '<div class="empty">작성한 운동일지가 없습니다</div>';
  }

  document.getElementById('wlogList').addEventListener('click', (e) => {
    const card = e.target.closest('.wlog-card');
    if (!card) return;
    const idx = parseInt(card.dataset.wlogIdx);
    wlogToggleDetail(idx, card.dataset.wlogId);
  });

  async function wlogToggleDetail(idx, logId) {
    const detail = document.getElementById(`wlogDetail-${idx}`);
    const arrow = document.getElementById(`wlogArrow-${idx}`);
    detail.classList.toggle('open');
    arrow.classList.toggle('open');

    if (detail.classList.contains('open') && !detail.innerHTML) {
      const { data } = await db.rpc('member_get_workout_log_detail', { p_token: _memberToken, p_log_id: logId });
      const exs = data || [];

      let html = '';
      exs.forEach(ex => {
        html += `<div class="ex-item">
          <div class="ex-item-name">${esc(ex.exercise_name)}</div>
          ${ex.sets_data?.length ? `
            <table class="sets-table"><thead><tr><th>세트</th><th>kg</th><th>횟수</th></tr></thead>
            <tbody>${ex.sets_data.map((s, si) => `<tr><td>${si+1}</td><td>${s.weight||0}</td><td>${s.reps||0}</td></tr>`).join('')}</tbody></table>` : ''}
          ${ex.comment ? `<div class="card-sub mt-2">${esc(ex.comment)}</div>` : ''}
        </div>`;
      });

      html += `<div style="display:flex;gap:var(--space-2);margin-top:var(--space-3);">
        <button class="btn btn-sm btn-ghost" data-wlog-edit="${escAttr(logId)}">수정</button>
        <button class="btn btn-sm btn-danger" data-wlog-del="${escAttr(logId)}" data-wlog-del-idx="${idx}">삭제</button>
      </div>`;

      detail.innerHTML = html;

      detail.querySelector('[data-wlog-edit]')?.addEventListener('click', () => wlogEdit(logId));
      detail.querySelector('[data-wlog-del]')?.addEventListener('click', async () => {
        if (!await showConfirm('운동일지를 삭제할까요?', { danger: true })) return;
        const { data: ok } = await db.rpc('member_delete_workout_log', { p_token: _memberToken, p_log_id: logId });
        if (ok) {
          _wlogList.splice(idx, 1);
          wlogRenderList();
          showToast('삭제 완료');
        }
      });
    }
  }

  // 새 일지 작성
  document.getElementById('btnWlogNew').addEventListener('click', () => wlogStartNew());

  function wlogStartNew() {
    _wlogEditId = null;
    _wlogExs = [];
    document.getElementById('wlogWriteTitle').textContent = '운동일지 작성';
    document.getElementById('wlogDate').value = formatDate(new Date());
    document.getElementById('wlogTitle').value = '';
    document.getElementById('wlogNotes').value = '';
    document.getElementById('wlogListView').style.display = 'none';
    document.getElementById('wlogWriteView').style.display = '';
    wlogRenderExList();
  }

  async function wlogEdit(logId) {
    _wlogEditId = logId;
    const log = _wlogList.find(l => l.id === logId);
    const { data } = await db.rpc('member_get_workout_log_detail', { p_token: _memberToken, p_log_id: logId });

    _wlogExs = (data || []).map(ex => ({
      refId: ex.exercise_ref_id,
      name: ex.exercise_name,
      part: ex.part || '',
      tool: ex.tool || '',
      weight_mode: ex.weight_mode || 'total',
      sets: ex.sets_data || [{ weight: 0, reps: 0 }],
      comment: ex.comment || ''
    }));

    document.getElementById('wlogWriteTitle').textContent = '운동일지 수정';
    document.getElementById('wlogDate').value = log?.log_date || formatDate(new Date());
    document.getElementById('wlogTitle').value = log?.title || '';
    document.getElementById('wlogNotes').value = log?.notes || '';
    document.getElementById('wlogListView').style.display = 'none';
    document.getElementById('wlogWriteView').style.display = '';
    wlogRenderExList();
  }

  document.getElementById('wlogCancelBtn').addEventListener('click', async () => {
    if (_wlogExs.length > 0 && !await showConfirm('작성을 취소할까요? 내용이 사라져요.')) return;
    document.getElementById('wlogWriteView').style.display = 'none';
    document.getElementById('wlogListView').style.display = '';
  });

  function wlogRenderExList() {
    if (!_wlogExs.length) {
      document.getElementById('wlogExList').innerHTML = '<div class="empty" style="padding:var(--space-4);">운동을 추가해주세요</div>';
      return;
    }

    let html = '';
    _wlogExs.forEach((ex, i) => {
      const wmLabel = ex.weight_mode === 'single' ? '한손' : '총중량';
      html += `<div class="wlog-ex-card">
        <div class="wlog-ex-head">
          <div class="wlog-ex-order">${i + 1}</div>
          <div style="flex:1;">
            <div class="wlog-ex-name">${esc(ex.name)}</div>
            <div class="wlog-ex-sub">${esc(ex.part)} · ${esc(ex.tool)}</div>
          </div>
          <button class="wlog-wm-chip ${ex.weight_mode === 'single' ? 'wlog-wm-single' : 'wlog-wm-total'}" data-wm-idx="${i}">${wmLabel}</button>
          <button class="wlog-ex-del" data-del-idx="${i}">삭제</button>
        </div>
        <div class="wlog-set-header"><span>#</span><span>kg</span><span>횟수</span><span></span></div>`;

      ex.sets.forEach((s, si) => {
        html += `<div class="wlog-set-row">
          <div class="wlog-set-num">${si + 1}</div>
          <input class="wlog-set-input" type="number" step="0.5" min="0" value="${s.weight}" data-set="${i}-${si}-weight">
          <input class="wlog-set-input" type="number" min="0" max="999" value="${s.reps}" data-set="${i}-${si}-reps">
          ${ex.sets.length > 1 ? `<button class="wlog-ex-del" style="font-size:14px;" data-delset="${i}-${si}">×</button>` : '<div></div>'}
        </div>`;
      });

      html += `<button class="wlog-add-set" data-addset="${i}">+ 세트 추가</button>`;

      html += `<div style="padding:0 var(--space-3) var(--space-2);">
        <textarea class="field-textarea" rows="1" placeholder="코멘트" style="font-size:var(--text-sm);min-height:36px;" data-comment="${i}">${esc(ex.comment)}</textarea>
      </div></div>`;
    });

    document.getElementById('wlogExList').innerHTML = html;

    // 이벤트
    document.querySelectorAll('[data-wm-idx]').forEach(b => b.addEventListener('click', () => {
      const idx = parseInt(b.dataset.wmIdx);
      _wlogExs[idx].weight_mode = _wlogExs[idx].weight_mode === 'single' ? 'total' : 'single';
      wlogRenderExList();
    }));
    document.querySelectorAll('[data-del-idx]').forEach(b => b.addEventListener('click', () => {
      _wlogExs.splice(parseInt(b.dataset.delIdx), 1);
      wlogRenderExList();
    }));
    document.querySelectorAll('[data-addset]').forEach(b => b.addEventListener('click', () => {
      const idx = parseInt(b.dataset.addset);
      const last = _wlogExs[idx].sets.at(-1) || { weight: 0, reps: 0 };
      _wlogExs[idx].sets.push({ ...last });
      wlogRenderExList();
    }));
    document.querySelectorAll('[data-delset]').forEach(b => b.addEventListener('click', () => {
      const [i, si] = b.dataset.delset.split('-').map(Number);
      if (_wlogExs[i].sets.length > 1) { _wlogExs[i].sets.splice(si, 1); wlogRenderExList(); }
    }));
    document.querySelectorAll('[data-set]').forEach(inp => {
      inp.addEventListener('change', () => {
        const [i, si, field] = inp.dataset.set.split('-');
        const val = parseFloat(inp.value) || 0;
        _wlogExs[parseInt(i)].sets[parseInt(si)][field] = Math.max(0, val);
      });
    });
    document.querySelectorAll('[data-comment]').forEach(ta => {
      ta.addEventListener('input', () => { _wlogExs[parseInt(ta.dataset.comment)].comment = ta.value; });
    });
  }

  // 운동 추가 버튼
  document.getElementById('wlogAddExBtn').addEventListener('click', () => {
    _pkMode = 'wlog';
    document.getElementById('pkHeaderTitle').textContent = '운동 추가';
    document.getElementById('pkHeaderSub').textContent = '';
    wlogOpenExPicker();
  });

  // 루틴 불러오기 버튼
  document.getElementById('wlogLoadRoutineBtn').addEventListener('click', wlogOpenRoutinePicker);

  // 저장
  document.getElementById('wlogSaveBtn').addEventListener('click', wlogSave);

  async function wlogSave() {
    // 입력값 동기화
    document.querySelectorAll('[data-set]').forEach(inp => {
      const [i, si, field] = inp.dataset.set.split('-');
      _wlogExs[parseInt(i)].sets[parseInt(si)][field] = parseFloat(inp.value) || 0;
    });

    if (!_wlogExs.length) { showToast('운동을 추가해주세요'); return; }

    const btn = document.getElementById('wlogSaveBtn');
    btn.disabled = true;
    btn.textContent = '저장 중...';

    const payload = {
      p_token: _memberToken,
      p_log_date: document.getElementById('wlogDate').value || formatDate(new Date()),
      p_title: document.getElementById('wlogTitle').value.trim() || null,
      p_notes: document.getElementById('wlogNotes').value.trim() || null,
      p_exercises: _wlogExs.map(ex => ({
        exercise_ref_id: ex.refId,
        exercise_name: ex.name,
        part: ex.part,
        tool: ex.tool,
        weight_mode: ex.weight_mode,
        sets_data: ex.sets,
        comment: ex.comment || null
      }))
    };

    let result;
    if (_wlogEditId) {
      result = await db.rpc('member_update_workout_log', { ...payload, p_log_id: _wlogEditId });
    } else {
      result = await db.rpc('member_save_workout_log', payload);
    }

    btn.disabled = false;
    btn.textContent = '저장';

    if (result.data) {
      showToast(_wlogEditId ? '수정 완료' : '저장 완료');
      document.getElementById('wlogWriteView').style.display = 'none';
      document.getElementById('wlogListView').style.display = '';
      await wlogLoadList();
    } else {
      showToast('저장 실패');
    }
  }


  // ================================================================
  // EXERCISE PICKER (운동 추가 / 루틴 운동 추가)
  // ================================================================

  function wlogOpenExPicker() {
    _pkPartFilter = '';
    _pkToolFilter = '';
    document.getElementById('wlogPickerSearch').value = '';
    pkBuildChips();
    wlogRenderPicker();
    document.getElementById('wlogPickerBg').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  document.getElementById('pkCloseBtn').addEventListener('click', () => {
    document.getElementById('wlogPickerBg').classList.remove('open');
    document.body.style.overflow = '';
    if (_pkMode === 'routine') rtLoadRoutines();
  });

  document.getElementById('wlogPickerSearch').addEventListener('input', debounce(wlogRenderPicker, 200));
  document.getElementById('pkBtnX').addEventListener('click', () => { document.getElementById('wlogPickerSearch').value = ''; wlogRenderPicker(); });

  function pkBuildChips() {
    const parts = [...new Set(_allExerciseDb.map(e => e.part_unified).filter(Boolean))].sort();
    const tools = [...new Set(_allExerciseDb.map(e => e.tool_unified).filter(Boolean))].sort();

    document.getElementById('pkPartChips').innerHTML =
      `<button class="chip ${!_pkPartFilter ? 'active' : ''}" data-pkpart="">전체</button>` +
      parts.map(p => `<button class="chip ${_pkPartFilter === p ? 'active' : ''}" data-pkpart="${escAttr(p)}">${esc(p)}</button>`).join('');

    document.getElementById('pkToolChips').innerHTML =
      `<button class="chip ${!_pkToolFilter ? 'active' : ''}" data-pktool="">전체</button>` +
      tools.map(t => `<button class="chip ${_pkToolFilter === t ? 'active' : ''}" data-pktool="${escAttr(t)}">${esc(t)}</button>`).join('');

    document.querySelectorAll('[data-pkpart]').forEach(b => b.addEventListener('click', () => { _pkPartFilter = b.dataset.pkpart; pkBuildChips(); wlogRenderPicker(); }));
    document.querySelectorAll('[data-pktool]').forEach(b => b.addEventListener('click', () => { _pkToolFilter = b.dataset.pktool; pkBuildChips(); wlogRenderPicker(); }));
  }

  function wlogRenderPicker() {
    const q = (document.getElementById('wlogPickerSearch').value || '').trim().toLowerCase().replace(/\s/g, '');
    let list = _allExerciseDb;

    if (_pkPartFilter) list = list.filter(e => (e.part_unified || '').includes(_pkPartFilter));
    if (_pkToolFilter) list = list.filter(e => (e.tool_unified || '') === _pkToolFilter);
    if (q) list = list.filter(e => {
      const ko = (e.name_ko || '').toLowerCase().replace(/\s/g, '');
      const en = (e.name_en || '').toLowerCase().replace(/\s/g, '');
      return ko.includes(q) || en.includes(q);
    });

    // 내 운동 우선, 즐겨찾기 우선
    list.sort((a, b) => {
      const am = _myExercises.includes(a.id) ? 0 : 1;
      const bm = _myExercises.includes(b.id) ? 0 : 1;
      if (am !== bm) return am - bm;
      const af = _myFavorites.includes(a.id) ? 0 : 1;
      const bf = _myFavorites.includes(b.id) ? 0 : 1;
      return af - bf;
    });

    document.getElementById('pkStat').textContent = `${list.length}개`;

    const shown = list.slice(0, 50);
    let html = '';
    shown.forEach(ex => {
      const alreadyAdded = _pkMode === 'wlog' && _wlogExs.some(e => e.refId === ex.id);
      html += `<div class="pk-card">
        ${ex.image_url ? `<img class="pk-thumb" src="${esc(ex.image_url)}" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div style="flex:1;min-width:0;">
          <div class="pk-name">${esc(ex.name_ko || ex.name_en)}</div>
          <div class="chips gap-1 mt-2">
            ${ex.tool_unified ? `<span class="tag tag-accent">${esc(ex.tool_unified)}</span>` : ''}
            ${ex.part_unified ? `<span class="tag tag-muted">${esc(ex.part_unified)}</span>` : ''}
          </div>
        </div>
        <button class="pk-add ${alreadyAdded ? 'added' : ''}" data-pk-pick="${escAttr(ex.id)}"
          data-pk-name="${escAttr(ex.name_ko || ex.name_en)}"
          data-pk-part="${escAttr(ex.part_unified || '')}"
          data-pk-tool="${escAttr(ex.tool_unified || '')}"
          ${alreadyAdded ? 'disabled' : ''}>${alreadyAdded ? '✓' : '+'}</button>
      </div>`;
    });

    document.getElementById('wlogPickerList').innerHTML = html || '<div class="empty">검색 결과가 없습니다</div>';
  }

  document.getElementById('wlogPickerList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pk-pick]');
    if (!btn || btn.disabled) return;

    const exId = btn.dataset.pkPick;
    const exName = btn.dataset.pkName;
    const part = btn.dataset.pkPart;
    const tool = btn.dataset.pkTool;

    if (_pkMode === 'wlog') {
      _wlogExs.push({
        refId: exId, name: exName, part, tool,
        weight_mode: defaultWeightMode(tool),
        sets: [{ weight: 0, reps: 0 }],
        comment: ''
      });
      btn.textContent = '✓';
      btn.disabled = true;
      btn.classList.add('added');
      wlogRenderExList();
    }

    if (_pkMode === 'routine') {
      const { data } = await db.rpc('member_append_routine_exercise', {
        p_token: _memberToken,
        p_routine_id: _pkRoutineId,
        p_exercise_ref_id: exId,
        p_name_ko: exName,
        p_part: part,
        p_tool: tool,
        p_weight_mode: defaultWeightMode(tool),
        p_order_index: _pkRoutineExCount
      });
      if (data) {
        _pkRoutineExCount++;
        btn.textContent = '✓';
        btn.disabled = true;
        btn.classList.add('added');
        showToast(`"${exName}" 추가 완료`);
      }
    }
  });


  // ================================================================
  // ROUTINE PICKER (운동일지에 루틴 불러오기)
  // ================================================================

  async function wlogOpenRoutinePicker() {
    const { data } = await db.rpc('member_get_routines', { p_token: _memberToken });
    const routines = data || [];

    let html = '';
    if (!routines.length) {
      html = '<div class="empty">저장된 루틴이 없습니다</div>';
    } else {
      for (const r of routines) {
        html += `<div class="card" style="cursor:pointer;" data-rt-load="${escAttr(r.id)}">
          <div class="card-name">${esc(r.name)}</div>
          <div class="card-sub">${formatDateDot(r.created_at)}</div>
        </div>`;
      }
    }

    document.getElementById('wlogRtPickerList').innerHTML = html;
    document.getElementById('wlogRtPickerBg').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  document.getElementById('rtPickerCloseBtn').addEventListener('click', () => {
    document.getElementById('wlogRtPickerBg').classList.remove('open');
    document.body.style.overflow = '';
  });

  document.getElementById('wlogRtPickerList').addEventListener('click', async (e) => {
    const card = e.target.closest('[data-rt-load]');
    if (!card) return;

    const { data } = await db.rpc('member_get_routine_detail', { p_token: _memberToken, p_routine_id: card.dataset.rtLoad });
    if (!data?.length) { showToast('루틴에 운동이 없습니다'); return; }

    data.forEach(ex => {
      _wlogExs.push({
        refId: ex.exercise_ref_id,
        name: ex.name_ko || ex.exercise_name || '운동',
        part: ex.part || '',
        tool: ex.tool || '',
        weight_mode: ex.weight_mode || 'total',
        sets: [{ weight: 0, reps: 0 }],
        comment: ''
      });
    });

    document.getElementById('wlogRtPickerBg').classList.remove('open');
    document.body.style.overflow = '';
    wlogRenderExList();
    showToast('루틴 불러오기 완료');
  });

  // 루틴으로 저장
  document.getElementById('wlogSaveBtn')?.parentElement; // wlog-save-btn 이미 있음
  // wlogSaveAsRoutine은 bottom bar에 추가 가능 (필요 시)


  // ================================================================
  // STATISTICS
  // ================================================================

  async function statsInit() {
    _statsLoaded = true;
    await statsLoad();
  }

  async function statsLoad() {
    const { data, error } = await db.rpc('member_get_stats', { p_token: _memberToken });
    if (error || !data) {
      document.getElementById('statsContent').innerHTML = '<div class="empty">통계를 불러올 수 없습니다</div>';
      return;
    }
    statsRender(data);
  }

  function statsRender(s) {
    const PART_COLOR = {
      '가슴': 'var(--part-chest)', '등': 'var(--part-back)',
      '어깨': 'var(--part-shoulder)', '팔': 'var(--part-arm)',
      '코어': 'var(--part-core)', '하체': 'var(--part-leg)'
    };

    let html = '';

    // 연속 출석 / 주당 평균
    html += `<div class="stat-grid">
      <div class="stat-card">
        <div class="stat-card-num">${s.streak || 0}</div>
        <div class="stat-card-label">연속 출석</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-num">${(s.weekly_avg || 0).toFixed(1)}</div>
        <div class="stat-card-label">주당 평균</div>
      </div>
    </div>`;

    // 부위별 운동량
    if (s.part_distribution?.length) {
      html += `<div class="stat-section">
        <div class="stat-section-title">부위별 운동량</div>`;
      const maxCnt = Math.max(...s.part_distribution.map(p => p.count));
      s.part_distribution.forEach(p => {
        const pct = maxCnt ? Math.round((p.count / maxCnt) * 100) : 0;
        html += `<div class="stat-bar-row">
          <span class="stat-bar-name">${esc(p.part)}</span>
          <div style="flex:1;height:8px;background:var(--gray-100);border-radius:4px;overflow:hidden;">
            <div class="stat-bar-fill" style="width:${pct}%;background:${PART_COLOR[p.part] || 'var(--accent)'}"></div>
          </div>
          <span class="stat-bar-cnt">${p.count}</span>
        </div>`;
      });
      html += `</div>`;
    }

    // 볼륨 트렌드
    if (s.volume_trend?.length) {
      html += `<div class="stat-section">
        <div class="stat-section-title">볼륨 트렌드</div>
        <div class="stat-section-desc">최근 운동 볼륨(총중량) 변화</div>
        <div style="display:flex;align-items:flex-end;gap:var(--space-1);height:120px;">`;
      const maxVol = Math.max(...s.volume_trend.map(v => v.volume));
      s.volume_trend.forEach(v => {
        const h = maxVol ? Math.round((v.volume / maxVol) * 100) : 0;
        html += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;">
          <div style="width:100%;height:${h}px;background:var(--accent);border-radius:3px 3px 0 0;"></div>
          <div style="font-size:9px;color:var(--text-tertiary);margin-top:2px;">${(v.date || '').slice(5)}</div>
        </div>`;
      });
      html += `</div></div>`;
    }

    document.getElementById('statsContent').innerHTML = html || '<div class="empty">데이터가 부족합니다</div>';
  }


  // ================================================================
  // ANATOMY VIEWER
  // ================================================================

  let _anatomyType = 'muscle';
  let _anatomyView = 'front';

  document.getElementById('btnTypeMuscle').addEventListener('click', () => setAnatomyType('muscle'));
  document.getElementById('btnTypeBone').addEventListener('click', () => setAnatomyType('bone'));
  document.getElementById('btnMuscleFront').addEventListener('click', () => showAnatomyImg('muscle-front'));
  document.getElementById('btnMuscleBack').addEventListener('click', () => showAnatomyImg('muscle-back'));
  document.getElementById('btnBoneFront').addEventListener('click', () => showAnatomyImg('skeleton-front'));
  document.getElementById('btnBoneSide').addEventListener('click', () => showAnatomyImg('skeleton-side'));

  function setAnatomyType(type) {
    _anatomyType = type;
    document.getElementById('btnTypeMuscle').className = `btn btn-sm ${type === 'muscle' ? 'btn-secondary' : 'btn-ghost'}`;
    document.getElementById('btnTypeBone').className = `btn btn-sm ${type === 'bone' ? 'btn-secondary' : 'btn-ghost'}`;
    document.getElementById('anatomyMuscleViews').style.display = type === 'muscle' ? 'flex' : 'none';
    document.getElementById('anatomyBoneViews').style.display = type === 'bone' ? 'flex' : 'none';
    showAnatomyImg(type === 'muscle' ? 'muscle-front' : 'skeleton-front');
  }

  function showAnatomyImg(view) {
    document.getElementById('anatomyImg').src = `../images/anatomy/${view}.png`;
  }

})();
