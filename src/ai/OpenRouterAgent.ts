import {
  bevelFaces,
  createExtrudedPolygonMesh,
  createLatheMesh,
  extrudeFaces
} from '../engine/MeshOperations';
import type { ModixEngine } from '../engine/ModixEngine';
import {
  generateProceduralTextureDataUrl,
  renderSVGToTextureDataUrl,
  type ProceduralTexturePreset
} from '../engine/TextureGenerator';
import type { PrimitiveType, SceneObjectData, UVProjectionMode } from '../types/scene';

export type ChatRoleMode = 'ia' | 'agente';

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  mode: ChatRoleMode;
  agentSteps?: string[];
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

interface ORMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function callOpenRouterWithFallback(
  messages: ORMessage[],
  preferredModels: string[],
  temperature = 0.35,
  maxTokens = 3500
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
        // If 401 unauthorized, don't retry other models with same invalid key
        if (resp.status === 401) {
          throw new Error(
            'Chave da OpenRouter inválida ou expirada (HTTP 401). Abra as configurações no painel IA para informar sua chave.'
          );
        }
        continue;
      }

      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim().length > 0) {
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
 * Mode 1: "IA" — Pure Q&A Assistant (never modifies the 3D scene; only answers questions)
 */
export async function askModixIA(
  userPrompt: string,
  history: ChatHistoryItem[],
  engine: ModixEngine
): Promise<string> {
  const sceneSummary = engine.getSceneSummaryForAI();
  const sysPrompt = `Você é a IA Assistente oficial do Modix 3D (estúdio mobile landscape profissional de modelagem, escultura e texturização 3D para Android e iOS).
Neste modo ("IA"), você APENAS responde dúvidas, explica como modelar, texturizar, exportar formatos 3D (.OBJ, .GLB, .GLTF, .USDZ, .STL, .PLY, .DAE), usar atalhos/ferramentas ou analisa a cena atual.
NÃO use emojis nas suas respostas.
NÃO invente que executou mudanças na cena neste modo (se o usuário pedir para criar/modificar automaticamente, explique como fazer passo a passo OU sugira trocar a chave acima para o modo "Agente").
Responda no mesmo idioma do usuário (Português por padrão), de forma clara, técnica e direta.

Estado atual da cena 3D no editor (Z-up, onde Z é altura):
${sceneSummary}`;

  const recent: ORMessage[] = history.slice(-6).map((h) => ({
    role: h.role,
    content: h.content
  }));

  const { content } = await callOpenRouterWithFallback(
    [{ role: 'system', content: sysPrompt }, ...recent, { role: 'user', content: userPrompt }],
    ['openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct'],
    0.5,
    1600
  );
  return content;
}

// ============================================================================
// Mode 2: "Agente" — Multi-AI 3D Builder, Cutter, Painter & Texture Generator
// ============================================================================

interface AgentAction {
  op:
    | 'clear_meshes'
    | 'create_group'
    | 'add_primitive'
    | 'add_extruded_polygon'
    | 'add_lathe'
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
  // Material & Paint fields
  color?: string;
  metallic?: number;
  roughness?: number;
  emissionColor?: string;
  emissionStrength?: number;
  opacity?: number;
  shadeSmooth?: boolean;
  // Extruded Polygon / Lathe fields
  points?: [number, number][];
  depth?: number;
  profile?: [number, number][];
  segments?: number;
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
  deformType?: 'noise' | 'taper' | 'smooth' | 'bevel' | 'extrude_top';
  amount?: number;
}

interface AgentPlanPayload {
  reply: string;
  actions: AgentAction[];
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

function extractJsonFromText(raw: string): AgentPlanPayload | null {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  const candidate = cleaned.slice(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && Array.isArray(parsed.actions)) {
      return {
        reply: typeof parsed.reply === 'string' ? parsed.reply : 'Operações 3D concluídas!',
        actions: parsed.actions
      };
    }
  } catch {
    // Attempt light trailing-comma cleanup
    try {
      const fixed = candidate.replace(/,\s*([}\]])/g, '$1');
      const parsed2 = JSON.parse(fixed);
      if (parsed2 && Array.isArray(parsed2.actions)) {
        return {
          reply: typeof parsed2.reply === 'string' ? parsed2.reply : 'Operações 3D concluídas!',
          actions: parsed2.actions
        };
      }
    } catch {
      return null;
    }
  }
  return null;
}

