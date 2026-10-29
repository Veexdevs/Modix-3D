import { Icons } from '../icons/blenderIcons';
import type { ModixEngine } from '../engine/ModixEngine';
import { openDropdownMenu, showToast } from './Modals';

export class TimelinePanel {
  private engine: ModixEngine;
  private rootEl: HTMLElement;

  private recordBtn!: HTMLButtonElement;
  private playRevBtn!: HTMLButtonElement;
  private playFwdBtn!: HTMLButtonElement;
  private frameBoxEl!: HTMLElement;
  private startValEl!: HTMLElement;
  private endValEl!: HTMLElement;
  private rulerWrap!: HTMLElement;
  private rulerCanvas!: HTMLCanvasElement;
  private resizeObs: ResizeObserver | null = null;

  constructor(engine: ModixEngine, rootEl: HTMLElement) {
    this.engine = engine;
    this.rootEl = rootEl;
    this.build();
  }

  private build(): void {
    this.rootEl.innerHTML = `
      <div class="tl-header">
        <div class="tl-left">
          <button type="button" class="hdr-pill" style="height:20px;padding:0 5px;">
            ${Icons.editorTimeline}${Icons.chevronDown}
          </button>
          <button type="button" class="hdr-menu-btn" data-tl-menu="playback">Playback ${Icons.chevronDown}</button>
          <button type="button" class="hdr-menu-btn" data-tl-menu="keying">Keying ${Icons.chevronDown}</button>
          <button type="button" class="hdr-menu-btn" data-tl-menu="view">View</button>
          <button type="button" class="hdr-menu-btn" data-tl-menu="marker">Marker</button>
        </div>

        <div class="tl-center">
          <button type="button" class="tl-record-btn" id="tl-rec" title="Auto Keying">
            ${Icons.recordDot}
          </button>
          <div class="tl-transport-group">
            <button type="button" class="tl-tr-btn" data-tr="start" title="Jump to Endpoint">${Icons.jumpStart}</button>
            <button type="button" class="tl-tr-btn" data-tr="prevk" title="Previous Keyframe">${Icons.prevKey}</button>
            <button type="button" class="tl-tr-btn" data-tr="rev" id="tl-rev" title="Play Reverse">${Icons.playRev}</button>
            <button type="button" class="tl-tr-btn" data-tr="fwd" id="tl-fwd" title="Play Animation">${Icons.playFwd}</button>
            <button type="button" class="tl-tr-btn" data-tr="nextk" title="Next Keyframe">${Icons.nextKey}</button>
            <button type="button" class="tl-tr-btn" data-tr="end" title="Jump to End">${Icons.jumpEnd}</button>
          </div>
        </div>

        <div class="tl-right">
          <div class="tl-frame-box" id="tl-cur-frame" title="Current Frame (drag to scrub)">1</div>
          <div class="tl-range-group">
            <button type="button" class="tl-tr-btn" style="width:22px;">${Icons.previewRange}</button>
            <div class="tl-range-item"><span class="lbl">Start</span><span id="tl-start">1</span></div>
            <div class="tl-range-item"><span class="lbl">End</span><span id="tl-end">250</span></div>
          </div>
        </div>
      </div>
      <div class="tl-ruler-wrap" id="tl-ruler-wrap">
        <canvas class="tl-ruler-canvas" id="tl-ruler-canvas"></canvas>
      </div>
    `;

    this.recordBtn = this.rootEl.querySelector('#tl-rec')!;
    this.playRevBtn = this.rootEl.querySelector('#tl-rev')!;
    this.playFwdBtn = this.rootEl.querySelector('#tl-fwd')!;
    this.frameBoxEl = this.rootEl.querySelector('#tl-cur-frame')!;
    this.startValEl = this.rootEl.querySelector('#tl-start')!;
    this.endValEl = this.rootEl.querySelector('#tl-end')!;
    this.rulerWrap = this.rootEl.querySelector('#tl-ruler-wrap')!;
    this.rulerCanvas = this.rootEl.querySelector('#tl-ruler-canvas')!;

    this.recordBtn.addEventListener('click', () => {
      this.engine.state.autoKeying = !this.engine.state.autoKeying;
      showToast(this.engine.state.autoKeying ? 'Auto-Keying Enabled' : 'Auto-Keying Disabled');
      this.engine.notify();
    });

    this.rootEl.querySelector('[data-tr="start"]')?.addEventListener('click', () => {
      this.engine.state.isPlaying = false;
      this.engine.setCurrentFrame(this.engine.state.startFrame);
    });
    this.rootEl.querySelector('[data-tr="end"]')?.addEventListener('click', () => {
      this.engine.state.isPlaying = false;
      this.engine.setCurrentFrame(this.engine.state.endFrame);
    });
    this.rootEl.querySelector('[data-tr="prevk"]')?.addEventListener('click', () => {
      const active = this.engine.getActiveObject();
      if (!active || active.keyframes.length === 0) {
        this.engine.setCurrentFrame(this.engine.state.currentFrame - 10);
        return;
      }
      const prev = [...active.keyframes]
        .reverse()
        .find((k) => k.frame < this.engine.state.currentFrame);
      if (prev) this.engine.setCurrentFrame(prev.frame);
    });
    this.rootEl.querySelector('[data-tr="nextk"]')?.addEventListener('click', () => {
      const active = this.engine.getActiveObject();
      if (!active || active.keyframes.length === 0) {
        this.engine.setCurrentFrame(this.engine.state.currentFrame + 10);
        return;
      }
      const next = active.keyframes.find((k) => k.frame > this.engine.state.currentFrame);
      if (next) this.engine.setCurrentFrame(next.frame);
    });

    this.playFwdBtn.addEventListener('click', () => {
      const st = this.engine.state;
      if (st.isPlaying && !st.playReverse) {
        st.isPlaying = false;
      } else {
        st.isPlaying = true;
        st.playReverse = false;
      }
      this.engine.notify();
    });

    this.playRevBtn.addEventListener('click', () => {
      const st = this.engine.state;
      if (st.isPlaying && st.playReverse) {
        st.isPlaying = false;
      } else {
        st.isPlaying = true;
        st.playReverse = true;
      }
      this.engine.notify();
    });

    // Menus in timeline header
    this.rootEl.querySelector('[data-tl-menu="playback"]')?.addEventListener('click', (e) => {
      openDropdownMenu(e.currentTarget as HTMLElement, [
        { label: '24 fps (Cinema)', onClick: () => { this.engine.state.fps = 24; } },
        { label: '30 fps (Video)', onClick: () => { this.engine.state.fps = 30; } },
        { label: '60 fps (Smooth)', onClick: () => { this.engine.state.fps = 60; } }
      ]);
    });
    this.rootEl.querySelector('[data-tl-menu="keying"]')?.addEventListener('click', (e) => {
      openDropdownMenu(e.currentTarget as HTMLElement, [
        {
          label: 'Insert Loc/Rot/Scale Keyframe',
          shortcut: 'I',
          onClick: () => {
            const active = this.engine.getActiveObject();
            if (!active) return;
            this.engine.toggleKeyframeForProperty(active.id, 'location');
            this.engine.toggleKeyframeForProperty(active.id, 'rotationDeg');
            this.engine.toggleKeyframeForProperty(active.id, 'scale');
            showToast(`Inserted Keyframe at ${this.engine.state.currentFrame}`);
          }
        },
        {
          label: 'Clear Object Keyframes',
          onClick: () => {
            const active = this.engine.getActiveObject();
            if (!active) return;
            active.keyframes = [];
            this.engine.notify();
            showToast('Cleared Keyframes');
          }
        }
      ]);
    });

    // Drag scrub on current frame box
    let boxDragging = false;
    let boxStartX = 0;
    let boxStartF = 1;
    this.frameBoxEl.addEventListener('pointerdown', (e) => {
      this.frameBoxEl.setPointerCapture(e.pointerId);
      boxDragging = true;
      boxStartX = e.clientX;
      boxStartF = this.engine.state.currentFrame;
    });
    this.frameBoxEl.addEventListener('pointermove', (e) => {
      if (!boxDragging) return;
      const df = Math.round((e.clientX - boxStartX) * 0.35);
      this.engine.setCurrentFrame(boxStartF + df);
    });
    this.frameBoxEl.addEventListener('pointerup', () => {
      boxDragging = false;
    });

    // Touch / drag scrub on timeline ruler
    let scrubbing = false;
    const scrubAt = (clientX: number) => {
      const rect = this.rulerWrap.getBoundingClientRect();
      const padL = 12;
      const padR = 16;
      const t = Math.max(0, Math.min(1, (clientX - rect.left - padL) / Math.max(1, rect.width - padL - padR)));
      const st = this.engine.state;
      const frame = Math.round(st.startFrame + t * (st.endFrame - st.startFrame));
      this.engine.setCurrentFrame(frame);
    };

    this.rulerWrap.addEventListener('pointerdown', (e) => {
      this.rulerWrap.setPointerCapture(e.pointerId);
      scrubbing = true;
      this.engine.state.isPlaying = false;
      scrubAt(e.clientX);
    });
    this.rulerWrap.addEventListener('pointermove', (e) => {
      if (!scrubbing) return;
      scrubAt(e.clientX);
    });
    this.rulerWrap.addEventListener('pointerup', () => {
      scrubbing = false;
    });

    this.resizeObs = new ResizeObserver(() => this.drawRuler());
    this.resizeObs.observe(this.rulerWrap);
    this.sync();
  }

