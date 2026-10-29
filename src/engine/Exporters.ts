import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { AMFLoader } from 'three/examples/jsm/loaders/AMFLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { EditableMeshData, MaterialData, ModixProjectState, SceneObjectData } from '../types/scene';
import {
  computeFaceNormal,
  computeMeshBounds,
  computeProjectedUV,
  computeVertexNormals,
  evaluateMeshWithModifiers,
  threeGeometryToEditableMesh
} from './MeshOperations';

export interface OBJExportOptions {
  /** Convert Z-up internal coordinates -> standard right-handed Y-up (default: true) */
  yUp?: boolean;
  /** Uniform scale multiplier */
  scale?: number;
  /** Triangulate all quads/n-gons for universal 3D importer compatibility (default: true) */
  triangulate?: boolean;
  /** Merge all visible meshes into one combined mesh object if true */
  combineMeshes?: boolean;
  /** Base filename for mtllib header */
  mtlFileName?: string;
}

function sanitizeObjName(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9_.-]+/g, '_') || 'Mesh';
}

function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '8');
  const num = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(num)) return [0.8, 0.8, 0.8];
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

/**
 * Exports scene objects to universal Wavefront .OBJ with full UV coordinates (vt),
 * outward vertex/face normals (vn), materials (usemtl), and standard right-handed Y-up orientation.
 */
export function exportSceneToOBJ(objects: SceneObjectData[], opts: OBJExportOptions = {}): string {
  const yUp = opts.yUp !== false;
  const scale = opts.scale ?? 1;
  const triangulate = opts.triangulate !== false;
  const combine = opts.combineMeshes ?? false;
  const mtlName = opts.mtlFileName || 'modix-export.mtl';

  const lines: string[] = [
    '# Modix 3D Wavefront OBJ Export',
    '# Coordinate System: ' + (yUp ? 'Y-Up Right-Handed' : 'Z-Up Right-Handed'),
    `mtllib ${mtlName}`,
    ''
  ];

  let vOffset = 1;
  let vtOffset = 1;
  let vnOffset = 1;

  if (combine) {
    lines.push('o ModixCombinedMesh');
  }

  const vVec = new THREE.Vector3();

  const mapPoint = (x: number, y: number, z: number): [number, number, number] => {
    if (yUp) {
      // Rx(-90 deg): (x, y, z)_Zup -> (x, z, -y)_Yup, det = +1 (preserves CCW outward winding)
      return [x * scale, z * scale, -y * scale];
    }
    return [x * scale, y * scale, z * scale];
  };

  const mapDir = (nx: number, ny: number, nz: number): [number, number, number] => {
    if (yUp) {
      return [nx, nz, -ny];
    }
    return [nx, ny, nz];
  };

  for (const obj of objects) {
    if (obj.kind !== 'MESH' || !obj.mesh || !obj.visible) continue;
    const evaluated = evaluateMeshWithModifiers(obj.mesh, obj.modifiers);
    if (evaluated.vertices.length === 0 || evaluated.faces.length === 0) continue;

    const safeName = sanitizeObjName(obj.name);
    if (!combine) {
      lines.push(`o ${safeName}`);
      lines.push(`g ${safeName}`);
    }
    lines.push(`usemtl Mat_${safeName}`);
    lines.push(evaluated.shadeSmooth ? 's 1' : 's off');

    const mat = composeObjectMatrix(obj);
    const localBounds = computeMeshBounds(evaluated);
    const projMode = obj.material.uvProjection ?? 'box';
    const repX = obj.material.repeatX ?? 1;
    const repY = obj.material.repeatY ?? 1;

    const worldVerts: [number, number, number][] = [];
    for (const [lx, ly, lz] of evaluated.vertices) {
      vVec.set(lx, ly, lz).applyMatrix4(mat);
      const [wx, wy, wz] = mapPoint(vVec.x, vVec.y, vVec.z);
      worldVerts.push([wx, wy, wz]);
      lines.push(`v ${wx.toFixed(6)} ${wy.toFixed(6)} ${wz.toFixed(6)}`);
    }

    const smoothNormals = evaluated.shadeSmooth
      ? computeVertexNormals({ vertices: worldVerts, faces: evaluated.faces, shadeSmooth: true })
      : null;

    let smoothVnBase = vnOffset;
    if (smoothNormals) {
      for (const [nx, ny, nz] of smoothNormals) {
        lines.push(`vn ${nx.toFixed(6)} ${ny.toFixed(6)} ${nz.toFixed(6)}`);
        vnOffset++;
      }
    }

    for (const f of evaluated.faces) {
      if (f.length < 3) continue;
      const localNormal = computeFaceNormal(evaluated.vertices, f);
      let flatVn = 0;
      if (!smoothNormals) {
        const worldNormal = computeFaceNormal(worldVerts, f);
        const nLen = Math.hypot(worldNormal[0], worldNormal[1], worldNormal[2]);
        const [nx, ny, nz] =
          nLen > 1e-7 ? worldNormal : mapDir(localNormal[0], localNormal[1], localNormal[2]);
        lines.push(`vn ${nx.toFixed(6)} ${ny.toFixed(6)} ${nz.toFixed(6)}`);
        flatVn = vnOffset++;
      }

      const cornerVts: number[] = [];
      for (const vi of f) {
        const lv = evaluated.vertices[vi] || [0, 0, 0];
        const [u, v] = computeProjectedUV(lv, localNormal, localBounds, projMode, repX, repY);
        lines.push(`vt ${u.toFixed(6)} ${v.toFixed(6)}`);
        cornerVts.push(vtOffset++);
      }

      if (triangulate) {
        for (let i = 1; i < f.length - 1; i++) {
          const idx0 = f[0];
          const idx1 = f[i];
          const idx2 = f[i + 1];
          const v0i = idx0 + vOffset;
          const v1i = idx1 + vOffset;
          const v2i = idx2 + vOffset;
          const t0 = cornerVts[0];
          const t1 = cornerVts[i];
          const t2 = cornerVts[i + 1];
          const n0 = smoothNormals ? smoothVnBase + idx0 : flatVn;
          const n1 = smoothNormals ? smoothVnBase + idx1 : flatVn;
          const n2 = smoothNormals ? smoothVnBase + idx2 : flatVn;
          lines.push(`f ${v0i}/${t0}/${n0} ${v1i}/${t1}/${n1} ${v2i}/${t2}/${n2}`);
        }
      } else {
        const tokens = f.map((vi, idx) => {
          const nIdx = smoothNormals ? smoothVnBase + vi : flatVn;
          return `${vi + vOffset}/${cornerVts[idx]}/${nIdx}`;
        });
        lines.push(`f ${tokens.join(' ')}`);
      }
    }

    void smoothVnBase;
    vOffset += evaluated.vertices.length;
    lines.push('');
  }

  return lines.join('\n');
}

