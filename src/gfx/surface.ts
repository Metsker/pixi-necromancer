// As much of a Grid as a screen actually draws through. Kept apart from the Grid
// itself so a check can hand a screen a stub without dragging the renderer in.
export type Surface = {
  cols: number;
  rows: number;
  put(x: number, y: number, ch: string, fg: number, bg?: number): void;
  fill(x: number, y: number, w: number, h: number, bg: number): void;
  text(x: number, y: number, s: string, fg: number, bg?: number): void;
  center(x: number, y: number, w: number, s: string, fg: number, bg?: number): void;
};

// A run of columns of a wider surface, addressed from zero
export const inset = (g: Surface, at: number, cols: number): Surface => ({
  cols,
  rows: g.rows,
  put: (x, y, ch, fg, bg) => g.put(x + at, y, ch, fg, bg),
  fill: (x, y, w, h, bg) => g.fill(x + at, y, w, h, bg),
  text: (x, y, s, fg, bg) => g.text(x + at, y, s, fg, bg),
  center: (x, y, w, s, fg, bg) => g.center(x + at, y, w, s, fg, bg),
});
