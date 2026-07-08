import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Bell 429 airframe model (CC/MIT, Sketchfab via github.com/FOSS-Supremacy/defy).
const MODEL_URL = `${import.meta.env.BASE_URL}models/helicopter.glb`;
// Target main-rotor diameter in world units — keeps framing/scale consistent
// with the rest of the sim regardless of the raw model size.
const ROTOR_DIAMETER = 7.4;

export class Helicopter {
  readonly group = new THREE.Group();
  readonly mainRotor = new THREE.Group();
  readonly tailRotor = new THREE.Group();

  private model?: THREE.Group;
  private placeholder?: THREE.Object3D;
  private rotorDisk?: THREE.Mesh;
  private tailDisk?: THREE.Mesh;
  private exhaust: THREE.Points;
  private wash: THREE.Points;
  private exhaustVel: Float32Array;
  private washVel: Float32Array;

  private rotorRadius = ROTOR_DIAMETER / 2;
  private rotorAngle = 0;
  private tailAngle = 0;
  private loaded = false;

  constructor(envMap?: THREE.Texture) {
    this.buildPlaceholder();
    this.loadModel(envMap);

    const exhaustData = this.buildParticles(48, 0xffaa66, 0.08);
    this.exhaust = exhaustData.points;
    this.exhaustVel = exhaustData.velocities;
    this.exhaust.position.set(-0.15, 0.55, 1.1);
    this.group.add(this.exhaust);

    const washData = this.buildParticles(72, 0xc2b280, 0.14);
    this.wash = washData.points;
    this.washVel = washData.velocities;
    this.wash.position.set(0, -1.0, 0);
    this.group.add(this.wash);
  }

