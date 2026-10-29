import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { EditableMeshData, ModixProjectState, SceneObjectData } from '../types/scene';
import { computeFaceNormal, evaluateMeshWithModifiers } from './MeshOperations';

export function exportSceneToOBJ(objects: SceneObjectData[]): string {
  const lines: string[] = [
    '# Modix 3D OBJ Export',
    '# https://github.com/Veexdevs/Modix-3D',
    ''
  ];
  let vertexOffset = 1;

  for (const obj of objects) {
    if (obj.kind !== 'MESH' || !obj.mesh || !obj.visible) continue;
    const evaluated = evaluateMeshWithModifiers(obj.mesh, obj.modifiers);
    lines.push(`o ${obj.name.replace(/\s+/g, '_')}`);

    const mat = composeObjectMatrix(obj);
    const v = new THREE.Vector3();
    for (const [x, y, z] of evaluated.vertices) {
      v.set(x, y, z).applyMatrix4(mat);
      lines.push(`v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}`);
    }

    for (const f of evaluated.faces) {
      const indices = f.map((idx) => idx + vertexOffset).join(' ');
      lines.push(`f ${indices}`);
    }
    vertexOffset += evaluated.vertices.length;
    lines.push('');
  }
  return lines.join('\n');
}

export function exportSceneToSTL(objects: SceneObjectData[]): string {
  const lines: string[] = ['solid Modix3D'];
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();

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
        v0.set(a[0], a[1], a[2]);
        v1.set(b[0], b[1], b[2]);
        v2.set(c[0], c[1], c[2]);
        lines.push(`  facet normal ${n[0].toFixed(6)} ${n[1].toFixed(6)} ${n[2].toFixed(6)}`);
        lines.push('    outer loop');
        lines.push(`      vertex ${v0.x.toFixed(6)} ${v0.y.toFixed(6)} ${v0.z.toFixed(6)}`);
        lines.push(`      vertex ${v1.x.toFixed(6)} ${v1.y.toFixed(6)} ${v1.z.toFixed(6)}`);
        lines.push(`      vertex ${v2.x.toFixed(6)} ${v2.y.toFixed(6)} ${v2.z.toFixed(6)}`);
        lines.push('    endloop');
        lines.push('  endfacet');
      }
    }
  }
  lines.push('endsolid Modix3D');
  return lines.join('\n');
}

export async function exportThreeGroupToGLB(group: THREE.Object3D): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      group,
      (res) => {
        if (res instanceof ArrayBuffer) {
          resolve(res);
        } else {
          const json = JSON.stringify(res);
          resolve(new TextEncoder().encode(json).buffer);
        }
      },
      (err) => reject(err),
      { binary: true }
    );
  });
}

export function parseOBJToMesh(text: string): EditableMeshData {
  const vertices: [number, number, number][] = [];
  const faces: number[][] = [];
  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      vertices.push([
        parseFloat(parts[1]) || 0,
        parseFloat(parts[2]) || 0,
        parseFloat(parts[3]) || 0
      ]);
    } else if (parts[0] === 'f' && parts.length >= 4) {
      const face: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const token = parts[i].split('/')[0];
        let idx = parseInt(token, 10);
        if (Number.isNaN(idx)) continue;
        if (idx < 0) idx = vertices.length + idx;
        else idx = idx - 1;
        if (idx >= 0) face.push(idx);
      }
      if (face.length >= 3) faces.push(face);
    }
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
    offset += 12; // skip normal
    const tri: number[] = [];
    for (let k = 0; k < 3; k++) {
      const x = dv.getFloat32(offset, true);
      const y = dv.getFloat32(offset + 4, true);
      const z = dv.getFloat32(offset + 8, true);
      offset += 12;
      tri.push(getV(x, y, z));
    }
    offset += 2; // attr byte count
    faces.push(tri);
  }
  return { vertices, faces, shadeSmooth: false };
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
        text: `Exported from Modix 3D`,
        url: writeResult.uri,
        dialogTitle: `Save or Share ${filename}`
      });
      return `Shared ${filename}`;
    } catch (err) {
      console.warn('Native share canceled or fell back:', err);
    }
  }

  // Fallback standard download
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
        dialogTitle: 'Export Render PNG'
      });
      return `Rendered ${filename}`;
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
  return `Rendered ${filename}`;
}

export function serializeProject(state: ModixProjectState): string {
  return JSON.stringify(state, null, 2);
}
