// UBO: MVP + visibility factor (x component of vis)
struct UBO {
  mvp : mat4x4f,   // 64 bytes
  vis : vec4f,     // 16 bytes (use vis.x)
};
@group(0) @binding(0) var<uniform> U : UBO;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var tex  : texture_2d<f32>;

struct VSIn {
  @location(0) pos : vec3f,
  @location(1) uv  : vec2f,
};
struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs_main(i : VSIn) -> VSOut {
  var o : VSOut;
  o.position = U.mvp * vec4f(i.pos, 1.0);
  o.uv = i.uv;
  return o;
}

@fragment
fn fs_main(i : VSOut) -> @location(0) vec4f {
  let base = textureSample(tex, samp, i.uv);
  // visibility: 1.0 → show texture; 0.0 → black (shadow)
  return base * U.vis.x;
}
