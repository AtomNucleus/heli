import * as THREE from 'three';

const waterVertex = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vWave;

  void main() {
    vUv = uv;
    vec3 p = position;
    float w1 = sin(p.x * 0.08 + uTime * 0.7) * 0.35;
    float w2 = cos(p.y * 0.06 + uTime * 0.55) * 0.25;
    float w3 = sin((p.x + p.y) * 0.04 + uTime * 0.4) * 0.4;
    vWave = w1 + w2 + w3;
    p.z += vWave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const waterFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  varying vec2 vUv;
  varying float vWave;

  void main() {
    float fres = pow(1.0 - abs(vWave * 0.4), 2.0);
    vec3 col = mix(uDeep, uShallow, 0.35 + vWave * 0.15 + fres * 0.2);
    float sparkle = pow(max(0.0, sin(vUv.x * 80.0 + uTime) * sin(vUv.y * 60.0 - uTime * 0.8)), 8.0) * 0.15;
    col += sparkle;
    float alpha = 0.88;
    gl_FragColor = vec4(col, alpha);
  }
`;

export class Water {
  readonly mesh: THREE.Mesh;
  readonly level = 0.15;
  private uniforms: {
    uTime: { value: number };
    uDeep: { value: THREE.Color };
    uShallow: { value: THREE.Color };
  };

  constructor(size = 800) {
    this.uniforms = {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x061820) },
      uShallow: { value: new THREE.Color(0x0e4a55) },
    };

    const geo = new THREE.PlaneGeometry(size, size, 64, 64);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: waterVertex,
      fragmentShader: waterFragment,
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = this.level;
    this.mesh.receiveShadow = true;
  }

  update(t: number) {
    this.uniforms.uTime.value = t;
  }
}
