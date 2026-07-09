import * as THREE from 'three';

type HeightFn = (x: number, z: number) => number;

/**
 * Soft additive foam band along the coast — dense samples, readable at dusk.
 */
export class ShoreFoam {
  readonly mesh: THREE.InstancedMesh;

  constructor(getHeight: HeightFn, waterLevel: number, count = 720) {
    const geo = new THREE.PlaneGeometry(2.2, 0.7);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xe8f8ff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;

    const dummy = new THREE.Object3D();
    let placed = 0;

    const biasCenters: [number, number, number][] = [
      [8, 5, 0.4],
      [0, -10, 0.2],
      [20, -5, 0.15],
      [-10, 15, 0.12],
      [6, -14, 0.13],
    ];

    const tryPlace = (x: number, z: number) => {
      if (placed >= count) return;
      const h = getHeight(x, z);
      if (h < waterLevel + 0.05 || h > waterLevel + 1.9) return;

      const eps = 0.9;
      const hx = getHeight(x + eps, z) - getHeight(x - eps, z);
      const hz = getHeight(x, z + eps) - getHeight(x, z - eps);
      const ang = Math.atan2(hx, hz) + Math.PI / 2;

      dummy.position.set(x, waterLevel + 0.12 + (h - waterLevel) * 0.04, z);
      dummy.rotation.set(-Math.PI / 2, 0, ang + (Math.random() - 0.5) * 0.25);
      const sx = 1.0 + Math.random() * 1.8;
      const sz = 0.55 + Math.random() * 0.7;
      dummy.scale.set(sx, sz, 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(placed++, dummy.matrix);
    };

    let attempts = 0;
    while (placed < count * 0.6 && attempts < count * 70) {
      attempts++;
      const pick = Math.random();
      let acc = 0;
      let cx = 8;
      let cz = 5;
      for (const [bx, bz, w] of biasCenters) {
        acc += w;
        if (pick <= acc) {
          cx = bx;
          cz = bz;
          break;
        }
      }
      const x = cx + (Math.random() - 0.5) * 60;
      const z = cz + (Math.random() - 0.5) * 60;
      tryPlace(x, z);
    }

    attempts = 0;
    while (placed < count && attempts < count * 55) {
      attempts++;
      tryPlace((Math.random() - 0.5) * 380, (Math.random() - 0.5) * 380);
    }

    this.mesh.count = placed;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
