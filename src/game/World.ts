import * as THREE from 'three';
import { Terrain } from './Terrain';
import { Water } from './Water';
import { Grass } from './Grass';
import { Gravel } from './Gravel';
import { Rings, buildCourseRings } from './Rings';

export class World {
  readonly group = new THREE.Group();
  readonly terrain: Terrain;
  readonly water: Water;
  readonly grass: Grass;
  readonly gravel: Gravel;
  readonly rings: Rings;
  readonly pads: THREE.Mesh[] = [];
  readonly spawn = new THREE.Vector3(8, 6, 5);
  readonly waterLevel: number;

  private trees: THREE.InstancedMesh;
  private rocks: THREE.InstancedMesh;
  private clock = 0;
  private padMaterials: THREE.MeshStandardMaterial[] = [];
  private envMap: THREE.Texture | null = null;

  constructor(options?: {
    envMap?: THREE.Texture | null;
    sunDirection?: THREE.Vector3;
  }) {
    this.envMap = options?.envMap ?? null;

    this.terrain = new Terrain(420, 128, this.envMap);
    this.water = new Water(1100, {
      sunDirection: options?.sunDirection,
      fog: true,
    });
    this.waterLevel = this.water.level;
    this.group.add(this.water.mesh);
    this.group.add(this.terrain.mesh);

    this.addSkyDecor();
    this.trees = this.scatterTrees(420);
    this.rocks = this.scatterRocks(180);
    this.group.add(this.trees, this.rocks);

    this.grass = new Grass((x, z) => this.terrain.getHeight(x, z), 20000);
    this.gravel = new Gravel((x, z) => this.terrain.getHeight(x, z), 5500);
    this.group.add(this.grass.mesh, this.gravel.mesh);

    this.buildPads();
    this.rings = new Rings(buildCourseRings((x, z) => this.terrain.getHeight(x, z)));
    this.group.add(this.rings.group);

    const h = this.terrain.getHeight(this.spawn.x, this.spawn.z);
    this.spawn.y = h + 1.4;
  }

  setEnvMap(envMap: THREE.Texture | null) {
    this.envMap = envMap;
    this.terrain.setEnvMap(envMap);
    for (let i = 0; i < this.padMaterials.length; i++) {
      const mat = this.padMaterials[i];
      mat.envMap = envMap;
      // Pad surface wetter than H-mark paint
      mat.envMapIntensity = i === 0 ? 0.95 : 0.55;
      mat.needsUpdate = true;
    }
  }

  getHeight(x: number, z: number): number {
    return this.terrain.getHeight(x, z);
  }

  update(dt: number) {
    this.clock += dt;
    this.water.update(this.clock);
  }

  /** Drive grass / gravel from helicopter state (also used in title attract). */
  updateEffects(
    heliPos: THREE.Vector3,
    rpm: number,
    agl: number,
    onGround: boolean,
    dt: number,
  ) {
    this.grass.update(heliPos, rpm, agl, onGround, dt);
    this.gravel.update(heliPos, rpm, agl, onGround, dt);
  }

