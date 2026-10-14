import { createClient } from '@supabase/supabase-js';
import { safeStorageAdapter, initSessionLifecycle } from './services/safeStorageAdapter';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Chưa tìm thấy VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY trong file .env');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: safeStorageAdapter,
  },
});

// Tự động khôi phục và refresh token khi online hoặc chuyển tab
if (typeof window !== 'undefined') {
  initSessionLifecycle(supabase);
}