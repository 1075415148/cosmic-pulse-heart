import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("locks the restrained rose-magenta 3D luminance contract", async () => {
  const [shaders, sampling, engine, types, ui] = await Promise.all([
    readFile(
      new URL("../app/experience/engine/shaders.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/experience/engine/heartSampling.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/experience/engine/HeartExperience.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/experience/core/types.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/experience/ui/ExperienceUI.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.equal(
    shaders.includes(String.fromCharCode(92) + String.fromCharCode(96)),
    false,
  );
  assert.doesNotMatch(shaders, /\bfloat active\b/);
  assert.match(shaders, /vec3 rose = vec3\(0\.96, 0\.035, 0\.30\)/);
  assert.match(shaders, /varying float vDepthCue/);
  assert.match(shaders, /vDiffuse \* 0\.25 \+ vDepthCue \* 0\.14/);
  assert.match(shaders, /varying float vSpecular/);
  assert.match(shaders, /float depthSize = mix\(0\.84, 1\.08, vDepthCue\)/);
  assert.match(shaders, /vCleftShadow \* 0\.14/);
  assert.match(shaders, /perspective = 17\.5/);
  assert.match(shaders, /float groupAlpha = homeGroup\.w < 0\.5/);
  assert.match(shaders, /mix\(0\.24, 0\.82, vDepthCue\)/);
  assert.match(shaders, /centerViewZ/);
  assert.match(sampling, /const halfDepth = 0\.52/);
  assert.match(engine, /PerspectiveCamera\(46/);
  assert.match(engine, /degToRad\(-6\.5\)/);
  assert.match(engine, /toneMappingExposure = 0\.72/);
  assert.match(engine, /this\.settings\.bloom \* 0\.56/);
  assert.match(types, /bloom: 0\.7/);
  assert.match(ui, /max="1\.2"/);
});

test("ships a valid landscape Open Graph image", async () => {
  const image = await readFile(
    new URL("../public/og-card.png", import.meta.url),
  );
  assert.equal(image.subarray(1, 4).toString("ascii"), "PNG");
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  assert.equal(width, 1731);
  assert.equal(height, 909);
  assert.ok(width / height > 1.9 && width / height < 1.92);
});
