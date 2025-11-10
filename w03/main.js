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

    let msTex = null;
    const vtxLayout = [
        { arrayStride: 3*4, attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }] },
    ];

    const shaderCode = await (await fetch("shader.wgsl")).text();
    const shaderModule = device.createShaderModule({ code: shaderCode });

    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: shaderModule,
            entryPoint: 'main_vs',
            buffers: vtxLayout, },
        fragment: { module: shaderModule,
            entryPoint: 'main_fs',
            targets: [{ format }], },
        primitive: { topology: 'line-list', },
        multisample: {count: 4,},
    });

    const mat4ByteLength = sizeof['mat4'];
    const numSquares = 3;
    const uniformBuffer = device.createBuffer({
        size: mat4ByteLength*numSquares,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
            entries: [{
                binding: 0,
                resource: { buffer: uniformBuffer }
            }],
    });

    var pos = [
        vec3(0.0, 0.0, 1.0),
        vec3(0.0, 1.0, 1.0),
        vec3(1.0, 1.0, 1.0),
        vec3(1.0, 0.0, 1.0),
        vec3(0.0, 0.0, 0.0),
        vec3(0.0, 1.0, 0.0),
        vec3(1.0, 1.0, 0.0),
        vec3(1.0, 0.0, 0.0),
    ];

    var wireIdx = new Uint32Array([
        0,1, 1,2, 2,3, 3,0, 2,6, 6,7, 7,3, 4,5, 5,1, 0,4, 5,6, 4,7,
    ])

    const indexBuffer = device.createBuffer({
        size: wireIdx.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    })

    var eye = vec3(0, 0, 5);
    var target = vec3(0.0,0.0,0.0);
    var upVec = vec3(0,1,0);
    const Vmat = lookAt(eye, target, upVec);

    const xs = pos.map(p => p[0]);
    const ys = pos.map(p => p[1]);
    const zs = pos.map(p => p[2]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const posCenter = vec3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    const orthoHalf = 3;

    var Proj = ortho(
        posCenter[0] - orthoHalf,
        posCenter[0] + orthoHalf,
        posCenter[1] - orthoHalf,
        posCenter[1] + orthoHalf,
        0.1,
        10
    );

    function makeModelMats() {
        const m1 = mult(translate(2.2,-0.3,-4), mult(rotateX(35), rotateY(45), rotateZ(0)));
        const m2 = mult(translate(0.5, 0, -4), mult(rotateX(0), rotateY(45), rotateZ(0)));
        const m3 = mult(translate(-1.5, 0, -4), mult(rotateX(0), rotateY(0), rotateZ(0)));
        return [m1, m2, m3];
    }

    var m1, m2, m3;
    [m1, m2, m3] = makeModelMats();

    const mst = mat4(
        vec4(1,0,0,0),
        vec4(0,1,0,0),
        vec4(0,0,0.5,0.5),
        vec4(0,0,0,1)
    );

    function uploadMVP(models) {
        const mvps = models.map(m => {
            return mult(mst, mult(Proj, mult(Vmat, m)));
        });
        const flatNumbers = [].concat(...mvps.map(x => Array.from(flatten(x))));
        const flat = new Float32Array(flatNumbers);
        device.queue.writeBuffer(uniformBuffer, 0, flat);
    }

    uploadMVP([m1, m2, m3]);

    const posData = new Float32Array(flatten(pos));
    const posBuffer = device.createBuffer({ size: posData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(posBuffer, 0, posData);
    device.queue.writeBuffer(indexBuffer, 0, wireIdx);

    var projMenu = document.getElementById("projectionMode");
    projMenu.addEventListener("click", () => {
        switch(projMenu.selectedIndex) {
                case 0:
                Proj = ortho(
                    posCenter[0] - orthoHalf,
                    posCenter[0] + orthoHalf,
                    posCenter[1] - orthoHalf,
                    posCenter[1] + orthoHalf,
                    0.1,
                    10
                );
                break;
            case 1:
                Proj = perspective(45, canvas.width/canvas.height, 0.1, 10);
                break;
        }
    [m1, m2, m3] = makeModelMats();
    uploadMVP([m1, m2, m3]);
    })

    function renderLoop() {
        if (!msTex || msTex.width !== canvas.width || msTex.height !== canvas.height) {
            if (msTex) {
                msTex.destroy();
            }
            msTex = device.createTexture({
                size: [canvas.width, canvas.height],
                format: format,
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
                sampleCount: 4,
            });
        }

        const encoder = device.createCommandEncoder();

        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: msTex.createView(),
                resolveTarget: context.getCurrentTexture().createView(),
                loadOp: "clear",
                clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1 },
                storeOp: "store",
            }]
        });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, posBuffer);
        pass.setIndexBuffer(indexBuffer, "uint32");
        pass.setBindGroup(0, bindGroup);
        pass.drawIndexed(wireIdx.length, numSquares);

        pass.end();
        device.queue.submit([encoder.finish()]);
        requestAnimationFrame(renderLoop);
    }
    requestAnimationFrame(renderLoop);
}
