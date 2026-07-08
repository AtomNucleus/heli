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

    // Instance scales — wash bend is authored in world units, then converted to local
    // so large scaleY/XZ blades don't explode when offset is applied before instanceMatrix.
    float sx = max(length(instanceMatrix[0].xyz), 0.01);
    float sy = max(length(instanceMatrix[1].xyz), 0.01);
    float sz = max(length(instanceMatrix[2].xyz), 0.01);

    // Ambient wind (small local sway — already scale-relative by design)
    float wind = sin(uTime * 1.4 + base.x * 0.35 + base.z * 0.28) * 0.22
               + cos(uTime * 0.9 + base.z * 0.5) * 0.12;
    local.x += wind * tip;
    local.z += cos(uTime * 1.1 + base.x * 0.4) * 0.14 * tip;

    // Rotor wash — flatten/part within ~16m; hard-clamp tip bend in world units
    vec2 toHeli = base.xz - uHeliPos.xz;
    float dist = length(toHeli);
    float washR = 16.0;
    float falloff = 1.0 - smoothstep(0.0, washR, dist);
    falloff *= falloff;
    float wash = min(uWashStrength, 1.2) * falloff;
    wash = min(wash, 1.2);
    if (wash > 0.001 && dist > 0.05) {
      vec2 dir = toHeli / max(dist, 0.001);
      // World-space tip displacement capped ~0.75m, then / scale → local offset
      float bendWorld = min(wash * tip * 0.85, 0.75);
      float flattenWorld = min(wash * tip * 0.45, 0.55);
      local.x += (dir.x * bendWorld) / sx;
      local.z += (dir.y * bendWorld) / sz;
      local.y -= flattenWorld / sy;
    }

    vColor = instanceColorAttr;
    vShade = tip * 0.32 + wash * 0.18 + (fract(base.x * 12.7 + base.z * 9.3) - 0.5) * 0.1;

    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(local, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const grassFragment = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vShade;

  void main() {
    vec3 col = vColor * (0.78 + vShade * 0.55);
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

  constructor(getHeight: (x: number, z: number) => number, count = 20000) {
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

    while (placed < count && attempts < count * 14) {
      attempts++;
      let x: number;
      let z: number;
      // Bias ~28% of clumps into a ring just outside gravel apron for wash demos
      if (Math.random() < 0.28) {
        const ang = Math.random() * Math.PI * 2;
        const rad = 13.5 + Math.random() * 14;
        x = 8 + Math.cos(ang) * rad;
        z = 5 + Math.sin(ang) * rad;
      } else {
        x = (Math.random() - 0.5) * 340;
        z = (Math.random() - 0.5) * 340;
      }
      const h = getHeight(x, z);
      if (h < 2.5 || h > 14) continue;
      // Pad exclusion ~12–14m — clear of gravel apron
      if (Math.hypot(x - 8, z - 5) < 13) continue;
      if (Math.hypot(x + 55, z - 40) < 12) continue;

      // Keep instance scale moderate (0.55–1.15) so wash offsets stay predictable
      const scaleY = 0.55 + Math.random() * 0.6;
      const scaleXZ = 0.55 + Math.random() * 0.35;
      dummy.position.set(x, h + scaleY * 0.48, z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.14);
      dummy.scale.set(scaleXZ, scaleY, scaleXZ);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(placed, dummy.matrix);

      const tone = Math.random();
      let r: number;
      let g: number;
      let b: number;
      if (tone < 0.28) {
        // olive highlights
        r = 0.22 + Math.random() * 0.1;
        g = 0.36 + Math.random() * 0.12;
        b = 0.1 + Math.random() * 0.05;
      } else if (tone < 0.58) {
        // forest
        r = 0.1 + Math.random() * 0.07;
        g = 0.3 + Math.random() * 0.12;
        b = 0.09 + Math.random() * 0.04;
      } else if (tone < 0.82) {
        // sage
        r = 0.16 + Math.random() * 0.08;
        g = 0.32 + Math.random() * 0.1;
        b = 0.14 + Math.random() * 0.05;
      } else {
        // muted yellow-green tip clumps
        r = 0.26 + Math.random() * 0.1;
        g = 0.4 + Math.random() * 0.1;
        b = 0.11 + Math.random() * 0.04;
      }
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

    const addBlade = (yaw: number, w: number, h: number, lean = 0) => {
      const hw = w * 0.5;
      const hh = h * 0.5;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      // Tapered tip for blade silhouette
      const tipScale = 0.22;
      const corners: [number, number, number][] = [
        [-hw, -hh, lean * 0.15],
        [hw, -hh, lean * 0.15],
        [hw * tipScale, hh, lean],
        [-hw * tipScale, hh, lean],
      ];
      for (const [lx, ly, lz] of corners) {
        positions.push(lx * c - lz * s, ly, lx * s + lz * c);
      }
      indices.push(vBase, vBase + 1, vBase + 2, vBase, vBase + 2, vBase + 3);
      vBase += 4;
    };

    // 7 blades — wider fans so clumps read as grass, not sparse sticks
    const blades: [number, number, number, number][] = [
      [0.0, 0.1, 1.35, 0.02],
      [Math.PI * 0.28, 0.088, 1.2, -0.03],
      [Math.PI * 0.55, 0.095, 1.4, 0.04],
      [Math.PI * 0.82, 0.082, 1.15, -0.02],
      [Math.PI * 1.12, 0.092, 1.3, 0.03],
      [Math.PI * 1.4, 0.078, 1.1, -0.04],
      [Math.PI * 1.72, 0.09, 1.25, 0.01],
    ];
    for (const [yaw, w, h, lean] of blades) {
      addBlade(yaw, w, h, lean);
    }

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
    // Wash when within ~16m and low AGL — clamped so tip bend never explodes
    const heightFactor = THREE.MathUtils.clamp(1 - agl / 16, 0, 1);
    this.uniforms.uWashStrength.value = Math.min(rpm * rpm * heightFactor * 1.35, 1.2);
  }
}
