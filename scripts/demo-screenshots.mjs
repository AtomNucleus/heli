/**
 * Visual fidelity proof screenshots (v3) for HELI STRIKE.
 * Requires: npm run dev on http://127.0.0.1:5173, google-chrome, playwright-core.
 *
 * Outputs:
 *   heli-title-v3.png          — title island + grass
 *   heli-flight-gravel-v3.png  — low over pad, gravel apron + scatter
 *   heli-flight-water-v3.png   — coastal / over water reflections
 *   heli-grass-wash-v3.png     — grass flatten under rotor (extra proof)
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const OUT = '/opt/cursor/artifacts/screenshots';
const BASE = 'http://127.0.0.1:5173';
const CHROME = '/usr/local/bin/google-chrome';

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForGame(page, timeout = 45000) {
  await page.waitForFunction(() => !!(window.__game || window.__HELI_DEBUG), { timeout });
}

async function setupDemoLocks(page) {
  await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    g.flight.update = function (_dt, _input, terrainHeight) {
      const s = this.state;
      s.agl = Math.max(0, s.position.y - terrainHeight - 1.05);
      s.onGround = s.agl < 0.45;
      s.crashed = false;
      s.velocity.set(0, 0, 0);
      s.angularVelocity.set(0, 0, 0);
    };
    g.cameraRig.update = function () {
      /* camera set explicitly by demo */
    };
  });
}

