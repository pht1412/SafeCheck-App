import { useState, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { supabase } from '../supabaseClient';
import { authService } from '../services/authService';
import type { UserProfile } from '../types';

const CACHE_KEY = 'safecheck_cached_profile';

export interface UseAuthSessionReturn {
  userProfile: UserProfile | null;
  isAuthChecking: boolean;
  setUserProfile: Dispatch<SetStateAction<UserProfile | null>>;
  signOut: () => Promise<void>;
}

/**
 * Hook quản lý phiên đăng nhập SafeCheck.
 *
 * Trách nhiệm:
 * - Khởi tạo từ localStorage cache (chống màn hình trắng khi mất mạng)
 * - Fetch profile mới nhất từ Supabase khi có mạng
 * - Fallback an toàn từ session.user_metadata khi offline + chưa có cache
 * - Lắng nghe onAuthStateChange: SIGNED_OUT → clear state; SIGNED_IN → fetch profile
 * - signOut(): authService.signOut() + clear localStorage
 *
 * KHÔNG chứa business logic về check-in, SOS, hay family linking.
 */
export function useAuthSession(): UseAuthSessionReturn {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    async function checkAuthSession() {
      try {
        const session = await authService.getSession();

        if (session?.user) {
          // 1. Đọc cache trước để tránh màn hình trắng khi offline
          const cached = localStorage.getItem(CACHE_KEY);
          if (cached && isMounted) {
            try {
              setUserProfile(JSON.parse(cached));
            } catch (e) {
              console.warn('[useAuthSession] Lỗi đọc cache profile:', e);
            }
          }

          // 2. Lấy profile mới nhất từ Supabase (nếu có mạng)
          const profile = await authService.fetchProfile(session.user.id);
          if (profile && isMounted) {
            setUserProfile(profile);
            localStorage.setItem(CACHE_KEY, JSON.stringify(profile));
          } else if (!cached && isMounted) {
            // 3. Fallback an toàn từ session metadata khi offline + chưa có cache
            const meta = session.user.user_metadata || {};
            const fallbackProfile: UserProfile = {
              id: session.user.id,
              email: session.user.email || '',
              full_name: meta.full_name || 'Người dùng',
              role: meta.role || 'elderly',
              avatar_url: meta.avatar_url || null,
              phone: meta.phone || '',
              pairing_code: meta.pairing_code || null,
            };
            setUserProfile(fallbackProfile);
            localStorage.setItem(CACHE_KEY, JSON.stringify(fallbackProfile));
          }
        }
      } catch (err) {
        console.error('[useAuthSession] Lỗi kiểm tra phiên đăng nhập:', err);
      } finally {
        if (isMounted) setIsAuthChecking(false);
      }
    }

    checkAuthSession();

    // Lắng nghe sự kiện đăng nhập / đăng xuất
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT') {
          localStorage.removeItem(CACHE_KEY);
          if (isMounted) setUserProfile(null);
        } else if (session?.user && !userProfile) {
          // Chỉ fetch khi chưa có profile (tránh re-fetch không cần thiết)
          const profile = await authService.fetchProfile(session.user.id);
          if (profile && isMounted) {
            setUserProfile(profile);
            localStorage.setItem(CACHE_KEY, JSON.stringify(profile));
          }
        }
      }
    );

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Note: userProfile intentionally excluded — chỉ dùng snapshot tại thời điểm mount

  const signOut = async () => {
    await authService.signOut();
    localStorage.removeItem(CACHE_KEY);
    setUserProfile(null);
  };

  return { userProfile, isAuthChecking, setUserProfile, signOut };
}
