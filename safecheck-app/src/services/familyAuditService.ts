// ==============================================================================
// SafeCheck - Service: familyAuditService.ts
// Thu thập & tổng hợp nhật ký hoạt động gia đình:
// 1. Toàn bộ con cháu trong nhà & mối quan hệ
// 2. Điểm danh hôm nay: giờ điểm danh, đúng giờ hay trễ mấy giờ mấy phút
// 3. Sự cố SOS: ai đã tiếp nhận, ai đã giải quyết / tắt còi
// ==============================================================================

import { supabase } from '../supabaseClient';

export interface FamilyMemberInfo {
  id: string;
  caregiver_id: string;
  full_name: string;
  relationship: string;
  phone?: string | null;
  status: string;
  linked_at: string;
  has_push_active?: boolean;
}

export interface CheckinAuditInfo {
  log_date: string;
  status: string;
  checkin_time: string | null;
  checkin_time_formatted: string | null;
  source: string | null;
  schedule_start: string;
  schedule_deadline: string;
  is_checked_in: boolean;
  is_late: boolean;
  delay_minutes: number;
  delay_text: string;
}

export interface SOSIncidentAudit {
  id: string;
  created_at: string;
  created_at_formatted: string;
  status: string;
  is_active: boolean;
  acknowledged_by: Array<{
    caregiver_name: string;
    relationship: string;
    acknowledged_at: string;
  }>;
  resolved_by?: {
    performer_name: string;
    performer_role: string;
    resolved_at: string;
    note?: string | null;
  } | null;
}

export interface FamilyAuditReport {
  members: FamilyMemberInfo[];
  todayCheckin: CheckinAuditInfo | null;
  recentSOS: SOSIncidentAudit[];
}