export function exportSceneToMTL(
  objects: SceneObjectData[],
  textureFileMap?: Map<string, string>
): string {
  const lines: string[] = ['# Modix 3D Material Library (.mtl)', ''];
  const seen = new Set<string>();
  for (const obj of objects) {
    if (obj.kind !== 'MESH' || !obj.mesh || !obj.visible) continue;
    const safeName = sanitizeObjName(obj.name);
    if (seen.has(safeName)) continue;
    seen.add(safeName);

    const [r, g, b] = hexToRgb01(obj.material.baseColor || '#cccccc');
    const [er, eg, eb] = hexToRgb01(obj.material.emissionColor || '#000000');
    const roughness = obj.material.roughness ?? 0.45;
    const ns = Math.max(1, Math.min(900, (1 - roughness) * 500));

    lines.push(`newmtl Mat_${safeName}`);
    lines.push(`Ka ${(r * 0.2).toFixed(4)} ${(g * 0.2).toFixed(4)} ${(b * 0.2).toFixed(4)}`);
    lines.push(`Kd ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}`);
    lines.push('Ks 0.2500 0.2500 0.2500');
    if ((obj.material.emissionStrength ?? 0) > 0) {
      const es = Math.min(1, obj.material.emissionStrength);
      lines.push(`Ke ${(er * es).toFixed(4)} ${(eg * es).toFixed(4)} ${(eb * es).toFixed(4)}`);
    }
    lines.push(`Ns ${ns.toFixed(2)}`);
    lines.push(`d ${(obj.material.opacity ?? 1).toFixed(4)}`);
    lines.push('illum 2');
    const texFile = textureFileMap?.get(obj.id);
    if (texFile) {
      lines.push(`map_Kd ${texFile}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Exports watertight Binary STL (standard Z-up CAD / 3D Slicer format) */
export function exportSceneToBinarySTL(objects: SceneObjectData[]): ArrayBuffer {
  const triangles: {
    n: [number, number, number];
    a: [number, number, number];
    b: [number, number, number];
    c: [number, number, number];
  }[] = [];
  const v0 = new THREE.Vector3();

  for (const obj of objects) {
    if (obj.kind !== 'MESH' || !obj.mesh || !obj.visible) continue;
    const evaluated = evaluateMeshWithModifiers(obj.mesh, obj.modifiers);
    const mat = composeObjectMatrix(obj);
    const transformed: [number, number, number][] = evaluated.vertices.map(([x, y, z]) => {
      v0.set(x, y, z).applyMatrix4(mat);
      return [v0.x, v0.y, v0.z];
    });

    for (const f of evaluated.faces) {
      if (f.length < 3) continue;
      for (let i = 1; i < f.length - 1; i++) {
        const a = transformed[f[0]];
        const b = transformed[f[i]];
        const c = transformed[f[i + 1]];
        const n = computeFaceNormal([a, b, c], [0, 1, 2]);
        triangles.push({ n, a, b, c });
      }
    }
  }

  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const dv = new DataView(buffer);
  const header = 'Modix 3D Binary STL Export';
  for (let i = 0; i < 80; i++) {
    dv.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  }
  dv.setUint32(80, triangles.length, true);

  let offset = 84;
  for (const t of triangles) {
    dv.setFloat32(offset, t.n[0], true);
    dv.setFloat32(offset + 4, t.n[1], true);
    dv.setFloat32(offset + 8, t.n[2], true);
    offset += 12;
    for (const pt of [t.a, t.b, t.c]) {
      dv.setFloat32(offset, pt[0], true);
      dv.setFloat32(offset + 4, pt[1], true);
      dv.setFloat32(offset + 8, pt[2], true);
      offset += 12;
    }
    dv.setUint16(offset, 0, true);
    offset += 2;
  }

  return buffer;
}

export function exportSceneToSTL(objects: SceneObjectData[]): string {
  const lines: string[] = ['solid Modix3D'];
  const v0 = new THREE.Vector3();

  for (const obj of objects) {
    if (obj.kind !== 'MESH' || !obj.mesh || !obj.visible) continue;
    const evaluated = evaluateMeshWithModifiers(obj.mesh, obj.modifiers);
    const mat = composeObjectMatrix(obj);
    const transformed: [number, number, number][] = evaluated.vertices.map(([x, y, z]) => {
      v0.set(x, y, z).applyMatrix4(mat);
      return [v0.x, v0.y, v0.z];
    });

    for (const f of evaluated.faces) {
      if (f.length < 3) continue;
      for (let i = 1; i < f.length - 1; i++) {
        const a = transformed[f[0]];
        const b = transformed[f[i]];
        const c = transformed[f[i + 1]];
        const n = computeFaceNormal([a, b, c], [0, 1, 2]);
        lines.push(`  facet normal ${n[0].toFixed(6)} ${n[1].toFixed(6)} ${n[2].toFixed(6)}`);
        lines.push('    outer loop');
        lines.push(`      vertex ${a[0].toFixed(6)} ${a[1].toFixed(6)} ${a[2].toFixed(6)}`);
        lines.push(`      vertex ${b[0].toFixed(6)} ${b[1].toFixed(6)} ${b[2].toFixed(6)}`);
        lines.push(`      vertex ${c[0].toFixed(6)} ${c[1].toFixed(6)} ${c[2].toFixed(6)}`);
        lines.push('    endloop');
        lines.push('  endfacet');
      }
    }
  }
  lines.push('endsolid Modix3D');
  return lines.join('\n');
}

/** Exports Stanford Polygon (.PLY) with Y-up coordinates, unit normals, UVs, and RGB vertex colors */
export function exportSceneToPLY(objects: SceneObjectData[]): string {
  const verts: {
    x: number;
    y: number;
    z: number;
    nx: number;
    ny: number;
    nz: number;
    s: number;
    t: number;
    r: number;
    g: number;
    b: number;
  }[] = [];
  const tris: [number, number, number][] = [];
  const v0 = new THREE.Vector3();

  for (const obj of objects) {
    if (obj.kind !== 'MESH' || !obj.mesh || !obj.visible) continue;
    const evaluated = evaluateMeshWithModifiers(obj.mesh, obj.modifiers);
    if (evaluated.vertices.length === 0 || evaluated.faces.length === 0) continue;

    const mat = composeObjectMatrix(obj);
    const [cr, cg, cb] = hexToRgb01(obj.material.baseColor || '#cccccc');
    const localBounds = computeMeshBounds(evaluated);
    const projMode = obj.material.uvProjection ?? 'box';
    const repX = obj.material.repeatX ?? 1;
    const repY = obj.material.repeatY ?? 1;
    const hasVC = Boolean(
      evaluated.vertexColors && evaluated.vertexColors.length === evaluated.vertices.length
    );

    const worldYUp: [number, number, number][] = evaluated.vertices.map(([lx, ly, lz]) => {
      v0.set(lx, ly, lz).applyMatrix4(mat);
      return [v0.x, v0.z, -v0.y];
    });
    const vNormals = computeVertexNormals({
      vertices: worldYUp,
      faces: evaluated.faces,
      shadeSmooth: true
    });
    const localNormals = computeVertexNormals(evaluated);

    const baseOffset = verts.length;
    evaluated.vertices.forEach((lv, idx) => {
      const [wx, wy, wz] = worldYUp[idx];
      const [nx, ny, nz] = vNormals[idx];
      const [u, v] = computeProjectedUV(lv, localNormals[idx], localBounds, projMode, repX, repY);
      const vc = hasVC ? evaluated.vertexColors![idx] : [1, 1, 1];
      verts.push({
        x: wx,
        y: wy,
        z: wz,
        nx,
        ny,
        nz,
        s: u,
        t: v,
        r: Math.max(0, Math.min(255, Math.round(cr * vc[0] * 255))),
        g: Math.max(0, Math.min(255, Math.round(cg * vc[1] * 255))),
        b: Math.max(0, Math.min(255, Math.round(cb * vc[2] * 255)))
      });
    });

    for (const f of evaluated.faces) {
      if (f.length < 3) continue;
      for (let i = 1; i < f.length - 1; i++) {
        tris.push([baseOffset + f[0], baseOffset + f[i], baseOffset + f[i + 1]]);
      }
    }
  }

  const lines: string[] = [
    'ply',
    'format ascii 1.0',
    'comment Exported by Modix 3D',
    `element vertex ${verts.length}`,
    'property float x',
    'property float y',
    'property float z',
    'property float nx',
    'property float ny',
    'property float nz',
    'property float s',
    'property float t',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    `element face ${tris.length}`,
    'property list uchar int vertex_indices',
    'end_header'
  ];

  for (const v of verts) {
    lines.push(
      `${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)} ${v.nx.toFixed(5)} ${v.ny.toFixed(5)} ${v.nz.toFixed(5)} ${v.s.toFixed(5)} ${v.t.toFixed(5)} ${v.r} ${v.g} ${v.b}`
    );
  }
  for (const [a, b, c] of tris) {
    lines.push(`3 ${a} ${b} ${c}`);
  }
  return lines.join('\n');
}

/** Exports COLLADA 1.4.1 (.DAE) with Y_UP axis, positions, normals, UVs, and Phong materials */
export function exportSceneToDAE(objects: SceneObjectData[]): string {
  const geomXml: string[] = [];
  const nodeXml: string[] = [];
  const matXml: string[] = [];
  const effectXml: string[] = [];
  const v0 = new THREE.Vector3();

  let meshIdx = 0;
  for (const obj of objects) {
    if (obj.kind !== 'MESH' || !obj.mesh || !obj.visible) continue;
    const evaluated = evaluateMeshWithModifiers(obj.mesh, obj.modifiers);
    if (evaluated.vertices.length === 0 || evaluated.faces.length === 0) continue;

    const id = `mesh_${meshIdx++}`;
    const matId = `mat_${id}`;
    const fxId = `fx_${id}`;
    const mat = composeObjectMatrix(obj);
    const [r, g, b] = hexToRgb01(obj.material.baseColor);
    const localBounds = computeMeshBounds(evaluated);
    const projMode = obj.material.uvProjection ?? 'box';
    const repX = obj.material.repeatX ?? 1;
    const repY = obj.material.repeatY ?? 1;

    const worldYUp: [number, number, number][] = evaluated.vertices.map(([lx, ly, lz]) => {
      v0.set(lx, ly, lz).applyMatrix4(mat);
      return [v0.x, v0.z, -v0.y];
    });
    const worldNormals = computeVertexNormals({
      vertices: worldYUp,
      faces: evaluated.faces,
      shadeSmooth: Boolean(evaluated.shadeSmooth)
    });
    const localNormals = computeVertexNormals(evaluated);

    const posFloats: string[] = [];
    const normFloats: string[] = [];
    const uvFloats: string[] = [];

    evaluated.vertices.forEach((lv, idx) => {
      const [wx, wy, wz] = worldYUp[idx];
      const [nx, ny, nz] = worldNormals[idx];
      const [u, w] = computeProjectedUV(lv, localNormals[idx], localBounds, projMode, repX, repY);
      posFloats.push(wx.toFixed(5), wy.toFixed(5), wz.toFixed(5));
      normFloats.push(nx.toFixed(5), ny.toFixed(5), nz.toFixed(5));
      uvFloats.push(u.toFixed(5), w.toFixed(5));
    });

    const pIndices: number[] = [];
    let triCount = 0;
    for (const f of evaluated.faces) {
      if (f.length < 3) continue;
      for (let i = 1; i < f.length - 1; i++) {
        for (const vi of [f[0], f[i], f[i + 1]]) {
          pIndices.push(vi, vi, vi);
        }
        triCount++;
      }
    }

    effectXml.push(`
    <effect id="${fxId}">
      <profile_COMMON>
        <technique sid="common">
          <phong>
            <diffuse><color>${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} 1</color></diffuse>
          </phong>
        </technique>
      </profile_COMMON>
    </effect>`);

    matXml.push(`
    <material id="${matId}" name="${sanitizeObjName(obj.name)}_Mat">
      <instance_effect url="#${fxId}"/>
    </material>`);

    geomXml.push(`
    <geometry id="${id}" name="${sanitizeObjName(obj.name)}">
      <mesh>
        <source id="${id}_positions">
          <float_array id="${id}_pos_arr" count="${posFloats.length}">${posFloats.join(' ')}</float_array>
          <technique_common>
            <accessor source="#${id}_pos_arr" count="${evaluated.vertices.length}" stride="3">
              <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <source id="${id}_normals">
          <float_array id="${id}_norm_arr" count="${normFloats.length}">${normFloats.join(' ')}</float_array>
          <technique_common>
            <accessor source="#${id}_norm_arr" count="${evaluated.vertices.length}" stride="3">
              <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <source id="${id}_uvs">
          <float_array id="${id}_uv_arr" count="${uvFloats.length}">${uvFloats.join(' ')}</float_array>
          <technique_common>
            <accessor source="#${id}_uv_arr" count="${evaluated.vertices.length}" stride="2">
              <param name="S" type="float"/><param name="T" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <vertices id="${id}_verts">
          <input semantic="POSITION" source="#${id}_positions"/>
        </vertices>
        <triangles material="${matId}" count="${triCount}">
          <input semantic="VERTEX" source="#${id}_verts" offset="0"/>
          <input semantic="NORMAL" source="#${id}_normals" offset="1"/>
          <input semantic="TEXCOORD" source="#${id}_uvs" offset="2" set="0"/>
          <p>${pIndices.join(' ')}</p>
        </triangles>
      </mesh>
    </geometry>`);

    nodeXml.push(`
      <node id="node_${id}" name="${sanitizeObjName(obj.name)}" type="NODE">
        <instance_geometry url="#${id}">
          <bind_material>
            <technique_common>
              <instance_material symbol="${matId}" target="#${matId}"/>
            </technique_common>
          </bind_material>
        </instance_geometry>
      </node>`);
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <contributor><authoring_tool>Modix 3D</authoring_tool></contributor>
    <up_axis>Y_UP</up_axis>
  </asset>
  <library_effects>${effectXml.join('')}</library_effects>
  <library_materials>${matXml.join('')}</library_materials>
  <library_geometries>${geomXml.join('')}</library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene">${nodeXml.join('')}
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#Scene"/></scene>
</COLLADA>`;
}

async function loadDataUrlAsCanvasTexture(
  dataUrl: string,
  repeatX = 1,
  repeatY = 1
): Promise<THREE.CanvasTexture | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width || 512;
      canvas.height = img.height || 512;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      tex.needsUpdate = true;
      resolve(tex);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * Builds a clean, spec-compliant Y-Up PBR THREE.Scene directly from SceneObjectData[]
 * (independent of current viewport shading mode, so GLB, GLTF, and USDZ always carry
 * proper MeshStandardMaterial + embedded textures + normals + UVs).
 */
export async function buildPbrSceneFromObjects(
  objects: SceneObjectData[],
  forUsdz = false
): Promise<{ scene: THREE.Scene; dispose: () => void }> {
  const scene = new THREE.Scene();
  scene.name = 'ModixScene';
  const disposables: { dispose: () => void }[] = [];
  const v0 = new THREE.Vector3();

  for (const obj of objects) {
    if (obj.kind !== 'MESH' || !obj.mesh || !obj.visible) continue;
    const evaluated = evaluateMeshWithModifiers(obj.mesh, obj.modifiers);
    if (evaluated.vertices.length === 0 || evaluated.faces.length === 0) continue;

    const mat4 = composeObjectMatrix(obj);
    const localBounds = computeMeshBounds(evaluated);
    const projMode = obj.material.uvProjection ?? 'box';
    const repX = obj.material.repeatX ?? 1;
    const repY = obj.material.repeatY ?? 1;
    const hasVC =
      !forUsdz &&
      Boolean(evaluated.vertexColors && evaluated.vertexColors.length === evaluated.vertices.length);

    const worldYUp: [number, number, number][] = evaluated.vertices.map(([lx, ly, lz]) => {
      v0.set(lx, ly, lz).applyMatrix4(mat4);
      // Z-up (x, y, z) -> Y-up (x, z, -y)
      return [v0.x, v0.z, -v0.y];
    });

    const smoothNormals = evaluated.shadeSmooth
      ? computeVertexNormals({ vertices: worldYUp, faces: evaluated.faces, shadeSmooth: true })
      : null;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];

    for (const f of evaluated.faces) {
      if (f.length < 3) continue;
      const localFn = computeFaceNormal(evaluated.vertices, f);
      const worldFn = computeFaceNormal(worldYUp, f);
      for (let i = 1; i < f.length - 1; i++) {
        for (const vi of [f[0], f[i], f[i + 1]]) {
          const wv = worldYUp[vi] || [0, 0, 0];
          const lv = evaluated.vertices[vi] || [0, 0, 0];
          const wn = smoothNormals ? smoothNormals[vi] : worldFn;
          const [u, w] = computeProjectedUV(lv, localFn, localBounds, projMode, repX, repY);
          positions.push(wv[0], wv[1], wv[2]);
          normals.push(wn[0], wn[1], wn[2]);
          uvs.push(u, w);
          if (hasVC) {
            const vc = evaluated.vertexColors![vi];
            colors.push(vc[0], vc[1], vc[2]);
          }
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (hasVC) {
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    disposables.push(geometry);

    let mapTex: THREE.CanvasTexture | null = null;
    if (obj.material.textureDataUrl) {
      mapTex = await loadDataUrlAsCanvasTexture(obj.material.textureDataUrl, repX, repY);
      if (mapTex) disposables.push(mapTex);
    }

    const stdMat = new THREE.MeshStandardMaterial({
      name: obj.material.name || `${sanitizeObjName(obj.name)}_Mat`,
      color: new THREE.Color(mapTex ? '#ffffff' : obj.material.baseColor || '#d4d4d4'),
      metalness: Math.max(0, Math.min(1, obj.material.metallic ?? 0.08)),
      roughness: Math.max(0.04, Math.min(1, obj.material.roughness ?? 0.45)),
      emissive: new THREE.Color(obj.material.emissionColor || '#000000'),
      emissiveIntensity: Math.max(0, obj.material.emissionStrength ?? 0),
      opacity: Math.max(0, Math.min(1, obj.material.opacity ?? 1)),
      transparent: (obj.material.opacity ?? 1) < 0.999,
      vertexColors: hasVC,
      map: mapTex
    });
    disposables.push(stdMat);

    const mesh = new THREE.Mesh(geometry, stdMat);
    mesh.name = sanitizeObjName(obj.name);
    scene.add(mesh);
  }

  scene.updateMatrixWorld(true);
  return {
    scene,
    dispose: () => {
      for (const d of disposables) d.dispose();
    }
  };
}

export async function exportSceneToGLB(objects: SceneObjectData[]): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  const { scene, dispose } = await buildPbrSceneFromObjects(objects, false);
  try {
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        scene,
        (res) => {
          if (res instanceof ArrayBuffer) {
            resolve(res);
          } else {
            const json = JSON.stringify(res, null, 2);
            resolve(new TextEncoder().encode(json).buffer);
          }
        },
        (err) => reject(err),
        { binary: true }
      );
    });
  } finally {
    dispose();
  }
}

export async function exportSceneToGLTF(objects: SceneObjectData[]): Promise<string> {
  const exporter = new GLTFExporter();
  const { scene, dispose } = await buildPbrSceneFromObjects(objects, false);
  try {
    return await new Promise<string>((resolve, reject) => {
      exporter.parse(
        scene,
        (res) => {
          if (res instanceof ArrayBuffer) {
            resolve(new TextDecoder().decode(res));
          } else {
            resolve(JSON.stringify(res, null, 2));
          }
        },
        (err) => reject(err),
        { binary: false }
      );
    });
  } finally {
    dispose();
  }
}

export async function exportSceneToUSDZ(objects: SceneObjectData[]): Promise<ArrayBuffer> {
  const exporter = new USDZExporter();
  const { scene, dispose } = await buildPbrSceneFromObjects(objects, true);
  try {
    const bytes = await exporter.parseAsync(scene);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } finally {
    dispose();
  }
}

// ============================================================================
// UNIVERSAL 3D IMPORTERS
// ============================================================================

export interface ImportedMeshResult {
  name: string;
  mesh: EditableMeshData;
  material?: Partial<MaterialData>;
  location?: [number, number, number];
}

export function parseOBJToMeshes(text: string, convertYUpToZUp = true): ImportedMeshResult[] {
  const globalVerts: [number, number, number][] = [];
  const groups: { name: string; faces: number[][] }[] = [];
  let currentGroup = { name: 'Imported_OBJ', faces: [] as number[][] };
  groups.push(currentGroup);

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const cmd = parts[0];

    if (cmd === 'o' || cmd === 'g') {
      const gName = parts.slice(1).join('_').trim() || 'Imported_OBJ';
      if (currentGroup.faces.length === 0) {
        currentGroup.name = gName;
      } else {
        currentGroup = { name: gName, faces: [] };
        groups.push(currentGroup);
      }
    } else if (cmd === 'v' && parts.length >= 4) {
      const x = parseFloat(parts[1]) || 0;
      const y = parseFloat(parts[2]) || 0;
      const z = parseFloat(parts[3]) || 0;
      // Convert standard Y-up OBJ -> Modix Z-up: (x, -z, y)
      globalVerts.push(convertYUpToZUp ? [x, -z, y] : [x, y, z]);
    } else if (cmd === 'f' && parts.length >= 4) {
      const face: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const token = parts[i].split('/')[0];
        let idx = parseInt(token, 10);
        if (Number.isNaN(idx)) continue;
        if (idx < 0) idx = globalVerts.length + idx;
        else idx = idx - 1;
        if (idx >= 0 && idx < globalVerts.length) face.push(idx);
      }
      if (face.length >= 3) currentGroup.faces.push(face);
    }
  }

  const results: ImportedMeshResult[] = [];
  for (const g of groups) {
    if (g.faces.length === 0) continue;
    const remap = new Map<number, number>();
    const localVerts: [number, number, number][] = [];
    const localFaces: number[][] = [];
    for (const f of g.faces) {
      const nf: number[] = [];
      for (const vi of f) {
        let ni = remap.get(vi);
        if (ni === undefined) {
          ni = localVerts.length;
          localVerts.push([...globalVerts[vi]]);
          remap.set(vi, ni);
        }
        nf.push(ni);
      }
      localFaces.push(nf);
    }
    results.push({
      name: g.name,
      mesh: { vertices: localVerts, faces: localFaces, shadeSmooth: false }
    });
  }
  return results;
}

