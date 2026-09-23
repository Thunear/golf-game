// Procedurally generated textures drawn on <canvas>. No image downloads needed,
// and the seams tile because every stroke is drawn wrapped around the edges.
import * as THREE from 'three';

function seeded(seed) {
  let s = (Math.imul(seed | 0, 2654435761) >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(canvas, { srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const ch = (v) => Math.max(0, Math.min(255, Math.round(v)));
const rgba = (r, g, b, a = 1) => `rgba(${ch(r)},${ch(g)},${ch(b)},${a})`;

// Runs fn at the four wrapped offsets so shapes crossing an edge continue on the other side.
function wrapped(size, x, y, fn) {
  for (const ox of [0, -size]) for (const oy of [0, -size]) fn(x + ox, y + oy);
}

export function grassTexture({ base = [74, 152, 60], size = 256, seed = 1 } = {}) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rnd = seeded(seed);
  const [r, g, b] = base;
  ctx.fillStyle = rgba(r, g, b);
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 5000; i++) {
    const x = rnd() * size, y = rnd() * size, rad = 1.5 + rnd() * 4, d = (rnd() - 0.5) * 44;
    ctx.fillStyle = rgba(r + d, g + d, b + d * 0.5, 0.35);
    wrapped(size, x, y, (px, py) => {
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3500; i++) {
    const x = rnd() * size, y = rnd() * size, len = 3 + rnd() * 6;
    const a = -Math.PI / 2 + (rnd() - 0.5) * 1.0, d = (rnd() - 0.35) * 60;
    ctx.strokeStyle = rgba(r + d, g + d, b + d * 0.4, 0.55);
    const ex = Math.cos(a) * len, ey = Math.sin(a) * len;
    wrapped(size, x, y, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + ex, py + ey);
      ctx.stroke();
    });
  }
  return toTexture(c);
}

export function woodTexture({ base = [168, 120, 70], size = 256, planks = 4, seed = 7 } = {}) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rnd = seeded(seed);
  const ph = size / planks;

  for (let p = 0; p < planks; p++) {
    const d = (rnd() - 0.5) * 40;
    const r = base[0] + d, g = base[1] + d * 0.8, b = base[2] + d * 0.6;
    ctx.fillStyle = rgba(r, g, b);
    ctx.fillRect(0, p * ph, size, ph);

    // Grain lines
    for (let k = 0; k < 28; k++) {
      const y0 = p * ph + rnd() * ph;
      const dd = -(10 + rnd() * 40);
      ctx.strokeStyle = rgba(r + dd, g + dd, b + dd, 0.3 + rnd() * 0.3);
      ctx.lineWidth = 0.6 + rnd() * 1.2;
      const amp = 1 + rnd() * 3, freq = 0.02 + rnd() * 0.04, ph0 = rnd() * 6;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 4) {
        const y = y0 + Math.sin(x * freq + ph0) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Occasional knot
    if (rnd() < 0.5) {
      const kx = rnd() * size, ky = p * ph + ph * 0.3 + rnd() * ph * 0.4;
      for (let ring = 6; ring > 0; ring--) {
        ctx.strokeStyle = rgba(r - 45, g - 45, b - 45, 0.28);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(kx, ky, ring * 1.7, ring * 1.0, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Plank gap + highlight
    ctx.fillStyle = rgba(r - 70, g - 70, b - 70, 0.9);
    ctx.fillRect(0, p * ph, size, 2);
    ctx.fillStyle = rgba(r + 30, g + 30, b + 30, 0.35);
    ctx.fillRect(0, p * ph + 2, size, 1);
  }

  for (let i = 0; i < 4000; i++) {
    const d = (rnd() - 0.5) * 30;
    ctx.fillStyle = rgba(base[0] + d, base[1] + d, base[2] + d, 0.15);
    ctx.fillRect(rnd() * size, rnd() * size, 2, 1);
  }
  return toTexture(c);
}

export function sandTexture({ base = [222, 200, 146], size = 256, seed = 5 } = {}) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rnd = seeded(seed);
  const [r, g, b] = base;
  ctx.fillStyle = rgba(r, g, b);
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 14000; i++) {
    const d = (rnd() - 0.5) * 36;
    ctx.fillStyle = rgba(r + d, g + d, b + d * 0.8, 0.5);
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = rgba(r - 60, g - 60, b - 50, 0.35);
    ctx.fillRect(rnd() * size, rnd() * size, 1, 1);
  }
  return toTexture(c);
}

// Red rubber with a white band, wrapped around bumper cylinders.
export function bumperTexture({ size = 128, seed = 3 } = {}) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rnd = seeded(seed);
  ctx.fillStyle = '#d63a3a';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(0, size * 0.38, size, size * 0.24);
  for (let i = 0; i < 2500; i++) {
    const d = (rnd() - 0.5) * 30;
    ctx.fillStyle = rgba(128 + d, 128 + d, 128 + d, 0.12);
    ctx.fillRect(rnd() * size, rnd() * size, 2, 2);
  }
  return toTexture(c);
}

// Grayscale noise used as a bump map for grass/sand/wood.
export function noiseTexture({ size = 256, seed = 11 } = {}) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rnd = seeded(seed);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (rnd() - 0.5) * 90;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });
}

