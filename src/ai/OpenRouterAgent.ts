import {
  bendMeshZ,
  bevelFaces,
  catmullClarkSubdivide,
  createExtrudedPolygonMesh,
  createLatheMesh,
  createLoftedSectionsMesh,
  createTubeSweepMesh,
  createUnifiedSDFMesh,
  extrudeFaces,
  taperMeshZ,
  twistMeshZ,
  type LoftSectionSpec,
  type SDFElementKind,
  type SDFElementSpec
} from '../engine/MeshOperations';
import type { ModixEngine } from '../engine/ModixEngine';
import {
  generateProceduralTextureDataUrl,
  renderSVGToTextureDataUrl,
  type ProceduralTexturePreset
} from '../engine/TextureGenerator';
import { getActiveLanguageInfo, tr } from '../i18n/I18nService';
import type { PrimitiveType, SceneObjectData, UVProjectionMode } from '../types/scene';
import {
  callOpenRouterChat,
  fetchUnlockedOpenRouterCatalog,
  getActiveOpenRouterKey,
  getPreferredOpenRouterModel,
  hasCustomOpenRouterKey,
  isMultiAIEnabled,
  setCustomOpenRouterKey,
  setMultiAIEnabled,
  setPreferredOpenRouterModel,
  UNLOCKED_FRONTIER_MODELS,
  type ORContentPart,
  type ORMessage,
  type UnlockedAIModelOption
} from './OpenRouterConfig';

export {
  fetchUnlockedOpenRouterCatalog,
  getActiveOpenRouterKey,
  getPreferredOpenRouterModel,
  hasCustomOpenRouterKey,
  isMultiAIEnabled,
  setCustomOpenRouterKey,
  setMultiAIEnabled,
  setPreferredOpenRouterModel,
  UNLOCKED_FRONTIER_MODELS,
  type UnlockedAIModelOption
};

export type ChatRoleMode = 'ia' | 'agente';

export interface ReferenceImageAttachment {
  id: string;
  name: string;
  /** Optimized data URL (<= 960px) sent to OpenRouter multimodal vision models */
  dataUrl: string;
  width: number;
  height: number;
  /** Measured width/height aspect ratio of the foreground subject inside the image */
  subjectAspectWH: number;
  /** Pixel-sampled dominant hex colors from the reference image (overall + top/mid/bottom) */
  dominantColors: string[];
  regionColors: {
    top: string;
    middle: string;
    bottom: string;
  };
}

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  mode: ChatRoleMode;
  agentSteps?: string[];
  images?: ReferenceImageAttachment[];
}

// ============================================================================
// Reference Image Preprocessor + Pixel-Exact Palette & Silhouette Analyzer
// ============================================================================

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Loads a user reference image File/Blob, resizes to <= 960px for crisp multimodal vision analysis,
 * detects foreground silhouette bounds (ignoring alpha/corner background), and extracts exact hex colors.
 */
export async function prepareReferenceImage(file: File): Promise<ReferenceImageAttachment> {
  const rawUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Falha ao ler imagem "${file.name}".`));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`Imagem inválida: "${file.name}".`));
    el.src = rawUrl;
  });

  const maxSide = 960;
  const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
  const w = Math.max(16, Math.round((img.width || 256) * scale));
  const h = Math.max(16, Math.round((img.height || 256) * scale));

  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = w;
  rawCanvas.height = h;
  const rawCtx = rawCanvas.getContext('2d')!;
  rawCtx.drawImage(img, 0, 0, w, h);

  const imgData = rawCtx.getImageData(0, 0, w, h).data;

  const cornerCoords: [number, number][] = [
    [1, 1],
    [w - 2, 1],
    [1, h - 2],
    [w - 2, h - 2]
  ];
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  let bgA = 0;
  for (const [cx, cy] of cornerCoords) {
    const idx = (Math.max(0, cy) * w + Math.max(0, cx)) * 4;
    bgR += imgData[idx];
    bgG += imgData[idx + 1];
    bgB += imgData[idx + 2];
    bgA += imgData[idx + 3];
  }
  bgR /= 4;
  bgG /= 4;
  bgB /= 4;
  bgA /= 4;
  const transparentBg = bgA < 50;

  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;
  let fgCount = 0;

  const buckets = new Map<string, { rSum: number; gSum: number; bSum: number; count: number }>();
  const regSums = {
    top: { r: 0, g: 0, b: 0, n: 0 },
    mid: { r: 0, g: 0, b: 0, n: 0 },
    bot: { r: 0, g: 0, b: 0, n: 0 }
  };

  const step = Math.max(1, Math.floor(Math.min(w, h) / 96));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];
      const a = imgData[i + 3];
      if (a < 45) continue;

      const distToCornerBg = Math.hypot(r - bgR, g - bgG, b - bgB);
      const isForeground = transparentBg || distToCornerBg > 26;
      if (!isForeground) continue;

      fgCount++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const qr = Math.round(r / 32) * 32;
      const qg = Math.round(g / 32) * 32;
      const qb = Math.round(b / 32) * 32;
      const key = `${qr}_${qg}_${qb}`;
      const hit = buckets.get(key);
      if (hit) {
        hit.rSum += r;
        hit.gSum += g;
        hit.bSum += b;
        hit.count++;
      } else {
        buckets.set(key, { rSum: r, gSum: g, bSum: b, count: 1 });
      }

      const relY = y / h;
      const targetReg = relY < 0.33 ? regSums.top : relY < 0.67 ? regSums.mid : regSums.bot;
      targetReg.r += r;
      targetReg.g += g;
      targetReg.b += b;
      targetReg.n++;
    }
  }

  const sortedClusters = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 7)
    .map((c) => rgbToHex(c.rSum / c.count, c.gSum / c.count, c.bSum / c.count));

  const dominantColors = sortedClusters.length > 0 ? sortedClusters : ['#d4d4d8', '#52525b'];
  const avgHex = (reg: { r: number; g: number; b: number; n: number }, fallback: string) =>
    reg.n > 0 ? rgbToHex(reg.r / reg.n, reg.g / reg.n, reg.b / reg.n) : fallback;

  const subjectW = fgCount > 16 && maxX > minX ? maxX - minX : w;
  const subjectH = fgCount > 16 && maxY > minY ? maxY - minY : h;
  const subjectAspectWH = Number((subjectW / Math.max(1, subjectH)).toFixed(3));

  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d')!;
  outCtx.fillStyle = '#242429';
  outCtx.fillRect(0, 0, w, h);
  outCtx.drawImage(rawCanvas, 0, 0);
  const dataUrl = outCanvas.toDataURL('image/jpeg', 0.88);

  return {
    id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: file.name || 'referencia.jpg',
    dataUrl,
    width: w,
    height: h,
    subjectAspectWH,
    dominantColors,
    regionColors: {
      top: avgHex(regSums.top, dominantColors[0]),
      middle: avgHex(regSums.mid, dominantColors[0]),
      bottom: avgHex(regSums.bot, dominantColors[dominantColors.length - 1] || dominantColors[0])
    }
  };
}

function buildReferenceTelemetrySummary(refs: ReferenceImageAttachment[]): string {
  if (refs.length === 0) return '';
  return refs
    .map(
      (r, i) =>
        `- Reference Image #${i + 1} ("${r.name}", ${r.width}x${r.height}px): ` +
        `Measured silhouette width/height ratio = ${r.subjectAspectWH}; ` +
        `Pixel-sampled HEX palette = [${r.dominantColors.join(', ')}]; ` +
        `Top=${r.regionColors.top}, Middle=${r.regionColors.middle}, Bottom=${r.regionColors.bottom}.`
    )
    .join('\n');
}

function buildMultimodalContent(text: string, imageUrls: string[]): string | ORContentPart[] {
  if (!imageUrls || imageUrls.length === 0) return text;
  const parts: ORContentPart[] = [{ type: 'text', text }];
  for (const url of imageUrls) {
    if (url && url.startsWith('data:image/')) {
      parts.push({ type: 'image_url', image_url: { url } });
    }
  }
  return parts;
}

