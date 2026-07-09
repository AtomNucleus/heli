import * as THREE from 'three';

export interface RingDef {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
}

const SEGMENTS = 7;
const GAP_FRAC = 0.14; // fraction of each segment reserved as gap

function buildSegmentedTorus(
  radius: number,
  tube: number,
  segments: number,
): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const arc = (Math.PI * 2) / segments;
  const usable = arc * (1 - GAP_FRAC);
  for (let i = 0; i < segments; i++) {
    const start = i * arc + (arc - usable) * 0.5;
    const seg = new THREE.TorusGeometry(radius, tube, 8, 16, usable);
    seg.rotateZ(start);
    geos.push(seg);
  }
  // Merge into one geometry for fewer draw calls per ring
  const merged = mergeGeometries(geos);
  for (const g of geos) g.dispose();
  return merged;
}

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Manual merge to avoid depending on BufferGeometryUtils path quirks
  let vertCount = 0;
  let idxCount = 0;
  for (const g of geos) {
    vertCount += g.attributes.position.count;
    idxCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices: number[] = [];
  let vOff = 0;
  let iOff = 0;
  for (const g of geos) {
    const pos = g.attributes.position.array as Float32Array;
    const nor = g.attributes.normal?.array as Float32Array | undefined;
    const uv = g.attributes.uv?.array as Float32Array | undefined;
    positions.set(pos, vOff * 3);
    if (nor) normals.set(nor, vOff * 3);
    if (uv) uvs.set(uv, vOff * 2);
    if (g.index) {
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i++) indices.push(idx[i] + vOff);
    } else {
      for (let i = 0; i < g.attributes.position.count; i++) indices.push(i + vOff);
    }
    vOff += g.attributes.position.count;
    iOff += g.index ? g.index.count : g.attributes.position.count;
  }
  void iOff;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setIndex(indices);
  return out;
}

export class Rings {
  readonly group = new THREE.Group();
  readonly defs: RingDef[] = [];
  private rings: {
    root: THREE.Group;
    tube: THREE.Mesh;
    silhouette: THREE.Mesh;
    glow: THREE.Mesh;
    arrows: THREE.Mesh[];
    particles: THREE.Points;
    particleAngles: Float32Array;
  }[] = [];
  private nextIndex = 0;
  readonly count: number;
  private activeMat: THREE.MeshStandardMaterial;
  private doneMat: THREE.MeshStandardMaterial;
  private pendingMat: THREE.MeshStandardMaterial;
  private clock = 0;

