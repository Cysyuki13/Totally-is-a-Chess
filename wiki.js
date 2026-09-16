// ============================================================
//  wiki.js — 技能圖鑑 (Skill Encyclopedia)
//  Depends on globals from main.js: PIECE_PARAMS, createPieceModel,
//  ABILITIES, SKILL_COOLDOWNS
// ============================================================

let wikiActive = false;
let wikiCurrent = null;

let wikiModelRenderer = null, wikiModelScene = null,
    wikiModelCamera = null, wikiModelGroup = null;
let wikiModelRAF = null;

let wikiEffectRenderer = null, wikiEffectScene = null,
    wikiEffectCamera = null, wikiEffectRoot = null;
let wikiEffectRAF = null;
let wikiEffectTimers = [];

const DECAY_PER_SEC = 0.965;    // smaller = stops sooner  (0.9 = fast stop, 0.99 = forever)
const VEL_CAP = 14;             // max angular speed (rad/s) after a very fast flick
const MIN_ANG_SPEED = 0.35;     // baseline spin magnitude — never fully stops
const DRAG_SENSITIVITY = 0.010; // radians per pixel dragged
const VEL_SMOOTH = 0.5;         // 0..1, higher = flick velocity is more responsive

// Initial "inertia" direction — the classic 3D diagonal tumble axis.
// Kept as a unit vector so we can smoothly blend drag velocity into it.
const TUMBLE_AXIS = new THREE.Vector3(0.35, 0.9, 0.28).normalize();

const wikiModelDrag = {
    dragging: false,
    lastX: 0, lastY: 0,
    lastMoveTime: 0,
    // Orientation lives in a quaternion (no gimbal lock, true 3D tumble)
    quat: new THREE.Quaternion(),
    // Angular velocity: DIRECTION = spin axis, LENGTH = rad/s.
    // A diagonal axis → the model tumbles diagonally like a free-falling body.
    angVel: new THREE.Vector3(0.35, 0.9, 0.28).normalize().multiplyScalar(1.1),
};

// ============================================================
//  PIECE DATA
// ============================================================
const WIKI_PIECES = {
    pawn: {
        name: '兵 (Pawn)', glyph: '♟',
        skillName: '冲锋爆炸 (Charge Explosion)',
        description: '兵向前衝刺，在落點引爆十字爆炸。對落點上下左右四格的敵人各造成 25 點傷害，但自身也會受到 50 點反噬傷害。',
        damage: 25, selfDamage: 50, cooldown: 1,
        board: () => ({
            caster: { r: 5, c: 4, type: 'pawn', color: 'white', icon: '♟' },
            damage: [{ r: 1, c: 4 }, { r: 3, c: 4 }, { r: 2, c: 3 }, { r: 2, c: 5 }],
            landing: { r: 2, c: 4 },
            path: [{ r: 4, c: 4 }, { r: 3, c: 4 }],
        }),
    },
    rook: {
        name: '城堡 (Rook)', glyph: '♜',
        skillName: '加農炮 (Cannon)',
        description: '城堡發射加農炮，可自由瞄準 4 格範圍內的任意位置。命中範圍內所有敵方棋子（含友方）各受到 35 點傷害。冷卻 1 回合。',
        damage: 35, selfDamage: 0, cooldown: 1,
        board: () => {
            const caster = { r: 4, c: 4 };
            const damage = [], path = [];
            for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
                const d = Math.hypot(r - caster.r, c - caster.c);
                if (d === 0) continue;
                if (d <= 4) damage.push({ r, c });
            }
            return { caster: { ...caster, type: 'rook', color: 'white', icon: '♜' }, damage, landing: { r: 2, c: 6 } };
        },
    },
    knight: {
        name: '騎士 (Knight)', glyph: '♞',
        skillName: '擊退 (Knockback)',
        description: '騎士躍向 3×3 內有敵人的落點，並將該區一名敵人往反方向擊退兩格。若目標被其他棋子阻擋，目標會彈回原位，而障礙方受到 25 點傷害。冷卻 2 回合。',
        damage: 0, selfDamage: 0, cooldown: 2,
        board: () => ({
            caster: { r: 5, c: 4, type: 'knight', color: 'white', icon: '♞' },
            landing: { r: 3, c: 5 },
            damage: [{ r: 2, c: 4 }, { r: 3, c: 4 }, { r: 4, c: 4 }, { r: 2, c: 5 }, { r: 4, c: 5 }, { r: 2, c: 6 }, { r: 3, c: 6 }, { r: 4, c: 6 }],
        }),
    },
    bishop: {
        name: '主教 (Bishop)', glyph: '♝',
        skillName: '炮躍 (Cannon Leap)',
        description: '主教沿對角線跳過至少一枚棋子，落在其後方的空格。路徑上所有棋子（不分敵我）各受到 50 點傷害。冷卻 2 回合。',
        damage: 50, selfDamage: 0, cooldown: 2,
        board: () => ({
            caster: { r: 5, c: 4, type: 'bishop', color: 'white', icon: '♝' },
            landing: { r: 2, c: 7 },
            path: [{ r: 4, c: 5 }, { r: 3, c: 6 }],
            damage: [{ r: 3, c: 6 }],
        }),
    },
    queen: {
        name: '皇后 (Queen)', glyph: '♛',
        skillName: '尚未實裝',
        description: '皇后在目前版本中尚未擁有特殊技能。',
        damage: 0, selfDamage: 0, cooldown: 1,
        board: () => ({
            caster: { r: 4, c: 4, type: 'queen', color: 'white', icon: '♛' },
        }),
    },
    king: {
        name: '國王 (King)', glyph: '♚',
        skillName: '尚未實裝',
        description: '國王在目前版本中尚未擁有特殊技能。',
        damage: 0, selfDamage: 0, cooldown: 1,
        board: () => ({
            caster: { r: 4, c: 4, type: 'king', color: 'white', icon: '♚' },
        }),
    },
};

