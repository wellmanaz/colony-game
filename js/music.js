// Original background music, synthesised live with the Web Audio API.
// A funky two-section loop: slap-ish bass, offbeat chord stabs, a
// pentatonic lead and chiptune drums. No audio files involved.

const BPM = 114;
const STEP = 60 / BPM / 4; // one sixteenth note in seconds
const SWING = 0.12; // delay on the off-sixteenths, as a fraction of a step

// Note helpers. Numbers are MIDI note numbers.
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
const E1 = 28;

// Chord progression: two bars each, 8 bars per section.
// Each chord lists the roots of the voicing (MIDI) and the bass root.
const SECTION_A = [
  { bass: E1 + 12, chord: [52, 55, 59, 62] }, // Em7
  { bass: E1 + 12, chord: [52, 55, 59, 62] },
  { bass: E1 + 17, chord: [57, 60, 64, 67] }, // Am7
  { bass: E1 + 19, chord: [59, 62, 66, 69] }, // Bm7
];
const SECTION_B = [
  { bass: E1 + 15, chord: [55, 59, 62, 66] }, // Gmaj7
  { bass: E1 + 17, chord: [57, 60, 64, 67] }, // Am7
  { bass: E1 + 20, chord: [60, 64, 67, 71] }, // Cmaj7
  { bass: E1 + 19, chord: [59, 63, 66, 69] }, // B7
];

// Bass pattern over two bars (32 sixteenths): offsets from the chord's bass
// root in semitones, null = rest, 'o' = octave pop.
const BASS = [
  0, null, null, 0, null, null, 12, null, 0, null, 10, null, 12, null, null, null,
  0, null, null, 0, null, 7, null, null, 0, null, 10, 12, null, null, 7, null,
];
// Chord stabs: which sixteenths get a stab, over two bars.
const STABS = [null, null, 1, null, null, null, null, 1, null, null, 1, null, null, null, 1, null,
  null, null, 1, null, null, null, null, 1, null, null, 1, null, 1, null, null, null];
// Drums over one bar (16 sixteenths): k = kick, s = snare, h = hat, H = open hat.
const KICK = [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0];
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];
const HAT = [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 2, 0];

// Lead melody: E minor pentatonic degrees over 8 bars (128 sixteenths),
// written as [step, midi, lengthInSteps]. Section B transposes freely.
const LEAD_A = [
  [0, 76, 2], [2, 79, 2], [4, 81, 4], [10, 79, 2], [12, 76, 4],
  [16, 74, 2], [18, 76, 2], [20, 79, 6], [28, 74, 2], [30, 71, 2],
  [32, 72, 4], [36, 76, 2], [38, 79, 2], [40, 81, 6], [48, 79, 2], [50, 76, 2],
  [52, 74, 4], [58, 71, 2], [60, 74, 2], [62, 76, 2],
  [64, 76, 2], [66, 79, 2], [68, 83, 4], [74, 81, 2], [76, 79, 4],
  [80, 81, 2], [82, 79, 2], [84, 76, 6], [92, 74, 2], [94, 76, 2],
  [96, 72, 4], [100, 76, 2], [102, 79, 2], [104, 84, 6], [112, 83, 2], [114, 79, 2],
  [116, 81, 4], [122, 79, 2], [124, 76, 4],
];
const LEAD_B = [
  [0, 79, 2], [2, 83, 2], [4, 86, 4], [10, 83, 2], [12, 79, 4],
  [16, 81, 2], [18, 84, 2], [20, 88, 6], [28, 84, 2], [30, 81, 2],
  [32, 84, 4], [36, 88, 2], [38, 91, 2], [40, 88, 6], [48, 84, 2], [50, 81, 2],
  [52, 83, 4], [58, 81, 2], [60, 78, 2], [62, 75, 2],
  [64, 79, 2], [66, 83, 2], [68, 86, 4], [74, 83, 2], [76, 79, 4],
  [80, 81, 2], [82, 84, 2], [84, 88, 6], [92, 91, 2], [94, 88, 2],
  [96, 84, 4], [100, 88, 2], [102, 84, 2], [104, 81, 6], [112, 83, 2], [114, 78, 2],
  [116, 81, 4], [122, 83, 2], [124, 86, 4],
];

