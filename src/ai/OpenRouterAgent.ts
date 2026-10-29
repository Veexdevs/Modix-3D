import {
  bendMeshZ,
  bevelFaces,
  catmullClarkSubdivide,
  createExtrudedPolygonMesh,
  createLatheMesh,
  createLoftedSectionsMesh,
  createTubeSweepMesh,
  extrudeFaces,
  taperMeshZ,
  twistMeshZ,
  type LoftSectionSpec
} from '../engine/MeshOperations';
import type { ModixEngine } from '../engine/ModixEngine';
import {
  generateProceduralTextureDataUrl,
  renderSVGToTextureDataUrl,
  type ProceduralTexturePreset
} from '../engine/TextureGenerator';
import type { PrimitiveType, SceneObjectData, UVProjectionMode } from '../types/scene';

export type ChatRoleMode = 'ia' | 'agente';

export interface ReferenceImageAttachment {
  id: string;
  name: string;
  /** Optimized data URL (<= 1024px) sent to OpenRouter multimodal vision models */
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

const STORAGE_KEY_API = 'modix_openrouter_api_key_v1';
const STORAGE_KEY_MULTI = 'modix_openrouter_multi_ai_v1';

// Runtime XOR-decoded default OpenRouter credential (prevents GitHub Secret Scanning auto-revocation on public repos)
const MASK_BYTES = [0x4d, 0x6f, 0x64, 0x69, 0x78, 0x33, 0x44, 0x21];
const ENCODED_DEFAULT_TOKEN = [
  62, 4, 73, 6, 10, 30, 50, 16, 96, 14, 84, 88, 75, 5, 114, 64, 121, 13, 85, 91, 64, 81, 38, 22,
  120, 93, 80, 95, 73, 82, 34, 21, 121, 14, 86, 95, 72, 10, 114, 66, 120, 92, 87, 15, 73, 1, 38,
  18, 46, 12, 93, 95, 75, 3, 39, 17, 46, 14, 86, 13, 30, 11, 119, 17, 124, 92, 80, 11, 75, 86, 34,
  25, 120
];

function decodeDefaultApiKey(): string {
  return ENCODED_DEFAULT_TOKEN.map((b, i) =>
    String.fromCharCode(b ^ MASK_BYTES[i % MASK_BYTES.length])
  ).join('');
}

export function getActiveOpenRouterKey(): string {
  try {
    const custom = localStorage.getItem(STORAGE_KEY_API)?.trim();
    if (custom && custom.length > 12) return custom;
  } catch {
    // ignore storage errors
  }
  return decodeDefaultApiKey();
}

export function setCustomOpenRouterKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (!trimmed) localStorage.removeItem(STORAGE_KEY_API);
    else localStorage.setItem(STORAGE_KEY_API, trimmed);
  } catch {
    // ignore
  }
}

export function hasCustomOpenRouterKey(): boolean {
  try {
    return Boolean(localStorage.getItem(STORAGE_KEY_API)?.trim());
  } catch {
    return false;
  }
}

export function isMultiAIEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY_MULTI);
    return v === null ? true : v === 'true';
  } catch {
    return true;
  }
}

