// public/js/audio.js — Sprint 37: sound for Finbuu. No audio files: background music and effects are synthesised with the Web Audio API.
// Four independent channels, each with on/off + volume: speaker (master output), music, effects, microphone (level meter now; the levels are
// kept for the upcoming voice chat). Everything is remembered per device; nothing starts before the first user gesture (browser rule),
// and the microphone is only opened while the player presses its test button.
const KEY = 'audio';
const DEF = { master: { on: true, vol: 0.8 }, music: { on: false, vol: 0.35 }, sfx: { on: true, vol: 0.7 }, mic: { on: true, vol: 0.8 } };
const GROUPS = ['master', 'music', 'sfx', 'mic'];
const hz = n => 440 * Math.pow(2, (n - 69) / 12);        // MIDI note -> frequency
// C major pentatonic-friendly progression (Cmaj7 · Am7 · Fmaj7 · G6), 8 eighth-notes per chord
const CHORDS = [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 55, 59]];
const SCALE = [60, 62, 64, 67, 69, 72, 74, 76];
const BPM = 78, STEP = 60 / BPM / 2;

export function createAudio({ loadJSON, saveJSON }) {
  const saved = loadJSON(KEY, null) || {};
  const st = Object.fromEntries(GROUPS.map(g => [g, { ...DEF[g], ...(saved[g] && typeof saved[g] === 'object' ? { on: !!saved[g].on, vol: Math.max(0, Math.min(1, Number(saved[g].vol ?? DEF[g].vol))) } : {}) }]));
  let ctx = null, master = null, musicBus = null, sfxBus = null, sched = null, nextT = 0, step = 0, unlocked = false;
  const listeners = new Set(), lastPlay = {};
  const persist = () => saveJSON(KEY, st);
  const emit = () => listeners.forEach(f => f(st));

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    ctx = new AC(); master = ctx.createGain(); musicBus = ctx.createGain(); sfxBus = ctx.createGain();
    musicBus.connect(master); sfxBus.connect(master); master.connect(ctx.destination); applyGains(true); return ctx;
  }
  function applyGains(now) {
    if (!ctx) return; const t = ctx.currentTime, set = (g, v) => (now ? (g.gain.value = v) : g.gain.setTargetAtTime(v, t, 0.03));
    set(master, st.master.on ? st.master.vol : 0); set(musicBus, st.music.on ? st.music.vol : 0); set(sfxBus, st.sfx.on ? st.sfx.vol : 0);
  }

  // ---------- background music (generative, quiet) ----------
  function tone(freq, t, dur, { type = 'sine', vol = 0.08, attack = 0.01, bus = musicBus, lp = 0 } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o; if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); node = f; }
    node.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }
  function scheduleStep(t, i) {
    const chord = CHORDS[Math.floor(i / 8) % CHORDS.length], k = i % 8;
    if (k === 0) chord.forEach((n, j) => tone(hz(n + (j ? 0 : 0)), t, STEP * 8, { type: 'triangle', vol: 0.045, attack: STEP * 2, lp: 900 }));   // soft pad
    const pat = [1, 0, 1, 1, 0, 1, 0, 1][k]; if (!pat) return;
    const base = chord[(k * 3 + Math.floor(i / 8)) % chord.length] + 12, n = (k % 3 === 2) ? SCALE[(i * 5) % SCALE.length] : base;      // pluck
    tone(hz(n), t, STEP * 3.5, { type: 'sine', vol: 0.07, attack: 0.008 }); tone(hz(n + 12), t, STEP * 1.6, { type: 'triangle', vol: 0.018, attack: 0.008 });
  }
  function musicTick() { while (nextT < ctx.currentTime + 0.25) { scheduleStep(nextT, step); nextT += STEP; step++; } }
  function startMusic() { if (!ctx || sched || !unlocked) return; nextT = ctx.currentTime + 0.1; sched = setInterval(musicTick, 90); }
  function stopMusic() { clearInterval(sched); sched = null; }
  const syncMusic = () => { if (!ctx) return; if (st.music.on && st.master.on) { ctx.resume?.(); startMusic(); } else stopMusic(); };

  // ---------- effects ----------
  const FX = {
    click: t => tone(880, t, 0.05, { type: 'triangle', vol: 0.1, bus: sfxBus }),
    open: t => { tone(420, t, 0.09, { type: 'sine', vol: 0.09, bus: sfxBus }); tone(620, t + 0.05, 0.09, { type: 'sine', vol: 0.07, bus: sfxBus }); },
    notify: t => { tone(660, t, 0.14, { vol: 0.12, bus: sfxBus }); tone(880, t + 0.11, 0.2, { vol: 0.12, bus: sfxBus }); },
    success: t => [72, 76, 79, 84].forEach((n, i) => tone(hz(n), t + i * 0.09, 0.28, { type: 'triangle', vol: 0.12, bus: sfxBus })),
    coin: t => { tone(1318, t, 0.09, { type: 'square', vol: 0.05, bus: sfxBus }); tone(1760, t + 0.07, 0.22, { type: 'square', vol: 0.05, bus: sfxBus }); },
    error: t => { tone(220, t, 0.18, { type: 'sawtooth', vol: 0.07, bus: sfxBus, lp: 800 }); tone(165, t + 0.12, 0.22, { type: 'sawtooth', vol: 0.07, bus: sfxBus, lp: 800 }); }
  };
  function sfx(name) {
    if (!unlocked || !st.sfx.on || !st.master.on || !FX[name] || !ensure()) return;
    const now = performance.now(); if (now - (lastPlay[name] || 0) < (name === 'click' ? 45 : 140)) return; lastPlay[name] = now;
    if (ctx.state === 'suspended') ctx.resume?.(); FX[name](ctx.currentTime + 0.005);
  }
  // test chime for the speaker slider: always plays through the master channel, even if effects are off
  function testSpeaker() { if (!ensure()) return; unlocked = true; ctx.resume?.(); const t = ctx.currentTime + 0.01; [72, 76, 79].forEach((n, i) => tone(hz(n), t + i * 0.12, 0.35, { type: 'triangle', vol: 0.18, bus: master })); }

  // ---------- microphone (level meter only; the signal is never played back or sent) ----------
  let mic = null;
  async function micStart(onLevel) {
    micStop();
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { code: 'none' });
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { throw Object.assign(e, { code: /NotAllowed|Permission/i.test(e.name + e.message) ? 'denied' : 'none' }); }
    const c = ensure(); if (!c) { stream.getTracks().forEach(t => t.stop()); throw Object.assign(new Error('unsupported'), { code: 'none' }); }
    const src = c.createMediaStreamSource(stream), gain = c.createGain(), an = c.createAnalyser(); an.fftSize = 512; gain.gain.value = st.mic.vol * 2;
    src.connect(gain); gain.connect(an); const buf = new Uint8Array(an.fftSize); let raf = 0;
    const loop = () => { an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) { const x = (v - 128) / 128; s += x * x; } onLevel(Math.min(1, Math.sqrt(s / buf.length) * 3.2)); raf = requestAnimationFrame(loop); };
    loop(); mic = { stream, gain, raf: () => cancelAnimationFrame(raf) };
  }
  function micStop() { if (!mic) return; mic.raf(); mic.stream.getTracks().forEach(t => t.stop()); try { mic.gain.disconnect(); } catch { /* already gone */ } mic = null; }
  const micActive = () => !!mic;

  // ---------- control ----------
  function set(group, patch) {
    if (!st[group]) return; if (patch.on != null) st[group].on = !!patch.on; if (patch.vol != null) st[group].vol = Math.max(0, Math.min(1, Number(patch.vol)));
    if (group === 'mic') { if (mic) mic.gain.gain.value = st.mic.vol * 2; if (!st.mic.on) micStop(); }
    applyGains(false); if (group === 'music' || group === 'master') syncMusic(); persist(); emit();
  }
  // mute everything / unmute everything (header button)
  const muted = () => !st.master.on;
  const toggleMute = () => set('master', { on: !st.master.on });
  // first user gesture: browsers allow audio from now on
  function unlock() { if (unlocked) return; unlocked = true; if (ensure()) { ctx.resume?.(); syncMusic(); } }
  document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) { stopMusic(); ctx.suspend?.(); } else if (unlocked) { ctx.resume?.(); syncMusic(); } });
  ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, unlock, { once: false, passive: true }));
  return { state: st, set, toggleMute, muted, sfx, testSpeaker, micStart, micStop, micActive, onChange: f => { listeners.add(f); return () => listeners.delete(f); }, getMicGain: () => (st.mic.on ? st.mic.vol : 0) };
}