// World-class frontier model priority lists on OpenRouter
const FRONTIER_VISION_ARCHITECT_MODELS = [
  'google/gemini-2.5-pro',
  'anthropic/claude-sonnet-4.5',
  'openai/gpt-5',
  'openai/gpt-4.1',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-3.5-sonnet',
  'x-ai/grok-4',
  'openai/gpt-4o',
  'google/gemini-2.5-flash'
];

const FRONTIER_MASTER_3D_BUILDER_MODELS = [
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-opus-4.1',
  'google/gemini-2.5-pro',
  'openai/gpt-5',
  'openai/gpt-4.1',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-3.5-sonnet',
  'x-ai/grok-4',
  'x-ai/grok-3',
  'deepseek/deepseek-chat-v3-0324',
  'openai/gpt-4o',
  'google/gemini-2.5-flash'
];

/**
 * Mode 1: "IA" — Pure Q&A & Visual Reference Analyst (never modifies the 3D scene)
 */
export async function askModixIA(
  userPrompt: string,
  history: ChatHistoryItem[],
  engine: ModixEngine,
  referenceImages: ReferenceImageAttachment[] = []
): Promise<string> {
  const sceneSummary = engine.getSceneSummaryForAI();
  const refSummary = buildReferenceTelemetrySummary(referenceImages);
  const lang = getActiveLanguageInfo();

  const sysPrompt = `You are the official AI Assistant of Modix 3D (professional landscape 3D & Mesh modeling, sculpting, PBR painting, and animation studio).
In this mode ("IA"), you ONLY answer questions, analyze reference images, explain topology, mesh modeling, sculpting, PBR texturing, and universal 3D exports (.OBJ, .GLB, .GLTF, .USDZ, .STL, .PLY, .DAE), or inspect the current scene.
Do NOT use emojis in your responses.
NEVER translate or alter the app name "Modix" or "Modix 3D".
Do NOT pretend to modify the scene in this mode (if the user asks to automatically build/edit in the 3D scene, explain that switching the selector above to "Agente" lets the Multi-AI 3D & Mesh team build it directly).
Respond in ${lang.enName} (${lang.nativeName}, code "${lang.code}").

Current 3D scene state (Z-up, where Z is height):
${sceneSummary}`;

  const recent: ORMessage[] = history.slice(-6).map((h) => ({
    role: h.role,
    content: h.content
  }));

  const fullUserText = refSummary
    ? `${userPrompt || 'Analyze these reference images for 3D & Mesh modeling.'}\n\nAttached Reference Telemetry:\n${refSummary}`
    : userPrompt;

  const { content } = await callOpenRouterChat(
    [
      { role: 'system', content: sysPrompt },
      ...recent,
      {
        role: 'user',
        content: buildMultimodalContent(
          fullUserText,
          referenceImages.map((r) => r.dataUrl)
        )
      }
    ],
    [
      'anthropic/claude-sonnet-4.5',
      'google/gemini-2.5-pro',
      'openai/gpt-4.1',
      'google/gemini-2.5-flash',
      'openai/gpt-4o'
    ],
    {
      temperature: 0.35,
      maxTokens: 2600,
      requiresVision: referenceImages.length > 0
    }
  );
  return content;
}

// ============================================================================
// Mode 2: "Agente" — Frontier Multi-AI Unified Mesh + 3D Master Engine
// ============================================================================

interface AgentAction {
  op:
    | 'clear_meshes'
    | 'create_group'
    | 'add_organic_mesh'
    | 'add_sdf_mesh'
    | 'add_unified_mesh'
    | 'fuse_to_mesh'
    | 'add_primitive'
    | 'add_loft_mesh'
    | 'add_tube_sweep'
    | 'add_extruded_polygon'
    | 'add_lathe'
    | 'mirror_object'
    | 'transform_object'
    | 'rename_object'
    | 'delete_object'
    | 'duplicate_object'
    | 'paint_material'
    | 'apply_procedural_texture'
    | 'generate_custom_texture'
    | 'slice_mesh'
    | 'deform_mesh'
    | 'join_objects'
    | 'group_objects';
  // Unified Smooth Connected Mesh (SDF + Surface Nets Quad Mesh)
  elements?: SDFElementSpec[];
  resolution?: number;
  defaultSmooth?: number;
  smooth?: number;
  // Common / Primitive fields
  shape?: PrimitiveType;
  name?: string;
  newName?: string;
  target?: string;
  targets?: string[];
  group?: string;
  groupName?: string;
  location?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  // Inline pro modifiers & bilateral symmetry on any newly created mesh
  mirrorX?: boolean;
  mirrorY?: boolean;
  subdivide?: number;
  bevel?: number;
  taper?: number;
  bendDeg?: number;
  twistDeg?: number;
  // Lofted hull fields
  sections?: LoftSectionSpec[];
  radialSegments?: number;
  subdivideLevels?: number;
  roundedCaps?: boolean;
  // 3D Tube / Curve Sweep fields
  path?: [number, number, number][];
  radii?: number | number[];
  aspectY?: number;
  closed?: boolean;
  tubularSamples?: number;
  // Extruded Polygon / Lathe fields
  points?: [number, number][];
  depth?: number;
  profile?: [number, number][];
  segments?: number;
  // Material & Paint fields
  color?: string;
  metallic?: number;
  roughness?: number;
  emissionColor?: string;
  emissionStrength?: number;
  opacity?: number;
  shadeSmooth?: boolean;
  // Texture fields
  preset?: ProceduralTexturePreset;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  uvProjection?: UVProjectionMode;
  repeatX?: number;
  repeatY?: number;
  description?: string;
  svg?: string;
  // Slice / Cut & Deform fields
  axis?: 'X' | 'Y' | 'Z' | 'CUSTOM';
  mode?: 'split' | 'keep_pos' | 'keep_neg';
  offset?: number;
  normal?: [number, number, number];
  gap?: number;
  deformType?: 'noise' | 'taper' | 'smooth' | 'bevel' | 'extrude_top' | 'bend' | 'twist';
  amount?: number;
}

interface AgentPlanPayload {
  reply: string;
  actions: AgentAction[];
}

interface InspectorVerdictPayload {
  needsRefinement: boolean;
  critique?: string;
  actions?: AgentAction[];
}

const VALID_SHAPES = new Set<string>([
  'cube', 'plane', 'grid', 'uv_sphere', 'ico_sphere', 'cylinder', 'hex_cylinder',
  'cone', 'pyramid', 'wedge', 'corner_wedge', 'prism', 'torus', 'torus_knot',
  'capsule', 'pipe', 'arch', 'stairs', 'star', 'gear', 'ring', 'crystal', 'heart', 'monkey'
]);

const VALID_PRESETS = new Set<string>([
  'studs', 'checker', 'brick', 'wood', 'metal', 'carbon', 'scifi',
  'grass', 'stone', 'lava', 'marble', 'stripes', 'gradient', 'noise'
]);

const VALID_SDF_TYPES = new Set<SDFElementKind>([
  'ellipsoid',
  'sphere',
  'capsule',
  'curve',
  'rounded_box',
  'torus',
  'cylinder'
]);

function extractJsonObject<T>(raw: string): T | null {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  const candidate = cleaned.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(candidate) as T;
  } catch {
    try {
      const fixed = candidate.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(fixed) as T;
    } catch {
      return null;
    }
  }
}

function extractPlanFromText(raw: string): AgentPlanPayload | null {
  const parsed = extractJsonObject<{ reply?: unknown; actions?: unknown }>(raw);
  if (parsed && Array.isArray(parsed.actions)) {
    return {
      reply:
        typeof parsed.reply === 'string'
          ? parsed.reply
          : tr('Cena 3D atualizada pelo Agente.'),
      actions: parsed.actions as AgentAction[]
    };
  }
  return null;
}

