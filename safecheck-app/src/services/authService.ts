import { supabase } from '../supabaseClient';
import type { UserProfile, UserRole } from '../types';

/**
 * Chuẩn hóa số điện thoại hoặc email:
 * - Nếu người dùng nhập email (chứa @) -> Giữ nguyên.
 * - Nếu người dùng nhập số điện thoại -> Chuyển thành virtual email dạng: 0901234567@safecheck.local
 */
export function normalizeIdentifierToEmail(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.includes('@')) {
    return trimmed.toLowerCase();
  }
  // Lọc chỉ giữ chữ số cho số điện thoại
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return `${digits}@safecheck.local`;
}

export interface SignUpParams {
  identifier: string; // Số điện thoại hoặc email
  password: string;
  fullName: string;
  role: UserRole;
  phone?: string;
}

export interface SignInParams {
  identifier: string; // Số điện thoại hoặc email
  password: string;
}

export const authService = {
  /**
   * Đăng ký tài khoản mới (Hỗ trợ cả SĐT cho Cụ và Email cho Con cháu)
   */
  async signUp({ identifier, password, fullName, role, phone }: SignUpParams) {
    const email = normalizeIdentifierToEmail(identifier);
    if (!email) {
      throw new Error('Vui lòng nhập số điện thoại hoặc email hợp lệ');
    }

    const actualPhone = phone || (identifier.includes('@') ? '' : identifier.replace(/\D/g, ''));

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          role,
          full_name: fullName,
          phone: actualPhone,
        },
      },
    });

    if (error) {
      if (error.message.includes('User already registered')) {
        throw new Error('Số điện thoại hoặc email này đã được đăng ký');
      }
      if (error.message.includes('Password should be')) {
        throw new Error('Mật khẩu phải có ít nhất 6 ký tự');
      }
      throw new Error(error.message || 'Đăng ký thất bại');
    }

    return data;
  },

  /**
   * Đăng nhập (Linh hoạt: Nhập số điện thoại hay email đều được)
   */
  async signIn({ identifier, password }: SignInParams) {
    const email = normalizeIdentifierToEmail(identifier);
    if (!email) {
      throw new Error('Vui lòng nhập số điện thoại hoặc email');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        throw new Error('Số điện thoại / email hoặc mật khẩu không chính xác');
      }
      throw new Error(error.message || 'Đăng nhập thất bại');
    }

    return data;
  },

  /**
   * Đăng xuất tài khoản
   */
  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  /**
   * Lấy thông tin phiên làm việc hiện tại
   */
  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  /**
   * Lấy chi tiết hồ sơ profile từ bảng public.profiles
   */
  async fetchProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Lỗi lấy profile:', error);
      return null;
    }

    return data as UserProfile | null;
  },
};
