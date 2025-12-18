// ============================================================
 
// ============================================================

fn clip_to_uvz(clip: vec4f) -> vec3f {
  let ndc = clip.xyz / clip.w;
  let u = ndc.x * 0.5 + 0.5;
  let v = 1.0 - (ndc.y * 0.5 + 0.5);
  let z01 = ndc.z * 0.5 + 0.5;
  return vec3f(u, v, z01);
}

fn in_range01(v: vec2f) -> bool {
  return all(v >= vec2f(0.0)) && all(v <= vec2f(1.0));
}

fn shadow_pcf_3x3(shadowTex: texture_2d<f32>, uv: vec2f, z: f32, bias: f32) -> f32 {
  let dimsI = textureDimensions(shadowTex);
  let dims  = vec2f(dimsI);
  let texel = 1.0 / dims;

  var sum: f32 = 0.0;

  for (var oy: i32 = -1; oy <= 1; oy = oy + 1) {
    for (var ox: i32 = -1; ox <= 1; ox = ox + 1) {
      let uvOff = uv + vec2f(f32(ox), f32(oy)) * texel;

      if (!in_range01(uvOff)) {
        sum = sum + 1.0;
        continue;
      }

      let px = vec2i(
        i32(uvOff.x * dims.x),
        i32(uvOff.y * dims.y)
      );
      let pxClamped = clamp(px, vec2i(0,0), vec2i(i32(dimsI.x)-1, i32(dimsI.y)-1));

      let stored = textureLoad(shadowTex, pxClamped, 0).r;
      sum = sum + select(0.0, 1.0, (z - bias) <= stored);
    }
  }
  return sum / 9.0;
}

// ============================================================
// Ground pipeline (textured ground + shadowing)
// ============================================================

struct GroundUBO {
  mvp      : mat4x4f,
  lightMVP : mat4x4f,
};

@group(0) @binding(0) var groundSamp : sampler;
@group(0) @binding(1) var groundTex  : texture_2d<f32>;
@group(0) @binding(2) var<uniform> gU : GroundUBO;
@group(0) @binding(3) var shadowMap  : texture_2d<f32>;

struct GroundVSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) lightClip : vec4f,
};

@vertex
fn ground_vs(
  @location(0) inPos : vec3f,
  @location(1) inUV  : vec2f
) -> GroundVSOut {
  var out : GroundVSOut;
  out.pos = gU.mvp * vec4f(inPos, 1.0);
  out.uv  = inUV;
  out.lightClip = gU.lightMVP * vec4f(inPos, 1.0);
  return out;
}

@fragment
fn ground_fs(in : GroundVSOut) -> @location(0) vec4f {
  let base = textureSample(groundTex, groundSamp, in.uv).rgb;

  
  let uvz = clip_to_uvz(in.lightClip);
  let uv = uvz.xy;
  let z  = uvz.z;

  var lit: f32 = 1.0;
  if (in.lightClip.w > 0.0 && in_range01(uv) && z >= 0.0 && z <= 1.0) {
    let bias = 0.0015;
    lit = shadow_pcf_3x3(shadowMap, uv, z, bias);
  }

  let ambient = 0.20;
  let color = base * (ambient + (1.0 - ambient) * lit);
  return vec4f(color, 1.0);
}

// ============================================================
// Teapot pipeline (point light + shadow map)
// ============================================================

struct TeapotUBO {
  model    : mat4x4f,
  mvp      : mat4x4f,
  lightMVP : mat4x4f,
  lightPos : vec4f,
  eyePos   : vec4f,
};

@group(0) @binding(0) var<uniform> tU : TeapotUBO;
@group(0) @binding(1) var shadowMap2 : texture_2d<f32>;

struct TeapotVSOut {
  @builtin(position) pos_clip : vec4f,
  @location(0) pos_world : vec3f,
  @location(1) n_world   : vec3f,
  @location(2) lightClip : vec4f,
};

@vertex
fn teapot_vs(
  @location(0) inPos   : vec3f,
  @location(1) inNorm  : vec3f
) -> TeapotVSOut {
  var out : TeapotVSOut;

  let pw = (tU.model * vec4f(inPos, 1.0)).xyz;
  let nw = normalize((tU.model * vec4f(inNorm, 0.0)).xyz);

  out.pos_clip  = tU.mvp * vec4f(inPos, 1.0);
  out.pos_world = pw;
  out.n_world   = nw;

  
  out.lightClip = tU.lightMVP * vec4f(inPos, 1.0);

  return out;
}

@fragment
fn teapot_fs(in : TeapotVSOut) -> @location(0) vec4f {
  let N = normalize(in.n_world);
  let L = normalize(tU.lightPos.xyz - in.pos_world);
  let V = normalize(tU.eyePos.xyz - in.pos_world);

  let diff = max(dot(N, L), 0.0);

  
  let H = normalize(L + V);
  let spec = pow(max(dot(N, H), 0.0), 24.0) * 0.25;

  
  let uvz = clip_to_uvz(in.lightClip);
  let uv = uvz.xy;
  let z  = uvz.z;

  var lit: f32 = 1.0;
  if (in.lightClip.w > 0.0 && in_range01(uv) && z >= 0.0 && z <= 1.0) {
    let bias = max(0.0010 * (1.0 - dot(N, L)), 0.0006);
    lit = shadow_pcf_3x3(shadowMap2, uv, z, bias);
  }

  let ambient = 0.20;
  let base = vec3f(0.75, 0.75, 0.75);
  let color = ambient * base + lit * (base * diff + vec3f(spec));

  return vec4f(color, 1.0);
}

// ============================================================
// Shadow-map pass (renders depth into rgba32float)
// ============================================================

struct ShadowUBO {
  mvp : mat4x4f,
};

@group(0) @binding(0) var<uniform> sU : ShadowUBO;

struct ShadowVSOut {
  @builtin(position) pos : vec4f,
  @location(0) clip : vec4f,
};

@vertex
fn shadow_ground_vs(
  @location(0) inPos : vec3f,
  @location(1) inUV  : vec2f
) -> ShadowVSOut {
  var out : ShadowVSOut;
  let clip = sU.mvp * vec4f(inPos, 1.0);
  out.pos = clip;
  out.clip = clip;
  return out;
}

@vertex
fn shadow_teapot_vs(
  @location(0) inPos  : vec3f,
  @location(1) inNorm : vec3f
) -> ShadowVSOut {
  var out : ShadowVSOut;
  let clip = sU.mvp * vec4f(inPos, 1.0);
  out.pos = clip;
  out.clip = clip;
  return out;
}

@fragment
fn shadow_fs(in : ShadowVSOut) -> @location(0) vec4f {
  let z01 = (in.clip.z / in.clip.w) * 0.5 + 0.5;
  let d = clamp(z01, 0.0, 1.0);
  return vec4f(d, d, d, 1.0);
}
