struct Uniforms {
  mvp   : mat4x4<f32>,
  model : mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> U : Uniforms;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var cubeTex : texture_cube<f32>;

struct VSIn {
  @location(0) pos : vec4<f32>,
  @location(1) nrm : vec4<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) wnrm : vec3<f32>,
};

@vertex
fn main_vs(input : VSIn) -> VSOut {
  var out : VSOut;
  out.position = U.mvp * vec4<f32>(input.pos.xyz, 1.0);

  let wn = U.model * vec4<f32>(input.nrm.xyz, 0.0);
  out.wnrm = normalize(wn.xyz);

  return out;
}

@fragment
fn main_fs(input : VSOut) -> @location(0) vec4<f32> {
  let dir = normalize(vec3<f32>(input.wnrm.x, -input.wnrm.y, input.wnrm.z));
  return textureSample(cubeTex, samp, dir);
}
