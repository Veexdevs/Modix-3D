import type { OBJExportOptions } from '../engine/Exporters';

export interface DropdownItem {
  label?: string;
  shortcut?: string;
  separator?: boolean;
  sectionTitle?: string;
  onClick?: () => void;
}

export type ExportFormatChoice =
  | 'obj_roblox'
  | 'obj_blender'
  | 'mtl'
  | 'tex_png'
  | 'rbxmx'
  | 'glb'
  | 'gltf'
  | 'stl'
  | 'ply'
  | 'usdz'
  | 'dae'
  | 'modix';

let activeMenuCleanup: (() => void) | null = null;
let toastTimer: number | undefined;

export function closeActiveDropdown(): void {
  if (activeMenuCleanup) {
    activeMenuCleanup();
    activeMenuCleanup = null;
  }
}

export function openDropdownMenu(anchor: HTMLElement, items: DropdownItem[]): void {
  closeActiveDropdown();

  const backdrop = document.createElement('div');
  backdrop.className = 'modix-menu-backdrop';

  const menu = document.createElement('div');
  menu.className = 'modix-dropdown-menu';

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      menu.appendChild(sep);
      continue;
    }
    if (item.sectionTitle) {
      const lbl = document.createElement('div');
      lbl.className = 'menu-section-lbl';
      lbl.textContent = item.sectionTitle;
      menu.appendChild(lbl);
      continue;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-item';
    const textSpan = document.createElement('span');
    textSpan.textContent = item.label || '';
    btn.appendChild(textSpan);
    if (item.shortcut) {
      const sc = document.createElement('span');
      sc.className = 'shortcut';
      sc.textContent = item.shortcut;
      btn.appendChild(sc);
    }
    btn.addEventListener('click', () => {
      closeActiveDropdown();
      item.onClick?.();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(backdrop);
  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 3;
  if (left + menuRect.width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - menuRect.width - 8);
  }
  if (top + menuRect.height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - menuRect.height - 3);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const cleanup = () => {
    backdrop.remove();
    menu.remove();
  };
  backdrop.addEventListener('pointerdown', closeActiveDropdown);
  activeMenuCleanup = cleanup;
}

export function showToast(message: string): void {
  let toast = document.querySelector<HTMLElement>('.modix-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'modix-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.display = 'block';
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (toast) toast.style.display = 'none';
  }, 2300);
}

/** Mobile-safe inline text prompt modal (for Rename Object / Create Group) */
export function openTextPromptModal(opts: {
  title: string;
  label: string;
  initialValue: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
}): void {
  const overlay = document.createElement('div');
  overlay.className = 'modix-modal-overlay';
  overlay.innerHTML = `
    <div class="modix-splash-card" style="width:min(360px, 88vw);">
      <div class="drawer-hdr">
        <span>${escapeHtml(opts.title)}</span>
        <button type="button" class="modix-btn" data-close style="height:20px;padding:0 6px;">✕</button>
      </div>
      <form id="modix-prompt-form" style="padding:12px;display:flex;flex-direction:column;gap:10px;background:#111;">
        <label style="display:flex;flex-direction:column;gap:5px;color:#ccc;font-size:11px;">
          <span>${escapeHtml(opts.label)}</span>
          <input type="text" id="modix-prompt-inp" class="props-name-input" style="height:28px;font-size:12px;" value="${escapeHtml(opts.initialValue)}" />
        </label>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="modix-btn" data-close>Cancelar</button>
          <button type="submit" class="modix-btn primary">${escapeHtml(opts.confirmLabel || 'Confirmar')}</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);
  const inp = overlay.querySelector<HTMLInputElement>('#modix-prompt-inp')!;
  setTimeout(() => {
    inp.focus();
    inp.select();
  }, 30);

  overlay.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => overlay.remove())
  );
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector('#modix-prompt-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = inp.value.trim();
    overlay.remove();
    if (v) opts.onConfirm(v);
  });
}

/** Interactive 3D Mesh Plane Cutter / Slicer Modal ("Recortar Malha 3D") */
export function openSliceMeshModal(
  objectName: string,
  onSlice: (axis: 'X' | 'Y' | 'Z', mode: 'split' | 'keep_pos' | 'keep_neg', offset: number) => void
): void {
  const overlay = document.createElement('div');
  overlay.className = 'modix-modal-overlay';
  overlay.innerHTML = `
    <div class="modix-splash-card" style="width:min(400px, 90vw);">
      <div class="drawer-hdr">
        <span>✂ Recortar / Fatiar Malha 3D — ${escapeHtml(objectName)}</span>
        <button type="button" class="modix-btn" data-close style="height:20px;padding:0 6px;">✕</button>
      </div>
      <div style="padding:12px;display:flex;flex-direction:column;gap:10px;background:#111;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <span style="color:#bbb;font-size:11px;">Eixo do Corte:</span>
          <select id="slice-axis" class="xf-select" style="height:26px;">
            <option value="Z">Horizontal — Eixo Z (Cima / Baixo)</option>
            <option value="X">Vertical — Eixo X (Esquerda / Direita)</option>
            <option value="Y">Profundidade — Eixo Y (Frente / Trás)</option>
          </select>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <span style="color:#bbb;font-size:11px;">Modo de Recorte:</span>
          <select id="slice-mode" class="xf-select" style="height:26px;">
            <option value="split">Dividir em 2 Objetos Independentes (Com Tampa)</option>
            <option value="keep_pos">Recortar e Manter Apenas Lado Positivo (+)</option>
            <option value="keep_neg">Recortar e Manter Apenas Lado Negativo (-)</option>
          </select>
        </div>
        <label style="display:flex;justify-content:space-between;align-items:center;color:#ccc;">
          <span>Posição do Plano (<b id="lbl-slice-off">0.00 m</b>)</span>
          <input type="range" id="slice-off" min="-1.5" max="1.5" step="0.05" value="0" style="width:140px;" />
        </label>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px;">
          <button type="button" class="modix-btn" data-close>Cancelar</button>
          <button type="button" class="modix-btn primary" id="btn-do-slice">✂ Recortar Agora</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  const offInp = overlay.querySelector<HTMLInputElement>('#slice-off')!;
  offInp.addEventListener('input', () => {
    overlay.querySelector('#lbl-slice-off')!.textContent = `${Number(offInp.value).toFixed(2)} m`;
  });
  overlay.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => overlay.remove())
  );
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector('#btn-do-slice')?.addEventListener('click', () => {
    const axis = (overlay.querySelector<HTMLSelectElement>('#slice-axis')?.value || 'Z') as 'X' | 'Y' | 'Z';
    const mode = (overlay.querySelector<HTMLSelectElement>('#slice-mode')?.value || 'split') as
      | 'split'
      | 'keep_pos'
      | 'keep_neg';
    const offset = parseFloat(offInp.value) || 0;
    overlay.remove();
    onSlice(axis, mode, offset);
  });
}

