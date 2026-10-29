export interface DropdownItem {
  label?: string;
  shortcut?: string;
  separator?: boolean;
  sectionTitle?: string;
  onClick?: () => void;
}

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
  }, 2100);
}

export function openSplashModal(actions: {
  onNewGeneral: () => void;
  onNewSculpting: () => void;
  onImportModel: () => void;
  onExportOBJ: () => void;
}): void {
  const overlay = document.createElement('div');
  overlay.className = 'modix-modal-overlay';
  overlay.innerHTML = `
    <div class="modix-splash-card">
      <div class="splash-hero">
        <img src="./brand/modix-full-white.png" alt="Modix 3D" />
        <div class="splash-version">Modix 3D Studio v1.0.0 — Mobile Landscape Edition (APK &amp; IPA)</div>
      </div>
      <div class="splash-actions">
        <button type="button" class="modix-btn primary" data-act="general">New General Scene</button>
        <button type="button" class="modix-btn" data-act="sculpt">New Sculpting Sphere</button>
        <button type="button" class="modix-btn" data-act="import">Import .OBJ / .STL / .MODIX</button>
        <button type="button" class="modix-btn" data-act="export">Export Scene (.OBJ)</button>
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
    actions.onExportOBJ();
  });

  document.body.appendChild(overlay);
}

export function openRenderResultModal(
  dataUrl: string,
  onSavePNG: () => void
): void {
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
        <button type="button" class="modix-btn" data-act="close2">Close</button>
        <button type="button" class="modix-btn primary" data-act="save">Save / Share PNG</button>
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
