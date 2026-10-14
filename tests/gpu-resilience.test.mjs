import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { selectGraphicsCapabilities } from "../app/experience/engine/capabilities.ts";
import {
  ContextRecoveryPolicy,
  isContextRecoveryTimedOut,
} from "../app/experience/engine/contextRecovery.ts";

const capableProbe = {
  maxTextureSize: 16_384,
  maxVertexTextureUnits: 16,
  floatRenderable: true,
  halfFloatRenderable: true,
};

test("GPU capability selection keeps the full-float visual path", () => {
  const result = selectGraphicsCapabilities(capableProbe);

  assert.equal(result.simulationPrecision, "float");
  assert.equal(result.fallbackReason, null);
});

test("GPU capability selection degrades from float to half-float", () => {
  const result = selectGraphicsCapabilities({
    ...capableProbe,
    floatRenderable: false,
  });

  assert.equal(result.simulationPrecision, "half-float");
  assert.equal(result.fallbackReason, null);
});

test("GPU capability selection uses static fallback when compute is unsafe", () => {
  const noRenderTarget = selectGraphicsCapabilities({
    ...capableProbe,
    floatRenderable: false,
    halfFloatRenderable: false,
  });
  const noVertexTextures = selectGraphicsCapabilities({
    ...capableProbe,
    maxVertexTextureUnits: 0,
  });
  const textureTooSmall = selectGraphicsCapabilities({
    ...capableProbe,
    maxTextureSize: 64,
  });

  assert.equal(noRenderTarget.simulationPrecision, null);
  assert.match(noRenderTarget.fallbackReason ?? "", /静态粒子爱心/);
  assert.equal(noVertexTextures.simulationPrecision, null);
  assert.equal(textureTooSmall.simulationPrecision, null);
});

test("context recovery timeout uses the exact three-second boundary", () => {
  assert.equal(isContextRecoveryTimedOut(1_000, 3_999), false);
  assert.equal(isContextRecoveryTimedOut(1_000, 4_000), true);
});

test("a second loss inside sixty seconds forces Performance", () => {
  const at59_999 = new ContextRecoveryPolicy();
  at59_999.beginLoss(0);
  assert.equal(at59_999.beginLoss(59_999).forcePerformance, true);

  const at60_000 = new ContextRecoveryPolicy();
  at60_000.beginLoss(0);
  assert.equal(at60_000.beginLoss(60_000).forcePerformance, true);

  const at60_001 = new ContextRecoveryPolicy();
  at60_001.beginLoss(0);
  assert.equal(at60_001.beginLoss(60_001).forcePerformance, false);
});

test("context recovery counts one failure per incident and locks on three", () => {
  const policy = new ContextRecoveryPolicy();

  policy.beginLoss(0);
  assert.deepEqual(policy.recordFailure(), {
    failureCount: 1,
    locked: false,
    newlyRecorded: true,
  });
  assert.equal(policy.recordFailure().newlyRecorded, false);

  policy.beginManualRetry();
  assert.equal(policy.recordFailure().failureCount, 2);
  policy.beginManualRetry();
  assert.deepEqual(policy.recordFailure(), {
    failureCount: 3,
    locked: true,
    newlyRecorded: true,
  });

  policy.beginManualRetry();
  assert.equal(policy.failureCount, 0);
  assert.equal(policy.isLocked, false);
  policy.recordFailure();
  policy.recordSuccess();
  assert.equal(policy.failureCount, 0);
});

test("context recovery contract stops work and rebuilds every visual resource", async () => {
  const [source, recovery, component] = await Promise.all([
    readFile(
      new URL("../app/experience/engine/HeartExperience.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/experience/engine/contextRecovery.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/experience/CosmicHeartExperience.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /this\.cancelAnimationFrame\(\)/);
  assert.match(recovery, /CONTEXT_RESTORE_TIMEOUT_MS = 3_000/);
  assert.match(recovery, /CONTEXT_LOSS_WINDOW_MS = 60_000/);
  assert.match(recovery, /MAX_CONTEXT_RECOVERY_FAILURES = 3/);
  assert.match(source, /this\.rebuildPostProcessing\(\)/);
  assert.match(source, /this\.rebuildVisualResources\(\)/);
  assert.match(source, /this\.renderRecoveryFrame\(\)/);
  assert.match(source, /this\.validateComputeTargets\(compute/);
  assert.match(source, /compute\.setDataType\(THREE\.HalfFloatType\)/);
  assert.match(source, /debugCycleContext\(restoreAfterMs = 1_500\)/);
  assert.match(
    component,
    /setEngineActive\(nextSnapshot\.fallbackReason === null\)/,
  );
  assert.match(component, /onFallback: \(reason\) => \{[\s\S]*setEngineActive\(false\)/);
  assert.match(component, /engineRef\.current\.retryGraphics\(\)/);
  assert.match(component, /get\("contextProbe"\) === "1"/);
});
