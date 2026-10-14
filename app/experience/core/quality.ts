import type {
  PerformanceSample,
  QualityMode,
  QualityTier,
} from "./types";

export interface QualityProfile {
  tier: QualityTier;
  textureSize: number;
  maxParticles: number;
  dpr: number;
  bloomScale: number;
  orbitParticles: number;
  backgroundParticles: number;
  trails: number;
  targetFps: number;
  p95BudgetMs: number;
}

export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  performance: {
    tier: "performance",
    textureSize: 128,
    maxParticles: 128 * 128,
    dpr: 1.25,
    bloomScale: 0.5,
    orbitParticles: 240,
    backgroundParticles: 1_000,
    trails: 6,
    targetFps: 28,
    p95BudgetMs: 45,
  },
  balanced: {
    tier: "balanced",
    textureSize: 224,
    maxParticles: 224 * 224,
    dpr: 1.5,
    bloomScale: 0.75,
    orbitParticles: 650,
    backgroundParticles: 2_500,
    trails: 14,
    targetFps: 45,
    p95BudgetMs: 30,
  },
  ultra: {
    tier: "ultra",
    textureSize: 384,
    maxParticles: 384 * 384,
    dpr: 2,
    bloomScale: 1,
    orbitParticles: 1_250,
    backgroundParticles: 5_000,
    trails: 28,
    targetFps: 55,
    p95BudgetMs: 22,
  },
};

const ORDER: QualityTier[] = ["performance", "balanced", "ultra"];

export interface CapabilityHints {
  mobile: boolean;
  reducedMotion: boolean;
  screenPixels: number;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export function chooseInitialTier(hints: CapabilityHints): QualityTier {
  if (hints.reducedMotion || hints.mobile) {
    return "performance";
  }

  const enoughMemory = (hints.deviceMemory ?? 4) >= 8;
  const enoughCores = (hints.hardwareConcurrency ?? 4) >= 8;
  const reasonablePixels = hints.screenPixels <= 3_686_400;
  return enoughMemory && enoughCores && reasonablePixels
    ? "balanced"
    : "performance";
}

export class AdaptiveQualityController {
  private tier: QualityTier;
  private lowWindows = 0;
  private highWindows = 0;
  private lastChangeAt = -Infinity;

  constructor(initialTier: QualityTier) {
    this.tier = initialTier;
  }

  get currentTier(): QualityTier {
    return this.tier;
  }

  reset(tier: QualityTier): void {
    this.tier = tier;
    this.lowWindows = 0;
    this.highWindows = 0;
    this.lastChangeAt = -Infinity;
  }

  sample(
    mode: QualityMode,
    sample: PerformanceSample,
  ): QualityTier | null {
    if (mode !== "auto" || sample.isTransient) {
      return null;
    }

    const profile = QUALITY_PROFILES[this.tier];
    const low =
      sample.averageFps < profile.targetFps ||
      sample.p95FrameMs > profile.p95BudgetMs * 1.5;
    const emergency = sample.averageFps < 15;
    const high =
      sample.averageFps > profile.targetFps + 10 &&
      sample.p95FrameMs < profile.p95BudgetMs * 0.72;

    this.lowWindows = low ? this.lowWindows + 1 : 0;
    this.highWindows = high ? this.highWindows + 1 : 0;

    const sinceChange = sample.timestamp - this.lastChangeAt;
    if ((emergency || this.lowWindows >= 3) && sinceChange >= 15_000) {
      return this.move(-1, sample.timestamp);
    }

    if (this.highWindows >= 10 && sinceChange >= 20_000) {
      return this.move(1, sample.timestamp);
    }

    return null;
  }

  private move(direction: -1 | 1, timestamp: number): QualityTier | null {
    const index = ORDER.indexOf(this.tier);
    const nextIndex = Math.max(0, Math.min(ORDER.length - 1, index + direction));
    if (nextIndex === index) {
      this.lowWindows = 0;
      this.highWindows = 0;
      return null;
    }

    this.tier = ORDER[nextIndex];
    this.lowWindows = 0;
    this.highWindows = 0;
    this.lastChangeAt = timestamp;
    return this.tier;
  }
}
