"use strict";

window.onload = () => main();

function f32(a){ return new Float32Array(a); }
function u32(a){ return new Uint32Array(a); }

// ---------------- Camera (W10 Part 1: simple orbiting) -------------------
const camera = {
  at: vec3(0, 0, -3),
  up: vec3(0, 1, 0),

  // Week 8 had eye=(0,0,1.5) and at=(0,0,-3) => radius = 4.5
  radius: 4.5,
  yaw: 0.0,
  pitch: 0.0,

  getEye() {
    const r = this.radius;

    const eps = 0.01;
    const p = Math.max(-Math.PI/2 + eps, Math.min(Math.PI/2 - eps, this.pitch));

    const cy = Math.cos(this.yaw),  sy = Math.sin(this.yaw);
    const cp = Math.cos(p),         sp = Math.sin(p);

    const offset = vec3(
      r * sy * cp,
      r * sp,
      r * cy * cp
    );

    return add(this.at, offset);
  }
};

const mouse = { dragging:false, lastX:0, lastY:0 };

function installOrbitControls(canvas) {
  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    mouse.dragging = true;
    mouse.lastX = e.offsetX;
    mouse.lastY = e.offsetY;
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!mouse.dragging) return;

    const dx = e.offsetX - mouse.lastX;
    const dy = e.offsetY - mouse.lastY;

    const s = 0.005;
    camera.yaw   += dx * s;
    camera.pitch += -dy * s;

    mouse.lastX = e.offsetX;
    mouse.lastY = e.offsetY;
  });

  const endDrag = () => { mouse.dragging = false; };
  canvas.addEventListener("mouseup", endDrag);
  canvas.addEventListener("mouseleave", endDrag);
}

// ---------------- Projection/View (now uses orbiting camera) ------------
function makePV(canvas){
  const A = canvas.width / canvas.height;
  const P = perspective(50, A, 0.1, 100);

  const eye = camera.getEye();
  const V   = lookAt(eye, camera.at, camera.up);
  return { P, V };
}

// shadow projection onto plane y = -1
function shadowMatrixPointToPlane(L){
  // plane: 0*x + 1*y + 0*z + 1 = 0
  const a=0, b=1, c=0, d=1;
  const lx=L[0], ly=L[1], lz=L[2], lw=1.0;
  const dot = a*lx + b*ly + c*lz + d*lw;
  return mat4(
    vec4(dot - lx*a,  -lx*b,       -lx*c,       -lx*d),
    vec4(  -ly*a,   dot - ly*b,    -ly*c,       -ly*d),
    vec4(  -lz*a,     -lz*b,     dot - lz*c,    -lz*d),
    vec4(  -lw*a,     -lw*b,       -lw*c,     dot - lw*d)
  );
}

