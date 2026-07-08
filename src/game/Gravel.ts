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

  constructor(getHeight: (x: number, z: number) => number, count = 6000) {
    // Small base geometry — instance scale keeps grains at true pebble size
    const geo = new THREE.DodecahedronGeometry(0.1, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.84,
      metalness: 0.04,
      flatShading: true,
      emissive: 0x6a5a42,
      emissiveIntensity: 0.22,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;

    const colors = new Float32Array(count * 3);
    // Brighter muted tan / stone — readable at chase distance under dusk
    const colorPalettes: [number, number, number][] = [
      [0.82, 0.72, 0.55], // tan
      [0.76, 0.7, 0.6], // warm grey
      [0.7, 0.6, 0.48], // brown stone
      [0.86, 0.76, 0.58], // light tan
      [0.68, 0.66, 0.6], // cool grey
      [0.74, 0.64, 0.48], // dusty brown
      [0.8, 0.72, 0.62], // pale stone
      [0.62, 0.56, 0.46], // dark pebble
    ];

    // Dense apron just outside pad cylinder
    const pads: { x: number; z: number; weight: number }[] = [
      { x: 8, z: 5, weight: 0.82 },
      { x: -55, z: 40, weight: 0.12 },
    ];

    let placed = 0;
    let attempts = 0;
    const maxAttempts = count * 50;

    while (placed < count && attempts < maxAttempts) {
      attempts++;
      let x: number;
      let z: number;
      let nearPad = false;
      const roll = Math.random();

      if (roll < pads[0].weight) {
        const p = pads[0];
        const ang = Math.random() * Math.PI * 2;
        // Dense pebble apron 7.2–10.5m from pad center
        const rad = 7.2 + Math.random() * 3.3;
        x = p.x + Math.cos(ang) * rad;
        z = p.z + Math.sin(ang) * rad;
        nearPad = true;
      } else if (roll < pads[0].weight + pads[1].weight) {
        const p = pads[1];
        const ang = Math.random() * Math.PI * 2;
        const rad = 7.2 + Math.random() * 3.0;
        x = p.x + Math.cos(ang) * rad;
        z = p.z + Math.sin(ang) * rad;
        nearPad = true;
      } else {
        x = (Math.random() - 0.5) * 300;
        z = (Math.random() - 0.5) * 300;
      }

      const h = getHeight(x, z);

      if (nearPad) {
        if (h < 3.6) continue;
      } else {
        if (h < 0.5 || h > 3.5) continue;
        if (Math.hypot(x - 8, z - 5) < 22) continue;
        if (Math.hypot(x + 55, z - 40) < 16) continue;
      }

      // Clear H-mark center
      if (Math.hypot(x - 8, z - 5) < 1.8) continue;
      if (Math.hypot(x + 55, z - 40) < 1.8) continue;

      // Readable pebble size at chase distance: base 0.1 × scale 0.22–0.42 (bias larger)
      const scale = 0.22 + Math.random() * 0.2;
      const grain: Grain = {
        baseX: x,
        baseY: h + scale * 0.18 + 0.06,
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

      const pal = colorPalettes[Math.floor(Math.random() * colorPalettes.length)];
      const jitter = 0.94 + Math.random() * 0.14;
      colors[placed * 3] = Math.min(1, pal[0] * jitter);
      colors[placed * 3 + 1] = Math.min(1, pal[1] * jitter);
      colors[placed * 3 + 2] = Math.min(1, pal[2] * jitter);
      placed++;
    }

    this.mesh.count = placed;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors.subarray(0, placed * 3), 3);
    this.dirty = false;
  }

  private writeInstance(i: number, g: Grain) {
    this.dummy.position.set(g.baseX + g.ox, g.baseY + g.oy, g.baseZ + g.oz);
    this.dummy.rotation.set(g.rotX, g.rotY, g.rotZ);
    this.dummy.scale.set(g.scale, g.scale * 0.62, g.scale * 0.88);
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
    const heightFactor = THREE.MathUtils.clamp(1 - agl / 10, 0, 1);
    let wash = rpm * rpm * heightFactor;
    // Strong scatter when RPM high + low AGL so motion reads in chase shots
    if (onGround && rpm > 0.35) wash = Math.max(wash, rpm * 2.35);
    else if (agl < 2.5 && rpm > 0.45) wash = Math.max(wash, rpm * 2.1);
    else if (onGround && rpm > 0.2) wash = Math.max(wash, rpm * 1.55);

    const radius = 14 + wash * 8;
    const impulse = wash * 110;

    let any = false;
    for (let i = 0; i < this.grains.length; i++) {
      const g = this.grains[i];
      const dx = g.baseX + g.ox - heliPos.x;
      const dz = g.baseZ + g.oz - heliPos.z;
      const dist = Math.hypot(dx, dz);

      if (wash > 0.04 && dist < radius && dist > 0.1) {
        const fall = 1 - dist / radius;
        const force = impulse * fall * fall;
        const inv = 1 / dist;
        g.vx += dx * inv * force * dt;
        g.vz += dz * inv * force * dt;
        g.vy += force * 0.62 * dt;
        g.rotX += g.vx * dt * 5.2;
        g.rotZ += g.vz * dt * 5.2;
      }

      g.ox += g.vx * dt;
      g.oy += g.vy * dt;
      g.oz += g.vz * dt;

      g.vy -= 9.5 * dt;
      if (g.oy < 0) {
        g.oy = 0;
        g.vy *= -0.32;
        if (Math.abs(g.vy) < 0.05) g.vy = 0;
      }

      // Soft spring-back so scatter holds for screenshots
      g.vx += -g.ox * 0.32 * dt;
      g.vz += -g.oz * 0.32 * dt;
      g.vx *= Math.exp(-1.05 * dt);
      g.vz *= Math.exp(-1.05 * dt);
      g.vy *= Math.exp(-0.85 * dt);

      const disp = Math.hypot(g.ox, g.oz);
      if (disp > 12) {
        const s = 12 / disp;
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

  /** Snap all grains back to rest (demo / screenshot harness). */
  reset() {
    for (let i = 0; i < this.grains.length; i++) {
      const g = this.grains[i];
      g.ox = g.oy = g.oz = 0;
      g.vx = g.vy = g.vz = 0;
      this.writeInstance(i, g);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dirty = false;
  }
}
