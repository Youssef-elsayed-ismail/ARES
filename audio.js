// All sound is synthesised live in the browser (Web Audio): no audio files, nothing to download or license.
let ac, master, sfx, mus, noiseBuf, musicOn = false, muted = false, timer;

export function unlock() {                    // browsers only allow sound after a click or key press
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
    sfx = ac.createGain(); sfx.gain.value = 0.55; sfx.connect(master);
    mus = ac.createGain(); mus.gain.value = 0.0; mus.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === "suspended") ac.resume();
}
export function toggleMute() { muted = !muted; if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ac.currentTime, 0.05); return muted; }
export const isMuted = () => muted;

function tone(freq, dur, { type = "square", gain = 0.2, at = 0, to = null, out = sfx, attack = 0.005 } = {}) {
  if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, { filter = "lowpass", freq = 800, q = 1, gain = 0.3, at = 0, to = null, out = sfx } = {}) {
  if (!ac) return;
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime + at;
  s.buffer = noiseBuf; s.loop = true; f.type = filter; f.frequency.setValueAtTime(freq, t); f.Q.value = q; if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out); s.start(t, Math.random()); s.stop(t + dur + 0.02);
}

// ---- effects ----
export const jump = () => tone(260, 0.09, { type: "triangle", gain: 0.12, to: 520 });
export function step(kind) {                  // a landing sounds like the ground it lands on
  if (kind === "dune") { noise(0.16, { freq: 520, gain: 0.34 }); noise(0.1, { freq: 300, gain: 0.2, at: 0.05 }); }        // soft sand
  else if (kind === "slab") { noise(0.035, { filter: "bandpass", freq: 2100, q: 3, gain: 0.5 }); tone(110, 0.07, { type: "sine", gain: 0.35, to: 60 }); }   // hard rock
  else { noise(0.06, { filter: "bandpass", freq: 1100, q: 1.5, gain: 0.4 }); noise(0.05, { filter: "bandpass", freq: 1700, q: 2, gain: 0.25, at: 0.045 }); }   // gravel crunch
}
export const blocked = () => { tone(95, 0.16, { type: "square", gain: 0.2 }); noise(0.08, { freq: 300, gain: 0.3 }); };
export const danger = () => { tone(520, 0.1, { type: "sawtooth", gain: 0.14 }); tone(390, 0.14, { type: "sawtooth", gain: 0.14, at: 0.11 }); };
export const pickup = () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, { type: "triangle", gain: 0.22, at: i * 0.075 })); noise(0.5, { filter: "highpass", freq: 5000, gain: 0.08, at: 0.2 }); };
export const tank = () => { noise(0.7, { filter: "highpass", freq: 2500, gain: 0.3, to: 7000 }); tone(300, 0.6, { type: "sine", gain: 0.2, to: 900, at: 0.05 }); };
export const heart = () => { tone(70, 0.12, { type: "sine", gain: 0.5, to: 45 }); tone(70, 0.12, { type: "sine", gain: 0.35, to: 45, at: 0.18 }); };
export const ui = () => tone(880, 0.05, { type: "square", gain: 0.08 });
export const whoosh = () => noise(0.5, { filter: "bandpass", freq: 300, q: 0.8, gain: 0.3, to: 1800 });
export const die = () => { tone(420, 1.0, { type: "sawtooth", gain: 0.22, to: 50 }); noise(0.9, { freq: 900, gain: 0.3, to: 120 }); };
export const win = () => { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i === 6 ? 0.7 : 0.2, { type: "triangle", gain: 0.24, at: i * 0.13 })); };
const VOICE = [[523, 659, 784], [392, 330, 262], [659, 784, 1047, 1319], [262, 196, 147, 98]];
export const ares = (mood = 0) => VOICE[mood].forEach((f, i) => tone(f, 0.075, { type: "square", gain: 0.1, at: i * 0.07 }));   // ARES speaks in tones

