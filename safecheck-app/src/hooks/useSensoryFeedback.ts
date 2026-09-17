import { playChimeSound } from '../utils/sirenPlayer';

export interface UseSensoryFeedbackReturn {
  /** Nói văn bản bằng giọng tiếng Việt (vi-VN, rate 0.9). */
  speak: (message: string) => void;
  /** Rung thiết bị theo pattern. Default: [200, 100, 200]. */
  vibrate: (pattern?: number[]) => void;
  /**
   * Kết hợp rung + giọng nói — đây là hành vi hiện tại của triggerSensoryFeedback() trong App.tsx.
   * Giữ nguyên 100%: vibrate([200,100,200]) + speak(vi-VN, rate 0.9).
   */
  triggerFeedback: (message: string) => void;
  /** Phát âm thanh chuông Ding-Dong. Wraps playChimeSound() từ utils/sirenPlayer. */
  playChime: () => void;
}

/**
 * Hook cảm quan đa kênh cho SafeCheck.
 *
 * Trách nhiệm:
 * - Rung thiết bị (navigator.vibrate)
 * - Giọng nói tiếng Việt (window.speechSynthesis)
 * - Phát chuông Ding-Dong (playChimeSound)
 *
 * KHÔNG chứa SirenPlayer (thuộc useSos — gắn với SOS lifecycle).
 * KHÔNG biết về SOS, Ping, hay Check-in.
 *
 * Platform abstraction: sau này nếu chuyển sang Capacitor/native,
 * chỉ cần sửa implementation bên trong hook này, không đụng đến business hooks.
 */
export function useSensoryFeedback(): UseSensoryFeedbackReturn {
  const speak = (message: string): void => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = 'vi-VN';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  };

  const vibrate = (pattern: number[] = [200, 100, 200]): void => {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  };

  const triggerFeedback = (message: string): void => {
    vibrate();
    speak(message);
  };

  const playChime = (): void => {
    playChimeSound();
  };

  return { speak, vibrate, triggerFeedback, playChime };
}
