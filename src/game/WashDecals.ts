import * as THREE from 'three';

/**
 * Expanding/fading rotor-wash ring decals on water and grass when AGL is low.
 * Uses a small InstancedMesh pool — one draw call.
 */
export class WashDecals {
  readonly mesh: THREE.InstancedMesh;
  private readonly max = 12;
  private readonly ages: Float32Array;
  private readonly radii: Float32Array;
  private readonly strengths: Float32Array;
  private readonly positions: Float32Array;
  private readonly overWater: Uint8Array;
  private spawnAcc = 0;
  private dummy = new THREE.Object3D();
  private waterLevel: number;

  constructor(waterLevel: number) {
    this.waterLevel = waterLevel;
    const geo = new THREE.RingGeometry(0.85, 1.0, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xd8ece8,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = this.max;

    this.ages = new Float32Array(this.max);
    this.radii = new Float32Array(this.max);
    this.strengths = new Float32Array(this.max);
    this.positions = new Float32Array(this.max * 3);
    this.overWater = new Uint8Array(this.max);

    for (let i = 0; i < this.max; i++) {
      this.ages[i] = 999;
      this.dummy.scale.set(0.001, 0.001, 0.001);
      this.dummy.position.set(0, -100, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(
    heliPos: THREE.Vector3,
    rpm: number,
    agl: number,
    onGround: boolean,
    overWater: boolean,
    groundY: number,
    dt: number,
  ) {
    const wash = rpm * THREE.MathUtils.clamp(1 - agl / 10, 0, 1);
    const groundBoost = onGround && rpm > 0.3 ? rpm * 0.4 : 0;
    const strength = Math.max(wash, groundBoost);

    this.spawnAcc += dt;
    if (strength > 0.12 && this.spawnAcc > 0.18) {
      this.spawnAcc = 0;
      this.spawn(heliPos.x, overWater ? this.waterLevel + 0.04 : groundY + 0.06, heliPos.z, strength, overWater);
    }

    const colors = this.mesh.instanceColor;
    if (!colors) {
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    }
    const colorAttr = this.mesh.instanceColor!;

    for (let i = 0; i < this.max; i++) {
      this.ages[i] += dt;
      const life = 1.1;
      if (this.ages[i] > life) {
        this.dummy.scale.set(0.001, 0.001, 0.001);
        this.dummy.position.set(0, -100, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      const t = this.ages[i] / life;
      const fade = (1 - t) * (1 - t) * this.strengths[i];
      const r = this.radii[i] * (0.6 + t * 2.4);
      const y = this.positions[i * 3 + 1];
      this.dummy.position.set(this.positions[i * 3], y, this.positions[i * 3 + 2]);
      this.dummy.rotation.set(-Math.PI / 2, 0, t * 0.4);
      this.dummy.scale.set(r, r, r);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);

      if (this.overWater[i]) {
        colorAttr.setXYZ(i, 0.75 * fade, 0.92 * fade, 0.95 * fade);
      } else {
        colorAttr.setXYZ(i, 0.55 * fade, 0.5 * fade, 0.35 * fade);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  private spawn(x: number, y: number, z: number, strength: number, overWater: boolean) {
    let best = 0;
    let bestAge = -1;
    for (let i = 0; i < this.max; i++) {
      if (this.ages[i] > bestAge) {
        bestAge = this.ages[i];
        best = i;
      }
    }
    this.ages[best] = 0;
    this.radii[best] = 1.2 + strength * 1.8;
    this.strengths[best] = Math.min(1, strength * 1.2);
    this.positions[best * 3] = x + (Math.random() - 0.5) * 0.6;
    this.positions[best * 3 + 1] = y;
    this.positions[best * 3 + 2] = z + (Math.random() - 0.5) * 0.6;
    this.overWater[best] = overWater ? 1 : 0;
  }
}
