/* A scaled NVR: four cameras, a RAID array, retention that competes with
 * capacity, and a playback index you can inspect.
 *
 * The arithmetic is real: bytes = bitrate/8 × seconds, retention is
 * min(policy, capacity), RAID tolerance decides when recording stops.
 * The scale is not: 512 MB of "disk" stands in for terabytes, so a demo can
 * show a week of behaviour in half a minute.
 */
(() => {
  const $ = (s) => document.querySelector(s);
  const MONO = (n) => String(n).padStart(2, '0');

  const DISK_MB = 256;
  const TICK_MS = 300;
  const CAMS = [
    { id: 'c1', name: 'CAM 01', hue: 168 },
    { id: 'c2', name: 'CAM 02', hue: 205 },
    { id: 'c3', name: 'CAM 03', hue: 38 },
    { id: 'c4', name: 'CAM 04', hue: 285 },
  ];

  let S;

  function reset() {
    S = {
      t: 0, running: true, speed: 3, bitrate: 2, retentionMin: 15,
      raid: '5', disks: [true, true, true, true],
      on: { c1: true, c2: true, c3: true, c4: true },
      slices: [], ticks: [], log: [], seq: 0, failed: false,
    };
    log('green', 'Recording started · 4 cameras · RAID 5');
    render(true);
  }

  const capacity = () => {
    const alive = S.disks.filter(Boolean).length;
    const usable = { single: alive, '5': Math.max(0, alive - 1), '6': Math.max(0, alive - 2) }[S.raid];
    return usable * DISK_MB;
  };
  const tolerance = () => ({ single: 0, '5': 1, '6': 2 }[S.raid]);
  const deadDisks = () => S.disks.filter((d) => !d).length;
  const onlineCams = () => CAMS.filter((c) => S.on[c.id]);

  function log(level, msg) {
    const stamp = fmt(S.t);
    S.log.unshift({ level, msg, stamp });
    if (S.log.length > 60) S.log.pop();
  }

  const fmt = (t) => {
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
    return `${MONO(h)}:${MONO(m)}:${MONO(s)}`;
  };

  function step() {
    if (!S.running) return;
    const advance = S.speed * 4;              // virtual seconds this tick
    S.t += advance;

    if (S.failed) { render(); return; }

    const MBPS = S.bitrate / 8;               // MB per second per camera

    for (const cam of onlineCams()) {
      const mb = MBPS * advance;
      const slice = {
        id: `seg_${String(++S.seq).padStart(6, '0')}`,
        cam: cam.id, t: S.t - advance, dur: advance, mb, corrupt: false,
      };
      S.slices.push(slice);
      S.ticks.push({ cam: cam.id, id: slice.id });
    }
    // ticks for offline cameras still advance the timeline (a gap)
    S.ticks.push({ cam: null, id: null });

    prune();
    render();
  }

  function prune() {
    const cutoff = S.t - S.retentionMin * 60;
    let removedPolicy = 0, removedCapacity = 0;

    const keep = [];
    for (const s of S.slices) {
      if (s.t < cutoff) removedPolicy++;
      else keep.push(s);
    }
    S.slices = keep;

    const total = () => S.slices.reduce((a, s) => a + s.mb, 0);
    const cap = capacity();
    while (S.slices.length && total() > cap) {
      // oldest first — a ring buffer, exactly what a real recorder does
      let idx = 0;
      for (let i = 1; i < S.slices.length; i++) if (S.slices[i].t < S.slices[idx].t) idx = i;
      S.slices.splice(idx, 1);
      removedCapacity++;
    }
    if (removedPolicy && S.seq % 12 === 0) log('', `Retention: deleted ${removedPolicy} segments older than ${S.retentionMin} min`);
    if (removedCapacity && S.seq % 24 === 0) log('warn', 'Disk full: oldest segments overwritten — actual retention is below policy');

    // keep the timeline to a readable window
    const maxTicks = 44;
    const perTick = new Set(S.ticks.map((x) => x.id));
    if (S.ticks.length > maxTicks * CAMS.length) S.ticks = S.ticks.slice(-maxTicks * CAMS.length);
    void perTick;
  }

  /* ---------------- rendering ---------------- */
  function render() {
    const cap = capacity();
    const used = S.slices.reduce((a, s) => a + s.mb, 0);
    const pct = cap ? Math.min(100, (used / cap) * 100) : 0;

    $('#vclock').textContent = fmt(S.t);
    $('#speedLbl').textContent = S.running ? `${S.speed}×` : 'paused';
    $('#speedVal').textContent = `${S.speed}×`;
    $('#bitrateVal').textContent = `${S.bitrate} Mbps`;
    $('#retentionVal').textContent = `${S.retentionMin} min`;
    $('#raidLbl').textContent = ({ single: 'single disk', '5': 'RAID 5', '6': 'RAID 6' })[S.raid];

    // bays
    $('#bays').innerHTML = S.disks.map((alive, i) =>
      `<div class="bay ${alive ? 'alive' : 'dead'}">${alive ? 'OK' : 'DEAD'}<br>d${i + 1}</div>`).join('');

    $('#usedBar').style.width = pct + '%';
    $('.bar-used').classList.toggle('warn', pct > 82);
    $('#usedTxt').textContent = `${Math.round(used)} / ${Math.round(cap)} MB`;
    $('#rateTxt').textContent = S.failed || !S.running ? '0 MB/s' : `${(onlineCams().length * S.bitrate / 8).toFixed(1)} MB/s`;
    $('#policyTxt').textContent = `${S.retentionMin} min`;

    const oldest = S.slices.length ? Math.min(...S.slices.map((s) => s.t)) : null;
    const actualMin = oldest === null ? 0 : (S.t - oldest) / 60;
    $('#actualTxt').textContent = `${actualMin.toFixed(1)} min`;
    $('#segsTxt').textContent = S.slices.length;

    const state = S.failed ? 'ARRAY FAILED' : !S.running ? 'paused' : deadDisks() ? 'degraded' : 'recording';
    $('#stateTxt').textContent = state;
    $('#stateTxt').style.color = S.failed ? 'var(--red)' : deadDisks() ? 'var(--amber)' : 'var(--green)';

    if (actualMin < S.retentionMin * 0.85 && S.slices.length) {
      $('#storageNote').innerHTML = `Policy says <em>${S.retentionMin} min</em>, but capacity only holds <em>${actualMin.toFixed(1)} min</em>. The disk decides, not the policy.`;
    } else if (deadDisks()) {
      $('#storageNote').innerHTML = `Array degraded: <em>${deadDisks()} disk${deadDisks() > 1 ? 's' : ''} down</em>. Tolerates ${tolerance()} — ${deadDisks() > tolerance() ? 'past the limit, recording has stopped.' : 'still recording, but the next failure is fatal.'}`;
    } else {
      $('#storageNote').innerHTML = 'Retention is whatever is <em>smaller</em>: the policy, or the disk.';
    }

    // log
    $('#log').innerHTML = S.log.slice(0, 14).map((l) => `<div class="${l.level}">${l.stamp} · ${l.msg}</div>`).join('');

    renderTimeline();
  }

  function renderTimeline() {
    const lanes = $('#lanes');
    // group ticks by camera, keep order
    const byCam = {};
    CAMS.forEach((c) => (byCam[c.id] = []));
    let camIdx = 0;
    const perCam = Math.floor(S.ticks.length / CAMS.length) || 0;

    // rebuild from the flat tick list: every camera gets one slot per cycle
    S.ticks.forEach((entry) => {
      if (entry.cam) byCam[entry.cam].push(entry.id);
    });

    lanes.innerHTML = CAMS.map((c) => {
      const ids = byCam[c.id].slice(-perCam || -44);
      const alive = new Set(S.slices.map((s) => s.id));
      const corrupt = new Set(S.slices.filter((s) => s.corrupt).map((s) => s.id));
      const cells = [];
      const width = Math.max(ids.length, 40);
      for (let i = 0; i < width; i++) {
        const id = ids[i - (width - ids.length)];
        if (!id) { cells.push('<div class="seg missing"></div>'); continue; }
        const cls = !alive.has(id) ? 'missing' : corrupt.has(id) ? 'corrupt' : '';
        cells.push(`<div class="seg ${cls}" data-id="${id}" title="${id}"></div>`);
      }
      return `<div class="lane"><div class="nm">${c.name}</div><div class="strip">${cells.join('')}</div></div>`;
    }).join('');

    lanes.querySelectorAll('.seg[data-id]').forEach((el) => el.addEventListener('click', () => inspect(el.dataset.id)));
    void camIdx;
  }

  function hashOf(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0') + (Math.imul(h, 31) >>> 0).toString(16).padStart(8, '0');
  }

  function inspect(id) {
    const s = S.slices.find((x) => x.id === id);
    const cam = CAMS.find((c) => c.id === (s && s.cam));
    if (!s) {
      $('#inspector').innerHTML = `<b>${id}</b> — this segment has been deleted (retention or capacity). The index entry would be gone too.`;
      return;
    }
    $('#inspector').innerHTML = `<b>${s.id}</b> · ${cam.name} · ${fmt(s.t)} → ${fmt(s.t + s.dur)}<br>
      size <b>${s.mb.toFixed(2)} MB</b> · status <b>${s.corrupt ? 'CORRUPT — decodes with artefacts' : 'intact'}</b><br>
      sha-256 (simulated) <b>${hashOf(s.id)}</b>`;
  }

  /* ---------------- live tiles ---------------- */
  function drawTiles(ts) {
    CAMS.forEach((cam, i) => {
      const tile = document.getElementById('tile-' + cam.id);
      if (!tile) return;
      const on = S.on[cam.id] && !S.failed;
      tile.classList.toggle('off', !on);
      tile.querySelector('.st').textContent = on ? 'LIVE' : 'NO SIGNAL';
      const cv = tile.querySelector('canvas');
      const ctx = cv.getContext('2d');
      const w = cv.width, h = cv.height;
      if (!on) { ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, w, h); return; }

      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, `hsl(${cam.hue} 22% 12%)`);
      g.addColorStop(1, '#05070a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

      // a moving subject, so "live" looks live
      const x = (ts / 26 + i * 90) % (w + 60) - 30;
      ctx.fillStyle = `hsla(${cam.hue} 60% 62% / .55)`;
      ctx.fillRect(x, h * 0.55, 26, 42);
      ctx.fillStyle = `hsla(${cam.hue} 60% 70% / .9)`;
      ctx.update = null;
      ctx.fillRect(x + 7, h * 0.55 - 10, 12, 12);

      // scanlines + timestamp
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
      ctx.fillStyle = 'rgba(230,245,255,.75)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(`${fmt(S.t)}  ${S.bitrate}Mbps`, 8, h - 8);
    });
  }

  function buildTiles() {
    $('#tiles').innerHTML = CAMS.map((c) => `
      <div class="tile" id="tile-${c.id}">
        <canvas width="320" height="180"></canvas>
        <span class="tag">${c.name}</span>
        <span class="st">LIVE</span>
      </div>`).join('');
  }

  /* ---------------- controls ---------------- */
  $('#speed').addEventListener('input', (e) => { S.speed = +e.target.value; render(); });
  $('#bitrate').addEventListener('input', (e) => { S.bitrate = +e.target.value; render(); });
  $('#retention').addEventListener('input', (e) => { S.retentionMin = +e.target.value; log('', `Retention policy set to ${S.retentionMin} min`); render(); });
  $('#raid').addEventListener('change', (e) => {
    S.raid = e.target.value;
    log('warn', `Array reconfigured to ${e.target.selectedOptions[0].textContent} — capacity is now ${capacity()} MB`);
    if (deadDisks() > tolerance()) { S.failed = true; log('e', 'Reconfiguration leaves no tolerance — recording stopped'); }
    render();
  });

  $('#pause').addEventListener('click', (e) => {
    S.running = !S.running;
    e.target.textContent = S.running ? 'Pause' : 'Resume';
    e.target.classList.toggle('on', !S.running);
    log('', S.running ? 'Recording resumed' : 'Recording paused');
    render();
  });
  $('#reset').addEventListener('click', () => { reset(); $('#pause').textContent = 'Pause'; });

  $('#killCam').addEventListener('click', () => {
    const up = onlineCams();
    if (!up.length) return;
    const cam = up[Math.floor(Math.random() * up.length)];
    S.on[cam.id] = false;
    log('warn', `${cam.name} lost — no segments written, a visible gap in playback`);
    render();
  });
  $('#killDisk').addEventListener('click', () => {
    const idx = S.disks.findIndex((d) => d);
    if (idx < 0) return;
    S.disks[idx] = false;
    log('warn', `Disk ${idx + 1} failed — array degraded`);
    if (deadDisks() > tolerance()) {
      S.failed = true;
      log('e', `Beyond tolerance (${tolerance()}): recording stopped. Video already written is still readable.`);
    }
    render();
  });
  $('#corrupt').addEventListener('click', () => {
    if (!S.slices.length) return;
    const s = S.slices[Math.floor(Math.random() * S.slices.length)];
    s.corrupt = true;
    log('warn', `${s.id} corrupted — playback decodes it with artefacts; the hash no longer matches`);
    render();
  });
  $('#restore').addEventListener('click', () => {
    S.disks = [true, true, true, true];
    CAMS.forEach((c) => (S.on[c.id] = true));
    S.failed = false;
    log('green', 'All cameras and disks restored — recording resumed');
    render();
  });

  /* ---------------- boot ---------------- */
  buildTiles();
  reset();
  setInterval(step, TICK_MS);
  (function loop(ts) { drawTiles(ts || 0); requestAnimationFrame(loop); })();
  document.documentElement.dataset.ready = '1';
})();
