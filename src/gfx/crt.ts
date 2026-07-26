import { defaultFilterVert, Filter, GlProgram, UniformGroup } from "pixi.js";

const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
// highp, because the vertex stage declares these too and the link fails if the
// two disagree about precision
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform highp vec4 uInputClamp;

uniform float uCurve;
uniform float uScan;
uniform float uPitch;
uniform float uSplit;
uniform float uVignette;

// Clamped, because a bent or split sample can land past the edge of the picture
vec4 tap(vec2 uv) {
  vec2 t = uv * uOutputFrame.zw * uInputSize.zw;
  return texture(uTexture, clamp(t, uInputClamp.xy, uInputClamp.zw));
}

void main(void) {
  // The glass bulges: what the middle of an edge shows gets pushed outward, and
  // the corners get pushed off the tube entirely. Divided by the bulge at an
  // edge, so the last row and column stay on screen and only corners are lost.
  vec2 c = vTextureCoord * uInputSize.xy / uOutputFrame.zw * 2.0 - 1.0;
  float r2 = dot(c, c);
  vec2 uv = c * (1.0 + uCurve * r2) / (1.0 + uCurve) * 0.5 + 0.5;

  // Past the edge of the tube there is no picture, only the dark bezel
  if (uv != clamp(uv, 0.0, 1.0)) {
    finalColor = vec4(0.0);
    return;
  }

  // Three guns land a hair apart, wider off to the sides
  vec2 off = c * uSplit * 0.003;
  vec4 col = tap(uv);
  col.r = tap(uv + off).r;
  col.b = tap(uv - off).b;

  // The beam skips rows, and the corners never get quite as bright.
  // Premultiplied color, so dimming the whole vec4 keeps it consistent.
  float line = 0.5 + 0.5 * cos(uv.y * uOutputFrame.w / uPitch * 6.2831853);
  finalColor = col * (1.0 - uScan * line) * (1.0 - uVignette * r2);
}
`;

// A knob per artifact, because the right amount of each is a thing you look at
// rather than derive: barrel, scanline depth, scanline spacing in css px,
// color fringing, corner falloff.
export const crtFilter = () =>
  new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: "crt" }),
    // Filters render at resolution 1 by default, which would put the whole game
    // through a half-size texture on a phone. Inherit the screen's own.
    resolution: "inherit",
    resources: {
      crt: new UniformGroup({
        uCurve: { value: 0.06, type: "f32" },
        uScan: { value: 0.22, type: "f32" },
        uPitch: { value: 3, type: "f32" },
        uSplit: { value: 1, type: "f32" },
        uVignette: { value: 0.18, type: "f32" },
      }),
    },
  });

// Where on the flat picture a spot on the bent glass is. The same bend as the
// shader, kept here rather than duplicated as a number, so a finger lands on the
// glyph it looks like it landed on.
export const bend = (crt: Filter, px: number, py: number, w: number, h: number) => {
  const k = (crt.resources.crt.uniforms as { uCurve: number }).uCurve;
  const cx = (px / w) * 2 - 1;
  const cy = (py / h) * 2 - 1;
  const s = (1 + k * (cx * cx + cy * cy)) / (1 + k);
  return { x: ((cx * s + 1) / 2) * w, y: ((cy * s + 1) / 2) * h };
};
