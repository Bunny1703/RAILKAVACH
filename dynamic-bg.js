(() => {
  const canvas = document.createElement('canvas');
  canvas.id = 'dynamic-bg';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  let w = 0, h = 0, dpr = 1, nodes = [], raf = 0;
  const pointer = { x: -9999, y: -9999, active: false };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    w = window.innerWidth; h = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.max(22, Math.min(64, Math.floor(w * h / 23000)));
    nodes = Array.from({ length: count }, (_, i) => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - .5) * .24, vy: (Math.random() - .5) * .24,
      r: Math.random() * 1.8 + .5, phase: Math.random() * Math.PI * 2,
      speed: Math.random() * .016 + .006, pulse: i % 7 === 0
    }));
  }

  function palette() {
    const dark = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark');
    return dark
      ? { dot: 'rgba(93,157,255,.46)', line: 'rgba(93,157,255,.10)', glow: 'rgba(43,113,255,.13)', scan: 'rgba(77,145,255,.055)', grid: 'rgba(110,150,210,.025)' }
      : { dot: 'rgba(31,94,255,.24)', line: 'rgba(31,94,255,.065)', glow: 'rgba(31,94,255,.07)', scan: 'rgba(31,94,255,.035)', grid: 'rgba(50,90,160,.022)' };
  }

  function frame(t) {
    const p = palette();
    ctx.clearRect(0, 0, w, h);

    // Soft ambient light that slowly drifts across the dashboard.
    const drift = reduced ? 0 : Math.sin(t * 0.00012) * 0.06;
    const g = ctx.createRadialGradient(w * (.72 + drift), h * .16, 0, w * .72, h * .16, Math.max(w, h) * .72);
    g.addColorStop(0, p.glow); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // Very subtle engineering-grid texture.
    ctx.strokeStyle = p.grid; ctx.lineWidth = 1;
    const grid = 72;
    for (let x = 0; x < w; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    if (!reduced) {
      const scanY = ((t * 0.018) % (h + 180)) - 90;
      const scan = ctx.createLinearGradient(0, scanY - 80, 0, scanY + 80);
      scan.addColorStop(0, 'rgba(0,0,0,0)'); scan.addColorStop(.5, p.scan); scan.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = scan; ctx.fillRect(0, scanY - 80, w, 160);
    }

    for (const n of nodes) {
      if (!reduced) {
        n.x += n.vx; n.y += n.vy; n.phase += n.speed;
        if (n.x < -30) n.x = w + 30; if (n.x > w + 30) n.x = -30;
        if (n.y < -30) n.y = h + 30; if (n.y > h + 30) n.y = -30;
      }
      if (pointer.active && !reduced) {
        const dx = pointer.x - n.x, dy = pointer.y - n.y, dist = Math.hypot(dx, dy);
        if (dist > 1 && dist < 170) { n.x -= dx / dist * .12; n.y -= dy / dist * .12; }
      }
      const pulse = n.pulse && !reduced ? Math.sin(n.phase * 1.7) * .7 : 0;
      ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(.35, n.r + pulse), 0, Math.PI * 2);
      ctx.fillStyle = p.dot; ctx.fill();
      if (n.pulse && !reduced && pulse > .35) {
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 4 + pulse * 2, 0, Math.PI * 2);
        ctx.strokeStyle = p.line; ctx.lineWidth = 1; ctx.stroke();
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j], dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < 125) {
          ctx.globalAlpha = 1 - dist / 125;
          ctx.strokeStyle = p.line; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    if (!reduced) raf = requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pointermove', e => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; }, { passive: true });
  window.addEventListener('blur', () => { pointer.active = false; }, { passive: true });
  resize();
  frame(0);
})();
