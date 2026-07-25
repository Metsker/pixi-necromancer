import { CanvasSource, Rectangle, Texture } from "pixi.js";
import { TILE, TILE_MAP } from "../tilemap.ts";

export type GlyphSet = Record<string, Texture>;

// ponytail: luminance-as-alpha, assumes the 1-bit black/white sheet this pack ships.
// Tinting multiplies against alpha, and the sheet is fully opaque, so without this
// every glyph paints as a solid square.
export async function loadGlyphs(src: string): Promise<GlyphSet> {
  const img = new Image();
  img.src = src;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i + 3] = px[i];
    px[i] = px[i + 1] = px[i + 2] = 255;
  }
  ctx.putImageData(image, 0, 0);

  const source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
  const out: GlyphSet = {};
  for (const [ch, [x, y]] of Object.entries(TILE_MAP)) {
    out[ch] = new Texture({ source, frame: new Rectangle(x, y, TILE, TILE) });
  }
  return out;
}