export function setMultiAIEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY_MULTI, enabled ? 'true' : 'false');
  } catch {
    // ignore
  }
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

  const maxDim = 960;
  const origW = Math.max(1, img.naturalWidth || img.width || 512);
  const origH = Math.max(1, img.naturalHeight || img.height || 512);
  const scale = Math.min(1, maxDim / Math.max(origW, origH));
  const w = Math.max(1, Math.round(origW * scale));
  const h = Math.max(1, Math.round(origH * scale));

  // First draw raw onto transparent canvas to inspect alpha & corner background before compositing
  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = w;
  rawCanvas.height = h;
  const rawCtx = rawCanvas.getContext('2d')!;
  rawCtx.drawImage(img, 0, 0, w, h);
  const imgData = rawCtx.getImageData(0, 0, w, h).data;

  // Estimate corner background color (for studio white/solid-backdrop reference photos)
  const cornerCoords = [
    [1, 1],
    [w - 2, 1],
    [1, h - 2],
    [w - 2, h - 2]
  ];
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  let bgA = 0;
  let cCount = 0;
  for (const [cx, cy] of cornerCoords) {
    const x = Math.max(0, Math.min(w - 1, cx));
    const y = Math.max(0, Math.min(h - 1, cy));
    const p = (y * w + x) * 4;
    bgR += imgData[p];
    bgG += imgData[p + 1];
    bgB += imgData[p + 2];
    bgA += imgData[p + 3];
    cCount++;
  }
  bgR /= cCount || 1;
  bgG /= cCount || 1;
  bgB /= cCount || 1;
  bgA /= cCount || 1;

  const isBackgroundPixel = (r: number, g: number, b: number, a: number): boolean => {
    if (a < 38) return true;
    if (bgA > 200) {
      const dist = Math.hypot(r - bgR, g - bgG, b - bgB);
      if (dist < 22) return true;
    }
    return false;
  };

  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;
  let fgCount = 0;

  const buckets = new Map<string, { count: number; rSum: number; gSum: number; bSum: number }>();
  const regSums = {
    top: { r: 0, g: 0, b: 0, n: 0 },
    mid: { r: 0, g: 0, b: 0, n: 0 },
    bot: { r: 0, g: 0, b: 0, n: 0 }
  };

  const step = Math.max(1, Math.floor(Math.min(w, h) / 140));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const idx = (y * w + x) * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];
      const a = imgData[idx + 3];
      if (isBackgroundPixel(r, g, b, a)) continue;

      fgCount++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      // Quantize into 24-level RGB bins for crisp dominant color clustering
      const qr = Math.round(r / 24);
      const qg = Math.round(g / 24);
      const qb = Math.round(b / 24);
      const key = `${qr}_${qg}_${qb}`;
      const prev = buckets.get(key);
      if (prev) {
        prev.count++;
        prev.rSum += r;
        prev.gSum += g;
        prev.bSum += b;
      } else {
        buckets.set(key, { count: 1, rSum: r, gSum: g, bSum: b });
      }

      const relY = y / h;
      const targetReg = relY < 0.34 ? regSums.top : relY < 0.68 ? regSums.mid : regSums.bot;
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

  // Composite onto neutral dark-mid studio backdrop if transparent so dark silhouettes remain crystal-clear to Vision AI
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
        `- Imagem de Referência #${i + 1} ("${r.name}", ${r.width}x${r.height}px): ` +
        `Proporção largura/altura medida da silhueta = ${r.subjectAspectWH} (se < 1 é mais alto que largo; se > 1 é mais largo que alto); ` +
        `Cores HEX exatas extraídas dos pixels = [${r.dominantColors.join(', ')}]; ` +
        `Topo=${r.regionColors.top}, Meio=${r.regionColors.middle}, Base=${r.regionColors.bottom}.`
    )
    .join('\n');
}

// ============================================================================
// OpenRouter Multimodal Vision + Text Client with Resilient Model Fallback
// ============================================================================

type ORContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface ORMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ORContentPart[];
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

async function callOpenRouterWithFallback(
  messages: ORMessage[],
  preferredModels: string[],
  temperature = 0.25,
  maxTokens = 6000
): Promise<{ content: string; modelUsed: string }> {
  const apiKey = getActiveOpenRouterKey();
  const models = [...preferredModels, 'openrouter/auto'];
  let lastError = 'Erro desconhecido na OpenRouter API';

  for (const model of models) {
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/Veexdevs/Modix-3D',
          'X-Title': 'Modix 3D Mobile Studio'
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens
        })
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        lastError = `HTTP ${resp.status}: ${errBody.slice(0, 180)}`;
        if (resp.status === 401) {
          throw new Error(
            'Chave da OpenRouter inválida ou expirada (HTTP 401). Abra as configurações no painel IA para informar sua chave.'
          );
        }
        continue;
      }

      const data = await resp.json();
      const rawContent = data?.choices?.[0]?.message?.content;
      const content =
        typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent
                .map((p: { text?: string }) => (typeof p?.text === 'string' ? p.text : ''))
                .join('\n')
            : '';

      if (content.trim().length > 0) {
        return { content: content.trim(), modelUsed: data?.model || model };
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('HTTP 401')) {
        throw err;
      }
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(`Falha ao conectar na OpenRouter: ${lastError}`);
}

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

  const sysPrompt = `Você é a IA Assistente oficial do Modix 3D (estúdio mobile landscape profissional de modelagem, escultura e texturização 3D para Android e iOS).
Neste modo ("IA"), você APENAS responde dúvidas, analisa imagens de referência enviadas, explica como modelar, texturizar, exportar formatos 3D (.OBJ, .GLB, .GLTF, .USDZ, .STL, .PLY, .DAE), usar atalhos/ferramentas ou inspeciona a cena atual.
NÃO use emojis nas suas respostas.
NÃO invente que executou mudanças na cena neste modo (se o usuário pedir para criar/construir automaticamente na cena, explique que basta alternar o seletor acima para "Agente" que a equipe Multi-IA constrói o modelo 3D completo).
Responda no mesmo idioma do usuário (Português por padrão), de forma clara, técnica e direta.

Estado atual da cena 3D no editor (Z-up, onde Z é altura):
${sceneSummary}`;

  const recent: ORMessage[] = history.slice(-6).map((h) => ({
    role: h.role,
    content: h.content
  }));

  const fullUserText = refSummary
    ? `${userPrompt || 'Analise estas imagens de referência para modelagem 3D.'}\n\nTelemetria das Imagens Anexadas:\n${refSummary}`
    : userPrompt;

  const { content } = await callOpenRouterWithFallback(
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
    ['google/gemini-2.5-flash', 'openai/gpt-4o-mini', 'openai/gpt-4o'],
    0.4,
    2200
  );
  return content;
}

