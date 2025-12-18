struct Uniforms {
  mvp   : mat4x4<f32>,
  mtex  : mat4x4<f32>,
  model : mat4x4<f32>,
  eye   : vec4<f32>,
  flags : vec4<u32>,     // x = isBG, y = reflective
};

@group(0) @binding(0) var<uniform> U : Uniforms;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var cubeTex : texture_cube<f32>;
@group(0) @binding(3) var normalTex : texture_2d<f32>;

struct VSIn {
  @location(0) pos : vec4<f32>,
  @location(1) nrm : vec4<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) wnrm : vec3<f32>,
  @location(1) wpos : vec3<f32>,
  @location(2) clip : vec4<f32>,
};

fn rotate_to_normal(n: vec3f, v: vec3f) -> vec3f
{
  let sgn_nz = sign(n.z + 1.0e-16);
  let a = -1.0/(1.0 + abs(n.z));
  let b = n.x*n.y*a;
  return vec3f(1.0 + n.x*n.x*a, b, -sgn_nz*n.x)*v.x
       + vec3f(sgn_nz*b, sgn_nz*(1.0 + n.y*n.y*a), -n.y)*v.y
       + n*v.z;
}

@vertex
fn main_vs(input : VSIn) -> VSOut {
  var out : VSOut;

  let isBG = (U.flags.x != 0u);

  out.position = select(U.mvp * vec4<f32>(input.pos.xyz, 1.0), input.pos, isBG);
  out.clip = input.pos;

  let wp = U.model * vec4<f32>(input.pos.xyz, 1.0);
  out.wpos = wp.xyz / wp.w;

  let wn = U.model * vec4<f32>(input.nrm.xyz, 0.0);
  out.wnrm = normalize(wn.xyz);

  return out;
}

@fragment
fn main_fs(input : VSOut) -> @location(0) vec4<f32> {
  let isBG = (U.flags.x != 0u);
  let reflective = (U.flags.y != 0u) && !isBG;

  var n = normalize(input.wnrm);

  let p = U.mtex * input.clip;
  let bgDir = normalize(vec3<f32>(p.x, select(p.y, -p.y, isBG), p.z) / p.w);

  let baseDir = select(n, bgDir, isBG);

  if (reflective) {
    let nf = normalize(vec3<f32>(n.x, -n.y, n.z));

    let u = atan2(nf.z, nf.x) / (2.0 * 3.14159265) + 0.5;
    let v = acos(nf.y) / 3.14159265;

    let nm = textureSample(normalTex, samp, vec2<f32>(u, v)).xyz;
    let tN = normalize(nm * 2.0 - 1.0);

    let bumpN = normalize(rotate_to_normal(nf, tN));

    let viewVec = normalize(U.eye.xyz - input.wpos);
    let r = normalize(reflect(-viewVec, bumpN));

    return textureSample(cubeTex, samp, r);
  }

  return textureSample(cubeTex, samp, normalize(baseDir));
}
