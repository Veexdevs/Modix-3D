import * as THREE from 'three';
import type { EditableMeshData, ModifierItem, PrimitiveType } from '../types/scene';

export function cloneMeshData(mesh: EditableMeshData): EditableMeshData {
  return {
    vertices: mesh.vertices.map((v) => [v[0], v[1], v[2]]),
    faces: mesh.faces.map((f) => [...f]),
    vertexColors: mesh.vertexColors ? mesh.vertexColors.map((c) => [c[0], c[1], c[2]]) : undefined,
    shadeSmooth: Boolean(mesh.shadeSmooth)
  };
}

export function computeFaceNormal(
  vertices: [number, number, number][],
  face: number[]
): [number, number, number] {
  if (face.length < 3) return [0, 0, 1];
  // Newell's method for arbitrary polygon normal
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < face.length; i++) {
    const curr = vertices[face[i]];
    const next = vertices[face[(i + 1) % face.length]];
    if (!curr || !next) continue;
    nx += (curr[1] - next[1]) * (curr[2] + next[2]);
    ny += (curr[2] - next[2]) * (curr[0] + next[0]);
    nz += (curr[0] - next[0]) * (curr[1] + next[1]);
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function computeFaceCenter(
  vertices: [number, number, number][],
  face: number[]
): [number, number, number] {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const n = face.length || 1;
  for (const idx of face) {
    const v = vertices[idx] || [0, 0, 0];
    cx += v[0];
    cy += v[1];
    cz += v[2];
  }
  return [cx / n, cy / n, cz / n];
}

export function computeVertexNormals(mesh: EditableMeshData): [number, number, number][] {
  const normals: [number, number, number][] = mesh.vertices.map(() => [0, 0, 0]);
  for (const face of mesh.faces) {
    const fn = computeFaceNormal(mesh.vertices, face);
    for (const idx of face) {
      if (normals[idx]) {
        normals[idx][0] += fn[0];
        normals[idx][1] += fn[1];
        normals[idx][2] += fn[2];
      }
    }
  }
  for (const n of normals) {
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= len;
    n[1] /= len;
    n[2] /= len;
  }
  return normals;
}

export function createPrimitiveMesh(type: PrimitiveType): EditableMeshData {
  switch (type) {
    case 'cube': {
      // Standard 2m Blender cube [-1..1] in Z-up
      const vertices: [number, number, number][] = [
        [-1, -1, -1],
        [1, -1, -1],
        [1, 1, -1],
        [-1, 1, -1],
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1]
      ];
      const faces: number[][] = [
        [0, 3, 2, 1], // bottom (-Z)
        [4, 5, 6, 7], // top (+Z)
        [0, 1, 5, 4], // front (-Y)
        [1, 2, 6, 5], // right (+X)
        [2, 3, 7, 6], // back (+Y)
        [3, 0, 4, 7]  // left (-X)
      ];
      return { vertices, faces, shadeSmooth: false };
    }

    case 'plane': {
      const vertices: [number, number, number][] = [
        [-1, -1, 0],
        [1, -1, 0],
        [1, 1, 0],
        [-1, 1, 0]
      ];
      return { vertices, faces: [[0, 1, 2, 3]], shadeSmooth: false };
    }

    case 'uv_sphere': {
      const segs = 20;
      const rings = 12;
      const r = 1;
      const vertices: [number, number, number][] = [];
      const faces: number[][] = [];
      vertices.push([0, 0, r]); // top pole 0
      for (let i = 1; i < rings; i++) {
        const phi = (Math.PI * i) / rings;
        const z = r * Math.cos(phi);
        const sinPhi = r * Math.sin(phi);
        for (let j = 0; j < segs; j++) {
          const theta = (2 * Math.PI * j) / segs;
          vertices.push([sinPhi * Math.cos(theta), sinPhi * Math.sin(theta), z]);
        }
      }
      vertices.push([0, 0, -r]); // bottom pole
      const bottomIdx = vertices.length - 1;

      // Top cap triangles
      for (let j = 0; j < segs; j++) {
        const next = (j + 1) % segs;
        faces.push([0, 1 + j, 1 + next]);
      }
      // Middle quad bands
      for (let i = 0; i < rings - 2; i++) {
        const rowA = 1 + i * segs;
        const rowB = 1 + (i + 1) * segs;
        for (let j = 0; j < segs; j++) {
          const next = (j + 1) % segs;
          faces.push([rowA + j, rowB + j, rowB + next, rowA + next]);
        }
      }
      // Bottom cap triangles
      const lastRow = 1 + (rings - 2) * segs;
      for (let j = 0; j < segs; j++) {
        const next = (j + 1) % segs;
        faces.push([bottomIdx, lastRow + next, lastRow + j]);
      }
      return { vertices, faces, shadeSmooth: true };
    }

    case 'ico_sphere': {
      const t = (1 + Math.sqrt(5)) / 2;
      const raw: [number, number, number][] = [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
      ];
      const vertices: [number, number, number][] = raw.map(([x, y, z]) => {
        const l = Math.hypot(x, y, z);
        return [x / l, y / l, z / l];
      });
      const faces: number[][] = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
      ];
      let ico: EditableMeshData = { vertices, faces, shadeSmooth: false };
      ico = subdivideTrianglesSphere(ico);
      return ico;
    }

    case 'cylinder': {
      const segs = 20;
      const r = 1;
      const h = 1;
      const vertices: [number, number, number][] = [];
      for (let j = 0; j < segs; j++) {
        const th = (2 * Math.PI * j) / segs;
        vertices.push([r * Math.cos(th), r * Math.sin(th), -h]);
      }
      for (let j = 0; j < segs; j++) {
        const th = (2 * Math.PI * j) / segs;
        vertices.push([r * Math.cos(th), r * Math.sin(th), h]);
      }
      const faces: number[][] = [];
      for (let j = 0; j < segs; j++) {
        const next = (j + 1) % segs;
        faces.push([j, next, segs + next, segs + j]);
      }
      const bottomCap: number[] = [];
      const topCap: number[] = [];
      for (let j = 0; j < segs; j++) {
        bottomCap.push(segs - 1 - j);
        topCap.push(segs + j);
      }
      faces.push(bottomCap, topCap);
      return { vertices, faces, shadeSmooth: false };
    }

    case 'cone': {
      const segs = 20;
      const r = 1;
      const vertices: [number, number, number][] = [[0, 0, 1]]; // apex 0
      for (let j = 0; j < segs; j++) {
        const th = (2 * Math.PI * j) / segs;
        vertices.push([r * Math.cos(th), r * Math.sin(th), -1]);
      }
      const faces: number[][] = [];
      const baseCap: number[] = [];
      for (let j = 0; j < segs; j++) {
        const next = (j + 1) % segs;
        faces.push([0, 1 + j, 1 + next]);
        baseCap.push(1 + (segs - 1 - j));
      }
      faces.push(baseCap);
      return { vertices, faces, shadeSmooth: false };
    }

    case 'torus': {
      const majorSegs = 24;
      const minorSegs = 12;
      const R = 1.0;
      const r = 0.35;
      const vertices: [number, number, number][] = [];
      const faces: number[][] = [];
      for (let i = 0; i < majorSegs; i++) {
        const u = (2 * Math.PI * i) / majorSegs;
        const cu = Math.cos(u);
        const su = Math.sin(u);
        for (let j = 0; j < minorSegs; j++) {
          const v = (2 * Math.PI * j) / minorSegs;
          const cv = Math.cos(v);
          const sv = Math.sin(v);
          vertices.push([(R + r * cv) * cu, (R + r * cv) * su, r * sv]);
        }
      }
      for (let i = 0; i < majorSegs; i++) {
        const ni = (i + 1) % majorSegs;
        for (let j = 0; j < minorSegs; j++) {
          const nj = (j + 1) % minorSegs;
          faces.push([
            i * minorSegs + j,
            ni * minorSegs + j,
            ni * minorSegs + nj,
            i * minorSegs + nj
          ]);
        }
      }
      return { vertices, faces, shadeSmooth: true };
    }

    case 'capsule': {
      const segs = 18;
      const capRings = 5;
      const r = 0.65;
      const halfCyl = 0.65;
      const vertices: [number, number, number][] = [];
      const faces: number[][] = [];
      vertices.push([0, 0, halfCyl + r]); // top pole
      for (let i = 1; i <= capRings; i++) {
        const phi = (Math.PI * 0.5 * i) / capRings;
        const z = halfCyl + r * Math.cos(phi);
        const rad = r * Math.sin(phi);
        for (let j = 0; j < segs; j++) {
          const th = (2 * Math.PI * j) / segs;
          vertices.push([rad * Math.cos(th), rad * Math.sin(th), z]);
        }
      }
      for (let i = 0; i < capRings; i++) {
        const phi = Math.PI * 0.5 + (Math.PI * 0.5 * i) / capRings;
        const z = -halfCyl + r * Math.cos(phi);
        const rad = r * Math.sin(phi);
        for (let j = 0; j < segs; j++) {
          const th = (2 * Math.PI * j) / segs;
          vertices.push([rad * Math.cos(th), rad * Math.sin(th), z]);
        }
      }
      vertices.push([0, 0, -(halfCyl + r)]);
      const bottomIdx = vertices.length - 1;
      const totalRings = capRings * 2;
      for (let j = 0; j < segs; j++) {
        faces.push([0, 1 + j, 1 + ((j + 1) % segs)]);
      }
      for (let i = 0; i < totalRings - 1; i++) {
        const rA = 1 + i * segs;
        const rB = 1 + (i + 1) * segs;
        for (let j = 0; j < segs; j++) {
          const nj = (j + 1) % segs;
          faces.push([rA + j, rB + j, rB + nj, rA + nj]);
        }
      }
      const lastR = 1 + (totalRings - 1) * segs;
      for (let j = 0; j < segs; j++) {
        const nj = (j + 1) % segs;
        faces.push([bottomIdx, lastR + nj, lastR + j]);
      }
      return { vertices, faces, shadeSmooth: true };
    }

    case 'monkey': {
      // Stylized Suzanne-like primate head built from subdivided cranium + snout + ears
      let head = catmullClarkSubdivide(createPrimitiveMesh('cube'), 2);
      for (const v of head.vertices) {
        v[0] *= 0.88;
        v[1] *= 0.82;
        v[2] *= 0.88;
        // Brow ridge & snout push (-Y is front in Blender!)
        if (v[1] < -0.35 && v[2] > 0.15 && v[2] < 0.55) {
          v[1] -= 0.25;
        }
        if (v[1] < -0.35 && v[2] < 0.05 && Math.abs(v[0]) < 0.52) {
          v[1] -= 0.42;
          v[2] -= 0.08;
        }
      }
      // Add left & right ear extrusions via merged mini-spheres
      const earBase = catmullClarkSubdivide(createPrimitiveMesh('cube'), 1);
      for (const side of [-1, 1]) {
        const offset = head.vertices.length;
        for (const ev of earBase.vertices) {
          head.vertices.push([side * (0.98 + ev[0] * 0.28), ev[1] * 0.16, 0.08 + ev[2] * 0.42]);
        }
        for (const ef of earBase.faces) {
          head.faces.push(ef.map((idx) => idx + offset));
        }
      }
      head.shadeSmooth = true;
      return head;
    }
  }
}

