import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createPrimitiveMesh } from '../engine/MeshOperations';
import type { ModixProjectState } from '../types/scene';

const SUPABASE_URL = 'https://hacgzoivstnpzfccebcv.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY2d6b2l2c3RucHpmY2NlYmN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyODg3MzksImV4cCI6MjEwODg2NDczOX0.vJcLoASnW-Ga5Itc_gBLEQ16SS0V6doafWzu0LFk7h8';

const LS_FALLBACK_SESSION_KEY = 'modix_account_fallback_session_v1';
const LS_FALLBACK_USERS_KEY = 'modix_account_fallback_users_v1';
const LS_PROJECTS_CACHE_PREFIX = 'modix_user_projects_cache_v1_';

export interface ModixUserAccount {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
}

export interface ModixSavedProject {
  id: string;
  userId: string;
  name: string;
  thumbnailUrl?: string;
  projectData: ModixProjectState;
  objectCount: number;
  createdAt: string;
  updatedAt: string;
}

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'modix_supabase_auth_v1'
      }
    });
  }
  return supabaseInstance;
}

/** Generates a crisp black-and-white SVG avatar monogram from user's name/email */
export function buildMonogramAvatarDataUrl(name: string, email: string): string {
  const source = (name || email || 'M').trim();
  const parts = source.split(/[\s._@-]+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : source.slice(0, 2).toUpperCase();

  const safeInitials = initials.replace(/[^A-Z0-9À-Ý]/gi, '') || 'M';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#2c2c2c"/>
        <stop offset="100%" stop-color="#111111"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="64" fill="url(#bg)"/>
    <circle cx="64" cy="64" r="61" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="2"/>
    <text x="64" y="66" text-anchor="middle" dominant-baseline="central" fill="#f5f5f5" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="46" font-weight="700" letter-spacing="1">${safeInitials}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function sha256Hex(input: string): Promise<string> {
  const normalized = input.trim().toLowerCase();
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = new TextEncoder().encode(normalized);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return '';
}

/** Resolves actual Gravatar photo associated with the user's email if one exists, else crisp SVG avatar */
export async function resolveEmailAvatarUrl(
  email: string,
  name: string,
  customAvatar?: string
): Promise<string> {
  if (customAvatar && customAvatar.trim().length > 0) {
    return customAvatar.trim();
  }
  const fallback = buildMonogramAvatarDataUrl(name, email);
  if (typeof Image === 'undefined') return fallback;

  try {
    const hash = await sha256Hex(email);
    if (!hash) return fallback;
    const gravatarUrl = `https://www.gravatar.com/avatar/${hash}?s=160&d=404`;
    const exists = await new Promise<boolean>((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => resolve(false), 1800);
      img.onload = () => {
        clearTimeout(timer);
        resolve(true);
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
      img.src = gravatarUrl;
    });
    return exists ? gravatarUrl : fallback;
  } catch {
    return fallback;
  }
}

/** Downscales a user-selected image file to a clean 160x160 square avatar data URL */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const rawUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler imagem.'));
    reader.readAsDataURL(file);
  });

  if (typeof document === 'undefined') return rawUrl;
  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = 160;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(rawUrl);
        return;
      }
      const minSide = Math.min(img.width, img.height);
      const sx = (img.width - minSide) * 0.5;
      const sy = (img.height - minSide) * 0.5;
      ctx.fillStyle = '#141414';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => resolve(rawUrl);
    img.src = rawUrl;
  });
}

function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /failed to fetch|networkerror|load failed|fetch|offline/i.test(msg);
}

function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'Este e-mail já possui uma conta. Use a aba "Entrar".';
  }
  if (m.includes('invalid login credentials')) {
    return 'E-mail ou senha incorretos.';
  }
  if (m.includes('password should be at least')) {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }
  if (m.includes('unable to validate email') || m.includes('invalid email')) {
    return 'Informe um endereço de e-mail válido.';
  }
  return message || 'Não foi possível autenticar sua conta.';
}

interface LocalFallbackUser extends ModixUserAccount {
  passwordHash: string;
}

function readLocalUsers(): LocalFallbackUser[] {
  try {
    const raw = localStorage.getItem(LS_FALLBACK_USERS_KEY);
    return raw ? (JSON.parse(raw) as LocalFallbackUser[]) : [];
  } catch {
    return [];
  }
}

function writeLocalUsers(users: LocalFallbackUser[]): void {
  try {
    localStorage.setItem(LS_FALLBACK_USERS_KEY, JSON.stringify(users));
  } catch {
    // ignore quota errors
  }
}

