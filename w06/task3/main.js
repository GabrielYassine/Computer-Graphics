"use strict";

window.onload = () => main();

async function main() {
  const canvas = document.getElementById("my-canvas");

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const shaderCode = await (await fetch("shader.wgsl")).text();
  const shaderModule = device.createShaderModule({ code: shaderCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [
        { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] },
        { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }] }
      ]
    },
    fragment: {
      module: shaderModule,
      entryPoint: "main_fs",
      targets: [{ format }]
    },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }
  });

  const { positions, normals, indices } = createSphere(64, 64);

  const vbuf = device.createBuffer({ size: positions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vbuf, 0, positions);

  const nbuf = device.createBuffer({ size: normals.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(nbuf, 0, normals);

  const ibuf = device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ibuf, 0, indices);

  const img = new Image();
  img.src = "../../models-images/earth.jpg";
  await img.decode();
  const bitmap = await createImageBitmap(img);

  const mips = numMipLevels(bitmap.width, bitmap.height);

  const texture = device.createTexture({
    size: [bitmap.width, bitmap.height, 1],
    format: "rgba8unorm",
    mipLevelCount: mips,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });

  device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture },
    [bitmap.width, bitmap.height]
  );

  generateMipmap(device, texture);

  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear"
  });

  const uniformBuffer = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texture.createView() }
    ]
  });

  let depthTex = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT
  });

  const OPENGL_TO_WGPU = mat4(
    vec4(1,0,0,0),
    vec4(0,1,0,0),
    vec4(0,0,0.5,0.5),
    vec4(0,0,0,1)
  );

  let angle = 0;

  function frame() {
    angle += 0.01;

    const eye = vec3(3 * Math.sin(angle), 0, 3 * Math.cos(angle));
    const V = lookAt(eye, vec3(0,0,0), vec3(0,1,0));
    const P = perspective(45, canvas.width / canvas.height, 0.1, 100);

    const model = mat4();
    const mvp = mult(OPENGL_TO_WGPU, mult(P, mult(V, model)));

    const U = new Float32Array(64);
    U.set(new Float32Array(flatten(mvp)), 0);
    U.set(new Float32Array(flatten(model)), 16);
    U.set(new Float32Array([eye[0], eye[1], eye[2], 1.0]), 32);
    device.queue.writeBuffer(uniformBuffer, 0, U);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 1 }
      }],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthLoadOp: "clear",
        depthClearValue: 1.0,
        depthStoreOp: "store"
      }
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vbuf);
    pass.setVertexBuffer(1, nbuf);
    pass.setIndexBuffer(ibuf, "uint32");
    pass.drawIndexed(indices.length);
    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function createSphere(latBands, lonBands) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (let lat = 0; lat <= latBands; lat++) {
    const theta = lat * Math.PI / latBands;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);

    for (let lon = 0; lon <= lonBands; lon++) {
      const phi = lon * 2 * Math.PI / lonBands;
      const x = Math.cos(phi) * sinT;
      const y = cosT;
      const z = Math.sin(phi) * sinT;

      positions.push(x, y, z, 1);
      normals.push(x, y, z, 0);
    }
  }

  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const a = lat * (lonBands + 1) + lon;
      const b = a + lonBands + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices)
  };
}
