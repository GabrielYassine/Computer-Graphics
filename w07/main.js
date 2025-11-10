"use strict";

window.onload = () => main();

// ---------- helpers ----------
const f32 = a => new Float32Array(a);
const u32 = a => new Uint32Array(a);

// Camera with your 90° FOV
function makeCamera(canvas){
  const A = canvas.width / canvas.height;
  const P = perspective(90, A, 0.1, 200);
  const eye = vec3(0, 1.8, 5.5);
  const at  = vec3(0, 0, 0);
  const up  = vec3(0, 1, 0);
  const V   = lookAt(eye, at, up);
  const M   = mat4();   // identity matrix (no rotation)
  const MVP = mult(P, mult(V, M));
  return {P, V, M, MVP, eye};
}

// Mtex = Rcw * inverse(P) : clip → world direction
function makeMtex(P, V){
  const Pinv = inverse(P);
  const R = mat4(
    V[0][0], V[0][1], V[0][2], 0,
    V[1][0], V[1][1], V[1][2], 0,
    V[2][0], V[2][1], V[2][2], 0,
    0, 0, 0, 1
  );
  const Rcw = transpose(R); // inverse of pure rotation
  return mult(Rcw, Pinv);
}

// ---------- sphere geometry ----------
function makeSphere(segments=48, rings=32, r=1.6){
  const pos=[], nrm=[], idx=[];
  for(let y=0;y<=rings;++y){
    const v=y/rings, th=v*Math.PI, ct=Math.cos(th), st=Math.sin(th);
    for(let x=0;x<=segments;++x){
      const u=x/segments, ph=u*2*Math.PI, cp=Math.cos(ph), sp=Math.sin(ph);
      const nx=cp*st, ny=ct, nz=sp*st;
      pos.push(r*nx, r*ny, r*nz);
      nrm.push(nx, ny, nz);
    }
  }
  const stride=segments+1;
  for(let y=0;y<rings;++y){
    for(let x=0;x<segments;++x){
      const i0=y*stride+x, i1=i0+1, i2=i0+stride, i3=i2+1;
      idx.push(i0,i2,i1, i1,i2,i3);
    }
  }
  return {pos:f32(pos), nrm:f32(nrm), idx:u32(idx)};
}

// Load image → RGBA8 Uint8Array
async function loadImageData(url){
  const img = new Image();
  img.src = url; await img.decode();
  const w = img.width, h = img.height;
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const g = cvs.getContext('2d');
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, w, h);
  return { w, h, data };
}