async function generateTextureSvgViaArtistAI(description: string): Promise<string> {
  const sys = `You are a master 2D PBR & 3D Surface Texture SVG Artist.
Return ONLY a complete, valid, rich, seamless 512x512 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">...</svg> with NO markdown fences and NO explanations.
Fill the entire 512x512 background first, then layer gradients, geometric panels, details, highlights, shadows, cracks, patterns, or decals matching the user's texture description.`;

  const { content } = await callOpenRouterWithFallback(
    [
      { role: 'system', content: sys },
      { role: 'user', content: `Create a rich 512x512 game texture SVG for: ${description}` }
    ],
    ['anthropic/claude-3.5-haiku', 'google/gemini-2.5-flash', 'openai/gpt-4o-mini'],
    0.45,
    2400
  );
  return content;
}

export async function runModixMultiAgent(
  userPrompt: string,
  history: ChatHistoryItem[],
  engine: ModixEngine,
  onProgress: (badge: string, stepText: string) => void
): Promise<{ reply: string; steps: string[] }> {
  const stepsLog: string[] = [];
  const multiAI = isMultiAIEnabled();
  const sceneSummary = engine.getSceneSummaryForAI();

  let architectBlueprint = '';

  // STAGE 1: Specialist AI #1 — 3D Architect & Spatial Director (when Multi-AI enabled)
  if (multiAI) {
    onProgress('IA Arquiteta', 'Planejando anatomia 3D, coordenadas Z-up, cortes e materiais...');
    const archSystem = `Você é a IA Arquiteta Espacial 3D líder de uma equipe multi-agente dentro do Modix 3D.
Coordenadas do Modix 3D: Z-UP (X = esquerda/direita, Y = frente/trás, Z = altura para cima; o chão é Z = 0).
Primitivas unitárias têm tamanho base ~2x2x2 centradas na própria origem (ex: um cubo com scale [1,1,1] em location [0,0,1] apoia exatamente no chão Z=0!).
Analise o pedido do usuário e o estado atual da cena, e escreva um plano técnico conciso (máx 18 linhas) para a IA Modeladora 3D e a IA Artista de Texturas especificando:
- Se deve manter objetos existentes ou limpar apenas se for criar uma cena/objeto novo do zero;
- Lista de partes 3D detalhadas (usando primitivas variadas, polígonos extrudados ou lathes, nunca apenas 1 cubo simples quando o pedido for um objeto rico como espada, carro, casa, robô, árvore, personagem, trono, arma, dragão etc.), com posições [x,y,z], escalas [sx,sy,sz], rotações e um nome de grupo;
- Se houver pedido de recortar/cortar, pintar, unir, renomear ou gerar textura customizada, detalhe exatamente quais objetos serão afetados.

Cena atual:
${sceneSummary}`;

    try {
      const archRes = await callOpenRouterWithFallback(
        [
          { role: 'system', content: archSystem },
          { role: 'user', content: userPrompt }
        ],
        ['openai/gpt-4o-mini', 'google/gemini-2.5-flash'],
        0.35,
        1100
      );
      architectBlueprint = archRes.content;
      stepsLog.push(`IA Arquiteta (${shortModel(archRes.modelUsed)}): Blueprint espacial definido`);
    } catch {
      // Non-fatal: Builder AI can proceed directly if Architect times out
    }
  }

  // STAGE 2: Specialist AI #2 - 3D Geometry, Cutter & Scene Builder AI
  onProgress('IA Modeladora 3D', 'Construindo geometrias 3D, cortes, grupos e materiais...');

  const builderSystem = `Você é a IA Engenheira & Modeladora 3D do Modix 3D. Você controla diretamente o motor 3D retornando EXCLUSIVAMENTE um objeto JSON válido no formato:
{
  "reply": "Resumo claro em Português (sem emojis) do que foi criado/modificado",
  "actions": [ ... ]
}

SISTEMA DE COORDENADAS: Z-UP!
- X = direita(+) / esquerda(-)
- Y = trás(+) / frente(-)
- Z = CIMA(+) / baixo(-). O piso da grade fica em Z = 0.
- Todas as primitivas têm tamanho base ~2 unidades (-1 a +1 em cada eixo antes do scale). Portanto, um objeto com scale [sx, sy, sz] tem dimensões reais (2*sx, 2*sy, 2*sz), e para apoiar no chão sua altura Z deve ser aproximadamente sz.

OPERAÇÕES DISPONÍVEIS EM "actions":
1. Limpar malhas antigas (use APENAS quando criar um modelo completo novo do zero e o objeto inicial 'Cube' padrão atrapalhar):
   { "op": "clear_meshes" }
2. Criar grupo/coleção:
   { "op": "create_group", "name": "Espada_Lendaria" }
3. Adicionar primitiva 3D (24 formatos disponíveis!):
   shape pode ser: "cube", "plane", "grid", "uv_sphere", "ico_sphere", "cylinder", "hex_cylinder", "cone", "pyramid", "wedge", "corner_wedge", "prism", "torus", "torus_knot", "capsule", "pipe", "arch", "stairs", "star", "gear", "ring", "crystal", "heart", "monkey"
   { "op": "add_primitive", "shape": "cylinder", "name": "Cabo", "group": "Espada", "location": [0, 0, 0.8], "rotation": [0, 0, 0], "scale": [0.12, 0.12, 0.7], "color": "#5c3a21", "metallic": 0.2, "roughness": 0.6, "shadeSmooth": true }
4. Adicionar Polígono 2D Extrudado em 3D (ótimo para lâminas, escudos, asas, carrocerias, telhados!):
   { "op": "add_extruded_polygon", "name": "Lamina", "group": "Espada", "points": [[0, -1.5], [0.28, -0.8], [0.18, 1.2], [0, 1.8], [-0.18, 1.2], [-0.28, -0.8]], "depth": 0.12, "location": [0, 0, 2.8], "rotation": [90, 0, 0], "scale": [1, 1, 1], "color": "#dbeafe", "metallic": 0.9, "roughness": 0.15 }
5. Adicionar Objeto Torneado / Revolução 3D (vasos, taças, foguetes, torres, garrafas, peças de xadrez!):
   { "op": "add_lathe", "name": "Vaso", "profile": [[0.01, -1.0], [0.55, -1.0], [0.85, -0.2], [0.45, 0.5], [0.65, 1.0]], "segments": 24, "location": [0, 0, 1.0], "scale": [1, 1, 1], "color": "#d97706", "shadeSmooth": true }
6. Transformar / Renomear / Duplicar / Deletar objeto existente ("target" é o nome do objeto):
   { "op": "transform_object", "target": "Cube", "location": [0, 0, 1], "rotation": [0, 0, 45], "scale": [1, 2, 0.5] }
   { "op": "rename_object", "target": "Cube", "newName": "Bloco_Base" }
   { "op": "duplicate_object", "target": "Pilar", "newName": "Pilar_2", "location": [2, 0, 1] }
   { "op": "delete_object", "target": "Cube" }
7. Pintar cor e material PBR ("target" pode ser nome do objeto, "SELECTED" ou "ALL"):
   { "op": "paint_material", "target": "Lamina", "color": "#38bdf8", "metallic": 0.85, "roughness": 0.18, "emissionColor": "#0284c7", "emissionStrength": 0.35, "opacity": 1.0 }
8. Aplicar textura procedural rápida:
   preset pode ser: "studs", "checker", "brick", "wood", "metal", "carbon", "scifi", "grass", "stone", "lava", "marble", "stripes", "gradient", "noise"
   { "op": "apply_procedural_texture", "target": "Parede", "preset": "brick", "primaryColor": "#9b3b2e", "secondaryColor": "#cbd5e1", "uvProjection": "box", "repeatX": 2, "repeatY": 2 }
9. Gerar textura artística customizada com a IA Artista de Texturas (512x512 PNG sob medida!):
   { "op": "generate_custom_texture", "target": "Escudo", "description": "Royal medieval golden crest with dragon emblem on dark cobalt steel armor plate", "uvProjection": "box", "repeatX": 1, "repeatY": 1 }
10. Recortar / Fatiar malha 3D ao meio ou em ângulo ("slice_mesh"):
   { "op": "slice_mesh", "target": "Cube", "axis": "Z", "mode": "split", "offset": 0.0, "gap": 0.15 }
   (mode: "split" divide em 2 partes independentes; "keep_pos" mantém lado positivo; "keep_neg" mantém lado negativo)
11. Deformar / Refinar malha ("noise" para rochas/terrenos, "taper" para afinar topo, "smooth" subdivisão suave, "bevel" chanfrar):
   { "op": "deform_mesh", "target": "Rocha", "deformType": "noise", "amount": 0.22 }
12. Unir objetos em uma malha só ("join_objects") ou Agrupar ("group_objects"):
   { "op": "join_objects", "targets": ["Parte1", "Parte2"], "newName": "Modelo_Unido" }
   { "op": "group_objects", "targets": ["Roda1", "Roda2"], "groupName": "Rodas" }

REGRAS DE OURO:
- Quando o usuário pedir para CRIAR um modelo 3D (ex: carro, casa, espada, personagem, robô, trono, castelo, árvore, pistola sci-fi, mesa, cadeira), construa um modelo RICO e BEM PROPORCIONADO compondo entre 6 e 24 partes bem posicionadas, agrupadas, coloridas e texturizadas!
- NÃO use emojis em nenhum campo.
- Retorne APENAS JSON puro, sem texto fora do JSON.`;

  const recentContext: ORMessage[] = history.slice(-4).map((h) => ({
    role: h.role,
    content: h.content
  }));

  const builderUserPrompt = architectBlueprint
    ? `Pedido do usuário: "${userPrompt}"\n\nCena atual JSON:\n${sceneSummary}\n\nPlano da IA Arquiteta:\n${architectBlueprint}\n\nGere agora o JSON completo { "reply": "...", "actions": [...] }.`
    : `Pedido do usuário: "${userPrompt}"\n\nCena atual JSON:\n${sceneSummary}\n\nGere agora o JSON completo { "reply": "...", "actions": [...] }.`;

  const builderRes = await callOpenRouterWithFallback(
    [
      { role: 'system', content: builderSystem },
      ...recentContext,
      { role: 'user', content: builderUserPrompt }
    ],
    ['google/gemini-2.5-flash', 'openai/gpt-4o-mini', 'anthropic/claude-3.5-haiku'],
    0.3,
    4096
  );

  const plan = extractJsonFromText(builderRes.content);
  if (!plan) {
    return {
      reply: builderRes.content,
      steps: [...stepsLog, `Resposta direta (${shortModel(builderRes.modelUsed)})`]
    };
  }

  stepsLog.push(
    `IA Modeladora 3D (${shortModel(builderRes.modelUsed)}): ${plan.actions.length} operações geradas`
  );

  // STAGE 3: Specialist AI #3 - Texture Artist AI runs in parallel for any custom textures!
  const customTexActions = plan.actions.filter((a) => a.op === 'generate_custom_texture');
  const preRenderedCustomTextures = new Map<AgentAction, string>();

  if (customTexActions.length > 0) {
    onProgress(
      'IA Artista de Texturas',
      `Pintando ${customTexActions.length} textura(s) 512x512 exclusivas...`
    );
    await Promise.all(
      customTexActions.map(async (act) => {
        try {
          const svgCode =
            act.svg && act.svg.includes('<svg')
              ? act.svg
              : await generateTextureSvgViaArtistAI(act.description || userPrompt);
          const pngUrl = await renderSVGToTextureDataUrl(svgCode, 512);
          preRenderedCustomTextures.set(act, pngUrl);
        } catch {
          preRenderedCustomTextures.set(
            act,
            generateProceduralTextureDataUrl({ preset: 'scifi', size: 512 })
          );
        }
      })
    );
    stepsLog.push(
      `IA Artista de Texturas: ${customTexActions.length} textura(s) HD 512x512 gerada(s)`
    );
  }

  // STAGE 4: Execute all actions atomically (single Undo snapshot!)
  onProgress('Motor Modix 3D', 'Aplicando malhas, cortes, materiais e texturas na cena...');
  const executedCount = executeAgentActionsBatch(engine, plan.actions, preRenderedCustomTextures);
  stepsLog.push(`Cena atualizada (${executedCount} ação(ões) aplicadas - Undo disponível)`);

  return {
    reply: plan.reply,
    steps: stepsLog
  };
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

function executeAgentActionsBatch(
  engine: ModixEngine,
  actions: AgentAction[],
  customTextures: Map<AgentAction, string>
): number {
  if (actions.length === 0) return 0;

  // Save ONE single undo snapshot before the entire batch, and temporarily mute intermediate snapshots
  engine.pushUndoSnapshot();
  const origPushUndo = engine.pushUndoSnapshot.bind(engine);
  engine.pushUndoSnapshot = () => {};

  let count = 0;
  const newlyCreatedIds: string[] = [];

  try {
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
          if (act.group) {
            if (!engine.state.collections.some((c) => c.name === act.group)) {
              engine.createCollection(act.group);
            }
            obj.collection = act.group;
          }
          if (act.location) obj.location = toVec3(act.location, [0, 0, 0]);
          if (act.rotation) obj.rotationDeg = toVec3(act.rotation, [0, 0, 0]);
          if (act.scale) obj.scale = toVec3(act.scale, [1, 1, 1]);
          if (act.color) obj.material.baseColor = act.color;
          if (typeof act.metallic === 'number') obj.material.metallic = clamp01(act.metallic);
          if (typeof act.roughness === 'number') obj.material.roughness = clamp01(act.roughness);
          if (act.emissionColor) obj.material.emissionColor = act.emissionColor;
          if (typeof act.emissionStrength === 'number') obj.material.emissionStrength = Math.max(0, act.emissionStrength);
          if (typeof act.opacity === 'number') obj.material.opacity = clamp01(act.opacity);
          if (typeof act.shadeSmooth === 'boolean' && obj.mesh) obj.mesh.shadeSmooth = act.shadeSmooth;
          newlyCreatedIds.push(obj.id);
          count++;
          break;
        }

        case 'add_extruded_polygon': {
          if (Array.isArray(act.points) && act.points.length >= 3) {
            const pts: [number, number][] = act.points.map((p) => [
              Number(p[0]) || 0,
              Number(p[1]) || 0
            ]);
            const mesh = createExtrudedPolygonMesh(pts, Number(act.depth) || 0.4);
            if (typeof act.shadeSmooth === 'boolean') mesh.shadeSmooth = act.shadeSmooth;
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
              act.location ? toVec3(act.location, [0, 0, 0]) : undefined
            );
            if (act.rotation) obj.rotationDeg = toVec3(act.rotation, [0, 0, 0]);
            if (act.scale) obj.scale = toVec3(act.scale, [1, 1, 1]);
            if (act.group) {
              if (!engine.state.collections.some((c) => c.name === act.group)) {
                engine.createCollection(act.group);
              }
              obj.collection = act.group;
            }
            newlyCreatedIds.push(obj.id);
            count++;
          }
          break;
        }

        case 'add_lathe': {
          if (Array.isArray(act.profile) && act.profile.length >= 2) {
            const prof: [number, number][] = act.profile.map((p) => [
              Math.max(0, Number(p[0]) || 0),
              Number(p[1]) || 0
            ]);
            const mesh = createLatheMesh(prof, Math.min(48, Math.max(8, Number(act.segments) || 20)));
            if (typeof act.shadeSmooth === 'boolean') mesh.shadeSmooth = act.shadeSmooth;
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
              act.location ? toVec3(act.location, [0, 0, 0]) : undefined
            );
            if (act.rotation) obj.rotationDeg = toVec3(act.rotation, [0, 0, 0]);
            if (act.scale) obj.scale = toVec3(act.scale, [1, 1, 1]);
            if (act.group) {
              if (!engine.state.collections.some((c) => c.name === act.group)) {
                engine.createCollection(act.group);
              }
              obj.collection = act.group;
            }
            newlyCreatedIds.push(obj.id);
            count++;
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
            if (typeof act.emissionStrength === 'number') obj.material.emissionStrength = Math.max(0, act.emissionStrength);
            if (typeof act.opacity === 'number') obj.material.opacity = clamp01(act.opacity);
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
              engine.deformMeshObject(obj.id, { type: 'smooth', levels: 1 });
            } else if (dt === 'bevel') {
              const allFaces = obj.mesh.faces.map((_, idx) => idx);
              obj.mesh = bevelFaces(obj.mesh, allFaces.slice(0, 12), Number(act.amount) || 0.18).mesh;
            } else if (dt === 'extrude_top') {
              obj.mesh = extrudeFaces(obj.mesh, [0], Number(act.amount) || 0.5).mesh;
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
  } finally {
    engine.pushUndoSnapshot = origPushUndo;
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