export const familyAuditService = {
  /**
   * Lấy toàn bộ danh sách con cháu liên kết với Cụ
   */
  async getFamilyMembers(elderlyId: string): Promise<FamilyMemberInfo[]> {
    try {
      const { data: links, error: linkErr } = await supabase
        .from('family_links')
        .select('id, caregiver_id, relationship, status, created_at')
        .eq('elderly_id', elderlyId)
        .order('created_at', { ascending: true });

      if (linkErr || !links || links.length === 0) {
        return [];
      }

      const caregiverIds = links.map((l) => l.caregiver_id);
      const [{ data: profiles }, { data: subs }] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, phone')
          .in('id', caregiverIds),
        supabase
          .from('push_subscriptions')
          .select('user_id, is_active')
          .in('user_id', caregiverIds)
          .eq('is_active', true),
      ]);

      const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
      const activePushSet = new Set((subs || []).map((s) => s.user_id));

      return links.map((l) => {
        const prof = profileMap.get(l.caregiver_id);
        return {
          id: l.id,
          caregiver_id: l.caregiver_id,
          full_name: prof?.full_name || 'Người thân',
          relationship: l.relationship || 'Con cháu',
          phone: prof?.phone || null,
          status: l.status,
          linked_at: l.created_at,
          has_push_active: activePushSet.has(l.caregiver_id),
        };
      });
    } catch (err) {
      console.error('[familyAuditService] Lỗi getFamilyMembers:', err);
      return [];
    }
  },

  /**
   * Lấy tình trạng điểm danh hôm nay & tính độ lệch trễ so với hạn chót
   */
  async getTodayCheckinAudit(elderlyId: string, pairingCode?: string): Promise<CheckinAuditInfo | null> {
    try {
      const todayStr = new Date().toISOString().split('T')[0];

      // 1. Đọc checkin log hôm nay
      let query = supabase.from('checkin_logs').select('*');
      if (pairingCode) {
        query = query.or(`elderly_id.eq.${elderlyId},family_code.eq.${pairingCode}`);
      } else {
        query = query.eq('elderly_id', elderlyId);
      }

      const { data: logs } = await query
        .order('created_at', { ascending: false })
        .limit(1);

      const log = logs && logs.length > 0 ? logs[0] : null;

      // 2. Đọc cấu hình giờ điểm danh từ checkin_schedules
      const { data: schedule } = await supabase
        .from('checkin_schedules')
        .select('checkin_start, checkin_deadline')
        .eq('elderly_id', elderlyId)
        .maybeSingle();

      const start = schedule?.checkin_start || '07:00:00';
      const deadline = schedule?.checkin_deadline || '09:00:00';

      const formatTime = (timeStr?: string | null) => {
        if (!timeStr) return null;
        try {
          return new Date(timeStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
          return timeStr;
        }
      };

      const checkinTimeFormatted = log?.checkin_time ? formatTime(log.checkin_time) : null;
      const isCheckedIn = log?.status === 'Safe' && Boolean(log?.checkin_time);

      let isLate = false;
      let delayMinutes = 0;
      let delayText = 'Chưa điểm danh';

      if (isCheckedIn && log?.checkin_time) {
        const checkinDate = new Date(log.checkin_time);
        const checkinHours = checkinDate.getHours();
        const checkinMinutes = checkinDate.getMinutes();
        const checkinTotalMinutes = checkinHours * 60 + checkinMinutes;

        const [dlHours, dlMins] = deadline.split(':').map((s: string) => parseInt(s, 10));
        const deadlineTotalMinutes = dlHours * 60 + dlMins;

        if (checkinTotalMinutes > deadlineTotalMinutes) {
          isLate = true;
          delayMinutes = checkinTotalMinutes - deadlineTotalMinutes;
          const hours = Math.floor(delayMinutes / 60);
          const mins = delayMinutes % 60;
          if (hours > 0) {
            delayText = `Trễ ${hours} giờ ${mins > 0 ? `${mins} phút` : ''} so với hạn chót (${deadline.slice(0, 5)})`;
          } else {
            delayText = `Trễ ${mins} phút so với hạn chót (${deadline.slice(0, 5)})`;
          }
        } else {
          isLate = false;
          delayMinutes = 0;
          delayText = `Đúng giờ (trước hạn chót ${deadline.slice(0, 5)})`;
        }
      } else if (log?.status === 'Late' || log?.status === 'Overdue_Ping') {
        isLate = true;
        delayText = `Chưa điểm danh, đã quá hạn chót (${deadline.slice(0, 5)})`;
      } else {
        delayText = `Đang đợi Cụ điểm danh (Hạn chót: ${deadline.slice(0, 5)})`;
      }

      return {
        log_date: todayStr,
        status: log?.status || 'Waiting',
        checkin_time: log?.checkin_time || null,
        checkin_time_formatted: checkinTimeFormatted,
        source: log?.source || 'Daily_Button',
        schedule_start: start.slice(0, 5),
        schedule_deadline: deadline.slice(0, 5),
        is_checked_in: isCheckedIn,
        is_late: isLate,
        delay_minutes: delayMinutes,
        delay_text: delayText,
      };
    } catch (err) {
      console.error('[familyAuditService] Lỗi getTodayCheckinAudit:', err);
      return null;
    }
  },

  /**
   * Lấy danh sách các ca SOS gần đây kèm người tiếp nhận & người giải quyết
   */
  async getRecentSOSIncidents(elderlyId: string): Promise<SOSIncidentAudit[]> {
    try {
      // 1. Lấy tối đa 5 sự kiện SOS gần nhất
      const { data: events, error: evErr } = await supabase
        .from('sos_events')
        .select('id, created_at, status')
        .eq('elderly_id', elderlyId)
        .order('created_at', { ascending: false })
        .limit(5);

      if (evErr || !events || events.length === 0) {
        return [];
      }

      const eventIds = events.map((e) => e.id);

      // 2. Lấy thông tin tiếp nhận
      const { data: acks } = await supabase
        .from('sos_acknowledgements')
        .select('sos_event_id, caregiver_id, acknowledged_at')
        .in('sos_event_id', eventIds)
        .order('acknowledged_at', { ascending: true });

      // Lấy tên và mối quan hệ con cháu
      const caregiverIds = Array.from(new Set((acks || []).map((a) => a.caregiver_id)));
      let profileMap = new Map<string, string>();
      let linkMap = new Map<string, string>();

      if (caregiverIds.length > 0) {
        const [{ data: profs }, { data: links }] = await Promise.all([
          supabase.from('profiles').select('id, full_name').in('id', caregiverIds),
          supabase.from('family_links').select('caregiver_id, relationship').in('caregiver_id', caregiverIds).eq('status', 'accepted'),
        ]);
        profileMap = new Map((profs || []).map((p) => [p.id, p.full_name]));
        linkMap = new Map((links || []).map((l) => [l.caregiver_id, l.relationship]));
      }

      // 3. Lấy thông tin người giải quyết (tắt còi an toàn) từ alarm_logs
      const { data: logs } = await supabase
        .from('alarm_logs')
        .select('sos_event_id, action, performer_name, performer_role, note, created_at')
        .in('sos_event_id', eventIds)
        .eq('action', 'RESOLVE')
        .order('created_at', { ascending: false });

      const resolveMap = new Map<string, any>();
      (logs || []).forEach((l) => {
        if (l.sos_event_id && !resolveMap.has(l.sos_event_id)) {
          resolveMap.set(l.sos_event_id, l);
        }
      });

      return events.map((ev) => {
        const evAcks = (acks || []).filter((a) => a.sos_event_id === ev.id);
        const resolveLog = resolveMap.get(ev.id);

        return {
          id: ev.id,
          created_at: ev.created_at,
          created_at_formatted: new Date(ev.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit',
          }),
          status: ev.status,
          is_active: ev.status === 'active',
          acknowledged_by: evAcks.map((a) => ({
            caregiver_name: profileMap.get(a.caregiver_id) || 'Người thân',
            relationship: linkMap.get(a.caregiver_id) || 'Con cháu',
            acknowledged_at: new Date(a.acknowledged_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
          })),
          resolved_by: resolveLog
            ? {
                performer_name: resolveLog.performer_name,
                performer_role: resolveLog.performer_role,
                resolved_at: new Date(resolveLog.created_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                note: resolveLog.note,
              }
            : null,
        };
      });
    } catch (err) {
      console.error('[familyAuditService] Lỗi getRecentSOSIncidents:', err);
      return [];
    }
  },

  /**
   * Tổng hợp toàn bộ báo cáo hoạt động cho giao diện
   */
  async getFullFamilyAudit(elderlyId: string, pairingCode?: string): Promise<FamilyAuditReport> {
    const [members, todayCheckin, recentSOS] = await Promise.all([
      this.getFamilyMembers(elderlyId),
      this.getTodayCheckinAudit(elderlyId, pairingCode),
      this.getRecentSOSIncidents(elderlyId),
    ]);

    return {
      members,
      todayCheckin,
      recentSOS,
    };
  },
};

export default familyAuditService;
