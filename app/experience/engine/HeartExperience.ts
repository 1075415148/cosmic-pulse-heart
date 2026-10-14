import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import {
  GPUComputationRenderer,
  type Variable,
} from "three/addons/misc/GPUComputationRenderer.js";
import {
  AdaptiveQualityController,
  DEFAULT_SETTINGS,
  ExperienceStateMachine,
  QUALITY_PROFILES,
  beatPhaseAt,
  createSeededRandom,
  heartbeatEnvelope,
  type ExperienceSettings,
  type ExperienceSnapshot,
  type QualityTier,
} from "../core";
import {
  createFloatTexture,
  createHeartTextureData,
} from "./heartSampling";
import {
  detectGraphicsCapabilities,
  type SimulationPrecision,
} from "./capabilities";
import {
  CONTEXT_RESTORE_TIMEOUT_MS,
  MAX_CONTEXT_RECOVERY_FAILURES,
  ContextRecoveryPolicy,
} from "./contextRecovery";
import {
  orbitFragmentShader,
  orbitVertexShader,
  particleFragmentShader,
  particleVertexShader,
  positionShader,
  velocityShader,
} from "./shaders";

const PHASE_CODE: Record<ExperienceSnapshot["phase"], number> = {
  PREWARM: 0,
  ASSEMBLE: 1,
  AWAKEN: 2,
  IDLE_BEAT: 3,
  CHARGE: 4,
  FRACTURE: 5,
  BURST: 6,
  SUSPEND: 7,
  VORTEX_RETURN: 8,
  OVERSHOOT: 9,
  SETTLE: 10,
};

export interface HeartExperienceCallbacks {
  onSnapshot?: (snapshot: ExperienceSnapshot) => void;
  onReady?: () => void;
  onFallback?: (reason: string) => void;
}

export interface HeartExperienceOptions {
  settings?: Partial<ExperienceSettings>;
  seed?: string | number;
  callbacks?: HeartExperienceCallbacks;
}

interface HeartGpuResources {
  compute: GPUComputationRenderer;
  positionVariable: Variable;
  velocityVariable: Variable;
  initialPosition: THREE.DataTexture;
  settledPosition: THREE.DataTexture;
  initialVelocity: THREE.DataTexture;
  home: THREE.DataTexture;
  normal: THREE.DataTexture;
  meta: THREE.DataTexture;
  spawn: THREE.DataTexture;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  points: THREE.Points;
}

interface NavigatorHints extends Navigator {
  deviceMemory?: number;
}

export class HeartExperience {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: WebGL2RenderingContext;
  private readonly callbacks: HeartExperienceCallbacks;
  private readonly seed: string | number;
  private settings: ExperienceSettings;
  private tier: QualityTier;
  private simulationPrecision: SimulationPrecision;
  private halfFloatRenderable: boolean;
  private maxTextureSize: number;
  private readonly qualityController: AdaptiveQualityController;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(46, 1, 0.1, 60);
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private heartGroup = new THREE.Group();
  private gpu: HeartGpuResources | null = null;
  private orbitPoints: THREE.Points | null = null;
  private orbitMaterial: THREE.ShaderMaterial | null = null;
  private backgroundPoints: THREE.Points | null = null;
  private coreSprites: THREE.Sprite[] = [];
  private rings: THREE.Mesh[] = [];
  private stateMachine: ExperienceStateMachine;
  private raf = 0;
  private running = false;
  private paused = false;
  private pageVisible = true;
  private contextLost = false;
  private disposed = false;
  private elapsed = 0;
  private accumulator = 0;
  private lastFrameAt = 0;
  private pulseImpulse = 0;
  private lastPulseAt = -Infinity;
  private pointerTarget = new THREE.Vector3();
  private pointerCurrent = new THREE.Vector3();
  private pointerStrengthTarget = 0;
  private pointerStrength = 0;
  private targetRotation = new THREE.Vector2();
  private currentRotation = new THREE.Vector2();
  private fps = 60;
  private frameTimes: number[] = [];
  private performanceWindowAt = 0;
  private lastSnapshotAt = 0;
  private firstReadySent = false;
  private fallbackReason: string | null = null;
  private pendingTier: QualityTier | null = null;
  private readonly contextRecoveryPolicy = new ContextRecoveryPolicy();
  private contextRestoreTimeout: ReturnType<typeof setTimeout> | null = null;
  private debugRestoreTimeout: ReturnType<typeof setTimeout> | null = null;

  private readonly onVisibilityChange = () => {
    this.pageVisible = document.visibilityState === "visible";
    this.lastFrameAt = performance.now();
    this.accumulator = 0;
    if (this.pageVisible) {
      this.scheduleAnimationFrame();
    } else {
      this.cancelAnimationFrame();
    }
  };

  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    if (this.disposed || this.contextLost) {
      return;
    }

    this.contextLost = true;
    this.cancelAnimationFrame();
    this.accumulator = 0;

    const now = performance.now();
    const decision = this.contextRecoveryPolicy.beginLoss(now);
    if (decision.forcePerformance) {
      this.tier = "performance";
      this.pendingTier = null;
      this.qualityController.reset(this.tier);
    }

    this.clearContextRestoreTimeout();
    if (this.contextRecoveryPolicy.isLocked) {
      this.setFallback("图形恢复连续失败，已切换到静态粒子爱心。可点击重新尝试。");
      return;
    }

