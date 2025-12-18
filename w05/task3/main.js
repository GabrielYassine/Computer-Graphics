"use strict";

window.onload = () => main();

async function main() {
  const canvas = document.getElementById("my-canvas");

  const gpu = navigator.gpu;
  if (!gpu) return;

  const adapter = await gpu.requestAdapter();
  if (!adapter) return;

  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const shaderCode = await (await fetch("shader.wgsl")).text();
  const shaderModule = device.createShaderModule({ code: shaderCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [
        { arrayStride: 4 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] },
        { arrayStride: 4 * 4, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }] }
      ]
    },
    fragment: { module: shaderModule, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }
  });

  const uniformBuffer = device.createBuffer({
    size: 16 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });

  const depthTex = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT
  });

  const OPENGL_TO_WGPU = mat4(
    vec4(1, 0, 0, 0),
    vec4(0, 1, 0, 0),
    vec4(0, 0, 0.5, 0.5),
    vec4(0, 0, 0, 1)
  );

  const objPath = "../../models-images/pacman.obj";
  const drawingInfo = await readOBJFile(objPath, 1.0, true);

  if (!drawingInfo || !drawingInfo.vertices || !drawingInfo.indices) return;

  const verts = drawingInfo.vertices;
  const cols = drawingInfo.colors;
  const inds = drawingInfo.indices;

  const vbuf = device.createBuffer({
    size: verts.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(vbuf, 0, verts);

  const cbuf = device.createBuffer({
    size: cols.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(cbuf, 0, cols);

  const ibuf = device.createBuffer({
    size: inds.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(ibuf, 0, inds);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < verts.length; i += 4) {
    const x = verts[i + 0], y = verts[i + 1], z = verts[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  const radius = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);
  const s = 1.0 / Math.max(radius, 1e-6);

  const T = translate(-cx, -cy, -cz);
  const S = scalem(s, s, s);
  const R = rotateY(45);
  const M = mult(R, mult(S, T));

  const eye = vec3(0, 0, 3);
  const at = vec3(0, 0, 0);
  const up = vec3(0, 1, 0);

  const V = lookAt(eye, at, up);
  const P = perspective(45, canvas.width / canvas.height, 0.1, 100.0);

  const MVP = mult(OPENGL_TO_WGPU, mult(P, mult(V, M)));
  device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(flatten(MVP)));

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 }
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
  pass.setVertexBuffer(1, cbuf);
  pass.setIndexBuffer(ibuf, "uint32");
  pass.drawIndexed(inds.length);
  pass.end();

  device.queue.submit([encoder.finish()]);
}