async function main(){
  const gpu = navigator.gpu;
  if (!gpu) { alert('WebGPU not supported'); return; }
  const adapter = await gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const canvas = document.getElementById('my-canvas');
  const context = canvas.getContext('webgpu');
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  // Sphere buffers
  const sph = makeSphere();
  const posBuf = device.createBuffer({size:sph.pos.byteLength, usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const nrmBuf = device.createBuffer({size:sph.nrm.byteLength, usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const idxBuf = device.createBuffer({size:sph.idx.byteLength, usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(posBuf,0,sph.pos);
  device.queue.writeBuffer(nrmBuf,0,sph.nrm);
  device.queue.writeBuffer(idxBuf,0,sph.idx);

  // Background quad in clip space (z near far)
  const zClip = 0.999;
  const qPos = f32([-1,-1,zClip,  1,-1,zClip,  1,1,zClip,  -1,1,zClip]);
  const qNrm = f32([0,0,1, 0,0,1, 0,0,1, 0,0,1]); // dummy
  const qIdx = u32([0,1,2, 0,2,3]);
  const qPosBuf = device.createBuffer({size:qPos.byteLength, usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const qNrmBuf = device.createBuffer({size:qNrm.byteLength, usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const qIdxBuf = device.createBuffer({size:qIdx.byteLength, usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(qPosBuf,0,qPos);
  device.queue.writeBuffer(qNrmBuf,0,qNrm);
  device.queue.writeBuffer(qIdxBuf,0,qIdx);

  // Cubemap (environment)
  const faces = [
    'textures/cm_left.png',
    'textures/cm_right.png',
    'textures/cm_bottom.png',
    'textures/cm_top.png',
    'textures/cm_back.png',
    'textures/cm_front.png'
  ];
  const imgs = await Promise.all(faces.map(loadImageData));
  const W = imgs[0].w, H = imgs[0].h;
  const cubeTex = device.createTexture({
    size:[W,H,6],
    format:'rgba8unorm',
    usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST
  });
  for(let i=0;i<6;++i){
    device.queue.writeTexture(
      {texture:cubeTex, origin:{x:0,y:0,z:i}},
      imgs[i].data,
      {bytesPerRow:W*4, rowsPerImage:H},
      [W,H,1]
    );
  }

  // Normal map (textures/normalmap.png)
  const nm = await loadImageData('textures/normalmap.png');
  const normalTex = device.createTexture({
    size:[nm.w, nm.h, 1],
    format:'rgba8unorm',
    usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST
  });
  device.queue.writeTexture(
    {texture: normalTex},
    nm.data,
    {bytesPerRow: nm.w*4},
    [nm.w, nm.h, 1]
  );

  const sampler = device.createSampler({
    addressModeU:'repeat',       // allow tiling if needed
    addressModeV:'repeat',
    minFilter:'linear', magFilter:'linear', mipmapFilter:'linear'
  });

  const shader = device.createShaderModule({ code: await (await fetch('shader.wgsl')).text() });
  const pipeline = device.createRenderPipeline({
    layout:'auto',
    vertex:{
      module:shader, entryPoint:'vs_main',
      buffers:[
        { arrayStride:3*4, attributes:[{shaderLocation:0, offset:0, format:'float32x3'}] },
        { arrayStride:3*4, attributes:[{shaderLocation:1, offset:0, format:'float32x3'}] }
      ]
    },
    fragment:{ module:shader, entryPoint:'fs_main', targets:[{format}] },
    primitive:{ topology:'triangle-list', cullMode:'back' },
    depthStencil:{ format:'depth24plus', depthWriteEnabled:true, depthCompare:'less' },
  });

  // UBO: mvp(64)+mtex(64)+model(64)+eye(16)+flags(16)=224
  const uSize = (16+16+16+4+4)*4;
  const uBuf  = device.createBuffer({ size:uSize, usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });

  // Bind group includes the normal map at binding(3)
  const bind = device.createBindGroup({
    layout:pipeline.getBindGroupLayout(0),
    entries:[
      {binding:0, resource:{buffer:uBuf}},
      {binding:1, resource:sampler},
      {binding:2, resource:cubeTex.createView({dimension:'cube'})},
      {binding:3, resource:normalTex.createView()},
    ]
  });

  // Depth reuse
  let depthTex=null;
  function ensureDepth(){
    if(!depthTex || depthTex.width!==canvas.width || depthTex.height!==canvas.height){
      depthTex?.destroy?.();
      depthTex = device.createTexture({
        size:[canvas.width, canvas.height],
        format:'depth24plus',
        usage:GPUTextureUsage.RENDER_ATTACHMENT
      });
    }
  }

  const bg = {r:0.3921,g:0.5843,b:0.9294,a:1};

  function writeUBO({MVP, P, V, M, eye}, flagsX, reflective){
    const Mtex = makeMtex(P, V);

    // floats part
    const f = new Float32Array(16+16+16+4); // mvp+mtex+model+eye
    f.set(new Float32Array(flatten(MVP)), 0);
    f.set(new Float32Array(flatten(Mtex)), 16);
    f.set(new Float32Array(flatten(M)),   32);
    f.set(new Float32Array([eye[0],eye[1],eye[2],0]), 48);
    device.queue.writeBuffer(uBuf, 0, f);

    // flags (x: background?, y: reflective?)
    const u = new Uint32Array([flagsX, reflective?1:0, 0, 0]);
    device.queue.writeBuffer(uBuf, (16+16+16+4)*4, u);
  }

  function frame(){
    ensureDepth();

    const cam = makeCamera(canvas);

    // Background
    writeUBO(cam, /*flagsX*/1, /*reflective*/false);
    let enc = device.createCommandEncoder();
    let pass = enc.beginRenderPass({
      colorAttachments:[{
        view:context.getCurrentTexture().createView(),
        loadOp:'clear', clearValue:bg, storeOp:'store'
      }],
      depthStencilAttachment:{
        view:depthTex.createView(),
        depthLoadOp:'clear', depthClearValue:1, depthStoreOp:'store'
      }
    });
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, qPosBuf);
    pass.setVertexBuffer(1, qNrmBuf);
    pass.setIndexBuffer(qIdxBuf, 'uint32');
    pass.setBindGroup(0, bind);
    pass.drawIndexed(6);
    pass.end();
    device.queue.submit([enc.finish()]);

    // Reflective, bump-mapped sphere
    writeUBO(cam, /*flagsX*/0, /*reflective*/true);
    enc = device.createCommandEncoder();
    pass = enc.beginRenderPass({
      colorAttachments:[{
        view:context.getCurrentTexture().createView(),
        loadOp:'load', storeOp:'store'
      }],
      depthStencilAttachment:{
        view:depthTex.createView(),
        depthLoadOp:'load', depthStoreOp:'store'
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
