import * as THREE from 'three';

const grassVertex = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec3 uHeliPos;
  uniform float uWashStrength;

  attribute vec3 instanceColorAttr;

  varying vec3 vColor;
  varying float vShade;

  void main() {
    vec3 local = position;
    float tip = clamp(local.y + 0.5, 0.0, 1.0);
    tip *= tip;

    // Instance base position (translation column) — instanceMatrix injected by Three.js
    vec3 base = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);

    // Ambient wind
    float wind = sin(uTime * 1.4 + base.x * 0.35 + base.z * 0.28) * 0.18
               + cos(uTime * 0.9 + base.z * 0.5) * 0.1;
    local.x += wind * tip;
    local.z += cos(uTime * 1.1 + base.x * 0.4) * 0.12 * tip;

    // Rotor wash — dramatic part within ~12m when low AGL
    vec2 toHeli = base.xz - uHeliPos.xz;
    float dist = length(toHeli);
    float washR = 12.0;
    float falloff = 1.0 - smoothstep(0.0, washR, dist);
    falloff *= falloff;
    float wash = uWashStrength * falloff;
    if (wash > 0.001 && dist > 0.05) {
      vec2 dir = toHeli / max(dist, 0.001);
      float bend = wash * tip * 1.85;
      local.x += dir.x * bend;
      local.z += dir.y * bend;
      local.y -= wash * tip * 0.55;
    }

    vColor = instanceColorAttr;
    vShade = tip * 0.4 + wash * 0.22;

    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(local, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const grassFragment = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vShade;

  void main() {
    vec3 col = vColor * (0.78 + vShade);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** GPU-driven instanced grass that parts under rotor wash. */
export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private uniforms: {
    uTime: { value: number };
    uHeliPos: { value: THREE.Vector3 };
    uWashStrength: { value: number };
  };

  constructor(getHeight: (x: number, z: number) => number, count = 16000) {
    this.uniforms = {
      uTime: { value: 0 },
      uHeliPos: { value: new THREE.Vector3(0, 100, 0) },
      uWashStrength: { value: 0 },
    };

    const geo = this.buildBladeGeo();
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: grassVertex,
      fragmentShader: grassFragment,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = true;

    const colors = new Float32Array(count * 3);
    const dummy = new THREE.Object3D();
    let placed = 0;
    let attempts = 0;

    while (placed < count && attempts < count * 12) {
      attempts++;
      const x = (Math.random() - 0.5) * 340;
      const z = (Math.random() - 0.5) * 340;
      const h = getHeight(x, z);
      if (h < 2.5 || h > 14) continue;
      // Closer to pads so wash parting is visible near landing
      if (Math.hypot(x - 8, z - 5) < 12) continue;
      if (Math.hypot(x + 55, z - 40) < 10) continue;

      const scaleY = 0.85 + Math.random() * 1.15;
      const scaleXZ = 1.25 + Math.random() * 0.9;
      dummy.position.set(x, h + scaleY * 0.48, z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.1);
      dummy.scale.set(scaleXZ, scaleY, scaleXZ);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(placed, dummy.matrix);

      // Saturated greens with yellow-lime variation
      const g = 0.42 + Math.random() * 0.28;
      const r = 0.14 + Math.random() * 0.14;
      const b = 0.08 + Math.random() * 0.1;
      colors[placed * 3] = r;
      colors[placed * 3 + 1] = g;
      colors[placed * 3 + 2] = b;
      placed++;
    }

    this.mesh.count = placed;
    this.mesh.instanceMatrix.needsUpdate = true;
    geo.setAttribute(
      'instanceColorAttr',
      new THREE.InstancedBufferAttribute(colors.subarray(0, placed * 3), 3),
    );
  }

  private buildBladeGeo(): THREE.BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    let vBase = 0;

    const addBlade = (yaw: number, w: number, h: number) => {
      const hw = w * 0.5;
      const hh = h * 0.5;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const corners: [number, number, number][] = [
        [-hw, -hh, 0],
        [hw, -hh, 0],
        [hw, hh, 0],
        [-hw, hh, 0],
      ];
      for (const [lx, ly, lz] of corners) {
        positions.push(lx * c - lz * s, ly, lx * s + lz * c);
      }
      indices.push(vBase, vBase + 1, vBase + 2, vBase, vBase + 2, vBase + 3);
      vBase += 4;
    };

    // 5 wider, taller blades per clump for readable density
    addBlade(0, 0.22, 1.25);
    addBlade(Math.PI / 5, 0.2, 1.18);
    addBlade((2 * Math.PI) / 5, 0.19, 1.12);
    addBlade((3 * Math.PI) / 5, 0.18, 1.3);
    addBlade((4 * Math.PI) / 5, 0.17, 1.08);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  update(
    heliPos: THREE.Vector3,
    rpm: number,
    agl: number,
    _onGround: boolean,
    dt: number,
  ) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uHeliPos.value.copy(heliPos);
    // Strong wash when within ~12m and low AGL
    const heightFactor = THREE.MathUtils.clamp(1 - agl / 12, 0, 1);
    this.uniforms.uWashStrength.value = rpm * rpm * heightFactor * 2.4;
  }
}
