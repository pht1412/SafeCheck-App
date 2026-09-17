import ElderlyApp from './ElderlyApp.tsx';
import CaregiverApp from './CaregiverApp.tsx';
import type { UserProfile } from '../../types';

interface AuthenticatedAppProps {
  userProfile: UserProfile;
  signOut: () => Promise<void>;
}

/**
 * Application composition layer — nhận userProfile + signOut, điều phối theo role.
 *
 * Layer này không gọi hooks trực tiếp.
 * Business logic thuộc về ElderlyApp / CaregiverApp.
 */
export default function AuthenticatedApp({ userProfile, signOut }: AuthenticatedAppProps) {
  if (userProfile.role === 'elderly') {
    return <ElderlyApp userProfile={userProfile} />;
  }
  if (userProfile.role === 'caregiver') {
    return <CaregiverApp userProfile={userProfile} signOut={signOut} />;
  }
  // Safety fallback nếu role không hợp lệ
  return null;
}
