struct Uniforms {
  mvp : mat4x4<f32>,
  eye : vec4<f32>,
  scales : vec4<f32>,
  shin : vec4<f32>,
};

@group(0) @binding(0)
var<uniform> U : Uniforms;

struct VSIn {
  @location(0) pos : vec3<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) wpos : vec3<f32>,
  @location(1) nrm : vec3<f32>,
};

@vertex
fn main_vs(input : VSIn) -> VSOut {
  var out : VSOut;
  out.position = U.mvp * vec4<f32>(input.pos, 1.0);
  out.wpos = input.pos;
  out.nrm = normalize(input.pos);
  return out;
}

@fragment
fn main_fs(input : VSOut) -> @location(0) vec4<f32> {
  let N = normalize(input.nrm);
  let p = input.wpos;

  let kdScale = U.scales.x;
  let ksScale = U.scales.y;
  let LeScale = U.scales.z;
  let LaScale = U.scales.w;
  let s = U.shin.x;

  let le = vec3<f32>(0.0, 0.0, -1.0);
  let wi = normalize(-le);

  let v = normalize(U.eye.xyz - p);
  let r = reflect(-wi, N);

  let ndotl = max(dot(N, wi), 0.0);
  let spec = pow(max(dot(r, v), 0.0), s);

  let kdColor = vec3<f32>(0.8, 0.2, 0.2);
  let ksColor = vec3<f32>(1.0, 1.0, 1.0);

  let kd = kdColor * kdScale;
  let ks = ksColor * ksScale;

  let Le = vec3<f32>(1.0, 1.0, 1.0) * LeScale;
  let La = vec3<f32>(1.0, 1.0, 1.0) * LaScale;

  let ambient = kd * La;
  let diffuse = kd * Le * ndotl;
  let specular = ks * Le * spec;

  return vec4<f32>(ambient + diffuse + specular, 1.0);
}