async function generateTextureSvgViaArtistAI(
  description: string,
  referenceImages: ReferenceImageAttachment[] = []
): Promise<string> {
  const sys = `You are a master 2D PBR & 3D Surface Texture SVG Artist.
Return ONLY a complete, valid, high-detail 512x512 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">...</svg> with NO markdown fences and NO explanations.
Fill the entire 512x512 background first using exact colors from the reference images if provided, then layer crisp panels, decals, emblems, eyes/visor details, seam lines, gradients, highlights, and surface micro-detail matching the requested 3D part.`;

  const refPaletteNote =
    referenceImages.length > 0
      ? `\nMatch the exact visual markings and hex colors from the attached reference image(s): ${referenceImages
          .flatMap((r) => r.dominantColors)
          .slice(0, 8)
          .join(', ')}.`
      : '';

  const { content } = await callOpenRouterChat(
    [
      { role: 'system', content: sys },
      {
        role: 'user',
        content: buildMultimodalContent(
          `Create a detailed 512x512 texture SVG for: ${description}.${refPaletteNote}`,
          referenceImages.slice(0, 2).map((r) => r.dataUrl)
        )
      }
    ],
    ['anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash', 'openai/gpt-4o'],
    { temperature: 0.3, maxTokens: 2800, requiresVision: referenceImages.length > 0 }
  );
  return content;
}

function buildMasterBuilderSystemPrompt(langName: string, langCode: string): string {
  return `You are the Master 3D & Unified Mesh Sculptor AI (ZBrush DynaMesh + Blender Sub-D + Parametric 3D Studio grade) of Modix 3D.
You control the 3D geometry kernel directly by returning EXCLUSIVELY a valid JSON object:
{
  "reply": "Clear technical summary in ${langName} (${langCode}) — NO emojis — describing the unified connected Meshes and 3D parts created",
  "actions": [ ... ]
}

=====================================================================
1. EXACT COORDINATE SYSTEM OF MODIX 3D (RIGHT-HANDED Z-UP!)
=====================================================================
- X = Right (+) / Left (-). Plane X = 0 is the exact BILATERAL SYMMETRY plane!
- Y = Back (+) / Front (-). The FRONT of every character/vehicle/object MUST face -Y!
- Z = UP (+) / Down (-). The ground/floor grid is at Z = 0! (Lowest foot/base/wheel touches Z = 0).
- Scale of "add_primitive": primitives span local [-1, +1] before scale, so with "scale": [sx, sy, sz], world size is (2*sx, 2*sy, 2*sz).
- Coordinates of "add_organic_mesh", "add_loft_mesh", and "add_tube_sweep": all coordinates ("center", "from", "to", "points", "path") and radii ("radii", "r1", "r2", "rx", "ry", "size") are DIRECT WORLD METERS when location=[0,0,0] and scale=[1,1,1]!

=====================================================================
2. THE #1 SECRET TO GORGEOUS, CONNECTED, ROUNDED MESHES ("add_organic_mesh")
=====================================================================
NEVER stack disconnected primitive spheres/cylinders/cubes with ugly intersection seams when building organic, sculpted, rounded, or seamless forms!
Instead, use "add_organic_mesh" (Smooth Signed Distance Field + Surface Nets All-Quad Remesher + Newton Exact Surface Projection + Smooth Vertex-Color Blending)!
It melts and fillets all sub-volumes together into ONE LITERAL WATER-TIGHT, CONNECTED, ROUNDED, SEAMLESS QUAD MESH — just like ZBrush DynaMesh / Womp 3D!

"add_organic_mesh" syntax:
{
  "op": "add_organic_mesh",
  "name": "Corpo_Mesh",
  "group": "Personagem",
  "resolution": 64,
  "defaultSmooth": 0.13,
  "color": "#f59e0b",
  "roughness": 0.48,
  "metallic": 0.05,
  "elements": [
    // 1. "ellipsoid" / "sphere": smooth 3D volume (heads, craniums, cheeks, snouts, chests, hips, paws, pads)
    { "type": "ellipsoid", "center": [0, -0.03, 2.38], "radii": [0.46, 0.43, 0.42], "smooth": 0.16, "color": "#f59e0b" },
    { "type": "ellipsoid", "center": [0, -0.37, 2.25], "radii": [0.22, 0.20, 0.15], "smooth": 0.12, "color": "#fef3c7" },

    // 2. "capsule": tapered round-cone bone from -> to with r1 -> r2 (NECKS, TORSOS, ARMS, FOREARMS, THIGHS, SHINS, FINGERS, EARS, SNOUTS!)
    { "type": "capsule", "from": [0, 0, 1.80], "to": [0, -0.02, 2.15], "r1": 0.20, "r2": 0.17, "smooth": 0.16, "color": "#f59e0b" },
    { "type": "capsule", "from": [0, 0, 0.88], "to": [0, 0, 1.82], "r1": 0.40, "r2": 0.36, "smooth": 0.18, "color": "#f59e0b" },
    { "type": "capsule", "from": [0.34, 0, 1.72], "to": [0.72, -0.14, 1.20], "r1": 0.14, "r2": 0.10, "mirrorX": true, "smooth": 0.13, "color": "#f59e0b" },
    { "type": "capsule", "from": [0.21, 0, 0.90], "to": [0.24, -0.03, 0.14], "r1": 0.17, "r2": 0.12, "mirrorX": true, "smooth": 0.14, "color": "#f59e0b" },

    // 3. "curve": smooth 3D Catmull-Rom spline fused right into the mesh (TAILS, HORNS, TENTACLES, HAIR LOCKS, HANDLES, ARCHES!)
    { "type": "curve", "points": [[0, 0.32, 0.95], [0, 0.68, 1.08], [0, 0.92, 1.52], [0, 0.78, 1.88]], "radii": [0.15, 0.12, 0.08, 0.035], "smooth": 0.14, "color": "#d97706" },

    // 4. "rounded_box": beveled sleek hull block (ergonomic car bodies, visors, chests, armor plates, soles, cushions)
    //    { "type": "rounded_box", "center": [x,y,z], "size": [hx,hy,hz], "bevel": 0.08, "rotation": [rx,ry,rz], "smooth": 0.12 }

    // 5. "torus" & "cylinder": smooth collars, lips, eye rims, wheel arches
    //    { "type": "torus", "center": [x,y,z], "majorRadius": 0.25, "minorRadius": 0.06, "rotation": [rx,ry,rz], "smooth": 0.08 }
    //    { "type": "cylinder", "center": [x,y,z], "radius": 0.2, "height": 0.4, "bevel": 0.05, "rotation": [rx,ry,rz], "smooth": 0.08 }

    // 6. SMOOTH BOOLEAN CAVITIES ("mode": "subtract"): carve smooth eye sockets, mouth smiles, ear hollows, nostrils, vents, wheel wells!
    { "type": "ellipsoid", "mode": "subtract", "center": [0.17, -0.41, 2.43], "radii": [0.085, 0.06, 0.095], "mirrorX": true, "smooth": 0.04 },
    { "type": "ellipsoid", "mode": "subtract", "center": [0.28, -0.08, 2.86], "radii": [0.06, 0.05, 0.16], "mirrorX": true, "smooth": 0.03 }
  ]
}

=====================================================================
3. COMBINING UNIFIED MESHES + PRECISION 3D PARTS TOGETHER (HYBRID MASTERWORK!)
=====================================================================
To make models look 100% professional, combine Unified Connected Meshes ("add_organic_mesh") WITH crisp 3D parts in the SAME scene:
- Use 1 to 4 rich "add_organic_mesh" objects (each with 8 to 35 smoothly fused volumetric elements, resolution 60..76) for connected organic/sculpted structures:
  * e.g. Unified Body/Head/Limbs Mesh + Unified Sculpted Hair/Mane Mesh + Unified Organic Armor/Cloak/Saddle/Ergonomic Car Shell Mesh!
- Combine them with crisp 3D components fitted cleanly onto the Mesh surface (ZERO floating gaps!):
  * Glossy Eyes, Irises, Pupils & Cornea Highlights ("add_primitive" uv_sphere with mirrorX: true, roughness: 0.06, metallic: 0.1, placed snugly inside the carved eye sockets!);
  * Sharp Teeth, Claws, Horns, Blades, Crossguards ("add_loft_mesh" with spline interpolation & rounded caps, "add_tube_sweep", "add_extruded_polygon");
  * Collars, Rings, Pommels, Wheels, Thrusters, Crowns ("add_lathe" 360° revolution);
  * Mechanical Visors, Emblems, Buckles, Straps, Weapons, Pedestals ("add_primitive" with subdivide/bevel/mirrorX);
  * You can ALSO weld existing 3D parts into a unified smooth mesh anytime using:
    { "op": "fuse_to_mesh", "targets": ["PartA", "PartB"], "smooth": 0.09, "resolution": 62, "newName": "Fused_Mesh" }

=====================================================================
4. COMPLETE PARAMETRIC 3D TOOLKIT (WORKS ALONGSIDE "add_organic_mesh")
=====================================================================
- "add_loft_mesh": { "op": "add_loft_mesh", "name": "...", "sections": [{ "center": [x,y,z], "rx": 0.3, "ry": 0.2, "roundness": 0.5, "rotDeg": 0 }, ...], "radialSegments": 22, "subdivideLevels": 1, "mirrorX": false, "color": "#hex", "metallic": 0.7, "roughness": 0.25 }
  (Note: roundness=1.0 is smooth ellipse, 0.3..0.45 is sleek rounded squircle, 1.8..2.2 is sharp diamond blade edge; automatically spline-interpolated with rounded dome caps!)
- "add_tube_sweep": { "op": "add_tube_sweep", "name": "...", "path": [[x,y,z], ...], "radii": [0.12, 0.08, 0.02], "aspectY": 1.0, "radialSegments": 18, "mirrorX": true, "color": "#hex" }
- "add_extruded_polygon": { "op": "add_extruded_polygon", "name": "...", "points": [[x,y], ...], "depth": 0.16, "bevel": 0.05, "location": [x,y,z], "rotation": [rx,ry,rz], "mirrorX": false, "color": "#hex" }
- "add_lathe": { "op": "add_lathe", "name": "...", "profile": [[r, z], ...], "segments": 28, "location": [x,y,z], "rotation": [rx,ry,rz], "mirrorX": false, "color": "#hex" }
- "add_primitive": shapes = "cube", "plane", "grid", "uv_sphere", "ico_sphere", "cylinder", "hex_cylinder", "cone", "pyramid", "wedge", "corner_wedge", "prism", "torus", "torus_knot", "capsule", "pipe", "arch", "stairs", "star", "gear", "ring", "crystal", "heart", "monkey". Supports inline "mirrorX": true, "subdivide": 1..2, "bevel": 0.12, "taper": 0.5, "bendDeg": 25, "twistDeg": 30.
- Scene & Material ops: "clear_meshes", "create_group", "mirror_object", "transform_object", "rename_object", "delete_object", "duplicate_object", "paint_material", "apply_procedural_texture", "generate_custom_texture", "slice_mesh", "deform_mesh", "join_objects", "fuse_to_mesh", "group_objects".

=====================================================================
5. QUALITY & REFERENCE FIDELITY MANDATES
=====================================================================
1. CONNECTED & ROUNDED BY DEFAULT: Every organic joint (neck-to-head, neck-to-chest, shoulder-to-arm, hip-to-leg, hand-to-fingers, snout-to-face, ear-to-head, tail-to-pelvis) MUST be smoothly fused inside "add_organic_mesh" with appropriate "smooth" (0.06 to 0.22) so it forms ONE gorgeous seamless rounded Mesh!
2. EXACT PROPORTIONS & COLORS: When reference images are attached, match the measured width/height ratio and pixel-extracted #HEX colors faithfully.
3. ZERO FLOATING PIECES: Any separate 3D eye, horn, armor plate, buckle, blade, or wheel must overlap/seat 0.02..0.05m into the host surface.
4. NEVER use emojis. NEVER alter the brand name "Modix" or "Modix 3D". Return ONLY valid JSON.`;
}

