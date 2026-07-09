/**
 * Cinematic visual-fidelity screenshots for HELI STRIKE.
 * Requires: npm run dev on http://127.0.0.1:5173, google-chrome, playwright-core.
 *
 * Outputs:
 *   heli-cinematic-title.png
 *   heli-cinematic-flight.png
 *   heli-cinematic-water.png
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

async function pose(page, opts) {
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
      g.heli.group.rotation.set(o.pitch ?? 0, o.heading, o.roll ?? 0);
      s.quaternion.copy(g.heli.group.quaternion);
    }

    g.heli.group.position.copy(s.position);
    g.heli.group.quaternion.copy(s.quaternion);
    g.heli.update(1 / 60, s.rpm, s.agl, o.speed ?? 0, s.onGround, !!o.boost, !!o.overWater);

    const steps = o.washSteps ?? 40;
    for (let i = 0; i < steps; i++) {
      g.world.updateEffects(s.position, s.rpm, s.agl, s.onGround, 1 / 30);
      g.world.update(1 / 30);
    }

    g.cameraRig.camera.position.set(o.camX, o.camY, o.camZ);
    g.cameraRig.camera.lookAt(o.lookX, o.lookY, o.lookZ);
    g.cameraRig.camera.fov = o.fov ?? 52;
    g.cameraRig.camera.updateProjectionMatrix();
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
  await sleep(2500);

  const sanity = await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    const waterMat = g.world.water.mesh.material;
    const fog = g.scene.fog;
    return {
      padH: g.world.getHeight(8, 5),
      waterLevel: g.world.water.level,
      exposure: g.renderer.toneMappingExposure,
      fogDensity: fog?.density ?? null,
      fogColor: fog?.color?.getHexString?.() ?? null,
      hasDetails: !!g.world.details,
      hasWash: !!g.world.washDecals,
      hasFoam: !!g.world.shoreFoam,
      ringCount: g.world.rings.count,
      waterPatched: !!(waterMat?.fragmentShader && waterMat.fragmentShader.includes('waveHi')),
    };
  });
  console.log('sanity', sanity);

  // --- 1) Title: cinematic island dusk — look toward sun behind the pad ---
  await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    g.showTitle();
    const padH = g.world.getHeight(8, 5);
    // Place camera opposite the sun so the warm horizon sits behind the pad
    const sun = g.sun.clone().normalize();
    g.cameraRig.camera.position.set(
      8 - sun.x * 52,
      padH + 14,
      5 - sun.z * 52,
    );
    g.cameraRig.camera.lookAt(8, padH + 2.5, 5);
    g.cameraRig.camera.fov = 48;
    g.cameraRig.camera.updateProjectionMatrix();
    for (let i = 0; i < 50; i++) {
      g.world.updateEffects(g.flight.state.position, 0.55, 1.0, true, 1 / 30);
      g.world.update(1 / 30);
    }
  });
  await sleep(700);
  const titlePath = path.join(OUT, 'heli-cinematic-title.png');
  await page.screenshot({ path: titlePath, type: 'png', timeout: 60000 });
  console.log('Wrote', titlePath);

  await page.click('#btn-enter');
  await sleep(1000);
  await setupDemoLocks(page);
  await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    g.phase = 'playing';
    g.hud?.show?.();
    ['title-screen', 'briefing-screen', 'pause-screen', 'complete-screen', 'crash-screen'].forEach(
      (id) => document.getElementById(id)?.classList.remove('active'),
    );
  });

  // --- 2) Flight: heli + rings + rim light against sunset ---
  const ring0 = await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    const d = g.world.rings.defs[0];
    return { x: d.position.x, y: d.position.y, z: d.position.z };
  });

  const flightPose = {
    x: ring0.x - 12,
    z: ring0.z + 6,
    y: ring0.y + 0.5,
    rpm: 0.95,
    agl: 14,
    onGround: false,
    heading: -0.55,
    pitch: 0.06,
    speed: 28,
    boost: true,
    washSteps: 30,
    // Frame heli + active ring with sun off to the side (not dead-center blowout)
    camX: ring0.x - 22,
    camY: ring0.y + 4,
    camZ: ring0.z + 22,
    lookX: ring0.x - 2,
    lookY: ring0.y - 1,
    lookZ: ring0.z - 2,
    fov: 50,
  };
  await pose(page, flightPose);
  for (let i = 0; i < 6; i++) {
    await pose(page, { ...flightPose, washSteps: 6 });
    await sleep(40);
  }
  const flightPath = path.join(OUT, 'heli-cinematic-flight.png');
  await page.screenshot({ path: flightPath, type: 'png', timeout: 60000 });
  console.log('Wrote', flightPath);

  // --- 3) Water: coastal readability + foam + buoys + wash ---
  await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
    g.hud?.hide?.();
  });

  const waterPose = {
    x: 6,
    z: -14,
    y: 3.8,
    rpm: 0.95,
    agl: 2.8,
    onGround: false,
    heading: Math.PI * 0.85,
    pitch: 0.04,
    speed: 10,
    overWater: true,
    washSteps: 80,
    // Low coastal angle — foam, buoys, wash, pad markers
    camX: -14,
    camY: 5.5,
    camZ: -36,
    lookX: 10,
    lookY: 1.8,
    lookZ: 2,
    fov: 46,
  };
  await pose(page, waterPose);
  for (let i = 0; i < 8; i++) {
    await pose(page, { ...waterPose, washSteps: 8 });
    await sleep(40);
  }
  const waterPath = path.join(OUT, 'heli-cinematic-water.png');
  await page.screenshot({ path: waterPath, type: 'png', timeout: 60000 });
  console.log('Wrote', waterPath);

  await page.evaluate(() => {
    const g = window.__game || window.__HELI_DEBUG;
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
        paths: [titlePath, flightPath, waterPath],
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