function saveLocalSession(acc: ModixUserAccount | null): void {
  try {
    if (!acc) localStorage.removeItem(LS_FALLBACK_SESSION_KEY);
    else localStorage.setItem(LS_FALLBACK_SESSION_KEY, JSON.stringify(acc));
  } catch {
    // ignore
  }
}

function readLocalSession(): ModixUserAccount | null {
  try {
    const raw = localStorage.getItem(LS_FALLBACK_SESSION_KEY);
    return raw ? (JSON.parse(raw) as ModixUserAccount) : null;
  } catch {
    return null;
  }
}

export async function getCurrentAccount(): Promise<ModixUserAccount | null> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.auth.getSession();
    if (!error && data.session?.user) {
      const u = data.session.user;
      const email = u.email || '';
      let name =
        (u.user_metadata?.full_name as string | undefined) ||
        email.split('@')[0] ||
        'Usuário';
      let avatarUrl = (u.user_metadata?.avatar_url as string | undefined) || '';

      const { data: prof } = await sb
        .from('modix_profiles')
        .select('full_name, avatar_url')
        .eq('id', u.id)
        .maybeSingle();

      if (prof) {
        if (prof.full_name) name = prof.full_name;
        if (prof.avatar_url) avatarUrl = prof.avatar_url;
      }

      if (!avatarUrl) {
        avatarUrl = await resolveEmailAvatarUrl(email, name);
      }

      const acc: ModixUserAccount = { id: u.id, email, name, avatarUrl };
      saveLocalSession(acc);
      return acc;
    }
  } catch (err) {
    if (isNetworkError(err)) {
      return readLocalSession();
    }
  }
  return readLocalSession();
}

export async function signUpWithEmail(
  rawEmail: string,
  password: string,
  rawName: string,
  customAvatarDataUrl?: string
): Promise<ModixUserAccount> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes('@') || !email.includes('.')) {
    throw new Error('Informe um endereço de e-mail válido.');
  }
  if (!password || password.length < 6) {
    throw new Error('A senha precisa ter no mínimo 6 caracteres.');
  }
  const name = rawName.trim() || email.split('@')[0] || 'Usuário';
  const avatarUrl = await resolveEmailAvatarUrl(email, name, customAvatarDataUrl);

  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
          avatar_url: avatarUrl
        }
      }
    });

    if (error) {
      if (isNetworkError(error)) throw error;
      throw new Error(translateAuthError(error.message));
    }

    const user = data.user;
    if (!user) {
      throw new Error('Não foi possível concluir a criação da conta.');
    }

    // Ensure profile row has latest name & avatar
    await sb.from('modix_profiles').upsert(
      {
        id: user.id,
        email,
        full_name: name,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'id' }
    );

    const acc: ModixUserAccount = { id: user.id, email, name, avatarUrl };
    saveLocalSession(acc);
    return acc;
  } catch (err) {
    if (!isNetworkError(err)) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    // Offline fallback so native mobile APK/IPA works even with zero connectivity
    const users = readLocalUsers();
    if (users.some((u) => u.email === email)) {
      throw new Error('Este e-mail já possui uma conta neste dispositivo. Use "Entrar".');
    }
    const passwordHash = (await sha256Hex(`${email}:${password}`)) || password;
    const acc: ModixUserAccount = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `local_${Date.now()}`,
      email,
      name,
      avatarUrl
    };
    users.push({ ...acc, passwordHash });
    writeLocalUsers(users);
    saveLocalSession(acc);
    return acc;
  }
}

export async function signInWithEmail(
  rawEmail: string,
  password: string
): Promise<ModixUserAccount> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('Informe seu endereço de e-mail.');
  }
  if (!password) {
    throw new Error('Informe sua senha.');
  }

  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      if (isNetworkError(error)) throw error;
      throw new Error(translateAuthError(error.message));
    }
    const u = data.user;
    let name =
      (u.user_metadata?.full_name as string | undefined) ||
      email.split('@')[0] ||
      'Usuário';
    let avatarUrl = (u.user_metadata?.avatar_url as string | undefined) || '';

    const { data: prof } = await sb
      .from('modix_profiles')
      .select('full_name, avatar_url')
      .eq('id', u.id)
      .maybeSingle();

    if (prof) {
      if (prof.full_name) name = prof.full_name;
      if (prof.avatar_url) avatarUrl = prof.avatar_url;
    }

    if (!avatarUrl) {
      avatarUrl = await resolveEmailAvatarUrl(email, name);
    }

    const acc: ModixUserAccount = { id: u.id, email, name, avatarUrl };
    saveLocalSession(acc);
    return acc;
  } catch (err) {
    if (!isNetworkError(err)) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    const users = readLocalUsers();
    const passwordHash = (await sha256Hex(`${email}:${password}`)) || password;
    const found = users.find((u) => u.email === email && u.passwordHash === passwordHash);
    if (!found) {
      throw new Error('E-mail ou senha incorretos (modo offline).');
    }
    const acc: ModixUserAccount = {
      id: found.id,
      email: found.email,
      name: found.name,
      avatarUrl: found.avatarUrl
    };
    saveLocalSession(acc);
    return acc;
  }
}

