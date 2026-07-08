import * as THREE from 'three';

export interface RingDef {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
}

export class Rings {
  readonly group = new THREE.Group();
  readonly defs: RingDef[] = [];
  private meshes: THREE.Mesh[] = [];
  private glows: THREE.Mesh[] = [];
  private nextIndex = 0;
  readonly count: number;

  constructor(defs: RingDef[]) {
    this.defs = defs;
    this.count = defs.length;

    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0x1a4030,
      emissive: 0x3dff9a,
      emissiveIntensity: 0.55,
      metalness: 0.4,
      roughness: 0.35,
      transparent: true,
      opacity: 0.9,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x3dff9a,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const doneMat = new THREE.MeshStandardMaterial({
      color: 0x0a2018,
      emissive: 0x5ee7ff,
      emissiveIntensity: 0.25,
      metalness: 0.5,
      roughness: 0.4,
      transparent: true,
      opacity: 0.45,
    });

    defs.forEach((d, i) => {
      const torus = new THREE.Mesh(new THREE.TorusGeometry(d.radius, 0.18, 10, 48), tubeMat.clone());
      const glow = new THREE.Mesh(new THREE.CircleGeometry(d.radius * 0.95, 32), glowMat.clone());

      const quat = new THREE.Quaternion();
      const defaultN = new THREE.Vector3(0, 0, 1);
      quat.setFromUnitVectors(defaultN, d.normal.clone().normalize());
      torus.quaternion.copy(quat);
      glow.quaternion.copy(quat);
      torus.position.copy(d.position);
      glow.position.copy(d.position);

      torus.userData.index = i;
      torus.userData.doneMat = doneMat;
      torus.userData.activeMat = tubeMat;
      torus.castShadow = true;

      this.meshes.push(torus);
      this.glows.push(glow);
      this.group.add(torus, glow);
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
    this.meshes.forEach((m) => {
      m.material = (m.userData.activeMat as THREE.Material).clone();
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.55;
      mat.opacity = 0.9;
    });
    this.refreshVisuals();
  }

  /** Returns true if a new ring was collected */
  tryCollect(heliPos: THREE.Vector3, dt: number): boolean {
    if (this.complete) return false;
    const d = this.defs[this.nextIndex];
    const toHeli = heliPos.clone().sub(d.position);
    const along = toHeli.dot(d.normal.clone().normalize());
    const radial = toHeli.clone().addScaledVector(d.normal.clone().normalize(), -along);
    if (Math.abs(along) < 1.8 && radial.length() < d.radius * 0.92) {
      this.nextIndex++;
      this.refreshVisuals();
      return true;
    }

    // Pulse active ring
    const mesh = this.meshes[this.nextIndex];
    if (mesh) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.45 + Math.sin(performance.now() * 0.006) * 0.35;
      const glow = this.glows[this.nextIndex];
      (glow.material as THREE.MeshBasicMaterial).opacity = 0.1 + Math.sin(performance.now() * 0.006) * 0.08;
      mesh.rotation.z += dt * 0.4;
    }
    return false;
  }

  private refreshVisuals() {
    this.meshes.forEach((m, i) => {
      const glow = this.glows[i];
      if (i < this.nextIndex) {
        m.material = m.userData.doneMat;
        (glow.material as THREE.MeshBasicMaterial).opacity = 0.04;
        (glow.material as THREE.MeshBasicMaterial).color.set(0x5ee7ff);
      } else if (i === this.nextIndex) {
        const mat = (m.userData.activeMat as THREE.MeshStandardMaterial).clone();
        mat.emissive.set(0x3dff9a);
        mat.emissiveIntensity = 0.7;
        m.material = mat;
        (glow.material as THREE.MeshBasicMaterial).color.set(0x3dff9a);
        (glow.material as THREE.MeshBasicMaterial).opacity = 0.15;
      } else {
        const mat = (m.userData.activeMat as THREE.MeshStandardMaterial).clone();
        mat.emissiveIntensity = 0.2;
        mat.opacity = 0.55;
        m.material = mat;
        (glow.material as THREE.MeshBasicMaterial).opacity = 0.05;
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
    // Face along course
    const normal = dir.lengthSq() < 0.01 ? new THREE.Vector3(0, 0, 1) : dir;
    return {
      position: new THREE.Vector3(x, y, z),
      normal,
      radius: 5.5,
    };
  });
}
