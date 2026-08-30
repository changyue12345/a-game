// Simple survival prototype with keyboard/mouse + touch (joystick + fire) support
// Added: level-up upgrade modal with 3 choices and in-game visual effects for chosen upgrades.
(function() {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });

  // HUD elements
  const elLevel = document.getElementById('level');
  const elXP = document.getElementById('xp');
  const elXPNext = document.getElementById('xpNext');
  const elWeapon = document.getElementById('weapon');
  const elUpgrades = document.getElementById('upgradesList');
  const upgradeBtn = document.getElementById('upgradeBtn');

  // Touch UI elements
  const joystickEl = document.getElementById('joystick');
  const thumb = joystickEl ? joystickEl.querySelector('.thumb') : null;
  const fireBtn = document.getElementById('fire');
  const switchBtn = document.getElementById('switch');

  // DPR-aware sizing
  let dpr = Math.max(1, window.devicePixelRatio || 1);
  function resize() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // Game state
  const state = {
    width: () => canvas.clientWidth,
    height: () => canvas.clientHeight,
    running: true,
    lastTime: performance.now(),
    keys: {},
    pointers: {}, // pointerId -> pointer data
    shooting: false,
    spawnTimer: 0,
    enemies: [],
    bullets: [],
    particles: [],
    score: 0,
    xp: 0,
    level: 1,
    xpNext: 10,
    upgradePoints: 0,
    unlockedWeapons: ['Pistol'],
    currentWeaponIndex: 0,
    // added
    showUpgrade: false,
    pendingOptions: [],
    turrets: [],
    drones: []
  };

  // Weapons definitions
  const weapons = [
    { name: 'Pistol', fireRate: 300, bulletSpeed: 420, damage: 10, burst: 1 },
    { name: 'Shotgun', fireRate: 800, bulletSpeed: 360, damage: 8, burst: 5, spread: 0.6 },
    { name: 'Rifle', fireRate: 90, bulletSpeed: 620, damage: 6, burst: 1 }
  ];

  // Player
  const player = {
    x: state.width() / 2,
    y: state.height() / 2,
    r: 14,
    speed: 200,
    vx: 0, vy: 0,
    aimAngle: 0,
    hp: 100,
    maxHp: 100,
    lastShot: 0
  };

  // Helpers
  function rand(min, max) { return Math.random() * (max - min) + min; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // Input: keyboard
  window.addEventListener('keydown', e => { state.keys[e.key.toLowerCase()] = true; if (e.key === 'r' || e.key === 'R') restart(); if ((e.key === 'u' || e.key === 'U') && state.upgradePoints > 0 && !state.showUpgrade) showUpgradeChoices(); });
  window.addEventListener('keyup', e => { state.keys[e.key.toLowerCase()] = false; });

  // Mouse aim & shoot
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    player.aimAngle = Math.atan2(e.clientY - rect.top - player.y, e.clientX - rect.left - player.x);
  });
  canvas.addEventListener('mousedown', e => { state.shooting = true; });
  canvas.addEventListener('mouseup', e => { state.shooting = false; });

  // Touch & Pointer handling (multitouch)
  function applyJoystickMovement(px, py, centerX, centerY, maxRadius=48) {
    const dx = px - centerX;
    const dy = py - centerY;
    const dist = Math.hypot(dx, dy);
    const r = Math.min(dist, maxRadius);
    const nx = dist === 0 ? 0 : dx / dist;
    const ny = dist === 0 ? 0 : dy / dist;
    return { nx, ny, radius: r, x: nx * (r / maxRadius), y: ny * (r / maxRadius) };
  }

  // Pointer events
  function onPointerDown(e) {
    if (state.showUpgrade) return; // block input while choosing upgrade
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX, y = e.clientY;
    // If touching controls, store role
    if (e.target === fireBtn) { state.pointers[e.pointerId] = { role: 'fire', startX: x, startY: y }; return; }
    if (e.target === switchBtn) { state.pointers[e.pointerId] = { role: 'switch' }; return; }
    if (e.target === upgradeBtn) { // open upgrade UI if available
      if (state.upgradePoints > 0 && !state.showUpgrade) showUpgradeChoices();
      return;
    }
    // left half -> joystick, right half -> aim/shoot
    const role = (x < rect.left + rect.width * 0.5) ? 'joystick' : 'aim';
    state.pointers[e.pointerId] = { role, startX: x, startY: y, x, y };
    if (role === 'aim') state.shooting = true;
    e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onPointerMove(e) {
    const p = state.pointers[e.pointerId]; if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (p.role === 'joystick') {
      const jb = joystickEl.getBoundingClientRect();
      const centerX = jb.left + jb.width / 2;
      const centerY = jb.top + jb.height / 2;
      const j = applyJoystickMovement(p.x, p.y, centerX, centerY, Math.min(jb.width, jb.height) / 2 - 8);
      player.vx = j.nx * player.speed;
      player.vy = j.ny * player.speed;
      if (thumb) { thumb.style.transition = '0.06s'; thumb.style.left = (centerX - jb.left + j.nx * j.radius) + 'px'; thumb.style.top = (centerY - jb.top + j.ny * j.radius) + 'px'; }
    } else if (p.role === 'aim') {
      const rect = canvas.getBoundingClientRect();
      player.aimAngle = Math.atan2(p.y - rect.top - player.y, p.x - rect.left - player.x);
    }
    e.preventDefault();
  }
  function onPointerUp(e) {
    const p = state.pointers[e.pointerId]; if (!p) return;
    if (p.role === 'joystick') { player.vx = 0; player.vy = 0; if (thumb) { thumb.style.transition = '0.12s'; thumb.style.left = ''; thumb.style.top = ''; } }
    else if (p.role === 'aim') state.shooting = false;
    else if (p.role === 'fire') state.shooting = false;
    delete state.pointers[e.pointerId];
    e.target.releasePointerCapture && e.target.releasePointerCapture(e.pointerId);
    e.preventDefault();
  }

  ['pointerdown','pointermove','pointerup','pointercancel'].forEach(name => {
    document.addEventListener(name, function(e) {
      if (name === 'pointerdown') return onPointerDown(e);
      if (name === 'pointermove') return onPointerMove(e);
      if (name === 'pointerup' || name === 'pointercancel') return onPointerUp(e);
    }, { passive:false });
  });

  // Touch fallback (for older browsers without pointer events)
  function setupTouchFallback() {
    if (window.PointerEvent) return;
    let ongoing = {};
    canvas.addEventListener('touchstart', function(e) {
      for (const t of e.changedTouches) {
        onPointerDown({ pointerId: t.identifier, clientX: t.clientX, clientY: t.clientY, target: t.target, targetTouches: e.targetTouches, setPointerCapture: ()=>{} });
        ongoing[t.identifier] = true;
      }
      e.preventDefault();
    }, { passive:false });
    canvas.addEventListener('touchmove', function(e) {
      for (const t of e.changedTouches) {
        onPointerMove({ pointerId: t.identifier, clientX: t.clientX, clientY: t.clientY });
      }
      e.preventDefault();
    }, { passive:false });
    canvas.addEventListener('touchend', function(e) {
      for (const t of e.changedTouches) {
        onPointerUp({ pointerId: t.identifier, target: t.target, releasePointerCapture: ()=>{} });
        delete ongoing[t.identifier];
      }
      e.preventDefault();
    }, { passive:false });
  }
  setupTouchFallback();

  // Fire button
  if (fireBtn) {
    fireBtn.addEventListener('pointerdown', e => { if (!state.showUpgrade) state.shooting = true; e.preventDefault(); }, { passive:false });
    fireBtn.addEventListener('pointerup', e => { state.shooting = false; e.preventDefault(); }, { passive:false });
  }
  if (switchBtn) {
    switchBtn.addEventListener('click', e => { cycleWeapon(); e.preventDefault(); }, { passive:false });
  }

  // Prevent double-tap zoom on iOS
  let lastTap = 0;
  document.addEventListener('touchend', function(e) {
    const now = Date.now();
    if (now - lastTap < 300) e.preventDefault();
    lastTap = now;
  }, { passive:false });

  // Game functions
  function spawnEnemy() {
    const side = Math.floor(rand(0,4));
    const w = state.width(), h = state.height();
    let x,y;
    if (side === 0) { x = -20; y = rand(0,h); }
    else if (side === 1) { x = w + 20; y = rand(0,h); }
    else if (side === 2) { x = rand(0,w); y = -20; }
    else { x = rand(0,w); y = h + 20; }
    const speed = rand(40 + state.level * 6, 80 + state.level * 8);
    const hp = 10 + Math.floor(state.level * 3) + Math.floor(rand(0,8));
    state.enemies.push({ x, y, vx: 0, vy:0, speed, hp, r: 12, color:'#e66' });
  }

  function spawnBullet(x, y, angle, speed, damage) {
    state.bullets.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: 4, damage, life: 2 });
  }

  // Upgrades system
  const upgradePool = [
    { id: 'health', name: 'Health Boost', desc: 'Increase max HP by 25 and heal to full', apply(state) {
      player.maxHp += 25; player.hp = player.maxHp;
      // visual particle burst
      for (let i=0;i<10;i++) state.particles.push({ x: player.x, y: player.y, vx: rand(-120,120), vy: rand(-120,120), life: 0.9 });
    }},
    { id: 'turret', name: 'Deploy Turret', desc: 'Spawn a friendly turret that auto-shoots nearby enemies', apply(state) {
      const t = { x: player.x + 40, y: player.y - 24, cooldown:0, fireRate: 700, damage: 8, bulletSpeed: 360, life: Infinity };
      state.turrets.push(t);
    }},
    { id: 'drone', name: 'Attack Drone', desc: 'A small drone orbits you and damages nearby enemies', apply(state) {
      const d = { angle: 0, dist: 42, speed: 3.0, damage: 12, cooldown: 0.2 };
      state.drones.push(d);
    }},
    { id: 'damage', name: 'Weapon Tune', desc: 'Increase current weapon damage by 3', apply(state) {
      const unlocked = weapons.filter(w => state.unlockedWeapons.includes(w.name));
      const weapon = unlocked[state.currentWeaponIndex] || weapons[0];
      weapon.damage += 3;
      // small particles
      for (let i=0;i<6;i++) state.particles.push({ x: player.x, y: player.y, vx: rand(-80,80), vy: rand(-80,80), life:0.6 });
    }}
  ];

  function generateUpgradeOptions() {
    const opts = [];
    const copy = upgradePool.slice();
    while (opts.length < 3 && copy.length) {
      const idx = Math.floor(rand(0, copy.length));
      opts.push(copy.splice(idx,1)[0]);
    }
    return opts;
  }

  function showUpgradeChoices() {
    state.showUpgrade = true;
    state.pendingOptions = generateUpgradeOptions();
    // build modal DOM
    const overlay = document.createElement('div'); overlay.className = 'upgrade-overlay'; overlay.id = 'upgradeOverlay';
    const panel = document.createElement('div'); panel.className = 'upgrade-panel';
    panel.innerHTML = `<div class="upgrade-title">Level Up! Choose one upgrade</div>`;
    const grid = document.createElement('div'); grid.className = 'upgrade-grid';
    state.pendingOptions.forEach(opt => {
      const card = document.createElement('div'); card.className = 'upgrade-card';
      const h = document.createElement('h3'); h.textContent = opt.name; const p = document.createElement('p'); p.textContent = opt.desc;
      const btn = document.createElement('button'); btn.className = 'upgrade-btn'; btn.textContent = 'Choose';
      btn.addEventListener('click', () => { applyUpgrade(opt); document.body.removeChild(overlay); });
      card.appendChild(h); card.appendChild(p); card.appendChild(btn); grid.appendChild(card);
    });
    panel.appendChild(grid); overlay.appendChild(panel); document.body.appendChild(overlay);
  }

  function applyUpgrade(opt) {
    opt.apply(state);
    state.showUpgrade = false;
    state.pendingOptions = [];
    state.upgradePoints = Math.max(0, state.upgradePoints - 1);
    elUpgrades.textContent = state.upgradePoints > 0 ? `${state.upgradePoints} available` : 'None';
    // show a small floating text to confirm
    const txt = { x: player.x, y: player.y - 30, life: 1.4, text: opt.name };
    state.particles.push({ x: txt.x, y: txt.y, vx: 0, vy: -20, life: 0.9 });
  }

  function giveXP(amount) {
    state.xp += amount;
    elXP.textContent = state.xp;
    if (state.xp >= state.xpNext) {
      state.xp -= state.xpNext;
      state.level += 1;
      state.upgradePoints += 1;
      state.xpNext = Math.floor(state.xpNext * 1.5) + 5;
      elLevel.textContent = state.level;
      elXPNext.textContent = state.xpNext;
      elUpgrades.textContent = state.upgradePoints > 0 ? `${state.upgradePoints} available` : 'None';
      // pause and show upgrade choices
      showUpgradeChoices();
    }
  }

  function cycleWeapon() {
    const unlocked = weapons.filter(w => state.unlockedWeapons.includes(w.name));
    state.currentWeaponIndex = (state.currentWeaponIndex + 1) % unlocked.length;
    elWeapon.textContent = unlocked[state.currentWeaponIndex].name;
  }

  // Restart
  function restart() {
    state.enemies.length = 0;
    state.bullets.length = 0;
    state.particles.length = 0;
    state.xp = 0;
    state.level = 1;
    state.xpNext = 10;
    state.upgradePoints = 0;
    state.unlockedWeapons = ['Pistol'];
    state.currentWeaponIndex = 0;
    state.turrets.length = 0; state.drones.length = 0;
    state.showUpgrade = false; state.pendingOptions = [];
    elLevel.textContent = state.level;
    elXP.textContent = state.xp;
    elXPNext.textContent = state.xpNext;
    elWeapon.textContent = weapons[state.currentWeaponIndex].name;
    player.x = state.width()/2; player.y = state.height()/2; player.hp = player.maxHp;
  }

  // Main update/draw loop
  function update(dt) {
    if (state.showUpgrade) return; // pause game updates while choosing upgrades

    // Input keyboard movement
    let mx = 0, my = 0;
    if (state.keys['w'] || state.keys['arrowup']) my -= 1;
    if (state.keys['s'] || state.keys['arrowdown']) my += 1;
    if (state.keys['a'] || state.keys['arrowleft']) mx -= 1;
    if (state.keys['d'] || state.keys['arrowright']) mx += 1;
    if (mx || my) {
      const mlen = Math.hypot(mx, my) || 1;
      player.vx = (mx / mlen) * player.speed;
      player.vy = (my / mlen) * player.speed;
    } else {
      // joystick sets velocities directly; if joystick not used, slow down
      if (!Object.values(state.pointers).some(p => p.role === 'joystick')) {
        player.vx = 0; player.vy = 0;
      }
    }

    // Move player
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    // clamp
    player.x = Math.max(0, Math.min(state.width(), player.x));
    player.y = Math.max(0, Math.min(state.height(), player.y));

    // Spawn enemies gradually
    state.spawnTimer += dt;
    if (state.spawnTimer > Math.max(0.6, 1.6 - state.level * 0.06)) {
      spawnEnemy();
      state.spawnTimer = 0;
    }

    // Update turrets: target nearest enemy and shoot
    for (const t of state.turrets) {
      t.cooldown -= dt*1000;
      // follow the player slowly
      const tx = player.x + (t.x - player.x) * 0.95;
      const ty = player.y + (t.y - player.y) * 0.95;
      t.x = tx; t.y = ty;
      if (t.cooldown <= 0) {
        // find nearest enemy in range
        let target = null; let bestD = 99999;
        for (const e of state.enemies) {
          const d = Math.hypot(e.x - t.x, e.y - t.y);
          if (d < 360 && d < bestD) { bestD = d; target = e; }
        }
        if (target) {
          const angle = Math.atan2(target.y - t.y, target.x - t.x);
          spawnBullet(t.x, t.y, angle, t.bulletSpeed, t.damage);
          t.cooldown = t.fireRate;
        }
      }
    }

    // Update drones: orbit player and damage enemies on proximity
    for (const d of state.drones) {
      d.angle += dt * d.speed;
      const dx = player.x + Math.cos(d.angle) * d.dist;
      const dy = player.y + Math.sin(d.angle) * d.dist;
      d.x = dx; d.y = dy;
      d.cooldown -= dt;
      if (d.cooldown <= 0) {
        // deal damage to enemies within radius
        for (let i = state.enemies.length - 1; i >= 0; i--) {
          const e = state.enemies[i];
          if (Math.hypot(e.x - d.x, e.y - d.y) < 24) {
            e.hp -= d.damage;
            d.cooldown = 0.2;
            if (e.hp <= 0) { giveXP(3); state.enemies.splice(i,1); }
            break;
          }
        }
      }
    }

    // Update enemies
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      const angle = Math.atan2(player.y - e.y, player.x - e.x);
      e.vx = Math.cos(angle) * e.speed;
      e.vy = Math.sin(angle) * e.speed;
      e.x += e.vx * dt;
      e.y += e.vy * dt;

      // collision with player
      const dx = e.x - player.x, dy = e.y - player.y;
      const d = Math.hypot(dx, dy);
      if (d < e.r + player.r) {
        // damage and knockback
        player.hp -= 8;
        const nx = dx / d || 0, ny = dy / d || 0;
        e.x += nx * 20;
        e.y += ny * 20;
        if (player.hp <= 0) {
          restart();
          return;
        }
      }
    }

    // Update bullets
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -50 || b.y < -50 || b.x > state.width() + 50 || b.y > state.height() + 50) {
        state.bullets.splice(i,1);
        continue;
      }
      // bullet-enemy collision
      for (let j = state.enemies.length - 1; j >= 0; j--) {
        const e = state.enemies[j];
        if (Math.hypot(b.x - e.x, b.y - e.y) < (b.r + e.r)) {
          e.hp -= b.damage;
          state.bullets.splice(i,1);
          if (e.hp <= 0) {
            // enemy dies
            giveXP(3 + Math.floor(Math.random()*3) + Math.floor(state.level*0.5));
            // small particles
            for (let p=0;p<6;p++) state.particles.push({ x:e.x, y:e.y, vx: rand(-80,80), vy: rand(-80,80), life:0.6 });
            state.enemies.splice(j,1);
          }
          break;
        }
      }
    }

    // Update particles
    for (let i = state.particles.length -1; i >=0; i--) {
      const p = state.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) state.particles.splice(i,1);
    }

    // Auto-shoot if shooting and weapon cooldown passed
    if (state.shooting) {
      const unlocked = weapons.filter(w => state.unlockedWeapons.includes(w.name));
      const weapon = unlocked[state.currentWeaponIndex] || weapons[0];
      const now = performance.now();
      if (now - player.lastShot > weapon.fireRate) {
        player.lastShot = now;
        // burst/spread support
        if (weapon.burst > 1) {
          const baseAngle = player.aimAngle;
          for (let i=0;i<weapon.burst;i++) {
            const spread = (weapon.spread || 0) * (i - (weapon.burst-1)/2);
            spawnBullet(player.x + Math.cos(baseAngle)*player.r, player.y + Math.sin(baseAngle)*player.r, baseAngle + spread, weapon.bulletSpeed, weapon.damage);
          }
        } else {
          spawnBullet(player.x + Math.cos(player.aimAngle)*player.r, player.y + Math.sin(player.aimAngle)*player.r, player.aimAngle, weapon.bulletSpeed, weapon.damage);
        }
      }
    }

    // update HUD
    elXP.textContent = state.xp;
    elLevel.textContent = state.level;
    elXPNext.textContent = state.xpNext;
    elWeapon.textContent = (weapons.find(w => w.name === (weapons[state.currentWeaponIndex] && weapons[state.currentWeaponIndex].name)) || weapons[state.currentWeaponIndex] || weapons[0]).name;

    // show/hide upgrade button
    if (upgradeBtn) upgradeBtn.style.display = (state.upgradePoints > 0 && !state.showUpgrade) ? 'inline-block' : 'none';
  }

  function draw() {
    const w = state.width(), h = state.height();
    ctx.clearRect(0,0,w,h);

    // background grid
    ctx.fillStyle = '#111';
    ctx.fillRect(0,0,w,h);

    // draw player
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.aimAngle);
    // body
    ctx.fillStyle = '#4fb';
    ctx.beginPath(); ctx.arc(0,0, player.r, 0, Math.PI*2); ctx.fill();
    // gun
    ctx.fillStyle = '#2aa';
    ctx.fillRect(8, -5, 16, 10);
    ctx.restore();

    // draw turrets
    for (const t of state.turrets) {
      ctx.fillStyle = '#7af'; ctx.beginPath(); ctx.arc(t.x, t.y, 10, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#3cf'; ctx.fillRect(t.x-6, t.y-20, 12, 8);
    }

    // draw drones
    for (const d of state.drones) {
      ctx.fillStyle = '#ffb86b'; ctx.beginPath(); ctx.arc(d.x, d.y, 8, 0, Math.PI*2); ctx.fill();
    }

    // draw enemies
    for (const e of state.enemies) {
      ctx.fillStyle = e.color || '#e66';
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI*2); ctx.fill();
    }

    // bullets
    ctx.fillStyle = '#ffd';
    for (const b of state.bullets) {
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.fill();
    }

    // particles
    for (const p of state.particles) {
      ctx.fillStyle = `rgba(255,200,90,${Math.max(0, p.life/0.6)})`;
      ctx.fillRect(p.x, p.y, 2, 2);
    }

    // HUD overlay on canvas (optional)
    // health bar
    ctx.fillStyle = '#444';
    ctx.fillRect(12, state.height()-28, 200, 12);
    ctx.fillStyle = '#e44';
    const hpW = Math.max(0, (player.hp / player.maxHp) * 200);
    ctx.fillRect(12, state.height()-28, hpW, 12);
    ctx.strokeStyle = '#222'; ctx.strokeRect(12, state.height()-28, 200, 12);
  }

  // Main loop
  function loop(now) {
    const dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // init HUD
  elLevel.textContent = state.level;
  elXP.textContent = state.xp;
  elXPNext.textContent = state.xpNext;
  elWeapon.textContent = weapons[0].name;

  // attach upgrade button listener
  if (upgradeBtn) upgradeBtn.addEventListener('click', () => { if (!state.showUpgrade && state.upgradePoints > 0) showUpgradeChoices(); });

  // Small util: enter fullscreen
  window.gameHelpers = {
    enterFullscreen: function() {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
  };

  // Debug: hide touch UI on desktop
  function detectTouchDevice(){
    return ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
  }
  if (!detectTouchDevice()) {
    joystickEl.style.display = 'none';
    fireBtn.style.display = 'none';
    switchBtn.style.display = 'none';
  }

  // Ensure canvas resizes immediately when loaded
  setTimeout(resize, 50);
})();