// image loader
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
  installOrbitControls(canvas);

  const ctx    = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode:"opaque" });

  // geometry
  const groundPos = f32([ -2,-1,-1,  2,-1,-1,  2,-1,-5,  -2,-1,-5 ]);
  const groundUV  = f32([ 0,0, 1,0, 1,1, 0,1 ]);
  const quadIdx   = u32([ 0,1,2, 0,2,3 ]);

  const aPos = f32([ 0.25,-0.5,-1.25,  0.75,-0.5,-1.25,  0.75,-0.5,-1.75,  0.25,-0.5,-1.75 ]);
  const aUV  = f32([ 0,0, 1,0, 1,1, 0,1 ]);

  const bPos = f32([ -1,-1,-2.5,  -1,-1,-3.0,  -1,0,-3.0,  -1,0,-2.5 ]);
  const bUV  = f32([ 0,0, 1,0, 1,1, 0,1 ]);

  const makeVBuf = d => {
    const b = device.createBuffer({ size:d.byteLength, usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, d);
    return b;
  };
  const makeIBuf = d => {
    const b = device.createBuffer({ size:d.byteLength, usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, d);
    return b;
  };

  const gPosBuf = makeVBuf(groundPos), gUVBuf = makeVBuf(groundUV), gIdxBuf = makeIBuf(quadIdx);
  const aPosBuf = makeVBuf(aPos),     aUVBuf = makeVBuf(aUV),     aIdxBuf = makeIBuf(quadIdx);
  const bPosBuf = makeVBuf(bPos),     bUVBuf = makeVBuf(bUV),     bIdxBuf = makeIBuf(quadIdx);

  // textures
  const img = await loadImageData("../../models-images/xamp23.png");

  const texGround = device.createTexture({
    size:[img.w,img.h],
    format:"rgba8unorm",
    usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST
  });
  device.queue.writeTexture({texture:texGround}, img.data, {bytesPerRow:img.w*4}, [img.w,img.h,1]);

  const texRed = device.createTexture({
    size:[1,1],
    format:"rgba8unorm",
    usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST
  });
  device.queue.writeTexture({texture:texRed}, new Uint8Array([255,0,0,255]), {bytesPerRow:4}, [1,1,1]);

  const sampler = device.createSampler({
    addressModeU:"clamp-to-edge",
    addressModeV:"clamp-to-edge",
    minFilter:"linear",
    magFilter:"linear"
  });

  // pipelines
  const shader = device.createShaderModule({ code: await (await fetch("shader.wgsl")).text() });

  // Objects pipeline (keep back-face culling)
  const pipeObj = device.createRenderPipeline({
    layout:"auto",
    vertex:{
      module:shader, entryPoint:"vs_main",
      buffers:[
        { arrayStride:3*4, attributes:[{shaderLocation:0, offset:0, format:"float32x3"}] },
        { arrayStride:2*4, attributes:[{shaderLocation:1, offset:0, format:"float32x2"}] },
      ]
    },
    fragment:{ module:shader, entryPoint:"fs_main", targets:[{format}] },
    primitive:{ topology:"triangle-list", cullMode:"none" },
    depthStencil:{ format:"depth24plus", depthWriteEnabled:true, depthCompare:"less" }
  });

  // Ground pipeline (NO culling so it’s visible from below)
  const pipeGround = device.createRenderPipeline({
    layout:"auto",
    vertex:{
      module:shader, entryPoint:"vs_main",
      buffers:[
        { arrayStride:3*4, attributes:[{shaderLocation:0, offset:0, format:"float32x3"}] },
        { arrayStride:2*4, attributes:[{shaderLocation:1, offset:0, format:"float32x2"}] },
      ]
    },
    fragment:{ module:shader, entryPoint:"fs_main", targets:[{format}] },
    primitive:{ topology:"triangle-list", cullMode:"none" },
    depthStencil:{ format:"depth24plus", depthWriteEnabled:true, depthCompare:"less" }
  });

  // Shadow pipeline: no cull, depthCompare "greater", alpha blend
  const pipeShadow = device.createRenderPipeline({
    layout:"auto",
    vertex:{
      module:shader, entryPoint:"vs_main",
      buffers:[
        { arrayStride:3*4, attributes:[{shaderLocation:0, offset:0, format:"float32x3"}] },
        { arrayStride:2*4, attributes:[{shaderLocation:1, offset:0, format:"float32x2"}] },
      ]
    },
    fragment:{
      module:shader,
      entryPoint:"fs_main",
      targets:[{
        format,
        blend:{
          color:{ srcFactor:"src-alpha", dstFactor:"one-minus-src-alpha", operation:"add" },
          alpha:{ srcFactor:"one",       dstFactor:"one-minus-src-alpha", operation:"add" }
        }
      }]
    },
    primitive:{ topology:"triangle-list", cullMode:"none" },
    depthStencil:{ format:"depth24plus", depthWriteEnabled:false, depthCompare:"greater" }
  });

  // UBOs (mat4 + vec4) => 64 + 16 = 80 bytes
  function makeUBuf(){
    return device.createBuffer({ size:80, usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });
  }
  const uGround = makeUBuf();
  const uRed    = makeUBuf();
  const uShadow = makeUBuf();

  const bgGround = device.createBindGroup({
    layout:pipeGround.getBindGroupLayout(0),
    entries:[
      {binding:0, resource:{buffer:uGround}},
      {binding:1, resource:sampler},
      {binding:2, resource:texGround.createView()}
    ]
  });

  const bgRed = device.createBindGroup({
    layout:pipeObj.getBindGroupLayout(0),
    entries:[
      {binding:0, resource:{buffer:uRed}},
      {binding:1, resource:sampler},
      {binding:2, resource:texRed.createView()}
    ]
  });

  const bgShadow = device.createBindGroup({
    layout:pipeShadow.getBindGroupLayout(0),
    entries:[
      {binding:0, resource:{buffer:uShadow}},
      {binding:1, resource:sampler},
      {binding:2, resource:texRed.createView()}
    ]
  });

  // depth
  const depthTex = device.createTexture({
    size:[canvas.width, canvas.height],
    format:"depth24plus",
    usage:GPUTextureUsage.RENDER_ATTACHMENT
  });

  let t = 0;

  function drawQuad(pass, posBuf, uvBuf, idxBuf){
    pass.setVertexBuffer(0, posBuf);
    pass.setVertexBuffer(1, uvBuf);
    pass.setIndexBuffer(idxBuf, "uint32");
    pass.drawIndexed(6);
  }

  function frame(){
    const {P,V} = makePV(canvas);

    // moving light (unchanged)
    t += 0.015;
    const L = vec3(2*Math.cos(t), 2.0, -2 + 2*Math.sin(t));

    const I = mat4();
    const MVP  = mult(P, mult(V, I));

    // push shadow slightly BELOW ground so depthCompare:"greater" passes only on ground
    const Ms0  = shadowMatrixPointToPlane(L);
    const Ms   = mult(translate(0, -0.001, 0), Ms0);
    const MVPs = mult(P, mult(V, Ms));

    device.queue.writeBuffer(uGround, 0, new Float32Array(flatten(MVP)));
    device.queue.writeBuffer(uGround, 64, new Float32Array([1,1,1,1]));

    device.queue.writeBuffer(uRed, 0, new Float32Array(flatten(MVP)));
    device.queue.writeBuffer(uRed, 64, new Float32Array([1,1,1,1]));

    device.queue.writeBuffer(uShadow, 0, new Float32Array(flatten(MVPs)));
    device.queue.writeBuffer(uShadow, 64, new Float32Array([0,0,0,0.6]));

    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments:[{
        view:ctx.getCurrentTexture().createView(),
        loadOp:"clear",
        clearValue:{r:1,g:1,b:1,a:1},
        storeOp:"store"
      }],
      depthStencilAttachment:{
        view:depthTex.createView(),
        depthLoadOp:"clear",
        depthClearValue:1,
        depthStoreOp:"store"
      }
    });

    // 1) ground (double-sided)
    pass.setPipeline(pipeGround);
    pass.setBindGroup(0, bgGround);
    drawQuad(pass, gPosBuf, gUVBuf, gIdxBuf);

    // 2) shadow (restricted to ground by depthCompare:"greater")
    pass.setPipeline(pipeShadow);
    pass.setBindGroup(0, bgShadow);
    drawQuad(pass, aPosBuf, aUVBuf, aIdxBuf);
    drawQuad(pass, bPosBuf, bUVBuf, bIdxBuf);

    // 3) objects
    pass.setPipeline(pipeObj);
    pass.setBindGroup(0, bgRed);
    drawQuad(pass, aPosBuf, aUVBuf, aIdxBuf);
    drawQuad(pass, bPosBuf, bUVBuf, bIdxBuf);

    pass.end();
    device.queue.submit([enc.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