/** Multi-Format Export Hub with Dedicated Roblox Studio .OBJ Tuning */
export function openExportHubModal(
  hasTextureOnActive: boolean,
  onExport: (fmt: ExportFormatChoice, objOptions?: OBJExportOptions) => void
): void {
  const overlay = document.createElement('div');
  overlay.className = 'modix-modal-overlay';
  overlay.innerHTML = `
    <div class="modix-splash-card" style="width:min(520px, 94vw);">
      <div class="drawer-hdr">
        <span>Exportar Modelo 3D &amp; Roblox Studio</span>
        <button type="button" class="modix-btn" data-close style="height:20px;padding:0 6px;">✕</button>
      </div>
      <div style="padding:12px;display:flex;flex-direction:column;gap:10px;background:#101010;max-height:80vh;overflow-y:auto;">
        <!-- Highlighted Roblox Studio Box -->
        <div style="background:#171c26;border:1px solid #2b4c7e;border-radius:6px;padding:10px;display:flex;flex-direction:column;gap:7px;">
          <div style="font-weight:600;color:#93c5fd;display:flex;justify-content:space-between;align-items:center;">
            <span>🎮 Roblox Studio (.OBJ + UVs + Normais Y-Up)</span>
            <span style="font-size:10px;background:#1e3a8a;color:#dbeafe;padding:2px 6px;border-radius:4px;">100% Compatível</span>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:#cbd5e1;">
            <label style="display:flex;align-items:center;gap:4px;">
              Escala Studs:
              <input type="number" id="exp-rbx-scale" value="1" min="0.1" max="100" step="0.5" class="xf-select" style="width:58px;height:22px;" />
            </label>
            <label style="display:flex;align-items:center;gap:4px;">
              <input type="checkbox" id="exp-rbx-combine" /> Unir tudo em 1 MeshPart só
            </label>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="modix-btn primary" data-exp="obj_roblox" style="flex:2;">⬇ Exportar .OBJ (Roblox Studio)</button>
            <button type="button" class="modix-btn" data-exp="mtl" style="flex:1;" title="Biblioteca de materiais .MTL">⬇ .MTL</button>
            ${
              hasTextureOnActive
                ? `<button type="button" class="modix-btn" data-exp="tex_png" style="flex:1;" title="Baixar PNG para TextureID no Roblox">⬇ Textura .PNG</button>`
                : ''
            }
          </div>
          <button type="button" class="modix-btn" data-exp="rbxmx" style="width:100%;">⬇ Exportar Modelo Nativo Roblox XML (.RBXMX Parts)</button>
        </div>

        <!-- Universal 3D Formats Grid -->
        <div style="font-size:10.5px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Outros Formatos 3D Profissionais</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <button type="button" class="modix-btn" data-exp="glb">📦 glTF Binário (.GLB + Texturas)</button>
          <button type="button" class="modix-btn" data-exp="gltf">📄 glTF 2.0 JSON (.GLTF)</button>
          <button type="button" class="modix-btn" data-exp="obj_blender">🧊 Wavefront (.OBJ Z-Up Blender)</button>
          <button type="button" class="modix-btn" data-exp="dae">🔗 COLLADA (.DAE Maya/Godot)</button>
          <button type="button" class="modix-btn" data-exp="stl">🖨 Impressão 3D (.STL)</button>
          <button type="button" class="modix-btn" data-exp="ply">🎨 Stanford Polygon (.PLY RGB)</button>
          <button type="button" class="modix-btn" data-exp="usdz">📱 Apple AR (.USDZ iOS)</button>
          <button type="button" class="modix-btn" data-exp="modix">💾 Projeto Modix (.MODIX)</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('[data-close]')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelectorAll<HTMLButtonElement>('[data-exp]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fmt = btn.dataset.exp as ExportFormatChoice;
      const scale = parseFloat(overlay.querySelector<HTMLInputElement>('#exp-rbx-scale')?.value || '1') || 1;
      const combine = Boolean(overlay.querySelector<HTMLInputElement>('#exp-rbx-combine')?.checked);
      overlay.remove();
      onExport(fmt, {
        yUpForRoblox: fmt === 'obj_roblox',
        scale,
        triangulate: true,
        combineMeshes: combine
      });
    });
  });
}

export function openSplashModal(actions: {
  onNewGeneral: () => void;
  onNewSculpting: () => void;
  onImportModel: () => void;
  onExportHub: () => void;
  onOpenAIAgent?: () => void;
}): void {
  const overlay = document.createElement('div');
  overlay.className = 'modix-modal-overlay';
  overlay.innerHTML = `
    <div class="modix-splash-card">
      <div class="splash-hero">
        <img src="./brand/modix-full-white.png" alt="Modix 3D" />
        <div class="splash-version">Modix 3D Studio v2.0 — Mobile Landscape + Multi-IA &amp; Roblox Studio</div>
      </div>
      <div class="splash-actions">
        <button type="button" class="modix-btn primary" data-act="general">Nova Cena Geral</button>
        <button type="button" class="modix-btn" data-act="ai">✦ Abrir Agente Multi-IA</button>
        <button type="button" class="modix-btn" data-act="import">Importar 3D (.OBJ/.FBX/.GLB...)</button>
        <button type="button" class="modix-btn" data-act="export">Exportar (.OBJ Roblox / .GLB...)</button>
        <button type="button" class="modix-btn" data-act="sculpt" style="grid-column: span 2;">Nova Esfera de Escultura 3D</button>
      </div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector('[data-act="general"]')?.addEventListener('click', () => {
    overlay.remove();
    actions.onNewGeneral();
  });
  overlay.querySelector('[data-act="sculpt"]')?.addEventListener('click', () => {
    overlay.remove();
    actions.onNewSculpting();
  });
  overlay.querySelector('[data-act="import"]')?.addEventListener('click', () => {
    overlay.remove();
    actions.onImportModel();
  });
  overlay.querySelector('[data-act="export"]')?.addEventListener('click', () => {
    overlay.remove();
    actions.onExportHub();
  });
  overlay.querySelector('[data-act="ai"]')?.addEventListener('click', () => {
    overlay.remove();
    actions.onOpenAIAgent?.();
  });

  document.body.appendChild(overlay);
}

export function openRenderResultModal(dataUrl: string, onSavePNG: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'modix-modal-overlay';
  overlay.innerHTML = `
    <div class="modix-splash-card" style="width: min(560px, 92vw);">
      <div class="drawer-hdr">
        <span>Modix Render Result (1280 × 720)</span>
        <button type="button" class="modix-btn" data-act="close" style="height:20px;padding:0 6px;">✕</button>
      </div>
      <div style="padding:10px;background:#090909;display:flex;justify-content:center;">
        <img src="${dataUrl}" alt="Render Result" style="max-width:100%;max-height:58vh;border:1px solid #2b2b2b;border-radius:4px;" />
      </div>
      <div style="padding:10px;display:flex;justify-content:flex-end;gap:8px;background:#111;">
        <button type="button" class="modix-btn" data-act="close2">Fechar</button>
        <button type="button" class="modix-btn primary" data-act="save">Salvar / Compartilhar PNG</button>
      </div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector('[data-act="close"]')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('[data-act="close2"]')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('[data-act="save"]')?.addEventListener('click', () => {
    onSavePNG();
  });

  document.body.appendChild(overlay);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}