export class Music {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.playing = false;
    this.muted = false;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.intensity = 1;
  }

  // Must be called from a user gesture the first time.
  start() {
    if (this.playing) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 40);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  // Lower the band a little during screens that need concentration.
  setIntensity(v) {
    this.intensity = v;
  }

  schedule() {
    const ahead = this.ctx.currentTime + 0.2;
    while (this.nextTime < ahead) {
      this.playStep(this.step, this.nextTime + (this.step % 2 ? STEP * SWING : 0));
      this.step = (this.step + 1) % 256;
      this.nextTime += STEP;
    }
  }

  playStep(step, t) {
    const section = step < 128 ? SECTION_A : SECTION_B;
    const local = step % 128;
    const chord = section[Math.floor(local / 32)];
    const bar16 = step % 16;
    const two = step % 32;
    const quiet = this.intensity < 1;

    // Drums.
    if (KICK[bar16]) this.kick(t);
    if (SNARE[bar16] && !(quiet && bar16 === 15)) this.snare(t, bar16 === 15 ? 0.5 : 1);
    if (HAT[bar16]) this.hat(t, HAT[bar16] === 2 ? 0.14 : 0.04, quiet ? 0.5 : 1);

    // Bass.
    const b = BASS[two];
    if (b !== null) this.bass(hz(chord.bass + b), t, b === 12 ? STEP * 0.9 : STEP * 1.6);

    // Chord stabs.
    if (STABS[two] && !quiet) this.stab(chord.chord, t);

    // Lead.
    const lead = step < 128 ? LEAD_A : LEAD_B;
    lead.forEach(([s, n, len]) => {
      if (s === local) this.lead(hz(n), t, len * STEP * 0.85);
    });
  }

  env(gainNode, t, attack, decay, peak, sustain, dur, release) {
    const g = gainNode.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.linearRampToValueAtTime(sustain, t + attack + decay);
    g.setValueAtTime(sustain, t + dur);
    g.linearRampToValueAtTime(0, t + dur + release);
  }

  kick(t) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  }

  noise(t, dur, filterType, freq, vol) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  snare(t, vol) {
    this.noise(t, 0.18, 'bandpass', 1800, 0.5 * vol);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    g.gain.setValueAtTime(0.4 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }

  hat(t, dur, vol) {
    this.noise(t, dur, 'highpass', 7000, 0.22 * vol);
  }

  bass(freq, t, dur) {
    const o = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o2.type = 'square';
    o.frequency.value = freq;
    o2.frequency.value = freq / 2;
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(220, t + 0.18);
    this.env(g, t, 0.005, 0.1, 0.55, 0.3, dur, 0.06);
    o.connect(f);
    o2.connect(f);
    f.connect(g);
    g.connect(this.master);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.1);
    o2.stop(t + dur + 0.1);
  }

  stab(notes, t) {
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.15);
    this.env(g, t, 0.005, 0.08, 0.16, 0.06, STEP * 1.2, 0.05);
    notes.forEach((n, i) => {
      const o = this.ctx.createOscillator();
      o.type = i % 2 ? 'square' : 'triangle';
      o.frequency.value = hz(n);
      o.detune.value = (i - 1.5) * 6;
      o.connect(f);
      o.start(t);
      o.stop(t + STEP * 1.5);
    });
    f.connect(g);
    g.connect(this.master);
  }

  lead(freq, t, dur) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const v = this.ctx.createOscillator();
    const vg = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    v.frequency.value = 5.5;
    vg.gain.value = 4;
    v.connect(vg);
    vg.connect(o.detune);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3200;
    this.env(g, t, 0.01, 0.05, this.intensity < 1 ? 0.08 : 0.13, this.intensity < 1 ? 0.06 : 0.1, dur, 0.08);
    o.connect(f);
    f.connect(g);
    g.connect(this.master);
    o.start(t);
    v.start(t);
    o.stop(t + dur + 0.1);
    v.stop(t + dur + 0.1);
  }
}
