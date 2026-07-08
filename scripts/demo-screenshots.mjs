/**
 * Final rebalance screenshots for HELI STRIKE.
 * Requires: npm run dev on http://127.0.0.1:5173, google-chrome, playwright-core.
 *
 * Outputs:
 *   heli-final-title.png  — title island
 *   heli-final-pad.png    — low hover on pad (pebble gravel + scatter)
 *   heli-final-water.png  — coastal dark reflective water
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
    let scales = [];
    for (let i = 0; i < g.world.gravel.mesh.count; i++) {
      g.world.gravel.mesh.getMatrixAt(i, mat4);
      const d = Math.hypot(mat4.elements[12] - 8, mat4.elements[14] - 5);
      if (d >= 7.0 && d < 10.5) {
        near++;
        // Approximate instance X scale from matrix column length
        const sx = Math.hypot(mat4.elements[0], mat4.elements[1], mat4.elements[2]);
        scales.push(sx);
      }
    }
    scales.sort((a, b) => a - b);
    const mid = scales[Math.floor(scales.length / 2)] ?? 0;
    const waterMat = g.world.water.mesh.material;
    return {
      padH: g.world.getHeight(8, 5),
      waterLevel: g.world.water.level,
      gravelNear: near,
      gravelCount: g.world.gravel.mesh.count,
      gravelMedianScale: mid,
      grassCount: g.world.grass.mesh.count,
      exposure: g.renderer.toneMappingExposure,
      fogDensity: g.scene.fog?.density ?? null,
      waterIsThreeWater: !!(waterMat && waterMat.uniforms && waterMat.uniforms.mirrorSampler),
      waterColor: waterMat?.uniforms?.waterColor?.value?.getHexString?.() ?? null,
      distortion: waterMat?.uniforms?.distortionScale?.value ?? null,
    };
  });
  console.log('sanity', sanity);

  // --- 1) Title ---
  await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    g.showTitle();
    const padH = g.world.getHeight(8, 5);
    g.cameraRig.camera.position.set(28, padH + 14, 32);
    g.cameraRig.camera.lookAt(8, padH + 1.5, 5);
    g.cameraRig.camera.fov = 52;
    g.cameraRig.camera.updateProjectionMatrix();
    for (let i = 0; i < 40; i++) {
      g.world.updateEffects(g.flight.state.position, 0.55, 1.0, true, 1 / 30);
      g.world.update(1 / 30);
    }
  });
  await sleep(600);
  const titlePath = path.join(OUT, 'heli-final-title.png');
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

  // --- 2) Low hover on pad: pebble gravel + scatter at 100% RPM ---
  const gravelPose = {
    x: 8,
    z: 5,
    y: padH + 1.55,
    rpm: 1.0,
    agl: 0.25,
    onGround: true,
    heading: 0.4,
    washSteps: 70,
    camX: 17.5,
    camY: padH + 5.8,
    camZ: 14.8,
    lookX: 9.2,
    lookY: padH + 0.35,
    lookZ: 6.0,
    fov: 44,
  };
  await poseClean(page, gravelPose);
  for (let i = 0; i < 8; i++) {
    await poseClean(page, { ...gravelPose, washSteps: 8 });
    await sleep(30);
  }
  const padPath = path.join(OUT, 'heli-final-pad.png');
  await page.screenshot({ path: padPath, type: 'png', timeout: 60000 });
  console.log('Wrote', padPath);

  // --- 3) Coastal water: over open ocean looking toward dry island (not flooded) ---
  await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    g.postfx.enabled = false;
    g.hud?.hide?.();
    g.world.gravel.reset();
    ['title-screen', 'briefing-screen', 'pause-screen', 'complete-screen', 'crash-screen'].forEach(
      (id) => document.getElementById(id)?.classList.remove('active'),
    );

    // Heli on dry pad shelf
    const hx = 8;
    const hz = 5;
    const hh = g.world.getHeight(hx, hz) + 3.2;
    g.flight.state.position.set(hx, hh, hz);
    g.flight.state.rpm = 0.65;
    g.flight.state.agl = 3.2;
    g.flight.state.onGround = false;
    g.heli.group.position.copy(g.flight.state.position);
    g.heli.group.rotation.set(0.04, Math.PI * 0.85, 0);
    g.flight.state.quaternion.copy(g.heli.group.quaternion);
    g.heli.update(1 / 60, 0.65, 3.2, 8, false);

    // Over coastal water looking at dry island — camera above open water south of pad
    g.cameraRig.camera.position.set(18, 7.5, -42);
    g.cameraRig.camera.lookAt(8, 3.0, 8);
    g.cameraRig.camera.fov = 50;
    g.cameraRig.camera.updateProjectionMatrix();
    g.world.water.setSunDirection(g.sun);

    for (let i = 0; i < 60; i++) g.world.update(1 / 30);
    for (let i = 0; i < 16; i++) {
      g.renderer.render(g.scene, g.cameraRig.camera);
    }

    window.__waterShore = {
      hx,
      hz,
      hh,
      oceanH: g.world.getHeight(18, -42),
      midH: g.world.getHeight(12, -20),
      padH: g.world.getHeight(8, 5),
      waterY: g.world.water.level,
      cam: [18, 7.5, -42],
    };
  });
  await sleep(400);
  const waterPath = path.join(OUT, 'heli-final-water.png');
  await page.screenshot({ path: waterPath, type: 'png', timeout: 60000 });
  console.log('Wrote', waterPath);

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
        paths: [titlePath, padPath, waterPath],
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
