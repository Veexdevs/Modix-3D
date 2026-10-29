import { saveDataUrlPNG } from '../engine/Exporters';
import { evaluateMeshWithModifiers } from '../engine/MeshOperations';
import type { ModixEngine } from '../engine/ModixEngine';
import {
  generateProceduralTextureDataUrl,
  type ProceduralTexturePreset
} from '../engine/TextureGenerator';
import { Icons } from '../icons/blenderIcons';
import type {
  ModifierType,
  PropertiesTabId,
  RotationMode,
  SceneObjectData,
  UVProjectionMode
} from '../types/scene';
import {
  openDropdownMenu,
  openSliceMeshModal,
  openTextPromptModal,
  showToast,
  type ExportFormatChoice
} from './Modals';
import { openTextureStudioModal } from './TexturePaintModal';

const PROP_TABS: Array<{ id: PropertiesTabId; icon: string; title: string }> = [
  { id: 'tool', icon: Icons.propTool, title: 'Active Tool and Workspace' },
  { id: 'render', icon: Icons.propRender, title: 'Render Properties' },
  { id: 'output', icon: Icons.propOutput, title: 'Output & Export (.OBJ / .GLB / .STL)' },
  { id: 'view_layer', icon: Icons.propViewLayer, title: 'View Layer Properties' },
  { id: 'scene', icon: Icons.propScene, title: 'Scene Properties' },
  { id: 'world', icon: Icons.propWorld, title: 'World Properties' },
  { id: 'collection', icon: Icons.propCollection, title: 'Groups & Collections' },
  { id: 'object', icon: Icons.propObject, title: 'Object Properties' },
  { id: 'modifiers', icon: Icons.propModifiers, title: 'Modifier Properties' },
  { id: 'particles', icon: Icons.propParticles, title: 'Particle Properties' },
  { id: 'physics', icon: Icons.propPhysics, title: 'Physics Properties' },
  { id: 'constraints', icon: Icons.propConstraints, title: 'Object Constraints' },
  { id: 'data', icon: Icons.propData, title: 'Object Data (Mesh / Light / Camera)' },
  { id: 'material', icon: Icons.propMaterial, title: 'Material Properties' },
  { id: 'texture', icon: Icons.propTexture, title: 'Texture Studio & Paint' }
];

export class PropertiesPanel {
  private engine: ModixEngine;
  private rootEl: HTMLElement;
  private tabStripEl!: HTMLElement;
  private inspectorEl!: HTMLElement;
  private onRenderRequest: () => void;
  private onExportRequest: (fmt: ExportFormatChoice) => void;
  private onOpenExportHub: () => void;
  private isEditingInlineInput = false;
  private quickOpsExpanded = false;

  constructor(
    engine: ModixEngine,
    rootEl: HTMLElement,
    callbacks: {
      onRenderRequest: () => void;
      onExportRequest: (fmt: ExportFormatChoice) => void;
      onOpenExportHub: () => void;
    }
  ) {
    this.engine = engine;
    this.rootEl = rootEl;
    this.onRenderRequest = callbacks.onRenderRequest;
    this.onExportRequest = callbacks.onExportRequest;
    this.onOpenExportHub = callbacks.onOpenExportHub;
    this.build();
  }

  private build(): void {
    this.rootEl.innerHTML = `
      <div class="panel-subhdr">
        <button type="button" class="hdr-pill" style="padding:0 5px;height:20px;">
          ${Icons.editorProperties}${Icons.chevronDown}
        </button>
        <div class="search-pill">
          ${Icons.searchGlass}
          <input type="text" placeholder="" aria-label="Search Properties" id="props-search-input" />
        </div>
        <button type="button" class="hdr-menu-btn" style="padding:0 4px;">${Icons.chevronDown}</button>
      </div>
      <div class="props-body">
        <div class="props-tab-strip"></div>
        <div class="props-inspector"></div>
      </div>
    `;

    this.tabStripEl = this.rootEl.querySelector('.props-tab-strip')!;
    this.inspectorEl = this.rootEl.querySelector('.props-inspector')!;

    const searchInput = this.rootEl.querySelector<HTMLInputElement>('#props-search-input');
    searchInput?.addEventListener('input', () => {
      this.engine.state.propertiesSearch = searchInput.value;
      this.sync();
    });

    this.renderTabs();
    this.sync();
  }

  private renderTabs(): void {
    this.tabStripEl.innerHTML = '';
    for (const t of PROP_TABS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `prop-tab-btn ${this.engine.state.activePropertiesTab === t.id ? 'active' : ''}`;
      btn.title = t.title;
      btn.dataset.tab = t.id;
      btn.innerHTML = t.icon;
      btn.addEventListener('click', () => {
        this.engine.state.activePropertiesTab = t.id;
        this.engine.notify();
      });
      this.tabStripEl.appendChild(btn);
    }
  }

  public sync(): void {
    if (this.isEditingInlineInput) return;

    this.tabStripEl.querySelectorAll<HTMLElement>('.prop-tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === this.engine.state.activePropertiesTab);
    });

    const tab = this.engine.state.activePropertiesTab;
    const active = this.engine.getActiveObject();

    this.inspectorEl.innerHTML = '';

