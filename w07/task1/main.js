"use strict";

window.onload = () => main();

const f32 = a => new Float32Array(a);
const u32 = a => new Uint32Array(a);

function createSphere(latBands, lonBands, r = 1.6) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (let lat = 0; lat <= latBands; lat++) {
    const t = lat * Math.PI / latBands;
    const st = Math.sin(t);
    const ct = Math.cos(t);

    for (let lon = 0; lon <= lonBands; lon++) {
      const p = lon * 2 * Math.PI / lonBands;
      const cp = Math.cos(p);
      const sp = Math.sin(p);

      const x = cp * st;
      const y = ct;
      const z = sp * st;

      positions.push(r * x, r * y, r * z, 1);
      normals.push(x, y, z, 0);
    }
  }

  const stride = lonBands + 1;
  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const a = lat * stride + lon;
      const b = a + stride;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  return {
    positions: f32(positions),
    normals: f32(normals),
    indices: u32(indices)
  };
}

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

async function main() {
  const canvas = document.getElementById("my-canvas");

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const shaderCode = await (await fetch("shader.wgsl")).text();
  const shaderModule = device.createShaderModule({ code: shaderCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [
        { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] },
        { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }] }
      ]
    },
    fragment: {
      module: shaderModule,
      entryPoint: "main_fs",
      targets: [{ format }]
    },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }
  });

  const sphere = createSphere(64, 64, 1.6);

  const posBuf = device.createBuffer({ size: sphere.positions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const nrmBuf = device.createBuffer({ size: sphere.normals.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const idxBuf = device.createBuffer({ size: sphere.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });

  device.queue.writeBuffer(posBuf, 0, sphere.positions);
  device.queue.writeBuffer(nrmBuf, 0, sphere.normals);
  device.queue.writeBuffer(idxBuf, 0, sphere.indices);

  const faces = [
    "../../models-images/textures/cm_left.png",
    "../../models-images/textures/cm_right.png",
    "../../models-images/textures/cm_bottom.png",
    "../../models-images/textures/cm_top.png",
    "../../models-images/textures/cm_back.png",
    "../../models-images/textures/cm_front.png"
  ];

  const imgs = await Promise.all(faces.map(loadImage));
  const bitmaps = await Promise.all(imgs.map(img => createImageBitmap(img)));

  const w = bitmaps[0].width;
  const h = bitmaps[0].height;

  const cube = device.createTexture({
    size: [w, h, 6],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });


  for (let i = 0; i < 6; i++) {
    device.queue.copyExternalImageToTexture(
      { source: bitmaps[i] },
      { texture: cube, origin: { x: 0, y: 0, z: i } },
      [w, h]
    );
  }

  const sampler = device.createSampler({
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    addressModeW: "clamp-to-edge",
    magFilter: "linear",
    minFilter: "linear"
  });

  const uniformBuffer = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: cube.createView({ dimension: "cube" }) }
    ]
  });

  const depthTex = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT
  });

  const OPENGL_TO_WGPU = mat4(
    vec4(1, 0, 0, 0),
    vec4(0, 1, 0, 0),
    vec4(0, 0, 0.5, 0.5),
    vec4(0, 0, 0, 1)
  );
  let angle = 0;

  function render() {
    angle += 0.01;

    const eye = vec3(5 * Math.sin(angle), 0, 5 * Math.cos(angle));
    const at = vec3(0, 0, 0);
    const up = vec3(0, 1, 0);

    const V = lookAt(eye, at, up);
    const P = perspective(45, canvas.width / canvas.height, 0.1, 100.0);
    const model = mat4();

    const mvp = mult(OPENGL_TO_WGPU, mult(P, mult(V, model)));

    const U = new Float32Array(64);
    U.set(new Float32Array(flatten(mvp)), 0);
    U.set(new Float32Array(flatten(model)), 16);
    device.queue.writeBuffer(uniformBuffer, 0, U);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }
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
    pass.setVertexBuffer(0, posBuf);
    pass.setVertexBuffer(1, nrmBuf);
    pass.setIndexBuffer(idxBuf, "uint32");
    pass.drawIndexed(sphere.indices.length);
    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}