import { saveDataUrlPNG } from '../engine/Exporters';
import type { ModixEngine } from '../engine/ModixEngine';
import {
  generateProceduralTextureDataUrl,
  type ProceduralTexturePreset
} from '../engine/TextureGenerator';
import { Icons } from '../icons/blenderIcons';
import type { UVProjectionMode } from '../types/scene';

type StudioDrawTool = 'brush' | 'airbrush' | 'line' | 'rect' | 'circle' | 'fill' | 'eraser';

const QUICK_PALETTE = [
  '#ffffff', '#d4d4d8', '#71717a', '#18181b',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#8b5a2b', '#fca5a5', '#93c5fd', '#fde047'
];

const PRESET_LIST: Array<{ id: ProceduralTexturePreset; label: string }> = [
  { id: 'studs', label: 'Relevo Tátil' },
  { id: 'checker', label: 'UV Grid' },
  { id: 'brick', label: 'Tijolos' },
  { id: 'wood', label: 'Madeira' },
  { id: 'metal', label: 'Metal' },
  { id: 'carbon', label: 'Carbono' },
  { id: 'scifi', label: 'Sci-Fi Neon' },
  { id: 'grass', label: 'Grama' },
  { id: 'stone', label: 'Pedra' },
  { id: 'lava', label: 'Lava' },
  { id: 'marble', label: 'Mármore' },
  { id: 'stripes', label: 'Listras' },
  { id: 'gradient', label: 'Gradiente' },
  { id: 'noise', label: 'Ruído' }
];