export async function updateAccountProfile(
  account: ModixUserAccount,
  updates: { name?: string; avatarUrl?: string }
): Promise<ModixUserAccount> {
  const next: ModixUserAccount = {
    ...account,
    name: updates.name !== undefined ? updates.name.trim() || account.name : account.name,
    avatarUrl: updates.avatarUrl !== undefined ? updates.avatarUrl : account.avatarUrl
  };
  saveLocalSession(next);

  try {
    const sb = getSupabaseClient();
    await sb.auth.updateUser({
      data: { full_name: next.name, avatar_url: next.avatarUrl }
    });
    await sb.from('modix_profiles').upsert(
      {
        id: next.id,
        email: next.email,
        full_name: next.name,
        avatar_url: next.avatarUrl,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'id' }
    );
  } catch {
    // Keep updated locally if offline
  }

  const localUsers = readLocalUsers();
  const idx = localUsers.findIndex((u) => u.id === next.id || u.email === next.email);
  if (idx >= 0) {
    localUsers[idx] = { ...localUsers[idx], name: next.name, avatarUrl: next.avatarUrl };
    writeLocalUsers(localUsers);
  }
  return next;
}

export async function signOutAccount(): Promise<void> {
  saveLocalSession(null);
  try {
    const sb = getSupabaseClient();
    await sb.auth.signOut();
  } catch {
    // ignore network failure during signout
  }
}

