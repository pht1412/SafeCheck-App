import { useAuthSession } from './hooks/useAuthSession';
import AuthScreen from './components/AuthScreen';
import AppLoadingScreen from './components/app/AppLoadingScreen';
import AuthenticatedApp from './components/app/AuthenticatedApp';

/**
 * App.tsx — Composition only (~25 dòng).
 *
 * Trách nhiệm duy nhất:
 * - Kiểm tra phiên đăng nhập (useAuthSession)
 * - Render loading screen / auth screen / authenticated app
 *
 * KHÔNG chứa: business logic, state machine, realtime, SOS, check-in, ping.
 * Mọi logic nghiệp vụ đã chuyển vào domain hooks + ElderlyApp / CaregiverApp.
 */
export default function App() {
  const { isAuthChecking, userProfile, setUserProfile, signOut } = useAuthSession();

  if (isAuthChecking) {
    return <AppLoadingScreen />;
  }

  if (!userProfile) {
    return <AuthScreen onAuthSuccess={setUserProfile} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-0 sm:p-4 flex flex-col items-center justify-center font-sans">
      <AuthenticatedApp userProfile={userProfile} signOut={signOut} />
    </div>
  );
}