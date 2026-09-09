import type { Point } from './layoutEngines';

// Solves for the planar projective transform (homography) mapping 4 source
// points onto 4 destination points, then applies it to arbitrary points.
// Self-contained rather than pulling in a library: the one well-known
// npm package for this (perspective-transform) relies on top-level `this`
// to detect the global object, which is `undefined` in a strict ES module
// (how Vite bundles it) and throws at import time.
//
// The transform has the form:
//   u = (a*x + b*y + c) / (g*x + h*y + 1)
//   v = (d*x + e*y + f) / (g*x + h*y + 1)
// Each of the 4 point pairs contributes 2 linear equations in the 8
// unknowns [a..h], solved via Gaussian elimination.
export interface Homography {
  transform(x: number, y: number): Point;
}

const solveLinearSystem = (a: number[][], b: number[]): number[] => {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];

    const pivotVal = m[col][col];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row][col] / pivotVal;
      for (let k = col; k <= n; k++) m[row][k] -= factor * m[col][k];
    }
  }

  return m.map((row, i) => row[n] / row[i]);
};

export const computeHomography = (src: Point[], dst: Point[]): Homography => {
  const rows: number[][] = [];
  const b: number[] = [];

  src.forEach((s, i) => {
    const d = dst[i];
    rows.push([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y]);
    b.push(d.x);
    rows.push([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y]);
    b.push(d.y);
  });

  const [a, bb, c, dd, e, f, g, h] = solveLinearSystem(rows, b);

  return {
    transform: (x: number, y: number) => {
      const w = g * x + h * y + 1;
      return { x: (a * x + bb * y + c) / w, y: (dd * x + e * y + f) / w };
    },
  };
};
