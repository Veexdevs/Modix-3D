import type { OBJExportOptions } from '../engine/Exporters';
import { tr } from '../i18n/I18nService';
import { Icons } from '../icons/blenderIcons';

export interface DropdownItem {
  label?: string;
  icon?: string;
  shortcut?: string;
  separator?: boolean;
  divider?: boolean;
  danger?: boolean;
  sectionTitle?: string;
  onClick?: () => void;
}

export type ExportFormatChoice =
  | 'obj'
  | 'obj_zup'
  | 'mtl'
  | 'tex_png'
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
    if (item.separator || item.divider) {
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
    btn.className = `menu-item${item.danger ? ' danger' : ''}`;

    const leftWrap = document.createElement('span');
    leftWrap.className = 'menu-item-left';
    if (item.icon) {
      const icoSpan = document.createElement('span');
      icoSpan.className = 'menu-item-ico';
      icoSpan.innerHTML = item.icon;
      leftWrap.appendChild(icoSpan);
    }
    const textSpan = document.createElement('span');
    textSpan.textContent = item.label || '';
    leftWrap.appendChild(textSpan);
    btn.appendChild(leftWrap);

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
    toast.setAttribute('data-no-i18n', 'true');
    document.body.appendChild(toast);
  }
  toast.textContent = tr(message);
  toast.style.display = 'block';
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (toast) toast.style.display = 'none';
  }, 2300);
}

