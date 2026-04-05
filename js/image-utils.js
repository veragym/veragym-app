// ============================================================
// VERA GYM v2 — image-utils.js
// 이미지 압축/리사이즈/EXIF 제거/업로드/Signed URL 캐시
// ============================================================

// ── 설정 ──────────────────────────────────────────────────

const IMG_MAX_WIDTH   = 1920;   // 최대 너비 (px)
const IMG_MAX_HEIGHT  = 1920;   // 최대 높이 (px)
const IMG_QUALITY     = 0.82;   // JPEG 품질 (0~1)
const IMG_MAX_SIZE_MB = 10;     // 원본 파일 크기 제한 (MB)
const SIGNED_URL_TTL  = 3600;   // Signed URL 유효 시간 (초)
const SIGNED_URL_RENEW = 50 * 60 * 1000; // 50분 후 자동 갱신 (ms)


// ── 이미지 압축 ──────────────────────────────────────────

/**
 * 이미지 파일을 압축/리사이즈
 * - 최대 1920px으로 리사이즈
 * - JPEG 82% 품질로 재인코딩
 * - EXIF 데이터(GPS 등) 자동 제거 (Canvas 재렌더링)
 *
 * @param {File} file - 원본 이미지 파일
 * @param {Object} [opts] - 옵션
 * @param {number} [opts.maxWidth=1920]
 * @param {number} [opts.maxHeight=1920]
 * @param {number} [opts.quality=0.82]
 * @returns {Promise<Blob>} 압축된 JPEG Blob
 */
function compressImage(file, opts = {}) {
  const maxW = opts.maxWidth  || IMG_MAX_WIDTH;
  const maxH = opts.maxHeight || IMG_MAX_HEIGHT;
  const quality = opts.quality || IMG_QUALITY;

  return new Promise((resolve, reject) => {
    // 파일 크기 체크
    if (file.size > IMG_MAX_SIZE_MB * 1024 * 1024) {
      reject(new Error(`파일이 너무 큽니다 (최대 ${IMG_MAX_SIZE_MB}MB)`));
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // 리사이즈 계산
      if (width > maxW || height > maxH) {
        const ratio = Math.min(maxW / width, maxH / height);
        width  = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      // Canvas 렌더 (EXIF 자동 제거)
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(blob => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('이미지 압축 실패'));
        }
      }, 'image/jpeg', quality);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽을 수 없습니다'));
    };

    img.src = url;
  });
}

/**
 * 이미지 파일 유효성 검사
 * @param {File} file
 * @returns {{ valid: boolean, error?: string }}
 */
function validateImageFile(file) {
  if (!file) return { valid: false, error: '파일이 없습니다' };

  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (!validTypes.includes(file.type) && !file.name.match(/\.(jpg|jpeg|png|webp|heic|heif)$/i)) {
    return { valid: false, error: '지원하지 않는 이미지 형식입니다' };
  }

  if (file.size > IMG_MAX_SIZE_MB * 1024 * 1024) {
    return { valid: false, error: `파일이 너무 큽니다 (최대 ${IMG_MAX_SIZE_MB}MB)` };
  }

  return { valid: true };
}


// ── Supabase Storage 업로드 ──────────────────────────────

/**
 * 이미지를 압축 후 Supabase Storage에 업로드
 * @param {File} file - 원본 파일
 * @param {string} path - Storage 경로
 * @param {Object} [opts] - 압축 옵션
 * @returns {Promise<{ path: string, error?: string }>}
 */
async function uploadImage(file, path, opts = {}) {
  // 검증
  const check = validateImageFile(file);
  if (!check.valid) return { path: null, error: check.error };

  try {
    // 압축
    const compressed = await compressImage(file, opts);

    // 업로드
    const { error } = await db.storage
      .from('session-photos')
      .upload(path, compressed, {
        upsert: true,
        contentType: 'image/jpeg'
      });

    if (error) {
      // Storage 용량 초과 감지
      if (error.message?.includes('quota') || error.statusCode === 413) {
        return { path: null, error: '저장 공간이 부족합니다. 관리자에게 문의하세요.' };
      }
      console.error('Upload error:', error); return { path: null, error: '업로드에 실패했습니다. 다시 시도해주세요.' };
    }

    return { path, error: null };
  } catch (e) {
    console.error('Upload exception:', e);
    return { path: null, error: '업로드 중 오류가 발생했습니다.' };
  }
}

/**
 * Storage에서 파일 삭제
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function deleteImage(path) {
  if (!path) return true;
  try {
    const { error } = await db.storage.from('session-photos').remove([path]);
    if (error) console.warn('사진 삭제 실패:', error.message);
    return !error;
  } catch (e) {
    console.warn('사진 삭제 오류:', e);
    return false;
  }
}


// ── Signed URL 캐시 ──────────────────────────────────────

const _urlCache = new Map(); // key: path, value: { url, expiresAt }

/**
 * Signed URL 가져오기 (캐시 + 자동 갱신)
 * @param {string} path - Storage 경로
 * @returns {Promise<string|null>} Signed URL 또는 null
 */
async function getSignedUrl(path) {
  if (!path) return null;

  // 캐시 확인 (만료 50분 전까지 유효)
  const cached = _urlCache.get(path);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.url;
  }

  // 새 URL 생성
  try {
    const { data, error } = await db.storage
      .from('session-photos')
      .createSignedUrl(path, SIGNED_URL_TTL);

    if (error || !data?.signedUrl) {
      _urlCache.delete(path);
      return null;
    }

    // 캐시 저장 (50분 유효)
    _urlCache.set(path, {
      url: data.signedUrl,
      expiresAt: Date.now() + SIGNED_URL_RENEW
    });

    return data.signedUrl;
  } catch (e) {
    console.warn('Signed URL 생성 실패:', e);
    return null;
  }
}

/**
 * 여러 경로의 Signed URL을 병렬로 가져오기
 * @param {string[]} paths
 * @returns {Promise<Map<string, string>>} path → url 매핑
 */
async function getSignedUrls(paths) {
  const results = new Map();
  const needFetch = [];

  for (const path of paths) {
    if (!path) continue;
    const cached = _urlCache.get(path);
    if (cached && Date.now() < cached.expiresAt) {
      results.set(path, cached.url);
    } else {
      needFetch.push(path);
    }
  }

  if (needFetch.length > 0) {
    const promises = needFetch.map(p => getSignedUrl(p));
    const urls = await Promise.all(promises);
    needFetch.forEach((path, i) => {
      if (urls[i]) results.set(path, urls[i]);
    });
  }

  return results;
}

/**
 * 캐시 클리어
 */
function clearUrlCache() {
  _urlCache.clear();
}


// ── 이미지 회전 ──────────────────────────────────────────

/**
 * 이미지를 반시계 90도 회전
 * @param {string} imageUrl - 현재 이미지 URL
 * @returns {Promise<Blob>} 회전된 JPEG Blob
 */
function rotateImageLeft(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      ctx.translate(0, canvas.height);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('회전 실패'));
      }, 'image/jpeg', IMG_QUALITY);
    };
    img.onerror = () => reject(new Error('이미지 로드 실패'));
    img.src = imageUrl;
  });
}
