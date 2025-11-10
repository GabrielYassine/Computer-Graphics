"use strict";

window.onload = () => main();

// ---------- helpers ----------
const f32 = a => new Float32Array(a);
const u32 = a => new Uint32Array(a);
function fail(m){ throw new Error(m); }

function makeMVP(canvas, yawDeg){
  const A = canvas.width / canvas.height;
  const P = perspective(60, A, 0.1, 200);
  // Lift camera up so we view the globe from above/front instead of from below
  const eye = vec3(0, 3.0, 6);
  const at  = vec3(0, 0, 0);
  const up  = vec3(0, 1, 0);
  // Rotate the eye position around the Y axis by yawDeg so the turntable slider actually works.
  // MV.js provides rotateY(theta) -> mat4 and mult(mat4, vec4) -> vec4.
  const eye4 = vec4(eye[0], eye[1], eye[2], 1.0);
  const rotated = mult( rotateY(yawDeg), eye4 );
  const eyeRot = vec3(rotated[0], rotated[1], rotated[2]);
  const V   = lookAt(eyeRot, at, up);
  return mult(P, mult(V, mat4())); // model = identity
}

// ---------- geometry ----------
function makeQuadData(){
  // positions: (-4,-1,-1), (4,-1,-1), (4,-1,-21), (-4,-1,-21)
  const pos = f32([ -4,-1,-1,  4,-1,-1,  4,-1,-21,  -4,-1,-21 ]);
  // uvs: (-1.5,0), (2.5,0), (2.5,10), (-1.5,10)
  const uv  = f32([ -1.5,0,  2.5,0,  2.5,10,  -1.5,10 ]);
  const idx = u32([0,1,2, 0,2,3]);
  return {pos, uv, idx};
}

function makeSphereData(segments=32, rings=24, radius=1.5){
  const positions = [];
  const normals   = [];
  const indices   = [];
  for (let y = 0; y <= rings; ++y) {
    const v = y / rings;
    const theta = v * Math.PI; // 0..PI
    const ct = Math.cos(theta), st = Math.sin(theta);
    for (let x = 0; x <= segments; ++x) {
      const u = x / segments;
      const phi = u * Math.PI * 2; // 0..2PI
      const cp = Math.cos(phi), sp = Math.sin(phi);
      const nx = cp * st, ny = ct, nz = sp * st;
      positions.push(radius*nx, radius*ny, radius*nz);
      normals.push(nx, ny, nz);
    }
  }
  const stride = segments + 1;
  for (let y = 0; y < rings; ++y) {
    for (let x = 0; x < segments; ++x) {
      const i0 = y*stride + x;
      const i1 = i0 + 1;
      const i2 = i0 + stride;
      const i3 = i2 + 1;
      indices.push(i0,i2,i1,  i1,i2,i3);
    }
  }
  return { pos: f32(positions), nrm: f32(normals), idx: u32(indices) };
}

// ---------- checkerboard ----------
function makeCheckerboard(size=64, tiles=8){
  const data = new Uint8Array(size*size*4);
  const step = size/tiles;
  for (let y=0;y<size;++y){
    for (let x=0;x<size;++x){
      const c = ((Math.floor(x/step)^Math.floor(y/step))&1)?255:0;
      const i = 4*(y*size+x);
      data[i+0]=data[i+1]=data[i+2]=c; data[i+3]=255;
    }
  }
  return data;
}

