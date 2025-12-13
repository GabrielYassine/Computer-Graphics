"use strict";

// --- Entry point ---------------------------------------------------------
window.onload = () => main();

// --- Projection / View helpers ------------------------------------------
function makeProjectionView(canvas, camera){
  const aspect = canvas.width / canvas.height;
  const P = perspective(65, aspect, 0.1, 100);
  const eye = camera.getEye();
  const at = camera.lookAt;
  const up = camera.getUp();
  const V = lookAt(eye, at, up);
  return { P, V, eye, at, up };
}

// --- Reflection helpers -------------------------------------------------
const reflection = {
  matrix: mat4(
    vec4(1, 0, 0, 0),
    vec4(0, -1, 0, -2),
    vec4(0, 0, 1, 0),
    vec4(0, 0, 0, 1)
  ),
  applyToPoint(p) { return vec3(p[0], -p[1] - 2, p[2]); }
};

// --- Projection modification (oblique clipping) -------------------------
function modifyProjectionMatrix(clipplane, projection) {
  const oblique = mult(mat4(), projection);

  const q = vec4(
    (Math.sign(clipplane[0]) + projection[0][2]) / projection[0][0],
    (Math.sign(clipplane[1]) + projection[1][2]) / projection[1][1],
     1.0,
    (1.0 - projection[2][2]) / projection[2][3]
  );

  const s = 2.0 / dot(clipplane, q);

  oblique[2] = vec4(
    clipplane[0] * s,
    clipplane[1] * s,
    clipplane[2] * s,
    clipplane[3] * s
  );

  return oblique;
}

// --- Asset loader -------------------------------------------------------
async function loadImageData(url){
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = img.width, h = img.height;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const g = cv.getContext("2d");
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, w, h);
  return { w, h, data };
}

