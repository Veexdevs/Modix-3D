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
