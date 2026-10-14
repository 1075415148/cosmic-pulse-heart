const TAU = Math.PI * 2;

export interface HeartbeatSample {
  phase: number;
  raw: number;
  normalized: number;
  primary: number;
  secondary: number;
  recoil: number;
}

function gaussian(value: number, mean: number, sigma: number): number {
  const normalized = (value - mean) / sigma;
  return Math.exp(-0.5 * normalized * normalized);
}

export function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

export function heartbeatEnvelope(phase: number): HeartbeatSample {
  const wrapped = wrap01(phase);
  const primary = gaussian(wrapped, 0.11, 0.035);
  const secondary = 0.58 * gaussian(wrapped, 0.28, 0.048);
  const recoil = 0.18 * gaussian(wrapped, 0.19, 0.028);
  const raw = primary + secondary - recoil;

  return {
    phase: wrapped,
    raw,
    normalized: Math.max(0, Math.min(1, raw)),
    primary,
    secondary,
    recoil,
  };
}

export function beatPhaseAt(
  elapsedSeconds: number,
  bpm: number,
  phaseOffset = 0,
): number {
  const safeBpm = Math.min(96, Math.max(48, bpm));
  return wrap01((elapsedSeconds * safeBpm) / 60 - phaseOffset);
}

export function particleHeartbeat(
  elapsedSeconds: number,
  bpm: number,
  radialDelay: number,
  groupDelay: number,
  seedJitter: number,
): HeartbeatSample {
  const secondsPerBeat = 60 / Math.min(96, Math.max(48, bpm));
  const delaySeconds = radialDelay + groupDelay + seedJitter;
  return heartbeatEnvelope(
    beatPhaseAt(elapsedSeconds - delaySeconds, bpm) +
      Math.sin(elapsedSeconds / secondsPerBeat / 16) * 0.0015,
  );
}

export function breathingEnvelope(elapsedSeconds: number): number {
  return 0.5 + 0.5 * Math.sin((elapsedSeconds / 6.4) * TAU - Math.PI / 2);
}
