export const velocityShader = /* glsl */ `
  uniform sampler2D uHome;
  uniform sampler2D uNormal;
  uniform sampler2D uMeta;
  uniform sampler2D uSpawn;
  uniform float uTime;
  uniform float uDelta;
  uniform float uPhase;
  uniform float uPhaseTime;
  uniform float uPhaseProgress;
  uniform float uCharge;
  uniform float uBeatPhase;
  uniform float uPulse;
  uniform float uBurstStrength;
  uniform float uReducedMotion;
  uniform vec3 uPointer;
  uniform float uPointerStrength;

  float gaussian(float value, float mean, float sigma) {
    float normalized = (value - mean) / sigma;
    return exp(-0.5 * normalized * normalized);
  }

  float heartbeat(float phase) {
    float wrapped = fract(phase);
    float first = gaussian(wrapped, 0.11, 0.035);
    float second = 0.58 * gaussian(wrapped, 0.28, 0.048);
    float recoil = 0.18 * gaussian(wrapped, 0.19, 0.028);
    return clamp(first + second - recoil, 0.0, 1.15);
  }

  float hash11(float value) {
    return fract(sin(value * 127.1) * 43758.5453123);
  }

  vec3 safeNormalize(vec3 value) {
    float magnitude = length(value);
    return magnitude > 0.00001 ? value / magnitude : vec3(0.0, 1.0, 0.0);
  }

  vec3 coherentField(vec3 point, float time) {
    vec3 p = point * 2.35;
    return vec3(
      sin(p.y * 1.7 + time * 0.37) - cos(p.z * 2.1 - time * 0.29),
      sin(p.z * 1.9 - time * 0.31) - cos(p.x * 1.6 + time * 0.33),
      sin(p.x * 2.2 + time * 0.27) - cos(p.y * 1.8 - time * 0.25)
    );
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 positionLife = texture2D(texturePosition, uv);
    vec4 velocityEnergy = texture2D(textureVelocity, uv);
    vec4 homeGroup = texture2D(uHome, uv);
    vec4 normalDepth = texture2D(uNormal, uv);
    vec4 meta = texture2D(uMeta, uv);
    vec4 spawn = texture2D(uSpawn, uv);

    vec3 position = positionLife.xyz;
    vec3 velocity = velocityEnergy.xyz;
    vec3 home = homeGroup.xyz;
    float group = homeGroup.w;
    vec3 normal = safeNormalize(normalDepth.xyz);
    float seed = meta.x;
    float radialDelay = meta.y * 0.12;
    float groupDelay = group < 0.5 ? 0.06 : group < 1.5 ? 0.025 : group < 2.5 ? 0.0 : 0.1;
    float localBeat = heartbeat(uBeatPhase - radialDelay - groupDelay - (seed - 0.5) * 0.018);
    float breathing = 0.5 + 0.5 * sin(uTime * 0.98 + seed * 6.2831);
    float motionScale = mix(1.0, 0.28, uReducedMotion);
    float compression = 1.0 - uCharge * 0.065;
    vec3 target = home * compression;
    target += normal * (localBeat * 0.055 + breathing * 0.012 + uPulse * 0.045) * motionScale;

    vec3 acceleration = vec3(0.0);
    float spring = 24.0;
    float damping = 4.2;
    float curlWeight = 0.24;

    if (uPhase < 1.5) {
      float activation = smoothstep(spawn.w, spawn.w + 0.28, uPhaseProgress);
      spring = mix(0.12, 12.0, activation);
      damping = mix(0.55, 2.8, activation);
      curlWeight = mix(1.35, 0.42, activation);
      acceleration += cross(vec3(0.0, 0.0, 1.0), position) * (1.0 - activation) * 0.75;
    } else if (uPhase < 2.5) {
      spring = 29.0;
      damping = 4.5;
      curlWeight = 0.32;
    } else if (uPhase < 3.5) {
      spring = 27.0;
      damping = 4.7;
      curlWeight = 0.22;
    } else if (uPhase < 4.5) {
      spring = 34.0;
      damping = 5.1;
      curlWeight = 0.12;
      acceleration += safeNormalize(-position + vec3(0.0, 0.03, 0.0)) * uCharge * 2.6;
      acceleration += cross(vec3(0.0, 0.0, 1.0), position) * uCharge * 0.7;
    } else if (uPhase < 5.5) {
      spring = 7.0;
      damping = 2.0;
      curlWeight = 0.18;
      target *= 0.95;
    } else if (uPhase < 6.5) {
      spring = 0.3;
      damping = 0.72;
      curlWeight = 0.45;
      float impulse = 1.0 - smoothstep(0.0, 0.13, uPhaseTime);
      vec3 tangent = safeNormalize(cross(normal, vec3(0.15, 0.35, 1.0)));
      vec3 seededDirection = safeNormalize(vec3(
        hash11(seed * 31.7) - 0.5,
        hash11(seed * 73.1) - 0.35,
        hash11(seed * 97.3) - 0.5
      ));
      vec3 burstDirection = safeNormalize(
        normal * 0.68 +
        tangent * mix(0.12, 0.48, hash11(seed * 17.0)) +
        seededDirection * 0.18
      );
      float groupSpeed = group > 3.5 ? 1.65 : group > 2.5 ? 1.15 : group > 1.5 ? 1.35 : 1.0;
      acceleration += burstDirection * impulse * (19.0 + 13.0 * seed) * uBurstStrength * groupSpeed;
      acceleration += cross(vec3(0.0, 1.0, 0.0), position) * impulse * (2.0 + 3.5 * seed);
    } else if (uPhase < 7.5) {
      spring = 0.08;
      damping = 0.52;
      curlWeight = 0.9;
    } else if (uPhase < 8.5) {
      float capture = smoothstep(0.0, 1.0, uPhaseProgress);
      spring = mix(2.0, 19.0, capture);
      damping = mix(0.8, 2.6, capture);
      curlWeight = mix(0.72, 0.18, capture);
      vec3 error = target - position;
      acceleration += cross(vec3(0.0, 1.0, 0.25), error) * (5.2 * (1.0 - capture) + 1.1);
    } else if (uPhase < 9.5) {
      spring = 34.0;
      damping = 1.6;
      curlWeight = 0.1;
    } else {
      spring = 31.0;
      damping = 5.8;
      curlWeight = 0.18;
    }

    acceleration += (target - position) * spring;
    acceleration += coherentField(position + seed, uTime) * curlWeight * motionScale;

    if (group > 2.5 && group < 3.5) {
      vec3 flowDirection = safeNormalize(cross(normal, vec3(0.0, 0.0, 1.0)));
      acceleration += flowDirection * (0.55 + localBeat * 0.7) * motionScale;
    }

    vec3 pointerDelta = position - uPointer;
    float pointerDistance = length(pointerDelta);
    float pointerFalloff = exp(-(pointerDistance * pointerDistance) / 0.32) * uPointerStrength * motionScale;
    acceleration += safeNormalize(pointerDelta) * pointerFalloff * 1.8;
    acceleration += cross(vec3(0.0, 0.0, 1.0), pointerDelta) * pointerFalloff * 1.05;

    velocity += acceleration * uDelta;
    velocity *= exp(-damping * uDelta);
    float speed = length(velocity);
    float maxSpeed = uPhase > 5.5 && uPhase < 8.5 ? 5.8 : 2.8;
    if (speed > maxSpeed) {
      velocity *= maxSpeed / speed;
    }

    float energy = clamp(
      localBeat * 0.72 +
      uPulse * 0.8 +
      uCharge * 0.55 +
      (uPhase > 5.5 && uPhase < 7.5 ? 0.48 : 0.0),
      0.0,
      1.4
    );

    if (length(position) > 9.0 || speed > 20.0) {
      velocity = (home - position) * 0.2;
    }

    gl_FragColor = vec4(velocity, energy);
  }
`;