  /** Simple low-detail stand-in shown until the GLB finishes loading. */
  private buildPlaceholder() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x24302b, metalness: 0.6, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.9, 5, 10), mat);
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.1;
    g.add(body);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.4, 8), mat);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 0.3, 1.9);
    g.add(boom);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.placeholder = g;
    this.group.add(g);
  }

  private loadModel(envMap?: THREE.Texture) {
    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        const model = gltf.scene;

        // The glTF already carries a Y-up root transform; only yaw is needed to
        // point the nose along the sim's forward (−Z) axis.
        model.rotation.y = Math.PI;
        model.updateMatrixWorld(true);

        // Uniform scale so the rotor span matches ROTOR_DIAMETER.
        let box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const scale = ROTOR_DIAMETER / Math.max(size.x, size.z);
        model.scale.setScalar(scale);
        model.updateMatrixWorld(true);

        // Recenter horizontally on the origin and drop so the skids sit just
        // below the flight reference point.
        box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.x -= center.x;
        model.position.z -= center.z;
        model.position.y -= box.min.y + 0.95;
        model.updateMatrixWorld(true);

        model.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            const apply = (m: THREE.Material) => {
              const std = m as THREE.MeshStandardMaterial;
              if (std.isMeshStandardMaterial) {
                if (envMap) {
                  std.envMap = envMap;
                  std.envMapIntensity = 0.9;
                }
                std.needsUpdate = true;
              }
            };
            if (Array.isArray(mesh.material)) mesh.material.forEach(apply);
            else if (mesh.material) apply(mesh.material);
          }
        });

        this.model = model;
        this.group.add(model);
        if (this.placeholder) {
          this.group.remove(this.placeholder);
          this.placeholder = undefined;
        }

        // Derive rotor placement from the model's final bounds.
        const finalBox = new THREE.Box3().setFromObject(model);
        const finalSize = finalBox.getSize(new THREE.Vector3());
        this.rotorRadius = Math.max(finalSize.x, finalSize.z) / 2;
        const hubY = finalBox.max.y - finalSize.y * 0.06;
        const tailZ = finalBox.max.z - finalSize.z * 0.08;
        const tailY = finalBox.min.y + finalSize.y * 0.62;

        this.buildRotorFx(hubY, tailZ, tailY);
        this.loaded = true;
      },
      undefined,
      (err) => {
        console.error('Failed to load helicopter model:', err);
      },
    );
  }

  private buildRotorFx(hubY: number, tailZ: number, tailY: number) {
    // Motion-blur disc for the spinning main rotor.
    const diskTex = this.makeRotorTexture();
    const diskMat = new THREE.MeshBasicMaterial({
      map: diskTex,
      color: 0xaab2ad,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.rotorDisk = new THREE.Mesh(new THREE.CircleGeometry(this.rotorRadius * 1.02, 48), diskMat);
    this.rotorDisk.rotation.x = -Math.PI / 2;
    this.rotorDisk.position.set(0, hubY, 0);
    this.mainRotor.position.set(0, hubY, 0);
    this.group.add(this.rotorDisk, this.mainRotor);

    // Tail rotor blur disc.
    const tailR = this.rotorRadius * 0.28;
    const tailMat = new THREE.MeshBasicMaterial({
      map: diskTex,
      color: 0x9aa39d,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.tailDisk = new THREE.Mesh(new THREE.CircleGeometry(tailR, 24), tailMat);
    this.tailDisk.position.set(this.rotorRadius * 0.05, tailY, tailZ);
    this.group.add(this.tailDisk);

    this.wash.position.set(0, -this.rotorRadius * 0.25, 0);
  }

  private makeRotorTexture(): THREE.Texture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const cx = size / 2;
    const grad = ctx.createRadialGradient(cx, cx, size * 0.05, cx, cx, cx);
    grad.addColorStop(0, 'rgba(210,215,210,0.05)');
    grad.addColorStop(0.55, 'rgba(180,186,182,0.12)');
    grad.addColorStop(0.9, 'rgba(150,158,152,0.30)');
    grad.addColorStop(1, 'rgba(120,128,122,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cx, cx, 0, Math.PI * 2);
    ctx.fill();
    // Faint streaks to read as blade motion.
    ctx.strokeStyle = 'rgba(90,96,92,0.16)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cx, cx * (0.35 + (i % 5) * 0.12), a, a + 0.5);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildParticles(count: number, color: number, size: number) {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      velocities[i * 3] = (Math.random() - 0.5) * 0.5;
      velocities[i * 3 + 1] = Math.random() * 0.5;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const matP = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { points: new THREE.Points(geo, matP), velocities };
  }

  update(dt: number, rpm: number, agl: number, speed: number, onGround: boolean) {
    const spin = rpm * rpm * 42;
    this.rotorAngle += spin * dt;
    this.tailAngle += spin * 3.2 * dt;

    if (this.rotorDisk) {
      const diskMat = this.rotorDisk.material as THREE.MeshBasicMaterial;
      diskMat.opacity = THREE.MathUtils.clamp((rpm - 0.3) * 0.95, 0, 0.72);
      this.rotorDisk.rotation.z = this.rotorAngle * 0.2;
    }
    if (this.tailDisk) {
      const tMat = this.tailDisk.material as THREE.MeshBasicMaterial;
      tMat.opacity = THREE.MathUtils.clamp((rpm - 0.35) * 0.95, 0, 0.62);
      this.tailDisk.rotation.z = this.tailAngle;
    }

    this.updateParticles(this.exhaust, this.exhaustVel, dt, 2.5, rpm > 0.3);
    const washStrength = rpm * THREE.MathUtils.clamp(1 - agl / 10, 0, 1);
    (this.wash.material as THREE.PointsMaterial).opacity = washStrength * 0.5;
    this.wash.visible = (washStrength > 0.05 && !onGround) || (onGround && rpm > 0.4);
    this.updateParticles(this.wash, this.washVel, dt, 4 + speed * 0.1, washStrength > 0.05);

    void this.loaded;
  }

  private updateParticles(
    points: THREE.Points,
    vel: Float32Array,
    dt: number,
    spread: number,
    active: boolean,
  ) {
    const pos = points.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length / 3; i++) {
      if (!active || Math.random() < 0.04) {
        arr[i * 3] = (Math.random() - 0.5) * 0.3;
        arr[i * 3 + 1] = Math.random() * 0.1;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
        vel[i * 3] = (Math.random() - 0.5) * spread;
        vel[i * 3 + 1] = Math.random() * spread * 0.4;
        vel[i * 3 + 2] = (Math.random() - 0.5) * spread;
      } else {
        arr[i * 3] += vel[i * 3] * dt;
        arr[i * 3 + 1] += vel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
    }
    pos.needsUpdate = true;
  }
}
