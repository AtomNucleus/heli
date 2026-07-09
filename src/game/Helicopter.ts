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
  private spinBlades: THREE.Mesh[] = [];
  private tailDisk?: THREE.Mesh;
  private exhaust: THREE.Points;
  private wash: THREE.Points;
  private heatShimmer: THREE.Points;
  private boostSparks: THREE.Points;
  private tailTrail: THREE.Points;
  private exhaustVel: Float32Array;
  private washVel: Float32Array;
  private heatVel: Float32Array;
  private sparkVel: Float32Array;
  private trailPositions: THREE.Vector3[] = [];
  private trailMax = 18;

  private rotorRadius = ROTOR_DIAMETER / 2;
  private rotorAngle = 0;
  private tailAngle = 0;
  private loaded = false;
  private bodyMaterials: THREE.MeshStandardMaterial[] = [];

  constructor(envMap?: THREE.Texture) {
    this.buildPlaceholder();
    this.loadModel(envMap);

    const exhaustData = this.buildParticles(56, 0xffaa66, 0.09);
    this.exhaust = exhaustData.points;
    this.exhaustVel = exhaustData.velocities;
    this.exhaust.position.set(-0.15, 0.55, 1.1);
    this.group.add(this.exhaust);

    const heatData = this.buildParticles(36, 0xff8844, 0.22);
    this.heatShimmer = heatData.points;
    this.heatVel = heatData.velocities;
    (this.heatShimmer.material as THREE.PointsMaterial).opacity = 0.25;
    this.heatShimmer.position.set(-0.1, 0.45, 1.25);
    this.group.add(this.heatShimmer);

    const sparkData = this.buildParticles(40, 0xffcc44, 0.12);
    this.boostSparks = sparkData.points;
    this.sparkVel = sparkData.velocities;
    this.boostSparks.position.set(-0.1, 0.4, 1.35);
    this.boostSparks.visible = false;
    this.group.add(this.boostSparks);

    const washData = this.buildParticles(140, 0xc2b280, 0.2);
    this.wash = washData.points;
    this.washVel = washData.velocities;
    this.wash.position.set(0, -1.0, 0);
    this.group.add(this.wash);

    // Tail trail — fading points behind the boom
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.trailMax * 3), 3));
    const trailMat = new THREE.PointsMaterial({
      color: 0x88aacc,
      size: 0.22,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.tailTrail = new THREE.Points(trailGeo, trailMat);
    this.tailTrail.frustumCulled = false;
    // World-space trail — added to group but positions written in local space each frame
    this.group.add(this.tailTrail);
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
                  // Slightly higher metal response for stronger dusk rim read
                  std.envMapIntensity = 1.15;
                }
                // Warm metal bias so orange rim light catches the airframe
                if (std.metalness > 0.3) {
                  std.metalness = Math.min(1, std.metalness + 0.08);
                  std.roughness = Math.max(0.18, std.roughness - 0.05);
                }
                this.bodyMaterials.push(std);
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
    // Motion-blur disc for the spinning main rotor, sitting just above the
    // model's static blades so it occludes them when spun up.
    const diskTex = this.makeRotorTexture();
    const diskMat = new THREE.MeshBasicMaterial({
      map: diskTex,
      color: 0x2a2f30,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.rotorDisk = new THREE.Mesh(new THREE.CircleGeometry(this.rotorRadius * 1.04, 48), diskMat);
    this.rotorDisk.rotation.x = -Math.PI / 2;
    this.rotorDisk.position.set(0, hubY + 0.05, 0);
    this.group.add(this.rotorDisk);

    // Fast-spinning translucent blades that fade in ABOVE idle (so they don't
    // double up with the model's static blades on the parked aircraft).
    this.mainRotor.position.set(0, hubY + 0.06, 0);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0x0e1012,
      metalness: 0.2,
      roughness: 0.7,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.015, this.rotorRadius * 1.9),
        bladeMat,
      );
      blade.rotation.y = (i * Math.PI) / 4;
      this.mainRotor.add(blade);
      this.spinBlades.push(blade);
    }
    this.group.add(this.mainRotor);

    // Tail rotor blur disc.
    const tailR = this.rotorRadius * 0.3;
    const tailMat = new THREE.MeshBasicMaterial({
      map: diskTex,
      color: 0x26292a,
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
    // Slightly more visible blur disc
    grad.addColorStop(0, 'rgba(70,74,76,0.28)');
    grad.addColorStop(0.55, 'rgba(60,64,66,0.55)');
    grad.addColorStop(0.92, 'rgba(40,44,46,0.82)');
    grad.addColorStop(1, 'rgba(30,32,34,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cx, cx, 0, Math.PI * 2);
    ctx.fill();
    // Blade-streak arcs to read as motion blur.
    ctx.strokeStyle = 'rgba(20,22,24,0.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cx, cx * (0.3 + (i % 6) * 0.11), a, a + 0.7);
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

  update(
    dt: number,
    rpm: number,
    agl: number,
    speed: number,
    onGround: boolean,
    boost = false,
    overWater = false,
  ) {
    const spin = rpm * rpm * 42;
    this.rotorAngle += spin * dt;
    this.tailAngle += spin * 3.2 * dt;
    this.mainRotor.rotation.y = this.rotorAngle;

    // Spinning blades read the rotor at low/mid RPM; the blur disc takes over
    // and dominates at high RPM.
    const bladeOpacity = THREE.MathUtils.clamp((rpm - 0.2) * 0.9, 0, 0.4);
    for (const blade of this.spinBlades) {
      (blade.material as THREE.MeshStandardMaterial).opacity = bladeOpacity;
    }
    this.mainRotor.visible = bladeOpacity > 0.001;

    if (this.rotorDisk) {
      const diskMat = this.rotorDisk.material as THREE.MeshBasicMaterial;
      // Slightly more visible rotor blur
      diskMat.opacity = THREE.MathUtils.clamp((rpm - 0.35) * 1.25, 0, 0.92);
      this.rotorDisk.rotation.z = this.rotorAngle * 0.2;
    }
    if (this.tailDisk) {
      const tMat = this.tailDisk.material as THREE.MeshBasicMaterial;
      tMat.opacity = THREE.MathUtils.clamp((rpm - 0.3) * 1.15, 0, 0.8);
      this.tailDisk.rotation.z = this.tailAngle;
    }

    // Exhaust + heat shimmer
    this.updateParticles(this.exhaust, this.exhaustVel, dt, 2.5, rpm > 0.3, {
      biasY: 0.8,
      biasZ: 1.2,
    });
    const heatOn = rpm > 0.35;
    (this.heatShimmer.material as THREE.PointsMaterial).opacity = heatOn ? 0.22 + rpm * 0.15 : 0;
    this.heatShimmer.visible = heatOn;
    this.updateParticles(this.heatShimmer, this.heatVel, dt, 1.8, heatOn, {
      biasY: 1.4,
      biasZ: 0.6,
      rise: true,
    });

    // Boost sparks only when boosting
    this.boostSparks.visible = boost && rpm > 0.4;
    if (this.boostSparks.visible) {
      (this.boostSparks.material as THREE.PointsMaterial).opacity = 0.75;
      this.updateParticles(this.boostSparks, this.sparkVel, dt, 6.5, true, {
        biasY: 0.5,
        biasZ: 2.5,
      });
    }

    // Dust / water spray below
    const washStrength = rpm * THREE.MathUtils.clamp(1 - agl / 12, 0, 1);
    const groundBoost = onGround && rpm > 0.3 ? rpm * 0.55 : 0;
    const wash = Math.max(washStrength, groundBoost);
    const washMat = this.wash.material as THREE.PointsMaterial;
    if (overWater) {
      washMat.color.set(0xc8e8f0);
      washMat.opacity = wash * 0.75;
    } else {
      washMat.color.set(0xc2b280);
      washMat.opacity = wash * 0.7;
    }
    this.wash.visible = wash > 0.04;
    this.updateParticles(this.wash, this.washVel, dt, 5.5 + speed * 0.15 + wash * 3.5, wash > 0.04);

    this.updateTailTrail(dt, speed, rpm);

    void this.loaded;
  }

  private updateTailTrail(dt: number, speed: number, rpm: number) {
    // Record local-space sample behind the tail boom
    const active = rpm > 0.35 && speed > 2;
    const mat = this.tailTrail.material as THREE.PointsMaterial;
    if (!active) {
      mat.opacity = Math.max(0, mat.opacity - dt * 1.5);
      if (mat.opacity < 0.02) {
        this.trailPositions.length = 0;
        this.tailTrail.visible = false;
      }
      return;
    }
    this.tailTrail.visible = true;
    mat.opacity = 0.28 + Math.min(0.25, speed * 0.01);

    // Push a new sample at the tail (local +Z is aft after model yaw)
    this.trailPositions.unshift(new THREE.Vector3(0, 0.35, this.rotorRadius * 0.85));
    if (this.trailPositions.length > this.trailMax) this.trailPositions.pop();

    // Drift older samples further aft / fade by stretching
    const pos = this.tailTrail.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < this.trailMax; i++) {
      if (i < this.trailPositions.length) {
        const p = this.trailPositions[i];
        // Stretch trail aft over time
        p.z += dt * (2.5 + speed * 0.15);
        p.y += dt * 0.15;
        arr[i * 3] = p.x;
        arr[i * 3 + 1] = p.y;
        arr[i * 3 + 2] = p.z;
      } else {
        arr[i * 3] = 0;
        arr[i * 3 + 1] = -10;
        arr[i * 3 + 2] = 0;
      }
    }
    pos.needsUpdate = true;
  }

  private updateParticles(
    points: THREE.Points,
    vel: Float32Array,
    dt: number,
    spread: number,
    active: boolean,
    opts?: { biasY?: number; biasZ?: number; rise?: boolean },
  ) {
    const pos = points.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const biasY = opts?.biasY ?? 0;
    const biasZ = opts?.biasZ ?? 0;
    for (let i = 0; i < arr.length / 3; i++) {
      if (!active || Math.random() < 0.04) {
        arr[i * 3] = (Math.random() - 0.5) * 0.3;
        arr[i * 3 + 1] = Math.random() * 0.1;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
        vel[i * 3] = (Math.random() - 0.5) * spread;
        vel[i * 3 + 1] = Math.random() * spread * 0.4 + biasY;
        vel[i * 3 + 2] = (Math.random() - 0.5) * spread + biasZ;
        if (opts?.rise) vel[i * 3 + 1] = Math.abs(vel[i * 3 + 1]) + 0.5;
      } else {
        arr[i * 3] += vel[i * 3] * dt;
        arr[i * 3 + 1] += vel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
    }
    pos.needsUpdate = true;
  }
}