function subdivideTrianglesSphere(mesh: EditableMeshData): EditableMeshData {
  const verts = mesh.vertices.map((v) => [...v] as [number, number, number]);
  const midCache = new Map<string, number>();
  const getMid = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const existing = midCache.get(key);
    if (existing !== undefined) return existing;
    const va = verts[a];
    const vb = verts[b];
    const mx = (va[0] + vb[0]) * 0.5;
    const my = (va[1] + vb[1]) * 0.5;
    const mz = (va[2] + vb[2]) * 0.5;
    const l = Math.hypot(mx, my, mz) || 1;
    const idx = verts.length;
    verts.push([mx / l, my / l, mz / l]);
    midCache.set(key, idx);
    return idx;
  };
  const newFaces: number[][] = [];
  for (const f of mesh.faces) {
    if (f.length === 3) {
      const [i0, i1, i2] = f;
      const a = getMid(i0, i1);
      const b = getMid(i1, i2);
      const c = getMid(i2, i0);
      newFaces.push([i0, a, c], [i1, b, a], [i2, c, b], [a, b, c]);
    } else {
      newFaces.push([...f]);
    }
  }
  return { vertices: verts, faces: newFaces, shadeSmooth: mesh.shadeSmooth };
}

/** Real Catmull-Clark Subdivision Surface */
export function catmullClarkSubdivide(mesh: EditableMeshData, levels = 1): EditableMeshData {
  let current = cloneMeshData(mesh);
  const clamped = Math.max(0, Math.min(3, Math.round(levels)));

  for (let step = 0; step < clamped; step++) {
    if (current.faces.length > 6000) break; // guard mobile performance
    const V = current.vertices;
    const F = current.faces;

    // 1. Face points
    const facePoints: [number, number, number][] = F.map((f) => computeFaceCenter(V, f));

    // 2. Collect edges & incident faces
    interface EdgeInfo {
      v0: number;
      v1: number;
      faces: number[];
      edgePointIdx: number;
    }
    const edgeMap = new Map<string, EdgeInfo>();
    const vertFaces: number[][] = V.map(() => []);
    const vertEdges: EdgeInfo[][] = V.map(() => []);

    F.forEach((f, fIdx) => {
      for (let i = 0; i < f.length; i++) {
        const a = f[i];
        const b = f[(i + 1) % f.length];
        vertFaces[a].push(fIdx);
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        let e = edgeMap.get(key);
        if (!e) {
          e = { v0: Math.min(a, b), v1: Math.max(a, b), faces: [], edgePointIdx: -1 };
          edgeMap.set(key, e);
          vertEdges[a].push(e);
          vertEdges[b].push(e);
        }
        e.faces.push(fIdx);
      }
    });

    // 3. New vertices array: [updated original verts..., face points..., edge points...]
    const newVerts: [number, number, number][] = V.map((orig, vIdx) => {
      const adjF = vertFaces[vIdx];
      const adjE = vertEdges[vIdx];
      const n = adjE.length;
      if (n === 0 || adjF.length === 0) return [...orig];

      // Boundary vertex check
      const boundaryEdges = adjE.filter((e) => e.faces.length < 2);
      if (boundaryEdges.length > 0) {
        let bx = orig[0] * 2;
        let by = orig[1] * 2;
        let bz = orig[2] * 2;
        let weight = 2;
        for (const be of boundaryEdges) {
          const other = be.v0 === vIdx ? V[be.v1] : V[be.v0];
          bx += other[0];
          by += other[1];
          bz += other[2];
          weight += 1;
        }
        return [bx / weight, by / weight, bz / weight];
      }

      // F average
      let fx = 0, fy = 0, fz = 0;
      for (const fi of adjF) {
        fx += facePoints[fi][0];
        fy += facePoints[fi][1];
        fz += facePoints[fi][2];
      }
      fx /= adjF.length;
      fy /= adjF.length;
      fz /= adjF.length;

      // R average of edge midpoints
      let rx = 0, ry = 0, rz = 0;
      for (const e of adjE) {
        rx += (V[e.v0][0] + V[e.v1][0]) * 0.5;
        ry += (V[e.v0][1] + V[e.v1][1]) * 0.5;
        rz += (V[e.v0][2] + V[e.v1][2]) * 0.5;
      }
      rx /= n;
      ry /= n;
      rz /= n;

      const wF = 1 / n;
      const wR = 2 / n;
      const wP = (n - 3) / n;
      return [
        wF * fx + wR * rx + wP * orig[0],
        wF * fy + wR * ry + wP * orig[1],
        wF * fz + wR * rz + wP * orig[2]
      ];
    });

    const facePointOffset = newVerts.length;
    for (const fp of facePoints) {
      newVerts.push(fp);
    }

    for (const e of edgeMap.values()) {
      const va = V[e.v0];
      const vb = V[e.v1];
      let ex = va[0] + vb[0];
      let ey = va[1] + vb[1];
      let ez = va[2] + vb[2];
      let count = 2;
      if (e.faces.length === 2) {
        for (const fi of e.faces) {
          ex += facePoints[fi][0];
          ey += facePoints[fi][1];
          ez += facePoints[fi][2];
          count++;
        }
      }
      e.edgePointIdx = newVerts.length;
      newVerts.push([ex / count, ey / count, ez / count]);
    }

    // 4. Build quad faces
    const newFaces: number[][] = [];
    F.forEach((f, fIdx) => {
      const fpIdx = facePointOffset + fIdx;
      const len = f.length;
      for (let i = 0; i < len; i++) {
        const prev = f[(i - 1 + len) % len];
        const curr = f[i];
        const next = f[(i + 1) % len];
        const ePrev = edgeMap.get(prev < curr ? `${prev}_${curr}` : `${curr}_${prev}`)!;
        const eNext = edgeMap.get(curr < next ? `${curr}_${next}` : `${next}_${curr}`)!;
        newFaces.push([curr, eNext.edgePointIdx, fpIdx, ePrev.edgePointIdx]);
      }
    });

    current = {
      vertices: newVerts,
      faces: newFaces,
      shadeSmooth: current.shadeSmooth
    };
  }
  return current;
}