// ============================================================
//  ENTRY POINTS
// ============================================================
function openWiki() {
    const overlay = document.getElementById('wikiOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    document.getElementById('mainMenu').classList.add('hidden');
    wikiActive = true;

    document.querySelectorAll('.wiki-tab').forEach(tab => {
        tab.onclick = () => selectWikiPiece(tab.dataset.piece);
    });

    setTimeout(() => {
        initWikiModelViewer();
        initWikiEffectViewer();
        selectWikiPiece('pawn');
    }, 40);
}

function closeWiki() {
    wikiActive = false;
    document.getElementById('wikiOverlay').classList.add('hidden');
    document.getElementById('mainMenu').classList.remove('hidden');
    cleanupWikiViewers();
}

function selectWikiPiece(type) {
    const data = WIKI_PIECES[type];
    if (!data) return;
    wikiCurrent = type;

    document.querySelectorAll('.wiki-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.piece === type));

    document.getElementById('wikiPieceName').textContent = data.name;
    document.getElementById('wikiSkillName').textContent = data.skillName;
    document.getElementById('wikiDescription').textContent = data.description;
    document.getElementById('wikiDamage').textContent = data.damage > 0 ? `${data.damage}` : '—';
    document.getElementById('wikiCooldown').textContent = data.cooldown;

    const selfBadge = document.getElementById('wikiSelfDamageBadge');
    if (data.selfDamage > 0) {
        selfBadge.classList.remove('hidden');
        document.getElementById('wikiSelfDamage').textContent = `${data.selfDamage}`;
    } else selfBadge.classList.add('hidden');

    loadModel(type);
    renderWikiBoard(data.board());
    playPieceEffect(type);
}

// ============================================================
//  3D MODEL VIEWER
// ============================================================
function initWikiModelViewer() {
    const container = document.getElementById('wikiModel3D');
    if (!container) return;
    const w = container.clientWidth || 320;
    const h = container.clientHeight || 320;

    wikiModelRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    wikiModelRenderer.setSize(w, h);
    wikiModelRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    wikiModelRenderer.setClearColor(0x000000, 0);
    container.appendChild(wikiModelRenderer.domElement);

    wikiModelScene = new THREE.Scene();
    wikiModelCamera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    wikiModelCamera.position.set(0, 1.6, 3.2);
    wikiModelCamera.lookAt(0, 0.5, 0);

    const hemi = new THREE.HemisphereLight(0xffeedd, 0x443322, 1.6);
    hemi.userData.keep = true; wikiModelScene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 2.4);
    dir.position.set(3, 6, 4); dir.userData.keep = true;
    wikiModelScene.add(dir);
    const rim = new THREE.DirectionalLight(0x8899cc, 0.9);
    rim.position.set(-3, 2, -4); rim.userData.keep = true;
    wikiModelScene.add(rim);

    // ── Static pedestal (NOT part of the spinning group) ──
    const pedGeo = new THREE.CylinderGeometry(0.75, 0.85, 0.08, 40);
    const pedMat = new THREE.MeshStandardMaterial({ color: 0x16213e, roughness: 0.4, metalness: 0.5 });
    const pedestal = new THREE.Mesh(pedGeo, pedMat);
    pedestal.position.y = -0.05;
    wikiModelScene.add(pedestal);

    // ── Zero-gravity, 3D free-fall tumble state ──
    wikiModelDrag.dragging = false;
    wikiModelDrag.lastX = 0;
    wikiModelDrag.lastY = 0;
    wikiModelDrag.lastMoveTime = 0;
    wikiModelDrag.quat.identity();
    wikiModelDrag.angVel.copy(TUMBLE_AXIS).multiplyScalar(1.1);

    container.addEventListener('pointerdown', (e) => {
        wikiModelDrag.dragging = true;
        wikiModelDrag.lastX = e.clientX;
        wikiModelDrag.lastY = e.clientY;
        wikiModelDrag.lastMoveTime = performance.now();
        try { container.setPointerCapture(e.pointerId); } catch (_) { }
        container.style.cursor = 'grabbing';
    });

    container.addEventListener('pointermove', (e) => {
        if (!wikiModelDrag.dragging) return;
        const dx = e.clientX - wikiModelDrag.lastX;
        const dy = e.clientY - wikiModelDrag.lastY;
        wikiModelDrag.lastX = e.clientX;
        wikiModelDrag.lastY = e.clientY;

        // ── Apply the drag as WORLD-space rotation on top of the current orientation ──
        //    Horizontal drag → world-Y rotation;  Vertical drag → world-X rotation.
        const rotY = dx * DRAG_SENSITIVITY;
        const rotX = dy * DRAG_SENSITIVITY;

        const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
        const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotX);
        wikiModelDrag.quat.premultiply(qY).premultiply(qX);

        // ── Blend released-motion velocity (angular) ──
        const now = performance.now();
        const dtMove = (now - wikiModelDrag.lastMoveTime) / 1000;
        wikiModelDrag.lastMoveTime = now;
        if (dtMove > 0.001 && dtMove < 0.15) {
            const instVelY = rotY / dtMove;
            const instVelX = rotX / dtMove;
            // Blend into X / Y components — the Z component (the diagonal
            // "free-fall" character of the tumble) is left alone so it stays alive.
            wikiModelDrag.angVel.x = wikiModelDrag.angVel.x * (1 - VEL_SMOOTH) + instVelX * VEL_SMOOTH;
            wikiModelDrag.angVel.y = wikiModelDrag.angVel.y * (1 - VEL_SMOOTH) + instVelY * VEL_SMOOTH;
        }
    });

    const endDrag = () => {
        if (!wikiModelDrag.dragging) return;
        wikiModelDrag.dragging = false;
        container.style.cursor = 'grab';
    };
    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', endDrag);
    container.addEventListener('lostpointercapture', endDrag);

    const _qDelta = new THREE.Quaternion();
    const _axis = new THREE.Vector3();

    let lastT = performance.now();
    const loop = () => {
        wikiModelRAF = requestAnimationFrame(loop);
        const now = performance.now();
        const dt = Math.min((now - lastT) / 1000, 0.05);
        lastT = now;

        if (!wikiModelDrag.dragging) {
            // ── Integrate angular velocity into orientation ──
            const speed = wikiModelDrag.angVel.length();
            if (speed > 1e-5) {
                _axis.copy(wikiModelDrag.angVel).divideScalar(speed);
                _qDelta.setFromAxisAngle(_axis, speed * dt);
                wikiModelDrag.quat.premultiply(_qDelta);   // world-space rotation
                wikiModelDrag.quat.normalize();
            }

            // ── Zero-g decay (very gentle) ──
            const decay = Math.pow(DECAY_PER_SEC, dt);
            wikiModelDrag.angVel.multiplyScalar(decay);

            // ── Keep a small spin floor so it never looks frozen ──
            const sp = wikiModelDrag.angVel.length();
            if (sp < MIN_ANG_SPEED) {
                if (sp < 1e-4) {
                    // Fully stopped → re-seed with the diagonal tumble axis
                    wikiModelDrag.angVel.copy(TUMBLE_AXIS).multiplyScalar(MIN_ANG_SPEED);
                } else {
                    wikiModelDrag.angVel.multiplyScalar(MIN_ANG_SPEED / sp);
                }
            }
        }

        // ── Clamp overall angular speed ──
        const cap = wikiModelDrag.angVel.length();
        if (cap > VEL_CAP) wikiModelDrag.angVel.multiplyScalar(VEL_CAP / cap);

        if (wikiModelGroup) {
            wikiModelGroup.quaternion.copy(wikiModelDrag.quat);
        }
        wikiModelRenderer.render(wikiModelScene, wikiModelCamera);
    };
    loop();
}

