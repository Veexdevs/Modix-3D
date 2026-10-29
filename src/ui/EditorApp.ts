import {
  exportSceneToDAE,
  exportSceneToMTL,
  exportSceneToOBJ,
  exportSceneToPLY,
  exportSceneToRBXMX,
  exportSceneToSTL,
  exportThreeGroupToGLB,
  exportThreeGroupToGLTF,
  exportThreeGroupToUSDZ,
  importAny3DFile,
  saveDataUrlPNG,
  saveOrShareFile,
  serializeProject,
  type OBJExportOptions
} from '../engine/Exporters';
import { ModixEngine } from '../engine/ModixEngine';
import { Icons } from '../icons/blenderIcons';
import type {
  ActiveToolId,
  InteractionMode,
  PrimitiveType,
  SceneObjectData,
  TransformOrientation,
  ViewportShading,
  WorkspaceId
} from '../types/scene';
import { AIChatPanel } from './AIChatPanel';
import {
  openDropdownMenu,
  openExportHubModal,
  openRenderResultModal,
  openSliceMeshModal,
  openSplashModal,
  openTextPromptModal,
  showToast,
  type DropdownItem,
  type ExportFormatChoice
} from './Modals';
import { PropertiesPanel } from './PropertiesPanel';
import { openTextureStudioModal } from './TexturePaintModal';
import { TimelinePanel } from './TimelinePanel';
import { ViewportOverlays } from './ViewportOverlays';

const WORKSPACES: WorkspaceId[] = [
  'Layout',
  'Modeling',
  'Sculpting',
  'UV Editing',
  'Texture Paint',
  'Shading',
  'Animation',
  'Rendering',
  'Compositing',
  'Geometry Nodes',
  'Scripting'
];

export class EditorApp {
  public engine: ModixEngine;
  private root: HTMLElement;

  private wsBarEl!: HTMLElement;
  private vpHeaderEl!: HTMLElement;
  private vpStageEl!: HTMLElement;
  private leftToolbarEl!: HTMLElement;
  private rightColEl!: HTMLElement;
  private outlinerEl!: HTMLElement;
  private outlinerResizerEl!: HTMLElement;
  private outlinerTreeEl!: HTMLElement;
  private fileInputEl!: HTMLInputElement;

  private overlays!: ViewportOverlays;
  private propsPanel!: PropertiesPanel;
  private timelinePanel!: TimelinePanel;
  private aiPanel!: AIChatPanel;

  constructor(root: HTMLElement) {
    this.root = root;
    this.engine = new ModixEngine();
    this.aiPanel = new AIChatPanel(this.engine, showToast);
    this.mountUI();
  }

  private mountUI(): void {
    this.root.innerHTML = `
      <div class="modix-shell">
        <div class="portrait-rotate-banner">
          <span>↻ Modix 3D foi desenhado para tela deitada (Landscape). Gire o aparelho para a experiência completa.</span>
        </div>

        <!-- 1. TOP MENU & WORKSPACE BAR -->
        <header class="modix-topbar">
          <button type="button" class="modix-brand-btn" id="modix-app-menu-btn" title="Modix 3D Menu">
            <img src="./brand/modix-mark-white.png" alt="Modix" class="modix-brand-icon" />
            <span class="modix-brand-title">Modix</span>
          </button>

          <nav class="modix-workspaces" id="modix-ws-tabs"></nav>

          <div class="modix-topbar-right">
            <button type="button" class="modix-ai-top-btn" id="btn-open-ai" title="Abrir Chat com IA ou Agente Multi-IA 3D">
              <span class="ai-star">✦</span><span>IA / Agente</span>
            </button>
            <button type="button" class="modix-scene-pill" id="btn-scene-pill">
              ${Icons.scene}<span id="lbl-scene-name">Scene</span><span class="pill-chevron">${Icons.chevronDown}</span>
            </button>
            <button type="button" class="modix-scene-pill" id="btn-viewlayer-pill">
              ${Icons.viewLayer}<span id="lbl-vl-name">ViewLayer</span><span class="pill-chevron">${Icons.chevronDown}</span>
            </button>
          </div>
        </header>

        <!-- 2. MAIN WORKBENCH -->
        <div class="modix-workbench">
          <!-- LEFT / CENTER COLUMN (3D Viewport + Timeline) -->
          <div class="modix-center-col">
            <div class="modix-vp-header" id="modix-vp-header"></div>
            <div class="modix-vp-stage" id="modix-vp-stage">
              <div class="vp-left-toolbar" id="vp-left-toolbar"></div>
            </div>
            <div class="modix-timeline" id="modix-timeline"></div>
          </div>

          <!-- RIGHT SIDEBAR (Resizable Explorer/Outliner + Properties) -->
          <aside class="modix-right-col" id="modix-right-col">
            <section class="modix-outliner" id="modix-outliner">
              <div class="panel-subhdr">
                <button type="button" class="hdr-pill" id="outliner-editor-btn" style="padding:0 5px;height:20px;" title="Explorer / Outliner">
                  ${Icons.editorOutliner}${Icons.chevronDown}
                </button>
                <button type="button" class="hdr-pill" id="outliner-new-group-btn" style="padding:0 6px;height:20px;" title="Criar Novo Grupo / Coleção">
                  ${Icons.collectionBox}<span style="font-size:10px;">+</span>
                </button>
                <div class="search-pill">
                  ${Icons.searchGlass}
                  <input type="text" id="outliner-search" aria-label="Search Outliner" />
                </div>
                <button type="button" class="hdr-menu-btn" id="outliner-filter-btn" style="padding:0 4px;" title="Ações do Explorer (Copiar, Colar, Unir, Grupos)">
                  ${Icons.filterFunnel}
                </button>
              </div>
              <div class="outliner-tree" id="outliner-tree"></div>
            </section>

            <!-- DRAG HANDLE UNDER EXPLORER TO RESIZE UP / DOWN -->
            <div
              class="outliner-resizer"
              id="outliner-resizer"
              title="Segure aqui embaixo do Explorer e puxe para cima ou para baixo"
            >
              <span class="outliner-resizer-grip"></span>
            </div>

            <section class="modix-properties" id="modix-properties"></section>
          </aside>
        </div>

        <input
          type="file"
          id="modix-file-input"
          accept=".obj,.fbx,.glb,.gltf,.dae,.stl,.ply,.3mf,.amf,.svg,.off,.rbxmx,.modix,.json,.png,.jpg,.jpeg,.webp"
          style="display:none;"
        />
      </div>
    `;

    this.wsBarEl = this.root.querySelector('#modix-ws-tabs')!;
    this.vpHeaderEl = this.root.querySelector('#modix-vp-header')!;
    this.vpStageEl = this.root.querySelector('#modix-vp-stage')!;
    this.leftToolbarEl = this.root.querySelector('#vp-left-toolbar')!;
    this.rightColEl = this.root.querySelector('#modix-right-col')!;
    this.outlinerEl = this.root.querySelector('#modix-outliner')!;
    this.outlinerResizerEl = this.root.querySelector('#outliner-resizer')!;
    this.outlinerTreeEl = this.root.querySelector('#outliner-tree')!;
    this.fileInputEl = this.root.querySelector('#modix-file-input')!;

    this.engine.mount(this.vpStageEl);

    this.overlays = new ViewportOverlays(this.engine, this.vpStageEl);
    this.propsPanel = new PropertiesPanel(
      this.engine,
      this.root.querySelector('#modix-properties')!,
      {
        onRenderRequest: () => this.triggerRenderModal(),
        onExportRequest: (fmt) => void this.handleExport(fmt),
        onOpenExportHub: () => this.openExportHub()
      }
    );
    this.timelinePanel = new TimelinePanel(
      this.engine,
      this.root.querySelector('#modix-timeline')!
    );

    this.bindTopBarEvents();
    this.bindExplorerResizer();
    this.bindOutlinerSearchAndImport();
    this.bindKeyboardShortcuts();

    this.engine.subscribe(() => this.syncAll());
    this.syncAll();
  }

