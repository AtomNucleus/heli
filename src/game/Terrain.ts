import * as THREE from 'three';

/** Simple value-noise heightmap terrain */
export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly size: number;
  readonly segments: number;
  private heights: Float32Array;
  private readonly half: number;

  constructor(size = 420, segments = 128) {
    this.size = size;
    this.segments = segments;
    this.half = size / 2;
    this.heights = new Float32Array((segments + 1) * (segments + 1));

    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.sampleHeight(x, z);
      pos.setY(i, h);

      const ix = Math.round(((x + this.half) / size) * segments);
      const iz = Math.round(((z + this.half) / size) * segments);
      this.heights[iz * (segments + 1) + ix] = h;

      // Color by height
      const t = THREE.MathUtils.clamp((h + 2) / 28, 0, 1);
      let r: number, g: number, b: number;
      if (h < 1.2) {
        r = 0.35; g = 0.42; b = 0.28; // wet sand / marsh
      } else if (h < 8) {
        r = 0.18 + t * 0.1; g = 0.38 + t * 0.15; b = 0.2;
      } else if (h < 18) {
        r = 0.28; g = 0.32; b = 0.22;
      } else {
        r = 0.45; g = 0.48; b = 0.42; // rock
      }
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: false,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
  }

  /** Procedural island height at world XZ */
  sampleHeight(x: number, z: number): number {
    const dist = Math.sqrt(x * x + z * z);
    const island = Math.max(0, 1 - Math.pow(dist / (this.size * 0.42), 2.2));

    const n =
      this.noise(x * 0.012, z * 0.012) * 14 +
      this.noise(x * 0.035, z * 0.035) * 5.5 +
      this.noise(x * 0.08, z * 0.08) * 1.8;

    // Coastal shelf
    const coast = Math.max(0, 1 - dist / (this.size * 0.48));
    let h = n * island * coast;

    // Central ridge
    const ridge = Math.exp(-((x - 20) ** 2) / 8000 - ((z + 10) ** 2) / 6000) * 12;
    h += ridge * island;

    // Flatten spawn plateau near origin-ish pad area
    const padDx = x - 8;
    const padDz = z - 5;
    const padDist = Math.sqrt(padDx * padDx + padDz * padDz);
    if (padDist < 18) {
      const flatten = 1 - padDist / 18;
      h = THREE.MathUtils.lerp(h, 4.2, flatten * flatten);
    }

    // Second pad area
    const pad2 = Math.sqrt((x + 55) ** 2 + (z - 40) ** 2);
    if (pad2 < 14) {
      const f = 1 - pad2 / 14;
      h = THREE.MathUtils.lerp(h, 6.5, f * f);
    }

    return h;
  }

  getHeight(x: number, z: number): number {
    // Bilinear sample from height grid when in bounds, else procedural
    const u = (x + this.half) / this.size;
    const v = (z + this.half) / this.size;
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return Math.min(0, this.sampleHeight(x, z));
    }

    const s = this.segments;
    const fx = u * s;
    const fz = v * s;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(s, x0 + 1);
    const z1 = Math.min(s, z0 + 1);
    const tx = fx - x0;
    const tz = fz - z0;

    const h00 = this.heights[z0 * (s + 1) + x0];
    const h10 = this.heights[z0 * (s + 1) + x1];
    const h01 = this.heights[z1 * (s + 1) + x0];
    const h11 = this.heights[z1 * (s + 1) + x1];

    const hx0 = h00 * (1 - tx) + h10 * tx;
    const hx1 = h01 * (1 - tx) + h11 * tx;
    return hx0 * (1 - tz) + hx1 * tz;
  }

  private noise(x: number, y: number): number {
    // Multi-octave value noise
    let sum = 0;
    let amp = 1;
    let freq = 1;
    for (let o = 0; o < 4; o++) {
      sum += this.vnoise(x * freq, y * freq) * amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum;
  }

  private vnoise(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = this.hash(x0, y0);
    const b = this.hash(x0 + 1, y0);
    const c = this.hash(x0, y0 + 1);
    const d = this.hash(x0 + 1, y0 + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  private hash(x: number, y: number): number {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
  }
}
