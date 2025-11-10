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
    vec2(0.0, 0.0),
    vec2(1.0, 0.0),
    vec2(1.0, 1.0),
  ];
  const posData = flatten(positions);

  const posBuffer = device.createBuffer({
    size: posData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(posBuffer, 0, posData);

  const colors = [
    vec3(1.0, 0.0, 0.0),
    vec3(0.0, 1.0, 0.0),
    vec3(0.0, 0.0, 1.0),
  ];
  const colData = flatten(colors);

  const colBuffer = device.createBuffer({
    size: colData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(colBuffer, 0, colData);

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [
        {
          arrayStride: sizeof["vec2"],
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }]
        },
        {
          arrayStride: sizeof["vec3"],
          attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }]
        }
      ]
    },
    fragment: {
      module: shaderModule,
      entryPoint: "main_fs",
      targets: [{ format }]
    },
    primitive: { topology: "triangle-list" }
  });

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
  pass.setVertexBuffer(0, posBuffer);
  pass.setVertexBuffer(1, colBuffer);
  pass.draw(3);
  pass.end();

  device.queue.submit([encoder.finish()]);
}