export async function runModixMultiAgent(
  userPrompt: string,
  history: ChatHistoryItem[],
  engine: ModixEngine,
  onProgress: (badge: string, stepText: string) => void,
  referenceImages: ReferenceImageAttachment[] = []
): Promise<{ reply: string; steps: string[] }> {
  const stepsLog: string[] = [];
  const multiAI = isMultiAIEnabled();
  const hasRefs = referenceImages.length > 0;
  const refUrls = referenceImages.map((r) => r.dataUrl);
  const refTelemetry = buildReferenceTelemetrySummary(referenceImages);
  const sceneSummary = engine.getSceneSummaryForAI();
  const lang = getActiveLanguageInfo();

  const effectivePrompt =
    userPrompt.trim() ||
    (hasRefs
      ? 'Replicate the attached reference images in 3D as a connected, smooth, rounded Mesh combined with high-precision 3D details, proportions, and colors.'
      : 'Build a detailed, connected, smooth 3D Mesh model.');

  let architectBlueprint = '';

  // =========================================================================
  // STAGE 1: Specialist AI #1 — Frontier Vision & Unified Mesh Topology Architect
  // =========================================================================
  if (multiAI || hasRefs) {
    onProgress(
      hasRefs ? 'Vision & Mesh AI' : 'Mesh Architect AI',
      tr('Processando...')
    );

    const archSystem = `You are the Lead 3D Mesh Topology & Computer Vision Director of Modix 3D (Z-UP: X=left/right with X=0 symmetry plane, -Y=front/+Y=back, Z=height with floor at Z=0).
Design a complete anatomical & geometric blueprint (22 to 42 lines) so the Master Builder AI creates a GORGEOUS, SEAMLESSLY CONNECTED, ROUNDED UNIFIED MESH ("add_organic_mesh") combined harmoniously with crisp 3D parts ("add_loft_mesh", "add_tube_sweep", "add_extruded_polygon", "add_lathe", "add_primitive"):
1. METRIC Z-UP BOUNDING BOX: Total height Z=[0..H], width X, depth Y (front = -Y), matching any reference image aspect ratio.
2. UNIFIED CONNECTED MESH ANATOMY ("add_organic_mesh"): Specify which body/hull/organic structures must be fused into seamless smooth All-Quad SDF Meshes (listing exact "capsule" bones from->to with r1/r2, "ellipsoid" masses, "curve" splines, "rounded_box" shells, "subtract" cavities for eye sockets/mouths/grooves, "smooth" fillet radii 0.08..0.22, "mirrorX": true, and per-zone #HEX colors).
3. COMPLEMENTARY 3D DETAILS: Specify crisp separate 3D parts seated onto the mesh (glossy eyes/pupils, blades, guards, visors, buckles, wheels, crowns, armor trim, textures) with exact Z-up coordinates so ZERO parts float.
Do NOT use emojis.`;

    const archUserText = `User Request: "${effectivePrompt}"
${refTelemetry ? `\nMeasured Reference Image Telemetry:\n${refTelemetry}\n` : ''}
Current Scene JSON:
${sceneSummary}`;

    try {
      const archRes = await callOpenRouterChat(
        [
          { role: 'system', content: archSystem },
          { role: 'user', content: buildMultimodalContent(archUserText, refUrls) }
        ],
        FRONTIER_VISION_ARCHITECT_MODELS,
        {
          temperature: 0.2,
          maxTokens: 3200,
          requiresVision: hasRefs
        }
      );
      architectBlueprint = archRes.content;
      stepsLog.push(
        `Architect AI (${shortModel(archRes.modelUsed)})`
      );
    } catch {
      // Proceed directly to Master Builder if Stage 1 skips
    }
  }

  // =========================================================================
  // STAGE 2: Specialist AI #2 — Frontier Master Unified Mesh & 3D Sculptor
  // =========================================================================
  onProgress('Master Mesh & 3D AI', tr('Processando...'));

  const recentContext: ORMessage[] = history.slice(-4).map((h) => ({
    role: h.role,
    content: h.content
  }));

  const builderUserText = `User Request: "${effectivePrompt}"
${
  refTelemetry
    ? `\nATTACHED REFERENCE IMAGES (${referenceImages.length}) — MATCH SILHOUETTE, CONNECTED ROUNDED MESH FLOW, DETAILS, AND EXACT HEX COLORS:\n${refTelemetry}\n`
    : ''
}
Current Scene JSON:
${sceneSummary}
${
  architectBlueprint
    ? `\n3D & Unified Mesh Topological Blueprint from Architect AI:\n${architectBlueprint}\n`
    : ''
}
Generate the complete JSON { "reply": "...", "actions": [ ... ] } now.
Remember:
- Use "add_organic_mesh" (with smooth-welded capsules, ellipsoids, curves, rounded_boxes, subtract cavities, mirrorX: true, and resolution 60..74) so organic/sculpted bodies, heads, limbs, creatures, or rounded shells become ONE LITERAL CONNECTED, ROUNDED, SEAMLESS MESH!
- Combine with "add_loft_mesh", "add_tube_sweep", "add_extruded_polygon", "add_lathe", and "add_primitive" for crisp 3D eyes, accessories, blades, visors, wheels, or mechanical parts!
- Write "reply" in ${lang.enName} (${lang.nativeName}).`;

  const builderRes = await callOpenRouterChat(
    [
      {
        role: 'system',
        content: buildMasterBuilderSystemPrompt(lang.enName, lang.code)
      },
      ...recentContext,
      { role: 'user', content: buildMultimodalContent(builderUserText, refUrls) }
    ],
    FRONTIER_MASTER_3D_BUILDER_MODELS,
    {
      temperature: 0.2,
      maxTokens: 14000,
      requiresVision: hasRefs
    }
  );

  const plan = extractPlanFromText(builderRes.content);
  if (!plan) {
    return {
      reply: builderRes.content,
      steps: [...stepsLog, `Direct (${shortModel(builderRes.modelUsed)})`]
    };
  }

  stepsLog.push(
    `Master 3D AI (${shortModel(builderRes.modelUsed)}): ${plan.actions.length} ops`
  );

  // =========================================================================
  // STAGE 3: Specialist AI #3 — Reference-Guided 512x512 Texture Artist AI
  // =========================================================================
  const preRenderedCustomTextures = await synthesizeCustomTexturesForActions(
    plan.actions,
    effectivePrompt,
    referenceImages,
    onProgress,
    stepsLog
  );

  // Save ONE atomic Undo snapshot covering initial build + Stage 4 visual inspection pass
  engine.pushUndoSnapshot();
  const origPushUndo = engine.pushUndoSnapshot.bind(engine);
  engine.pushUndoSnapshot = () => {};

  let totalExecuted = 0;
  const finalReply = plan.reply;

  try {
    onProgress('Modix 3D Kernel', tr('Processando...'));
    totalExecuted += executeAgentActionsInternal(engine, plan.actions, preRenderedCustomTextures);
    engine.frameAllMeshes();

    // =========================================================================
    // STAGE 4: Specialist AI #4 — Visual 3D Inspector (3-Angle Render QA Loop!)
    // Runs both when references are attached AND on complex multi-AI builds!
    // =========================================================================
    if (multiAI && engine.state.objects.some((o) => o.kind === 'MESH')) {
      const inspectionSheetUrl = engine.captureMultiViewInspectionDataURL();
      if (inspectionSheetUrl) {
        onProgress('3D Inspector AI', tr('Processando...'));

        try {
          const updatedSceneJson = engine.getSceneSummaryForAI();
          const inspectorSystem = `You are the Visual 3D & Mesh Quality Inspector AI of Modix 3D.
You receive:
${hasRefs ? '1. The user’s original REFERENCE IMAGES;\n2. The last image showing' : '1. An image showing'} the 3-ANGLE RENDERED INSPECTION SHEET (FRONT -Y, SIDE +X, 3/4 HERO) of the 3D model currently in the viewport;
- Plus the exact JSON scene summary with worldBounds [minX..maxX, minY..maxY, minZ..maxZ].

Inspect rigorously:
- Are any pieces floating, disconnected, misaligned, or rotated on the wrong axis?
- Did any part that should be a smooth, rounded, connected Mesh look blocky or detached? (You can fix/replace it with "add_organic_mesh" or weld pieces together with "fuse_to_mesh"!)
- Are key details missing (eyes/pupils, ears, horns, tail, mouth/visor, trim, secondary colors) or proportions off?

Return EXCLUSIVELY pure JSON:
{
  "needsRefinement": true | false,
  "critique": "Short technical note without emojis",
  "actions": [ ... surgical Modix 3D actions (transform_object, add_organic_mesh, fuse_to_mesh, add_loft_mesh, add_tube_sweep, add_primitive with mirrorX, paint_material, delete_object, deform_mesh). NEVER use clear_meshes here! ... ]
}
If the 3D & Mesh model already looks cohesive, connected, rounded, and accurate, return { "needsRefinement": false, "actions": [] }.`;

          const inspectorImages = hasRefs
            ? [...refUrls.slice(0, 4), inspectionSheetUrl]
            : [inspectionSheetUrl];

          const inspectorUserText = `User Request: "${effectivePrompt}"
${
  hasRefs
    ? `First ${Math.min(4, refUrls.length)} image(s) = USER REFERENCES. LAST image (FRONT / SIDE / 3/4 HERO) = CURRENT 3D RENDER.`
    : `Attached image (FRONT / SIDE / 3/4 HERO) = CURRENT 3D RENDER.`
}

Current scene objects (Z-up, front = -Y):
${updatedSceneJson}`;

          const inspRes = await callOpenRouterChat(
            [
              { role: 'system', content: inspectorSystem },
              { role: 'user', content: buildMultimodalContent(inspectorUserText, inspectorImages) }
            ],
            FRONTIER_VISION_ARCHITECT_MODELS,
            {
              temperature: 0.16,
              maxTokens: 6000,
              requiresVision: true
            }
          );

          const verdict = extractJsonObject<InspectorVerdictPayload>(inspRes.content);
          const refineActions = Array.isArray(verdict?.actions)
            ? verdict!.actions.filter((a) => a.op !== 'clear_meshes')
            : [];

          if (verdict?.needsRefinement && refineActions.length > 0) {
            onProgress('3D Refinement', tr('Processando...'));
            const extraTex = await synthesizeCustomTexturesForActions(
              refineActions,
              effectivePrompt,
              referenceImages,
              onProgress,
              stepsLog
            );
            const refinedCount = executeAgentActionsInternal(engine, refineActions, extraTex);
            totalExecuted += refinedCount;
            engine.frameAllMeshes();
            stepsLog.push(
              `Inspector AI (${shortModel(inspRes.modelUsed)}): +${refinedCount} refinements`
            );
          } else {
            stepsLog.push(`Inspector AI (${shortModel(inspRes.modelUsed)}): verified`);
          }
        } catch {
          // Non-fatal if visual inspection pass skips
        }
      }
    }
  } finally {
    engine.pushUndoSnapshot = origPushUndo;
  }

  stepsLog.push(`Modix 3D: ${totalExecuted} ops`);

  return {
    reply: finalReply,
    steps: stepsLog
  };
}

