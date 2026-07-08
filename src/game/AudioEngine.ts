export class AudioEngine {
  private ctx: AudioContext | null = null;
  private rotorOsc: OscillatorNode | null = null;
  private rotorGain: GainNode | null = null;
  private rotorFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private noiseSrc: AudioBufferSourceNode | null = null;
  private master: GainNode | null = null;
  private started = false;
  private muted = false;

  async resume() {
    if (!this.ctx) this.init();
    if (this.ctx!.state === 'suspended') await this.ctx!.resume();
    if (!this.started) this.startNodes();
  }

  private init() {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  private startNodes() {
    if (!this.ctx || !this.master || this.started) return;
    this.started = true;

    // Rotor: dual oscillators through filter
    this.rotorOsc = this.ctx.createOscillator();
    this.rotorOsc.type = 'sawtooth';
    this.rotorOsc.frequency.value = 42;
    this.rotorGain = this.ctx.createGain();
    this.rotorGain.gain.value = 0;
    this.rotorFilter = this.ctx.createBiquadFilter();
    this.rotorFilter.type = 'lowpass';
    this.rotorFilter.frequency.value = 280;
    this.rotorFilter.Q.value = 0.7;
    this.rotorOsc.connect(this.rotorFilter);
    this.rotorFilter.connect(this.rotorGain);
    this.rotorGain.connect(this.master);
    this.rotorOsc.start();

    // Wind / broadband noise
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    this.noiseSrc = this.ctx.createBufferSource();
    this.noiseSrc.buffer = buffer;
    this.noiseSrc.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 600;
    this.windFilter.Q.value = 0.6;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    this.noiseSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    this.noiseSrc.start();
  }

  update(rpm: number, speed: number, enabled: boolean) {
    if (!this.started || !this.rotorOsc || !this.rotorGain || !this.windGain || !this.ctx) return;
    if (this.muted || !enabled) {
      this.rotorGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      return;
    }

    const t = this.ctx.currentTime;
    this.rotorOsc.frequency.setTargetAtTime(28 + rpm * 55, t, 0.05);
    if (this.rotorFilter) {
      this.rotorFilter.frequency.setTargetAtTime(180 + rpm * 320, t, 0.08);
    }
    this.rotorGain.gain.setTargetAtTime(0.04 + rpm * 0.18, t, 0.08);

    const wind = Math.min(1, speed / 45);
    this.windGain.gain.setTargetAtTime(wind * 0.12 + rpm * 0.03, t, 0.1);
    if (this.windFilter) {
      this.windFilter.frequency.setTargetAtTime(400 + wind * 1200, t, 0.1);
    }
  }

  blip(freq = 880, dur = 0.08) {
    if (!this.ctx || !this.master || !this.started || this.muted) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'square';
    g.gain.value = 0.08;
    osc.connect(g);
    g.connect(this.master);
    osc.start();
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    osc.stop(this.ctx.currentTime + dur);
  }

  setMuted(m: boolean) {
    this.muted = m;
  }
}