// Two-tone checkered putting green. `cells` per texture repeat; keep it even so it tiles.
export function checkerGrassTexture({ a = [96, 186, 72], b = [72, 156, 58], size = 256, cells = 2, seed = 2 } = {}) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rnd = seeded(seed);
  const cell = size / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const col = (i + j) % 2 === 0 ? a : b;
      ctx.fillStyle = rgba(col[0], col[1], col[2]);
      ctx.fillRect(i * cell, j * cell, cell, cell);
    }
  }
  // Subtle mottling and blades that work on both shades.
  for (let i = 0; i < 3500; i++) {
    const x = rnd() * size, y = rnd() * size, rad = 1 + rnd() * 3, d = (rnd() - 0.5) * 30;
    ctx.fillStyle = rgba(84 + d, 170 + d, 64 + d * 0.5, 0.22);
    wrapped(size, x, y, (px, py) => {
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (let i = 0; i < 2200; i++) {
    const x = rnd() * size, y = rnd() * size, len = 2 + rnd() * 5;
    const ang = -Math.PI / 2 + (rnd() - 0.5) * 1.1, d = (rnd() - 0.3) * 50;
    ctx.strokeStyle = rgba(84 + d, 170 + d, 64 + d * 0.4, 0.35);
    const ex = Math.cos(ang) * len, ey = Math.sin(ang) * len;
    wrapped(size, x, y, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + ex, py + ey);
      ctx.stroke();
    });
  }
  return toTexture(c);
}

