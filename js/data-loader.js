// ============================================================
// VERA GYM v2 — data-loader.js
// 페이지네이션 + 안전한 데이터 로드 (1000행 잘림 방지)
// ============================================================

// Supabase PostgREST는 기본 max-rows=1000.
// .from() 쿼리에 LIMIT 없으면 1000행에서 자동 잘리고 에러도 안 남.
// 이 모듈은 모든 대량 쿼리를 안전하게 처리.

// ── 전체 로드 (1000행 제한 우회) ─────────────────────────

/**
 * 테이블 전체 데이터를 안전하게 로드 (1000행 이상도 OK)
 * 내부적으로 페이지네이션하여 모든 행을 가져옴
 *
 * @param {string} table - 테이블명
 * @param {string} select - SELECT 컬럼
 * @param {Function} [filterFn] - query builder에 필터 추가하는 함수
 * @param {Object} [opts] - 옵션
 * @param {number} [opts.pageSize=500] - 페이지 크기
 * @param {string} [opts.orderBy='id'] - 정렬 기준 컬럼
 * @param {boolean} [opts.ascending=true] - 오름차순 여부
 * @returns {Promise<{ data: Array, error: any }>}
 */
async function loadAll(table, select, filterFn, opts = {}) {
  const pageSize = opts.pageSize || 500;
  const orderBy  = opts.orderBy  || 'id';
  const ascending = opts.ascending !== false;

  let allData = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    let query = db.from(table)
      .select(select)
      .order(orderBy, { ascending })
      .range(from, from + pageSize - 1);

    if (typeof filterFn === 'function') {
      query = filterFn(query);
    }

    const { data, error } = await query;

    if (error) return { data: allData, error };

    if (data && data.length > 0) {
      allData = allData.concat(data);
      from += data.length;
      hasMore = data.length === pageSize; // 페이지 크기만큼 왔으면 더 있을 수 있음
    } else {
      hasMore = false;
    }
  }

  return { data: allData, error: null };
}


// ── 커서 기반 페이지네이션 (목록 UI용) ───────────────────

/**
 * 페이지네이션 로드 (무한 스크롤 / 더보기 버튼용)
 *
 * @param {string} table
 * @param {string} select
 * @param {Function} filterFn
 * @param {Object} opts
 * @param {number} opts.limit - 한 번에 가져올 개수
 * @param {number} opts.offset - 시작 위치
 * @param {string} [opts.orderBy='created_at']
 * @param {boolean} [opts.ascending=false]
 * @returns {Promise<{ data: Array, hasMore: boolean, error: any }>}
 */
async function loadPage(table, select, filterFn, opts) {
  const limit   = opts.limit || 30;
  const offset  = opts.offset || 0;
  const orderBy = opts.orderBy || 'created_at';
  const ascending = opts.ascending === true;

  let query = db.from(table)
    .select(select, { count: 'exact' })
    .order(orderBy, { ascending })
    .range(offset, offset + limit - 1);

  if (typeof filterFn === 'function') {
    query = filterFn(query);
  }

  const { data, error, count } = await query;

  return {
    data: data || [],
    hasMore: (offset + limit) < (count || 0),
    total: count || 0,
    error
  };
}


// ── 날짜 범위 쿼리 헬퍼 ──────────────────────────────────

/**
 * 결제/매출 데이터를 월별로 안전하게 로드
 * (전체 로드 대신 월별 필터로 1000행 잘림 방지)
 *
 * @param {string} table
 * @param {string} select
 * @param {string} dateColumn - 날짜 컬럼명
 * @param {string} yearMonth - 'YYYY-MM' 형태
 * @param {Function} [filterFn] - 추가 필터
 * @returns {Promise<{ data: Array, error: any }>}
 */
async function loadByMonth(table, select, dateColumn, yearMonth, filterFn) {
  const startDate = yearMonth + '-01';
  const endDate = _lastDayOfMonth(yearMonth);

  return loadAll(table, select, (q) => {
    q = q.gte(dateColumn, startDate).lte(dateColumn, endDate);
    if (typeof filterFn === 'function') q = filterFn(q);
    return q;
  });
}

/**
 * 날짜 범위로 로드
 */
async function loadByDateRange(table, select, dateColumn, startDate, endDate, filterFn) {
  return loadAll(table, select, (q) => {
    q = q.gte(dateColumn, startDate).lte(dateColumn, endDate);
    if (typeof filterFn === 'function') q = filterFn(q);
    return q;
  });
}


// ── 집계 쿼리 (대량 데이터 통계용) ───────────────────────

/**
 * 레코드 수만 가져오기 (데이터 로드 없이)
 */
async function countRows(table, filterFn) {
  let query = db.from(table)
    .select('id', { count: 'exact', head: true });

  if (typeof filterFn === 'function') {
    query = filterFn(query);
  }

  const { count, error } = await query;
  return { count: count || 0, error };
}


// ── 내부 헬퍼 ────────────────────────────────────────────

function _lastDayOfMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m, 0); // 다음달 0일 = 이번달 마지막날
  return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