export function parseOBJToMesh(text: string): EditableMeshData {
  const res = parseOBJToMeshes(text, false);
  if (res.length === 0) return { vertices: [], faces: [], shadeSmooth: false };
  if (res.length === 1) return res[0].mesh;
  const vertices: [number, number, number][] = [];
  const faces: number[][] = [];
  for (const item of res) {
    const off = vertices.length;
    for (const v of item.mesh.vertices) vertices.push(v);
    for (const f of item.mesh.faces) faces.push(f.map((i) => i + off));
  }
  return { vertices, faces, shadeSmooth: false };
}

export function parseSTLToMesh(buffer: ArrayBuffer): EditableMeshData {
  const textSample = new TextDecoder().decode(buffer.slice(0, 256));
  if (textSample.trimStart().startsWith('solid') && textSample.includes('facet')) {
    const fullText = new TextDecoder().decode(buffer);
    const vertices: [number, number, number][] = [];
    const faces: number[][] = [];
    const vertMap = new Map<string, number>();

    const getV = (x: number, y: number, z: number): number => {
      const key = `${x.toFixed(5)}_${y.toFixed(5)}_${z.toFixed(5)}`;
      const hit = vertMap.get(key);
      if (hit !== undefined) return hit;
      const idx = vertices.length;
      vertices.push([x, y, z]);
      vertMap.set(key, idx);
      return idx;
    };

    let currentTri: number[] = [];
    for (const raw of fullText.split(/\r?\n/)) {
      const l = raw.trim();
      if (l.startsWith('vertex')) {
        const p = l.split(/\s+/);
        currentTri.push(getV(parseFloat(p[1]) || 0, parseFloat(p[2]) || 0, parseFloat(p[3]) || 0));
        if (currentTri.length === 3) {
          faces.push(currentTri);
          currentTri = [];
        }
      }
    }
    if (faces.length > 0) return { vertices, faces, shadeSmooth: false };
  }

  // Binary STL
  const dv = new DataView(buffer);
  const vertices: [number, number, number][] = [];
  const faces: number[][] = [];
  if (buffer.byteLength < 84) return { vertices, faces, shadeSmooth: false };
  const triCount = dv.getUint32(80, true);
  const vertMap = new Map<string, number>();
  const getV = (x: number, y: number, z: number): number => {
    const key = `${x.toFixed(5)}_${y.toFixed(5)}_${z.toFixed(5)}`;
    const hit = vertMap.get(key);
    if (hit !== undefined) return hit;
    const idx = vertices.length;
    vertices.push([x, y, z]);
    vertMap.set(key, idx);
    return idx;
  };

  let offset = 84;
  for (let i = 0; i < triCount && offset + 50 <= buffer.byteLength; i++) {
    offset += 12;
    const tri: number[] = [];
    for (let k = 0; k < 3; k++) {
      const x = dv.getFloat32(offset, true);
      const y = dv.getFloat32(offset + 4, true);
      const z = dv.getFloat32(offset + 8, true);
      offset += 12;
      tri.push(getV(x, y, z));
    }
    offset += 2;
    faces.push(tri);
  }
  return { vertices, faces, shadeSmooth: false };
}

