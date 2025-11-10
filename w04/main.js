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

  const vtxLayout = [
    { arrayStride: 3 * 4, attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }] },
  ];

  const shaderCode = await (await fetch("shader.wgsl")).text();
  const shaderModule = device.createShaderModule({ code: shaderCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shaderModule, entryPoint: "main_vs", buffers: vtxLayout },
    fragment: { module: shaderModule, entryPoint: "main_fs", targets: [{ format }] },
    primitive: {
      topology: "triangle-list",
      frontFace: "ccw",
      cullMode: "back",
    },
    multisample: { count: 4 },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: "less",
      format: "depth24plus",
    },
  });

  const UNIFORM_BYTES = 192;
  const uniformBuffer = device.createBuffer({
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  let P = perspective(45, canvas.width / canvas.height, 0.1, 10.0);

  function writeUniforms(V, eye, params) {
    const M = mat4();
    const MVP = mult(P, mult(V, M));

    const arr = [];
    arr.push(...flatten(MVP));
    arr.push(eye[0], eye[1], eye[2], 0.0);
    const wi = [0.0, 0.0, 1.0];
    arr.push(wi[0], wi[1], wi[2], 0.0);
    arr.push(params.kd[0], params.kd[1], params.kd[2], params.kdScale);
    arr.push(params.ks[0], params.ks[1], params.ks[2], params.ksScale);
    arr.push(params.Le[0], params.Le[1], params.Le[2], params.LeScale);
    arr.push(params.La[0], params.La[1], params.La[2], params.LaScale);
    arr.push(params.shininess, 0.0, 0.0, 0.0);
    while (arr.length < 48) arr.push(0.0);

    const f32 = new Float32Array(arr);
    device.queue.writeBuffer(uniformBuffer, 0, f32);
  }

  let posBuffer = null;
  let indexBuffer = null;
  let indexCount = 0;
  let msTex = null;
  let depthTex = null;

  function makeTetrahedron() {
    const M_SQRT2 = Math.sqrt(2.0);
    const M_SQRT6 = Math.sqrt(6.0);
    const positions = [
      vec3(0.0, 0.0, 1.0),
      vec3(0.0, (2.0 * M_SQRT2) / 3.0, -1.0 / 3.0),
      vec3(-M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
      vec3(M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
    ];
    const indices = [
      0, 1, 2,
      0, 3, 1,
      1, 3, 2,
      0, 2, 3,
    ];
    return { positions, indices };
  }

  function subdivideOnce(positions, indices) {
    const newPos = positions.map(p => vec3(p[0], p[1], p[2]));
    const newIdx = [];

    for (let t = 0; t < indices.length; t += 3) {
      const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
      const a = positions[i0], b = positions[i1], c = positions[i2];

      const ab = normalize(mix(a, b, 0.5));
      const bc = normalize(mix(b, c, 0.5));
      const ca = normalize(mix(c, a, 0.5));

      const iAB = newPos.push(ab) - 1;
      const iBC = newPos.push(bc) - 1;
      const iCA = newPos.push(ca) - 1;

      newIdx.push(
        i0, iAB, iCA,
        i1, iBC, iAB,
        i2, iCA, iBC,
        iAB, iBC, iCA
      );
    }

    return { positions: newPos, indices: newIdx };
  }

  function buildSphere(subdivLevel) {
    let { positions, indices } = makeTetrahedron();
    for (let i = 0; i < subdivLevel; ++i) {
      ({ positions, indices } = subdivideOnce(positions, indices));
    }

    const posFlat = new Float32Array(flatten(positions));
    const idxArr = new Uint32Array(indices);

    if (posBuffer) posBuffer.destroy();
    if (indexBuffer) indexBuffer.destroy();

    posBuffer = device.createBuffer({ size: posFlat.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    indexBuffer = device.createBuffer({ size: idxArr.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });

    device.queue.writeBuffer(posBuffer, 0, posFlat);
    device.queue.writeBuffer(indexBuffer, 0, idxArr);
    indexCount = idxArr.length;
  }

  function ensureTargets() {
    if (!msTex || msTex.width !== canvas.width || msTex.height !== canvas.height) {
      if (msTex) msTex.destroy();
      msTex = device.createTexture({
        size: [canvas.width, canvas.height],
        format: format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        sampleCount: 4,
      });
    }
    if (!depthTex || depthTex.width !== canvas.width || depthTex.height !== canvas.height) {
      if (depthTex) depthTex.destroy();
      depthTex = device.createTexture({
        size: [canvas.width, canvas.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        sampleCount: 4,
      });
    }
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

  function bindSlider(id, idVal, onChange) {
    const el = document.getElementById(id);
    const lab = document.getElementById(idVal);
    const update = () => { lab.textContent = el.value; onChange(parseFloat(el.value)); };
    el.addEventListener("input", update);
    update();
  }

  const params = {
    kd: [1.0, 1.0, 1.0],
    ks: [1.0, 1.0, 1.0],
    kdScale: 1.0,
    ksScale: 0.3,
    shininess: 32.0,
    Le: [1.0, 1.0, 1.0],
    La: [1.0, 1.0, 1.0],
    LeScale: 1.0,
    LaScale: 0.05,
  };

  bindSlider("kd", "kdVal", v => params.kdScale = v);
  bindSlider("ks", "ksVal", v => params.ksScale = v);
  bindSlider("shin", "shinVal", v => params.shininess = v);
  bindSlider("Le", "LeVal", v => params.LeScale = v);
  bindSlider("La", "LaVal", v => params.LaScale = v);

  setLevel(0);

  let angle = 0;
  const radius = 3.0;
  function renderLoop() {
    ensureTargets();

    if (orbit) angle += 0.01;

    const eye = vec3(radius * Math.sin(angle), 0.0, radius * Math.cos(angle));
    const target = vec3(0, 0, 0);
    const up = vec3(0, 1, 0);
    const V = lookAt(eye, target, up);

    writeUniforms(V, eye, params);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: msTex.createView(),
        resolveTarget: context.getCurrentTexture().createView(),
        loadOp: "clear",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1 },
        storeOp: "store",
      }],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthLoadOp: "clear",
        depthClearValue: 1.0,
        depthStoreOp: "store",
      },
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, posBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.setBindGroup(0, bindGroup);
    pass.drawIndexed(indexCount, 1);
    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(renderLoop);
  }

  requestAnimationFrame(renderLoop);
}