    this.setFallback("图形上下文暂时中断，正在恢复。");
    this.contextRestoreTimeout = setTimeout(() => {
      if (!this.disposed && this.contextLost) {
        this.recordContextRecoveryFailure("图形恢复超时");
      }
    }, CONTEXT_RESTORE_TIMEOUT_MS);
  };

  private readonly onContextRestored = () => {
    if (this.disposed) {
      return;
    }

    this.clearContextRestoreTimeout();
    this.contextLost = false;
    if (this.contextRecoveryPolicy.isLocked) {
      this.setFallback("图形恢复连续失败，已切换到静态粒子爱心。可点击重新尝试。");
      return;
    }

    try {
      const capabilities = detectGraphicsCapabilities(this.context);
      if (!capabilities.simulationPrecision) {
        throw new Error(
          capabilities.fallbackReason ?? "GPU 粒子能力恢复失败。",
        );
      }
      this.simulationPrecision = capabilities.simulationPrecision;
      this.halfFloatRenderable = capabilities.halfFloatRenderable;
      this.maxTextureSize = capabilities.maxTextureSize;
      const requestedTier =
        this.contextRecoveryPolicy.recentLossCount >= 2
          ? "performance"
          : (this.pendingTier ?? this.tier);
      this.pendingTier = null;
      this.tier = this.constrainTierForCapabilities(requestedTier);
      this.qualityController.reset(this.tier);

      this.renderer.resetState();
      this.rebuildPostProcessing();
      this.rebuildVisualResources();
      this.frameTimes = [];
      this.accumulator = 0;
      this.lastFrameAt = performance.now();
      this.performanceWindowAt = this.lastFrameAt;
      this.stateMachine.forceIdle();
      this.renderRecoveryFrame();
      this.contextRecoveryPolicy.recordSuccess();
      this.fallbackReason = null;
      this.emitSnapshot(true);
      this.scheduleAnimationFrame();
    } catch (error) {
      this.disposeHeartSystem();
      this.disposeSceneResources();
      this.recordContextRecoveryFailure(
        error instanceof Error ? error.message : "图形资源恢复失败",
      );
    }
  };

  constructor(canvas: HTMLCanvasElement, options: HeartExperienceOptions = {}) {
    this.canvas = canvas;
    this.callbacks = options.callbacks ?? {};
    this.seed = options.seed ?? "cosmic-pulse-heart-v1";
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...options.settings,
    };
    this.settings.bloom = THREE.MathUtils.clamp(this.settings.bloom, 0.1, 1.2);

    const context = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: true,
      powerPreference: "high-performance",
      premultipliedAlpha: true,
    });

    if (!context) {
      throw new Error("当前设备不支持 WebGL2，已使用静态粒子爱心。");
    }

    this.context = context;
    const capabilities = detectGraphicsCapabilities(context);
    if (!capabilities.simulationPrecision) {
      throw new Error(
        capabilities.fallbackReason ?? "当前 GPU 无法运行粒子模拟。",
      );
    }
    this.simulationPrecision = capabilities.simulationPrecision;
    this.halfFloatRenderable = capabilities.halfFloatRenderable;
    this.maxTextureSize = capabilities.maxTextureSize;
    this.tier = this.constrainTierForCapabilities(this.resolveInitialTier());
    this.qualityController = new AdaptiveQualityController(this.tier);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.72;
    this.renderer.setClearColor(0x000000, 0);

    this.camera.position.set(0, 0.02, 4.05);
    this.mountHeartGroup();
    const postProcessing = this.createPostProcessing();
    this.composer = postProcessing.composer;
    this.bloomPass = postProcessing.bloomPass;

    this.stateMachine = new ExperienceStateMachine({
      reducedMotion: this.settings.reducedMotion,
      onPhaseChange: (phase) => {
        if (phase === "IDLE_BEAT" && !this.firstReadySent) {
          this.firstReadySent = true;
          this.callbacks.onReady?.();
        }
        if (phase === "IDLE_BEAT" && this.pendingTier) {
          const pending = this.pendingTier;
          this.pendingTier = null;
          this.applyTier(pending);
        }
        this.emitSnapshot(true);
      },
    });

    try {
      this.rebuildHeartSystem(this.tier);
      this.createCore();
      this.createRings();
      this.createOrbitParticles();
      this.createBackground();
      this.resize();
      this.stateMachine.markReady();
      if (this.settings.reducedMotion && !this.firstReadySent) {
        this.firstReadySent = true;
        this.callbacks.onReady?.();
      }
    } catch (error) {
      this.disposeSceneResources();
      throw error;
    }

    document.addEventListener("visibilitychange", this.onVisibilityChange);
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
  }

  start(): void {
    if (this.running || this.disposed) {
      return;
    }
    this.running = true;
    this.lastFrameAt = performance.now();
    this.performanceWindowAt = this.lastFrameAt;
    this.scheduleAnimationFrame();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.lastFrameAt = performance.now();
    this.accumulator = 0;
    if (paused) {
      this.cancelAnimationFrame();
    } else {
      this.scheduleAnimationFrame();
    }
    this.emitSnapshot(true);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  retryGraphics(): void {
    if (this.disposed) {
      return;
    }

    this.contextRecoveryPolicy.beginManualRetry();
    this.clearContextRestoreTimeout();
    this.setFallback("正在重新创建图形资源。");

    if (this.context.isContextLost()) {
      this.contextLost = true;
      this.context.getExtension("WEBGL_lose_context")?.restoreContext();
      this.contextRestoreTimeout = setTimeout(() => {
        if (!this.disposed && this.contextLost) {
          this.recordContextRecoveryFailure("图形恢复超时");
        }
      }, CONTEXT_RESTORE_TIMEOUT_MS);
      return;
    }

    this.onContextRestored();
  }

  debugCycleContext(restoreAfterMs = 1_500): boolean {
    if (this.disposed) {
      return false;
    }
    const extension = this.context.getExtension("WEBGL_lose_context");
    if (!extension) {
      return false;
    }

    if (this.debugRestoreTimeout !== null) {
      clearTimeout(this.debugRestoreTimeout);
    }
    extension.loseContext();
    this.debugRestoreTimeout = setTimeout(() => {
      this.debugRestoreTimeout = null;
      if (!this.disposed && this.context.isContextLost()) {
        extension.restoreContext();
      }
    }, Math.max(250, restoreAfterMs));
    return true;
  }

  setPointer(normalizedX: number, normalizedY: number, active = true): void {
    this.pointerTarget.set(
      THREE.MathUtils.clamp(normalizedX, -1, 1) * 1.18,
      THREE.MathUtils.clamp(normalizedY, -1, 1) * 0.88 + 0.04,
      0,
    );
    this.targetRotation.set(
      THREE.MathUtils.degToRad(normalizedY * 6.5),
      THREE.MathUtils.degToRad(-normalizedX * 10),
    );
    this.pointerStrengthTarget = active ? 1 : 0;
  }

  clearPointer(): void {
    this.pointerStrengthTarget = 0;
    this.targetRotation.set(0, 0);
  }

  triggerPulse(): void {
    const now = performance.now();
    if (now - this.lastPulseAt < 650) {
      this.pulseImpulse = Math.max(this.pulseImpulse, 0.24);
      return;
    }
    if (this.stateMachine.requestPulse()) {
      this.lastPulseAt = now;
      this.pulseImpulse = 1;
    }
  }

  startCharge(): boolean {
    return this.stateMachine.startCharge();
  }

  releaseCharge(cancelled = false): boolean {
    if (this.settings.reducedMotion) {
      this.triggerPulse();
      return this.stateMachine.releaseCharge(true);
    }
    return this.stateMachine.releaseCharge(cancelled);
  }

  replay(): void {
    if (this.contextLost || !this.gpu) {
      return;
    }
    const resources = this.gpu;
    resources.compute.renderTexture(
      resources.initialPosition,
      resources.compute.getCurrentRenderTarget(resources.positionVariable),
    );
    resources.compute.renderTexture(
      resources.initialPosition,
      resources.compute.getAlternateRenderTarget(resources.positionVariable),
    );
    resources.compute.renderTexture(
      resources.initialVelocity,
      resources.compute.getCurrentRenderTarget(resources.velocityVariable),
    );
    resources.compute.renderTexture(
      resources.initialVelocity,
      resources.compute.getAlternateRenderTarget(resources.velocityVariable),
    );
    this.pulseImpulse = 0;
    this.stateMachine.replay();
  }

  private seedHeartAtRest(): void {
    if (!this.gpu) {
      throw new Error("粒子资源尚未准备完成。");
    }
    const resources = this.gpu;
    resources.compute.renderTexture(
      resources.settledPosition,
      resources.compute.getCurrentRenderTarget(resources.positionVariable),
    );
    resources.compute.renderTexture(
      resources.settledPosition,
      resources.compute.getAlternateRenderTarget(resources.positionVariable),
    );
    resources.compute.renderTexture(
      resources.initialVelocity,
      resources.compute.getCurrentRenderTarget(resources.velocityVariable),
    );
    resources.compute.renderTexture(
      resources.initialVelocity,
      resources.compute.getAlternateRenderTarget(resources.velocityVariable),
    );
  }

  setSettings(changes: Partial<ExperienceSettings>): void {
    const previousMode = this.settings.qualityMode;
    this.settings = { ...this.settings, ...changes };
    this.settings.bloom = THREE.MathUtils.clamp(this.settings.bloom, 0.1, 1.2);
    this.settings.bpm = THREE.MathUtils.clamp(this.settings.bpm, 48, 96);
    this.bloomPass.strength = this.settings.bloom * 0.56;
    this.stateMachine.setReducedMotion(this.settings.reducedMotion);

    if (
      changes.qualityMode &&
      changes.qualityMode !== previousMode
    ) {
      const requested =
        changes.qualityMode === "auto"
          ? this.resolveInitialTier()
          : changes.qualityMode;
      this.requestTier(requested);
    }

    if (this.settings.reducedMotion && this.tier !== "performance") {
      this.requestTier("performance");
    }
    this.emitSnapshot(true);
  }

  resize(): void {
    if (this.disposed || this.contextLost) {
      return;
    }
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth);
    const height = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight);
    const profile = QUALITY_PROFILES[this.tier];
    const textureSafeRatio = Math.min(
      this.maxTextureSize / width,
      this.maxTextureSize / height,
    );
    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      profile.dpr,
      textureSafeRatio,
    );
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.position.z = width / height < 0.78 ? 4.95 : 4.05;
    this.camera.updateProjectionMatrix();

    if (this.gpu) {
      this.gpu.material.uniforms.uPixelRatio.value = pixelRatio;
    }
    if (this.orbitMaterial) {
      this.orbitMaterial.uniforms.uPixelRatio.value = pixelRatio;
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.running = false;
    this.cancelAnimationFrame();
    this.clearContextRestoreTimeout();
    if (this.debugRestoreTimeout !== null) {
      clearTimeout(this.debugRestoreTimeout);
      this.debugRestoreTimeout = null;
    }
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.disposeHeartSystem();
    this.disposeSceneResources();
    this.composer.dispose();
    this.renderer.dispose();
  }

  private readonly frame = (now: number) => {
    this.raf = 0;
    if (
      !this.running ||
      this.disposed ||
      this.paused ||
      !this.pageVisible ||
      this.contextLost ||
      !this.gpu
    ) {
      return;
    }

    const rawDelta = Math.max(0, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;

    const delta = Math.min(0.05, rawDelta);
    this.elapsed += delta;
    this.stateMachine.update(delta);
    this.pulseImpulse *= Math.exp(-delta * 5.8);
    const pointerSmoothing = 1 - Math.exp(-delta * 8);
    const rotationSmoothing = 1 - Math.exp(-delta * 5.5);
    this.pointerCurrent.lerp(this.pointerTarget, pointerSmoothing);
    this.pointerStrength = THREE.MathUtils.lerp(
      this.pointerStrength,
      this.pointerStrengthTarget,
      pointerSmoothing,
    );
    this.currentRotation.lerp(this.targetRotation, rotationSmoothing);

    this.accumulator += delta;
    let subSteps = 0;
    while (this.accumulator >= 1 / 60 && subSteps < 3) {
      this.updateComputeUniforms(1 / 60);
      this.gpu.compute.compute();
      this.accumulator -= 1 / 60;
      subSteps += 1;
    }
    if (subSteps === 3) {
      this.accumulator = 0;
    }

    this.gpu.material.uniforms.uPositionTexture.value =
      this.gpu.compute.getCurrentRenderTarget(
        this.gpu.positionVariable,
      ).texture;
    this.gpu.material.uniforms.uTime.value = this.elapsed;
    this.gpu.material.uniforms.uGlobalAlpha.value =
      this.stateMachine.current === "PREWARM" ? 0 : 1;

    this.updateScene(delta);
    this.composer.render();
    this.samplePerformance(rawDelta, now);
    this.emitSnapshot(false);
    this.scheduleAnimationFrame();
  };

  private renderRecoveryFrame(): void {
    if (!this.gpu || this.context.isContextLost()) {
      throw new Error("GPU 上下文尚未恢复。");
    }

    this.updateComputeUniforms(1 / 60);
    this.gpu.compute.compute();
    this.gpu.material.uniforms.uPositionTexture.value =
      this.gpu.compute.getCurrentRenderTarget(
        this.gpu.positionVariable,
      ).texture;
    this.gpu.material.uniforms.uTime.value = this.elapsed;
    this.gpu.material.uniforms.uGlobalAlpha.value = 1;
    this.updateScene(0);
    this.composer.render();

    const error = this.context.getError();
    if (error !== this.context.NO_ERROR || this.context.isContextLost()) {
      throw new Error(`恢复首帧提交失败（0x${error.toString(16)}）。`);
    }
  }

  private updateComputeUniforms(delta: number): void {
    if (!this.gpu) {
      return;
    }
    const phase = PHASE_CODE[this.stateMachine.current];
    const beatPhase = beatPhaseAt(
      this.elapsed,
      this.settings.bpm,
    );
    const commonValues = {
      uTime: this.elapsed,
      uDelta: delta,
      uPhase: phase,
      uPhaseTime: this.stateMachine.phaseElapsed,
      uPhaseProgress: this.stateMachine.phaseProgress,
      uCharge: this.stateMachine.chargeAmount,
      uBeatPhase: beatPhase,
      uPulse: this.pulseImpulse,
      uBurstStrength: Math.max(0.45, this.stateMachine.chargeAmount),
      uReducedMotion: this.settings.reducedMotion ? 1 : 0,
      uPointer: this.pointerCurrent,
      uPointerStrength: this.pointerStrength,
    };

    const velocityUniforms = this.gpu.velocityVariable.material.uniforms;
    for (const [name, value] of Object.entries(commonValues)) {
      velocityUniforms[name].value = value;
    }

    const positionUniforms = this.gpu.positionVariable.material.uniforms;
    positionUniforms.uDelta.value = delta;
    positionUniforms.uPhase.value = phase;
    positionUniforms.uPhaseProgress.value = this.stateMachine.phaseProgress;
  }

  private updateScene(delta: number): void {
    const beat = heartbeatEnvelope(
      beatPhaseAt(this.elapsed, this.settings.bpm),
    ).normalized;
    const autoYaw =
      this.settings.autoCamera && !this.settings.reducedMotion
        ? Math.sin(this.elapsed / 5.6) * THREE.MathUtils.degToRad(4.8)
        : 0;
    const autoPitch =
      this.settings.autoCamera && !this.settings.reducedMotion
        ? Math.sin(this.elapsed / 7.8) * THREE.MathUtils.degToRad(2.4)
        : 0;
    this.heartGroup.rotation.x = this.currentRotation.x + autoPitch;
    this.heartGroup.rotation.y = THREE.MathUtils.clamp(
      THREE.MathUtils.degToRad(-6.5) + this.currentRotation.y + autoYaw,
      THREE.MathUtils.degToRad(-18),
      THREE.MathUtils.degToRad(18),
    );
    this.heartGroup.rotation.z = Math.sin(this.elapsed / 9) * 0.008;

    const coreEnergy =
      0.72 +
      beat * 0.28 +
      this.pulseImpulse * 0.32 +
      this.stateMachine.chargeAmount * 0.2;
    for (let index = 0; index < this.coreSprites.length; index += 1) {
      const sprite = this.coreSprites[index];
      const scale =
        (0.18 + index * 0.09) *
        coreEnergy *
        (1 + Math.sin(this.elapsed * 0.7 + index) * 0.025);
      sprite.scale.setScalar(scale);
      const material = sprite.material as THREE.SpriteMaterial;
      material.opacity = (0.1 - index * 0.03) * coreEnergy;
    }

    for (let index = 0; index < this.rings.length; index += 1) {
      const ring = this.rings[index];
      const direction = index === 1 ? -1 : 1;
      ring.rotation.z += delta * (0.055 + index * 0.018) * direction;
      ring.rotation.y += delta * 0.025 * direction;
      const burstExpansion =
        this.stateMachine.current === "BURST" ||
        this.stateMachine.current === "SUSPEND"
          ? this.stateMachine.phaseProgress * 0.16
          : 0;
      ring.scale.setScalar(1 + beat * (0.025 + index * 0.008) + burstExpansion);
      const material = ring.material as THREE.MeshBasicMaterial;
      material.opacity =
        0.08 +
        beat * 0.08 +
        this.pulseImpulse * 0.08 -
        burstExpansion * 0.3;
    }

    if (this.orbitMaterial) {
      this.orbitMaterial.uniforms.uTime.value = this.elapsed;
      this.orbitMaterial.uniforms.uBeat.value =
        beat + this.pulseImpulse * 0.6;
    }
    if (this.backgroundPoints) {
      this.backgroundPoints.rotation.y += delta * 0.003;
      this.backgroundPoints.rotation.x =
        Math.sin(this.elapsed * 0.025) * 0.03;
    }
    this.bloomPass.strength =
      this.settings.bloom *
      0.56 *
      (1 + beat * 0.045 + this.pulseImpulse * 0.075);
  }

  private createHeartSystem(tier: QualityTier): void {
    const profile = QUALITY_PROFILES[tier];
    const textureSize = profile.textureSize;
    const data = createHeartTextureData(textureSize, this.seed);
    const initialPosition = createFloatTexture(
      data.initialPosition,
      textureSize,
    );
    const settledPosition = createFloatTexture(
      data.settledPosition,
      textureSize,
    );
    const initialVelocity = createFloatTexture(
      data.initialVelocity,
      textureSize,
    );
    const home = createFloatTexture(data.homeGroup, textureSize);
    const normal = createFloatTexture(data.normalDepth, textureSize);
    const meta = createFloatTexture(data.particleMeta, textureSize);
    const spawn = createFloatTexture(data.spawnData, textureSize);

    const compute = new GPUComputationRenderer(
      textureSize,
      textureSize,
      this.renderer,
    );
    if (this.simulationPrecision === "half-float") {
      compute.setDataType(THREE.HalfFloatType);
    }
    const positionVariable = compute.addVariable(
      "texturePosition",
      positionShader,
      initialPosition,
    );
    const velocityVariable = compute.addVariable(
      "textureVelocity",
      velocityShader,
      initialVelocity,
    );
    compute.setVariableDependencies(positionVariable, [
      positionVariable,
      velocityVariable,
    ]);
    compute.setVariableDependencies(velocityVariable, [
      positionVariable,
      velocityVariable,
    ]);

    Object.assign(positionVariable.material.uniforms, {
      uHome: { value: home },
      uSpawn: { value: spawn },
      uDelta: { value: 1 / 60 },
      uPhase: { value: 1 },
      uPhaseProgress: { value: 0 },
    });
    Object.assign(velocityVariable.material.uniforms, {
      uHome: { value: home },
      uNormal: { value: normal },
      uMeta: { value: meta },
      uSpawn: { value: spawn },
      uTime: { value: 0 },
      uDelta: { value: 1 / 60 },
      uPhase: { value: 1 },
      uPhaseTime: { value: 0 },
      uPhaseProgress: { value: 0 },
      uCharge: { value: 0 },
      uBeatPhase: { value: 0 },
      uPulse: { value: 0 },
      uBurstStrength: { value: 1 },
      uReducedMotion: { value: this.settings.reducedMotion ? 1 : 0 },
      uPointer: { value: this.pointerCurrent },
      uPointerStrength: { value: 0 },
    });

    let computeError = compute.init();
    if (!computeError) {
      try {
        this.validateComputeTargets(compute, [
          positionVariable,
          velocityVariable,
        ]);
      } catch (error) {
        computeError =
          error instanceof Error ? error.message : "粒子缓冲区验证失败";
      }
    }
    if (computeError) {
      compute.dispose();
      initialPosition.dispose();
      settledPosition.dispose();
      initialVelocity.dispose();
      home.dispose();
      normal.dispose();
      meta.dispose();
      spawn.dispose();
      throw new Error("GPU 粒子模拟初始化失败：" + computeError);
    }

    const count = textureSize * textureSize;
    const references = new Float32Array(count * 2);
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      references[index * 2] = (index % textureSize + 0.5) / textureSize;
      references[index * 2 + 1] =
        (Math.floor(index / textureSize) + 0.5) / textureSize;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute(
      "aReference",
      new THREE.BufferAttribute(references, 2),
    );
    geometry.setDrawRange(0, count);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uPositionTexture: {
          value: compute.getCurrentRenderTarget(positionVariable).texture,
        },
        uHomeTexture: { value: home },
        uNormalTexture: { value: normal },
        uMetaTexture: { value: meta },
        uPixelRatio: {
          value: Math.min(
            window.devicePixelRatio || 1,
            QUALITY_PROFILES[tier].dpr,
          ),
        },
        uTime: { value: 0 },
        uGlobalAlpha: { value: 1 },
      },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: true,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 5;
    this.heartGroup.add(points);

    this.gpu = {
      compute,
      positionVariable,
      velocityVariable,
      initialPosition,
      settledPosition,
      initialVelocity,
      home,
      normal,
      meta,
      spawn,
      geometry,
      material,
      points,
    };
  }

  private validateComputeTargets(
    compute: GPUComputationRenderer,
    variables: Variable[],
  ): void {
    const previousTarget = this.renderer.getRenderTarget();
    try {
      for (const variable of variables) {
        const targets = [
          compute.getCurrentRenderTarget(variable),
          compute.getAlternateRenderTarget(variable),
        ];
        for (const target of targets) {
          this.renderer.setRenderTarget(target);
          const status = this.context.checkFramebufferStatus(
            this.context.DRAW_FRAMEBUFFER,
          );
          const error = this.context.getError();
          if (
            status !== this.context.FRAMEBUFFER_COMPLETE ||
            error !== this.context.NO_ERROR
          ) {
            throw new Error(
              `Framebuffer 不完整（status: 0x${status.toString(16)}, error: 0x${error.toString(16)}）`,
            );
          }
        }
      }
    } finally {
      this.renderer.setRenderTarget(previousTarget);
    }
  }

  private createCore(): void {
    const texture = this.createGlowTexture();
    const colors = [0xff527f, 0xff6b36, 0xe20a63];
    const depths = [0.08, 0, -0.1];
    for (let index = 0; index < 3; index += 1) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: colors[index],
        transparent: true,
        opacity: 0.1 - index * 0.03,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: true,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(0, 0.03, depths[index]);
      sprite.scale.setScalar(0.18 + index * 0.09);
      sprite.renderOrder = 4 - index;
      this.heartGroup.add(sprite);
      this.coreSprites.push(sprite);
    }
  }

  private createGlowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("无法创建程序化星核纹理。");
    }
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,84,132,.78)");
    gradient.addColorStop(0.12, "rgba(255,44,109,.65)");
    gradient.addColorStop(0.32, "rgba(255,137,57,.24)");
    gradient.addColorStop(0.62, "rgba(226,10,99,.08)");
    gradient.addColorStop(1, "rgba(255,23,107,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  private createRings(): void {
    const random = createSeededRandom(String(this.seed) + "-rings");
    const configurations = [
      { radius: 1.26, tiltX: 1.1, tiltY: 0.18, color: 0xffd36a },
      { radius: 1.46, tiltX: 0.52, tiltY: 0.92, color: 0xff176b },
      { radius: 1.68, tiltX: 1.32, tiltY: -0.48, color: 0x7657ff },
    ];
    for (const configuration of configurations) {
      const geometry = new THREE.TorusGeometry(
        configuration.radius,
        0.0045,
        6,
        220,
      );
      const material = new THREE.MeshBasicMaterial({
        color: configuration.color,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.set(
        configuration.tiltX,
        configuration.tiltY,
        random() * Math.PI,
      );
      ring.renderOrder = 2;
      this.heartGroup.add(ring);
      this.rings.push(ring);
    }
  }

  private createOrbitParticles(): void {
    const maxCount = QUALITY_PROFILES.ultra.orbitParticles;
    const random = createSeededRandom(String(this.seed) + "-orbits");
    const positions = new Float32Array(maxCount * 3);
    const angles = new Float32Array(maxCount);
    const radii = new Float32Array(maxCount);
    const speeds = new Float32Array(maxCount);
    const inclinations = new Float32Array(maxCount);
    const seeds = new Float32Array(maxCount);

    for (let index = 0; index < maxCount; index += 1) {
      const orbit = index % 5;
      angles[index] = random() * Math.PI * 2;
      radii[index] = 1.22 + orbit * 0.13 + random() * 0.08;
      speeds[index] =
        (0.08 + orbit * 0.018 + random() * 0.035) *
        (orbit === 3 ? -1 : 1);
      inclinations[index] =
        THREE.MathUtils.degToRad(15 + orbit * 12 + random() * 8);
      seeds[index] = random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aAngle", new THREE.BufferAttribute(angles, 1));
    geometry.setAttribute("aRadius", new THREE.BufferAttribute(radii, 1));
    geometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute(
      "aInclination",
      new THREE.BufferAttribute(inclinations, 1),
    );
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geometry.setDrawRange(0, QUALITY_PROFILES[this.tier].orbitParticles);

    this.orbitMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uPixelRatio: {
          value: Math.min(
            window.devicePixelRatio || 1,
            QUALITY_PROFILES[this.tier].dpr,
          ),
        },
      },
      vertexShader: orbitVertexShader,
      fragmentShader: orbitFragmentShader,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.orbitPoints = new THREE.Points(geometry, this.orbitMaterial);
    this.orbitPoints.frustumCulled = false;
    this.orbitPoints.renderOrder = 3;
    this.heartGroup.add(this.orbitPoints);
  }

  private createBackground(): void {
    const maxCount = QUALITY_PROFILES.ultra.backgroundParticles;
    const random = createSeededRandom(String(this.seed) + "-background");
    const positions = new Float32Array(maxCount * 3);
    const colors = new Float32Array(maxCount * 3);
    const rose = new THREE.Color(0xff176b);
    const violet = new THREE.Color(0x7657ff);
    const ivory = new THREE.Color(0xfff8f4);

    for (let index = 0; index < maxCount; index += 1) {
      const offset = index * 3;
      const radius = 5 + random() * 10;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(random() * 2 - 1);
      positions[offset] = Math.sin(phi) * Math.cos(theta) * radius;
      positions[offset + 1] = Math.cos(phi) * radius * 0.68;
      positions[offset + 2] =
        Math.sin(phi) * Math.sin(theta) * radius - 3.5;
      const source = random() > 0.93 ? violet : random() > 0.7 ? rose : ivory;
      const brightness = 0.2 + random() * 0.35;
      colors[offset] = source.r * brightness;
      colors[offset + 1] = source.g * brightness;
      colors[offset + 2] = source.b * brightness;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, QUALITY_PROFILES[this.tier].backgroundParticles);
    const material = new THREE.PointsMaterial({
      size: 0.018,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.backgroundPoints = new THREE.Points(geometry, material);
    this.backgroundPoints.renderOrder = -2;
    this.scene.add(this.backgroundPoints);
  }

  private samplePerformance(delta: number, now: number): void {
    if (delta > 0 && delta < 0.5) {
      this.frameTimes.push(delta * 1000);
    }
    if (now - this.performanceWindowAt < 2_000 || this.frameTimes.length < 10) {
      return;
    }

    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const averageFrameMs =
      this.frameTimes.reduce((sum, value) => sum + value, 0) /
      this.frameTimes.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    this.fps = 1_000 / Math.max(1, averageFrameMs);
    const requested = this.qualityController.sample(
      this.settings.qualityMode,
      {
        averageFps: this.fps,
        p95FrameMs: p95,
        longFrames: this.frameTimes.filter((value) => value > 50).length,
        timestamp: now,
        isTransient: this.stateMachine.isBurstSequence,
      },
    );
    if (requested) {
      this.requestTier(requested);
    }
    this.frameTimes = [];
    this.performanceWindowAt = now;
  }

  private requestTier(tier: QualityTier): void {
    const compatibleTier = this.constrainTierForCapabilities(tier);
    if (compatibleTier === this.tier) {
      return;
    }
    if (
      this.contextLost ||
      (!this.gpu && this.contextRecoveryPolicy.failureCount > 0)
    ) {
      this.pendingTier = compatibleTier;
      return;
    }
    if (
      this.stateMachine.current === "IDLE_BEAT" ||
      this.stateMachine.current === "SETTLE"
    ) {
      this.applyTier(compatibleTier);
    } else {
      this.pendingTier = compatibleTier;
    }
  }

  private applyTier(tier: QualityTier): void {
    const compatibleTier = this.constrainTierForCapabilities(tier);
    if (
      this.contextLost ||
      (!this.gpu && this.contextRecoveryPolicy.failureCount > 0)
    ) {
      this.pendingTier = compatibleTier;
      return;
    }
    if (compatibleTier === this.tier || this.disposed) {
      return;
    }
    this.tier = compatibleTier;
    this.qualityController.reset(compatibleTier);
    this.rebuildHeartSystem(compatibleTier);

    if (this.orbitPoints) {
      this.orbitPoints.geometry.setDrawRange(
        0,
        QUALITY_PROFILES[this.tier].orbitParticles,
      );
    }
    if (this.backgroundPoints) {
      this.backgroundPoints.geometry.setDrawRange(
        0,
        QUALITY_PROFILES[this.tier].backgroundParticles,
      );
    }
    this.resize();
    this.seedHeartAtRest();
    this.stateMachine.forceIdle();
  }

  private rebuildHeartSystem(tier: QualityTier): void {
    this.disposeHeartSystem();
    const compatibleTier = this.constrainTierForCapabilities(tier);
    this.tier = compatibleTier;
    try {
      this.createHeartSystem(compatibleTier);
    } catch (error) {
      if (
        this.simulationPrecision !== "float" ||
        !this.halfFloatRenderable
      ) {
        throw error;
      }

      this.simulationPrecision = "half-float";
      this.tier = "performance";
      this.qualityController.reset(this.tier);
      this.createHeartSystem(this.tier);
    }
  }

  private rebuildVisualResources(): void {
    this.disposeHeartSystem();
    this.disposeSceneResources();
    this.heartGroup = new THREE.Group();
    this.mountHeartGroup();
    this.rebuildHeartSystem(this.tier);
    this.seedHeartAtRest();
    this.createCore();
    this.createRings();
    this.createOrbitParticles();
    this.createBackground();
    this.resize();
  }

  private mountHeartGroup(): void {
    this.scene.add(this.heartGroup);
    this.heartGroup.scale.setScalar(1.48);
    this.heartGroup.position.y = 0.08;
  }

  private createPostProcessing(): {
    composer: EffectComposer;
    bloomPass: UnrealBloomPass;
  } {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      this.settings.bloom * 0.56,
      0.3,
      0.82,
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    return { composer, bloomPass };
  }

  private rebuildPostProcessing(): void {
    this.composer.dispose();
    const postProcessing = this.createPostProcessing();
    this.composer = postProcessing.composer;
    this.bloomPass = postProcessing.bloomPass;
  }

  private disposeHeartSystem(): void {
    if (!this.gpu) {
      return;
    }
    this.heartGroup.remove(this.gpu.points);
    this.gpu.geometry.dispose();
    this.gpu.material.dispose();
    this.gpu.compute.dispose();
    this.gpu.initialPosition.dispose();
    this.gpu.settledPosition.dispose();
    this.gpu.initialVelocity.dispose();
    this.gpu.home.dispose();
    this.gpu.normal.dispose();
    this.gpu.meta.dispose();
    this.gpu.spawn.dispose();
    this.gpu = null;
  }

  private disposeSceneResources(): void {
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) {
        for (const material of mesh.material) {
          this.disposeMaterial(material);
        }
      } else if (mesh.material) {
        this.disposeMaterial(mesh.material);
      }
    });
    this.scene.clear();
    this.coreSprites = [];
    this.rings = [];
    this.orbitPoints = null;
    this.orbitMaterial = null;
    this.backgroundPoints = null;
  }

  private disposeMaterial(material: THREE.Material): void {
    const withMap = material as THREE.Material & { map?: THREE.Texture | null };
    withMap.map?.dispose();
    material.dispose();
  }

  private scheduleAnimationFrame(): void {
    if (
      this.raf !== 0 ||
      !this.running ||
      this.disposed ||
      this.paused ||
      !this.pageVisible ||
      this.contextLost ||
      !this.gpu
    ) {
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  private cancelAnimationFrame(): void {
    if (this.raf === 0) {
      return;
    }
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private clearContextRestoreTimeout(): void {
    if (this.contextRestoreTimeout === null) {
      return;
    }
    clearTimeout(this.contextRestoreTimeout);
    this.contextRestoreTimeout = null;
  }

  private recordContextRecoveryFailure(reason: string): void {
    const decision = this.contextRecoveryPolicy.recordFailure();

    const cleanReason = reason.replace(/[。.]$/, "");
    if (decision.locked) {
      this.setFallback(
        cleanReason + "。连续三次恢复失败，已切换到静态粒子爱心。可点击重新尝试。",
      );
      return;
    }

    this.setFallback(
      cleanReason +
        `，已显示静态粒子爱心（${decision.failureCount}/${MAX_CONTEXT_RECOVERY_FAILURES}）。可点击重新尝试。`,
    );
  }

  private constrainTierForCapabilities(tier: QualityTier): QualityTier {
    if (this.simulationPrecision === "half-float") {
      return "performance";
    }
    if (QUALITY_PROFILES[tier].textureSize <= this.maxTextureSize) {
      return tier;
    }
    if (
      tier === "ultra" &&
      QUALITY_PROFILES.balanced.textureSize <= this.maxTextureSize
    ) {
      return "balanced";
    }
    return "performance";
  }

  private resolveInitialTier(): QualityTier {
    if (this.settings.reducedMotion) {
      return "performance";
    }
    if (this.settings.qualityMode !== "auto") {
      return this.settings.qualityMode;
    }
    const navigatorHints = navigator as NavigatorHints;
    const mobile =
      window.matchMedia("(pointer: coarse)").matches ||
      Math.min(window.innerWidth, window.innerHeight) < 720;
    const highCapacity =
      !mobile &&
      (navigator.hardwareConcurrency ?? 4) >= 8 &&
      (navigatorHints.deviceMemory ?? 4) >= 8 &&
      window.innerWidth * window.innerHeight <= 3_686_400;
    return highCapacity ? "balanced" : "performance";
  }

  private setFallback(reason: string): void {
    this.fallbackReason = reason;
    this.callbacks.onFallback?.(reason);
    this.emitSnapshot(true);
  }

  private emitSnapshot(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastSnapshotAt < 100) {
      return;
    }
    this.lastSnapshotAt = now;
    const phase = this.stateMachine.current;
    this.callbacks.onSnapshot?.({
      phase,
      phaseProgress: this.stateMachine.phaseProgress,
      charge: this.stateMachine.chargeAmount,
      qualityTier: this.tier,
      fps: this.fps,
      isPaused: this.paused,
      isReady: !["PREWARM", "ASSEMBLE", "AWAKEN"].includes(phase),
      fallbackReason: this.fallbackReason,
    });
  }
}
