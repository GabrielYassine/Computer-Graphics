struct VertexOut {
	@builtin(position) position: vec4f,
	@location(0) color: vec3f
};

@group(0) @binding(0) var<uniform> uModel: mat4x4f;

@vertex
fn main_vs(
	@location(0) pos: vec2f,
	@location(1) color: vec3f
) -> VertexOut {
	var out: VertexOut;
	let p = vec4f(pos, 0.0, 1.0);
	out.position = uModel * p;
	out.color = color;
	return out;
}

@fragment
fn main_fs(@location(0) color: vec3f) -> @location(0) vec4f {
	return vec4f(color, 1.0);
}
