"use strict";

window.onload = () => main();

function f32(a){ return new Float32Array(a); }
function u32(a){ return new Uint32Array(a); }

function qIdentity(){ return { w:1, x:0, y:0, z:0 }; }

function qNormalize(q){
  const n = Math.hypot(q.w, q.x, q.y, q.z) || 1;
  return { w:q.w/n, x:q.x/n, y:q.y/n, z:q.z/n };
}

function qMul(a,b){
  return {
    w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
    x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
    y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
    z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w
  };
}

function qFromAxisAngle(axis, angle){
  const s = Math.sin(angle * 0.5);
  return qNormalize({
    w: Math.cos(angle * 0.5),
    x: axis[0] * s,
    y: axis[1] * s,
    z: axis[2] * s
  });
}

function qConj(q){ return { w:q.w, x:-q.x, y:-q.y, z:-q.z }; }

function qRotateVec3(q, v){
  const p = { w:0, x:v[0], y:v[1], z:v[2] };
  const t = qMul(qMul(q, p), qConj(q));
  return vec3(t.x, t.y, t.z);
}

function clamp(x, lo, hi){ return Math.max(lo, Math.min(hi, x)); }

function qFromTo(vFrom, vTo){
  const fx=vFrom[0], fy=vFrom[1], fz=vFrom[2];
  const tx=vTo[0],   ty=vTo[1],   tz=vTo[2];

  const ax = fy*tz - fz*ty;
  const ay = fz*tx - fx*tz;
  const az = fx*ty - fy*tx;

  const dot = clamp(fx*tx + fy*ty + fz*tz, -1, 1);
  const axisLen = Math.hypot(ax, ay, az);

  if (axisLen < 1e-8) return qIdentity();

  const axis = vec3(ax/axisLen, ay/axisLen, az/axisLen);
  const angle = Math.acos(dot);
  return qFromAxisAngle(axis, angle);
}

function trackballProject(x, y){
  const d = Math.hypot(x, y);
  const r = 1.0;
  const t = r * Math.SQRT1_2;

  let z;
  if (d < t) z = Math.sqrt(r*r - d*d);
  else if (d > 1e-8) z = (t*t) / d;
  else z = r;

  const n = Math.hypot(x, y, z) || 1;
  return vec3(x/n, y/n, z/n);
}

function vNormalize(v){
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return vec3(v[0]/n, v[1]/n, v[2]/n);
}

function vCross(a,b){
  return vec3(
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0]
  );
}

function vSub(a,b){ return vec3(a[0]-b[0], a[1]-b[1], a[2]-b[2]); }
function vAdd(a,b){ return vec3(a[0]+b[0], a[1]+b[1], a[2]+b[2]); }
function vScale(v,s){ return vec3(v[0]*s, v[1]*s, v[2]*s); }

const camera = {
  at: vec3(0, 0, -3),
  radius: 4.5,
  q: qIdentity(),
  baseOffset: vec3(0, 0, 1),
  baseUp: vec3(0, 1, 0),

  getEye(){
    const dir = qRotateVec3(this.q, this.baseOffset);
    return add(this.at, vec3(dir[0]*this.radius, dir[1]*this.radius, dir[2]*this.radius));
  },

  getUp(){
    return qRotateVec3(this.q, this.baseUp);
  }
};

const mouse = {
  down: false,
  mode: "orbit",
  lastX: 0,
  lastY: 0,
  lastV: vec3(0,0,1),
  lastMoveTime: 0
};

const spinning = {
  active: false,
  dq: qIdentity()
};

function mouseToNDC(canvas, e){
  const x = (2 * e.offsetX / canvas.width) - 1;
  const y = 1 - (2 * e.offsetY / canvas.height);
  const aspect = canvas.width / canvas.height;
  let xx = x, yy = y;
  if (aspect >= 1) xx *= aspect;
  else yy /= aspect;
  return { x: xx, y: yy };
}

