import * as THREE from 'three';
import type {
  EditableMeshData,
  ModifierItem,
  PrimitiveType,
  UVProjectionMode
} from '../types/scene';

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

/** Extrudes an arbitrary 2D contour (supporting concave polygons) along Z [-height/2 .. +height/2] */
export function createExtrudedPolygonMesh(
  points2D: [number, number][],
  height = 0.6,
  shadeSmooth = false
): EditableMeshData {
  if (points2D.length < 3) return createPrimitiveMesh('cube');
  const contour = points2D.map(([x, y]) => new THREE.Vector2(x, y));
  // Ensure counter-clockwise winding for ShapeUtils
  if (THREE.ShapeUtils.isClockWise(contour)) {
    contour.reverse();
  }
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const n = contour.length;
  const hz = height * 0.5;
  const vertices: [number, number, number][] = [];
  for (const p of contour) vertices.push([p.x, p.y, -hz]); // bottom 0..n-1
  for (const p of contour) vertices.push([p.x, p.y, hz]);  // top n..2n-1

  const faces: number[][] = [];
  // Bottom cap (reversed winding so normal points -Z)
  for (const [a, b, c] of tris) {
    faces.push([c, b, a]);
  }
  // Top cap (+Z)
  for (const [a, b, c] of tris) {
    faces.push([n + a, n + b, n + c]);
  }
  // Side quad walls
  for (let i = 0; i < n; i++) {
    const ni = (i + 1) % n;
    faces.push([i, ni, n + ni, n + i]);
  }
  return { vertices, faces, shadeSmooth };
}

/** Revolves a [radius, z] 2D profile around the Z axis */
export function createLatheMesh(
  profileRZ: [number, number][],
  segments = 20,
  shadeSmooth = true
): EditableMeshData {
  if (profileRZ.length < 2) return createPrimitiveMesh('cylinder');
  const segs = Math.max(4, Math.min(64, Math.round(segments)));
  const vertices: [number, number, number][] = [];
  const faces: number[][] = [];

  for (let i = 0; i < profileRZ.length; i++) {
    const [r, z] = profileRZ[i];
    const rad = Math.max(0.001, r);
    for (let j = 0; j < segs; j++) {
      const th = (2 * Math.PI * j) / segs;
      vertices.push([rad * Math.cos(th), rad * Math.sin(th), z]);
    }
  }

  for (let i = 0; i < profileRZ.length - 1; i++) {
    const rowA = i * segs;
    const rowB = (i + 1) * segs;
    for (let j = 0; j < segs; j++) {
      const nj = (j + 1) % segs;
      faces.push([rowA + j, rowA + nj, rowB + nj, rowB + j]);
    }
  }

  // Cap bottom and top if open
  if (profileRZ[0][0] > 0.02) {
    const bottomCap: number[] = [];
    for (let j = segs - 1; j >= 0; j--) bottomCap.push(j);
    faces.push(bottomCap);
  }
  const lastRow = (profileRZ.length - 1) * segs;
  if (profileRZ[profileRZ.length - 1][0] > 0.02) {
    const topCap: number[] = [];
    for (let j = 0; j < segs; j++) topCap.push(lastRow + j);
    faces.push(topCap);
  }

  return { vertices, faces, shadeSmooth };
}

export interface LoftSectionSpec {
  center: [number, number, number];
  rx: number;
  ry: number;
  /** 1.0 = ellipse/circle, 0.2..0.5 = sleek rounded-rect/squircle, 1.8+ = diamond/pinched */
  roundness?: number;
  rotDeg?: number;
}

function computeRotationMinimizingFrames(
  centers: THREE.Vector3[],
  closed = false
): { N: THREE.Vector3[]; B: THREE.Vector3[]; T: THREE.Vector3[] } {
  const count = centers.length;
  const T: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    let dir: THREE.Vector3;
    if (closed) {
      dir = centers[(i + 1) % count].clone().sub(centers[(i - 1 + count) % count]);
    } else if (i === 0) {
      dir = centers[Math.min(1, count - 1)].clone().sub(centers[0]);
    } else if (i === count - 1) {
      dir = centers[count - 1].clone().sub(centers[count - 2]);
    } else {
      dir = centers[i + 1].clone().sub(centers[i - 1]);
    }
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
    T.push(dir.normalize());
  }

  // Build right-handed orthonormal basis (N, B, T) where N x B = +T
  const N: THREE.Vector3[] = [];
  const B: THREE.Vector3[] = [];
  const t0 = T[0];
  const ref = Math.abs(t0.x) < 0.85 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  // Let B0 = T0 x ref, N0 = B0 x T0 -> then N0 x B0 = (B0 x T0) x B0 = +T0!
  const b0 = new THREE.Vector3().crossVectors(t0, ref).normalize();
  const n0 = new THREE.Vector3().crossVectors(b0, t0).normalize();
  N.push(n0);
  B.push(b0);

  for (let i = 1; i < count; i++) {
    const prevT = T[i - 1];
    const currT = T[i];
    const ni = N[i - 1].clone();
    const axis = new THREE.Vector3().crossVectors(prevT, currT);
    const sinA = axis.length();
    if (sinA > 1e-6) {
      axis.normalize();
      const cosA = Math.max(-1, Math.min(1, prevT.dot(currT)));
      ni.applyAxisAngle(axis, Math.atan2(sinA, cosA));
    }
    // Re-orthonormalize so N x B = +currT
    ni.sub(currT.clone().multiplyScalar(ni.dot(currT))).normalize();
    const bi = new THREE.Vector3().crossVectors(currT, ni).normalize();
    N.push(ni);
    B.push(bi);
  }

  return { N, B, T };
}

/**
 * Smooth 3D Spline Sweep / Generalized Cylinder with variable radius profile along a 3D curve.
 * Ideal for horns, tails, limbs, handles, cables, curved blades, handlebars, pipes, arches, hair locks.
 */
export function createTubeSweepMesh(
  path3D: [number, number, number][],
  radii: number | number[] = 0.2,
  options?: {
    radialSegments?: number;
    tubularSamples?: number;
    closed?: boolean;
    capEnds?: boolean;
    aspectY?: number;
    shadeSmooth?: boolean;
  }
): EditableMeshData {
  if (!Array.isArray(path3D) || path3D.length < 2) {
    return createPrimitiveMesh('cylinder');
  }
  const closed = Boolean(options?.closed && path3D.length >= 3);
  const radialSegs = Math.max(6, Math.min(36, Math.round(options?.radialSegments ?? 14)));
  const defaultSamples = Math.max(path3D.length * 4, 16);
  const samples = Math.max(4, Math.min(72, Math.round(options?.tubularSamples ?? defaultSamples)));
  const capEnds = options?.capEnds !== false && !closed;
  const aspectY = Math.max(0.15, Math.min(6, Number(options?.aspectY) || 1));
  const shadeSmooth = options?.shadeSmooth !== false;

  const ctrlPts = path3D.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(ctrlPts, closed, 'centripetal', 0.5);

  const centers: THREE.Vector3[] = [];
  const ringCount = closed ? samples : samples + 1;
  for (let i = 0; i < ringCount; i++) {
    const u = closed ? i / samples : i / samples;
    centers.push(curve.getPoint(u));
  }

  const radList = Array.isArray(radii) && radii.length > 0 ? radii : [Number(radii) || 0.2];
  const sampleRadiusAt = (u: number): number => {
    if (radList.length === 1) return Math.max(0.002, Number(radList[0]) || 0.15);
    const pos = Math.max(0, Math.min(1, u)) * (radList.length - 1);
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = Number(radList[idx]) || 0.1;
    const b = Number(radList[Math.min(radList.length - 1, idx + 1)]) ?? a;
    return Math.max(0.002, a + (b - a) * frac);
  };

  const { N, B } = computeRotationMinimizingFrames(centers, closed);
  const vertices: [number, number, number][] = [];
  const faces: number[][] = [];

  for (let i = 0; i < ringCount; i++) {
    const u = closed ? i / samples : i / samples;
    const r = sampleRadiusAt(u);
    const rx = r;
    const ry = r * aspectY;
    const c = centers[i];
    const ni = N[i];
    const bi = B[i];
    for (let j = 0; j < radialSegs; j++) {
      const th = (2 * Math.PI * j) / radialSegs;
      const ca = Math.cos(th) * rx;
      const sa = Math.sin(th) * ry;
      vertices.push([
        c.x + ca * ni.x + sa * bi.x,
        c.y + ca * ni.y + sa * bi.y,
        c.z + ca * ni.z + sa * bi.z
      ]);
    }
  }

  const segLoops = closed ? ringCount : ringCount - 1;
  for (let i = 0; i < segLoops; i++) {
    const rA = i * radialSegs;
    const rB = ((i + 1) % ringCount) * radialSegs;
    for (let j = 0; j < radialSegs; j++) {
      const nj = (j + 1) % radialSegs;
      faces.push([rA + j, rA + nj, rB + nj, rB + j]);
    }
  }

  if (capEnds) {
    const r0 = sampleRadiusAt(0);
    if (r0 > 0.004) {
      const c0 = centers[0];
      const n0 = N[0];
      const b0 = B[0];
      // Outward tangent at start points -T[0] = -(N0 x B0)
      const outStart = new THREE.Vector3().crossVectors(b0, n0).normalize();
      const domeRings = 3;
      const domeDepth = r0 * 0.42;
      let prevRow = 0;
      for (let d = 1; d < domeRings; d++) {
        const ang = (Math.PI * 0.5 * d) / domeRings;
        const scaleR = Math.cos(ang);
        const push = Math.sin(ang) * domeDepth;
        const newRow = vertices.length;
        for (let j = 0; j < radialSegs; j++) {
          const th = (2 * Math.PI * j) / radialSegs;
          const ca = Math.cos(th) * r0 * scaleR;
          const sa = Math.sin(th) * r0 * aspectY * scaleR;
          vertices.push([
            c0.x + outStart.x * push + ca * n0.x + sa * b0.x,
            c0.y + outStart.y * push + ca * n0.y + sa * b0.y,
            c0.z + outStart.z * push + ca * n0.z + sa * b0.z
          ]);
        }
        for (let j = 0; j < radialSegs; j++) {
          const nj = (j + 1) % radialSegs;
          faces.push([prevRow + nj, prevRow + j, newRow + j, newRow + nj]);
        }
        prevRow = newRow;
      }
      const startTipIdx = vertices.length;
      vertices.push([
        c0.x + outStart.x * domeDepth,
        c0.y + outStart.y * domeDepth,
        c0.z + outStart.z * domeDepth
      ]);
      for (let j = 0; j < radialSegs; j++) {
        const nj = (j + 1) % radialSegs;
        faces.push([startTipIdx, prevRow + nj, prevRow + j]);
      }
    }

    const rEnd = sampleRadiusAt(1);
    if (rEnd > 0.004) {
      const lastIdx = ringCount - 1;
      const cL = centers[lastIdx];
      const nL = N[lastIdx];
      const bL = B[lastIdx];
      const outEnd = new THREE.Vector3().crossVectors(nL, bL).normalize();
      const domeRings = 3;
      const domeDepth = rEnd * 0.42;
      let prevRow = lastIdx * radialSegs;
      for (let d = 1; d < domeRings; d++) {
        const ang = (Math.PI * 0.5 * d) / domeRings;
        const scaleR = Math.cos(ang);
        const push = Math.sin(ang) * domeDepth;
        const newRow = vertices.length;
        for (let j = 0; j < radialSegs; j++) {
          const th = (2 * Math.PI * j) / radialSegs;
          const ca = Math.cos(th) * rEnd * scaleR;
          const sa = Math.sin(th) * rEnd * aspectY * scaleR;
          vertices.push([
            cL.x + outEnd.x * push + ca * nL.x + sa * bL.x,
            cL.y + outEnd.y * push + ca * nL.y + sa * bL.y,
            cL.z + outEnd.z * push + ca * nL.z + sa * bL.z
          ]);
        }
        for (let j = 0; j < radialSegs; j++) {
          const nj = (j + 1) % radialSegs;
          faces.push([prevRow + j, prevRow + nj, newRow + nj, newRow + j]);
        }
        prevRow = newRow;
      }
      const endTipIdx = vertices.length;
      vertices.push([
        cL.x + outEnd.x * domeDepth,
        cL.y + outEnd.y * domeDepth,
        cL.z + outEnd.z * domeDepth
      ]);
      for (let j = 0; j < radialSegs; j++) {
        const nj = (j + 1) % radialSegs;
        faces.push([endTipIdx, prevRow + j, prevRow + nj]);
      }
    }
  }

  return { vertices, faces, shadeSmooth };
}

