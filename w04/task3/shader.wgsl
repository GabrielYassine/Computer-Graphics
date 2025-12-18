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
  @location(0) color : vec3<f32>,
};

@vertex
fn main_vs(input : VSIn) -> VSOut {
  var out : VSOut;

  out.position = U.mvp * vec4<f32>(input.pos, 1.0);

  // True normal for unit sphere
  let N = normalize(input.pos);

  // Directional light: direction (0,0,-1)
  // Worksheet note: wi = l = -le, so use L = (0,0,1)
  let L = normalize(vec3<f32>(0.0, 0.0, 1.0));

  // Diffuse term: kd * Le * max(dot(N,L), 0)
  let kd = vec3<f32>(1.0, 1.0, 1.0);
  let Le = vec3<f32>(1.0, 1.0, 1.0);
  let diff = max(dot(N, L), 0.0);

  out.color = kd * Le * diff;
  return out;
}

@fragment
fn main_fs(input : VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(input.color, 1.0);
}
