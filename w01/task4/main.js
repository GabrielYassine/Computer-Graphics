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

  const shaderCode = await (await fetch("shader.wgsl")).text();
  const shaderModule = device.createShaderModule({ code: shaderCode });

  const positions = [
    vec2(-0.5, -0.5), vec2( 0.5, -0.5), vec2(-0.5,  0.5),
    vec2(-0.5,  0.5), vec2( 0.5, -0.5), vec2( 0.5,  0.5),
  ];
  const posData = flatten(positions);
  const posBuffer = device.createBuffer({
    size: posData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(posBuffer, 0, posData);

  const uniformBytes = 4 * sizeof["vec4"];
  const uniformArray = new ArrayBuffer(uniformBytes);
  const f32 = new Float32Array(uniformArray);
  const uniformBuffer = device.createBuffer({
    size: uniformArray.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule, entryPoint: "main_vs",
      buffers: [{
        arrayStride: sizeof["vec2"],
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }]
      }]
    },
    fragment: {
      module: shaderModule, entryPoint: "main_fs",
      targets: [{ format }]
    },
    primitive: { topology: "triangle-list" }
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });

  let theta = 0.0;
  let lastTime = performance.now();
  function frame(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    theta += dt;
    f32[0] = theta;
    device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp:  "clear",
        storeOp: "store",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 }
      }]
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);

    pass.setVertexBuffer(0, posBuffer);
    pass.draw(6);
    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