async function synthesizeCustomTexturesForActions(
  actions: AgentAction[],
  fallbackPrompt: string,
  referenceImages: ReferenceImageAttachment[],
  onProgress: (badge: string, stepText: string) => void,
  stepsLog: string[]
): Promise<Map<AgentAction, string>> {
  const customTexActions = actions.filter((a) => a.op === 'generate_custom_texture');
  const map = new Map<AgentAction, string>();
  if (customTexActions.length === 0) return map;

  onProgress('Texture AI', tr('Processando...'));
  await Promise.all(
    customTexActions.map(async (act) => {
      try {
        const svgCode =
          act.svg && act.svg.includes('<svg')
            ? act.svg
            : await generateTextureSvgViaArtistAI(
                act.description || fallbackPrompt,
                referenceImages
              );
        const pngUrl = await renderSVGToTextureDataUrl(svgCode, 512);
        map.set(act, pngUrl);
      } catch {
        map.set(act, generateProceduralTextureDataUrl({ preset: 'scifi', size: 512 }));
      }
    })
  );
  stepsLog.push(`Texture AI: ${customTexActions.length}x 512px`);
  return map;
}

function resolveTargets(engine: ModixEngine, target?: string): SceneObjectData[] {
  if (!target || target === 'SELECTED') {
    const sel = engine.state.objects.filter(
      (o) => engine.state.selectedIds.includes(o.id) && o.kind === 'MESH'
    );
    if (sel.length > 0) return sel;
    const act = engine.getActiveObject();
    return act && act.kind === 'MESH' ? [act] : [];
  }
  if (target === 'ALL') {
    return engine.state.objects.filter((o) => o.kind === 'MESH');
  }
  const hit = engine.findObjectByNameOrId(target);
  return hit ? [hit] : [];
}

