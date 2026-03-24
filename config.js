/**
 * 베라짐 트레이너 앱 - 공통 설정 [TEST 환경]
 * ⚠️ 이 파일은 veragym-test Supabase 연동용입니다
 * ★ 이 파일만 수정하면 전체 앱에 반영됨
 *
 * 모든 HTML 파일 <head>에 아래 한 줄 추가:
 *   <script src="config.js"></script>
 */

// ============================================================
// ★ Supabase 프로젝트 정보 (여기만 수정!)
// ============================================================
const SUPA_URL  = 'https://jpfgcwlhitzwjoppszzl.supabase.co';
const SUPA_ANON = 'sb_publishable_t6mKiM_s_ruF6fuzj4uz6g_kusBpwE5';
// ============================================================

// Supabase 클라이언트 (전역 - 모든 페이지에서 db 변수로 사용)
// Supabase SDK 로드 후에 초기화됨 (init_db() 호출 필요)
let db = null;
function init_db() {
  if (!db) db = supabase.createClient(SUPA_URL, SUPA_ANON);
  return db;
}

// ============================================================
// 앱 설정
// ============================================================
const APP_CONFIG = {
  gymName:      '베라짐',
  gymLocations: ['미사점', '동탄점'],
  defaultGym:   '미사점',
  version:      'v0.1',

  // 이미지 설정
  img: {
    // 운동 시연 이미지 베이스 URL (GitHub Pages)
    // 파일명 규칙: 영문 운동명을 소문자-하이픈으로 변환
    // 예: "Bench Press" → bench-press.png
    exerciseBase: 'https://veragym.github.io/exercises/',

    // 회원/수업 사진 업로드 버킷 (Supabase Storage)
    sessionBucket: 'session-photos',

    // 업로드 전 압축 설정
    compress: {
      maxWidth:  1200,  // px
      maxHeight: 1200,  // px
      quality:   0.80,  // WebP 품질 (0~1)
      format:    'webp',
    },
  },

  // 세트 기본값
  defaultSet: { weight: 0, reps: 10 },
};

// ============================================================
// 공통 유틸리티
// ============================================================

/**
 * 이미지 업로드 전 클라이언트 압축
 * @param {File} file - 원본 파일
 * @returns {Promise<Blob>} - 압축된 WebP Blob
 */
async function compressImage(file) {
  const cfg = APP_CONFIG.img.compress;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      // 비율 유지 리사이즈
      let { width, height } = img;
      if (width > cfg.maxWidth || height > cfg.maxHeight) {
        const ratio = Math.min(cfg.maxWidth / width, cfg.maxHeight / height);
        width  = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => {
        URL.revokeObjectURL(url);
        resolve(blob);
      }, 'image/webp', cfg.quality);
    };
    img.src = url;
  });
}

/**
 * Supabase Storage에 세션 사진 업로드
 * @param {File} file
 * @param {string} sessionId
 * @returns {Promise<string>} publicUrl
 */
async function uploadSessionPhoto(file, sessionId) {
  const compressed = await compressImage(file);
  const ext      = 'webp';
  const fileName = `${sessionId}/${Date.now()}.${ext}`;

  const { error } = await db.storage
    .from(APP_CONFIG.img.sessionBucket)
    .upload(fileName, compressed, { contentType: 'image/webp', upsert: false });

  if (error) throw error;

  const { data: { publicUrl } } = db.storage
    .from(APP_CONFIG.img.sessionBucket)
    .getPublicUrl(fileName);

  return publicUrl;
}

/**
 * 토스트 메시지 표시 (전역)
 * HTML에 <div id="toast" class="toast"></div> 필요
 */
function showToast(msg, ms = 2200) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = `
      position:fixed;bottom:90px;left:50%;transform:translateX(-50%);
      background:#333;color:#fff;border-radius:10px;
      padding:10px 18px;font-size:13px;font-weight:600;
      opacity:0;pointer-events:none;transition:opacity 0.3s;
      z-index:9999;white-space:nowrap;font-family:inherit;
    `;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, ms);
}

/**
 * 날짜 포맷 (2026-03-20 → 3월 20일 (금))
 */
function fmtDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    month: 'long', day: 'numeric', weekday: 'short'
  });
}

/**
 * 로그인 체크 + 트레이너 정보 반환
 * 세션이 있으면 localStorage 없어도 DB에서 자동 복구 → PWA 재시작 후에도 로그인 유지
 */
async function requireTrainer() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.replace('trainer-login.html'); return null; }

  let saved = localStorage.getItem('vg_trainer');
  if (!saved) {
    // 세션은 살아 있지만 로컬 데이터 없음 → DB에서 자동 복구
    const { data: trainer, error } = await db
      .from('trainers')
      .select('id, name, gym_location, is_active, is_admin')
      .eq('auth_id', session.user.id)
      .single();

    if (error || !trainer || !trainer.is_active) {
      await db.auth.signOut();
      location.replace('trainer-login.html');
      return null;
    }
    saved = JSON.stringify({ id: trainer.id, name: trainer.name, gym_location: trainer.gym_location });
    localStorage.setItem('vg_trainer', saved);
  }
  return JSON.parse(saved);
}

/**
 * 운동 이미지 URL 반환
 * 1순위: DB image_url / 2순위: GitHub Pages (영문명 기반)
 */
function getExerciseImgUrl(exercise) {
  if (exercise.image_url) return exercise.image_url;
  if (exercise.name_en) {
    const slug = exercise.name_en.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return APP_CONFIG.img.exerciseBase + slug + '.png';
  }
  return null;
}

/**
 * 관리자 로그인 체크 + 관리자 정보 반환
 * 로그인 안 됐거나 관리자 권한 없으면 admin-login.html로 리다이렉트
 */
async function requireAdmin() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.replace('admin-login.html'); return null; }

  const { data, error } = await db
    .from('trainers')
    .select('*')
    .eq('auth_id', session.user.id)
    .single();

  if (error || !data || !data.is_admin) {
    location.replace('admin-login.html');
    return null;
  }
  return data;
}
