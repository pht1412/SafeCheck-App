import { useState } from 'react';
import { authService } from '../services/authService';
import type { UserProfile, UserRole } from '../types';

interface AuthScreenProps {
  onAuthSuccess: (profile: UserProfile) => void;
}

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [role, setRole] = useState<UserRole>('elderly');

  // Form states
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');

  // UI status
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      if (mode === 'signup') {
        if (!identifier.trim()) {
          throw new Error('Vui lòng nhập số điện thoại hoặc email');
        }
        if (!fullName.trim()) {
          throw new Error('Vui lòng nhập họ và tên');
        }
        if (password.length < 6) {
          throw new Error('Mật khẩu phải có ít nhất 6 ký tự');
        }

        const data = await authService.signUp({
          identifier,
          password,
          fullName: fullName.trim(),
          role,
        });

        if (data.user) {
          let profile = await authService.fetchProfile(data.user.id);
          for (let i = 0; i < 4 && !profile; i++) {
            await new Promise((r) => setTimeout(r, 400));
            profile = await authService.fetchProfile(data.user.id);
          }
          if (profile) {
            onAuthSuccess(profile);
          } else {
            onAuthSuccess({
              id: data.user.id,
              email: data.user.email || null,
              full_name: fullName.trim(),
              role,
              avatar_url: null,
              phone: identifier.includes('@') ? null : identifier,
              pairing_code: null,
            });
          }
        }
      } else {
        // Đăng nhập
        if (!identifier.trim()) {
          throw new Error('Vui lòng nhập số điện thoại hoặc email');
        }
        if (!password) {
          throw new Error('Vui lòng nhập mật khẩu');
        }

        const data = await authService.signIn({
          identifier,
          password,
        });

        if (data.user) {
          const profile = await authService.fetchProfile(data.user.id);
          if (profile) {
            onAuthSuccess(profile);
          } else {
            throw new Error('Không tìm thấy thông tin hồ sơ người dùng');
          }
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Có lỗi xảy ra, vui lòng thử lại');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-0 sm:p-4 font-sans selection:bg-emerald-500 selection:text-white">
      {/* Khung mô phỏng ứng dụng điện thoại (Mobile Container) */}
      <div className="w-full sm:w-[390px] min-h-screen sm:min-h-0 bg-slate-900 border-0 sm:border-2 border-slate-800 rounded-none sm:rounded-[36px] p-6 shadow-2xl flex flex-col justify-between sm:ring-1 sm:ring-white/10 relative overflow-hidden">
        
        {/* Header ứng dụng */}
        <div className="text-center mb-5">
          <div className="w-16 h-16 bg-gradient-to-tr from-emerald-600 to-teal-400 rounded-3xl mx-auto flex items-center justify-center shadow-lg shadow-emerald-900/40 mb-3">
            <span className="text-3xl">🛡️</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">SafeCheck</h1>
          <p className="text-xs text-slate-400 mt-0.5">Hệ thống an tâm trực tuyến cho người cao tuổi</p>
        </div>

        {/* Tab chuyển đổi Đăng nhập / Đăng ký */}
        <div className="flex bg-slate-950 p-1 rounded-2xl mb-5 border border-slate-800">
          <button
            type="button"
            onClick={() => {
              setMode('signin');
              setErrorMessage(null);
            }}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${
              mode === 'signin'
                ? 'bg-slate-800 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Đăng nhập
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setErrorMessage(null);
            }}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${
              mode === 'signup'
                ? 'bg-slate-800 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Tạo tài khoản mới
          </button>
        </div>

        {/* Thông báo lỗi nếu có */}
        {errorMessage && (
          <div
            data-testid="auth-error-alert"
            className="mb-4 bg-rose-950/80 border border-rose-600/80 p-3 rounded-2xl text-xs text-rose-200 flex items-start gap-2 animate-in fade-in"
          >
            <span className="text-base leading-none">⚠️</span>
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Khi ở chế độ ĐĂNG KÝ: Chọn Role trước */}
          {mode === 'signup' && (
            <div className="space-y-2">
              <label className="text-[11px] uppercase font-bold text-slate-400 tracking-wider block">
                Chọn vai trò của bạn:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="role-elderly-btn"
                  onClick={() => setRole('elderly')}
                  className={`p-3 rounded-2xl border-2 text-left transition-all flex flex-col justify-between ${
                    role === 'elderly'
                      ? 'bg-emerald-950/40 border-emerald-500 text-emerald-200 shadow-md shadow-emerald-950/50'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <span className="text-2xl mb-1">👴</span>
                  <div>
                    <strong className="text-xs font-bold block text-white">Ông / Bà</strong>
                    <span className="text-[10px] text-slate-400 leading-tight block mt-0.5">
                      Điểm danh & SOS
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  data-testid="role-caregiver-btn"
                  onClick={() => setRole('caregiver')}
                  className={`p-3 rounded-2xl border-2 text-left transition-all flex flex-col justify-between ${
                    role === 'caregiver'
                      ? 'bg-indigo-950/40 border-indigo-500 text-indigo-200 shadow-md shadow-indigo-950/50'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <span className="text-2xl mb-1">🧑</span>
                  <div>
                    <strong className="text-xs font-bold block text-white">Con cháu</strong>
                    <span className="text-[10px] text-slate-400 leading-tight block mt-0.5">
                      Theo dõi & Nhận tin
                    </span>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Ô nhập Họ và Tên (chỉ khi đăng ký) */}
          {mode === 'signup' && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">
                {role === 'elderly' ? 'Tên gọi của Cụ:' : 'Họ và tên của bạn:'}
              </label>
              <input
                type="text"
                required
                data-testid="auth-fullname-input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={role === 'elderly' ? 'Ví dụ: Cụ Ba, Bà Ngoại' : 'Ví dụ: Nguyễn Văn Tuấn'}
                className="w-full h-12 bg-slate-950 border border-slate-800 rounded-2xl px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
          )}

          {/* Ô nhập Số điện thoại hoặc Email */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">
              {mode === 'signup' && role === 'elderly'
                ? 'Số điện thoại của Cụ:'
                : 'Số điện thoại hoặc Email:'}
            </label>
            <input
              type={mode === 'signup' && role === 'elderly' ? 'tel' : 'text'}
              inputMode={mode === 'signup' && role === 'elderly' ? 'tel' : 'text'}
              required
              data-testid="auth-identifier-input"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={
                mode === 'signup' && role === 'elderly'
                  ? 'Ví dụ: 0901234567'
                  : '0901234567 hoặc conchau@gmail.com'
              }
              className="w-full h-12 bg-slate-950 border border-slate-800 rounded-2xl px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          {/* Ô nhập Mật khẩu */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">Mật khẩu:</label>
            <input
              type="password"
              required
              data-testid="auth-password-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tối thiểu 6 ký tự"
              className="w-full h-12 bg-slate-950 border border-slate-800 rounded-2xl px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          {/* Nút bấm Submit to bản, dễ chạm trên điện thoại */}
          <button
            type="submit"
            disabled={isLoading}
            data-testid="auth-submit-btn"
            className="w-full h-14 bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white text-base font-black rounded-2xl shadow-xl shadow-emerald-900/30 transition-all flex items-center justify-center gap-2 mt-3 disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                </svg>
                Đang xử lý...
              </span>
            ) : mode === 'signin' ? (
              'ĐĂNG NHẬP'
            ) : (
              'HOÀN TẤT ĐĂNG KÝ'
            )}
          </button>
        </form>

        {/* Chân trang ghi chú bảo mật */}
        <div className="mt-5 text-center">
          <p className="text-[10px] text-slate-500">
            🔒 Bảo mật theo tiêu chuẩn SafeCheck & Supabase Cloud
          </p>
        </div>

      </div>
    </div>
  );
}