export async function deleteAccountPermanently(userId: string): Promise<void> {
  try {
    const sb = getSupabaseClient();
    const { error } = await sb.rpc('delete_own_account');
    if (error && !isNetworkError(error)) {
      throw new Error(error.message);
    }
    await sb.auth.signOut();
  } catch (err) {
    if (!isNetworkError(err)) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  saveLocalSession(null);
  try {
    localStorage.removeItem(`${LS_PROJECTS_CACHE_PREFIX}${userId}`);
    const users = readLocalUsers().filter((u) => u.id !== userId);
    writeLocalUsers(users);
  } catch {
    // ignore
  }
}

// ============================================================================
// USER PROJECTS STORAGE (Supabase Cloud + Local Device Cache)
// ============================================================================

function readCachedProjects(userId: string): ModixSavedProject[] {
  try {
    const raw = localStorage.getItem(`${LS_PROJECTS_CACHE_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ModixSavedProject[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedProjects(userId: string, list: ModixSavedProject[]): void {
  try {
    localStorage.setItem(`${LS_PROJECTS_CACHE_PREFIX}${userId}`, JSON.stringify(list));
  } catch {
    // If quota is tight due to large embedded textures, store lightweight thumbnails in cache
    try {
      const compact = list.map((p) => ({ ...p, thumbnailUrl: undefined }));
      localStorage.setItem(`${LS_PROJECTS_CACHE_PREFIX}${userId}`, JSON.stringify(compact));
    } catch {
      // ignore
    }
  }
}

interface DbProjectRow {
  id: string;
  user_id: string;
  name: string;
  thumbnail_url: string | null;
  project_data: ModixProjectState;
  object_count: number;
  created_at: string;
  updated_at: string;
}

function mapDbRowToProject(row: DbProjectRow): ModixSavedProject {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    thumbnailUrl: row.thumbnail_url || undefined,
    projectData: row.project_data,
    objectCount: row.object_count ?? row.project_data?.objects?.length ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listUserProjects(userId: string): Promise<ModixSavedProject[]> {
  const local = readCachedProjects(userId);
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('modix_projects')
      .select('id, user_id, name, thumbnail_url, project_data, object_count, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      if (isNetworkError(error)) return local;
      throw error;
    }

    const remote = ((data || []) as DbProjectRow[]).map(mapDbRowToProject);
    // Merge any unsynced local-only projects created while offline
    const remoteIds = new Set(remote.map((r) => r.id));
    const merged = [...remote];
    for (const lp of local) {
      if (!remoteIds.has(lp.id)) {
        merged.push(lp);
      }
    }
    merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    writeCachedProjects(userId, merged);
    return merged;
  } catch {
    return local;
  }
}

export function createInitialBlankProjectState(projectName: string): ModixProjectState {
  return {
    version: '2.1.0',
    sceneName: projectName || 'Novo Projeto',
    viewLayerName: 'ViewLayer',
    workspace: 'Layout',
    mode: 'OBJECT',
    editSelectMode: 'VERTEX',
    activeTool: 'select_box',
    shading: 'SOLID',
    showOverlays: true,
    xray: false,
    snapEnabled: false,
    proportionalEnabled: false,
    orientation: 'Global',
    pivotPoint: 'Median Point',
    isOrthographic: false,
    inCameraView: false,
    viewLabel: 'User Perspective',
    cursor3D: [0, 0, 0],
    collections: [{ id: 'col_main', name: 'Collection', visible: true, collapsed: false }],
    activeCollection: 'Collection',
    objects: [
      {
        id: 'obj_camera',
        name: 'Camera',
        kind: 'CAMERA',
        collection: 'Collection',
        visible: true,
        selectable: true,
        location: [7.36, -6.93, 4.96],
        rotationDeg: [63.6, 0, 46.7],
        rotationMode: 'XYZ Euler',
        scale: [1, 1, 1],
        deltaLocation: [0, 0, 0],
        deltaRotationDeg: [0, 0, 0],
        deltaScale: [1, 1, 1],
        lockLocation: { x: false, y: false, z: false },
        lockRotation: { x: false, y: false, z: false },
        lockScale: { x: false, y: false, z: false },
        modifiers: [],
        material: {
          name: 'CameraMat',
          baseColor: '#ffffff',
          metallic: 0,
          roughness: 0.5,
          emissionColor: '#000000',
          emissionStrength: 0,
          opacity: 1,
          wireframe: false
        },
        cameraFov: 50,
        cameraClipStart: 0.1,
        cameraClipEnd: 1000,
        keyframes: []
      },
      {
        id: 'obj_cube',
        name: 'Cube',
        kind: 'MESH',
        collection: 'Collection',
        visible: true,
        selectable: true,
        location: [0, 0, 0],
        rotationDeg: [0, 0, 0],
        rotationMode: 'XYZ Euler',
        scale: [1, 1, 1],
        deltaLocation: [0, 0, 0],
        deltaRotationDeg: [0, 0, 0],
        deltaScale: [1, 1, 1],
        lockLocation: { x: false, y: false, z: false },
        lockRotation: { x: false, y: false, z: false },
        lockScale: { x: false, y: false, z: false },
        primitive: 'cube',
        mesh: createPrimitiveMesh('cube'),
        modifiers: [],
        material: {
          name: 'Material',
          baseColor: '#d4d4d4',
          metallic: 0.08,
          roughness: 0.45,
          emissionColor: '#000000',
          emissionStrength: 0,
          opacity: 1,
          wireframe: false,
          uvProjection: 'box',
          repeatX: 1,
          repeatY: 1
        },
        keyframes: []
      },
      {
        id: 'obj_light',
        name: 'Light',
        kind: 'LIGHT',
        collection: 'Collection',
        visible: true,
        selectable: true,
        location: [4.08, 1.01, 5.9],
        rotationDeg: [37, 3, 107],
        rotationMode: 'XYZ Euler',
        scale: [1, 1, 1],
        deltaLocation: [0, 0, 0],
        deltaRotationDeg: [0, 0, 0],
        deltaScale: [1, 1, 1],
        lockLocation: { x: false, y: false, z: false },
        lockRotation: { x: false, y: false, z: false },
        lockScale: { x: false, y: false, z: false },
        modifiers: [],
        material: {
          name: 'LightMat',
          baseColor: '#ffffff',
          metallic: 0,
          roughness: 0.5,
          emissionColor: '#ffffff',
          emissionStrength: 1,
          opacity: 1,
          wireframe: false
        },
        lightKind: 'POINT',
        lightColor: '#ffffff',
        lightPower: 1000,
        keyframes: []
      }
    ],
    selectedIds: ['obj_cube'],
    activeObjectId: 'obj_cube',
    selectedVertices: [],
    selectedFaces: [],
    currentFrame: 1,
    startFrame: 1,
    endFrame: 250,
    fps: 24,
    isPlaying: false,
    playReverse: false,
    autoKeying: false,
    activePropertiesTab: 'object',
    outlinerSearch: '',
    propertiesSearch: '',
    deltaTransformExpanded: false,
    sculpt: {
      radius: 0.65,
      strength: 0.35,
      symmetryX: false,
      symmetryY: false,
      symmetryZ: false,
      paintColor: '#ffffff',
      paintSecondaryColor: '#1a1a1a',
      paintBrushPx: 18,
      paintOpacity: 1,
      paintTarget: 'texture',
      paintToTexture: true,
      brushPixelSize: 18
    },
    world: {
      backgroundColor: '#3a3a3a',
      ambientStrength: 0.55
    },
    compositor: {
      useNodes: true,
      monochromeBW: false,
      contrast: 1.04,
      exposure: 1.0,
      vignette: 0.15,
      bloom: 0
    },
    annotations: [],
    measures: []
  };
}

export async function createUserProject(
  userId: string,
  name: string,
  customState?: ModixProjectState,
  thumbnailUrl?: string
): Promise<ModixSavedProject> {
  const cleanName = name.trim() || 'Novo Projeto';
  const state = customState
    ? { ...customState, sceneName: cleanName }
    : createInitialBlankProjectState(cleanName);
  const now = new Date().toISOString();
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-modix`;
  const objectCount = state.objects?.length ?? 0;

  const project: ModixSavedProject = {
    id,
    userId,
    name: cleanName,
    thumbnailUrl,
    projectData: state,
    objectCount,
    createdAt: now,
    updatedAt: now
  };

  const cached = readCachedProjects(userId);
  writeCachedProjects(userId, [project, ...cached]);

  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('modix_projects')
      .insert({
        id,
        user_id: userId,
        name: cleanName,
        thumbnail_url: thumbnailUrl || null,
        project_data: state,
        object_count: objectCount
      })
      .select('id, user_id, name, thumbnail_url, project_data, object_count, created_at, updated_at')
      .single();

    if (!error && data) {
      const saved = mapDbRowToProject(data as DbProjectRow);
      writeCachedProjects(
        userId,
        [saved, ...cached.filter((p) => p.id !== saved.id)]
      );
      return saved;
    }
  } catch {
    // Keep cached offline
  }

  return project;
}

export async function saveUserProject(
  projectId: string,
  userId: string,
  name: string,
  projectData: ModixProjectState,
  thumbnailUrl?: string
): Promise<ModixSavedProject> {
  const now = new Date().toISOString();
  const cleanName = name.trim() || projectData.sceneName || 'Projeto';
  const syncedState: ModixProjectState = { ...projectData, sceneName: cleanName };
  const objectCount = syncedState.objects?.length ?? 0;

  const cached = readCachedProjects(userId);
  const existing = cached.find((p) => p.id === projectId);
  const updated: ModixSavedProject = {
    id: projectId,
    userId,
    name: cleanName,
    thumbnailUrl: thumbnailUrl ?? existing?.thumbnailUrl,
    projectData: syncedState,
    objectCount,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  writeCachedProjects(userId, [updated, ...cached.filter((p) => p.id !== projectId)]);

  try {
    const sb = getSupabaseClient();
    await sb.from('modix_projects').upsert(
      {
        id: projectId,
        user_id: userId,
        name: cleanName,
        thumbnail_url: updated.thumbnailUrl || null,
        project_data: syncedState,
        object_count: objectCount,
        updated_at: now
      },
      { onConflict: 'id' }
    );
  } catch {
    // Keep cached offline
  }

  return updated;
}

export async function renameUserProject(
  projectId: string,
  userId: string,
  newName: string
): Promise<void> {
  const clean = newName.trim();
  if (!clean) return;
  const now = new Date().toISOString();

  const cached = readCachedProjects(userId).map((p) =>
    p.id === projectId
      ? { ...p, name: clean, projectData: { ...p.projectData, sceneName: clean }, updatedAt: now }
      : p
  );
  writeCachedProjects(userId, cached);

  try {
    const sb = getSupabaseClient();
    const target = cached.find((p) => p.id === projectId);
    await sb
      .from('modix_projects')
      .update({
        name: clean,
        ...(target ? { project_data: target.projectData } : {}),
        updated_at: now
      })
      .eq('id', projectId)
      .eq('user_id', userId);
  } catch {
    // ignore offline
  }
}

export async function deleteUserProject(projectId: string, userId: string): Promise<void> {
  const cached = readCachedProjects(userId).filter((p) => p.id !== projectId);
  writeCachedProjects(userId, cached);

  try {
    const sb = getSupabaseClient();
    await sb.from('modix_projects').delete().eq('id', projectId).eq('user_id', userId);
  } catch {
    // ignore offline
  }
}
