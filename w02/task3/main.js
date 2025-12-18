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

  const COLORS = [
    { r: 0, g: 0, b: 0 },
    { r: 1, g: 0, b: 0 },
    { r: 1, g: 1, b: 0 },
    { r: 0, g: 1, b: 0 },
    { r: 0, g: 0, b: 1 },
    { r: 1, g: 0, b: 1 },
    { r: 0, g: 1, b: 1 },
    { r: 0.3921, g: 0.5843, b: 0.9294 }
  ];

  const drawSel = document.getElementById("drawColor");
  const clearSel = document.getElementById("clearColor");
  const clearBtn = document.getElementById("clearBtn");

  const btnPoint = document.getElementById("modePoint");
  const btnTri = document.getElementById("modeTriangle");

  let mode = "point";
  function setMode(m) {
    mode = m;
    btnPoint.classList.remove("active");
    btnTri.classList.remove("active");
    if (m === "point") btnPoint.classList.add("active");
    else btnTri.classList.add("active");
  }
  btnPoint.onclick = () => setMode("point");
  btnTri.onclick = () => setMode("triangle");

  function getDrawColor() {
    const c = COLORS[drawSel.selectedIndex] || COLORS[0];
    return vec3(c.r, c.g, c.b);
  }

  function getClearColor() {
    const idx = clearSel.selectedIndex;
    const c = COLORS[idx] || COLORS[7];
    return { r: c.r, g: c.g, b: c.b, a: 1.0 };
  }

  function toNDC(ev) {
    const r = canvas.getBoundingClientRect();
    const x = 2 * (ev.clientX - r.left) / canvas.width - 1;
    const y = 2 * (canvas.height - (ev.clientY - r.top)) / canvas.height - 1;
    return vec2(x, y);
  }

  const pointSize = 20 * (2 / canvas.height);

  function makePoint(center, col, size) {
    const h = size / 2;
    const x = center[0], y = center[1];
    const p0 = vec2(x - h, y - h), p1 = vec2(x + h, y - h);
    const p2 = vec2(x - h, y + h), p3 = vec2(x + h, y + h);
    return {
      positions: [p0, p1, p2, p2, p1, p3],
      colors:    [col, col, col, col, col, col]
    };
  }

  const shapes = [];

  const pendingTri = [];

  let posBuffer = null;
  let colBuffer = null;
  let vertCount = 0;

  function rebuildBuffers() {
    const positions = [];
    const colors = [];

    
    for (const s of shapes) {
      if (s.type === "point") {
        const o = makePoint(s.center, s.color, pointSize);
        positions.push(...o.positions);
        colors.push(...o.colors);
      } else {
        
        positions.push(s.p0, s.p1, s.p2);
        colors.push(s.c0, s.c1, s.c2);
      }
    }
    
    if (pendingTri.length) {
      for (const v of pendingTri) {
        const o = makePoint(v.p, v.c, pointSize);
        positions.push(...o.positions);
        colors.push(...o.colors);
      }
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
        clearValue: getClearColor()
      }]
    });

    if (shapes.length || pendingTri.length) {
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
    const p = toNDC(ev);
    const c = getDrawColor();

    if (mode === "point") {
      shapes.push({ type: "point", center: p, color: c });
      render();
      return;
    }

    
    pendingTri.push({ p, c });

    if (pendingTri.length === 3) {
      shapes.push({
        type: "triangle",
        p0: pendingTri[0].p, p1: pendingTri[1].p, p2: pendingTri[2].p,
        c0: pendingTri[0].c, c1: pendingTri[1].c, c2: pendingTri[2].c
      });
      pendingTri.length = 0;
    }

    render();
  });

  clearBtn.addEventListener("click", () => {
    shapes.length = 0;
    pendingTri.length = 0;
    render();
  });

  clearSel.addEventListener("change", () => render());

  render();
}
