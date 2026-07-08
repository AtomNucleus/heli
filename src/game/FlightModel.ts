import * as THREE from 'three';

export type AssistMode = 'arcade' | 'realistic';

export interface FlightState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  quaternion: THREE.Quaternion;
  angularVelocity: THREE.Vector3;
  collective: number;
  cyclicPitch: number;
  cyclicRoll: number;
  pedal: number;
  rpm: number;
  onGround: boolean;
  agl: number;
  crashed: boolean;
}

export interface FlightInput {
  collective: number; // -1..1 desired change rate or absolute assist
  cyclicPitch: number; // -1..1
  cyclicRoll: number; // -1..1
  pedal: number; // -1..1
  boost: boolean;
  autoLevel: boolean;
}

const GRAVITY = 9.81;
const MAX_COLLECTIVE = 1;
const AIR_DENSITY = 1.2;

export class FlightModel {
  mode: AssistMode = 'arcade';
  state: FlightState;

  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler();
  private readonly tmpV = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly liftDir = new THREE.Vector3();

  constructor(spawn: THREE.Vector3) {
    this.state = {
      position: spawn.clone(),
      velocity: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      angularVelocity: new THREE.Vector3(),
      collective: 0.35,
      cyclicPitch: 0,
      cyclicRoll: 0,
      pedal: 0,
      rpm: 0,
      onGround: true,
      agl: 0,
      crashed: false,
    };
  }

  reset(spawn: THREE.Vector3, heading = 0) {
    this.state.position.copy(spawn);
    this.state.velocity.set(0, 0, 0);
    this.state.angularVelocity.set(0, 0, 0);
    this.state.quaternion.setFromAxisAngle(this.up, heading);
    this.state.collective = 0.35;
    this.state.cyclicPitch = 0;
    this.state.cyclicRoll = 0;
    this.state.pedal = 0;
    this.state.rpm = 0;
    this.state.onGround = true;
    this.state.agl = 0;
    this.state.crashed = false;
  }

  toggleMode(): AssistMode {
    this.mode = this.mode === 'arcade' ? 'realistic' : 'arcade';
    return this.mode;
  }

