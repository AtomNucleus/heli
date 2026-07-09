import * as THREE from 'three';

type HeightFn = (x: number, z: number) => number;

/**
 * Sparse pockets of low-poly interest — cabins, docks, turbines, markers, lights.
 * Kept clear of primary ring flight paths; uses InstancedMesh where repeated.
 */
export class DetailProps {
  readonly group = new THREE.Group();
  private turbines: { hub: THREE.Group; speed: number }[] = [];

  constructor(getHeight: HeightFn, waterLevel: number) {
    this.buildPrimaryPadCluster(getHeight);
    this.buildSecondaryPadDock(getHeight, waterLevel);
    this.buildRidgeCabin(getHeight);
    this.buildCoastalBayDock(getHeight, waterLevel);
    this.buildWindTurbines(getHeight);
    this.buildTrail(getHeight);
    this.buildShoreLights(getHeight, waterLevel);
    this.buildExtraRocks(getHeight);
    this.buildBuoys(getHeight, waterLevel);
    this.buildCheckpoints(getHeight);
  }

  update(dt: number) {
    for (const t of this.turbines) {
      t.hub.rotation.z += dt * t.speed;
    }
  }

  private placeOnTerrain(
    obj: THREE.Object3D,
    x: number,
    z: number,
    getHeight: HeightFn,
    yOff = 0,
  ) {
    const h = getHeight(x, z);
    obj.position.set(x, h + yOff, z);
    this.group.add(obj);
    return h;
  }

