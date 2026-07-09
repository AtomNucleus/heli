import * as THREE from 'three';
import { Terrain } from './Terrain';
import { Water } from './Water';
import { Grass } from './Grass';
import { Gravel } from './Gravel';
import { Rings, buildCourseRings } from './Rings';
import { DetailProps } from './DetailProps';
import { WashDecals } from './WashDecals';
import { ShoreFoam } from './ShoreFoam';

export class World {
  readonly group = new THREE.Group();
  readonly terrain: Terrain;
  readonly water: Water;
  readonly grass: Grass;
  readonly gravel: Gravel;
  readonly rings: Rings;
  readonly details: DetailProps;
  readonly washDecals: WashDecals;
  readonly shoreFoam: ShoreFoam;
  readonly pads: THREE.Mesh[] = [];
  readonly spawn = new THREE.Vector3(8, 6, 5);
  readonly waterLevel: number;

  private trees: THREE.InstancedMesh;
  private rocks: THREE.InstancedMesh;
  private clock = 0;
  private padMaterials: THREE.MeshStandardMaterial[] = [];
  private envMap: THREE.Texture | null = null;
  private haze?: THREE.Mesh;
  private warmHaze?: THREE.Mesh;
  private sunHaze?: THREE.Mesh;

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
    this.addHorizonHaze();
    this.trees = this.scatterTrees(420);
    this.rocks = this.scatterRocks(180);
    this.group.add(this.trees, this.rocks);

    this.grass = new Grass((x, z) => this.terrain.getHeight(x, z), 20000);
    this.gravel = new Gravel((x, z) => this.terrain.getHeight(x, z), 6000);
    this.group.add(this.grass.mesh, this.gravel.mesh);

    this.shoreFoam = new ShoreFoam((x, z) => this.terrain.getHeight(x, z), this.waterLevel);
    this.group.add(this.shoreFoam.mesh);

    this.washDecals = new WashDecals(this.waterLevel);
    this.group.add(this.washDecals.mesh);

    this.buildPads();
    this.details = new DetailProps((x, z) => this.terrain.getHeight(x, z), this.waterLevel);
    this.group.add(this.details.group);

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
    this.details.update(dt);
    if (this.haze) {
      const mat = this.haze.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.48 + Math.sin(this.clock * 0.15) * 0.04;
    }
    if (this.warmHaze) {
      const mat = this.warmHaze.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.42 + Math.sin(this.clock * 0.12) * 0.04;
    }
    if (this.sunHaze) {
      const mat = this.sunHaze.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.55 + Math.sin(this.clock * 0.1) * 0.05;
    }
  }

  /** Drive grass / gravel / wash decals from helicopter state (also used in title attract). */
  updateEffects(
    heliPos: THREE.Vector3,
    rpm: number,
    agl: number,
    onGround: boolean,
    dt: number,
  ) {
    this.grass.update(heliPos, rpm, agl, onGround, dt);
    this.gravel.update(heliPos, rpm, agl, onGround, dt);

    const groundY = this.terrain.getHeight(heliPos.x, heliPos.z);
    const overWater = groundY < this.waterLevel + 0.6;
    this.washDecals.update(heliPos, rpm, agl, onGround, overWater, groundY, dt);
  }

  private addHorizonHaze() {
    // Warm horizon band — dissolves distant silhouettes into dusk
    const warm = new THREE.Mesh(
      new THREE.RingGeometry(100, 900, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffb078,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      }),
    );
    warm.rotation.x = -Math.PI / 2;
    warm.position.y = 6;
    warm.renderOrder = -2;
    this.warmHaze = warm;
    this.group.add(warm);

    // Extra warm lobe toward sun azimuth (~155°)
    const sunSide = new THREE.Mesh(
      new THREE.RingGeometry(60, 850, 48, 1, 0, Math.PI * 1.15),
      new THREE.MeshBasicMaterial({
        color: 0xffc080,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      }),
    );
    sunSide.rotation.x = -Math.PI / 2;
    sunSide.rotation.z = THREE.MathUtils.degToRad(155) - Math.PI * 0.575;
    sunSide.position.y = 12;
    sunSide.renderOrder = -2;
    this.sunHaze = sunSide;
    this.group.add(sunSide);

    // Vertical haze curtains — softens tree/hill cutouts against sky
    const curtain = new THREE.Mesh(
      new THREE.CylinderGeometry(300, 360, 42, 48, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xd0a080,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      }),
    );
    curtain.position.y = 14;
    curtain.renderOrder = -3;
    this.group.add(curtain);

    const curtain2 = new THREE.Mesh(
      new THREE.CylinderGeometry(380, 440, 55, 48, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xb09078,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      }),
    );
    curtain2.position.y = 18;
    curtain2.renderOrder = -4;
    this.group.add(curtain2);

    // Low warm ground haze
    const teal = new THREE.Mesh(
      new THREE.RingGeometry(30, 650, 64),
      new THREE.MeshBasicMaterial({
        color: 0x6a7870,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      }),
    );
    teal.rotation.x = -Math.PI / 2;
    teal.position.y = 4;
    teal.renderOrder = -2;
    this.haze = teal;
    this.group.add(teal);
  }

  private addSkyDecor() {
    // Distant hills — warm muted, fog-enabled, low so they sit in atmosphere
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const r = 250 + (i % 3) * 30;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x5a6058,
        roughness: 1,
        metalness: 0,
        emissive: 0x000000,
        emissiveIntensity: 0,
        flatShading: true,
        fog: true,
      });
      const hill = new THREE.Mesh(
        new THREE.ConeGeometry(36 + (i % 4) * 12, 14 + (i % 3) * 6, 5),
        mat,
      );
      hill.position.set(Math.cos(ang) * r, -4, Math.sin(ang) * r);
      hill.rotation.y = ang;
      this.group.add(hill);
    }
  }

  private scatterTrees(count: number): THREE.InstancedMesh {
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 1.2, 5);
    const canopyGeo = new THREE.ConeGeometry(1.1, 2.4, 6);
    const geo = new THREE.ConeGeometry(1.0, 2.8, 6);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4a6a58,
      roughness: 0.85,
      metalness: 0.05,
      flatShading: true,
      fog: true,
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

      const tint = 1.05 + Math.random() * 0.2;
      colors[placed * 3] = 0.28 * tint;
      colors[placed * 3 + 1] = 0.4 * tint + Math.random() * 0.05;
      colors[placed * 3 + 2] = 0.3 * tint;
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
      color: 0x4a5558,
      metalness: 0.55,
      roughness: 0.28,
      emissive: 0x1a3a2a,
      emissiveIntensity: 0.35,
      envMap: this.envMap ?? undefined,
      envMapIntensity: 0.95,
    });
    this.padMaterials.push(padMat);

    const markMat = new THREE.MeshStandardMaterial({
      color: 0x3dff9a,
      emissive: 0x3dff9a,
      emissiveIntensity: 0.7,
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
