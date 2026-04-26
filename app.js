const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d", { alpha: false });
const fpsLabel = document.getElementById("fps");
const modeLabel = document.getElementById("mode");

const state = {
  w: 0,
  h: 0,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
  time: 0,
  last: performance.now(),
  frames: 0,
  fpsTime: 0,
  fps: 0,
  glow: true,
  blur: true,
  inputMode: "Keyboard/Mouse",
};

const heli = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  angle: 0,
  angularVelocity: 0,
  thrust: 0,
  boost: false,
};

const input = {
  left: false,
  right: false,
  thrust: false,
  boost: false,
  brake: false,
};

const stars = Array.from({ length: 180 }, () => ({
  x: Math.random(),
  y: Math.random(),
  z: 0.2 + Math.random() * 1.1,
  twinkle: Math.random() * Math.PI * 2,
}));

const particles = [];

function resize() {
  state.w = window.innerWidth;
  state.h = window.innerHeight;
  canvas.width = Math.floor(state.w * state.dpr);
  canvas.height = Math.floor(state.h * state.dpr);
  canvas.style.width = `${state.w}px`;
  canvas.style.height = `${state.h}px`;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

  if (!heli.x && !heli.y) {
    resetHeli();
  }
}

function resetHeli() {
  heli.x = state.w * 0.5;
  heli.y = state.h * 0.45;
  heli.vx = 0;
  heli.vy = 0;
  heli.angle = -Math.PI / 2;
  heli.angularVelocity = 0;
}

function emitExhaust() {
  const speed = Math.hypot(heli.vx, heli.vy);
  const count = heli.thrust > 0 ? 4 : speed > 140 ? 1 : 0;
  for (let i = 0; i < count; i++) {
    const dir = heli.angle + Math.PI + (Math.random() - 0.5) * 0.7;
    const force = 120 + Math.random() * 140 + speed * 0.2;
    particles.push({
      x: heli.x - Math.cos(heli.angle) * 24,
      y: heli.y - Math.sin(heli.angle) * 24,
      vx: Math.cos(dir) * force + (Math.random() - 0.5) * 40,
      vy: Math.sin(dir) * force + (Math.random() - 0.5) * 40,
      life: 0.4 + Math.random() * 0.35,
      age: 0,
      size: 1.2 + Math.random() * 2.7,
      hue: 190 + Math.random() * 65,
    });
  }
}

function physics(dt) {
  const rotateAccel = 4.8;
  if (input.left) heli.angularVelocity -= rotateAccel * dt;
  if (input.right) heli.angularVelocity += rotateAccel * dt;

  heli.angularVelocity *= input.brake ? 0.85 : 0.93;
  heli.angle += heli.angularVelocity;

  const targetThrust = input.thrust ? 1 : 0;
  heli.thrust += (targetThrust - heli.thrust) * Math.min(1, dt * 10);

  const boostMult = input.boost ? 1.8 : 1;
  const thrustForce = 470 * heli.thrust * boostMult;
  heli.vx += Math.cos(heli.angle) * thrustForce * dt;
  heli.vy += Math.sin(heli.angle) * thrustForce * dt;

  // Ambient drift + pseudo-gravity for richer movement feel.
  heli.vx += Math.sin(state.time * 0.5 + heli.y * 0.002) * 6 * dt;
  heli.vy += 34 * dt;

  const damping = input.brake ? 0.965 : 0.988;
  heli.vx *= damping;
  heli.vy *= damping;

  heli.x += heli.vx * dt;
  heli.y += heli.vy * dt;

  const margin = 60;
  if (heli.x < -margin) heli.x = state.w + margin;
  if (heli.x > state.w + margin) heli.x = -margin;
  if (heli.y < -margin) heli.y = state.h + margin;
  if (heli.y > state.h + margin) heli.y = -margin;

  emitExhaust();

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.96;
    p.vy *= 0.96;
    if (p.age >= p.life) particles.splice(i, 1);
  }
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, state.h);
  g.addColorStop(0, "#0b1538");
  g.addColorStop(0.5, "#0a1025");
  g.addColorStop(1, "#04060f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, state.w, state.h);

  for (const s of stars) {
    const px = ((s.x * state.w + state.time * 8 * s.z) % (state.w + 8)) - 4;
    const py = (s.y * state.h + Math.sin(state.time * 0.35 + s.twinkle) * 4 * s.z) % state.h;
    const a = 0.35 + Math.sin(state.time * 2.1 + s.twinkle) * 0.25;
    ctx.fillStyle = `rgba(180,210,255,${a})`;
    ctx.fillRect(px, py, s.z * 1.4, s.z * 1.4);
  }
}

