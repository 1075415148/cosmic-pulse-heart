import * as THREE from "three";
import {
  createSeededRandom,
  randomRange,
  randomSigned,
} from "../core";

export interface HeartTextureData {
  initialPosition: Float32Array;
  settledPosition: Float32Array;
  initialVelocity: Float32Array;
  homeGroup: Float32Array;
  normalDepth: Float32Array;
  particleMeta: Float32Array;
  spawnData: Float32Array;
}

interface Point2 {
  x: number;
  y: number;
}

function heartCurve(t: number): Point2 {
  const sin = Math.sin(t);
  return {
    x: (16 * sin * sin * sin) / 17,
    y:
      (13 * Math.cos(t) -
        5 * Math.cos(2 * t) -
        2 * Math.cos(3 * t) -
        Math.cos(4 * t)) /
      17,
  };
}

function curveNormal(t: number, point: Point2): Point2 {
  const epsilon = 0.002;
  const before = heartCurve(t - epsilon);
  const after = heartCurve(t + epsilon);
  const tangentX = after.x - before.x;
  const tangentY = after.y - before.y;
  const length = Math.hypot(tangentX, tangentY);

  if (length < 0.0001) {
    const fallbackLength = Math.max(0.0001, Math.hypot(point.x, point.y));
    return {
      x: point.x / fallbackLength,
      y: point.y / fallbackLength,
    };
  }

  let x = tangentY / length;
  let y = -tangentX / length;
  const outwardX = point.x;
  const outwardY = point.y - 0.08;
  if (x * outwardX + y * outwardY < 0) {
    x *= -1;
    y *= -1;
  }
  return { x, y };
}

function writeVector(
  target: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  w: number,
): void {
  const offset = index * 4;
  target[offset] = x;
  target[offset + 1] = y;
  target[offset + 2] = z;
  target[offset + 3] = w;
}

