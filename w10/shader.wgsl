// ---------- GROUND ----------

struct GroundUBO {
  cameraMVP : mat4x4f,  // 64 bytes
  lightVP   : mat4x4f,  // 64 bytes (unused but needed for alignment)
};

@group(0) @binding(0) var<uniform> gUBO : GroundUBO;
@group(0) @binding(1) var gSampler : sampler;
@group(0) @binding(2) var gTex     : texture_2d<f32>;
@group(0) @binding(3) var shadowTex : texture_2d<f32>;
@group(0) @binding(4) var shadowSampler : sampler;

struct GroundVSIn {
  @location(0) pos : vec3f,
  @location(1) uv  : vec2f,
};

struct GroundVSOut {
  @builtin(position) position : vec4f,
  @location(0) uv        : vec2f,
};

@vertex
fn vs_ground(input : GroundVSIn) -> GroundVSOut {
  var out : GroundVSOut;
  let world = vec4f(input.pos, 1.0);
  out.position = gUBO.cameraMVP * world;
  out.uv       = input.uv;
  return out;
}

@fragment
fn fs_ground(input : GroundVSOut) -> @location(0) vec4f {
  let base = textureSample(gTex, gSampler, input.uv).rgb;
  return vec4f(base, 0.6);
}

// ---------- TEAPOT (lit) ----------

struct TeapotUBO {
  cameraMVP : mat4x4f,
  model     : mat4x4f,
  lightPos  : vec4f,
  viewPos   : vec4f,
};

@group(1) @binding(0) var<uniform> tUBO : TeapotUBO;

struct TeapotVSIn {
  @location(0) pos : vec4f,
  @location(1) nrm : vec4f,
  @location(2) col : vec4f,
};

struct TeapotVSOut {
  @builtin(position) position : vec4f,
  @location(0) worldPos : vec3f,
  @location(1) worldNrm : vec3f,
  @location(2) color    : vec3f,
};

@vertex
fn vs_teapot(input : TeapotVSIn) -> TeapotVSOut {
  var out : TeapotVSOut;

  let worldPos4 = tUBO.model * input.pos;
  let worldNrm4 = tUBO.model * vec4f(input.nrm.xyz, 0.0);

  out.worldPos = worldPos4.xyz;
  out.worldNrm = normalize(worldNrm4.xyz);
  out.color    = input.col.rgb;

  out.position = tUBO.cameraMVP * input.pos;
  return out;
}

@fragment
fn fs_teapot(input : TeapotVSOut) -> @location(0) vec4f {
  let N = normalize(input.worldNrm);
  let L = normalize(tUBO.lightPos.xyz - input.worldPos);
  let V = normalize(tUBO.viewPos.xyz - input.worldPos);
  let R = reflect(-L, N);

  let kd = 0.9;
  let ks = 0.5;
  let ka = 0.15;
  let shininess = 32.0;

  let diff = max(dot(N, L), 0.0);
  let spec = select(0.0, pow(max(dot(R, V), 0.0), shininess), diff > 0.0);

  let baseColor = input.color;
  let ambient   = ka * baseColor;
  let diffuse   = kd * diff * baseColor;
  let specular  = ks * spec * vec3f(1.0);

  return vec4f(ambient + diffuse + specular, 1.0);
}