// UBO layout:
//  mvp   : model-view-projection (sphere)
//  mtex  : Rcw * inverse(P) to turn clip → world dir (background)
//  model : sphere model matrix (rotation only here)
//  eye   : world-space eye position (xyz)
//  flags : x = pass (1=background, 0=sphere), y = reflective (sphere)
struct UBO {
  mvp   : mat4x4f,  // 64
  mtex  : mat4x4f,  // 64
  model : mat4x4f,  // 64
  eye   : vec4f,    // 16
  flags : vec4u,    // 16
};                  // = 224 bytes
@group(0) @binding(0) var<uniform> U : UBO;

@group(0) @binding(1) var samp    : sampler;
@group(0) @binding(2) var cubeTex : texture_cube<f32>;
@group(0) @binding(3) var normTex : texture_2d<f32>;   // normal map (RGB)

// Efficient change-of-basis from tangent-space to world aligned with normal `n`.
// Takes world-space surface normal `n` and tangent-space vector `v` → returns world-space vector.
fn rotate_to_normal(n: vec3f, v: vec3f) -> vec3f {
  let sgn_nz = sign(n.z + 1.0e-16);
  let a = -1.0 / (1.0 + abs(n.z));
  let b = n.x * n.y * a;
  return (vec3f(1.0 + n.x*n.x*a, b, -sgn_nz*n.x) * v.x)
       + (vec3f(sgn_nz*b, sgn_nz*(1.0 + n.y*n.y*a), -n.y) * v.y)
       + (n * v.z);
}

struct VSIn {
  @location(0) pos : vec3f, // bg: clip xy & z; sphere: model pos
  @location(1) nrm : vec3f, // bg: dummy; sphere: normal
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) dirW : vec3f, // bg: world dir; sphere: unused
  @location(1) nrmW : vec3f, // sphere: world normal (unperturbed)
  @location(2) wpos : vec3f, // sphere: world position
};

@vertex
fn vs_main(in : VSIn) -> VSOut {
  var o : VSOut;

  if (U.flags.x == 1u) {
    // Background quad: positions are clip coords (x,y,0.999,1)
    let posClip = vec4f(in.pos, 1.0);
    o.position = posClip;

    // Clip → camera via P^-1, then to world via Rcw (packed in U.mtex).
    let c   = U.mtex * posClip;
    let cam = c.xyz / c.w;
    o.dirW  = normalize(cam);

    o.nrmW = vec3f(0.0);
    o.wpos = vec3f(0.0);
  } else {
    // Sphere
    o.position = U.mvp * vec4f(in.pos, 1.0);
    o.nrmW = normalize((U.model * vec4f(in.nrm, 0.0)).xyz);
    o.wpos = (U.model * vec4f(in.pos, 1.0)).xyz;
    o.dirW = vec3f(0.0);
  }
  return o;
}

// Compute spherical UVs from a world-space normal (like W06 P3)
fn uv_from_normal(n: vec3f) -> vec2f {
  let u = (atan2(n.z, n.x) / (2.0 * 3.14159265)) + 0.5;
  let v = 0.5 - asin(n.y) / 3.14159265;
  return vec2f(u, v);
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  var lookup : vec3f;

  if (U.flags.x == 1u) {
    // Background uses direction from clip
    lookup = in.dirW;
  } else {
    // Sphere: compute view vector (eye → point)
    let n0 = normalize(in.nrmW);             // unperturbed normal (world)
    let v  = normalize(in.wpos - U.eye.xyz); // view vector

    // Sample normal map in tangent space using UV from unperturbed normal
    let uv = uv_from_normal(n0);
    let tN = textureSample(normTex, samp, uv).rgb * 2.0 - vec3f(1.0); // [0,1]^3 → [-1,1]^3

    // Rotate tangent-space normal to world space aligned with n0
    let nBump = normalize(rotate_to_normal(n0, tN));

    // Choose between plain normal or bump-mapped normal (reflective sphere)
    let nUsed = select(n0, nBump, U.flags.y == 1u);

    // Reflection vector for environment lookup
    let refl = reflect(-v, nUsed);
    lookup = refl;
  }

  // Flip Y for your cube asset
  let dir = vec3f(lookup.x, -lookup.y, lookup.z);
  let color = textureSample(cubeTex, samp, dir);
  return color;
}
