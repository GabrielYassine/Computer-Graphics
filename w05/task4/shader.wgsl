struct Uniforms {
  mvp : mat4x4<f32>,
  model : mat4x4<f32>,
  eye : vec4<f32>,
  params : vec4<f32>,
};

@group(0) @binding(0)
var<uniform> U : Uniforms;

struct VSIn {
  @location(0) pos : vec4<f32>,
  @location(1) nrm : vec4<f32>,
  @location(2) col : vec4<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) wpos : vec3<f32>,
  @location(1) wnrm : vec3<f32>,
  @location(2) col : vec3<f32>,
};

@vertex
fn main_vs(input : VSIn) -> VSOut {
  var out : VSOut;

  let wp4 = U.model * vec4<f32>(input.pos.xyz, 1.0);
  out.wpos = wp4.xyz;

  let wn4 = U.model * vec4<f32>(input.nrm.xyz, 0.0);
  out.wnrm = wn4.xyz;

  out.col = input.col.rgb;

  out.position = U.mvp * vec4<f32>(input.pos.xyz, 1.0);
  return out;
}

@fragment
fn main_fs(input : VSOut) -> @location(0) vec4<f32> {
  let N = normalize(input.wnrm);
  let p = input.wpos;

  let kdScale = U.params.x;
  let ksScale = U.params.y;
  let LeScale = U.params.z;
  let LaScale = U.params.w;

  let le = vec3<f32>(0.0, 0.0, -1.0);
  let wi = normalize(-le);

  let v = normalize(U.eye.xyz - p);
  let r = reflect(-wi, N);

  let ndotl = max(dot(N, wi), 0.0);

  let shininess = 32.0;
  let spec = pow(max(dot(r, v), 0.0), shininess);

  let kd = input.col * kdScale;
  let ks = vec3<f32>(1.0, 1.0, 1.0) * ksScale;

  let Le = vec3<f32>(1.0, 1.0, 1.0) * LeScale;
  let La = vec3<f32>(1.0, 1.0, 1.0) * LaScale;

  let ambient = kd * La;
  let diffuse = kd * Le * ndotl;
  let specular = ks * Le * spec;

  return vec4<f32>(ambient + diffuse + specular, 1.0);
}
