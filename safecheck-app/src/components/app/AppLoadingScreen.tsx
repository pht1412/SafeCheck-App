/**
 * AppLoadingScreen — Shared presentation component (không sở hữu state).
 *
 * Dùng cho:
 * - Auth loading tại App.tsx (isAuthChecking từ useAuthSession)
 * - Data loading tại ElderlyApp / CaregiverApp (isLoading từ useCheckinEngine)
 *
 * State được truyền vào thông qua props từ layer trên; component này chỉ render UI.
 */

interface AppLoadingScreenProps {
  /** Thông điệp hiển thị bên dưới icon. Default: 'Đang kiểm tra bảo mật SafeCheck...' */
  message?: string;
}

export default function AppLoadingScreen({
  message = 'Đang kiểm tra bảo mật SafeCheck...',
}: AppLoadingScreenProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-16 h-16 bg-emerald-600 rounded-3xl flex items-center justify-center animate-bounce mb-3 shadow-lg shadow-emerald-900/50">
        <span className="text-3xl">🛡️</span>
      </div>
      <p className="text-slate-400 text-sm animate-pulse">{message}</p>
    </div>
  );
}
