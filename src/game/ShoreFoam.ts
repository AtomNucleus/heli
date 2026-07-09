import * as THREE from 'three';

type HeightFn = (x: number, z: number) => number;

/**
 * Thin translucent foam ribbons along the coast where terrain height is near water.
 */
export class ShoreFoam {
  readonly mesh: THREE.InstancedMesh;

  constructor(getHeight: HeightFn, waterLevel: number, count = 280) {
    const geo = new THREE.PlaneGeometry(1.8, 0.55);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xe8f8fc,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;

    const dummy = new THREE.Object3D();
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 40) {
      attempts++;
      const x = (Math.random() - 0.5) * 380;
      const z = (Math.random() - 0.5) * 380;
      const h = getHeight(x, z);
      // Shore band: just above water, shallow shelf
      if (h < waterLevel + 0.15 || h > waterLevel + 1.6) continue;

      // Estimate shore tangent via height gradient
      const eps = 1.2;
      const hx = getHeight(x + eps, z) - getHeight(x - eps, z);
      const hz = getHeight(x, z + eps) - getHeight(x, z - eps);
      const ang = Math.atan2(hx, hz) + Math.PI / 2;

      dummy.position.set(x, waterLevel + 0.08 + (h - waterLevel) * 0.05, z);
      dummy.rotation.set(-Math.PI / 2, 0, ang + (Math.random() - 0.5) * 0.4);
      const sx = 0.7 + Math.random() * 1.4;
      const sz = 0.4 + Math.random() * 0.6;
      dummy.scale.set(sx, sz, 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(placed++, dummy.matrix);
    }
    this.mesh.count = placed;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