/** Flat quad subdivision (keeps sharp corners) */
export function subdivideFlat(mesh: EditableMeshData, selectedFaces?: number[]): EditableMeshData {
  const out = cloneMeshData(mesh);
  const targetSet =
    selectedFaces && selectedFaces.length > 0
      ? new Set(selectedFaces)
      : new Set(out.faces.map((_, i) => i));

  const edgeMidMap = new Map<string, number>();
  const getEdgeMid = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const hit = edgeMidMap.get(key);
    if (hit !== undefined) return hit;
    const va = out.vertices[a];
    const vb = out.vertices[b];
    const idx = out.vertices.length;
    out.vertices.push([(va[0] + vb[0]) * 0.5, (va[1] + vb[1]) * 0.5, (va[2] + vb[2]) * 0.5]);
    edgeMidMap.set(key, idx);
    return idx;
  };

  const nextFaces: number[][] = [];
  out.faces.forEach((f, fIdx) => {
    if (!targetSet.has(fIdx)) {
      nextFaces.push(f);
      return;
    }
    const center = computeFaceCenter(out.vertices, f);
    const cIdx = out.vertices.length;
    out.vertices.push(center);
    for (let i = 0; i < f.length; i++) {
      const prev = f[(i - 1 + f.length) % f.length];
      const curr = f[i];
      const next = f[(i + 1) % f.length];
      const mNext = getEdgeMid(curr, next);
      const mPrev = getEdgeMid(prev, curr);
      nextFaces.push([curr, mNext, cIdx, mPrev]);
    }
  });
  out.faces = nextFaces;
  return out;
}