// Tree bark for log walls: u wraps around the log, v runs along its length.
export function barkTexture({ base = [98, 64, 38], size = 256, seed = 13 } = {}) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rnd = seeded(seed);
  const [r, g, b] = base;
  ctx.fillStyle = rgba(r, g, b);
  ctx.fillRect(0, 0, size, size);
  // Long grain streaks along v (vertical in texture space).
  for (let k = 0; k < 140; k++) {
    const x0 = rnd() * size, d = (rnd() - 0.55) * 60;
    ctx.strokeStyle = rgba(r + d, g + d * 0.9, b + d * 0.7, 0.35 + rnd() * 0.35);
    ctx.lineWidth = 0.8 + rnd() * 2.4;
    const amp = 1 + rnd() * 3, freq = 0.01 + rnd() * 0.03, ph = rnd() * 6;
    for (const ox of [0, -size, size]) {
      ctx.beginPath();
      for (let y = 0; y <= size; y += 4) {
        const x = x0 + ox + Math.sin(y * freq + ph) * amp;
        if (y === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  // Cracks and a couple of knots.
  for (let k = 0; k < 18; k++) {
    const x = rnd() * size, y = rnd() * size, h = 10 + rnd() * 40;
    ctx.fillStyle = rgba(r - 50, g - 40, b - 30, 0.6);
    wrapped(size, x, y, (px, py) => ctx.fillRect(px, py, 1.5, h));
  }
  for (let k = 0; k < 3; k++) {
    const kx = rnd() * size, ky = rnd() * size;
    for (let ring = 5; ring > 0; ring--) {
      ctx.strokeStyle = rgba(r - 40, g - 35, b - 25, 0.3);
      ctx.lineWidth = 1.2;
      wrapped(size, kx, ky, (px, py) => {
        ctx.beginPath();
        ctx.ellipse(px, py, ring * 1.4, ring * 2.2, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
    }
  }
  for (let i = 0; i < 5000; i++) {
    const d = (rnd() - 0.5) * 36;
    ctx.fillStyle = rgba(r + d, g + d, b + d, 0.18);
    ctx.fillRect(rnd() * size, rnd() * size, 1, 2);
  }
  return toTexture(c);
}

// Cut end of a log: pale wood with growth rings and a dark bark rim.
export function logEndTexture({ size = 128, seed = 17 } = {}) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rnd = seeded(seed);
  const cx = size / 2, cy = size / 2;
  ctx.fillStyle = rgba(204, 160, 104);
  ctx.fillRect(0, 0, size, size);
  for (let rr = size / 2; rr > 2; rr -= 3 + rnd() * 3) {
    const d = (rnd() - 0.5) * 40 - 10;
    ctx.strokeStyle = rgba(190 + d, 145 + d, 90 + d, 0.55);
    ctx.lineWidth = 1 + rnd() * 1.5;
    ctx.beginPath();
    ctx.ellipse(cx + (rnd() - 0.5) * 3, cy + (rnd() - 0.5) * 3, rr, rr * (0.94 + rnd() * 0.06), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(96, 62, 38, 1);
  ctx.lineWidth = size * 0.07;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - size * 0.035, 0, Math.PI * 2);
  ctx.stroke();
  return toTexture(c);
}

// The game logo: four rounded squares rotated 45° in a diamond (same layout as logo.svg).
export function drawLogo(ctx, cx, cy, size) {
  const k = size / 332;
  const side = 106.452 * k, half = side / 2, r = 8 * k, arm = 90.3275 * k;
  const centers = [
    [0, -arm, '#F45F63'], // top
    [-arm, 0, '#E5AA20'], // left
    [arm, 0, '#1E98F5'], // right
    [0, arm, '#68707C'], // bottom
  ];
  for (const [dx, dy, color] of centers) {
    ctx.save();
    ctx.translate(cx + dx, cy + dy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-half, -half, side, side, r);
    ctx.fill();
    ctx.restore();
  }
}

// Cream flag: logo on the left, hole number on the right like a real golf flag.
// Aspect matches the flag plane (0.85 x 0.5).
export function flagTexture(number) {
  const c = document.createElement('canvas');
  c.width = 272;
  c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f7f2e6';
  ctx.fillRect(0, 0, 272, 160);
  ctx.fillStyle = '#d8ccb4';
  ctx.fillRect(0, 0, 10, 160); // slightly darker hem at the pole
  ctx.strokeStyle = 'rgba(120,100,70,0.35)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 268, 156);
  if (number == null) {
    drawLogo(ctx, 141, 80, 118);
  } else {
    drawLogo(ctx, 82, 80, 104);
    ctx.fillStyle = '#2b2b2b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 118px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(String(number), 196, 86);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// A tuft of grass blades on a transparent background, for crossed-quad ground cover.
export function grassTuftTexture({ size = 128, seed = 23 } = {}) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rnd = seeded(seed);
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x0 = size * (0.3 + rnd() * 0.4), y0 = size * 0.98;
    const lean = (rnd() - 0.5) * 1.6;
    const h = size * (0.45 + rnd() * 0.5);
    const d = (rnd() - 0.5) * 50;
    ctx.strokeStyle = rgba(70 + d, 150 + d, 55 + d * 0.5, 1);
    ctx.lineWidth = 2.5 + rnd() * 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + lean * h * 0.35, y0 - h * 0.55, x0 + lean * h * 0.9, y0 - h);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Wooden plaque text, one line. Defaults to the tee plaque look; pass bg/fg for the
// coloured quiz answer boards.
export function plaqueTexture(text, { bg = '#c99a5e', fg = '#3a2412', width = 512, height = 128, grain = true, font = 66 } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  if (grain) {
    for (let i = 0; i < height / 3; i++) {
      ctx.fillStyle = `rgba(90,55,25,${0.05 + (i % 3) * 0.03})`;
      ctx.fillRect(0, i * 3.3 + (i % 2), width, 1);
    }
  }
  ctx.strokeStyle = grain ? 'rgba(80,45,20,0.55)' : 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, width - 12, height - 12);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${font}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillText(text, width / 2, height / 2 + 4, width - 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Large wooden question board with word-wrapped text and an optional answer line.
export function questionBoardTexture(question, answerLine = null) {
  const W = 1024, H = 288;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c99a5e';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < H / 3; i++) {
    ctx.fillStyle = `rgba(90,55,25,${0.05 + (i % 3) * 0.03})`;
    ctx.fillRect(0, i * 3.3 + (i % 2), W, 1);
  }
  ctx.strokeStyle = 'rgba(80,45,20,0.55)';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, W - 16, H - 16);
  ctx.fillStyle = '#3a2412';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 54px "Segoe UI", system-ui, sans-serif';
  // Word wrap to at most three lines.
  const words = question.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > W - 90 && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  const lineH = 62;
  const total = lines.length * lineH + (answerLine ? lineH : 0);
  let y = H / 2 - total / 2 + lineH / 2;
  for (const l of lines) {
    ctx.fillText(l, W / 2, y);
    y += lineH;
  }
  if (answerLine) {
    ctx.fillStyle = '#1d6b2e';
    ctx.font = 'bold 50px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(answerLine, W / 2, y);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Canvas text for the wooden hole sign.
export function signTexture(line1, line2) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c99a5e';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = 'rgba(80,45,20,0.5)';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 116);
  ctx.fillStyle = '#3a2412';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 54px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(line1, 128, 48);
  ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(line2, 128, 96);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Name tag drawn above other players' balls.
export function labelTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = Math.min(240, ctx.measureText(text).width + 28);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.roundRect(128 - w / 2, 10, w, 44, 22);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 33, 230);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Transparent canvas with centred text, for labels laid on coloured surfaces.
export function textTexture(text, { fg = '#ffffff', font = 96, width = 1024, height = 256 } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${font}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillText(text, width / 2, height / 2 + font * 0.04, width - 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// A Designsystemet-style Card: white rounded panel with a thin border, heading,
// body text and (optionally) a primary button. Rendered at the given aspect.
export function cardTexture({ title, lines = [], button = null, buttonColor = '#1E98F5', width = 1024, height = 640 } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  const r = 44, pad = 64;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, r);
  ctx.fill();
  ctx.strokeStyle = '#c4c9d0';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(3, 3, width - 6, height - 6, r - 3);
  ctx.stroke();
  // Small logo top right, like a card media slot.
  drawLogo(ctx, width - pad - 44, pad + 40, 88);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#1e2b3c';
  ctx.font = 'bold 92px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(title, pad, pad, width - pad * 2 - 120);
  ctx.fillStyle = '#4b5563';
  ctx.font = '56px "Segoe UI", system-ui, sans-serif';
  let y = pad + 128;
  for (const l of lines) {
    ctx.fillText(l, pad, y, width - pad * 2);
    y += 72;
  }
  if (button) {
    const bw = Math.min(width - pad * 2, ctx.measureText(button).width * 1.1 + 120), bh = 104;
    const by = height - pad - bh;
    ctx.fillStyle = buttonColor;
    ctx.beginPath();
    ctx.roundRect(pad, by, bw, bh, 18);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 50px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(button, pad + bw / 2, by + bh / 2 + 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
