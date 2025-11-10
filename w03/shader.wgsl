struct Uniforms {
    modelMatrices: array<mat4x4f, 3>,
};
@group(0) @binding(0)
var<uniform> uniforms : Uniforms;

struct VSOut {
    @builtin(position) position: vec4f,
};

@vertex
fn main_vs(@location(0) inPos: vec3f,
           @builtin(instance_index) instance : u32) -> VSOut {
    var out: VSOut;
    out.position = uniforms.modelMatrices[instance] * vec4f(inPos, 1.0);
    return out;
}

@fragment
fn main_fs() -> @location(0) vec4f {
    return vec4f(1.0, 1.0, 1.0, 1.0);
}
