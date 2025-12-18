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

  const shaderCode = await (await fetch("shader.wgsl")).text();
  const shaderModule = device.createShaderModule({ code: shaderCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [{ arrayStride: 3 * 4, attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }] }]
    },
    fragment: { module: shaderModule, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: "back" },
    depthStencil: { depthWriteEnabled: true, depthCompare: "less", format: "depth24plus" }
  });

  const uniformBuffer = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });

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

  let posBuffer = null;
  let indexBuffer = null;
  let indexCount = 0;

  function makeTetrahedron() {
    const s2 = Math.sqrt(2.0);
    const s6 = Math.sqrt(6.0);
    return {
      positions: [
        vec3(0.0, 0.0, 1.0),
        vec3(0.0, (2.0 * s2) / 3.0, -1.0 / 3.0),
        vec3(-s6 / 3.0, -s2 / 3.0, -1.0 / 3.0),
        vec3(s6 / 3.0, -s2 / 3.0, -1.0 / 3.0),
      ],
      indices: [0, 1, 2, 0, 3, 1, 1, 3, 2, 0, 2, 3]
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
    for (let i = 0; i < level; i++) ({ positions, indices } = subdivideOnce(positions, indices));

    const posFlat = new Float32Array(flatten(positions));
    const idxArr = new Uint32Array(indices);

    posBuffer = device.createBuffer({ size: posFlat.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    indexBuffer = device.createBuffer({ size: idxArr.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });

    device.queue.writeBuffer(posBuffer, 0, posFlat);
    device.queue.writeBuffer(indexBuffer, 0, idxArr);
    indexCount = idxArr.length;
  }

  const subInc = document.getElementById("subInc");
  const subDec = document.getElementById("subDec");
  const levelLabel = document.getElementById("level");
  const orbitToggle = document.getElementById("orbitToggle");

  let level = 0;
  let orbit = true;

  orbitToggle.addEventListener("change", (e) => { orbit = e.target.checked; });

  function setLevel(newLevel) {
    level = Math.max(0, newLevel);
    levelLabel.textContent = `Level: ${level}`;
    buildSphere(level);
  }

  subInc.addEventListener("click", () => setLevel(level + 1));
  subDec.addEventListener("click", () => setLevel(level - 1));

  const params = { kd: 1.0, ks: 0.3, shin: 32.0, Le: 1.0, La: 0.05 };

  function bindSlider(id, idVal, onChange) {
    const el = document.getElementById(id);
    const lab = document.getElementById(idVal);
    const update = () => { lab.textContent = el.value; onChange(parseFloat(el.value)); };
    el.addEventListener("input", update);
    update();
  }

  bindSlider("kd", "kdVal", v => params.kd = v);
  bindSlider("ks", "ksVal", v => params.ks = v);
  bindSlider("shin", "shinVal", v => params.shin = v);
  bindSlider("Le", "LeVal", v => params.Le = v);
  bindSlider("La", "LaVal", v => params.La = v);

  setLevel(0);

  let angle = 0;
  const radius = 3.0;

  function writeUniforms(mvp, eye) {
    const arr = new Float32Array(28);
    arr.set(new Float32Array(flatten(mvp)), 0);
    arr.set(new Float32Array([eye[0], eye[1], eye[2], 1.0]), 16);
    arr.set(new Float32Array([params.kd, params.ks, params.Le, params.La]), 20);
    arr.set(new Float32Array([params.shin, 0.0, 0.0, 0.0]), 24);
    device.queue.writeBuffer(uniformBuffer, 0, arr);
  }

  function frame() {
    ensureDepth();

    if (orbit) angle += 0.01;

    const eye = vec3(radius * Math.sin(angle), 0.0, radius * Math.cos(angle));
    const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
    const P = perspective(45, canvas.width / canvas.height, 0.1, 10.0);
    const MVP = mult(P, V);

    writeUniforms(MVP, eye);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1 },
        storeOp: "store"
      }],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthLoadOp: "clear",
        depthClearValue: 1.0,
        depthStoreOp: "store"
      }
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, posBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.setBindGroup(0, bindGroup);
    pass.drawIndexed(indexCount);
    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