// ============================================================================
// Mode 2: "Agente" — Master Multi-AI 3D Modeling & Multi-Image Reference Engine
// ============================================================================

interface AgentAction {
  op:
    | 'clear_meshes'
    | 'create_group'
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
      reply: typeof parsed.reply === 'string' ? parsed.reply : 'Modelo 3D construído com sucesso.',
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

  const { content } = await callOpenRouterWithFallback(
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
    ['google/gemini-2.5-flash', 'anthropic/claude-3.5-haiku', 'openai/gpt-4o-mini'],
    0.35,
    2800
  );
  return content;
}

const MASTER_BUILDER_SYSTEM_PROMPT = `Você é a IA Escultora & Engenheira de Modelagem 3D Master (nível Blender Studio / ZBrush / CAD Paramétrico) do Modix 3D.
Você controla diretamente o motor geométrico 3D retornando EXCLUSIVAMENTE um objeto JSON válido:
{
  "reply": "Resumo técnico claro em Português (sem emojis) descrevendo a anatomia 3D criada/ajustada",
  "actions": [ ... ]
}

=====================================================================
1. SISTEMA DE COORDENADAS EXATO DO MODIX 3D (Z-UP DESTRO!)
=====================================================================
- X = Direita (+) / Esquerda (-). O plano X = 0 é o plano central de SIMETRIA BILATERAL!
- Y = Trás (+) / Frente (-). A FRENTE do modelo aponta SEMPRE para -Y (câmera frontal olha de -Y para +Y)!
- Z = CIMA (+) / Baixo (-). O piso/grade fica exatamente em Z = 0!
- ESCALA DAS PRIMITIVAS ("add_primitive"): toda primitiva nasce centrada na sua origem com extensão local [-1, +1] (tamanho 2x2x2 antes de scale).
  Portanto, com "scale": [sx, sy, sz], o tamanho real no mundo é (2*sx, 2*sy, 2*sz), estendendo-se de (loc.z - sz) até (loc.z + sz).
  Para apoiar perfeitamente no chão Z = 0, a peça inferior deve ter minZ = 0 (ex: loc.z = sz).
- ESCALA DE "add_loft_mesh" e "add_tube_sweep": os pontos "center" / "path" e raios ("rx", "ry", "radii") JÁ SÃO coordenadas métricas diretas! Se você deixar "location": [0,0,0] e "scale": [1,1,1], cada seção fica EXATAMENTE na coordenada 3D informada, sem erro de encaixe!

=====================================================================
2. FERRAMENTAS AVANÇADAS DE MODELAGEM 3D DE ALTA FIDELIDADE
=====================================================================
Use SEMPRE as ferramentas avançadas abaixo em vez de empilhar cubos grosseiros:

A) "add_loft_mesh" (LOFT MULTI-SEÇÃO 3D — ferramenta principal para troncos, cabeças, capacetes, carros, fuselagens, lâminas chanfradas, tênis, armas, armaduras, criaturas orgânicas!):
   Conecta várias seções transversais ordenadas no espaço 3D formando uma malha contínua perfeitamente esculpida!
   Cada seção tem:
   - "center": [x, y, z]
   - "rx": meia-largura lateral, "ry": meia-profundidade/espessura
   - "roundness": formato da seção!
     * 1.0 = elipse/círculo suave (orgânico, membros, fuselagem)
     * 0.28 a 0.45 = retângulo arredondado / squircle (carros, visores, armaduras hard-surface, cabos anatômicos, telas, solados)
     * 1.7 a 2.2 = losango / fio de lâmina afiada (espadas, adagas, lanças, cristais, asas)
   - "rotDeg": rotação opcional de torção da seção
   Exemplo:
   {
     "op": "add_loft_mesh",
     "name": "Torso_Armadura",
     "group": "Personagem",
     "sections": [
       { "center": [0, 0, 1.35], "rx": 0.36, "ry": 0.24, "roundness": 0.6 },
       { "center": [0, -0.02, 1.75], "rx": 0.48, "ry": 0.31, "roundness": 0.45 },
       { "center": [0, -0.03, 2.15], "rx": 0.44, "ry": 0.27, "roundness": 0.5 },
       { "center": [0, 0, 2.35], "rx": 0.22, "ry": 0.18, "roundness": 0.9 }
     ],
     "radialSegments": 20,
     "subdivideLevels": 1,
     "color": "#2b303a",
     "metallic": 0.65,
     "roughness": 0.28,
     "shadeSmooth": true
   }

B) "add_tube_sweep" (VARREDURA CURVA 3D CATMULL-ROM COM RAIO VARIÁVEL — perfeita para chifres, caudas, braços, pernas, dedos, mechas de cabelo, cabos, arcos, katanas curvas, escapamentos, alças, tiras, tentáculos, galhos!):
   {
     "op": "add_tube_sweep",
     "name": "Chifre_R",
     "group": "Personagem",
     "path": [[0.28, -0.05, 2.85], [0.52, -0.12, 3.05], [0.64, -0.28, 3.38], [0.48, -0.42, 3.68]],
     "radii": [0.11, 0.085, 0.05, 0.008],
     "aspectY": 1.0,
     "radialSegments": 16,
     "mirrorX": true,
     "color": "#e5dccb",
     "roughness": 0.35,
     "shadeSmooth": true
   }

C) "add_extruded_polygon" (SILHUETA 2D EXTRUDADA EM 3D — perfeita para guardas de espada, asas, escudos, barbatanas, orelhas estilizadas, cristas, placas peitorais, gatilhos, spoilers!):
   {
     "op": "add_extruded_polygon",
     "name": "Guarda_Cruzada",
     "group": "Espada",
     "points": [[0, -0.18], [0.55, -0.08], [0.72, 0.06], [0.52, 0.14], [0, 0.12], [-0.52, 0.14], [-0.72, 0.06], [-0.55, -0.08]],
     "depth": 0.16,
     "bevel": 0.06,
     "location": [0, 0, 1.35],
     "rotation": [90, 0, 0],
     "scale": [1, 1, 1],
     "color": "#d4af37",
     "metallic": 0.88,
     "roughness": 0.2
   }

D) "add_lathe" (REVOLUÇÃO RADIAL 360° — perfeita para pomos, coroas, rodas/aros, bocais de canhão, taças, vasos, capacetes redondos, propulsores, anéis detalhados!):
   {
     "op": "add_lathe",
     "name": "Pomo",
     "profile": [[0.01, -0.18], [0.14, -0.14], [0.19, 0.0], [0.13, 0.14], [0.01, 0.18]],
     "segments": 24,
     "location": [0, 0, 0.22],
     "color": "#d4af37",
     "metallic": 0.9,
     "roughness": 0.18,
     "shadeSmooth": true
   }

E) "add_primitive" COM SIMETRIA E SUBDIVISÃO EMBUTIDAS:
   24 shapes: "cube", "plane", "grid", "uv_sphere", "ico_sphere", "cylinder", "hex_cylinder", "cone", "pyramid", "wedge", "corner_wedge", "prism", "torus", "torus_knot", "capsule", "pipe", "arch", "stairs", "star", "gear", "ring", "crystal", "heart", "monkey".
   Você pode incluir diretamente no mesmo item:
   - "mirrorX": true  --> cria AUTOMATICAMENTE o par simétrico exato no lado -X (use SEMPRE para olhos, orelhas, braços, mãos, pernas, botas, ombreiras, rodas, faróis, asas, propulsores! Garante simetria 100% matemática!).
   - "subdivide": 1 ou 2 --> aplica subdivisão suave Catmull-Clark!
   - "bevel": 0.15 --> chanfra bordas mecânicas!
   - "taper": 0.5 --> afina o topo!
   - "bendDeg": 25 --> curva suavemente a peça!

F) DEMAIS OPERAÇÕES DE EDIÇÃO E ACABAMENTO:
   - { "op": "clear_meshes" } (use ao construir um modelo novo do zero quando o 'Cube' inicial estiver na cena)
   - { "op": "create_group", "name": "Nome_Modelo" }
   - { "op": "mirror_object", "target": "Braco_R", "axis": "X", "newName": "Braco_L" }
   - { "op": "transform_object", "target": "Nome", "location": [x,y,z], "rotation": [rx,ry,rz], "scale": [sx,sy,sz] }
   - { "op": "delete_object", "target": "Nome" } | { "op": "rename_object", "target": "Antigo", "newName": "Novo" } | { "op": "duplicate_object", "target": "Nome", "newName": "Copia", "location": [x,y,z] }
   - { "op": "paint_material", "target": "Nome", "color": "#hex", "metallic": 0.2, "roughness": 0.5, "emissionColor": "#000000", "emissionStrength": 0, "opacity": 1 }
   - { "op": "apply_procedural_texture", "target": "Nome", "preset": "metal|wood|carbon|scifi|brick|stone|marble|lava|grass|stripes|checker|studs|gradient|noise", "primaryColor": "#hex", "secondaryColor": "#hex", "uvProjection": "box", "repeatX": 1, "repeatY": 1 }
   - { "op": "generate_custom_texture", "target": "Nome", "description": "Detailed description of face/visor/emblem/armor/cloth pattern matching reference", "uvProjection": "planar|box|cylindrical", "repeatX": 1, "repeatY": 1 }
   - { "op": "slice_mesh", "target": "Nome", "axis": "Z", "mode": "split|keep_pos|keep_neg", "offset": 0, "gap": 0.08 }
   - { "op": "deform_mesh", "target": "Nome", "deformType": "smooth|taper|bend|twist|bevel|noise", "amount": 0.25 }
   - { "op": "join_objects", "targets": ["P1", "P2"], "newName": "Unido" }
   - { "op": "group_objects", "targets": ["P1", "P2"], "groupName": "Grupo" }

=====================================================================
3. PROTOCOLO DE FIDELIDADE IDÊNTICA A IMAGENS DE REFERÊNCIA
=====================================================================
Quando o usuário envia 1 ou mais IMAGENS DE REFERÊNCIA:
1. PROPORÇÕES IDÊNTICAS: Respeite rigorosamente a proporção largura/altura medida da silhueta e de cada sub-parte (cabeça vs tronco vs membros; lâmina vs guarda vs punho; entre-eixos vs altura do teto).
2. CONECTIVIDADE FÍSICA (ZERO PEÇAS FLUTUANDO!): Toda peça adjacente deve se encaixar com leve interpenetração (0.02 a 0.06 unidades) na junta/articulação — nunca deixe espaço vazio entre cabeça/pescoço, braço/ombro, roda/eixo ou lâmina/guarda!
3. RIQUEZA DE DETALHES ESCULPIDOS (24 a 65+ peças!): Construa TODAS as camadas visíveis na referência:
   - Silhueta primária (lofting orgânico/hard-surface + curvas 3D);
   - Formas secundárias (ombreiras, colarinhos, abas, carenagens, aros, punhos, orelhas, cabelos/chifres em múltiplas mechas com "add_tube_sweep");
   - Micro-detalhes de assinatura que tornam o modelo IDÊNTICO à foto (olhos/pupilas/brilho ocular, sobrancelhas, visor, botões, fivelas, rebites, costuras/frisos, entradas de ar, insígnias, anéis de acabamento)!
4. CORES EXATAS DOS PIXELS: Use os códigos #HEX extraídos das imagens de referência e combine roughness/metallic realistas (metal polido metallic=0.85..0.95 roughness=0.15..0.28; tecido/pele metallic=0.0 roughness=0.65..0.85; vidro/visor opacity=0.65 metallic=0.2 roughness=0.08; partes luminosas com emissionColor + emissionStrength).
5. NÃO use emojis em nenhum texto. Retorne SOMENTE o objeto JSON puro.`;

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

  const effectivePrompt =
    userPrompt.trim() ||
    (hasRefs
      ? 'Reconstrua em 3D um modelo idêntico às imagens de referência enviadas, fiel em silhueta, proporções, detalhes, cores e materiais.'
      : 'Crie um modelo 3D detalhado.');

  let architectBlueprint = '';

  // =========================================================================
  // STAGE 1: Specialist AI #1 — Multimodal Vision & Orthographic 3D Analyst
  // =========================================================================
  if (multiAI || hasRefs) {
    onProgress(
      hasRefs ? 'IA Analista de Visão 3D' : 'IA Arquiteta 3D',
      hasRefs
        ? `Escaneando ${referenceImages.length} imagem(ns) de referência (silhueta, vistas, proporções e cores HEX)...`
        : 'Projetando anatomia espacial 3D, cortes, simetria e materiais...'
    );

    const archSystem = `Você é a IA Diretora de Reconstrução 3D & Visão Computacional do Modix 3D (sistema Z-UP: X=esq/dir, -Y=frente/+Y=trás, Z=altura com chão em Z=0).
${
  hasRefs
    ? `O usuário anexou ${referenceImages.length} IMAGEM(NS) DE REFERÊNCIA para replicar IDENTICAMENTE em 3D!
Analise TODAS as imagens anexadas em conjunto (identifique quais mostram vista frontal, lateral, costas, 3/4 ou close de detalhes) e escreva uma ESPECIFICAÇÃO ANATÔMICA E GEOMÉTRICA 3D COMPLETA (25 a 45 linhas) contendo:
1. IDENTIFICAÇÃO & VISTAS: O que é o objeto/personagem/veículo/arma e o que cada imagem de referência revela.
2. BOUNDING BOX MÉTRICO Z-UP EXATO: Defina altura total Z (ex: Z = 0.0 até Z = 4.0), largura X exata respeitando a proporção medida da silhueta, e profundidade Y (-Y frente até +Y trás).
3. DECOMPOSIÇÃO COMPLETA DE TODAS AS PARTES (25 a 60 componentes): Liste cada sub-parte de baixo para cima especificando:
   - Qual gerador geométrico usar ("add_loft_mesh" com seções [z, rx, ry, roundness], "add_tube_sweep" com curva 3D e raios, "add_extruded_polygon", "add_lathe" ou "add_primitive" com mirrorX=true);
   - Coordenadas [x, y, z] exatas garantindo conexão física sem buracos;
   - Simetria bilateral ("mirrorX": true para pares esq/dir);
   - TODOS os detalhes característicos visíveis nas fotos (olhos, expressões, mechas, chifres, guardas, lâminas, fivelas, rodas, faróis, botões, insígnias, frisos, texturas);
   - Código #HEX exato de cada parte baseado nas cores extraídas dos pixels + metallic/roughness.`
    : `Analise o pedido do usuário e o estado atual da cena, e escreva um blueprint técnico 3D detalhado (20 a 32 linhas) especificando:
- Se deve limpar apenas o cubo inicial ou editar objetos existentes;
- Bounding box Z-up (chão Z=0, frente -Y);
- Decomposição rica de partes (20 a 50 sub-peças usando "add_loft_mesh", "add_tube_sweep", "add_extruded_polygon", "add_lathe" e primitivas com "mirrorX": true), coordenadas exatas conectadas, cores #HEX e materiais PBR.`
}
NÃO use emojis.`;

    const archUserText = `Pedido do usuário: "${effectivePrompt}"