export const positionShader = /* glsl */ `
  uniform sampler2D uHome;
  uniform sampler2D uSpawn;
  uniform float uDelta;
  uniform float uPhase;
  uniform float uPhaseProgress;

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 positionLife = texture2D(texturePosition, uv);
    vec4 velocityEnergy = texture2D(textureVelocity, uv);
    vec4 homeGroup = texture2D(uHome, uv);
    vec4 spawn = texture2D(uSpawn, uv);
    vec3 position = positionLife.xyz + velocityEnergy.xyz * uDelta;
    float activation = positionLife.w;

    if (uPhase < 1.5) {
      activation = smoothstep(spawn.w, spawn.w + 0.22, uPhaseProgress);
    } else {
      activation = min(1.0, activation + uDelta * 2.5);
    }

    if (length(position) > 10.0) {
      position = mix(spawn.xyz, homeGroup.xyz, 0.2);
      activation = 0.2;
    }

    gl_FragColor = vec4(position, activation);
  }
`;

export const particleVertexShader = /* glsl */ `
  uniform sampler2D uPositionTexture;
  uniform sampler2D uHomeTexture;
  uniform sampler2D uNormalTexture;
  uniform sampler2D uMetaTexture;
  uniform float uPixelRatio;
  uniform float uTime;
  uniform float uGlobalAlpha;
  attribute vec2 aReference;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vEnergy;
  varying float vDiffuse;
  varying float vRim;
  varying float vDepthCue;
  varying float vFacing;
  varying float vSpecular;
  varying float vCleftShadow;

  vec3 palette(float value, float group, float energy) {
    vec3 deepRed = vec3(0.34, 0.0, 0.075);
    vec3 rose = vec3(0.96, 0.035, 0.30);
    vec3 magenta = vec3(0.96, 0.12, 0.52);
    vec3 gold = vec3(0.92, 0.58, 0.16);
    vec3 ivory = vec3(1.0, 0.58, 0.70);
    vec3 violet = vec3(0.463, 0.341, 1.0);
    vec3 color = mix(deepRed, rose, smoothstep(0.0, 0.5, value));
    color = mix(color, magenta, smoothstep(0.45, 0.85, value));
    if (group > 1.5 && group < 2.5) color = mix(gold, ivory, value * 0.28 + energy * 0.12);
    if (group > 2.5 && group < 3.5) color = mix(rose, gold, value);
    if (value > 0.965) color = mix(color, violet, 0.55);
    return mix(color, ivory, clamp(energy * 0.09, 0.0, 0.12));
  }

  void main() {
    vec4 positionLife = texture2D(uPositionTexture, aReference);
    vec4 homeGroup = texture2D(uHomeTexture, aReference);
    vec4 normalDepth = texture2D(uNormalTexture, aReference);
    vec4 meta = texture2D(uMetaTexture, aReference);
    vec3 transformed = positionLife.xyz;
    vec4 modelViewPosition = modelViewMatrix * vec4(transformed, 1.0);
    float energy = clamp(length(transformed - homeGroup.xyz) * 0.08 + sin(uTime * (0.7 + meta.x * 1.8) + meta.x * 31.0) * 0.08 + 0.18, 0.0, 1.0);
    float groupScale = homeGroup.w > 1.5 && homeGroup.w < 2.5 ? 1.42 : homeGroup.w > 3.5 ? 1.25 : 1.0;
    float centerViewZ = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
    float geometricDepth = smoothstep(-0.72, 0.72, modelViewPosition.z - centerViewZ);
    float displacement = smoothstep(0.35, 1.8, length(transformed - homeGroup.xyz));
    vDepthCue = mix(geometricDepth, 0.62, displacement * 0.55);
    float perspective = 17.5 / max(1.0, -modelViewPosition.z);
    float depthSize = mix(0.84, 1.08, vDepthCue);
    gl_PointSize = clamp(meta.z * groupScale * depthSize * perspective * uPixelRatio, 1.0, 7.2 * uPixelRatio);
    gl_Position = projectionMatrix * modelViewPosition;
    vColor = palette(meta.w, homeGroup.w, energy);
    float groupAlpha = homeGroup.w < 0.5
      ? 0.34
      : homeGroup.w < 1.5
        ? 0.18
        : homeGroup.w < 2.5
          ? 0.28
          : homeGroup.w < 3.5
            ? 0.48
            : 0.55;
    vAlpha = positionLife.w * uGlobalAlpha * groupAlpha * (0.62 + meta.x * 0.38);
    vEnergy = energy;
    vec3 viewNormal = normalize(normalMatrix * normalDepth.xyz);
    vec3 viewDirection = normalize(-modelViewPosition.xyz);
    vec3 viewLight = normalize(vec3(-0.42, 0.56, 0.72));
    vDiffuse = max(dot(viewNormal, viewLight), 0.0);
    float normalFacing = dot(viewNormal, viewDirection);
    vFacing = smoothstep(-0.28, 0.78, normalFacing);
    vRim = pow(1.0 - abs(normalFacing), 2.05) * mix(0.56, 1.0, vDepthCue);
    vec3 halfDirection = normalize(viewLight + viewDirection);
    vSpecular = pow(max(dot(viewNormal, halfDirection), 0.0), 16.0) * smoothstep(-0.04, 0.36, normalFacing);
    float cleftX = exp(-24.0 * homeGroup.x * homeGroup.x);
    float cleftY = exp(-20.0 * (homeGroup.y - 0.37) * (homeGroup.y - 0.37));
    vCleftShadow = cleftX * cleftY * smoothstep(0.4, 1.0, vFacing);
  }
`;

