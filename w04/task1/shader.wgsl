struct Uniforms {
  mvp : mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> U : Uniforms;

struct VSIn {
  @location(0) pos : vec3<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
};

@vertex
fn main_vs(input : VSIn) -> VSOut {
  var out : VSOut;
  out.position = U.mvp * vec4<f32>(input.pos, 1.0);
  return out;
}

@fragment
fn main_fs() -> @location(0) vec4<f32> {
  return vec4<f32>(0.7, 0.7, 0.7, 1.0);
}
