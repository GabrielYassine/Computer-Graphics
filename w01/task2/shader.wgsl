struct VSOut {
    @builtin(position) position: vec4f
};

@vertex
fn main_vs(@location(0) inPos: vec2f) -> VSOut {
    var out: VSOut;
    out.position = vec4f(inPos, 0.0, 1.0);
    return out;
}

@fragment
fn main_fs() -> @location(0) vec4f {
    return vec4f(0.0, 0.0, 0.0, 1.0);
}