function loadModel(type) {
    if (!wikiModelScene) return;
    if (wikiModelGroup) { wikiModelScene.remove(wikiModelGroup); wikiModelGroup = null; }

    const model = createPieceModel(type, 'white', 100, 100, PIECE_PARAMS[type] || {});
    model.position.set(0, 0, 0);

    // ── Pivot at the model's true geometric centre (spin around its middle) ──
    const bbox = new THREE.Box3().setFromObject(model);
    const centre = bbox.getCenter(new THREE.Vector3());

    const pivot = new THREE.Group();
    pivot.position.copy(centre);
    model.position.sub(centre);
    pivot.add(model);

    wikiModelScene.add(pivot);
    wikiModelGroup = pivot;

    // ── Fresh piece → fresh diagonal free-fall tumble ──
    wikiModelDrag.quat.identity();
    wikiModelDrag.angVel.copy(TUMBLE_AXIS).multiplyScalar(1.1);
    wikiModelDrag.dragging = false;
    wikiModelDrag.lastX = 0;
    wikiModelDrag.lastY = 0;
    wikiModelDrag.lastMoveTime = 0;
}

// ============================================================
//  MINI BOARD (damage area diagram)
// ============================================================
function renderWikiBoard(display) {
    const board = document.getElementById('wikiBoard');
    if (!board) return;
    board.innerHTML = '';
    if (!display) return;

    const key = p => p ? `${p.r},${p.c}` : null;
    const castKey = key(display.caster);
    const landKey = key(display.landing);
    const damageKeys = new Set((display.damage || []).map(key));
    const pathKeys = new Set((display.path || []).map(key));

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const cell = document.createElement('div');
            cell.className = 'wiki-board-cell ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
            const k = `${r},${c}`;

            if (k === castKey) {
                cell.classList.add('caster');
                const icon = document.createElement('span');
                icon.className = `piece-icon ${display.caster.color}`;
                icon.textContent = display.caster.icon || '♟';
                cell.appendChild(icon);
            } else if (damageKeys.has(k)) {
                cell.classList.add('damage');
            } else if (pathKeys.has(k)) {
                cell.classList.add('path');
            }

            if (k === landKey) cell.classList.add('landing');
            board.appendChild(cell);
        }
    }
}

