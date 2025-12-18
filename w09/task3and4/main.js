"use strict";
window.onload = () => main();

const TEAPOT_OBJ_PATH = "../../models-images/teapot.obj";
const GROUND_TEX_PATH = "../../models-images/xamp23.png";
const SHADER_PATH     = "shader.wgsl";

const SHADOW_SIZE = 2048;

async function loadText(path) {
  const r = await fetch(path, { cache: "reload" });
  if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
  return await r.text();
}

async function loadImage(path) {
  const img = new Image();
  img.src = path;
  await img.decode();
  return img;
}

async function createTextureFromImage(device, img) {
  const bmp = await createImageBitmap(img);
  const tex = device.createTexture({
    size: [bmp.width, bmp.height, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture(
    { source: bmp },
    { texture: tex },
    [bmp.width, bmp.height]
  );
  return tex;
}

function lightPosition(t) {
  const cx = 0.0, cy = 1.5, cz = -3.0;
  const r = 3.0;
  return vec3(cx + r * Math.cos(t), cy, cz + r * Math.sin(t));
}

function writeMat4(device, buffer, M) {
  device.queue.writeBuffer(buffer, 0, new Float32Array(flatten(M)));
}

function writeGroundUniforms(device, buffer, mvp, lightMVP) {
  const data = new Float32Array(32);
  data.set(flatten(mvp), 0);
  data.set(flatten(lightMVP), 16);
  device.queue.writeBuffer(buffer, 0, data);
}

function writeTeapotUniforms(device, buffer, model, mvp, lightMVP, lightPos, eyePos) {
  const data = new Float32Array(56);
  data.set(flatten(model), 0);
  data.set(flatten(mvp), 16);
  data.set(flatten(lightMVP), 32);
  data.set([lightPos[0], lightPos[1], lightPos[2], 1.0], 48);
  data.set([eyePos[0], eyePos[1], eyePos[2], 1.0], 52);
  device.queue.writeBuffer(buffer, 0, data);
}

async function main() {
  const canvas = document.getElementById("my-canvas");
  if (!navigator.gpu) throw new Error("WebGPU not supported.");

  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  // UI: toggles
  const bounceToggle = document.getElementById("bounceToggle");
  const lightToggle  = document.getElementById("lightToggle");

  // Main depth
  const mainDepthTex = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // Shadow map: color stores depth in .r, plus a depth attachment for correct nearest-surface
  const shadowMapTex = device.createTexture({
    size: [SHADOW_SIZE, SHADOW_SIZE],
    format: "rgba32float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });

  const shadowDepthTex = device.createTexture({
    size: [SHADOW_SIZE, SHADOW_SIZE],
    format: "depth32float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // WGSL
  const wgslCode = await loadText(SHADER_PATH);
  const module = device.createShaderModule({ code: wgslCode });

  // ---------- Ground quad (pos.xyz + uv) ----------
  const groundVerts = new Float32Array([
    -2, -1, -1,   0, 0,
     2, -1, -1,   1, 0,
     2, -1, -5,   1, 1,
    -2, -1, -5,   0, 1,
  ]);
  const groundIdx = new Uint16Array([0, 1, 2, 0, 2, 3]);

  const groundVBuf = device.createBuffer({
    size: groundVerts.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(groundVBuf, 0, groundVerts);

  const groundIBuf = device.createBuffer({
    size: groundIdx.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(groundIBuf, 0, groundIdx);

  const groundVertexLayout = {
    arrayStride: 5 * 4,
    attributes: [
      { shaderLocation: 0, offset: 0,     format: "float32x3" },
      { shaderLocation: 1, offset: 3 * 4, format: "float32x2" },
    ],
  };

  const groundImg = await loadImage(GROUND_TEX_PATH);
  const groundTex = await createTextureFromImage(device, groundImg);

  const groundSampler = device.createSampler({
    addressModeU: "repeat",
    addressModeV: "repeat",
    magFilter: "linear",
    minFilter: "linear",
  });

  // ---------- Teapot OBJ (interleaved pos+normal) ----------
  const info = await readOBJFile(TEAPOT_OBJ_PATH, 1.0, false);

  const vCount = info.vertices.length / 4;
  const teapotInterleaved = new Float32Array(vCount * 6);
  for (let i = 0; i < vCount; i++) {
    const px = info.vertices[i * 4 + 0];
    const py = info.vertices[i * 4 + 1];
    const pz = info.vertices[i * 4 + 2];
    const nx = info.normals[i * 4 + 0];
    const ny = info.normals[i * 4 + 1];
    const nz = info.normals[i * 4 + 2];
    teapotInterleaved.set([px, py, pz, nx, ny, nz], i * 6);
  }

  const teapotVBuf = device.createBuffer({
    size: teapotInterleaved.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(teapotVBuf, 0, teapotInterleaved);

  const teapotIBuf = device.createBuffer({
    size: info.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(teapotIBuf, 0, info.indices);

  const teapotIndexFormat = (info.indices.BYTES_PER_ELEMENT === 2) ? "uint16" : "uint32";
  const teapotIndexCount = info.indices.length;

  const teapotVertexLayout = {
    arrayStride: 6 * 4,
    attributes: [
      { shaderLocation: 0, offset: 0,     format: "float32x3" },
      { shaderLocation: 1, offset: 3 * 4, format: "float32x3" },
    ],
  };

  // ---------- Bind group layouts (explicit, like your friend) ----------
  const groundBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "2d" } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float", viewDimension: "2d" } },
    ],
  });

  const teapotBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float", viewDimension: "2d" } },
    ],
  });

  const shadowBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    ],
  });

  // ---------- Pipelines ----------
  const groundPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [groundBGL] }),
    vertex: { module, entryPoint: "ground_vs", buffers: [groundVertexLayout] },
    fragment: { module, entryPoint: "ground_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });

  const teapotPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [teapotBGL] }),
    vertex: { module, entryPoint: "teapot_vs", buffers: [teapotVertexLayout] },
    fragment: { module, entryPoint: "teapot_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });

  const shadowGroundPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [shadowBGL] }),
    vertex: { module, entryPoint: "shadow_ground_vs", buffers: [groundVertexLayout] },
    fragment: { module, entryPoint: "shadow_fs", targets: [{ format: "rgba32float" }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: "depth32float",
      depthWriteEnabled: true,
      depthCompare: "less",
      depthBias: 2,
      depthBiasSlopeScale: 2,
      depthBiasClamp: 0,
    },
  });

  const shadowTeapotPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [shadowBGL] }),
    vertex: { module, entryPoint: "shadow_teapot_vs", buffers: [teapotVertexLayout] },
    fragment: { module, entryPoint: "shadow_fs", targets: [{ format: "rgba32float" }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: "depth32float",
      depthWriteEnabled: true,
      depthCompare: "less",
      depthBias: 2,
      depthBiasSlopeScale: 2,
      depthBiasClamp: 0,
    },
  });

  // ---------- Uniform buffers + bind groups ----------
  const groundUBO = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const teapotUBO = device.createBuffer({ size: 224, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const shadowGroundUBO = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const shadowTeapotUBO = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const groundBindGroup = device.createBindGroup({
    layout: groundBGL,
    entries: [
      { binding: 0, resource: groundSampler },
      { binding: 1, resource: groundTex.createView() },
      { binding: 2, resource: { buffer: groundUBO } },
      { binding: 3, resource: shadowMapTex.createView() },
    ],
  });

  const teapotBindGroup = device.createBindGroup({
    layout: teapotBGL,
    entries: [
      { binding: 0, resource: { buffer: teapotUBO } },
      { binding: 1, resource: shadowMapTex.createView() },
    ],
  });

  const shadowGroundBindGroup = device.createBindGroup({
    layout: shadowBGL,
    entries: [{ binding: 0, resource: { buffer: shadowGroundUBO } }],
  });

  const shadowTeapotBindGroup = device.createBindGroup({
    layout: shadowBGL,
    entries: [{ binding: 0, resource: { buffer: shadowTeapotUBO } }],
  });

  // ---------- Camera + matrices ----------
  const eye = vec3(0, 0.75, 2.0);
  const at  = vec3(0, -0.5, -3.0);
  const up  = vec3(0, 1, 0);

  const P = perspective(50, canvas.width / canvas.height, 0.1, 100);
  const Mground = mat4();

  const S_teapot = scalem(0.25, 0.25, 0.25);
  const start = performance.now();
  let tTeapot = 0;
  let tLight = 0;

  function frame(now) {
    const t = (now - start) * 0.001;

    if (lightToggle && lightToggle.checked) tLight += 0.02;
    const lightCenter = vec3(0.0, -0.5, -3.0);
    const lightPos = vec3(
      lightCenter[0] + 3 * Math.cos(tLight),
      lightCenter[1] + 3,
      lightCenter[2] + 3 * Math.sin(tLight)
    );

    const V = lookAt(eye, at, up);

    if (bounceToggle && bounceToggle.checked) tTeapot += 0.02;
    const yOffset = bounceToggle && bounceToggle.checked ? 1.5 * (0.5 * (Math.sin(tTeapot) + 1.0)) : 0.0;
    const Mteapot = mult(translate(0.0, -1 + yOffset, -3.0), S_teapot);

    
    const lightAt = vec3(0.0, -1.0, -3.0);
    const Vlight = lookAt(lightPos, lightAt, vec3(0,1,0));
    const Plight = perspective(50, 1.0, 0.5, 12.0);
    const lightVP = mult(Plight, Vlight);

    const MVP_ground = mult(P, mult(V, Mground));
    const MVP_teapot = mult(P, mult(V, Mteapot));

    const lightMVP_ground = mult(lightVP, Mground);
    const lightMVP_teapot = mult(lightVP, Mteapot);

    writeGroundUniforms(device, groundUBO, MVP_ground, lightMVP_ground);
    writeTeapotUniforms(device, teapotUBO, Mteapot, MVP_teapot, lightMVP_teapot, lightPos, eye);

    writeMat4(device, shadowGroundUBO, lightMVP_ground);
    writeMat4(device, shadowTeapotUBO, lightMVP_teapot);

    const encoder = device.createCommandEncoder();

    // Pass A: shadow map
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: shadowMapTex.createView(),
          loadOp: "clear",
          clearValue: { r: 1, g: 1, b: 1, a: 1 },
          storeOp: "store",
        }],
        depthStencilAttachment: {
          view: shadowDepthTex.createView(),
          depthLoadOp: "clear",
          depthClearValue: 1.0,
          depthStoreOp: "store",
        },
      });

      // Ground into shadow map
      pass.setPipeline(shadowGroundPipeline);
      pass.setBindGroup(0, shadowGroundBindGroup);
      pass.setVertexBuffer(0, groundVBuf);
      pass.setIndexBuffer(groundIBuf, "uint16");
      pass.drawIndexed(6);

      // Teapot into shadow map
      pass.setPipeline(shadowTeapotPipeline);
      pass.setBindGroup(0, shadowTeapotBindGroup);
      pass.setVertexBuffer(0, teapotVBuf);
      pass.setIndexBuffer(teapotIBuf, teapotIndexFormat);
      pass.drawIndexed(teapotIndexCount);

      pass.end();
    }

    // Pass B: main render
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          clearValue: { r: 1, g: 1, b: 1, a: 1 },
          storeOp: "store",
        }],
        depthStencilAttachment: {
          view: mainDepthTex.createView(),
          depthLoadOp: "clear",
          depthClearValue: 1.0,
          depthStoreOp: "store",
        },
      });

      pass.setPipeline(groundPipeline);
      pass.setBindGroup(0, groundBindGroup);
      pass.setVertexBuffer(0, groundVBuf);
      pass.setIndexBuffer(groundIBuf, "uint16");
      pass.drawIndexed(6);

      pass.setPipeline(teapotPipeline);
      pass.setBindGroup(0, teapotBindGroup);
      pass.setVertexBuffer(0, teapotVBuf);
      pass.setIndexBuffer(teapotIBuf, teapotIndexFormat);
      pass.drawIndexed(teapotIndexCount);

      pass.end();
    }

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
