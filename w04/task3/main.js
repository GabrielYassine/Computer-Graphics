"use strict";
window.onload = () => main();

async function main() {
  const gpu = navigator.gpu;
  if (!gpu) return;

  const adapter = await gpu.requestAdapter();
  if (!adapter) return;

  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  // ---------- Pipeline ----------
  const shaderCode = await (await fetch("shader.wgsl")).text();
  const shaderModule = device.createShaderModule({ code: shaderCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [
        { arrayStride: 3 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }
      ]
    },
    fragment: {
      module: shaderModule,
      entryPoint: "main_fs",
      targets: [{ format }]
    },
    primitive: {
      topology: "triangle-list",
      frontFace: "ccw",
      cullMode: "back"
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less"
    }
  });

  // ---------- Uniform ----------
  const uniformBuffer = device.createBuffer({
    size: 16 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });

  // ---------- Depth texture ----------
  let depthTex = null;
  function ensureDepth() {
    if (!depthTex || depthTex.width !== canvas.width || depthTex.height !== canvas.height) {
      if (depthTex) depthTex.destroy();
      depthTex = device.createTexture({
        size: [canvas.width, canvas.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT
      });
    }
  }

  // ---------- Geometry ----------
  let posBuffer = null;
  let indexBuffer = null;
  let indexCount = 0;

  function makeTetrahedron() {
    const s2 = Math.sqrt(2);
    const s6 = Math.sqrt(6);
    return {
      positions: [
        vec3(0, 0, 1),
        vec3(0, 2 * s2 / 3, -1 / 3),
        vec3(-s6 / 3, -s2 / 3, -1 / 3),
        vec3(s6 / 3, -s2 / 3, -1 / 3),
      ],
      indices: [
        0, 1, 2,
        0, 3, 1,
        1, 3, 2,
        0, 2, 3,
      ]
    };
  }

  function subdivideOnce(positions, indices) {
    const newPos = positions.slice();
    const newIdx = [];

    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
      const a = positions[i0];
      const b = positions[i1];
      const c = positions[i2];

      const ab = normalize(mix(a, b, 0.5));
      const bc = normalize(mix(b, c, 0.5));
      const ca = normalize(mix(c, a, 0.5));

      const iab = newPos.push(ab) - 1;
      const ibc = newPos.push(bc) - 1;
      const ica = newPos.push(ca) - 1;

      newIdx.push(
        i0, iab, ica,
        i1, ibc, iab,
        i2, ica, ibc,
        iab, ibc, ica
      );
    }
    return { positions: newPos, indices: newIdx };
  }

  function buildSphere(level) {
    let { positions, indices } = makeTetrahedron();
    for (let i = 0; i < level; i++) {
      ({ positions, indices } = subdivideOnce(positions, indices));
    }

    const posData = new Float32Array(flatten(positions));
    const idxData = new Uint32Array(indices);

    posBuffer = device.createBuffer({
      size: posData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    indexBuffer = device.createBuffer({
      size: idxData.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
    });

    device.queue.writeBuffer(posBuffer, 0, posData);
    device.queue.writeBuffer(indexBuffer, 0, idxData);
    indexCount = idxData.length;
  }

  // ---------- UI ----------
  let level = 0;
  const label = document.getElementById("level");
  const inc = document.getElementById("subInc");
  const dec = document.getElementById("subDec");

  function setLevel(l) {
    level = Math.max(0, l);
    label.textContent = `Level: ${level}`;
    buildSphere(level);
  }

  inc.onclick = () => setLevel(level + 1);
  dec.onclick = () => setLevel(level - 1);

  setLevel(0);

  // ---------- Animation (orbit camera) ----------
  let angle = 0;
  const radius = 3.0;

  function updateMVP() {
    const aspect = canvas.width / canvas.height;
    const P = perspective(45, aspect, 0.1, 10);

    angle += 0.01;
    const eye = vec3(radius * Math.sin(angle), 0.0, radius * Math.cos(angle));
    const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));

    const M = mat4();
    const MVP = mult(P, mult(V, M));
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(flatten(MVP)));
  }

  // ---------- Render loop ----------
  function frame() {
    ensureDepth();
    updateMVP();

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1 }
      }],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthLoadOp: "clear",
        depthClearValue: 1.0,
        depthStoreOp: "store"
      }
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, posBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.drawIndexed(indexCount);

    pass.end();
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