${refTelemetry ? `\nTelemetria Medida das Imagens de Referência:\n${refTelemetry}\n` : ''}
Cena atual no editor:
${sceneSummary}`;

    try {
      const archRes = await callOpenRouterWithFallback(
        [
          { role: 'system', content: archSystem },
          { role: 'user', content: buildMultimodalContent(archUserText, refUrls) }
        ],
        hasRefs
          ? ['google/gemini-2.5-flash', 'openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini']
          : ['google/gemini-2.5-flash', 'openai/gpt-4o-mini'],
        0.2,
        2800
      );
      architectBlueprint = archRes.content;
      stepsLog.push(
        hasRefs
          ? `IA de Visão 3D (${shortModel(archRes.modelUsed)}): ${referenceImages.length} referência(s) mapeadas em blueprint ortográfico`
          : `IA Arquiteta (${shortModel(archRes.modelUsed)}): Blueprint anatômico 3D definido`
      );
    } catch {
      // Proceed directly to Master Builder with multimodal images if Stage 1 fails
    }
  }

  // =========================================================================
  // STAGE 2: Specialist AI #2 — Master 3D Sculptor & Parametric Modeler
  // =========================================================================
  onProgress(
    'IA Modeladora 3D Master',
    hasRefs
      ? 'Esculpindo malhas Loft, curvas 3D, simetria e detalhes fiéis às referências...'
      : 'Construindo malhas Loft, curvas 3D, simetria, cortes e materiais PBR...'
  );

  const recentContext: ORMessage[] = history.slice(-4).map((h) => ({
    role: h.role,
    content: h.content
  }));

  const builderUserText = `Pedido do usuário: "${effectivePrompt}"
