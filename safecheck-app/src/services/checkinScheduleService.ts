import { supabase } from '../supabaseClient';
import type { CheckinSchedule, UpdateScheduleResult, PerformCheckinResult } from '../types';

export const DEFAULT_SCHEDULE: Omit<CheckinSchedule, 'elderly_id'> = {
  checkin_start: '07:00:00',
  checkin_deadline: '09:00:00',
  emergency_buffer_minutes: 30,
  timezone: 'Asia/Ho_Chi_Minh',
  is_active: true,
};

/**
 * Chuyển chuỗi giờ 'HH:mm' hoặc 'HH:mm:ss' thành tổng số giây từ 00:00:00
 */
export function timeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map(Number);
  const hours = parts[0] || 0;
  const minutes = parts[1] || 0;
  const seconds = parts[2] || 0;
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Định dạng chuỗi thời gian 'HH:mm:ss' thành 'HH:mm' hiển thị thân thiện
 */
export function formatTimeDisplay(timeStr?: string | null): string {
  if (!timeStr) return '--:--';
  const parts = timeStr.split(':');
  if (parts.length >= 2) {
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
  }
  return timeStr;
}

export const checkinScheduleService = {
  /**
   * Lấy cấu hình lịch điểm danh của Cụ.
   * Nếu Cụ chưa từng có cấu hình trong DB, trả về cấu hình mặc định an toàn.
   */
  async getSchedule(elderlyId: string): Promise<{ data: CheckinSchedule | null; error: any }> {
    if (!elderlyId) {
      return { data: null, error: new Error('Thiếu elderly_id') };
    }

    try {
      const { data, error } = await supabase
        .from('checkin_schedules')
        .select('*')
        .eq('elderly_id', elderlyId)
        .maybeSingle();

      if (error) {
        console.error('Lỗi khi tải lịch điểm danh:', error);
        return { data: null, error };
      }

      if (!data) {
        return {
          data: {
            elderly_id: elderlyId,
            ...DEFAULT_SCHEDULE,
          },
          error: null,
        };
      }

      return { data: data as CheckinSchedule, error: null };
    } catch (err) {
      console.error('Ngoại lệ khi getSchedule:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Cập nhật lịch điểm danh cho Cụ thông qua RPC atomic
   * Kiểm tra validation: start < deadline và (deadline + buffer) < 86400s (không tràn ngày)
   */
  async updateSchedule(
    elderlyId: string,
    start: string,
    deadline: string,
    bufferMinutes: number = 30
  ): Promise<UpdateScheduleResult> {
    if (!elderlyId) {
      return { success: false, message: 'Thiếu thông tin Cụ', error: 'MISSING_ELDERLY_ID' };
    }

    const startSeconds = timeToSeconds(start);
    const deadlineSeconds = timeToSeconds(deadline);

    // Bất biến: start < deadline
    if (startSeconds >= deadlineSeconds) {
      return {
        success: false,
        message: 'Giờ bắt đầu phải diễn ra trước giờ hạn chót',
        error: 'INVALID_RANGE',
      };
    }

    // Bất biến: buffer từ 5 đến 120 phút
    if (bufferMinutes < 5 || bufferMinutes > 120) {
      return {
        success: false,
        message: 'Thời gian chờ phải từ 5 đến 120 phút',
        error: 'INVALID_BUFFER',
      };
    }

    // Bất biến 2: Kiểm tra không tràn ngày qua Epoch (< 86400)
    if (deadlineSeconds + bufferMinutes * 60 >= 86400) {
      return {
        success: false,
        message: 'Hạn chót cộng thời gian chờ không được vượt quá 23:59 trong ngày',
        error: 'DAY_OVERFLOW',
      };
    }

    try {
      const { data, error } = await supabase.rpc('update_checkin_schedule', {
        p_elderly_id: elderlyId,
        p_start: start.length === 5 ? `${start}:00` : start,
        p_deadline: deadline.length === 5 ? `${deadline}:00` : deadline,
        p_buffer_minutes: bufferMinutes,
      });

      if (error) {
        return {
          success: false,
          message: error.message || 'Lỗi từ máy chủ khi cập nhật lịch',
          error: error.code || 'RPC_ERROR',
        };
      }

      return data as UpdateScheduleResult;
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Lỗi không xác định khi cập nhật lịch',
        error: 'UNEXPECTED_ERROR',
      };
    }
  },

  /**
   * Cụ thực hiện điểm danh buổi sáng thông qua RPC atomic v2
   */
  async performCheckin(elderlyId: string): Promise<PerformCheckinResult> {
    if (!elderlyId) {
      return { success: false, message: 'Thiếu thông tin Cụ', error: 'MISSING_ELDERLY_ID' };
    }

    try {
      const { data, error } = await supabase.rpc('perform_checkin_atomic_v2', {
        p_elderly_id: elderlyId,
      });

      if (error) {
        return {
          success: false,
          message: error.message || 'Lỗi từ máy chủ khi điểm danh',
          error: error.code || 'RPC_ERROR',
        };
      }

      return data as PerformCheckinResult;
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Lỗi không xác định khi điểm danh',
        error: 'UNEXPECTED_ERROR',
      };
    }
  },
};
