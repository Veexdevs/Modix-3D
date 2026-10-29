import { Icons } from '../icons/blenderIcons';
import type { ModixEngine } from '../engine/ModixEngine';
import { openDropdownMenu, showToast } from './Modals';
import { openTextureStudioModal } from './TexturePaintModal';

export class ViewportOverlays {
  private engine: ModixEngine;
  private stageEl: HTMLElement;

  private infoEl!: HTMLElement;
  private gizmoCanvas!: HTMLCanvasElement;
  private cameraFrameEl!: HTMLElement;
  private sculptBarEl!: HTMLElement;
  private drawerEl!: HTMLElement;
  private btnCam!: HTMLButtonElement;
  private btnProj!: HTMLButtonElement;
  private lastWorkspace = '';
  private rafGizmo = 0;

  constructor(engine: ModixEngine, stageEl: HTMLElement) {
    this.engine = engine;
    this.stageEl = stageEl;
    this.build();
  }

  private build(): void {
    // 1. Top-Left Info HUD ("User Perspective" / "(1) Collection | Cube")
    this.infoEl = document.createElement('div');
    this.infoEl.className = 'vp-info-overlay';
    this.stageEl.appendChild(this.infoEl);

    // 2. Camera Passepartout Frame
    this.cameraFrameEl = document.createElement('div');
    this.cameraFrameEl.className = 'vp-camera-frame';
    this.cameraFrameEl.style.display = 'none';
    this.stageEl.appendChild(this.cameraFrameEl);

    // 3. Top-Right Gizmo & 4 Circular Buttons
    const rightWrap = document.createElement('div');
    rightWrap.className = 'vp-right-controls';

    const optBtn = document.createElement('button');
    optBtn.type = 'button';
    optBtn.className = 'vp-options-pill';
    optBtn.innerHTML = `<span>Options</span>${Icons.chevronDown}`;
    optBtn.addEventListener('click', () => {
      openDropdownMenu(optBtn, [
        {
          label: 'Show Overlays & Grid',
          icon: this.engine.state.showOverlays ? Icons.check : undefined,
          onClick: () => {
            this.engine.state.showOverlays = !this.engine.state.showOverlays;
            this.engine.rebuildSceneObjects();
            this.engine.notify();
          }
        },
        {
          label: 'Toggle X-Ray',
          icon: this.engine.state.xray ? Icons.check : undefined,
          onClick: () => {
            this.engine.state.xray = !this.engine.state.xray;
            this.engine.rebuildSceneObjects();
            this.engine.notify();
          }
        },
        { separator: true },
        {
          label: 'Reset 3D Cursor to Origin',
          onClick: () => {
            this.engine.state.cursor3D = [0, 0, 0];
            this.engine.rebuildSceneObjects();
            this.engine.notify();
          }
        },
        {
          label: 'Frame Selected',
          onClick: () => this.engine.frameSelected()
        }
      ]);
    });
    rightWrap.appendChild(optBtn);

    // Interactive XYZ Navigation Gizmo Canvas
    this.gizmoCanvas = document.createElement('canvas');
    this.gizmoCanvas.className = 'vp-axis-gizmo-canvas';
    this.gizmoCanvas.width = 156;
    this.gizmoCanvas.height = 156;
    this.bindGizmoEvents();
    rightWrap.appendChild(this.gizmoCanvas);

    // 4 Round Buttons (Zoom, Pan, Camera, Projection)
    const navCol = document.createElement('div');
    navCol.className = 'vp-nav-buttons';

    // Zoom button (drag vertically or tap)
    const btnZoom = document.createElement('button');
    btnZoom.type = 'button';
    btnZoom.className = 'vp-round-btn';
    btnZoom.title = 'Zoom View (drag or tap)';
    btnZoom.innerHTML = Icons.navZoom;
    this.bindDragButton(
      btnZoom,
      (_dx, dy) => this.engine.zoomByFactor(1 + dy * 0.008),
      () => this.engine.zoomByFactor(0.85)
    );
    navCol.appendChild(btnZoom);

    // Pan / Hand button (drag in any direction)
    const btnPan = document.createElement('button');
    btnPan.type = 'button';
    btnPan.className = 'vp-round-btn';
    btnPan.title = 'Move / Pan View (drag)';
    btnPan.innerHTML = Icons.navPan;
    this.bindDragButton(
      btnPan,
      (dx, dy) => this.engine.panByDelta(dx, dy),
      () => {
        this.engine.frameSelected();
        showToast('Centered View');
      }
    );
    navCol.appendChild(btnPan);

    // Toggle Camera View
    this.btnCam = document.createElement('button');
    this.btnCam.type = 'button';
    this.btnCam.className = 'vp-round-btn';
    this.btnCam.title = 'Toggle Camera View';
    this.btnCam.innerHTML = Icons.navCamera;
    this.btnCam.addEventListener('click', () => this.engine.toggleCameraView());
    navCol.appendChild(this.btnCam);

    // Toggle Perspective / Orthographic
    this.btnProj = document.createElement('button');
    this.btnProj.type = 'button';
    this.btnProj.className = 'vp-round-btn';
    this.btnProj.title = 'Toggle Perspective / Orthographic';
    this.btnProj.innerHTML = Icons.navProjection;
    this.btnProj.addEventListener('click', () => this.engine.toggleProjection());
    navCol.appendChild(this.btnProj);

    rightWrap.appendChild(navCol);
    this.stageEl.appendChild(rightWrap);

    // 4. Contextual Sculpt / Paint Brush Bar
    this.sculptBarEl = document.createElement('div');
    this.sculptBarEl.className = 'vp-sculpt-bar';
    this.sculptBarEl.style.display = 'none';
    this.stageEl.appendChild(this.sculptBarEl);

    // 5. Contextual Workspace Drawer (UV / Nodes / Scripting / Compositing)
    this.drawerEl = document.createElement('div');
    this.drawerEl.className = 'vp-workspace-drawer';
    this.drawerEl.style.display = 'none';
    this.stageEl.appendChild(this.drawerEl);

    const drawLoop = () => {
      this.rafGizmo = requestAnimationFrame(drawLoop);
      this.drawGizmo();
    };
    this.rafGizmo = requestAnimationFrame(drawLoop);
    this.sync();
  }

