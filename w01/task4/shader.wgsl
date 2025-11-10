struct Uniforms {
  theta: f32,
  _pad0: f32, _pad1: f32, _pad2: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VSOut {
  @builtin(position) position: vec4f,
};

@vertex
fn main_vs(@location(0) inPos: vec2f) -> VSOut {
  let c = cos(uniforms.theta);
  let s = sin(uniforms.theta);
  let p = vec2f(c*inPos.x - s*inPos.y, s*inPos.x + c*inPos.y);

  var out: VSOut;
  out.position = vec4f(p, 0.0, 1.0);
  return out;
}

@fragment
fn main_fs() -> @location(0) vec4f {
  return vec4f(1.0, 1.0, 1.0, 1.0);
}
