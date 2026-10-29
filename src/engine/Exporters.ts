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
  createPrimitiveMesh,
  evaluateMeshWithModifiers,
  threeGeometryToEditableMesh
} from './MeshOperations';

export interface OBJExportOptions {
  /** Convert Z-up (Modix/Blender) -> Y-up (Roblox Studio, Unity, Maya) with Rx(-90deg) */
  yUpForRoblox?: boolean;
  /** Uniform scale multiplier (e.g., 1 = 1 stud/m, 4 = large Roblox prop) */
  scale?: number;
  /** Triangulate all quads/n-gons for strict game-engine importers like Roblox Studio */
  triangulate?: boolean;
  /** Merge all visible meshes into one single MeshPart object if true */
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
 * Exports scene objects to Wavefront .OBJ with full UV coordinates (vt),
 * outward vertex/face normals (vn), materials (usemtl), and optional Y-up conversion
 * specifically engineered for 100% compatibility with Roblox Studio MeshPart importer.
 */
export function exportSceneToOBJ(objects: SceneObjectData[], opts: OBJExportOptions = {}): string {
  const yUp = opts.yUpForRoblox !== false; // default true for Roblox Studio & standard game engines
  const scale = opts.scale ?? 1;
  const triangulate = opts.triangulate !== false;
  const combine = opts.combineMeshes ?? false;
  const mtlName = opts.mtlFileName || 'modix_export.mtl';

  const lines: string[] = [
    '# Modix 3D OBJ Export (Roblox Studio & Blender Ready)',
    '# Coordinate System: ' + (yUp ? 'Y-Up Right-Handed (Roblox Studio)' : 'Z-Up Right-Handed (Blender)'),
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
      // Rx(-90 deg): (x, y, z)_Zup -> (x, z, -y)_Yup, det = +1 (preserves CCW winding!)
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

    for (const f of evaluated.faces) {
      if (f.length < 3) continue;
      const localNormal = computeFaceNormal(evaluated.vertices, f);
      const worldNormal = computeFaceNormal(worldVerts, f);
      // Ensure non-zero normal
      const nLen = Math.hypot(worldNormal[0], worldNormal[1], worldNormal[2]);
      const [nx, ny, nz] =
        nLen > 1e-7 ? worldNormal : mapDir(localNormal[0], localNormal[1], localNormal[2]);
      lines.push(`vn ${nx.toFixed(6)} ${ny.toFixed(6)} ${nz.toFixed(6)}`);
      const thisVn = vnOffset++;

      // Emit per-corner UVs for clean seam-free box/planar/spherical mapping
      const cornerVts: number[] = [];
      for (const vi of f) {
        const lv = evaluated.vertices[vi] || [0, 0, 0];
        const [u, v] = computeProjectedUV(lv, localNormal, localBounds, projMode, repX, repY);
        lines.push(`vt ${u.toFixed(6)} ${v.toFixed(6)}`);
        cornerVts.push(vtOffset++);
      }

      if (triangulate) {
        for (let i = 1; i < f.length - 1; i++) {
          const i0 = f[0] + vOffset;
          const i1 = f[i] + vOffset;
          const i2 = f[i + 1] + vOffset;
          const t0 = cornerVts[0];
          const t1 = cornerVts[i];
          const t2 = cornerVts[i + 1];
          lines.push(`f ${i0}/${t0}/${thisVn} ${i1}/${t1}/${thisVn} ${i2}/${t2}/${thisVn}`);
        }
      } else {
        const tokens = f.map((vi, idx) => `${vi + vOffset}/${cornerVts[idx]}/${thisVn}`);
        lines.push(`f ${tokens.join(' ')}`);
      }
    }

    vOffset += evaluated.vertices.length;
    lines.push('');
  }

  return lines.join('\n');
}

export function exportSceneToMTL(
  objects: SceneObjectData[],
  textureFileMap?: Map<string, string>
): string {
  const lines: string[] = [
    '# Modix 3D Material Library (.mtl)',
    '# Compatible with Roblox Studio & Blender',
    ''
  ];
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
    lines.push(`Ks 0.2500 0.2500 0.2500`);
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
      const n = computeFaceNormal(transformed, f);
      for (let i = 1; i < f.length - 1; i++) {
        const a = transformed[f[0]];
        const b = transformed[f[i]];
        const c = transformed[f[i + 1]];
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

export function exportSceneToPLY(objects: SceneObjectData[]): string {
  const verts: { x: number; y: number; z: number; r: number; g: number; b: number }[] = [];
  const tris: [number, number, number][] = [];
  const v0 = new THREE.Vector3();

  for (const obj of objects) {
    if (obj.kind !== 'MESH' || !obj.mesh || !obj.visible) continue;
    const evaluated = evaluateMeshWithModifiers(obj.mesh, obj.modifiers);
    const mat = composeObjectMatrix(obj);
    const [cr, cg, cb] = hexToRgb01(obj.material.baseColor || '#cccccc');
    const r = Math.round(cr * 255);
    const g = Math.round(cg * 255);
    const b = Math.round(cb * 255);
    const baseOffset = verts.length;

    for (const [x, y, z] of evaluated.vertices) {
      v0.set(x, y, z).applyMatrix4(mat);
      // Y-up conversion
      verts.push({ x: v0.x, y: v0.z, z: -v0.y, r, g, b });
    }
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
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    `element face ${tris.length}`,
    'property list uchar int vertex_indices',
    'end_header'
  ];

  for (const v of verts) {
    lines.push(`${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)} ${v.r} ${v.g} ${v.b}`);
  }
  for (const [a, b, c] of tris) {
    lines.push(`3 ${a} ${b} ${c}`);
  }
  return lines.join('\n');
}

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

    const posFloats: string[] = [];
    for (const [x, y, z] of evaluated.vertices) {
      v0.set(x, y, z).applyMatrix4(mat);
      posFloats.push(v0.x.toFixed(5), v0.y.toFixed(5), v0.z.toFixed(5));
    }

    const triIndices: number[] = [];
    let triCount = 0;
    for (const f of evaluated.faces) {
      if (f.length < 3) continue;
      for (let i = 1; i < f.length - 1; i++) {
        triIndices.push(f[0], f[i], f[i + 1]);
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
        <vertices id="${id}_verts">
          <input semantic="POSITION" source="#${id}_positions"/>
        </vertices>
        <triangles material="${matId}" count="${triCount}">
          <input semantic="VERTEX" source="#${id}_verts" offset="0"/>
          <p>${triIndices.join(' ')}</p>
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
    <up_axis>Z_UP</up_axis>
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

/**
 * Exports scene objects into a native Roblox Studio XML Model (.rbxmx) using Parts/WedgeParts!
 */
export function exportSceneToRBXMX(objects: SceneObjectData[]): string {
  const itemsXml: string[] = [];
  let refIdx = 1;

  for (const obj of objects) {
    if (obj.kind !== 'MESH' || !obj.mesh || !obj.visible) continue;
    const evaluated = evaluateMeshWithModifiers(obj.mesh, obj.modifiers);
    const bounds = computeMeshBounds(evaluated);

    const sx = Math.max(0.2, bounds.span[0] * Math.abs(obj.scale[0] * obj.deltaScale[0]));
    const sy = Math.max(0.2, bounds.span[2] * Math.abs(obj.scale[2] * obj.deltaScale[2])); // Z-up -> Roblox Y-up
    const sz = Math.max(0.2, bounds.span[1] * Math.abs(obj.scale[1] * obj.deltaScale[1]));

    const px = obj.location[0] + obj.deltaLocation[0];
    const py = obj.location[2] + obj.deltaLocation[2];
    const pz = -(obj.location[1] + obj.deltaLocation[1]);

    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(obj.rotationDeg[0] + obj.deltaRotationDeg[0]),
      THREE.MathUtils.degToRad(obj.rotationDeg[2] + obj.deltaRotationDeg[2]),
      THREE.MathUtils.degToRad(-(obj.rotationDeg[1] + obj.deltaRotationDeg[1])),
      'XYZ'
    );
    const m = new THREE.Matrix4().makeRotationFromEuler(euler);
    const e = m.elements; // column-major

    const [r, g, b] = hexToRgb01(obj.material.baseColor);
    const colorUint =
      (0xff << 24) |
      ((Math.round(r * 255) & 255) << 16) |
      ((Math.round(g * 255) & 255) << 8) |
      (Math.round(b * 255) & 255);

    const isWedge = obj.primitive === 'wedge';
    const className = isWedge ? 'WedgePart' : 'Part';
    const shapeToken =
      obj.primitive === 'uv_sphere' || obj.primitive === 'ico_sphere'
        ? 0 // Ball
        : obj.primitive === 'cylinder'
          ? 2 // Cylinder
          : 1; // Block

    itemsXml.push(`
    <Item class="${className}" referent="RBXMODIX${refIdx++}">
      <Properties>
        <string name="Name">${sanitizeObjName(obj.name)}</string>
        <bool name="Anchored">true</bool>
        <Color3uint8 name="Color3uint8">${colorUint >>> 0}</Color3uint8>
        <float name="Transparency">${(1 - (obj.material.opacity ?? 1)).toFixed(3)}</float>
        ${!isWedge ? `<token name="shape">${shapeToken}</token>` : ''}
        <Vector3 name="size">
          <X>${sx.toFixed(4)}</X>
          <Y>${sy.toFixed(4)}</Y>
          <Z>${sz.toFixed(4)}</Z>
        </Vector3>
        <CoordinateFrame name="CFrame">
          <X>${px.toFixed(4)}</X>
          <Y>${py.toFixed(4)}</Y>
          <Z>${pz.toFixed(4)}</Z>
          <R00>${e[0].toFixed(5)}</R00><R01>${e[4].toFixed(5)}</R01><R02>${e[8].toFixed(5)}</R02>
          <R10>${e[1].toFixed(5)}</R10><R11>${e[5].toFixed(5)}</R11><R12>${e[9].toFixed(5)}</R12>
          <R20>${e[2].toFixed(5)}</R20><R21>${e[6].toFixed(5)}</R21><R22>${e[10].toFixed(5)}</R22>
        </CoordinateFrame>
      </Properties>
    </Item>`);
  }

  return `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">
  <External>null</External>
  <External>nil</External>
  <Item class="Model" referent="RBXMODIXROOT">
    <Properties>
      <string name="Name">ModixModel</string>
    </Properties>${itemsXml.join('')}
  </Item>
</roblox>`;
}

function buildExportableYUpScene(group: THREE.Object3D): THREE.Scene {
  const exportScene = new THREE.Scene();
  const wrapper = new THREE.Group();
  wrapper.name = 'ModixYUpRoot';
  // Convert Z-up Modix scene to Y-up glTF/USDZ standard
  wrapper.rotation.x = -Math.PI / 2;

  group.traverse((child) => {
    if (child instanceof THREE.Mesh && child.visible) {
      // Skip wireframe overlay children (LineSegments are not Mesh, so only solid meshes match)
      const cloned = child.clone(false);
      // Apply world transform relative to group
      cloned.position.copy(child.position);
      cloned.rotation.copy(child.rotation);
      cloned.scale.copy(child.scale);
      wrapper.add(cloned);
    }
  });
  exportScene.add(wrapper);
  exportScene.updateMatrixWorld(true);
  return exportScene;
}

export async function exportThreeGroupToGLB(group: THREE.Object3D): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  const yUpScene = buildExportableYUpScene(group);
  return new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      yUpScene,
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
}

export async function exportThreeGroupToGLTF(group: THREE.Object3D): Promise<string> {
  const exporter = new GLTFExporter();
  const yUpScene = buildExportableYUpScene(group);
  return new Promise<string>((resolve, reject) => {
    exporter.parse(
      yUpScene,
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
}

export async function exportThreeGroupToUSDZ(group: THREE.Object3D): Promise<ArrayBuffer> {
  const exporter = new USDZExporter();
  const yUpScene = buildExportableYUpScene(group);
  const bytes = await exporter.parseAsync(yUpScene);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
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
      // Convert standard Y-up OBJ (Roblox/Maya/glTF) -> Modix Z-up: (x, -z, y)
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
  // Combine if single mesh expected
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

export function parseRBXMXToMeshes(xmlText: string): ImportedMeshResult[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const items = Array.from(doc.querySelectorAll('Item[class="Part"], Item[class="WedgePart"], Item[class="MeshPart"]'));
  const results: ImportedMeshResult[] = [];

  for (const item of items) {
    const cls = item.getAttribute('class') || 'Part';
    const nameEl = item.querySelector(':scope > Properties > string[name="Name"]');
    const name = nameEl?.textContent?.trim() || cls;

    const sizeEl = item.querySelector(':scope > Properties > Vector3[name="size"], :scope > Properties > Vector3[name="Size"]');
    const sx = parseFloat(sizeEl?.querySelector('X')?.textContent || '2') || 2;
    const sy = parseFloat(sizeEl?.querySelector('Y')?.textContent || '1') || 1;
    const sz = parseFloat(sizeEl?.querySelector('Z')?.textContent || '2') || 2;

    const cfEl = item.querySelector(':scope > Properties > CoordinateFrame[name="CFrame"]');
    const px = parseFloat(cfEl?.querySelector('X')?.textContent || '0') || 0;
    const py = parseFloat(cfEl?.querySelector('Y')?.textContent || '0') || 0;
    const pz = parseFloat(cfEl?.querySelector('Z')?.textContent || '0') || 0;

    const colEl = item.querySelector(':scope > Properties > Color3uint8[name="Color3uint8"]');
    let baseColor = '#9ca3af';
    if (colEl?.textContent) {
      const c = parseInt(colEl.textContent, 10) >>> 0;
      const r = (c >> 16) & 255;
      const g = (c >> 8) & 255;
      const b = c & 255;
      baseColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    const baseMesh = createPrimitiveMesh(cls === 'WedgePart' ? 'wedge' : 'cube');
    // Scale unit mesh (size 2) to Roblox Part size (sx, sz, sy in Z-up)
    const scaledVerts: [number, number, number][] = baseMesh.vertices.map(([vx, vy, vz]) => [
      vx * (sx / 2),
      vy * (sz / 2),
      vz * (sy / 2)
    ]);

    results.push({
      name,
      mesh: { vertices: scaledVerts, faces: baseMesh.faces, shadeSmooth: false },
      material: { baseColor },
      location: [px, -pz, py]
    });
  }
  return results;
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
          // Embedded image may be compressed or untainted fallback
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
 * .obj, .fbx, .glb, .gltf, .dae, .stl, .ply, .3mf, .amf, .svg, .off, .rbxmx
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

  if (lower.endsWith('.rbxmx')) {
    const text = await file.text();
    return parseRBXMXToMeshes(text);
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

  throw new Error(`Unsupported file format: ${file.name}`);
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
        text: 'Exported from Modix 3D',
        url: writeResult.uri,
        dialogTitle: `Save or Share ${filename}`
      });
      return `Shared ${filename}`;
    } catch (err) {
      console.warn('Native share canceled or fell back:', err);
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
  return `Saved ${filename}`;
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
        dialogTitle: `Export ${filename}`
      });
      return `Saved ${filename}`;
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
  return `Saved ${filename}`;
}

export function serializeProject(state: ModixProjectState): string {
  return JSON.stringify(state, null, 2);
}
