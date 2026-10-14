export class PulseAudio {
  private context: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private bpm = 66;
  private enabled = false;

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    if (!enabled) {
      this.stopTimer();
      return;
    }

    try {
      if (!this.context) {
        this.context = new AudioContext();
      }
      if (this.context.state === "suspended") {
        await this.context.resume();
      }
      this.restartTimer();
    } catch {
      this.enabled = false;
      this.stopTimer();
    }
  }

  setBpm(bpm: number): void {
    this.bpm = Math.min(96, Math.max(48, bpm));
    if (this.enabled) {
      this.restartTimer();
    }
  }

  setPaused(paused: boolean): void {
    if (paused) {
      this.stopTimer();
    } else if (this.enabled) {
      this.restartTimer();
    }
  }

  pulse(strength = 1): void {
    if (!this.enabled || !this.context) {
      return;
    }
    const now = this.context.currentTime;
    this.createThump(now, 58, 0.12 * strength);
    this.createThump(now + 0.15, 43, 0.072 * strength);
  }

  dispose(): void {
    this.stopTimer();
    void this.context?.close();
    this.context = null;
  }

  private restartTimer(): void {
    this.stopTimer();
    this.pulse(0.62);
    const interval = (60 / this.bpm) * 1000;
    this.timer = setInterval(() => this.pulse(0.62), interval);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private createThump(at: number, frequency: number, gainValue: number): void {
    if (!this.context) {
      return;
    }
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(24, frequency * 0.58),
      at + 0.11,
    );
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(180, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(gainValue, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.2);
  }
}