/** Extrude selected faces along their normals */
export function extrudeFaces(
  mesh: EditableMeshData,
  faceIndices: number[],
  distance = 0.45
): { mesh: EditableMeshData; newFaceIndices: number[] } {
  const out = cloneMeshData(mesh);
  const targets =
    faceIndices.length > 0 ? faceIndices.filter((i) => i >= 0 && i < out.faces.length) : [1];
  if (targets.length === 0 && out.faces.length > 0) targets.push(0);

  const targetSet = new Set(targets);
  const newTopFaces: number[] = [];
  const nextFaces: number[][] = [];

  out.faces.forEach((f, idx) => {
    if (!targetSet.has(idx)) {
      nextFaces.push(f);
      return;
    }
    const n = computeFaceNormal(out.vertices, f);
    const extrudedLoop: number[] = f.map((vIdx) => {
      const v = out.vertices[vIdx];
      const nIdx = out.vertices.length;
      out.vertices.push([
        v[0] + n[0] * distance,
        v[1] + n[1] * distance,
        v[2] + n[2] * distance
      ]);
      return nIdx;
    });

    // Side wall quads
    for (let i = 0; i < f.length; i++) {
      const ni = (i + 1) % f.length;
      nextFaces.push([f[i], f[ni], extrudedLoop[ni], extrudedLoop[i]]);
    }
    newTopFaces.push(nextFaces.length);
    nextFaces.push(extrudedLoop);
  });

  out.faces = nextFaces;
  return { mesh: out, newFaceIndices: newTopFaces };
}

