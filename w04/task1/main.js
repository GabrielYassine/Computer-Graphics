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
    primitive: { topology: "triangle-list" }
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
      const a = positions[indices[i]];
      const b = positions[indices[i + 1]];
      const c = positions[indices[i + 2]];

      const ab = normalize(mix(a, b, 0.5));
      const bc = normalize(mix(b, c, 0.5));
      const ca = normalize(mix(c, a, 0.5));

      const iab = newPos.push(ab) - 1;
      const ibc = newPos.push(bc) - 1;
      const ica = newPos.push(ca) - 1;

      newIdx.push(
        indices[i], iab, ica,
        indices[i + 1], ibc, iab,
        indices[i + 2], ica, ibc,
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

  // ---------- Controls ----------
  let level = 0;
  const label = document.getElementById("level");
  const inc = document.getElementById("subInc");
  const dec = document.getElementById("subDec");

  function setLevel(l) {
    level = Math.max(0, l);
    label.textContent = `Level: ${level}`;
    buildSphere(level);
    render();
  }

  inc.onclick = () => setLevel(level + 1);
  dec.onclick = () => setLevel(level - 1);

  // ---------- MVP ----------
  const P = perspective(45, canvas.width / canvas.height, 0.1, 10);
  const V = lookAt(vec3(0, 0, 3), vec3(0, 0, 0), vec3(0, 1, 0));
  const M = mat4();
  const MVP = mult(P, mult(V, M));
  device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(flatten(MVP)));

  setLevel(0);

  function render() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1 }
      }]
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, posBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.drawIndexed(indexCount);

    pass.end();
    device.queue.submit([encoder.finish()]);
  }
}