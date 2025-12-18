"use strict";
window.onload = () => main();

async function main() {
  const gpu = navigator.gpu;
  if (!gpu) return;

  const adapter = await gpu.requestAdapter();
  if (!adapter) return;

  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  // --- Shader / pipeline ------------------------------------------------
  
  const shaderCode = await (await fetch("shader.wgsl")).text();
  const shaderModule = device.createShaderModule({ code: shaderCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [
        { arrayStride: 3 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }
      ]
    },
    fragment: {
      module: shaderModule,
      entryPoint: "main_fs",
      targets: [{ format }]
    },
    primitive: {
      topology: "line-list"
    }
  });

  // --- Cube geometry ----------------------------------------------------
  // Unit cube with diagonal from (0,0,0) to (1,1,1)
  const pos = [
    vec3(0.0, 0.0, 1.0), // 0
    vec3(0.0, 1.0, 1.0), // 1
    vec3(1.0, 1.0, 1.0), // 2
    vec3(1.0, 0.0, 1.0), // 3
    vec3(0.0, 0.0, 0.0), // 4
    vec3(0.0, 1.0, 0.0), // 5
    vec3(1.0, 1.0, 0.0), // 6
    vec3(1.0, 0.0, 0.0)  // 7
  ];

  // Wireframe edges (pairs)
  const wireIdx = new Uint32Array([
    0,1, 1,2, 2,3, 3,0,   // top square
    4,5, 5,6, 6,7, 7,4,   // bottom square
    0,4, 1,5, 2,6, 3,7    // vertical edges
  ]);

  const posData = new Float32Array(flatten(pos));
  const posBuffer = device.createBuffer({
    size: posData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(posBuffer, 0, posData);

  const indexBuffer = device.createBuffer({
    size: wireIdx.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(indexBuffer, 0, wireIdx);

  // --- MVP (orthographic + isometric) ----------------------------------
  // WebGPU depth is [0,1], MV.js makes clip-space depth like OpenGL [-1,1]
  // This matrix maps z from [-1,1] -> [0,1]
  const mst = mat4(
    vec4(1,0,0,0),
    vec4(0,1,0,0),
    vec4(0,0,0.5,0.5),
    vec4(0,0,0,1)
  );

  // Center cube at origin (so rotation gives isometric view)
  const centerToOrigin = translate(-0.5, -0.5, -0.5);

  // Isometric rotation (classic): rotateY(45), rotateX(35.264...)
  const isoY = rotateY(45);
  const isoX = rotateX(35.264);

  // Model transform: first center cube at origin, then rotate
  const M = mult(isoX, mult(isoY, centerToOrigin));

  // Simple view: camera looking at origin
  const V = lookAt(vec3(0, 0, 4), vec3(0, 0, 0), vec3(0, 1, 0));

  // Orthographic projection around origin
  const half = 1.5;
  const P = ortho(-half, half, -half, half, 0.1, 10.0);

  const MVP = mult(mst, mult(P, mult(V, M)));

  // Upload MVP
  const uniformBuffer = device.createBuffer({
    size: sizeof["mat4"],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(flatten(MVP)));

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });

  // --- Render -----------------------------------------------------------
  function render() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 } // same background as before
      }]
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, posBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.drawIndexed(wireIdx.length);

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  render();
}
