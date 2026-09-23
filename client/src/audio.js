// Tiny synthesized sound effects via WebAudio. No audio files needed.
class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
  }

  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
    return this.muted;
  }

  _noise(duration, { freq = 1200, q = 1, gain = 0.5 } = {}) {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
  }

  _tone(freq, duration, { type = 'sine', gain = 0.3, delay = 0 } = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    const t0 = ctx.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  hit(power) {
    if (!this.ensure()) return;
    this._noise(0.08, { freq: 2200, q: 0.8, gain: 0.25 + power * 0.5 });
    this._tone(180 + power * 120, 0.09, { type: 'triangle', gain: 0.2 + power * 0.3 });
  }

  bounce(strength) {
    if (!this.ensure()) return;
    const s = Math.min(1, strength);
    this._noise(0.06, { freq: 700, q: 1.2, gain: 0.15 + s * 0.4 });
    this._tone(120, 0.07, { type: 'sine', gain: 0.1 + s * 0.25 });
  }

  sink() {
    if (!this.ensure()) return;
    this._noise(0.12, { freq: 500, q: 1, gain: 0.35 });
    this._tone(523, 0.18, { gain: 0.25, delay: 0.05 });
    this._tone(659, 0.18, { gain: 0.25, delay: 0.17 });
    this._tone(784, 0.3, { gain: 0.3, delay: 0.29 });
  }

  splash() {
    if (!this.ensure()) return;
    this._noise(0.35, { freq: 900, q: 0.5, gain: 0.35 });
    this._tone(220, 0.3, { type: 'sine', gain: 0.15 });
  }

  correct() {
    if (!this.ensure()) return;
    this._tone(587, 0.14, { gain: 0.22 });
    this._tone(740, 0.14, { gain: 0.22, delay: 0.12 });
    this._tone(988, 0.26, { gain: 0.26, delay: 0.24 });
  }

  fail() {
    if (!this.ensure()) return;
    this._tone(330, 0.2, { type: 'square', gain: 0.08 });
    this._tone(262, 0.3, { type: 'square', gain: 0.08, delay: 0.18 });
  }
}

export const audio = new GameAudio();
