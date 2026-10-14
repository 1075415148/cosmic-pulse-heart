export type SimulationPrecision = "float" | "half-float";

export interface GraphicsCapabilities {
  simulationPrecision: SimulationPrecision | null;
  maxTextureSize: number;
  maxVertexTextureUnits: number;
  floatRenderable: boolean;
  halfFloatRenderable: boolean;
  fallbackReason: string | null;
}

interface CapabilityProbeResult {
  maxTextureSize: number;
  maxVertexTextureUnits: number;
  floatRenderable: boolean;
  halfFloatRenderable: boolean;
}

const MINIMUM_SIMULATION_TEXTURE_SIZE = 128;

export function selectGraphicsCapabilities(
  probe: CapabilityProbeResult,
): GraphicsCapabilities {
  const common = {
    maxTextureSize: probe.maxTextureSize,
    maxVertexTextureUnits: probe.maxVertexTextureUnits,
    floatRenderable: probe.floatRenderable,
    halfFloatRenderable: probe.halfFloatRenderable,
  };

  if (probe.maxVertexTextureUnits < 1) {
    return {
      ...common,
      simulationPrecision: null,
      fallbackReason: "当前 GPU 不支持顶点纹理读取，已显示静态粒子爱心。",
    };
  }

  if (probe.maxTextureSize < MINIMUM_SIMULATION_TEXTURE_SIZE) {
    return {
      ...common,
      simulationPrecision: null,
      fallbackReason: "当前 GPU 的纹理尺寸不足，已显示静态粒子爱心。",
    };
  }

  if (probe.floatRenderable) {
    return {
      ...common,
      simulationPrecision: "float",
      fallbackReason: null,
    };
  }

  if (probe.halfFloatRenderable) {
    return {
      ...common,
      simulationPrecision: "half-float",
      fallbackReason: null,
    };
  }

  return {
    ...common,
    simulationPrecision: null,
    fallbackReason: "当前 GPU 无法创建粒子模拟缓冲区，已显示静态粒子爱心。",
  };
}

function clearErrors(gl: WebGL2RenderingContext): void {
  for (let index = 0; index < 16; index += 1) {
    if (gl.getError() === gl.NO_ERROR) {
      return;
    }
  }
}

function probeColorBuffer(
  gl: WebGL2RenderingContext,
  internalFormat: number,
  type: number,
): boolean {
  const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  const previousFramebuffer = gl.getParameter(
    gl.DRAW_FRAMEBUFFER_BINDING,
  ) as WebGLFramebuffer | null;

  gl.activeTexture(gl.TEXTURE0);
  const previousTexture = gl.getParameter(
    gl.TEXTURE_BINDING_2D,
  ) as WebGLTexture | null;
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();

  if (!texture || !framebuffer) {
    if (texture) {
      gl.deleteTexture(texture);
    }
    if (framebuffer) {
      gl.deleteFramebuffer(framebuffer);
    }
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousFramebuffer);
    gl.bindTexture(gl.TEXTURE_2D, previousTexture);
    gl.activeTexture(previousActiveTexture);
    return false;
  }

  try {
    clearErrors(gl);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      4,
      4,
      0,
      gl.RGBA,
      type,
      null,
    );
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.DRAW_FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );

    if (
      gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !==
      gl.FRAMEBUFFER_COMPLETE
    ) {
      return false;
    }
    gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0, 0, 0, 1]));
    return gl.getError() === gl.NO_ERROR;
  } catch {
    return false;
  } finally {
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousFramebuffer);
    gl.bindTexture(gl.TEXTURE_2D, previousTexture);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    gl.activeTexture(previousActiveTexture);
    clearErrors(gl);
  }
}

export function detectGraphicsCapabilities(
  gl: WebGL2RenderingContext,
): GraphicsCapabilities {
  gl.getExtension("EXT_color_buffer_float");

  return selectGraphicsCapabilities({
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    maxVertexTextureUnits: gl.getParameter(
      gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS,
    ) as number,
    floatRenderable: probeColorBuffer(gl, gl.RGBA32F, gl.FLOAT),
    halfFloatRenderable: probeColorBuffer(gl, gl.RGBA16F, gl.HALF_FLOAT),
  });
}