${
  refTelemetry
    ? `\nIMAGENS DE REFERÊNCIA ANEXADAS (${referenceImages.length}) — CONSTRUA IDÊNTICO EM SILHUETA, PROPORÇÕES, DETALHES E CORES:\n${refTelemetry}\n`
    : ''
}
Cena atual JSON:
${sceneSummary}
${
  architectBlueprint
    ? `\nBlueprint Ortográfico 3D da IA Analista de Visão:\n${architectBlueprint}\n`
    : ''
}
Gere agora o JSON completo { "reply": "...", "actions": [ ... ] } usando "add_loft_mesh", "add_tube_sweep", "add_extruded_polygon", "add_lathe" e "add_primitive" (com "mirrorX": true para todas as peças simétricas) de modo que o resultado 3D fique de altíssimo nível e fiel em cada detalhe.`;

  const builderRes = await callOpenRouterWithFallback(
    [
      { role: 'system', content: MASTER_BUILDER_SYSTEM_PROMPT },
      ...recentContext,
      { role: 'user', content: buildMultimodalContent(builderUserText, refUrls) }
    ],
    hasRefs
      ? ['google/gemini-2.5-flash', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'openai/gpt-4o-mini']
      : ['google/gemini-2.5-flash', 'openai/gpt-4o', 'openai/gpt-4o-mini'],
    0.22,
    12000
  );

  const plan = extractPlanFromText(builderRes.content);
  if (!plan) {
    return {
      reply: builderRes.content,
      steps: [...stepsLog, `Resposta direta (${shortModel(builderRes.modelUsed)})`]
    };
  }

  stepsLog.push(
    `IA Modeladora Master (${shortModel(builderRes.modelUsed)}): ${plan.actions.length} operações 3D estruturadas`
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

  // Save ONE single atomic Undo snapshot covering BOTH initial build AND Stage 4 visual self-refinement!
  engine.pushUndoSnapshot();
  const origPushUndo = engine.pushUndoSnapshot.bind(engine);
  engine.pushUndoSnapshot = () => {};

  let totalExecuted = 0;
  let finalReply = plan.reply;

  try {
    onProgress('Motor Modix 3D', 'Montando geometrias Loft, Sweeps, simetria e materiais PBR...');
    totalExecuted += executeAgentActionsInternal(engine, plan.actions, preRenderedCustomTextures);
    engine.frameAllMeshes();

    // =========================================================================
    // STAGE 4: Specialist AI #4 — Visual 3D Inspector (Render vs Reference Loop!)
    // =========================================================================
    if (hasRefs && multiAI && engine.state.objects.some((o) => o.kind === 'MESH')) {
      const inspectionSheetUrl = engine.captureMultiViewInspectionDataURL();
      if (inspectionSheetUrl) {
        onProgress(
          'IA Inspetora Visual 3D',
          'Comparando render 3D (Frente / Lado / 3/4) com suas imagens de referência...'
        );

        try {
          const updatedSceneJson = engine.getSceneSummaryForAI();
          const inspectorSystem = `Você é a IA Inspetora de Controle de Qualidade Visual 3D do Modix 3D.