// ============================================================
//  EFFECT VIEWER (mini Three.js scene, loops the skill)
// ============================================================
function initWikiEffectViewer() {
    const container = document.getElementById('wikiEffect');
    if (!container) return;
    const w = container.clientWidth || 640;
    const h = container.clientHeight || 360;

    wikiEffectRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    wikiEffectRenderer.setSize(w, h);
    wikiEffectRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    wikiEffectRenderer.setClearColor(0x0d0d1a, 1);
    container.appendChild(wikiEffectRenderer.domElement);

    wikiEffectScene = new THREE.Scene();
    wikiEffectCamera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    wikiEffectCamera.position.set(0, 3.2, 4.8);
    wikiEffectCamera.lookAt(0, 0.3, 0);

    const hemi = new THREE.HemisphereLight(0xffeedd, 0x333355, 1.3);
    hemi.userData.keep = true; wikiEffectScene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 2.0);
    dir.position.set(4, 7, 5); dir.userData.keep = true;
    wikiEffectScene.add(dir);

    wikiEffectRoot = new THREE.Group();
    wikiEffectScene.add(wikiEffectRoot);

    const loop = () => {
        wikiEffectRAF = requestAnimationFrame(loop);
        wikiEffectRenderer.render(wikiEffectScene, wikiEffectCamera);
    };
    loop();
}

