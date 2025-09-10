"use strict";

async function main() {
  if (!navigator.gpu) {
    alert("WebGPU not supported.");
    return;
  }

  // Adapter and device
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();

  // Canvases and contexts
  const cvsClear = document.getElementById("canvas-dots");
  const cvsTriangle = document.getElementById("canvas-triangle");
  const cvsSquare = document.getElementById("canvas-square");
  const cvsCircle = document.getElementById("canvas-circle");
  const ctxDots = cvsClear.getContext("webgpu");
  const ctxTriangle = cvsTriangle.getContext("webgpu");
  const ctxSquare = cvsSquare.getContext("webgpu");
  const ctxCircle = cvsCircle.getContext("webgpu");
  [ctxDots, ctxTriangle, ctxSquare, ctxCircle].forEach(ctx => ctx.configure({ device, format }));

  // Shader
  const shaderCode = await fetch("shaders.wgsl").then(r => r.text());
  const shaderModule = device.createShaderModule({ code: shaderCode });

  // Common pipeline (triangle-list)
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [
        { arrayStride: 8, attributes: [{ format: "float32x2", offset: 0, shaderLocation: 0 }] },
        { arrayStride: 12, attributes: [{ format: "float32x3", offset: 0, shaderLocation: 1 }] }
      ]
    },
    fragment: { module: shaderModule, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  // ============ Triangle Scene ============

  const triPositions = new Float32Array([
     0.0,  0.75,
    -0.75, -0.75,
     0.75, -0.75,
  ]);
  const triColors = new Float32Array([
    1.0, 0.0, 0.0,
    0.0, 1.0, 0.0,
    0.0, 0.0, 1.0,
  ]);

  const triPosBuf = device.createBuffer({ size: triPositions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const triColBuf = device.createBuffer({ size: triColors.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(triPosBuf, 0, triPositions);
  device.queue.writeBuffer(triColBuf, 0, triColors);
  const triUniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const triBind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: triUniform } }] });

  // identity

  device.queue.writeBuffer(triUniform, 0, new Float32Array([
    1,0,0,0,
    0,1,0,0,
    0,0,1,0,
    0,0,0,1
  ]));

  // ============ Rotating Square Scene ============

  const sqPositions = new Float32Array([
    // two triangles
    -0.5, -0.5,
     0.5, -0.5,
     0.5,  0.5,
    -0.5, -0.5,
     0.5,  0.5,
    -0.5,  0.5,
  ]);
  const sqColors = new Float32Array([
    1,0,0,  0,1,0,  0,0,1,  1,0,0,  0,0,1,  1,1,0
  ]);

  const sqPosBuf = device.createBuffer({ size: sqPositions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const sqColBuf = device.createBuffer({ size: sqColors.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(sqPosBuf, 0, sqPositions);
  device.queue.writeBuffer(sqColBuf, 0, sqColors);
  const sqUniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sqBind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: sqUniform } }] });

  // ============ Bouncing Circle Scene ============

  const numSegments = 64;
  const radius = 0.3;
  const circleVerts = [];
  const circleCols = [];
  for (let i = 0; i < numSegments; ++i) {
    const t0 = (i / numSegments) * 2 * Math.PI;
    const t1 = ((i + 1) / numSegments) * 2 * Math.PI;
    circleVerts.push(0,0,  Math.cos(t0)*radius, Math.sin(t0)*radius,  Math.cos(t1)*radius, Math.sin(t1)*radius);
    circleCols.push(1,1,1,  1,1,1,  1,1,1);
  }
  const cirPositions = new Float32Array(circleVerts);
  const cirColors = new Float32Array(circleCols);
  const cirPosBuf = device.createBuffer({ size: cirPositions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const cirColBuf = device.createBuffer({ size: cirColors.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(cirPosBuf, 0, cirPositions);
  device.queue.writeBuffer(cirColBuf, 0, cirColors);
  const cirUniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const cirBind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: cirUniform } }] });

  // Animation state

  let angle = 0;
  let y = 0.0;
  let dir = 1;
  const speed = 0.005;
  const minY = -0.75;
  const maxY = 0.75;

  function frame() {

    // Update square rotation
    angle += 0.02;
    const c = Math.cos(angle), s = Math.sin(angle);
    device.queue.writeBuffer(sqUniform, 0, new Float32Array([
      c,-s,0,0,
      s, c,0,0,
      0, 0,1,0,
      0, 0,0,1
    ]));

    // Update circle bounce
    y += dir * speed;
    if (y > maxY) { y = maxY; dir = -1; }
    if (y < minY) { y = minY; dir = 1; }
    device.queue.writeBuffer(cirUniform, 0, new Float32Array([
      1,0,0,0,
      0,1,0,0,
      0,0,1,0,
      0,y,0,1
    ]));

    // Render dots

    {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: ctxDots.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0.2, g: 0.2, b: 0.2, a: 1 } }]
      });
      pass.end();
      device.queue.submit([encoder.finish()]);
    }

    // Render triangle

    {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: ctxTriangle.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0.05, g: 0.05, b: 0.1, a: 1 } }]
      });
      pass.setPipeline(pipeline);
      pass.setVertexBuffer(0, triPosBuf);
      pass.setVertexBuffer(1, triColBuf);
      pass.setBindGroup(0, triBind);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    }

    // Render rotating square

    {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: ctxSquare.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0.1, g: 0.1, b: 0.15, a: 1 } }]
      });
      pass.setPipeline(pipeline);
      pass.setVertexBuffer(0, sqPosBuf);
      pass.setVertexBuffer(1, sqColBuf);
      pass.setBindGroup(0, sqBind);
      pass.draw(6);
      pass.end();
      device.queue.submit([encoder.finish()]);
    }

    // Render bouncing circle
    
    {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: ctxCircle.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0.1, g: 0.12, b: 0.18, a: 1 } }]
      });
      pass.setPipeline(pipeline);
      pass.setVertexBuffer(0, cirPosBuf);
      pass.setVertexBuffer(1, cirColBuf);
      pass.setBindGroup(0, cirBind);
      pass.draw(cirPositions.length / 2);
      pass.end();
      device.queue.submit([encoder.finish()]);
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

window.onload = main;
