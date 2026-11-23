/**
 * Swept clear-plastic rods and flat sheets, in millimetres.
 *
 * Ported to TypeScript from Ann Nguyen's CD Case (`caseGeometry.js`, RodBuilder / profile / fillet /
 * sheet / mergeSheets — https://github.com/annnguyentt/vibe-coding/tree/main/cd-case). Behaviour is
 * unchanged: every vertex carries its rod's centre line, side axis and rounded-rectangle profile so
 * ROD_FRAG can trace refraction through the real cross-section.
 */
import * as THREE from 'three';

export type P2 = [number, number];

export interface RodSize {
  /** Half-width across the path (in the path plane). */
  hw: number;
  /** Half-height along +Z. */
  hh: number;
  /** Corner radius of the profile. */
  rc: number;
  /** Z of the rod's centre line. */
  zc: number;
  seg?: number;
  ends?: 'flat' | 'dome';
}

const norm2 = (v: P2): P2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

export function arc(c: P2, r: number, a0: number, a1: number, step = 1.2): P2[] {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / step));
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}

export function fillet(points: P2[], r: number, closed: boolean): P2[] {
  const n = points.length;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(p);
      continue;
    }
    const a = points[(i - 1 + n) % n];
    const b = points[(i + 1) % n];
    const da = norm2([a[0] - p[0], a[1] - p[1]]);
    const db = norm2([b[0] - p[0], b[1] - p[1]]);
    const cos = da[0] * db[0] + da[1] * db[1];
    const half = Math.acos(Math.max(-1, Math.min(1, cos))) / 2;
    if (half > Math.PI / 2 - 1e-3) {
      out.push(p);
      continue;
    }
    const cut = r / Math.tan(half);
    const bis = norm2([da[0] + db[0], da[1] + db[1]]);
    const c: P2 = [p[0] + bis[0] * (r / Math.sin(half)), p[1] + bis[1] * (r / Math.sin(half))];
    const s: P2 = [p[0] + da[0] * cut, p[1] + da[1] * cut];
    const e: P2 = [p[0] + db[0] * cut, p[1] + db[1] * cut];
    const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
    let a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
    if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
    if (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
    out.push(...arc(c, r, a0, a1, 0.8));
  }
  return out;
}

export function roundedRect(cx: number, cy: number, hw: number, hh: number, r: number): P2[] {
  return fillet(
    [
      [cx + hw, cy - hh],
      [cx + hw, cy + hh],
      [cx - hw, cy + hh],
      [cx - hw, cy - hh],
    ],
    Math.min(r, hw - 1e-3, hh - 1e-3),
    true,
  );
}