/** Inset selected faces */
export function insetFaces(
  mesh: EditableMeshData,
  faceIndices: number[],
  insetRatio = 0.28,
  depth = 0
): { mesh: EditableMeshData; newFaceIndices: number[] } {
  const out = cloneMeshData(mesh);
  const targets =
    faceIndices.length > 0 ? faceIndices.filter((i) => i >= 0 && i < out.faces.length) : [1];
  if (targets.length === 0 && out.faces.length > 0) targets.push(0);

  const targetSet = new Set(targets);
  const newInnerFaces: number[] = [];
  const nextFaces: number[][] = [];
  const t = Math.max(0.05, Math.min(0.85, insetRatio));

  out.faces.forEach((f, idx) => {
    if (!targetSet.has(idx)) {
      nextFaces.push(f);
      return;
    }
    const c = computeFaceCenter(out.vertices, f);
    const n = computeFaceNormal(out.vertices, f);
    const innerLoop = f.map((vIdx) => {
      const v = out.vertices[vIdx];
      const nIdx = out.vertices.length;
      out.vertices.push([
        v[0] + (c[0] - v[0]) * t + n[0] * depth,
        v[1] + (c[1] - v[1]) * t + n[1] * depth,
        v[2] + (c[2] - v[2]) * t + n[2] * depth
      ]);
      return nIdx;
    });
    for (let i = 0; i < f.length; i++) {
      const ni = (i + 1) % f.length;
      nextFaces.push([f[i], f[ni], innerLoop[ni], innerLoop[i]]);
    }
    newInnerFaces.push(nextFaces.length);
    nextFaces.push(innerLoop);
  });

  out.faces = nextFaces;
  return { mesh: out, newFaceIndices: newInnerFaces };
}

