struct Uniforms {
  mvp: mat4x4f,
  eye: vec3f, _pad0: f32,
  wi: vec3f, _pad1: f32,
  kd: vec3f, kdScale: f32,
  ks: vec3f, ksScale: f32,
  Le: vec3f, LeScale: f32,
  La: vec3f, LaScale: f32,
  shininess: f32,
  _pad2: vec3f,
};

@group(0) @binding(0) var<uniform> U : Uniforms;

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) normal: vec3f,
};

@vertex
fn main_vs(@location(0) inPos: vec3f) -> VSOut {
  var out: VSOut;
  out.worldPos = inPos;
  out.normal = normalize(inPos);
  out.position = U.mvp * vec4f(inPos, 1.0);
  return out;
}

@fragment
fn main_fs(inp: VSOut) -> @location(0) vec4f {
  let n = normalize(inp.normal);
  let wi = normalize(U.wi);
  let wo = normalize(U.eye - inp.worldPos);

  let Li = U.Le * U.LeScale;
  let kd = U.kd * U.kdScale;
  let ks = U.ks * U.ksScale;

  let diff = max(dot(n, wi), 0.0);
  var Lo = kd * Li * diff;

  let r = reflect(-wi, n);
  let specTerm = pow(max(dot(r, wo), 0.0), U.shininess);
  Lo += ks * Li * specTerm;

  let La = U.La * U.LaScale;
  Lo += kd * La;

  return vec4f(Lo, 1.0);
}
