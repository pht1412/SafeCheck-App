import { supabase } from '../supabaseClient';
import type { EmergencyContact, EmergencyContactCategory } from '../types';

export interface CreateContactInput {
  elderly_id: string;
  name: string;
  phone: string;
  contact_type: EmergencyContactCategory;
  note?: string;
  priority_order?: number;
}

export interface UpdateContactInput {
  name?: string;
  phone?: string;
  contact_type?: EmergencyContactCategory;
  note?: string;
  priority_order?: number;
}

export const emergencyContactsService = {
  /**
   * Lấy danh sách liên hệ khẩn cấp của Cụ, sắp xếp theo thứ tự ưu tiên 1 -> 5
   */
  async getContactsByElderlyId(elderlyId: string): Promise<{ data: EmergencyContact[]; error: any }> {
    try {
      const { data, error } = await supabase
        .from('emergency_contacts')
        .select('*')
        .eq('elderly_id', elderlyId)
        .order('priority_order', { ascending: true });

      if (error) {
        console.error('[emergencyContactsService] getContactsByElderlyId error:', error);
        return { data: [], error };
      }

      return { data: (data as EmergencyContact[]) || [], error: null };
    } catch (err) {
      console.error('[emergencyContactsService] Unexpected error:', err);
      return { data: [], error: err };
    }
  },

  /**
   * Thêm liên hệ khẩn cấp mới (Tối đa 5 liên hệ cho mỗi Cụ)
   */
  async createContact(input: CreateContactInput): Promise<{ data: EmergencyContact | null; error: any }> {
    try {
      // 1. Kiểm tra số lượng hiện tại
      const { data: existing, error: countErr } = await supabase
        .from('emergency_contacts')
        .select('id, priority_order')
        .eq('elderly_id', input.elderly_id);

      if (countErr) return { data: null, error: countErr };

      if (existing && existing.length >= 5) {
        return {
          data: null,
          error: { message: 'Mỗi Cụ chỉ được lưu tối đa 5 liên hệ cứu hộ khẩn cấp!' },
        };
      }

      // Xác định priority_order tiếp theo nếu chưa có
      const nextPriority = input.priority_order || (existing ? existing.length + 1 : 1);

      const { data, error } = await supabase
        .from('emergency_contacts')
        .insert({
          elderly_id: input.elderly_id,
          name: input.name.trim(),
          phone: input.phone.trim(),
          contact_type: input.contact_type,
          note: input.note?.trim() || null,
          priority_order: nextPriority,
        })
        .select()
        .single();

      return { data: data as EmergencyContact | null, error };
    } catch (err) {
      return { data: null, error: err };
    }
  },

  /**
   * Cập nhật thông tin liên hệ (không cho phép đổi elderly_id)
   */
  async updateContact(
    contactId: string,
    updates: UpdateContactInput
  ): Promise<{ data: EmergencyContact | null; error: any }> {
    try {
      const payload: any = {
        updated_at: new Date().toISOString(),
      };

      if (updates.name !== undefined) payload.name = updates.name.trim();
      if (updates.phone !== undefined) payload.phone = updates.phone.trim();
      if (updates.contact_type !== undefined) payload.contact_type = updates.contact_type;
      if (updates.note !== undefined) payload.note = updates.note ? updates.note.trim() : null;
      if (updates.priority_order !== undefined) payload.priority_order = updates.priority_order;

      const { data, error } = await supabase
        .from('emergency_contacts')
        .update(payload)
        .eq('id', contactId)
        .select()
        .single();

      return { data: data as EmergencyContact | null, error };
    } catch (err) {
      return { data: null, error: err };
    }
  },

  /**
   * Xóa liên hệ (Trigger database sẽ tự normalize lại thứ tự 1..N)
   */
  async deleteContact(contactId: string): Promise<{ error: any }> {
    try {
      const { error } = await supabase
        .from('emergency_contacts')
        .delete()
        .eq('id', contactId);

      return { error };
    } catch (err) {
      return { error: err };
    }
  },
};