export function openTextureStudioModal(
  engine: ModixEngine,
  showToast: (msg: string) => void
): void {
  document.querySelectorAll('.modix-tex-studio-backdrop').forEach((el) => el.remove());

  const active = engine.getActiveObject();
  if (!active || active.kind !== 'MESH') {
    showToast('Selecione um objeto Mesh 3D para editar/pintar textura');
    return;
  }

  let tool: StudioDrawTool = 'brush';
  let primaryColor = engine.state.sculpt.paintColor || '#3b82f6';
  let secondaryColor = engine.state.sculpt.paintSecondaryColor || '#1e293b';
  let accentColor = '#00e5ff';
  let brushSize = engine.state.sculpt.paintBrushPx || 16;
  let opacity = Math.round((engine.state.sculpt.paintOpacity ?? 1) * 100);
  let mirrorX = false;
  let mirrorY = false;
  let showUVGuide = false;
  let shapeFilled = true;
  let uvMode: UVProjectionMode = active.material.uvProjection || 'box';
  let repeatX = active.material.repeatX ?? 1;
  let repeatY = active.material.repeatY ?? 1;

  const history: ImageData[] = [];
  const redoStack: ImageData[] = [];

  const backdrop = document.createElement('div');
  backdrop.className = 'modix-modal-backdrop modix-tex-studio-backdrop';

  const card = document.createElement('div');
  card.className = 'modix-tex-studio-card';

  card.innerHTML = `
    <div class="modix-modal-header">
      <span style="display:flex;align-items:center;gap:6px;">
        ${Icons.palette}<span>Estúdio de Texturas 2D &amp; 3D — <b>${escapeHtml(active.name)}</b> (512x512 PNG)</span>
      </span>
      <div style="display:flex;gap:6px;align-items:center;">
        <button class="modix-btn-sm" data-act="paint3d" title="Pintar direto no modelo 3D">${Icons.brush}<span>Pintar em 3D</span></button>
        <button class="modix-btn-sm primary" data-act="apply">${Icons.check}<span>Aplicar no 3D</span></button>
        <button class="modix-modal-close" data-act="close">${Icons.close}</button>
      </div>
    </div>

    <div class="modix-tex-studio-body">
      <!-- Left Column: Tools & Brush Settings -->
      <div class="modix-tex-col tools">
        <div class="modix-tex-sec-title">Ferramentas de Desenho</div>
        <div class="modix-tex-tool-grid" id="tex-tool-grid">
          <button class="modix-tex-tool-btn active" data-tool="brush">${Icons.brush}<span>Pincel</span></button>
          <button class="modix-tex-tool-btn" data-tool="airbrush">${Icons.spray}<span>Spray</span></button>
          <button class="modix-tex-tool-btn" data-tool="line">${Icons.lineTool}<span>Linha</span></button>
          <button class="modix-tex-tool-btn" data-tool="rect">${Icons.rectTool}<span>Retâng.</span></button>
          <button class="modix-tex-tool-btn" data-tool="circle">${Icons.circleTool}<span>Círculo</span></button>
          <button class="modix-tex-tool-btn" data-tool="fill">${Icons.fillBucket}<span>Fundo</span></button>
          <button class="modix-tex-tool-btn" data-tool="eraser">${Icons.eraser}<span>Borracha</span></button>
        </div>

        <div class="modix-tex-row">
          <label><input type="checkbox" id="tex-mirror-x" /> Espelho X</label>
          <label><input type="checkbox" id="tex-mirror-y" /> Espelho Y</label>
        </div>
        <div class="modix-tex-row">
          <label><input type="checkbox" id="tex-shape-fill" checked /> Forma Cheia</label>
          <label><input type="checkbox" id="tex-uv-guide" /> Grade UV</label>
        </div>

        <div class="modix-tex-sec-title">Cores &amp; Pincel</div>
        <div class="modix-tex-colors-row">
          <label title="Cor Principal">1ª <input type="color" id="tex-col-1" value="${primaryColor}" /></label>
          <label title="Cor Secundária / Fundo">2ª <input type="color" id="tex-col-2" value="${secondaryColor}" /></label>
          <label title="Cor Destaque Procedural">3ª <input type="color" id="tex-col-3" value="${accentColor}" /></label>
        </div>

        <div class="modix-tex-palette" id="tex-quick-palette">
          ${QUICK_PALETTE.map((c) => `<button class="modix-swatch" data-col="${c}" style="background:${c}" title="${c}"></button>`).join('')}
        </div>

        <div class="modix-tex-slider-row">
          <span>Tamanho <b id="lbl-bsize">${brushSize}px</b></span>
          <input type="range" id="tex-bsize" min="1" max="80" value="${brushSize}" />
        </div>
        <div class="modix-tex-slider-row">
          <span>Opacidade <b id="lbl-bop">${opacity}%</b></span>
          <input type="range" id="tex-bop" min="5" max="100" value="${opacity}" />
        </div>

        <div class="modix-tex-row" style="margin-top:auto;">
          <button class="modix-btn-sm" id="tex-undo" style="flex:1;">${Icons.undo}<span>Desfazer</span></button>
          <button class="modix-btn-sm" id="tex-redo" style="flex:1;">${Icons.redo}<span>Refazer</span></button>
        </div>
      </div>

      <!-- Center Column: Interactive 512x512 Paint Canvas -->
      <div class="modix-tex-canvas-wrap">
        <div class="modix-tex-stage">
          <canvas id="tex-main-canvas" width="512" height="512"></canvas>
          <canvas id="tex-overlay-canvas" width="512" height="512"></canvas>
        </div>
      </div>

      <!-- Right Column: Procedural Presets, UV Mapping & File I/O -->
      <div class="modix-tex-col presets">
        <div class="modix-tex-sec-title">Gerador Procedural</div>
        <div class="modix-tex-preset-grid" id="tex-preset-grid">
          ${PRESET_LIST.map((p) => `<button class="modix-tex-preset-btn" data-preset="${p.id}">${p.label}</button>`).join('')}
        </div>

        <div class="modix-tex-sec-title">Projeção UV 3D</div>
        <select id="tex-uv-mode" class="modix-select-dark">
          <option value="box" ${uvMode === 'box' ? 'selected' : ''}>Smart Box UV (Cubo/Geral)</option>
          <option value="planar" ${uvMode === 'planar' ? 'selected' : ''}>Planar Z (Topo/Chão)</option>
          <option value="cylindrical" ${uvMode === 'cylindrical' ? 'selected' : ''}>Cilíndrica</option>
          <option value="spherical" ${uvMode === 'spherical' ? 'selected' : ''}>Esférica</option>
        </select>

        <div class="modix-tex-row">
          <label style="flex:1;font-size:11px;">Rep X <input type="number" id="tex-repx" class="modix-num-dark" min="0.25" max="32" step="0.25" value="${repeatX}" /></label>
          <label style="flex:1;font-size:11px;">Rep Y <input type="number" id="tex-repy" class="modix-num-dark" min="0.25" max="32" step="0.25" value="${repeatY}" /></label>
        </div>

        <div class="modix-tex-sec-title">Arquivo de Textura</div>
        <button class="modix-btn-sm" id="tex-import-img" style="width:100%;">${Icons.folderOpen}<span>Importar Imagem (.png/.jpg/.svg)</span></button>
        <button class="modix-btn-sm" id="tex-export-png" style="width:100%;">${Icons.download}<span>Baixar Textura .PNG</span></button>
        <button class="modix-btn-sm danger" id="tex-remove" style="width:100%;">${Icons.trash}<span>Remover Textura do Objeto</span></button>
      </div>
    </div>
  `;

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  const mainCanvas = card.querySelector<HTMLCanvasElement>('#tex-main-canvas')!;
  const overlayCanvas = card.querySelector<HTMLCanvasElement>('#tex-overlay-canvas')!;
  const ctx = mainCanvas.getContext('2d', { willReadFrequently: true })!;
  const octx = overlayCanvas.getContext('2d')!;

  const pushCanvasUndo = () => {
    history.push(ctx.getImageData(0, 0, 512, 512));
    if (history.length > 25) history.shift();
    redoStack.length = 0;
  };

  const redrawOverlay = (previewShape?: { x0: number; y0: number; x1: number; y1: number }) => {
    octx.clearRect(0, 0, 512, 512);
    if (showUVGuide) {
      octx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
      octx.lineWidth = 1;
      for (let i = 64; i < 512; i += 64) {
        octx.beginPath();
        octx.moveTo(i, 0);
        octx.lineTo(i, 512);
        octx.moveTo(0, i);
        octx.lineTo(512, i);
        octx.stroke();
      }
    }
    if (mirrorX) {
      octx.strokeStyle = 'rgba(245, 139, 32, 0.65)';
      octx.setLineDash([6, 4]);
      octx.beginPath();
      octx.moveTo(256, 0);
      octx.lineTo(256, 512);
      octx.stroke();
      octx.setLineDash([]);
    }
    if (mirrorY) {
      octx.strokeStyle = 'rgba(245, 139, 32, 0.65)';
      octx.setLineDash([6, 4]);
      octx.beginPath();
      octx.moveTo(0, 256);
      octx.lineTo(512, 256);
      octx.stroke();
      octx.setLineDash([]);
    }
    if (previewShape) {
      drawShapeOnContext(octx, tool, previewShape.x0, previewShape.y0, previewShape.x1, previewShape.y1);
    }
  };

  const drawShapeOnContext = (
    target: CanvasRenderingContext2D,
    drawTool: StudioDrawTool,
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ) => {
    target.save();
    target.globalAlpha = opacity / 100;
    const col = drawTool === 'eraser' ? secondaryColor : primaryColor;
    target.strokeStyle = col;
    target.fillStyle = col;
    target.lineWidth = brushSize * 2;
    target.lineCap = 'round';
    target.lineJoin = 'round';

    const pairs: Array<[number, number, number, number]> = [[x0, y0, x1, y1]];
    if (mirrorX) pairs.push([512 - x0, y0, 512 - x1, y1]);
    if (mirrorY) pairs.push([x0, 512 - y0, x1, 512 - y1]);
    if (mirrorX && mirrorY) pairs.push([512 - x0, 512 - y0, 512 - x1, 512 - y1]);

    for (const [ax, ay, bx, by] of pairs) {
      if (drawTool === 'line') {
        target.beginPath();
        target.moveTo(ax, ay);
        target.lineTo(bx, by);
        target.stroke();
      } else if (drawTool === 'rect') {
        const rx = Math.min(ax, bx);
        const ry = Math.min(ay, by);
        const rw = Math.abs(bx - ax);
        const rh = Math.abs(by - ay);
        if (shapeFilled) target.fillRect(rx, ry, rw, rh);
        else target.strokeRect(rx, ry, rw, rh);
      } else if (drawTool === 'circle') {
        const r = Math.hypot(bx - ax, by - ay);
        target.beginPath();
        target.arc(ax, ay, r, 0, Math.PI * 2);
        if (shapeFilled) target.fill();
        else target.stroke();
      }
    }
    target.restore();
  };

  // Initialize canvas from existing object texture or clean base color
  ctx.fillStyle =
    active.material.baseColor && active.material.baseColor !== '#9a9a9a'
      ? active.material.baseColor
      : '#e5e7eb';
  ctx.fillRect(0, 0, 512, 512);
  pushCanvasUndo();

  if (active.material.textureDataUrl) {
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, 512, 512);
      ctx.drawImage(img, 0, 0, 512, 512);
      history.length = 0;
      pushCanvasUndo();
    };
    img.src = active.material.textureDataUrl;
  }

  // Pointer drawing logic on overlayCanvas
  let drawing = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;

  const toCanvasCoords = (ev: PointerEvent): [number, number] => {
    const r = overlayCanvas.getBoundingClientRect();
    return [
      ((ev.clientX - r.left) / Math.max(1, r.width)) * 512,
      ((ev.clientY - r.top) / Math.max(1, r.height)) * 512
    ];
  };

  const paintStrokeSegment = (x0: number, y0: number, x1: number, y1: number) => {
    const col = tool === 'eraser' ? secondaryColor : primaryColor;
    const pairs: Array<[number, number, number, number]> = [[x0, y0, x1, y1]];
    if (mirrorX) pairs.push([512 - x0, y0, 512 - x1, y1]);
    if (mirrorY) pairs.push([x0, 512 - y0, x1, 512 - y1]);
    if (mirrorX && mirrorY) pairs.push([512 - x0, 512 - y0, 512 - x1, 512 - y1]);

    ctx.save();
    for (const [ax, ay, bx, by] of pairs) {
      if (tool === 'airbrush') {
        const r = Math.max(4, brushSize * 1.8);
        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, r);
        grad.addColorStop(0, hexWithAlpha(col, (opacity / 100) * 0.35));
        grad.addColorStop(1, hexWithAlpha(col, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = opacity / 100;
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = brushSize * 2;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  overlayCanvas.style.touchAction = 'none';
  overlayCanvas.addEventListener('pointerdown', (ev) => {
    overlayCanvas.setPointerCapture(ev.pointerId);
    const [cx, cy] = toCanvasCoords(ev);
    pushCanvasUndo();

    if (tool === 'fill') {
      ctx.save();
      ctx.globalAlpha = opacity / 100;
      ctx.fillStyle = primaryColor;
      ctx.fillRect(0, 0, 512, 512);
      ctx.restore();
      return;
    }

    drawing = true;
    startX = cx;
    startY = cy;
    lastX = cx;
    lastY = cy;

    if (tool === 'brush' || tool === 'eraser' || tool === 'airbrush') {
      paintStrokeSegment(cx, cy, cx + 0.01, cy + 0.01);
    }
  });

  overlayCanvas.addEventListener('pointermove', (ev) => {
    if (!drawing) return;
    const [cx, cy] = toCanvasCoords(ev);
    if (tool === 'brush' || tool === 'eraser' || tool === 'airbrush') {
      paintStrokeSegment(lastX, lastY, cx, cy);
      lastX = cx;
      lastY = cy;
    } else {
      redrawOverlay({ x0: startX, y0: startY, x1: cx, y1: cy });
    }
  });

  const finishStroke = (ev: PointerEvent) => {
    if (!drawing) return;
    drawing = false;
    const [cx, cy] = toCanvasCoords(ev);
    if (tool === 'line' || tool === 'rect' || tool === 'circle') {
      drawShapeOnContext(ctx, tool, startX, startY, cx, cy);
      redrawOverlay();
    }
  };
  overlayCanvas.addEventListener('pointerup', finishStroke);
  overlayCanvas.addEventListener('pointercancel', finishStroke);

  // Wire UI buttons
  card.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tool = btn.dataset.tool as StudioDrawTool;
      card.querySelectorAll('[data-tool]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const col1Input = card.querySelector<HTMLInputElement>('#tex-col-1')!;
  const col2Input = card.querySelector<HTMLInputElement>('#tex-col-2')!;
  const col3Input = card.querySelector<HTMLInputElement>('#tex-col-3')!;

  col1Input.addEventListener('input', () => {
    primaryColor = col1Input.value;
    engine.state.sculpt.paintColor = primaryColor;
  });
  col2Input.addEventListener('input', () => {
    secondaryColor = col2Input.value;
    engine.state.sculpt.paintSecondaryColor = secondaryColor;
  });
  col3Input.addEventListener('input', () => {
    accentColor = col3Input.value;
  });

  card.querySelectorAll<HTMLButtonElement>('.modix-swatch').forEach((sw) => {
    sw.addEventListener('click', () => {
      primaryColor = sw.dataset.col || '#ffffff';
      col1Input.value = primaryColor;
      engine.state.sculpt.paintColor = primaryColor;
    });
  });

  const bSizeInput = card.querySelector<HTMLInputElement>('#tex-bsize')!;
  bSizeInput.addEventListener('input', () => {
    brushSize = Number(bSizeInput.value);
    engine.state.sculpt.paintBrushPx = brushSize;
    card.querySelector('#lbl-bsize')!.textContent = `${brushSize}px`;
  });

  const bOpInput = card.querySelector<HTMLInputElement>('#tex-bop')!;
  bOpInput.addEventListener('input', () => {
    opacity = Number(bOpInput.value);
    engine.state.sculpt.paintOpacity = opacity / 100;
    card.querySelector('#lbl-bop')!.textContent = `${opacity}%`;
  });

  card.querySelector<HTMLInputElement>('#tex-mirror-x')!.addEventListener('change', (e) => {
    mirrorX = (e.target as HTMLInputElement).checked;
    redrawOverlay();
  });
  card.querySelector<HTMLInputElement>('#tex-mirror-y')!.addEventListener('change', (e) => {
    mirrorY = (e.target as HTMLInputElement).checked;
    redrawOverlay();
  });
  card.querySelector<HTMLInputElement>('#tex-shape-fill')!.addEventListener('change', (e) => {
    shapeFilled = (e.target as HTMLInputElement).checked;
  });
  card.querySelector<HTMLInputElement>('#tex-uv-guide')!.addEventListener('change', (e) => {
    showUVGuide = (e.target as HTMLInputElement).checked;
    redrawOverlay();
  });

  card.querySelector('#tex-undo')!.addEventListener('click', () => {
    if (history.length <= 1) return;
    const current = history.pop()!;
    redoStack.push(current);
    ctx.putImageData(history[history.length - 1], 0, 0);
  });

  card.querySelector('#tex-redo')!.addEventListener('click', () => {
    if (redoStack.length === 0) return;
    const next = redoStack.pop()!;
    history.push(next);
    ctx.putImageData(next, 0, 0);
  });

  card.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset as ProceduralTexturePreset;
      const dataUrl = generateProceduralTextureDataUrl({
        preset,
        primaryColor,
        secondaryColor,
        accentColor,
        size: 512
      });
      const img = new Image();
      img.onload = () => {
        pushCanvasUndo();
        ctx.clearRect(0, 0, 512, 512);
        ctx.drawImage(img, 0, 0, 512, 512);
      };
      img.src = dataUrl;
    });
  });

  card.querySelector<HTMLSelectElement>('#tex-uv-mode')!.addEventListener('change', (e) => {
    uvMode = (e.target as HTMLSelectElement).value as UVProjectionMode;
  });
  card.querySelector<HTMLInputElement>('#tex-repx')!.addEventListener('change', (e) => {
    repeatX = Math.max(0.25, parseFloat((e.target as HTMLInputElement).value) || 1);
  });
  card.querySelector<HTMLInputElement>('#tex-repy')!.addEventListener('change', (e) => {
    repeatY = Math.max(0.25, parseFloat((e.target as HTMLInputElement).value) || 1);
  });

  card.querySelector('#tex-import-img')!.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*,.svg';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          pushCanvasUndo();
          ctx.clearRect(0, 0, 512, 512);
          ctx.drawImage(img, 0, 0, 512, 512);
          showToast(`Imagem "${f.name}" carregada no estúdio`);
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(f);
    };
    inp.click();
  });

  card.querySelector('#tex-export-png')!.addEventListener('click', async () => {
    const url = mainCanvas.toDataURL('image/png');
    const msg = await saveDataUrlPNG(`${active.name}_Texture.png`, url);
    showToast(msg);
  });

  card.querySelector('#tex-remove')!.addEventListener('click', () => {
    engine.applyTextureDataUrl(active.id, undefined);
    backdrop.remove();
    showToast(`Textura removida de ${active.name}`);
  });

  const commitTextureToObject = () => {
    const dataUrl = mainCanvas.toDataURL('image/png');
    active.material.repeatX = repeatX;
    active.material.repeatY = repeatY;
    engine.applyTextureDataUrl(active.id, dataUrl, `${active.name}_Tex.png`, uvMode);
  };

  card.querySelector('[data-act="apply"]')!.addEventListener('click', () => {
    commitTextureToObject();
    backdrop.remove();
    showToast(`Textura 512×512 aplicada em "${active.name}"!`);
  });

  card.querySelector('[data-act="paint3d"]')!.addEventListener('click', () => {
    commitTextureToObject();
    engine.state.mode = 'TEXTURE_PAINT';
    engine.state.sculpt.paintTarget = 'texture';
    engine.state.sculpt.paintColor = primaryColor;
    engine.state.sculpt.paintBrushPx = brushSize;
    engine.rebuildSceneObjects();
    engine.notify();
    backdrop.remove();
    showToast('Modo Pintura 3D ativo! Arraste o dedo direto sobre o modelo 3D.');
  });

  card.querySelector('[data-act="close"]')!.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
}

function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0');
  const num = parseInt(full.slice(0, 6), 16) || 0;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}
