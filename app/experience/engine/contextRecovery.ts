export const CONTEXT_LOSS_WINDOW_MS = 60_000;
export const CONTEXT_RESTORE_TIMEOUT_MS = 3_000;
export const MAX_CONTEXT_RECOVERY_FAILURES = 3;

export function isContextRecoveryTimedOut(
  startedAt: number,
  now: number,
): boolean {
  return now - startedAt >= CONTEXT_RESTORE_TIMEOUT_MS;
}

export interface ContextLossDecision {
  forcePerformance: boolean;
  recentLossCount: number;
}

export interface ContextFailureDecision {
  failureCount: number;
  locked: boolean;
  newlyRecorded: boolean;
}

export class ContextRecoveryPolicy {
  private lossTimestamps: number[] = [];
  private failures = 0;
  private failureRecordedForIncident = false;
  private locked = false;

  beginLoss(now: number): ContextLossDecision {
    this.lossTimestamps = this.lossTimestamps.filter(
      (timestamp) => now - timestamp <= CONTEXT_LOSS_WINDOW_MS,
    );
    this.lossTimestamps.push(now);
    this.failureRecordedForIncident = false;
    return {
      forcePerformance: this.lossTimestamps.length >= 2,
      recentLossCount: this.lossTimestamps.length,
    };
  }

  recordFailure(): ContextFailureDecision {
    const newlyRecorded = !this.failureRecordedForIncident;
    if (newlyRecorded) {
      this.failures += 1;
      this.failureRecordedForIncident = true;
    }
    this.locked = this.failures >= MAX_CONTEXT_RECOVERY_FAILURES;
    return {
      failureCount: this.failures,
      locked: this.locked,
      newlyRecorded,
    };
  }

  recordSuccess(): void {
    this.failures = 0;
    this.failureRecordedForIncident = false;
    this.locked = false;
  }

  beginManualRetry(): void {
    if (this.locked) {
      this.failures = 0;
      this.locked = false;
    }
    this.failureRecordedForIncident = false;
  }

  get failureCount(): number {
    return this.failures;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  get recentLossCount(): number {
    return this.lossTimestamps.length;
  }
}
