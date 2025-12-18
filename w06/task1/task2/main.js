"use strict";

window.onload = () => main();

const f32 = a => new Float32Array(a);
const u32 = a => new Uint32Array(a);

function makeCheckerboard(size = 256, tiles = 16) {
  const data = new Uint8Array(size * size * 4);
  const step = size / tiles;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = ((Math.floor(x / step) ^ Math.floor(y / step)) & 1) ? 255 : 0;
      const i = 4 * (y * size + x);
      data[i + 0] = c;
      data[i + 1] = c;
      data[i + 2] = c;
      data[i + 3] = 255;
    }
  }
  return data;
}

async function loadText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const text = await res.text();
  if (text.trim().startsWith('"use strict"') || text.includes("window.onload")) {
    throw new Error(`Fetched ${url}, but got JavaScript instead of WGSL. Check file name/path.`);
  }
  return text;
}

async function main() {
  const canvas = document.getElementById("my-canvas");

  const gpu = navigator.gpu;
  if (!gpu) return;

  const adapter = await gpu.requestAdapter();
  if (!adapter) return;

  const device = await adapter.requestDevice();

  const context = canvas.getContext("webgpu");
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const shaderCode = await loadText("./shader.wgsl");
  const shaderModule = device.createShaderModule({ code: shaderCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [
        { arrayStride: 3 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
        { arrayStride: 2 * 4, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }] }
      ]
    },
    fragment: {
      module: shaderModule,
      entryPoint: "main_fs",
      targets: [{ format }]
    },
    primitive: { topology: "triangle-list", cullMode: "back" }
  });

  const positions = f32([
    -4, -1, -1,
     4, -1, -1,
     4, -1,-21,
    -4, -1,-21
  ]);

  const uvs = f32([
    -1.5,  0.0,
     2.5,  0.0,
     2.5, 10.0,
    -1.5, 10.0
  ]);

  const indices = u32([0, 1, 2, 0, 2, 3]);

  const posBuffer = device.createBuffer({ size: positions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(posBuffer, 0, positions);

  const uvBuffer = device.createBuffer({ size: uvs.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uvBuffer, 0, uvs);

  const idxBuffer = device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(idxBuffer, 0, indices);

  const texSize = 256;
  const base = makeCheckerboard(texSize, 16);

  const mips = numMipLevels(texSize, texSize);

  const texture = device.createTexture({
    size: [texSize, texSize, 1],
    format: "rgba8unorm",
    mipLevelCount: mips,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });

  device.queue.writeTexture(
    { texture, mipLevel: 0 },
    base,
    { bytesPerRow: texSize * 4 },
    [texSize, texSize, 1]
  );

  generateMipmap(device, texture);

  const uniformBuffer = device.createBuffer({
    size: 16 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const OPENGL_TO_WGPU = mat4(
    vec4(1, 0, 0, 0),
    vec4(0, 1, 0, 0),
    vec4(0, 0, 0.5, 0.5),
    vec4(0, 0, 0, 1)
  );

  const P = perspective(90, canvas.width / canvas.height, 0.1, 100.0);
  const V = mat4();
  const M = mat4();
  const MVP = mult(OPENGL_TO_WGPU, mult(P, mult(V, M)));
  device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(flatten(MVP)));

  let bindGroup = null;

  const wrapEl = document.getElementById("wrap");
  const minFEl = document.getElementById("minF");
  const magFEl = document.getElementById("magF");
  const mipFEl = document.getElementById("mipF");
  const useMipsEl = document.getElementById("useMips");

  function draw() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 }
      }]
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, posBuffer);
    pass.setVertexBuffer(1, uvBuffer);
    pass.setIndexBuffer(idxBuffer, "uint32");
    pass.drawIndexed(indices.length);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  function rebuildBindGroup() {
    const wrap = wrapEl.value === "repeat" ? "repeat" : "clamp-to-edge";
    const minFilter = minFEl.value === "nearest" ? "nearest" : "linear";
    const magFilter = magFEl.value === "nearest" ? "nearest" : "linear";
    const mipmapFilter = mipFEl.value === "nearest" ? "nearest" : "linear";
    const useMips = useMipsEl.checked;

    const sampler = device.createSampler({
      addressModeU: wrap,
      addressModeV: wrap,
      minFilter,
      magFilter,
      mipmapFilter: useMips ? mipmapFilter : "nearest"
    });

    const view = texture.createView({
      baseMipLevel: 0,
      mipLevelCount: useMips ? mips : 1
    });

    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: view }
      ]
    });

    draw();
  }

  wrapEl.addEventListener("change", rebuildBindGroup);
  minFEl.addEventListener("change", rebuildBindGroup);
  magFEl.addEventListener("change", rebuildBindGroup);
  mipFEl.addEventListener("change", rebuildBindGroup);
  useMipsEl.addEventListener("change", rebuildBindGroup);

  rebuildBindGroup();
}
