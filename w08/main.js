"use strict";

window.onload = () => main();

function f32(a){ return new Float32Array(a); }
function u32(a){ return new Uint32Array(a); }

// ---- camera (same as you set) ----
function makePV(canvas){
  const A = canvas.width / canvas.height;
  const P = perspective(50, A, 0.1, 100);
  const eye = vec3(0, 0, 1.5);
  const at  = vec3(0, 0, -3);
  const up  = vec3(0, 1, 0);
  const V   = lookAt(eye, at, up);
  return {P, V};
}
function mul4(a,b){ return mult(a,b); } // MV.js mat4 mul helper

// ---- shadow projection matrix onto plane y = -1 ----
// Plane: ax + by + cz + d = 0  with (a,b,c,d) = (0,1,0,1)
function shadowMatrixPointToPlane(L){
  const a=0, b=1, c=0, d=1;          // plane y + 1 = 0  -> y = -1
  const lx=L[0], ly=L[1], lz=L[2], lw=1.0;
  const dot = a*lx + b*ly + c*lz + d*lw;

  // Red Book planar shadow matrix (point light, lw=1)
  return mat4(
    vec4(dot - lx*a,  -lx*b,       -lx*c,       -lx*d),
    vec4(  -ly*a,   dot - ly*b,    -ly*c,       -ly*d),
    vec4(  -lz*a,     -lz*b,     dot - lz*c,    -lz*d),
    vec4(  -lw*a,     -lw*b,       -lw*c,     dot - lw*d)
  );
}

// --- Simple texture loader (image -> rgba8) ---
async function loadImageData(url){
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = img.width, h = img.height;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, w, h);
  return { w, h, data };
}

