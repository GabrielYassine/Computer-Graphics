"use strict";

window.onload = () => main();

function f32(a){ return new Float32Array(a); }
function u32(a){ return new Uint32Array(a); }

// camera
function makePV(canvas){
  const A = canvas.width / canvas.height;
  const P = perspective(50, A, 0.1, 100);
  const eye = vec3(0, 0, 1.5);
  const at  = vec3(0, 0, -3);
  const up  = vec3(0, 1, 0);
  const V   = lookAt(eye, at, up);
  return {P, V};
}
function mul4(a,b){ return mult(a,b); }

// planar shadow matrix onto y = -1  (plane y+1=0 : a,b,c,d = 0,1,0,1)
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

  // geometry
  const groundPos = f32([ -2,-1,-1,  2,-1,-1,  2,-1,-5,  -2,-1,-5 ]);
  const groundUV  = f32([ 0,0, 1,0, 1,1, 0,1 ]);
  const groundIdx = u32([ 0,1,2, 0,2,3 ]);

  const aPos = f32([ 0.25,-0.5,-1.25,  0.75,-0.5,-1.25,  0.75,-0.5,-1.75,  0.25,-0.5,-1.75 ]);
  const aUV  = f32([ 0,0, 1,0, 1,1, 0,1 ]);
  const aIdx = u32([ 0,1,2, 0,2,3 ]);

  const bPos = f32([ -1,-1,-2.5,  -1,-1,-3.0,  -1, 0,-3.0,  -1, 0,-2.5 ]);
  const bUV  = f32([ 0,0, 1,0, 1,1, 0,1 ]);
  const bIdx = u32([ 0,1,2, 0,2,3 ]);

  const makeVBuf = d => { const b=device.createBuffer({size:d.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}); device.queue.writeBuffer(b,0,d); return b; };
  const makeIBuf = d => { const b=device.createBuffer({size:d.byteLength,usage:GPUBufferUsage.INDEX |GPUBufferUsage.COPY_DST}); device.queue.writeBuffer(b,0,d); return b; };

  const gPosBuf = makeVBuf(groundPos), gUVBuf = makeVBuf(groundUV), gIdxBuf = makeIBuf(groundIdx);
  const aPosBuf = makeVBuf(aPos),     aUVBuf = makeVBuf(aUV),       aIdxBuf = makeIBuf(aIdx);
  const bPosBuf = makeVBuf(bPos),     bUVBuf = makeVBuf(bUV),       bIdxBuf = makeIBuf(bIdx);

  // textures
  const img = await loadImageData("xamp23.png");
  const texGround = device.createTexture({ size:[img.w,img.h], format:"rgba8unorm", usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({texture:texGround}, img.data, {bytesPerRow:img.w*4}, [img.w,img.h,1]);

  const texRed = device.createTexture({ size:[1,1], format:"rgba8unorm", usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({texture:texRed}, new Uint8Array([255,0,0,255]), {bytesPerRow:4}, [1,1,1]);

  const sampler = device.createSampler({ addressModeU:"clamp-to-edge", addressModeV:"clamp-to-edge", minFilter:"linear", magFilter:"linear" });

  // pipelines
  const shader = device.createShaderModule({ code: await (await fetch("shader.wgsl")).text() });

  const pipeNormal = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "vs_main",
      buffers: [
        { arrayStride: 3*4, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
        { arrayStride: 2*4, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }] },
      ]},
    fragment: { module: shader, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: { format:"depth24plus", depthWriteEnabled:true, depthCompare:"less" },
  });

  // SHADOW pipeline: depth test "greater", no culling, no depth write, BLENDING enabled
  const pipeShadow = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "vs_main",
      buffers: [
        { arrayStride: 3*4, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
        { arrayStride: 2*4, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }] },
      ]},
    fragment: {
      module: shader, entryPoint: "fs_main",
      targets: [{
        format,
        blend: {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one",       dstFactor: "one-minus-src-alpha", operation: "add" }
        }
      }]
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format:"depth24plus",
      depthWriteEnabled:false,
      depthCompare:"greater"
    },
  });

  // UBOs & bind groups  (UBO = mat4 + vec4)
  function makeUBuf(){ return device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); }
  const uGround = makeUBuf();   // vis=(1,1)
  const uRed    = makeUBuf();   // vis=(1,1)
  const uShadow = makeUBuf();   // vis=(0,0.6)

  const bgGround = device.createBindGroup({ layout: pipeNormal.getBindGroupLayout(0),
    entries:[ {binding:0,resource:{buffer:uGround}}, {binding:1,resource:sampler}, {binding:2,resource:texGround.createView()} ]});
  const bgRed    = device.createBindGroup({ layout: pipeNormal.getBindGroupLayout(0),
    entries:[ {binding:0,resource:{buffer:uRed}},    {binding:1,resource:sampler}, {binding:2,resource:texRed.createView()}    ]});
  const bgShadow = device.createBindGroup({ layout: pipeShadow.getBindGroupLayout(0),
    entries:[ {binding:0,resource:{buffer:uShadow}}, {binding:1,resource:sampler}, {binding:2,resource:texRed.createView()}    ]});

  // depth target reuse
  let depthTex=null;
  function ensureDepth(){
    if(!depthTex || depthTex.width!==canvas.width || depthTex.height!==canvas.height){
      depthTex?.destroy?.();
      depthTex = device.createTexture({ size:[canvas.width,canvas.height], format:"depth24plus", usage:GPUTextureUsage.RENDER_ATTACHMENT });
    }
  }

  // animate + draw
  let t = 0;
  const clear = {r:1,g:1,b:1,a:1};

  function frame(){
    ensureDepth();

    // light circle around (0,2,-2), radius 2
    t += 0.015;
    const L = vec3( 2*Math.cos(t), 2.0, -2 + 2*Math.sin(t) );

    const {P,V} = makePV(canvas);
    const I = mat4();

    // ground
    {
      const MVP = mul4(P, mul4(V, I));
      device.queue.writeBuffer(uGround, 0, new Float32Array(flatten(MVP)));
      device.queue.writeBuffer(uGround, 64, new Float32Array([1,1,0,0])); // vis=(1,1)
    }

    // shadows (project slightly BELOW ground so depthCompare: "greater" passes)
    const Ms = mult( translate(0, -0.001, 0), shadowMatrixPointToPlane(L) );
    const MVPs = mul4(P, mul4(V, Ms));
    device.queue.writeBuffer(uShadow, 0, new Float32Array(flatten(MVPs)));
    device.queue.writeBuffer(uShadow, 64, new Float32Array([0,0.6,0,0])); // black with alpha 0.6

    // red quads
    {
      const MVP = mul4(P, mul4(V, I));
      device.queue.writeBuffer(uRed, 0, new Float32Array(flatten(MVP)));
      device.queue.writeBuffer(uRed, 64, new Float32Array([1,1,0,0])); // vis=(1,1)
    }

    // render
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments:[{ view:ctx.getCurrentTexture().createView(), loadOp:"clear", clearValue:clear, storeOp:"store" }],
      depthStencilAttachment:{ view:depthTex.createView(), depthLoadOp:"clear", depthClearValue:1, depthStoreOp:"store" }
    });

    // 1) ground
    pass.setPipeline(pipeNormal);
    pass.setBindGroup(0, bgGround);
    pass.setVertexBuffer(0, gPosBuf); pass.setVertexBuffer(1, gUVBuf); pass.setIndexBuffer(gIdxBuf, "uint32");
    pass.drawIndexed(6);

    // 2) semi-transparent shadows
    pass.setPipeline(pipeShadow);
    pass.setBindGroup(0, bgShadow);
    pass.setVertexBuffer(0, aPosBuf); pass.setVertexBuffer(1, aUVBuf); pass.setIndexBuffer(aIdxBuf, "uint32");
    pass.drawIndexed(6);
    pass.setVertexBuffer(0, bPosBuf); pass.setVertexBuffer(1, bUVBuf); pass.setIndexBuffer(bIdxBuf, "uint32");
    pass.drawIndexed(6);

    // 3) red quads
    pass.setPipeline(pipeNormal);
    pass.setBindGroup(0, bgRed);
    pass.setVertexBuffer(0, aPosBuf); pass.setVertexBuffer(1, aUVBuf); pass.setIndexBuffer(aIdxBuf, "uint32");
    pass.drawIndexed(6);
    pass.setVertexBuffer(0, bPosBuf); pass.setVertexBuffer(1, bUVBuf); pass.setIndexBuffer(bIdxBuf, "uint32");
    pass.drawIndexed(6);

    pass.end();
    device.queue.submit([enc.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
