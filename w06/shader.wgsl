struct UBO {
  mvp : mat4x4f,
};
@group(0) @binding(0) var<uniform> U : UBO;

@group(0) @binding(1) var mySampler : sampler;
@group(0) @binding(2) var myTex     : texture_2d<f32>;

struct VSIn {
  @location(0) pos : vec3f,
  @location(1) uv  : vec2f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs_main(in : VSIn) -> VSOut {
  var o : VSOut;
  o.position = U.mvp * vec4f(in.pos, 1.0);
  o.uv = in.uv;
  return o;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  // Sample checkerboard texture with repeat wrapping & nearest filter
  let color = textureSample(myTex, mySampler, in.uv);
  return color;
}