function toVec3(val: unknown, fallback: [number, number, number]): [number, number, number] {
  if (Array.isArray(val) && val.length >= 3) {
    return [
      Number.isFinite(Number(val[0])) ? Number(val[0]) : fallback[0],
      Number.isFinite(Number(val[1])) ? Number(val[1]) : fallback[1],
      Number.isFinite(Number(val[2])) ? Number(val[2]) : fallback[2]
    ];
  }
  return [...fallback];
}

function normalizeSDFElement(raw: Partial<SDFElementSpec>): SDFElementSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const rawType = String(raw.type || 'ellipsoid').toLowerCase() as SDFElementKind;
  const type: SDFElementKind = VALID_SDF_TYPES.has(rawType) ? rawType : 'ellipsoid';
  const mode =
    raw.mode === 'subtract'
      ? 'subtract'
      : raw.mode === 'intersect'
        ? 'intersect'
        : 'union';

  return {
    type,
    mode,
    smooth: typeof raw.smooth === 'number' ? raw.smooth : undefined,
    center: raw.center ? toVec3(raw.center, [0, 0, 0]) : undefined,
    radii: raw.radii,
    radius: typeof raw.radius === 'number' ? raw.radius : undefined,
    size: raw.size ? toVec3(raw.size, [0.3, 0.3, 0.3]) : undefined,
    height: typeof raw.height === 'number' ? raw.height : undefined,
    bevel: typeof raw.bevel === 'number' ? raw.bevel : undefined,
    majorRadius: typeof raw.majorRadius === 'number' ? raw.majorRadius : undefined,
    minorRadius: typeof raw.minorRadius === 'number' ? raw.minorRadius : undefined,
    from: raw.from ? toVec3(raw.from, [0, 0, 0]) : undefined,
    to: raw.to ? toVec3(raw.to, [0, 0, 0.5]) : undefined,
    r1: typeof raw.r1 === 'number' ? raw.r1 : undefined,
    r2: typeof raw.r2 === 'number' ? raw.r2 : undefined,
    points: Array.isArray(raw.points)
      ? raw.points.map((pt) => toVec3(pt, [0, 0, 0]))
      : undefined,
    rotation: raw.rotation ? toVec3(raw.rotation, [0, 0, 0]) : undefined,
    mirrorX: Boolean(raw.mirrorX),
    mirrorY: Boolean(raw.mirrorY),
    color: typeof raw.color === 'string' ? raw.color : undefined
  };
}

function applyInlineModifiersAndSymmetry(
  engine: ModixEngine,
  obj: SceneObjectData,
  act: AgentAction,
  newlyCreatedIds: string[]
): number {
  let extraCount = 0;
  if (obj.mesh) {
    if (typeof act.taper === 'number' && Number.isFinite(act.taper)) {
      obj.mesh = taperMeshZ(obj.mesh, act.taper);
    }
    if (typeof act.bevel === 'number' && act.bevel > 0) {
      const faces = obj.mesh.faces.map((_, idx) => idx).slice(0, 24);
      obj.mesh = bevelFaces(obj.mesh, faces, Math.min(0.4, act.bevel)).mesh;
    }
    if (typeof act.subdivide === 'number' && act.subdivide > 0) {
      obj.mesh = catmullClarkSubdivide(obj.mesh, Math.min(2, Math.round(act.subdivide)));
      obj.mesh.shadeSmooth = true;
    }
    if (typeof act.bendDeg === 'number' && Math.abs(act.bendDeg) > 0.5) {
      obj.mesh = bendMeshZ(obj.mesh, act.bendDeg);
    }
    if (typeof act.twistDeg === 'number' && Math.abs(act.twistDeg) > 0.5) {
      obj.mesh = twistMeshZ(obj.mesh, act.twistDeg);
    }
    if (typeof act.shadeSmooth === 'boolean') {
      obj.mesh.shadeSmooth = act.shadeSmooth;
    }
  }

  if (act.mirrorX) {
    const mirrored = engine.mirrorObjectAcrossAxis(obj.id, 'X');
    if (mirrored) {
      newlyCreatedIds.push(mirrored.id);
      extraCount++;
    }
  }
  if (act.mirrorY) {
    const mirroredY = engine.mirrorObjectAcrossAxis(obj.id, 'Y');
    if (mirroredY) {
      newlyCreatedIds.push(mirroredY.id);
      extraCount++;
    }
  }
  return extraCount;
}

function assignGroupAndMaterial(
  engine: ModixEngine,
  obj: SceneObjectData,
  act: AgentAction,
  preserveWhiteForVertexColors = false
): void {
  if (act.group) {
    if (!engine.state.collections.some((c) => c.name === act.group)) {
      engine.createCollection(act.group);
    }
    obj.collection = act.group;
  }
  if (act.location) obj.location = toVec3(act.location, obj.location);
  if (act.rotation) obj.rotationDeg = toVec3(act.rotation, obj.rotationDeg);
  if (act.scale) obj.scale = toVec3(act.scale, obj.scale);
  if (preserveWhiteForVertexColors) {
    obj.material.baseColor = '#ffffff';
  } else if (act.color) {
    obj.material.baseColor = act.color;
  }
  if (typeof act.metallic === 'number') obj.material.metallic = clamp01(act.metallic);
  if (typeof act.roughness === 'number') obj.material.roughness = clamp01(act.roughness);
  if (act.emissionColor) obj.material.emissionColor = act.emissionColor;
  if (typeof act.emissionStrength === 'number') {
    obj.material.emissionStrength = Math.max(0, act.emissionStrength);
  }
  if (typeof act.opacity === 'number') obj.material.opacity = clamp01(act.opacity);
}