/**
 * Multi-Cross-Section 3D Lofting Hull (CAD / Sub-D style) with smooth spline ring interpolation
 * and rounded dome end-caps so hulls look continuously sculpted rather than faceted frustums.
 */
export function createLoftedSectionsMesh(
  sections: LoftSectionSpec[],
  options?: {
    radialSegments?: number;
    subdivideLevels?: number;
    roundedCaps?: boolean;
    shadeSmooth?: boolean;
  }
): EditableMeshData {
  if (!Array.isArray(sections) || sections.length < 2) {
    return createPrimitiveMesh('cube');
  }
  const radialSegs = Math.max(8, Math.min(44, Math.round(options?.radialSegments ?? 20)));

  // Smoothly resample sections with Catmull-Rom spline interpolation when >= 3 sections
  const denseSections: LoftSectionSpec[] = [];
  if (sections.length >= 3) {
    const posCurve = new THREE.CatmullRomCurve3(
      sections.map((s) => new THREE.Vector3(s.center[0], s.center[1], s.center[2])),
      false,
      'centripetal',
      0.5
    );
    const paramCurve = new THREE.CatmullRomCurve3(
      sections.map(
        (s) =>
          new THREE.Vector3(
            Math.max(0.003, Number(s.rx) || 0.25),
            Math.max(0.003, Number(s.ry) || 0.25),
            Math.max(0.22, Math.min(2.6, Number(s.roundness) || 1.0))
          )
      ),
      false,
      'centripetal',
      0.5
    );
    const totalRings = Math.min(48, (sections.length - 1) * 4 + 1);
    for (let i = 0; i < totalRings; i++) {
      const u = i / (totalRings - 1);
      const p = posCurve.getPoint(u);
      const prm = paramCurve.getPoint(u);
      const fIdx = u * (sections.length - 1);
      const i0 = Math.floor(fIdx);
      const i1 = Math.min(sections.length - 1, i0 + 1);
      const frac = fIdx - i0;
      const rot0 = Number(sections[i0].rotDeg) || 0;
      const rot1 = Number(sections[i1].rotDeg) || 0;
      denseSections.push({
        center: [p.x, p.y, p.z],
        rx: Math.max(0.003, prm.x),
        ry: Math.max(0.003, prm.y),
        roundness: Math.max(0.22, Math.min(2.6, prm.z)),
        rotDeg: rot0 + (rot1 - rot0) * frac
      });
    }
  } else {
    // 2 sections: add smooth intermediate rings for clean quad density
    const steps = 4;
    const s0 = sections[0];
    const s1 = sections[1];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const su = u * u * (3 - 2 * u);
      denseSections.push({
        center: [
          s0.center[0] + (s1.center[0] - s0.center[0]) * u,
          s0.center[1] + (s1.center[1] - s0.center[1]) * u,
          s0.center[2] + (s1.center[2] - s0.center[2]) * u
        ],
        rx: Math.max(0.003, (Number(s0.rx) || 0.25) + ((Number(s1.rx) || 0.25) - (Number(s0.rx) || 0.25)) * su),
        ry: Math.max(0.003, (Number(s0.ry) || 0.25) + ((Number(s1.ry) || 0.25) - (Number(s0.ry) || 0.25)) * su),
        roundness:
          (Number(s0.roundness) || 1) + ((Number(s1.roundness) || 1) - (Number(s0.roundness) || 1)) * su,
        rotDeg: (Number(s0.rotDeg) || 0) + ((Number(s1.rotDeg) || 0) - (Number(s0.rotDeg) || 0)) * u
      });
    }
  }

  // Add smooth rounded cosine dome end-caps if ends are open
  if (options?.roundedCaps !== false) {
    const first = denseSections[0];
    const next = denseSections[1];
    const dirStart = new THREE.Vector3(
      first.center[0] - next.center[0],
      first.center[1] - next.center[1],
      first.center[2] - next.center[2]
    );
    if (dirStart.lengthSq() > 1e-8 && Math.min(first.rx, first.ry) > 0.025) {
      dirStart.normalize();
      const capDepth = Math.min(first.rx, first.ry) * 0.34;
      const pre1: LoftSectionSpec = {
        ...first,
        center: [
          first.center[0] + dirStart.x * capDepth * 0.55,
          first.center[1] + dirStart.y * capDepth * 0.55,
          first.center[2] + dirStart.z * capDepth * 0.55
        ],
        rx: first.rx * 0.76,
        ry: first.ry * 0.76
      };
      const pre2: LoftSectionSpec = {
        ...first,
        center: [
          first.center[0] + dirStart.x * capDepth * 0.92,
          first.center[1] + dirStart.y * capDepth * 0.92,
          first.center[2] + dirStart.z * capDepth * 0.92
        ],
        rx: first.rx * 0.36,
        ry: first.ry * 0.36
      };
      denseSections.unshift(pre2, pre1);
    }

    const last = denseSections[denseSections.length - 1];
    const prev = denseSections[denseSections.length - 2];
    const dirEnd = new THREE.Vector3(
      last.center[0] - prev.center[0],
      last.center[1] - prev.center[1],
      last.center[2] - prev.center[2]
    );
    if (dirEnd.lengthSq() > 1e-8 && Math.min(last.rx, last.ry) > 0.025) {
      dirEnd.normalize();
      const capDepth = Math.min(last.rx, last.ry) * 0.34;
      const post1: LoftSectionSpec = {
        ...last,
        center: [
          last.center[0] + dirEnd.x * capDepth * 0.55,
          last.center[1] + dirEnd.y * capDepth * 0.55,
          last.center[2] + dirEnd.z * capDepth * 0.55
        ],
        rx: last.rx * 0.76,
        ry: last.ry * 0.76
      };
      const post2: LoftSectionSpec = {
        ...last,
        center: [
          last.center[0] + dirEnd.x * capDepth * 0.92,
          last.center[1] + dirEnd.y * capDepth * 0.92,
          last.center[2] + dirEnd.z * capDepth * 0.92
        ],
        rx: last.rx * 0.36,
        ry: last.ry * 0.36
      };
      denseSections.push(post1, post2);
    }
  }

  const centers = denseSections.map((s) => new THREE.Vector3(s.center[0], s.center[1], s.center[2]));
  const { N, B, T } = computeRotationMinimizingFrames(centers, false);

  const vertices: [number, number, number][] = [];
  const faces: number[][] = [];

  for (let i = 0; i < denseSections.length; i++) {
    const sec = denseSections[i];
    const rx = Math.max(0.003, Number(sec.rx) || 0.5);
    const ry = Math.max(0.003, Number(sec.ry) || 0.5);
    const exp = Math.max(0.22, Math.min(2.6, Number(sec.roundness) || 1.0));
    const rotRad = ((Number(sec.rotDeg) || 0) * Math.PI) / 180;
    const cRot = Math.cos(rotRad);
    const sRot = Math.sin(rotRad);

    const c = centers[i];
    const ni = N[i];
    const bi = B[i];

    for (let j = 0; j < radialSegs; j++) {
      const th = (2 * Math.PI * j) / radialSegs;
      const ct = Math.cos(th);
      const st = Math.sin(th);
      const lx = Math.sign(ct) * Math.pow(Math.abs(ct), exp) * rx;
      const ly = Math.sign(st) * Math.pow(Math.abs(st), exp) * ry;
      const ux = lx * cRot - ly * sRot;
      const uy = lx * sRot + ly * cRot;

      vertices.push([
        c.x + ux * ni.x + uy * bi.x,
        c.y + ux * ni.y + uy * bi.y,
        c.z + ux * ni.z + uy * bi.z
      ]);
    }
  }

  for (let i = 0; i < denseSections.length - 1; i++) {
    const rA = i * radialSegs;
    const rB = (i + 1) * radialSegs;
    for (let j = 0; j < radialSegs; j++) {
      const nj = (j + 1) % radialSegs;
      faces.push([rA + j, rA + nj, rB + nj, rB + j]);
    }
  }

  // Outward start tip (-T[0]) and end tip (+T[last])
  const firstSec = denseSections[0];
  const tipStartPush = Math.min(firstSec.rx, firstSec.ry) * 0.14 + 0.001;
  const startCenterIdx = vertices.length;
  vertices.push([
    centers[0].x - T[0].x * tipStartPush,
    centers[0].y - T[0].y * tipStartPush,
    centers[0].z - T[0].z * tipStartPush
  ]);
  for (let j = 0; j < radialSegs; j++) {
    const nj = (j + 1) % radialSegs;
    faces.push([startCenterIdx, nj, j]);
  }

  const lastIdx = denseSections.length - 1;
  const lastSec = denseSections[lastIdx];
  const tipEndPush = Math.min(lastSec.rx, lastSec.ry) * 0.14 + 0.001;
  const lastRow = lastIdx * radialSegs;
  const endCenterIdx = vertices.length;
  vertices.push([
    centers[lastIdx].x + T[lastIdx].x * tipEndPush,
    centers[lastIdx].y + T[lastIdx].y * tipEndPush,
    centers[lastIdx].z + T[lastIdx].z * tipEndPush
  ]);
  for (let j = 0; j < radialSegs; j++) {
    const nj = (j + 1) % radialSegs;
    faces.push([endCenterIdx, lastRow + j, lastRow + nj]);
  }

  let mesh: EditableMeshData = {
    vertices,
    faces,
    shadeSmooth: options?.shadeSmooth !== false
  };
  const subdiv = Math.max(0, Math.min(2, Math.round(options?.subdivideLevels ?? 0)));
  if (subdiv > 0) {
    mesh = catmullClarkSubdivide(mesh, subdiv);
    mesh.shadeSmooth = options?.shadeSmooth !== false;
  }
  return mesh;
}

// ============================================================================
// UNIFIED SMOOTH-SDF CONNECTED MESH ENGINE (ZBrush DynaMesh / Smooth Metaballs)
// Surface Nets All-Quad Iso-Extraction + Tangential Relaxation + Exact SDF Snap
// ============================================================================

export type SDFElementKind =
  | 'ellipsoid'
  | 'sphere'
  | 'capsule'
  | 'curve'
  | 'rounded_box'
  | 'torus'
  | 'cylinder';

export interface SDFElementSpec {
  type: SDFElementKind;
  mode?: 'union' | 'subtract' | 'intersect';
  /** Smooth fillet/blend radius in metric units (e.g. 0.06 .. 0.35) */
  smooth?: number;
  /** Center for ellipsoid / sphere / rounded_box / torus / cylinder */
  center?: [number, number, number];
  /** Radii [rx, ry, rz] for ellipsoid, or single radius for sphere/cylinder */
  radii?: [number, number, number] | number | number[];
  radius?: number;
  /** Half-extents [hx, hy, hz] for rounded_box */
  size?: [number, number, number];
  /** Full height for cylinder */
  height?: number;
  /** Bevel/rounding radius for rounded_box or cylinder */
  bevel?: number;
  /** Torus radii */
  majorRadius?: number;
  minorRadius?: number;
  /** Capsule / tapered bone endpoints & radii */
  from?: [number, number, number];
  to?: [number, number, number];
  r1?: number;
  r2?: number;
  /** Multi-point 3D spline curve for 'curve' */
  points?: [number, number, number][];
  /** Optional local Euler rotation [rxDeg, ryDeg, rzDeg] */
  rotation?: [number, number, number];
  /** Seamless bilateral symmetry across X=0 or Y=0 */
  mirrorX?: boolean;
  mirrorY?: boolean;
  /** Optional per-element hex color smoothly blended onto vertexColors */
  color?: string;
}

