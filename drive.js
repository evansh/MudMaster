// Distances are in world pixels and time is in seconds.
const surfaces = {
  grass: { name: 'Grass', grip: 4.3, drag: 0.56, pace: 0.87, color: '#293821' },
  trail: { name: 'Packed dirt', grip: 6.5, drag: 0.38, pace: 1, color: '#57462f' },
  forest: { name: 'Pine needles', grip: 4, drag: 0.73, pace: 0.8, color: '#2a3925' },
  rock: { name: 'Loose rock', grip: 3.6, drag: 0.9, pace: 0.72, color: '#544d42' },
  sand: { name: 'Soft sand', grip: 2.6, drag: 1.3, pace: 0.69, color: '#836b45' },
  mud: { name: 'Deep mud', grip: 2, drag: 2.1, pace: 0.48, color: '#2d2219' },
  water: { name: 'Shallow water', grip: 1.5, drag: 3, pace: 0.4, color: '#b9e0d4' },
};
const zoneSurfaces = ['mud', 'forest', 'rock', 'sand', 'water', 'trail'];
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
const trail = [];
for (const [, zx, zy] of zones) {
  for (let i = 0; i <= 50; i++) {
    const u = i / 50;
    trail.push([1800 + (zx - 1800) * (2 * u - u * u), 1800 + (zy - 1800) * u * u]);
  }
}
function zoneRadius(zone, angle) {
  return zone[3] * (1 + 0.06 * Math.sin(3 * angle) + 0.045 * Math.cos(5 * angle));
}
function groundAt(px, py) {
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i], dx = px - zone[1], dy = py - zone[2];
    if (Math.hypot(dx, dy) < zoneRadius(zone, Math.atan2(dy, dx))) return zoneSurfaces[i];
  }
  if (Math.hypot(px - 1800, py - 1800) < 85 ||
      trail.some(([tx, ty]) => (px - tx) ** 2 + (py - ty) ** 2 < 35 ** 2)) return 'trail';
  return 'grass';
}

let vx = 0, vy = 0, steering = 0, vertical = 0, lift = 0, trackDistance = 0;
let surfaceName = 'trail', approach = null, lastRamp = null, actionTime = 0;
const particles = [];

function resetDrive() {
  vx = vy = steering = vertical = lift = trackDistance = actionTime = 0;
  surfaceName = 'trail';
  approach = lastRamp = null;
  particles.length = 0;
}

function tell(message) {
  $('tip').textContent = message;
  actionTime = 3;
}