// ---------- header panel ----------
export function createAudioPanel({ audio, el, toast, t }) {
  let panel = null, offClick = null, cleanup = [];
  const icon = () => (audio.muted() ? '🔇' : '🔊');
  function row(group, label, emoji, extra) {
    const s = audio.state[group], r = el('div', null, 'audRow'), top = el('div', null, 'audTop');
    const on = el('button', s.on ? '✓' : '✕', 'audToggle'); on.type = 'button'; on.setAttribute('role', 'switch'); on.setAttribute('aria-checked', String(s.on)); on.setAttribute('aria-label', `${label} — ${t('audio.on')}`);
    const name = el('b', `${emoji} ${label}`), pct = el('small', '', 'muted'); pct.style.marginLeft = 'auto';
    const rng = el('input'); rng.type = 'range'; rng.min = 0; rng.max = 100; rng.step = 1; rng.value = Math.round(s.vol * 100); rng.setAttribute('aria-label', `${label} — ${t('audio.volume')}`);
    const paint = () => { const g = audio.state[group]; on.textContent = g.on ? '✓' : '✕'; on.setAttribute('aria-checked', String(g.on)); on.classList.toggle('off', !g.on); rng.disabled = !g.on; pct.textContent = `${Math.round(g.vol * 100)}%`; rng.value = Math.round(g.vol * 100); };
    on.onclick = () => { audio.set(group, { on: !audio.state[group].on }); };
    rng.oninput = () => { audio.set(group, { vol: rng.value / 100 }); };
    top.append(on, name, pct); r.append(top, rng); if (extra) r.append(extra); r._paint = paint; paint(); return r;
  }
  function open(anchor) {
    close(); panel = el('div', null, 'audPanel'); panel.id = 'audioPanel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', t('audio.title'));
    const head = el('div', null, 'audHead'); head.append(el('b', '🎚 ' + t('audio.title')));
    const x = el('button', '✕'); x.type = 'button'; x.setAttribute('aria-label', t('ui.close')); x.onclick = close; head.append(x); panel.append(head);
    const speakerExtra = el('button', '▶ ' + t('audio.testSpeaker')); speakerExtra.type = 'button'; speakerExtra.onclick = () => audio.testSpeaker();
    const meter = el('div', null, 'audMeter'), fill = el('i'); meter.append(fill); const msg = el('small', t('audio.micHint'), 'muted');
    const micBtn = el('button', '🎤 ' + t('audio.testMic')); micBtn.type = 'button';
    const stopMic = () => { audio.micStop(); fill.style.width = '0%'; micBtn.textContent = '🎤 ' + t('audio.testMic'); };
    micBtn.onclick = async () => {
      if (audio.micActive()) return stopMic();
      if (!audio.state.mic.on) return toast(t('audio.micOff'));
      try { await audio.micStart(l => { fill.style.width = Math.round(l * 100) + '%'; }); micBtn.textContent = '⏹ ' + t('audio.stopMic'); msg.textContent = t('audio.micLive'); }
      catch (e) { msg.textContent = t(e.code === 'denied' ? 'audio.micDenied' : 'audio.micNone'); }
    };
    const micExtra = el('div'); micExtra.append(micBtn, meter, msg);
    const rows = [row('master', t('audio.speaker'), '🔈', speakerExtra), row('music', t('audio.music'), '🎵'), row('sfx', t('audio.sfx'), '🔔'), row('mic', t('audio.mic'), '🎤', micExtra)];
    // labels are read inside row(); declare after so the closure sees them
    panel.append(...rows);
    const all = el('button', audio.muted() ? '🔊 ' + t('audio.unmuteAll') : '🔇 ' + t('audio.muteAll'), 'audAll'); all.type = 'button'; all.onclick = () => audio.toggleMute(); panel.append(all);
    panel.append(el('small', t('audio.note'), 'muted'));
    document.body.append(panel);
    const off = audio.onChange(() => { rows.forEach(r => r._paint()); all.textContent = audio.muted() ? '🔊 ' + t('audio.unmuteAll') : '🔇 ' + t('audio.muteAll'); }); cleanup = [off, stopMic];
    const away = e => { if (!panel.contains(e.target) && !(anchor && anchor.contains(e.target)) && !e.target.closest?.('#drawer')) close(); };
    const esc = e => { if (e.key === 'Escape') { close(); anchor?.focus?.(); } };
    setTimeout(() => document.addEventListener('pointerdown', away), 0); document.addEventListener('keydown', esc);
    offClick = () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
    rows[0].querySelector('button')?.focus();
  }
  function close() { if (!panel) return; cleanup.forEach(f => f()); cleanup = []; offClick?.(); offClick = null; panel.remove(); panel = null; }
  const isOpen = () => !!panel;
  return { open, close, toggle: a => (isOpen() ? close() : open(a)), icon, isOpen };
}