export function createHeartTextureData(
  textureSize: number,
  seed: string | number,
): HeartTextureData {
  const halfDepth = 0.52;
  const count = textureSize * textureSize;
  const random = createSeededRandom(seed);
  const initialPosition = new Float32Array(count * 4);
  const settledPosition = new Float32Array(count * 4);
  const initialVelocity = new Float32Array(count * 4);
  const homeGroup = new Float32Array(count * 4);
  const normalDepth = new Float32Array(count * 4);
  const particleMeta = new Float32Array(count * 4);
  const spawnData = new Float32Array(count * 4);

  for (let index = 0; index < count; index += 1) {
    const ratio = index / count;
    let group = 0;
    if (ratio >= 0.52 && ratio < 0.82) {
      group = 1;
    } else if (ratio >= 0.82 && ratio < 0.9) {
      group = 2;
    } else if (ratio >= 0.9 && ratio < 0.97) {
      group = 3;
    } else if (ratio >= 0.97) {
      group = 4;
    }

    const t = randomRange(random, 0, Math.PI * 2);
    const curve = heartCurve(t);
    const planarNormal = curveNormal(t, curve);
    let x = 0;
    let y = 0;
    let z = 0;
    let normalX = planarNormal.x;
    let normalY = planarNormal.y;
    let normalZ = 0;
    let depth = 0;

    if (group === 0) {
      if (random() < 0.62) {
        const radial = Math.sqrt(random()) * 0.985;
        const depthRadius = Math.sqrt(Math.max(0, 1 - radial * radial));
        const side = random() < 0.5 ? -1 : 1;
        x = curve.x * radial;
        y = curve.y * radial + 0.04;
        const verticalBulge =
          0.78 + 0.22 * (1 - Math.min(1, Math.abs(y - 0.08)));
        z = side * halfDepth * depthRadius * verticalBulge;
        normalX = planarNormal.x * radial;
        normalY = planarNormal.y * radial;
        normalZ = side * (depthRadius / halfDepth);
        depth = Math.abs(z / halfDepth);
      } else {
        z = randomSigned(random) * halfDepth;
        const depthRatio = z / halfDepth;
        const shellScale = 1 - 0.25 * depthRatio * depthRatio;
        x = curve.x * shellScale;
        y = curve.y * shellScale + 0.04;
        normalZ = depthRatio * 0.9;
        depth = Math.abs(depthRatio);
      }
    } else if (group === 1) {
      const radial = Math.sqrt(random()) * 0.88;
      const depthRadius = Math.sqrt(Math.max(0, 1 - radial * radial));
      x = curve.x * radial;
      y = curve.y * radial + 0.04;
      z = randomSigned(random) * halfDepth * 0.9 * depthRadius;
      normalX = x;
      normalY = y - 0.04;
      normalZ = z * 2.15;
      depth = 1 - radial;
    } else if (group === 2) {
      const radius = Math.cbrt(random()) * 0.2;
      const azimuth = randomRange(random, 0, Math.PI * 2);
      const elevation = Math.acos(randomSigned(random));
      x = Math.sin(elevation) * Math.cos(azimuth) * radius;
      y = 0.03 + Math.cos(elevation) * radius * 0.78;
      z = Math.sin(elevation) * Math.sin(azimuth) * radius * 0.94;
      normalX = x;
      normalY = y - 0.03;
      normalZ = z;
      depth = 1;
    } else if (group === 3) {
      const lane = index % 4;
      const surfaceRadius = 0.82 + lane * 0.035;
      const side = lane < 2 ? 1 : -1;
      const surfaceDepth = Math.sqrt(
        Math.max(0, 1 - surfaceRadius * surfaceRadius),
      );
      x = curve.x * surfaceRadius;
      y = curve.y * surfaceRadius + 0.04;
      z =
        side * halfDepth * surfaceDepth +
        Math.sin(t * 3 + lane * 1.7) * 0.038 +
        randomSigned(random) * 0.012;
      normalX = planarNormal.x * 0.35;
      normalY = planarNormal.y * 0.35;
      normalZ = side;
      depth = t / (Math.PI * 2);
    } else {
      const radius = Math.cbrt(random()) * 0.13;
      const azimuth = randomRange(random, 0, Math.PI * 2);
      x = Math.cos(azimuth) * radius;
      y = 0.02 + randomSigned(random) * radius;
      z = Math.sin(azimuth) * radius;
      normalX = Math.cos(azimuth);
      normalY = randomSigned(random) * 0.35;
      normalZ = Math.sin(azimuth);
      depth = random();
    }

    const normalLength = Math.max(
      0.0001,
      Math.hypot(normalX, normalY, normalZ),
    );
    normalX /= normalLength;
    normalY /= normalLength;
    normalZ /= normalLength;

    const arm = index % 3;
    const spawnAngle =
      randomRange(random, 0, Math.PI * 2) +
      arm * ((Math.PI * 2) / 3);
    const spawnRadius = randomRange(random, 2.1, 5.4);
    const spiral = spawnAngle + spawnRadius * 1.35;
    const spawnX = Math.cos(spiral) * spawnRadius;
    const spawnY =
      Math.sin(spiral) * spawnRadius * 0.68 + randomSigned(random) * 0.7;
    const spawnZ = randomSigned(random) * randomRange(random, 1.2, 4.5);
    const delay = randomRange(random, 0, 0.8);

    writeVector(homeGroup, index, x, y, z, group);
    writeVector(settledPosition, index, x, y, z, 1);
    writeVector(normalDepth, index, normalX, normalY, normalZ, depth);
    writeVector(
      particleMeta,
      index,
      random(),
      Math.min(1, Math.hypot(x, y, z) / 1.25),
      randomRange(random, group === 2 ? 2.0 : 0.8, group === 2 ? 4.5 : 2.8),
      random(),
    );
    writeVector(spawnData, index, spawnX, spawnY, spawnZ, delay);
    writeVector(initialPosition, index, spawnX, spawnY, spawnZ, 0);
    writeVector(
      initialVelocity,
      index,
      -Math.sin(spiral) * randomRange(random, 0.05, 0.25),
      Math.cos(spiral) * randomRange(random, 0.05, 0.25),
      randomSigned(random) * 0.06,
      0,
    );
  }

  return {
    initialPosition,
    settledPosition,
    initialVelocity,
    homeGroup,
    normalDepth,
    particleMeta,
    spawnData,
  };
}

export function createFloatTexture(
  data: Float32Array,
  textureSize: number,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    data,
    textureSize,
    textureSize,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