export interface UnifiedSDFMeshSpec {
  elements: SDFElementSpec[];
  /** Grid resolution along the longest bounding-box axis (default 68, clamped 36..96) */
  resolution?: number;
  /** Default smooth blend radius when an element omits smooth (default 0.12) */
  defaultSmooth?: number;
  /** Default base hex color when elements omit color */
  baseColor?: string;
  /** Tangential relaxation iterations (default 4) */
  relaxIterations?: number;
}

interface CompiledSDFPrim {
  kind: 'ellipsoid' | 'capsule' | 'rounded_box' | 'torus' | 'cylinder';
  mode: 0 | 1 | 2; // 0 = union, 1 = subtract, 2 = intersect
  smooth: number;
  cx: number;
  cy: number;
  cz: number;
  hasRot: boolean;
  // Inverse rotation matrix rows
  m00: number; m01: number; m02: number;
  m10: number; m11: number; m12: number;
  m20: number; m21: number; m22: number;
  // Shape params
  p0: number; p1: number; p2: number; p3: number;
  // Capsule endpoints
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  // AABB for fast distance culling
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  // Linear RGB [0..1]
  cr: number; cg: number; cb: number;
  hasColor: boolean;
}

function hexToRgb01(hex?: string, fallback: [number, number, number] = [0.82, 0.84, 0.88]): [number, number, number] {
  if (!hex || typeof hex !== 'string') return fallback;
  const clean = hex.trim().replace('#', '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b];
  } else if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b];
  }
  return fallback;
}

function sminPoly(a: number, b: number, k: number): number {
  if (k <= 1e-5) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a < b ? a : b) - h * h * k * 0.25;
}

function smaxPoly(a: number, b: number, k: number): number {
  if (k <= 1e-5) return a > b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a > b ? a : b) + h * h * k * 0.25;
}

function evalSinglePrim(p: CompiledSDFPrim, wx: number, wy: number, wz: number): number {
  if (p.kind === 'capsule') {
    const pax = wx - p.ax;
    const pay = wy - p.ay;
    const paz = wz - p.az;
    const bax = p.bx - p.ax;
    const bay = p.by - p.ay;
    const baz = p.bz - p.az;
    const r1 = p.p0;
    const r2 = p.p1;
    const b2 = bax * bax + bay * bay + baz * baz;
    if (b2 < 1e-8) {
      return Math.hypot(pax, pay, paz) - Math.max(r1, r2);
    }
    // Exact Inigo Quilez sdRoundCone (tapered capsule)
    const rr = r1 - r2;
    const a2 = b2 - rr * rr;
    if (a2 <= 1e-6) {
      const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / b2));
      return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - (r1 + (r2 - r1) * h);
    }
    const il2 = 1.0 / b2;
    const pa2 = pax * pax + pay * pay + paz * paz;
    const y = pax * bax + pay * bay + paz * baz;
    const z = y - b2;
    const x2 = b2 * Math.max(0, pa2 * b2 - y * y);
    const y2 = y * y * b2;
    const z2 = z * z * b2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(z) * a2 * z2 > k) {
      return Math.sqrt(x2 + z2) * il2 - r2;
    }
    if (Math.sign(y) * a2 * y2 < k) {
      return Math.sqrt(x2 + y2) * il2 - r1;
    }
    return (Math.sqrt(Math.max(0, x2 * a2 * il2)) + y * rr) * il2 - r1;
  }

  let lx = wx - p.cx;
  let ly = wy - p.cy;
  let lz = wz - p.cz;
  if (p.hasRot) {
    const rx = p.m00 * lx + p.m01 * ly + p.m02 * lz;
    const ry = p.m10 * lx + p.m11 * ly + p.m12 * lz;
    const rz = p.m20 * lx + p.m21 * ly + p.m22 * lz;
    lx = rx;
    ly = ry;
    lz = rz;
  }

  switch (p.kind) {
    case 'ellipsoid': {
      const rx = p.p0;
      const ry = p.p1;
      const rz = p.p2;
      if (Math.abs(rx - ry) < 1e-5 && Math.abs(rx - rz) < 1e-5) {
        return Math.hypot(lx, ly, lz) - rx;
      }
      // Quilez improved ellipsoid SDF bound (accurate gradient everywhere)
      const kx0 = lx / rx;
      const ky0 = ly / ry;
      const kz0 = lz / rz;
      const k0 = Math.hypot(kx0, ky0, kz0);
      if (k0 < 1e-8) return -Math.min(rx, ry, rz);
      const k1 = Math.hypot(lx / (rx * rx), ly / (ry * ry), lz / (rz * rz));
      return (k0 * (k0 - 1.0)) / Math.max(1e-8, k1);
    }
    case 'rounded_box': {
      const hx = p.p0;
      const hy = p.p1;
      const hz = p.p2;
      const rad = p.p3;
      const qx = Math.abs(lx) - hx;
      const qy = Math.abs(ly) - hy;
      const qz = Math.abs(lz) - hz;
      const outD = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      const inD = Math.min(Math.max(qx, qy, qz), 0);
      return outD + inD - rad;
    }
    case 'torus': {
      const R = p.p0;
      const r = p.p1;
      const qx = Math.hypot(lx, ly) - R;
      return Math.hypot(qx, lz) - r;
    }
    case 'cylinder': {
      const r = p.p0;
      const hh = p.p1;
      const bev = p.p2;
      const dx = Math.hypot(lx, ly) - (r - bev);
      const dz = Math.abs(lz) - (hh - bev);
      return (
        Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) +
        Math.min(Math.max(dx, dz), 0) -
        bev
      );
    }
  }
}

function l2Safe(v: number): number {
  return v > 1e-8 ? v : 1e-8;
}

function compileSDFElements(
  elements: SDFElementSpec[],
  defaultSmooth: number,
  defaultRgb: [number, number, number]
): CompiledSDFPrim[] {
  const out: CompiledSDFPrim[] = [];

  const pushExpanded = (el: SDFElementSpec) => {
    const mode: 0 | 1 | 2 =
      el.mode === 'subtract' ? 1 : el.mode === 'intersect' ? 2 : 0;
    const smooth = Math.max(
      0,
      Math.min(1.2, typeof el.smooth === 'number' ? el.smooth : defaultSmooth)
    );
    const hasColor = Boolean(el.color);
    const [cr, cg, cb] = hexToRgb01(el.color, defaultRgb);

    const rot = el.rotation || [0, 0, 0];
    const hasRot =
      Math.abs(rot[0] || 0) > 0.05 ||
      Math.abs(rot[1] || 0) > 0.05 ||
      Math.abs(rot[2] || 0) > 0.05;
    const invMat = new THREE.Matrix4();
    if (hasRot) {
      const eul = new THREE.Euler(
        ((rot[0] || 0) * Math.PI) / 180,
        ((rot[1] || 0) * Math.PI) / 180,
        ((rot[2] || 0) * Math.PI) / 180,
        'XYZ'
      );
      invMat.makeRotationFromEuler(eul).transpose();
    }
    const me = invMat.elements;

    if (el.type === 'curve' && Array.isArray(el.points) && el.points.length >= 2) {
      const pts = el.points.map((pt) => new THREE.Vector3(pt[0] || 0, pt[1] || 0, pt[2] || 0));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
      const segs = Math.min(20, Math.max(4, (pts.length - 1) * 4));
      const radArr = Array.isArray(el.radii)
        ? el.radii.map((n) => Math.max(0.01, Number(n) || 0.1))
        : [Math.max(0.01, Number(el.radii ?? el.radius) || 0.12)];
      const sampleR = (u: number) => {
        if (radArr.length === 1) return radArr[0];
        const f = u * (radArr.length - 1);
        const i0 = Math.floor(f);
        const i1 = Math.min(radArr.length - 1, i0 + 1);
        return radArr[i0] + (radArr[i1] - radArr[i0]) * (f - i0);
      };
      for (let i = 0; i < segs; i++) {
        const u0 = i / segs;
        const u1 = (i + 1) / segs;
        const pA = curve.getPoint(u0);
        const pB = curve.getPoint(u1);
        const rA = sampleR(u0);
        const rB = sampleR(u1);
        const rMax = Math.max(rA, rB);
        out.push({
          kind: 'capsule',
          mode,
          smooth: i === 0 ? smooth : Math.max(0.015, Math.min(smooth, rMax * 0.35)),
          cx: 0, cy: 0, cz: 0,
          hasRot: false,
          m00: 1, m01: 0, m02: 0,
          m10: 0, m11: 1, m12: 0,
          m20: 0, m21: 0, m22: 1,
          p0: rA, p1: rB, p2: 0, p3: 0,
          ax: pA.x, ay: pA.y, az: pA.z,
          bx: pB.x, by: pB.y, bz: pB.z,
          minX: Math.min(pA.x, pB.x) - rMax,
          minY: Math.min(pA.y, pB.y) - rMax,
          minZ: Math.min(pA.z, pB.z) - rMax,
          maxX: Math.max(pA.x, pB.x) + rMax,
          maxY: Math.max(pA.y, pB.y) + rMax,
          maxZ: Math.max(pA.z, pB.z) + rMax,
          cr, cg, cb, hasColor
        });
      }
      return;
    }

    if (el.type === 'capsule') {
      const a = el.from || [0, 0, 0];
      const b = el.to || [0, 0, 0.5];
      const r1 = Math.max(0.008, Number(el.r1 ?? el.radius) || 0.15);
      const r2 = Math.max(0.008, Number(el.r2 ?? r1) || r1);
      const rMax = Math.max(r1, r2);
      out.push({
        kind: 'capsule',
        mode,
        smooth,
        cx: 0, cy: 0, cz: 0,
        hasRot: false,
        m00: 1, m01: 0, m02: 0,
        m10: 0, m11: 1, m12: 0,
        m20: 0, m21: 0, m22: 1,
        p0: r1, p1: r2, p2: 0, p3: 0,
        ax: a[0] || 0, ay: a[1] || 0, az: a[2] || 0,
        bx: b[0] || 0, by: b[1] || 0, bz: b[2] || 0,
        minX: Math.min(a[0], b[0]) - rMax,
        minY: Math.min(a[1], b[1]) - rMax,
        minZ: Math.min(a[2], b[2]) - rMax,
        maxX: Math.max(a[0], b[0]) + rMax,
        maxY: Math.max(a[1], b[1]) + rMax,
        maxZ: Math.max(a[2], b[2]) + rMax,
        cr, cg, cb, hasColor
      });
      return;
    }

    const c = el.center || [0, 0, 0];
    const cx = c[0] || 0;
    const cy = c[1] || 0;
    const cz = c[2] || 0;

    if (el.type === 'rounded_box') {
      const sz = el.size || [0.3, 0.3, 0.3];
      const rad = Math.max(0.005, Number(el.bevel ?? el.radius) || 0.06);
      const hx = Math.max(0.005, (Number(sz[0]) || 0.3) - rad);
      const hy = Math.max(0.005, (Number(sz[1]) || 0.3) - rad);
      const hz = Math.max(0.005, (Number(sz[2]) || 0.3) - rad);
      const bound = hasRot ? Math.hypot(hx + rad, hy + rad, hz + rad) : 0;
      out.push({
        kind: 'rounded_box',
        mode,
        smooth,
        cx, cy, cz,
        hasRot,
        m00: me[0], m01: me[4], m02: me[8],
        m10: me[1], m11: me[5], m12: me[9],
        m20: me[2], m21: me[6], m22: me[10],
        p0: hx, p1: hy, p2: hz, p3: rad,
        ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0,
        minX: cx - (hasRot ? bound : hx + rad),
        minY: cy - (hasRot ? bound : hy + rad),
        minZ: cz - (hasRot ? bound : hz + rad),
        maxX: cx + (hasRot ? bound : hx + rad),
        maxY: cy + (hasRot ? bound : hy + rad),
        maxZ: cz + (hasRot ? bound : hz + rad),
        cr, cg, cb, hasColor
      });
      return;
    }

    if (el.type === 'torus') {
      const R = Math.max(0.02, Number(el.majorRadius ?? el.radius) || 0.35);
      const r = Math.max(0.008, Number(el.minorRadius ?? el.bevel) || 0.1);
      const ext = R + r;
      out.push({
        kind: 'torus',
        mode,
        smooth,
        cx, cy, cz,
        hasRot,
        m00: me[0], m01: me[4], m02: me[8],
        m10: me[1], m11: me[5], m12: me[9],
        m20: me[2], m21: me[6], m22: me[10],
        p0: R, p1: r, p2: 0, p3: 0,
        ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0,
        minX: cx - ext, minY: cy - ext, minZ: cz - (hasRot ? ext : r),
        maxX: cx + ext, maxY: cy + ext, maxZ: cz + (hasRot ? ext : r),
        cr, cg, cb, hasColor
      });
      return;
    }

    if (el.type === 'cylinder') {
      const r = Math.max(0.01, Number(el.radius) || 0.25);
      const hh = Math.max(0.01, (Number(el.height) || 0.5) * 0.5);
      const bev = Math.max(0.002, Math.min(Math.min(r, hh) * 0.9, Number(el.bevel) || Math.min(r, hh) * 0.18));
      const bound = hasRot ? Math.hypot(r, hh) : 0;
      out.push({
        kind: 'cylinder',
        mode,
        smooth,
        cx, cy, cz,
        hasRot,
        m00: me[0], m01: me[4], m02: me[8],
        m10: me[1], m11: me[5], m12: me[9],
        m20: me[2], m21: me[6], m22: me[10],
        p0: r, p1: hh, p2: bev, p3: 0,
        ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0,
        minX: cx - (hasRot ? bound : r),
        minY: cy - (hasRot ? bound : r),
        minZ: cz - (hasRot ? bound : hh),
        maxX: cx + (hasRot ? bound : r),
        maxY: cy + (hasRot ? bound : r),
        maxZ: cz + (hasRot ? bound : hh),
        cr, cg, cb, hasColor
      });
      return;
    }

    // Default: sphere / ellipsoid
    let rx = 0.25;
    let ry = 0.25;
    let rz = 0.25;
    if (Array.isArray(el.radii) && el.radii.length >= 3) {
      rx = Math.max(0.008, Number(el.radii[0]) || 0.25);
      ry = Math.max(0.008, Number(el.radii[1]) || 0.25);
      rz = Math.max(0.008, Number(el.radii[2]) || 0.25);
    } else {
      const r = Math.max(0.008, Number(el.radius ?? el.radii) || 0.25);
      rx = r;
      ry = r;
      rz = r;
    }
    const maxR = Math.max(rx, ry, rz);
    out.push({
      kind: 'ellipsoid',
      mode,
      smooth,
      cx, cy, cz,
      hasRot,
      m00: me[0], m01: me[4], m02: me[8],
      m10: me[1], m11: me[5], m12: me[9],
      m20: me[2], m21: me[6], m22: me[10],
      p0: rx, p1: ry, p2: rz, p3: 0,
      ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0,
      minX: cx - (hasRot ? maxR : rx),
      minY: cy - (hasRot ? maxR : ry),
      minZ: cz - (hasRot ? maxR : rz),
      maxX: cx + (hasRot ? maxR : rx),
      maxY: cy + (hasRot ? maxR : ry),
      maxZ: cz + (hasRot ? maxR : rz),
      cr, cg, cb, hasColor
    });
  };

  for (const raw of elements) {
    if (!raw) continue;
    pushExpanded({ ...raw, mirrorX: false, mirrorY: false });

    if (raw.mirrorX) {
      const mirroredX: SDFElementSpec = {
        ...raw,
        mirrorX: false,
        mirrorY: false,
        center: raw.center ? [-raw.center[0], raw.center[1], raw.center[2]] : undefined,
        from: raw.from ? [-raw.from[0], raw.from[1], raw.from[2]] : undefined,
        to: raw.to ? [-raw.to[0], raw.to[1], raw.to[2]] : undefined,
        points: raw.points ? raw.points.map((pt) => [-pt[0], pt[1], pt[2]]) : undefined,
        rotation: raw.rotation ? [raw.rotation[0], -raw.rotation[1], -raw.rotation[2]] : undefined
      };
      pushExpanded(mirroredX);
    }

    if (raw.mirrorY) {
      const mirroredY: SDFElementSpec = {
        ...raw,
        mirrorX: false,
        mirrorY: false,
        center: raw.center ? [raw.center[0], -raw.center[1], raw.center[2]] : undefined,
        from: raw.from ? [raw.from[0], -raw.from[1], raw.from[2]] : undefined,
        to: raw.to ? [raw.to[0], -raw.to[1], raw.to[2]] : undefined,
        points: raw.points ? raw.points.map((pt) => [pt[0], -pt[1], pt[2]]) : undefined,
        rotation: raw.rotation ? [-raw.rotation[0], raw.rotation[1], -raw.rotation[2]] : undefined
      };
      pushExpanded(mirroredY);
    }
  }

  return out;
}

