import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const ColorGradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    shadowTint: { value: new THREE.Color(0x0a3a40) },
    highlightTint: { value: new THREE.Color(0xffb070) },
    contrast: { value: 1.06 },
    saturation: { value: 1.08 },
    shadowLift: { value: 0.32 },
    highlightWarm: { value: 0.16 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 shadowTint;
    uniform vec3 highlightTint;
    uniform float contrast;
    uniform float saturation;
    uniform float shadowLift;
    uniform float highlightWarm;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;

      // Mild contrast around mid-grey
      c = (c - 0.5) * contrast + 0.5;

      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, saturation);

      // Teal lift in shadows, warm push in highlights
      float shadowMask = 1.0 - smoothstep(0.05, 0.45, luma);
      float highlightMask = smoothstep(0.45, 0.92, luma);
      c = mix(c, mix(c, shadowTint, 0.55), shadowMask * shadowLift);
      c = mix(c, mix(c, highlightTint, 0.65), highlightMask * highlightWarm);

      gl_FragColor = vec4(clamp(c, 0.0, 1.2), texel.a);
    }
  `,
};

const SunGlareShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    sunPos: { value: new THREE.Vector2(0.7, 0.75) },
    intensity: { value: 0.22 },
    aspect: { value: 1.6 },
    visible: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 sunPos;
    uniform float intensity;
    uniform float aspect;
    uniform float visible;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      if (visible < 0.01) {
        gl_FragColor = texel;
        return;
      }

      vec2 uv = vUv;
      vec2 sp = sunPos;
      vec2 d = uv - sp;
      d.x *= aspect;
      float dist = length(d);

      // Soft sun disc bloom / glare
      float core = exp(-dist * dist * 48.0) * 0.55;
      float halo = exp(-dist * dist * 8.0) * 0.22;
      float streak = exp(-abs(d.x) * 28.0) * exp(-abs(d.y) * 2.2) * 0.12;
      float streak2 = exp(-abs(d.y) * 32.0) * exp(-abs(d.x) * 2.0) * 0.08;

      // Ghost orbs along sun→center axis
      vec2 toCenter = vec2(0.5) - sp;
      float ghosts = 0.0;
      for (int i = 1; i <= 3; i++) {
        float t = float(i) * 0.28;
        vec2 gp = sp + toCenter * t;
        vec2 gd = uv - gp;
        gd.x *= aspect;
        ghosts += exp(-dot(gd, gd) * 220.0) * (0.08 / float(i));
      }

      float glare = (core + halo + streak + streak2 + ghosts) * intensity * visible;
      vec3 warm = vec3(1.0, 0.78, 0.48);
      texel.rgb += warm * glare;

      gl_FragColor = texel;
    }
  `,
};

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    darkness: { value: 0.42 },
    offset: { value: 0.95 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float darkness;
    uniform float offset;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * vec2(offset);
      float vig = smoothstep(0.8, 0.2, dot(uv, uv));
      texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
      gl_FragColor = texel;
    }
  `,
};

export class PostFX {
  readonly composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private glarePass: ShaderPass;
  enabled = true;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    const size = renderer.getSize(new THREE.Vector2());
    // Moderate bloom — rings + sun glow without washing the scene
    this.bloom = new UnrealBloomPass(size, 0.26, 0.5, 0.78);
    this.composer.addPass(this.bloom);

    const grade = new ShaderPass(ColorGradeShader);
    this.composer.addPass(grade);

    this.glarePass = new ShaderPass(SunGlareShader);
    const aspect = size.x / Math.max(size.y, 1);
    this.glarePass.uniforms['aspect'].value = aspect;
    this.composer.addPass(this.glarePass);

    const vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(vignette);
  }

  /** NDC-ish screen UV of the sun (0–1). Pass visibility 0 when sun is behind camera. */
  setSunScreenPos(x: number, y: number, visible = 1) {
    this.glarePass.uniforms['sunPos'].value.set(x, y);
    this.glarePass.uniforms['visible'].value = visible;
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.glarePass.uniforms['aspect'].value = w / Math.max(h, 1);
  }

  render() {
    if (this.enabled) this.composer.render();
  }
}
