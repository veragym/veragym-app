// ============================================================
// VERA GYM v2 — exercise-picker.js
// 운동 검색/선택/세트 관리 (session-write + image-card 공통)
// ============================================================

// ── 상태 ──────────────────────────────────────────────────

let _pickerExercises = [];  // 선택된 운동 목록
let _allExerciseDb = [];    // 전체 운동 DB
let _myLibrary = [];        // 내 라이브러리
let _freqMap = {};          // 사용 빈도
let _pickerFilter = '';     // 현재 필터 (부위)
let _pickerToolFilter = ''; // 도구 필터

// ── 운동 DB 로드 ──────────────────────────────────────────

const _EX_CACHE_KEY = 'vg_exdb_cache_v2';
const _EX_CACHE_TTL = 5 * 60 * 1000; // 5분

async function loadExerciseDb() {
  // 캐시 확인
  try {
    const raw = sessionStorage.getItem(_EX_CACHE_KEY);
    if (raw) {
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts < _EX_CACHE_TTL && data?.length) {
        _allExerciseDb = data;
        return data;
      }
    }
  } catch (_) {}

  // DB 로드
  const { data, error } = await db.rpc('get_all_exercise_refs');
  if (error) {
    console.error('운동 DB 로드 실패:', error);
    return [];
  }

  _allExerciseDb = data || [];

  // 캐시 저장
  try {
    sessionStorage.setItem(_EX_CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      data: _allExerciseDb
    }));
  } catch (_) {}

  return _allExerciseDb;
}


// ── 내 라이브러리 로드 ────────────────────────────────────

async function loadMyLibrary(trainerId) {
  if (!trainerId) return;
  const { data } = await db.from('trainer_exercise_library')
    .select('exercise_ref_id')
    .eq('trainer_id', trainerId);
  _myLibrary = (data || []).map(d => d.exercise_ref_id);
}

async function loadFreqMap(trainerId) {
  if (!trainerId) return;
  const { data } = await db.rpc('get_exercise_freq', { p_trainer_id: trainerId });
  _freqMap = {};
  (data || []).forEach(r => { _freqMap[r.exercise_ref_id] = r.cnt; });
}


// ── 운동 선택 ─────────────────────────────────────────────

/**
 * 운동 추가
 * @param {Object} ex - 운동 정보 { id, refId, name, part, tool, image_url }
 */
function addExercise(ex) {
  _pickerExercises.push({
    ...ex,
    weight_mode: defaultWeightMode(ex.tool),
    sets: [{ weight: 0, reps: 0 }],
    comment: '',
    photos: { start: null, end: null }
  });
}

/**
 * 운동 코멘트 업데이트
 * @param {number} idx - 인덱스
 * @param {string} val - 코멘트 내용
 */
function updateComment(idx, val) {
  const ex = _pickerExercises[idx];
  if (ex) ex.comment = val || '';
}

/**
 * 운동 제거
 * @param {number} idx - 인덱스
 */
function removeExercise(idx) {
  _pickerExercises.splice(idx, 1);
}


// ── 세트 관리 ─────────────────────────────────────────────

function addSet(exIdx) {
  const ex = _pickerExercises[exIdx];
  if (!ex) return;
  const last = ex.sets[ex.sets.length - 1] || { weight: 0, reps: 0 };
  ex.sets.push({ ...last });
}

function removeSet(exIdx, setIdx) {
  const ex = _pickerExercises[exIdx];
  if (!ex || ex.sets.length <= 1) return;
  ex.sets.splice(setIdx, 1);
}

function updateSet(exIdx, setIdx, field, value) {
  const ex = _pickerExercises[exIdx];
  if (!ex || !ex.sets[setIdx]) return;
  ex.sets[setIdx][field] = parseFloat(value) || 0;
}

function toggleWeightMode(exIdx) {
  const ex = _pickerExercises[exIdx];
  if (!ex) return;
  ex.weight_mode = ex.weight_mode === 'single' ? 'total' : 'single';
}


// ── 검색/필터 렌더링 ─────────────────────────────────────

/**
 * 운동 검색 결과 필터링
 * @param {string} query - 검색어
 * @returns {Array} 필터링된 운동 목록
 */
/**
 * 부위 필터 설정
 * @param {string} part - 부위명 (빈 문자열이면 전체)
 */
function setPartFilter(part) {
  _pickerFilter = part || '';
}

/**
 * 도구 필터 설정
 * @param {string} tool - 도구명 (빈 문자열이면 전체)
 */
function setToolFilter(tool) {
  _pickerToolFilter = tool || '';
}

/**
 * 운동 검색 결과 필터링
 * @param {string} query - 검색어
 * @returns {Array} 필터링된 운동 목록
 */
function filterExercises(query) {
  let list = _allExerciseDb;

  // 부위 필터
  if (_pickerFilter) {
    list = list.filter(e =>
      (e.part_unified || '').includes(_pickerFilter)
    );
  }

  // 도구 필터
  if (_pickerToolFilter) {
    list = list.filter(e =>
      (e.tool_unified || '').includes(_pickerToolFilter)
    );
  }

  // 검색어 필터
  if (query) {
    const q = query.toLowerCase().replace(/\s/g, '');
    list = list.filter(e => {
      const ko = (e.name_ko || '').toLowerCase().replace(/\s/g, '');
      const en = (e.name_en || '').toLowerCase().replace(/\s/g, '');
      return ko.includes(q) || en.includes(q);
    });
  }

  return list;
}

/**
 * 즐겨찾기 토글
 */
async function toggleFavorite(trainerId, exerciseRefId, isFav) {
  if (isFav) {
    await db.from('trainer_exercise_library')
      .delete()
      .eq('trainer_id', trainerId)
      .eq('exercise_ref_id', exerciseRefId);
    _myLibrary = _myLibrary.filter(id => id !== exerciseRefId);
  } else {
    await db.from('trainer_exercise_library')
      .insert({ trainer_id: trainerId, exercise_ref_id: exerciseRefId });
    _myLibrary.push(exerciseRefId);
  }
}