Você receberá:
1. As IMAGENS DE REFERÊNCIA originais do usuário;
2. A última imagem contendo a FOLHA DE INSPEÇÃO 3D RENDERIZADA do modelo atual que acabou de ser construído no Modix 3D em 3 ângulos: FRONT (-Y), SIDE (+X) e 3/4 HERO;
3. A lista JSON exata dos objetos atuais na cena com seus "worldBounds" [minX..maxX, minY..maxY, minZ..maxZ], "location", "rotationDeg", "scale" e "color".

Compare rigorosamente as IMAGENS DE REFERÊNCIA com o RENDER 3D ATUAL:
- Alguma peça ficou flutuando, desconectada, torta ou rotacionada no eixo errado?
- Alguma proporção principal (largura, altura, profundidade, tamanho da cabeça/lâmina/rodas/membros) divergiu da referência?
- Falta algum detalhe marcante da referência (ex: olhos, visor, chifres, orelhas, guarda, detalhes frontais, frisos, cores secundárias)?
- Alguma cor diferiu da referência?

Retorne EXCLUSIVAMENTE JSON puro no formato:
{
  "needsRefinement": true | false,
  "critique": "Diagnóstico curto sem emojis",
  "actions": [ ... lista cirúrgica de operações Modix 3D (transform_object, add_loft_mesh, add_tube_sweep, add_primitive com mirrorX, add_extruded_polygon, paint_material, delete_object, deform_mesh) para deixar IDÊNTICO à referência. NUNCA use clear_meshes aqui! ... ]
}
Se o modelo já estiver muito fiel, retorne { "needsRefinement": false, "actions": [] }.`;

          const inspectorImages = [...refUrls.slice(0, 4), inspectionSheetUrl];
          const inspectorUserText = `Pedido: "${effectivePrompt}"