  private woodMat(color = 0x4a3828) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    });
  }

  private metalMat(color = 0x4a5560, emissive = 0x000000, ei = 0) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.45,
      metalness: 0.7,
      emissive,
      emissiveIntensity: ei,
      flatShading: true,
    });
  }

  private buildTower(height: number, color = 0x3a4550): THREE.Group {
    const g = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, height, 6), this.metalMat(color));
    mast.position.y = height * 0.5;
    mast.castShadow = true;
    g.add(mast);
    const dish = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.08, 8),
      this.metalMat(0x5a6870, 0x224466, 0.15),
    );
    dish.position.y = height * 0.85;
    dish.rotation.x = 0.4;
    g.add(dish);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 6, 6),
      new THREE.MeshStandardMaterial({
        color: 0xff6644,
        emissive: 0xff4422,
        emissiveIntensity: 0.9,
      }),
    );
    tip.position.y = height + 0.1;
    g.add(tip);
    return g;
  }

  private buildPrimaryPadCluster(getHeight: HeightFn) {
    // Runway markers leading toward primary pad (8, 5) from SE
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x2a3038,
      emissive: 0xffaa44,
      emissiveIntensity: 0.65,
      roughness: 0.5,
      metalness: 0.4,
    });
    const posts: THREE.Object3D[] = [];
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const x = 8 + 18 * (1 - t);
      const z = 5 + 22 * (1 - t);
      const h = getHeight(x, z);
      if (h < 1.2) continue;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.9, 6), postMat);
      post.position.set(x, h + 0.45, z);
      post.castShadow = true;
      this.group.add(post);
      posts.push(post);
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 6, 6),
        new THREE.MeshStandardMaterial({
          color: 0xffcc66,
          emissive: 0xffaa33,
          emissiveIntensity: 1.1,
        }),
      );
      cap.position.set(x, h + 0.95, z);
      this.group.add(cap);
    }

    const tower = this.buildTower(6.5);
    this.placeOnTerrain(tower, 18, -4, getHeight);

    // Small antenna near pad apron
    const ant = this.buildTower(3.2, 0x505860);
    this.placeOnTerrain(ant, 2, 14, getHeight);
    void posts;
  }

  private buildSecondaryPadDock(getHeight: HeightFn, waterLevel: number) {
    // Dock near secondary pad (-55, 40)
    const wood = this.woodMat(0x3d2e20);
    const pier = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 10), wood);
    deck.position.set(0, 0.2, 0);
    deck.castShadow = true;
    pier.add(deck);
    for (let i = 0; i < 5; i++) {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 2.2, 6), wood);
      pile.position.set((i % 2 === 0 ? -1.2 : 1.2), -0.6, -4 + i * 2);
      pier.add(pile);
    }
    const hx = -68;
    const hz = 48;
    pier.position.set(hx, Math.max(waterLevel, getHeight(hx, hz)) + 0.15, hz);
    pier.rotation.y = 0.6;
    this.group.add(pier);

    // Pilings / buoy line toward pad
    const buoyMat = new THREE.MeshStandardMaterial({
      color: 0xff5533,
      emissive: 0xff3311,
      emissiveIntensity: 0.7,
    });
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const x = -68 + (-55 + 68) * t * 0.7;
      const z = 48 + (40 - 48) * t * 0.7;
      const buoy = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.7, 6), buoyMat);
      buoy.position.set(x, waterLevel + 0.35, z);
      this.group.add(buoy);
    }
  }

  private buildRidgeCabin(getHeight: HeightFn) {
    const cabin = new THREE.Group();
    const wood = this.woodMat(0x4a3428);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.2, 3.4), wood);
    wall.position.y = 1.1;
    wall.castShadow = true;
    cabin.add(wall);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(3.2, 1.4, 4),
      this.woodMat(0x2a2018),
    );
    roof.position.y = 2.9;
    roof.rotation.y = Math.PI / 4;
    cabin.add(roof);
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1.4, 0.1),
      this.metalMat(0x1a1814),
    );
    door.position.set(0, 0.7, 1.75);
    cabin.add(door);
    const window = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.55, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0xffcc88,
        emissive: 0xffaa55,
        emissiveIntensity: 0.85,
      }),
    );
    window.position.set(1.2, 1.3, 1.72);
    cabin.add(window);

    this.placeOnTerrain(cabin, -12, -35, getHeight);
    const mast = this.buildTower(5.5);
    this.placeOnTerrain(mast, -8, -38, getHeight);
  }

  private buildCoastalBayDock(getHeight: HeightFn, waterLevel: number) {
    const wood = this.woodMat(0x453528);
    const pier = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 8), wood);
    deck.position.y = 0.15;
    pier.add(deck);
    for (let i = 0; i < 4; i++) {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.8, 5), wood);
      pile.position.set(i % 2 === 0 ? -0.9 : 0.9, -0.5, -3 + i * 2);
      pier.add(pile);
    }
    const x = 72;
    const z = 55;
    pier.position.set(x, Math.max(waterLevel + 0.1, getHeight(x, z) * 0.3 + waterLevel), z);
    pier.rotation.y = -0.9;
    this.group.add(pier);

    // Extra rocks near dock
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x3a4038,
      roughness: 0.95,
      flatShading: true,
    });
    for (let i = 0; i < 6; i++) {
      const rx = x + (Math.random() - 0.5) * 8;
      const rz = z + (Math.random() - 0.5) * 8;
      const rh = getHeight(rx, rz);
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + Math.random() * 0.6, 0), rockMat);
      rock.position.set(rx, Math.max(rh, waterLevel) + 0.2, rz);
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.castShadow = true;
      this.group.add(rock);
    }
  }

  private buildWindTurbines(getHeight: HeightFn) {
    const sites: [number, number][] = [
      [-90, -70],
      [-105, -55],
      [-80, -90],
    ];
    for (const [x, z] of sites) {
      const h = getHeight(x, z);
      if (h < 4) continue;
      const tower = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.55, 14, 8),
        this.metalMat(0xc8d0d4, 0x223344, 0.05),
      );
      pole.position.y = 7;
      pole.castShadow = true;
      tower.add(pole);

      const hub = new THREE.Group();
      hub.position.y = 14;
      const nacelle = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.7, 1.8),
        this.metalMat(0xb0b8bc),
      );
      hub.add(nacelle);
      const bladeMat = this.metalMat(0xe8ecee);
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.25, 6.5, 0.4), bladeMat);
        blade.position.y = 3.2;
        const arm = new THREE.Group();
        arm.rotation.z = (i * Math.PI * 2) / 3;
        arm.add(blade);
        hub.add(arm);
      }
      tower.add(hub);
      tower.position.set(x, h, z);
      this.group.add(tower);
      this.turbines.push({ hub, speed: 0.35 + Math.random() * 0.25 });
    }
  }

  private buildTrail(getHeight: HeightFn) {
    // Faint trail between pads (8,5) → (-55,40)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a2820,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });
    const segments = 18;
    for (let i = 0; i < segments; i++) {
      const t = i / (segments - 1);
      const x = THREE.MathUtils.lerp(8, -55, t) + Math.sin(t * 6) * 3;
      const z = THREE.MathUtils.lerp(5, 40, t) + Math.cos(t * 4) * 2.5;
      const h = getHeight(x, z);
      if (h < 1.5) continue;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 2.4), mat);
      slab.position.set(x, h + 0.04, z);
      const dx = -55 - 8;
      const dz = 40 - 5;
      slab.rotation.y = Math.atan2(dx, dz);
      slab.receiveShadow = true;
      this.group.add(slab);
    }
  }

  private buildShoreLights(getHeight: HeightFn, waterLevel: number) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffcc66,
      emissive: 0xffaa44,
      emissiveIntensity: 1.2,
      roughness: 0.4,
    });
    const points: [number, number][] = [
      [35, -55],
      [50, -40],
      [60, 10],
      [45, 50],
      [-20, 70],
      [-70, 30],
      [-40, -50],
      [15, -70],
      [80, 30],
      [-30, 55],
    ];
    for (const [x, z] of points) {
      const h = getHeight(x, z);
      const y = h > waterLevel + 0.5 ? h + 0.35 : waterLevel + 0.5;
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), mat);
      light.position.set(x, y, z);
      this.group.add(light);
    }
  }

  private buildExtraRocks(getHeight: HeightFn) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3a4038,
      roughness: 0.95,
      flatShading: true,
    });
    const clusters: [number, number][] = [
      [-65, 45],
      [70, 52],
      [20, -8],
      [-10, -32],
    ];
    for (const [cx, cz] of clusters) {
      for (let i = 0; i < 5; i++) {
        const x = cx + (Math.random() - 0.5) * 6;
        const z = cz + (Math.random() - 0.5) * 6;
        const h = getHeight(x, z);
        if (h < 0.8) continue;
        const s = 0.4 + Math.random() * 1.2;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), mat);
        rock.position.set(x, h + s * 0.25, z);
        rock.scale.set(s, s * 0.7, s);
        rock.rotation.set(Math.random(), Math.random(), Math.random());
        rock.castShadow = true;
        this.group.add(rock);
      }
    }
  }

  private buildBuoys(getHeight: HeightFn, waterLevel: number) {
    const colors = [0xff5533, 0xffcc33, 0x33ffaa, 0xff8833];
    const sites: [number, number][] = [
      [12, -12],
      [0, -8],
      [22, 18],
      [-50, 52],
      [-62, 35],
      [65, 48],
      [55, -25],
      [-25, 65],
      [40, 65],
      [-5, 25],
    ];
    for (let i = 0; i < sites.length; i++) {
      const [x, z] = sites[i];
      const h = getHeight(x, z);
      // Prefer near-shore / shallow
      if (h > 3.5) continue;
      const col = colors[i % colors.length];
      const mat = new THREE.MeshStandardMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 0.75,
        roughness: 0.4,
        metalness: 0.2,
      });
      const buoy = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.35, 0.85, 6), mat);
      buoy.position.set(x, waterLevel + 0.4, z);
      this.group.add(buoy);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 6, 6),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0xffffaa,
          emissiveIntensity: 1.4,
        }),
      );
      tip.position.set(x, waterLevel + 0.9, z);
      this.group.add(tip);
    }
  }

  private buildCheckpoints(getHeight: HeightFn) {
    // Glowing checkpoint pillars at a couple of course waypoints (off flight path center)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a4030,
      emissive: 0x3dff9a,
      emissiveIntensity: 0.55,
      roughness: 0.4,
      metalness: 0.3,
    });
    const spots: [number, number][] = [
      [40, -45],
      [85, 5],
      [-45, 10],
    ];
    for (const [x, z] of spots) {
      const h = getHeight(x, z);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 2.4, 6), mat);
      pillar.position.set(x, h + 1.2, z);
      pillar.castShadow = true;
      this.group.add(pillar);
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 8, 8),
        new THREE.MeshStandardMaterial({
          color: 0x3dff9a,
          emissive: 0x3dff9a,
          emissiveIntensity: 1.2,
          transparent: true,
          opacity: 0.7,
        }),
      );
      glow.position.set(x, h + 2.6, z);
      this.group.add(glow);
    }
  }
}
