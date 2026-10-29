export type ProceduralTexturePreset =
  | 'studs'
  | 'checker'
  | 'brick'
  | 'wood'
  | 'metal'
  | 'carbon'
  | 'scifi'
  | 'grass'
  | 'stone'
  | 'lava'
  | 'marble'
  | 'stripes'
  | 'gradient'
  | 'noise';

export interface ProceduralTextureOptions {
  preset: ProceduralTexturePreset;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  scale?: number;
  size?: number;
}

export function generateProceduralTextureDataUrl(opts: ProceduralTextureOptions): string {
  const size = opts.size ?? 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const c1 = opts.primaryColor || defaultColors(opts.preset)[0];
  const c2 = opts.secondaryColor || defaultColors(opts.preset)[1];
  const c3 = opts.accentColor || defaultColors(opts.preset)[2];
  const sc = Math.max(1, opts.scale ?? 1);

  ctx.fillStyle = c1;
  ctx.fillRect(0, 0, size, size);

  switch (opts.preset) {
    case 'studs': {
      // Raised tactile grid tile pattern
      const cells = Math.round(4 * sc);
      const cellSz = size / cells;
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 2;
      for (let y = 0; y < cells; y++) {
        for (let x = 0; x < cells; x++) {
          const px = x * cellSz;
          const py = y * cellSz;
          ctx.strokeRect(px, py, cellSz, cellSz);

          const cx = px + cellSz * 0.5;
          const cy = py + cellSz * 0.5;
          const r = cellSz * 0.28;

          // Drop shadow
          ctx.beginPath();
          ctx.arc(cx + 2, cy + 3, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0,0,0,0.28)';
          ctx.fill();

          // Raised stud rim
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = c2;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(255,255,255,0.28)';
          ctx.stroke();

          // Inner highlight
          ctx.beginPath();
          ctx.arc(cx - r * 0.2, cy - r * 0.2, r * 0.45, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.16)';
          ctx.fill();
        }
      }
      break;
    }

    case 'checker': {
      const cells = Math.round(8 * sc);
      const cell = size / cells;
      for (let y = 0; y < cells; y++) {
        for (let x = 0; x < cells; x++) {
          ctx.fillStyle = (x + y) % 2 === 0 ? c1 : c2;
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
      ctx.strokeStyle = c3;
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, size - 4, size - 4);
      break;
    }

    case 'brick': {
      ctx.fillStyle = c2; // mortar
      ctx.fillRect(0, 0, size, size);
      const rows = Math.round(8 * sc);
      const cols = Math.round(4 * sc);
      const bh = size / rows;
      const bw = size / cols;
      const gap = Math.max(3, size * 0.012);
      for (let r = 0; r < rows; r++) {
        const offset = r % 2 === 1 ? bw * 0.5 : 0;
        for (let c = -1; c <= cols; c++) {
          const x = c * bw + offset + gap * 0.5;
          const y = r * bh + gap * 0.5;
          ctx.fillStyle = (r + c) % 3 === 0 ? c3 : c1;
          ctx.fillRect(x, y, bw - gap, bh - gap);
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(x, y, bw - gap, 3);
        }
      }
      break;
    }

    case 'wood': {
      const planks = Math.round(5 * sc);
      const pw = size / planks;
      for (let p = 0; p < planks; p++) {
        ctx.fillStyle = p % 2 === 0 ? c1 : c2;
        ctx.fillRect(p * pw, 0, pw, size);
        // Grain lines
        ctx.strokeStyle = c3;
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = 2;
        for (let g = 0; g < 14; g++) {
          ctx.beginPath();
          const gx = p * pw + ((g + 0.5) * pw) / 14;
          ctx.moveTo(gx, 0);
          for (let y = 0; y <= size; y += 32) {
            ctx.lineTo(gx + Math.sin(y * 0.03 + g + p) * 5, y);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(p * pw, 0, 2.5, size);
      }
      break;
    }

    case 'metal': {
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, c1);
      grad.addColorStop(0.5, c2);
      grad.addColorStop(1, c1);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);

      // Brushed horizontal streaks
      for (let i = 0; i < 400; i++) {
        const y = (i * 73) % size;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
        ctx.fillRect(0, y, size, 1.5);
      }
      // Panel seam & rivets
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 4;
      ctx.strokeRect(10, 10, size - 20, size - 20);
      ctx.fillStyle = c3;
      for (const [rx, ry] of [[26, 26], [size - 26, 26], [26, size - 26], [size - 26, size - 26]]) {
        ctx.beginPath();
        ctx.arc(rx, ry, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'carbon': {
      const step = Math.max(8, Math.round(16 / sc));
      for (let y = 0; y < size; y += step) {
        for (let x = 0; x < size; x += step) {
          const alt = ((x + y) / step) % 2 === 0;
          ctx.fillStyle = alt ? c1 : c2;
          ctx.fillRect(x, y, step, step);
          ctx.fillStyle = 'rgba(255,255,255,0.09)';
          ctx.fillRect(x + 1, y + 1, step * 0.6, step * 0.35);
        }
      }
      break;
    }

    case 'scifi': {
      ctx.fillStyle = c1;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = c2;
      ctx.lineWidth = 5;
      ctx.strokeRect(16, 16, size - 32, size - 32);
      ctx.strokeRect(48, 48, size - 96, size * 0.42);
      ctx.fillStyle = c2;
      ctx.fillRect(48, size * 0.58, size - 96, size * 0.28);

      // Glowing neon energy lines
      ctx.strokeStyle = c3;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(32, size * 0.52);
      ctx.lineTo(size - 32, size * 0.52);
      ctx.stroke();

      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = c3;
        ctx.fillRect(68 + i * 62, size * 0.66, 36, 14);
      }
      break;
    }

    case 'grass': {
      ctx.fillStyle = c1;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 1200; i++) {
        const x = (i * 137.5) % size;
        const y = (i * 293.3) % size;
        ctx.strokeStyle = i % 3 === 0 ? c2 : c3;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.sin(i) * 5, y - 10);
        ctx.stroke();
      }
      break;
    }

    case 'stone': {
      ctx.fillStyle = c2;
      ctx.fillRect(0, 0, size, size);
      const n = Math.round(6 * sc);
      const cell = size / n;
      for (let gy = 0; gy < n; gy++) {
        for (let gx = 0; gx < n; gx++) {
          const jx = Math.sin(gx * 12.9 + gy * 78.2) * cell * 0.14;
          const jy = Math.cos(gx * 45.1 + gy * 19.7) * cell * 0.14;
          ctx.fillStyle = (gx + gy) % 2 === 0 ? c1 : c3;
          ctx.beginPath();
          ctx.roundRect(gx * cell + 4 + jx * 0.3, gy * cell + 4 + jy * 0.3, cell - 8, cell - 8, 12);
          ctx.fill();
        }
      }
      break;
    }

    case 'lava': {
      ctx.fillStyle = c1; // dark crust
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = c2;
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      for (let k = 0; k < 14; k++) {
        ctx.beginPath();
        let x = ((k * 97) % size);
        let y = 0;
        ctx.moveTo(x, y);
        while (y < size) {
          y += 42;
          x += Math.sin(y * 0.05 + k * 2.1) * 38;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = c3;
      ctx.lineWidth = 3.5;
      for (let k = 0; k < 14; k++) {
        ctx.beginPath();
        let x = ((k * 97) % size);
        let y = 0;
        ctx.moveTo(x, y);
        while (y < size) {
          y += 42;
          x += Math.sin(y * 0.05 + k * 2.1) * 38;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }

    case 'marble': {
      ctx.fillStyle = c1;
      ctx.fillRect(0, 0, size, size);
      for (let v = 0; v < 18; v++) {
        ctx.strokeStyle = v % 2 === 0 ? c2 : c3;
        ctx.globalAlpha = 0.32;
        ctx.lineWidth = (v % 4) + 1.5;
        ctx.beginPath();
        let y = (v * 41) % size;
        ctx.moveTo(0, y);
        for (let x = 0; x <= size; x += 24) {
          y += Math.sin(x * 0.025 + v) * 9;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }

    case 'stripes': {
      const count = Math.round(8 * sc);
      const w = size / count;
      for (let i = -count; i < count * 2; i++) {
        ctx.fillStyle = i % 2 === 0 ? c1 : c2;
        ctx.beginPath();
        ctx.moveTo(i * w, 0);
        ctx.lineTo(i * w + w, 0);
        ctx.lineTo(i * w + w - size * 0.5, size);
        ctx.lineTo(i * w - size * 0.5, size);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }

    case 'gradient': {
      const g = ctx.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, c1);
      g.addColorStop(0.5, c2);
      g.addColorStop(1, c3);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      break;
    }

    case 'noise': {
      const cell = 8;
      for (let y = 0; y < size; y += cell) {
        for (let x = 0; x < size; x += cell) {
          const r = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
          ctx.fillStyle = r < 0.45 ? c1 : r < 0.8 ? c2 : c3;
          ctx.fillRect(x, y, cell, cell);
        }
      }
      break;
    }
  }

  return canvas.toDataURL('image/png');
}

function defaultColors(preset: ProceduralTexturePreset): [string, string, string] {
  switch (preset) {
    case 'studs': return ['#3b82f6', '#2563eb', '#93c5fd'];
    case 'checker': return ['#e5e5e5', '#2a2a2a', '#2664bb'];
    case 'brick': return ['#9b3b2e', '#beb7ad', '#7f2d22'];
    case 'wood': return ['#8b5a2b', '#764920', '#4a2c11'];
    case 'metal': return ['#7b828a', '#b6bec7', '#393e44'];
    case 'carbon': return ['#19191b', '#2b2c30', '#555555'];
    case 'scifi': return ['#1a212b', '#2d394a', '#00e5ff'];
    case 'grass': return ['#3d7a32', '#529940', '#2d5c24'];
    case 'stone': return ['#6e7175', '#3d3f42', '#82868b'];
    case 'lava': return ['#1f1b1a', '#ff4500', '#ffd000'];
    case 'marble': return ['#ececec', '#9ca3af', '#6b7280'];
    case 'stripes': return ['#f59e0b', '#18181b', '#ffffff'];
    case 'gradient': return ['#0ea5e9', '#6366f1', '#ec4899'];
    case 'noise': return ['#4b5563', '#6b7280', '#9ca3af'];
  }
}

/** Rasterizes an SVG string (e.g. generated by Texture Artist AI) into a 512x512 PNG DataURL */
export async function renderSVGToTextureDataUrl(
  rawSvg: string,
  size = 512
): Promise<string> {
  let svg = rawSvg.trim();
  const svgStart = svg.indexOf('<svg');
  const svgEnd = svg.lastIndexOf('</svg>');
  if (svgStart !== -1 && svgEnd !== -1) {
    svg = svg.slice(svgStart, svgEnd + 6);
  }
  if (!svg.includes('xmlns=')) {
    svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!svg.includes('viewBox=')) {
    svg = svg.replace('<svg', `<svg viewBox="0 0 ${size} ${size}"`);
  }

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#222222';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(generateProceduralTextureDataUrl({ preset: 'scifi', size }));
    };

    img.src = url;
  });
}