/** Bevel faces (inset + slight outward lift) */
export function bevelFaces(
  mesh: EditableMeshData,
  faceIndices: number[],
  amount = 0.18
): { mesh: EditableMeshData; newFaceIndices: number[] } {
  const target =
    faceIndices.length > 0
      ? faceIndices
      : mesh.faces.map((_, idx) => idx);
  return insetFaces(mesh, target, Math.min(0.45, amount), amount * 0.45);
}

/** Loop cut across midplane of X, Y, or Z */
export function loopCutAxis(mesh: EditableMeshData, axis: 0 | 1 | 2 = 2): EditableMeshData {
  const out = cloneMeshData(mesh);
  // Find bounding midpoint on chosen axis
  let minV = Infinity;
  let maxV = -Infinity;
  for (const v of out.vertices) {
    if (v[axis] < minV) minV = v[axis];
    if (v[axis] > maxV) maxV = v[axis];
  }
  const planeVal = (minV + maxV) * 0.5;
  const eps = 1e-4;
  const edgeCutCache = new Map<string, number>();

  const getCutVert = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const hit = edgeCutCache.get(key);
    if (hit !== undefined) return hit;
    const va = out.vertices[a];
    const vb = out.vertices[b];
    const denom = vb[axis] - va[axis];
    const t = Math.abs(denom) < 1e-6 ? 0.5 : (planeVal - va[axis]) / denom;
    const idx = out.vertices.length;
    out.vertices.push([
      va[0] + (vb[0] - va[0]) * t,
      va[1] + (vb[1] - va[1]) * t,
      va[2] + (vb[2] - va[2]) * t
    ]);
    edgeCutCache.set(key, idx);
    return idx;
  };

  const nextFaces: number[][] = [];
  for (const f of out.faces) {
    const polyNeg: number[] = [];
    const polyPos: number[] = [];
    for (let i = 0; i < f.length; i++) {
      const curr = f[i];
      const next = f[(i + 1) % f.length];
      const dc = out.vertices[curr][axis] - planeVal;
      const dn = out.vertices[next][axis] - planeVal;

      if (dc <= eps) polyNeg.push(curr);
      if (dc >= -eps) polyPos.push(curr);

      if ((dc < -eps && dn > eps) || (dc > eps && dn < -eps)) {
        const cutIdx = getCutVert(curr, next);
        polyNeg.push(cutIdx);
        polyPos.push(cutIdx);
      }
    }
    if (polyNeg.length >= 3 && polyPos.length >= 3) {
      nextFaces.push(polyNeg, polyPos);
    } else {
      nextFaces.push(f);
    }
  }
  out.faces = nextFaces;
  return out;
}

export function deleteFaces(mesh: EditableMeshData, faceIndices: number[]): EditableMeshData {
  const out = cloneMeshData(mesh);
  if (faceIndices.length === 0) return out;
  const drop = new Set(faceIndices);
  out.faces = out.faces.filter((_, i) => !drop.has(i));
  return out;
}