  constructor(defs: RingDef[]) {
    this.defs = defs;
    this.count = defs.length;

    this.activeMat = new THREE.MeshStandardMaterial({
      color: 0x0a2818,
      emissive: 0x4dffaa,
      emissiveIntensity: 1.55,
      metalness: 0.25,
      roughness: 0.25,
      transparent: true,
      opacity: 0.98,
    });
    this.doneMat = new THREE.MeshStandardMaterial({
      color: 0x0a1828,
      emissive: 0x5ee7ff,
      emissiveIntensity: 0.35,
      metalness: 0.5,
      roughness: 0.4,
      transparent: true,
      opacity: 0.5,
    });
    this.pendingMat = new THREE.MeshStandardMaterial({
      color: 0x0a2018,
      emissive: 0x2ecc7a,
      emissiveIntensity: 0.55,
      metalness: 0.35,
      roughness: 0.35,
      transparent: true,
      opacity: 0.75,
    });

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x3dff9a,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const silMat = new THREE.MeshBasicMaterial({
      color: 0x010304,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    defs.forEach((d) => {
      const root = new THREE.Group();
      const quat = new THREE.Quaternion();
      quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normal.clone().normalize());
      root.quaternion.copy(quat);
      root.position.copy(d.position);

      // Dark silhouette tube (not filled) for contrast against bright sky / sun
      const silhouette = new THREE.Mesh(
        buildSegmentedTorus(d.radius, 0.36, SEGMENTS),
        silMat.clone(),
      );
      silhouette.renderOrder = 0;

      const tube = new THREE.Mesh(
        buildSegmentedTorus(d.radius, 0.22, SEGMENTS),
        this.activeMat.clone(),
      );
      tube.castShadow = true;
      tube.renderOrder = 1;

      // Soft additive glow disc — keep subtle so it doesn't read as a dark sky plate
      const glow = new THREE.Mesh(new THREE.RingGeometry(d.radius * 0.55, d.radius * 1.05, 32), glowMat.clone());
      glow.renderOrder = 0;

      // Inner flight-direction arrows (along +Z in local = ring normal in world)
      const arrows: THREE.Mesh[] = [];
      const arrowMat = new THREE.MeshStandardMaterial({
        color: 0x1a4030,
        emissive: 0x3dff9a,
        emissiveIntensity: 0.9,
        metalness: 0.3,
        roughness: 0.4,
      });
      for (let a = 0; a < 3; a++) {
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 5), arrowMat.clone());
        const ang = (a / 3) * Math.PI * 2;
        const rr = d.radius * 0.42;
        arrow.position.set(Math.cos(ang) * rr, Math.sin(ang) * rr, 0);
        // Point along ring normal (+Z local) — flight direction through the gate
        arrow.rotation.x = Math.PI / 2;
        arrows.push(arrow);
        root.add(arrow);
      }

      // Orbiting spark particles
      const pCount = 24;
      const pPos = new Float32Array(pCount * 3);
      const angles = new Float32Array(pCount);
      for (let i = 0; i < pCount; i++) {
        angles[i] = (i / pCount) * Math.PI * 2;
        const rr = d.radius;
        pPos[i * 3] = Math.cos(angles[i]) * rr;
        pPos[i * 3 + 1] = Math.sin(angles[i]) * rr;
        pPos[i * 3 + 2] = 0;
      }
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
      const pMat = new THREE.PointsMaterial({
        color: 0x7dffb8,
        size: 0.35,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const particles = new THREE.Points(pGeo, pMat);

      root.add(silhouette, tube, glow, particles);
      this.group.add(root);
      this.rings.push({ root, tube, silhouette, glow, arrows, particles, particleAngles: angles });
    });

    this.refreshVisuals();
  }

  get next(): number {
    return this.nextIndex;
  }

  get complete(): boolean {
    return this.nextIndex >= this.count;
  }

  reset() {
    this.nextIndex = 0;
    this.refreshVisuals();
  }

  /** Returns true if a new ring was collected */
  tryCollect(heliPos: THREE.Vector3, dt: number): boolean {
    this.clock += dt;
    if (this.complete) {
      this.animateIdle(dt);
      return false;
    }
    const d = this.defs[this.nextIndex];
    const toHeli = heliPos.clone().sub(d.position);
    const n = d.normal.clone().normalize();
    const along = toHeli.dot(n);
    const radial = toHeli.clone().addScaledVector(n, -along);
    if (Math.abs(along) < 1.8 && radial.length() < d.radius * 0.92) {
      this.nextIndex++;
      this.refreshVisuals();
      return true;
    }

    this.pulseActive(dt);
    this.animateIdle(dt);
    return false;
  }

  private pulseActive(dt: number) {
    const r = this.rings[this.nextIndex];
    if (!r) return;
    const pulse = 0.55 + Math.sin(this.clock * 4.2) * 0.45;
    const mat = r.tube.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 1.1 + pulse * 0.7;
    mat.opacity = 0.9 + pulse * 0.08;
    const scale = 1 + pulse * 0.045;
    r.tube.scale.setScalar(scale);
    r.silhouette.scale.setScalar(scale * 1.04);
    (r.glow.material as THREE.MeshBasicMaterial).opacity = 0.14 + pulse * 0.14;
    r.root.rotation.z += dt * 0.35;

    // Orbit particles
    const def = this.defs[this.nextIndex];
    const pos = r.particles.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < r.particleAngles.length; i++) {
      r.particleAngles[i] += dt * (1.8 + (i % 3) * 0.3);
      const a = r.particleAngles[i];
      const rr = def.radius * (0.92 + Math.sin(a * 3 + i) * 0.06);
      arr[i * 3] = Math.cos(a) * rr;
      arr[i * 3 + 1] = Math.sin(a) * rr;
      arr[i * 3 + 2] = Math.sin(a * 2 + this.clock) * 0.15;
    }
    pos.needsUpdate = true;
    (r.particles.material as THREE.PointsMaterial).opacity = 0.45 + pulse * 0.4;
  }

