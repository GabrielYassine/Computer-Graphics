struct Uniforms {
  mvp   : mat4x4<f32>,
  model : mat4x4<f32>,
  eye   : vec4<f32>,
};

@group(0) @binding(0) var<uniform> U : Uniforms;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var tex  : texture_2d<f32>;

struct VSIn {
  @location(0) pos : vec4<f32>,
  @location(1) nrm : vec4<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) nrm : vec3<f32>,
};

@vertex
fn main_vs(input : VSIn) -> VSOut {
  var out : VSOut;
  out.position = U.mvp * vec4<f32>(input.pos.xyz, 1.0);
  let wn = U.model * vec4<f32>(input.nrm.xyz, 0.0);
  out.nrm = normalize(wn.xyz);
  return out;
}

@fragment
fn main_fs(input : VSOut) -> @location(0) vec4<f32> {
  let n = normalize(input.nrm);

  let u = atan2(n.z, n.x) / (2.0 * 3.14159265) + 0.5;
  let v = acos(n.y) / 3.14159265;

  let kd = textureSample(tex, samp, vec2<f32>(u, v)).rgb;

  let wi = normalize(vec3<f32>(0.0, 0.0, -1.0));
  let ndotl = max(dot(n, wi), 0.0);

  let ambient = 0.1 * kd;
  let diffuse = ndotl * kd;

  return vec4<f32>(ambient + diffuse, 1.0);
}
