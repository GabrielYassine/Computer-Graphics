struct Uniforms {
  mvp   : mat4x4<f32>,
  mtex  : mat4x4<f32>,
  model : mat4x4<f32>,
  eye   : vec4<f32>,
  flags : vec4<u32>,    // x = isBG, y = reflective
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
  @location(1) wpos : vec3<f32>,
  @location(2) clip : vec4<f32>,
};

@vertex
fn main_vs(input : VSIn) -> VSOut {
  var out : VSOut;

  let isBG = (U.flags.x != 0u);

  out.position = select(U.mvp * vec4<f32>(input.pos.xyz, 1.0), input.pos, isBG);
  out.clip = input.pos;

  let wp = U.model * vec4<f32>(input.pos.xyz, 1.0);
  out.wpos = wp.xyz / wp.w;

  let wn = U.model * vec4<f32>(input.nrm.xyz, 0.0);
  out.wnrm = normalize(wn.xyz);

  return out;
}

@fragment
fn main_fs(input : VSOut) -> @location(0) vec4<f32> {
  let isBG = (U.flags.x != 0u);
  let reflective = (U.flags.y != 0u) && !isBG;

  var n = normalize(input.wnrm);
  n = vec3<f32>(n.x, n.y, n.z);

  let p = U.mtex * input.clip;
  var bgDir = normalize(vec3<f32>(p.x, select(p.y, -p.y, isBG), p.z) / p.w);

  let baseDir = select(n, bgDir, isBG);

  let v = normalize(U.eye.xyz - input.wpos);      // from surface to eye
  var r = reflect(-v, n);                         // incidence is toward surface
  r = normalize(r);

  let useDir = select(baseDir, r, reflective);

  return textureSample(cubeTex, samp, normalize(useDir));
}
