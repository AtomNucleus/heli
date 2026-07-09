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
  /** Original coastal level — island shelf stays dry. */
  readonly level = 0.15;
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
        sunColor: 0xffd0a0,
        // Readable coastal teal — not crushed black under dusk
        waterColor: 0x1a6878,
        distortionScale: 3.6,
        fog: options?.fog ?? true,
        alpha: 1.0,
      });
      water.rotation.x = -Math.PI / 2;
      water.position.y = this.level;
      water.visible = true;
      const mat = water.material as THREE.ShaderMaterial;
      if (mat.uniforms?.size) mat.uniforms.size.value = 2.6;
      if (mat.uniforms?.waterColor) mat.uniforms.waterColor.value.set(0x1a6878);
      if (mat.uniforms?.sunColor) mat.uniforms.sunColor.value.set(0xffd0a0);
      if (mat.uniforms?.distortionScale) mat.uniforms.distortionScale.value = 3.6;
      // Write depth so submerged shelf doesn't punch through as milky sand
      mat.depthWrite = true;
      mat.transparent = false;
      water.renderOrder = -1;

      // Soft reflection + low-poly wave highlights + sun specular streak
      if (mat.fragmentShader) {
        mat.fragmentShader = mat.fragmentShader
          .replace(
            'vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );',
            `vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );
             // Soften bright sky without crushing all mirror detail
             reflectionSample = mix( reflectionSample, waterColor, 0.12 );
             reflectionSample *= 0.92;`,
          )
          .replace(
            'vec3 albedo = mix( ( sunColor * diffuseLight * 0.3 + scatter ) * getShadowMask(), ( vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight ), reflectance);',
            `vec3 albedo = mix(
               ( waterColor * ( 0.5 + diffuseLight * 0.45 ) + scatter * 0.6 ) * getShadowMask(),
               ( waterColor * 0.18 + reflectionSample * 0.95 + specularLight * sunColor * 0.85 ),
               clamp( reflectance * 0.98, 0.2, 0.9 )
             );
             albedo = mix( albedo, waterColor, 0.06 );
             // Strong sun reflection streak — must read in coastal shots
             albedo += specularLight * sunColor * 0.42;
             float sunSpec = max( specularLight.r, max( specularLight.g, specularLight.b ) );
             float sunStreak = pow( max( 0.0, sunSpec ), 1.4 );
             albedo += sunColor * sunStreak * 0.35;
             // Low-poly wave highlight sparkles (stylized, not noise soup)
             float waveHi = pow( max( 0.0, sin( worldPosition.x * 0.35 + time * 1.1 )
               * sin( worldPosition.z * 0.28 - time * 0.85 ) ), 6.0 );
             albedo += sunColor * waveHi * 0.16;
             float crest = pow( max( 0.0, surfaceNormal.y ), 4.0 );
             albedo += vec3( 0.6, 0.8, 0.85 ) * crest * 0.1;`,
          );
        mat.needsUpdate = true;
      }

      this.waterObj = water;
      this.mesh = water;
      this.mesh.visible = true;
      this.mesh.receiveShadow = true;
    } catch {
      this.mesh = this.buildFallback(size);
    }
  }

  private buildFallback(size: number): THREE.Mesh {
    const uniforms = {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x0c3a48) },
      uShallow: { value: new THREE.Color(0x1a5a68) },
      uSky: { value: new THREE.Color(0x6a90a8) },
    };
    this.fallbackUniforms = uniforms;
    const mat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      fog: true,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorld;
        varying vec3 vView;
        #include <common>
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          vec3 p = position;
          float w = sin(p.x * 0.05 + uTime * 0.6) * 0.2 + cos(p.y * 0.04 + uTime * 0.45) * 0.15;
          p.z += w;
          vec4 world = modelMatrix * vec4(p, 1.0);
          vWorld = world.xyz;
          vView = cameraPosition - world.xyz;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
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
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          vec3 N = normalize(vec3(
            sin(vWorld.x * 0.08 + uTime) * 0.15,
            1.0,
            cos(vWorld.z * 0.07 + uTime * 0.8) * 0.15
          ));
          vec3 V = normalize(vView);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          vec3 col = mix(uDeep, uShallow, 0.4);
          col = mix(col, uSky, fres * 0.55);
          float sparkle = pow(max(0.0, sin(vUv.x * 90.0 + uTime) * sin(vUv.y * 70.0 - uTime)), 10.0) * 0.18;
          col += sparkle;
          gl_FragColor = vec4(col, 0.95);
          #include <fog_fragment>
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
      this.waterObj.visible = true;
      const mat = this.waterObj.material as THREE.ShaderMaterial;
      // Drive Three Water time uniform so normals + mirror stay live each frame
      if (mat.uniforms['time']) mat.uniforms['time'].value = t * 0.5;
    } else if (this.fallbackUniforms) {
      this.fallbackUniforms.uTime.value = t;
    }
  }
}