// --- Mouse event handlers -----------------------------------------------
function setupMouseControls(canvas, camera, mouse, spinning) {
  canvas.addEventListener('mousedown', (e) => {
    mouse.isDragging = true;
    mouse.lastX = e.offsetX;
    mouse.lastY = e.offsetY;
    mouse.lastMoveTime = Date.now();
    
    // Stop any active spinning
    spinning.active = false;
    spinning.velocity.setIdentity();
    
    // Determine interaction mode based on mouse button
    if (e.button === 0) {
      // Left button: Orbit
      mouse.dragMode = 'orbit';
      mouse.lastSpherePos = mapToSphere(e.offsetX, e.offsetY, canvas.width, canvas.height);
      canvas.style.cursor = 'grabbing';
    } else if (e.button === 1) {
      // Middle button: Pan
      e.preventDefault(); // Prevent default middle-click behavior
      mouse.dragMode = 'pan';
      canvas.style.cursor = 'move';
    } else if (e.button === 2) {
      // Right button: Dolly (zoom)
      mouse.dragMode = 'dolly';
      canvas.style.cursor = 'ns-resize';
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!mouse.isDragging) return;

    const deltaX = e.offsetX - mouse.lastX;
    const deltaY = e.offsetY - mouse.lastY;
    
    // Update last move time
    mouse.lastMoveTime = Date.now();

    if (mouse.dragMode === 'orbit') {
      // Orbit mode: rotate camera around lookAt point
      const currentSpherePos = mapToSphere(e.offsetX, e.offsetY, canvas.width, canvas.height);
      
      // Create quaternion that rotates from last position to current position
      const rotQuat = new Quaternion();
      rotQuat.make_rot_vec2vec(mouse.lastSpherePos, currentSpherePos);
      
      // Accumulate this rotation for spinning velocity (with smoothing)
      const alpha = 0.5; // Smoothing factor (higher = more responsive)
      const q_old = spinning.velocity.elements;
      const q_new = rotQuat.elements;
      
      // Blend old and new rotation (SLERP-like)
      q_old[0] = q_old[0] * (1 - alpha) + q_new[0] * alpha;
      q_old[1] = q_old[1] * (1 - alpha) + q_new[1] * alpha;
      q_old[2] = q_old[2] * (1 - alpha) + q_new[2] * alpha;
      q_old[3] = q_old[3] * (1 - alpha) + q_new[3] * alpha;
      
      // Normalize
      const len = Math.sqrt(q_old[0]*q_old[0] + q_old[1]*q_old[1] + q_old[2]*q_old[2] + q_old[3]*q_old[3]);
      q_old[0] /= len; q_old[1] /= len; q_old[2] /= len; q_old[3] /= len;
      
      // Apply this rotation to the camera's current rotation
      camera.rotation = rotQuat.multiply(new Quaternion(camera.rotation));
      
      // Update last position
      mouse.lastSpherePos = currentSpherePos;
      
    } else if (mouse.dragMode === 'dolly') {
      // Dolly mode: move camera closer/farther from lookAt point
      const dollySpeed = 0.01;
      camera.distance += deltaY * dollySpeed;
      camera.distance = Math.max(0.5, Math.min(20.0, camera.distance)); // Clamp distance
      
    } else if (mouse.dragMode === 'pan') {
      // Pan mode: move both camera and lookAt point in the image plane
      const panSpeed = 0.005;
      
      // Get the current view direction and camera orientation
      const eye = camera.getEye();
      const viewDir = normalize(subtract(camera.lookAt, eye));
      const up = camera.getUp();
      const right = normalize(cross(viewDir, up));
      const trueUp = normalize(cross(right, viewDir));
      
      // Pan displacement in world space
      const panX = scale(-deltaX * panSpeed * camera.distance, right);
      const panY = scale(deltaY * panSpeed * camera.distance, trueUp);
      
      // Update lookAt point
      camera.lookAt = add(camera.lookAt, add(panX, panY));
    }

    mouse.lastX = e.offsetX;
    mouse.lastY = e.offsetY;
  });

  canvas.addEventListener('mouseup', () => {
    const timeSinceLastMove = Date.now() - mouse.lastMoveTime;
    
    // If in orbit mode and mouse was moving recently (< 20ms), activate spinning
    if (mouse.dragMode === 'orbit' && timeSinceLastMove < 20) {
      // Check if velocity is significant enough to spin
      const q = spinning.velocity.elements;
      const rotationMagnitude = Math.sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2]);
      
      if (rotationMagnitude > 0.001) {
        spinning.active = true;
      } else {
        spinning.active = false;
      }
    } else {
      // Otherwise, stop spinning
      spinning.active = false;
      spinning.velocity.setIdentity();
    }
    
    mouse.isDragging = false;
    mouse.dragMode = 'none';
    mouse.lastSpherePos = null;
    canvas.style.cursor = 'grab';
  });

  canvas.addEventListener('mouseleave', () => {
    mouse.isDragging = false;
    mouse.dragMode = 'none';
    mouse.lastSpherePos = null;
    spinning.active = false;
    spinning.velocity.setIdentity();
    canvas.style.cursor = 'grab';
  });

  // Prevent context menu on right-click
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  canvas.style.cursor = 'grab';
}

// --- Virtual Trackball helpers ------------------------------------------
function mapToSphere(x, y, width, height) {
  // Map screen coordinates to [-1, 1]
  const nx = (2.0 * x) / width - 1.0;
  const ny = 1.0 - (2.0 * y) / height;
  
  // Project to sphere/hyperbola
  const r = Math.sqrt(nx * nx + ny * ny);
  let z;
  
  if (r < 0.707) {
    // Inside sphere
    z = Math.sqrt(1.0 - r * r);
  } else {
    // Outside sphere, use hyperbolic sheet
    z = 0.5 / r;
  }
  
  // Normalize the result
  const len = Math.sqrt(nx * nx + ny * ny + z * z);
  return vec3(nx / len, ny / len, z / len);
}

