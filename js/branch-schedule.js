// ============================================================
// VERA GYM v2 — branch-schedule.js
// 지점 전체 시간표 (admin + trainer 공통)
// ============================================================

// ── 상태 ──────────────────────────────────────────────────

let _bsTrainers = [];
let _bsSchedules = [];
let _bsDayOffset = 0;

// ── 일정 유형별 색상 ─────────────────────────────────────

const SCHED_TYPE_COLORS = {
  PT:   { color: '#6c63ff', bg: '#e8e4ff', cell: '#e8e4ff' },
  SPT:  { color: '#f59e0b', bg: '#fffbeb', cell: '#fffde7' },
  업무: { color: '#22c55e', bg: '#f0fdf4', cell: '#e8f5e9' },
  청소: { color: '#3b82f6', bg: '#eff6ff', cell: '#e3f2fd' },
  홍보: { color: '#ec4899', bg: '#fdf2f8', cell: '#fce4ec' },
  식사: { color: '#f87171', bg: '#fef2f2', cell: '#ffebee' },
};

// ── Canvas 유틸 ───────────────────────────────────────────

/**
 * Canvas 둥근 사각형
 */
function canvasRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * 이름 정리 (지점명 제거 등)
 */
function cleanTrainerName(raw) {
  if (!raw) return '';
  return raw.replace(/\s*[\[(（].*$/, '').trim();
}


// ── 데이터 로드 ──────────────────────────────────────────

/**
 * 지점 시간표 데이터 로드
 * @param {string} gymLocation - 지점
 * @param {string} dateStr - 날짜 (YYYY-MM-DD)
 */
async function loadBranchSchedule(gymLocation, dateStr) {
  // 트레이너 목록
  const { data: trainers } = await db.from('trainers')
    .select('id, name')
    .eq('gym_location', gymLocation)
    .eq('is_active', true)
    .eq('is_admin', false)
    .order('name');

  _bsTrainers = (trainers || []).slice(0, 10);

  if (!_bsTrainers.length) return;

  const ids = _bsTrainers.map(t => t.id);

  // 해당 날짜 일정
  const { data: scheds } = await db.from('schedules')
    .select('id, trainer_id, member_id, sched_date, start_time, end_time, type, status, members(name)')
    .in('trainer_id', ids)
    .eq('sched_date', dateStr)
    .neq('status', 'cancelled')
    .order('start_time');

  _bsSchedules = scheds || [];
}


// ── Canvas 렌더링 ────────────────────────────────────────

/**
 * 지점 시간표 Canvas 그리기
 * @param {HTMLCanvasElement} canvas
 * @param {string} dateStr
 * @param {string} gymLocation
 */
function drawBranchScheduleCanvas(canvas, dateStr, gymLocation) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 2;

  // 시간 범위 계산
  const hours = [];
  for (let h = 6; h <= 22; h++) hours.push(h);

  const colW = 120;
  const headerH = 60;
  const timeColW = 50;
  const rowH = 50;
  const totalW = timeColW + colW * _bsTrainers.length + 80;
  const totalH = headerH + rowH * hours.length + 100;

  canvas.width = totalW * dpr;
  canvas.height = totalH * dpr;
  canvas.style.width = totalW + 'px';
  canvas.style.height = totalH + 'px';
  ctx.scale(dpr, dpr);

  // 배경
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalW, totalH);

  // 폰트
  const fontFamily = "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

  // 헤더: 제목
  ctx.fillStyle = '#111827';
  ctx.font = `bold 20px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.fillText(`VERA GYM ${gymLocation}`, totalW / 2, 28);

  ctx.fillStyle = '#6b7280';
  ctx.font = `14px ${fontFamily}`;
  ctx.fillText(dateStr, totalW / 2, 48);

  // 트레이너 헤더
  _bsTrainers.forEach((t, i) => {
    const x = timeColW + i * colW;
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(x, headerH, colW, 24);
    ctx.fillStyle = '#374151';
    ctx.font = `bold 11px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.fillText(cleanTrainerName(t.name), x + colW / 2, headerH + 16);
  });

  // 시간 행
  hours.forEach((h, ri) => {
    const y = headerH + 24 + ri * rowH;

    // 배경 줄무늬
    ctx.fillStyle = ri % 2 === 0 ? '#ffffff' : '#f9fafb';
    ctx.fillRect(timeColW, y, totalW - timeColW, rowH);

    // 시간 라벨
    ctx.fillStyle = '#9ca3af';
    ctx.font = `10px ${fontFamily}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${String(h).padStart(2, '0')}:00`, timeColW - 6, y + 14);

    // 구분선
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(timeColW, y);
    ctx.lineTo(totalW, y);
    ctx.stroke();
  });

  // 일정 블록 렌더
  _bsSchedules.forEach(s => {
    const ti = _bsTrainers.findIndex(t => t.id === s.trainer_id);
    if (ti < 0) return;

    const [sh, sm] = (s.start_time || '06:00').split(':').map(Number);
    const [eh, em] = (s.end_time || '07:00').split(':').map(Number);
    const startMin = (sh - 6) * 60 + sm;
    const endMin = (eh - 6) * 60 + em;
    const duration = Math.max(endMin - startMin, 30);

    const x = timeColW + ti * colW + 2;
    const y = headerH + 24 + (startMin / 60) * rowH;
    const h = (duration / 60) * rowH;
    const w = colW - 4;

    const typeInfo = SCHED_TYPE_COLORS[s.type] || SCHED_TYPE_COLORS.PT;

    // 블록 배경
    canvasRoundRect(ctx, x, y, w, h, 4);
    ctx.fillStyle = typeInfo.cell;
    ctx.fill();

    // 블록 텍스트
    ctx.fillStyle = typeInfo.color;
    ctx.font = `bold 10px ${fontFamily}`;
    ctx.textAlign = 'left';

    const memberName = s.members?.name || '';
    const label = s.type === 'PT' ? memberName : s.type;
    ctx.fillText(label, x + 4, y + 13);

    if (h > 24) {
      ctx.fillStyle = '#6b7280';
      ctx.font = `9px ${fontFamily}`;
      ctx.fillText(formatTime(s.start_time) + '-' + formatTime(s.end_time), x + 4, y + 24);
    }
  });

  // 워터마크
  ctx.fillStyle = '#d1d5db';
  ctx.font = `10px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.fillText('VERA GYM', totalW / 2, totalH - 10);
}


// ── iOS 이미지 저장 호환 ─────────────────────────────────

/**
 * Canvas를 이미지로 저장/공유
 * @param {HTMLCanvasElement} canvas
 * @param {string} filename
 */
function downloadCanvasImage(canvas, filename) {
  canvas.toBlob(blob => {
    if (!blob) { showToast('이미지 생성 실패'); return; }

    if (/iPhone|iPad/i.test(navigator.userAgent) && navigator.share) {
      const file = new File([blob], filename, { type: 'image/png' });
      navigator.share({ files: [file] }).catch(() => {
        _fallbackDownload(blob, filename);
      });
    } else {
      _fallbackDownload(blob, filename);
    }
  }, 'image/png');
}

function _fallbackDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
