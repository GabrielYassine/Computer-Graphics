struct Uniforms {
  mvp : mat4x4<f32>,
  eye : vec4<f32>,
  kdScale : f32,
  ksScale : f32,
  LeScale : f32,
  LaScale : f32,
  shininess : f32,
  pad0 : f32,
  pad1 : f32,
  pad2 : f32,
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

  let p = input.pos;
  let N = normalize(p);

  let le = vec3<f32>(0.0, 0.0, -1.0);
  let wi = normalize(-le);

  let eyePos = U.eye.xyz;
  let v = normalize(eyePos - p);

  let ndotl = max(dot(N, wi), 0.0);

  let r = reflect(-wi, N);
  let spec = pow(max(dot(r, v), 0.0), U.shininess);

  let kdColor = vec3<f32>(0.8, 0.2, 0.2);
  let ksColor = vec3<f32>(1.0, 1.0, 1.0);

  let kd = kdColor * U.kdScale;
  let ks = ksColor * U.ksScale;

  let Le = vec3<f32>(1.0, 1.0, 1.0) * U.LeScale;
  let La = vec3<f32>(1.0, 1.0, 1.0) * U.LaScale;

  let ambient = kd * La;
  let diffuse = kd * Le * ndotl;
  let specular = ks * Le * spec;

  out.color = ambient + diffuse + specular;
  out.position = U.mvp * vec4<f32>(p, 1.0);
  return out;
}

@fragment
fn main_fs(input : VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(input.color, 1.0);
}
