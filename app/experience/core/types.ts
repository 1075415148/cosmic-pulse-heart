export type QualityMode = "auto" | "ultra" | "balanced" | "performance";
export type QualityTier = Exclude<QualityMode, "auto">;

export type ExperiencePhase =
  | "PREWARM"
  | "ASSEMBLE"
  | "AWAKEN"
  | "IDLE_BEAT"
  | "CHARGE"
  | "FRACTURE"
  | "BURST"
  | "SUSPEND"
  | "VORTEX_RETURN"
  | "OVERSHOOT"
  | "SETTLE";

export interface ExperienceSettings {
  qualityMode: QualityMode;
  bloom: number;
  bpm: number;
  autoCamera: boolean;
  muted: boolean;
  reducedMotion: boolean;
}

export interface ExperienceSnapshot {
  phase: ExperiencePhase;
  phaseProgress: number;
  charge: number;
  qualityTier: QualityTier;
  fps: number;
  isPaused: boolean;
  isReady: boolean;
  fallbackReason: string | null;
}

export interface PerformanceSample {
  averageFps: number;
  p95FrameMs: number;
  longFrames: number;
  timestamp: number;
  isTransient: boolean;
}

export const DEFAULT_SETTINGS: ExperienceSettings = {
  qualityMode: "auto",
  bloom: 0.7,
  bpm: 66,
  autoCamera: true,
  muted: true,
  reducedMotion: false,
};