export function parseOFFToMesh(text: string): EditableMeshData {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  let idx = 0;
  if (lines[idx]?.startsWith('OFF')) {
    if (lines[idx] === 'OFF') idx++;
    else lines[idx] = lines[idx].slice(3).trim();
  }
  if (idx >= lines.length) return { vertices: [], faces: [], shadeSmooth: false };
  const counts = lines[idx++].split(/\s+/).map(Number);
  const nVerts = counts[0] || 0;
  const nFaces = counts[1] || 0;

  const vertices: [number, number, number][] = [];
  for (let i = 0; i < nVerts && idx < lines.length; i++, idx++) {
    const p = lines[idx].split(/\s+/).map(Number);
    vertices.push([p[0] || 0, p[1] || 0, p[2] || 0]);
  }
  const faces: number[][] = [];
  for (let i = 0; i < nFaces && idx < lines.length; i++, idx++) {
    const p = lines[idx].split(/\s+/).map(Number);
    const k = p[0] || 0;
    if (k >= 3) {
      faces.push(p.slice(1, 1 + k));
    }
  }
  return { vertices, faces, shadeSmooth: false };
}

function extractThreeRootMeshes(
  root: THREE.Object3D,
  fallbackName: string,
  convertYUpToZUp = true
): ImportedMeshResult[] {
  if (convertYUpToZUp) {
    root.rotation.x += Math.PI / 2;
  }
  root.updateMatrixWorld(true);
  const results: ImportedMeshResult[] = [];
  let idx = 1;

  root.traverse((node) => {
    if (node instanceof THREE.Mesh && node.geometry) {
      const worldGeom = node.geometry.clone();
      worldGeom.applyMatrix4(node.matrixWorld);
      const editable = threeGeometryToEditableMesh(worldGeom, false);
      worldGeom.dispose();
      if (editable.vertices.length === 0 || editable.faces.length === 0) return;

      const matData: Partial<MaterialData> = {};
      const mat = Array.isArray(node.material) ? node.material[0] : node.material;
      if (mat && 'color' in mat && mat.color instanceof THREE.Color) {
        matData.baseColor = `#${mat.color.getHexString()}`;
      }
      if (mat && 'roughness' in mat && typeof mat.roughness === 'number') {
        matData.roughness = mat.roughness;
      }
      if (mat && 'metalness' in mat && typeof mat.metalness === 'number') {
        matData.metallic = mat.metalness;
      }
      if (mat && 'map' in mat && mat.map instanceof THREE.Texture && mat.map.image) {
        try {
          const img = mat.map.image as CanvasImageSource & { width?: number; height?: number };
          const w = Math.min(512, Number(img.width) || 512);
          const h = Math.min(512, Number(img.height) || 512);
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            matData.textureDataUrl = c.toDataURL('image/png');
            matData.textureName = `${node.name || fallbackName}_tex.png`;
          }
        } catch {
          // Ignore tainted/compressed embedded image fallback
        }
      }

      results.push({
        name: node.name?.trim() || `${fallbackName}_${idx++}`,
        mesh: editable,
        material: matData
      });
    }
  });

  return results;
}