  private addSkyDecor() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0a1820,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const r = 280 + (i % 3) * 40;
      const hill = new THREE.Mesh(
        new THREE.ConeGeometry(40 + (i % 4) * 15, 25 + (i % 3) * 12, 5),
        mat,
      );
      hill.position.set(Math.cos(ang) * r, 5, Math.sin(ang) * r);
      hill.rotation.y = ang;
      this.group.add(hill);
    }
  }

  private scatterTrees(count: number): THREE.InstancedMesh {
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 1.2, 5);
    const canopyGeo = new THREE.ConeGeometry(1.1, 2.4, 6);
    const geo = new THREE.ConeGeometry(1.0, 2.8, 6);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a3a28,
      roughness: 0.85,
      metalness: 0.05,
      flatShading: true,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Per-instance color variation
    const colors = new Float32Array(count * 3);
    const dummy = new THREE.Object3D();
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 8) {
      attempts++;
      const x = (Math.random() - 0.5) * 360;
      const z = (Math.random() - 0.5) * 360;
      const h = this.terrain.getHeight(x, z);
      if (h < 2.5 || h > 16) continue;
      if (Math.hypot(x - 8, z - 5) < 22) continue;
      if (Math.hypot(x + 55, z - 40) < 16) continue;

      const scale = 0.7 + Math.random() * 1.1;
      dummy.position.set(x, h + scale * 1.2, z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.1);
      dummy.scale.set(scale * (0.8 + Math.random() * 0.3), scale, scale * (0.8 + Math.random() * 0.3));
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);

      const tint = 0.85 + Math.random() * 0.3;
      colors[placed * 3] = 0.1 * tint;
      colors[placed * 3 + 1] = 0.22 * tint + Math.random() * 0.06;
      colors[placed * 3 + 2] = 0.14 * tint;
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors.subarray(0, placed * 3), 3);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, placed);
    trunks.castShadow = true;
    let ti = 0;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    for (let i = 0; i < placed; i++) {
      mesh.getMatrixAt(i, m);
      m.decompose(p, q, s);
      dummy.position.set(p.x, p.y - s.y * 0.9, p.z);
      dummy.scale.set(s.x * 0.5, s.y * 0.45, s.z * 0.5);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      trunks.setMatrixAt(ti++, dummy.matrix);
    }
    trunks.count = ti;
    trunks.instanceMatrix.needsUpdate = true;
    this.group.add(trunks);

    void canopyGeo;
    return mesh;
  }

  private scatterRocks(count: number): THREE.InstancedMesh {
    const geo = new THREE.DodecahedronGeometry(0.8, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3a4038,
      roughness: 0.95,
      metalness: 0.1,
      flatShading: true,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    let placed = 0;
    for (let i = 0; i < count * 5 && placed < count; i++) {
      const x = (Math.random() - 0.5) * 340;
      const z = (Math.random() - 0.5) * 340;
      const h = this.terrain.getHeight(x, z);
      if (h < 1.5 || h > 22) continue;
      if (Math.hypot(x - 8, z - 5) < 22) continue;
      if (Math.hypot(x + 55, z - 40) < 18) continue;
      const scale = 0.4 + Math.random() * 1.8;
      dummy.position.set(x, h + scale * 0.3, z);
      dummy.rotation.set(Math.random(), Math.random(), Math.random());
      dummy.scale.set(scale, scale * 0.7, scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed++, dummy.matrix);
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  private buildPads() {
    // Wet pad: lower roughness + stronger envMap for subtle sky reflection
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x2e3638,
      metalness: 0.72,
      roughness: 0.22,
      emissive: 0x0a2a1a,
      emissiveIntensity: 0.18,
      envMap: this.envMap ?? undefined,
      envMapIntensity: 0.95,
    });
    this.padMaterials.push(padMat);

    const markMat = new THREE.MeshStandardMaterial({
      color: 0x3dff9a,
      emissive: 0x3dff9a,
      emissiveIntensity: 0.5,
      roughness: 0.28,
      metalness: 0.45,
      envMap: this.envMap ?? undefined,
      envMapIntensity: 0.55,
    });
    this.padMaterials.push(markMat);

    const makePad = (x: number, z: number) => {
      const h = this.terrain.getHeight(x, z);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.5, 0.35, 24), padMat);
      pad.position.set(x, h + 0.15, z);
      pad.receiveShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.08, 8, 40), markMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, h + 0.36, z);
      const hMark = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 0.35), markMat);
      const hMark2 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 2.2), markMat);
      hMark.position.set(x, h + 0.38, z);
      hMark2.position.set(x, h + 0.38, z);
      this.group.add(pad, ring, hMark, hMark2);
      this.pads.push(pad);
      return pad;
    };

    makePad(8, 5);
    makePad(-55, 40);
  }

  /** Bonus landing check on primary or secondary pad */
  isOnPad(pos: THREE.Vector3, onGround: boolean): boolean {
    if (!onGround) return false;
    for (const pad of this.pads) {
      const dx = pos.x - pad.position.x;
      const dz = pos.z - pad.position.z;
      if (Math.hypot(dx, dz) < 6.5 && Math.abs(pos.y - pad.position.y) < 3) return true;
    }
    return false;
  }
}