function extractSurfaceNetsQuadMesh(
  evalField: (x: number, y: number, z: number) => number,
  evalColor: ((x: number, y: number, z: number) => [number, number, number]) | null,
  boundsMin: [number, number, number],
  boundsMax: [number, number, number],
  resolution = 68,
  relaxIterations = 4
): EditableMeshData {
  const res = Math.max(32, Math.min(96, Math.round(resolution)));
  const spanX = Math.max(0.08, boundsMax[0] - boundsMin[0]);
  const spanY = Math.max(0.08, boundsMax[1] - boundsMin[1]);
  const spanZ = Math.max(0.08, boundsMax[2] - boundsMin[2]);
  const maxSpan = Math.max(spanX, spanY, spanZ);
  const h = maxSpan / res;

  // Pad by 2.5 voxels on each side so the d=0 iso-surface never clips against grid border
  const pad = h * 2.5;
  const ox = boundsMin[0] - pad;
  const oy = boundsMin[1] - pad;
  const oz = boundsMin[2] - pad;

  const nx = Math.max(8, Math.ceil((spanX + pad * 2) / h));
  const ny = Math.max(8, Math.ceil((spanY + pad * 2) / h));
  const nz = Math.max(8, Math.ceil((spanZ + pad * 2) / h));

  const gx = nx + 1;
  const gy = ny + 1;
  const gz = nz + 1;
  const gxy = gx * gy;
  const grid = new Float32Array(gx * gy * gz);

  for (let iz = 0; iz < gz; iz++) {
    const wz = oz + iz * h;
    const zBase = iz * gxy;
    for (let iy = 0; iy < gy; iy++) {
      const wy = oy + iy * h;
      const yzBase = zBase + iy * gx;
      for (let ix = 0; ix < gx; ix++) {
        grid[yzBase + ix] = evalField(ox + ix * h, wy, wz);
      }
    }
  }

  // 12 edges of a unit cell in local corner bitmask [0..7], corner (dx, dy, dz) => dx | (dy<<1) | (dz<<2)
  const CELL_EDGES: [number, number][] = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7]
  ];

  const cxy = nx * ny;
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const vertices: [number, number, number][] = [];
  const cd = new Float32Array(8);

  for (let cz = 0; cz < nz; cz++) {
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx < nx; cx++) {
        let mask = 0;
        for (let k = 0; k < 8; k++) {
          const dx = k & 1;
          const dy = (k >> 1) & 1;
          const dz = (k >> 2) & 1;
          const val = grid[(cz + dz) * gxy + (cy + dy) * gx + (cx + dx)];
          cd[k] = val;
          if (val < 0) mask |= 1 << k;
        }
        if (mask === 0 || mask === 255) continue;

        let sx = 0;
        let sy = 0;
        let sz = 0;
        let crossings = 0;
        for (let e = 0; e < 12; e++) {
          const c0 = CELL_EDGES[e][0];
          const c1 = CELL_EDGES[e][1];
          const d0 = cd[c0];
          const d1 = cd[c1];
          if ((d0 < 0) === (d1 < 0)) continue;
          const denom = d0 - d1;
          const t = Math.abs(denom) > 1e-8 ? Math.max(0, Math.min(1, d0 / denom)) : 0.5;
          const x0 = c0 & 1, y0 = (c0 >> 1) & 1, z0 = (c0 >> 2) & 1;
          const x1 = c1 & 1, y1 = (c1 >> 1) & 1, z1 = (c1 >> 2) & 1;
          sx += x0 + (x1 - x0) * t;
          sy += y0 + (y1 - y0) * t;
          sz += z0 + (z1 - z0) * t;
          crossings++;
        }

        const inv = crossings > 0 ? 1 / crossings : 0.5;
        const vIdx = vertices.length;
        cellVert[cz * cxy + cy * nx + cx] = vIdx;
        vertices.push([
          ox + (cx + sx * inv) * h,
          oy + (cy + sy * inv) * h,
          oz + (cz + sz * inv) * h
        ]);
      }
    }
  }

  if (vertices.length < 4) {
    return createPrimitiveMesh('uv_sphere');
  }

  const faces: number[][] = [];
  const cellAt = (cx: number, cy: number, cz: number) => cellVert[cz * cxy + cy * nx + cx];

  // X-directed interior edges
  for (let iz = 1; iz < nz; iz++) {
    for (let iy = 1; iy < ny; iy++) {
      const rowBase = iz * gxy + iy * gx;
      for (let ix = 0; ix < nx; ix++) {
        const d0 = grid[rowBase + ix];
        const d1 = grid[rowBase + ix + 1];
        if ((d0 < 0) === (d1 < 0)) continue;
        const c0 = cellAt(ix, iy - 1, iz - 1);
        const c1 = cellAt(ix, iy, iz - 1);
        const c2 = cellAt(ix, iy, iz);
        const c3 = cellAt(ix, iy - 1, iz);
        if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) continue;
        if (d0 < 0) faces.push([c0, c1, c2, c3]);
        else faces.push([c0, c3, c2, c1]);
      }
    }
  }

  // Y-directed interior edges
  for (let iz = 1; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 1; ix < nx; ix++) {
        const d0 = grid[iz * gxy + iy * gx + ix];
        const d1 = grid[iz * gxy + (iy + 1) * gx + ix];
        if ((d0 < 0) === (d1 < 0)) continue;
        const c0 = cellAt(ix - 1, iy, iz - 1);
        const c1 = cellAt(ix - 1, iy, iz);
        const c2 = cellAt(ix, iy, iz);
        const c3 = cellAt(ix, iy, iz - 1);
        if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) continue;
        if (d0 < 0) faces.push([c0, c1, c2, c3]);
        else faces.push([c0, c3, c2, c1]);
      }
    }
  }

  // Z-directed interior edges
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 1; iy < ny; iy++) {
      for (let ix = 1; ix < nx; ix++) {
        const d0 = grid[iz * gxy + iy * gx + ix];
        const d1 = grid[(iz + 1) * gxy + iy * gx + ix];
        if ((d0 < 0) === (d1 < 0)) continue;
        const c0 = cellAt(ix - 1, iy - 1, iz);
        const c1 = cellAt(ix, iy - 1, iz);
        const c2 = cellAt(ix, iy, iz);
        const c3 = cellAt(ix - 1, iy, iz);
        if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) continue;
        if (d0 < 0) faces.push([c0, c1, c2, c3]);
        else faces.push([c0, c3, c2, c1]);
      }
    }
  }

  // Build vertex adjacency for tangential relaxation + Taubin fairing
  const vCount = vertices.length;
  const adj: number[][] = Array.from({ length: vCount }, () => []);
  const addEdge = (a: number, b: number) => {
    if (!adj[a].includes(b)) adj[a].push(b);
    if (!adj[b].includes(a)) adj[b].push(a);
  };
  for (const f of faces) {
    for (let i = 0; i < f.length; i++) {
      addEdge(f[i], f[(i + 1) % f.length]);
    }
  }

  const eps = h * 0.35;
  const sampleGrad = (px: number, py: number, pz: number): [number, number, number] => {
    const gxVal = evalField(px + eps, py, pz) - evalField(px - eps, py, pz);
    const gyVal = evalField(px, py + eps, pz) - evalField(px, py - eps, pz);
    const gzVal = evalField(px, py, pz + eps) - evalField(px, py, pz - eps);
    const len = Math.hypot(gxVal, gyVal, gzVal) || 1;
    return [gxVal / len, gyVal / len, gzVal / len];
  };

  // Tangential relaxation + exact Newton-Raphson SDF zero-level projection
  const iters = Math.max(1, Math.min(8, relaxIterations));
  const nextVerts: [number, number, number][] = vertices.map((v) => [v[0], v[1], v[2]]);
  const maxSnap = h * 0.55;

  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < vCount; i++) {
      const nbrs = adj[i];
      const [px, py, pz] = vertices[i];
      const [nxv, nyv, nzv] = sampleGrad(px, py, pz);

      let tx = px;
      let ty = py;
      let tz = pz;
      if (nbrs.length > 0) {
        let ax = 0;
        let ay = 0;
        let az = 0;
        for (let k = 0; k < nbrs.length; k++) {
          const nb = vertices[nbrs[k]];
          ax += nb[0];
          ay += nb[1];
          az += nb[2];
        }
        ax /= nbrs.length;
        ay /= nbrs.length;
        az /= nbrs.length;
        const dx = ax - px;
        const dy = ay - py;
        const dz = az - pz;
        const dotN = dx * nxv + dy * nyv + dz * nzv;
        // Slide strictly in tangent plane -> regularizes quad flow with zero shrinkage
        tx = px + (dx - dotN * nxv) * 0.55;
        ty = py + (dy - dotN * nyv) * 0.55;
        tz = pz + (dz - dotN * nzv) * 0.55;
      }

      // Snap onto exact d(p) = 0 curved iso-surface
      const dVal = Math.max(-maxSnap, Math.min(maxSnap, evalField(tx, ty, tz)));
      const [gnx, gny, gnz] = sampleGrad(tx, ty, tz);
      nextVerts[i][0] = tx - dVal * gnx;
      nextVerts[i][1] = ty - dVal * gny;
      nextVerts[i][2] = tz - dVal * gnz;
    }
    for (let i = 0; i < vCount; i++) {
      vertices[i][0] = nextVerts[i][0];
      vertices[i][1] = nextVerts[i][1];
      vertices[i][2] = nextVerts[i][2];
    }
  }

  // Gentle volume-preserving Taubin polish pass (lambda = +0.28, mu = -0.29)
  for (const factor of [0.28, -0.29]) {
    for (let i = 0; i < vCount; i++) {
      const nbrs = adj[i];
      if (nbrs.length === 0) continue;
      let ax = 0;
      let ay = 0;
      let az = 0;
      for (let k = 0; k < nbrs.length; k++) {
        const nb = vertices[nbrs[k]];
        ax += nb[0];
        ay += nb[1];
        az += nb[2];
      }
      ax /= nbrs.length;
      ay /= nbrs.length;
      az /= nbrs.length;
      nextVerts[i][0] = vertices[i][0] + (ax - vertices[i][0]) * factor;
      nextVerts[i][1] = vertices[i][1] + (ay - vertices[i][1]) * factor;
      nextVerts[i][2] = vertices[i][2] + (az - vertices[i][2]) * factor;
    }
    for (let i = 0; i < vCount; i++) {
      vertices[i][0] = nextVerts[i][0];
      vertices[i][1] = nextVerts[i][1];
      vertices[i][2] = nextVerts[i][2];
    }
  }

  let vertexColors: [number, number, number][] | undefined;
  if (evalColor) {
    vertexColors = vertices.map(([vx, vy, vz]) => evalColor(vx, vy, vz));
  }

  return {
    vertices,
    faces,
    vertexColors,
    shadeSmooth: true
  };
}