  private animateIdle(dt: number) {
    // Slow spin on pending rings for life
    for (let i = this.nextIndex + 1; i < this.rings.length; i++) {
      this.rings[i].root.rotation.z += dt * 0.12;
    }
  }

  private refreshVisuals() {
    this.rings.forEach((r, i) => {
      if (i < this.nextIndex) {
        r.tube.material = this.doneMat.clone();
        r.tube.scale.setScalar(1);
        r.silhouette.scale.setScalar(1);
        (r.silhouette.material as THREE.MeshBasicMaterial).opacity = 0.25;
        (r.glow.material as THREE.MeshBasicMaterial).color.set(0x5ee7ff);
        (r.glow.material as THREE.MeshBasicMaterial).opacity = 0.05;
        (r.particles.material as THREE.PointsMaterial).opacity = 0.08;
        (r.particles.material as THREE.PointsMaterial).color.set(0x5ee7ff);
        for (const a of r.arrows) {
          const m = a.material as THREE.MeshStandardMaterial;
          m.emissive.set(0x5ee7ff);
          m.emissiveIntensity = 0.3;
        }
      } else if (i === this.nextIndex) {
        r.tube.material = this.activeMat.clone();
        (r.silhouette.material as THREE.MeshBasicMaterial).opacity = 0.82;
        (r.glow.material as THREE.MeshBasicMaterial).color.set(0x3dff9a);
        (r.glow.material as THREE.MeshBasicMaterial).opacity = 0.2;
        r.particles.visible = true;
        (r.particles.material as THREE.PointsMaterial).opacity = 0.7;
        (r.particles.material as THREE.PointsMaterial).color.set(0x7dffb8);
        for (const a of r.arrows) {
          const m = a.material as THREE.MeshStandardMaterial;
          m.emissive.set(0x3dff9a);
          m.emissiveIntensity = 1.0;
        }
      } else {
        r.tube.material = this.pendingMat.clone();
        (r.silhouette.material as THREE.MeshBasicMaterial).opacity = 0.7;
        (r.glow.material as THREE.MeshBasicMaterial).opacity = 0.07;
        (r.particles.material as THREE.PointsMaterial).opacity = 0.12;
        for (const a of r.arrows) {
          const m = a.material as THREE.MeshStandardMaterial;
          m.emissiveIntensity = 0.25;
        }
      }
    });
  }
}

export function buildCourseRings(getHeight: (x: number, z: number) => number): RingDef[] {
  const waypoints: [number, number, number][] = [
    [25, 0, -30],
    [55, 0, -55],
    [90, 0, -20],
    [100, 0, 30],
    [70, 0, 70],
    [20, 0, 85],
    [-30, 0, 60],
    [-55, 0, 25],
    [-40, 0, -20],
    [0, 0, -50],
  ];

  return waypoints.map((wp, i) => {
    const [x, , z] = wp;
    const ground = getHeight(x, z);
    const y = ground + 12 + (i % 3) * 3;
    const next = waypoints[(i + 1) % waypoints.length];
    const dir = new THREE.Vector3(next[0] - x, 0, next[2] - z).normalize();
    const normal = dir.lengthSq() < 0.01 ? new THREE.Vector3(0, 0, 1) : dir;
    return {
      position: new THREE.Vector3(x, y, z),
      normal,
      radius: 5.5,
    };
  });
}
