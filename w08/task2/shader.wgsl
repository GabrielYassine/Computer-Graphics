struct UBO {
  mvp   : mat4x4<f32>,
  color : vec4<f32>,
};

@group(0) @binding(0) var<uniform> U : UBO;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var tex  : texture_2d<f32>;

struct VSIn {
  @location(0) pos : vec3<f32>,
  @location(1) uv  : vec2<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(i : VSIn) -> VSOut {
  var o : VSOut;
  o.position = U.mvp * vec4<f32>(i.pos, 1.0);
  o.uv = i.uv;
  return o;
}

@fragment
fn fs_main(i : VSOut) -> @location(0) vec4<f32> {
  return textureSample(tex, samp, i.uv) * U.color;
}