async function main() {
  const gpu = navigator.gpu;
  if (!gpu) return;
  const adapter = await gpu.requestAdapter();
  if (!adapter) return;
  const device = await adapter.requestDevice();

  const canvas = document.getElementById('my-canvas');
  const context = canvas.getContext('webgpu');
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  // UI
  const sceneSel = document.getElementById('scene');
  const wrapSel  = document.getElementById('wrap');
  const minSel   = document.getElementById('minF');
  const magSel   = document.getElementById('magF');
  const mipSel   = document.getElementById('mipF');
  const useMips  = document.getElementById('useMips');
  const orbit    = document.getElementById('orbit');

  // Shader & pipelines
  const shaderCode = await (await fetch('shader.wgsl')).text();
  const shader = device.createShaderModule({code: shaderCode});

  // Pipelines with different vertex layouts
  const pipelineQuad = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shader, entryPoint: 'vs_quad',
      buffers: [
        { arrayStride: 3*4, attributes: [{shaderLocation:0, offset:0, format:'float32x3'}] }, // pos
        { arrayStride: 2*4, attributes: [{shaderLocation:1, offset:0, format:'float32x2'}] }, // uv
      ]
    },
    fragment: { module: shader, entryPoint: 'fs_main', targets: [{format}] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
  });

  const pipelineSphere = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shader, entryPoint: 'vs_sphere',
      buffers: [
        { arrayStride: 3*4, attributes: [{shaderLocation:0, offset:0, format:'float32x3'}] }, // pos
        { arrayStride: 3*4, attributes: [{shaderLocation:1, offset:0, format:'float32x3'}] }, // nrm
      ]
    },
    fragment: { module: shader, entryPoint: 'fs_main', targets: [{format}] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });

  // Uniform buffer (mat4 + eye + lightDir + flags) = 112 bytes
  const uSize = (16 + 4 + 4 + 4) * 4;
  const uBuf  = device.createBuffer({ size: uSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  // Geometry buffers
  const quad = makeQuadData();
  const quadPos = device.createBuffer({size: quad.pos.byteLength, usage: GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const quadUV  = device.createBuffer({size: quad.uv.byteLength,  usage: GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const quadIdx = device.createBuffer({size: quad.idx.byteLength, usage: GPUBufferUsage.INDEX |GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(quadPos, 0, quad.pos);
  device.queue.writeBuffer(quadUV,  0, quad.uv);
  device.queue.writeBuffer(quadIdx, 0, quad.idx);

  const sphere = makeSphereData(48, 32, 1.6);
  const sphPos = device.createBuffer({size: sphere.pos.byteLength, usage: GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const sphNrm = device.createBuffer({size: sphere.nrm.byteLength, usage: GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const sphIdx = device.createBuffer({size: sphere.idx.byteLength, usage: GPUBufferUsage.INDEX |GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(sphPos, 0, sphere.pos);
  device.queue.writeBuffer(sphNrm, 0, sphere.nrm);
  device.queue.writeBuffer(sphIdx, 0, sphere.idx);

  // --- Textures (with mipmaps) ---
  // Quad: procedural checkerboard
  const checkerSize = 256; // bigger to show mip effects
  const checkerData = makeCheckerboard(checkerSize, 16);
  const checkerLevels = numMipLevels(checkerSize, checkerSize);
  const texQuad = device.createTexture({
    size: [checkerSize, checkerSize, 1],
    format: 'rgba8unorm',
    mipLevelCount: checkerLevels,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });
  device.queue.writeTexture(
    {texture: texQuad},
    checkerData,
    {bytesPerRow: checkerSize*4},
    [checkerSize, checkerSize, 1]
  );
  generateMipmap(device, texQuad); // create mipmaps

  // Sphere: load earth.jpg and build mipmaps
  const earthImg = new Image();
  earthImg.src = 'earth.jpg';
  await earthImg.decode();

  const earthW = earthImg.width, earthH = earthImg.height;
  const earthLevels = numMipLevels(earthW, earthH);
  const texSphere = device.createTexture({
    size: [earthW, earthH, 1],
    format: 'rgba8unorm',
    mipLevelCount: earthLevels,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });
  // Copy image onto base level
  {
    const bmp = await createImageBitmap(earthImg);
    // Create an intermediate canvas to read pixels
    const cvs = document.createElement('canvas');
    cvs.width = earthW; cvs.height = earthH;
    const g = cvs.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const imgData = g.getImageData(0, 0, earthW, earthH);
    device.queue.writeTexture(
      {texture: texSphere},
      imgData.data,
      {bytesPerRow: earthW*4},
      [earthW, earthH, 1]
    );
  }
  generateMipmap(device, texSphere);

  // Current texture/sampler and bind group
  let currentTex = texQuad;

  function makeSampler(){
    const wrap = wrapSel.value === 'repeat' ? 'repeat' : 'clamp-to-edge';
    return device.createSampler({
      addressModeU: wrap,
      addressModeV: wrap,
      minFilter: minSel.value,
      magFilter: magSel.value,
      mipmapFilter: mipSel.value,
    });
  }
  let sampler = makeSampler();

  function makeBindGroup(){
    return device.createBindGroup({
      layout: (sceneSel.value === 'quad' ? pipelineQuad : pipelineSphere).getBindGroupLayout(0),
      entries: [
        {binding:0, resource:{buffer:uBuf}},
        {binding:1, resource:sampler},
        {binding:2, resource:currentTex.createView()},
      ]
    });
  }
  let bindGroup = makeBindGroup();

  // Orbit helper: when `orbit` is checked, automatically spin the view.
  let lastTime = performance.now();
  let autoYaw = 0; // degrees accumulated from automatic orbit

  // Recreate sampler/bindgroup on UI change
  function refreshSampler(){
    sampler = makeSampler();
    bindGroup = makeBindGroup();
  }
  [wrapSel,minSel,magSel,mipSel].forEach(el => el.addEventListener('change', refreshSampler));
  sceneSel.addEventListener('change', ()=>{
    currentTex = (sceneSel.value === 'quad') ? texQuad : texSphere;
    bindGroup = makeBindGroup();
  });
  useMips.addEventListener('change', ()=>{/* flag handled in uniforms */});

  // Render
  const bg = { r: 0.3921, g: 0.5843, b: 0.9294, a: 1 };

  function frame(){
    const now = performance.now();
    const dt = (now - lastTime) * 0.001; // seconds
    lastTime = now;

    // If orbit is enabled, rotate automatically; otherwise keep static view.
    if (orbit && orbit.checked) {
      const speedDegPerSec = 30.0; // degrees per second
      autoYaw = (autoYaw + speedDegPerSec * dt) % 360.0;
    }
    const yaw = (orbit && orbit.checked) ? autoYaw : 0.0;
  const mvp = makeMVP(canvas, yaw);
  const eye = [0, 3.0, 6, 0];
    const lightDir = [0.3, -1.0, 0.4, 0]; // from above/front
    const use_mipmap = useMips.checked ? 1 : 0;
    const sceneFlag  = (sceneSel.value === 'quad') ? 0 : 1;

    // pack uniforms: mat4 + eye + light + flags(uvec4)
    const u = new Float32Array(16 + 4 + 4); // first 3 parts
    u.set(new Float32Array(flatten(mvp)), 0);
    u.set(eye, 16);
    u.set(lightDir, 20);
    device.queue.writeBuffer(uBuf, 0, u);

    const flags = new Uint32Array([use_mipmap, sceneFlag, 0, 0]);
    device.queue.writeBuffer(uBuf, (16+4+4)*4, flags);

    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear', clearValue: bg, storeOp: 'store'
      }],
      depthStencilAttachment: (sceneFlag===1) ? {
        view: device.createTexture({
          size:[canvas.width, canvas.height],
          format:'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT
        }).createView(),
        depthLoadOp:'clear', depthClearValue:1, depthStoreOp:'discard'
      } : undefined
    });

    if (sceneFlag === 0){
      pass.setPipeline(pipelineQuad);
      pass.setVertexBuffer(0, quadPos);
      pass.setVertexBuffer(1, quadUV);
      pass.setIndexBuffer(quadIdx, 'uint32');
    } else {
      pass.setPipeline(pipelineSphere);
      pass.setVertexBuffer(0, sphPos);
      pass.setVertexBuffer(1, sphNrm);
      pass.setIndexBuffer(sphIdx, 'uint32');
    }
    pass.setBindGroup(0, bindGroup);
    const indexCount = (sceneFlag===0) ? 6 : sphere.idx.length;
    pass.drawIndexed(indexCount);
    pass.end();

    device.queue.submit([enc.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