async function poseClean(page, opts) {
  await page.evaluate((o) => {
    const g = window.__game || window.__HELI_DEBUG;
    const s = g.flight.state;
    const terrainH = g.world.getHeight(o.x, o.z);
    const y = o.y != null ? o.y : terrainH + (o.aglLift ?? 1.4);
    s.position.set(o.x, y, o.z);
    s.rpm = o.rpm;
    s.onGround = !!o.onGround;
    s.agl = o.agl;
    s.crashed = false;
    s.velocity.set(0, 0, 0);
    s.angularVelocity.set(0, 0, 0);

    if (o.heading != null) {
      g.heli.group.rotation.set(0, o.heading, 0);
      s.quaternion.copy(g.heli.group.quaternion);
    }

    g.heli.group.position.copy(s.position);
    g.heli.group.quaternion.copy(s.quaternion);
    g.heli.update(1 / 60, s.rpm, s.agl, 0, s.onGround);

    const steps = o.washSteps ?? 50;
    for (let i = 0; i < steps; i++) {
      g.world.updateEffects(s.position, s.rpm, s.agl, s.onGround, 1 / 30);
    }
    if (o.tickWater) {
      for (let i = 0; i < 20; i++) g.world.update(1 / 30);
    }

    g.cameraRig.camera.position.set(o.camX, o.camY, o.camZ);
    g.cameraRig.camera.lookAt(o.lookX, o.lookY, o.lookZ);
    g.cameraRig.camera.fov = o.fov ?? 55;
    g.cameraRig.camera.updateProjectionMatrix();

    if (o.forceMirror) {
      for (let i = 0; i < 6; i++) {
        g.renderer.render(g.scene, g.cameraRig.camera);
      }
    }
  }, opts);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const errors = [];

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader-webgl',
    ],
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });

  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });

  console.log('Loading', BASE);
  await page.goto(BASE + '/?demo=' + Date.now(), { waitUntil: 'networkidle', timeout: 90000 });
  await waitForGame(page);
  await sleep(2000);

  const sanity = await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    const mat4 = g.heli.group.matrix.clone();
    let near = 0;
    let bright = 0;
    const col = new Float32Array(3);
    for (let i = 0; i < g.world.gravel.mesh.count; i++) {
      g.world.gravel.mesh.getMatrixAt(i, mat4);
      const d = Math.hypot(mat4.elements[12] - 8, mat4.elements[14] - 5);
      if (d >= 6.5 && d < 12) {
        near++;
        if (g.world.gravel.mesh.instanceColor) {
          const c = g.world.gravel.mesh.instanceColor;
          const lum = c.getX(i) * 0.3 + c.getY(i) * 0.59 + c.getZ(i) * 0.11;
          if (lum > 0.7) bright++;
        }
      }
    }
    const waterMat = g.world.water.mesh.material;
    return {
      padH: g.world.getHeight(8, 5),
      gravelNear: near,
      gravelBright: bright,
      gravelCount: g.world.gravel.mesh.count,
      grassCount: g.world.grass.mesh.count,
      waterIsThreeWater: !!(waterMat && waterMat.uniforms && waterMat.uniforms.mirrorSampler),
      waterColor: waterMat?.uniforms?.waterColor?.value?.getHexString?.() ?? null,
    };
  });
  console.log('sanity', sanity);

  // --- 1) Title: island + grass ---
  await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    g.showTitle();
    // Orbit camera toward grassy shelf + pad
    const padH = g.world.getHeight(8, 5);
    g.cameraRig.camera.position.set(28, padH + 14, 32);
    g.cameraRig.camera.lookAt(8, padH + 1.5, 5);
    g.cameraRig.camera.fov = 52;
    g.cameraRig.camera.updateProjectionMatrix();
    // Drive light attract wash so nearby grass tips move
    for (let i = 0; i < 40; i++) {
      g.world.updateEffects(g.flight.state.position, 0.55, 1.0, true, 1 / 30);
      g.world.update(1 / 30);
    }
  });
  await sleep(600);
  const titlePath = path.join(OUT, 'heli-title-v3.png');
  await page.screenshot({ path: titlePath, type: 'png', timeout: 60000 });
  console.log('Wrote', titlePath);

  await page.click('#btn-enter');
  await sleep(1000);
  await setupDemoLocks(page);
  await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    g.phase = 'playing';
    g.hud?.show?.();
  });

  const padH = await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    return g.world.getHeight(8, 5);
  });

  // --- 2) Flight low over pad: gravel apron + scatter ---
  const gravelPose = {
    x: 8,
    z: 5,
    y: padH + 1.55,
    rpm: 1.0,
    agl: 0.25,
    onGround: true,
    heading: 0.4,
    washSteps: 70,
    // Low chase looking across apron ring — grains fill lower frame
    camX: 17.5,
    camY: padH + 5.8,
    camZ: 14.8,
    lookX: 9.2,
    lookY: padH + 0.45,
    lookZ: 6.0,
    fov: 44,
  };
  await poseClean(page, gravelPose);
  for (let i = 0; i < 8; i++) {
    await poseClean(page, { ...gravelPose, washSteps: 8 });
    await sleep(30);
  }
  const gravelPath = path.join(OUT, 'heli-flight-gravel-v3.png');
  await page.screenshot({ path: gravelPath, type: 'png', timeout: 60000 });
  console.log('Wrote', gravelPath);

  // Also keep legacy name for continuity
  await page.screenshot({ path: path.join(OUT, 'heli-gravel-wash.png'), type: 'png', timeout: 60000 });

  // --- 3) Grass wash near pad apron ---
  const grassSpot = await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    const mat4 = g.heli.group.matrix.clone();
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < g.world.grass.mesh.count; i += 3) {
      g.world.grass.mesh.getMatrixAt(i, mat4);
      const x = mat4.elements[12];
      const z = mat4.elements[14];
      const dPad = Math.hypot(x - 8, z - 5);
      if (dPad < 12 || dPad > 28) continue;
      const h = g.world.getHeight(x, z);
      if (h < 3.0) continue;
      let n = 0;
      for (let j = 0; j < g.world.grass.mesh.count; j += 7) {
        g.world.grass.mesh.getMatrixAt(j, mat4);
        if (Math.hypot(mat4.elements[12] - x, mat4.elements[14] - z) < 6) n++;
      }
      const score = n + h * 0.25;
      if (score > bestScore) {
        bestScore = score;
        best = { x, z, h, n, dPad };
      }
    }
    return best || { x: 20, z: -6, h: g.world.getHeight(20, -6), n: 0, dPad: 0 };
  });
  console.log('grassSpot', grassSpot);

  // Reset gravel so prior pad scatter doesn't pollute grass field
  await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    g.world.gravel.reset();
  });

  const grassPose = {
    x: grassSpot.x,
    z: grassSpot.z,
    y: grassSpot.h + 1.55,
    rpm: 1.0,
    agl: 0.55,
    onGround: false,
    heading: 0.2,
    washSteps: 35,
    // Ground-level side angle — parting blades fill foreground
    camX: grassSpot.x + 3.2,
    camY: grassSpot.h + 1.15,
    camZ: grassSpot.z + 3.8,
    lookX: grassSpot.x - 0.2,
    lookY: grassSpot.h + 0.05,
    lookZ: grassSpot.z - 0.2,
    fov: 48,
  };
  await poseClean(page, grassPose);
  for (let i = 0; i < 8; i++) {
    await poseClean(page, { ...grassPose, washSteps: 4 });
    await sleep(30);
  }
  const grassPath = path.join(OUT, 'heli-grass-wash-v3.png');
  await page.screenshot({ path: grassPath, type: 'png', timeout: 60000 });
  console.log('Wrote', grassPath);
  await page.screenshot({ path: path.join(OUT, 'heli-grass-wash.png'), type: 'png', timeout: 60000 });

  // --- 4) Coastal / over water reflections (known bay at ~70,109) ---
  await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    g.postfx.enabled = false;
    g.hud?.hide?.();
    g.world.gravel.reset();
    ['title-screen', 'briefing-screen', 'pause-screen', 'complete-screen', 'crash-screen'].forEach(
      (id) => document.getElementById(id)?.classList.remove('active'),
    );

    // Known underwater bay (terrain ~ -1 near 70,109) — heli on nearby shelf
    const hx = 55;
    const hz = 85;
    const hh = Math.max(2.5, g.world.getHeight(hx, hz)) + 4.0;
    g.flight.state.position.set(hx, hh, hz);
    g.flight.state.rpm = 0.85;
    g.flight.state.agl = 4.0;
    g.flight.state.onGround = false;
    g.heli.group.position.copy(g.flight.state.position);
    g.heli.group.rotation.set(0.06, 0.9, 0);
    g.flight.state.quaternion.copy(g.heli.group.quaternion);
    g.heli.update(1 / 60, 0.85, 4.0, 12, false);

    // Camera over flooded bay looking toward shore + heli (water fills lower frame)
    g.cameraRig.camera.position.set(95, 11, 130);
    g.cameraRig.camera.lookAt(60, 1.5, 90);
    g.cameraRig.camera.fov = 58;
    g.cameraRig.camera.updateProjectionMatrix();
    g.world.water.setSunDirection(g.sun);

    for (let i = 0; i < 50; i++) g.world.update(1 / 30);
    for (let i = 0; i < 12; i++) {
      g.renderer.render(g.scene, g.cameraRig.camera);
    }

    window.__waterShore = {
      hx,
      hz,
      hh,
      bayH: g.world.getHeight(70, 109),
      waterY: g.world.water.level,
      cam: [95, 11, 130],
    };
  });
  await sleep(400);
  const waterPath = path.join(OUT, 'heli-flight-water-v3.png');
  await page.screenshot({ path: waterPath, type: 'png', timeout: 60000 });
  console.log('Wrote', waterPath);
  await page.screenshot({
    path: path.join(OUT, 'heli-water-reflect.png'),
    type: 'png',
    timeout: 60000,
  });

  const shoreInfo = await page.evaluate(() => window.__waterShore);
  console.log('shore', shoreInfo);

  await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    g.postfx.enabled = true;
    g.hud?.show?.();
  });

  await browser.close();

  const unique = [...new Set(errors)];
  console.log(
    JSON.stringify(
      {
        errors: unique,
        errorCount: unique.length,
        sanity,
        shore: shoreInfo,
        paths: [titlePath, gravelPath, grassPath, waterPath],
      },
      null,
      2,
    ),
  );
  if (unique.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