  public sync(): void {
    const st = this.engine.state;
    this.recordBtn.classList.toggle('active', st.autoKeying);
    this.playFwdBtn.classList.toggle('active', st.isPlaying && !st.playReverse);
    this.playRevBtn.classList.toggle('active', st.isPlaying && st.playReverse);
    this.playFwdBtn.innerHTML =
      st.isPlaying && !st.playReverse ? Icons.pause : Icons.playFwd;
    this.frameBoxEl.textContent = String(st.currentFrame);
    this.startValEl.textContent = String(st.startFrame);
    this.endValEl.textContent = String(st.endFrame);
    this.drawRuler();
  }

  private drawRuler(): void {
    const rect = this.rulerWrap.getBoundingClientRect();
    const w = Math.max(100, rect.width);
    const h = Math.max(24, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.rulerCanvas.width = Math.round(w * dpr);
    this.rulerCanvas.height = Math.round(h * dpr);
    const ctx = this.rulerCanvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Top ruler dark band (#111111) + bottom track (#1b1b1b)
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, w, h * 0.56);
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(0, h * 0.56, w, h * 0.44);

    const st = this.engine.state;
    const padL = 12;
    const padR = 16;
    const spanW = Math.max(20, w - padL - padR);
    const frameToX = (f: number) =>
      padL + ((f - st.startFrame) / Math.max(1, st.endFrame - st.startFrame)) * spanW;

    // Step density adaptive to screen width so labels never overlap on compact phones
    const step = w < 620 ? 20 : 10;
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let f = 0; f <= st.endFrame; f += 5) {
      if (f < st.startFrame) continue;
      const x = frameToX(f);
      const isMajor = f % step === 0;
      ctx.strokeStyle = isMajor ? '#282828' : '#1f1f1f';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, isMajor ? 2 : h * 0.42);
      ctx.lineTo(x, h);
      ctx.stroke();

      if (isMajor && f >= 10) {
        ctx.fillStyle = '#9a9a9a';
        ctx.fillText(String(f), x, h * 0.3);
      }
    }