function drive(dt) {
  const car = cars[selected];
  surfaceName = groundAt(x, y);
  const surface = surfaces[surfaceName];
  const soft = ['mud', 'water', 'sand', 'rock'].includes(surfaceName);
  const capability = soft ? car[3] : 1;
  const airborne = lift > 0 || vertical > 0;
  const boost = keys.boost && !keys.reverse && energy > 1;
  const control = Number(!!(keys.gas || boost)) - Number(!!keys.reverse);
  const wheel = Number(!!keys.right) - Number(!!keys.left);
  const fx = Math.cos(a), fy = Math.sin(a);
  const forward = vx * fx + vy * fy;
  const sideways = vy * fx - vx * fy;
  const speed = Math.hypot(vx, vy);
  const top = car[2] * 60 * surface.pace * capability * (boost ? 1.32 : 1);
  energy = clamp(energy + (boost ? -29 : 12) * dt, 0, 100);
  steering += (wheel - steering) * (1 - Math.exp(-9 * dt));

  if (!airborne) {
    const braking = control * forward < -12;
    const pull = clamp(1 - Math.abs(forward) / (top * (control < 0 ? 0.42 : 1)), 0, 1);
    const acceleration = braking ? 820 : 480 * capability * pull * (boost ? 1.48 : 1);
    const drag = surface.drag + (control ? 0 : 0.85);
    const longitudinal = (forward + control * acceleration * dt) * Math.exp(-drag * dt);
    const lateral = sideways * Math.exp(-surface.grip * capability * dt);
    vx = longitudinal * fx - lateral * fy;
    vy = longitudinal * fy + lateral * fx;
    const steerSpeed = clamp(forward / 95, -0.7, 1) / (1 + speed / 390);
    a += steering * car[4] * 60 * steerSpeed * dt;
  } else {
    a += steering * 0.65 * dt;
    vertical -= 360 * dt;
    lift += vertical * dt;
    if (lift <= 0) {
      lift = vertical = 0;
      vx *= 0.86;
      vy *= 0.86;
      score += 5;
      tell('Clean landing · +5 points');
    }
  }

  const oldX = x, oldY = y;
  x = clamp(x + vx * dt, 24, S - 24);
  y = clamp(y + vy * dt, 24, S - 24);
  if (x === 24 || x === S - 24) vx = 0;
  if (y === 24 || y === S - 24) vy = 0;

  if (lift < 12) {
    for (const obstacles of [trees, rocks]) {
      for (const [ox, oy, radius] of obstacles) {
        const clearance = car[6] * 0.48 + radius * (obstacles === trees ? 0.55 : 0.8);
        const dx = x - ox, dy = y - oy;
        const distance = Math.hypot(dx, dy);
        if (distance >= clearance) continue;
        const nx = distance ? dx / distance : -fx;
        const ny = distance ? dy / distance : -fy;
        x = clamp(ox + nx * clearance, 24, S - 24);
        y = clamp(oy + ny * clearance, 24, S - 24);
        const impact = vx * nx + vy * ny;
        if (impact < 0) {
          vx = (vx - 1.15 * impact * nx) * 0.6;
          vy = (vy - 1.15 * impact * ny) * 0.6;
        }
      }
    }
  }

  const nearRamp = ramps.find(([rx, ry]) => Math.hypot(x - rx, y - ry) < 65);
  const onRamp = nearRamp && Math.hypot(x - nearRamp[0], y - nearRamp[1]) < 22;
  if (onRamp && !airborne && nearRamp !== lastRamp && forward > (keys.jump ? 65 : 105)) {
    vertical = clamp(forward * 0.7, 100, 160) + (keys.jump ? 20 : 0);
    lastRamp = nearRamp;
  }
  if (lastRamp && lastRamp !== nearRamp) lastRamp = null;
  approach = nearRamp;

  trackDistance += Math.hypot(x - oldX, y - oldY);
  if (!airborne && speed > 20 && trackDistance >= 8) {
    trackDistance = 0;
    for (const side of [-1, 1]) {
      const tx = x - fx * car[5] * 0.28 - fy * side * car[6] * 0.48;
      const ty = y - fy * car[5] * 0.28 + fx * side * car[6] * 0.48;
      tracks.push([tx, ty, a, surfaceName]);
      if (soft || Math.abs(sideways) > 30) {
        particles.push({
          x: tx, y: ty, dx: -vx * 0.35 - fy * side * 32,
          dy: -vy * 0.35 + fx * side * 32, life: 0.32, color: surface.color,
        });
      }
    }
    if (tracks.length > 700) tracks.splice(0, tracks.length - 700);
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.dx * dt;
    p.y += p.dy * dt;
    if (p.life <= 0) particles.splice(i, 1);
  }

  const cell = Math.floor(x / 150) + ',' + Math.floor(y / 150);
  if (!visited.has(cell)) {
    visited.add(cell);
    score += 2;
  }
  gold.forEach(([gx, gy], i) => {
    if (!taken.has(i) && Math.hypot(x - gx, y - gy) < 30 && lift < 18) {
      taken.add(i);
      score += 25;
      tell('Hidden gold · +25 points');
    }
  });
  for (const zone of zones) {
    const dx = x - zone[1], dy = y - zone[2];
    if (!found.has(zone[0]) && Math.hypot(dx, dy) < zoneRadius(zone, Math.atan2(dy, dx))) {
      found.add(zone[0]);
      score += 150;
      tell(found.size === zones.length ? 'All six landmarks found · +150 points' : zone[0] + ' discovered · +150 points');
    }
  }
}

let accumulator = 0;
function loop(time) {
  const elapsed = last ? clamp((time - last) / 1000, 0, 0.1) : 0;
  last = time;
  if (active && !paused) {
    accumulator += elapsed;
    while (accumulator >= 1 / 120) {
      drive(1 / 120);
      accumulator -= 1 / 120;
    }
    actionTime -= elapsed;
    if (actionTime <= 0) {
      $('tip').textContent = approach ? 'Ramp ahead. Hold Jump as you drive onto it for more airtime.' :
        surfaceName === 'mud' ? 'Deep mud. Keep rolling and make wide turns.' :
        'Find six landmarks and look for hidden gold along the way.';
    }
  } else {
    accumulator = 0;
  }
  $('hud').textContent = Math.round(Math.hypot(vx, vy) * 0.19) + ' km/h · ' +
    surfaces[surfaceName].name + ' · ' + score + ' pts · ' + found.size + '/6 found · ' +
    Math.floor(energy) + '% turbo';
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
