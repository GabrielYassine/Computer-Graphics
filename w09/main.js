"use strict";

window.onload = () => main();

function f32(a){ return new Float32Array(a); }
function u32(a){ return new Uint32Array(a); }

// -------- Camera (same as before) --------
function makePV(canvas){
  const A = canvas.width / canvas.height;
  const P = perspective(50, A, 0.1, 100);
  const eye = vec3(0, 1.0, 3.0);
  const at  = vec3(0, -0.5, -3.0);
  const up  = vec3(0, 1, 0);
  const V   = lookAt(eye, at, up);
  return { P, V, eye };
}

function mul4(a,b){ return mult(a,b); }

// -------- Image loader --------
async function loadImageData(url){
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = img.width, h = img.height;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const g = cv.getContext("2d");
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, w, h);
  return { w, h, data };
}

async function main(){
  if (!("gpu" in navigator)) { alert("WebGPU not supported"); return; }

  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const canvas = document.getElementById("gpu-canvas");
  const ctx    = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });

  const bounceToggle = document.getElementById("bounceToggle");
  const lightToggle  = document.getElementById("lightToggle");

  // ---------- Ground geometry ----------
  const groundPos = f32([
    -2, -1, -1,
     2, -1, -1,
     2, -1, -5,
    -2, -1, -5,
  ]);
  const groundUV  = f32([ 0,0,  1,0,  1,1,  0,1 ]);
  const groundIdx = u32([ 0,1,2,  0,2,3 ]);

  const makeVBuf = (data) => {
    const buf = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(buf, 0, data);
    return buf;
  };
  const makeIBuf = (data) => {
    const buf = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(buf, 0, data);
    return buf;
  };

  const gPosBuf = makeVBuf(groundPos);
  const gUVBuf  = makeVBuf(groundUV);
  const gIdxBuf = makeIBuf(groundIdx);

  // ---------- Ground texture ----------
  const img = await loadImageData("xamp23.png");
  const texGround = device.createTexture({
    size: [img.w, img.h],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  });
  device.queue.writeTexture(
    { texture: texGround },
    img.data,
    { bytesPerRow: img.w * 4 },
    [img.w, img.h, 1]
  );

  const sampler = device.createSampler({
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    minFilter: "linear",
    magFilter: "linear"
  });

  // ---------- Load teapot OBJ ----------
  const teapotInfo = await readOBJFile("teapot.obj", 1.0, false);
  if (!teapotInfo) {
    alert("Failed to load teapot.obj");
    return;
  }

  const tPos = f32(teapotInfo.vertices);
  const tNrm = f32(teapotInfo.normals);
  const tCol = f32(teapotInfo.colors);
  const tIdx = u32(teapotInfo.indices);

  const tPosBuf = makeVBuf(tPos);
  const tNrmBuf = makeVBuf(tNrm);
  const tColBuf = makeVBuf(tCol);
  const tIdxBuf = makeIBuf(tIdx);

  // ---------- Shadow map texture ----------
  const SHADOW_SIZE = 1024;
  const shadowTex = device.createTexture({
    size: [SHADOW_SIZE, SHADOW_SIZE],
    format: "rgba16float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  });
  const shadowView = shadowTex.createView();
  const shadowSampler = device.createSampler({
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    minFilter: "linear",
    magFilter: "linear"
  });

  // ---------- Shaders & pipelines ----------
  const wgslSource = await (await fetch("shader.wgsl")).text();
  const shaderModule = device.createShaderModule({ code: wgslSource });

  // Ground pipeline (camera + shadow sampling)
  const pipelineGround = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_ground",
      buffers: [
        { arrayStride: 3*4, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
        { arrayStride: 2*4, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }] },
      ]
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_ground",
      targets: [{ format }]
    },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less"
    }
  });

  // Teapot pipeline (lit)
  const pipelineTeapot = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_teapot",
      buffers: [
        { arrayStride: 4*4, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] },
        { arrayStride: 4*4, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }] },
        { arrayStride: 4*4, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x4" }] },
      ]
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_teapot",
      targets: [{ format }]
    },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less"
    }
  });

  // Shadow pipeline (render from light into shadowTex)
  const pipelineShadow = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_shadow",
      buffers: [
        { arrayStride: 4*4, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] },
      ]
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_shadow",
      targets: [{ format: "rgba16float" }]
    },
    primitive: { topology: "triangle-list", cullMode: "back" },
    // no depth buffer in light pass to keep things simple
  });

  // ---------- Uniform buffers & bind groups ----------

  // Ground: cameraMVP + lightVP => 2 * mat4 = 128 bytes
  const gUBuf = device.createBuffer({
    size: 128,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const gBind = device.createBindGroup({
    layout: pipelineGround.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: gUBuf } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texGround.createView() },
      { binding: 3, resource: shadowView },
      { binding: 4, resource: shadowSampler },
    ]
  });

  // Teapot: cameraMVP + model + lightPos + viewPos
  const tUBuf = device.createBuffer({
    size: 224, // 3 mat4 + 2 vec4 (but WGSL struct only uses first 2 mat4 + 2 vec4)
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const tBind = device.createBindGroup({
    layout: pipelineTeapot.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: { buffer: tUBuf } }
    ]
  });

  // Shadow: lightMVP
  const sUBuf = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const sBind = device.createBindGroup({
    layout: pipelineShadow.getBindGroupLayout(2),
    entries: [
      { binding: 0, resource: { buffer: sUBuf } }
    ]
  });

  // Depth texture for main pass
  let depthTex = null;
  function ensureDepth(){
    if (!depthTex ||
        depthTex.width !== canvas.width ||
        depthTex.height !== canvas.height) {
      depthTex?.destroy?.();
      depthTex = device.createTexture({
        size: [canvas.width, canvas.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT
      });
    }
  }

  // ---------- Animation state ----------
  let tLight = 0;
  let tTeapot = 0;
  const clearColor = { r: 1, g: 1, b: 1, a: 1 };

  function frame(){
    ensureDepth();

    if (lightToggle.checked) tLight  += 0.02;
    if (bounceToggle.checked) tTeapot += 0.02;

    const { P, V, eye } = makePV(canvas);

    // Light moves in circle around center (0, -0.5, -3)
    const lightCenter = vec3(0, -0.5, -3);
    const lightPos = vec3(
      lightCenter[0] + 3 * Math.cos(tLight),
      lightCenter[1] + 3,
      lightCenter[2] + 3 * Math.sin(tLight)
    );

    const lightView = lookAt(lightPos, lightCenter, vec3(0,1,0));
    const lightProj = perspective(60, 1.0, 0.5, 20.0);
    const lightVP   = mul4(lightProj, lightView);

    // Ground UBO: cameraMVP + lightVP
    const M_ground = mat4();
    const MVP_ground = mul4(P, mul4(V, M_ground));

    const groundFloats = new Float32Array(32);
    groundFloats.set(new Float32Array(flatten(MVP_ground)), 0);
    groundFloats.set(new Float32Array(flatten(lightVP)), 16);
    device.queue.writeBuffer(gUBuf, 0, groundFloats);

    // Teapot model transform
    const S = scalem(0.25, 0.25, 0.25);

    let yOffset = 0.0;
    if (bounceToggle.checked) {
      yOffset = 0.5 * Math.sin(tTeapot);
    }
    const baseT   = translate(0, -0.5, -3);
    const bounceT = translate(0, yOffset, 0);

    const M_teapot = mult(bounceT, mult(baseT, S));
    const MVP_teapot = mul4(P, mul4(V, M_teapot));

    // Teapot UBO (cameraMVP, model, lightPos, viewPos)
    const tFloats = new Float32Array(40);
    tFloats.set(new Float32Array(flatten(MVP_teapot)), 0);
    tFloats.set(new Float32Array(flatten(M_teapot)), 16);
    tFloats.set(new Float32Array([lightPos[0], lightPos[1], lightPos[2], 1.0]), 32);
    tFloats.set(new Float32Array([eye[0], eye[1], eye[2], 1.0]), 36);
    device.queue.writeBuffer(tUBuf, 0, tFloats);

    // Shadow UBO: lightMVP for teapot
    const lightMVP_teapot = mul4(lightVP, M_teapot);
    device.queue.writeBuffer(sUBuf, 0, new Float32Array(flatten(lightMVP_teapot)));

    // ---------- Encode commands ----------
    const encoder = device.createCommandEncoder();

    // (1) Shadow pass – render teapot from light into shadowTex
    const passShadow = encoder.beginRenderPass({
      colorAttachments: [{
        view: shadowView,
        loadOp: "clear",
        clearValue: { r: 1, g: 1, b: 1, a: 1 },
        storeOp: "store"
      }]
    });
    passShadow.setPipeline(pipelineShadow);
    passShadow.setBindGroup(2, sBind);
    passShadow.setVertexBuffer(0, tPosBuf);
    passShadow.setIndexBuffer(tIdxBuf, "uint32");
    passShadow.drawIndexed(tIdx.length);
    passShadow.end();

    // (2) Main camera pass
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: "clear",
        clearValue: clearColor,
        storeOp: "store"
      }],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthLoadOp: "clear",
        depthClearValue: 1,
        depthStoreOp: "store"
      }
    });

    // ground + shadowed lighting
    pass.setPipeline(pipelineGround);
    pass.setBindGroup(0, gBind);
    pass.setVertexBuffer(0, gPosBuf);
    pass.setVertexBuffer(1, gUVBuf);
    pass.setIndexBuffer(gIdxBuf, "uint32");
    pass.drawIndexed(groundIdx.length);

    // lit teapot
    pass.setPipeline(pipelineTeapot);
    pass.setBindGroup(1, tBind);
    pass.setVertexBuffer(0, tPosBuf);
    pass.setVertexBuffer(1, tNrmBuf);
    pass.setVertexBuffer(2, tColBuf);
    pass.setIndexBuffer(tIdxBuf, "uint32");
    pass.drawIndexed(tIdx.length);

    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