function executeAgentActionsInternal(
  engine: ModixEngine,
  actions: AgentAction[],
  customTextures: Map<AgentAction, string>
): number {
  if (actions.length === 0) return 0;

  let count = 0;
  const newlyCreatedIds: string[] = [];

  for (const act of actions) {
    switch (act.op) {
      case 'clear_meshes': {
        engine.clearAllMeshObjects();
        count++;
        break;
      }

      case 'create_group': {
        if (act.name) {
          engine.createCollection(act.name, act.color);
          count++;
        }
        break;
      }

      case 'add_organic_mesh':
      case 'add_sdf_mesh':
      case 'add_unified_mesh': {
        if (Array.isArray(act.elements) && act.elements.length > 0) {
          const validEls = act.elements
            .map((e) => normalizeSDFElement(e))
            .filter((e): e is SDFElementSpec => Boolean(e));
          if (validEls.length > 0) {
            const mesh = createUnifiedSDFMesh({
              elements: validEls,
              resolution: act.resolution ?? 62,
              defaultSmooth: act.defaultSmooth ?? act.smooth ?? 0.12,
              baseColor: act.color || '#cbd5e1'
            });
            const hasVC = Boolean(mesh.vertexColors && mesh.vertexColors.length > 0);
            const obj = engine.addImportedMesh(
              act.name || 'UnifiedMesh',
              mesh,
              {
                baseColor: hasVC ? '#ffffff' : act.color || '#cbd5e1',
                metallic: typeof act.metallic === 'number' ? clamp01(act.metallic) : 0.08,
                roughness: typeof act.roughness === 'number' ? clamp01(act.roughness) : 0.46,
                emissionColor: act.emissionColor || '#000000',
                emissionStrength: Number(act.emissionStrength) || 0,
                opacity: typeof act.opacity === 'number' ? clamp01(act.opacity) : 1
              },
              act.location ? toVec3(act.location, [0, 0, 0]) : [0, 0, 0]
            );
            const cleanAct = { ...act, subdivide: undefined };
            assignGroupAndMaterial(engine, obj, cleanAct, hasVC);
            newlyCreatedIds.push(obj.id);
            count += 1 + applyInlineModifiersAndSymmetry(engine, obj, cleanAct, newlyCreatedIds);
          }
        }
        break;
      }

      case 'fuse_to_mesh': {
        let ids: string[] = [];
        if (Array.isArray(act.targets) && act.targets.length > 0) {
          if (act.targets.includes('ALL')) {
            ids = engine.state.objects.filter((o) => o.kind === 'MESH').map((o) => o.id);
          } else {
            ids = act.targets
              .map((n) => engine.findObjectByNameOrId(n)?.id)
              .filter((x): x is string => Boolean(x));
          }
        } else if (act.target) {
          ids = resolveTargets(engine, act.target).map((o) => o.id);
        }
        if (ids.length >= 1) {
          const fused = engine.fuseObjectsToSmoothMesh(
            ids,
            act.smooth ?? act.defaultSmooth ?? 0.09,
            act.resolution ?? 60,
            act.newName || act.name
          );
          if (fused) {
            newlyCreatedIds.push(fused.id);
            count++;
          }
        }
        break;
      }

      case 'add_primitive': {
        const shape: PrimitiveType = VALID_SHAPES.has(String(act.shape))
          ? (act.shape as PrimitiveType)
          : 'cube';
        const obj = engine.addPrimitive(shape);
        if (act.name) obj.name = engine.makeUniqueName(act.name, obj.id);
        assignGroupAndMaterial(engine, obj, act);
        newlyCreatedIds.push(obj.id);
        count += 1 + applyInlineModifiersAndSymmetry(engine, obj, act, newlyCreatedIds);
        break;
      }

      case 'add_loft_mesh': {
        if (Array.isArray(act.sections) && act.sections.length >= 2) {
          const validSections: LoftSectionSpec[] = act.sections.map((s) => ({
            center: toVec3(s?.center, [0, 0, 0]),
            rx: Math.max(0.004, Number(s?.rx) || 0.25),
            ry: Math.max(0.004, Number(s?.ry) || 0.25),
            roundness: typeof s?.roundness === 'number' ? s.roundness : 1.0,
            rotDeg: typeof s?.rotDeg === 'number' ? s.rotDeg : 0
          }));
          const mesh = createLoftedSectionsMesh(validSections, {
            radialSegments: act.radialSegments ?? 20,
            subdivideLevels: act.subdivideLevels ?? act.subdivide ?? 0,
            roundedCaps: act.roundedCaps !== false,
            shadeSmooth: act.shadeSmooth !== false
          });
          const obj = engine.addImportedMesh(
            act.name || 'LoftPart',
            mesh,
            {
              baseColor: act.color || '#cbd5e1',
              metallic: typeof act.metallic === 'number' ? clamp01(act.metallic) : 0.15,
              roughness: typeof act.roughness === 'number' ? clamp01(act.roughness) : 0.45,
              emissionColor: act.emissionColor || '#000000',
              emissionStrength: Number(act.emissionStrength) || 0,
              opacity: typeof act.opacity === 'number' ? clamp01(act.opacity) : 1
            },
            act.location ? toVec3(act.location, [0, 0, 0]) : [0, 0, 0]
          );
          const cleanAct = { ...act, subdivide: undefined };
          assignGroupAndMaterial(engine, obj, cleanAct);
          newlyCreatedIds.push(obj.id);
          count += 1 + applyInlineModifiersAndSymmetry(engine, obj, cleanAct, newlyCreatedIds);
        }
        break;
      }

      case 'add_tube_sweep': {
        if (Array.isArray(act.path) && act.path.length >= 2) {
          const cleanPath: [number, number, number][] = act.path.map((p) => toVec3(p, [0, 0, 0]));
          const mesh = createTubeSweepMesh(cleanPath, act.radii ?? 0.12, {
            radialSegments: act.radialSegments ?? 18,
            tubularSamples: act.tubularSamples,
            closed: Boolean(act.closed),
            aspectY: act.aspectY ?? 1,
            shadeSmooth: act.shadeSmooth !== false
          });
          const obj = engine.addImportedMesh(
            act.name || 'SweepPart',
            mesh,
            {
              baseColor: act.color || '#cbd5e1',
              metallic: typeof act.metallic === 'number' ? clamp01(act.metallic) : 0.15,
              roughness: typeof act.roughness === 'number' ? clamp01(act.roughness) : 0.45,
              emissionColor: act.emissionColor || '#000000',
              emissionStrength: Number(act.emissionStrength) || 0,
              opacity: typeof act.opacity === 'number' ? clamp01(act.opacity) : 1
            },
            act.location ? toVec3(act.location, [0, 0, 0]) : [0, 0, 0]
          );
          assignGroupAndMaterial(engine, obj, act);
          newlyCreatedIds.push(obj.id);
          count += 1 + applyInlineModifiersAndSymmetry(engine, obj, act, newlyCreatedIds);
        }
        break;
      }

      case 'add_extruded_polygon': {
        if (Array.isArray(act.points) && act.points.length >= 3) {
          const pts: [number, number][] = act.points.map((p) => [
            Number(p[0]) || 0,
            Number(p[1]) || 0
          ]);
          const mesh = createExtrudedPolygonMesh(
            pts,
            Number(act.depth) || 0.4,
            Boolean(act.shadeSmooth)
          );
          const obj = engine.addImportedMesh(
            act.name || 'ExtrudedPart',
            mesh,
            {
              baseColor: act.color || '#cbd5e1',
              metallic: typeof act.metallic === 'number' ? clamp01(act.metallic) : 0.15,
              roughness: typeof act.roughness === 'number' ? clamp01(act.roughness) : 0.45,
              emissionColor: act.emissionColor || '#000000',
              emissionStrength: Number(act.emissionStrength) || 0,
              opacity: typeof act.opacity === 'number' ? clamp01(act.opacity) : 1
            },
            act.location ? toVec3(act.location, [0, 0, 0]) : [0, 0, 0]
          );
          assignGroupAndMaterial(engine, obj, act);
          newlyCreatedIds.push(obj.id);
          count += 1 + applyInlineModifiersAndSymmetry(engine, obj, act, newlyCreatedIds);
        }
        break;
      }

      case 'add_lathe': {
        if (Array.isArray(act.profile) && act.profile.length >= 2) {
          const prof: [number, number][] = act.profile.map((p) => [
            Math.max(0, Number(p[0]) || 0),
            Number(p[1]) || 0
          ]);
          const mesh = createLatheMesh(
            prof,
            Math.min(48, Math.max(8, Number(act.segments) || 24)),
            act.shadeSmooth !== false
          );
          const obj = engine.addImportedMesh(
            act.name || 'LathePart',
            mesh,
            {
              baseColor: act.color || '#e2e8f0',
              metallic: typeof act.metallic === 'number' ? clamp01(act.metallic) : 0.1,
              roughness: typeof act.roughness === 'number' ? clamp01(act.roughness) : 0.4,
              emissionColor: act.emissionColor || '#000000',
              emissionStrength: Number(act.emissionStrength) || 0,
              opacity: typeof act.opacity === 'number' ? clamp01(act.opacity) : 1
            },
            act.location ? toVec3(act.location, [0, 0, 0]) : [0, 0, 0]
          );
          assignGroupAndMaterial(engine, obj, act);
          newlyCreatedIds.push(obj.id);
          count += 1 + applyInlineModifiersAndSymmetry(engine, obj, act, newlyCreatedIds);
        }
        break;
      }

      case 'mirror_object': {
        for (const t of resolveTargets(engine, act.target)) {
          const axis = act.axis === 'Y' ? 'Y' : act.axis === 'Z' ? 'Z' : 'X';
          const mirrored = engine.mirrorObjectAcrossAxis(t.id, axis, act.newName);
          if (mirrored) {
            newlyCreatedIds.push(mirrored.id);
            count++;
          }
        }
        break;
      }

      case 'transform_object': {
        for (const t of resolveTargets(engine, act.target)) {
          if (act.location) t.location = toVec3(act.location, t.location);
          if (act.rotation) t.rotationDeg = toVec3(act.rotation, t.rotationDeg);
          if (act.scale) t.scale = toVec3(act.scale, t.scale);
          count++;
        }
        break;
      }

      case 'rename_object': {
        const hit = act.target ? engine.findObjectByNameOrId(act.target) : engine.getActiveObject();
        if (hit && act.newName) {
          engine.renameObject(hit.id, act.newName);
          count++;
        }
        break;
      }

      case 'delete_object': {
        const targets = resolveTargets(engine, act.target);
        if (targets.length > 0) {
          engine.state.selectedIds = targets.map((t) => t.id);
          engine.deleteSelected();
          count++;
        }
        break;
      }

      case 'duplicate_object': {
        const hit = act.target ? engine.findObjectByNameOrId(act.target) : engine.getActiveObject();
        if (hit) {
          engine.selectObject(hit.id, false);
          engine.duplicateSelected();
          const dup = engine.getActiveObject();
          if (dup) {
            if (act.newName) engine.renameObject(dup.id, act.newName);
            if (act.location) dup.location = toVec3(act.location, dup.location);
            if (act.rotation) dup.rotationDeg = toVec3(act.rotation, dup.rotationDeg);
            if (act.scale) dup.scale = toVec3(act.scale, dup.scale);
            newlyCreatedIds.push(dup.id);
          }
          count++;
        }
        break;
      }

      case 'paint_material': {
        for (const obj of resolveTargets(engine, act.target)) {
          if (act.color) {
            obj.material.baseColor = act.color;
            if (obj.mesh?.vertexColors) {
              obj.mesh.vertexColors = undefined;
            }
          }
          if (typeof act.metallic === 'number') obj.material.metallic = clamp01(act.metallic);
          if (typeof act.roughness === 'number') obj.material.roughness = clamp01(act.roughness);
          if (act.emissionColor) obj.material.emissionColor = act.emissionColor;
          if (typeof act.emissionStrength === 'number') {
            obj.material.emissionStrength = Math.max(0, act.emissionStrength);
          }
          if (typeof act.opacity === 'number') obj.material.opacity = clamp01(act.opacity);
          if (typeof act.shadeSmooth === 'boolean' && obj.mesh) {
            obj.mesh.shadeSmooth = act.shadeSmooth;
          }
          count++;
        }
        break;
      }

      case 'apply_procedural_texture': {
        const preset: ProceduralTexturePreset = VALID_PRESETS.has(String(act.preset))
          ? (act.preset as ProceduralTexturePreset)
          : 'studs';
        const url = generateProceduralTextureDataUrl({
          preset,
          primaryColor: act.primaryColor || act.color,
          secondaryColor: act.secondaryColor,
          accentColor: act.accentColor,
          size: 512
        });
        for (const obj of resolveTargets(engine, act.target)) {
          if (typeof act.repeatX === 'number') obj.material.repeatX = Math.max(0.25, act.repeatX);
          if (typeof act.repeatY === 'number') obj.material.repeatY = Math.max(0.25, act.repeatY);
          engine.applyTextureDataUrl(obj.id, url, `${preset}_512.png`, act.uvProjection || 'box');
          count++;
        }
        break;
      }

      case 'generate_custom_texture': {
        const url = customTextures.get(act);
        if (url) {
          for (const obj of resolveTargets(engine, act.target)) {
            if (typeof act.repeatX === 'number') obj.material.repeatX = Math.max(0.25, act.repeatX);
            if (typeof act.repeatY === 'number') obj.material.repeatY = Math.max(0.25, act.repeatY);
            engine.applyTextureDataUrl(
              obj.id,
              url,
              `${obj.name}_AITexture.png`,
              act.uvProjection || 'box'
            );
            count++;
          }
        }
        break;
      }

      case 'slice_mesh': {
        const targets = resolveTargets(engine, act.target);
        for (const obj of targets) {
          engine.selectObject(obj.id, false);
          engine.sliceActiveMesh(
            act.axis || 'Z',
            act.mode || 'split',
            Number(act.offset) || 0,
            act.normal,
            typeof act.gap === 'number' ? act.gap : 0.1
          );
          count++;
        }
        break;
      }

      case 'deform_mesh': {
        for (const obj of resolveTargets(engine, act.target)) {
          if (!obj.mesh) continue;
          const dt = act.deformType || 'smooth';
          if (dt === 'noise') {
            engine.deformMeshObject(obj.id, { type: 'noise', amplitude: Number(act.amount) || 0.2 });
          } else if (dt === 'taper') {
            engine.deformMeshObject(obj.id, { type: 'taper', topScale: Number(act.amount) ?? 0.4 });
          } else if (dt === 'smooth') {
            engine.deformMeshObject(obj.id, {
              type: 'smooth',
              levels: Math.min(2, Math.max(1, Number(act.amount) || 1))
            });
          } else if (dt === 'bevel') {
            const allFaces = obj.mesh.faces.map((_, idx) => idx);
            obj.mesh = bevelFaces(obj.mesh, allFaces.slice(0, 16), Number(act.amount) || 0.18).mesh;
          } else if (dt === 'extrude_top') {
            obj.mesh = extrudeFaces(obj.mesh, [0], Number(act.amount) || 0.5).mesh;
          } else if (dt === 'bend') {
            obj.mesh = bendMeshZ(obj.mesh, Number(act.amount) || 30);
          } else if (dt === 'twist') {
            obj.mesh = twistMeshZ(obj.mesh, Number(act.amount) || 45);
          }
          count++;
        }
        break;
      }

      case 'join_objects': {
        if (Array.isArray(act.targets) && act.targets.length >= 2) {
          const ids = act.targets
            .map((n) => engine.findObjectByNameOrId(n)?.id)
            .filter((x): x is string => Boolean(x));
          if (ids.length >= 2) {
            engine.state.selectedIds = ids;
            engine.state.activeObjectId = ids[0];
            const joined = engine.joinSelected();
            if (joined && act.newName) engine.renameObject(joined.id, act.newName);
            count++;
          }
        }
        break;
      }

      case 'group_objects': {
        const gName = act.groupName || act.group || 'Grupo_IA';
        const ids = Array.isArray(act.targets)
          ? act.targets
              .map((n) => engine.findObjectByNameOrId(n)?.id)
              .filter((x): x is string => Boolean(x))
          : newlyCreatedIds;
        if (ids.length > 0) {
          engine.moveObjectsToCollection(ids, gName);
          count++;
        }
        break;
      }
    }
  }

  if (newlyCreatedIds.length > 0) {
    engine.state.selectedIds = newlyCreatedIds;
    engine.state.activeObjectId = newlyCreatedIds[newlyCreatedIds.length - 1];
  }
  engine.rebuildSceneObjects();
  engine.notify();
  return count;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function shortModel(m: string): string {
  return m.split('/').pop() || m;
}