/** Mobile-safe inline text prompt modal */
export function openTextPromptModal(opts: {
  title: string;
  label: string;
  initialValue: string;
  placeholder?: string;
  confirmLabel?: string;
  extraActionLabel?: string;
  onExtraAction?: () => void;
  onConfirm: (value: string) => void;
}): void {
  const overlay = document.createElement('div');
  overlay.className = 'modix-modal-overlay';
  overlay.innerHTML = `
    <div class="modix-splash-card" style="width:min(380px, 90vw);">
      <div class="drawer-hdr">
        <span>${escapeHtml(tr(opts.title))}</span>
        <button type="button" class="modix-btn" data-close style="height:22px;padding:0 6px;">${Icons.close}</button>
      </div>
      <form id="modix-prompt-form" style="padding:12px;display:flex;flex-direction:column;gap:10px;background:#111;">
        <label style="display:flex;flex-direction:column;gap:5px;color:#ccc;font-size:11px;">
          <span>${escapeHtml(tr(opts.label))}</span>
          <input
            type="text"
            id="modix-prompt-inp"
            class="props-name-input"
            data-no-i18n="true"
            style="height:30px;font-size:12px;"
            value="${escapeHtml(opts.initialValue)}"
            placeholder="${escapeHtml(tr(opts.placeholder || ''))}"
          />
        </label>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div>
            ${
              opts.extraActionLabel
                ? `<button type="button" class="modix-btn" id="modix-prompt-extra">${Icons.upload}<span>${escapeHtml(tr(opts.extraActionLabel))}</span></button>`
                : ''
            }
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="modix-btn" data-close>${escapeHtml(tr('Cancelar'))}</button>
            <button type="submit" class="modix-btn primary">${escapeHtml(tr(opts.confirmLabel || 'Salvar'))}</button>
          </div>
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
  overlay.querySelector('#modix-prompt-extra')?.addEventListener('click', () => {
    overlay.remove();
    opts.onExtraAction?.();
  });
  overlay.querySelector('#modix-prompt-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = inp.value.trim();
    overlay.remove();
    if (v) opts.onConfirm(v);
  });
}

/** Interactive 3D Mesh Plane Cutter / Slicer Modal */
export function openSliceMeshModal(
  objectName: string,
  onSlice: (axis: 'X' | 'Y' | 'Z', mode: 'split' | 'keep_pos' | 'keep_neg', offset: number) => void
): void {
  const overlay = document.createElement('div');
  overlay.className = 'modix-modal-overlay';
  overlay.innerHTML = `
    <div class="modix-splash-card" style="width:min(400px, 90vw);">
      <div class="drawer-hdr">
        <span style="display:flex;align-items:center;gap:6px;">
          ${Icons.slice3d}<span>Recortar / Fatiar Malha 3D</span> — <span data-no-i18n="true">${escapeHtml(objectName)}</span>
        </span>
        <button type="button" class="modix-btn" data-close style="height:22px;padding:0 6px;">${Icons.close}</button>
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
          <button type="button" class="modix-btn primary" id="btn-do-slice">
            ${Icons.slice3d}<span>Recortar Agora</span>
          </button>
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

/** Universal Multi-Format 3D Export Hub */
export function openExportHubModal(
  hasTextureOnActive: boolean,
  onExport: (fmt: ExportFormatChoice, objOptions?: OBJExportOptions) => void
): void {
  const overlay = document.createElement('div');
  overlay.className = 'modix-modal-overlay';
  overlay.innerHTML = `
    <div class="modix-splash-card" style="width:min(530px, 94vw);">
      <div class="drawer-hdr">
        <span style="display:flex;align-items:center;gap:6px;">
          ${Icons.download}<span>Exportar Modelo 3D</span>
        </span>
        <button type="button" class="modix-btn" data-close style="height:22px;padding:0 6px;">${Icons.close}</button>
      </div>
      <div style="padding:12px;display:flex;flex-direction:column;gap:10px;background:#101010;max-height:80vh;overflow-y:auto;">
        <div style="background:#171717;border:1px solid #2c2c2c;border-radius:6px;padding:10px;display:flex;flex-direction:column;gap:8px;">
          <div style="font-weight:600;color:#e6e6e6;display:flex;justify-content:space-between;align-items:center;">
            <span style="display:flex;align-items:center;gap:6px;">${Icons.file3d}<span>Wavefront (.OBJ + .MTL + UVs)</span></span>
            <span style="font-size:10px;background:#242424;color:#d4d4d4;padding:2px 6px;border-radius:4px;">Y-Up Universal</span>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#bdbdbd;">
            <label style="display:flex;align-items:center;gap:5px;">
              Escala:
              <input type="number" id="exp-obj-scale" value="1" min="0.01" max="100" step="0.25" class="xf-select" style="width:62px;height:22px;" />
            </label>
            <label style="display:flex;align-items:center;gap:5px;">
              <input type="checkbox" id="exp-obj-combine" /> Combinar malhas visíveis em um único objeto
            </label>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="modix-btn primary" data-exp="obj" style="flex:2;">
              ${Icons.download}<span>Exportar .OBJ</span>
            </button>
            <button type="button" class="modix-btn" data-exp="mtl" style="flex:1;" title="Biblioteca de materiais .MTL">
              ${Icons.download}<span>.MTL</span>
            </button>
            ${
              hasTextureOnActive
                ? `<button type="button" class="modix-btn" data-exp="tex_png" style="flex:1;" title="Exportar mapa de textura PNG">${Icons.palette}<span>Textura .PNG</span></button>`
                : ''
            }
          </div>
        </div>

        <div style="font-size:10.5px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Formatos 3D Padrão da Indústria</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <button type="button" class="modix-btn" data-exp="glb">${Icons.file3d}<span>glTF Binário (.GLB + PBR)</span></button>
          <button type="button" class="modix-btn" data-exp="gltf">${Icons.file3d}<span>glTF 2.0 JSON (.GLTF)</span></button>
          <button type="button" class="modix-btn" data-exp="dae">${Icons.layers}<span>COLLADA 1.4 (.DAE)</span></button>
          <button type="button" class="modix-btn" data-exp="usdz">${Icons.cubeSmall}<span>Universal Scene (.USDZ)</span></button>
          <button type="button" class="modix-btn" data-exp="stl">${Icons.cubeSmall}<span>Stereolithography (.STL)</span></button>
          <button type="button" class="modix-btn" data-exp="ply">${Icons.palette}<span>Stanford Polygon (.PLY)</span></button>
          <button type="button" class="modix-btn" data-exp="obj_zup">${Icons.file3d}<span>Wavefront Z-Up (.OBJ)</span></button>
          <button type="button" class="modix-btn" data-exp="modix">${Icons.save}<span>Projeto Modix (.MODIX)</span></button>
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
      const scale = parseFloat(overlay.querySelector<HTMLInputElement>('#exp-obj-scale')?.value || '1') || 1;
      const combine = Boolean(overlay.querySelector<HTMLInputElement>('#exp-obj-combine')?.checked);
      overlay.remove();
      onExport(fmt, {
        yUp: fmt !== 'obj_zup',
        scale,
        triangulate: true,
        combineMeshes: combine
      });
    });
  });
}

export function openRenderResultModal(dataUrl: string, onSavePNG: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'modix-modal-overlay';
  overlay.innerHTML = `
    <div class="modix-splash-card" style="width: min(560px, 92vw);">
      <div class="drawer-hdr">
        <span style="display:flex;align-items:center;gap:6px;">
          ${Icons.cameraPhoto}<span>Resultado da Renderização (1280 x 720)</span>
        </span>
        <button type="button" class="modix-btn" data-act="close" style="height:22px;padding:0 6px;">${Icons.close}</button>
      </div>
      <div style="padding:10px;background:#090909;display:flex;justify-content:center;">
        <img src="${dataUrl}" alt="Render Result" style="max-width:100%;max-height:58vh;border:1px solid #2b2b2b;border-radius:4px;" />
      </div>
      <div style="padding:10px;display:flex;justify-content:flex-end;gap:8px;background:#111;">
        <button type="button" class="modix-btn" data-act="close2">Fechar</button>
        <button type="button" class="modix-btn primary" data-act="save">
          ${Icons.download}<span>Salvar / Compartilhar PNG</span>
        </button>
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
