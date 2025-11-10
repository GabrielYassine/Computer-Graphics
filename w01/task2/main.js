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

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex:   {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [{
        arrayStride: sizeof["vec2"],
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }]
      }]
    },
    fragment: { module: shaderModule, entryPoint: "main_fs", targets: [{ format }] },
    primitive:{ topology: "triangle-list" }
  });

  const size = 20 * (2 / canvas.height);
  const positions = [];
  addPoint(positions, vec2( 0.0,  0.0), size);
  addPoint(positions, vec2( 1.0,  0.0), size);
  addPoint(positions, vec2( 1.0,  1.0), size);

  const positionData   = flatten(positions);
  const positionBuffer = device.createBuffer({
    size: positionData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(positionBuffer, 0, positionData);

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
  pass.setVertexBuffer(0, positionBuffer);
  pass.draw(positions.length);
  pass.end();

  device.queue.submit([encoder.finish()]);

  function addPoint(arr, c, s) {
    const h = s / 2;
    const p0 = vec2(c[0] - h, c[1] - h);
    const p1 = vec2(c[0] + h, c[1] - h);
    const p2 = vec2(c[0] - h, c[1] + h);
    const p3 = vec2(c[0] + h, c[1] + h);
    arr.push(p0, p1, p2,  p2, p1, p3);
  }
}
