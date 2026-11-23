/** Small procedural solids for the mechanism, in millimetres. All are centred on their origin. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type P2, circle, roundedRect } from './rods';

const shapeOf = (pts: P2[]): THREE.Shape => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));

/** Rounded box: rounded rectangle in XY, extruded along Z with a soft bevel. */
export function roundedBox(w: number, h: number, d: number, r: number, bevel = 0.4): THREE.BufferGeometry {
  const b = Math.min(bevel, d / 2 - 0.01, r - 0.01);
  const shape = shapeOf(roundedRect(0, 0, w / 2 - b, h / 2 - b, Math.max(r - b, 0.05)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: d - 2 * b,
    bevelEnabled: b > 0,
    bevelSize: b,
    bevelThickness: b,
    bevelSegments: 3,
    curveSegments: 6,
  });
  g.translate(0, 0, -(d - 2 * b) / 2);
  g.computeVertexNormals();
  return g;
}

/** Flat plate with holes, extruded along Z. */
export function plate(outline: P2[], holes: P2[][], thickness: number, bevel = 0.25): THREE.BufferGeometry {
  const shape = shapeOf(outline);
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness - 2 * bevel,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  g.translate(0, 0, -(thickness - 2 * bevel) / 2);
  return g;
}

/** Cylinder whose axis is Z. */
export function cylinderZ(r: number, length: number, seg = 40, r2 = r): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r2, r, length, seg, 1);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Cylinder whose axis is X. */
export function cylinderX(r: number, length: number, seg = 32): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, length, seg, 1);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** Annulus extruded along Z. */
export function ring(rOut: number, rIn: number, depth: number, seg = 64): THREE.BufferGeometry {
  const outer = circle(0, 0, rOut, (2 * Math.PI * rOut) / seg);
  const inner = circle(0, 0, rIn, (2 * Math.PI * rIn) / seg).reverse();
  return plate(outer, [inner], depth, Math.min(0.3, depth / 4));
}

/** A tape hub: ring with six drive teeth on the inside. */
export function hub(rOut: number, rIn: number, toothDepth: number, depth: number): THREE.BufferGeometry {
  const outer = circle(0, 0, rOut, 0.6);
  const hole: P2[] = [];
  const n = 120;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const tooth = Math.cos(a * 6) > 0.82 ? toothDepth : 0;
    hole.push([(rIn - tooth) * Math.cos(a), (rIn - tooth) * Math.sin(a)]);
  }
  return plate(outer, [hole.reverse()], depth, 0.35);
}

/** Spur gear outline extruded along Z. */
export function gear(r: number, teeth: number, depth: number, bore = 1): THREE.BufferGeometry {
  const pts: P2[] = [];
  const n = teeth * 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = Math.cos(a * teeth) > 0 ? 1 : 0.88;
    pts.push([r * k * Math.cos(a), r * k * Math.sin(a)]);
  }
  return plate(pts, [circle(0, 0, bore, 0.3).reverse()], depth, 0.15);
}

/** Cross-head screw: domed head with a recessed cross, axis Z, top at z = 0. */
export function screwHead(r: number): THREE.BufferGeometry {
  const head = new THREE.SphereGeometry(r, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  head.scale(1, 1, 0.42);
  head.rotateX(Math.PI / 2);
  head.translate(0, 0, -r * 0.42);
  const parts = [head];
  return mergeGeometries(parts, false);
}

export function screwCross(r: number): THREE.BufferGeometry {
  const a = new THREE.BoxGeometry(r * 1.3, r * 0.26, r * 0.2);
  const b = new THREE.BoxGeometry(r * 0.26, r * 1.3, r * 0.2);
  const g = mergeGeometries([a, b], false);
  g.translate(0, 0, 0.02);
  return g;
}

/** Knurled thumb wheel, axis X. */
export function knurledWheel(r: number, width: number, ribs = 48): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [cylinderX(r - 0.35, width, 64)];
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2;
    const rib = new THREE.BoxGeometry(width * 0.92, 0.55, 0.7);
    rib.translate(0, r - 0.3, 0);
    rib.rotateX(a);
    parts.push(rib);
  }
  return mergeGeometries(
    parts.map((g) => (g.index ? g.toNonIndexed() : g)),
    false,
  );
}

/** Closed belt around two pulleys in the XY plane, as a thin tube. */
export function belt(c1: P2, r1: number, c2: P2, r2: number, z: number, thick = 0.55): THREE.BufferGeometry {
  const dx = c2[0] - c1[0];
  const dy = c2[1] - c1[1];
  const d = Math.hypot(dx, dy);
  const base = Math.atan2(dy, dx);
  const phi = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
  const pts: THREE.Vector3[] = [];
  const steps = 48;
  // Around pulley 1 the long way, then pulley 2 the short way.
  for (let i = 0; i <= steps; i++) {
    const a = base + phi + ((2 * Math.PI - 2 * phi) * i) / steps;
    pts.push(new THREE.Vector3(c1[0] + r1 * Math.cos(a), c1[1] + r1 * Math.sin(a), z));
  }
  for (let i = 0; i <= steps; i++) {
    const a = base - phi + (2 * phi * i) / steps;
    pts.push(new THREE.Vector3(c2[0] + r2 * Math.cos(a), c2[1] + r2 * Math.sin(a), z));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  return new THREE.TubeGeometry(curve, 220, thick, 6, true);
}
