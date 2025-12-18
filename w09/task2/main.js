"use strict";

window.onload = () => main();

function f32(a){ return new Float32Array(a); }
function u32(a){ return new Uint32Array(a); }
function mul4(a,b){ return mult(a,b); }

// camera
function makePV(canvas){
  const A = canvas.width / canvas.height;
  const P = perspective(50, A, 0.1, 100);
  const eye = vec3(0, 0.75, 2.0);
  const at  = vec3(0, -0.5, -3.0);
  const up  = vec3(0, 1, 0);
  const V   = lookAt(eye, at, up);
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

  const canvas = document.getElementById("my-canvas");
  const ctx    = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode:"opaque" });

  const bounceToggle = document.getElementById("bounceToggle");
  const lightToggle  = document.getElementById("lightToggle");

  // ---------- Ground quad ----------
  const groundPos = f32([ -2,-1,-1,  2,-1,-1,  2,-1,-5,  -2,-1,-5 ]);
  const groundUV  = f32([ 0,0, 1,0, 1,1, 0,1 ]);
  const groundIdx = u32([ 0,1,2, 0,2,3 ]);

  const makeVBuf = (data) => {
    const b = device.createBuffer({ size:data.byteLength, usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, data);
    return b;
  };
  const makeIBuf = (data) => {
    const b = device.createBuffer({ size:data.byteLength, usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, data);
    return b;
  };

  const gPosBuf = makeVBuf(groundPos);
  const gUVBuf  = makeVBuf(groundUV);
  const gIdxBuf = makeIBuf(groundIdx);

  const img = await loadImageData("../../models-images/xamp23.png");
  const texGround = device.createTexture({
    size:[img.w,img.h],
    format:"rgba8unorm",
    usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST
  });
  device.queue.writeTexture({texture:texGround}, img.data, {bytesPerRow:img.w*4}, [img.w,img.h,1]);

  const sampler = device.createSampler({
    addressModeU:"clamp-to-edge",
    addressModeV:"clamp-to-edge",
    minFilter:"linear",
    magFilter:"linear"
  });

  // ---------- Teapot OBJ ----------
  const teapot = await readOBJFile("../../models-images/teapot.obj", 1.0, true);
  if (!teapot) { alert("Failed to load teapot.obj"); return; }

  const tPos = f32(teapot.vertices);
  const tNrm = f32(teapot.normals);
  const tIdx = u32(teapot.indices);

  const tPosBuf = makeVBuf(tPos);
  const tNrmBuf = makeVBuf(tNrm);
  const tIdxBuf = makeIBuf(tIdx);

  // ---------- Shaders & pipelines ----------
  const shader = device.createShaderModule({ code: await (await fetch("shader.wgsl")).text() });

  const pipeGround = device.createRenderPipeline({
    layout:"auto",
    vertex:{
      module:shader, entryPoint:"vs_ground",
      buffers:[
        { arrayStride:3*4, attributes:[{ shaderLocation:0, offset:0, format:"float32x3" }] },
        { arrayStride:2*4, attributes:[{ shaderLocation:1, offset:0, format:"float32x2" }] },
      ]
    },
    fragment:{ module:shader, entryPoint:"fs_ground", targets:[{ format }] },
    primitive:{ topology:"triangle-list", cullMode:"back" },
    depthStencil:{ format:"depth24plus", depthWriteEnabled:true, depthCompare:"less" },
  });

  const pipeTeapot = device.createRenderPipeline({
    layout:"auto",
    vertex:{
      module:shader, entryPoint:"vs_teapot",
      buffers:[
        { arrayStride:4*4, attributes:[{ shaderLocation:0, offset:0, format:"float32x4" }] },
        { arrayStride:4*4, attributes:[{ shaderLocation:1, offset:0, format:"float32x4" }] },
      ]
    },
    fragment:{ module:shader, entryPoint:"fs_teapot", targets:[{ format }] },
    primitive:{ topology:"triangle-list", cullMode:"back" },
    depthStencil:{ format:"depth24plus", depthWriteEnabled:true, depthCompare:"less" },
  });

  
  const pipeShadow = device.createRenderPipeline({
    layout:"auto",
    vertex:{
      module:shader, entryPoint:"vs_shadow",
      buffers:[
        { arrayStride:4*4, attributes:[{ shaderLocation:0, offset:0, format:"float32x4" }] },
        { arrayStride:4*4, attributes:[{ shaderLocation:1, offset:0, format:"float32x4" }] },
      ]
    },
    fragment:{ module:shader, entryPoint:"fs_shadow", targets:[{ format }] },
    primitive:{ topology:"triangle-list", cullMode:"none" },
    depthStencil:{ format:"depth24plus", depthWriteEnabled:false, depthCompare:"greater" }
  });

  // ---------- Uniforms & bind groups ----------
  const uGround = device.createBuffer({ size:64, usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });
  const bgGround = device.createBindGroup({
    layout: pipeGround.getBindGroupLayout(0),
    entries:[
      { binding:0, resource:{ buffer:uGround } },
      { binding:1, resource:sampler },
      { binding:2, resource:texGround.createView() },
    ]
  });

  
  const uTeapot = device.createBuffer({ size:144, usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });
  const bgTeapot = device.createBindGroup({
    layout: pipeTeapot.getBindGroupLayout(1),
    entries:[ { binding:0, resource:{ buffer:uTeapot } } ]
  });

  // Shadow: mat4 (64)
  const uShadow = device.createBuffer({ size:64, usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });
  const bgShadow = device.createBindGroup({
    layout: pipeShadow.getBindGroupLayout(2),
    entries:[ { binding:0, resource:{ buffer:uShadow } } ]
  });

  const depthTex = device.createTexture({
    size:[canvas.width, canvas.height],
    format:"depth24plus",
    usage:GPUTextureUsage.RENDER_ATTACHMENT
  });

  // ---------- Animation state ----------
  let tTeapot = 0;
  let tLight  = 0;

  function frame(){
    if (bounceToggle.checked) tTeapot += 0.02;
    if (lightToggle.checked)  tLight  += 0.02;

    const { P, V } = makePV(canvas);

    // Light circles around the scene
    const lightCenter = vec3(0, -0.5, -3);
    const L = vec3(
      lightCenter[0] + 3 * Math.cos(tLight),
      lightCenter[1] + 3,
      lightCenter[2] + 3 * Math.sin(tLight)
    );

    // Ground MVP
    const MVPg = mul4(P, mul4(V, mat4()));
    device.queue.writeBuffer(uGround, 0, new Float32Array(flatten(MVPg)));

    // Teapot model (scale 0.25, base translate (0,-1,-3), bounce y:-1..0.5)
    let yOffset = 0.0;
      if (bounceToggle.checked) {
      yOffset = 1.5 * (0.5 * (Math.sin(tTeapot) + 1.0));
    }
    const M = mult( translate(0, -1 + yOffset, -3), scalem(0.25,0.25,0.25) );
    const MVPt = mul4(P, mul4(V, M));

    const pack = new Float32Array(144/4);
    pack.set(new Float32Array(flatten(MVPt)), 0);
    pack.set(new Float32Array(flatten(M)),   16);
    pack.set(new Float32Array([L[0], L[1], L[2], 1.0]), 32);
    device.queue.writeBuffer(uTeapot, 0, pack);

    
    const Ms0 = shadowMatrixPointToPlane(L);
    const Ms  = mult(translate(0, -0.001, 0), Ms0);
    const Mshadow = mult(Ms, M);
    const MVPs = mul4(P, mul4(V, Mshadow));
    device.queue.writeBuffer(uShadow, 0, new Float32Array(flatten(MVPs)));

    // ---------- render ----------
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments:[{
        view: ctx.getCurrentTexture().createView(),
        loadOp:"clear",
        clearValue:{ r:1, g:1, b:1, a:1 },
        storeOp:"store"
      }],
      depthStencilAttachment:{
        view: depthTex.createView(),
        depthLoadOp:"clear",
        depthClearValue:1.0,
        depthStoreOp:"store"
      }
    });

    // 1) ground
    pass.setPipeline(pipeGround);
    pass.setBindGroup(0, bgGround);
    pass.setVertexBuffer(0, gPosBuf);
    pass.setVertexBuffer(1, gUVBuf);
    pass.setIndexBuffer(gIdxBuf, "uint32");
    pass.drawIndexed(groundIdx.length);

    // 2) shadow (restricted to ground)
    pass.setPipeline(pipeShadow);
    pass.setBindGroup(2, bgShadow);
    pass.setVertexBuffer(0, tPosBuf);
    pass.setVertexBuffer(1, tNrmBuf);
    pass.setIndexBuffer(tIdxBuf, "uint32");
    pass.drawIndexed(tIdx.length);

    // 3) teapot
    pass.setPipeline(pipeTeapot);
    pass.setBindGroup(1, bgTeapot);
    pass.setVertexBuffer(0, tPosBuf);
    pass.setVertexBuffer(1, tNrmBuf);
    pass.setIndexBuffer(tIdxBuf, "uint32");
    pass.drawIndexed(tIdx.length);

    pass.end();
    device.queue.submit([enc.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