/**
 * Builds a 100% connected, watertight, smooth, rounded All-Quad Unified Mesh
 * by fusing multiple volumetric sculpted elements with smooth-minimum fillets and boolean cavities.
 */
export function createUnifiedSDFMesh(spec: UnifiedSDFMeshSpec): EditableMeshData {
  const defaultSmooth =
    typeof spec.defaultSmooth === 'number' ? Math.max(0, spec.defaultSmooth) : 0.12;
  const defaultRgb = hexToRgb01(spec.baseColor, [0.84, 0.86, 0.9]);
  const prims = compileSDFElements(spec.elements || [], defaultSmooth, defaultRgb);

  if (prims.length === 0) {
    return createPrimitiveMesh('uv_sphere');
  }

  const minB: [number, number, number] = [Infinity, Infinity, Infinity];
  const maxB: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let anyUnion = false;
  let anyCustomColor = false;

  for (const p of prims) {
    if (p.hasColor) anyCustomColor = true;
    if (p.mode === 0) {
      anyUnion = true;
      const m = p.smooth * 0.65;
      if (p.minX - m < minB[0]) minB[0] = p.minX - m;
      if (p.minY - m < minB[1]) minB[1] = p.minY - m;
      if (p.minZ - m < minB[2]) minB[2] = p.minZ - m;
      if (p.maxX + m > maxB[0]) maxB[0] = p.maxX + m;
      if (p.maxY + m > maxB[1]) maxB[1] = p.maxY + m;
      if (p.maxZ + m > maxB[2]) maxB[2] = p.maxZ + m;
    }
  }

  if (!anyUnion) {
    return createPrimitiveMesh('uv_sphere');
  }

  const nPrims = prims.length;
  const evalField = (x: number, y: number, z: number): number => {
    let d = 1e6;
    for (let i = 0; i < nPrims; i++) {
      const p = prims[i];
      if (p.mode === 0) {
        // Fast squared-distance AABB reject (zero Math.hypot overhead)
        const dx = x < p.minX ? p.minX - x : x > p.maxX ? x - p.maxX : 0;
        const dy = y < p.minY ? p.minY - y : y > p.maxY ? y - p.maxY : 0;
        const dz = z < p.minZ ? p.minZ - z : z > p.maxZ ? z - p.maxZ : 0;
        const thresh = d + p.smooth;
        if (dx + dy + dz > 0 && thresh > 0 && dx * dx + dy * dy + dz * dz > thresh * thresh) {
          continue;
        }
        const dp = evalSinglePrim(p, x, y, z);
        d = i === 0 || d > 9e5 ? dp : sminPoly(d, dp, p.smooth);
      } else if (p.mode === 1) {
        const dx = x < p.minX ? p.minX - x : x > p.maxX ? x - p.maxX : 0;
        const dy = y < p.minY ? p.minY - y : y > p.maxY ? y - p.maxY : 0;
        const dz = z < p.minZ ? p.minZ - z : z > p.maxZ ? z - p.maxZ : 0;
        const thresh = Math.abs(d) + p.smooth + 0.05;
        if (dx === 0 && dy === 0 && dz === 0 || dx * dx + dy * dy + dz * dz < thresh * thresh) {
          const dp = evalSinglePrim(p, x, y, z);
          d = smaxPoly(d, -dp, p.smooth);
        }
      } else {
        const dp = evalSinglePrim(p, x, y, z);
        d = smaxPoly(d, dp, p.smooth);
      }
    }
    return d;
  };

  const evalColor = anyCustomColor
    ? (x: number, y: number, z: number): [number, number, number] => {
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let wSum = 0;
        for (let i = 0; i < nPrims; i++) {
          const p = prims[i];
          if (p.mode === 2) continue;
          const dp = Math.abs(evalSinglePrim(p, x, y, z));
          const sharpness = 18 / Math.max(0.04, p.smooth || 0.1);
          const w = Math.exp(-dp * sharpness);
          rSum += p.cr * w;
          gSum += p.cg * w;
          bSum += p.cb * w;
          wSum += w;
        }
        if (wSum <= 1e-9) return defaultRgb;
        return [rSum / wSum, gSum / wSum, bSum / wSum];
      }
    : null;

  return extractSurfaceNetsQuadMesh(
    evalField,
    evalColor,
    minB,
    maxB,
    spec.resolution ?? 58,
    spec.relaxIterations ?? 3
  );
}

export interface WorldMeshPartForFusion {
  mesh: EditableMeshData;
  colorHex?: string;
  color?: string;
}

/**
 * Remeshes and smooth-welds multiple arbitrary 3D meshes (already in target/world coordinates)
 * into ONE single connected, watertight, smooth, rounded All-Quad Mesh!
 */