/**
 * Universal 3D File Importer supporting:
 * .obj, .fbx, .glb, .gltf, .dae, .stl, .ply, .3mf, .amf, .svg, .off
 */
export async function importAny3DFile(file: File): Promise<ImportedMeshResult[]> {
  const lower = file.name.toLowerCase();
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'Imported';

  if (lower.endsWith('.obj')) {
    const text = await file.text();
    return parseOBJToMeshes(text, true);
  }

  if (lower.endsWith('.stl')) {
    const buf = await file.arrayBuffer();
    return [{ name: baseName, mesh: parseSTLToMesh(buf) }];
  }

  if (lower.endsWith('.off')) {
    const text = await file.text();
    return [{ name: baseName, mesh: parseOFFToMesh(text) }];
  }

  if (lower.endsWith('.ply')) {
    const buf = await file.arrayBuffer();
    const loader = new PLYLoader();
    const geom = loader.parse(buf);
    return [{ name: baseName, mesh: threeGeometryToEditableMesh(geom, true) }];
  }

  if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
    const buf = await file.arrayBuffer();
    const loader = new GLTFLoader();
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
      loader.parse(buf, '', (res) => resolve(res), (err) => reject(err));
    });
    return extractThreeRootMeshes(gltf.scene, baseName, true);
  }

  if (lower.endsWith('.fbx')) {
    const buf = await file.arrayBuffer();
    const loader = new FBXLoader();
    const group = loader.parse(buf, '');
    return extractThreeRootMeshes(group, baseName, true);
  }

  if (lower.endsWith('.dae')) {
    const text = await file.text();
    const loader = new ColladaLoader();
    const collada = loader.parse(text, '');
    if (!collada || !collada.scene) return [];
    const isZUp = text.includes('<up_axis>Z_UP</up_axis>');
    return extractThreeRootMeshes(collada.scene, baseName, !isZUp);
  }

  if (lower.endsWith('.3mf')) {
    const buf = await file.arrayBuffer();
    const loader = new ThreeMFLoader();
    const group = loader.parse(buf);
    return extractThreeRootMeshes(group, baseName, false);
  }

  if (lower.endsWith('.amf')) {
    const buf = await file.arrayBuffer();
    const loader = new AMFLoader();
    const group = loader.parse(buf);
    return extractThreeRootMeshes(group, baseName, false);
  }

  if (lower.endsWith('.svg')) {
    const text = await file.text();
    const loader = new SVGLoader();
    const svgData = loader.parse(text);
    const group = new THREE.Group();
    let idx = 1;
    for (const path of svgData.paths) {
      const shapes = SVGLoader.createShapes(path);
      for (const shape of shapes) {
        const geom = new THREE.ExtrudeGeometry(shape, {
          depth: 12,
          bevelEnabled: true,
          bevelThickness: 1.5,
          bevelSize: 1,
          bevelSegments: 2
        });
        geom.center();
        geom.scale(0.03, -0.03, 0.03);
        const colorHex = path.color ? `#${path.color.getHexString()}` : '#d4d4d4';
        const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: colorHex }));
        mesh.name = `${baseName}_Shape_${idx++}`;
        group.add(mesh);
      }
    }
    return extractThreeRootMeshes(group, baseName, false);
  }

  throw new Error(`Formato não suportado: ${file.name}`);
}

