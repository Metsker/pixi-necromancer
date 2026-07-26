import { Container, Sprite, Texture } from "pixi.js";
import { TILE } from "../tilemap.ts";
import type { GlyphSet } from "./glyphs.ts";
import type { Surface } from "./surface.ts";

// A character grid over Pixi: two sprite pools, one for cell fills and one for
// glyphs. Everything the game draws goes through put(), so a tap can be turned
// back into a cell with nothing but arithmetic.
export class Grid implements Surface {
  readonly root = new Container();
  cols = 0;
  rows = 0;
  cssCell = 0;

  private readonly back = new Container();
  private readonly front = new Container();
  private readonly bgS: Sprite[] = [];
  private readonly fgS: Sprite[] = [];
  private ch: string[] = [];
  private fg: number[] = [];
  private bg: number[] = [];

  constructor(
    private glyphs: GlyphSet,
    private base: number,
  ) {
    this.back.eventMode = "none";
    this.front.eventMode = "none";
    this.root.addChild(this.back, this.front);
  }

  resize(cols: number, rows: number, cssCell: number) {
    this.cols = cols;
    this.rows = rows;
    this.cssCell = cssCell;
    const n = cols * rows;

    while (this.bgS.length < n) {
      const b = new Sprite(Texture.WHITE);
      const f = new Sprite();
      b.eventMode = "none";
      f.eventMode = "none";
      this.back.addChild(b);
      this.front.addChild(f);
      this.bgS.push(b);
      this.fgS.push(f);
    }

    for (let i = 0; i < this.bgS.length; i++) {
      const on = i < n;
      const b = this.bgS[i];
      const f = this.fgS[i];
      b.visible = on;
      f.visible = false;
      if (!on) continue;
      const x = (i % cols) * cssCell;
      const y = Math.floor(i / cols) * cssCell;
      b.position.set(x, y);
      b.setSize(cssCell, cssCell);
      f.position.set(x, y);
      f.scale.set(cssCell / TILE);
    }

    this.ch = new Array(n).fill(" ");
    this.fg = new Array(n).fill(this.base);
    this.bg = new Array(n).fill(this.base);
  }

  clear(bg = this.base) {
    this.ch.fill(" ");
    this.fg.fill(bg);
    this.bg.fill(bg);
  }

  put(x: number, y: number, ch: string, fg: number, bg?: number) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = y * this.cols + x;
    this.ch[i] = ch;
    this.fg[i] = fg;
    if (bg !== undefined) this.bg[i] = bg;
  }

  fill(x: number, y: number, w: number, h: number, bg: number) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, " ", bg, bg);
  }

  // Walked as code points, not code units: half a surrogate pair is not a glyph
  text(x: number, y: number, s: string, fg: number, bg?: number) {
    [...s].forEach((ch, i) => this.put(x + i, y, ch, fg, bg));
  }

  center(x: number, y: number, w: number, s: string, fg: number, bg?: number) {
    const t = [...s].slice(0, w);
    this.text(x + Math.max(0, (w - t.length) >> 1), y, t.join(""), fg, bg);
  }

  flush() {
    const n = this.cols * this.rows;
    for (let i = 0; i < n; i++) {
      const b = this.bgS[i];
      const f = this.fgS[i];
      b.tint = this.bg[i];
      const t = this.glyphs[this.ch[i]];
      if (!t || this.ch[i] === " ") {
        f.visible = false;
        continue;
      }
      if (f.texture !== t) f.texture = t;
      f.tint = this.fg[i];
      f.visible = true;
    }
  }

  cellAt(px: number, py: number) {
    return { x: Math.floor(px / this.cssCell), y: Math.floor(py / this.cssCell) };
  }
}