function clearEffectScene() {
    wikiEffectTimers.forEach(t => clearTimeout(t));
    wikiEffectTimers = [];
    if (!wikiEffectRoot) return;
    while (wikiEffectRoot.children.length > 0) {
        const child = wikiEffectRoot.children[0];
        wikiEffectRoot.remove(child);
        child.traverse(n => {
            if (n.geometry) n.geometry.dispose();
            if (n.material) {
                if (Array.isArray(n.material)) n.material.forEach(m => m.dispose());
                else n.material.dispose();
            }
        });
    }
}

function makeWikiGround() {
    const g = new THREE.Group();
    // Board grid
    const sq = 0.6;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
        const light = (r + c) % 2 === 0;
        const geo = new THREE.BoxGeometry(sq, 0.06, sq);
        const mat = new THREE.MeshStandardMaterial({
            color: light ? 0xd4b896 : 0x8b5e3c, roughness: 0.5
        });
        const m = new THREE.Mesh(geo, mat);
        m.position.set((c - 2.5) * sq, -0.03, (r - 2.5) * sq);
        m.receiveShadow = true;
        g.add(m);
    }
    return g;
}

// Utility: simple delayed loop
function wikiLoop(delay, fn) {
    const tick = () => {
        fn();
        wikiEffectTimers.push(setTimeout(tick, delay));
    };
    tick();
}

function playPieceEffect(type) {
    if (!wikiEffectRoot) return;
    clearEffectScene();

    wikiEffectRoot.add(makeWikiGround());

    const info = WIKI_PIECES[type];
    if (!info || type === 'queen' || type === 'king') {
        // No effect — show a hint model sitting still
        const model = createPieceModel(type, 'white', 100, 100, PIECE_PARAMS[type] || {});
        model.position.set(0, 0, 0.5);
        wikiEffectRoot.add(model);
        return;
    }

    if (type === 'pawn') setupPawnEffect();
    if (type === 'rook') setupRookEffect();
    if (type === 'knight') setupKnightEffect();
    if (type === 'bishop') setupBishopEffect();
}

// ── Individual effect players ──
function setupPawnEffect() {
    const CYCLE = 3000;
    wikiLoop(CYCLE, () => {
        clearEffectScene();
        wikiEffectRoot.add(makeWikiGround());

        const pawn = createPieceModel('pawn', 'white', 100, 100, PIECE_PARAMS.pawn);
        pawn.position.set(0, 0, 1.2);
        wikiEffectRoot.add(pawn);

        const startT = performance.now();
        const DURATION = 500;
        const step = () => {
            const t = Math.min((performance.now() - startT) / DURATION, 1);
            pawn.position.z = 1.2 * (1 - t);

            if (t >= 1) {
                // Cross explosion at pawn position
                spawnCrossBurst(pawn.position.x, pawn.position.z);
                return;
            }
            requestAnimationFrame(step);
        };
        step();
    });
}

