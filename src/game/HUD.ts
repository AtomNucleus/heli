export interface HudData {
  airspeedKts: number;
  altAglFt: number;
  altMslFt: number;
  vsFpm: number;
  heading: number;
  pitch: number;
  roll: number;
  rpm: number;
  ringIndex: number;
  ringTotal: number;
  timerSec: number;
  mode: string;
  camera: string;
  lowAlt: boolean;
  overspeed: boolean;
  warning?: string;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${pad2(m)}:${s.toFixed(1).padStart(4, '0')}`;
}

export class HUD {
  private root: HTMLElement;
  private airspeed: HTMLElement;
  private alt: HTMLElement;
  private msl: HTMLElement;
  private vs: HTMLElement;
  private rpm: HTMLElement;
  private ring: HTMLElement;
  private timer: HTMLElement;
  private mode: HTMLElement;
  private cam: HTMLElement;
  private warnings: HTMLElement;
  private horizon: HTMLElement;
  private headingTrack: HTMLElement;
  private builtHeading = false;

  constructor() {
    this.root = document.getElementById('hud')!;
    this.airspeed = document.getElementById('hud-airspeed')!;
    this.alt = document.getElementById('hud-alt')!;
    this.msl = document.getElementById('hud-msl')!;
    this.vs = document.getElementById('hud-vs')!;
    this.rpm = document.getElementById('hud-rpm')!;
    this.ring = document.getElementById('hud-ring')!;
    this.timer = document.getElementById('hud-timer')!;
    this.mode = document.getElementById('hud-mode')!;
    this.cam = document.getElementById('hud-cam')!;
    this.warnings = document.getElementById('hud-warnings')!;
    this.horizon = document.getElementById('attitude-horizon')!;
    this.headingTrack = document.getElementById('heading-track')!;
    this.buildHeadingTape();
  }

  show() {
    this.root.classList.remove('hidden');
    requestAnimationFrame(() => this.root.classList.add('visible'));
  }

  hide() {
    this.root.classList.remove('visible');
    this.root.classList.add('hidden');
  }

  update(d: HudData) {
    this.airspeed.textContent = `${Math.round(d.airspeedKts)}`;
    this.alt.textContent = `${Math.round(d.altAglFt)}`;
    this.msl.textContent = `${Math.round(d.altMslFt)}`;
    this.vs.textContent = `${Math.round(d.vsFpm)}`;
    this.rpm.textContent = `${Math.round(d.rpm * 100)}`;
    this.ring.textContent = `${Math.min(d.ringIndex, d.ringTotal)}/${d.ringTotal}`;
    this.timer.textContent = formatTime(d.timerSec);
    this.mode.textContent = d.mode.toUpperCase();
    this.cam.textContent = d.camera.toUpperCase();

    // Attitude
    const pitchPx = (-d.pitch * 180) / Math.PI * 0.9;
    const rollDeg = (-d.roll * 180) / Math.PI;
    this.horizon.style.transform = `translateY(${pitchPx}px) rotate(${rollDeg}deg)`;

    // Heading tape: center mark at heading
    const markWidth = 40;
    const offset = -((d.heading / 360) * 36 * markWidth) + this.headingTrack.parentElement!.clientWidth / 2 - markWidth / 2;
    this.headingTrack.style.transform = `translateX(${offset}px)`;

    const msgs: string[] = [];
    if (d.warning) msgs.push(d.warning);
    if (d.lowAlt) msgs.push('LOW ALTITUDE');
    if (d.overspeed) msgs.push('OVERSPEED');
    this.warnings.textContent = msgs.join('  ·  ');
    this.warnings.classList.toggle('critical', d.lowAlt || d.overspeed || !!d.warning);
  }

  private buildHeadingTape() {
    if (this.builtHeading) return;
    this.builtHeading = true;
    const tape = document.getElementById('heading-tape')!;
    if (!tape.querySelector('.center-tick')) {
      const tick = document.createElement('div');
      tick.className = 'center-tick';
      tape.appendChild(tick);
    }
    // 0..360 every 10 deg, repeated 3x for wrap
    let html = '';
    for (let rep = 0; rep < 3; rep++) {
      for (let h = 0; h < 360; h += 10) {
        const label =
          h === 0 ? 'N' : h === 90 ? 'E' : h === 180 ? 'S' : h === 270 ? 'W' : `${h}`;
        html += `<span class="heading-mark"><span class="tick"></span>${label}</span>`;
      }
    }
    this.headingTrack.innerHTML = html;
  }
}
