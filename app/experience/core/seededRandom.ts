export type RandomSource = () => number;

export function hashSeed(value: string | number): number {
  const text = String(value);
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function createSeededRandom(seed: string | number): RandomSource {
  let state = hashSeed(seed) || 0x6d2b79f5;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomRange(
  random: RandomSource,
  minimum: number,
  maximum: number,
): number {
  return minimum + (maximum - minimum) * random();
}

export function randomSigned(random: RandomSource): number {
  return random() * 2 - 1;
}