export function fuseWorldMeshesToUnifiedMesh(
  parts: WorldMeshPartForFusion[],
  options?: { smoothness?: number; resolution?: number }
): EditableMeshData {
  if (!parts || parts.length === 0) return createPrimitiveMesh('cube');

  const smoothness = Math.max(0.01, Math.min(0.6, Number(options?.smoothness) || 0.09));
  const resolution = Math.max(36, Math.min(88, Math.round(options?.resolution ?? 60)));

  interface PreparedPart {
    tris: Float32Array; // 9 floats per triangle (ax,ay,az, bx,by,bz, cx,cy,cz)
    triCount: number;
    minX: number; minY: number; minZ: number;
    maxX: number; maxY: number; maxZ: number;
    cr: number; cg: number; cb: number;
  }

  const prepared: PreparedPart[] = [];
  const globalMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const globalMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const part of parts) {
    const m = part.mesh;
    if (!m || m.vertices.length < 3 || m.faces.length === 0) continue;
    const flat: number[] = [];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const v of m.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] > maxZ) maxZ = v[2];
    }

    for (const f of m.faces) {
      if (f.length < 3) continue;
      const v0 = m.vertices[f[0]];
      if (!v0) continue;
      for (let i = 1; i < f.length - 1; i++) {
        const v1 = m.vertices[f[i]];
        const v2 = m.vertices[f[i + 1]];
        if (!v1 || !v2) continue;
        flat.push(v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]);
      }
    }

    if (flat.length === 0) continue;
    const [cr, cg, cb] = hexToRgb01(part.colorHex || part.color || '#cccccc');
    prepared.push({
      tris: new Float32Array(flat),
      triCount: flat.length / 9,
      minX, minY, minZ,
      maxX, maxY, maxZ,
      cr, cg, cb
    });

    if (minX - smoothness < globalMin[0]) globalMin[0] = minX - smoothness;
    if (minY - smoothness < globalMin[1]) globalMin[1] = minY - smoothness;
    if (minZ - smoothness < globalMin[2]) globalMin[2] = minZ - smoothness;
    if (maxX + smoothness > globalMax[0]) globalMax[0] = maxX + smoothness;
    if (maxY + smoothness > globalMax[1]) globalMax[1] = maxY + smoothness;
    if (maxZ + smoothness > globalMax[2]) globalMax[2] = maxZ + smoothness;
  }

  if (prepared.length === 0) return createPrimitiveMesh('cube');

  const signedDistToPart = (part: PreparedPart, px: number, py: number, pz: number): number => {
    const t = part.tris;
    const n = part.triCount;
    let minDistSq = Infinity;
    let intersections = 0;

    for (let i = 0; i < n; i++) {
      const b = i * 9;
      const ax = t[b], ay = t[b + 1], az = t[b + 2];
      const bx = t[b + 3], by = t[b + 4], bz = t[b + 5];
      const cx = t[b + 6], cy = t[b + 7], cz = t[b + 8];

      // +X Ray parity test (perturbed slightly to avoid vertex/edge degeneracies)
      const ry = py + 1.37e-5;
      const rz = pz + 2.19e-5;
      const minTy = Math.min(ay, by, cy);
      const maxTy = Math.max(ay, by, cy);
      const minTz = Math.min(az, bz, cz);
      const maxTz = Math.max(az, bz, cz);
      if (ry >= minTy && ry <= maxTy && rz >= minTz && rz <= maxTz && Math.max(ax, bx, cx) >= px) {
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        // d = (1, 0, 0), pvec = d x e2 = (0, -e2z, e2y)
        const det = -e1y * e2z + e1z * e2y;
        if (Math.abs(det) > 1e-9) {
          const invDet = 1 / det;
          const sx = px - ax, sy = ry - ay, sz = rz - az;
          const u = (-sy * e2z + sz * e2y) * invDet;
          if (u >= 0 && u <= 1) {
            // qvec = s x e1
            const qx = sy * e1z - sz * e1y;
            const qy = sz * e1x - sx * e1z;
            const qz = sx * e1y - sy * e1x;
            const v = qx * invDet;
            if (v >= 0 && u + v <= 1) {
              const rayT = (e2x * qx + e2y * qy + e2z * qz) * invDet;
              if (rayT > 0) intersections++;
            }
          }
        }
      }

      // Closest point on triangle (Ericson real-time collision detection)
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const acx = cx - ax, acy = cy - ay, acz = cz - az;
      const apx = px - ax, apy = py - ay, apz = pz - az;
      const d1 = abx * apx + aby * apy + abz * apz;
      const d2 = acx * apx + acy * apy + acz * apz;
      let qx = ax, qy = ay, qz = az;

      if (d1 <= 0 && d2 <= 0) {
        qx = ax; qy = ay; qz = az;
      } else {
        const bpx = px - bx, bpy = py - by, bpz = pz - bz;
        const d3 = abx * bpx + aby * bpy + abz * bpz;
        const d4 = acx * bpx + acy * bpy + acz * bpz;
        if (d3 >= 0 && d4 <= d3) {
          qx = bx; qy = by; qz = bz;
        } else {
          const vc = d1 * d4 - d3 * d2;
          if (vc <= 0 && d1 >= 0 && d3 <= 0) {
            const v = d1 / (d1 - d3);
            qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v;
          } else {
            const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
            const d5 = abx * cpx + aby * cpy + abz * cpz;
            const d6 = acx * cpx + acy * cpy + acz * cpz;
            if (d6 >= 0 && d5 <= d6) {
              qx = cx; qy = cy; qz = cz;
            } else {
              const vb = d5 * d2 - d1 * d6;
              if (vb <= 0 && d2 >= 0 && d6 <= 0) {
                const w = d2 / (d2 - d6);
                qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w;
              } else {
                const va = d3 * d6 - d5 * d4;
                if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
                  const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
                  qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; qz = bz + (cz - bz) * w;
                } else {
                  const denom = 1 / (va + vb + vc);
                  const v = vb * denom;
                  const w = vc * denom;
                  qx = ax + abx * v + acx * w;
                  qy = ay + aby * v + acy * w;
                  qz = az + abz * v + acz * w;
                }
              }
            }
          }
        }
      }

      const dx = px - qx, dy = py - qy, dz = pz - qz;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq < minDistSq) minDistSq = dSq;
    }

    const dist = Math.sqrt(minDistSq);
    return intersections % 2 === 1 ? -dist : dist;
  };

  const evalField = (x: number, y: number, z: number): number => {
    let d = 1e6;
    for (let i = 0; i < prepared.length; i++) {
      const p = prepared[i];
      const dx = x < p.minX ? p.minX - x : x > p.maxX ? x - p.maxX : 0;
      const dy = y < p.minY ? p.minY - y : y > p.maxY ? y - p.maxY : 0;
      const dz = z < p.minZ ? p.minZ - z : z > p.maxZ ? z - p.maxZ : 0;
      if (dx + dy + dz > 0 && Math.hypot(dx, dy, dz) > d + smoothness) continue;
      const dp = signedDistToPart(p, x, y, z);
      d = i === 0 || d > 9e5 ? dp : sminPoly(d, dp, smoothness);
    }
    return d;
  };

  const multiColor =
    new Set(parts.map((p) => (p.colorHex || p.color || '#cccccc').toLowerCase())).size > 1;
  const evalColor = multiColor
    ? (x: number, y: number, z: number): [number, number, number] => {
        let rS = 0, gS = 0, bS = 0, wS = 0;
        const sharp = 16 / Math.max(0.04, smoothness);
        for (let i = 0; i < prepared.length; i++) {
          const p = prepared[i];
          const dp = Math.abs(signedDistToPart(p, x, y, z));
          const w = Math.exp(-dp * sharp);
          rS += p.cr * w;
          gS += p.cg * w;
          bS += p.cb * w;
          wS += w;
        }
        return wS > 1e-9 ? [rS / wS, gS / wS, bS / wS] : [prepared[0].cr, prepared[0].cg, prepared[0].cb];
      }
    : null;

  return extractSurfaceNetsQuadMesh(evalField, evalColor, globalMin, globalMax, resolution, 4);
}

/** Bends a mesh along Z (height) curving into X by angleDeg */
export function bendMeshZ(mesh: EditableMeshData, angleDeg = 35): EditableMeshData {
  const out = cloneMeshData(mesh);
  const rad = (angleDeg * Math.PI) / 180;
  if (Math.abs(rad) < 1e-4) return out;
  const bounds = computeMeshBounds(out);
  const minZ = bounds.min[2];
  const spanZ = bounds.span[2];
  const radius = spanZ / rad;

  for (const v of out.vertices) {
    const t = (v[2] - minZ) / spanZ;
    const theta = t * rad;
    const rLocal = radius - v[0];
    v[0] = radius - rLocal * Math.cos(theta);
    v[2] = minZ + rLocal * Math.sin(theta);
  }
  return out;
}

/** Twists a mesh around Z axis by angleDeg from bottom to top */
export function twistMeshZ(mesh: EditableMeshData, angleDeg = 45): EditableMeshData {
  const out = cloneMeshData(mesh);
  const rad = (angleDeg * Math.PI) / 180;
  if (Math.abs(rad) < 1e-4) return out;
  const bounds = computeMeshBounds(out);
  const minZ = bounds.min[2];
  const spanZ = bounds.span[2];

  for (const v of out.vertices) {
    const t = (v[2] - minZ) / spanZ - 0.5;
    const a = t * rad;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const nx = v[0] * c - v[1] * s;
    const ny = v[0] * s + v[1] * c;
    v[0] = nx;
    v[1] = ny;
  }
  return out;
}

/** Converts any Three.js BufferGeometry (from FBX/GLB/DAE/PLY/3MF/SVG) into EditableMeshData */
export function threeGeometryToEditableMesh(
  geo: THREE.BufferGeometry,
  convertYUpToZUp = true
): EditableMeshData {
  const pos = geo.getAttribute('position');
  if (!pos) return { vertices: [], faces: [], shadeSmooth: false };

  const colAttr = geo.getAttribute('color');
  const vertices: [number, number, number][] = [];
  const vertexColors: [number, number, number][] = [];
  const vertMap = new Map<string, number>();

  const getVertIndex = (i: number): number => {
    const rx = pos.getX(i);
    const ry = pos.getY(i);
    const rz = pos.getZ(i);
    // Y-up (x, y, z) -> Z-up (x, -z, y) preserves right-handed winding!
    const x = rx;
    const y = convertYUpToZUp ? -rz : ry;
    const z = convertYUpToZUp ? ry : rz;

    const key = `${x.toFixed(5)}_${y.toFixed(5)}_${z.toFixed(5)}`;
    const existing = vertMap.get(key);
    if (existing !== undefined) return existing;

    const idx = vertices.length;
    vertices.push([x, y, z]);
    if (colAttr) {
      vertexColors.push([colAttr.getX(i), colAttr.getY(i), colAttr.getZ(i)]);
    }
    vertMap.set(key, idx);
    return idx;
  };

  const faces: number[][] = [];
  const index = geo.getIndex();
  if (index) {
    for (let i = 0; i + 2 < index.count; i += 3) {
      const a = getVertIndex(index.getX(i));
      const b = getVertIndex(index.getX(i + 1));
      const c = getVertIndex(index.getX(i + 2));
      if (a !== b && b !== c && a !== c) faces.push([a, b, c]);
    }
  } else {
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const a = getVertIndex(i);
      const b = getVertIndex(i + 1);
      const c = getVertIndex(i + 2);
      if (a !== b && b !== c && a !== c) faces.push([a, b, c]);
    }
  }

  return {
    vertices,
    faces,
    vertexColors: colAttr ? vertexColors : undefined,
    shadeSmooth: false
  };
}

