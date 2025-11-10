// Phong lighting per fragment: ambient + diffuse + specular
// Inputs: pos/nrm/col as vec4 from buffers (pos.w=1, nrm.w unused).
// Uniforms: MVP, eye.xyz, lightDir.xyz, shininess.

struct UBO {
  mvp      : mat4x4f,
  eye_pad  : vec4f,   // eye.xyz, .w unused
  light_sh : vec4f,   // lightDir.xyz, shininess in .w
};
@group(0) @binding(0) var<uniform> U : UBO;

struct VSIn {
  @location(0) pos : vec4f,
  @location(1) nrm : vec4f,
  @location(2) col : vec4f,
};

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) worldPos : vec3f,
  @location(1) normal   : vec3f,
  @location(2) color    : vec3f,
};

@vertex
fn vs_main(in : VSIn) -> VSOut {
  var o: VSOut;
  o.position = U.mvp * in.pos;
  o.worldPos = in.pos.xyz;               // model = identity
  o.normal   = normalize(in.nrm.xyz);    // vertex normal from OBJ
  o.color    = in.col.rgb;               // diffuse base color
  return o;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  let n  = normalize(in.normal);
  // NOTE: lightDir in U is the "direction the light travels" (toward surface),
  // we use -dir to get vector pointing *from light to surface* in the dot.
  let wi = normalize(-U.light_sh.xyz);
  let wo = normalize(U.eye_pad.xyz - in.worldPos);

  // material constants (you can parameterize later if you like)
  let kd = 1.0;   // diffuse scale
  let ka = 0.15;  // ambient scale
  let ks = 0.35;  // specular scale
  let s  = U.light_sh.w; // shininess

  let ndotl = max(dot(n, wi), 0.0);
  var Lo = in.color * (ka + kd * ndotl);                 // ambient + diffuse

  let r = reflect(-wi, n);
  let spec = pow(max(dot(r, wo), 0.0), s);
  Lo += vec3f(ks * spec);

  return vec4f(Lo, 1.0);
}
