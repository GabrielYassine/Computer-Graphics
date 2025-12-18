struct Uniforms {
  mvp : mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> U : Uniforms;

struct VSIn {
  @location(0) pos : vec4<f32>,
  @location(1) col : vec4<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) col : vec4<f32>,
};

@vertex
fn main_vs(input : VSIn) -> VSOut {
  var out : VSOut;
  out.position = U.mvp * vec4<f32>(input.pos.xyz, 1.0);
  out.col = input.col;
  return out;
}

@fragment
fn main_fs(input : VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(input.col.rgb, 1.0);
}