export function createPrimitiveMesh(type: PrimitiveType): EditableMeshData {
  switch (type) {
    case 'cube': {
      const vertices: [number, number, number][] = [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
      ];
      const faces: number[][] = [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7]
      ];
      return { vertices, faces, shadeSmooth: false };
    }

    case 'plane': {
      const vertices: [number, number, number][] = [
        [-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]
      ];
      return { vertices, faces: [[0, 1, 2, 3]], shadeSmooth: false };
    }

    case 'grid': {
      const divs = 8;
      const half = 1.5;
      const vertices: [number, number, number][] = [];
      const faces: number[][] = [];
      for (let iy = 0; iy <= divs; iy++) {
        for (let ix = 0; ix <= divs; ix++) {
          vertices.push([
            -half + (2 * half * ix) / divs,
            -half + (2 * half * iy) / divs,
            0
          ]);
        }
      }
      const stride = divs + 1;
      for (let iy = 0; iy < divs; iy++) {
        for (let ix = 0; ix < divs; ix++) {
          const a = iy * stride + ix;
          const b = a + 1;
          const c = a + stride + 1;
          const d = a + stride;
          faces.push([a, b, c, d]);
        }
      }
      return { vertices, faces, shadeSmooth: false };
    }

    case 'wedge': {
      // Sloped wedge ramp from -Y front bottom to +Y back top
      const vertices: [number, number, number][] = [
        [-1, -1, -1], // 0 front-left-bottom
        [1, -1, -1],  // 1 front-right-bottom
        [1, 1, -1],   // 2 back-right-bottom
        [-1, 1, -1],  // 3 back-left-bottom
        [-1, 1, 1],   // 4 back-left-top
        [1, 1, 1]     // 5 back-right-top
      ];
      const faces: number[][] = [
        [0, 3, 2, 1], // bottom
        [2, 3, 4, 5], // vertical back
        [0, 1, 5, 4], // sloped ramp
        [0, 4, 3],    // left triangle
        [1, 2, 5]     // right triangle
      ];
      return { vertices, faces, shadeSmooth: false };
    }

    case 'corner_wedge': {
      // Sloped corner wedge primitive
      const vertices: [number, number, number][] = [
        [-1, -1, -1], // 0
        [1, -1, -1],  // 1
        [1, 1, -1],   // 2
        [-1, 1, -1],  // 3
        [1, 1, 1]     // 4 apex corner
      ];
      const faces: number[][] = [
        [0, 3, 2, 1], // bottom
        [1, 2, 4],    // right vertical
        [2, 3, 4],    // back vertical
        [0, 1, 4],    // front slope
        [3, 0, 4]     // left slope
      ];
      return { vertices, faces, shadeSmooth: false };
    }

    case 'pyramid': {
      const vertices: [number, number, number][] = [
        [-1, -1, -1],
        [1, -1, -1],
        [1, 1, -1],
        [-1, 1, -1],
        [0, 0, 1.2]
      ];
      const faces: number[][] = [
        [0, 3, 2, 1],
        [0, 1, 4],
        [1, 2, 4],
        [2, 3, 4],
        [3, 0, 4]
      ];
      return { vertices, faces, shadeSmooth: false };
    }

    case 'prism': {
      // Triangular roof prism along Y
      const vertices: [number, number, number][] = [
        [-1, -1, -0.8], [1, -1, -0.8], [0, -1, 0.9],
        [-1, 1, -0.8], [1, 1, -0.8], [0, 1, 0.9]
      ];
      const faces: number[][] = [
        [0, 2, 1],       // front
        [3, 4, 5],       // back
        [0, 1, 4, 3],    // bottom
        [1, 2, 5, 4],    // right roof
        [2, 0, 3, 5]     // left roof
      ];
      return { vertices, faces, shadeSmooth: false };
    }

    case 'hex_cylinder': {
      return makeNGonCylinder(6, 1.0, 2.0, false);
    }

    case 'cylinder': {
      return makeNGonCylinder(20, 1.0, 2.0, false);
    }

    case 'pipe': {
      const segs = 20;
      const rOut = 1.0;
      const rIn = 0.68;
      const hz = 1.0;
      const vertices: [number, number, number][] = [];
      for (const z of [-hz, hz]) {
        for (const r of [rOut, rIn]) {
          for (let j = 0; j < segs; j++) {
            const th = (2 * Math.PI * j) / segs;
            vertices.push([r * Math.cos(th), r * Math.sin(th), z]);
          }
        }
      }
      // Indices: bOut=0, bIn=segs, tOut=2*segs, tIn=3*segs
      const bOut = 0;
      const bIn = segs;
      const tOut = 2 * segs;
      const tIn = 3 * segs;
      const faces: number[][] = [];
      for (let j = 0; j < segs; j++) {
        const nj = (j + 1) % segs;
        faces.push([bOut + j, bOut + nj, tOut + nj, tOut + j]); // outer wall
        faces.push([bIn + nj, bIn + j, tIn + j, tIn + nj]);     // inner wall
        faces.push([tOut + j, tOut + nj, tIn + nj, tIn + j]);   // top rim
        faces.push([bIn + j, bIn + nj, bOut + nj, bOut + j]);   // bottom rim
      }
      return { vertices, faces, shadeSmooth: false };
    }

    case 'ring': {
      const segs = 24;
      const rOut = 1.1;
      const rIn = 0.55;
      const hz = 0.16;
      const vertices: [number, number, number][] = [];
      for (const z of [-hz, hz]) {
        for (const r of [rOut, rIn]) {
          for (let j = 0; j < segs; j++) {
            const th = (2 * Math.PI * j) / segs;
            vertices.push([r * Math.cos(th), r * Math.sin(th), z]);
          }
        }
      }
      const bOut = 0, bIn = segs, tOut = 2 * segs, tIn = 3 * segs;
      const faces: number[][] = [];
      for (let j = 0; j < segs; j++) {
        const nj = (j + 1) % segs;
        faces.push([bOut + j, bOut + nj, tOut + nj, tOut + j]);
        faces.push([bIn + nj, bIn + j, tIn + j, tIn + nj]);
        faces.push([tOut + j, tOut + nj, tIn + nj, tIn + j]);
        faces.push([bIn + j, bIn + nj, bOut + nj, bOut + j]);
      }
      return { vertices, faces, shadeSmooth: false };
    }

    case 'arch': {
      // 2D arch contour in XZ plane extruded along Y!
      const pts: [number, number][] = [
        [-1.2, -1.0],
        [-0.7, -1.0]
      ];
      const archSegs = 12;
      for (let i = 0; i <= archSegs; i++) {
        const a = Math.PI - (Math.PI * i) / archSegs;
        pts.push([0.7 * Math.cos(a), -0.2 + 0.7 * Math.sin(a)]);
      }
      pts.push([0.7, -1.0], [1.2, -1.0], [1.2, 0.9], [-1.2, 0.9]);
      const ext = createExtrudedPolygonMesh(pts, 0.8, false);
      // Rotate from XY extrusion to XZ upright arch
      for (const v of ext.vertices) {
        const y = v[1];
        const z = v[2];
        v[1] = -z;
        v[2] = y;
      }
      return ext;
    }

    case 'stairs': {
      const steps = 6;
      const pts: [number, number][] = [[-1.2, -1.0], [1.2, -1.0]];
      for (let s = 0; s < steps; s++) {
        const x0 = 1.2 - (2.4 * s) / steps;
        const x1 = 1.2 - (2.4 * (s + 1)) / steps;
        const zTop = -1.0 + (2.0 * (s + 1)) / steps;
        pts.push([x0, zTop], [x1, zTop]);
      }
      const ext = createExtrudedPolygonMesh(pts, 1.8, false);
      for (const v of ext.vertices) {
        const y = v[1];
        const z = v[2];
        v[1] = -z;
        v[2] = y;
      }
      return ext;
    }

    case 'star': {
      const pts: [number, number][] = [];
      const spikes = 5;
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? 1.15 : 0.48;
        const a = (Math.PI * i) / spikes - Math.PI / 2;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return createExtrudedPolygonMesh(pts, 0.45, false);
    }

    case 'gear': {
      const teeth = 10;
      const pts: [number, number][] = [];
      for (let i = 0; i < teeth * 4; i++) {
        const phase = i % 4;
        const r = phase === 1 || phase === 2 ? 1.12 : 0.84;
        const a = (2 * Math.PI * i) / (teeth * 4);
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return createExtrudedPolygonMesh(pts, 0.4, false);
    }

    case 'crystal': {
      return createLatheMesh(
        [
          [0.002, -1.35],
          [0.58, -0.55],
          [0.65, 0.55],
          [0.002, 1.35]
        ],
        6,
        false
      );
    }

    case 'heart': {
      const pts: [number, number][] = [];
      const n = 32;
      for (let i = 0; i < n; i++) {
        const t = (2 * Math.PI * i) / n;
        const x = 16 * Math.pow(Math.sin(t), 3);
        const y =
          13 * Math.cos(t) -
          5 * Math.cos(2 * t) -
          2 * Math.cos(3 * t) -
          Math.cos(4 * t);
        pts.push([x * 0.068, y * 0.068]);
      }
      return createExtrudedPolygonMesh(pts, 0.48, true);
    }

    case 'torus_knot': {
      const tkGeo = new THREE.TorusKnotGeometry(0.82, 0.24, 64, 10);
      const mesh = threeGeometryToEditableMesh(tkGeo, false);
      mesh.shadeSmooth = true;
      return mesh;
    }

    case 'uv_sphere': {
      const segs = 20;
      const rings = 12;
      const r = 1;
      const vertices: [number, number, number][] = [];
      const faces: number[][] = [];
      vertices.push([0, 0, r]);
      for (let i = 1; i < rings; i++) {
        const phi = (Math.PI * i) / rings;
        const z = r * Math.cos(phi);
        const sinPhi = r * Math.sin(phi);
        for (let j = 0; j < segs; j++) {
          const theta = (2 * Math.PI * j) / segs;
          vertices.push([sinPhi * Math.cos(theta), sinPhi * Math.sin(theta), z]);
        }
      }
      vertices.push([0, 0, -r]);
      const bottomIdx = vertices.length - 1;
      for (let j = 0; j < segs; j++) {
        faces.push([0, 1 + j, 1 + ((j + 1) % segs)]);
      }
      for (let i = 0; i < rings - 2; i++) {
        const rowA = 1 + i * segs;
        const rowB = 1 + (i + 1) * segs;
        for (let j = 0; j < segs; j++) {
          const next = (j + 1) % segs;
          faces.push([rowA + j, rowB + j, rowB + next, rowA + next]);
        }
      }
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
      return subdivideTrianglesSphere({ vertices, faces, shadeSmooth: false });
    }

    case 'cone': {
      const segs = 20;
      const r = 1;
      const vertices: [number, number, number][] = [[0, 0, 1]];
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
      vertices.push([0, 0, halfCyl + r]);
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
      let head = catmullClarkSubdivide(createPrimitiveMesh('cube'), 2);
      for (const v of head.vertices) {
        v[0] *= 0.88;
        v[1] *= 0.82;
        v[2] *= 0.88;
        if (v[1] < -0.35 && v[2] > 0.15 && v[2] < 0.55) {
          v[1] -= 0.25;
        }
        if (v[1] < -0.35 && v[2] < 0.05 && Math.abs(v[0]) < 0.52) {
          v[1] -= 0.42;
          v[2] -= 0.08;
        }
      }
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

function makeNGonCylinder(
  segs: number,
  r: number,
  depth: number,
  shadeSmooth: boolean
): EditableMeshData {
  const h = depth * 0.5;
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
  return { vertices, faces, shadeSmooth };
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
    if (current.faces.length > 6000) break;
    const V = current.vertices;
    const F = current.faces;

    const facePoints: [number, number, number][] = F.map((f) => computeFaceCenter(V, f));

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

    const newVerts: [number, number, number][] = V.map((orig, vIdx) => {
      const adjF = vertFaces[vIdx];
      const adjE = vertEdges[vIdx];
      const n = adjE.length;
      if (n === 0 || adjF.length === 0) return [...orig];

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

      let fx = 0, fy = 0, fz = 0;
      for (const fi of adjF) {
        fx += facePoints[fi][0];
        fy += facePoints[fi][1];
        fz += facePoints[fi][2];
      }
      fx /= adjF.length;
      fy /= adjF.length;
      fz /= adjF.length;

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
    for (const fp of facePoints) newVerts.push(fp);

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
      if (out.vertexColors && out.vertexColors[vIdx]) {
        out.vertexColors.push([...out.vertexColors[vIdx]]);
      }
      return nIdx;
    });

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
      if (out.vertexColors && out.vertexColors[vIdx]) {
        out.vertexColors.push([...out.vertexColors[vIdx]]);
      }
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

export function bevelFaces(
  mesh: EditableMeshData,
  faceIndices: number[],
  amount = 0.18
): { mesh: EditableMeshData; newFaceIndices: number[] } {
  const target = faceIndices.length > 0 ? faceIndices : mesh.faces.map((_, idx) => idx);
  return insetFaces(mesh, target, Math.min(0.45, amount), amount * 0.45);
}

export function loopCutAxis(mesh: EditableMeshData, axis: 0 | 1 | 2 = 2): EditableMeshData {
  const out = cloneMeshData(mesh);
  let minV = Infinity;
  let maxV = -Infinity;
  for (const v of out.vertices) {
    if (v[axis] < minV) minV = v[axis];
    if (v[axis] > maxV) maxV = v[axis];
  }
  const planeVal = (minV + maxV) * 0.5;
  return bisectMeshInternal(out, axis, planeVal, 'both', false).combined;
}

/** Slices / Cuts a 3D mesh across X, Y, or Z = planeVal, optionally capping the cut cross-section! */
export function sliceMeshByPlane(
  mesh: EditableMeshData,
  axis: 0 | 1 | 2 = 2,
  planeVal = 0,
  keep: 'positive' | 'negative' = 'positive',
  capCut = true
): EditableMeshData {
  const res = bisectMeshInternal(mesh, axis, planeVal, keep, capCut);
  return keep === 'positive' ? res.posMesh : res.negMesh;
}

/** Splits a 3D mesh into TWO separate capped meshes along an axis plane! */
export function splitMeshInTwo(
  mesh: EditableMeshData,
  axis: 0 | 1 | 2 = 0,
  planeVal = 0
): { positive: EditableMeshData; negative: EditableMeshData } {
  const res = bisectMeshInternal(mesh, axis, planeVal, 'both', true);
  return { positive: res.posMesh, negative: res.negMesh };
}

function bisectMeshInternal(
  mesh: EditableMeshData,
  axis: 0 | 1 | 2,
  planeVal: number,
  mode: 'positive' | 'negative' | 'both',
  capCut: boolean
): {
  combined: EditableMeshData;
  posMesh: EditableMeshData;
  negMesh: EditableMeshData;
} {
  const verts = mesh.vertices.map((v) => [...v] as [number, number, number]);
  const eps = 1e-4;
  const edgeCutCache = new Map<string, number>();
  const cutIndices = new Set<number>();

  const getCutVert = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const hit = edgeCutCache.get(key);
    if (hit !== undefined) return hit;
    const va = verts[a];
    const vb = verts[b];
    const denom = vb[axis] - va[axis];
    const t = Math.abs(denom) < 1e-6 ? 0.5 : (planeVal - va[axis]) / denom;
    const idx = verts.length;
    verts.push([
      va[0] + (vb[0] - va[0]) * t,
      va[1] + (vb[1] - va[1]) * t,
      va[2] + (vb[2] - va[2]) * t
    ]);
    edgeCutCache.set(key, idx);
    cutIndices.add(idx);
    return idx;
  };

  const posFaces: number[][] = [];
  const negFaces: number[][] = [];
  const combinedFaces: number[][] = [];

  for (const f of mesh.faces) {
    const polyNeg: number[] = [];
    const polyPos: number[] = [];
    for (let i = 0; i < f.length; i++) {
      const curr = f[i];
      const next = f[(i + 1) % f.length];
      const dc = verts[curr][axis] - planeVal;
      const dn = verts[next][axis] - planeVal;

      if (dc <= eps) {
        polyNeg.push(curr);
        if (Math.abs(dc) <= eps) cutIndices.add(curr);
      }
      if (dc >= -eps) {
        polyPos.push(curr);
        if (Math.abs(dc) <= eps) cutIndices.add(curr);
      }

      if ((dc < -eps && dn > eps) || (dc > eps && dn < -eps)) {
        const cutIdx = getCutVert(curr, next);
        polyNeg.push(cutIdx);
        polyPos.push(cutIdx);
      }
    }

    if (polyNeg.length >= 3) {
      negFaces.push(polyNeg);
      combinedFaces.push(polyNeg);
    }
    if (polyPos.length >= 3) {
      posFaces.push(polyPos);
      combinedFaces.push(polyPos);
    }
  }

  // Cap cross-section polygon by angle sorting cut vertices around centroid
  if (capCut && cutIndices.size >= 3) {
    const cList = [...cutIndices];
    let cx = 0, cy = 0, cz = 0;
    for (const i of cList) {
      cx += verts[i][0];
      cy += verts[i][1];
      cz += verts[i][2];
    }
    cx /= cList.length;
    cy /= cList.length;
    cz /= cList.length;

    const uAx = ((axis + 1) % 3) as 0 | 1 | 2;
    const vAx = ((axis + 2) % 3) as 0 | 1 | 2;
    const cU = axis === 0 ? cy : axis === 1 ? cz : cx;
    const cV = axis === 0 ? cz : axis === 1 ? cx : cy;

    cList.sort((ia, ib) => {
      const angA = Math.atan2(verts[ia][vAx] - cV, verts[ia][uAx] - cU);
      const angB = Math.atan2(verts[ib][vAx] - cV, verts[ib][uAx] - cU);
      return angA - angB;
    });

    // Pos cap normal should point in -axis; Neg cap normal should point in +axis
    negFaces.push([...cList]);
    posFaces.push([...cList].reverse());
  }

  void mode;
  return {
    combined: { vertices: verts, faces: combinedFaces, shadeSmooth: mesh.shadeSmooth },
    posMesh: compactMesh({ vertices: verts.map((v) => [...v]), faces: posFaces, shadeSmooth: mesh.shadeSmooth }),
    negMesh: compactMesh({ vertices: verts.map((v) => [...v]), faces: negFaces, shadeSmooth: mesh.shadeSmooth })
  };
}

/** Removes unreferenced vertices after slicing or deleting faces */
export function compactMesh(mesh: EditableMeshData): EditableMeshData {
  const remap = new Map<number, number>();
  const newVerts: [number, number, number][] = [];
  const newCols: [number, number, number][] = [];
  const hasCols = Boolean(mesh.vertexColors && mesh.vertexColors.length === mesh.vertices.length);

  const newFaces: number[][] = [];
  for (const f of mesh.faces) {
    const nf: number[] = [];
    for (const vi of f) {
      let mapped = remap.get(vi);
      if (mapped === undefined) {
        mapped = newVerts.length;
        remap.set(vi, mapped);
        const orig = mesh.vertices[vi] || [0, 0, 0];
        newVerts.push([orig[0], orig[1], orig[2]]);
        if (hasCols) newCols.push([...mesh.vertexColors![vi]]);
      }
      nf.push(mapped);
    }
    if (nf.length >= 3) newFaces.push(nf);
  }

  return {
    vertices: newVerts,
    faces: newFaces,
    vertexColors: hasCols ? newCols : undefined,
    shadeSmooth: mesh.shadeSmooth
  };
}

/** Separates disconnected face islands into independent meshes */
export function separateLooseParts(mesh: EditableMeshData): EditableMeshData[] {
  if (mesh.faces.length <= 1) return [cloneMeshData(mesh)];
  const vertToFaces = new Map<number, number[]>();
  mesh.faces.forEach((f, fi) => {
    for (const vi of f) {
      let arr = vertToFaces.get(vi);
      if (!arr) {
        arr = [];
        vertToFaces.set(vi, arr);
      }
      arr.push(fi);
    }
  });

  const visited = new Uint8Array(mesh.faces.length);
  const parts: EditableMeshData[] = [];

  for (let i = 0; i < mesh.faces.length; i++) {
    if (visited[i]) continue;
    const queue = [i];
    visited[i] = 1;
    const islandFaces: number[][] = [];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      const f = mesh.faces[cur];
      islandFaces.push([...f]);
      for (const vi of f) {
        const neighbors = vertToFaces.get(vi) || [];
        for (const nb of neighbors) {
          if (!visited[nb]) {
            visited[nb] = 1;
            queue.push(nb);
          }
        }
      }
    }
    parts.push(
      compactMesh({
        vertices: mesh.vertices,
        faces: islandFaces,
        vertexColors: mesh.vertexColors,
        shadeSmooth: mesh.shadeSmooth
      })
    );
  }
  return parts;
}

export function displaceMeshNoise(
  mesh: EditableMeshData,
  strength = 0.25,
  freq = 2.4
): EditableMeshData {
  const out = cloneMeshData(mesh);
  const normals = computeVertexNormals(out);
  out.vertices.forEach((v, i) => {
    const n =
      Math.sin(v[0] * freq + 1.1) *
      Math.cos(v[1] * freq - 0.7) *
      Math.sin(v[2] * freq + 0.3);
    v[0] += normals[i][0] * n * strength;
    v[1] += normals[i][1] * n * strength;
    v[2] += normals[i][2] * n * strength;
  });
  return out;
}

export function taperMeshZ(mesh: EditableMeshData, topScale = 0.35): EditableMeshData {
  const out = cloneMeshData(mesh);
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of out.vertices) {
    if (v[2] < minZ) minZ = v[2];
    if (v[2] > maxZ) maxZ = v[2];
  }
  const span = Math.max(0.001, maxZ - minZ);
  for (const v of out.vertices) {
    const t = (v[2] - minZ) / span;
    const s = 1 + (topScale - 1) * t;
    v[0] *= s;
    v[1] *= s;
  }
  return out;
}

export function deleteFaces(mesh: EditableMeshData, faceIndices: number[]): EditableMeshData {
  const out = cloneMeshData(mesh);
  if (faceIndices.length === 0) return out;
  const drop = new Set(faceIndices);
  out.faces = out.faces.filter((_, i) => !drop.has(i));
  return compactMesh(out);
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
        const edgeCount = new Map<string, [number, number]>();
        for (const f of origFaces) {
          for (let i = 0; i < f.length; i++) {
            const a = f[i];
            const b = f[(i + 1) % f.length];
            const key = a < b ? `${a}_${b}` : `${b}_${a}`;
            if (edgeCount.has(key)) edgeCount.delete(key);
            else edgeCount.set(key, [a, b]);
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

/** Computes bounding-box-normalized UV coordinates for any vertex & face normal (PBR & universal 3D ready) */
export function computeProjectedUV(
  v: [number, number, number],
  fn: [number, number, number],
  bounds: { min: [number, number, number]; span: [number, number, number] },
  mode: UVProjectionMode = 'box',
  repeatX = 1,
  repeatY = 1
): [number, number] {
  const nx = (v[0] - bounds.min[0]) / bounds.span[0];
  const ny = (v[1] - bounds.min[1]) / bounds.span[1];
  const nz = (v[2] - bounds.min[2]) / bounds.span[2];

  let u = 0;
  let w = 0;

  if (mode === 'planar') {
    u = nx;
    w = ny;
  } else if (mode === 'spherical') {
    const cx = nx - 0.5;
    const cy = ny - 0.5;
    const cz = nz - 0.5;
    const r = Math.hypot(cx, cy, cz) || 1;
    u = 0.5 + Math.atan2(cy, cx) / (2 * Math.PI);
    w = 0.5 + Math.asin(Math.max(-1, Math.min(1, cz / r))) / Math.PI;
  } else if (mode === 'cylindrical') {
    const cx = nx - 0.5;
    const cy = ny - 0.5;
    u = 0.5 + Math.atan2(cy, cx) / (2 * Math.PI);
    w = nz;
  } else {
    // Smart Box / Triplanar projection based on dominant face normal axis
    const ax = Math.abs(fn[0]);
    const ay = Math.abs(fn[1]);
    const az = Math.abs(fn[2]);
    if (az >= ax && az >= ay) {
      u = fn[2] >= 0 ? nx : 1 - nx;
      w = ny;
    } else if (ax >= ay) {
      u = fn[0] >= 0 ? ny : 1 - ny;
      w = nz;
    } else {
      u = fn[1] >= 0 ? 1 - nx : nx;
      w = nz;
    }
  }

  return [u * repeatX, w * repeatY];
}

export function computeMeshBounds(mesh: EditableMeshData): {
  min: [number, number, number];
  max: [number, number, number];
  span: [number, number, number];
} {
  if (mesh.vertices.length === 0) {
    return { min: [-1, -1, -1], max: [1, 1, 1], span: [2, 2, 2] };
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const v of mesh.vertices) {
    for (let k = 0; k < 3; k++) {
      if (v[k] < min[k]) min[k] = v[k];
      if (v[k] > max[k]) max[k] = v[k];
    }
  }
  return {
    min,
    max,
    span: [
      Math.max(1e-4, max[0] - min[0]),
      Math.max(1e-4, max[1] - min[1]),
      Math.max(1e-4, max[2] - min[2])
    ]
  };
}

export interface BuiltThreeGeometries {
  surfaceGeometry: THREE.BufferGeometry;
  polygonWireGeometry: THREE.BufferGeometry;
  triangleToFaceIndex: number[];
}

export function buildThreeGeometries(
  mesh: EditableMeshData,
  uvMode: UVProjectionMode = 'box',
  repeatX = 1,
  repeatY = 1
): BuiltThreeGeometries {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const triangleToFaceIndex: number[] = [];

  const smoothNormals = mesh.shadeSmooth ? computeVertexNormals(mesh) : null;
  const hasVertexColors = Boolean(
    mesh.vertexColors && mesh.vertexColors.length === mesh.vertices.length
  );
  const bounds = computeMeshBounds(mesh);

  mesh.faces.forEach((face, fIdx) => {
    if (face.length < 3) return;
    const fn = computeFaceNormal(mesh.vertices, face);
    for (let i = 1; i < face.length - 1; i++) {
      const tri = [face[0], face[i], face[i + 1]];
      for (const vIdx of tri) {
        const v = mesh.vertices[vIdx] || [0, 0, 0];
        positions.push(v[0], v[1], v[2]);
        const n = smoothNormals ? smoothNormals[vIdx] : fn;
        normals.push(n[0], n[1], n[2]);
        const vc = hasVertexColors ? mesh.vertexColors![vIdx] : [1, 1, 1];
        colors.push(vc[0], vc[1], vc[2]);
        const [u, w] = computeProjectedUV(v, fn, bounds, uvMode, repeatX, repeatY);
        uvs.push(u, w);
      }
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
