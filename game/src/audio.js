// Neon Bay audio: every sound is synthesized with WebAudio — no audio files.
// The AudioContext is created lazily in resume() (first user gesture), so all
// methods are safe no-ops before then. M toggles mute.

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineFilter = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = null;
  let sirenHigh = false;
  let muted = false;

  function ensureEngine() {
    if (!ctx || engineOsc) return;
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 60;
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 800;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start();
  }

  function tone({ type = 'sine', freq = 440, toFreq = null, dur = 0.1, gain = 0.15, when = 0 }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (toFreq !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, toFreq), t0 + dur);
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(amp);
    amp.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise({ dur = 0.2, gain = 0.2, filterType = 'lowpass', filterFreq = 1200, when = 0 }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    src.start(t0);
    src.stop(t0 + dur);
  }

  function applyMute() {
    if (master) master.gain.value = muted ? 0 : 1;
  }

  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyM' && !event.repeat) {
      muted = !muted;
      applyMute();
    }
  });

  return {
    get muted() { return muted; },
    resume() {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      ensureEngine();
    },
    setMuted(m) {
      muted = Boolean(m);
      applyMute();
    },
    toggleMute() {
      muted = !muted;
      applyMute();
      return muted;
    },
    engine(level) {
      if (!ctx) return;
      ensureEngine();
      const clamped = Math.max(0, Math.min(1, level));
      engineOsc.frequency.setTargetAtTime(60 + clamped * 140, ctx.currentTime, 0.05);
      engineGain.gain.setTargetAtTime(clamped > 0.02 ? 0.05 : 0, ctx.currentTime, 0.05);
    },
    siren(on) {
      if (on) {
        if (!ctx || sirenOsc) return;
        sirenOsc = ctx.createOscillator();
        sirenOsc.type = 'sine';
        sirenOsc.frequency.value = 700;
        sirenGain = ctx.createGain();
        sirenGain.gain.value = 0.035;
        sirenOsc.connect(sirenGain);
        sirenGain.connect(master);
        sirenOsc.start();
        sirenHigh = false;
        sirenTimer = setInterval(() => {
          sirenHigh = !sirenHigh;
          if (sirenOsc) sirenOsc.frequency.value = sirenHigh ? 950 : 700;
        }, 400);
      } else {
        if (sirenTimer) { clearInterval(sirenTimer); sirenTimer = null; }
        if (sirenOsc) {
          try { sirenOsc.stop(); } catch (e) { /* already stopped */ }
          sirenOsc.disconnect();
          sirenOsc = null;
        }
        sirenGain = null;
      }
    },
    shoot() { noise({ dur: 0.12, gain: 0.25, filterType: 'highpass', filterFreq: 1200 }); },
    punch() { tone({ type: 'sine', freq: 90, dur: 0.1, gain: 0.25 }); },
    pickup() {
      tone({ type: 'sine', freq: 660, dur: 0.09, gain: 0.15 });
      tone({ type: 'sine', freq: 880, dur: 0.12, gain: 0.15, when: 0.09 });
    },
    crash() { noise({ dur: 0.3, gain: 0.3, filterType: 'lowpass', filterFreq: 500 }); },
    click() { tone({ type: 'square', freq: 1200, dur: 0.05, gain: 0.08 }); },
    busted() {
      tone({ type: 'sine', freq: 400, dur: 0.18, gain: 0.18 });
      tone({ type: 'sine', freq: 300, dur: 0.18, gain: 0.18, when: 0.18 });
      tone({ type: 'sine', freq: 200, dur: 0.3, gain: 0.18, when: 0.36 });
    },
  };
}