  /** Touch & Mouse vertical drag handle right under the Explorer/Outliner */
  private bindExplorerResizer(): void {
    let dragging = false;
    let startY = 0;
    let startHeight = 0;

    this.outlinerResizerEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.outlinerResizerEl.setPointerCapture(e.pointerId);
      dragging = true;
      startY = e.clientY;
      startHeight = this.outlinerEl.getBoundingClientRect().height;
      this.outlinerResizerEl.classList.add('dragging');
    });

    this.outlinerResizerEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const colHeight = this.rightColEl.getBoundingClientRect().height;
      const minH = 62;
      const maxH = Math.max(120, colHeight - 92);
      const dy = e.clientY - startY;
      const nextH = Math.max(minH, Math.min(maxH, Math.round(startHeight + dy)));
      this.outlinerEl.style.flex = '0 0 auto';
      this.outlinerEl.style.minHeight = `${minH}px`;
      this.outlinerEl.style.height = `${nextH}px`;
    });

    const stopDrag = () => {
      if (!dragging) return;
      dragging = false;
      this.outlinerResizerEl.classList.remove('dragging');
    };

    this.outlinerResizerEl.addEventListener('pointerup', stopDrag);
    this.outlinerResizerEl.addEventListener('pointercancel', stopDrag);
  }

  private bindTopBarEvents(): void {
    this.root.querySelector('#btn-open-ai')?.addEventListener('click', () => {
      this.aiPanel.toggle();
    });

    const brandBtn = this.root.querySelector<HTMLElement>('#modix-app-menu-btn')!;
    brandBtn.addEventListener('click', () => {
      openDropdownMenu(brandBtn, [
        {
          label: 'Splash Screen / Sobre Modix 3D',
          onClick: () => this.showSplash()
        },
        {
          label: '✦ Abrir Chat IA / Agente Multi-IA',
          onClick: () => this.aiPanel.open()
        },
        { separator: true },
        { sectionTitle: 'Arquivo & Importação Universal' },
        {
          label: 'Nova Cena Padrão',
          shortcut: 'Ctrl+N',
          onClick: () => this.resetScene()
        },
        {
          label: 'Importar 3D (.OBJ, .FBX, .GLB, .DAE, .STL, .PLY, .3MF, .SVG, .RBXMX)...',
          onClick: () => this.fileInputEl.click()
        },
        {
          label: 'Estúdio de Desenho & Pintura de Textura 2D',
          onClick: () => openTextureStudioModal(this.engine, showToast)
        },
        {
          label: 'Salvar Projeto (.MODIX)',
          shortcut: 'Ctrl+S',
          onClick: () => void this.handleExport('modix')
        },
        { separator: true },
        { sectionTitle: 'Exportar Modelo 3D & Roblox Studio' },
        {
          label: '🚀 Central de Exportação Completa...',
          onClick: () => this.openExportHub()
        },
        {
          label: '🎮 Exportar .OBJ p/ Roblox Studio (Y-Up + UVs)',
          onClick: () => void this.handleExport('obj_roblox')
        },
        {
          label: '🧱 Exportar .RBXMX (Modelo Roblox Parts)',
          onClick: () => void this.handleExport('rbxmx')
        },
        {
          label: '📦 Exportar glTF Binário (.GLB + Texturas)',
          onClick: () => void this.handleExport('glb')
        },
        {
          label: '🖨 Exportar Impressão 3D (.STL)',
          onClick: () => void this.handleExport('stl')
        },
        {
          label: '📱 Exportar Apple AR (.USDZ)',
          onClick: () => void this.handleExport('usdz')
        },
        { separator: true },
        {
          label: 'Renderizar Imagem (PNG)',
          shortcut: 'F12',
          onClick: () => this.triggerRenderModal()
        },
        { separator: true },
        {
          label: 'Desfazer (Undo)',
          shortcut: 'Ctrl+Z',
          onClick: () => {
            if (this.engine.undo()) showToast('Desfeito (Undo)');
          }
        },
        {
          label: 'Refazer (Redo)',
          shortcut: 'Ctrl+Y',
          onClick: () => {
            if (this.engine.redo()) showToast('Refeito (Redo)');
          }
        }
      ]);
    });

    this.root.querySelector('#btn-scene-pill')?.addEventListener('click', (e) => {
      openDropdownMenu(e.currentTarget as HTMLElement, [
        {
          label: 'Renomear Cena...',
          onClick: () =>
            openTextPromptModal({
              title: 'Renomear Cena',
              label: 'Nome da cena:',
              initialValue: this.engine.state.sceneName,
              onConfirm: (v) => {
                this.engine.state.sceneName = v;
                this.engine.notify();
              }
            })
        },
        { label: 'Resetar Cena Inicial', onClick: () => this.resetScene() }
      ]);
    });

    this.root.querySelector('#btn-viewlayer-pill')?.addEventListener('click', (e) => {
      openDropdownMenu(e.currentTarget as HTMLElement, [
        { label: 'ViewLayer (Principal)', onClick: () => {} },
        { label: 'Central de Exportação 3D', onClick: () => this.openExportHub() },
        { label: 'Renderizar PNG', onClick: () => this.triggerRenderModal() }
      ]);
    });
  }

  private switchWorkspace(ws: WorkspaceId): void {
    const st = this.engine.state;
    st.workspace = ws;

    switch (ws) {
      case 'Layout':
        st.mode = 'OBJECT';
        st.shading = 'SOLID';
        st.activePropertiesTab = 'object';
        break;
      case 'Modeling':
        st.mode = 'EDIT';
        st.shading = 'SOLID';
        st.activePropertiesTab = 'data';
        break;
      case 'Sculpting':
        st.mode = 'SCULPT';
        st.activeTool = 'sculpt_draw';
        st.shading = 'SOLID';
        st.activePropertiesTab = 'tool';
        break;
      case 'UV Editing':
        st.mode = 'EDIT';
        st.shading = 'SOLID';
        st.activePropertiesTab = 'texture';
        break;
      case 'Texture Paint':
        st.mode = 'TEXTURE_PAINT';
        st.shading = 'SOLID';
        st.activePropertiesTab = 'texture';
        break;
      case 'Shading':
        st.mode = 'OBJECT';
        st.shading = 'MATERIAL';
        st.activePropertiesTab = 'material';
        break;
      case 'Animation':
        st.mode = 'OBJECT';
        st.activePropertiesTab = 'object';
        break;
      case 'Rendering':
        st.mode = 'OBJECT';
        st.shading = 'RENDERED';
        st.activePropertiesTab = 'render';
        this.triggerRenderModal();
        break;
      case 'Compositing':
        st.mode = 'OBJECT';
        break;
      case 'Geometry Nodes':
        st.mode = 'OBJECT';
        st.activePropertiesTab = 'modifiers';
        break;
      case 'Scripting':
        st.mode = 'OBJECT';
        break;
    }

    this.engine.rebuildSceneObjects();
    this.engine.notify();
  }

  private renderWorkspaceTabs(): void {
    this.wsBarEl.innerHTML = '';
    for (const ws of WORKSPACES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `modix-ws-tab ${this.engine.state.workspace === ws ? 'active' : ''}`;
      btn.textContent = ws;
      btn.addEventListener('click', () => this.switchWorkspace(ws));
      this.wsBarEl.appendChild(btn);
    }
    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'modix-ws-plus';
    plusBtn.title = 'Splash / New Workspace';
    plusBtn.innerHTML = Icons.plus;
    plusBtn.addEventListener('click', () => this.showSplash());
    this.wsBarEl.appendChild(plusBtn);
  }

  private renderViewportHeader(): void {
    const st = this.engine.state;
    const modeLabels: Record<InteractionMode, { label: string; icon: string }> = {
      OBJECT: { label: 'Object Mode', icon: Icons.modeObject },
      EDIT: { label: 'Edit Mode', icon: Icons.modeEdit },
      SCULPT: { label: 'Sculpt Mode', icon: Icons.modeSculpt },
      TEXTURE_PAINT: { label: 'Texture Paint', icon: Icons.modePaint }
    };
    const curMode = modeLabels[st.mode];

    this.vpHeaderEl.innerHTML = `
      <div class="vp-hdr-group">
        <button type="button" class="hdr-pill" id="vp-editor-btn" style="padding:0 5px;">
          ${Icons.editor3d}${Icons.chevronDown}
        </button>

        <button type="button" class="hdr-pill" id="vp-mode-btn">
          ${curMode.icon}<span>${curMode.label}</span>${Icons.chevronDown}
        </button>

        ${
          st.mode === 'EDIT'
            ? `<div class="hdr-icon-group">
                <button type="button" class="hdr-icon-btn ${st.editSelectMode === 'VERTEX' ? 'active' : ''}" data-esel="VERTEX" title="Vertex Select">${Icons.editVertex}</button>
                <button type="button" class="hdr-icon-btn ${st.editSelectMode === 'EDGE' ? 'active' : ''}" data-esel="EDGE" title="Edge Select">${Icons.editEdge}</button>
                <button type="button" class="hdr-icon-btn ${st.editSelectMode === 'FACE' ? 'active' : ''}" data-esel="FACE" title="Face Select">${Icons.editFace}</button>
              </div>`
            : ''
        }

        <button type="button" class="hdr-menu-btn" id="menu-view">View</button>
        <button type="button" class="hdr-menu-btn" id="menu-select">Select</button>
        <button type="button" class="hdr-menu-btn" id="menu-add">Add</button>
        <button type="button" class="hdr-menu-btn" id="menu-object">${st.mode === 'EDIT' ? 'Mesh' : 'Object'}</button>
      </div>

      <div class="vp-hdr-group">
        <button type="button" class="hdr-pill" id="btn-orient">
          ${Icons.orientationGlobal}<span>${st.orientation}</span>${Icons.chevronDown}
        </button>

        <button type="button" class="hdr-pill" id="btn-pivot" style="padding:0 5px;" title="Transform Pivot Point">
          ${Icons.pivotMedian}${Icons.chevronDown}
        </button>

        <div class="hdr-icon-group">
          <button type="button" class="hdr-icon-btn ${st.snapEnabled ? 'active' : ''}" id="btn-snap" title="Snap during Transform">${Icons.snapMagnet}</button>
          <button type="button" class="hdr-icon-btn" id="btn-snap-opt">${Icons.snapIncrement}${Icons.chevronDown}</button>
        </div>

        <div class="hdr-icon-group">
          <button type="button" class="hdr-icon-btn ${st.proportionalEnabled ? 'active' : ''}" id="btn-prop" title="Proportional Editing">${Icons.proportionalCircle}</button>
          <button type="button" class="hdr-icon-btn">${Icons.proportionalSmooth}${Icons.chevronDown}</button>
        </div>
      </div>

      <div class="vp-hdr-group">
        <button type="button" class="hdr-pill" id="btn-gizmos" style="padding:0 5px;" title="Viewport Gizmos">
          ${Icons.gizmoToggle}${Icons.chevronDown}
        </button>

        <div class="hdr-icon-group">
          <button type="button" class="hdr-icon-btn ${st.showOverlays ? 'active' : ''}" id="btn-overlays" title="Show Overlays">${Icons.overlaysToggle}</button>
          <button type="button" class="hdr-icon-btn" id="btn-overlays-more" style="padding:0 3px;">${Icons.chevronDown}</button>
        </div>

        <button type="button" class="hdr-pill ${st.xray ? 'active' : ''}" id="btn-xray" style="padding:0 5px;" title="Toggle X-Ray">
          ${Icons.xrayToggle}
        </button>

        <div class="hdr-icon-group">
          <button type="button" class="hdr-icon-btn ${st.shading === 'WIREFRAME' ? 'active-gray' : ''}" data-shade="WIREFRAME" title="Viewport Shading: Wireframe">${Icons.shadingWireframe}</button>
          <button type="button" class="hdr-icon-btn ${st.shading === 'SOLID' ? 'active-gray' : ''}" data-shade="SOLID" title="Viewport Shading: Solid">${Icons.shadingSolid}</button>
          <button type="button" class="hdr-icon-btn ${st.shading === 'MATERIAL' ? 'active-gray' : ''}" data-shade="MATERIAL" title="Viewport Shading: Material Preview">${Icons.shadingMaterial}</button>
          <button type="button" class="hdr-icon-btn ${st.shading === 'RENDERED' ? 'active-gray' : ''}" data-shade="RENDERED" title="Viewport Shading: Rendered">${Icons.shadingRendered}</button>
          <button type="button" class="hdr-icon-btn" id="btn-shade-opt" style="padding:0 3px;">${Icons.chevronDown}</button>
        </div>
      </div>
    `;

    // Mode Selector
    this.vpHeaderEl.querySelector('#vp-mode-btn')?.addEventListener('click', (e) => {
      const setMode = (m: InteractionMode) => {
        st.mode = m;
        if (m === 'SCULPT' && !st.activeTool.startsWith('sculpt_')) {
          st.activeTool = 'sculpt_draw';
        } else if (m === 'OBJECT' && st.activeTool.startsWith('sculpt_')) {
          st.activeTool = 'select_box';
        }
        this.engine.rebuildSceneObjects();
        this.engine.notify();
      };
      openDropdownMenu(e.currentTarget as HTMLElement, [
        { label: 'Object Mode', shortcut: 'Tab', onClick: () => setMode('OBJECT') },
        { label: 'Edit Mode', shortcut: 'Tab', onClick: () => setMode('EDIT') },
        { label: 'Sculpt Mode', onClick: () => setMode('SCULPT') },
        { label: 'Texture Paint (Pintar 3D)', onClick: () => setMode('TEXTURE_PAINT') },
        { separator: true },
        {
          label: '🎨 Estúdio de Desenho de Texturas 2D...',
          onClick: () => openTextureStudioModal(this.engine, showToast)
        }
      ]);
    });

    this.vpHeaderEl.querySelectorAll<HTMLButtonElement>('[data-esel]').forEach((b) => {
      b.addEventListener('click', () => {
        st.editSelectMode = b.dataset.esel as 'VERTEX' | 'EDGE' | 'FACE';
        this.engine.rebuildSceneObjects();
        this.engine.notify();
      });
    });

    // View Menu
    this.vpHeaderEl.querySelector('#menu-view')?.addEventListener('click', (e) => {
      openDropdownMenu(e.currentTarget as HTMLElement, [
        { label: 'Frame Selected', shortcut: '.', onClick: () => this.engine.frameSelected() },
        { separator: true },
        { label: 'Top View (Z)', shortcut: 'Num 7', onClick: () => this.engine.snapViewToAxis('Z') },
        { label: 'Front View (-Y)', shortcut: 'Num 1', onClick: () => this.engine.snapViewToAxis('-Y') },
        { label: 'Right View (X)', shortcut: 'Num 3', onClick: () => this.engine.snapViewToAxis('X') },
        { separator: true },
        { label: 'Toggle Active Camera', shortcut: 'Num 0', onClick: () => this.engine.toggleCameraView() },
        { label: 'Perspective / Orthographic', shortcut: 'Num 5', onClick: () => this.engine.toggleProjection() }
      ]);
    });

    // Select Menu
    this.vpHeaderEl.querySelector('#menu-select')?.addEventListener('click', (e) => {
      openDropdownMenu(e.currentTarget as HTMLElement, [
        {
          label: 'Selecionar Tudo (All)',
          shortcut: 'A',
          onClick: () => {
            if (st.mode === 'EDIT') {
              const active = this.engine.getActiveObject();
              if (active?.mesh) {
                st.selectedFaces = active.mesh.faces.map((_, i) => i);
                st.selectedVertices = active.mesh.vertices.map((_, i) => i);
              }
            } else {
              st.selectedIds = st.objects.map((o) => o.id);
              st.activeObjectId = st.objects[0]?.id || null;
            }
            this.engine.rebuildSceneObjects();
            this.engine.notify();
          }
        },
        {
          label: 'Selecionar Apenas Malhas (Meshes)',
          onClick: () => {
            const meshes = st.objects.filter((o) => o.kind === 'MESH').map((o) => o.id);
            st.selectedIds = meshes;
            st.activeObjectId = meshes[0] || null;
            this.engine.rebuildSceneObjects();
            this.engine.notify();
          }
        },
        {
          label: 'Limpar Seleção (None)',
          shortcut: 'Alt+A',
          onClick: () => {
            st.selectedIds = [];
            st.selectedFaces = [];
            st.selectedVertices = [];
            this.engine.rebuildSceneObjects();
            this.engine.notify();
          }
        },
        {
          label: 'Inverter Seleção',
          shortcut: 'Ctrl+I',
          onClick: () => {
            const cur = new Set(st.selectedIds);
            st.selectedIds = st.objects.filter((o) => !cur.has(o.id)).map((o) => o.id);
            st.activeObjectId = st.selectedIds[0] || null;
            this.engine.rebuildSceneObjects();
            this.engine.notify();
          }
        }
      ]);
    });

    // Expanded Add Menu (All 24 3D Primitives + Groups + Import!)
    this.vpHeaderEl.querySelector('#menu-add')?.addEventListener('click', (e) => {
      const addP = (t: PrimitiveType) => {
        const created = this.engine.addPrimitive(t);
        showToast(`Adicionado: ${created.name}`);
      };
      openDropdownMenu(e.currentTarget as HTMLElement, [
        { sectionTitle: 'Formas Básicas 3D' },
        { label: 'Cube (Cubo)', onClick: () => addP('cube') },
        { label: 'Plane (Plano)', onClick: () => addP('plane') },
        { label: 'Grid (Grade Subdividida)', onClick: () => addP('grid') },
        { label: 'UV Sphere (Esfera)', onClick: () => addP('uv_sphere') },
        { label: 'Ico Sphere (Icoesfera)', onClick: () => addP('ico_sphere') },
        { label: 'Cylinder (Cilindro)', onClick: () => addP('cylinder') },
        { label: 'Cone', onClick: () => addP('cone') },
        { label: 'Torus (Rosquinha)', onClick: () => addP('torus') },
        { label: 'Capsule (Cápsula)', onClick: () => addP('capsule') },
        { separator: true },
        { sectionTitle: 'Arquitetura & Roblox Studio' },
        { label: 'Wedge (Rampa Roblox)', onClick: () => addP('wedge') },
        { label: 'Corner Wedge (Rampa de Canto)', onClick: () => addP('corner_wedge') },
        { label: 'Pyramid (Pirâmide)', onClick: () => addP('pyramid') },
        { label: 'Prism (Prisma Triangular)', onClick: () => addP('prism') },
        { label: 'Hexagon (Coluna Hexagonal)', onClick: () => addP('hex_cylinder') },
        { label: 'Pipe (Tubo Oco)', onClick: () => addP('pipe') },
        { label: 'Arch (Arco / Portal)', onClick: () => addP('arch') },
        { label: 'Stairs (Escada)', onClick: () => addP('stairs') },
        { separator: true },
        { sectionTitle: 'Formas Especiais & Arte' },
        { label: 'Star (Estrela 3D)', onClick: () => addP('star') },
        { label: 'Gear (Engrenagem)', onClick: () => addP('gear') },
        { label: 'Ring (Anel)', onClick: () => addP('ring') },
        { label: 'Crystal (Cristal / Diamante)', onClick: () => addP('crystal') },
        { label: 'Heart (Coração 3D)', onClick: () => addP('heart') },
        { label: 'Torus Knot (Nó 3D)', onClick: () => addP('torus_knot') },
        { label: 'Suzanne (Macaco)', onClick: () => addP('monkey') },
        { separator: true },
        { sectionTitle: 'Cena, Grupos & Arquivos' },
        { label: '📁 Novo Grupo / Coleção...', onClick: () => this.promptCreateGroup() },
        { label: 'Light (Ponto de Luz)', onClick: () => this.engine.addSceneNonMesh('LIGHT') },
        { label: 'Camera', onClick: () => this.engine.addSceneNonMesh('CAMERA') },
        { label: 'Empty (Eixos)', onClick: () => this.engine.addSceneNonMesh('EMPTY') },
        { label: '📂 Importar Arquivo 3D...', onClick: () => this.fileInputEl.click() }
      ]);
    });

    // Expanded Object / Mesh Menu (Rename, Copy, Paste, Cut, Join, Group, Slice 3D, Texture, Delete)
    this.vpHeaderEl.querySelector('#menu-object')?.addEventListener('click', (e) => {
      if (st.mode === 'EDIT') {
        openDropdownMenu(e.currentTarget as HTMLElement, [
          { sectionTitle: 'Modelagem de Malha' },
          { label: 'Extrude Faces', shortcut: 'E', onClick: () => this.engine.performEditMeshOp('extrude') },
          { label: 'Inset Faces', shortcut: 'I', onClick: () => this.engine.performEditMeshOp('inset') },
          { label: 'Bevel Faces', shortcut: 'Ctrl+B', onClick: () => this.engine.performEditMeshOp('bevel') },
          { label: 'Subdivide Quads', onClick: () => this.engine.performEditMeshOp('subdivide') },
          { label: 'Catmull-Clark Smooth', onClick: () => this.engine.performEditMeshOp('subsurf') },
          { label: 'Loop Cut (Mid Z)', shortcut: 'Ctrl+R', onClick: () => this.engine.performEditMeshOp('loop_cut') },
          {
            label: '✂ Recortar / Fatiar Malha 3D...',
            onClick: () => this.promptSliceActiveMesh()
          },
          { separator: true },
          { label: 'Deletar Faces Selecionadas', shortcut: 'X', onClick: () => this.engine.performEditMeshOp('delete_faces') }
        ]);
      } else {
        openDropdownMenu(e.currentTarget as HTMLElement, this.buildObjectOperationsMenu());
      }
    });

    this.vpHeaderEl.querySelector('#btn-orient')?.addEventListener('click', (e) => {
      const setOr = (o: TransformOrientation) => {
        st.orientation = o;
        this.engine.notify();
      };
      openDropdownMenu(e.currentTarget as HTMLElement, [
        { label: 'Global', onClick: () => setOr('Global') },
        { label: 'Local', onClick: () => setOr('Local') },
        { label: 'Normal', onClick: () => setOr('Normal') },
        { label: 'View', onClick: () => setOr('View') }
      ]);
    });

    this.vpHeaderEl.querySelector('#btn-pivot')?.addEventListener('click', (e) => {
      openDropdownMenu(e.currentTarget as HTMLElement, [
        { label: 'Median Point', onClick: () => { st.pivotPoint = 'Median Point'; this.engine.rebuildGizmo(); this.engine.notify(); } },
        { label: '3D Cursor', onClick: () => { st.pivotPoint = '3D Cursor'; this.engine.rebuildGizmo(); this.engine.notify(); } },
        { label: 'Individual Origins', onClick: () => { st.pivotPoint = 'Individual Origins'; this.engine.notify(); } }
      ]);
    });

    this.vpHeaderEl.querySelector('#btn-snap')?.addEventListener('click', () => {
      st.snapEnabled = !st.snapEnabled;
      showToast(st.snapEnabled ? 'Snap: ON (0.25m / 15°)' : 'Snap: OFF');
      this.engine.notify();
    });

    this.vpHeaderEl.querySelector('#btn-prop')?.addEventListener('click', () => {
      st.proportionalEnabled = !st.proportionalEnabled;
      this.engine.notify();
    });

    this.vpHeaderEl.querySelector('#btn-overlays')?.addEventListener('click', () => {
      st.showOverlays = !st.showOverlays;
      this.engine.rebuildSceneObjects();
      this.engine.notify();
    });

    this.vpHeaderEl.querySelector('#btn-xray')?.addEventListener('click', () => {
      st.xray = !st.xray;
      this.engine.rebuildSceneObjects();
      this.engine.notify();
    });

    this.vpHeaderEl.querySelectorAll<HTMLButtonElement>('[data-shade]').forEach((b) => {
      b.addEventListener('click', () => {
        st.shading = b.dataset.shade as ViewportShading;
        this.engine.rebuildSceneObjects();
        this.engine.notify();
      });
    });
  }

  private buildObjectOperationsMenu(specificObj?: SceneObjectData): DropdownItem[] {
    const targetObj = specificObj || this.engine.getActiveObject();
    const selCount = this.engine.state.selectedIds.length;
    const moveGroupItems: DropdownItem[] = this.engine.state.collections.map((c) => ({
      label: `↳ Mover para "${c.name}"`,
      onClick: () => {
        const ids = specificObj
          ? [...new Set([...this.engine.state.selectedIds, specificObj.id])]
          : this.engine.state.selectedIds;
        this.engine.moveObjectsToCollection(ids, c.name);
        showToast(`Movido para grupo "${c.name}"`);
      }
    }));

    return [
      { sectionTitle: targetObj ? `Objeto: ${targetObj.name}` : 'Operações de Objeto' },
      {
        label: '✎ Renomear...',
        shortcut: 'F2',
        onClick: () => {
          if (!targetObj) return;
          openTextPromptModal({
            title: 'Renomear Objeto',
            label: 'Novo nome:',
            initialValue: targetObj.name,
            onConfirm: (val) => {
              this.engine.renameObject(targetObj.id, val);
              showToast(`Renomeado para "${val}"`);
            }
          });
        }
      },
      {
        label: '📋 Copiar (Copy)',
        shortcut: 'Ctrl+C',
        onClick: () => {
          if (specificObj && !this.engine.state.selectedIds.includes(specificObj.id)) {
            this.engine.selectObject(specificObj.id, false);
          }
          const n = this.engine.copySelected();
          showToast(`${n} objeto(s) copiado(s)`);
        }
      },
      {
        label: '✂ Recortar (Cut p/ Clipboard)',
        shortcut: 'Ctrl+X',
        onClick: () => {
          if (specificObj && !this.engine.state.selectedIds.includes(specificObj.id)) {
            this.engine.selectObject(specificObj.id, false);
          }
          const n = this.engine.cutSelected();
          showToast(`${n} objeto(s) recortado(s)`);
        }
      },
      {
        label: '📥 Colar (Paste)',
        shortcut: 'Ctrl+V',
        onClick: () => {
          const p = this.engine.pasteClipboard();
          showToast(p.length ? `${p.length} objeto(s) colado(s)` : 'Nada copiado ainda');
        }
      },
      {
        label: 'Duplicar',
        shortcut: 'Shift+D',
        onClick: () => this.engine.duplicateSelected()
      },
      { separator: true },
      { sectionTitle: 'Malha, União & Corte 3D' },
      {
        label: `🔗 Unir Malhas Selecionadas (${selCount})`,
        shortcut: 'Ctrl+J',
        onClick: () => {
          const res = this.engine.joinSelected();
          showToast(
            res
              ? `Objetos unidos em "${res.name}"!`
              : 'Selecione 2 ou mais objetos Mesh (toque no ⊕ no Explorer ou Shift+Clique) para unir!'
          );
        }
      },
      {
        label: '🔪 Recortar / Fatiar Malha 3D...',
        onClick: () => this.promptSliceActiveMesh()
      },
      {
        label: 'Separar Partes Soltas',
        onClick: () => {
          const parts = this.engine.separateSelectedByLooseParts();
          showToast(parts.length > 1 ? `Separado em ${parts.length} partes!` : 'Nenhuma parte solta');
        }
      },
      {
        label: '🎨 Desenhar / Pintar Textura...',
        onClick: () => openTextureStudioModal(this.engine, showToast)
      },
      { label: 'Shade Smooth', onClick: () => this.engine.performEditMeshOp('shade_smooth') },
      { label: 'Shade Flat', onClick: () => this.engine.performEditMeshOp('shade_flat') },
      { separator: true },
      { sectionTitle: 'Grupos / Coleções' },
      {
        label: '📁 Colocar em Novo Grupo...',
        shortcut: 'Ctrl+G',
        onClick: () => this.promptCreateGroup(true)
      },
      ...moveGroupItems,
      { separator: true },
      {
        label: '🗑 Remover / Deletar',
        shortcut: 'Del',
        onClick: () => {
          if (specificObj && !this.engine.state.selectedIds.includes(specificObj.id)) {
            this.engine.selectObject(specificObj.id, false);
          }
          this.engine.deleteSelected();
          showToast('Removido');
        }
      }
    ];
  }

  private promptCreateGroup(moveSelected = false): void {
    openTextPromptModal({
      title: moveSelected ? 'Colocar Selecionados em Novo Grupo' : 'Criar Novo Grupo / Coleção',
      label: 'Nome do Grupo:',
      initialValue: `Grupo_${this.engine.state.collections.length}`,
      confirmLabel: 'Criar Grupo',
      onConfirm: (name) => {
        if (moveSelected && this.engine.state.selectedIds.length > 0) {
          this.engine.groupSelectedIntoNewCollection(name);
          showToast(`Objetos agrupados em "${name}"`);
        } else {
          this.engine.createCollection(name);
          showToast(`Grupo "${name}" criado`);
        }
      }
    });
  }

  private promptSliceActiveMesh(): void {
    const active = this.engine.getActiveObject();
    if (!active || active.kind !== 'MESH') {
      showToast('Selecione um objeto Mesh 3D para recortar');
      return;
    }
    openSliceMeshModal(active.name, (axis, mode, offset) => {
      const parts = this.engine.sliceActiveMesh(axis, mode, offset);
      showToast(
        mode === 'split'
          ? `"${active.name}" dividido em ${parts.length} partes!`
          : `Malha "${active.name}" recortada!`
      );
    });
  }

  private renderLeftToolbar(): void {
    const st = this.engine.state;
    const baseTools: Array<{ id: ActiveToolId; icon: string; title: string; hasSub?: boolean }> = [
      { id: 'select_box', icon: Icons.toolSelectBox, title: 'Select Box', hasSub: true },
      { id: 'cursor', icon: Icons.toolCursor, title: '3D Cursor' },
      { id: 'move', icon: Icons.toolMove, title: 'Move (G)' },
      { id: 'rotate', icon: Icons.toolRotate, title: 'Rotate (R)' },
      { id: 'scale', icon: Icons.toolScale, title: 'Scale (S)', hasSub: true },
      { id: 'transform', icon: Icons.toolTransform, title: 'Transform' },
      { id: 'annotate', icon: Icons.toolAnnotate, title: 'Annotate', hasSub: true },
      { id: 'measure', icon: Icons.toolMeasure, title: 'Measure' },
      { id: 'add_cube', icon: Icons.toolAddCube, title: 'Add Cube', hasSub: true }
    ];

    this.leftToolbarEl.innerHTML = '';

    for (const t of baseTools) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tool-btn ${st.activeTool === t.id ? 'active' : ''}`;
      btn.title = t.title;
      btn.innerHTML = `${t.icon}${t.hasSub ? '<span class="sub-corner"></span>' : ''}`;
      btn.addEventListener('click', () => {
        st.activeTool = t.id;
        this.engine.rebuildGizmo();
        this.engine.notify();
      });
      this.leftToolbarEl.appendChild(btn);
    }

    if (st.mode === 'EDIT') {
      const sep = document.createElement('div');
      sep.className = 'tool-divider';
      this.leftToolbarEl.appendChild(sep);

      const editActions: Array<{
        op: 'extrude' | 'inset' | 'bevel' | 'loop_cut';
        icon: string;
        title: string;
      }> = [
        { op: 'extrude', icon: Icons.toolExtrude, title: 'Extrude Selected Faces' },
        { op: 'inset', icon: Icons.toolInset, title: 'Inset Selected Faces' },
        { op: 'bevel', icon: Icons.toolBevel, title: 'Bevel Faces' },
        { op: 'loop_cut', icon: Icons.toolLoopCut, title: 'Loop Cut' }
      ];
      for (const act of editActions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tool-btn';
        btn.title = act.title;
        btn.innerHTML = act.icon;
        btn.addEventListener('click', () => {
          this.engine.performEditMeshOp(act.op);
          showToast(act.title);
        });
        this.leftToolbarEl.appendChild(btn);
      }
    } else if (st.mode === 'SCULPT') {
      const sep = document.createElement('div');
      sep.className = 'tool-divider';
      this.leftToolbarEl.appendChild(sep);

      const brushes: Array<{ id: ActiveToolId; icon: string; title: string }> = [
        { id: 'sculpt_draw', icon: Icons.toolSculptDraw, title: 'Draw Brush' },
        { id: 'sculpt_inflate', icon: Icons.toolSculptInflate, title: 'Inflate Brush' },
        { id: 'sculpt_smooth', icon: Icons.toolSculptSmooth, title: 'Smooth Brush' },
        { id: 'sculpt_grab', icon: Icons.toolSculptGrab, title: 'Grab Brush' },
        { id: 'sculpt_flatten', icon: Icons.toolSculptFlatten, title: 'Flatten Brush' },
        { id: 'sculpt_pinch', icon: Icons.toolSculptPinch, title: 'Pinch Brush' }
      ];
      for (const br of brushes) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `tool-btn ${st.activeTool === br.id ? 'active' : ''}`;
        btn.title = br.title;
        btn.innerHTML = br.icon;
        btn.addEventListener('click', () => {
          st.activeTool = br.id;
          this.engine.notify();
        });
        this.leftToolbarEl.appendChild(btn);
      }
    }
  }

  private renderOutliner(): void {
    const st = this.engine.state;
    const q = st.outlinerSearch.trim().toLowerCase();

    this.outlinerTreeEl.innerHTML = `
      <div class="outliner-row">
        <div class="outliner-row-left">
          ${Icons.collectionRoot}
          <span class="obj-label">Scene Collection</span>
        </div>
        <div class="outliner-row-right">
          <button type="button" class="outliner-mini-btn" id="outliner-paste-top" title="Colar (Paste)">📥</button>
        </div>
      </div>
    `;

    this.outlinerTreeEl.querySelector('#outliner-paste-top')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const pasted = this.engine.pasteClipboard();
      showToast(pasted.length ? `${pasted.length} colado(s)` : 'Área de transferência vazia');
    });

    for (const col of st.collections) {
      const colObjs = st.objects.filter(
        (o) =>
          (o.collection || 'Collection') === col.name &&
          (!q || o.name.toLowerCase().includes(q) || col.name.toLowerCase().includes(q))
      );

      const isActiveCol = st.activeCollection === col.name;
      const colRow = document.createElement('div');
      colRow.className = `outliner-row indent-1 ${isActiveCol ? 'active-col' : ''}`;
      colRow.innerHTML = `
        <div class="outliner-row-left">
          <button type="button" class="outliner-collapse-btn" title="Expandir / Recolher Grupo">
            ${col.collapsed ? Icons.chevronRight : Icons.chevronDown}
          </button>
          ${Icons.collectionBox}
          <span class="obj-label">${escapeHtml(col.name)}</span>
        </div>
        <div class="outliner-row-right">
          <button type="button" class="outliner-mini-btn" data-col-more title="Opções do Grupo">⋯</button>
          <button type="button" class="outliner-eye-btn ${col.visible ? '' : 'dimmed'}" data-col-eye title="Mostrar / Ocultar Grupo">
            ${col.visible ? Icons.eyeOpen : Icons.eyeClosed}
          </button>
          ${Icons.renderCamSmall}
        </div>
      `;

      colRow.querySelector('.outliner-collapse-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.engine.toggleCollectionCollapsed(col.name);
      });

      colRow.querySelector('[data-col-eye]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.engine.toggleCollectionVisible(col.name);
      });

      colRow.querySelector('[data-col-more]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openDropdownMenu(e.currentTarget as HTMLElement, [
          { sectionTitle: `Grupo: ${col.name}` },
          {
            label: 'Selecionar Todos do Grupo',
            onClick: () => this.engine.selectCollectionObjects(col.name)
          },
          {
            label: 'Mover Objetos Selecionados p/ Este Grupo',
            onClick: () => {
              this.engine.moveObjectsToCollection(st.selectedIds, col.name);
              showToast(`Movido para "${col.name}"`);
            }
          },
          {
            label: '✎ Renomear Grupo...',
            onClick: () =>
              openTextPromptModal({
                title: 'Renomear Grupo',
                label: 'Novo nome:',
                initialValue: col.name,
                onConfirm: (next) => this.engine.renameCollection(col.name, next)
              })
          },
          { separator: true },
          {
            label: 'Excluir Grupo (Manter Objetos)',
            onClick: () => this.engine.deleteCollection(col.name, false)
          },
          {
            label: '🗑 Excluir Grupo + Objetos Dentro',
            onClick: () => this.engine.deleteCollection(col.name, true)
          }
        ]);
      });

      colRow.addEventListener('click', () => {
        st.activeCollection = col.name;
        this.renderOutliner();
      });

      colRow.addEventListener('dblclick', () => {
        openTextPromptModal({
          title: 'Renomear Grupo',
          label: 'Novo nome do grupo:',
          initialValue: col.name,
          onConfirm: (next) => this.engine.renameCollection(col.name, next)
        });
      });

      this.outlinerTreeEl.appendChild(colRow);

      if (col.collapsed && !q) continue;

      for (const obj of colObjs) {
        const isSelected = st.selectedIds.includes(obj.id);
        const row = document.createElement('div');
        row.className = `outliner-row indent-2 ${isSelected ? 'selected' : ''}`;

        const objIcon =
          obj.kind === 'CAMERA'
            ? Icons.outlinerCamOrange
            : obj.kind === 'LIGHT'
              ? Icons.outlinerLightOrange
              : obj.kind === 'EMPTY'
                ? Icons.outlinerEmptyOrange
                : Icons.outlinerObjOrange;

        const dataBadge =
          obj.kind === 'CAMERA'
            ? Icons.dataCamBadge
            : obj.kind === 'LIGHT'
              ? Icons.dataLightBadge
              : obj.kind === 'MESH'
                ? Icons.dataMeshBadge
                : '';

        row.innerHTML = `
          <div class="outliner-row-left">
            <span style="opacity:0.55;font-size:9px;">▸</span>
            ${objIcon}
            <span class="obj-label">${escapeHtml(obj.name)}</span>
            ${dataBadge}
          </div>
          <div class="outliner-row-right">
            <button type="button" class="outliner-mini-btn ${isSelected ? 'multi-on' : ''}" data-multi title="Selecionar junto (Multi-Seleção p/ Unir ou Agrupar)">⊕</button>
            <button type="button" class="outliner-mini-btn" data-more title="Ações (Renomear, Grupo, Copiar, Unir, Recortar, Deletar)">⋯</button>
            <button type="button" class="outliner-eye-btn ${obj.visible ? '' : 'dimmed'}" data-eye title="Mostrar / Ocultar">
              ${obj.visible ? Icons.eyeOpen : Icons.eyeClosed}
            </button>
            ${Icons.renderCamSmall}
          </div>
        `;

        row.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          this.engine.selectObject(obj.id, e.shiftKey || e.ctrlKey || e.metaKey);
        });

        row.addEventListener('dblclick', () => {
          openTextPromptModal({
            title: 'Renomear Objeto',
            label: 'Novo nome:',
            initialValue: obj.name,
            onConfirm: (val) => this.engine.renameObject(obj.id, val)
          });
        });

        row.querySelector('[data-multi]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.engine.selectObject(obj.id, true);
        });

        row.querySelector('[data-more]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!st.selectedIds.includes(obj.id)) {
            this.engine.selectObject(obj.id, false);
          }
          openDropdownMenu(
            e.currentTarget as HTMLElement,
            this.buildObjectOperationsMenu(obj)
          );
        });

        row.querySelector('[data-eye]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          obj.visible = !obj.visible;
          this.engine.rebuildSceneObjects();
          this.engine.notify();
        });

        this.outlinerTreeEl.appendChild(row);
      }
    }
  }

  private bindOutlinerSearchAndImport(): void {
    const outSearch = this.root.querySelector<HTMLInputElement>('#outliner-search');
    outSearch?.addEventListener('input', () => {
      this.engine.state.outlinerSearch = outSearch.value;
      this.renderOutliner();
    });

    this.root.querySelector('#outliner-new-group-btn')?.addEventListener('click', () => {
      this.promptCreateGroup(false);
    });

    this.root.querySelector('#outliner-filter-btn')?.addEventListener('click', (e) => {
      openDropdownMenu(e.currentTarget as HTMLElement, [
        { sectionTitle: 'Explorer & Hierarquia' },
        { label: '📁 Criar Novo Grupo...', onClick: () => this.promptCreateGroup(false) },
        {
          label: '📁 Agrupar Selecionados...',
          onClick: () => this.promptCreateGroup(true)
        },
        { separator: true },
        ...this.buildObjectOperationsMenu()
      ]);
    });

    this.fileInputEl.addEventListener('change', async () => {
      const file = this.fileInputEl.files?.[0];
      if (!file) return;
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      try {
        // 1. Native Modix Project JSON
        if (ext === 'modix' || ext === 'json') {
          const text = await file.text();
          const parsed = JSON.parse(text);
          if (parsed && Array.isArray(parsed.objects)) {
            this.engine.state = {
              ...this.engine.createStartupState(),
              ...parsed
            };
            this.engine.rebuildSceneObjects();
            this.engine.notify();
            showToast(`Projeto "${file.name}" aberto!`);
          }
        }
        // 2. Image Texture applied directly onto active 3D object
        else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
          const active = this.engine.getActiveObject();
          if (!active || active.kind !== 'MESH') {
            showToast('Selecione um objeto Mesh primeiro para aplicar textura de imagem');
          } else {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(String(r.result));
              r.onerror = () => reject(new Error('Falha ao ler imagem'));
              r.readAsDataURL(file);
            });
            this.engine.applyTextureDataUrl(active.id, dataUrl, file.name);
            showToast(`Textura "${file.name}" aplicada em ${active.name}!`);
          }
        }
        // 3. Universal 3D Model Import (.obj, .fbx, .glb, .gltf, .dae, .stl, .ply, .3mf, .amf, .svg, .off, .rbxmx)
        else {
          showToast(`Importando ${file.name}...`);
          const importedList = await importAny3DFile(file);
          if (importedList.length === 0) {
            showToast(`Nenhuma malha 3D encontrada em ${file.name}`);
          } else {
            const addedIds: string[] = [];
            for (const item of importedList) {
              const created = this.engine.addImportedMesh(
                item.name,
                item.mesh,
                item.material,
                item.location
              );
              addedIds.push(created.id);
            }
            this.engine.state.selectedIds = addedIds;
            this.engine.state.activeObjectId = addedIds[0];
            this.engine.rebuildSceneObjects();
            this.engine.notify();
            showToast(`Importado: ${importedList.length} objeto(s) de ${file.name}`);
          }
        }
      } catch (err) {
        showToast(`Erro ao importar: ${(err as Error).message}`);
      }
      this.fileInputEl.value = '';
    });
  }

  private bindKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const st = this.engine.state;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.engine.redo();
        else this.engine.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.engine.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        const n = this.engine.copySelected();
        showToast(`${n} objeto(s) copiado(s)`);
        return;
      }
      if (mod && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        const n = this.engine.cutSelected();
        showToast(`${n} objeto(s) recortado(s)`);
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        const p = this.engine.pasteClipboard();
        showToast(p.length ? `${p.length} colado(s)` : 'Área de transferência vazia');
        return;
      }
      if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        const joined = this.engine.joinSelected();
        showToast(joined ? `Unido em "${joined.name}"` : 'Selecione 2+ objetos Mesh');
        return;
      }
      if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        this.promptCreateGroup(true);
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        const active = this.engine.getActiveObject();
        if (active) {
          openTextPromptModal({
            title: 'Renomear Objeto',
            label: 'Novo nome:',
            initialValue: active.name,
            onConfirm: (val) => this.engine.renameObject(active.id, val)
          });
        }
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        st.mode = st.mode === 'EDIT' ? 'OBJECT' : 'EDIT';
        this.engine.rebuildSceneObjects();
        this.engine.notify();
      } else if (e.key === ' ') {
        e.preventDefault();
        st.isPlaying = !st.isPlaying;
        st.playReverse = false;
        this.engine.notify();
      } else if (e.key === 'Delete' || e.key.toLowerCase() === 'x') {
        this.engine.deleteSelected();
      } else if (e.key.toLowerCase() === 'g') {
        st.activeTool = 'move';
        this.engine.rebuildGizmo();
        this.engine.notify();
      } else if (e.key.toLowerCase() === 'r') {
        st.activeTool = 'rotate';
        this.engine.rebuildGizmo();
        this.engine.notify();
      } else if (e.key.toLowerCase() === 's') {
        st.activeTool = 'scale';
        this.engine.rebuildGizmo();
        this.engine.notify();
      } else if (e.key.toLowerCase() === 'e' && st.mode === 'EDIT') {
        this.engine.performEditMeshOp('extrude');
      } else if (e.key.toLowerCase() === 'i' && st.mode === 'EDIT') {
        this.engine.performEditMeshOp('inset');
      }
    });
  }

  private showSplash(): void {
    openSplashModal({
      onNewGeneral: () => this.resetScene(),
      onNewSculpting: () => {
        this.resetScene();
        this.engine.deleteSelected();
        this.engine.addPrimitive('uv_sphere');
        this.switchWorkspace('Sculpting');
      },
      onImportModel: () => this.fileInputEl.click(),
      onExportHub: () => this.openExportHub(),
      onOpenAIAgent: () => this.aiPanel.open('agente')
    });
  }

  private openExportHub(): void {
    const active = this.engine.getActiveObject();
    const anyTex =
      Boolean(active?.material.textureDataUrl) ||
      this.engine.state.objects.some((o) => Boolean(o.material.textureDataUrl));
    openExportHubModal(anyTex, (fmt, opts) => {
      void this.handleExport(fmt, opts);
    });
  }

  private resetScene(): void {
    this.engine.state = this.engine.createStartupState();
    this.engine.rebuildSceneObjects();
    this.engine.notify();
    showToast('Nova cena Modix 3D iniciada');
  }

  private triggerRenderModal(): void {
    const dataUrl = this.engine.captureRenderDataURL(1280, 720);
    openRenderResultModal(dataUrl, () => {
      void saveDataUrlPNG('modix-render.png', dataUrl).then((msg) => showToast(msg));
    });
  }

  private async handleExport(
    fmt: ExportFormatChoice,
    objOptions?: OBJExportOptions
  ): Promise<void> {
    try {
      const objs = this.engine.state.objects;

      if (fmt === 'obj_roblox') {
        const objText = exportSceneToOBJ(objs, {
          yUpForRoblox: true,
          scale: objOptions?.scale ?? 1,
          triangulate: true,
          combineMeshes: objOptions?.combineMeshes ?? false,
          mtlFileName: 'modix-roblox.mtl'
        });
        const msg = await saveOrShareFile('modix-roblox.obj', objText, 'text/plain');
        showToast(`${msg} (Roblox Studio Y-Up + UVs prontos!)`);
      } else if (fmt === 'obj_blender') {
        const objText = exportSceneToOBJ(objs, {
          yUpForRoblox: false,
          scale: 1,
          triangulate: false,
          mtlFileName: 'modix-blender.mtl'
        });
        const msg = await saveOrShareFile('modix-blender.obj', objText, 'text/plain');
        showToast(msg);
      } else if (fmt === 'mtl') {
        const texMap = new Map<string, string>();
        for (const o of objs) {
          if (o.material.textureDataUrl) {
            texMap.set(o.id, o.material.textureName || `${o.name}_tex.png`);
          }
        }
        const mtlText = exportSceneToMTL(objs, texMap);
        const msg = await saveOrShareFile('modix-roblox.mtl', mtlText, 'text/plain');
        showToast(msg);
      } else if (fmt === 'tex_png') {
        const active =
          this.engine.getActiveObject()?.material.textureDataUrl
            ? this.engine.getActiveObject()
            : objs.find((o) => Boolean(o.material.textureDataUrl));
        if (active?.material.textureDataUrl) {
          const msg = await saveDataUrlPNG(
            `${active.name}_RobloxTexture.png`,
            active.material.textureDataUrl
          );
          showToast(msg);
        } else {
          showToast('Nenhuma textura encontrada na cena');
        }
      } else if (fmt === 'rbxmx') {
        const xml = exportSceneToRBXMX(objs);
        const msg = await saveOrShareFile('modix-model.rbxmx', xml, 'application/xml');
        showToast(msg);
      } else if (fmt === 'glb') {
        const group = this.engine.getExportableThreeGroup();
        const glb = await exportThreeGroupToGLB(group);
        const msg = await saveOrShareFile('modix-model.glb', glb, 'model/gltf-binary');
        showToast(msg);
      } else if (fmt === 'gltf') {
        const group = this.engine.getExportableThreeGroup();
        const gltf = await exportThreeGroupToGLTF(group);
        const msg = await saveOrShareFile('modix-model.gltf', gltf, 'model/gltf+json');
        showToast(msg);
      } else if (fmt === 'stl') {
        const stlText = exportSceneToSTL(objs);
        const msg = await saveOrShareFile('modix-model.stl', stlText, 'model/stl');
        showToast(msg);
      } else if (fmt === 'ply') {
        const plyText = exportSceneToPLY(objs);
        const msg = await saveOrShareFile('modix-model.ply', plyText, 'text/plain');
        showToast(msg);
      } else if (fmt === 'dae') {
        const daeXml = exportSceneToDAE(objs);
        const msg = await saveOrShareFile('modix-model.dae', daeXml, 'model/vnd.collada+xml');
        showToast(msg);
      } else if (fmt === 'usdz') {
        const group = this.engine.getExportableThreeGroup();
        const usdz = await exportThreeGroupToUSDZ(group);
        const msg = await saveOrShareFile('modix-model.usdz', usdz, 'model/vnd.usdz+zip');
        showToast(msg);
      } else if (fmt === 'modix') {
        const json = serializeProject(this.engine.state);
        const msg = await saveOrShareFile('scene.modix', json, 'application/json');
        showToast(msg);
      }
    } catch (err) {
      showToast(`Erro na exportação: ${(err as Error).message}`);
    }
  }

  public syncAll(): void {
    const lblScene = this.root.querySelector('#lbl-scene-name');
    if (lblScene) lblScene.textContent = this.engine.state.sceneName;
    this.renderWorkspaceTabs();
    this.renderViewportHeader();
    this.renderLeftToolbar();
    this.renderOutliner();
    this.overlays.sync();
    this.propsPanel.sync();
    this.timelinePanel.sync();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}
