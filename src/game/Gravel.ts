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

  constructor(getHeight: (x: number, z: number) => number, count = 5500) {
    // Small base geometry — instance scale keeps grains at true pebble size
    const geo = new THREE.DodecahedronGeometry(0.1, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.06,
      flatShading: true,
      emissive: 0x4a4030,
      emissiveIntensity: 0.1,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;

    const colors = new Float32Array(count * 3);
    // Muted tan / grey / brown — readable pebbles under dusk, not neon bone or black voids
    const colorPalettes: [number, number, number][] = [
      [0.62, 0.55, 0.42], // tan
      [0.58, 0.54, 0.48], // warm grey
      [0.5, 0.44, 0.36], // brown stone
      [0.66, 0.58, 0.46], // light tan
      [0.48, 0.46, 0.44], // cool grey
      [0.56, 0.48, 0.36], // dusty brown
      [0.6, 0.56, 0.5], // pale stone
      [0.44, 0.4, 0.34], // dark pebble
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
        // Dense pebble apron 7.2–10m from pad center
        const rad = 7.2 + Math.random() * 2.8;
        x = p.x + Math.cos(ang) * rad;
        z = p.z + Math.sin(ang) * rad;
        nearPad = true;
      } else if (roll < pads[0].weight + pads[1].weight) {
        const p = pads[1];
        const ang = Math.random() * Math.PI * 2;
        const rad = 7.2 + Math.random() * 2.6;
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

      // True pebble size: base 0.1 × scale 0.15–0.34
      const scale = 0.15 + Math.random() * 0.19;
      const grain: Grain = {
        baseX: x,
        baseY: h + scale * 0.05,
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
      const jitter = 0.92 + Math.random() * 0.16;
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
    // On pad / low hover with RPM: scatter pebbles outward
    if (onGround && rpm > 0.35) wash = Math.max(wash, rpm * 1.85);
    else if (agl < 2.5 && rpm > 0.45) wash = Math.max(wash, rpm * 1.55);
    else if (onGround && rpm > 0.2) wash = Math.max(wash, rpm * 1.3);

    const radius = 13 + wash * 7;
    const impulse = wash * 72;

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
        g.vy += force * 0.48 * dt;
        g.rotX += g.vx * dt * 4.2;
        g.rotZ += g.vz * dt * 4.2;
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
      g.vx += -g.ox * 0.45 * dt;
      g.vz += -g.oz * 0.45 * dt;
      g.vx *= Math.exp(-1.35 * dt);
      g.vz *= Math.exp(-1.35 * dt);
      g.vy *= Math.exp(-0.95 * dt);

      const disp = Math.hypot(g.ox, g.oz);
      if (disp > 11) {
        const s = 11 / disp;
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
