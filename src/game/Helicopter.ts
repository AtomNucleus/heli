import * as THREE from 'three';

function mat(opts: THREE.MeshStandardMaterialParameters) {
  return new THREE.MeshStandardMaterial(opts);
}

export class Helicopter {
  readonly group = new THREE.Group();
  readonly mainRotor = new THREE.Group();
  readonly tailRotor = new THREE.Group();
  private rotorDisk: THREE.Mesh;
  private exhaust: THREE.Points;
  private wash: THREE.Points;
  private exhaustVel: Float32Array;
  private washVel: Float32Array;

  private rotorAngle = 0;
  private tailAngle = 0;

  constructor() {
    this.buildAirframe();
    this.rotorDisk = this.buildRotorDisk();
    this.group.add(this.rotorDisk);

    const exhaustData = this.buildParticles(48, 0xffaa66, 0.08);
    this.exhaust = exhaustData.points;
    this.exhaustVel = exhaustData.velocities;
    this.exhaust.position.set(-0.15, 0.55, 1.1);
    this.group.add(this.exhaust);

    const washData = this.buildParticles(64, 0xc2b280, 0.12);
    this.wash = washData.points;
    this.washVel = washData.velocities;
    this.wash.position.set(0, -1.2, 0);
    this.group.add(this.wash);

    this.group.castShadow = true;
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  private buildAirframe() {
    const bodyMat = mat({
      color: 0x2a3530,
      metalness: 0.72,
      roughness: 0.38,
    });
    const accentMat = mat({
      color: 0x1a4d3a,
      metalness: 0.55,
      roughness: 0.42,
      emissive: 0x0a2a1a,
      emissiveIntensity: 0.15,
    });
    const darkMat = mat({ color: 0x121816, metalness: 0.8, roughness: 0.35 });
    const glassMat = mat({
      color: 0x88ccee,
      metalness: 0.9,
      roughness: 0.08,
      transparent: true,
      opacity: 0.45,
      envMapIntensity: 1.2,
    });
    const skidMat = mat({ color: 0x3a4038, metalness: 0.85, roughness: 0.3 });
    const rotorMat = mat({ color: 0x1c221e, metalness: 0.4, roughness: 0.55 });
    const tipMat = mat({
      color: 0x3dff9a,
      emissive: 0x3dff9a,
      emissiveIntensity: 0.6,
      metalness: 0.3,
      roughness: 0.4,
    });

    // Fuselage
    const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.8, 6, 12), bodyMat);
    fuselage.rotation.z = Math.PI / 2;
    fuselage.scale.set(1, 0.85, 1.05);
    fuselage.position.set(0, 0.15, 0.1);
    this.group.add(fuselage);

    // Nose
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.48, 12, 10), bodyMat);
    nose.scale.set(1.1, 0.85, 1.3);
    nose.position.set(0, 0.12, -1.15);
    this.group.add(nose);

    // Cockpit glass
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.52, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), glassMat);
    canopy.scale.set(0.95, 0.75, 1.1);
    canopy.position.set(0, 0.35, -0.55);
    this.group.add(canopy);

    // Cabin stripe
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.08, 1.6), accentMat);
    stripe.position.set(0, 0.05, 0.05);
    this.group.add(stripe);

    // Tail boom
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 2.4, 8), bodyMat);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 0.35, 2.0);
    this.group.add(boom);

    // Vertical stabilizer
    const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.55), darkMat);
    vStab.position.set(0, 0.7, 3.05);
    this.group.add(vStab);

    const hStab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.35), darkMat);
    hStab.position.set(0, 0.45, 2.85);
    this.group.add(hStab);

    // Engine hump
    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.9), darkMat);
    engine.position.set(0, 0.55, 0.35);
    this.group.add(engine);

    // Landing skids
    const skidGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6);
    for (const x of [-0.55, 0.55]) {
      const skid = new THREE.Mesh(skidGeo, skidMat);
      skid.rotation.z = Math.PI / 2;
      skid.rotation.y = Math.PI / 2;
      skid.position.set(x, -0.55, -0.1);
      this.group.add(skid);

      for (const z of [-0.7, 0.6]) {
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 5), skidMat);
        strut.position.set(x, -0.28, z);
        this.group.add(strut);
      }
    }

    // Main rotor hub + blades
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.2, 10), darkMat);
    hub.position.set(0, 0.85, 0.15);
    this.group.add(hub);

    this.mainRotor.position.set(0, 0.95, 0.15);
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 3.6), rotorMat);
      blade.position.z = 0;
      const pivot = new THREE.Group();
      pivot.rotation.y = (i * Math.PI) / 2;
      blade.position.z = -1.7;
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.032, 0.25), tipMat);
      tip.position.z = -3.45;
      pivot.add(blade, tip);
      this.mainRotor.add(pivot);
    }
    this.group.add(this.mainRotor);

    // Mast
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 6), darkMat);
    mast.position.set(0, 0.78, 0.15);
    this.group.add(mast);

    // Tail rotor
    this.tailRotor.position.set(0.12, 0.65, 3.15);
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.7), rotorMat);
      const pivot = new THREE.Group();
      pivot.rotation.x = (i * Math.PI * 2) / 3;
      blade.position.z = 0.3;
      pivot.add(blade);
      this.tailRotor.add(pivot);
    }
    this.group.add(this.tailRotor);

    // Nav lights
    const lightGeo = new THREE.SphereGeometry(0.05, 6, 6);
    const red = mat({ color: 0xff3333, emissive: 0xff2222, emissiveIntensity: 1.2 });
    const green = mat({ color: 0x33ff66, emissive: 0x22ff55, emissiveIntensity: 1.2 });
    const leftLight = new THREE.Mesh(lightGeo, red);
    leftLight.position.set(-0.55, 0.2, -0.3);
    const rightLight = new THREE.Mesh(lightGeo, green);
    rightLight.position.set(0.55, 0.2, -0.3);
    this.group.add(leftLight, rightLight);
  }

  private buildRotorDisk(): THREE.Mesh {
    const geo = new THREE.CircleGeometry(3.5, 32);
    const matDisk = new THREE.MeshBasicMaterial({
      color: 0x889988,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const disk = new THREE.Mesh(geo, matDisk);
    disk.rotation.x = -Math.PI / 2;
    disk.position.set(0, 0.95, 0.15);
    return disk;
  }

  private buildParticles(count: number, color: number, size: number) {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
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
    this.mainRotor.rotation.y = this.rotorAngle;
    this.tailRotor.rotation.x = this.tailAngle;

    const diskMat = this.rotorDisk.material as THREE.MeshBasicMaterial;
    diskMat.opacity = THREE.MathUtils.clamp((rpm - 0.55) * 1.4, 0, 0.28);
    this.mainRotor.visible = diskMat.opacity < 0.2;

    this.updateParticles(this.exhaust, this.exhaustVel, dt, 2.5, rpm > 0.3);
    const washStrength = rpm * THREE.MathUtils.clamp(1 - agl / 10, 0, 1);
    (this.wash.material as THREE.PointsMaterial).opacity = washStrength * 0.5;
    this.wash.visible = (washStrength > 0.05 && !onGround) || (onGround && rpm > 0.4);
    this.updateParticles(this.wash, this.washVel, dt, 4 + speed * 0.1, washStrength > 0.05);
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
