"use strict";

window.onload = () => main();

function f32(a){ return new Float32Array(a); }
function u32(a){ return new Uint32Array(a); }
function mul4(a,b){ return mult(a,b); }

function makePV(canvas){
  const A = canvas.width / canvas.height;
  const P = perspective(50, A, 0.1, 100);
  const eye = vec3(0, 0.75, 2.0);
  const at  = vec3(0, -0.5, -3.0);
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

async function main(){
  if (!("gpu" in navigator)) { alert("WebGPU not supported"); return; }

  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const canvas = document.getElementById("gpu-canvas");
  const ctx    = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode:"opaque" });

  const bounceToggle = document.getElementById("bounceToggle");

  // ---------- Ground quad (W8 P3) ----------
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

  // ---------- Teapot OBJ (W5 P3) ----------
  const teapot = await readOBJFile("../../models-images/teapot.obj", 1.0, true);
  if (!teapot) { alert("Failed to load teapot.obj"); return; }

  const tPos = f32(teapot.vertices);
  const tNrm = f32(teapot.normals);
  const tIdx = u32(teapot.indices);

  const tPosBuf = device.createBuffer({ size:tPos.byteLength, usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(tPosBuf, 0, tPos);

  const tNrmBuf = device.createBuffer({ size:tNrm.byteLength, usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(tNrmBuf, 0, tNrm);

  const tIdxBuf = device.createBuffer({ size:tIdx.byteLength, usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(tIdxBuf, 0, tIdx);

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

  // ---------- Uniforms ----------
  const uGround = device.createBuffer({ size:64, usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });

  const uTeapot = device.createBuffer({ size:144, usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });

  const bgGround = device.createBindGroup({
    layout: pipeGround.getBindGroupLayout(0),
    entries:[
      { binding:0, resource:{ buffer:uGround } },
      { binding:1, resource:sampler },
      { binding:2, resource:texGround.createView() },
    ]
  });

  const bgTeapot = device.createBindGroup({
    layout: pipeTeapot.getBindGroupLayout(1),
    entries:[ { binding:0, resource:{ buffer:uTeapot } } ]
  });

  const depthTex = device.createTexture({
    size:[canvas.width, canvas.height],
    format:"depth24plus",
    usage:GPUTextureUsage.RENDER_ATTACHMENT
  });

  // ---------- Draw loop ----------
  let t = 0;

  function frame(){
    t += 0.02;

    const { P, V } = makePV(canvas);

    // light circles the scene
    const light = vec3(
      2.0 * Math.cos(t),
      2.0,
      -3.0 + 2.0 * Math.sin(t)
    );

    // ground MVP
    const MVPg = mul4(P, mul4(V, mat4()));
    device.queue.writeBuffer(uGround, 0, new Float32Array(flatten(MVPg)));

    // teapot model: scale 0.25, translate (0,-1,-3), optional bounce y:-1..0.5
    let yOffset = 0.0;
    if (bounceToggle.checked) {
      yOffset = 1.5 * (0.5 * (Math.sin(t) + 1.0));
    }
    const M = mult( translate(0, -1 + yOffset, -3), scalem(0.25,0.25,0.25) );
    const MVPt = mul4(P, mul4(V, M));

    const pack = new Float32Array(144/4);
    pack.set(new Float32Array(flatten(MVPt)), 0);
    pack.set(new Float32Array(flatten(M)),   16);
    pack.set(new Float32Array([light[0], light[1], light[2], 1.0]), 32);
    device.queue.writeBuffer(uTeapot, 0, pack);

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

    // ground
    pass.setPipeline(pipeGround);
    pass.setBindGroup(0, bgGround);
    pass.setVertexBuffer(0, gPosBuf);
    pass.setVertexBuffer(1, gUVBuf);
    pass.setIndexBuffer(gIdxBuf, "uint32");
    pass.drawIndexed(groundIdx.length);

    // teapot
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
