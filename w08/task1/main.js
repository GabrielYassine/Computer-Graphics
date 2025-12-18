"use strict";

window.onload = () => main();

function f32(a){ return new Float32Array(a); }
function u32(a){ return new Uint32Array(a); }

function makePV(canvas){
  const A = canvas.width / canvas.height;
  const P = perspective(50, A, 0.1, 100);
  const eye = vec3(0, 0, 1.5);
  const at  = vec3(0, 0, -3);
  const up  = vec3(0, 1, 0);
  const V   = lookAt(eye, at, up);
  return { P, V };
}

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

function makeVBuf(device, data){
  const b = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(b, 0, data);
  return b;
}
function makeIBuf(device, data){
  const b = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(b, 0, data);
  return b;
}

async function main(){
  if(!("gpu" in navigator)) { alert("WebGPU not supported"); return; }

  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const canvas = document.getElementById("gpu-canvas");
  const ctx    = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });

  const shader = device.createShaderModule({ code: await (await fetch("shader.wgsl")).text() });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shader, entryPoint: "vs_main",
      buffers: [
        { arrayStride: 3*4, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
        { arrayStride: 2*4, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }] },
      ],
    },
    fragment: { module: shader, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });

  const groundPos = f32([
    -2,-1,-1,   2,-1,-1,   2,-1,-5,  -2,-1,-5
  ]);
  const groundUV = f32([
    0,0,  1,0,  1,1,  0,1
  ]);
  const quadIdx = u32([0,1,2, 0,2,3]);

  const aPos = f32([
    0.25,-0.5,-1.25,  0.75,-0.5,-1.25,  0.75,-0.5,-1.75,  0.25,-0.5,-1.75
  ]);
  const aUV = f32([ 0,0, 1,0, 1,1, 0,1 ]);

  const bPos = f32([
    -1,-1,-2.5,  -1,-1,-3.0,  -1,0,-3.0,  -1,0,-2.5
  ]);
  const bUV = f32([ 0,0, 1,0, 1,1, 0,1 ]);

  const gPosBuf = makeVBuf(device, groundPos);
  const gUVBuf  = makeVBuf(device, groundUV);
  const gIdxBuf = makeIBuf(device, quadIdx);

  const aPosBuf = makeVBuf(device, aPos);
  const aUVBuf  = makeVBuf(device, aUV);
  const aIdxBuf = makeIBuf(device, quadIdx);

  const bPosBuf = makeVBuf(device, bPos);
  const bUVBuf  = makeVBuf(device, bUV);
  const bIdxBuf = makeIBuf(device, quadIdx);

  const marble = await loadImageData("../../models-images/xamp23.png");
  const texGround = device.createTexture({
    size: [marble.w, marble.h, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  });
  device.queue.writeTexture(
    { texture: texGround },
    marble.data,
    { bytesPerRow: marble.w * 4 },
    [marble.w, marble.h, 1]
  );

  const texRed = device.createTexture({
    size: [1,1,1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  });
  device.queue.writeTexture(
    { texture: texRed },
    new Uint8Array([255,0,0,255]),
    { bytesPerRow: 4 },
    [1,1,1]
  );

  const sampler = device.createSampler({
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    minFilter: "linear",
    magFilter: "linear"
  });

  const uGround = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uRed    = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const bgGround = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uGround } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texGround.createView() }
    ]
  });

  const bgRed = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uRed } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texRed.createView() }
    ]
  });

  const depthTex = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT
  });

  function frame(){
    const { P, V } = makePV(canvas);
    const M = mat4();
    const MVP = mult(P, mult(V, M));

    device.queue.writeBuffer(uGround, 0, new Float32Array(flatten(MVP)));
    device.queue.writeBuffer(uRed,    0, new Float32Array(flatten(MVP)));

    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 1, g: 1, b: 1, a: 1 }
      }],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthLoadOp: "clear",
        depthClearValue: 1.0,
        depthStoreOp: "store"
      }
    });

    pass.setPipeline(pipeline);

    pass.setBindGroup(0, bgGround);
    pass.setVertexBuffer(0, gPosBuf);
    pass.setVertexBuffer(1, gUVBuf);
    pass.setIndexBuffer(gIdxBuf, "uint32");
    pass.drawIndexed(6);

    pass.setBindGroup(0, bgRed);

    pass.setVertexBuffer(0, aPosBuf);
    pass.setVertexBuffer(1, aUVBuf);
    pass.setIndexBuffer(aIdxBuf, "uint32");
    pass.drawIndexed(6);

    pass.setVertexBuffer(0, bPosBuf);
    pass.setVertexBuffer(1, bUVBuf);
    pass.setIndexBuffer(bIdxBuf, "uint32");
    pass.drawIndexed(6);

    pass.end();
    device.queue.submit([enc.finish()]);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