/** Non-destructive Modifier Pipeline */
export function evaluateMeshWithModifiers(
  baseMesh: EditableMeshData,
  modifiers: ModifierItem[]
): EditableMeshData {
  let mesh = cloneMeshData(baseMesh);

  for (const mod of modifiers) {
    if (!mod.enabled) continue;

    switch (mod.type) {
      case 'SUBSURF': {
        mesh = catmullClarkSubdivide(mesh, mod.levels ?? 1);
        break;
      }

      case 'MIRROR': {
        const axes: (0 | 1 | 2)[] = [];
        if (mod.axisX !== false) axes.push(0);
        if (mod.axisY) axes.push(1);
        if (mod.axisZ) axes.push(2);
        for (const ax of axes) {
          const vCount = mesh.vertices.length;
          for (let i = 0; i < vCount; i++) {
            const v = mesh.vertices[i];
            const copy: [number, number, number] = [v[0], v[1], v[2]];
            copy[ax] = -copy[ax];
            mesh.vertices.push(copy);
          }
          const fCount = mesh.faces.length;
          for (let i = 0; i < fCount; i++) {
            // Reverse winding for mirrored parity
            const rev = [...mesh.faces[i]].reverse().map((idx) => idx + vCount);
            mesh.faces.push(rev);
          }
        }
        break;
      }

      case 'ARRAY': {
        const count = Math.max(1, Math.min(16, Math.round(mod.count ?? 3)));
        const [ox, oy, oz] = mod.offset ?? [2.2, 0, 0];
        const origVerts = mesh.vertices.map((v) => [...v] as [number, number, number]);
        const origFaces = mesh.faces.map((f) => [...f]);
        for (let k = 1; k < count; k++) {
          const vOffset = mesh.vertices.length;
          for (const v of origVerts) {
            mesh.vertices.push([v[0] + ox * k, v[1] + oy * k, v[2] + oz * k]);
          }
          for (const f of origFaces) {
            mesh.faces.push(f.map((idx) => idx + vOffset));
          }
        }
        break;
      }

      case 'SOLIDIFY': {
        const thickness = mod.thickness ?? 0.15;
        const vNormals = computeVertexNormals(mesh);
        const origCount = mesh.vertices.length;
        for (let i = 0; i < origCount; i++) {
          const v = mesh.vertices[i];
          const n = vNormals[i];
          mesh.vertices.push([
            v[0] - n[0] * thickness,
            v[1] - n[1] * thickness,
            v[2] - n[2] * thickness
          ]);
        }
        const origFaces = mesh.faces.map((f) => [...f]);
        // Find boundary edges so open shells get clean rim walls
        const edgeCount = new Map<string, [number, number]>();
        for (const f of origFaces) {
          for (let i = 0; i < f.length; i++) {
            const a = f[i];
            const b = f[(i + 1) % f.length];
            const key = a < b ? `${a}_${b}` : `${b}_${a}`;
            if (edgeCount.has(key)) {
              edgeCount.delete(key); // shared interior edge
            } else {
              edgeCount.set(key, [a, b]);
            }
          }
        }
        for (const f of origFaces) {
          mesh.faces.push([...f].reverse().map((idx) => idx + origCount));
        }
        for (const [a, b] of edgeCount.values()) {
          mesh.faces.push([a, a + origCount, b + origCount, b]);
        }
        break;
      }

      case 'BEVEL': {
        const amt = mod.amount ?? 0.16;
        mesh = bevelFaces(mesh, [], amt).mesh;
        break;
      }

      case 'WIREFRAME': {
        const thick = Math.max(0.02, mod.thickness ?? 0.06);
        mesh = buildWireframeStrutMesh(mesh, thick);
        break;
      }

      case 'TWIST': {
        const rad = ((mod.angleDeg ?? 45) * Math.PI) / 180;
        for (const v of mesh.vertices) {
          const theta = rad * v[2] * 0.5;
          const c = Math.cos(theta);
          const s = Math.sin(theta);
          const nx = v[0] * c - v[1] * s;
          const ny = v[0] * s + v[1] * c;
          v[0] = nx;
          v[1] = ny;
        }
        break;
      }
    }
  }
  return mesh;
}

