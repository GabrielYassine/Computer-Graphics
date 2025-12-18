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

function mat4Identity() {
  return mat4(
    vec4(1,0,0,0),
    vec4(0,1,0,0),
    vec4(0,0,1,0),
    vec4(0,0,0,1)
  );
}

function buildMtex(P_wgpu, V) {
  const invP = inverse(P_wgpu);
  let worldFromCam = inverse(V);
  worldFromCam[3] = vec4(0,0,0,1);
  return mult(worldFromCam, invP);
}

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
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

  const sPosBuf = device.createBuffer({ size: sphere.positions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const sNrmBuf = device.createBuffer({ size: sphere.normals.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const sIdxBuf = device.createBuffer({ size: sphere.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });

  device.queue.writeBuffer(sPosBuf, 0, sphere.positions);
  device.queue.writeBuffer(sNrmBuf, 0, sphere.normals);
  device.queue.writeBuffer(sIdxBuf, 0, sphere.indices);

  const zClip = 0.999;
  const qPos = f32([
    -1, -1, zClip, 1,
     1, -1, zClip, 1,
     1,  1, zClip, 1,
    -1,  1, zClip, 1
  ]);
  const qNrm = f32([0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0]);
  const qIdx = u32([0, 1, 2, 0, 2, 3]);

  const qPosBuf = device.createBuffer({ size: qPos.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const qNrmBuf = device.createBuffer({ size: qNrm.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const qIdxBuf = device.createBuffer({ size: qIdx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });

  device.queue.writeBuffer(qPosBuf, 0, qPos);
  device.queue.writeBuffer(qNrmBuf, 0, qNrm);
  device.queue.writeBuffer(qIdxBuf, 0, qIdx);

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

  const uBufBG = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const uBufSphere = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const cubeView = cube.createView({ dimension: "cube" });

  const bindGroupBG = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uBufBG } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: cubeView }
    ]
  });

  const bindGroupSphere = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uBufSphere } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: cubeView }
    ]
  });

  const depthTex = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT
  });

  const OPENGL_TO_WGPU = mat4(
    vec4(1,0,0,0),
    vec4(0,1,0,0),
    vec4(0,0,0.5,0.5),
    vec4(0,0,0,1)
  );

  function writeUBO(buf, mvp, mtex, model, isBG) {
    const f = new Float32Array(16 + 16 + 16);
    f.set(new Float32Array(flatten(mvp)), 0);
    f.set(new Float32Array(flatten(mtex)), 16);
    f.set(new Float32Array(flatten(model)), 32);
    device.queue.writeBuffer(buf, 0, f);

    const flags = new Uint32Array([isBG ? 1 : 0, 0, 0, 0]);
    device.queue.writeBuffer(buf, (16 + 16 + 16) * 4, flags);
  }

  let angle = 0;

  function frame() {
    angle += 0.01;

    const eye = vec3(8 * Math.sin(angle), 0, 8 * Math.cos(angle));
    const at = vec3(0, 0, 0);
    const up = vec3(0, 1, 0);

    const V = lookAt(eye, at, up);
    const P_gl = perspective(45, canvas.width / canvas.height, 0.1, 100.0);
    const P_wgpu = mult(OPENGL_TO_WGPU, P_gl);

    const model = mat4Identity();

    const MVP_sphere = mult(P_wgpu, mult(V, model));
    const Mtex_sphere = mat4Identity();

    const MVP_bg = mat4Identity();
    const Mtex_bg = buildMtex(P_wgpu, V);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 1 }
      }],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthLoadOp: "clear",
        depthClearValue: 1.0,
        depthStoreOp: "store"
      }
    });

    pass.setPipeline(pipeline);

    writeUBO(uBufBG, MVP_bg, Mtex_bg, model, true);
    pass.setBindGroup(0, bindGroupBG);
    pass.setVertexBuffer(0, qPosBuf);
    pass.setVertexBuffer(1, qNrmBuf);
    pass.setIndexBuffer(qIdxBuf, "uint32");
    pass.drawIndexed(6);

    writeUBO(uBufSphere, MVP_sphere, Mtex_sphere, model, false);
    pass.setBindGroup(0, bindGroupSphere);
    pass.setVertexBuffer(0, sPosBuf);
    pass.setVertexBuffer(1, sNrmBuf);
    pass.setIndexBuffer(sIdxBuf, "uint32");
    pass.drawIndexed(sphere.indices.length);

    pass.end();
    device.queue.submit([encoder.finish()]);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