    if (tab === 'object') {
      this.renderObjectTab(active);
    } else if (tab === 'modifiers') {
      this.renderModifiersTab(active);
    } else if (tab === 'material') {
      this.renderMaterialTab(active);
    } else if (tab === 'texture') {
      this.renderTextureTab(active);
    } else if (tab === 'collection') {
      this.renderCollectionTab(active);
    } else if (tab === 'data') {
      this.renderDataTab(active);
    } else if (tab === 'render' || tab === 'output') {
      this.renderOutputAndRenderTab();
    } else if (tab === 'world') {
      this.renderWorldTab();
    } else if (tab === 'tool') {
      this.renderToolTab();
    } else {
      this.renderSceneOverviewTab(tab);
    }
  }

  private formatMeters(val: number): string {
    if (Math.abs(val) < 1e-6) return '0 m';
    const clean = Number(val.toFixed(3));
    return `${clean} m`;
  }

  private formatDegrees(val: number): string {
    if (Math.abs(val) < 1e-6) return '0°';
    const clean = Number(val.toFixed(1));
    return `${clean}°`;
  }

  private formatScale(val: number): string {
    return val.toFixed(3);
  }

  private createScrubRow(opts: {
    label: string;
    value: number;
    step: number;
    formatter: (v: number) => string;
    locked: boolean;
    keyed: boolean;
    onChange: (v: number) => void;
    onToggleLock: () => void;
    onToggleKey: () => void;
  }): HTMLElement {
    const row = document.createElement('div');
    row.className = 'xf-row';

    const lbl = document.createElement('div');
    lbl.className = 'xf-label';
    lbl.textContent = opts.label;

    const scrub = document.createElement('div');
    scrub.className = 'xf-scrub-box';
    scrub.textContent = opts.formatter(opts.value);

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startVal = opts.value;

    scrub.addEventListener('pointerdown', (e) => {
      if (scrub.querySelector('input')) return;
      e.stopPropagation();
      scrub.setPointerCapture(e.pointerId);
      dragging = true;
      moved = false;
      startX = e.clientX;
      startVal = opts.value;
    });

    scrub.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      if (moved && !opts.locked) {
        const nextVal = startVal + dx * opts.step;
        scrub.textContent = opts.formatter(nextVal);
        opts.onChange(nextVal);
      }
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      if (!moved && !opts.locked) {
        this.isEditingInlineInput = true;
        scrub.innerHTML = `<input type="number" step="${opts.step}" value="${opts.value}" />`;
        const inp = scrub.querySelector('input')!;
        inp.focus();
        inp.select();
        const commit = () => {
          const parsed = parseFloat(inp.value);
          this.isEditingInlineInput = false;
          if (!Number.isNaN(parsed)) {
            opts.onChange(parsed);
          }
          this.engine.notify();
        };
        inp.addEventListener('blur', commit);
        inp.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') inp.blur();
          if (ke.key === 'Escape') {
            this.isEditingInlineInput = false;
            this.engine.notify();
          }
        });
      }
    };
    scrub.addEventListener('pointerup', endDrag);
    scrub.addEventListener('pointercancel', endDrag);

    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'xf-lock-btn';
    lockBtn.innerHTML = opts.locked ? Icons.lockClosed : Icons.lockOpen;
    lockBtn.addEventListener('click', opts.onToggleLock);

    const keyBtn = document.createElement('button');
    keyBtn.type = 'button';
    keyBtn.className = `xf-key-dot ${opts.keyed ? 'keyed' : ''}`;
    keyBtn.innerHTML = opts.keyed ? Icons.keyframeDiamond : Icons.keyframeDot;
    keyBtn.title = 'Insert / Remove Keyframe';
    keyBtn.addEventListener('click', opts.onToggleKey);

    row.append(lbl, scrub, lockBtn, keyBtn);
    return row;
  }

  private renderObjectTab(active: SceneObjectData | null): void {
    if (!active) {
      this.inspectorEl.innerHTML = `<div style="color:#888;padding:10px 4px;">Nenhum objeto ativo selecionado.</div>`;
      return;
    }

    // 1. Breadcrumb
    const bc = document.createElement('div');
    bc.className = 'props-breadcrumb';
    bc.innerHTML = `
      <div class="props-breadcrumb-left">${Icons.cubeSmall}<span>${escapeHtml(active.name)}</span></div>
      <span style="color:#aaa;">${Icons.pin}</span>
    `;
    this.inspectorEl.appendChild(bc);

    // 2. Object Name Input Row (Renomear direto)
    const nameRow = document.createElement('div');
    nameRow.className = 'props-name-row';
    nameRow.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:2px;color:#ccc;">
        ${Icons.modeObject}${Icons.chevronDown}
      </span>
      <input type="text" class="props-name-input" value="${escapeHtml(active.name)}" aria-label="Object Name" />
    `;
    const nameInp = nameRow.querySelector<HTMLInputElement>('input')!;
    nameInp.addEventListener('focus', () => {
      this.isEditingInlineInput = true;
    });
    nameInp.addEventListener('blur', () => {
      this.isEditingInlineInput = false;
      const trimmed = nameInp.value.trim();
      if (trimmed && trimmed !== active.name) {
        this.engine.renameObject(active.id, trimmed);
      } else {
        this.engine.notify();
      }
    });
    nameInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') nameInp.blur();
    });
    this.inspectorEl.appendChild(nameRow);

    // 3. Transform Section
    const tfSec = document.createElement('div');
    tfSec.className = 'props-section';
    const tfHdr = document.createElement('div');
    tfHdr.className = 'props-sec-hdr';
    tfHdr.innerHTML = `${Icons.chevronDown}<span>Transform</span>`;
    const tfContent = document.createElement('div');
    tfContent.className = 'props-sec-content';

    const curFrame = this.engine.state.currentFrame;
    const kfAtCur = active.keyframes.find((k) => k.frame === curFrame);

    const locGroup = document.createElement('div');
    locGroup.className = 'xf-group';
    const axes: Array<{ idx: 0 | 1 | 2; key: 'x' | 'y' | 'z'; name: string }> = [
      { idx: 0, key: 'x', name: 'X' },
      { idx: 1, key: 'y', name: 'Y' },
      { idx: 2, key: 'z', name: 'Z' }
    ];
    for (const ax of axes) {
      locGroup.appendChild(
        this.createScrubRow({
          label: ax.idx === 0 ? 'Location X' : ax.name,
          value: active.location[ax.idx],
          step: 0.04,
          formatter: (v) => this.formatMeters(v),
          locked: active.lockLocation[ax.key],
          keyed: Boolean(kfAtCur?.location),
          onChange: (v) => {
            active.location[ax.idx] = Number(v.toFixed(3));
            this.engine.recordAutoKeyIfEnabled(active);
            this.engine.syncObjectTransformsOnly();
            this.engine.rebuildGizmo();
          },
          onToggleLock: () => {
            active.lockLocation[ax.key] = !active.lockLocation[ax.key];
            this.engine.notify();
          },
          onToggleKey: () => this.engine.toggleKeyframeForProperty(active.id, 'location')
        })
      );
    }
    tfContent.appendChild(locGroup);

    const rotGroup = document.createElement('div');
    rotGroup.className = 'xf-group';
    for (const ax of axes) {
      rotGroup.appendChild(
        this.createScrubRow({
          label: ax.idx === 0 ? 'Rotation X' : ax.name,
          value: active.rotationDeg[ax.idx],
          step: 0.5,
          formatter: (v) => this.formatDegrees(v),
          locked: active.lockRotation[ax.key],
          keyed: Boolean(kfAtCur?.rotationDeg),
          onChange: (v) => {
            active.rotationDeg[ax.idx] = Number(v.toFixed(1));
            this.engine.recordAutoKeyIfEnabled(active);
            this.engine.syncObjectTransformsOnly();
            this.engine.rebuildGizmo();
          },
          onToggleLock: () => {
            active.lockRotation[ax.key] = !active.lockRotation[ax.key];
            this.engine.notify();
          },
          onToggleKey: () => this.engine.toggleKeyframeForProperty(active.id, 'rotationDeg')
        })
      );
    }

    const modeRow = document.createElement('div');
    modeRow.className = 'xf-row';
    modeRow.style.marginTop = '4px';
    modeRow.innerHTML = `
      <div class="xf-label">Mode</div>
      <select class="xf-select" style="grid-column: span 2;">
        ${(['XYZ Euler', 'XZY Euler', 'YXZ Euler', 'YZX Euler', 'ZXY Euler', 'ZYX Euler', 'Quaternion'] as RotationMode[])
          .map((m) => `<option value="${m}" ${active.rotationMode === m ? 'selected' : ''}>${m}</option>`)
          .join('')}
      </select>
      <div class="xf-key-dot">${Icons.keyframeDot}</div>
    `;
    modeRow.querySelector('select')?.addEventListener('change', (e) => {
      active.rotationMode = (e.target as HTMLSelectElement).value as RotationMode;
    });
    rotGroup.appendChild(modeRow);
    tfContent.appendChild(rotGroup);

    const sclGroup = document.createElement('div');
    sclGroup.className = 'xf-group';
    sclGroup.style.marginBottom = '0';
    for (const ax of axes) {
      sclGroup.appendChild(
        this.createScrubRow({
          label: ax.idx === 0 ? 'Scale X' : ax.name,
          value: active.scale[ax.idx],
          step: 0.02,
          formatter: (v) => this.formatScale(v),
          locked: active.lockScale[ax.key],
          keyed: Boolean(kfAtCur?.scale),
          onChange: (v) => {
            active.scale[ax.idx] = Math.max(0.01, Number(v.toFixed(3)));
            this.engine.recordAutoKeyIfEnabled(active);
            this.engine.syncObjectTransformsOnly();
            this.engine.rebuildGizmo();
          },
          onToggleLock: () => {
            active.lockScale[ax.key] = !active.lockScale[ax.key];
            this.engine.notify();
          },
          onToggleKey: () => this.engine.toggleKeyframeForProperty(active.id, 'scale')
        })
      );
    }
    tfContent.appendChild(sclGroup);

    tfSec.append(tfHdr, tfContent);
    this.inspectorEl.appendChild(tfSec);

    // 4. Collapsible "> Delta Transform"
    const deltaSec = document.createElement('div');
    deltaSec.className = 'props-section';
    const expanded = this.engine.state.deltaTransformExpanded;
    const deltaHdr = document.createElement('button');
    deltaHdr.type = 'button';
    deltaHdr.className = 'props-sec-hdr';
    deltaHdr.innerHTML = `${expanded ? Icons.chevronDown : Icons.chevronRight}<span>Delta Transform</span>`;
    deltaHdr.addEventListener('click', () => {
      this.engine.state.deltaTransformExpanded = !this.engine.state.deltaTransformExpanded;
      this.engine.notify();
    });
    deltaSec.appendChild(deltaHdr);

    if (expanded) {
      const dBody = document.createElement('div');
      dBody.className = 'props-sec-content';
      for (const ax of axes) {
        dBody.appendChild(
          this.createScrubRow({
            label: ax.idx === 0 ? 'Location X' : ax.name,
            value: active.deltaLocation[ax.idx],
            step: 0.04,
            formatter: (v) => this.formatMeters(v),
            locked: false,
            keyed: false,
            onChange: (v) => {
              active.deltaLocation[ax.idx] = Number(v.toFixed(3));
              this.engine.syncObjectTransformsOnly();
            },
            onToggleLock: () => {},
            onToggleKey: () => {}
          })
        );
      }
      deltaSec.appendChild(dBody);
    }
    this.inspectorEl.appendChild(deltaSec);

    // 5. Collapsible "> Ações de Objeto & Grupo" (Copiar, Colar, Recortar, Unir, Grupo, Deletar)
    const opsSec = document.createElement('div');
    opsSec.className = 'props-section';
    const opsHdr = document.createElement('button');
    opsHdr.type = 'button';
    opsHdr.className = 'props-sec-hdr';
    opsHdr.innerHTML = `${this.quickOpsExpanded ? Icons.chevronDown : Icons.chevronRight}<span>Ações &amp; Grupos (${escapeHtml(active.collection)})</span>`;
    opsHdr.addEventListener('click', () => {
      this.quickOpsExpanded = !this.quickOpsExpanded;
      this.sync();
    });
    opsSec.appendChild(opsHdr);

    if (this.quickOpsExpanded) {
      const opsBody = document.createElement('div');
      opsBody.className = 'props-sec-content';
      opsBody.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
          <button type="button" class="modix-btn" data-q="copy">${Icons.copy}<span>Copiar</span></button>
          <button type="button" class="modix-btn" data-q="paste">${Icons.paste}<span>Colar</span></button>
          <button type="button" class="modix-btn" data-q="cut">${Icons.scissors}<span>Recortar</span></button>
          <button type="button" class="modix-btn" data-q="slice">${Icons.slice3d}<span>Fatiar 3D</span></button>
          <button type="button" class="modix-btn" data-q="join">${Icons.join}<span>Unir (${this.engine.state.selectedIds.length})</span></button>
          <button type="button" class="modix-btn" data-q="group">${Icons.folderPlus}<span>Novo Grupo</span></button>
          <button type="button" class="modix-btn" data-q="tex">${Icons.palette}<span>Textura 2D</span></button>
          <button type="button" class="modix-btn danger" data-q="del">${Icons.trash}<span>Deletar</span></button>
        </div>
      `;
      opsBody.querySelector('[data-q="copy"]')?.addEventListener('click', () => {
        const n = this.engine.copySelected();
        showToast(`${n} objeto(s) copiado(s)`);
      });
      opsBody.querySelector('[data-q="paste"]')?.addEventListener('click', () => {
        const p = this.engine.pasteClipboard();
        showToast(p.length ? `${p.length} objeto(s) colado(s)` : 'Área de transferência vazia');
      });
      opsBody.querySelector('[data-q="cut"]')?.addEventListener('click', () => {
        const n = this.engine.cutSelected();
        showToast(`${n} objeto(s) recortado(s)`);
      });
      opsBody.querySelector('[data-q="slice"]')?.addEventListener('click', () => {
        openSliceMeshModal(active.name, (axis, mode, off) => {
          this.engine.sliceActiveMesh(axis, mode, off);
          showToast(`Malha "${active.name}" recortada no eixo ${axis}!`);
        });
      });
      opsBody.querySelector('[data-q="join"]')?.addEventListener('click', () => {
        const res = this.engine.joinSelected();
        showToast(res ? `Malhas unidas em "${res.name}"` : 'Selecione 2+ objetos Mesh (Shift+Toque) para unir');
      });
      opsBody.querySelector('[data-q="group"]')?.addEventListener('click', () => {
        openTextPromptModal({
          title: 'Colocar Selecionados em Grupo',
          label: 'Nome do Grupo / Coleção:',
          initialValue: 'Grupo_1',
          confirmLabel: 'Criar Grupo',
          onConfirm: (val) => {
            this.engine.groupSelectedIntoNewCollection(val);
            showToast(`Agrupado em "${val}"`);
          }
        });
      });
      opsBody.querySelector('[data-q="tex"]')?.addEventListener('click', () => {
        openTextureStudioModal(this.engine, showToast);
      });
      opsBody.querySelector('[data-q="del"]')?.addEventListener('click', () => {
        this.engine.deleteSelected();
        showToast('Objeto removido');
      });
      opsSec.appendChild(opsBody);
    }
    this.inspectorEl.appendChild(opsSec);
  }

  private renderCollectionTab(active: SceneObjectData | null): void {
    const st = this.engine.state;
    const wrap = document.createElement('div');
    wrap.className = 'props-section';
    wrap.innerHTML = `
      <div class="props-sec-hdr">${Icons.chevronDown}<span>Grupos &amp; Coleções (${st.collections.length})</span></div>
      <div class="props-sec-content" style="display:flex;flex-direction:column;gap:6px;">
        <button type="button" class="modix-btn primary" id="col-new-btn">+ Criar Novo Grupo</button>
        ${
          active
            ? `<div style="display:flex;flex-direction:column;gap:4px;margin-top:2px;">
                <span style="color:#aaa;font-size:10.5px;">Mover selecionado(s) para grupo:</span>
                <select id="col-move-sel" class="xf-select">
                  ${st.collections
                    .map(
                      (c) =>
                        `<option value="${escapeHtml(c.name)}" ${active.collection === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
                    )
                    .join('')}
                </select>
                <button type="button" class="modix-btn" id="col-ungroup-btn">Tirar do Grupo (Voltar p/ Collection)</button>
               </div>`
            : ''
        }
        <div class="menu-sep"></div>
        <div style="display:flex;flex-direction:column;gap:4px;" id="col-list-box"></div>
      </div>
    `;

    const listBox = wrap.querySelector('#col-list-box')!;
    for (const col of st.collections) {
      const count = st.objects.filter((o) => o.collection === col.name).length;
      const item = document.createElement('div');
      item.style.cssText =
        'display:flex;align-items:center;justify-content:space-between;background:#1d1d1d;padding:4px 6px;border-radius:4px;gap:4px;';
      item.innerHTML = `
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;">${Icons.folder}<b>${escapeHtml(col.name)}</b> (${count})</span>
        <span style="display:flex;gap:3px;">
          <button type="button" class="modix-btn" data-ren style="height:19px;padding:0 5px;" title="Renomear Grupo">${Icons.edit}</button>
          ${
            st.collections.length > 1
              ? `<button type="button" class="modix-btn danger" data-del style="height:19px;padding:0 5px;" title="Excluir Grupo">${Icons.close}</button>`
              : ''
          }
        </span>
      `;
      item.querySelector('[data-ren]')?.addEventListener('click', () => {
        openTextPromptModal({
          title: 'Renomear Grupo',
          label: 'Novo nome do grupo:',
          initialValue: col.name,
          onConfirm: (nextName) => {
            this.engine.renameCollection(col.name, nextName);
            showToast(`Grupo renomeado para "${nextName}"`);
          }
        });
      });
      item.querySelector('[data-del]')?.addEventListener('click', () => {
        this.engine.deleteCollection(col.name, false);
        showToast(`Grupo "${col.name}" removido (objetos mantidos)`);
      });
      listBox.appendChild(item);
    }

    wrap.querySelector('#col-new-btn')?.addEventListener('click', () => {
      openTextPromptModal({
        title: 'Novo Grupo / Coleção',
        label: 'Nome do novo grupo:',
        initialValue: `Grupo_${st.collections.length}`,
        confirmLabel: 'Criar & Agrupar Seleção',
        onConfirm: (val) => {
          if (st.selectedIds.length > 0) {
            this.engine.groupSelectedIntoNewCollection(val);
          } else {
            this.engine.createCollection(val);
          }
          showToast(`Grupo "${val}" criado!`);
        }
      });
    });

    wrap.querySelector<HTMLSelectElement>('#col-move-sel')?.addEventListener('change', (e) => {
      const target = (e.target as HTMLSelectElement).value;
      this.engine.moveObjectsToCollection(st.selectedIds, target);
      showToast(`Movido para "${target}"`);
    });

    wrap.querySelector('#col-ungroup-btn')?.addEventListener('click', () => {
      this.engine.ungroupSelected();
      showToast('Removido do grupo secundário');
    });

    this.inspectorEl.appendChild(wrap);
  }

  private renderTextureTab(active: SceneObjectData | null): void {
    if (!active || active.kind !== 'MESH') {
      this.inspectorEl.innerHTML = `<div style="color:#888;padding:8px;">Selecione um objeto Mesh 3D para aplicar, desenhar ou pintar texturas.</div>`;
      return;
    }

    const m = active.material;
    const wrap = document.createElement('div');
    wrap.className = 'props-section';
    wrap.innerHTML = `
      <div class="props-sec-hdr">${Icons.chevronDown}<span>Texturas 2D &amp; Pintura 3D — ${escapeHtml(active.name)}</span></div>
      <div class="props-sec-content" style="display:flex;flex-direction:column;gap:7px;">
        ${
          m.textureDataUrl
            ? `<div style="display:flex;gap:8px;align-items:center;background:#161616;padding:6px;border-radius:4px;border:1px solid #2e2e2e;">
                <img src="${m.textureDataUrl}" alt="Tex" style="width:52px;height:52px;border-radius:3px;object-fit:cover;border:1px solid #444;" />
                <div style="flex:1;min-width:0;">
                  <div style="font-weight:600;color:#e5e7eb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(m.textureName || 'Texture_512.png')}</div>
                  <div style="font-size:10px;color:#9ca3af;">UV: ${m.uvProjection || 'box'} (${m.repeatX ?? 1}×${m.repeatY ?? 1})</div>
                </div>
               </div>`
            : `<div style="color:#9ca3af;font-size:10.5px;">Nenhuma textura aplicada ainda. Crie, importe ou desenhe abaixo!</div>`
        }

        <button type="button" class="modix-btn primary" id="btn-open-tex-studio">${Icons.palette}<span>Desenhar / Editar Textura 2D</span></button>
        <button type="button" class="modix-btn" id="btn-paint-3d">${Icons.brush}<span>Pintar Direto no Modelo 3D</span></button>
        <button type="button" class="modix-btn" id="btn-import-tex">${Icons.folderOpen}<span>Importar Imagem (.PNG / .JPG / .SVG)</span></button>

        <div class="menu-sep"></div>
        <div style="font-size:10.5px;color:#bdbdbd;">Texturas Procedurais Instantâneas:</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
          <button type="button" class="modix-btn" data-p="studs">Relevo Tátil</button>
          <button type="button" class="modix-btn" data-p="brick">Tijolos</button>
          <button type="button" class="modix-btn" data-p="wood">Madeira</button>
          <button type="button" class="modix-btn" data-p="metal">Metal</button>
          <button type="button" class="modix-btn" data-p="scifi">Sci-Fi Neon</button>
          <button type="button" class="modix-btn" data-p="grass">Grama</button>
          <button type="button" class="modix-btn" data-p="stone">Pedra</button>
          <button type="button" class="modix-btn" data-p="lava">Lava</button>
          <button type="button" class="modix-btn" data-p="marble">Mármore</button>
          <button type="button" class="modix-btn" data-p="checker">Grade UV</button>
        </div>

        <label style="display:flex;justify-content:space-between;align-items:center;margin-top:2px;">
          <span>Projeção UV</span>
          <select id="prop-uv-proj" class="xf-select" style="width:110px;">
            <option value="box" ${(m.uvProjection || 'box') === 'box' ? 'selected' : ''}>Smart Box</option>
            <option value="planar" ${m.uvProjection === 'planar' ? 'selected' : ''}>Planar</option>
            <option value="cylindrical" ${m.uvProjection === 'cylindrical' ? 'selected' : ''}>Cilíndrica</option>
            <option value="spherical" ${m.uvProjection === 'spherical' ? 'selected' : ''}>Esférica</option>
          </select>
        </label>

        ${
          m.textureDataUrl
            ? `<div style="display:flex;gap:5px;">
                <button type="button" class="modix-btn" id="btn-dl-tex" style="flex:1;">${Icons.download}<span>Baixar .PNG</span></button>
                <button type="button" class="modix-btn danger" id="btn-rm-tex">${Icons.trash}<span>Remover</span></button>
               </div>`
            : ''
        }
      </div>
    `;

    wrap.querySelector('#btn-open-tex-studio')?.addEventListener('click', () => {
      openTextureStudioModal(this.engine, showToast);
    });

    wrap.querySelector('#btn-paint-3d')?.addEventListener('click', () => {
      this.engine.state.mode = 'TEXTURE_PAINT';
      this.engine.state.sculpt.paintTarget = 'texture';
      this.engine.rebuildSceneObjects();
      this.engine.notify();
      showToast('Arraste o dedo sobre o objeto 3D para pintar sua textura UV!');
    });

    wrap.querySelector('#btn-import-tex')?.addEventListener('click', () => {
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
            const c = document.createElement('canvas');
            c.width = 512;
            c.height = 512;
            c.getContext('2d')!.drawImage(img, 0, 0, 512, 512);
            this.engine.applyTextureDataUrl(active.id, c.toDataURL('image/png'), f.name);
            showToast(`Textura "${f.name}" aplicada!`);
          };
          img.src = String(reader.result);
        };
        reader.readAsDataURL(f);
      };
      inp.click();
    });

    wrap.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) => {
      b.addEventListener('click', () => {
        const preset = b.dataset.p as ProceduralTexturePreset;
        const url = generateProceduralTextureDataUrl({ preset, size: 512 });
        this.engine.applyTextureDataUrl(active.id, url, `${preset}_512.png`);
        showToast(`Textura ${b.textContent} aplicada!`);
      });
    });

    wrap.querySelector<HTMLSelectElement>('#prop-uv-proj')?.addEventListener('change', (e) => {
      m.uvProjection = (e.target as HTMLSelectElement).value as UVProjectionMode;
      this.engine.rebuildSceneObjects();
      this.engine.notify();
    });

    wrap.querySelector('#btn-dl-tex')?.addEventListener('click', () => {
      if (m.textureDataUrl) {
        void saveDataUrlPNG(`${active.name}_Texture.png`, m.textureDataUrl).then((msg) =>
          showToast(msg)
        );
      }
    });

    wrap.querySelector('#btn-rm-tex')?.addEventListener('click', () => {
      this.engine.applyTextureDataUrl(active.id, undefined);
      showToast('Textura removida');
    });

    this.inspectorEl.appendChild(wrap);
  }

  private renderModifiersTab(active: SceneObjectData | null): void {
    if (!active || active.kind !== 'MESH') {
      this.inspectorEl.innerHTML = `<div style="color:#888;padding:8px;">Select a Mesh object to add Modifiers.</div>`;
      return;
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'modix-btn primary';
    addBtn.style.width = '100%';
    addBtn.style.marginBottom = '8px';
    addBtn.innerHTML = `${Icons.propModifiers}<span>Add Modifier</span>${Icons.chevronDown}`;
    addBtn.addEventListener('click', () => {
      const addMod = (type: ModifierType, name: string) => {
        this.engine.pushUndoSnapshot();
        active.modifiers.push({
          id: `mod_${Date.now()}`,
          type,
          name,
          enabled: true,
          levels: 1,
          axisX: true,
          axisY: false,
          axisZ: false,
          count: 3,
          offset: [2.2, 0, 0],
          thickness: 0.14,
          amount: 0.18,
          angleDeg: 45
        });
        this.engine.rebuildSceneObjects();
        this.engine.notify();
      };
      openDropdownMenu(addBtn, [
        { sectionTitle: 'Generate' },
        { label: 'Subdivision Surface', onClick: () => addMod('SUBSURF', 'Subdivision') },
        { label: 'Mirror', onClick: () => addMod('MIRROR', 'Mirror') },
        { label: 'Array', onClick: () => addMod('ARRAY', 'Array') },
        { label: 'Solidify', onClick: () => addMod('SOLIDIFY', 'Solidify') },
        { label: 'Bevel', onClick: () => addMod('BEVEL', 'Bevel') },
        { label: 'Wireframe', onClick: () => addMod('WIREFRAME', 'Wireframe') },
        { separator: true },
        { sectionTitle: 'Deform' },
        { label: 'Simple Deform (Twist)', onClick: () => addMod('TWIST', 'Twist') }
      ]);
    });
    this.inspectorEl.appendChild(addBtn);

    if (active.modifiers.length === 0) {
      const empty = document.createElement('div');
      empty.style.color = '#888';
      empty.style.fontSize = '10.8px';
      empty.textContent = 'No modifiers active. Tap "Add Modifier" above.';
      this.inspectorEl.appendChild(empty);
      return;
    }

    active.modifiers.forEach((mod, mIdx) => {
      const card = document.createElement('div');
      card.className = 'props-section';
      card.innerHTML = `
        <div class="props-sec-hdr" style="justify-content:space-between;">
          <span style="display:flex;align-items:center;gap:5px;">
            <input type="checkbox" ${mod.enabled ? 'checked' : ''} data-toggle />
            <strong>${escapeHtml(mod.name)}</strong>
          </span>
          <span style="display:flex;gap:4px;">
            <button type="button" class="modix-btn" data-apply style="height:18px;padding:0 5px;font-size:10px;">Apply</button>
            <button type="button" class="modix-btn danger" data-del style="height:18px;padding:0 5px;">${Icons.close}</button>
          </span>
        </div>
        <div class="props-sec-content" data-body></div>
      `;

      const body = card.querySelector<HTMLElement>('[data-body]')!;
      if (mod.type === 'SUBSURF') {
        body.innerHTML = `<label style="display:flex;justify-content:space-between;align-items:center;">
          <span>Levels Viewport (${mod.levels ?? 1})</span>
          <input type="range" min="1" max="3" step="1" value="${mod.levels ?? 1}" style="width:90px;" />
        </label>`;
        body.querySelector('input')?.addEventListener('input', (e) => {
          mod.levels = parseInt((e.target as HTMLInputElement).value, 10);
          this.engine.rebuildSceneObjects();
          this.engine.notify();
        });
      } else if (mod.type === 'MIRROR') {
        body.innerHTML = `<div style="display:flex;gap:10px;align-items:center;">
          <span>Axis:</span>
          <label><input type="checkbox" ${mod.axisX !== false ? 'checked' : ''} data-ax="x"/> X</label>
          <label><input type="checkbox" ${mod.axisY ? 'checked' : ''} data-ax="y"/> Y</label>
          <label><input type="checkbox" ${mod.axisZ ? 'checked' : ''} data-ax="z"/> Z</label>
        </div>`;
        body.querySelector('[data-ax="x"]')?.addEventListener('change', (e) => {
          mod.axisX = (e.target as HTMLInputElement).checked;
          this.engine.rebuildSceneObjects();
        });
        body.querySelector('[data-ax="y"]')?.addEventListener('change', (e) => {
          mod.axisY = (e.target as HTMLInputElement).checked;
          this.engine.rebuildSceneObjects();
        });
        body.querySelector('[data-ax="z"]')?.addEventListener('change', (e) => {
          mod.axisZ = (e.target as HTMLInputElement).checked;
          this.engine.rebuildSceneObjects();
        });
      } else if (mod.type === 'ARRAY') {
        body.innerHTML = `
          <label style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span>Count (${mod.count ?? 3})</span>
            <input type="range" min="2" max="10" step="1" value="${mod.count ?? 3}" data-cnt style="width:90px;" />
          </label>
          <label style="display:flex;justify-content:space-between;">
            <span>Offset X (${(mod.offset?.[0] ?? 2.2).toFixed(1)}m)</span>
            <input type="range" min="0.5" max="5" step="0.1" value="${mod.offset?.[0] ?? 2.2}" data-off style="width:90px;" />
          </label>
        `;
        body.querySelector('[data-cnt]')?.addEventListener('input', (e) => {
          mod.count = parseInt((e.target as HTMLInputElement).value, 10);
          this.engine.rebuildSceneObjects();
          this.engine.notify();
        });
        body.querySelector('[data-off]')?.addEventListener('input', (e) => {
          const ox = parseFloat((e.target as HTMLInputElement).value);
          mod.offset = [ox, 0, 0];
          this.engine.rebuildSceneObjects();
          this.engine.notify();
        });
      } else if (mod.type === 'SOLIDIFY' || mod.type === 'WIREFRAME') {
        body.innerHTML = `<label style="display:flex;justify-content:space-between;">
          <span>Thickness (${(mod.thickness ?? 0.1).toFixed(2)}m)</span>
          <input type="range" min="0.02" max="0.5" step="0.02" value="${mod.thickness ?? 0.1}" style="width:90px;" />
        </label>`;
        body.querySelector('input')?.addEventListener('input', (e) => {
          mod.thickness = parseFloat((e.target as HTMLInputElement).value);
          this.engine.rebuildSceneObjects();
          this.engine.notify();
        });
      } else if (mod.type === 'BEVEL') {
        body.innerHTML = `<label style="display:flex;justify-content:space-between;">
          <span>Amount (${(mod.amount ?? 0.18).toFixed(2)})</span>
          <input type="range" min="0.05" max="0.42" step="0.02" value="${mod.amount ?? 0.18}" style="width:90px;" />
        </label>`;
        body.querySelector('input')?.addEventListener('input', (e) => {
          mod.amount = parseFloat((e.target as HTMLInputElement).value);
          this.engine.rebuildSceneObjects();
          this.engine.notify();
        });
      } else if (mod.type === 'TWIST') {
        body.innerHTML = `<label style="display:flex;justify-content:space-between;">
          <span>Angle (${mod.angleDeg ?? 45}°)</span>
          <input type="range" min="-180" max="180" step="5" value="${mod.angleDeg ?? 45}" style="width:90px;" />
        </label>`;
        body.querySelector('input')?.addEventListener('input', (e) => {
          mod.angleDeg = parseFloat((e.target as HTMLInputElement).value);
          this.engine.rebuildSceneObjects();
          this.engine.notify();
        });
      }

      card.querySelector('[data-toggle]')?.addEventListener('change', (e) => {
        mod.enabled = (e.target as HTMLInputElement).checked;
        this.engine.rebuildSceneObjects();
      });
      card.querySelector('[data-apply]')?.addEventListener('click', () => {
        if (!active.mesh) return;
        this.engine.pushUndoSnapshot();
        active.mesh = evaluateMeshWithModifiers(active.mesh, [mod]);
        active.modifiers.splice(mIdx, 1);
        this.engine.rebuildSceneObjects();
        this.engine.notify();
        showToast(`Applied ${mod.name}`);
      });
      card.querySelector('[data-del]')?.addEventListener('click', () => {
        this.engine.pushUndoSnapshot();
        active.modifiers.splice(mIdx, 1);
        this.engine.rebuildSceneObjects();
        this.engine.notify();
      });

      this.inspectorEl.appendChild(card);
    });
  }

  private renderMaterialTab(active: SceneObjectData | null): void {
    if (!active || active.kind !== 'MESH') {
      this.inspectorEl.innerHTML = `<div style="color:#888;padding:8px;">Select a Mesh object to edit PBR Materials.</div>`;
      return;
    }

    const m = active.material;
    const wrap = document.createElement('div');
    wrap.className = 'props-section';
    wrap.innerHTML = `
      <div class="props-sec-hdr">${Icons.chevronDown}<span>Principled BSDF — ${escapeHtml(m.name)}</span></div>
      <div class="props-sec-content" style="display:flex;flex-direction:column;gap:8px;">
        <label style="display:flex;justify-content:space-between;align-items:center;">
          <span>Base Color</span>
          <input type="color" value="${m.baseColor}" data-mat="color" style="width:48px;height:22px;border:none;background:none;" />
        </label>
        <label style="display:flex;justify-content:space-between;align-items:center;">
          <span>Metallic (${m.metallic.toFixed(2)})</span>
          <input type="range" min="0" max="1" step="0.02" value="${m.metallic}" data-mat="metal" style="width:95px;" />
        </label>
        <label style="display:flex;justify-content:space-between;align-items:center;">
          <span>Roughness (${m.roughness.toFixed(2)})</span>
          <input type="range" min="0.02" max="1" step="0.02" value="${m.roughness}" data-mat="rough" style="width:95px;" />
        </label>
        <label style="display:flex;justify-content:space-between;align-items:center;">
          <span>Emission</span>
          <input type="color" value="${m.emissionColor}" data-mat="emcol" style="width:48px;height:22px;border:none;background:none;" />
        </label>
        <label style="display:flex;justify-content:space-between;align-items:center;">
          <span>Emission Strength (${m.emissionStrength.toFixed(1)})</span>
          <input type="range" min="0" max="5" step="0.1" value="${m.emissionStrength}" data-mat="emstr" style="width:95px;" />
        </label>
        <label style="display:flex;justify-content:space-between;align-items:center;">
          <span>Alpha / Opacity (${m.opacity.toFixed(2)})</span>
          <input type="range" min="0.1" max="1" step="0.05" value="${m.opacity}" data-mat="alpha" style="width:95px;" />
        </label>
        <button type="button" class="modix-btn primary" data-mat="texstudio">${Icons.palette}<span>Estúdio de Texturas 2D / 3D</span></button>
        <button type="button" class="modix-btn" data-mat="preview">Ativar Material Preview</button>
      </div>
    `;

    wrap.querySelector('[data-mat="color"]')?.addEventListener('input', (e) => {
      m.baseColor = (e.target as HTMLInputElement).value;
      this.engine.rebuildSceneObjects();
      this.engine.notify();
    });
    wrap.querySelector('[data-mat="metal"]')?.addEventListener('input', (e) => {
      m.metallic = parseFloat((e.target as HTMLInputElement).value);
      this.engine.rebuildSceneObjects();
      this.engine.notify();
    });
    wrap.querySelector('[data-mat="rough"]')?.addEventListener('input', (e) => {
      m.roughness = parseFloat((e.target as HTMLInputElement).value);
      this.engine.rebuildSceneObjects();
      this.engine.notify();
    });
    wrap.querySelector('[data-mat="emcol"]')?.addEventListener('input', (e) => {
      m.emissionColor = (e.target as HTMLInputElement).value;
      if (m.emissionStrength === 0) m.emissionStrength = 1;
      this.engine.rebuildSceneObjects();
      this.engine.notify();
    });
    wrap.querySelector('[data-mat="emstr"]')?.addEventListener('input', (e) => {
      m.emissionStrength = parseFloat((e.target as HTMLInputElement).value);
      this.engine.rebuildSceneObjects();
      this.engine.notify();
    });
    wrap.querySelector('[data-mat="alpha"]')?.addEventListener('input', (e) => {
      m.opacity = parseFloat((e.target as HTMLInputElement).value);
      this.engine.rebuildSceneObjects();
      this.engine.notify();
    });
    wrap.querySelector('[data-mat="texstudio"]')?.addEventListener('click', () => {
      openTextureStudioModal(this.engine, showToast);
    });
    wrap.querySelector('[data-mat="preview"]')?.addEventListener('click', () => {
      this.engine.state.shading = 'MATERIAL';
      this.engine.rebuildSceneObjects();
      this.engine.notify();
    });

    this.inspectorEl.appendChild(wrap);
  }

  private renderDataTab(active: SceneObjectData | null): void {
    if (!active) return;

    if (active.kind === 'MESH' && active.mesh) {
      const stats = this.engine.getPolyStats();
      const wrap = document.createElement('div');
      wrap.className = 'props-section';
      wrap.innerHTML = `
        <div class="props-sec-hdr">${Icons.chevronDown}<span>Mesh Topology &amp; Cutting</span></div>
        <div class="props-sec-content" style="display:flex;flex-direction:column;gap:6px;">
          <div style="color:#bbb;">Base Verts: <strong>${active.mesh.vertices.length}</strong> | Polygons: <strong>${active.mesh.faces.length}</strong></div>
          <div style="color:#999;font-size:10.5px;">Scene Evaluated Triangles: ${stats.tris}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:4px;">
            <button type="button" class="modix-btn" data-op="extrude">Extrude</button>
            <button type="button" class="modix-btn" data-op="inset">Inset</button>
            <button type="button" class="modix-btn" data-op="bevel">Bevel</button>
            <button type="button" class="modix-btn" data-op="subdivide">Subdivide</button>
            <button type="button" class="modix-btn" data-op="subsurf">Smooth Subd</button>
            <button type="button" class="modix-btn" data-op="loop_cut">Loop Cut</button>
            <button type="button" class="modix-btn" data-op="shade_smooth">Shade Smooth</button>
            <button type="button" class="modix-btn" data-op="shade_flat">Shade Flat</button>
          </div>
          <div class="menu-sep"></div>
          <button type="button" class="modix-btn primary" id="mesh-slice-btn">${Icons.slice3d}<span>Recortar / Fatiar Malha 3D</span></button>
          <div style="display:flex;gap:4px;">
            <button type="button" class="modix-btn" id="mesh-join-btn" style="flex:1;">${Icons.join}<span>Unir Selecionados</span></button>
            <button type="button" class="modix-btn" id="mesh-sep-btn" style="flex:1;">${Icons.separate}<span>Separar Partes</span></button>
          </div>
        </div>
      `;
      wrap.querySelectorAll<HTMLButtonElement>('[data-op]').forEach((b) => {
        b.addEventListener('click', () => {
          const op = b.dataset.op as
            | 'extrude'
            | 'inset'
            | 'bevel'
            | 'subdivide'
            | 'subsurf'
            | 'loop_cut'
            | 'shade_smooth'
            | 'shade_flat';
          this.engine.performEditMeshOp(op);
          showToast(`Mesh: ${b.textContent}`);
        });
      });
      wrap.querySelector('#mesh-slice-btn')?.addEventListener('click', () => {
        openSliceMeshModal(active.name, (axis, mode, off) => {
          this.engine.sliceActiveMesh(axis, mode, off);
          showToast(`Malha recortada no eixo ${axis}!`);
        });
      });
      wrap.querySelector('#mesh-join-btn')?.addEventListener('click', () => {
        const res = this.engine.joinSelected();
        showToast(res ? `Unido em "${res.name}"` : 'Selecione 2+ malhas primeiro');
      });
      wrap.querySelector('#mesh-sep-btn')?.addEventListener('click', () => {
        const parts = this.engine.separateSelectedByLooseParts();
        showToast(parts.length > 1 ? `Separado em ${parts.length} objetos` : 'A malha já é uma peça única');
      });
      this.inspectorEl.appendChild(wrap);
    } else if (active.kind === 'LIGHT') {
      const wrap = document.createElement('div');
      wrap.className = 'props-section';
      wrap.innerHTML = `
        <div class="props-sec-hdr">${Icons.chevronDown}<span>Light Settings</span></div>
        <div class="props-sec-content" style="display:flex;flex-direction:column;gap:8px;">
          <label style="display:flex;justify-content:space-between;">
            <span>Color</span>
            <input type="color" value="${active.lightColor || '#ffffff'}" data-lt="col" />
          </label>
          <label style="display:flex;justify-content:space-between;">
            <span>Power (${active.lightPower ?? 1000} W)</span>
            <input type="range" min="50" max="4000" step="50" value="${active.lightPower ?? 1000}" data-lt="pow" style="width:95px;" />
          </label>
          <button type="button" class="modix-btn primary" data-lt="ren">Preview Rendered Lighting</button>
        </div>
      `;
      wrap.querySelector('[data-lt="col"]')?.addEventListener('input', (e) => {
        active.lightColor = (e.target as HTMLInputElement).value;
        this.engine.rebuildSceneObjects();
      });
      wrap.querySelector('[data-lt="pow"]')?.addEventListener('input', (e) => {
        active.lightPower = parseFloat((e.target as HTMLInputElement).value);
        this.engine.rebuildSceneObjects();
        this.engine.notify();
      });
      wrap.querySelector('[data-lt="ren"]')?.addEventListener('click', () => {
        this.engine.state.shading = 'RENDERED';
        this.engine.rebuildSceneObjects();
        this.engine.notify();
      });
      this.inspectorEl.appendChild(wrap);
    } else if (active.kind === 'CAMERA') {
      const wrap = document.createElement('div');
      wrap.className = 'props-section';
      wrap.innerHTML = `
        <div class="props-sec-hdr">${Icons.chevronDown}<span>Camera Lens</span></div>
        <div class="props-sec-content" style="display:flex;flex-direction:column;gap:8px;">
          <button type="button" class="modix-btn primary" data-cam-view>Toggle Active Camera View</button>
        </div>
      `;
      wrap.querySelector('[data-cam-view]')?.addEventListener('click', () => {
        this.engine.toggleCameraView();
      });
      this.inspectorEl.appendChild(wrap);
    }
  }

  private renderOutputAndRenderTab(): void {
    const wrap = document.createElement('div');
    wrap.className = 'props-section';
    wrap.innerHTML = `
      <div class="props-sec-hdr">${Icons.chevronDown}<span>Renderização &amp; Exportação 3D</span></div>
      <div class="props-sec-content" style="display:flex;flex-direction:column;gap:6px;">
        <button type="button" class="modix-btn primary" data-act="hub">${Icons.download}<span>Central de Exportação (.OBJ, .GLB, .USDZ, .STL...)</span></button>
        <button type="button" class="modix-btn" data-exp="obj">${Icons.file3d}<span>Exportar Wavefront (.OBJ + UVs)</span></button>
        <button type="button" class="modix-btn" data-exp="glb">${Icons.file3d}<span>Exportar glTF Binário (.GLB + PBR)</span></button>
        <button type="button" class="modix-btn" data-exp="usdz">${Icons.cubeSmall}<span>Exportar Universal Scene (.USDZ)</span></button>
        <button type="button" class="modix-btn" data-exp="stl">${Icons.cubeSmall}<span>Exportar Stereolithography (.STL)</span></button>
        <button type="button" class="modix-btn" data-exp="modix">${Icons.save}<span>Exportar Arquivo (.MODIX)</span></button>
        <div class="menu-sep"></div>
        <button type="button" class="modix-btn" data-act="render">${Icons.cameraPhoto}<span>Renderizar Imagem (1280 x 720 PNG)</span></button>
      </div>
    `;
    wrap.querySelector('[data-act="hub"]')?.addEventListener('click', () => this.onOpenExportHub());
    wrap.querySelector('[data-act="render"]')?.addEventListener('click', () => this.onRenderRequest());
    wrap.querySelectorAll<HTMLButtonElement>('[data-exp]').forEach((b) => {
      b.addEventListener('click', () => {
        this.onExportRequest(b.dataset.exp as ExportFormatChoice);
      });
    });
    this.inspectorEl.appendChild(wrap);
  }

  private renderWorldTab(): void {
    const w = this.engine.state.world;
    const wrap = document.createElement('div');
    wrap.className = 'props-section';
    wrap.innerHTML = `
      <div class="props-sec-hdr">${Icons.chevronDown}<span>World Surface</span></div>
      <div class="props-sec-content" style="display:flex;flex-direction:column;gap:8px;">
        <label style="display:flex;justify-content:space-between;align-items:center;">
          <span>Viewport / World Color</span>
          <input type="color" value="${w.backgroundColor}" data-w="col" />
        </label>
        <div style="display:flex;gap:5px;">
          <button type="button" class="modix-btn" data-preset="#202020" style="flex:1;">Default #202020</button>
          <button type="button" class="modix-btn" data-preset="#000000" style="flex:1;">Pure Black</button>
        </div>
      </div>
    `;
    wrap.querySelector('[data-w="col"]')?.addEventListener('input', (e) => {
      w.backgroundColor = (e.target as HTMLInputElement).value;
      this.engine.rebuildSceneObjects();
    });
    wrap.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        w.backgroundColor = b.dataset.preset!;
        this.engine.rebuildSceneObjects();
        this.engine.notify();
      });
    });
    this.inspectorEl.appendChild(wrap);
  }

  private renderToolTab(): void {
    const st = this.engine.state;
    const wrap = document.createElement('div');
    wrap.className = 'props-section';
    wrap.innerHTML = `
      <div class="props-sec-hdr">${Icons.chevronDown}<span>Active Tool &amp; Touch Settings</span></div>
      <div class="props-sec-content" style="display:flex;flex-direction:column;gap:8px;">
        <div>Mode: <strong>${st.mode}</strong> | Tool: <strong>${st.activeTool}</strong></div>
        <label style="display:flex;justify-content:space-between;">
          <span>Increment Grid Snap</span>
          <input type="checkbox" ${st.snapEnabled ? 'checked' : ''} data-snap />
        </label>
        <div style="display:flex;gap:5px;">
          <button type="button" class="modix-btn" data-undo style="flex:1;">Undo</button>
          <button type="button" class="modix-btn" data-redo style="flex:1;">Redo</button>
        </div>
      </div>
    `;
    wrap.querySelector('[data-snap]')?.addEventListener('change', (e) => {
      st.snapEnabled = (e.target as HTMLInputElement).checked;
      this.engine.notify();
    });
    wrap.querySelector('[data-undo]')?.addEventListener('click', () => this.engine.undo());
    wrap.querySelector('[data-redo]')?.addEventListener('click', () => this.engine.redo());
    this.inspectorEl.appendChild(wrap);
  }

  private renderSceneOverviewTab(tab: PropertiesTabId): void {
    const stats = this.engine.getPolyStats();
    const wrap = document.createElement('div');
    wrap.className = 'props-section';
    wrap.innerHTML = `
      <div class="props-sec-hdr">${Icons.chevronDown}<span style="text-transform:capitalize;">${tab.replace('_', ' ')} Properties</span></div>
      <div class="props-sec-content" style="display:flex;flex-direction:column;gap:6px;color:#ccc;">
        <div>Scene: <strong>${escapeHtml(this.engine.state.sceneName)}</strong></div>
        <div>Groups / Collections: <strong>${this.engine.state.collections.length}</strong></div>
        <div>Objects: <strong>${this.engine.state.objects.length}</strong></div>
        <div>Vertices: <strong>${stats.verts}</strong> | Faces: <strong>${stats.faces}</strong></div>
        <div>Units: <strong>Metric (Meters)</strong></div>
      </div>
    `;
    this.inspectorEl.appendChild(wrap);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}