async function main(){
  if (!('gpu' in navigator)) { alert('WebGPU not supported'); return; }

  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const canvas = document.getElementById('gpu-canvas');
  const ctx    = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode:'opaque' });

  // ---------- Geometry (positions + UVs) ----------
  const groundPos = f32([
    -2, -1, -1,   2, -1, -1,
     2, -1, -5,  -2, -1, -5,
  ]);
  const groundUV  = f32([ 0,0,  1,0,  1,1,  0,1 ]);
  const groundIdx = u32([ 0,1,2,  0,2,3 ]);

  const aPos = f32([
    0.25, -0.5, -1.25,
    0.75, -0.5, -1.25,
    0.75, -0.5, -1.75,
    0.25, -0.5, -1.75,
  ]);
  const aUV = f32([ 0,0, 1,0, 1,1, 0,1 ]);
  const aIdx = u32([ 0,1,2, 0,2,3 ]);

  const bPos = f32([
    -1, -1, -2.5,
    -1, -1, -3.0,
    -1,  0, -3.0,
    -1,  0, -2.5,
  ]);
  const bUV = f32([ 0,0, 1,0, 1,1, 0,1 ]);
  const bIdx = u32([ 0,1,2, 0,2,3 ]);

  // buffers
  const makeVBuf = (data) => {
    const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buf, 0, data);
    return buf;
  };
  const makeIBuf = (data) => {
    const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buf, 0, data);
    return buf;
  };

  const gPosBuf = makeVBuf(groundPos), gUVBuf = makeVBuf(groundUV), gIdxBuf = makeIBuf(groundIdx);
  const aPosBuf = makeVBuf(aPos),     aUVBuf = makeVBuf(aUV),       aIdxBuf = makeIBuf(aIdx);
  const bPosBuf = makeVBuf(bPos),     bUVBuf = makeVBuf(bUV),       bIdxBuf = makeIBuf(bIdx);

  // ---------- Textures ----------
  const img = await loadImageData("xamp23.png");
  const texGround = device.createTexture({
    size: [img.w, img.h],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  });
  device.queue.writeTexture({ texture: texGround }, img.data, { bytesPerRow: img.w * 4 }, [img.w, img.h, 1]);

  const texRed = device.createTexture({
    size: [1, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  });
  device.queue.writeTexture({ texture: texRed }, new Uint8Array([255,0,0,255]), { bytesPerRow: 4 }, [1,1,1]);

  const sampler = device.createSampler({
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    minFilter: "linear",
    magFilter: "linear",
  });

  // ---------- Pipeline ----------
  const wgsl = await (await fetch("shader.wgsl")).text();
  const shader = device.createShaderModule({ code: wgsl });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shader, entryPoint: "vs_main",
      buffers: [
        { arrayStride: 3*4, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
        { arrayStride: 2*4, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }] },
      ]
    },
    fragment: { module: shader, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });

  // ---------- Uniforms & bind groups ----------
  // UBO = mat4 (64) + vec4 (16) = 80 bytes → round up to 80 (already 16-aligned)
  function makeUBuf(){ return device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); }
  const uGround = makeUBuf();   // ground (vis = 1)
  const uRed    = makeUBuf();   // red quads (vis = 1)
  const uShadow = makeUBuf();   // shadow polys (vis = 0)

  const bgGround = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uGround } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texGround.createView() },
    ],
  });
  const bgRed = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uRed } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texRed.createView() },
    ],
  });
  const bgShadow = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uShadow } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texRed.createView() }, // any texture; we'll multiply by vis=0
    ],
  });

  // Depth texture (reused)
  let depthTex = null;
  function ensureDepth(){
    if (!depthTex || depthTex.width !== canvas.width || depthTex.height !== canvas.height){
      depthTex?.destroy?.();
      depthTex = device.createTexture({
        size: [canvas.width, canvas.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT
      });
    }
  }

  // ---------- Animate light + draw ----------
  let t = 0;
  const bg = { r: 1, g: 1, b: 1, a: 1 };

  function frame(){
    ensureDepth();

    // Light path: circle parallel to xz-plane with center (0,2,-2), radius 2
    t += 0.015;
    const L = vec3( 2*Math.cos(t), 2.0, -2 + 2*Math.sin(t) );

    // PV and MVPs
    const {P, V} = makePV(canvas);

    // Ground MVP + vis=1
    {
      const MVP = mul4(P, mul4(V, mat4()));
      device.queue.writeBuffer(uGround, 0, new Float32Array(flatten(MVP)));
      device.queue.writeBuffer(uGround, 64, new Float32Array([1,0,0,0])); // vis=1
    }

    // Shadow MVPs: Ms * slight lift (to avoid z-fight) then PV
    // Draw shadows for quads A and B in same pass by switching vertex buffers.
    const Ms = mult( translate(0, +0.1, 0), shadowMatrixPointToPlane(L) );
    const MVPshadow = mul4(P, mul4(V, Ms));
    device.queue.writeBuffer(uShadow, 0, new Float32Array(flatten(MVPshadow)));
    device.queue.writeBuffer(uShadow, 64, new Float32Array([0,0,0,0])); // vis=0 → black

    // Red quads MVP + vis=1
    {
      const MVP = mul4(P, mul4(V, mat4()));
      device.queue.writeBuffer(uRed, 0, new Float32Array(flatten(MVP)));
      device.queue.writeBuffer(uRed, 64, new Float32Array([1,0,0,0])); // vis=1
    }

    // Render in correct order: ground → shadows → red quads
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: "clear", clearValue: bg, storeOp: "store"
      }],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthLoadOp: "clear", depthClearValue: 1, depthStoreOp: "store"
      }
    });

    pass.setPipeline(pipeline);

    // Ground
    pass.setBindGroup(0, bgGround);
    pass.setVertexBuffer(0, gPosBuf);
    pass.setVertexBuffer(1, gUVBuf);
    pass.setIndexBuffer(gIdxBuf, "uint32");
    pass.drawIndexed(6);

    // Shadows (project quads A and B using MVPshadow)
    pass.setBindGroup(0, bgShadow);

    pass.setVertexBuffer(0, aPosBuf);
    pass.setVertexBuffer(1, aUVBuf);
    pass.setIndexBuffer(aIdxBuf, "uint32");
    pass.drawIndexed(6);

    pass.setVertexBuffer(0, bPosBuf);
    pass.setVertexBuffer(1, bUVBuf);
    pass.setIndexBuffer(bIdxBuf, "uint32");
    pass.drawIndexed(6);

    // Red quads (in front of shadows)
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