export function circle(cx: number, cy: number, r: number, step = 1): P2[] {
  const n = Math.max(24, Math.ceil((2 * Math.PI * r) / step));
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

function profile({ hw, hh, rc }: RodSize, seg = 6): { pts: P2[]; nrm: P2[] } {
  const pts: P2[] = [];
  const nrm: P2[] = [];
  const corners: [number, number, number][] = [
    [hw - rc, hh - rc, 0],
    [-(hw - rc), hh - rc, Math.PI / 2],
    [-(hw - rc), -(hh - rc), Math.PI],
    [hw - rc, -(hh - rc), (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      const p: P2 = [cx + rc * Math.cos(a), cy + rc * Math.sin(a)];
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1e-6) continue;
      pts.push(p);
      nrm.push([Math.cos(a), Math.sin(a)]);
    }
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) {
    pts.pop();
    nrm.pop();
  }
  return { pts, nrm };
}

export class RodBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private centre: number[] = [];
  private side: number[] = [];
  private size: number[] = [];
  private cap: number[] = [];
  private index: number[] = [];

  private vertex(p: number[], n: number[], c: number[], s: P2, size: RodSize, cap: number): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.centre.push(c[0], c[1], c[2]);
    this.side.push(s[0], s[1], 0);
    this.size.push(size.hw, size.hh, size.rc);
    this.cap.push(cap);
    return this.pos.length / 3 - 1;
  }

  add(path: P2[], size: RodSize, closed = false): this {
    const { pts, nrm } = profile(size, size.seg ?? 6);
    const m = pts.length;
    const n = path.length;
    const zc = size.zc;
    const frames = path.map((p, i) => {
      const a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const b = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const t = norm2([b[0] - a[0], b[1] - a[1]]);
      return { p, t, s: [-t[1], t[0]] as P2 };
    });
    const base = this.pos.length / 3;
    for (const f of frames) {
      const c = [f.p[0], f.p[1], zc];
      for (let j = 0; j < m; j++) {
        const [px, py] = pts[j];
        const [nx, ny] = nrm[j];
        this.vertex([c[0] + f.s[0] * px, c[1] + f.s[1] * px, zc + py], [f.s[0] * nx, f.s[1] * nx, ny], c, f.s, size, 0);
      }
    }
    const rings = closed ? n : n - 1;
    for (let i = 0; i < rings; i++) {
      const r0 = base + i * m;
      const r1 = base + ((i + 1) % n) * m;
      for (let j = 0; j < m; j++) {
        const j1 = (j + 1) % m;
        this.index.push(r0 + j, r0 + j1, r1 + j, r0 + j1, r1 + j1, r1 + j);
      }
    }
    if (closed) return this;
    if (size.ends === 'flat') {
      for (const [k, dir] of [
        [0, -1],
        [n - 1, 1],
      ] as const) {
        const f = frames[k];
        const c = [f.p[0], f.p[1], zc];
        const out = [f.t[0] * dir, f.t[1] * dir, 0];
        const mid = this.vertex(c, out, c, f.s, size, 1);
        const ring: number[] = [];
        for (let j = 0; j < m; j++) {
          const [px, py] = pts[j];
          ring.push(this.vertex([c[0] + f.s[0] * px, c[1] + f.s[1] * px, zc + py], out, c, f.s, size, 1));
        }
        for (let j = 0; j < m; j++) {
          const a = ring[j];
          const b = ring[(j + 1) % m];
          if (dir > 0) this.index.push(mid, a, b);
          else this.index.push(mid, b, a);
        }
      }
      return this;
    }
    const dome = Math.min(size.hw, size.hh) * 0.8;
    const K = 5;
    for (const [k, dir] of [
      [0, -1],
      [n - 1, 1],
    ] as const) {
      const f = frames[k];
      const c = [f.p[0], f.p[1], zc];
      const ax = [f.t[0] * dir, f.t[1] * dir, 0];
      let prev = base + k * m;
      for (let r = 1; r <= K; r++) {
        const a = (r / K) * (Math.PI / 2);
        const sc = Math.cos(a);
        const off = Math.sin(a) * dome;
        const ring = this.pos.length / 3;
        for (let j = 0; j < m; j++) {
          const [px, py] = pts[j];
          const [nx, ny] = nrm[j];
          const radial = [f.s[0] * nx, f.s[1] * nx, ny];
          const nv = [
            radial[0] * sc * dome + ax[0] * Math.sin(a) * dome * 1.1,
            radial[1] * sc * dome + ax[1] * Math.sin(a) * dome * 1.1,
            radial[2] * sc * dome,
          ];
          const l = Math.hypot(nv[0], nv[1], nv[2]) || 1;
          this.vertex(
            [c[0] + f.s[0] * px * sc + ax[0] * off, c[1] + f.s[1] * px * sc + ax[1] * off, zc + py * sc],
            [nv[0] / l, nv[1] / l, nv[2] / l],
            c,
            f.s,
            size,
            0,
          );
        }
        for (let j = 0; j < m; j++) {
          const j1 = (j + 1) % m;
          if (dir > 0) this.index.push(prev + j, prev + j1, ring + j, prev + j1, ring + j1, ring + j);
          else this.index.push(prev + j, ring + j, prev + j1, prev + j1, ring + j, ring + j1);
        }
        prev = ring;
      }
    }
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aCentre', new THREE.Float32BufferAttribute(this.centre, 3));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(this.side, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(this.size, 3));
    g.setAttribute('aCap', new THREE.Float32BufferAttribute(this.cap, 1));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

/** A flat clear panel between z0 and z1 with optional holes. */
export function sheet(outline: P2[], z0: number, z1: number, holes: P2[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const flat = new THREE.ShapeGeometry(shape, 1);
  const p = flat.attributes.position;
  const idx = flat.index!.array;
  const pos: number[] = [];
  const nrm: number[] = [];
  const index: number[] = [];
  for (const [z, nz] of [
    [z1, 1],
    [z0, -1],
  ]) {
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), z);
      nrm.push(0, 0, nz);
    }
    for (let i = 0; i < idx.length; i += 3) {
      if (nz > 0) index.push(base + idx[i], base + idx[i + 1], base + idx[i + 2]);
      else index.push(base + idx[i], base + idx[i + 2], base + idx[i + 1]);
    }
  }
  flat.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(index);
  g.setAttribute('aThick', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(z1 - z0), 1));
  g.computeBoundingSphere();
  return g;
}

export function mergeSheets(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const thick: number[] = [];
  const index: number[] = [];
  for (const g of list) {
    const base = pos.length / 3;
    pos.push(...(g.attributes.position.array as Float32Array));
    nrm.push(...(g.attributes.normal.array as Float32Array));
    thick.push(...(g.attributes.aThick.array as Float32Array));
    for (const i of g.index!.array) index.push(base + i);
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aThick', new THREE.Float32BufferAttribute(thick, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}
