"use strict";

window.onload = () => main();

// ---------- helpers ----------
function fail(msg){ throw new Error(msg); }
function toFloat32(arr){ return (arr instanceof Float32Array) ? arr : new Float32Array(arr); }
function toUint32(arr){ return (arr instanceof Uint32Array) ? arr : new Uint32Array(arr); }

function makeMVP(canvas, yawDeg) {
  const eye = vec3(0, 1.5, 4);
  const at  = vec3(0, 1, 0);
  const up  = vec3(0, 1, 0);
  const V   = lookAt(eye, at, up);
  const A   = canvas.width / canvas.height;
  const P   = perspective(45, A, 0.1, 100);
  const M   = rotateY(yawDeg);
  return mult(P, mult(V, M));
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

  const orbit = document.getElementById('orbit');

  const info = await readOBJFile('pacman.obj', 1.0, false);
  if (!info) fail('Could not load OBJ (check paths / CORS)');

  const posData = toFloat32(info.vertices);
  const nrmData = toFloat32(info.normals);
  const colData = toFloat32(info.colors);
  const idxData = toUint32(info.indices);

  function makeVBuf(data){
    const buf = device.createBuffer({size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(buf, 0, data);
    return buf;
  }
  const posBuf = makeVBuf(posData);
  const nrmBuf = makeVBuf(nrmData);
  const colBuf = makeVBuf(colData);

  const idxBuf = device.createBuffer({size: idxData.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(idxBuf, 0, idxData);

  const shaderCode = await (await fetch("shader.wgsl")).text();
  const shader = device.createShaderModule({ code: shaderCode });

  const vtxStride = 4 * 4;
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shader, entryPoint: 'vs_main',
      buffers: [
        { arrayStride: vtxStride, attributes: [{shaderLocation:0, offset:0, format:'float32x4'}] },
        { arrayStride: vtxStride, attributes: [{shaderLocation:1, offset:0, format:'float32x4'}] },
        { arrayStride: vtxStride, attributes: [{shaderLocation:2, offset:0, format:'float32x4'}] },
      ]
    },
    fragment: {
      module: shader, entryPoint: 'fs_main',
      targets: [{format}]
    },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
  });

  // 16 floats for mat4 + 4 for eye_pad + 4 for light_sh = 24 floats * 4 bytes = 96 bytes
  const uSize = (16 + 4 + 4) * 4;
  const uBuf  = device.createBuffer({size: uSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
  const bind  = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{binding:0, resource:{buffer:uBuf}}]
  });

  function makeDepth(){ 
    return device.createTexture({size:[canvas.width, canvas.height], format:'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT});
  }
  let depthTex = makeDepth();

  let yaw = 0;
  function frame(){
    if (depthTex.width !== canvas.width || depthTex.height !== canvas.height) depthTex = makeDepth();

    if (orbit.checked) yaw += 0.5;
    const mvp = makeMVP(canvas, yaw);

    // eye must match the one used in makeMVP()
    const eye = vec3(0, 1.5, 4);


    // Light coming from above and a bit toward camera
    const lightDir = [0.0, -1.0, 0.5]; // remember shader uses -lightDir in the dot
    const shininess = 48.0;

    const uData = new Float32Array(16 + 4 + 4);
    uData.set(Array.from(flatten(mvp)), 0);          // 0..15
    uData.set([eye[0], eye[1], eye[2], 0.0], 16);    // 16..19
    uData.set([lightDir[0], lightDir[1], lightDir[2], shininess], 20); // 20..23
    device.queue.writeBuffer(uBuf, 0, uData);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear',
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1 },
        storeOp: 'store'
      }],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'store'
      }
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, posBuf);
    pass.setVertexBuffer(1, nrmBuf);
    pass.setVertexBuffer(2, colBuf);
    pass.setIndexBuffer(idxBuf, 'uint32');
    pass.setBindGroup(0, bind);
    pass.drawIndexed(idxData.length);
    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