// ---- the opening cinematic ----
export const boom = (big = 1) => { tone(90, 1.6 * big, { type: "sine", gain: 0.9, to: 28 }); noise(1.4 * big, { freq: 1400, gain: 0.8, to: 60 }); noise(0.25, { filter: "highpass", freq: 3000, gain: 0.3 }); };
export function roar(dur = 4) {               // falling through the air: a noise that grows until the ground
  if (!ac) return;
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime;
  s.buffer = noiseBuf; s.loop = true; f.type = "lowpass"; f.frequency.setValueAtTime(180, t); f.frequency.exponentialRampToValueAtTime(2600, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
  s.connect(f).connect(g).connect(sfx); s.start(t); s.stop(t + dur + 0.1);
  tone(55, dur, { type: "sawtooth", gain: 0.14, to: 150, attack: dur * 0.85 });
}
export const engine = (dur = 5) => { tone(72, dur, { type: "sawtooth", gain: 0.07, to: 66, attack: 0.8 }); tone(144, dur, { type: "sine", gain: 0.05, attack: 0.8 }); };
export const powerdown = () => tone(320, 1.5, { type: "sawtooth", gain: 0.2, to: 30 });
export const alarm = () => { tone(880, 0.16, { type: "square", gain: 0.09 }); tone(660, 0.22, { type: "square", gain: 0.09, at: 0.18 }); };
export const spark = () => { noise(0.06, { filter: "highpass", freq: 4000, gain: 0.3 }); noise(0.05, { filter: "highpass", freq: 5200, gain: 0.2, at: 0.09 }); };
export const riser = (dur = 1.5) => tone(110, dur, { type: "sawtooth", gain: 0.13, to: 880, attack: dur * 0.9 });
export const hit = () => { tone(55, 2.2, { type: "sine", gain: 0.8, to: 36 }); [110, 165, 220, 277].forEach((f) => tone(f, 2.4, { type: "triangle", gain: 0.11, attack: 0.02 })); };
export function hush(sec = 5) {               // cut whatever effects are still ringing (the cinematic was skipped)
  if (!ac) return; const t = ac.currentTime; sfx.gain.cancelScheduledValues(t); sfx.gain.setTargetAtTime(0, t, 0.03); sfx.gain.setTargetAtTime(0.55, t + sec, 0.2);
}

// ---- music: a slow, lonely pad, a few plucked notes, and the wind ----
const CHORDS = [[110, 164.8, 220, 261.6], [87.3, 130.8, 174.6, 220], [73.4, 110, 146.8, 174.6], [82.4, 123.5, 164.8, 196]];   // Am  F  Dm  Em
const PLUCK = [440, 523.3, 587.3, 659.3, 784, 880];
function bar(n) {
  if (!musicOn) return;
  const chord = CHORDS[n % CHORDS.length], len = 7.5;
  chord.forEach((f, k) => { tone(f, len, { type: "sine", gain: 0.11, out: mus, attack: 2.2 }); tone(f * 1.005, len, { type: "triangle", gain: 0.035, out: mus, attack: 2.6, at: k * 0.02 }); });
  for (let k = 0; k < 4; k++) if (Math.random() < 0.7) { const f = PLUCK[(Math.random() * PLUCK.length) | 0] * (Math.random() < 0.25 ? 0.5 : 1), at = 0.6 + k * 1.7 + Math.random() * 0.5;
    tone(f, 1.6, { type: "triangle", gain: 0.06, out: mus, at }); tone(f, 1.2, { type: "triangle", gain: 0.025, out: mus, at: at + 0.33 }); }   // note + echo
  timer = setTimeout(() => bar(n + 1), (len - 1.2) * 1000);
}
let wind;
export function music(on) {
  if (!ac || on === musicOn) return;
  musicOn = on; clearTimeout(timer);
  mus.gain.setTargetAtTime(on ? 0.55 : 0, ac.currentTime, on ? 1.5 : 0.4);
  if (on) {
    bar(0);
    if (!wind) {                              // wind: filtered noise that slowly rises and falls
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
      s.buffer = noiseBuf; s.loop = true; f.type = "bandpass"; f.frequency.value = 420; f.Q.value = 0.7; g.gain.value = 0.085;
      lfo.frequency.value = 0.09; lg.gain.value = 260; lfo.connect(lg).connect(f.frequency);
      s.connect(f).connect(g).connect(mus); s.start(); lfo.start(); wind = s;
    }
  }
}
