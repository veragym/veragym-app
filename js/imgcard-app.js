// ============================================================
// VERA GYM v2 — imgcard-app.js
// 이미지 카드 생성 (Canvas 기반 운동 프로그램 이미지)
// ============================================================

(function () {
  'use strict';

  initDb();
  preventBackExit();

  let me = null;
  let _exercises = []; // [{ refId, name, part, tool, weight_mode, image_url, sets }]
  let _searchDebounce = null;

  async function init() {
    me = await requireTrainer();
    if (!me) return;
    document.getElementById('trainerInfo').textContent = `${me.name} · ${me.gym_location}`;
    await Promise.all([loadExerciseDb(), loadMyLibrary(me.id), loadFreqMap(me.id)]);
  }

  init();

  document.getElementById('btnBack').addEventListener('click', () => history.back());

  // ================================================================
  // EXERCISE SEARCH
  // ================================================================

  document.getElementById('igSearch').addEventListener('input', () => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(renderSearchResults, 150);
  });

  document.getElementById('igSearchClear').addEventListener('click', () => {
    document.getElementById('igSearch').value = '';
    document.getElementById('igResults').style.display = 'none';
  });

  function renderSearchResults() {
    const q = (document.getElementById('igSearch').value || '').trim().toLowerCase().replace(/\s/g, '');
    if (!q) { document.getElementById('igResults').style.display = 'none'; return; }

    const list = filterExercises(q).slice(0, 20);
    if (!list.length) {
      document.getElementById('igResults').innerHTML = '<div class="empty" style="padding:var(--space-3);">결과 없음</div>';
      document.getElementById('igResults').style.display = '';
      return;
    }

    let html = '';
    list.forEach(ex => {
      html += `<div class="sr-item" data-add-ex="${escAttr(ex.id)}"
            data-name="${escAttr(ex.name_ko || ex.name_en)}"
            data-part="${escAttr(ex.part_unified || '')}"
            data-tool="${escAttr(ex.tool_unified || '')}"
            data-img="${escAttr(ex.image_url || '')}">
        <div style="flex:1;">
          <div class="sr-name">${esc(ex.name_ko || ex.name_en)}</div>
          <div class="sr-sub">${esc(ex.part_unified || '')} · ${esc(ex.tool_unified || '')}</div>
        </div>
      </div>`;
    });

    document.getElementById('igResults').innerHTML = html;
    document.getElementById('igResults').style.display = '';
  }

  document.getElementById('igResults').addEventListener('click', (e) => {
    const item = e.target.closest('[data-add-ex]');
    if (!item) return;

    _exercises.push({
      refId: item.dataset.addEx,
      name: item.dataset.name,
      part: item.dataset.part,
      tool: item.dataset.tool,
      image_url: item.dataset.img || null,
      weight_mode: defaultWeightMode(item.dataset.tool),
      sets: [{ weight: 0, reps: 0 }]
    });

    document.getElementById('igSearch').value = '';
    document.getElementById('igResults').style.display = 'none';
    renderExList();
  });


  // ================================================================
  // EXERCISE LIST RENDER
  // ================================================================

  function renderExList() {
    if (!_exercises.length) {
      document.getElementById('igExList').innerHTML = '<div class="empty" style="padding:var(--space-8);">운동을 검색하여 추가해주세요</div>';
      return;
    }

    let html = '';
    _exercises.forEach((ex, i) => {
      const wmLabel = ex.weight_mode === 'single' ? '한손' : '총중량';
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

      html += `<button class="sw-add-set" data-addset="${i}">+ 세트 추가</button></div>`;
    });

    document.getElementById('igExList').innerHTML = html;

    // 이벤트
    document.querySelectorAll('[data-set]').forEach(inp => {
      inp.addEventListener('change', () => {
        const [i, si, field] = inp.dataset.set.split('-');
        _exercises[parseInt(i)].sets[parseInt(si)][field] = Math.max(0, parseFloat(inp.value) || 0);
      });
    });
    document.querySelectorAll('[data-addset]').forEach(b => b.addEventListener('click', () => {
      const idx = parseInt(b.dataset.addset);
      const last = _exercises[idx].sets.at(-1) || { weight: 0, reps: 0 };
      _exercises[idx].sets.push({ ...last });
      renderExList();
    }));
    document.querySelectorAll('[data-delset]').forEach(b => b.addEventListener('click', () => {
      const [i, si] = b.dataset.delset.split('-').map(Number);
      if (_exercises[i].sets.length > 1) { _exercises[i].sets.splice(si, 1); renderExList(); }
    }));
    document.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
      _exercises.splice(parseInt(b.dataset.remove), 1);
      renderExList();
    }));
    document.querySelectorAll('[data-wm]').forEach(b => b.addEventListener('click', () => {
      const idx = parseInt(b.dataset.wm);
      _exercises[idx].weight_mode = _exercises[idx].weight_mode === 'single' ? 'total' : 'single';
      renderExList();
    }));
  }


  // ================================================================
  // ROUTINE LOAD
  // ================================================================

  document.getElementById('btnLoadRoutine').addEventListener('click', () => {
    routinePickerOpen({
      trainerId: me.id,
      withImageUrl: true,
      onSelect: async (exList) => {
        exList.forEach(ex => {
          _exercises.push({
            refId: ex.refId, name: ex.name, part: ex.part, tool: ex.tool,
            image_url: ex.image_url || null,
            weight_mode: ex.weight_mode || defaultWeightMode(ex.tool),
            sets: [{ weight: 0, reps: 0 }]
          });
        });
        renderExList();
        showToast('루틴 불러오기 완료');
      }
    });
  });


  // ================================================================
  // CANVAS IMAGE GENERATION
  // ================================================================

  async function buildCanvas() {
    // 입력 동기화
    document.querySelectorAll('[data-set]').forEach(inp => {
      const [i, si, field] = inp.dataset.set.split('-');
      _exercises[parseInt(i)].sets[parseInt(si)][field] = Math.max(0, parseFloat(inp.value) || 0);
    });

    const memberName = document.getElementById('igMember').value.trim() || '회원';
    const programName = document.getElementById('igProgram').value.trim() || '운동 프로그램';

    const dpr = 2;
    const W = 1080;
    const font = "'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif";

    // 높이 계산
    const headerH = 180;
    const exCardH = 120;
    const setRowH = 36;
    const exGap = 16;
    const footerH = 60;
    let totalH = headerH;
    _exercises.forEach(ex => {
      totalH += exCardH + ex.sets.length * setRowH + exGap;
    });
    totalH += footerH;

    const canvas = document.createElement('canvas');
    canvas.width = W * dpr;
    canvas.height = totalH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // 배경
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, totalH);

    // 헤더
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(0, 0, W, headerH);

    ctx.fillStyle = '#3b82f6';
    ctx.font = `bold 44px ${font}`;
    ctx.textAlign = 'center';
    ctx.fillText('VERA GYM', W / 2, 55);

    ctx.fillStyle = '#111827';
    ctx.font = `bold 36px ${font}`;
    ctx.fillText(memberName, W / 2, 105);

    ctx.fillStyle = '#6b7280';
    ctx.font = `24px ${font}`;
    ctx.fillText(programName, W / 2, 145);

    ctx.fillStyle = '#d1d5db';
    ctx.font = `16px ${font}`;
    ctx.fillText(formatDate(new Date()), W / 2, 170);

    // 운동 카드
    let y = headerH + 16;
    const margin = 32;
    const cardW = W - margin * 2;

    for (let i = 0; i < _exercises.length; i++) {
      const ex = _exercises[i];

      // 카드 배경
      canvasRoundRect(ctx, margin, y, cardW, exCardH + ex.sets.length * setRowH, 12);
      ctx.fillStyle = '#f9fafb';
      ctx.fill();
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 번호
      ctx.fillStyle = '#3b82f6';
      ctx.font = `bold 32px ${font}`;
      ctx.textAlign = 'left';
      ctx.fillText(`${i + 1}`, margin + 20, y + 40);

      // 운동명
      ctx.fillStyle = '#111827';
      ctx.font = `bold 28px ${font}`;
      ctx.fillText(ex.name, margin + 60, y + 38);

      // 도구/부위
      ctx.fillStyle = '#9ca3af';
      ctx.font = `18px ${font}`;
      ctx.fillText(`${ex.part} · ${ex.tool}${ex.weight_mode === 'single' ? ' · 한손' : ''}`, margin + 60, y + 68);

      // 세트 헤더
      const setY = y + 88;
      ctx.fillStyle = '#9ca3af';
      ctx.font = `bold 16px ${font}`;
      ctx.textAlign = 'center';
      ctx.fillText('세트', margin + 80, setY);
      ctx.fillText('중량(kg)', margin + 240, setY);
      ctx.fillText('횟수', margin + 400, setY);

      // 세트 데이터
      ex.sets.forEach((s, si) => {
        const sy = setY + 12 + (si + 1) * setRowH;
        ctx.fillStyle = '#374151';
        ctx.font = `bold 20px ${font}`;
        ctx.textAlign = 'center';
        ctx.fillText(`${si + 1}`, margin + 80, sy);
        ctx.fillText(`${s.weight}`, margin + 240, sy);
        ctx.fillText(`${s.reps}`, margin + 400, sy);
      });

      y += exCardH + ex.sets.length * setRowH + exGap;
    }

    // 푸터
    ctx.fillStyle = '#d1d5db';
    ctx.font = `14px ${font}`;
    ctx.textAlign = 'center';
    ctx.fillText('VERA GYM · Personal Training', W / 2, totalH - 20);

    return canvas;
  }

  // 저장
  document.getElementById('btnGenSave').addEventListener('click', async () => {
    if (!_exercises.length) { showToast('운동을 추가해주세요'); return; }
    showToast('이미지 생성 중...');
    const canvas = await buildCanvas();
    const name = document.getElementById('igMember').value.trim() || '회원';
    downloadCanvasImage(canvas, `veragym_${name}_${formatDate(new Date())}.png`);
  });

  // 공유
  document.getElementById('btnGenShare').addEventListener('click', async () => {
    if (!_exercises.length) { showToast('운동을 추가해주세요'); return; }
    if (!navigator.share) { showToast('이 기기에서 공유를 지원하지 않습니다'); return; }
    showToast('이미지 생성 중...');
    const canvas = await buildCanvas();
    canvas.toBlob(async (blob) => {
      if (!blob) { showToast('이미지 생성 실패'); return; }
      const name = document.getElementById('igMember').value.trim() || '회원';
      const file = new File([blob], `veragym_${name}.png`, { type: 'image/png' });
      try {
        await navigator.share({ files: [file], title: `${name} 운동 프로그램` });
      } catch (e) {
        if (e.name !== 'AbortError') showToast('공유 실패');
      }
    }, 'image/png');
  });

})();
