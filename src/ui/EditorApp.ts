import { Icons } from '../icons/blenderIcons';
import {
  exportSceneToOBJ,
  exportSceneToSTL,
  exportThreeGroupToGLB,
  parseOBJToMesh,
  parseSTLToMesh,
  saveDataUrlPNG,
  saveOrShareFile,
  serializeProject
} from '../engine/Exporters';
import { ModixEngine } from '../engine/ModixEngine';
import type {
  ActiveToolId,
  InteractionMode,
  TransformOrientation,
  ViewportShading,
  WorkspaceId
} from '../types/scene';
import {
  openDropdownMenu,
  openRenderResultModal,
  openSplashModal,
  showToast
} from './Modals';
import { PropertiesPanel } from './PropertiesPanel';
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
  private outlinerTreeEl!: HTMLElement;
  private fileInputEl!: HTMLInputElement;

  private overlays!: ViewportOverlays;
  private propsPanel!: PropertiesPanel;
  private timelinePanel!: TimelinePanel;

  constructor(root: HTMLElement) {
    this.root = root;
    this.engine = new ModixEngine();
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

          <!-- RIGHT SIDEBAR (Outliner + Properties) -->
          <aside class="modix-right-col">
            <section class="modix-outliner">
              <div class="panel-subhdr">
                <button type="button" class="hdr-pill" style="padding:0 5px;height:20px;">
                  ${Icons.editorOutliner}${Icons.chevronDown}
                </button>
                <button type="button" class="hdr-pill" style="padding:0 5px;height:20px;">
                  ${Icons.viewLayer}${Icons.chevronDown}
                </button>
                <div class="search-pill">
                  ${Icons.searchGlass}
                  <input type="text" id="outliner-search" aria-label="Search Outliner" />
                </div>
                <button type="button" class="hdr-menu-btn" id="outliner-filter-btn" style="padding:0 4px;">
                  ${Icons.filterFunnel}
                </button>
              </div>
              <div class="outliner-tree" id="outliner-tree"></div>
            </section>

            <section class="modix-properties" id="modix-properties"></section>
          </aside>
        </div>

        <input type="file" id="modix-file-input" accept=".obj,.stl,.modix,.json" style="display:none;" />
      </div>
    `;

    this.wsBarEl = this.root.querySelector('#modix-ws-tabs')!;
    this.vpHeaderEl = this.root.querySelector('#modix-vp-header')!;
    this.vpStageEl = this.root.querySelector('#modix-vp-stage')!;
    this.leftToolbarEl = this.root.querySelector('#vp-left-toolbar')!;
    this.outlinerTreeEl = this.root.querySelector('#outliner-tree')!;
    this.fileInputEl = this.root.querySelector('#modix-file-input')!;

    // Mount Three.js 3D Engine inside Viewport Stage
    this.engine.mount(this.vpStageEl);

    // Mount Sub-Panels
    this.overlays = new ViewportOverlays(this.engine, this.vpStageEl);
    this.propsPanel = new PropertiesPanel(
      this.engine,
      this.root.querySelector('#modix-properties')!,
      {
        onRenderRequest: () => this.triggerRenderModal(),
        onExportRequest: (fmt) => void this.handleExport(fmt)
      }
    );
    this.timelinePanel = new TimelinePanel(
      this.engine,
      this.root.querySelector('#modix-timeline')!
    );

    this.bindTopBarEvents();
    this.bindOutlinerSearchAndImport();
    this.bindKeyboardShortcuts();

    this.engine.subscribe(() => this.syncAll());
    this.syncAll();
  }

  private bindTopBarEvents(): void {
    const brandBtn = this.root.querySelector<HTMLElement>('#modix-app-menu-btn')!;
    brandBtn.addEventListener('click', () => {
      openDropdownMenu(brandBtn, [
        {
          label: 'Splash Screen / About Modix 3D',
          onClick: () => this.showSplash()
        },
        { separator: true },
        { sectionTitle: 'File & Project' },
        {
          label: 'New Startup Scene',
          shortcut: 'Ctrl+N',
          onClick: () => this.resetScene()
        },
        {
          label: 'Import 3D File (.OBJ / .STL / .MODIX)...',
          onClick: () => this.fileInputEl.click()
        },
        {
          label: 'Save Project (.MODIX)',
          shortcut: 'Ctrl+S',
          onClick: () => void this.handleExport('modix')
        },
        { separator: true },
        { sectionTitle: 'Export 3D Mesh' },
        {
          label: 'Export Wavefront (.OBJ)',
          onClick: () => void this.handleExport('obj')
        },
        {
          label: 'Export 3D Print (.STL)',
          onClick: () => void this.handleExport('stl')
        },
        {
          label: 'Export glTF Binary (.GLB)',
          onClick: () => void this.handleExport('glb')
        },
        { separator: true },
        {
          label: 'Render Image (PNG)',
          shortcut: 'F12',
          onClick: () => this.triggerRenderModal()
        },
        { separator: true },
        {
          label: 'Undo',
          shortcut: 'Ctrl+Z',
          onClick: () => {
            if (this.engine.undo()) showToast('Undo');
          }
        },
        {
          label: 'Redo',
          shortcut: 'Ctrl+Y',
          onClick: () => {
            if (this.engine.redo()) showToast('Redo');
          }
        }
      ]);
    });

    this.root.querySelector('#btn-scene-pill')?.addEventListener('click', (e) => {
      openDropdownMenu(e.currentTarget as HTMLElement, [
        { label: 'Scene (Default)', onClick: () => { this.engine.state.sceneName = 'Scene'; this.engine.notify(); } },
        { label: 'Reset Factory Startup', onClick: () => this.resetScene() }
      ]);
    });

    this.root.querySelector('#btn-viewlayer-pill')?.addEventListener('click', (e) => {
      openDropdownMenu(e.currentTarget as HTMLElement, [
        { label: 'ViewLayer (Main)', onClick: () => {} },
        {
          label: 'Render ViewLayer PNG',
          onClick: () => this.triggerRenderModal()
        }
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
        break;
      case 'Texture Paint':
        st.mode = 'TEXTURE_PAINT';
        st.shading = 'SOLID';
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

    // Bind Mode Selector
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
        { label: 'Texture Paint', onClick: () => setMode('TEXTURE_PAINT') }
      ]);
    });

    // Edit Select Mode (Vertex / Edge / Face)
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
          label: 'All',
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
          label: 'None',
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
          label: 'Invert',
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

    // Add Menu
    this.vpHeaderEl.querySelector('#menu-add')?.addEventListener('click', (e) => {
      openDropdownMenu(e.currentTarget as HTMLElement, [
        { sectionTitle: 'Mesh Primitives' },
        { label: 'Cube', onClick: () => this.engine.addPrimitive('cube') },
        { label: 'Plane', onClick: () => this.engine.addPrimitive('plane') },
        { label: 'UV Sphere', onClick: () => this.engine.addPrimitive('uv_sphere') },
        { label: 'Ico Sphere', onClick: () => this.engine.addPrimitive('ico_sphere') },
        { label: 'Cylinder', onClick: () => this.engine.addPrimitive('cylinder') },
        { label: 'Cone', onClick: () => this.engine.addPrimitive('cone') },
        { label: 'Torus', onClick: () => this.engine.addPrimitive('torus') },
        { label: 'Capsule', onClick: () => this.engine.addPrimitive('capsule') },
        { label: 'Suzanne (Monkey)', onClick: () => this.engine.addPrimitive('monkey') },
        { separator: true },
        { sectionTitle: 'Scene Objects' },
        { label: 'Light (Point)', onClick: () => this.engine.addSceneNonMesh('LIGHT') },
        { label: 'Camera', onClick: () => this.engine.addSceneNonMesh('CAMERA') },
        { label: 'Empty (Axes)', onClick: () => this.engine.addSceneNonMesh('EMPTY') }
      ]);
    });

    // Object / Mesh Menu
    this.vpHeaderEl.querySelector('#menu-object')?.addEventListener('click', (e) => {
      if (st.mode === 'EDIT') {
        openDropdownMenu(e.currentTarget as HTMLElement, [
          { sectionTitle: 'Mesh Modeling' },
          { label: 'Extrude Faces', shortcut: 'E', onClick: () => this.engine.performEditMeshOp('extrude') },
          { label: 'Inset Faces', shortcut: 'I', onClick: () => this.engine.performEditMeshOp('inset') },
          { label: 'Bevel Faces', shortcut: 'Ctrl+B', onClick: () => this.engine.performEditMeshOp('bevel') },
          { label: 'Subdivide Quads', onClick: () => this.engine.performEditMeshOp('subdivide') },
          { label: 'Catmull-Clark Smooth', onClick: () => this.engine.performEditMeshOp('subsurf') },
          { label: 'Loop Cut (Mid Z)', shortcut: 'Ctrl+R', onClick: () => this.engine.performEditMeshOp('loop_cut') },
          { separator: true },
          { label: 'Delete Selected Faces', shortcut: 'X', onClick: () => this.engine.performEditMeshOp('delete_faces') }
        ]);
      } else {
        openDropdownMenu(e.currentTarget as HTMLElement, [
          { label: 'Duplicate Objects', shortcut: 'Shift+D', onClick: () => this.engine.duplicateSelected() },
          { label: 'Delete', shortcut: 'X', onClick: () => this.engine.deleteSelected() },
          { separator: true },
          { label: 'Shade Smooth', onClick: () => this.engine.performEditMeshOp('shade_smooth') },
          { label: 'Shade Flat', onClick: () => this.engine.performEditMeshOp('shade_flat') },
          { separator: true },
          {
            label: 'Snap Object to Origin',
            onClick: () => {
              const active = this.engine.getActiveObject();
              if (active) {
                this.engine.pushUndoSnapshot();
                active.location = [0, 0, 0];
                this.engine.syncObjectTransformsOnly();
                this.engine.rebuildGizmo();
                this.engine.notify();
              }
            }
          }
        ]);
      }
    });

    // Orientation, Pivot, Snap, Proportional, Overlays, X-Ray, Shading
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
      </div>
      <div class="outliner-row indent-1">
        <div class="outliner-row-left">
          ${Icons.chevronDown}
          ${Icons.collectionBox}
          <span class="obj-label">Collection</span>
        </div>
        <div class="outliner-row-right">
          ${Icons.checkboxChecked}
          ${Icons.eyeOpen}
          ${Icons.renderCamSmall}
        </div>
      </div>
    `;

    for (const obj of st.objects) {
      if (q && !obj.name.toLowerCase().includes(q)) continue;
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
          <span class="obj-label">${obj.name}</span>
          ${dataBadge}
        </div>
        <div class="outliner-row-right">
          <button type="button" class="outliner-eye-btn ${obj.visible ? '' : 'dimmed'}" title="Hide in Viewport">
            ${obj.visible ? Icons.eyeOpen : Icons.eyeClosed}
          </button>
          ${Icons.renderCamSmall}
        </div>
      `;

      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.outliner-eye-btn')) return;
        this.engine.selectObject(obj.id, e.shiftKey);
      });

      row.querySelector('.outliner-eye-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        obj.visible = !obj.visible;
        this.engine.rebuildSceneObjects();
        this.engine.notify();
      });

      this.outlinerTreeEl.appendChild(row);
    }
  }

  private bindOutlinerSearchAndImport(): void {
    const outSearch = this.root.querySelector<HTMLInputElement>('#outliner-search');
    outSearch?.addEventListener('input', () => {
      this.engine.state.outlinerSearch = outSearch.value;
      this.renderOutliner();
    });

    this.fileInputEl.addEventListener('change', async () => {
      const file = this.fileInputEl.files?.[0];
      if (!file) return;
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      try {
        if (ext === 'obj') {
          const text = await file.text();
          const mesh = parseOBJToMesh(text);
          if (mesh.vertices.length > 0) {
            this.engine.addImportedMesh(file.name.replace(/\.obj$/i, ''), mesh);
            showToast(`Imported ${file.name}`);
          }
        } else if (ext === 'stl') {
          const buf = await file.arrayBuffer();
          const mesh = parseSTLToMesh(buf);
          if (mesh.vertices.length > 0) {
            this.engine.addImportedMesh(file.name.replace(/\.stl$/i, ''), mesh);
            showToast(`Imported ${file.name}`);
          }
        } else if (ext === 'modix' || ext === 'json') {
          const text = await file.text();
          const parsed = JSON.parse(text);
          if (parsed && Array.isArray(parsed.objects)) {
            this.engine.state = parsed;
            this.engine.rebuildSceneObjects();
            this.engine.notify();
            showToast(`Opened ${file.name}`);
          }
        }
      } catch (err) {
        showToast(`Import failed: ${(err as Error).message}`);
      }
      this.fileInputEl.value = '';
    });
  }

  private bindKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const st = this.engine.state;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.engine.redo();
        else this.engine.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.engine.redo();
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
      onExportOBJ: () => void this.handleExport('obj')
    });
  }

  private resetScene(): void {
    this.engine.state = this.engine.createStartupState();
    this.engine.rebuildSceneObjects();
    this.engine.notify();
    showToast('New Modix 3D Scene');
  }

  private triggerRenderModal(): void {
    const dataUrl = this.engine.captureRenderDataURL(1280, 720);
    openRenderResultModal(dataUrl, () => {
      void saveDataUrlPNG('modix-render.png', dataUrl).then((msg) => showToast(msg));
    });
  }

  private async handleExport(fmt: 'obj' | 'stl' | 'glb' | 'modix'): Promise<void> {
    try {
      if (fmt === 'obj') {
        const objText = exportSceneToOBJ(this.engine.state.objects);
        const msg = await saveOrShareFile('modix-model.obj', objText, 'text/plain');
        showToast(msg);
      } else if (fmt === 'stl') {
        const stlText = exportSceneToSTL(this.engine.state.objects);
        const msg = await saveOrShareFile('modix-model.stl', stlText, 'model/stl');
        showToast(msg);
      } else if (fmt === 'glb') {
        const group = this.engine.getExportableThreeGroup();
        const glb = await exportThreeGroupToGLB(group);
        const msg = await saveOrShareFile('modix-model.glb', glb, 'model/gltf-binary');
        showToast(msg);
      } else if (fmt === 'modix') {
        const json = serializeProject(this.engine.state);
        const msg = await saveOrShareFile('scene.modix', json, 'application/json');
        showToast(msg);
      }
    } catch (err) {
      showToast(`Export error: ${(err as Error).message}`);
    }
  }

  public syncAll(): void {
    this.renderWorkspaceTabs();
    this.renderViewportHeader();
    this.renderLeftToolbar();
    this.renderOutliner();
    this.overlays.sync();
    this.propsPanel.sync();
    this.timelinePanel.sync();
  }
}
