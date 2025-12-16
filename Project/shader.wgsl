// ---------- Teapot UBO (shared by original & reflected) ----------

struct TeapotUBO {
  mvp      : mat4x4f,
  model    : mat4x4f,
  lightPos : vec4f,
  viewPos  : vec4f,
};

@group(0) @binding(0)
var<uniform> U : TeapotUBO;

// ---------- Ground UBO ----------

struct GroundUBO {
  mvp   : mat4x4f,
  alpha : f32,
  pad0  : f32,
  pad1  : f32,
  pad2  : f32,
};

@group(1) @binding(0)
var<uniform> G : GroundUBO;

@group(1) @binding(1)
var gSampler : sampler;

@group(1) @binding(2)
var gTex : texture_2d<f32>;

// ---------- Ground pipeline structs & shaders ----------

struct GroundVSIn {
  @location(0) pos : vec3f,
  @location(1) uv  : vec2f,
};

struct GroundVSOut {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs_ground(input : GroundVSIn) -> GroundVSOut {
  var out : GroundVSOut;
  out.position = G.mvp * vec4f(input.pos, 1.0);
  out.uv = input.uv;
  return out;
}

@fragment
fn fs_ground(input : GroundVSOut) -> @location(0) vec4f {
  let texColor = textureSample(gTex, gSampler, input.uv);
  let a = G.alpha;
  return vec4f(texColor.rgb, a);
}

// ---------- Teapot pipeline structs & shaders ----------

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

  let worldPos4 = U.model * input.pos;
  let worldNrm4 = U.model * vec4f(input.nrm.xyz, 0.0);

  out.worldPos = worldPos4.xyz;
  out.worldNrm = normalize(worldNrm4.xyz);
  out.color    = input.col.rgb;

  out.position = U.mvp * input.pos;
  return out;
}

// ---------- Phong fragment shader for teapot ----------

@fragment
fn fs_teapot(input : TeapotVSOut) -> @location(0) vec4f {
  let N = normalize(input.worldNrm);
  let L = normalize(U.lightPos.xyz - input.worldPos);
  let V = normalize(U.viewPos.xyz  - input.worldPos);
  let R = reflect(-L, N);

  let kd = 0.9;
  let ks = 0.5;
  let ka = 0.15;
  let shininess = 32.0;

  let diff = max(dot(N, L), 0.0);
  let spec = select(
    0.0,
    pow(max(dot(R, V), 0.0), shininess),
    diff > 0.0
  );

  let baseColor = input.color;
  let ambient   = ka * baseColor;
  let diffuse   = kd * diff * baseColor;
  let specular  = ks * spec * vec3f(1.0, 1.0, 1.0);

  let finalColor = ambient + diffuse + specular;
  return vec4f(finalColor, 1.0);
}
