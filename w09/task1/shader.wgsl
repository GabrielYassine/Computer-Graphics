// ---------- Ground (textured) ----------
struct GroundUBO { mvp : mat4x4<f32> };

@group(0) @binding(0) var<uniform> UG : GroundUBO;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var tex  : texture_2d<f32>;

struct GIn {
  @location(0) pos : vec3<f32>,
  @location(1) uv  : vec2<f32>,
};

struct GOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_ground(i : GIn) -> GOut {
  var o : GOut;
  o.position = UG.mvp * vec4<f32>(i.pos, 1.0);
  o.uv = i.uv;
  return o;
}

@fragment
fn fs_ground(i : GOut) -> @location(0) vec4<f32> {
  return textureSample(tex, samp, i.uv);
}

// ---------- Teapot (basic diffuse + ambient) ----------
struct TeapotUBO {
  mvp      : mat4x4<f32>,
  model    : mat4x4<f32>,
  lightPos : vec4<f32>,
};

@group(1) @binding(0) var<uniform> UT : TeapotUBO;

struct TIn {
  @location(0) pos : vec4<f32>,
  @location(1) nrm : vec4<f32>,
};

struct TOut {
  @builtin(position) position : vec4<f32>,
  @location(0) wpos : vec3<f32>,
  @location(1) wnrm : vec3<f32>,
};

@vertex
fn vs_teapot(i : TIn) -> TOut {
  var o : TOut;
  let wp = (UT.model * i.pos).xyz;
  o.position = UT.mvp * i.pos;
  o.wpos = wp;
  o.wnrm = normalize((UT.model * vec4<f32>(i.nrm.xyz, 0.0)).xyz);
  return o;
}

@fragment
fn fs_teapot(i : TOut) -> @location(0) vec4<f32> {
  let N = normalize(i.wnrm);
  let L = normalize(UT.lightPos.xyz - i.wpos);
  let diff = max(dot(N, L), 0.0);

  let base = vec3<f32>(0.75, 0.75, 0.75);
  let c = base * (0.2 + 0.8 * diff);

  return vec4<f32>(c, 1.0);
}
