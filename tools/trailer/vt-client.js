/**
 * Virtual time for the game page (a Playwright init script). requestAnimationFrame, timers,
 * performance.now and Date.now all read one clock. In free mode the clock follows real time (menus,
 * loading); once locked, it moves only when the capture script calls __vt.step(ms), and CSS
 * animations and transitions are stepped with it so HUD effects play at game speed too.
 */
(() => {
  const realRAF = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  const epoch = Date.now();
  const vt = { t: 0, free: true, last: realNow(), raf: [], timers: new Map(), id: 1, anim: new WeakMap(), frames: 0 };
  window.__vt = vt;
  let seed = 12345;
  Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  vt.reseed = (n) => { seed = n >>> 0; };

  performance.now = () => vt.t;
  Date.now = () => epoch + vt.t;
  window.requestAnimationFrame = (cb) => { const id = vt.id++; vt.raf.push([id, cb]); return id; };
  window.cancelAnimationFrame = (id) => { vt.raf = vt.raf.filter((r) => r[0] !== id); };
  const add = (cb, ms, every, args) => {
    if (typeof cb !== 'function') return 0;
    const id = vt.id++, d = Math.max(every ? 1 : 0, Number(ms) || 0);
    vt.timers.set(id, { at: vt.t + d, every: every ? d : 0, cb, args });
    return id;
  };
  window.setTimeout = (cb, ms, ...a) => add(cb, ms, false, a);
  window.setInterval = (cb, ms, ...a) => add(cb, ms, true, a);
  window.clearTimeout = window.clearInterval = (id) => { vt.timers.delete(id); };

  function timersUpTo(end) {
    for (;;) {
      let best = null, bid = 0;
      for (const [id, t] of vt.timers) if (t.at <= end && (!best || t.at < best.at)) { best = t; bid = id; }
      if (!best) break;
      vt.t = Math.max(vt.t, best.at);
      if (best.every) best.at += best.every; else vt.timers.delete(bid);
      try { best.cb(...best.args); } catch (e) { console.error(e); }
    }
    vt.t = end;
  }

  function animations() {
    for (const a of document.getAnimations()) {
      let s = vt.anim.get(a);
      if (s === undefined) { s = vt.t; vt.anim.set(a, s); }
      try { if (a.playState !== 'paused') a.pause(); a.currentTime = vt.t - s; } catch { /* gone */ }
    }
  }

  vt.step = (ms) => {
    timersUpTo(vt.t + ms);
    const list = vt.raf; vt.raf = [];
    for (const [, cb] of list) { try { cb(vt.t); } catch (e) { console.error(e); } }
    animations();
    vt.frames++;
  };
  vt.lock = () => { vt.free = false; };
  vt.unlock = () => { vt.free = true; vt.last = realNow(); };

  const loop = () => {
    realRAF(loop);
    if (!vt.free) return;
    const n = realNow(), d = Math.min(100, n - vt.last);
    vt.last = n;
    vt.step(d);
  };
  realRAF(loop);
})();
