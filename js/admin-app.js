// ============================================================
// VERA GYM v2 — admin-app.js
// 관리자 대시보드 로직 (admin.html 전용)
// 의존: config.js, auth.js, ui.js, utils.js, data-loader.js,
//       schedule-actions.js, branch-schedule.js
// ============================================================

(function () {
  'use strict';

  initDb();
  preventBackExit();

  // ── 상태 변수 ────────────────────────────────────────────
  let me = null;                    // 현재 관리자 정보

  // 트레이너/회원 탭
  let _allTrainers = [];
  let _allMembers  = [];
  let _currentMemberId = null;

  // PT 상품
  let _ctProductId = null;

  // 비밀번호 변경
  let _changePwTargetId = null;

  // 운동 DB 탭
  let _allExercises = [];
  let _exFiltered   = [];
  let _exShowCount  = 50;
  let _exToolFilter = '';
  let _exPartFilter = '';
  let _currentExId  = null;

  // 일정 탭
  let scData = [];
  let scStart = null;
  let scSelectedDate = '';
  let scTarget = null;
  let scPendingAction = '';
  let scTrainersLoaded = false;
  let _scAllTrainers = [];

  // 매출 탭
  let _admRevForecasts = [];
  let _admRevPayments  = [];
  let _admRevTrainers  = [];
  let _admRevMonthMode = 'cur';
  let _allPayments     = [];
  let _allTrainersList = [];
  let _payDataLoaded   = false;


  // ================================================================
  // INIT
  // ================================================================

  async function init() {
    me = await requireAdmin();
    if (!me) return;
    document.getElementById('adminName').textContent =
      me.is_super ? '슈퍼관리자' : `${me.name} · ${me.gym_location}`;
    await loadTrainers();
  }

  init();


  // ================================================================
  // TAB SWITCHING
  // ================================================================

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab, btn, onTabSwitch);
    });
  });

  function onTabSwitch(tabId) {
    if (tabId === 'members' && _allMembers.length === 0) loadMembers();
    if (tabId === 'exercise' && _allExercises.length === 0) loadExercise();
    if (tabId === 'requests') loadRequests();
    if (tabId === 'schedule') loadScheduleTab();
    if (tabId === 'revenue') {
      if (!_payDataLoaded) loadAllPayments();
      loadAdminRevenue();
    }
  }


  // ================================================================
  // TRAINER MANAGEMENT
  // ================================================================

  async function loadTrainers() {
    const { data, error } = await loadAll('trainers',
      'id, name, gym_location, is_admin, is_active, auth_id',
      null,
      { orderBy: 'name' }
    );
    if (error) { showToast('트레이너 목록 로드 실패'); return; }
    _allTrainers = data || [];

    const admins   = _allTrainers.filter(t => t.is_admin && t.is_active);
    const active   = _allTrainers.filter(t => !t.is_admin && t.is_active);
    const inactive = _allTrainers.filter(t => !t.is_active);

    document.getElementById('trainerCount').textContent = `(${active.length}명)`;

    let html = '';
    const renderGroup = (label, list) => {
      if (!list.length) return '';
      let h = `<div class="sec-header mt-3"><span class="sec-title" style="font-size:var(--text-sm)">${esc(label)}</span></div>`;
      list.forEach(t => {
        h += `<div class="card">
          <div class="card-row">
            <div class="avatar">${esc(t.name[0])}</div>
            <div style="flex:1">
              <div class="card-name">${esc(t.name)}</div>
              <div class="card-sub">${esc(t.gym_location)}${t.is_admin ? ' · <span class="badge badge-accent">관리자</span>' : ''}</div>
            </div>
            <div style="display:flex;gap:var(--space-1);flex-wrap:wrap;">
              <button class="btn btn-sm btn-ghost" data-action="changePw" data-id="${escAttr(t.id)}" data-name="${escAttr(t.name)}">비밀번호</button>
              ${t.is_active
                ? `<button class="btn btn-sm btn-danger" data-action="deactivate" data-id="${escAttr(t.id)}" data-name="${escAttr(t.name)}">비활성</button>`
                : `<button class="btn btn-sm btn-secondary" data-action="activate" data-id="${escAttr(t.id)}" data-name="${escAttr(t.name)}">활성화</button>`
              }
            </div>
          </div>
        </div>`;
      });
      return h;
    };

    html += renderGroup('관리자', admins);
    html += renderGroup('트레이너', active);
    if (inactive.length) html += renderGroup('비활성', inactive);
    document.getElementById('trainerList').innerHTML = html;
  }

  // 트레이너 리스트 이벤트 위임
  document.getElementById('trainerList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, name } = btn.dataset;

    if (action === 'changePw') openChangePw(id, name);
    if (action === 'deactivate') {
      if (await showConfirm(`${name} 트레이너를 비활성화할까요?`, { danger: true })) {
        await db.from('trainers').update({ is_active: false }).eq('id', id);
        showToast('비활성화 완료');
        await loadTrainers();
      }
    }
    if (action === 'activate') {
      if (await showConfirm(`${name} 트레이너를 다시 활성화할까요?`)) {
        await db.from('trainers').update({ is_active: true }).eq('id', id);
        showToast('활성화 완료');
        await loadTrainers();
      }
    }
  });

  // 트레이너 추가
  document.getElementById('btnAddTrainer').addEventListener('click', () => {
    document.getElementById('tName').value = '';
    document.getElementById('tPw').value = '';
    document.getElementById('addErr').style.display = 'none';
    openModal('addModal');
  });

  document.getElementById('btnAdd').addEventListener('click', async () => {
    const name = document.getElementById('tName').value.trim();
    const pw   = document.getElementById('tPw').value;
    const gym  = document.getElementById('tGym').value;
    const role = document.getElementById('tRole').value;
    const err  = document.getElementById('addErr');
    const btn  = document.getElementById('btnAdd');

    err.style.display = 'none';
    if (!name) { err.textContent = '이름을 입력해주세요'; err.style.display = 'block'; return; }
    if (!pw || pw.length < 8) { err.textContent = '비밀번호는 8자 이상이어야 합니다'; err.style.display = 'block'; return; }
    if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) { err.textContent = '영문과 숫자를 모두 포함해야 합니다'; err.style.display = 'block'; return; }

    btn.disabled = true;
    try {
      const { data: { session } } = await db.auth.getSession();
      const res = await fetch(`${EDGE_BASE}/create-trainer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ name, password: pw, gym_location: gym, is_admin: role === 'admin' })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '생성 실패');
      closeModal('addModal');
      showToast(`${name} 트레이너 추가 완료`);
      await loadTrainers();
    } catch (e) {
      err.textContent = e.message; err.style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  });

  // 비밀번호 변경
  function openChangePw(id, name) {
    _changePwTargetId = id;
    document.getElementById('changePwTitle').textContent = `${name} 비밀번호 변경`;
    document.getElementById('newPw').value = '';
    document.getElementById('changePwErr').style.display = 'none';
    openModal('changePwModal');
  }

  document.getElementById('btnChangePw').addEventListener('click', async () => {
    const pw  = document.getElementById('newPw').value;
    const err = document.getElementById('changePwErr');
    const btn = document.getElementById('btnChangePw');

    err.style.display = 'none';
    if (!pw || pw.length < 8) {
      err.textContent = '비밀번호는 8자 이상이어야 합니다';
      err.style.display = 'block';
      return;
    }
    if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) {
      err.textContent = '영문과 숫자를 모두 포함해야 합니다';
      err.style.display = 'block';
      return;
    }

    btn.disabled = true;
    try {
      const { data: { session } } = await db.auth.getSession();
      const res = await fetch(`${EDGE_BASE}/update-trainer-pw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ trainer_id: _changePwTargetId, new_password: pw })
      });
      if (!res.ok) { const r = await res.json(); throw new Error(r.error || '변경 실패'); }
      closeModal('changePwModal');
      showToast('비밀번호 변경 완료');
    } catch (e) {
      err.textContent = e.message; err.style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  });


  // ================================================================
  // MEMBER MANAGEMENT
  // ================================================================

  async function loadMembers() {
    const [trRes, memRes] = await Promise.all([
      loadAll('trainers', 'id, name, gym_location, is_active', null, { orderBy: 'name' }),
      loadAll('members', 'id, name, gym_location, trainer_id, is_active, member_status, status_override, token, token_active, token_expires_at, notes, created_at', null, { orderBy: 'name' })
    ]);
    _allTrainers = trRes.data || [];
    _allMembers  = memRes.data || [];
    document.getElementById('memberCount').textContent = `(${_allMembers.length}명)`;
    showAllBranches();
  }

  function showAllBranches() {
    setBreadcrumb([{ label: '전체' }]);
    const gyms = {};
    _allMembers.forEach(m => {
      const g = m.gym_location || '미지정';
      if (!gyms[g]) gyms[g] = [];
      gyms[g].push(m);
    });

    let html = '';
    Object.keys(gyms).sort().forEach(g => {
      const members = gyms[g];
      const trainers = new Set(members.map(m => m.trainer_id).filter(Boolean));
      html += `<div class="branch-chip" data-branch="${escAttr(g)}">
        <div>
          <div class="branch-chip-name">${esc(g)}</div>
          <div class="branch-chip-label">트레이너 ${trainers.size}명</div>
        </div>
        <div class="branch-chip-count">${members.length}</div>
        <div class="branch-chip-arrow">›</div>
      </div>`;
    });
    document.getElementById('memberList').innerHTML = html;
    document.getElementById('branchSummary').innerHTML = '';
  }

  // 이벤트 위임: 브랜치 클릭
  document.getElementById('memberList').addEventListener('click', (e) => {
    const chip = e.target.closest('.branch-chip');
    if (chip) { showBranch(chip.dataset.branch); return; }

    const row = e.target.closest('.member-row');
    if (row) { showMemberDetail(row.dataset.id); return; }

    const acc = e.target.closest('.acc-header');
    if (acc) { toggleAcc(acc.dataset.accId); return; }
  });

  function showBranch(branch) {
    setBreadcrumb([
      { label: '전체', onclick: () => showAllBranches() },
      { label: branch }
    ]);

    const members = _allMembers.filter(m => (m.gym_location || '미지정') === branch);
    const trainerMap = {};
    _allTrainers.filter(t => t.gym_location === branch && t.is_active).forEach(t => {
      trainerMap[t.id] = t.name;
    });

    // 상태별 그룹
    const groups = { active: [], long_absent: [], expired: [] };
    members.forEach(m => {
      const st = m.status_override || m.member_status || 'active';
      if (groups[st]) groups[st].push(m);
      else groups.active.push(m);
    });

    let html = '';
    const statusLabels = { active: '활성', long_absent: '장기미방문', expired: '만료' };

    Object.entries(groups).forEach(([status, list]) => {
      if (!list.length) return;
      const accId = `acc-${status}`;
      // 트레이너별 그룹
      const byTrainer = {};
      list.forEach(m => {
        const tid = m.trainer_id || '_none';
        if (!byTrainer[tid]) byTrainer[tid] = [];
        byTrainer[tid].push(m);
      });

      html += `<div class="acc-block">
        <div class="acc-header" data-acc-id="${accId}">
          <span class="acc-header-title">${esc(statusLabels[status])}</span>
          <span class="acc-header-count">${list.length}명</span>
          <span class="acc-arrow" id="${accId}-arrow">›</span>
        </div>
        <div class="acc-body" id="${accId}">`;

      Object.entries(byTrainer).forEach(([tid, mems]) => {
        const tName = trainerMap[tid] || (tid === '_none' ? '미배정' : '퇴사 트레이너');
        html += `<div style="padding:var(--space-2) var(--space-4);font-size:var(--text-xs);color:var(--text-tertiary);font-weight:var(--font-semibold);border-bottom:1px solid var(--border-light);">${esc(tName)} (${mems.length})</div>`;
        mems.forEach(m => {
          html += `<div class="member-row" data-id="${escAttr(m.id)}">
            <span class="member-row-name">${esc(m.name)}</span>
            <span class="member-row-arrow">›</span>
          </div>`;
        });
      });

      html += `</div></div>`;
    });

    document.getElementById('memberList').innerHTML = html;
    // 첫 번째 아코디언 자동 열기
    const firstAcc = document.querySelector('.acc-block');
    if (firstAcc) {
      const id = firstAcc.querySelector('.acc-header').dataset.accId;
      toggleAcc(id);
    }
  }

  function toggleAcc(id) {
    const body = document.getElementById(id);
    const arrow = document.getElementById(id + '-arrow');
    if (!body) return;
    body.classList.toggle('open');
    if (arrow) arrow.classList.toggle('open');
  }

  function setBreadcrumb(items) {
    const el = document.getElementById('memberBreadcrumb');
    if (!el) return;
    if (items.length <= 1) { el.innerHTML = ''; return; }
    let html = '';
    items.forEach((item, i) => {
      if (i > 0) html += '<span class="bc-sep">›</span>';
      if (i < items.length - 1 && item.onclick) {
        html += `<button class="bc-item" data-bc-idx="${i}">${esc(item.label)}</button>`;
      } else {
        html += `<span class="bc-current">${esc(item.label)}</span>`;
      }
    });
    el.innerHTML = `<div class="breadcrumb">${html}</div>`;

    // 이벤트
    el.querySelectorAll('.bc-item').forEach(btn => {
      const idx = parseInt(btn.dataset.bcIdx);
      btn.addEventListener('click', () => items[idx].onclick());
    });
  }

  // 회원 검색
  document.getElementById('memberSearchInput').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { showAllBranches(); return; }
    const filtered = _allMembers.filter(m => m.name.toLowerCase().includes(q));
    setBreadcrumb([{ label: '전체', onclick: () => { e.target.value = ''; showAllBranches(); } }, { label: `검색: ${q}` }]);
    let html = '';
    filtered.forEach(m => {
      html += `<div class="member-row" data-id="${escAttr(m.id)}">
        <span class="member-row-name">${esc(m.name)}</span>
        <span style="font-size:var(--text-xs);color:var(--text-tertiary);margin-left:auto;margin-right:var(--space-2);">${esc(m.gym_location || '')}</span>
        <span class="member-row-arrow">›</span>
      </div>`;
    });
    document.getElementById('memberList').innerHTML = html || '<div class="empty">검색 결과가 없습니다</div>';
    document.getElementById('branchSummary').innerHTML = '';
  });

  document.getElementById('memberSearchClear').addEventListener('click', () => {
    document.getElementById('memberSearchInput').value = '';
    showAllBranches();
  });


  // ================================================================
  // MEMBER DETAIL
  // ================================================================

  async function showMemberDetail(memberId) {
    _currentMemberId = memberId;
    const m = _allMembers.find(x => x.id === memberId);
    if (!m) return;

    document.getElementById('detailMemberName').textContent = m.name;
    const trainer = _allTrainers.find(t => t.id === m.trainer_id);
    document.getElementById('detailMemberMeta').textContent =
      `${m.gym_location || ''} · ${trainer ? trainer.name : '미배정'} · ${formatDateDot(m.created_at)} 등록`;

    // 상태
    const sel = document.getElementById('statusOverrideSelect');
    sel.value = m.status_override || '';
    document.getElementById('statusOverrideNote').textContent =
      m.status_override ? '수동 설정됨' : '자동 계산';

    // 토큰
    renderTokenSection(m);

    // PT 상품
    await loadPtProducts(memberId);
    openModal('memberDetailModal');
  }

  function renderTokenSection(m) {
    const badge = document.getElementById('tokenStatusBadge');
    const expiry = document.getElementById('tokenExpiryText');
    const btns = document.getElementById('tokenToggleBtn');

    if (m.token_active) {
      badge.className = 'badge badge-success';
      badge.textContent = '활성';
    } else {
      badge.className = 'badge badge-danger';
      badge.textContent = '비활성';
    }

    if (m.token_expires_at) {
      const days = Math.ceil((new Date(m.token_expires_at) - Date.now()) / 86400000);
      expiry.textContent = days > 0 ? `${days}일 남음` : '만료됨';
      if (days <= 0) expiry.style.color = 'var(--color-danger)';
      else expiry.style.color = '';
    } else {
      expiry.textContent = '만료일 없음';
    }

    btns.innerHTML = `
      <button class="btn btn-sm btn-secondary" id="btnExtendToken">1년 연장</button>
      <button class="btn btn-sm ${m.token_active ? 'btn-danger' : 'btn-secondary'}" id="btnToggleToken">
        ${m.token_active ? '비활성화' : '활성화'}
      </button>`;

    document.getElementById('btnExtendToken').addEventListener('click', adminExtendToken);
    document.getElementById('btnToggleToken').addEventListener('click', adminToggleToken);
  }

  async function adminExtendToken() {
    const { error } = await db.rpc('admin_extend_member_token', { p_member_id: _currentMemberId });
    if (error) { showToast('토큰 연장 실패'); return; }
    // 로컬 캐시 업데이트
    const m = _allMembers.find(x => x.id === _currentMemberId);
    if (m) {
      const d = new Date(); d.setFullYear(d.getFullYear() + 1);
      m.token_expires_at = d.toISOString();
      renderTokenSection(m);
    }
    showToast('1년 연장 완료');
  }

  async function adminToggleToken() {
    const { error } = await db.rpc('admin_toggle_member_token', { p_member_id: _currentMemberId });
    if (error) { showToast('토큰 토글 실패'); return; }
    const m = _allMembers.find(x => x.id === _currentMemberId);
    if (m) {
      m.token_active = !m.token_active;
      renderTokenSection(m);
    }
    showToast(m?.token_active ? '활성화 완료' : '비활성화 완료');
  }

  // 상태 오버라이드
  document.getElementById('statusOverrideBtn').addEventListener('click', async () => {
    const val = document.getElementById('statusOverrideSelect').value || null;
    const btn = document.getElementById('statusOverrideBtn');
    btn.disabled = true;
    const { error } = await db.rpc('admin_set_member_status', {
      p_member_id: _currentMemberId,
      p_status: val
    });
    btn.disabled = false;
    if (error) { showToast('상태 변경 실패'); return; }
    const m = _allMembers.find(x => x.id === _currentMemberId);
    if (m) m.status_override = val;
    document.getElementById('statusOverrideNote').textContent =
      val ? '수동 설정됨' : '자동 계산';
    showToast('상태 변경 완료');
  });


  // ================================================================
  // PT PRODUCTS
  // ================================================================

  async function loadPtProducts(memberId) {
    const { data, error } = await db.from('pt_products')
      .select('id, contract_date, total_sessions, remaining_sessions, contract_trainer_id, price_per_session, notes, is_active, created_at')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false });

    const el = document.getElementById('ptProductList');
    if (error || !data?.length) {
      el.innerHTML = '<div class="empty">등록된 PT 상품이 없습니다</div>';
      return;
    }

    let html = '';
    data.forEach(p => {
      const trainer = _allTrainers.find(t => t.id === p.contract_trainer_id);
      const isActive = p.is_active && p.remaining_sessions > 0;
      html += `<div class="pt-card">
        <div class="pt-card-header">
          <div class="pt-sessions">${p.remaining_sessions}<span style="font-size:var(--text-sm);color:var(--text-tertiary);">/${p.total_sessions}회</span></div>
          <span class="badge ${isActive ? 'badge-success' : 'badge-neutral'}">${isActive ? '진행중' : '종료'}</span>
        </div>
        <div class="pt-meta">
          ${esc(trainer?.name || '미지정')} · ${formatDateDot(p.contract_date)} 계약
          ${p.price_per_session ? ` · 회당 ${formatWon(p.price_per_session)}` : ''}
        </div>
        ${p.notes ? `<div class="pt-meta mt-2">${esc(p.notes)}</div>` : ''}
        <div style="display:flex;gap:var(--space-1);margin-top:var(--space-2);">
          <button class="btn btn-sm btn-ghost" data-action="changeTrainer" data-product-id="${escAttr(p.id)}" data-trainer-id="${escAttr(p.contract_trainer_id || '')}">트레이너 변경</button>
        </div>
      </div>`;
    });
    el.innerHTML = html;

    // 이벤트
    el.querySelectorAll('[data-action="changeTrainer"]').forEach(btn => {
      btn.addEventListener('click', () => {
        openChangeTrainer(btn.dataset.productId, btn.dataset.trainerId);
      });
    });
  }

  // PT 상품 추가
  document.getElementById('btnAddPtFromDetail').addEventListener('click', openAddPtProduct);

  function openAddPtProduct() {
    document.getElementById('addPtTitle').textContent = 'PT 상품 추가';
    document.getElementById('ptErr').style.display = 'none';
    document.getElementById('ptDate').value = formatDate(new Date());
    document.getElementById('ptSessions').value = '';
    document.getElementById('ptPricePerSession').value = '';
    document.getElementById('ptPaymentAmount').value = '';
    document.getElementById('ptNotes').value = '';

    // 트레이너 드롭다운
    const m = _allMembers.find(x => x.id === _currentMemberId);
    const gym = m?.gym_location || '';
    const sel = document.getElementById('ptContractTrainer');
    sel.innerHTML = _allTrainers
      .filter(t => t.is_active && t.gym_location === gym)
      .map(t => `<option value="${escAttr(t.id)}">${esc(t.name)}</option>`)
      .join('');

    openModal('addPtModal');
  }

  // 자동 결제 계산
  document.getElementById('ptPricePerSession').addEventListener('input', calcPtPayment);
  document.getElementById('ptSessions').addEventListener('input', calcPtPayment);

  function calcPtPayment() {
    const price = parseInt(document.getElementById('ptPricePerSession').value) || 0;
    const sessions = parseInt(document.getElementById('ptSessions').value) || 0;
    if (price && sessions) {
      document.getElementById('ptPaymentAmount').value = Math.round(price * sessions * 1.1);
    }
  }

  document.getElementById('btnAddPt').addEventListener('click', async () => {
    const err = document.getElementById('ptErr');
    const btn = document.getElementById('btnAddPt');
    err.style.display = 'none';

    const contractDate = document.getElementById('ptDate').value;
    const sessions = parseInt(document.getElementById('ptSessions').value);
    const trainerId = document.getElementById('ptContractTrainer').value;

    if (!contractDate || !sessions || sessions < 1 || !trainerId) {
      err.textContent = '계약일, 횟수, 트레이너를 입력해주세요';
      err.style.display = 'block';
      return;
    }

    btn.disabled = true;
    try {
      const pricePerSession = parseInt(document.getElementById('ptPricePerSession').value) || 0;
      const paymentAmt = parseInt(document.getElementById('ptPaymentAmount').value) || 0;
      const notes = document.getElementById('ptNotes').value.trim();

      // PT 상품 생성
      const { data: product, error: pErr } = await db.from('pt_products').insert({
        member_id: _currentMemberId,
        contract_date: contractDate,
        total_sessions: sessions,
        remaining_sessions: sessions,
        contract_trainer_id: trainerId,
        price_per_session: pricePerSession || null,
        notes: notes || null,
        is_active: true
      }).select('id').single();

      if (pErr) throw new Error(pErr.message);

      // 결제 기록 (금액이 있을 때만)
      if (paymentAmt > 0) {
        const m = _allMembers.find(x => x.id === _currentMemberId);
        const t = _allTrainers.find(x => x.id === trainerId);
        const { error: payErr } = await db.from('payment_records').insert({
          payment_date: contractDate,
          member_name: m?.name || '',
          member_id: _currentMemberId,
          total_sessions: sessions,
          payment_amount: paymentAmt,
          // net_amount, price_per_session은 DB GENERATED 컬럼 — 자동 계산
          trainer_id: trainerId,
          trainer_name: t?.name || '',
          pt_product_id: product.id
        });

        if (payErr) {
          // 롤백: PT 상품 삭제
          await db.from('pt_products').delete().eq('id', product.id);
          throw new Error('결제 기록 실패');
        }
      }

      closeModal('addPtModal');
      showToast('PT 상품 추가 완료');
      await loadPtProducts(_currentMemberId);
    } catch (e) {
      err.textContent = e.message; err.style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  });

  // 담당 트레이너 변경
  function openChangeTrainer(productId, contractTrainerId) {
    _ctProductId = productId;
    const err = document.getElementById('ctErr');
    err.style.display = 'none';

    const ct = _allTrainers.find(t => t.id === contractTrainerId);
    document.getElementById('ctContractName').textContent = ct?.name || '미지정';

    const m = _allMembers.find(x => x.id === _currentMemberId);
    const sel = document.getElementById('ctTrainerSel');
    sel.innerHTML = _allTrainers
      .filter(t => t.is_active && t.gym_location === m?.gym_location)
      .map(t => `<option value="${escAttr(t.id)}" ${t.id === m?.trainer_id ? 'selected' : ''}>${esc(t.name)}</option>`)
      .join('');

    openModal('changeTrainerModal');
  }

  document.getElementById('btnCtSave').addEventListener('click', async () => {
    const newTrainerId = document.getElementById('ctTrainerSel').value;
    const btn = document.getElementById('btnCtSave');
    btn.disabled = true;

    const { error } = await db.from('members')
      .update({ trainer_id: newTrainerId })
      .eq('id', _currentMemberId);

    btn.disabled = false;
    if (error) { console.error('Trainer change error:', error); showToast('변경에 실패했습니다'); return; }

    // 로컬 캐시 업데이트
    const m = _allMembers.find(x => x.id === _currentMemberId);
    if (m) m.trainer_id = newTrainerId;

    closeModal('changeTrainerModal');
    showToast('담당 트레이너 변경 완료');
    await loadPtProducts(_currentMemberId);
  });


  // ================================================================
  // MEMBER ADD
  // ================================================================

  document.getElementById('btnAddMember').addEventListener('click', () => {
    openModal('addMemberModal');
    document.getElementById('mName').value = '';
    document.getElementById('mSuffix').value = '';
    document.getElementById('mNotes').value = '';
    document.getElementById('mContractDate').value = '';
    document.getElementById('mSessions').value = '';
    document.getElementById('mPricePerSession').value = '';
    document.getElementById('mPaymentAmount').value = '';
    document.getElementById('memberErr').style.display = 'none';
    document.getElementById('mNameHint').textContent = '';
    document.getElementById('mSuffixField').style.display = 'none';
    filterTrainersByGym(document.getElementById('mGym').value);
  });

  document.getElementById('mGym').addEventListener('change', (e) => {
    filterTrainersByGym(e.target.value);
  });

  function filterTrainersByGym(gym) {
    const opts = _allTrainers
      .filter(t => t.is_active && t.gym_location === gym)
      .map(t => `<option value="${escAttr(t.id)}">${esc(t.name)}</option>`)
      .join('');
    document.getElementById('mTrainer').innerHTML = opts;
    document.getElementById('mContractTrainer').innerHTML = opts;
  }

  document.getElementById('mName').addEventListener('input', () => {
    const name = document.getElementById('mName').value.trim();
    const dup = _allMembers.find(m => m.name === name);
    const hint = document.getElementById('mNameHint');
    const suffix = document.getElementById('mSuffixField');
    if (dup) {
      hint.textContent = '동일한 이름의 회원이 있습니다. 구분 접미사를 입력하세요.';
      hint.style.color = 'var(--color-warning)';
      suffix.style.display = '';
    } else {
      hint.textContent = '';
      suffix.style.display = 'none';
    }
  });

  document.getElementById('mPricePerSession').addEventListener('input', calcMemberPayment);
  document.getElementById('mSessions').addEventListener('input', calcMemberPayment);

  function calcMemberPayment() {
    const price = parseInt(document.getElementById('mPricePerSession').value) || 0;
    const sessions = parseInt(document.getElementById('mSessions').value) || 0;
    if (price && sessions) {
      document.getElementById('mPaymentAmount').value = Math.round(price * sessions * 1.1);
    }
  }

  document.getElementById('btnAddMember').addEventListener('click', addMember);

  async function addMember() {
    const err = document.getElementById('memberErr');
    const btn = document.getElementById('btnAddMember');
    err.style.display = 'none';

    let name = document.getElementById('mName').value.trim();
    const suffix = document.getElementById('mSuffix').value.trim();
    if (suffix) name += suffix;

    const gym = document.getElementById('mGym').value;
    const trainerId = document.getElementById('mTrainer').value;
    const notes = document.getElementById('mNotes').value.trim();

    if (!name) { err.textContent = '이름을 입력해주세요'; err.style.display = 'block'; return; }
    if (!trainerId) { err.textContent = '담당 트레이너를 선택해주세요'; err.style.display = 'block'; return; }

    btn.disabled = true;
    try {
      // 회원 생성
      const { data: member, error: mErr } = await db.from('members').insert({
        name, gym_location: gym, trainer_id: trainerId, notes: notes || null, is_active: true
      }).select('id').single();

      if (mErr) throw new Error(mErr.message);

      // PT 상품 (선택 입력)
      const contractDate = document.getElementById('mContractDate').value;
      const sessions = parseInt(document.getElementById('mSessions').value);
      const contractTrainer = document.getElementById('mContractTrainer').value;

      if (contractDate && sessions && sessions > 0 && contractTrainer) {
        const pricePerSession = parseInt(document.getElementById('mPricePerSession').value) || 0;
        const paymentAmt = parseInt(document.getElementById('mPaymentAmount').value) || 0;

        const { data: product, error: pErr } = await db.from('pt_products').insert({
          member_id: member.id,
          contract_date: contractDate,
          total_sessions: sessions,
          remaining_sessions: sessions,
          contract_trainer_id: contractTrainer,
          price_per_session: pricePerSession || null,
          is_active: true
        }).select('id').single();

        if (pErr) {
          await db.from('members').delete().eq('id', member.id);
          throw new Error('PT 상품 생성 실패: ' + pErr.message);
        }

        if (paymentAmt > 0) {
          const t = _allTrainers.find(x => x.id === contractTrainer);
          const { error: payErr } = await db.from('payment_records').insert({
            payment_date: contractDate,
            member_name: name,
            member_id: member.id,
            total_sessions: sessions,
            payment_amount: paymentAmt,
            // net_amount, price_per_session은 DB GENERATED 컬럼
            trainer_id: contractTrainer,
            trainer_name: t?.name || '',
            pt_product_id: product.id
          });

          if (payErr) {
            await db.from('payment_records').delete().eq('pt_product_id', product.id);
            await db.from('pt_products').delete().eq('id', product.id);
            await db.from('members').delete().eq('id', member.id);
            throw new Error('결제 기록 실패');
          }
        }
      }

      closeModal('addMemberModal');
      showToast(`${name} 회원 추가 완료`);
      await loadMembers();
    } catch (e) {
      err.textContent = e.message; err.style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  }


  // ================================================================
  // EXERCISE DB
  // ================================================================

  async function loadExercise() {
    const { data, error } = await db.rpc('get_all_exercise_refs');
    if (error) { showToast('운동 DB 로드 실패'); return; }
    _allExercises = data || [];
    _exFiltered = _allExercises;
    _exShowCount = 50;
    buildExFilters();
    renderExList();
  }

  function buildExFilters() {
    const tools = [...new Set(_allExercises.map(e => e.tool_unified).filter(Boolean))].sort();
    const parts = [...new Set(_allExercises.map(e => e.part_unified).filter(Boolean))].sort();

    document.getElementById('toolFilter').innerHTML =
      `<button class="chip ${!_exToolFilter ? 'active' : ''}" data-tool="">전체</button>` +
      tools.map(t => `<button class="chip ${_exToolFilter === t ? 'active' : ''}" data-tool="${escAttr(t)}">${esc(t)}</button>`).join('');

    document.getElementById('partFilter').innerHTML =
      `<button class="chip ${!_exPartFilter ? 'active' : ''}" data-part="">전체</button>` +
      parts.map(p => `<button class="chip ${_exPartFilter === p ? 'active' : ''}" data-part="${escAttr(p)}">${esc(p)}</button>`).join('');

    // 이벤트
    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => { _exToolFilter = btn.dataset.tool; _exShowCount = 50; buildExFilters(); filterExercise(); });
    });
    document.querySelectorAll('[data-part]').forEach(btn => {
      btn.addEventListener('click', () => { _exPartFilter = btn.dataset.part; _exShowCount = 50; buildExFilters(); filterExercise(); });
    });
  }

  document.getElementById('exSearch').addEventListener('input', () => { _exShowCount = 50; filterExercise(); });
  document.getElementById('exClear').addEventListener('click', () => {
    document.getElementById('exSearch').value = '';
    _exShowCount = 50;
    filterExercise();
  });

  function filterExercise() {
    const q = document.getElementById('exSearch').value.trim().toLowerCase().replace(/\s/g, '');
    let list = _allExercises;

    if (_exToolFilter) list = list.filter(e => (e.tool_unified || '') === _exToolFilter);
    if (_exPartFilter) list = list.filter(e => (e.part_unified || '').includes(_exPartFilter));
    if (q) {
      list = list.filter(e => {
        const ko = (e.name_ko || '').toLowerCase().replace(/\s/g, '');
        const en = (e.name_en || '').toLowerCase().replace(/\s/g, '');
        return ko.includes(q) || en.includes(q);
      });
    }

    _exFiltered = list;
    document.getElementById('exStatBar').textContent = `${list.length}개 / 전체 ${_allExercises.length}개`;
    renderExList();
  }

  function renderExList() {
    const list = _exFiltered.slice(0, _exShowCount);
    let html = '';
    list.forEach(ex => {
      html += `<div class="ex-card" data-ex-id="${escAttr(ex.id)}">
        <div class="ex-card-row">
          ${ex.image_url ? `<img class="ex-thumb" src="${esc(ex.image_url)}" loading="lazy" onerror="this.style.display='none'">` : ''}
          <div style="flex:1;min-width:0;">
            <div class="ex-name">${esc(ex.name_ko || ex.name_en)}</div>
            <div class="ex-en">${esc(ex.name_en || '')}</div>
            <div class="chips gap-1 mt-2">
              ${ex.tool_unified ? `<span class="tag tag-accent">${esc(ex.tool_unified)}</span>` : ''}
              ${ex.part_unified ? `<span class="tag tag-muted">${esc(ex.part_unified)}</span>` : ''}
            </div>
          </div>
        </div>
      </div>`;
    });

    if (_exFiltered.length > _exShowCount) {
      html += `<button class="btn btn-md btn-ghost btn-block mt-3" id="exMoreBtn">더보기 (+50)</button>`;
    }

    document.getElementById('exerciseList').innerHTML = html;

    // 더보기
    document.getElementById('exMoreBtn')?.addEventListener('click', () => {
      _exShowCount += 50;
      renderExList();
    });
  }

  // 운동 카드 클릭 → 상세
  document.getElementById('exerciseList').addEventListener('click', (e) => {
    const card = e.target.closest('.ex-card');
    if (card) openExDetail(card.dataset.exId);
  });

  async function openExDetail(id) {
    _currentExId = id;
    const ex = _allExercises.find(e => e.id === id);
    if (!ex) return;

    document.getElementById('exDetailNameKo').textContent = ex.name_ko || ex.name_en || '';
    document.getElementById('exDetailNameEn').textContent = ex.name_en || '';

    const img = document.getElementById('exDetailImg');
    if (ex.image_url) { img.src = ex.image_url; img.style.display = ''; }
    else img.style.display = 'none';

    document.getElementById('exDetailTags').innerHTML =
      `${ex.tool_unified ? `<span class="tag tag-accent">${esc(ex.tool_unified)}</span>` : ''}
       ${ex.part_unified ? `<span class="tag tag-muted">${esc(ex.part_unified)}</span>` : ''}`;

    // 근육 정보 로드
    const { data } = await db.from('exercise_refs')
      .select('primary_muscle, synergist_1, synergist_2, is_stretch')
      .eq('id', id).single();

    if (data) {
      document.getElementById('exEditPrimary').value = data.primary_muscle || '';
      document.getElementById('exEditSyn1').value = data.synergist_1 || '';
      document.getElementById('exEditSyn2').value = data.synergist_2 || '';
      document.getElementById('exEditStretch').value = data.is_stretch ? 'true' : 'false';

      let muscleHtml = '';
      if (data.primary_muscle) muscleHtml += `<span class="tag tag-accent">${esc(data.primary_muscle)}</span>`;
      if (data.synergist_1) muscleHtml += `<span class="tag tag-muted">${esc(data.synergist_1)}</span>`;
      if (data.synergist_2) muscleHtml += `<span class="tag tag-muted">${esc(data.synergist_2)}</span>`;
      document.getElementById('exDetailMuscles').innerHTML = muscleHtml
        ? `<div class="chips gap-1">${muscleHtml}</div>`
        : '<div class="empty" style="padding:var(--space-2);">근육 정보 없음</div>';
    }

    openModal('exDetailModal');
  }

  document.getElementById('btnSaveExMuscle').addEventListener('click', async () => {
    const { error } = await db.from('exercise_refs').update({
      primary_muscle: document.getElementById('exEditPrimary').value.trim() || null,
      synergist_1: document.getElementById('exEditSyn1').value.trim() || null,
      synergist_2: document.getElementById('exEditSyn2').value.trim() || null,
      is_stretch: document.getElementById('exEditStretch').value === 'true'
    }).eq('id', _currentExId);

    if (error) { showToast('저장 실패'); return; }
    showToast('근육 정보 저장 완료');
    closeModal('exDetailModal');
  });


  // ================================================================
  // REQUESTS
  // ================================================================

  async function loadRequests() {
    const { data, error } = await loadAll('requests',
      'id, trainer_id, type, content, status, admin_note, created_at, trainers(name)',
      null,
      { orderBy: 'created_at', ascending: false }
    );
    if (error) { showToast('요청 로드 실패'); return; }

    const reqs = data || [];
    const pending = reqs.filter(r => r.status === 'pending');
    const completed = reqs.filter(r => r.status === 'approved');

    document.getElementById('reqCount').textContent = pending.length ? `(${pending.length}건 대기)` : '';

    const typeLabel = { db_add: 'DB 추가', bug_report: '버그', other: '기타' };
    const renderReq = (r) => `
      <div class="req-card">
        <div class="req-header">
          <span class="badge ${r.type === 'db_add' ? 'badge-info' : r.type === 'bug_report' ? 'badge-danger' : 'badge-neutral'}">${esc(typeLabel[r.type] || r.type)}</span>
          <span class="req-meta">${esc(r.trainers?.name || '')} · ${formatDateShort(r.created_at)}</span>
        </div>
        <div class="req-content">${esc(r.content)}</div>
        ${r.admin_note ? `<div class="req-meta">관리자 메모: ${esc(r.admin_note)}</div>` : ''}
        ${r.status === 'pending' ? `
          <div class="req-actions">
            <button class="btn btn-sm btn-secondary" data-req-action="complete" data-req-id="${escAttr(r.id)}">완료</button>
            <button class="btn btn-sm btn-danger" data-req-action="delete" data-req-id="${escAttr(r.id)}">삭제</button>
          </div>` : ''}
      </div>`;

    let html = '';
    if (pending.length) {
      html += `<div class="sec-header mt-3"><span class="sec-title" style="font-size:var(--text-sm)">대기 중</span></div>`;
      pending.forEach(r => html += renderReq(r));
    }
    if (completed.length) {
      html += `<div class="sec-header mt-3"><span class="sec-title" style="font-size:var(--text-sm)">완료</span></div>`;
      completed.slice(0, 20).forEach(r => html += renderReq(r));
    }

    document.getElementById('reqList').innerHTML = html || '<div class="empty">요청이 없습니다</div>';
  }

  // 요청 이벤트 위임
  document.getElementById('reqList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-req-action]');
    if (!btn) return;
    const { reqAction, reqId } = btn.dataset;

    if (reqAction === 'complete') {
      await db.from('requests').update({ status: 'approved' }).eq('id', reqId);
      showToast('완료 처리됨');
      await loadRequests();
    }
    if (reqAction === 'delete') {
      if (await showConfirm('요청을 삭제할까요?', { danger: true })) {
        await db.from('requests').update({ status: 'cancelled' }).eq('id', reqId);
        showToast('삭제 완료');
        await loadRequests();
      }
    }
  });


  // ================================================================
  // SCHEDULE TAB
  // ================================================================

  async function loadScheduleTab() {
    if (!scTrainersLoaded) {
      const { data } = await db.from('trainers')
        .select('id, name, gym_location')
        .eq('is_active', true)
        .order('name');
      _scAllTrainers = data || [];
      scTrainersLoaded = true;

      const gyms = [...new Set(_scAllTrainers.map(t => t.gym_location))].sort();
      const sel = document.getElementById('scBranchSel');
      sel.innerHTML = `<option value="">전체</option>` +
        gyms.map(g => `<option value="${escAttr(g)}">${esc(g)}</option>`).join('');
    }

    if (!scStart) {
      const d = new Date();
      d.setDate(d.getDate() - d.getDay() + 1); // 월요일
      scStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    await scRefresh();
  }

  document.getElementById('scBranchSel').addEventListener('change', scRefresh);
  document.getElementById('scPrev').addEventListener('click', () => { scStart.setDate(scStart.getDate() - 7); scRefresh(); });
  document.getElementById('scNext').addEventListener('click', () => { scStart.setDate(scStart.getDate() + 7); scRefresh(); });

  async function scRefresh() {
    const branch = document.getElementById('scBranchSel').value;
    const startStr = formatDate(scStart);
    const endDate = new Date(scStart); endDate.setDate(endDate.getDate() + 6);
    const endStr = formatDate(endDate);

    let query = db.from('schedules')
      .select('id, trainer_id, member_id, sched_date, start_time, end_time, type, status, session_number, auto_completed, notes, pt_product_id, members(name), trainers(name), pt_products(total_sessions, remaining_sessions)')
      .gte('sched_date', startStr)
      .lte('sched_date', endStr)
      .order('sched_date').order('start_time');

    if (branch) {
      const tIds = _scAllTrainers.filter(t => t.gym_location === branch).map(t => t.id);
      if (tIds.length) query = query.in('trainer_id', tIds);
    }

    const { data } = await query;
    scData = data || [];

    if (!scSelectedDate || scSelectedDate < startStr || scSelectedDate > endStr) {
      scSelectedDate = formatDate(new Date());
      if (scSelectedDate < startStr) scSelectedDate = startStr;
      if (scSelectedDate > endStr) scSelectedDate = endStr;
    }

    scRenderDatePills();
    scRenderDayView();
  }

  function scRenderDatePills() {
    const days = ['일','월','화','수','목','금','토'];
    const todayStr = formatDate(new Date());
    let html = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(scStart);
      d.setDate(d.getDate() + i);
      const ds = formatDate(d);
      const isToday = ds === todayStr;
      const isActive = ds === scSelectedDate;
      html += `<div class="sc-date-pill ${isActive ? 'active' : ''} ${isToday ? 'today' : ''}" data-date="${ds}">
        <div class="pill-num">${d.getDate()}</div>
        <div class="pill-day">${days[d.getDay()]}</div>
      </div>`;
    }
    document.getElementById('scDatePills').innerHTML = html;

    const endDate = new Date(scStart); endDate.setDate(endDate.getDate() + 6);
    document.getElementById('scRange').textContent =
      `${scStart.getMonth()+1}/${scStart.getDate()} - ${endDate.getMonth()+1}/${endDate.getDate()}`;

    // 날짜 필 클릭
    document.querySelectorAll('.sc-date-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        scSelectedDate = pill.dataset.date;
        scRenderDatePills();
        scRenderDayView();
      });
    });
  }

  function scRenderDayView() {
    const daySessions = scData.filter(s => s.sched_date === scSelectedDate);
    const branch = document.getElementById('scBranchSel').value;
    const trainers = branch
      ? _scAllTrainers.filter(t => t.gym_location === branch)
      : _scAllTrainers;

    let html = '';

    // 전체 시간표 버튼
    html += `<div style="margin-bottom:var(--space-3);">
      <button class="btn btn-sm btn-secondary" id="btnBranchSched">전체 시간표</button>
    </div>`;

    trainers.forEach(t => {
      const sessions = daySessions
        .filter(s => s.trainer_id === t.id && s.status !== 'cancelled')
        .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

      html += `<div class="sc-trainer-col">
        <div class="sc-trainer-col-hdr">${esc(t.name)} <span style="color:var(--text-tertiary);font-weight:normal;">(${sessions.length}건)</span></div>`;

      if (sessions.length === 0) {
        html += `<div class="empty" style="padding:var(--space-3);">일정 없음</div>`;
      } else {
        sessions.forEach(s => {
          const statusColors = {
            scheduled: '', completed: 'var(--color-success)', noshow: 'var(--color-warning)'
          };
          const statusLabels = {
            scheduled: '예정', completed: '완료', noshow: '노쇼'
          };
          const memberName = s.members?.name || s.type;
          const pt = calcPtSession(s, scData);

          html += `<div class="sc-session" data-sched='${escAttr(JSON.stringify({id:s.id}))}'>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span class="sc-session-time">${formatTime(s.start_time)}${s.end_time ? '-'+formatTime(s.end_time) : ''}</span>
              <span class="badge ${s.status === 'completed' ? 'badge-success' : s.status === 'noshow' ? 'badge-warning' : 'badge-info'}">${esc(statusLabels[s.status] || s.status)}</span>
            </div>
            <div class="sc-session-name">${esc(memberName)}${pt.num ? ` (${pt.num}/${pt.total})` : ''}</div>
            ${s.auto_completed ? '<div style="font-size:10px;color:var(--text-tertiary);">자동완료</div>' : ''}
          </div>`;
        });
      }

      html += `</div>`;
    });

    document.getElementById('scDayView').innerHTML = html;

    // 전체 시간표 버튼
    document.getElementById('btnBranchSched')?.addEventListener('click', () => {
      window.openBranchSchedModal(scSelectedDate);
    });

    // 세션 클릭 → 상세 모달
    document.querySelectorAll('.sc-session').forEach(el => {
      el.addEventListener('click', () => {
        const data = JSON.parse(el.dataset.sched);
        scOpenInfo(data.id);
      });
    });
  }


  // ================================================================
  // SCHEDULE INFO MODAL
  // ================================================================

  function scOpenInfo(schedId) {
    scTarget = scData.find(s => s.id === schedId);
    if (!scTarget) return;

    const s = scTarget;
    document.getElementById('scInfoMember').textContent = s.members?.name || s.type;

    const statusLabels = { scheduled: '예정', completed: '완료', noshow: '노쇼', cancelled: '취소' };
    document.getElementById('scInfoStatus').innerHTML =
      `<span class="badge ${s.status === 'completed' ? 'badge-success' : s.status === 'noshow' ? 'badge-warning' : s.status === 'cancelled' ? 'badge-neutral' : 'badge-info'}">${statusLabels[s.status]}</span>`;

    const pt = calcPtSession(s, scData);
    document.getElementById('scInfoDetail').innerHTML = `
      <div style="margin-top:var(--space-3);font-size:var(--text-sm);color:var(--text-secondary);line-height:1.8;">
        날짜: ${formatDateShort(s.sched_date)}<br>
        시간: ${formatTime(s.start_time)}${s.end_time ? ' - ' + formatTime(s.end_time) : ''}<br>
        유형: ${esc(s.type)}<br>
        트레이너: ${esc(s.trainers?.name || '')}<br>
        ${pt.num ? `회차: ${pt.num}/${pt.total}<br>` : ''}
        ${s.notes ? `메모: ${esc(s.notes)}` : ''}
      </div>`;

    document.getElementById('scInfoErr').style.display = 'none';
    document.getElementById('scInfoWarn').style.display = 'none';
    document.getElementById('scConfirmArea').style.display = 'none';
    document.getElementById('scEditArea').style.display = 'none';

    scRenderInfoActions();
    openModal('scInfoModal');
  }

  function scRenderInfoActions() {
    const s = scTarget;
    if (!s) return;
    const el = document.getElementById('scInfoActions');
    let html = '<div style="display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-3);">';

    if (s.status === 'scheduled') {
      html += `<button class="btn btn-md btn-secondary" data-sc-action="complete">완료</button>`;
      html += `<button class="btn btn-md btn-danger" data-sc-action="noshow">노쇼</button>`;
      html += `<button class="btn btn-md btn-ghost" data-sc-action="cancel">취소</button>`;
      html += `<button class="btn btn-md btn-ghost" data-sc-action="edit">수정</button>`;
    }
    if (s.status === 'completed' || s.status === 'noshow') {
      html += `<button class="btn btn-md btn-ghost" data-sc-action="toggle">${s.status === 'completed' ? '노쇼로 변경' : '완료로 변경'}</button>`;
      html += `<button class="btn btn-md btn-danger" data-sc-action="rollback">롤백 (예약으로)</button>`;
      html += `<button class="btn btn-md btn-danger" data-sc-action="adminCancel">취소 (복원)</button>`;
      html += `<button class="btn btn-md btn-ghost" data-sc-action="edit">수정</button>`;
    }

    html += '</div>';
    el.innerHTML = html;

    // 이벤트
    el.querySelectorAll('[data-sc-action]').forEach(btn => {
      btn.addEventListener('click', () => handleScAction(btn.dataset.scAction));
    });
  }

  async function handleScAction(action) {
    const s = scTarget;
    if (!s) return;
    const errEl = document.getElementById('scInfoErr');
    errEl.style.display = 'none';
    let result;

    if (action === 'complete') result = await completeSession(s.id);
    else if (action === 'noshow') result = await noshowSession(s.id);
    else if (action === 'cancel') result = await cancelScheduledSession(s.id);
    else if (action === 'rollback') result = await rollbackSession(s.id);
    else if (action === 'adminCancel') result = await adminCancelCompletedSession(s.id);
    else if (action === 'toggle') result = await toggleSessionStatus(s.id);
    else if (action === 'edit') { scOpenEdit(); return; }

    if (result && result.ok) {
      closeModal('scInfoModal');
      showToast('처리 완료');
      await scRefresh();
    } else if (result && result.error) {
      errEl.textContent = result.error;
      errEl.style.display = 'block';
    }
  }

  function scOpenEdit() {
    const s = scTarget;
    if (!s) return;
    document.getElementById('scEditDate').value = s.sched_date || '';
    document.getElementById('scEditStart').value = s.start_time || '';
    document.getElementById('scEditEnd').value = s.end_time || '';
    document.getElementById('scInfoActions').style.display = 'none';
    document.getElementById('scEditArea').style.display = '';
  }

  document.getElementById('scEditCancel').addEventListener('click', () => {
    document.getElementById('scEditArea').style.display = 'none';
    document.getElementById('scInfoActions').style.display = '';
  });

  document.getElementById('scEditSave').addEventListener('click', async () => {
    const errEl = document.getElementById('scInfoErr');
    const date = document.getElementById('scEditDate').value;
    const start = document.getElementById('scEditStart').value;
    const end = document.getElementById('scEditEnd').value;

    if (!date || !start) {
      errEl.textContent = '날짜와 시작 시간을 입력해주세요';
      errEl.style.display = 'block';
      return;
    }

    const { error } = await db.from('schedules').update({
      sched_date: date,
      start_time: start,
      end_time: end || null
    }).eq('id', scTarget.id);

    if (error) {
      console.error('Schedule edit error:', error); errEl.textContent = '수정에 실패했습니다';
      errEl.style.display = 'block';
      return;
    }

    closeModal('scInfoModal');
    showToast('일정 수정 완료');
    await scRefresh();
  });


  // ================================================================
  // BRANCH SCHEDULE CANVAS (전체 시간표)
  // ================================================================

  window.openBranchSchedModal = function(dateStr) {
    const gym = document.getElementById('scBranchSel').value || _scAllTrainers[0]?.gym_location || '';
    document.getElementById('bsDatePicker').value = dateStr || scSelectedDate;
    document.getElementById('bsSubtitle').textContent = `${gym} · ${dateStr}`;

    (async () => {
      await loadBranchSchedule(gym, dateStr || scSelectedDate);
      drawBranchScheduleCanvas(
        document.getElementById('bsCanvas'),
        dateStr || scSelectedDate,
        gym
      );
    })();

    document.getElementById('branchSchedModal').classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  window.closeBranchSchedModal = function() {
    document.getElementById('branchSchedModal').classList.remove('open');
    document.body.style.overflow = '';
  };

  document.getElementById('bsBtnToday')?.addEventListener('click', () => {
    const today = formatDate(new Date());
    document.getElementById('bsDatePicker').value = today;
    window.openBranchSchedModal(today);
  });

  document.getElementById('bsBtnTomorrow')?.addEventListener('click', () => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    const tomorrow = formatDate(d);
    document.getElementById('bsDatePicker').value = tomorrow;
    window.openBranchSchedModal(tomorrow);
  });

  document.getElementById('bsDatePicker')?.addEventListener('change', (e) => {
    if (e.target.value) window.openBranchSchedModal(e.target.value);
  });

  document.getElementById('btnDownloadBs')?.addEventListener('click', () => {
    const date = document.getElementById('bsDatePicker').value || formatDate(new Date());
    downloadCanvasImage(document.getElementById('bsCanvas'), `veragym_${date}.png`);
  });


  // ================================================================
  // REVENUE TAB
  // ================================================================

  // 매출 서브탭
  document.querySelectorAll('[data-rev-sub]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-rev-sub]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.rev-sub-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`revSub-${btn.dataset.revSub}`).classList.add('active');

      if (btn.dataset.revSub === 'payments' && !_payDataLoaded) loadAllPayments();
      if (btn.dataset.revSub === 'stats' && !_payDataLoaded) loadAllPayments();
    });
  });

  async function loadAllPayments() {
    const [payRes, trRes] = await Promise.all([
      loadAll('payment_records', '*', null, { orderBy: 'payment_date', ascending: false }),
      loadAll('trainers', 'id, name', q => q.eq('is_active', true), { orderBy: 'name' })
    ]);
    _allPayments = payRes.data || [];
    _allTrainersList = trRes.data || [];
    _payDataLoaded = true;
    buildPayFilters();
    renderPayList();
  }

  function buildPayFilters() {
    const months = [...new Set(_allPayments.map(p => (p.payment_date || '').slice(0, 7)))].sort().reverse();
    document.getElementById('payMonthSel').innerHTML =
      `<option value="">전체</option>` +
      months.map(m => `<option value="${m}">${m}</option>`).join('');

    document.getElementById('payTrainerSel').innerHTML =
      `<option value="">전체</option>` +
      _allTrainersList.map(t => `<option value="${escAttr(t.id)}">${esc(t.name)}</option>`).join('');
  }

  document.getElementById('payMonthSel').addEventListener('change', renderPayList);
  document.getElementById('payTrainerSel').addEventListener('change', renderPayList);
  document.getElementById('paySearchInput').addEventListener('input', renderPayList);

  function renderPayList() {
    const month = document.getElementById('payMonthSel').value;
    const trainer = document.getElementById('payTrainerSel').value;
    const search = document.getElementById('paySearchInput').value.trim().toLowerCase();

    let filtered = _allPayments;
    if (month) filtered = filtered.filter(p => (p.payment_date || '').startsWith(month));
    if (trainer) filtered = filtered.filter(p => p.trainer_id === trainer);
    if (search) filtered = filtered.filter(p => (p.member_name || '').toLowerCase().includes(search));

    const totalAmt = filtered.reduce((s, p) => s + (p.payment_amount || 0), 0);
    const totalNet = filtered.reduce((s, p) => s + (p.net_amount || 0), 0);

    document.getElementById('payTotalCount').textContent = filtered.length;
    document.getElementById('payTotalAmt').textContent = formatWon(totalAmt);
    document.getElementById('payTotalNet').textContent = formatWon(totalNet);

    const list = filtered.slice(0, 100);
    let html = '';
    list.forEach(p => {
      html += `<div class="pay-item">
        <div class="pay-item-top">
          <span class="pay-item-name">${esc(p.member_name)}</span>
          <span class="pay-item-amt">${formatWon(p.payment_amount)}</span>
        </div>
        <div class="pay-item-sub">
          ${esc(p.trainer_name || '')} · ${p.total_sessions || 0}회 · ${formatDateDot(p.payment_date)}
          · 순매출 ${formatWon(p.net_amount)}
        </div>
      </div>`;
    });

    if (filtered.length > 100) {
      html += `<div class="empty">외 ${filtered.length - 100}건 (최근 100건만 표시)</div>`;
    }

    document.getElementById('payListWrap').innerHTML = html || '<div class="empty">결제 내역이 없습니다</div>';
  }

  // 예상매출 탭
  async function loadAdminRevenue() {
    const gym = document.getElementById('revGymSelect').value;
    if (!gym) {
      // 지점 선택지 생성
      const gyms = [...new Set(_allTrainers.filter(t => t.is_active).map(t => t.gym_location))].sort();
      const sel = document.getElementById('revGymSelect');
      if (!sel.options.length || sel.options.length <= 1) {
        sel.innerHTML = gyms.map(g => `<option value="${escAttr(g)}">${esc(g)}</option>`).join('');
      }
      if (!sel.value && gyms.length) sel.value = gyms[0];
    }

    const selectedGym = document.getElementById('revGymSelect').value;
    if (!selectedGym) return;

    const trainers = _allTrainers.filter(t => t.is_active && t.gym_location === selectedGym);
    const trIds = trainers.map(t => t.id);
    _admRevTrainers = trainers;

    const curMonth = _curMonth();
    const nextMonth = _nextMonth();
    const month = _admRevMonthMode === 'cur' ? curMonth : nextMonth;

    const [fcRes, payRes] = await Promise.all([
      db.from('sales_forecasts').select('*').in('trainer_id', trIds),
      loadByMonth('payment_records', '*', 'payment_date', curMonth,
        q => q.in('trainer_id', trIds)
      )
    ]);

    _admRevForecasts = fcRes.data || [];
    _admRevPayments = payRes.data || [];

    renderAdminRevSummary();
    renderAdminTrainerList();
  }

  document.getElementById('revGymSelect').addEventListener('change', loadAdminRevenue);

  document.getElementById('adminRevCur').addEventListener('click', () => {
    _admRevMonthMode = 'cur';
    document.getElementById('adminRevCur').className = 'btn btn-sm btn-secondary';
    document.getElementById('adminRevNext').className = 'btn btn-sm btn-ghost';
    renderAdminTrainerList();
  });

  document.getElementById('adminRevNext').addEventListener('click', () => {
    _admRevMonthMode = 'next';
    document.getElementById('adminRevNext').className = 'btn btn-sm btn-secondary';
    document.getElementById('adminRevCur').className = 'btn btn-sm btn-ghost';
    renderAdminTrainerList();
  });

  function renderAdminRevSummary() {
    const curMonth = _curMonth();
    const forecasts = _admRevForecasts.filter(f => (f.forecast_month || '').startsWith(curMonth) && f.status !== 'cancelled');
    const totalForecast = forecasts.reduce((s, f) => s + (f.amount || 0), 0);
    const totalAchieved = _admRevPayments.reduce((s, p) => s + (p.net_amount || 0), 0);

    document.getElementById('adminRevForecast').textContent = formatWon(totalForecast);
    document.getElementById('adminRevAchieved').textContent = formatWon(totalAchieved);
  }

  function renderAdminTrainerList() {
    const month = _admRevMonthMode === 'cur' ? _curMonth() : _nextMonth();
    let html = '';

    _admRevTrainers.forEach(t => {
      const forecasts = _admRevForecasts.filter(f =>
        f.trainer_id === t.id &&
        (f.forecast_month || '').startsWith(month) &&
        f.status !== 'cancelled'
      );
      const total = forecasts.reduce((s, f) => s + (f.amount || 0), 0);

      html += `<div class="card" style="cursor:default;">
        <div class="card-row">
          <div class="avatar">${esc(t.name[0])}</div>
          <div style="flex:1">
            <div class="card-name">${esc(t.name)}</div>
            <div class="card-sub">${forecasts.length}건</div>
          </div>
          <div style="font-weight:var(--font-bold);color:var(--accent);">${formatWon(total)}</div>
        </div>
      </div>`;
    });

    document.getElementById('adminRevTrainerList').innerHTML =
      html || '<div class="empty">트레이너가 없습니다</div>';
  }

  function _curMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function _nextMonth() {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }


  // ================================================================
  // LOGOUT
  // ================================================================

  document.getElementById('btnLogout').addEventListener('click', () => {
    doLogout('admin-login.html');
  });


  // ================================================================
  // MEMO MODAL (window 노출)
  // ================================================================

  window.showMemo = function(memberId) {
    const m = _allMembers.find(x => x.id === memberId);
    if (!m) return;
    document.getElementById('memoMemberName').textContent = m.name;
    document.getElementById('memoMemberMeta').textContent = m.gym_location || '';
    document.getElementById('memoContent').textContent = m.notes || '메모가 없습니다';
    openModal('memoModal');
  };

})();
