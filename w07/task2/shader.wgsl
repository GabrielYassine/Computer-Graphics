struct Uniforms {
  mvp   : mat4x4<f32>,
  mtex  : mat4x4<f32>,
  model : mat4x4<f32>,
  flags : vec4<u32>,
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
  @location(1) clip : vec4<f32>,
};

@vertex
fn main_vs(input : VSIn) -> VSOut {
  var out : VSOut;

  let isBG = (U.flags.x != 0u);

  out.position = select(U.mvp * vec4<f32>(input.pos.xyz, 1.0), input.pos, isBG);
  out.clip = input.pos;

  let wn = U.model * vec4<f32>(input.nrm.xyz, 0.0);
  out.wnrm = normalize(wn.xyz);

  return out;
}

@fragment
fn main_fs(input : VSOut) -> @location(0) vec4<f32> {
  let isBG = (U.flags.x != 0u);

  var dir = normalize(input.wnrm);
  dir = vec3<f32>(dir.x, -dir.y, dir.z);

  let p = U.mtex * input.clip;
  let bgDir = normalize(vec3<f32>(p.x, -p.y, p.z) / p.w);

  let useDir = select(dir, bgDir, isBG);

  return textureSample(cubeTex, samp, normalize(useDir));
}
