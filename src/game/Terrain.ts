import * as THREE from 'three';

/** Procedural canvas albedo for a terrain layer (no custom normal blending). */
function makeTerrainAlbedo(kind: 'grass' | 'sand' | 'rock', size = 256): THREE.CanvasTexture {
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const aCtx = albedoCanvas.getContext('2d')!;
  const aImg = aCtx.createImageData(size, size);

  const hash = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const vnoise = (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = hash(x0, y0);
    const b = hash(x0 + 1, y0);
    const c = hash(x0, y0 + 1);
    const d = hash(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm = (x: number, y: number, oct = 4) => {
    let s = 0;
    let a = 0.5;
    let f = 1;
    for (let i = 0; i < oct; i++) {
      s += vnoise(x * f, y * f) * a;
      a *= 0.5;
      f *= 2.05;
    }
    return s;
  };

  let baseR: number, baseG: number, baseB: number;
  let varAmp: number;
  let nScale: number;
  // Bright sRGB-authored bases (converted to linear by Three) so land reads under dusk
  if (kind === 'grass') {
    baseR = 0.38;
    baseG = 0.62;
    baseB = 0.28;
    varAmp = 0.18;
    nScale = 10;
  } else if (kind === 'sand') {
    baseR = 0.78;
    baseG = 0.68;
    baseB = 0.42;
    varAmp = 0.16;
    nScale = 8;
  } else {
    baseR = 0.62;
    baseG = 0.58;
    baseB = 0.52;
    varAmp = 0.2;
    nScale = 14;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbm(u * nScale, v * nScale, 5);
      const speck = hash(x * 3.1, y * 7.7) * 0.1;

      let r = baseR + (n - 0.5) * varAmp + speck;
      let g = baseG + (n - 0.5) * varAmp * 0.9 + speck * 0.5;
      let b = baseB + (n - 0.5) * varAmp * 0.7;

      if (kind === 'grass') {
        const streak = Math.sin(u * 180 + n * 8) * 0.045;
        g += streak + 0.04;
        r -= streak * 0.25;
      } else if (kind === 'sand') {
        if (hash(x, y) > 0.9) {
          r *= 0.78;
          g *= 0.78;
          b *= 0.72;
        }
        // Warm highlight flecks
        if (hash(x * 1.7, y * 2.3) > 0.94) {
          r = Math.min(1, r + 0.12);
          g = Math.min(1, g + 0.08);
        }
      } else {
        const crack = Math.abs(fbm(u * 20, v * 20, 2) - 0.5);
        if (crack < 0.04) {
          r *= 0.5;
          g *= 0.5;
          b *= 0.5;
        }
      }

      const i = (y * size + x) * 4;
      aImg.data[i] = Math.floor(THREE.MathUtils.clamp(r, 0, 1) * 255);
      aImg.data[i + 1] = Math.floor(THREE.MathUtils.clamp(g, 0, 1) * 255);
      aImg.data[i + 2] = Math.floor(THREE.MathUtils.clamp(b, 0, 1) * 255);
      aImg.data[i + 3] = 255;
    }
  }

  aCtx.putImageData(aImg, 0, 0);

  const albedo = new THREE.CanvasTexture(albedoCanvas);
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = 4;
  albedo.needsUpdate = true;
  return albedo;
}

/** Value-noise heightmap terrain with world-XZ textured blends + wet shoreline. */
export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly size: number;
  readonly segments: number;
  private heights: Float32Array;
  private readonly half: number;

  constructor(size = 420, segments = 128, envMap?: THREE.Texture | null) {
    this.size = size;
    this.segments = segments;
    this.half = size / 2;
    this.heights = new Float32Array((segments + 1) * (segments + 1));

    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.sampleHeight(x, z);
      pos.setY(i, h);
      const ix = Math.round(((x + this.half) / size) * segments);
      const iz = Math.round(((z + this.half) / size) * segments);
      this.heights[iz * (segments + 1) + ix] = h;
    }
    geo.computeVertexNormals();

    const grassMap = makeTerrainAlbedo('grass', 256);
    const sandMap = makeTerrainAlbedo('sand', 256);
    const rockMap = makeTerrainAlbedo('rock', 256);

    // Albedo height-blend only — no custom normalMap path (avoids perturbNormal2Arb breakage)
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0.04,
      map: grassMap,
      normalMap: null,
      envMap: envMap ?? undefined,
      envMapIntensity: envMap ? 0.55 : 0.28,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSand = { value: sandMap };
      shader.uniforms.uRock = { value: rockMap };
      shader.uniforms.uTile = { value: 0.085 };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          varying vec3 vTerrainWorld;
          varying float vTerrainH;
          `,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          vTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vTerrainH = position.y;
          `,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform sampler2D uSand;
          uniform sampler2D uRock;
          uniform float uTile;
          varying vec3 vTerrainWorld;
          varying float vTerrainH;
          `,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          vec2 tUV = vTerrainWorld.xz * uTile;
          vec4 grassSample = texture2D( map, tUV );
          vec4 sandSample = texture2D( uSand, tUV * 1.15 );
          vec4 rockSample = texture2D( uRock, tUV * 0.75 );

          float sandW = 1.0 - smoothstep( 0.6, 3.2, vTerrainH );
          float rockW = smoothstep( 12.0, 20.0, vTerrainH );
          float slope = 1.0 - clamp( normalize( vNormal ).y, 0.0, 1.0 );
          rockW = clamp( rockW + slope * 0.55, 0.0, 1.0 );
          float grassW = max( 1.0 - sandW - rockW * 0.85, 0.0 );
          grassW *= ( 1.0 - rockW * 0.7 );
          sandW *= ( 1.0 - rockW * 0.5 );
          float sumW = grassW + sandW + rockW + 1e-4;
          grassW /= sumW; sandW /= sumW; rockW /= sumW;

          vec4 blendedMap = grassSample * grassW + sandSample * sandW + rockSample * rockW;
          // Wet shoreline: darker + slightly cooler; roughness handled below
          float wet = 1.0 - smoothstep( 0.2, 2.0, vTerrainH );
          blendedMap.rgb = mix( blendedMap.rgb, blendedMap.rgb * vec3( 0.7, 0.76, 0.8 ), wet * 0.55 );
          // Lift midtones so land reads under dusk + ACES
          blendedMap.rgb = blendedMap.rgb * 1.25 + 0.04;
          diffuseColor *= blendedMap;
          `,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `
          float roughnessFactor = roughness;
          #ifdef USE_ROUGHNESSMAP
            vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
            roughnessFactor *= texelRoughness.g;
          #endif
          // Recompute wet here — locals from map_fragment are out of scope
          float wetShore = 1.0 - smoothstep( 0.2, 2.0, vTerrainH );
          roughnessFactor = mix( roughnessFactor, 0.28, wetShore * 0.8 );
          `,
        );

      mat.userData.shader = shader;
    };

    // Bump key so broken cached programs from prior normal-blend shader are discarded
    mat.customProgramCacheKey = () => 'heli-terrain-blend-v3-albedo-bright';

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.renderOrder = 0;
  }

  setEnvMap(envMap: THREE.Texture | null) {
    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    mat.envMap = envMap;
    mat.envMapIntensity = 0.55;
    mat.needsUpdate = true;
  }

  /** Procedural island height at world XZ */
  sampleHeight(x: number, z: number): number {
    const dist = Math.sqrt(x * x + z * z);
    const island = Math.max(0, 1 - Math.pow(dist / (this.size * 0.42), 2.2));

    const n =
      this.noise(x * 0.012, z * 0.012) * 14 +
      this.noise(x * 0.035, z * 0.035) * 5.5 +
      this.noise(x * 0.08, z * 0.08) * 1.8;

    const coast = Math.max(0, 1 - dist / (this.size * 0.48));
    let h = n * island * coast;

    const ridge = Math.exp(-((x - 20) ** 2) / 8000 - ((z + 10) ** 2) / 6000) * 12;
    h += ridge * island;

    const padDx = x - 8;
    const padDz = z - 5;
    const padDist = Math.sqrt(padDx * padDx + padDz * padDz);
    if (padDist < 18) {
      const flatten = 1 - padDist / 18;
      h = THREE.MathUtils.lerp(h, 4.2, flatten * flatten);
    }

    const pad2 = Math.sqrt((x + 55) ** 2 + (z - 40) ** 2);
    if (pad2 < 14) {
      const f = 1 - pad2 / 14;
      h = THREE.MathUtils.lerp(h, 6.5, f * f);
    }

    return h;
  }

  getHeight(x: number, z: number): number {
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