  update(
    dt: number,
    input: FlightInput,
    terrainHeight: number,
    waterLevel: number,
  ): void {
    if (this.state.crashed) return;

    const s = this.state;
    const arcade = this.mode === 'arcade';

    // RPM spool
    const targetRpm = 0.55 + s.collective * 0.45;
    s.rpm += (targetRpm - s.rpm) * Math.min(1, dt * 1.8);
    s.rpm = THREE.MathUtils.clamp(s.rpm, 0, 1.05);

    // Collective
    const collRate = arcade ? 0.85 : 0.55;
    s.collective += input.collective * collRate * dt;
    if (input.boost) s.collective += 0.35 * dt;
    s.collective = THREE.MathUtils.clamp(s.collective, 0.05, MAX_COLLECTIVE);

    // Cyclic / pedal with smoothing
    const cyclicLag = arcade ? 8 : 4.5;
    s.cyclicPitch += (input.cyclicPitch - s.cyclicPitch) * Math.min(1, dt * cyclicLag);
    s.cyclicRoll += (input.cyclicRoll - s.cyclicRoll) * Math.min(1, dt * cyclicLag);
    s.pedal += (input.pedal - s.pedal) * Math.min(1, dt * (arcade ? 10 : 6));

    // Orientation from angular rates
    const pitchRate = s.cyclicPitch * (arcade ? 1.35 : 1.0);
    const rollRate = s.cyclicRoll * (arcade ? 1.55 : 1.15);
    const yawRate = s.pedal * (arcade ? 1.4 : 1.05) * (0.4 + s.rpm * 0.6);

    s.angularVelocity.x = THREE.MathUtils.lerp(s.angularVelocity.x, pitchRate, Math.min(1, dt * 6));
    s.angularVelocity.z = THREE.MathUtils.lerp(s.angularVelocity.z, -rollRate, Math.min(1, dt * 6));
    s.angularVelocity.y = THREE.MathUtils.lerp(s.angularVelocity.y, yawRate, Math.min(1, dt * 6));

    // Auto-level
    if (input.autoLevel || (arcade && Math.abs(input.cyclicPitch) < 0.05 && Math.abs(input.cyclicRoll) < 0.05)) {
      this.tmpEuler.setFromQuaternion(s.quaternion, 'YXZ');
      const levelStrength = input.autoLevel ? 2.2 : arcade ? 0.9 : 0.25;
      this.tmpEuler.x *= Math.max(0, 1 - levelStrength * dt);
      this.tmpEuler.z *= Math.max(0, 1 - levelStrength * dt);
      s.quaternion.setFromEuler(this.tmpEuler);
    }

    this.tmpQ.setFromEuler(
      new THREE.Euler(s.angularVelocity.x * dt, s.angularVelocity.y * dt, s.angularVelocity.z * dt, 'YXZ'),
    );
    s.quaternion.multiply(this.tmpQ);
    s.quaternion.normalize();

    // Clamp extreme attitudes in arcade
    if (arcade) {
      this.tmpEuler.setFromQuaternion(s.quaternion, 'YXZ');
      this.tmpEuler.x = THREE.MathUtils.clamp(this.tmpEuler.x, -0.85, 0.85);
      this.tmpEuler.z = THREE.MathUtils.clamp(this.tmpEuler.z, -0.95, 0.95);
      s.quaternion.setFromEuler(this.tmpEuler);
    }

    // Local axes
    this.forward.set(0, 0, -1).applyQuaternion(s.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(s.quaternion);
    this.liftDir.copy(this.up).applyQuaternion(s.quaternion);

    // Thrust / lift
    const hoverCollective = arcade ? 0.42 : 0.48;
    const excess = s.collective - hoverCollective;
    const thrustMag = (12 + excess * 28) * s.rpm * s.rpm;
    const mass = arcade ? 1.0 : 1.25;

    this.tmpV.copy(this.liftDir).multiplyScalar(thrustMag / mass);

    // Translational lift / forward bias from nose-down pitch
    this.tmpEuler.setFromQuaternion(s.quaternion, 'YXZ');
    this.tmpV.addScaledVector(this.forward, thrustMag * 0.35 * Math.max(0, -this.tmpEuler.x));

    // Gravity
    this.tmpV.y -= GRAVITY;

    // Drag
    const speed = s.velocity.length();
    const dragCoeff = arcade ? 0.55 : 0.35;
    if (speed > 0.01) {
      this.tmpV.addScaledVector(s.velocity, -dragCoeff * AIR_DENSITY * speed * 0.08);
    }

    // Ground effect
    const gearClearance = 1.35;
    const groundY = Math.max(terrainHeight, waterLevel) + gearClearance;
    s.agl = s.position.y - groundY;
    if (s.agl < 8 && s.agl > 0) {
      const ge = (1 - s.agl / 8) * 4.5 * s.rpm;
      this.tmpV.y += ge;
    }

    s.velocity.addScaledVector(this.tmpV, dt);

    // Soft speed limit
    const maxSpeed = arcade ? 55 : 48;
    if (s.velocity.length() > maxSpeed) {
      s.velocity.setLength(maxSpeed);
    }

    s.position.addScaledVector(s.velocity, dt);

    // Terrain / water collision
    s.agl = s.position.y - groundY;
    if (s.agl < 0) {
      s.position.y = groundY;
      const impact = -s.velocity.y;
      if (impact > (arcade ? 14 : 10) || speed > (arcade ? 42 : 35)) {
        s.crashed = true;
        s.velocity.set(0, 0, 0);
        return;
      }
      s.velocity.y = Math.max(0, -s.velocity.y * 0.15);
      s.velocity.x *= 0.85;
      s.velocity.z *= 0.85;
      s.onGround = true;

      // Settle attitude on ground
      if (s.collective < hoverCollective + 0.05) {
        this.tmpEuler.setFromQuaternion(s.quaternion, 'YXZ');
        this.tmpEuler.x *= 0.9;
        this.tmpEuler.z *= 0.9;
        s.quaternion.setFromEuler(this.tmpEuler);
        if (s.collective < hoverCollective - 0.02) {
          s.velocity.x *= 0.7;
          s.velocity.z *= 0.7;
        }
      }
    } else {
      s.onGround = false;
    }

    // Lateral soft push from steep terrain slope approximation: keep above water
    if (s.position.y < waterLevel + 0.5 && !s.crashed) {
      // skim — already handled via groundY
    }
  }

  getAirspeed(): number {
    return this.state.velocity.length();
  }

  getVerticalSpeed(): number {
    return this.state.velocity.y;
  }

  getHeading(): number {
    this.tmpEuler.setFromQuaternion(this.state.quaternion, 'YXZ');
    let h = THREE.MathUtils.radToDeg(this.tmpEuler.y);
    h = ((h % 360) + 360) % 360;
    return h;
  }

  getAttitude(): { pitch: number; roll: number } {
    this.tmpEuler.setFromQuaternion(this.state.quaternion, 'YXZ');
    return { pitch: this.tmpEuler.x, roll: this.tmpEuler.z };
  }
}
