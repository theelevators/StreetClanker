import type { Entity } from "./entity.js";
import type { ComponentType } from "./component.js";
import type { TransformData } from "./transform.js";

/** Row-major 4x4 */
export type Mat4 = Float64Array;

export function mat4Identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** Local TRS (Euler XYZ) → matrix. */
export function trsToMat4(t: TransformData, out: Mat4 = mat4Identity()): Mat4 {
  const cx = Math.cos(t.rx);
  const sx = Math.sin(t.rx);
  const cy = Math.cos(t.ry);
  const sy = Math.sin(t.ry);
  const cz = Math.cos(t.rz);
  const sz = Math.sin(t.rz);

  // R = Rz * Ry * Rx (Three.js Object3D default order)
  const r00 = cz * cy;
  const r01 = cz * sy * sx - sz * cx;
  const r02 = cz * sy * cx + sz * sx;
  const r10 = sz * cy;
  const r11 = sz * sy * sx + cz * cx;
  const r12 = sz * sy * cx - cz * sx;
  const r20 = -sy;
  const r21 = cy * sx;
  const r22 = cy * cx;

  out[0] = r00 * t.sx;
  out[1] = r10 * t.sx;
  out[2] = r20 * t.sx;
  out[3] = 0;
  out[4] = r01 * t.sy;
  out[5] = r11 * t.sy;
  out[6] = r21 * t.sy;
  out[7] = 0;
  out[8] = r02 * t.sz;
  out[9] = r12 * t.sz;
  out[10] = r22 * t.sz;
  out[11] = 0;
  out[12] = t.x;
  out[13] = t.y;
  out[14] = t.z;
  out[15] = 1;
  return out;
}

export function mat4Multiply(a: Mat4, b: Mat4, out: Mat4 = mat4Identity()): Mat4 {
  const o = out === a || out === b ? new Float64Array(16) : out;
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r]! * b[c * 4 + 0]! +
        a[1 * 4 + r]! * b[c * 4 + 1]! +
        a[2 * 4 + r]! * b[c * 4 + 2]! +
        a[3 * 4 + r]! * b[c * 4 + 3]!;
    }
  }
  if (o !== out) out.set(o);
  return out;
}

export function mat4Invert(m: Mat4, out: Mat4 = mat4Identity()): Mat4 | null {
  // Affine inverse for TRS-ish matrices
  const n11 = m[0]!,
    n21 = m[1]!,
    n31 = m[2]!;
  const n12 = m[4]!,
    n22 = m[5]!,
    n32 = m[6]!;
  const n13 = m[8]!,
    n23 = m[9]!,
    n33 = m[10]!;
  const t1 = m[12]!,
    t2 = m[13]!,
    t3 = m[14]!;

  const det =
    n11 * (n22 * n33 - n32 * n23) -
    n21 * (n12 * n33 - n32 * n13) +
    n31 * (n12 * n23 - n22 * n13);
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;

  out[0] = (n22 * n33 - n32 * n23) * invDet;
  out[1] = (n31 * n23 - n21 * n33) * invDet;
  out[2] = (n21 * n32 - n31 * n22) * invDet;
  out[3] = 0;
  out[4] = (n32 * n13 - n12 * n33) * invDet;
  out[5] = (n11 * n33 - n31 * n13) * invDet;
  out[6] = (n31 * n12 - n11 * n32) * invDet;
  out[7] = 0;
  out[8] = (n12 * n23 - n22 * n13) * invDet;
  out[9] = (n21 * n13 - n11 * n23) * invDet;
  out[10] = (n11 * n22 - n21 * n12) * invDet;
  out[11] = 0;
  out[12] = -(out[0]! * t1 + out[4]! * t2 + out[8]! * t3);
  out[13] = -(out[1]! * t1 + out[5]! * t2 + out[9]! * t3);
  out[14] = -(out[2]! * t1 + out[6]! * t2 + out[10]! * t3);
  out[15] = 1;
  return out;
}

/** Extract TRS (Euler XYZ) from matrix — sufficient for hierarchy reparent. */
export function mat4ToTrs(m: Mat4, out: TransformData): TransformData {
  out.x = m[12]!;
  out.y = m[13]!;
  out.z = m[14]!;

  const sx = Math.hypot(m[0]!, m[1]!, m[2]!);
  const sy = Math.hypot(m[4]!, m[5]!, m[6]!);
  const sz = Math.hypot(m[8]!, m[9]!, m[10]!);
  out.sx = sx || 1;
  out.sy = sy || 1;
  out.sz = sz || 1;

  const r00 = m[0]! / out.sx;
  const r10 = m[1]! / out.sx;
  const r20 = m[2]! / out.sx;
  const r21 = m[6]! / out.sy;
  const r22 = m[10]! / out.sz;

  out.ry = Math.asin(Math.max(-1, Math.min(1, -r20)));
  if (Math.cos(out.ry) > 1e-6) {
    out.rx = Math.atan2(r21, r22);
    out.rz = Math.atan2(r10, r00);
  } else {
    out.rx = Math.atan2(-m[9]! / out.sz, m[5]! / out.sy);
    out.rz = 0;
  }
  return out;
}

export function copyTrs(from: TransformData, to: TransformData): void {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.rx = from.rx;
  to.ry = from.ry;
  to.rz = from.rz;
  to.sx = from.sx;
  to.sy = from.sy;
  to.sz = from.sz;
}

export type HierarchyNameFn = (entity: Entity) => string | undefined;

/**
 * Format a forest of roots as a text tree.
 */
export function formatHierarchyTree(
  roots: Entity[],
  childrenOf: (e: Entity) => readonly Entity[],
  label: (e: Entity) => string,
): string {
  const lines: string[] = ["World Hierarchy", "────────────────", ""];
  function walk(entity: Entity, prefix: string, isLast: boolean): void {
    const branch = prefix === "" ? "" : isLast ? "└── " : "├── ";
    lines.push(`${prefix}${branch}${label(entity)}`);
    const kids = childrenOf(entity);
    const nextPrefix =
      prefix === "" ? "" : prefix + (isLast ? "    " : "│   ");
    for (let i = 0; i < kids.length; i++) {
      walk(kids[i]!, nextPrefix === "" ? "" : nextPrefix, i === kids.length - 1);
    }
    if (prefix === "" && kids.length) {
      // roots printed with children using ├── under empty prefix awkwardly —
      // for roots, print name then children with tree prefixes
    }
  }
  // Cleaner root printing:
  lines.length = 3;
  for (let r = 0; r < roots.length; r++) {
    const root = roots[r]!;
    lines.push(label(root));
    const kids = childrenOf(root);
    for (let i = 0; i < kids.length; i++) {
      walkChild(kids[i]!, "", i === kids.length - 1, childrenOf, label, lines);
    }
    if (r < roots.length - 1) lines.push("");
  }
  return lines.join("\n");
}

function walkChild(
  entity: Entity,
  prefix: string,
  isLast: boolean,
  childrenOf: (e: Entity) => readonly Entity[],
  label: (e: Entity) => string,
  lines: string[],
): void {
  lines.push(`${prefix}${isLast ? "└── " : "├── "}${label(entity)}`);
  const kids = childrenOf(entity);
  const next = prefix + (isLast ? "    " : "│   ");
  for (let i = 0; i < kids.length; i++) {
    walkChild(kids[i]!, next, i === kids.length - 1, childrenOf, label, lines);
  }
}

export type EntityInspect = {
  entity: Entity;
  parent: Entity | null;
  children: Entity[];
  root: Entity;
  components: string[];
};