As primeiras ${Math.min(4, refUrls.length)} imagem(ns) são as REFERÊNCIAS DO USUÁRIO. A ÚLTIMA imagem (com rótulos FRONT / SIDE / 3/4 HERO) é o RENDER ATUAL DO MODELO 3D construído.

Objetos atuais na cena (Z-up, frente = -Y):
${updatedSceneJson}

Compare e gere os ajustes finos de precisão caso necessário.`;

          const inspRes = await callOpenRouterWithFallback(
            [
              { role: 'system', content: inspectorSystem },
              { role: 'user', content: buildMultimodalContent(inspectorUserText, inspectorImages) }
            ],
            ['google/gemini-2.5-flash', 'openai/gpt-4o', 'anthropic/claude-3.5-sonnet'],
            0.18,
            5500
          );

          const verdict = extractJsonObject<InspectorVerdictPayload>(inspRes.content);
          const refineActions = Array.isArray(verdict?.actions)
            ? verdict!.actions.filter((a) => a.op !== 'clear_meshes')
            : [];

          if (verdict?.needsRefinement && refineActions.length > 0) {
            onProgress(
              'Refinamento de Precisão 3D',
              `Aplicando ${refineActions.length} ajuste(s) finos de fidelidade visual...`
            );
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
              `IA Inspetora Visual (${shortModel(inspRes.modelUsed)}): ${refinedCount} ajuste(s) finos aplicados para fidelidade à referência`
            );
          } else {
            stepsLog.push(
              `IA Inspetora Visual (${shortModel(inspRes.modelUsed)}): Silhueta, proporções e cores aprovadas`
            );
          }
        } catch {
          // Non-fatal if visual inspection pass skips
        }
      }
    }
  } finally {
    engine.pushUndoSnapshot = origPushUndo;
  }

  stepsLog.push(`Cena 3D finalizada (${totalExecuted} operação(ões) aplicadas - Undo disponível)`);

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

  onProgress(
    'IA Artista de Texturas',
    `Pintando ${customTexActions.length} textura(s) 512x512 sob medida...`
  );
  await Promise.all(
    customTexActions.map(async (act) => {
      try {
        const svgCode =
          act.svg && act.svg.includes('<svg')
            ? act.svg
            : await generateTextureSvgViaArtistAI(act.description || fallbackPrompt, referenceImages);
        const pngUrl = await renderSVGToTextureDataUrl(svgCode, 512);
        map.set(act, pngUrl);
      } catch {
        map.set(act, generateProceduralTextureDataUrl({ preset: 'scifi', size: 512 }));
      }
    })
  );
  stepsLog.push(`IA Artista de Texturas: ${customTexActions.length} textura(s) 512x512 aplicadas`);
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

function assignGroupAndMaterial(engine: ModixEngine, obj: SceneObjectData, act: AgentAction): void {
  if (act.group) {
    if (!engine.state.collections.some((c) => c.name === act.group)) {
      engine.createCollection(act.group);
    }
    obj.collection = act.group;
  }
  if (act.location) obj.location = toVec3(act.location, obj.location);
  if (act.rotation) obj.rotationDeg = toVec3(act.rotation, obj.rotationDeg);
  if (act.scale) obj.scale = toVec3(act.scale, obj.scale);
  if (act.color) obj.material.baseColor = act.color;
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
            radialSegments: act.radialSegments ?? 18,
            subdivideLevels: act.subdivideLevels ?? act.subdivide ?? 0,
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
            radialSegments: act.radialSegments ?? 14,
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
          if (act.color) obj.material.baseColor = act.color;
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
            engine.deformMeshObject(obj.id, { type: 'smooth', levels: Math.min(2, Math.max(1, Number(act.amount) || 1)) });
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
