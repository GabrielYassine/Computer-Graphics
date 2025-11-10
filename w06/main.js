"use strict";

// ---------- helpers ----------
function fail(msg){ throw new Error(msg); }
function f32(a){ return new Float32Array(a); }
function u32(a){ return new Uint32Array(a); }

// Perspective(90°), default view (identity), rectangle is already at y = -1 in world space
function makeMVP(canvas){
  const A = canvas.width / canvas.height;
  const P = perspective(90, A, 0.1, 100); // 90° FOV
  const V = mat4();                       // identity view
  const M = mat4();                       // no model transform
  return mult(P, mult(V, M));
}

// Build a 64x64 RGBA checkerboard with 8x8 tiles (black/white), Uint8 RGBA
function makeCheckerboard(size=64, tiles=8){
  const data = new Uint8Array(size*size*4);
  const step = size / tiles;
  for(let y=0; y<size; ++y){
    for(let x=0; x<size; ++x){
      const ix = Math.floor(x/step);
      const iy = Math.floor(y/step);
      const c  = ((ix ^ iy) & 1) ? 255 : 0; // alternating
      const i4 = 4*(y*size + x);
      data[i4+0] = data[i4+1] = data[i4+2] = c;
      data[i4+3] = 255;
    }
  }
  return data;
}

window.addEventListener('load', async () => {
  // --- WebGPU setup ---
  if (!('gpu' in navigator)) fail('WebGPU not supported');
  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const canvas  = document.getElementById('gpu-canvas');
  const ctx     = canvas.getContext('webgpu');
  const format  = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format });

  // --- Geometry: the required rectangle as two triangles ---
  // Vertices: (-4,-1,-1), (4,-1,-1), (4,-1,-21), (-4,-1,-21)
  const positions = f32([
    -4,-1,-1,   4,-1,-1,   4,-1,-21,   -4,-1,-21
  ]);
  // Texture coordinates: (-1.5,0), (2.5,0), (2.5,10), (-1.5,10)
  // This repeats 4 times across width and 10 times along length (with repeat wrapping).
  const uvs = f32([
    -1.5, 0.0,   2.5, 0.0,   2.5,10.0,  -1.5,10.0
  ]);
  const indices = u32([ 0,1,2,   0,2,3 ]);

  const posBuf = device.createBuffer({ size: positions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const uvBuf  = device.createBuffer({ size: uvs.byteLength,       usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const idxBuf = device.createBuffer({ size: indices.byteLength,   usage: GPUBufferUsage.INDEX  | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(posBuf, 0, positions);
  device.queue.writeBuffer(uvBuf,  0, uvs);
  device.queue.writeBuffer(idxBuf, 0, indices);

  // --- Texture: 64x64 checkerboard (RGBA8) ---
  const texSize = 64;
  const texels  = makeCheckerboard(64, 8);
  const texture = device.createTexture({
    format: "rgba8unorm",
    size:   [texSize, texSize, 1],
    usage:  GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING
  });
  device.queue.writeTexture(
    { texture },
    texels,
    { offset: 0, bytesPerRow: texSize * 4, rowsPerImage: texSize },
    [texSize, texSize, 1]
  );

  // Sampler: repeat address, nearest filtering (per W06P1)
  const sampler = device.createSampler({
    addressModeU: "repeat",
    addressModeV: "repeat",
    magFilter: "nearest",
    minFilter: "nearest",
    mipmapFilter: "nearest", // only one level at P1, but set to nearest anyway
  });

  // --- Pipeline & uniforms ---
  const shader = device.createShaderModule({ code: await (await fetch('shader.wgsl')).text() });

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shader, entryPoint: 'vs_main',
      buffers: [
        { arrayStride: 3*4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
        { arrayStride: 2*4, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
      ]
    },
    fragment: {
      module: shader, entryPoint: 'fs_main',
      targets: [{ format }]
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: undefined
  });

  // MVP only (mat4) → 64 bytes
  const uSize = 16*4;
  const uBuf  = device.createBuffer({ size: uSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uBuf } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texture.createView() },
    ],
  });

  // --- Render loop ---
  const bg = { r: 0.3921, g: 0.5843, b: 0.9294, a: 1 }; // cornflower blue background

  function frame(){
    const mvp = makeMVP(canvas);
    device.queue.writeBuffer(uBuf, 0, new Float32Array(flatten(mvp)));

    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear',
        clearValue: bg,
        storeOp: 'store',
      }]
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, posBuf);
    pass.setVertexBuffer(1, uvBuf);
    pass.setIndexBuffer(idxBuf, 'uint32');
    pass.setBindGroup(0, bindGroup);
    pass.drawIndexed(6);
    pass.end();

    device.queue.submit([enc.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
});