    // Draw active object keyframe diamonds ◆
    const active = this.engine.getActiveObject();
    if (active) {
      for (const kf of active.keyframes) {
        const kx = frameToX(kf.frame);
        const ky = h * 0.78;
        ctx.fillStyle = '#f2b233';
        ctx.beginPath();
        ctx.moveTo(kx, ky - 4.5);
        ctx.lineTo(kx + 4.5, ky);
        ctx.lineTo(kx, ky + 4.5);
        ctx.lineTo(kx - 4.5, ky);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Draw Blue Current Frame Playhead Badge (#0966dd) + Vertical Line (identical to screenshot!)
    const curX = frameToX(st.currentFrame);
    ctx.strokeStyle = '#0966dd';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(curX, 0);
    ctx.lineTo(curX, h);
    ctx.stroke();

    const label = String(st.currentFrame);
    const pillW = Math.max(18, label.length * 7 + 10);
    const pillX = Math.max(2, Math.min(w - pillW - 2, curX - pillW * 0.5));
    ctx.fillStyle = '#0966dd';
    ctx.beginPath();
    ctx.roundRect(pillX, 1.5, pillW, 15, 2.5);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(label, pillX + pillW * 0.5, 9.5);
  }

  public destroy(): void {
    this.resizeObs?.disconnect();
  }
}