function buildWireframeStrutMesh(mesh: EditableMeshData, radius: number): EditableMeshData {
  const edges = new Map<string, [number, number]>();
  for (const f of mesh.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      const b = f[(i + 1) % f.length];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!edges.has(key)) edges.set(key, [a, b]);
    }
  }
  const verts: [number, number, number][] = [];
  const faces: number[][] = [];
  for (const [a, b] of edges.values()) {
    const va = mesh.vertices[a];
    const vb = mesh.vertices[b];
    if (!va || !vb) continue;
    const dx = vb[0] - va[0];
    const dy = vb[1] - va[1];
    const dz = vb[2] - va[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) continue;
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    const up = Math.abs(dir.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(radius);
    const w = new THREE.Vector3().crossVectors(dir, u).normalize().multiplyScalar(radius);
    const base = verts.length;
    const offsets = [
      [u.x + w.x, u.y + w.y, u.z + w.z],
      [-u.x + w.x, -u.y + w.y, -u.z + w.z],
      [-u.x - w.x, -u.y - w.y, -u.z - w.z],
      [u.x - w.x, u.y - w.y, u.z - w.z]
    ];
    for (const o of offsets) verts.push([va[0] + o[0], va[1] + o[1], va[2] + o[2]]);
    for (const o of offsets) verts.push([vb[0] + o[0], vb[1] + o[1], vb[2] + o[2]]);
    faces.push(
      [base + 0, base + 1, base + 5, base + 4],
      [base + 1, base + 2, base + 6, base + 5],
      [base + 2, base + 3, base + 7, base + 6],
      [base + 3, base + 0, base + 4, base + 7]
    );
  }
  return { vertices: verts, faces, shadeSmooth: false };
}

export interface BuiltThreeGeometries {
  surfaceGeometry: THREE.BufferGeometry;
  polygonWireGeometry: THREE.BufferGeometry;
  triangleToFaceIndex: number[];
}

/** Converts polygonal EditableMeshData into Three.js BufferGeometries + face pick map */
export function buildThreeGeometries(mesh: EditableMeshData): BuiltThreeGeometries {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const triangleToFaceIndex: number[] = [];

  const smoothNormals = mesh.shadeSmooth ? computeVertexNormals(mesh) : null;
  const hasVertexColors = Boolean(mesh.vertexColors && mesh.vertexColors.length === mesh.vertices.length);

  mesh.faces.forEach((face, fIdx) => {
    if (face.length < 3) return;
    const fn = computeFaceNormal(mesh.vertices, face);
    // Fan triangulation from face[0]
    for (let i = 1; i < face.length - 1; i++) {
      const tri = [face[0], face[i], face[i + 1]];
      const triUVs: [number, number][] = [
        [0, 0],
        [1, i === 1 ? 0 : 1],
        [i === 1 ? 1 : 0, 1]
      ];
      tri.forEach((vIdx, k) => {
        const v = mesh.vertices[vIdx] || [0, 0, 0];
        positions.push(v[0], v[1], v[2]);
        const n = smoothNormals ? smoothNormals[vIdx] : fn;
        normals.push(n[0], n[1], n[2]);
        const vc = hasVertexColors ? mesh.vertexColors![vIdx] : [1, 1, 1];
        colors.push(vc[0], vc[1], vc[2]);
        uvs.push(triUVs[k][0], triUVs[k][1]);
      });
      triangleToFaceIndex.push(fIdx);
    }
  });

  const surfaceGeometry = new THREE.BufferGeometry();
  surfaceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  surfaceGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  surfaceGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  surfaceGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  surfaceGeometry.computeBoundingSphere();
  surfaceGeometry.computeBoundingBox();

  // Polygon wireframe geometry (only true polygon edges — no internal triangulation diagonals!)
  const wirePositions: number[] = [];
  const seenEdges = new Set<string>();
  for (const face of mesh.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      const va = mesh.vertices[a];
      const vb = mesh.vertices[b];
      if (!va || !vb) continue;
      wirePositions.push(va[0], va[1], va[2], vb[0], vb[1], vb[2]);
    }
  }
  const polygonWireGeometry = new THREE.BufferGeometry();
  polygonWireGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wirePositions, 3));

  return { surfaceGeometry, polygonWireGeometry, triangleToFaceIndex };
}
