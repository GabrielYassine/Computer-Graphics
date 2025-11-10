"use strict";

window.onload = () => main();

// ---------- math helpers ----------
const f32 = a => new Float32Array(a);
const u32 = a => new Uint32Array(a);

function makeMVP(canvas, yawDeg){
  const A = canvas.width / canvas.height;
  const P = perspective(60, A, 0.1, 200);
  const eye = vec3(0, 1.8, 5.5);
  const at  = vec3(0, 0, 0);
  const up  = vec3(0, 1, 0);
  const V   = lookAt(eye, at, up);
  const R   = rotateY(yawDeg);
  const M   = R; // turntable
  return mult(P, mult(V, M));
}

// ---------- sphere geometry ----------
function makeSphere(segments=48, rings=32, r=1.6){
  const pos = [], nrm = [], idx = [];
  for(let y=0;y<=rings;++y){
    const v = y/rings, th = v*Math.PI, ct=Math.cos(th), st=Math.sin(th);
    for(let x=0;x<=segments;++x){
      const u = x/segments, ph = u*2*Math.PI, cp=Math.cos(ph), sp=Math.sin(ph);
      const nx = cp*st, ny = ct, nz = sp*st;
      pos.push(r*nx, r*ny, r*nz);
      nrm.push(nx, ny, nz);
    }
  }
  const stride = segments+1;
  for(let y=0;y<rings;++y){
    for(let x=0;x<segments;++x){
      const i0 = y*stride+x, i1=i0+1, i2=i0+stride, i3=i2+1;
      idx.push(i0,i2,i1,  i1,i2,i3);
    }
  }
  return {pos:f32(pos), nrm:f32(nrm), idx:u32(idx)};
}

// ---------- image loading to RGBA8 ----------
async function loadImageData(url){
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = img.width, h = img.height;
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const g = cvs.getContext('2d');
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, w, h);
  return { w, h, data };
}

async function main() {
  const gpu = navigator.gpu;
  if (!gpu) { alert('WebGPU not supported'); return; }
  
  const adapter = await gpu.requestAdapter();
  if (!adapter) return;
  
  const device = await adapter.requestDevice();
  
  const canvas = document.getElementById('my-canvas');
  const orbit = document.getElementById('orbit');
  const context = canvas.getContext('webgpu');
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  // Handle device lost gracefully
  device.lost.then(info => {
    console.error('WebGPU device lost:', info);
    alert('WebGPU device lost. Reloading page...');
    location.reload();
  });

  // 1) Sphere buffers
  const sph = makeSphere();
  const posBuf = device.createBuffer({size:sph.pos.byteLength, usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const nrmBuf = device.createBuffer({size:sph.nrm.byteLength, usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const idxBuf = device.createBuffer({size:sph.idx.byteLength, usage:GPUBufferUsage.INDEX |GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(posBuf,0,sph.pos);
  device.queue.writeBuffer(nrmBuf,0,sph.nrm);
  device.queue.writeBuffer(idxBuf,0,sph.idx);

  // 2) Load 6 cubemap faces (DTU-provided filenames/orientation)
  const faces = [
    'textures/cm_left.png',
    'textures/cm_right.png',
    'textures/cm_bottom.png',
    'textures/cm_top.png',
    'textures/cm_back.png',
    'textures/cm_front.png'
  ];

  // Load all
  const imgs = await Promise.all(faces.map(loadImageData));
  const W = imgs[0].w, H = imgs[0].h;

  // Create 2D array texture with 6 layers and view as cube
  const cubeTex = device.createTexture({
    size: [W, H, 6],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  });

  // Copy each face into layer z = 0..5
  for (let i=0;i<6;++i){
    device.queue.writeTexture(
      { texture: cubeTex, origin: {x:0, y:0, z:i} },
      imgs[i].data,
      { bytesPerRow: W*4, rowsPerImage: H },
      [W, H, 1]
    );
  }

  // 3) Sampler and shader/pipeline
  const sampler = device.createSampler({
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear'
  });

  const shader = device.createShaderModule({ code: await (await fetch('shader.wgsl')).text() });

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shader, entryPoint: 'vs_main',
      buffers: [
        { arrayStride: 3*4, attributes: [{shaderLocation:0, offset:0, format:'float32x3'}] },
        { arrayStride: 3*4, attributes: [{shaderLocation:1, offset:0, format:'float32x3'}] },
      ]
    },
    fragment: { module: shader, entryPoint: 'fs_main', targets: [{format}] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format:'depth24plus', depthWriteEnabled:true, depthCompare:'less' },
  });

  // Uniforms: MVP (64 bytes)
  const uBuf = device.createBuffer({ size: 16*4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  // Bind group (cube view: viewDimension='cube')
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uBuf } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: cubeTex.createView({ dimension: 'cube' }) },
    ],
  });

  // Depth texture - reuse it, don't create every frame!
  let depthTex = null;

  function ensureDepth() {
    if (!depthTex ||
        depthTex.width  !== canvas.width ||
        depthTex.height !== canvas.height) {
      depthTex?.destroy?.(); // destroy old one if it exists
      depthTex = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT
      });
    }
  }

  // 4) Render
  const bg = { r:0.3921, g:0.5843, b:0.9294, a:1 };

  let yaw = 0;
  function frame(){
    ensureDepth(); // ensure depth texture is ready
    
    if (orbit.checked) yaw += 0.5;
    const mvp = makeMVP(canvas, yaw);
    device.queue.writeBuffer(uBuf, 0, new Float32Array(flatten(mvp)));

    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp:'clear', clearValue:bg, storeOp:'store'
      }],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthLoadOp:'clear', depthClearValue:1, depthStoreOp:'store'
      }
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, posBuf);
    pass.setVertexBuffer(1, nrmBuf);
    pass.setIndexBuffer(idxBuf, 'uint32');
    pass.setBindGroup(0, bind);
    pass.drawIndexed(sph.idx.length);
    pass.end();

    device.queue.submit([enc.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
