import * as THREE from 'three';

interface Grain {
  baseX: number;
  baseY: number;
  baseZ: number;
  ox: number;
  oy: number;
  oz: number;
  vx: number;
  vy: number;
  vz: number;
  scale: number;
  rotX: number;
  rotY: number;
  rotZ: number;
}

/** Interactive gravel grains that scatter under rotor wash / landings. */
export class Gravel {
  readonly mesh: THREE.InstancedMesh;
  private grains: Grain[] = [];
  private dummy = new THREE.Object3D();
  private dirty = true;

  constructor(getHeight: (x: number, z: number) => number, count = 3200) {
    const geo = new THREE.DodecahedronGeometry(0.12, 0);
    // Slight irregularity via non-uniform scale per instance
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6a6558,
      roughness: 0.92,
      metalness: 0.08,
      flatShading: true,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = true;

    // Dense around pads, lighter shore band
    const pads: { x: number; z: number; r: number; dens: number }[] = [
      { x: 8, z: 5, r: 14, dens: 0.55 },
      { x: -55, z: 40, r: 12, dens: 0.35 },
    ];

    let placed = 0;
    let attempts = 0;
    const maxAttempts = count * 20;

    while (placed < count && attempts < maxAttempts) {
      attempts++;
      let x: number;
      let z: number;
      const roll = Math.random();

      if (roll < 0.55) {
        // Primary pad cluster
        const p = pads[0];
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(Math.random()) * p.r;
        x = p.x + Math.cos(ang) * rad;
        z = p.z + Math.sin(ang) * rad;
      } else if (roll < 0.8) {
        // Secondary pad
        const p = pads[1];
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(Math.random()) * p.r;
        x = p.x + Math.cos(ang) * rad;
        z = p.z + Math.sin(ang) * rad;
      } else {
        // Shore / marsh gravel band
        x = (Math.random() - 0.5) * 300;
        z = (Math.random() - 0.5) * 300;
      }

      const h = getHeight(x, z);
      // Keep on solid ground near pads or low coastal band
      const nearPad =
        Math.hypot(x - 8, z - 5) < 15 || Math.hypot(x + 55, z - 40) < 13;
      if (nearPad) {
        if (h < 2.0 || h > 12) continue;
      } else {
        // Shore gravel: low elevation band
        if (h < 0.8 || h > 3.5) continue;
      }

      // Don't place right under H mark center (tiny clear)
      if (Math.hypot(x - 8, z - 5) < 1.2) continue;
      if (Math.hypot(x + 55, z - 40) < 1.2) continue;

      const scale = 0.35 + Math.random() * 0.9;
      const grain: Grain = {
        baseX: x,
        baseY: h + scale * 0.04,
        baseZ: z,
        ox: 0,
        oy: 0,
        oz: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        scale,
        rotX: Math.random() * Math.PI,
        rotY: Math.random() * Math.PI,
        rotZ: Math.random() * Math.PI,
      };
      this.grains.push(grain);
      this.writeInstance(placed, grain);
      placed++;
    }

    this.mesh.count = placed;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dirty = false;
  }

  private writeInstance(i: number, g: Grain) {
    this.dummy.position.set(g.baseX + g.ox, g.baseY + g.oy, g.baseZ + g.oz);
    this.dummy.rotation.set(g.rotX, g.rotY, g.rotZ);
    this.dummy.scale.set(g.scale, g.scale * 0.65, g.scale * 0.85);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
  }

  update(
    heliPos: THREE.Vector3,
    rpm: number,
    agl: number,
    onGround: boolean,
    dt: number,
  ) {
    const heightFactor = THREE.MathUtils.clamp(1 - agl / 8, 0, 1);
    let wash = rpm * rpm * heightFactor;
    if (onGround && rpm > 0.25) wash = Math.max(wash, rpm * 0.85);
    // Impulse radius around heli
    const radius = 9 + wash * 4;
    const impulse = wash * 18;

    let any = false;
    for (let i = 0; i < this.grains.length; i++) {
      const g = this.grains[i];
      const dx = g.baseX + g.ox - heliPos.x;
      const dz = g.baseZ + g.oz - heliPos.z;
      const dist = Math.hypot(dx, dz);

      if (wash > 0.08 && dist < radius && dist > 0.15) {
        const fall = 1 - dist / radius;
        const force = impulse * fall * fall;
        const inv = 1 / dist;
        g.vx += dx * inv * force * dt;
        g.vz += dz * inv * force * dt;
        g.vy += force * 0.12 * dt;
        // Tumble
        g.rotX += g.vx * dt * 2;
        g.rotZ += g.vz * dt * 2;
      }

      // Integrate
      g.ox += g.vx * dt;
      g.oy += g.vy * dt;
      g.oz += g.vz * dt;

      // Gravity + ground clamp
      g.vy -= 9.5 * dt;
      if (g.oy < 0) {
        g.oy = 0;
        g.vy *= -0.25;
        if (Math.abs(g.vy) < 0.05) g.vy = 0;
      }

      // Spring back toward rest + damping (alive repeated landings)
      g.vx += -g.ox * 1.8 * dt;
      g.vz += -g.oz * 1.8 * dt;
      g.vx *= Math.exp(-3.2 * dt);
      g.vz *= Math.exp(-3.2 * dt);
      g.vy *= Math.exp(-1.5 * dt);

      // Cap displacement so grains don't fly forever
      const disp = Math.hypot(g.ox, g.oz);
      if (disp > 4.5) {
        const s = 4.5 / disp;
        g.ox *= s;
        g.oz *= s;
      }

      const moving =
        Math.abs(g.vx) + Math.abs(g.vz) + Math.abs(g.vy) > 0.002 ||
        Math.abs(g.ox) + Math.abs(g.oz) + Math.abs(g.oy) > 0.002;
      if (moving) {
        this.writeInstance(i, g);
        any = true;
      }
    }

    if (any || this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirty = false;
    }
  }
}
