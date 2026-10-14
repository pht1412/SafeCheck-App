// ==============================================================================
// SafeCheck - Service: sosAcknowledgementService.ts
// Quản lý việc Tiếp nhận SOS của người thân & Đồng bộ Realtime chống sót
// Tuân thủ: PRD_Deep_v2.md (v2.1) & Implementation Plan Phase 3
// ==============================================================================

import { supabase } from '../supabaseClient';

export interface SOSAcknowledgement {
  id: string;
  sos_event_id: string;
  caregiver_id: string;
  caregiver_name?: string;
  relationship?: string;
  acknowledged_at: string;
  channel: string;
  client_metadata?: Record<string, any>;
  created_at?: string;
}

export const sosAcknowledgementService = {
  /**
   * Gọi RPC acknowledge_sos_event ghi nhận người thân tiếp nhận ca SOS
   */
  async acknowledgeSOS(
    sosEventId: string,
    channel: string = 'app_click',
    clientMetadata: Record<string, any> = {}
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('acknowledge_sos_event', {
        p_sos_event_id: sosEventId,
        p_channel: channel,
        p_client_metadata: clientMetadata,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (!data?.success) {
        return { success: false, error: data?.error || 'Không thể ghi nhận tiếp nhận SOS' };
      }

      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err.message || 'Lỗi mạng khi tiếp nhận SOS' };
    }
  },

  /**
   * Truy vấn danh sách những người thân đã tiếp nhận ca SOS này
   */
  async getAcknowledgements(
    sosEventId: string
  ): Promise<{ data: SOSAcknowledgement[]; error?: string }> {
    try {
      // Ưu tiên 1: Gọi RPC get_sos_acknowledgements để lấy tên và mối quan hệ chính xác của từng con cháu
      const { data: rpcAcks, error: rpcError } = await supabase.rpc('get_sos_acknowledgements', {
        p_sos_event_id: sosEventId,
      });

      if (!rpcError && Array.isArray(rpcAcks) && rpcAcks.length > 0) {
        return {
          data: rpcAcks.map((a: any) => ({
            id: a.id,
            sos_event_id: a.sos_event_id,
            caregiver_id: a.caregiver_id,
            caregiver_name: a.caregiver_name || 'Người thân',
            relationship: a.relationship || 'Người thân',
            acknowledged_at: a.acknowledged_at,
            channel: a.channel,
            created_at: a.created_at,
          })),
        };
      }

      // Ưu tiên 2 (Fallback): Query trực tiếp từ bảng
      const { data: acks, error: acksError } = await supabase
        .from('sos_acknowledgements')
        .select('id, sos_event_id, caregiver_id, acknowledged_at, channel, client_metadata, created_at')
        .eq('sos_event_id', sosEventId)
        .order('acknowledged_at', { ascending: true });

      if (acksError) {
        return { data: [], error: acksError.message };
      }

      if (!acks || acks.length === 0) {
        return { data: [] };
      }

      // Lấy danh sách tên người thân từ profiles & mối quan hệ từ family_links
      const caregiverIds = acks.map((a) => a.caregiver_id);
      const [{ data: profiles }, { data: links }] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', caregiverIds),
        supabase
          .from('family_links')
          .select('caregiver_id, relationship')
          .in('caregiver_id', caregiverIds)
          .eq('status', 'accepted'),
      ]);

      const profileMap = new Map((profiles || []).map((p) => [p.id, p.full_name]));
      const linkMap = new Map((links || []).map((l) => [l.caregiver_id, l.relationship]));

      const enrichedAcks: SOSAcknowledgement[] = acks.map((a) => {
        const metaName = a.client_metadata?.caregiver_name;
        const metaRel = a.client_metadata?.relationship;
        const profName = profileMap.get(a.caregiver_id);
        const linkRel = linkMap.get(a.caregiver_id);

        return {
          ...a,
          caregiver_name: metaName || profName || 'Người thân',
          relationship: metaRel || linkRel || 'Người thân',
        };
      });

      return { data: enrichedAcks };
    } catch (err: any) {
      return { data: [], error: err.message };
    }
  },

  /**
   * Đăng ký Realtime lắng nghe tiếp nhận mới với quy trình 3 bước chống mất tin (Read -> Subscribe -> Re-read)
   */
  subscribeAcknowledgements(
    sosEventId: string,
    onUpdate: (acks: SOSAcknowledgement[]) => void
  ): () => void {
    const fetchAndNotify = async () => {
      const { data } = await sosAcknowledgementService.getAcknowledgements(sosEventId);
      onUpdate(data);
    };

    // Bước 1: Đọc ban đầu từ Server
    fetchAndNotify();

    // Bước 2: Thiết lập kênh Supabase Realtime với tên duy nhất
    const channelName = `sos_acks_${sosEventId}_${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sos_acknowledgements',
          filter: `sos_event_id=eq.${sosEventId}`,
        },
        async () => {
          // Khi có bất kỳ thay đổi nào (INSERT/UPDATE), re-fetch toàn bộ danh sách để có đủ profile name
          await fetchAndNotify();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Bước 3: Re-read lần 2 để lấp khoảng trống trong lúc đang kết nối socket
          void fetchAndNotify();
        }
      });

    // Cleanup function
    return () => {
      void supabase.removeChannel(channel);
    };
  },

  /**
   * Gọi RPC escalate_sos_event_atomic để kích hoạt trạng thái leo thang nếu quá SLA deadline
   */
  async escalateSOS(
    sosEventId: string
  ): Promise<{ success: boolean; escalated: boolean; reason?: string; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('escalate_sos_event_atomic', {
        p_sos_event_id: sosEventId,
      });

      if (error) {
        return { success: false, escalated: false, error: error.message };
      }

      // Tự động kích hoạt Serverless Escalation Worker kèm Bearer token của session người dùng
      supabase.auth.getSession().then(({ data: sessionData }) => {
        const token = sessionData?.session?.access_token;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        fetch('/api/check-escalation', {
          method: 'POST',
          headers,
          body: JSON.stringify({ sos_event_id: sosEventId }),
        }).catch((e) => console.warn('[escalateSOS] Không thể trigger /api/check-escalation:', e));
      }).catch((e) => console.warn('[escalateSOS] Không thể lấy session cho check-escalation:', e));

      return {
        success: data?.success ?? true,
        escalated: Boolean(data?.escalated),
        reason: data?.reason,
      };
    } catch (err: any) {
      return { success: false, escalated: false, error: err.message };
    }
  },
};

export default sosAcknowledgementService;