export const particleFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vEnergy;
  varying float vDiffuse;
  varying float vRim;
  varying float vDepthCue;
  varying float vFacing;
  varying float vSpecular;
  varying float vCleftShadow;
  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float distanceToCenter = length(centered);
    float soft = 1.0 - smoothstep(0.08, 0.5, distanceToCenter);
    float core = 1.0 - smoothstep(0.0, 0.17, distanceToCenter);
    float alpha = soft * vAlpha * mix(0.24, 0.82, vDepthCue);
    if (alpha < 0.01) discard;
    float lighting = 0.42 + vDiffuse * 0.25 + vDepthCue * 0.14 + vFacing * 0.08;
    vec3 depthTint = mix(vec3(0.46, 0.25, 0.61), vec3(1.0, 0.62, 0.78), vDepthCue);
    vec3 color = vColor * lighting * (0.75 + core * 0.24 + vEnergy * 0.08);
    color *= depthTint;
    color *= 1.0 - vCleftShadow * 0.14;
    color += vColor * vSpecular * 0.1;
    color += vec3(0.38, 0.01, 0.15) * vRim * 0.075;
    gl_FragColor = vec4(color, alpha);
  }
`;

export const orbitVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uBeat;
  uniform float uPixelRatio;
  attribute float aAngle;
  attribute float aRadius;
  attribute float aSpeed;
  attribute float aInclination;
  attribute float aSeed;
  varying float vSeed;
  void main() {
    float angle = aAngle + uTime * aSpeed;
    vec3 point = vec3(
      cos(angle) * aRadius,
      sin(angle) * aRadius * 0.55,
      sin(angle * 0.7 + aSeed * 6.2831) * 0.16
    );
    float c = cos(aInclination);
    float s = sin(aInclination);
    point.yz = mat2(c, -s, s, c) * point.yz;
    point *= 1.0 + uBeat * 0.04;
    vec4 mv = modelViewMatrix * vec4(point, 1.0);
    gl_PointSize = clamp((1.2 + aSeed * 2.2) * 18.0 / -mv.z * uPixelRatio, 1.0, 6.0 * uPixelRatio);
    gl_Position = projectionMatrix * mv;
    vSeed = aSeed;
  }
`;

export const orbitFragmentShader = /* glsl */ `
  varying float vSeed;
  void main() {
    float radius = length(gl_PointCoord - 0.5);
    float alpha = 1.0 - smoothstep(0.04, 0.5, radius);
    vec3 rose = vec3(1.0, 0.09, 0.42);
    vec3 gold = vec3(1.0, 0.827, 0.416);
    vec3 color = mix(rose, gold, step(0.55, vSeed));
    gl_FragColor = vec4(color * 1.4, alpha * (0.24 + vSeed * 0.58));
  }
`;
