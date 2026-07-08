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

  constructor(getHeight: (x: number, z: number) => number, count = 4000) {
    // Unit dodecahedron; instance scale 0.18–0.45 makes grains readable
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.68,
      metalness: 0.32,
      flatShading: true,
      emissive: 0x2a2418,
      emissiveIntensity: 0.28,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = true;

    const colors = new Float32Array(count * 3);
    const colorPalettes: [number, number, number][] = [
      [0.85, 0.72, 0.48], // tan
      [0.7, 0.68, 0.64], // grey
      [0.62, 0.48, 0.34], // brown
      [0.78, 0.74, 0.62], // warm grey
      [0.9, 0.82, 0.58], // light sand
      [0.55, 0.52, 0.48], // dark stone
    ];

    // Dense ring just outside pad cylinder + pad apron fill
    const pads: { x: number; z: number; rInner: number; rOuter: number; dens: number }[] = [
      { x: 8, z: 5, rInner: 7.2, rOuter: 16, dens: 0.6 },
      { x: -55, z: 40, rInner: 7.2, rOuter: 14, dens: 0.35 },
    ];

    let placed = 0;
    let attempts = 0;
    const maxAttempts = count * 25;

    while (placed < count && attempts < maxAttempts) {
      attempts++;
      let x: number;
      let z: number;
      const roll = Math.random();

      if (roll < 0.62) {
        // Primary pad: denser ring just outside cylinder
        const p = pads[0];
        const ang = Math.random() * Math.PI * 2;
        const t = Math.random();
        // Bias toward outer ring (apron edge)
        const rad =
          t < 0.55
            ? p.rInner + Math.random() * (p.rOuter - p.rInner) * 0.45
            : Math.sqrt(Math.random()) * p.rOuter;
        x = p.x + Math.cos(ang) * rad;
        z = p.z + Math.sin(ang) * rad;
      } else if (roll < 0.88) {
        const p = pads[1];
        const ang = Math.random() * Math.PI * 2;
        const t = Math.random();
        const rad =
          t < 0.55
            ? p.rInner + Math.random() * (p.rOuter - p.rInner) * 0.5
            : Math.sqrt(Math.random()) * p.rOuter;
        x = p.x + Math.cos(ang) * rad;
        z = p.z + Math.sin(ang) * rad;
      } else {
        // Shore / marsh gravel band
        x = (Math.random() - 0.5) * 300;
        z = (Math.random() - 0.5) * 300;
      }

      const h = getHeight(x, z);
      const nearPad =
        Math.hypot(x - 8, z - 5) < 17 || Math.hypot(x + 55, z - 40) < 15;
      if (nearPad) {
        // Sit on pad apron / terrain — above water
        if (h < 2.2 || h > 12) continue;
      } else {
        if (h < 0.9 || h > 3.5) continue;
      }

      // Tiny clear under H mark center
      if (Math.hypot(x - 8, z - 5) < 1.2) continue;
      if (Math.hypot(x + 55, z - 40) < 1.2) continue;

      const scale = 0.38 + Math.random() * 0.42;
      const grain: Grain = {
        baseX: x,
        baseY: h + scale * 0.5,
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
      const jitter = 0.9 + Math.random() * 0.2;
      colors[placed * 3] = pal[0] * jitter;
      colors[placed * 3 + 1] = pal[1] * jitter;
      colors[placed * 3 + 2] = pal[2] * jitter;
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
    if (onGround && rpm > 0.25) wash = Math.max(wash, rpm * 1.15);
    // Stronger impulse so motion is obvious on landing / high wash
    const radius = 10 + wash * 5;
    const impulse = wash * 32;

    let any = false;
    for (let i = 0; i < this.grains.length; i++) {
      const g = this.grains[i];
      const dx = g.baseX + g.ox - heliPos.x;
      const dz = g.baseZ + g.oz - heliPos.z;
      const dist = Math.hypot(dx, dz);

      if (wash > 0.06 && dist < radius && dist > 0.15) {
        const fall = 1 - dist / radius;
        const force = impulse * fall * fall;
        const inv = 1 / dist;
        g.vx += dx * inv * force * dt;
        g.vz += dz * inv * force * dt;
        g.vy += force * 0.18 * dt;
        g.rotX += g.vx * dt * 2.5;
        g.rotZ += g.vz * dt * 2.5;
      }

      g.ox += g.vx * dt;
      g.oy += g.vy * dt;
      g.oz += g.vz * dt;

      g.vy -= 9.5 * dt;
      if (g.oy < 0) {
        g.oy = 0;
        g.vy *= -0.28;
        if (Math.abs(g.vy) < 0.05) g.vy = 0;
      }

      g.vx += -g.ox * 1.6 * dt;
      g.vz += -g.oz * 1.6 * dt;
      g.vx *= Math.exp(-2.8 * dt);
      g.vz *= Math.exp(-2.8 * dt);
      g.vy *= Math.exp(-1.4 * dt);

      const disp = Math.hypot(g.ox, g.oz);
      if (disp > 5.5) {
        const s = 5.5 / disp;
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