function drawParticles() {
  for (const p of particles) {
    const t = 1 - p.age / p.life;
    ctx.fillStyle = `hsla(${p.hue}, 90%, 65%, ${t * 0.8})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHeli() {
  ctx.save();
  ctx.translate(heli.x, heli.y);
  ctx.rotate(heli.angle);

  if (state.glow) {
    ctx.shadowBlur = 26;
    ctx.shadowColor = "#5be7ff";
  }

  // body
  ctx.fillStyle = "#7de9ff";
  ctx.beginPath();
  ctx.moveTo(26, 0);
  ctx.lineTo(-18, -10);
  ctx.lineTo(-24, 0);
  ctx.lineTo(-18, 10);
  ctx.closePath();
  ctx.fill();

  // cockpit
  ctx.fillStyle = "#c2fff8";
  ctx.beginPath();
  ctx.ellipse(6, 0, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // tail
  ctx.fillStyle = "#86bfff";
  ctx.fillRect(-26, -2, 14, 4);

  // rotor mast
  ctx.fillStyle = "#d8eaff";
  ctx.fillRect(-1, -17, 2, 14);

  // rotor blades
  const rotor = state.time * 35;
  ctx.save();
  ctx.translate(0, -17);
  ctx.rotate(rotor);
  ctx.fillStyle = "#dcf2ff";
  ctx.fillRect(-36, -1.25, 72, 2.5);
  ctx.rotate(Math.PI / 2);
  ctx.fillRect(-21, -1.25, 42, 2.5);
  ctx.restore();

  // light trails
  if (state.glow) {
    ctx.strokeStyle = "rgba(106, 246, 255, 0.65)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-24, -8);
    ctx.lineTo(-36 - heli.thrust * 12, -4);
    ctx.moveTo(-24, 8);
    ctx.lineTo(-36 - heli.thrust * 12, 4);
    ctx.stroke();
  }

  ctx.restore();
}

function drawMotionBlur() {
  if (!state.blur) return;
  const speed = Math.hypot(heli.vx, heli.vy);
  const alpha = Math.min(0.16, speed / 2400);
  if (alpha <= 0.01) return;

  ctx.fillStyle = `rgba(6, 8, 18, ${alpha})`;
  ctx.fillRect(0, 0, state.w, state.h);
}

function render(dt) {
  drawMotionBlur();
  drawBackground();
  drawParticles();
  drawHeli();

  state.frames += 1;
  state.fpsTime += dt;
  if (state.fpsTime >= 0.35) {
    state.fps = Math.round(state.frames / state.fpsTime);
    fpsLabel.textContent = `FPS: ${state.fps}`;
    modeLabel.textContent = `Input: ${state.inputMode}`;
    state.frames = 0;
    state.fpsTime = 0;
  }
}

function loop(now) {
  const dt = Math.min(0.032, (now - state.last) / 1000);
  state.last = now;
  state.time += dt;

  updateGamepad();
  physics(dt);
  render(dt);

  requestAnimationFrame(loop);
}

const keyMap = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "thrust",
  a: "left",
  d: "right",
  w: "thrust",
  Shift: "boost",
  " ": "brake",
};

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.key === "r" || e.key === "R") resetHeli();
  if (e.key === "m" || e.key === "M") state.blur = !state.blur;
  if (e.key === "g" || e.key === "G") state.glow = !state.glow;

  const mapped = keyMap[e.key];
  if (mapped) {
    input[mapped] = true;
    state.inputMode = "Keyboard/Mouse";
    e.preventDefault();
  }
});

window.addEventListener("keyup", (e) => {
  const mapped = keyMap[e.key];
  if (mapped) {
    input[mapped] = false;
    e.preventDefault();
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (e.buttons !== 1) return;
  const tx = e.clientX;
  const ty = e.clientY;
  const angleTarget = Math.atan2(ty - heli.y, tx - heli.x);
  let delta = angleTarget - heli.angle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  heli.angularVelocity += delta * 0.025;
  input.thrust = true;
  state.inputMode = "Keyboard/Mouse";
});

canvas.addEventListener("mouseup", () => {
  input.thrust = false;
});

function bindTouchControls() {
  const touch = document.getElementById("touchControls");
  touch.querySelectorAll("button").forEach((btn) => {
    const action = btn.dataset.action;
    const on = () => {
      input[action] = true;
      state.inputMode = "Touch";
    };
    const off = () => (input[action] = false);

    btn.addEventListener("touchstart", on, { passive: true });
    btn.addEventListener("touchend", off, { passive: true });
    btn.addEventListener("touchcancel", off, { passive: true });
    btn.addEventListener("mousedown", on);
    btn.addEventListener("mouseup", off);
    btn.addEventListener("mouseleave", off);
  });
}

function updateGamepad() {
  const gp = navigator.getGamepads?.()[0];
  if (!gp) return;

  const dead = 0.2;
  const x = Math.abs(gp.axes[0]) > dead ? gp.axes[0] : 0;
  const y = Math.abs(gp.axes[1]) > dead ? gp.axes[1] : 0;

  input.left = x < -0.2 || gp.buttons[14]?.pressed;
  input.right = x > 0.2 || gp.buttons[15]?.pressed;
  input.thrust = y < -0.15 || gp.buttons[0]?.pressed || gp.buttons[7]?.pressed;
  input.boost = gp.buttons[1]?.pressed || gp.buttons[5]?.pressed;
  input.brake = gp.buttons[2]?.pressed || gp.buttons[6]?.pressed;

  if (input.left || input.right || input.thrust || input.boost || input.brake) {
    state.inputMode = "Gamepad";
  }
}

window.addEventListener("resize", resize);
window.addEventListener("gamepadconnected", () => {
  state.inputMode = "Gamepad";
});

resize();
bindTouchControls();
requestAnimationFrame(loop);