function composeObjectMatrix(obj: SceneObjectData): THREE.Matrix4 {
  const pos = new THREE.Vector3(
    obj.location[0] + obj.deltaLocation[0],
    obj.location[1] + obj.deltaLocation[1],
    obj.location[2] + obj.deltaLocation[2]
  );
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(obj.rotationDeg[0] + obj.deltaRotationDeg[0]),
    THREE.MathUtils.degToRad(obj.rotationDeg[1] + obj.deltaRotationDeg[1]),
    THREE.MathUtils.degToRad(obj.rotationDeg[2] + obj.deltaRotationDeg[2]),
    'XYZ'
  );
  const quat = new THREE.Quaternion().setFromEuler(euler);
  const scl = new THREE.Vector3(
    obj.scale[0] * obj.deltaScale[0],
    obj.scale[1] * obj.deltaScale[1],
    obj.scale[2] * obj.deltaScale[2]
  );
  return new THREE.Matrix4().compose(pos, quat, scl);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function saveOrShareFile(
  filename: string,
  payload: string | ArrayBuffer,
  mimeType: string
): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    try {
      const writeResult =
        typeof payload === 'string'
          ? await Filesystem.writeFile({
              path: filename,
              data: payload,
              directory: Directory.Cache,
              encoding: Encoding.UTF8
            })
          : await Filesystem.writeFile({
              path: filename,
              data: arrayBufferToBase64(payload),
              directory: Directory.Cache
            });

      await Share.share({
        title: filename,
        text: 'Exportado pelo Modix 3D',
        url: writeResult.uri,
        dialogTitle: `Salvar ou Compartilhar ${filename}`
      });
      return `Arquivo compartilhado: ${filename}`;
    } catch (err) {
      console.warn('Native share fallback:', err);
    }
  }

  const blob =
    typeof payload === 'string'
      ? new Blob([payload], { type: mimeType })
      : new Blob([payload], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return `Arquivo salvo: ${filename}`;
}

export async function saveDataUrlPNG(filename: string, dataUrl: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    try {
      const base64 = dataUrl.split(',')[1] || '';
      const writeResult = await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Cache
      });
      await Share.share({
        title: filename,
        url: writeResult.uri,
        dialogTitle: `Exportar ${filename}`
      });
      return `Imagem salva: ${filename}`;
    } catch {
      // Fallback
    }
  }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return `Imagem salva: ${filename}`;
}

export function serializeProject(state: ModixProjectState): string {
  return JSON.stringify(state, null, 2);
}