function spawnCrossBurst(x, z) {
    const burstStart = performance.now();
    const DURATION = 700;
    const beams = [];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dr, dc] of dirs) {
        const geo = new THREE.BoxGeometry(0.06, 0.06, 0.9);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xff6622, transparent: true, opacity: 0.95,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const beam = new THREE.Mesh(geo, mat);
        beam.position.set(x + dr * 0.45, 0.15, z + dc * 0.45);
        if (dr === 0) beam.rotation.y = Math.PI / 2;
        wikiEffectRoot.add(beam);
        beams.push(beam);
    }
    // Flash
    const flashGeo = new THREE.SphereGeometry(0.35, 14, 14);
    const flashMat = new THREE.MeshBasicMaterial({
        color: 0xffffaa, transparent: true, opacity: 1,
        depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(x, 0.3, z);
    wikiEffectRoot.add(flash);

    const loop = () => {
        const t = (performance.now() - burstStart) / DURATION;
        if (t >= 1) return;
        for (const b of beams) b.material.opacity = 0.95 * (1 - t);
        flash.scale.setScalar(1 + t * 4);
        flash.material.opacity = 1 - t * 1.2;
        requestAnimationFrame(loop);
    };
    loop();
}

function setupRookEffect() {
    const CYCLE = 3000;
    wikiLoop(CYCLE, () => {
        clearEffectScene();
        wikiEffectRoot.add(makeWikiGround());

        const rook = createPieceModel('rook', 'white', 100, 100, PIECE_PARAMS.rook);
        rook.position.set(-1.4, 0, 1.4);
        wikiEffectRoot.add(rook);

        const start = new THREE.Vector3(-1.4, 0.6, 1.4);
        const end = new THREE.Vector3(1.6, 0.05, -1.6);
        const projGeo = new THREE.SphereGeometry(0.16, 14, 14);
        const projMat = new THREE.MeshStandardMaterial({
            color: 0xff5500, emissive: 0xff3300, emissiveIntensity: 0.9, roughness: 0.2,
        });
        const proj = new THREE.Mesh(projGeo, projMat);
        proj.position.copy(start);
        wikiEffectRoot.add(proj);

        const glowGeo = new THREE.SphereGeometry(0.28, 10, 10);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xff8800, transparent: true, opacity: 0.35,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.copy(start);
        wikiEffectRoot.add(glow);

        const startT = performance.now();
        const DURATION = 600;
        const fly = () => {
            const t = Math.min((performance.now() - startT) / DURATION, 1);
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            const arc = Math.sin(t * Math.PI) * 1.6;
            proj.position.lerpVectors(start, end, ease);
            proj.position.y += arc;
            glow.position.copy(proj.position);
            proj.rotation.x += 0.25;
            if (t < 1) requestAnimationFrame(fly);
            else {
                wikiEffectRoot.remove(proj); wikiEffectRoot.remove(glow);
                proj.geometry.dispose(); proj.material.dispose();
                glow.geometry.dispose(); glow.material.dispose();
                spawnExplosion(end.x, end.z);
            }
        };
        fly();
    });
}

function spawnExplosion(x, z) {
    const startT = performance.now();
    const DURATION = 700;
    const group = new THREE.Group();
    group.position.set(x, 0.3, z);
    wikiEffectRoot.add(group);

    const coreGeo = new THREE.SphereGeometry(0.7, 18, 18);
    const coreMat = new THREE.MeshBasicMaterial({
        color: 0xff5500, transparent: true, opacity: 0.9,
        depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.scale.setScalar(0.1);
    group.add(core);

    const particles = [];
    for (let i = 0; i < 40; i++) {
        const pg = new THREE.SphereGeometry(0.05, 5, 5);
        const pm = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(0.05 + Math.random() * 0.1, 1, 0.6),
            transparent: true, opacity: 1, depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const p = new THREE.Mesh(pg, pm);
        const a = Math.random() * Math.PI * 2;
        const r = 0.15;
        p.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        p.userData.vel = new THREE.Vector3(
            Math.cos(a) * (2 + Math.random() * 3), 1.5 + Math.random() * 2.5, Math.sin(a) * (2 + Math.random() * 3));
        group.add(p); particles.push(p);
    }

    const loop = () => {
        const t = (performance.now() - startT) / DURATION;
        if (t >= 1) {
            wikiEffectRoot.remove(group);
            group.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose(); });
            return;
        }
        core.scale.setScalar(0.1 + t * 6);
        core.material.opacity = 0.9 * (1 - t * 1.3);
        for (const p of particles) {
            p.position.addScaledVector(p.userData.vel, 0.02);
            p.userData.vel.y -= 0.06;
            p.material.opacity = 1 - t;
        }
        requestAnimationFrame(loop);
    };
    loop();
}

function setupKnightEffect() {
    const CYCLE = 3200;
    wikiLoop(CYCLE, () => {
        clearEffectScene();
        wikiEffectRoot.add(makeWikiGround());

        const knight = createPieceModel('knight', 'white', 100, 100, PIECE_PARAMS.knight);
        knight.position.set(-1.2, 0, 1.2);
        wikiEffectRoot.add(knight);

        // Victim
        const victim = createPieceModel('pawn', 'black', 100, 100, PIECE_PARAMS.pawn);
        victim.position.set(0.6, 0, -0.6);
        wikiEffectRoot.add(victim);

        // Landing zone
        const landGeo = new THREE.RingGeometry(0.35, 0.45, 32);
        const landMat = new THREE.MeshBasicMaterial({
            color: 0xe8c547, transparent: true, opacity: 0.8,
            depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        });
        const landRing = new THREE.Mesh(landGeo, landMat);
        landRing.rotation.x = -Math.PI / 2;
        landRing.position.set(0, 0.03, 0);
        wikiEffectRoot.add(landRing);

        const start = new THREE.Vector3(-1.2, 0, 1.2);
        const mid = new THREE.Vector3(0, 0, 0);
        const startT = performance.now();
        const DURATION = 600;

        // Spiral wind particles during dash
        const spiral = [];
        for (let i = 0; i < 24; i++) {
            const pg = new THREE.SphereGeometry(0.05, 5, 5);
            const pm = new THREE.MeshBasicMaterial({
                color: 0xb8ecff, transparent: true, opacity: 0.9,
                depthWrite: false, blending: THREE.AdditiveBlending,
            });
            const p = new THREE.Mesh(pg, pm);
            p.visible = false;
            wikiEffectRoot.add(p);
            spiral.push({ mesh: p, phase: Math.random() * Math.PI * 2, r: 0.35 + Math.random() * 0.2 });
        }

        const animate = () => {
            const t = Math.min((performance.now() - startT) / DURATION, 1);
            const ease = t * (2 - t);
            knight.position.lerpVectors(start, mid, ease);
            knight.position.y = Math.sin(t * Math.PI) * 0.5;

            for (const s of spiral) {
                s.mesh.visible = t > 0.05 && t < 0.95;
                const angle = s.phase + t * 12;
                s.mesh.position.set(
                    knight.position.x + Math.cos(angle) * s.r,
                    knight.position.y + 0.3 + Math.sin(t * 10 + s.phase) * 0.1,
                    knight.position.z + Math.sin(angle) * s.r
                );
                s.mesh.material.opacity = 0.9 * (1 - Math.abs(t - 0.5) * 2);
            }

            if (t < 1) requestAnimationFrame(animate);
            else {
                spiral.forEach(s => { wikiEffectRoot.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); });
                // Push victim away
                const pushStart = performance.now();
                const PUSH_DURATION = 400;
                const victimStart = victim.position.clone();
                const victimEnd = victim.position.clone().add(new THREE.Vector3(0.9, 0, -0.9));
                const push = () => {
                    const pt = Math.min((performance.now() - pushStart) / PUSH_DURATION, 1);
                    victim.position.lerpVectors(victimStart, victimEnd, pt * pt);
                    if (pt < 1) requestAnimationFrame(push);
                };
                push();
            }
        };
        animate();
    });
}

