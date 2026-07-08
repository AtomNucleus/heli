import * as THREE from 'three';
import { Water as ThreeWater } from 'three/examples/jsm/objects/Water.js';

/** Procedural water normal map (no external download). */
function makeWaterNormals(size = 256): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

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
  const fbm = (x: number, y: number) => {
    let s = 0;
    let a = 0.5;
    let f = 1;
    for (let i = 0; i < 5; i++) {
      s += vnoise(x * f, y * f) * a;
      a *= 0.5;
      f *= 2.1;
    }
    return s;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const eps = 1 / size;
      const h = fbm(u * 8, v * 8);
      const hx = fbm((u + eps) * 8, v * 8);
      const hy = fbm(u * 8, (v + eps) * 8);
      let nx = (h - hx) * 12;
      let ny = (h - hy) * 12;
      let nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      img.data[i] = Math.floor((nx * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Reflective coastal water using Three.js mirror Water + procedural normals.
 * Falls back gracefully if Water construction fails.
 */
export class Water {
  readonly mesh: THREE.Mesh;
  /** Raised so bays / shelf edges clearly flood over terrain. */
  readonly level = 0.85;
  private waterObj: ThreeWater | null = null;
  private clock = 0;
  private fallbackUniforms: { uTime: { value: number } } | null = null;

  constructor(
    size = 1100,
    options?: {
      sunDirection?: THREE.Vector3;
      fog?: boolean;
    },
  ) {
    const normals = makeWaterNormals(256);
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);

    try {
      const water = new ThreeWater(geo, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: normals,
        sunDirection: options?.sunDirection?.clone() ?? new THREE.Vector3(0.55, 0.85, 0.25).normalize(),
        sunColor: 0xffe8c8,
        // Deep teal — must stay readable after ACES + SwiftShader
        waterColor: 0x1a6a78,
        distortionScale: 3.2,
        fog: false,
        alpha: 1.0,
      });
      water.rotation.x = -Math.PI / 2;
      water.position.y = this.level;
      const mat = water.material as THREE.ShaderMaterial;
      if (mat.uniforms?.size) mat.uniforms.size.value = 2.0;
      mat.depthWrite = false;
      water.renderOrder = -1;
      mat.transparent = true;

      // Controlled reflection boost — avoid white blowout under ACES/SwiftShader
      if (mat.fragmentShader) {
        mat.fragmentShader = mat.fragmentShader
          .replace(
            'vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );',
            `vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );
             // Soft floor so empty mirror isn't black; keep below sun white
             reflectionSample = clamp( reflectionSample, vec3( 0.05 ), vec3( 0.85 ) );
             reflectionSample = mix( reflectionSample, waterColor * 1.4, 0.18 );`,
          )
          .replace(
            'vec3 albedo = mix( ( sunColor * diffuseLight * 0.3 + scatter ) * getShadowMask(), ( vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight ), reflectance);',
            `vec3 albedo = mix(
               ( sunColor * diffuseLight * 0.35 + scatter * 1.15 ) * getShadowMask(),
               ( waterColor * 0.35 + reflectionSample * 0.95 + specularLight * sunColor * 0.55 ),
               clamp( reflectance * 1.15 + 0.08, 0.0, 0.92 )
             );
             albedo = clamp( albedo, vec3( 0.04, 0.1, 0.12 ), vec3( 0.75, 0.88, 0.95 ) );
             albedo += specularLight * sunColor * 0.22;`,
          );
        mat.needsUpdate = true;
      }

      this.waterObj = water;
      this.mesh = water;
      this.mesh.receiveShadow = true;
    } catch {
      this.mesh = this.buildFallback(size);
    }
  }

  private buildFallback(size: number): THREE.Mesh {
    const uniforms = {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x061820) },
      uShallow: { value: new THREE.Color(0x1a6a78) },
      uSky: { value: new THREE.Color(0x6a9ab0) },
    };
    this.fallbackUniforms = uniforms;
    const mat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorld;
        varying vec3 vView;
        void main() {
          vUv = uv;
          vec3 p = position;
          float w = sin(p.x * 0.05 + uTime * 0.6) * 0.2 + cos(p.y * 0.04 + uTime * 0.45) * 0.15;
          p.z += w;
          vec4 world = modelMatrix * vec4(p, 1.0);
          vWorld = world.xyz;
          vView = cameraPosition - world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uSky;
        varying vec2 vUv;
        varying vec3 vWorld;
        varying vec3 vView;
        void main() {
          vec3 N = normalize(vec3(
            sin(vWorld.x * 0.08 + uTime) * 0.15,
            1.0,
            cos(vWorld.z * 0.07 + uTime * 0.8) * 0.15
          ));
          vec3 V = normalize(vView);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          vec3 col = mix(uDeep, uShallow, 0.45);
          col = mix(col, uSky, fres * 0.7);
          float sparkle = pow(max(0.0, sin(vUv.x * 90.0 + uTime) * sin(vUv.y * 70.0 - uTime)), 10.0) * 0.25;
          col += sparkle;
          gl_FragColor = vec4(col, 0.95);
        }
      `,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 48, 48), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = this.level;
    mesh.receiveShadow = true;
    mesh.renderOrder = -1;
    return mesh;
  }

  setSunDirection(dir: THREE.Vector3) {
    if (this.waterObj) {
      const mat = this.waterObj.material as THREE.ShaderMaterial;
      mat.uniforms['sunDirection'].value.copy(dir).normalize();
    }
  }

  update(t: number) {
    this.clock = t;
    if (this.waterObj) {
      const mat = this.waterObj.material as THREE.ShaderMaterial;
      mat.uniforms['time'].value = t;
    } else if (this.fallbackUniforms) {
      this.fallbackUniforms.uTime.value = t;
    }
  }
}
