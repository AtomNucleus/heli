import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { World } from './World';
import { Helicopter } from './Helicopter';
import { FlightModel, FlightInput } from './FlightModel';
import { Input } from './Input';
import { CameraRig } from './CameraRig';
import { HUD, formatTime } from './HUD';
import { AudioEngine } from './AudioEngine';
import { PostFX } from './PostFX';

export type GamePhase = 'title' | 'briefing' | 'playing' | 'paused' | 'complete' | 'crash';

const BEST_KEY = 'heli-strike-best-time';
const MS_TO_KTS = 1.94384;
const M_TO_FT = 3.28084;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly world: World;
  readonly heli: Helicopter;
  readonly flight: FlightModel;
  readonly input: Input;
  readonly cameraRig: CameraRig;
  readonly hud: HUD;
  readonly audio = new AudioEngine();
  readonly postfx: PostFX;

  phase: GamePhase = 'title';
  private clock = new THREE.Clock();
  private elapsed = 0;
  private missionTime = 0;
  private introBlend = 0;
  private landedBonus = false;
  private awaitingLand = false;
  private landWindow = 0;
  private animId = 0;
  private sun = new THREE.Vector3();

  onPhaseChange?: (phase: GamePhase) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.fog = new THREE.FogExp2(0x071018, 0.0042);
    this.scene.background = new THREE.Color(0x071018);

    this.setupLighting();
    this.setupSky();

    this.world = new World();
    this.scene.add(this.world.group);

    this.heli = new Helicopter();
    this.scene.add(this.heli.group);

    this.flight = new FlightModel(this.world.spawn);
    this.syncHeliFromFlight();

    this.input = new Input(canvas);
    this.cameraRig = new CameraRig(window.innerWidth / window.innerHeight);
    this.hud = new HUD();
    this.postfx = new PostFX(this.renderer, this.scene, this.cameraRig.camera);

    window.addEventListener('resize', () => this.onResize());
  }

  private setupLighting() {
    const hemi = new THREE.HemisphereLight(0x8ec8e0, 0x1a2a18, 0.55);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff0d8, 1.65);
    sun.position.set(80, 120, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 400;
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120;
    sun.shadow.camera.bottom = -120;
    sun.shadow.bias = -0.0002;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x3a6a80, 0.25);
    fill.position.set(-40, 30, -60);
    this.scene.add(fill);

    const ambient = new THREE.AmbientLight(0x102018, 0.15);
    this.scene.add(ambient);
  }

  private setupSky() {
    const sky = new Sky();
    sky.scale.setScalar(4500);
    const u = sky.material.uniforms;
    u['turbidity'].value = 4.5;
    u['rayleigh'].value = 1.8;
    u['mieCoefficient'].value = 0.004;
    u['mieDirectionalG'].value = 0.75;
    this.sun.setFromSphericalCoords(1, THREE.MathUtils.degToRad(88), THREE.MathUtils.degToRad(160));
    u['sunPosition'].value.copy(this.sun);
    this.scene.add(sky);
  }

  start() {
    this.clock.start();
    const loop = () => {
      this.animId = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  private setPhase(p: GamePhase) {
    this.phase = p;
    this.onPhaseChange?.(p);
  }

  enterFlight() {
    this.resetMission();
    this.introBlend = 0;
    this.setPhase('playing');
    this.hud.show();
    void this.audio.resume();
    this.input.requestPointerLock();
  }

  showTitle() {
    this.input.exitPointerLock();
    this.hud.hide();
    this.audio.update(0.2, 0, false);
    this.setPhase('title');
    this.flight.reset(this.world.spawn, 0.4);
    this.syncHeliFromFlight();
    this.world.rings.reset();
  }

  pause() {
    if (this.phase !== 'playing') return;
    this.input.exitPointerLock();
    this.setPhase('paused');
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.setPhase('playing');
    this.input.requestPointerLock();
  }

  resetMission() {
    this.flight.reset(this.world.spawn, 0.4);
    this.syncHeliFromFlight();
    this.world.rings.reset();
    this.missionTime = 0;
    this.landedBonus = false;
    this.awaitingLand = false;
    this.landWindow = 0;
    this.cameraRig.mode = 'chase';
    this.introBlend = 0;
  }

  private syncHeliFromFlight() {
    this.heli.group.position.copy(this.flight.state.position);
    this.heli.group.quaternion.copy(this.flight.state.quaternion);
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;

    this.world.update(dt);

    if (this.phase === 'title' || this.phase === 'briefing') {
      // Attract: parked heli, slow orbit
      this.flight.state.rpm = 0.15 + Math.sin(this.elapsed * 0.5) * 0.02;
      this.heli.update(dt, this.flight.state.rpm, 1.2, 0, true);
      this.syncHeliFromFlight();
      this.cameraRig.setAttract(this.flight.state.position, this.elapsed);
      this.audio.update(0.15, 0, false);
      this.render();
      return;
    }

    if (this.phase === 'paused' || this.phase === 'complete' || this.phase === 'crash') {
      this.audio.update(this.flight.state.rpm * 0.3, 0, this.phase === 'paused');
      this.render();
      // Still allow reset / help edge keys
      this.input.sample();
      if (this.input.resetPressed && (this.phase === 'crash' || this.phase === 'complete')) {
        this.enterFlight();
      }
      return;
    }

    // playing
    const raw = this.input.sample();

    if (this.input.pausePressed) {
      this.pause();
      return;
    }
    if (this.input.resetPressed) {
      this.resetMission();
    }
    if (this.input.cameraPressed) {
      this.cameraRig.cycle();
    }
    if (this.input.modePressed) {
      this.flight.toggleMode();
      this.audio.blip(660, 0.06);
    }
    if (this.input.helpPressed) {
      this.pause();
      this.onPhaseChange?.('paused');
      document.getElementById('controls-overlay')?.classList.add('active');
    }

    const fin: FlightInput = {
      collective: raw.collective,
      cyclicPitch: raw.cyclicPitch,
      cyclicRoll: raw.cyclicRoll,
      pedal: raw.pedal,
      boost: raw.boost,
      autoLevel: raw.autoLevel,
    };

    const terrainH = this.world.getHeight(this.flight.state.position.x, this.flight.state.position.z);
    this.flight.update(dt, fin, terrainH, this.world.waterLevel);
    this.syncHeliFromFlight();

    const speed = this.flight.getAirspeed();
    this.heli.update(dt, this.flight.state.rpm, this.flight.state.agl, speed, this.flight.state.onGround);

    this.missionTime += dt;
    this.introBlend = Math.min(1, this.introBlend + dt * 0.55);

    if (this.world.rings.tryCollect(this.flight.state.position, dt)) {
      this.audio.blip(920 + this.world.rings.next * 40, 0.1);
      this.cameraRig.addShake(0.15);
      if (this.world.rings.complete) {
        this.awaitingLand = true;
        this.landWindow = 8;
        if (this.world.isOnPad(this.flight.state.position, this.flight.state.onGround)) {
          this.applyPadBonus();
          this.finishMission();
          this.render();
          return;
        }
      }
    }

    // After rings: land for −5s bonus, or auto-finish when window expires
    if (this.awaitingLand && this.phase === 'playing') {
      if (this.world.isOnPad(this.flight.state.position, this.flight.state.onGround)) {
        this.applyPadBonus();
        this.finishMission();
        this.render();
        return;
      }
      this.landWindow -= dt;
      if (this.landWindow <= 0) {
        this.finishMission();
        this.render();
        return;
      }
    }

    if (this.flight.state.crashed) {
      this.cameraRig.addShake(0.8);
      this.input.exitPointerLock();
      this.setPhase('crash');
      this.audio.blip(120, 0.3);
      return;
    }

    this.cameraRig.update(dt, this.flight.state.position, this.flight.state.quaternion, speed, this.introBlend);
    this.audio.update(this.flight.state.rpm, speed, true);

    const att = this.flight.getAttitude();
    const aglFt = this.flight.state.agl * M_TO_FT;
    const mslFt = this.flight.state.position.y * M_TO_FT;
    const kts = speed * MS_TO_KTS;
    const vsFpm = this.flight.getVerticalSpeed() * M_TO_FT * 60;

    let warning: string | undefined;
    if (this.awaitingLand && !this.landedBonus) {
      warning = `LAND ON PAD (−5s)  ${Math.ceil(Math.max(0, this.landWindow))}s`;
    }

    this.hud.update({
      airspeedKts: kts,
      altAglFt: Math.max(0, aglFt),
      altMslFt: mslFt,
      vsFpm,
      heading: this.flight.getHeading(),
      pitch: att.pitch,
      roll: att.roll,
      rpm: this.flight.state.rpm,
      ringIndex: this.world.rings.next,
      ringTotal: this.world.rings.count,
      timerSec: this.missionTime,
      mode: this.flight.mode,
      camera: this.cameraRig.mode,
      lowAlt: aglFt < 25 && !this.flight.state.onGround && this.flight.state.rpm > 0.4,
      overspeed: kts > 95,
      warning,
    });

    this.render();
  }

  private applyPadBonus() {
    if (this.landedBonus) return;
    this.landedBonus = true;
    this.missionTime = Math.max(0, this.missionTime - 5);
    this.audio.blip(1200, 0.15);
  }

  private finishMission() {
    if (this.phase === 'complete') return;
    this.awaitingLand = false;
    this.input.exitPointerLock();
    const best = this.loadBest();
    if (best === null || this.missionTime < best) {
      localStorage.setItem(BEST_KEY, String(this.missionTime));
    }
    this.setPhase('complete');
    const timeEl = document.getElementById('complete-time');
    const subEl = document.getElementById('complete-sub');
    if (timeEl) timeEl.textContent = formatTime(this.missionTime);
    if (subEl) {
      const b = this.loadBest();
      const bestStr = b !== null ? formatTime(b) : formatTime(this.missionTime);
      subEl.textContent = this.landedBonus
        ? `Pad bonus −5s · Best ${bestStr}`
        : `Course cleared · Best ${bestStr}`;
    }
    this.audio.blip(1400, 0.2);
  }

  loadBest(): number | null {
    const v = localStorage.getItem(BEST_KEY);
    if (!v) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  private render() {
    // Keep postfx camera in sync — RenderPass holds camera ref
    if (this.postfx.enabled) {
      this.postfx.render();
    } else {
      this.renderer.render(this.scene, this.cameraRig.camera);
    }
  }

  private onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.cameraRig.resize(w / h);
    this.postfx.setSize(w, h);
  }
}
