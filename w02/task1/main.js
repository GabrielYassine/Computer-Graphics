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
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [
        { arrayStride: sizeof["vec2"], attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] },
        { arrayStride: sizeof["vec3"], attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] }
      ]
    },
    fragment: { module: shaderModule, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" }
  });

  const drawColor = vec3(0, 0, 0);
  const clearColor = { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 };

  const points = [];

  const pointSize = 20 * (2 / canvas.height);

  function toNDC(ev) {
    const r = canvas.getBoundingClientRect();
    const x = 2 * (ev.clientX - r.left) / canvas.width - 1;
    const y = 2 * (canvas.height - (ev.clientY - r.top)) / canvas.height - 1;
    return vec2(x, y);
  }

  function makePoint(pos, col, size) {
    const h = size / 2;
    const x = pos[0], y = pos[1];
    const p0 = vec2(x - h, y - h), p1 = vec2(x + h, y - h);
    const p2 = vec2(x - h, y + h), p3 = vec2(x + h, y + h);
    return {
      positions: [p0, p1, p2, p2, p1, p3],
      colors:    [col, col, col, col, col, col]
    };
  }

  let posBuffer = null, colBuffer = null, vertCount = 0;

  function rebuildBuffers() {
    const positions = [];
    const colors = [];

    for (const p of points) {
      const o = makePoint(p, drawColor, pointSize);
      positions.push(...o.positions);
      colors.push(...o.colors);
    }

    vertCount = positions.length;

    const posData = flatten(positions);
    const colData = flatten(colors);

    posBuffer = device.createBuffer({
      size: posData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(posBuffer, 0, posData);

    colBuffer = device.createBuffer({
      size: colData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(colBuffer, 0, colData);
  }

  function render() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: clearColor
      }]
    });

    if (points.length) {
      rebuildBuffers();
      pass.setPipeline(pipeline);
      pass.setVertexBuffer(0, posBuffer);
      pass.setVertexBuffer(1, colBuffer);
      pass.draw(vertCount);
    }

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  canvas.addEventListener("click", (ev) => {
    points.push(toNDC(ev));
    render();
  });

  render();
}
