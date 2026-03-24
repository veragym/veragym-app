/**
 * 베라짐 트레이너 앱 - 공통 설정
 * ★★★ 테스트 환경 ★★★
 * DB: veragym-test (jpfgcwlhitzwjoppszzl)
 * URL: veragym.github.io/veragym-app/ (test 브랜치 배포 시)
 */

// ============================================================
// ★ Supabase 프로젝트 정보 — 테스트 DB
// ============================================================
const SUPA_URL  = 'https://jpfgcwlhitzwjoppszzl.supabase.co';
const SUPA_ANON = 'sb_publishable_t6mKiM_s_ruF6fuzj4uz6g_kusBpwE5';
const ENV = 'test'; // 테스트 환경 표시용

// Edge Function 베이스 URL (admin.html에서 트레이너 생성/비번변경에 사용)
const EDGE_BASE = 'https://jpfgcwlhitzwjoppszzl.supabase.co/functions/v1';
// anon key 별칭 (admin.html 호환)
const SUPABASE_ANON_KEY = SUPA_ANON;
// ============================================================

// ★ 슈퍼 관리자 이메일
const SUPER_ADMIN_EMAIL = 'veragym@naver.com';

// Supabase 클라이언트
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
  version:      'v0.1-test',

  img: {
    exerciseBase:  'https://veragym.github.io/exercises/',
    sessionBucket: 'session-photos',
    compress: {
      maxWidth:  1200,
      maxHeight: 1200,
      quality:   0.80,
      format:    'webp',
    },
  },

  defaultSet: { weight: 0, reps: 10 },
};

// ============================================================
// 공통 유틸리티
// ============================================================

async function compressImage(file) {
  const cfg = APP_CONFIG.img.compress;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
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

function showToast(msg, ms = 2200) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = `
      position:fixed;bottom:90px;left:50%;transform:translateX(-50%);
      background:#c9a84c;color:#000;border-radius:10px;
      padding:10px 18px;font-size:13px;font-weight:700;
      opacity:0;pointer-events:none;transition:opacity 0.3s;
      z-index:9999;white-space:nowrap;font-family:inherit;
    `;
    document.body.appendChild(t);
  }
  // 테스트 환경 표시
  t.textContent = '[TEST] ' + msg;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, ms);
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    month: 'long', day: 'numeric', weekday: 'short'
  });
}

async function requireTrainer() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.replace('trainer-login.html'); return null; }

  let saved = localStorage.getItem('vg_trainer');
  if (!saved) {
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

function getExerciseImgUrl(exercise) {
  if (exercise.image_url) return exercise.image_url;
  if (exercise.name_en) {
    const slug = exercise.name_en.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return APP_CONFIG.img.exerciseBase + slug + '.png';
  }
  return null;
}

async function requireAdmin() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.replace('admin-login.html'); return null; }

  // 슈퍼 관리자 직접 허용 (trainers 테이블 조회 없이 통과)
  if (session.user.email === SUPER_ADMIN_EMAIL) {
    return { email: SUPER_ADMIN_EMAIL, is_admin: true, is_active: true, name: 'SUPER ADMIN' };
  }

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

function preventBackExit() {
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', () => {
    history.pushState(null, '', location.href);
  });
}

// 테스트 환경 배너 자동 표시
window.addEventListener('DOMContentLoaded', () => {
  const banner = document.createElement('div');
  banner.style.cssText = `
    position:fixed;top:0;left:0;right:0;
    background:#c9a84c;color:#000;
    text-align:center;font-size:11px;font-weight:700;
    padding:3px;z-index:99999;letter-spacing:1px;
  `;
  banner.textContent = '⚠️ TEST ENV — veragym-test DB';
  document.body.prepend(banner);
});