function setupBishopEffect() {
    const CYCLE = 3400;
    wikiLoop(CYCLE, () => {
        clearEffectScene();
        wikiEffectRoot.add(makeWikiGround());

        const bishop = createPieceModel('bishop', 'white', 100, 100, PIECE_PARAMS.bishop);
        bishop.position.set(-1.5, 0, 1.5);
        wikiEffectRoot.add(bishop);

        // Screen piece in the path
        const screen = createPieceModel('pawn', 'black', 100, 100, PIECE_PARAMS.pawn);
        screen.position.set(-0.5, 0, 0.5);
        wikiEffectRoot.add(screen);

        const start = new THREE.Vector3(-1.5, 0, 1.5);
        const end = new THREE.Vector3(1.5, 0, -1.5);

        // Ground crack trail
        const startT = performance.now();
        const DURATION = 700;

        const jump = () => {
            const t = Math.min((performance.now() - startT) / DURATION, 1);
            const ease = t * (2 - t);
            bishop.position.lerpVectors(start, end, ease);
            bishop.position.y = Math.sin(t * Math.PI) * 1.1;

            if (t >= 0.5 && !jump._hitScreen) {
                jump._hitScreen = true;
                // Flash the screen piece and fade it (it "took damage")
                screen.traverse(n => {
                    if (n.isMesh && n.material) {
                        n.material.color.setHex(0xff2200);
                        n.material.emissive && n.material.emissive.setHex(0xff0000);
                    }
                });
                setTimeout(() => { if (screen.parent) screen.visible = false; }, 250);
            }

            if (t < 1) requestAnimationFrame(jump);
            else {
                spawnBishopLava(end.x, end.z);
                // Fade back in for the next cycle
                setTimeout(() => { screen.visible = true; }, 800);
            }
        };
        jump._hitScreen = false;
        jump();
    });
}

