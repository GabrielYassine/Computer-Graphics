struct VSIn {
  @location(0) pos : vec2<f32>,
  @location(1) col : vec3<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec3<f32>,
};

@vertex
fn main_vs(input : VSIn) -> VSOut {
  var out : VSOut;
  out.position = vec4<f32>(input.pos, 0.0, 1.0);
  out.color = input.col;
  return out;
}

@fragment
fn main_fs(input : VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(input.color, 1.0);
}
