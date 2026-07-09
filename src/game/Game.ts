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
  /** Shared sun direction (sky + directional light + water). */
  readonly sun = new THREE.Vector3();
  private sunLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;
  private rimTarget = new THREE.Object3D();
  private hemiLight!: THREE.HemisphereLight;
  private fillLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private sky!: Sky;
  private readonly _sunWorld = new THREE.Vector3();
  private readonly _sunNdc = new THREE.Vector3();

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
    // Balance: readable dusk without white-blown sun
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Teal dusk fog — light enough that the island stays readable
    const fogColor = new THREE.Color(0x1a4858);
    this.scene.fog = new THREE.FogExp2(fogColor.getHex(), 0.0025);
    this.scene.background = fogColor.clone();

    this.setupLighting();
    this.sky = this.setupSky();
    const envMap = this.buildEnvMap(this.sky);

    // Match water sun to directional light direction
    const sunDir = this.sun.clone().normalize();
    this.world = new World({
      envMap,
      sunDirection: sunDir,
    });
    this.world.setEnvMap(envMap);
    this.world.water.setSunDirection(sunDir);
    this.scene.add(this.world.group);

    this.heli = new Helicopter(envMap);
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
    // Strong fill so foreground isn't crushed; dusk mood via warm sun + teal fog
    this.hemiLight = new THREE.HemisphereLight(0xb0e0f5, 0x2a4030, 1.1);
    this.scene.add(this.hemiLight);

    // Lower sun elevation for longer orange rim (phi closer to horizon)
    this.sun.setFromSphericalCoords(1, THREE.MathUtils.degToRad(87), THREE.MathUtils.degToRad(155));

    this.sunLight = new THREE.DirectionalLight(0xffa868, 1.05);
    this.sunLight.position.copy(this.sun).multiplyScalar(160);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 400;
    this.sunLight.shadow.camera.left = -120;
    this.sunLight.shadow.camera.right = 120;
    this.sunLight.shadow.camera.top = 120;
    this.sunLight.shadow.camera.bottom = -120;
    this.sunLight.shadow.bias = -0.00015;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight(0x5aa0b8, 0.72);
    this.fillLight.position.set(-50, 40, -40);
    this.scene.add(this.fillLight);

    // Cool bounce from opposite side softens shadow wells
    const bounce = new THREE.DirectionalLight(0x3a6878, 0.35);
    bounce.position.set(30, 20, 50);
    this.scene.add(bounce);

    this.ambientLight = new THREE.AmbientLight(0x244840, 0.45);
    this.scene.add(this.ambientLight);

    // Warm orange rim from sun direction — tracks heli each frame
    this.rimLight = new THREE.DirectionalLight(0xff9048, 1.15);
    this.rimLight.castShadow = false;
    this.rimTarget.position.set(0, 0, 0);
    this.scene.add(this.rimTarget);
    this.rimLight.target = this.rimTarget;
    this.scene.add(this.rimLight);
  }

  private setupSky(): Sky {
    const sky = new Sky();
    sky.scale.setScalar(4500);
    const u = sky.material.uniforms;
    // Cleaner gradient — low turbidity/mie keeps sun warm orange, not white disc
    u['turbidity'].value = 2.2;
    u['rayleigh'].value = 2.6;
    u['mieCoefficient'].value = 0.0018;
    u['mieDirectionalG'].value = 0.62;
    u['sunPosition'].value.copy(this.sun);
    this.scene.add(sky);
    return sky;
  }

  /** Prefilter the sky into an env map so the metallic airframe reflects it. */
  private buildEnvMap(sky: Sky): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const skyClone = sky.clone();
    envScene.add(skyClone);
    const rt = pmrem.fromScene(envScene, 0, 0.1, 1000);
    pmrem.dispose();
    return rt.texture;
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

  private updateRimLight() {
    const heliPos = this.flight.state.position;
    this.rimTarget.position.copy(heliPos);
    // Place rim light along sun direction so warm edge light reads on the airframe
    this.rimLight.position.copy(heliPos).addScaledVector(this.sun, 40);
    this.rimLight.target.updateMatrixWorld();
  }

  private updateSunGlare() {
    // Project sun far along direction into NDC for screen-space glare
    this._sunWorld.copy(this.cameraRig.camera.position).addScaledVector(this.sun, 800);
    this._sunNdc.copy(this._sunWorld).project(this.cameraRig.camera);
    const visible = this._sunNdc.z < 1 ? 1 : 0;
    const sx = this._sunNdc.x * 0.5 + 0.5;
    const sy = this._sunNdc.y * 0.5 + 0.5;
    // Fade when near/off screen edges
    const edge =
      THREE.MathUtils.clamp(1 - Math.abs(this._sunNdc.x), 0, 1) *
      THREE.MathUtils.clamp(1 - Math.abs(this._sunNdc.y), 0, 1);
    this.postfx.setSunScreenPos(sx, sy, visible * edge);
  }

  private isOverWater(): boolean {
    const p = this.flight.state.position;
    const h = this.world.getHeight(p.x, p.z);
    return h < this.world.waterLevel + 0.6;
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;

    this.world.update(dt);
    // Keep water sun synced (mirror specular matches dusk directional)
    this.world.water.setSunDirection(this.sun);
    this.updateRimLight();

    if (this.phase === 'title' || this.phase === 'briefing') {
      // Attract: parked heli, slow orbit — still drive grass/gravel lightly
      this.flight.state.rpm = 0.15 + Math.sin(this.elapsed * 0.5) * 0.02;
      this.heli.update(dt, this.flight.state.rpm, 1.2, 0, true, false, false);
      this.syncHeliFromFlight();
      this.world.updateEffects(
        this.flight.state.position,
        this.flight.state.rpm,
        1.2,
        true,
        dt,
      );
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
    const overWater = this.isOverWater();
    this.heli.update(
      dt,
      this.flight.state.rpm,
      this.flight.state.agl,
      speed,
      this.flight.state.onGround,
      raw.boost,
      overWater,
    );
    this.world.updateEffects(
      this.flight.state.position,
      this.flight.state.rpm,
      this.flight.state.agl,
      this.flight.state.onGround,
      dt,
    );

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
    this.updateSunGlare();
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
