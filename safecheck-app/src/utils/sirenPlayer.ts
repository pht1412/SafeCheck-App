// Trình phát còi hú khẩn cấp dồn dập (Web Audio API)
export class SirenPlayer {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private isPlaying = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.isPlaying) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.gain = this.ctx.createGain();
      this.gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
      this.gain.connect(this.ctx.destination);

      this.osc = this.ctx.createOscillator();
      this.osc.type = 'sawtooth';
      this.osc.frequency.setValueAtTime(650, this.ctx.currentTime);
      this.osc.connect(this.gain);
      this.osc.start();

      let toggle = false;
      this.intervalId = setInterval(() => {
        if (!this.osc || !this.ctx) return;
        toggle = !toggle;
        this.osc.frequency.exponentialRampToValueAtTime(
          toggle ? 950 : 600,
          this.ctx.currentTime + 0.25
        );
      }, 350);

      this.isPlaying = true;
    } catch (err) {
      console.warn('Không thể phát còi báo động:', err);
    }
  }

  stop() {
    if (!this.isPlaying) return;
    if (this.intervalId) clearInterval(this.intervalId);
    try {
      if (this.osc) {
        this.osc.stop();
        this.osc.disconnect();
      }
      if (this.ctx && this.ctx.state !== 'closed') {
        this.ctx.close();
      }
    } catch (err) {}
    this.osc = null;
    this.ctx = null;
    this.gain = null;
    this.isPlaying = false;
  }
}

// Trình phát chuông hỏi thăm ấm áp "Ding-Dong" (Web Audio API)
export function playChimeSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    // Nốt 1: "Ding" (E5 - 659.25 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, ctx.currentTime);
    gain1.gain.setValueAtTime(0.35, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.6);

    // Nốt 2: "Dong" (C5 - 523.25 Hz) phát sau 0.28 giây
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(523.25, ctx.currentTime + 0.28);
    gain2.gain.setValueAtTime(0.35, ctx.currentTime + 0.28);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.28);
    osc2.stop(ctx.currentTime + 1.2);

    setTimeout(() => {
      if (ctx.state !== 'closed') ctx.close();
    }, 1500);
  } catch (err) {
    console.warn('Không thể phát chuông Ding-Dong:', err);
  }
}
