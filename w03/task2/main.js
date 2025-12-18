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

  // ---------- Shader + pipeline ----------
  const shaderCode = await (await fetch("shader.wgsl")).text();
  const shaderModule = device.createShaderModule({ code: shaderCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [
        {
          arrayStride: 3 * 4,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }]
        }
      ]
    },
    fragment: {
      module: shaderModule,
      entryPoint: "main_fs",
      targets: [{ format }]
    },
    primitive: { topology: "line-list" }
  });

  // ---------- Cube geometry ----------
  const positions = [
    vec3(0,0,1), vec3(0,1,1), vec3(1,1,1), vec3(1,0,1),
    vec3(0,0,0), vec3(0,1,0), vec3(1,1,0), vec3(1,0,0)
  ];

  const indices = new Uint32Array([
    0,1, 1,2, 2,3, 3,0,
    4,5, 5,6, 6,7, 7,4,
    0,4, 1,5, 2,6, 3,7
  ]);

  const posBuffer = device.createBuffer({
    size: flatten(positions).byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(posBuffer, 0, new Float32Array(flatten(positions)));

  const idxBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(idxBuffer, 0, indices);

  // ---------- Uniform buffer (3 MVP matrices) ----------
  const uniformBuffer = device.createBuffer({
    size: 3 * 16 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });

  // ---------- Projection selection ----------
  const projectionMenu = document.getElementById("projectionMode");

  function makeProjection() {
    const aspect = canvas.width / canvas.height;

    if (projectionMenu.value === "Perspective") {
      // REQUIRED for task 2
      return perspective(45, aspect, 0.1, 100.0);
    }

    // Orthographic option kept (same style as your earlier solution)
    const s = 3;
    return ortho(-s, s, -s, s, 0.1, 100.0);
  }

  // WebGPU depth correction (MV.js uses OpenGL style depth)
  const mst = mat4(
    vec4(1,0,0,0),
    vec4(0,1,0,0),
    vec4(0,0,0.5,0.5),
    vec4(0,0,0,1)
  );

  function updateMVPs() {
    const P = makeProjection();
    const V = lookAt(vec3(0, 0, 6), vec3(0, 0, 0), vec3(0, 1, 0));

    // ----- Three required views -----

    // one-point (front)
    const M1 = translate(-2.2, 0, -6);

    // two-point (X)
    const M2 = mult(translate(0, 0, -6), rotateY(45));

    // three-point
    const M3 = mult(
      translate(2.2, 0, -6),
      mult(rotateX(35), rotateY(45))
    );

    const MVP1 = mult(mst, mult(P, mult(V, M1)));
    const MVP2 = mult(mst, mult(P, mult(V, M2)));
    const MVP3 = mult(mst, mult(P, mult(V, M3)));

    device.queue.writeBuffer(
      uniformBuffer,
      0,
      new Float32Array([
        ...flatten(MVP1),
        ...flatten(MVP2),
        ...flatten(MVP3)
      ])
    );
  }

  // ---------- Render ----------
  function render() {
    updateMVPs();

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 }
      }]
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, posBuffer);
    pass.setIndexBuffer(idxBuffer, "uint32");

    // draw cube 3 times
    pass.drawIndexed(indices.length, 3);

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  projectionMenu.addEventListener("change", render);
  render();
}
