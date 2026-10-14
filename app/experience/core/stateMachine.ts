import type { ExperiencePhase } from "./types";

const PHASE_DURATIONS: Partial<Record<ExperiencePhase, number>> = {
  PREWARM: 2.5,
  ASSEMBLE: 3.2,
  AWAKEN: 1.35,
  FRACTURE: 0.18,
  BURST: 0.7,
  SUSPEND: 0.55,
  VORTEX_RETURN: 1.8,
  OVERSHOOT: 0.28,
  SETTLE: 0.58,
};

const NEXT_PHASE: Partial<Record<ExperiencePhase, ExperiencePhase>> = {
  PREWARM: "ASSEMBLE",
  ASSEMBLE: "AWAKEN",
  AWAKEN: "IDLE_BEAT",
  FRACTURE: "BURST",
  BURST: "SUSPEND",
  SUSPEND: "VORTEX_RETURN",
  VORTEX_RETURN: "OVERSHOOT",
  OVERSHOOT: "SETTLE",
  SETTLE: "IDLE_BEAT",
};

export interface StateMachineOptions {
  reducedMotion?: boolean;
  onPhaseChange?: (
    phase: ExperiencePhase,
    previous: ExperiencePhase,
  ) => void;
}

export class ExperienceStateMachine {
  private phase: ExperiencePhase;
  private elapsed = 0;
  private charge = 0;
  private readonly onPhaseChange?: StateMachineOptions["onPhaseChange"];
  private reducedMotion: boolean;
  private queuedPulse = false;

  constructor(options: StateMachineOptions = {}) {
    this.reducedMotion = options.reducedMotion ?? false;
    this.onPhaseChange = options.onPhaseChange;
    this.phase = this.reducedMotion ? "IDLE_BEAT" : "PREWARM";
  }

  get current(): ExperiencePhase {
    return this.phase;
  }

  get phaseElapsed(): number {
    return this.elapsed;
  }

  get phaseProgress(): number {
    const duration = this.getDuration();
    return duration === null ? 0 : Math.min(1, this.elapsed / duration);
  }

  get chargeAmount(): number {
    return this.charge;
  }

  get isBurstSequence(): boolean {
    return [
      "FRACTURE",
      "BURST",
      "SUSPEND",
      "VORTEX_RETURN",
      "OVERSHOOT",
    ].includes(this.phase);
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    if (value && this.phase !== "IDLE_BEAT") {
      this.transition("IDLE_BEAT");
      this.charge = 0;
    }
  }

  markReady(): void {
    if (this.phase === "PREWARM") {
      this.transition(this.reducedMotion ? "IDLE_BEAT" : "ASSEMBLE");
    }
  }

  update(deltaSeconds: number): void {
    const delta = Math.max(0, Math.min(0.05, deltaSeconds));

    if (this.phase === "CHARGE") {
      this.elapsed += delta;
      this.charge = Math.min(1, Math.max(0, (this.elapsed - 0.18) / 1.42));
      return;
    }

    this.elapsed += delta;
    const duration = this.getDuration();
    if (duration !== null && this.elapsed >= duration) {
      const next = NEXT_PHASE[this.phase];
      if (next) {
        this.transition(next);
      }
    }
  }

  startCharge(): boolean {
    if (this.reducedMotion || this.phase !== "IDLE_BEAT") {
      return false;
    }
    this.transition("CHARGE");
    this.charge = 0;
    return true;
  }

  releaseCharge(cancelled = false): boolean {
    if (this.phase !== "CHARGE") {
      return false;
    }

    if (cancelled || this.charge < 0.12 || this.reducedMotion) {
      this.transition("SETTLE");
      return false;
    }

    PHASE_DURATIONS.SUSPEND = 0.28 + 0.42 * this.charge;
    PHASE_DURATIONS.VORTEX_RETURN = 1.55 + 0.45 * this.charge;
    this.transition("FRACTURE");
    return true;
  }

  requestPulse(): boolean {
    if (this.phase === "IDLE_BEAT") {
      return true;
    }
    if (this.phase === "SETTLE") {
      this.queuedPulse = true;
    }
    return false;
  }

  consumeQueuedPulse(): boolean {
    if (this.phase !== "IDLE_BEAT" || !this.queuedPulse) {
      return false;
    }
    this.queuedPulse = false;
    return true;
  }

  replay(): void {
    this.charge = 0;
    this.queuedPulse = false;
    this.transition(this.reducedMotion ? "IDLE_BEAT" : "ASSEMBLE");
  }

  forceIdle(): void {
    this.charge = 0;
    this.queuedPulse = false;
    this.transition("IDLE_BEAT");
  }

  private getDuration(): number | null {
    return PHASE_DURATIONS[this.phase] ?? null;
  }

  private transition(next: ExperiencePhase): void {
    if (next === this.phase) {
      return;
    }
    const previous = this.phase;
    this.phase = next;
    this.elapsed = 0;
    if (next !== "CHARGE" && next !== "FRACTURE" && !this.isBurstSequence) {
      this.charge = 0;
    }
    this.onPhaseChange?.(next, previous);
  }
}
