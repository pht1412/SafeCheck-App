// ==============================================================================
// SafeCheck - Login Rate Limiter (Brute-Force & Credential Stuffing Protection)
// Tuân thủ: P0-SEC-05 - Giới hạn 5 lần đăng nhập sai, khóa 15 phút
// ==============================================================================

interface AttemptRecord {
  failedAttempts: number;
  lastFailedAt: number;
  lockedUntil: number | null;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 phút
const STORAGE_PREFIX = 'safecheck_login_attempt_';

// Fallback in-memory map nếu môi trường không có localStorage
const memoryStore = new Map<string, AttemptRecord>();

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Chế độ hạn chế hoặc SSR
  }
  return null;
}

function getRecord(identifier: string): AttemptRecord {
  const key = `${STORAGE_PREFIX}${identifier.toLowerCase()}`;
  const storage = getStorage();

  if (storage) {
    try {
      const raw = storage.getItem(key);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // Bỏ qua lỗi parse
    }
  }

  return memoryStore.get(key) || { failedAttempts: 0, lastFailedAt: 0, lockedUntil: null };
}

function saveRecord(identifier: string, record: AttemptRecord): void {
  const key = `${STORAGE_PREFIX}${identifier.toLowerCase()}`;
  const storage = getStorage();

  if (storage) {
    try {
      storage.setItem(key, JSON.stringify(record));
    } catch {
      // Storage đầy hoặc bị chặn
    }
  }
  memoryStore.set(key, record);
}

function removeRecord(identifier: string): void {
  const key = `${STORAGE_PREFIX}${identifier.toLowerCase()}`;
  const storage = getStorage();

  if (storage) {
    try {
      storage.removeItem(key);
    } catch {
      // Bỏ qua
    }
  }
  memoryStore.delete(key);
}

export const loginRateLimiter = {
  /**
   * Kiểm tra xem tài khoản có đang bị khóa hay không
   */
  checkLoginAllowed(identifier: string): { allowed: boolean; retryAfterMinutes?: number; remainingAttempts: number } {
    const record = getRecord(identifier);
    const now = Date.now();

    // Nếu đang bị khóa và thời hạn khóa chưa hết
    if (record.lockedUntil && record.lockedUntil > now) {
      const remainingMinutes = Math.max(1, Math.ceil((record.lockedUntil - now) / (60 * 1000)));
      return {
        allowed: false,
        retryAfterMinutes: remainingMinutes,
        remainingAttempts: 0,
      };
    }

    // Nếu thời hạn khóa đã qua, tự động reset
    if (record.lockedUntil && record.lockedUntil <= now) {
      removeRecord(identifier);
      return {
        allowed: true,
        remainingAttempts: MAX_FAILED_ATTEMPTS,
      };
    }

    const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - record.failedAttempts);
    return {
      allowed: true,
      remainingAttempts: remaining,
    };
  },

  /**
   * Ghi nhận 1 lần đăng nhập thất bại
   */
  recordFailedAttempt(identifier: string): { locked: boolean; retryAfterMinutes?: number; remainingAttempts: number } {
    const record = getRecord(identifier);
    const now = Date.now();

    // Nếu bản ghi trước đó đã hết hạn khóa thì tính từ lần 1
    let newFailed = (record.lockedUntil && record.lockedUntil <= now) ? 1 : record.failedAttempts + 1;
    let lockedUntil: number | null = null;
    let isLocked = false;

    if (newFailed >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = now + LOCKOUT_DURATION_MS;
      isLocked = true;
    }

    saveRecord(identifier, {
      failedAttempts: newFailed,
      lastFailedAt: now,
      lockedUntil,
    });

    const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - newFailed);
    return {
      locked: isLocked,
      retryAfterMinutes: isLocked ? Math.ceil(LOCKOUT_DURATION_MS / (60 * 1000)) : undefined,
      remainingAttempts: remaining,
    };
  },

  /**
   * Đăng nhập thành công -> Xóa lịch sử thử sai
   */
  resetAttempts(identifier: string): void {
    removeRecord(identifier);
  },
};
