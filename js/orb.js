// La sfera di Jarvis: particelle disposte su una sfera che ruota, respira e reagisce alla voce.
// Disegnata in 2D (leggera per la batteria dell'iPad).
const COLORS = {
  sleep: [90, 140, 170],
  listen: [110, 220, 255],
  think: [255, 190, 90],
  speak: [140, 230, 255],
};

export function createOrb(canvas) {
  const ctx = canvas.getContext("2d");
  const N = 520;
  const pts = [];
  for (let i = 0; i < N; i++) {
    // sfera di Fibonacci: punti distribuiti in modo uniforme
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * Math.PI * (3 - Math.sqrt(5));
    pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, j: Math.random() });
  }
  let mode = "sleep", level = 0, mic = 0, rot = 0, tilt = 0.35, col = [...COLORS.sleep], burst = 0, w = 0, h = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const b = canvas.getBoundingClientRect();
    w = b.width; h = b.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  function frame(t) {
    const target = COLORS[mode] || COLORS.sleep;
    for (let i = 0; i < 3; i++) col[i] += (target[i] - col[i]) * 0.06;
    const speed = mode === "think" ? 0.018 : mode === "sleep" ? 0.0025 : 0.007;
    rot += speed + level * 0.02;
    burst *= 0.94;
    const R = Math.min(w, h) * 0.34 * (1 + level * 0.12 + mic * 0.06 + Math.sin(t / 1400) * 0.015 + burst * 0.04);
    const cx = w / 2, cy = h / 2;
    ctx.clearRect(0, 0, w, h);

    // alone
    const glow = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.6);
    const a = mode === "sleep" ? 0.08 : 0.16 + level * 0.25;
    glow.addColorStop(0, `rgba(${col.map(Math.round)},${a})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // anelli
    ctx.lineWidth = 1;
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${col.map(Math.round)},${0.18 - k * 0.07})`;
      const rr = R * (1.22 + k * 0.16);
      const start = rot * (k ? -0.7 : 1.1);
      ctx.arc(cx, cy, rr, start, start + Math.PI * (1.2 - k * 0.4));
      ctx.stroke();
    }

    // particelle
    const cr = Math.cos(rot), sr = Math.sin(rot), ct = Math.cos(tilt), st = Math.sin(tilt);
    const proj = [];
    for (const p of pts) {
      const wob = 1 + (mode === "speak" || mode === "think" ? Math.sin(t / 180 + p.j * 12) * (0.03 + level * 0.12) : 0);
      let x = p.x * cr - p.z * sr, z = p.x * sr + p.z * cr, y = p.y;
      const y2 = y * ct - z * st; z = y * st + z * ct; y = y2;
      proj.push({ x: cx + x * R * wob, y: cy + y * R * wob, z });
    }
    for (const p of proj) {
      const d = (p.z + 1) / 2; // 0 dietro, 1 davanti
      ctx.fillStyle = `rgba(${col.map(Math.round)},${0.12 + d * 0.8})`;
      const s = 0.6 + d * 1.5;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    // mentre pensa: sinapsi che si accendono tra punti vicini
    if (mode === "think" || burst > 0.1) {
      ctx.strokeStyle = `rgba(${col.map(Math.round)},0.22)`;
      ctx.beginPath();
      for (let i = 0; i < 40; i++) {
        const a1 = proj[(i * 97 + Math.floor(t / 90)) % N], a2 = proj[(i * 97 + 13 + Math.floor(t / 90)) % N];
        if (a1.z > 0 && a2.z > 0) { ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y); }
      }
      ctx.stroke();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setMode: (m) => { mode = m; },
    setLevel: (v) => { level += (v - level) * 0.5; },
    setMic: (v) => { mic = v; },
    burst: () => { burst = 1; },
  };
}