function installControls(canvas){
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) mouse.mode = "orbit";
    else if (e.button === 1) mouse.mode = "dolly";
    else if (e.button === 2) mouse.mode = "pan";
    else return;

    mouse.down = true;
    mouse.lastX = e.offsetX;
    mouse.lastY = e.offsetY;
    mouse.lastMoveTime = performance.now();

    spinning.active = false;
    spinning.dq = qIdentity();

    if (mouse.mode === "orbit") {
      const ndc = mouseToNDC(canvas, e);
      mouse.lastV = trackballProject(ndc.x, ndc.y);
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!mouse.down) return;

    const x = e.offsetX, y = e.offsetY;
    const dx = x - mouse.lastX;
    const dy = y - mouse.lastY;

    if (mouse.mode === "orbit") {
      const ndc = mouseToNDC(canvas, e);
      const curV = trackballProject(ndc.x, ndc.y);
      const dq = qFromTo(mouse.lastV, curV);
      camera.q = qNormalize(qMul(camera.q, dq));
      spinning.dq = dq;
      mouse.lastV = curV;
      mouse.lastMoveTime = performance.now();
    } else if (mouse.mode === "dolly") {
      const s = 0.01;
      const factor = Math.exp(dy * s);
      camera.radius = clamp(camera.radius * factor, 0.5, 50.0);
      mouse.lastMoveTime = performance.now();
    } else if (mouse.mode === "pan") {
      const eye = camera.getEye();
      const up = vNormalize(camera.getUp());
      const fwd = vNormalize(vSub(camera.at, eye));
      const right = vNormalize(vCross(fwd, up));
      const imgUp = vNormalize(vCross(right, fwd));

      const fovRad = 50.0 * Math.PI / 180.0;
      const worldPerPixel = 2.0 * camera.radius * Math.tan(fovRad * 0.5) / canvas.height;

      const delta = vAdd(vScale(right, -dx * worldPerPixel), vScale(imgUp, dy * worldPerPixel));
      camera.at = vAdd(camera.at, delta);
      mouse.lastMoveTime = performance.now();
    }

    mouse.lastX = x;
    mouse.lastY = y;
  });

  canvas.addEventListener("mouseup", () => {
    const now = performance.now();
    const dt = now - mouse.lastMoveTime;

    if (mouse.mode === "orbit" && dt < 20) {
      const m = Math.hypot(spinning.dq.x, spinning.dq.y, spinning.dq.z);
      spinning.active = m > 1e-6;
    } else {
      spinning.active = false;
      spinning.dq = qIdentity();
    }

    mouse.down = false;
  });

  canvas.addEventListener("mouseleave", () => {
    mouse.down = false;
    spinning.active = false;
    spinning.dq = qIdentity();
  });
}

function makePV(canvas){
  const A = canvas.width / canvas.height;
  const P = perspective(50, A, 0.1, 100);
  const eye = camera.getEye();
  const V = lookAt(eye, camera.at, camera.getUp());
  return { P, V };
}

function shadowMatrixPointToPlane(L){
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
  installControls(canvas);

  const ctx    = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode:"opaque" });

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

  const shader = device.createShaderModule({ code: await (await fetch("shader.wgsl")).text() });

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
    if (spinning.active && !mouse.down) camera.q = qNormalize(qMul(camera.q, spinning.dq));

    const {P,V} = makePV(canvas);

    t += 0.015;
    const L = vec3(2*Math.cos(t), 2.0, -2 + 2*Math.sin(t));

    const I = mat4();
    const MVP  = mult(P, mult(V, I));

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

    pass.setPipeline(pipeGround);
    pass.setBindGroup(0, bgGround);
    drawQuad(pass, gPosBuf, gUVBuf, gIdxBuf);

    pass.setPipeline(pipeShadow);
    pass.setBindGroup(0, bgShadow);
    drawQuad(pass, aPosBuf, aUVBuf, aIdxBuf);
    drawQuad(pass, bPosBuf, bUVBuf, bIdxBuf);

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