// --- Main application / initialization ----------------------------------
async function main(){
  if (!("gpu" in navigator)) { alert("WebGPU not supported"); return; }

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("gpu-canvas");
  const ctx = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });

  // Camera State
  const camera = {
    distance: 4.5,
    rotation: new Quaternion(), // Using quaternion instead of Euler angles
    lookAt: vec3(0, 0, -3),
    
    getEye() {
      // Start with initial eye position relative to lookAt
      const initialEye = vec3(0, 0, this.distance);
      // Apply quaternion rotation
      const rotatedEye = this.rotation.apply(initialEye);
      // Translate to lookAt point
      return vec3(
        rotatedEye[0] + this.lookAt[0],
        rotatedEye[1] + this.lookAt[1],
        rotatedEye[2] + this.lookAt[2]
      );
    },
    
    getUp() {
      // Rotate the up vector by the quaternion
      const initialUp = vec3(0, 1, 0);
      return this.rotation.apply(initialUp);
    }
  };

  // Mouse State
  const mouse = {
    isDragging: false,
    dragMode: 'none', // 'orbit', 'dolly', 'pan'
    lastX: 0,
    lastY: 0,
    lastSpherePos: null,
    lastMoveTime: 0
  };

  // Spinning state
  const spinning = {
    active: false,
    velocity: new Quaternion(), // Accumulated velocity
    damping: 0.98, // Reduce spin over time (higher = spins longer)
    amplification: 2.0 // Amplify the velocity for more noticeable spinning
  };

  // Setup mouse controls
  setupMouseControls(canvas, camera, mouse, spinning);

  // UI elements
  const bounceToggle = document.getElementById("bounceToggle");
  const lightToggle = document.getElementById("lightToggle");

  // Ground geometry
  const groundPos = new Float32Array([-2, -1, -1, 2, -1, -1, 2, -1, -5, -2, -1, -5]);
  const groundUV = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const groundIdx = new Uint32Array([0 , 1, 2, 0, 2, 3]);

  // Buffer helpers
  const makeBuffer = (data, usage) => {
    const buf = device.createBuffer({
      size: data.byteLength,
      usage: usage
    });
    device.queue.writeBuffer(buf, 0, data);
    return buf;
  };

  // UBO writer for teapot-like uniform layout
  function writeTeapotUBO(buf, MVP, M, lightVec, eyeVec) {
    const arr = new Float32Array(40);
    arr.set(new Float32Array(flatten(MVP)), 0);
    arr.set(new Float32Array(flatten(M)), 16);
    arr.set(new Float32Array([lightVec[0], lightVec[1], lightVec[2], 1.0]), 32);
    arr.set(new Float32Array([eyeVec[0], eyeVec[1], eyeVec[2], 1.0]), 36);
    device.queue.writeBuffer(buf, 0, arr);
  }

  // Ground buffers
  const gPosBuf = makeBuffer(groundPos, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
  const gUVBuf = makeBuffer(groundUV, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
  const gIdxBuf = makeBuffer(groundIdx, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST);

  // Ground texture & sampler
  const img = await loadImageData("../models-images/xamp23.png");
  const texGround = device.createTexture({ size: [img.w, img.h], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: texGround }, img.data, { bytesPerRow: img.w * 4 }, [img.w, img.h, 1]);

  const sampler = device.createSampler({ addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", minFilter: "linear", magFilter: "linear" });

  // Dummy shadow texture (1x1 white texture) - use rgba8unorm for filtering support
  const dummyShadowTex = device.createTexture({ 
    size: [1, 1], 
    format: "rgba8unorm", 
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST 
  });
  device.queue.writeTexture({ texture: dummyShadowTex }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1, 1]);
  
  const shadowSampler = device.createSampler({ minFilter: "nearest", magFilter: "nearest" });

  // Load teapot model
  const teapotInfo = await readOBJFile("../models-images/teapot.obj", 1.0, false);
  if (!teapotInfo) { alert("Failed to load teapot.obj"); return; }

  const tPos = new Float32Array(teapotInfo.vertices);
  const tNrm = new Float32Array(teapotInfo.normals);
  const tCol = new Float32Array(teapotInfo.colors);
  const tIdx = new Uint32Array(teapotInfo.indices);

  const tPosBuf = makeBuffer(tPos, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
  const tNrmBuf = makeBuffer(tNrm, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
  const tColBuf = makeBuffer(tCol, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
  const tIdxBuf = makeBuffer(tIdx, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST);

  // Shader module & formats
  const wgslSource = await (await fetch("shader.wgsl")).text();
  const shaderModule = device.createShaderModule({ code: wgslSource });

  const depthStencilFormat = "depth24plus-stencil8";

  // Render pipelines: vertex buffer layouts
  const teapotVertexBuffers = [
    { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] },
    { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }] },
    { arrayStride: 16, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x4" }] },
  ];

  const groundVertexBuffers = [
    { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
    { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }] },
  ];

  // Pipeline creation helper
  function createPipeline({ vertexEntry, fragmentEntry, vertexBuffers, fragmentTargets, primitive = {}, depthStencil = null }) {
    return device.createRenderPipeline({
      layout: "auto",
      vertex: { module: shaderModule, entryPoint: vertexEntry, buffers: vertexBuffers },
      fragment: { module: shaderModule, entryPoint: fragmentEntry, targets: fragmentTargets || [ { format } ] },
      primitive: Object.assign({ topology: "triangle-list", cullMode: "back" }, primitive),
      depthStencil: depthStencil || { format: depthStencilFormat, depthWriteEnabled: true, depthCompare: "less" },
    });
  }

  const pipelineTeapot = createPipeline({ vertexEntry: "vs_teapot", fragmentEntry: "fs_teapot", vertexBuffers: teapotVertexBuffers });

  const pipelineTeapotReflect = createPipeline({
    vertexEntry: "vs_teapot",
    fragmentEntry: "fs_teapot",
    vertexBuffers: teapotVertexBuffers,
    primitive: { frontFace: "cw" },
    depthStencil: {
      format: depthStencilFormat,
      depthWriteEnabled: true,
      depthCompare: "less",
      stencilFront: { compare: "equal", failOp: "keep", depthFailOp: "keep", passOp: "keep", readMask: 0xFF, writeMask: 0xFF },
      stencilBack: { compare: "equal", failOp: "keep", depthFailOp: "keep", passOp: "keep", readMask: 0xFF, writeMask: 0xFF },
    }
  });

  const pipelineGround = createPipeline({
    vertexEntry: "vs_ground",
    fragmentEntry: "fs_ground",
    vertexBuffers: groundVertexBuffers,
    fragmentTargets: [ {
      format,
      blend: {
        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      },
    } ],
  });

  const pipelineGroundMask = createPipeline({
    vertexEntry: "vs_ground",
    fragmentEntry: "fs_ground",
    vertexBuffers: groundVertexBuffers,
    fragmentTargets: [ { format, writeMask: 0 } ],
    depthStencil: {
      format: depthStencilFormat,
      depthWriteEnabled: false,
      depthCompare: "less",
      stencilFront: { compare: "always", failOp: "replace", depthFailOp: "replace", passOp: "replace", readMask: 0xFF, writeMask: 0xFF },
      stencilBack: { compare: "always", failOp: "replace", depthFailOp: "replace", passOp: "replace", readMask: 0xFF, writeMask: 0xFF },
    }
  });

  // Uniform buffers
  const tUBuf = device.createBuffer({ size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const rUBuf = device.createBuffer({ size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const gUBuf = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  // Bind group helper
  const makeBindGroup = (pipeline, index, entries) => {
    return device.createBindGroup({ layout: pipeline.getBindGroupLayout(index), entries });
  };

  // Create bind groups
  // Teapot uses @group(1) in shader
  const tBind = makeBindGroup(pipelineTeapot, 1, [ { binding: 0, resource: { buffer: tUBuf } } ]);
  const rBind = makeBindGroup(pipelineTeapotReflect, 1, [ { binding: 0, resource: { buffer: rUBuf } } ]);
  
  // Ground uses @group(0) in shader with all 5 bindings
  const gBind = makeBindGroup(pipelineGround, 0, [ 
    { binding: 0, resource: { buffer: gUBuf } }, 
    { binding: 1, resource: sampler }, 
    { binding: 2, resource: texGround.createView() },
    { binding: 3, resource: dummyShadowTex.createView() },
    { binding: 4, resource: shadowSampler }
  ]);
  const gBindMask = makeBindGroup(pipelineGroundMask, 0, [ 
    { binding: 0, resource: { buffer: gUBuf } }, 
    { binding: 1, resource: sampler }, 
    { binding: 2, resource: texGround.createView() },
    { binding: 3, resource: dummyShadowTex.createView() },
    { binding: 4, resource: shadowSampler }
  ]);

  // Depth/stencil texture (resized on demand)
  let depthTex = null;
  function ensureDepth() {
    if (!depthTex || depthTex.width !== canvas.width || depthTex.height !== canvas.height) {
      depthTex?.destroy?.();
      depthTex = device.createTexture({ size: [canvas.width, canvas.height], format: depthStencilFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
  }

  // Render pass helper
  function beginPass(enc, colorView, depthTex, opts = {}) {
    const colorAtt = { view: colorView, loadOp: opts.colorLoadOp ?? "clear", storeOp: opts.colorStoreOp ?? "store" };
    if (opts.clearColor !== undefined) colorAtt.clearValue = opts.clearColor;

    return enc.beginRenderPass({
      colorAttachments: [ colorAtt ],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthLoadOp: opts.depthLoadOp ?? "clear",
        depthClearValue: opts.depthClearValue ?? 1,
        depthStoreOp: opts.depthStoreOp ?? "store",
        stencilLoadOp: opts.stencilLoadOp ?? "clear",
        stencilClearValue: opts.stencilClearValue ?? 0,
        stencilStoreOp: opts.stencilStoreOp ?? "store",
      }
    });
  }

  // Animation timers
  let tLight = 0;
  let tTeapot = 0;
  const clearColor = { r: 1, g: 1, b: 1, a: 1 };
  const R_reflect = reflection.matrix;

  // Frame update & render loop
  function frame() {
    ensureDepth();

    if (lightToggle.checked)  tLight  += 0.02;
    if (bounceToggle.checked) tTeapot += 0.02;

    // Apply spinning if active
    if (spinning.active) {
      // Amplify the velocity for more visible spinning
      const q = spinning.velocity.elements;
      const amplifiedQuat = new Quaternion();
      const amp_q = amplifiedQuat.elements;
      
      // Amplify the imaginary part (rotation axis * angle)
      amp_q[0] = q[0] * spinning.amplification;
      amp_q[1] = q[1] * spinning.amplification;
      amp_q[2] = q[2] * spinning.amplification;
      amp_q[3] = q[3];
      
      // Normalize the amplified quaternion
      const len_amp = Math.sqrt(amp_q[0]*amp_q[0] + amp_q[1]*amp_q[1] + amp_q[2]*amp_q[2] + amp_q[3]*amp_q[3]);
      amp_q[0] /= len_amp; amp_q[1] /= len_amp; amp_q[2] /= len_amp; amp_q[3] /= len_amp;
      
      // Apply the amplified rotation
      camera.rotation = amplifiedQuat.multiply(new Quaternion(camera.rotation));
      
      // Apply damping to the original velocity quaternion
      q[0] *= spinning.damping;
      q[1] *= spinning.damping;
      q[2] *= spinning.damping;
      q[3] = q[3] * spinning.damping + (1.0 - spinning.damping); // Interpolate w towards 1
      
      // Normalize to prevent drift
      const len = Math.sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]);
      q[0] /= len; q[1] /= len; q[2] /= len; q[3] /= len;
      
      // Stop spinning if rotation is negligible
      const rotationMagnitude = Math.sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2]);
      if (rotationMagnitude < 0.0001) {
        spinning.active = false;
        spinning.velocity.setIdentity();
        console.log('Spinning stopped naturally');
      }
    }

    const { P, V, eye } = makeProjectionView(canvas, camera);
    const lightPos = vec3(2 * Math.cos(tLight), 2.0, -3 + 2 * Math.sin(tLight));

    let yAnim = 0.0;
    if (bounceToggle.checked) yAnim = 0.9 * Math.sin(tTeapot);
    const S = scalem(0.25, 0.25, 0.25);
    const T_teapot = translate(0, -0.9 + yAnim, -3);
    const M_teapot = mult(T_teapot, S);
    const MVP_teapot = mult(P, mult(V, M_teapot));

    writeTeapotUBO(tUBuf, MVP_teapot, M_teapot, lightPos, eye);

    const M_reflect = mult(R_reflect, M_teapot);
    const V_ref = V;

    const planeWorld = vec4(0, -1, 0, -1);
    const planeEye4 = mult(inverse(transpose(V_ref)), planeWorld);
    const len = Math.hypot(planeEye4[0], planeEye4[1], planeEye4[2]);
    let planeEye = vec4(planeEye4[0] / len, planeEye4[1] / len, planeEye4[2] / len, planeEye4[3] / len);

    const keepWorld = vec4(0, -1.01, -3, 1);
    const keepEye   = mult(V_ref, keepWorld);
    if (dot(planeEye, keepEye) < 0.0) planeEye = vec4(-planeEye[0], -planeEye[1], -planeEye[2], -planeEye[3]);

    const P_oblique  = modifyProjectionMatrix(planeEye, P);
    const MVP_reflect = mult(P_oblique, mult(V_ref, M_reflect));

    const lightRef = reflection.applyToPoint(lightPos);

    writeTeapotUBO(rUBuf, MVP_reflect, M_reflect, lightRef, eye);

    const M_ground = mat4();
    const MVP_ground = mult(P, mult(V, M_ground));
    const gData = new Float32Array(32); // 128 bytes / 4 = 32 floats
    gData.set(new Float32Array(flatten(MVP_ground)), 0);
    // lightVP matrix (unused, but needs space) at offset 16
    const identityMat = mat4();
    gData.set(new Float32Array(flatten(identityMat)), 16);
    device.queue.writeBuffer(gUBuf, 0, gData);

    const colorView = ctx.getCurrentTexture().createView();
    const enc = device.createCommandEncoder();
    const pass = beginPass(enc, colorView, depthTex, { colorLoadOp: "clear", clearColor: clearColor, depthLoadOp: "clear", depthClearValue: 1, stencilLoadOp: "clear", stencilClearValue: 0 });

    pass.setPipeline(pipelineGroundMask);
    pass.setBindGroup(0, gBindMask);
    pass.setStencilReference(1);
    pass.setVertexBuffer(0, gPosBuf);
    pass.setVertexBuffer(1, gUVBuf);
    pass.setIndexBuffer(gIdxBuf, "uint32");
    pass.drawIndexed(groundIdx.length);

    pass.setPipeline(pipelineTeapotReflect);
    pass.setBindGroup(1, rBind);
    pass.setStencilReference(1);
    pass.setVertexBuffer(0, tPosBuf);
    pass.setVertexBuffer(1, tNrmBuf);
    pass.setVertexBuffer(2, tColBuf);
    pass.setIndexBuffer(tIdxBuf, "uint32");
    pass.drawIndexed(tIdx.length);

    pass.end();

    const clearPass = beginPass(enc, colorView, depthTex, { colorLoadOp: "load", depthLoadOp: "clear", depthClearValue: 1, stencilLoadOp: "load" });
    clearPass.end();

    const mainPass = beginPass(enc, colorView, depthTex, { colorLoadOp: "load", depthLoadOp: "load", stencilLoadOp: "load" });

    mainPass.setPipeline(pipelineGround);
    mainPass.setBindGroup(0, gBind);
    mainPass.setVertexBuffer(0, gPosBuf);
    mainPass.setVertexBuffer(1, gUVBuf);
    mainPass.setIndexBuffer(gIdxBuf, "uint32");
    mainPass.drawIndexed(groundIdx.length);

    mainPass.setPipeline(pipelineTeapot);
    mainPass.setBindGroup(1, tBind);
    mainPass.setVertexBuffer(0, tPosBuf);
    mainPass.setVertexBuffer(1, tNrmBuf);
    mainPass.setVertexBuffer(2, tColBuf);
    mainPass.setIndexBuffer(tIdxBuf, "uint32");
    mainPass.drawIndexed(tIdx.length);

    mainPass.end();
    device.queue.submit([enc.finish()]);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}