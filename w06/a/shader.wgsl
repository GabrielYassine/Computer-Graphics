// Uniforms
struct UBO {
  mvp        : mat4x4f,    // 64
  eye        : vec4f,      // 16 (xyz used)
  lightDir   : vec4f,      // 16 (xyz used)
  flags      : vec4u,      // 16 (x: use_mipmap 0/1, y: scene 0=quad,1=sphere)
};                          // total 112 bytes
@group(0) @binding(0) var<uniform> U : UBO;

@group(0) @binding(1) var mySampler : sampler;
@group(0) @binding(2) var myTex     : texture_2d<f32>;

struct VSInQuad {
  @location(0) pos : vec3f,
  @location(1) uv  : vec2f,
};
struct VSInSphere {
  @location(0) pos : vec3f,
  @location(1) nrm : vec3f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) uv    : vec2f,   // used in quad scene
  @location(1) nrm   : vec3f,   // used in sphere scene
  @location(2) wpos  : vec3f,   // for view dir in lighting
};

@vertex
fn vs_quad(in : VSInQuad) -> VSOut {
  var o : VSOut;
  o.position = U.mvp * vec4f(in.pos, 1.0);
  o.uv   = in.uv;
  o.nrm  = vec3f(0.0,1.0,0.0);
  o.wpos = in.pos;
  return o;
}

@vertex
fn vs_sphere(in : VSInSphere) -> VSOut {
  var o : VSOut;
  o.position = U.mvp * vec4f(in.pos, 1.0);
  o.uv   = vec2f(0.0);       // not used
  o.nrm  = normalize(in.nrm);
  o.wpos = in.pos;
  return o;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  // Decide UV source
  var uv : vec2f;
  if (U.flags.y == 0u) {
    // quad: use interpolated UV directly
    uv = in.uv;
  } else {
    // sphere: compute UV from normal (longitude/latitude)
    let n = normalize(in.nrm);
    // u in [0,1): atan2(n.z, n.x) mapped to [0,1)
    let u = (atan2(n.z, n.x) / (2.0 * 3.14159265)) + 0.5;
    // v in [0,1]: asin(n.y) mapped to [0,1]
    let v = 0.5 - asin(n.y) / 3.14159265;
    uv = vec2f(u, v);
  }

  // Sample either with mipmaps (default) or force base level (no mips)
  var texColor : vec4f;
  if (U.flags.x == 0u) {
    texColor = textureSampleLevel(myTex, mySampler, uv, 0.0);
  } else {
    texColor = textureSample(myTex, mySampler, uv);
  }

  // Diffuse lighting (Lambert) so we can see shape on sphere scene
  let n  = normalize(in.nrm);
  let wi = normalize(-U.lightDir.xyz);
  let ndotl = max(dot(n, wi), 0.0);
  let kd = 1.0;
  let ka = 0.15;

  // For the quad we just display texture; for sphere we modulate with diffuse
  var col = texColor.rgb;
  if (U.flags.y == 1u) {
    col = texColor.rgb * (ka + kd * ndotl);
  }
  return vec4f(col, 1.0);
}
