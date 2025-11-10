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
      module: shaderModule, entryPoint: "main_vs",
      buffers: [
        { arrayStride: sizeof["vec2"], attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] },
        { arrayStride: sizeof["vec3"], attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] }
      ]
    },
    fragment: { module: shaderModule, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" }
  });

  const COLORS = [
    {r:0,g:0,b:0},{r:1,g:0,b:0},{r:1,g:1,b:0},
    {r:0,g:1,b:0},{r:0,g:0,b:1},{r:1,g:0,b:1},
    {r:0,g:1,b:1},{r:0.3921,g:0.5843,b:0.9294}
  ];

  const drawSel = document.getElementById("drawColor");
  const clearSel = document.getElementById("clearColor");
  const clearBtn = document.getElementById("clearBtn");
  const btnPoint = document.getElementById("modePoint");
  const btnTri = document.getElementById("modeTriangle");
  const btnCirc = document.getElementById("modeCircle");

  let mode = "point";
  function setMode(m) {
    mode = m;
    btnPoint.classList.remove("active");
    btnTri.classList.remove("active");
    btnCirc.classList.remove("active");
    if (m === "point") btnPoint.classList.add("active");
    else if (m === "triangle") btnTri.classList.add("active");
    else btnCirc.classList.add("active");
  }
  btnPoint.onclick = () => setMode("point");
  btnTri.onclick = () => setMode("triangle");
  btnCirc.onclick = () => setMode("circle");

  const shapes = [];
  const pendingTri = [];
  let circleCenter = null, circleCenterColor = null;

  function toNDC(ev){
    const r = canvas.getBoundingClientRect();
    const x = 2*(ev.clientX - r.left)/canvas.width - 1;
    const y = 2*(canvas.height - (ev.clientY - r.top))/canvas.height - 1;
    return vec2(x,y);
  }
  function getColor(sel){ 
    const c = COLORS[sel.selectedIndex] || COLORS[0]; 
    return vec3(c.r, c.g, c.b); 
  }
  const pointSize = 20 * (2/canvas.height);

  function makePoint(pos, col, size){
    const h = size/2;
    const x = pos[0], y = pos[1];
    const p0 = vec2(x-h, y-h), p1 = vec2(x+h, y-h);
    const p2 = vec2(x-h, y+h), p3 = vec2(x+h, y+h);
    return { positions: [p0, p1, p2, p2, p1, p3], colors: [col, col, col, col, col, col] };
  }

  function makeCircle(center, r, cCenter, cRim){
    const positions = [], colors = [];
    const segments = 64;
    for(let i = 0; i < segments; i++){
      const a0 = 2*Math.PI*i/segments;
      const a1 = 2*Math.PI*(i+1)/segments;
      const p0 = vec2(center[0] + r*Math.cos(a0), center[1] + r*Math.sin(a0));
      const p1 = vec2(center[0] + r*Math.cos(a1), center[1] + r*Math.sin(a1));
      positions.push(center, p0, p1);
      colors.push(cCenter, cRim, cRim);
    }
    return {positions, colors};
  }

  canvas.addEventListener("click", ev => {
    const p = toNDC(ev);
    if (mode === "point") {
      shapes.push({ type: "point", center: p, color: getColor(drawSel) });
      render();
    } else if (mode === "triangle") {
      pendingTri.push({ p, c: getColor(drawSel) });
      if (pendingTri.length === 3) {
        shapes.push({ type: "triangle", p: [pendingTri[0].p, pendingTri[1].p, pendingTri[2].p], c: [pendingTri[0].c, pendingTri[1].c, pendingTri[2].c] });
        pendingTri.length = 0;
        render();
      } else {
        render();
      }
    } else {
      if (!circleCenter) { 
        circleCenter = p; 
        circleCenterColor = getColor(drawSel); 
        render(); 
      } else {
        const r = Math.hypot(p[0] - circleCenter[0], p[1] - circleCenter[1]);
        shapes.push({ type: "circle", center: circleCenter, radius: r, cCenter: circleCenterColor, cRim: getColor(drawSel) });
        circleCenter = null; 
        circleCenterColor = null; 
        render();
      }
    }
  });

  clearBtn.onclick = () => { 
    shapes.length = 0; 
    pendingTri.length = 0; 
    circleCenter = null; 
    circleCenterColor = null; 
    render(); 
  };

  let posBuffer = null, colBuffer = null, vertCount = 0;

  function rebuildBuffers(){
    const positions = [], colors = [];
    for(const s of shapes){
      if(s.type === "point"){ 
        const o = makePoint(s.center, s.color, pointSize); 
        positions.push(...o.positions); 
        colors.push(...o.colors); 
      } else if(s.type === "triangle"){ 
        positions.push(s.p[0], s.p[1], s.p[2]); 
        colors.push(s.c[0], s.c[1], s.c[2]); 
      } else { 
        const o = makeCircle(s.center, s.radius, s.cCenter, s.cRim); 
        positions.push(...o.positions); 
        colors.push(...o.colors); 
      }
    }
    if(pendingTri.length){ 
      for(const v of pendingTri){ 
        const o = makePoint(v.p, v.c, pointSize); 
        positions.push(...o.positions); 
        colors.push(...o.colors); 
      } 
    }
    if(circleCenter){ 
      const o = makePoint(circleCenter, circleCenterColor, pointSize); 
      positions.push(...o.positions); 
      colors.push(...o.colors); 
    }

    vertCount = positions.length;
    const posData = flatten(positions);
    const colData = flatten(colors);
    posBuffer = device.createBuffer({ size: posData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(posBuffer, 0, posData);
    colBuffer = device.createBuffer({ size: colData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(colBuffer, 0, colData);
  }

  function render(){
    const bg = COLORS[clearSel.selectedIndex] || COLORS[7];
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ 
        view: context.getCurrentTexture().createView(), 
        loadOp: "clear", 
        storeOp: "store", 
        clearValue: { r: bg.r, g: bg.g, b: bg.b, a: 1.0 }
      }]
    });
    if (shapes.length || pendingTri.length || circleCenter){
      rebuildBuffers();
      pass.setPipeline(pipeline);
      pass.setVertexBuffer(0, posBuffer);
      pass.setVertexBuffer(1, colBuffer);
      pass.draw(vertCount);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  render();
}