  private bindDragButton(
    btn: HTMLButtonElement,
    onDrag: (dx: number, dy: number) => void,
    onTap: () => void
  ): void {
    let dragging = false;
    let moved = false;
    let lx = 0;
    let ly = 0;
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      btn.setPointerCapture(e.pointerId);
      dragging = true;
      moved = false;
      lx = e.clientX;
      ly = e.clientY;
    });
    btn.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      if (Math.hypot(dx, dy) > 2) moved = true;
      lx = e.clientX;
      ly = e.clientY;
      onDrag(dx, dy);
    });
    const finish = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (!moved) onTap();
      e.stopPropagation();
    };
    btn.addEventListener('pointerup', finish);
    btn.addEventListener('pointercancel', finish);
  }

  private bindGizmoEvents(): void {
    let dragging = false;
    let moved = false;
    let lx = 0;
    let ly = 0;

    this.gizmoCanvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.gizmoCanvas.setPointerCapture(e.pointerId);
      dragging = true;
      moved = false;
      lx = e.clientX;
      ly = e.clientY;
    });

    this.gizmoCanvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      if (Math.hypot(dx, dy) > 3) moved = true;
      lx = e.clientX;
      ly = e.clientY;
      this.engine.orbitByDelta(dx * 1.4, dy * 1.4);
      this.engine.notify();
    });

    const up = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (!moved) {
        const rect = this.gizmoCanvas.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * 156;
        const py = ((e.clientY - rect.top) / rect.height) * 156;
        const cx = 78;
        const cy = 78;
        const arm = 50;
        const axes = this.engine.getGizmoOrientationScreenAxes();
        // Check from frontmost to backmost
        for (let i = axes.length - 1; i >= 0; i--) {
          const ax = axes[i];
          const bx = cx + ax.sx * arm;
          const by = cy + ax.sy * arm;
          if (Math.hypot(px - bx, py - by) <= 18) {
            this.engine.snapViewToAxis(ax.axis);
            break;
          }
        }
      }
      e.stopPropagation();
    };

    this.gizmoCanvas.addEventListener('pointerup', up);
    this.gizmoCanvas.addEventListener('pointercancel', up);
  }

  private drawGizmo(): void {
    const ctx = this.gizmoCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 156, 156);

    const cx = 78;
    const cy = 78;
    const arm = 50;
    const axes = this.engine.getGizmoOrientationScreenAxes();

    // Subtle dark backdrop circle on hover/general visibility
    ctx.beginPath();
    ctx.arc(cx, cy, 66, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.fill();

    for (const item of axes) {
      const ex = cx + item.sx * arm;
      const ey = cy + item.sy * arm;

      if (item.positive) {
        // Stem line from center to positive ball
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 3.2;
        ctx.stroke();

        // Filled colored circle with letter X, Y, Z
        ctx.beginPath();
        ctx.arc(ex, ey, 12.5, 0, Math.PI * 2);
        ctx.fillStyle = item.color;
        ctx.fill();

        ctx.fillStyle = '#0e0e0e';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.axis, ex, ey + 0.5);
      } else {
        // Negative axis outlined circle (exact match to screenshot!)
        ctx.beginPath();
        ctx.arc(ex, ey, 9.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(22, 22, 22, 0.85)';
        ctx.fill();
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = item.color;
        ctx.stroke();
      }
    }
  }

  public sync(): void {
    const st = this.engine.state;
    const active = this.engine.getActiveObject();
    const objTitle = active ? `${active.collection} | ${active.name}` : 'Collection';

    this.infoEl.innerHTML = `
      <div>${st.viewLabel}</div>
      <div>(${st.currentFrame}) ${objTitle}</div>
    `;

    this.cameraFrameEl.style.display = st.inCameraView ? 'block' : 'none';
    this.btnCam.classList.toggle('active', st.inCameraView);
    this.btnProj.classList.toggle('active', st.isOrthographic);

    // Sculpt / Paint floating controls
    if (st.mode === 'SCULPT' || st.mode === 'TEXTURE_PAINT') {
      this.sculptBarEl.style.display = 'flex';
      if (st.mode === 'SCULPT') {
        this.sculptBarEl.innerHTML = `
          <strong style="color:#fff;">Sculpt</strong>
          <label>Radius <input type="range" min="0.15" max="1.6" step="0.05" value="${st.sculpt.radius}" data-sc="radius" /></label>
          <label>Strength <input type="range" min="0.05" max="1.0" step="0.05" value="${st.sculpt.strength}" data-sc="strength" /></label>
          <label><input type="checkbox" ${st.sculpt.symmetryX ? 'checked' : ''} data-sc="symx" /> X-Sym</label>
        `;
        this.sculptBarEl.querySelector('[data-sc="radius"]')?.addEventListener('input', (e) => {
          st.sculpt.radius = parseFloat((e.target as HTMLInputElement).value);
        });
        this.sculptBarEl.querySelector('[data-sc="strength"]')?.addEventListener('input', (e) => {
          st.sculpt.strength = parseFloat((e.target as HTMLInputElement).value);
        });
        this.sculptBarEl.querySelector('[data-sc="symx"]')?.addEventListener('change', (e) => {
          st.sculpt.symmetryX = (e.target as HTMLInputElement).checked;
        });
      } else {
        const ptTarget = st.sculpt.paintTarget ?? 'texture';
        const brushPx = st.sculpt.paintBrushPx ?? 18;
        const opVal = st.sculpt.paintOpacity ?? 1;
        this.sculptBarEl.innerHTML = `
          <strong style="color:#93c5fd;display:inline-flex;align-items:center;gap:4px;">${Icons.brush}<span>Pintura 3D</span></strong>
          <label>Cor <input type="color" value="${st.sculpt.paintColor}" data-pt="color" style="width:24px;height:18px;border:none;background:none;" /></label>
          <label>Pincel <input type="range" min="2" max="64" step="1" value="${brushPx}" data-pt="px" /></label>
          <label>Opac. <input type="range" min="0.05" max="1" step="0.05" value="${opVal}" data-pt="op" /></label>
          <select class="xf-select" data-pt="target" style="width:94px;height:20px;">
            <option value="texture" ${ptTarget === 'texture' ? 'selected' : ''}>Textura UV</option>
            <option value="vertex" ${ptTarget === 'vertex' ? 'selected' : ''}>Vértices</option>
          </select>
          <button type="button" class="modix-btn primary" data-pt="studio" style="height:20px;padding:0 7px;">${Icons.palette}<span>Estúdio 2D</span></button>
        `;
        this.sculptBarEl.querySelector('[data-pt="color"]')?.addEventListener('input', (e) => {
          st.sculpt.paintColor = (e.target as HTMLInputElement).value;
        });
        this.sculptBarEl.querySelector('[data-pt="px"]')?.addEventListener('input', (e) => {
          st.sculpt.paintBrushPx = parseInt((e.target as HTMLInputElement).value, 10);
        });
        this.sculptBarEl.querySelector('[data-pt="op"]')?.addEventListener('input', (e) => {
          st.sculpt.paintOpacity = parseFloat((e.target as HTMLInputElement).value);
        });
        this.sculptBarEl.querySelector('[data-pt="target"]')?.addEventListener('change', (e) => {
          st.sculpt.paintTarget = (e.target as HTMLSelectElement).value as 'texture' | 'vertex';
        });
        this.sculptBarEl.querySelector('[data-pt="studio"]')?.addEventListener('click', () => {
          openTextureStudioModal(this.engine, showToast);
        });
      }
    } else {
      this.sculptBarEl.style.display = 'none';
    }

    // Contextual Workspace Sub-Drawers
    const drawerWorkspaces = ['UV Editing', 'Compositing', 'Geometry Nodes', 'Scripting'];
    if (drawerWorkspaces.includes(st.workspace)) {
      this.drawerEl.style.display = 'flex';
      if (this.lastWorkspace !== st.workspace) {
        this.lastWorkspace = st.workspace;
        this.renderWorkspaceDrawer(st.workspace);
      }
    } else {
      this.drawerEl.style.display = 'none';
      this.lastWorkspace = st.workspace;
    }
  }

  private renderWorkspaceDrawer(ws: string): void {
    const st = this.engine.state;
    const closeBtn = `<button type="button" class="modix-btn" data-close-ws style="height:19px;padding:0 6px;">Layout</button>`;

    if (ws === 'UV Editing') {
      this.drawerEl.innerHTML = `
        <div class="drawer-hdr"><span>UV Editor — Smart Unwrap</span>${closeBtn}</div>
        <div class="drawer-body" style="display:flex;flex-direction:column;gap:8px;">
          <canvas id="uv-grid-preview" width="240" height="240" style="width:100%;aspect-ratio:1/1;background:#151515;border:1px solid #333;border-radius:4px;"></canvas>
          <div style="color:#aaa;">Active Mesh UV Islands projected onto [0..1] UV space.</div>
        </div>
      `;
      const c = this.drawerEl.querySelector<HTMLCanvasElement>('#uv-grid-preview');
      if (c) {
        const ctx = c.getContext('2d')!;
        ctx.strokeStyle = '#2a2a2a';
        for (let i = 0; i <= 8; i++) {
          const p = (i * 240) / 8;
          ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 240); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(240, p); ctx.stroke();
        }
        // Draw unfolded cross UV layout
        ctx.strokeStyle = '#f58b20';
        ctx.fillStyle = 'rgba(245, 139, 32, 0.18)';
        const cells = [[1, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2]];
        for (const [gx, gy] of cells) {
          ctx.fillRect(20 + gx * 50, 35 + gy * 50, 50, 50);
          ctx.strokeRect(20 + gx * 50, 35 + gy * 50, 50, 50);
        }
      }
    } else if (ws === 'Compositing') {
      this.drawerEl.innerHTML = `
        <div class="drawer-hdr"><span>Compositor Nodes</span>${closeBtn}</div>
        <div class="drawer-body" style="display:flex;flex-direction:column;gap:10px;">
          <label style="display:flex;justify-content:space-between;">
            <span>Use Compositor Nodes</span>
            <input type="checkbox" ${st.compositor.useNodes ? 'checked' : ''} data-comp="use" />
          </label>
          <label style="display:flex;justify-content:space-between;">
            <span>Modix Monochrome B&amp;W Filter</span>
            <input type="checkbox" ${st.compositor.monochromeBW ? 'checked' : ''} data-comp="bw" />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span>Contrast (${st.compositor.contrast.toFixed(2)})</span>
            <input type="range" min="0.6" max="1.8" step="0.05" value="${st.compositor.contrast}" data-comp="contrast" />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span>Exposure (${st.compositor.exposure.toFixed(2)})</span>
            <input type="range" min="0.4" max="2.0" step="0.05" value="${st.compositor.exposure}" data-comp="exposure" />
          </label>
        </div>
      `;
      this.drawerEl.querySelector('[data-comp="use"]')?.addEventListener('change', (e) => {
        st.compositor.useNodes = (e.target as HTMLInputElement).checked;
      });
      this.drawerEl.querySelector('[data-comp="bw"]')?.addEventListener('change', (e) => {
        st.compositor.monochromeBW = (e.target as HTMLInputElement).checked;
      });
      this.drawerEl.querySelector('[data-comp="contrast"]')?.addEventListener('input', (e) => {
        st.compositor.contrast = parseFloat((e.target as HTMLInputElement).value);
      });
      this.drawerEl.querySelector('[data-comp="exposure"]')?.addEventListener('input', (e) => {
        st.compositor.exposure = parseFloat((e.target as HTMLInputElement).value);
      });
    } else if (ws === 'Geometry Nodes') {
      this.drawerEl.innerHTML = `
        <div class="drawer-hdr"><span>Geometry Nodes Graph</span>${closeBtn}</div>
        <div class="drawer-body" style="display:flex;flex-direction:column;gap:8px;">
          <div style="background:#141414;border:1px solid #2e2e2e;border-radius:5px;padding:8px;">
            <div style="color:#3bc97c;font-weight:600;margin-bottom:4px;display:flex;align-items:center;gap:4px;"><span>Group Input</span>${Icons.arrowRight}<span>Mesh Pipeline</span>${Icons.arrowRight}<span>Group Output</span></div>
            <div style="color:#aaa;font-size:10.5px;">Add procedural node presets to the active object:</div>
          </div>
          <button type="button" class="modix-btn primary" data-gn="array">Add Linear Array Node (3x)</button>
          <button type="button" class="modix-btn" data-gn="subsurf">Add Subdivide Smooth Node</button>
          <button type="button" class="modix-btn" data-gn="wire">Add Wireframe Lattice Node</button>
          <button type="button" class="modix-btn" data-gn="twist">Add Z-Twist Deform Node</button>
        </div>
      `;
      const addMod = (type: 'ARRAY' | 'SUBSURF' | 'WIREFRAME' | 'TWIST', name: string) => {
        const active = this.engine.getActiveObject();
        if (!active || active.kind !== 'MESH') return;
        this.engine.pushUndoSnapshot();
        active.modifiers.push({
          id: `mod_${Date.now()}`,
          type,
          name,
          enabled: true,
          levels: 1,
          count: 3,
          offset: [2.3, 0, 0],
          thickness: 0.06,
          angleDeg: 55
        });
        st.activePropertiesTab = 'modifiers';
        this.engine.rebuildSceneObjects();
        this.engine.notify();
        showToast(`Added ${name}`);
      };
      this.drawerEl.querySelector('[data-gn="array"]')?.addEventListener('click', () => addMod('ARRAY', 'Array'));
      this.drawerEl.querySelector('[data-gn="subsurf"]')?.addEventListener('click', () => addMod('SUBSURF', 'Subdivision'));
      this.drawerEl.querySelector('[data-gn="wire"]')?.addEventListener('click', () => addMod('WIREFRAME', 'Wireframe'));
      this.drawerEl.querySelector('[data-gn="twist"]')?.addEventListener('click', () => addMod('TWIST', 'Twist'));
    } else if (ws === 'Scripting') {
      this.drawerEl.innerHTML = `
        <div class="drawer-hdr"><span>Modix Scene Scripting</span>${closeBtn}</div>
        <div class="drawer-body" style="display:flex;flex-direction:column;gap:6px;">
          <textarea id="modix-script-box" style="flex:1;min-height:130px;background:#0d0d0d;color:#9ef0b8;border:1px solid #2c2c2c;border-radius:4px;padding:6px;font-family:monospace;font-size:11px;">// Modix 3D Scene API
const torus = modix.add('torus');
torus.location = [0, 0, 2.2];
torus.scale = [0.8, 0.8, 0.8];</textarea>
          <button type="button" class="modix-btn primary" id="run-modix-script">${Icons.play}<span>Run Script</span></button>
        </div>
      `;
      this.drawerEl.querySelector('#run-modix-script')?.addEventListener('click', () => {
        const code = this.drawerEl.querySelector<HTMLTextAreaElement>('#modix-script-box')?.value || '';
        try {
          const api = {
            add: (t: 'cube' | 'uv_sphere' | 'torus' | 'cylinder' | 'cone' | 'monkey') =>
              this.engine.addPrimitive(t),
            objects: this.engine.state.objects
          };
          const fn = new Function('modix', code);
          fn(api);
          this.engine.rebuildSceneObjects();
          this.engine.notify();
          showToast('Script executed');
        } catch (err) {
          showToast(`Script error: ${(err as Error).message}`);
        }
      });
    }

    this.drawerEl.querySelector('[data-close-ws]')?.addEventListener('click', () => {
      st.workspace = 'Layout';
      this.engine.notify();
    });
  }

  public destroy(): void {
    cancelAnimationFrame(this.rafGizmo);
  }
}
