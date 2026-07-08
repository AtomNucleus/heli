import * as THREE from 'three';

export type CameraMode = 'chase' | 'cockpit' | 'orbit';

export class CameraRig {
  mode: CameraMode = 'chase';
  readonly camera: THREE.PerspectiveCamera;

  private orbitAngle = 0.4;
  private orbitPitch = 0.35;
  private orbitDist = 18;
  private shake = 0;

  private readonly desired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly currentPos = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 2000);
    this.camera.position.set(0, 12, 24);
    this.currentPos.copy(this.camera.position);
  }

  cycle(): CameraMode {
    const order: CameraMode[] = ['chase', 'cockpit', 'orbit'];
    const i = order.indexOf(this.mode);
    this.mode = order[(i + 1) % order.length];
    return this.mode;
  }

  setAttract(heliPos: THREE.Vector3, t: number) {
    const r = 28;
    this.camera.position.set(
      heliPos.x + Math.cos(t * 0.12) * r,
      heliPos.y + 10 + Math.sin(t * 0.08) * 3,
      heliPos.z + Math.sin(t * 0.12) * r,
    );
    this.camera.lookAt(heliPos.x, heliPos.y + 1, heliPos.z);
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
    this.currentPos.copy(this.camera.position);
  }

  update(
    dt: number,
    heliPos: THREE.Vector3,
    heliQuat: THREE.Quaternion,
    speed: number,
    introBlend = 1,
  ) {
    const baseFov = 58;
    const rush = THREE.MathUtils.clamp(speed / 50, 0, 1);
    const targetFov = baseFov + rush * 12;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 3));

    if (this.mode === 'chase') {
      this.tmp.set(0, 4.5, 14).applyQuaternion(heliQuat);
      this.desired.copy(heliPos).add(this.tmp);
      this.look.copy(heliPos).add(new THREE.Vector3(0, 1.2, -6).applyQuaternion(heliQuat));
      this.currentPos.lerp(this.desired, Math.min(1, dt * 3.5));
    } else if (this.mode === 'cockpit') {
      this.tmp.set(0, 0.55, -0.35).applyQuaternion(heliQuat);
      this.desired.copy(heliPos).add(this.tmp);
      this.currentPos.lerp(this.desired, Math.min(1, dt * 12));
      this.look.copy(heliPos).add(new THREE.Vector3(0, 0.4, -12).applyQuaternion(heliQuat));
    } else {
      this.orbitAngle += dt * 0.15;
      this.desired.set(
        heliPos.x + Math.cos(this.orbitAngle) * this.orbitDist * Math.cos(this.orbitPitch),
        heliPos.y + Math.sin(this.orbitPitch) * this.orbitDist + 4,
        heliPos.z + Math.sin(this.orbitAngle) * this.orbitDist * Math.cos(this.orbitPitch),
      );
      this.currentPos.lerp(this.desired, Math.min(1, dt * 2.5));
      this.look.copy(heliPos);
    }

    // Intro blend from attract-ish high angle
    if (introBlend < 1) {
      const intro = new THREE.Vector3(heliPos.x + 20, heliPos.y + 18, heliPos.z + 24);
      this.currentPos.lerpVectors(intro, this.currentPos, introBlend);
    }

    if (this.shake > 0) {
      this.currentPos.x += (Math.random() - 0.5) * this.shake;
      this.currentPos.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 4);
    }

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.look);
    this.camera.updateProjectionMatrix();
  }

  addShake(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
