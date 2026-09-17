import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import type { UserProfile } from '../types';

// Export type để các hook và component khác import (thay vì khai báo inline trong App.tsx)
export interface LinkedElderly {
  id: string;
  full_name: string;
  pairing_code: string;
  phone?: string | null;
}

export interface UseFamilyLinkReturn {
  linkedElderly: LinkedElderly | null;
  hasLinkedCaregivers: boolean;
  primaryCaregiver: { name: string; phone: string } | null;
  /** Mã phòng động:
   *  - Elderly → pairing_code của Cụ (hoặc id nếu chưa có)
   *  - Caregiver → pairing_code của Cụ đã liên kết (hoặc null nếu chưa liên kết)
   */
  activeFamilyCode: string | null;
  connectFamily: (
    pairingCode: string,
    relationship: string
  ) => Promise<{ success: boolean; message: string }>;
  /** Refresh toàn bộ family state. Promise<void> — caller có thể await để chắc chắn state đã cập nhật. */
  refreshFamily: () => Promise<void>;
}

/**
 * Hook quản lý liên kết gia đình SafeCheck.
 *
 * Trách nhiệm:
 * - Caregiver: fetch Cụ đã kết nối (family_links JOIN profiles)
 * - Elderly: kiểm tra xem đã có người thân liên kết chưa; lấy primaryCaregiver
 * - Elderly: Realtime channel family-links-{id} → re-fetch khi có thay đổi
 * - Expose activeFamilyCode (derived)
 * - connectFamily(): gọi RPC connect_family → await refreshFamily()
 *
 * KHÔNG chứa logic check-in, SOS hay auth.
 */
export function useFamilyLink(userProfile: UserProfile | null): UseFamilyLinkReturn {
  const [linkedElderly, setLinkedElderly] = useState<LinkedElderly | null>(null);
  const [hasLinkedCaregivers, setHasLinkedCaregivers] = useState<boolean>(false);
  const [primaryCaregiver, setPrimaryCaregiver] = useState<{ name: string; phone: string } | null>(null);

  // ─── Fetch helpers ────────────────────────────────────────────────────────

  const fetchLinkedElderly = async (caregiverId: string): Promise<void> => {
    try {
      const { data } = await supabase
        .from('family_links')
        .select('elderly_id, relationship, profiles!elderly_id(id, full_name, pairing_code, phone)')
        .eq('caregiver_id', caregiverId)
        .eq('status', 'accepted')
        .maybeSingle();

      if (data && data.profiles) {
        setLinkedElderly(data.profiles as unknown as LinkedElderly);
      } else {
        setLinkedElderly(null);
      }
    } catch (err) {
      console.error('[useFamilyLink] Lỗi lấy thông tin liên kết gia đình:', err);
      setLinkedElderly(null);
    }
  };

  const fetchElderlyCaregivers = async (elderlyId: string): Promise<void> => {
    try {
      const { data, count, error } = await supabase
        .from('family_links')
        .select('caregiver_id, profiles!caregiver_id(full_name, phone)', { count: 'exact' })
        .eq('elderly_id', elderlyId)
        .eq('status', 'accepted');

      if (!error && count !== null) {
        setHasLinkedCaregivers(count > 0);
        if (data && data.length > 0 && data[0].profiles) {
          const prof = data[0].profiles as { full_name?: string; phone?: string };
          setPrimaryCaregiver({
            name: prof.full_name || 'Con cháu',
            phone: prof.phone || '0901234567',
          });
        }
      }
    } catch (err) {
      console.error('[useFamilyLink] Lỗi kiểm tra người thân liên kết:', err);
    }
  };

  // ─── refreshFamily — public, awaitable ───────────────────────────────────

  const refreshFamily = async (): Promise<void> => {
    if (!userProfile) return;
    if (userProfile.role === 'caregiver') {
      await fetchLinkedElderly(userProfile.id);
    } else if (userProfile.role === 'elderly') {
      await fetchElderlyCaregivers(userProfile.id);
    }
  };

  // ─── Effect: initial fetch + realtime ────────────────────────────────────

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!userProfile) {
      setLinkedElderly(null);
      setHasLinkedCaregivers(false);
      setPrimaryCaregiver(null);
      return;
    }
    /* eslint-enable react-hooks/set-state-in-effect */

    if (userProfile.role === 'caregiver') {
      fetchLinkedElderly(userProfile.id);
    } else if (userProfile.role === 'elderly') {
      setLinkedElderly(null);
      fetchElderlyCaregivers(userProfile.id);

      // Lắng nghe Realtime: có con cháu nào vừa kết nối / huỷ kết nối không
      const linkChannel = supabase
        .channel(`family-links-${userProfile.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'family_links',
            filter: `elderly_id=eq.${userProfile.id}`,
          },
          () => {
            fetchElderlyCaregivers(userProfile.id);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(linkChannel);
      };
    }
  }, [userProfile?.id, userProfile?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Derived value ────────────────────────────────────────────────────────

  const activeFamilyCode: string | null =
    userProfile?.role === 'elderly'
      ? userProfile.pairing_code || userProfile.id
      : linkedElderly?.pairing_code || null;

  // ─── connectFamily ────────────────────────────────────────────────────────

  const connectFamily = async (
    pairingCode: string,
    relationship: string
  ): Promise<{ success: boolean; message: string }> => {
    const { data, error } = await supabase.rpc('connect_family', {
      p_pairing_code: pairingCode,
      p_relationship: relationship,
    });

    if (error) {
      return { success: false, message: error.message || 'Lỗi kết nối máy chủ' };
    }
    if (!data?.success) {
      return { success: false, message: data?.message || 'Kết nối thất bại' };
    }

    // Await để đảm bảo state refresh xong trước khi caller nhận kết quả
    await refreshFamily();

    return { success: true, message: data.message };
  };

  return {
    linkedElderly,
    hasLinkedCaregivers,
    primaryCaregiver,
    activeFamilyCode,
    connectFamily,
    refreshFamily,
  };
}