function spawnBishopLava(x, z) {
    const startT = performance.now();
    const DURATION = 1200;
    const cracks = [];
    for (let i = 0; i < 5; i++) {
        const angle = Math.random() * Math.PI * 2;
        const len = 0.5 + Math.random() * 0.6;
        const geo = new THREE.PlaneGeometry(len, 0.08);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xff7700, transparent: true, opacity: 0.9,
            depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        });
        const m = new THREE.Mesh(geo, mat);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = angle;
        m.position.set(x + Math.cos(angle) * len * 0.5, 0.03, z + Math.sin(angle) * len * 0.5);
        wikiEffectRoot.add(m);
        cracks.push(m);
    }
    const ringGeo = new THREE.RingGeometry(0.25, 0.4, 32);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffcc44, transparent: true, opacity: 1,
        depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.04, z);
    wikiEffectRoot.add(ring);

    const loop = () => {
        const t = (performance.now() - startT) / DURATION;
        if (t >= 1) {
            cracks.forEach(c => { wikiEffectRoot.remove(c); c.geometry.dispose(); c.material.dispose(); });
            wikiEffectRoot.remove(ring); ring.geometry.dispose(); ring.material.dispose();
            return;
        }
        for (const c of cracks) c.material.opacity = 0.9 * (1 - t);
        ring.scale.setScalar(1 + t * 3);
        ring.material.opacity = 1 - t;
        requestAnimationFrame(loop);
    };
    loop();
}

// ============================================================
//  CLEANUP
// ============================================================
function cleanupWikiViewers() {
    if (wikiModelRAF) { cancelAnimationFrame(wikiModelRAF); wikiModelRAF = null; }
    if (wikiEffectRAF) { cancelAnimationFrame(wikiEffectRAF); wikiEffectRAF = null; }
    wikiEffectTimers.forEach(t => clearTimeout(t));
    wikiEffectTimers = [];

    if (wikiModelRenderer) {
        wikiModelRenderer.dispose();
        wikiModelRenderer.domElement.remove();
        wikiModelRenderer = null;
    }
    if (wikiEffectRenderer) {
        wikiEffectRenderer.dispose();
        wikiEffectRenderer.domElement.remove();
        wikiEffectRenderer = null;
    }

    // Dispose of scene-only resources (cached geometries from GEO_CACHE stay)
    const disposeScene = sc => {
        if (!sc) return;
        sc.traverse(n => {
            if (n.userData && n.userData.keep) return;
            if (n.isMesh && n.material) {
                if (Array.isArray(n.material)) n.material.forEach(m => m.dispose());
                else n.material.dispose();
            }
            if (n.isSprite && n.material) {
                if (n.material.map) n.material.map.dispose();
                n.material.dispose();
            }
        });
    };
    disposeScene(wikiModelScene);
    disposeScene(wikiEffectScene);

    wikiModelScene = wikiModelCamera = wikiModelGroup = null;
    wikiEffectScene = wikiEffectCamera = wikiEffectRoot = null;
    wikiCurrent = null;
}