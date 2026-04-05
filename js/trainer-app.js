// ============================================================
// VERA GYM v2 — trainer-app.js
// 트레이너 대시보드 로직
// ============================================================

(function () {
  'use strict';

  initDb();
  preventBackExit();

  // ── 상태 ─────────────────────────────────────────────────
  let me = null;
  let myMembers = [];
  let myMembersForSched = [];
  let scheduleData = [];
  let _currentDetailMemberId = null;

  // 캐시
  const _tabCache = { members: 0, logs: 0, schedule: 0, revenue: 0, requests: 0 };
  const _cacheValid = (tab) => Date.now() - _tabCache[tab] < 30000;
  const _cacheSet = (tab) => { _tabCache[tab] = Date.now(); };

  // 수업일지
  let _allLogs = [];

  // 매출
  let _revPayments = [];
  let _revForecasts = [];
  let _revTargets = [];
  let _revMonthMode = 'cur';
  let _fcEditId = null;

  // 일정 모달
  let _schedEditId = null;
  let _siTarget = null;

  // 캘린더
  const CAL_START = 6, CAL_END = 23, CAL_PX = 60;
  let calDates = [];


  // ================================================================
  // INIT
  // ================================================================

  async function init() {
    me = await requireTrainer();
    if (!me) return;
    document.getElementById('trainerInfo').textContent = `${me.name} · ${me.gym_location}`;
    await loadMembers();
    scheduleMidnightRefresh();
  }

  init();


  // ================================================================
  // TAB SWITCHING
  // ================================================================

  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab, btn, onTabSwitch));
  });

  function onTabSwitch(tabId) {
    document.getElementById('writeBar').style.display = 'none';

    if (tabId === 'members' && !_cacheValid('members')) loadMembers();
    if (tabId === 'logs' && !_cacheValid('logs')) loadLogs();
    if (tabId === 'schedule' && !_cacheValid('schedule')) loadScheduleView();
    if (tabId === 'revenue' && !_cacheValid('revenue')) loadRevenue();
    if (tabId === 'requests' && !_cacheValid('requests')) loadRequests();
  }


  // ================================================================
  // MEMBERS
  // ================================================================

  async function loadMembers() {
    const { data, error } = await db.from('members')
      .select('id, name, gym_location, is_active, member_status, token, token_active, token_expires_at, notes')
      .eq('trainer_id', me.id)
      .order('name');

    if (error) { showToast('회원 목록 로드 실패'); return; }
    myMembers = data || [];
    _cacheSet('members');
    renderMemberList();
  }

  function renderMemberList() {
    document.getElementById('memberCount').textContent = `(${myMembers.filter(m => m.is_active).length}명)`;
    const active = myMembers.filter(m => m.is_active);
    const inactive = myMembers.filter(m => !m.is_active);

    let html = '';
    active.forEach(m => {
      html += `<div class="card" data-member-id="${escAttr(m.id)}" style="cursor:pointer;">
        <div class="card-row">
          <div class="avatar">${esc(m.name[0])}</div>
          <div style="flex:1;">
            <div class="card-name">${esc(m.name)}</div>
            <div class="card-sub">${esc(m.gym_location || '')}</div>
          </div>
          <div class="card-arrow">›</div>
        </div>
      </div>`;
    });

    if (inactive.length) {
      html += `<div class="sec-header mt-4"><span class="sec-title" style="font-size:var(--text-sm);color:var(--text-tertiary);">비활성 (${inactive.length})</span></div>`;
      inactive.forEach(m => {
        html += `<div class="card" data-member-id="${escAttr(m.id)}" style="cursor:pointer;opacity:0.5;">
          <div class="card-row">
            <div class="avatar" style="background:var(--gray-400);">${esc(m.name[0])}</div>
            <div><div class="card-name">${esc(m.name)}</div></div>
            <div class="card-arrow">›</div>
          </div>
        </div>`;
      });
    }

    document.getElementById('memberList').innerHTML = html || '<div class="empty">담당 회원이 없습니다</div>';
  }

  // 회원 카드 클릭
  document.getElementById('memberList').addEventListener('click', (e) => {
    const card = e.target.closest('[data-member-id]');
    if (card) showMemberDetail(card.dataset.memberId);
  });

  async function showMemberDetail(memberId) {
    _currentDetailMemberId = memberId;
    const m = myMembers.find(x => x.id === memberId);
    if (!m) return;

    document.getElementById('view-member-list').style.display = 'none';
    document.getElementById('view-member-detail').style.display = '';
    document.getElementById('writeBar').style.display = '';

    document.getElementById('detailName').textContent = m.name;
    document.getElementById('detailSub').textContent = m.gym_location || '';

    // 토큰
    const { data: tokenData } = await db.from('members').select('token').eq('id', memberId).single();
    const tokenUrl = tokenData?.token ? `${APP_URL}/member-view.html?token=${tokenData.token}` : null;
    const tokenBox = document.getElementById('detailTokenBox');
    if (tokenUrl) {
      tokenBox.innerHTML = `<div class="token-box">
        <div class="token-url">${esc(tokenUrl)}</div>
        <div style="display:flex;gap:var(--space-2);">
          <button class="btn btn-sm btn-secondary" id="btnShareToken">공유</button>
          <button class="btn btn-sm btn-ghost" id="btnCopyToken">복사</button>
        </div>
      </div>`;
      document.getElementById('btnShareToken').addEventListener('click', () => shareToken(m.name, tokenUrl));
      document.getElementById('btnCopyToken').addEventListener('click', () => copyTokenUrl(tokenUrl));
    } else {
      tokenBox.innerHTML = '<div class="card-sub">토큰이 없습니다</div>';
    }

    // 수업 기록
    await loadMemberLogs(memberId);
    await loadMemberSelfLogs(memberId);
  }

  async function loadMemberLogs(memberId) {
    const { data } = await db.from('workout_logs')
      .select('id, session_date, is_noshow, notes, note_photo_path, created_at, workout_log_exercises(exercise_name)')
      .eq('member_id', memberId)
      .eq('trainer_id', me.id)
      .eq('is_deleted', false)
      .order('session_date', { ascending: false })
      .limit(30);

    const el = document.getElementById('memberLogs');
    if (!data?.length) { el.innerHTML = '<div class="empty">수업 기록이 없습니다</div>'; return; }
    el.innerHTML = renderLogCards(data, false);
  }

  async function loadMemberSelfLogs(memberId) {
    const { data, error } = await db.rpc('trainer_get_member_workout_logs', { p_member_id: memberId });
    const el = document.getElementById('memberSelfLogs');
    if (error || !data?.length) { el.innerHTML = '<div class="empty">회원 작성 일지가 없습니다</div>'; return; }
    el.innerHTML = renderLogCards(data, false);
  }

  function shareToken(name, url) {
    if (navigator.share) {
      navigator.share({ title: `${name} 회원 앱`, url }).catch(() => {});
    } else {
      copyTokenUrl(url);
    }
  }

  async function copyTokenUrl(url) {
    const ok = await copyToClipboard(url);
    showToast(ok ? '링크 복사 완료' : '복사 실패');
  }

  // 목록으로 돌아가기
  document.getElementById('btnBackToList').addEventListener('click', () => {
    document.getElementById('view-member-detail').style.display = 'none';
    document.getElementById('view-member-list').style.display = '';
    document.getElementById('writeBar').style.display = 'none';
    _currentDetailMemberId = null;
  });

  // 수업일지 작성 버튼
  document.getElementById('btnWriteSession').addEventListener('click', () => {
    if (_currentDetailMemberId) {
      location.href = `session-write.html?member=${_currentDetailMemberId}&date=${formatDate(new Date())}`;
    }
  });


  // ================================================================
  // WORKOUT LOGS
  // ================================================================

  async function loadLogs() {
    const { data, error } = await db.from('workout_logs')
      .select('id, session_date, member_id, is_noshow, notes, note_photo_path, created_at, members(name)')
      .eq('trainer_id', me.id)
      .eq('is_deleted', false)
      .order('session_date', { ascending: false })
      .limit(50);

    if (error) { showToast('수업일지 로드 실패'); return; }
    _allLogs = data || [];

    // 운동 태그 로드
    if (_allLogs.length) {
      const ids = _allLogs.map(l => l.id);
      const { data: exs } = await db.from('workout_log_exercises')
        .select('log_id, exercise_name')
        .in('log_id', ids);

      const exMap = {};
      (exs || []).forEach(e => {
        if (!exMap[e.log_id]) exMap[e.log_id] = [];
        exMap[e.log_id].push(e);
      });
      _allLogs = _allLogs.map(l => ({ ...l, workout_log_exercises: exMap[l.id] || [] }));
    }

    _cacheSet('logs');
    document.getElementById('logCount').textContent = `(${_allLogs.length}건)`;
    document.getElementById('logList').innerHTML = renderLogCards(_allLogs, true);
  }

  function renderLogCards(logs, showMember) {
    if (!logs?.length) return '<div class="empty">수업일지가 없습니다</div>';

    return logs.map(l => {
      const exTags = (l.workout_log_exercises || [])
        .slice(0, 4)
        .map(e => `<span class="tag tag-accent">${esc(e.exercise_name)}</span>`)
        .join('');
      const moreCount = (l.workout_log_exercises || []).length - 4;

      return `<div class="log-card ${l.is_noshow ? 'noshow' : ''}">
        <div class="log-header">
          <span class="log-date">${formatDateShort(l.session_date)}</span>
          ${showMember ? `<span class="log-member">${esc(l.members?.name || '')}</span>` : ''}
          ${l.is_noshow ? '<span class="badge badge-warning">노쇼</span>' : ''}
        </div>
        ${l.notes ? `<div class="log-notes">${esc(l.notes)}</div>` : ''}
        <div class="log-exercises">
          ${exTags}
          ${moreCount > 0 ? `<span class="tag tag-muted">+${moreCount}</span>` : ''}
        </div>
        <div class="log-actions">
          ${l.note_photo_path ? `<button class="btn btn-sm btn-ghost" data-action="viewNote" data-path="${escAttr(l.note_photo_path)}">노트 사진</button>` : ''}
          <button class="btn btn-sm btn-ghost" data-action="genCard" data-log-id="${escAttr(l.id)}">카드 생성</button>
          <button class="btn btn-sm btn-danger" data-action="deleteLog" data-log-id="${escAttr(l.id)}">삭제</button>
        </div>
      </div>`;
    }).join('');
  }

  // 로그 리스트 이벤트 위임
  document.getElementById('logList').addEventListener('click', handleLogAction);
  document.getElementById('memberLogs')?.addEventListener('click', handleLogAction);

  async function handleLogAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    if (btn.dataset.action === 'viewNote') {
      const url = await getSignedUrl(btn.dataset.path);
      if (url) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
        overlay.innerHTML = `<img src="${esc(url)}" style="max-width:100%;max-height:90dvh;border-radius:var(--radius-md);">`;
        overlay.addEventListener('click', () => overlay.remove());
        document.body.appendChild(overlay);
      } else {
        showToast('사진을 불러올 수 없습니다');
      }
    }

    if (btn.dataset.action === 'deleteLog') {
      if (!await showConfirm('수업일지를 삭제할까요?', { danger: true })) return;
      const { error } = await db.from('workout_logs').update({ is_deleted: true }).eq('id', btn.dataset.logId);
      if (error) { showToast('삭제 실패'); return; }
      showToast('삭제 완료');
      await loadLogs();
    }

    if (btn.dataset.action === 'genCard') {
      showToast('카드 생성 중...');
      // TODO: generateWorkoutCard 구현 (Canvas 기반)
    }
  }


  // ================================================================
  // REQUESTS
  // ================================================================

  async function loadRequests() {
    const { data } = await db.from('requests')
      .select('id, type, content, status, admin_note, created_at')
      .eq('trainer_id', me.id)
      .order('created_at', { ascending: false });

    _cacheSet('requests');
    const reqs = data || [];
    const pending = reqs.filter(r => r.status === 'pending');

    document.getElementById('reqCount').textContent = pending.length ? `(${pending.length})` : '';

    const typeLabel = { db_add: 'DB 추가', bug_report: '버그', other: '기타' };
    let html = '';
    reqs.forEach(r => {
      html += `<div class="req-card">
        <div class="req-top">
          <span class="badge ${r.type === 'db_add' ? 'badge-info' : r.type === 'bug_report' ? 'badge-danger' : 'badge-neutral'}">${esc(typeLabel[r.type] || r.type)}</span>
          <span class="badge ${r.status === 'pending' ? 'badge-warning' : 'badge-success'}">${r.status === 'pending' ? '대기' : '완료'}</span>
          <span class="req-meta" style="margin-left:auto;">${formatDateShort(r.created_at)}</span>
        </div>
        <div class="req-content">${esc(r.content)}</div>
        ${r.admin_note ? `<div class="req-meta">관리자: ${esc(r.admin_note)}</div>` : ''}
      </div>`;
    });

    document.getElementById('reqList').innerHTML = html || '<div class="empty">요청이 없습니다</div>';
  }

  document.getElementById('btnAddReq').addEventListener('click', () => {
    document.getElementById('reqContent').value = '';
    document.getElementById('reqErr').style.display = 'none';
    openModal('addReqModal');
  });

  document.getElementById('btnSaveReq').addEventListener('click', async () => {
    const content = document.getElementById('reqContent').value.trim();
    const err = document.getElementById('reqErr');
    if (!content) { err.textContent = '내용을 입력해주세요'; err.style.display = 'block'; return; }

    const btn = document.getElementById('btnSaveReq');
    btn.disabled = true;
    const { error } = await db.from('requests').insert({
      trainer_id: me.id,
      type: document.getElementById('reqType').value,
      content,
      status: 'pending'
    });
    btn.disabled = false;

    if (error) { err.textContent = '등록 실패'; err.style.display = 'block'; return; }
    closeModal('addReqModal');
    showToast('요청 등록 완료');
    await loadRequests();
  });


  // ================================================================
  // SCHEDULE / CALENDAR
  // ================================================================

  async function loadScheduleView() {
    calDates = getCalDates();

    // 회원 목록 (일정 등록용)
    const { data: mems } = await db.from('members')
      .select('id, name')
      .eq('trainer_id', me.id)
      .eq('is_active', true)
      .order('name');
    myMembersForSched = mems || [];

    const startStr = formatDate(calDates[0]);
    const endStr = formatDate(calDates[calDates.length - 1]);

    const { data } = await db.from('schedules')
      .select('id, sched_date, start_time, end_time, type, status, member_id, notes, pt_product_id, session_number, auto_completed, pt_products(total_sessions, remaining_sessions)')
      .eq('trainer_id', me.id)
      .gte('sched_date', startStr)
      .lte('sched_date', endStr)
      .order('start_time');

    scheduleData = data || [];
    _cacheSet('schedule');
    renderCalGrid();
  }

  function getCalDates() {
    const today = new Date();
    const dates = [];
    for (let i = -1; i <= 2; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      dates.push(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
    }
    return dates;
  }

  document.getElementById('calPrev')?.addEventListener('click', () => {
    calDates = calDates.map(d => { const n = new Date(d); n.setDate(n.getDate() - 4); return n; });
    loadScheduleView();
  });

  document.getElementById('calNext')?.addEventListener('click', () => {
    calDates = calDates.map(d => { const n = new Date(d); n.setDate(n.getDate() + 4); return n; });
    loadScheduleView();
  });

  function renderCalGrid() {
    const days = ['일','월','화','수','목','금','토'];
    const todayStr = formatDate(new Date());
    const now = new Date();
    const nowH = now.getHours(), nowM = now.getMinutes();

    // 날짜 헤더
    let dateHtml = '<div class="cal-gutter"></div>';
    calDates.forEach(d => {
      const ds = formatDate(d);
      dateHtml += `<div class="cal-day-hdr ${ds === todayStr ? 'today' : ''} ${ds < todayStr ? 'past' : ''}">
        <div class="cal-dhdr-name">${days[d.getDay()]}</div>
        <div class="cal-dhdr-num">${d.getDate()}</div>
      </div>`;
    });
    document.getElementById('calDateRow').innerHTML = dateHtml;

    // 시간 범위
    document.getElementById('calRange').textContent =
      `${calDates[0].getMonth()+1}/${calDates[0].getDate()} - ${calDates[calDates.length-1].getMonth()+1}/${calDates[calDates.length-1].getDate()}`;

    // 그리드
    const totalH = (CAL_END - CAL_START) * CAL_PX;
    let gridHtml = '<div class="cal-time-col">';
    for (let h = CAL_START; h <= CAL_END; h++) {
      gridHtml += `<div class="cal-time-label" style="height:${CAL_PX}px;">${String(h).padStart(2,'0')}</div>`;
    }
    gridHtml += '</div>';

    calDates.forEach(d => {
      const ds = formatDate(d);
      const isToday = ds === todayStr;
      const daySessions = scheduleData.filter(s => s.sched_date === ds && s.status !== 'cancelled');

      let colHtml = `<div class="cal-day-col-body" style="height:${totalH}px;">`;

      // 그리드 라인
      for (let h = CAL_START; h <= CAL_END; h++) {
        const y = (h - CAL_START) * CAL_PX;
        colHtml += `<div class="cal-gridline-hr" style="top:${y}px;"></div>`;
        if (h < CAL_END) colHtml += `<div class="cal-gridline-half" style="top:${y + CAL_PX/2}px;"></div>`;
      }

      // 클릭 존 (30분 단위)
      for (let h = CAL_START; h < CAL_END; h++) {
        for (let m = 0; m < 60; m += 30) {
          const y = (h - CAL_START) * CAL_PX + (m / 60) * CAL_PX;
          const t = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
          colHtml += `<div class="cal-click-zone" style="top:${y}px;height:${CAL_PX/2}px;" data-date="${ds}" data-time="${t}"></div>`;
        }
      }

      // 이벤트
      const typeColors = SCHED_TYPE_COLORS;
      daySessions.forEach(s => {
        const [sh, sm] = (s.start_time || '06:00').split(':').map(Number);
        const [eh, em] = (s.end_time || `${sh+1}:00`).split(':').map(Number);
        const topPx = (sh - CAL_START) * CAL_PX + (sm / 60) * CAL_PX;
        const dur = Math.max(((eh * 60 + em) - (sh * 60 + sm)), 30);
        const hPx = (dur / 60) * CAL_PX;

        const tc = typeColors[s.type] || typeColors.PT;
        const memberName = myMembersForSched.find(m => m.id === s.member_id)?.name || s.type;
        const pt = calcPtSession(s, scheduleData);
        const opacity = (s.status === 'completed' || s.status === 'noshow') ? '0.7' : '1';

        colHtml += `<div class="cal-event" style="top:${topPx}px;height:${hPx}px;background:${tc.bg};color:${tc.color};opacity:${opacity};" data-sched-id="${escAttr(s.id)}">
          <div class="cal-event-title">${esc(memberName)}${pt.num ? ` ${pt.num}/${pt.total}` : ''}</div>
          ${hPx > 28 ? `<div class="cal-event-sub">${formatTime(s.start_time)}-${formatTime(s.end_time || '')}${s.status === 'noshow' ? ' 노쇼' : ''}</div>` : ''}
        </div>`;
      });

      // 현재 시각 라인
      if (isToday && nowH >= CAL_START && nowH < CAL_END) {
        const ny = (nowH - CAL_START) * CAL_PX + (nowM / 60) * CAL_PX;
        colHtml += `<div class="cal-now-line" style="top:${ny}px;"></div>`;
      }

      colHtml += '</div>';
      gridHtml += colHtml;
    });

    document.getElementById('calGrid').innerHTML = gridHtml;

    // 스크롤 to 현재 시각
    const scrollTarget = Math.max(0, (nowH - CAL_START - 1) * CAL_PX);
    document.getElementById('calGridScroll').scrollTop = scrollTarget;

    // 이벤트: 일정 클릭
    document.querySelectorAll('.cal-event').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openSchedInfo(el.dataset.schedId);
      });
    });

    // 이벤트: 빈 슬롯 클릭 → 일정 추가
    document.querySelectorAll('.cal-click-zone').forEach(el => {
      el.addEventListener('click', () => {
        openSchedModal(null, el.dataset.date, el.dataset.time);
      });
    });
  }

  function scheduleMidnightRefresh() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const ms = midnight - now + 1000;
    setTimeout(() => {
      if (_tabCache.schedule) loadScheduleView();
      scheduleMidnightRefresh();
    }, ms);
  }


  // ================================================================
  // SCHEDULE MODAL (ADD/EDIT)
  // ================================================================

  function openSchedModal(schedId, date, time) {
    _schedEditId = schedId;
    document.getElementById('schedModalTitle').textContent = schedId ? '일정 수정' : '일정 추가';
    document.getElementById('schedModalErr').style.display = 'none';
    document.getElementById('schedDeleteBtn').style.display = schedId ? '' : 'none';

    // 회원 드롭다운
    const memberSel = document.getElementById('schedMember');
    memberSel.innerHTML = `<option value="">선택</option>` +
      myMembersForSched.map(m => `<option value="${escAttr(m.id)}">${esc(m.name)}</option>`).join('');

    if (schedId) {
      const s = scheduleData.find(x => x.id === schedId);
      if (s) {
        document.getElementById('schedDate').value = s.sched_date || '';
        document.getElementById('schedStart').value = s.start_time || '';
        document.getElementById('schedEnd').value = s.end_time || '';
        document.getElementById('schedType').value = s.type || 'PT';
        memberSel.value = s.member_id || '';
        document.getElementById('schedNotes').value = s.notes || '';
      }
    } else {
      document.getElementById('schedDate').value = date || formatDate(new Date());
      document.getElementById('schedStart').value = time || '';
      document.getElementById('schedEnd').value = '';
      document.getElementById('schedType').value = 'PT';
      memberSel.value = '';
      document.getElementById('schedNotes').value = '';
    }

    onSchedTypeChange();
    openModal('schedModal');
  }

  document.getElementById('schedType').addEventListener('change', onSchedTypeChange);

  function onSchedTypeChange() {
    const type = document.getElementById('schedType').value;
    const isPT = type === 'PT' || type === 'SPT';
    document.getElementById('schedMemberRow').style.display = isPT ? '' : 'none';
    document.getElementById('schedMemberTextRow').style.display = isPT ? 'none' : '';
  }

  document.getElementById('schedCancelBtn').addEventListener('click', () => closeModal('schedModal'));

  document.getElementById('schedSaveBtn').addEventListener('click', async () => {
    const err = document.getElementById('schedModalErr');
    const btn = document.getElementById('schedSaveBtn');
    err.style.display = 'none';

    const date = document.getElementById('schedDate').value;
    const start = document.getElementById('schedStart').value;
    const end = document.getElementById('schedEnd').value;
    const type = document.getElementById('schedType').value;
    const memberId = document.getElementById('schedMember').value || null;
    const notes = document.getElementById('schedNotes').value.trim();

    if (!date || !start) {
      err.textContent = '날짜와 시작 시간을 입력해주세요';
      err.style.display = 'block';
      return;
    }

    btn.disabled = true;

    const payload = {
      trainer_id: me.id,
      sched_date: date,
      start_time: start,
      end_time: end || null,
      type,
      member_id: memberId,
      notes: notes || null,
    };

    // PT 상품 자동 연결
    if ((type === 'PT' || type === 'SPT') && memberId) {
      const { data: products } = await db.from('pt_products')
        .select('id, remaining_sessions')
        .eq('member_id', memberId)
        .eq('is_active', true)
        .gt('remaining_sessions', 0)
        .order('created_at', { ascending: true })
        .limit(1);

      if (products?.length) {
        // 오버부킹 방어
        const scheduled = scheduleData.filter(s =>
          s.pt_product_id === products[0].id &&
          s.status === 'scheduled' &&
          s.id !== _schedEditId
        ).length;

        if (scheduled >= products[0].remaining_sessions) {
          err.textContent = '잔여 횟수를 초과합니다';
          err.style.display = 'block';
          btn.disabled = false;
          return;
        }
        payload.pt_product_id = products[0].id;
      }
    }

    let result;
    if (_schedEditId) {
      result = await db.from('schedules').update(payload).eq('id', _schedEditId);
    } else {
      result = await db.from('schedules').insert(payload);
    }

    btn.disabled = false;
    if (result.error) {
      console.error('Schedule save error:', result.error); err.textContent = '저장에 실패했습니다';
      err.style.display = 'block';
      return;
    }

    closeModal('schedModal');
    showToast(_schedEditId ? '일정 수정 완료' : '일정 추가 완료');
    await loadScheduleView();
  });

  document.getElementById('schedDeleteBtn').addEventListener('click', async () => {
    if (!_schedEditId) return;
    if (!await showConfirm('일정을 삭제할까요?', { danger: true })) return;

    const btn = document.getElementById('schedDeleteBtn');
    btn.disabled = true;
    const { error } = await db.from('schedules').delete()
      .eq('id', _schedEditId)
      .eq('trainer_id', me.id); // 소유권 검증

    btn.disabled = false;
    if (error) { showToast('삭제 실패'); return; }
    closeModal('schedModal');
    showToast('일정 삭제 완료');
    await loadScheduleView();
  });


  // ================================================================
  // SCHEDULE INFO MODAL (STATUS ACTIONS)
  // ================================================================

  function openSchedInfo(schedId) {
    _siTarget = scheduleData.find(s => s.id === schedId);
    if (!_siTarget) return;
    const s = _siTarget;

    document.getElementById('siMember').textContent =
      myMembersForSched.find(m => m.id === s.member_id)?.name || s.type;

    const statusLabels = { scheduled: '예정', completed: '완료', noshow: '노쇼', cancelled: '취소' };
    document.getElementById('siStatus').innerHTML =
      `<span class="badge ${s.status === 'completed' ? 'badge-success' : s.status === 'noshow' ? 'badge-warning' : s.status === 'cancelled' ? 'badge-neutral' : 'badge-info'}">${statusLabels[s.status]}</span>`;

    document.getElementById('siDateTime').textContent =
      `${formatDateShort(s.sched_date)} · ${formatTime(s.start_time)}${s.end_time ? '-' + formatTime(s.end_time) : ''}`;

    document.getElementById('siType').textContent = s.type;

    const pt = calcPtSession(s, scheduleData);
    const sessionRow = document.getElementById('siSessionRow');
    if (pt.num) {
      sessionRow.style.display = '';
      document.getElementById('siSession').textContent = `${pt.num}/${pt.total}회차`;
    } else {
      sessionRow.style.display = 'none';
    }

    document.getElementById('siErr').style.display = 'none';
    renderSiActions();
    openModal('schedInfoModal');
  }

  function renderSiActions() {
    const s = _siTarget;
    if (!s) return;
    const el = document.getElementById('siActions');
    let html = '<div style="display:flex;flex-wrap:wrap;gap:var(--space-2);">';

    if (s.status === 'scheduled') {
      if (!s.auto_completed) {
        html += `<button class="btn btn-md btn-secondary" data-si="complete">완료</button>`;
        html += `<button class="btn btn-md btn-danger" data-si="noshow">노쇼</button>`;
        html += `<button class="btn btn-md btn-ghost" data-si="cancel">취소</button>`;
      } else {
        html += `<div class="card-sub">자동완료 수업입니다. 관리자에게 문의하세요.</div>`;
      }
      html += `<button class="btn btn-md btn-ghost" data-si="edit">수정</button>`;
    }

    if (s.status === 'completed' || s.status === 'noshow') {
      if (!s.auto_completed) {
        html += `<button class="btn btn-md btn-ghost" data-si="toggle">${s.status === 'completed' ? '노쇼로 변경' : '완료로 변경'}</button>`;
        html += `<button class="btn btn-md btn-danger" data-si="cancelCompleted">취소 (복원)</button>`;
      } else {
        html += `<div class="card-sub">자동완료 수업입니다. 관리자에게 문의하세요.</div>`;
      }
    }

    html += '</div>';
    el.innerHTML = html;

    el.querySelectorAll('[data-si]').forEach(btn => {
      btn.addEventListener('click', () => handleSiAction(btn.dataset.si));
    });
  }

  async function handleSiAction(action) {
    const s = _siTarget;
    if (!s) return;
    const errEl = document.getElementById('siErr');
    errEl.style.display = 'none';
    let result;

    if (action === 'complete') {
      result = await completeSession(s.id);
      if (result?.ok) {
        // PT 완료 → 수업일지 연결 모달
        if (s.type === 'PT' || s.type === 'SPT') {
          closeModal('schedInfoModal');
          openLinkLogModal(s.id, s.member_id, s.sched_date);
          _tabCache.members = 0; // 회원 캐시 무효화
          await loadScheduleView();
          return;
        }
      }
    }
    else if (action === 'noshow') result = await noshowSession(s.id);
    else if (action === 'cancel') result = await cancelScheduledSession(s.id);
    else if (action === 'toggle') result = await toggleSessionStatus(s.id);
    else if (action === 'cancelCompleted') result = await cancelCompletedSession(s.id);
    else if (action === 'edit') {
      closeModal('schedInfoModal');
      openSchedModal(s.id);
      return;
    }

    if (result?.ok) {
      closeModal('schedInfoModal');
      showToast('처리 완료');
      _tabCache.members = 0;
      await loadScheduleView();
    } else if (result?.error) {
      errEl.textContent = result.error;
      errEl.style.display = 'block';
    }
  }


  // ================================================================
  // LINK LOG MODAL
  // ================================================================

  async function openLinkLogModal(scheduleId, memberId, schedDate) {
    const memberName = myMembersForSched.find(m => m.id === memberId)?.name || '';
    document.getElementById('linkLogSubtitle').textContent =
      `${memberName} · ${formatDateShort(schedDate)}`;

    // 미연결 수업일지 목록
    const { data: logs } = await db.from('workout_logs')
      .select('id, session_date, created_at, workout_log_exercises(exercise_name)')
      .eq('member_id', memberId)
      .eq('trainer_id', me.id)
      .eq('is_deleted', false)
      .is('schedule_id', null)
      .order('session_date', { ascending: false })
      .limit(10);

    let html = '';
    (logs || []).forEach(l => {
      const exNames = (l.workout_log_exercises || []).slice(0, 3).map(e => esc(e.exercise_name)).join(', ');
      html += `<div class="card" style="cursor:pointer;" data-link-log-id="${escAttr(l.id)}">
        <div class="card-name">${formatDateShort(l.session_date)}</div>
        <div class="card-sub">${exNames || '운동 없음'}</div>
      </div>`;
    });

    document.getElementById('linkLogList').innerHTML =
      html || '<div class="empty">연결 가능한 수업일지가 없습니다</div>';

    // 이벤트
    document.querySelectorAll('[data-link-log-id]').forEach(el => {
      el.addEventListener('click', async () => {
        const { error } = await db.from('workout_logs')
          .update({ schedule_id: scheduleId })
          .eq('id', el.dataset.linkLogId);
        if (error) { showToast('연결 실패'); return; }
        closeModal('linkLogModal');
        document.body.style.overflow = '';
        showToast('수업일지 연결 완료');
      });
    });

    openModal('linkLogModal');
  }

  document.getElementById('linkLogSkipBtn').addEventListener('click', () => {
    closeModal('linkLogModal');
  });

  document.getElementById('linkLogWriteBtn').addEventListener('click', () => {
    closeModal('linkLogModal');
    if (_siTarget) {
      location.href = `session-write.html?member=${_siTarget.member_id}&schedule=${_siTarget.id}&date=${_siTarget.sched_date}`;
    }
  });


  // ================================================================
  // BRANCH SCHEDULE
  // ================================================================

  document.getElementById('btnBranchSched')?.addEventListener('click', () => {
    openBranchSchedModalTrainer();
  });

  async function openBranchSchedModalTrainer() {
    const today = formatDate(new Date());
    document.getElementById('bsDatePicker').value = today;
    document.getElementById('bsSubtitle').textContent = `${me.gym_location} · ${today}`;

    await loadBranchSchedule(me.gym_location, today);
    drawBranchScheduleCanvas(document.getElementById('bsCanvas'), today, me.gym_location);
    openModal('branchSchedModal');
  }

  document.getElementById('bsCloseBtn')?.addEventListener('click', () => closeModal('branchSchedModal'));

  document.getElementById('bsBtnToday')?.addEventListener('click', async () => {
    const d = formatDate(new Date());
    document.getElementById('bsDatePicker').value = d;
    document.getElementById('bsSubtitle').textContent = `${me.gym_location} · ${d}`;
    await loadBranchSchedule(me.gym_location, d);
    drawBranchScheduleCanvas(document.getElementById('bsCanvas'), d, me.gym_location);
  });

  document.getElementById('bsBtnTomorrow')?.addEventListener('click', async () => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    const ds = formatDate(d);
    document.getElementById('bsDatePicker').value = ds;
    document.getElementById('bsSubtitle').textContent = `${me.gym_location} · ${ds}`;
    await loadBranchSchedule(me.gym_location, ds);
    drawBranchScheduleCanvas(document.getElementById('bsCanvas'), ds, me.gym_location);
  });

  document.getElementById('bsDatePicker')?.addEventListener('change', async (e) => {
    if (!e.target.value) return;
    document.getElementById('bsSubtitle').textContent = `${me.gym_location} · ${e.target.value}`;
    await loadBranchSchedule(me.gym_location, e.target.value);
    drawBranchScheduleCanvas(document.getElementById('bsCanvas'), e.target.value, me.gym_location);
  });

  document.getElementById('btnDownloadBs')?.addEventListener('click', () => {
    const date = document.getElementById('bsDatePicker').value || formatDate(new Date());
    downloadCanvasImage(document.getElementById('bsCanvas'), `veragym_${date}.png`);
  });


  // ================================================================
  // REVENUE
  // ================================================================

  async function loadRevenue() {
    const curMonth = _curMonth();
    const [payRes, fcRes, tgRes] = await Promise.all([
      loadAll('payment_records', '*', q => q.eq('trainer_id', me.id), { orderBy: 'payment_date', ascending: false }),
      db.from('sales_forecasts').select('*').eq('trainer_id', me.id),
      db.from('sales_targets').select('*').eq('trainer_id', me.id)
    ]);

    _revPayments = payRes.data || [];
    _revForecasts = fcRes.data || [];
    _revTargets = tgRes.data || [];
    _cacheSet('revenue');

    renderRevAvg();
    renderRevSummary();
    renderForecasts();
  }

  function _curMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function _nextMonth() {
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function renderRevAvg() {
    const total = _revPayments.reduce((s, p) => s + (p.net_amount || 0), 0);
    const months = new Set(_revPayments.map(p => (p.payment_date || '').slice(0, 7)));
    const avg = months.size ? Math.round(total / months.size) : 0;
    document.getElementById('revAvgAll').textContent = formatWon(avg);

    // 연도 셀렉트
    const years = [...new Set(_revPayments.map(p => (p.payment_date || '').slice(0, 4)))].sort().reverse();
    const yearSel = document.getElementById('revYear');
    if (!yearSel.options.length) {
      yearSel.innerHTML = years.map(y => `<option value="${y}">${y}년</option>`).join('');
    }

    calcRevPeriod();
  }

  document.getElementById('revYear')?.addEventListener('change', calcRevPeriod);
  document.getElementById('revPeriodType')?.addEventListener('change', calcRevPeriod);
  document.getElementById('revPeriodSub')?.addEventListener('change', calcRevPeriod);

  function calcRevPeriod() {
    const year = document.getElementById('revYear').value;
    if (!year) { document.getElementById('revAvgPeriod').textContent = '0원'; return; }

    const payments = _revPayments.filter(p => (p.payment_date || '').startsWith(year));
    const total = payments.reduce((s, p) => s + (p.net_amount || 0), 0);
    const months = new Set(payments.map(p => (p.payment_date || '').slice(0, 7)));
    const avg = months.size ? Math.round(total / months.size) : 0;
    document.getElementById('revAvgPeriod').textContent = formatWon(avg);
  }

  function renderRevSummary() {
    const curMonth = _curMonth();
    const target = _revTargets.find(t => t.target_month === curMonth);
    if (target) document.getElementById('revTargetInput').value = target.target_amount || '';

    const achieved = _revPayments
      .filter(p => (p.payment_date || '').startsWith(curMonth))
      .reduce((s, p) => s + (p.net_amount || 0), 0);
    document.getElementById('revAchieved').textContent = formatWon(achieved);

    updateForecastTotal();
  }

  function updateForecastTotal() {
    const month = _revMonthMode === 'cur' ? _curMonth() : _nextMonth();
    const total = _revForecasts
      .filter(f => (f.forecast_month || '').startsWith(month) && f.is_registered !== false)
      .reduce((s, f) => s + (f.forecast_amount || 0), 0);
    document.getElementById('revForecastTotal').textContent = formatWon(total);
  }

  // 목표 저장
  document.getElementById('revTargetInput')?.addEventListener('change', async () => {
    const amount = parseInt(document.getElementById('revTargetInput').value) || 0;
    const month = _curMonth();
    const existing = _revTargets.find(t => t.target_month === month);

    if (existing) {
      await db.from('sales_targets').update({ target_amount: amount }).eq('id', existing.id);
      existing.target_amount = amount;
    } else {
      const { data } = await db.from('sales_targets').insert({
        trainer_id: me.id, target_month: month, target_amount: amount
      }).select('id').single();
      if (data) _revTargets.push({ id: data.id, target_month: month, target_amount: amount });
    }
    showToast('목표 저장 완료');
  });

  // 월 전환
  document.getElementById('revMonthCur')?.addEventListener('click', () => {
    _revMonthMode = 'cur';
    document.getElementById('revMonthCur').className = 'btn btn-sm btn-secondary';
    document.getElementById('revMonthNext').className = 'btn btn-sm btn-ghost';
    updateForecastTotal();
    renderForecasts();
  });

  document.getElementById('revMonthNext')?.addEventListener('click', () => {
    _revMonthMode = 'next';
    document.getElementById('revMonthNext').className = 'btn btn-sm btn-secondary';
    document.getElementById('revMonthCur').className = 'btn btn-sm btn-ghost';
    updateForecastTotal();
    renderForecasts();
  });

  // 예상매출 목록
  function renderForecasts() {
    const month = _revMonthMode === 'cur' ? _curMonth() : _nextMonth();
    const forecasts = _revForecasts
      .filter(f => (f.forecast_month || '').startsWith(month))
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

    let html = '';
    forecasts.forEach(f => {
      const isReg = f.is_registered !== false;
      html += `<div class="fc-card ${isReg ? '' : 'unregistered'}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:var(--text-sm);font-weight:var(--font-semibold);">${esc(f.member_name || '')}</div>
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);">
              ${f.session_count || 0}회 × ${formatWon(f.price_per_session || 0)}
              ${f.payment_due_date ? ` · ${formatDateDot(f.payment_due_date)}` : ''}
            </div>
          </div>
          <div style="font-size:var(--text-base);font-weight:var(--font-bold);color:var(--accent);">
            ${formatWon(f.forecast_amount || 0)}
          </div>
        </div>
        ${f.memo ? `<div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-top:var(--space-1);">${esc(f.memo)}</div>` : ''}
        <div style="display:flex;gap:var(--space-2);margin-top:var(--space-2);">
          <button class="btn btn-sm btn-ghost" data-fc-action="edit" data-fc-id="${escAttr(f.id)}">수정</button>
          <button class="btn btn-sm ${isReg ? 'btn-ghost' : 'btn-secondary'}" data-fc-action="toggle" data-fc-id="${escAttr(f.id)}" data-registered="${isReg}">${isReg ? '미등록' : '등록'}</button>
          <button class="btn btn-sm btn-danger" data-fc-action="delete" data-fc-id="${escAttr(f.id)}">삭제</button>
        </div>
      </div>`;
    });

    document.getElementById('revForecastList').innerHTML =
      html || '<div class="empty">예상매출이 없습니다</div>';
  }

  // 예상매출 이벤트 위임
  document.getElementById('revForecastList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-fc-action]');
    if (!btn) return;
    const id = btn.dataset.fcId;

    if (btn.dataset.fcAction === 'edit') editForecast(id);
    if (btn.dataset.fcAction === 'toggle') {
      const isReg = btn.dataset.registered === 'true';
      await db.from('sales_forecasts').update({ is_registered: !isReg }).eq('id', id);
      const f = _revForecasts.find(x => x.id === id);
      if (f) f.is_registered = !isReg;
      updateForecastTotal();
      renderForecasts();
    }
    if (btn.dataset.fcAction === 'delete') {
      if (!await showConfirm('삭제할까요?', { danger: true })) return;
      await db.from('sales_forecasts').delete().eq('id', id);
      _revForecasts = _revForecasts.filter(x => x.id !== id);
      updateForecastTotal();
      renderForecasts();
      showToast('삭제 완료');
    }
  });

  // 예상매출 추가/수정 모달
  document.getElementById('btnAddForecast')?.addEventListener('click', () => openForecastModal());
  document.getElementById('btnCopyForecast')?.addEventListener('click', copyForecastText);

  function openForecastModal() {
    _fcEditId = null;
    document.getElementById('forecastModalTitle').textContent = '예상매출 등록';
    document.getElementById('btnSaveForecast').textContent = '등록';
    document.getElementById('fcName').value = '';
    document.getElementById('fcPPS').value = '';
    document.getElementById('fcCount').value = '';
    document.getElementById('fcAmount').value = '';
    document.getElementById('fcDueDate').value = '';
    document.getElementById('fcMemo').value = '';
    document.getElementById('forecastErr').style.display = 'none';
    openModal('forecastModal');
  }

  function editForecast(id) {
    const f = _revForecasts.find(x => x.id === id);
    if (!f) return;
    _fcEditId = id;
    document.getElementById('forecastModalTitle').textContent = '예상매출 수정';
    document.getElementById('btnSaveForecast').textContent = '수정';
    document.getElementById('fcName').value = f.member_name || '';
    document.getElementById('fcPPS').value = f.price_per_session || '';
    document.getElementById('fcCount').value = f.session_count || '';
    document.getElementById('fcAmount').value = f.forecast_amount || (f.price_per_session || 0) * (f.session_count || 0) || '';
    document.getElementById('fcDueDate').value = f.payment_due_date || '';
    document.getElementById('fcMemo').value = f.memo || '';
    document.getElementById('forecastErr').style.display = 'none';
    openModal('forecastModal');
  }

  document.getElementById('fcPPS')?.addEventListener('input', calcFcAmount);
  document.getElementById('fcCount')?.addEventListener('input', calcFcAmount);

  function calcFcAmount() {
    const pps = parseInt(document.getElementById('fcPPS').value) || 0;
    const count = parseInt(document.getElementById('fcCount').value) || 0;
    if (pps && count) document.getElementById('fcAmount').value = pps * count;
  }

  document.getElementById('btnSaveForecast').addEventListener('click', async () => {
    const name = document.getElementById('fcName').value.trim();
    const err = document.getElementById('forecastErr');
    const btn = document.getElementById('btnSaveForecast');

    if (!name) { err.textContent = '이름을 입력해주세요'; err.style.display = 'block'; return; }

    const month = _revMonthMode === 'cur' ? _curMonth() : _nextMonth();
    const payload = {
      trainer_id: me.id,
      forecast_month: month,
      member_name: name,
      price_per_session: parseInt(document.getElementById('fcPPS').value) || 0,
      session_count: parseInt(document.getElementById('fcCount').value) || 0,
      // forecast_amount는 DB GENERATED 컬럼 (price_per_session * session_count)
      payment_due_date: document.getElementById('fcDueDate').value || null,
      memo: document.getElementById('fcMemo').value.trim() || null,
      is_registered: true
    };

    btn.disabled = true;
    let result;
    if (_fcEditId) {
      result = await db.from('sales_forecasts').update(payload).eq('id', _fcEditId).select().single();
      if (result.data) {
        const idx = _revForecasts.findIndex(x => x.id === _fcEditId);
        if (idx >= 0) _revForecasts[idx] = { ...result.data };
      }
    } else {
      result = await db.from('sales_forecasts').insert(payload).select().single();
      if (result.data) _revForecasts.push(result.data);
    }
    btn.disabled = false;

    if (result.error) { err.textContent = '저장 실패'; err.style.display = 'block'; return; }
    closeModal('forecastModal');
    showToast(_fcEditId ? '수정 완료' : '등록 완료');
    updateForecastTotal();
    renderForecasts();
  });

  async function copyForecastText() {
    const month = _revMonthMode === 'cur' ? _curMonth() : _nextMonth();
    const target = document.getElementById('revTargetInput').value || '0';
    const forecasts = _revForecasts
      .filter(f => (f.forecast_month || '').startsWith(month) && f.is_registered !== false);

    let text = `[${month} 예상매출]\n목표: ${formatWon(parseInt(target))}\n\n`;
    forecasts.forEach((f, i) => {
      text += `${i + 1}. ${f.member_name || ''} - ${formatWon(f.forecast_amount || 0)}`;
      if (f.session_count) text += ` (${f.session_count}회)`;
      text += '\n';
    });
    text += `\n합계: ${formatWon(forecasts.reduce((s, f) => s + (f.forecast_amount || 0), 0))}`;

    const ok = await copyToClipboard(text);
    showToast(ok ? '복사 완료' : '복사 실패');
  }


  // ================================================================
  // LOGOUT
  // ================================================================

  document.getElementById('btnLogout').addEventListener('click', () => {
    doLogout('trainer-login.html');
  });

})();
