// Uniforms: MVP only (64 bytes)
struct UBO {
  mvp : mat4x4f,
};
@group(0) @binding(0) var<uniform> U : UBO;

@group(0) @binding(1) var mySampler : sampler;
@group(0) @binding(2) var myCube    : texture_cube<f32>;

struct VSIn {
  @location(0) pos : vec3f,
  @location(1) nrm : vec3f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) nrmW : vec3f,   // world-space normal (model is identity)
};

@vertex
fn vs_main(in : VSIn) -> VSOut {
  var o : VSOut;
  o.position = U.mvp * vec4f(in.pos, 1.0);
  o.nrmW = normalize(in.nrm);       // sphere provides unit normals
  return o;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  // Flip Y in the lookup direction
  let dir = vec3f(in.nrmW.x, -in.nrmW.y, in.nrmW.z);
  let color = textureSample(myCube, mySampler, dir);
  return color;
}
