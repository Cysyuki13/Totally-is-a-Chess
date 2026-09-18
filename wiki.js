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
        skillName: '① 治癒 (Heal) ／ ② 復活 (Revive)',
        description:
            '皇后是<strong>唯一同時擁有兩種特殊技能</strong>的棋子。\n' +
            '\n【① 治癒 Heal】— 冷卻 2 回合\n' +
            '   治療自身移動範圍內（每條射線上的第一個）受損的友方棋子 <b>100</b> 點生命。\n' +
            '\n【② 復活 Revive】— 冷卻 10 回合\n' +
            '   將一名<strong>當前陣亡</strong>的友方棋子以滿血復活於自身周圍 8 格內的任一空格。\n' +
            '   已被復活過的棋子必須再次陣亡，才能再次被復活。',
        damage: 0, heal: 100, selfDamage: 0, cooldown: '2 / 10',
        board: () => {
            const caster = { r: 4, c: 4 };
            const reviveZone = [];
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    reviveZone.push({ r: caster.r + dr, c: caster.c + dc });
                }
            }
            return {
                caster: { ...caster, type: 'queen', color: 'white', icon: '♛' },
                damage: reviveZone,                                  // 🔴 復活放置區
                path: [{ r: 2, c: 4 }, { r: 4, c: 2 }],              // 🟡 治癒目標
            };
        },
    },
    king: {
        name: '國王 (King)', glyph: '♚',
        skillName: '領域展開 (Domain Expansion)',
        description:
            '當國王被將軍時，可展開<b>漆黑領域</b>，與將軍者進行猜拳對決。\n' +
            '\n【使用條件】\n' +
            '   • 僅當己方國王被將軍時才能發動\n' +
            '   • 每場對局最多使用 <b>3</b> 次\n' +
            '   • 每次使用後需等待 <b>10</b> 回合冷卻\n' +
            '\n【對決規則】\n' +
            '   國王有 <b>2</b> 顆心，將軍者有 <b>1</b> 顆心。\n' +
            '   • 國王獲勝 → 將軍者當場消滅，對局繼續\n' +
            '   • 國王落敗 → 直接輸掉整場對局\n' +
            '   • 平手 → 重擲，雙方皆不掉血',
        damage: 0, selfDamage: 0, cooldown: '10 回合 / 3 次',
        board: () => {
            // Visualize: king in the center, a checker on the side
            const caster = { r: 4, c: 4 };
            const checker = { r: 4, c: 0 };
            return {
                caster: { ...caster, type: 'king', color: 'white', icon: '♚' },
                damage: [checker],   // enemy checker highlighted
                path: [],            // whole board is the domain, skip for clarity
            };
        },
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
    document.getElementById('wikiDescription').innerHTML =
        String(data.description).replace(/\n/g, '<br>');
    const dmgBadge = document.getElementById('wikiDamageBadge');
    if (data.heal) {
        dmgBadge.innerHTML = `💚 治療 <b id="wikiDamage">+${data.heal}</b>`;
    } else {
        dmgBadge.innerHTML = `💥 傷害 <b id="wikiDamage">${data.damage > 0 ? data.damage : '—'}</b>`;
    }
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
    if (!info) {
        const model = createPieceModel(type, 'white', 100, 100, PIECE_PARAMS[type] || {});
        model.position.set(0, 0, 0.5);
        wikiEffectRoot.add(model);
        return;
    }

    if (type === 'pawn') setupPawnEffect();
    if (type === 'rook') setupRookEffect();
    if (type === 'knight') setupKnightEffect();
    if (type === 'bishop') setupBishopEffect();
    if (type === 'queen') setupQueenEffect();
    if (type === 'king') setupKingEffect();   // ★ NEW
}

// ── Queen effect — alternates between HEAL and REVIVE ──────────
//    Every full loop we flip to the other demo so viewers see both
//    of the queen's skills without leaving the wiki page.
let _queenDemoPhase = 0;      // 0 = heal, 1 = revive

function setupQueenEffect() {
    const CYCLE = 4000;       // a bit longer — two demos per "cycle pair"
    _queenDemoPhase = 0;      // start on Heal each time the tab is opened

    wikiLoop(CYCLE, () => {
        clearEffectScene();
        wikiEffectRoot.add(makeWikiGround());

        if (_queenDemoPhase === 0) {
            playQueenHealDemo();
        } else {
            playQueenReviveDemo();
        }
        _queenDemoPhase = 1 - _queenDemoPhase;

        // Update the small on-canvas label
        updateQueenSkillLabel(_queenDemoPhase === 0 ? 'heal' : 'revive');
    });
}

// Small helper so a label sits at the top of the wiki effect canvas
function updateQueenSkillLabel(which) {
    const container = document.getElementById('wikiEffect');
    if (!container) return;
    let label = container.querySelector('.wiki-effect-label');
    if (!label) {
        label = document.createElement('div');
        label.className = 'wiki-effect-label';
        container.appendChild(label);
    }
    if (which === 'heal') {
        label.textContent = '① 治癒 Heal';
        label.style.color = '#a8ffcc';
        label.style.borderColor = 'rgba(168, 255, 204, 0.6)';
    } else {
        label.textContent = '② 復活 Revive';
        label.style.color = '#e0b3ff';
        label.style.borderColor = 'rgba(224, 179, 255, 0.6)';
    }
    // Restart the CSS animation so it re-pops on each switch
    label.style.animation = 'none';
    void label.offsetWidth;
    label.style.animation = 'wikiEffectLabelPop 0.5s ease-out';
}

// ── Demo A: Heal (original queen heal animation) ───────────────
function playQueenHealDemo() {
    const queen = createPieceModel('queen', 'white', 100, 100, PIECE_PARAMS.queen || {});
    queen.position.set(-0.9, 0, 0.9);
    wikiEffectRoot.add(queen);

    const ally = createPieceModel('pawn', 'white', 100, 100, PIECE_PARAMS.pawn || {});
    ally.position.set(0.6, 0, -0.6);
    wikiEffectRoot.add(ally);

    // Ally starts out "damaged"
    const dim = (hex) => ally.traverse(n => {
        if (n.isMesh && n.material) n.material.color.setHex(hex);
    });
    dim(0x8f8878);

    const beamGroup = new THREE.Group();
    beamGroup.position.set(0.6, 0, -0.6);
    beamGroup.visible = false;
    wikiEffectRoot.add(beamGroup);

    const beamMat = new THREE.MeshBasicMaterial({
        color: 0x6dffb0, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 2.4, 20, 1, true), beamMat);
    beam.position.y = 1.2;
    beamGroup.add(beam);

    const ringMat = new THREE.MeshBasicMaterial({
        color: 0x2ecc71, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.34, 32), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    beamGroup.add(ring);

    const particles = [];
    for (let i = 0; i < 28; i++) {
        const pg = new THREE.SphereGeometry(0.028 + Math.random() * 0.03, 5, 5);
        const pm = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(0.36 + Math.random() * 0.08, 0.9, 0.65),
            transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const p = new THREE.Mesh(pg, pm);
        const a = Math.random() * Math.PI * 2;
        const r = 0.08 + Math.random() * 0.3;
        p.position.set(Math.cos(a) * r, 0.05, Math.sin(a) * r);
        p.userData.vel = new THREE.Vector3(Math.cos(a) * 0.2, 1.0 + Math.random() * 1.2, Math.sin(a) * 0.2);
        p.userData.delay = Math.random() * 0.4;
        beamGroup.add(p);
        particles.push(p);
    }

    const startT = performance.now();
    const BEAM_START = 450;
    const DURATION = 2000;
    let restored = false;

    const animate = () => {
        const t = performance.now() - startT;
        const bt = t - BEAM_START;
        if (bt >= 0) {
            beamGroup.visible = true;
            const k = Math.min(bt / (DURATION - BEAM_START), 1);
            beamMat.opacity = 0.45 * Math.sin(Math.PI * k);
            ringMat.opacity = 0.85 * (1 - k);
            ring.scale.setScalar(1 + k * 2.6);

            for (const p of particles) {
                const pt = bt / 1000 - p.userData.delay;
                if (pt < 0 || pt > 1) { p.visible = false; continue; }
                p.visible = true;
                p.position.addScaledVector(p.userData.vel, 0.016);
                p.material.opacity = (1 - pt) * 0.9;
            }

            if (!restored && k > 0.6) { restored = true; dim(0xf5f0e1); }
        }
        if (t < DURATION) requestAnimationFrame(animate);
    };
    animate();
}

// ── Demo B: Revive (matches in-game effect) ────────────────────
function playQueenReviveDemo() {
    const queen = createPieceModel('queen', 'white', 100, 100, PIECE_PARAMS.queen || {});
    queen.position.set(-0.9, 0, 0.9);
    wikiEffectRoot.add(queen);

    // The revived ally: a rook — "fallen warrior returns"
    const REVIVE_POS = new THREE.Vector3(0.6, 0, -0.6);

    // ── Ground rune circle ──
    const runeGroup = new THREE.Group();
    runeGroup.position.copy(REVIVE_POS);
    runeGroup.position.y = 0.02;
    wikiEffectRoot.add(runeGroup);

    const runeOuterMat = new THREE.MeshBasicMaterial({
        color: 0xd9a6ff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const runeOuter = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 48), runeOuterMat);
    runeOuter.rotation.x = -Math.PI / 2;
    runeGroup.add(runeOuter);

    const runeInnerMat = new THREE.MeshBasicMaterial({
        color: 0xffe27a, transparent: true, opacity: 0,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const runeInner = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.32, 40), runeInnerMat);
    runeInner.rotation.x = -Math.PI / 2;
    runeInner.position.y = 0.004;
    runeGroup.add(runeInner);

    // ── Sky beam ──
    const beamMat = new THREE.MeshBasicMaterial({
        color: 0xd9a6ff, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.55, 4.0, 24, 1, true), beamMat);
    beam.position.set(REVIVE_POS.x, 2.0, REVIVE_POS.z);
    wikiEffectRoot.add(beam);

    const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.14, 4.0, 16, 1, true), coreMat);
    core.position.set(REVIVE_POS.x, 2.0, REVIVE_POS.z);
    wikiEffectRoot.add(core);

    // ── Shock rings ──
    const rings = [];
    for (let i = 0; i < 3; i++) {
        const mat = new THREE.MeshBasicMaterial({
            color: i % 2 === 0 ? 0xb06cff : 0xffe27a,
            transparent: true, opacity: 0, depthWrite: false,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        });
        const r = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.22, 40), mat);
        r.rotation.x = -Math.PI / 2;
        r.position.set(REVIVE_POS.x, 0.05 + i * 0.006, REVIVE_POS.z);
        wikiEffectRoot.add(r);
        rings.push({ mesh: r, delay: i * 0.15 });
    }

    // ── Rising spiral motes ──
    const motes = [];
    for (let i = 0; i < 48; i++) {
        const pg = new THREE.SphereGeometry(0.02 + Math.random() * 0.03, 5, 5);
        const pm = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(
                0.72 + Math.random() * 0.13, 0.95, 0.6 + Math.random() * 0.3
            ),
            transparent: true, opacity: 0, depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const p = new THREE.Mesh(pg, pm);
        const a = Math.random() * Math.PI * 2;
        const r = 0.05 + Math.random() * 0.38;
        p.position.set(REVIVE_POS.x + Math.cos(a) * r, 0.05, REVIVE_POS.z + Math.sin(a) * r);
        p.userData = {
            baseAngle: a,
            baseRadius: r,
            angularSpeed: 1.6 + Math.random() * 2.4,
            riseSpeed: 1.1 + Math.random() * 1.9,
            delay: Math.random() * 0.35,
            life: 0.8 + Math.random() * 0.55,
        };
        wikiEffectRoot.add(p);
        motes.push(p);
    }

    // ── Materialize flash ──
    const flashMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const flash = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), flashMat);
    flash.rotation.x = -Math.PI / 2;
    flash.position.set(REVIVE_POS.x, 0.08, REVIVE_POS.z);
    wikiEffectRoot.add(flash);

    // ── The piece that will be revived ──
    const revived = createPieceModel('rook', 'white', 100, 100, PIECE_PARAMS.rook || {});
    revived.position.set(REVIVE_POS.x, -1.0, REVIVE_POS.z);
    revived.scale.setScalar(0.05);
    revived.rotation.y = -Math.PI * 2;
    wikiEffectRoot.add(revived);

    // ── Animate ──
    const startT = performance.now();
    const DURATION = 2200;
    const MATERIALIZE_AT = 500;   // ms

    const animate = () => {
        const t = performance.now() - startT;
        if (t >= DURATION) return;
        const prog = t / DURATION;

        // Rune circle
        const runeFade = Math.min(t / 300, 1) * Math.max(0, 1 - prog * 1.05);
        runeOuterMat.opacity = 0.85 * runeFade;
        runeInnerMat.opacity = 0.95 * runeFade;
        runeGroup.rotation.y += 0.04;

        // Beams
        const beamEnv = Math.sin(Math.PI * Math.min(prog / 0.8, 1));
        beamMat.opacity = 0.55 * beamEnv;
        coreMat.opacity = 0.9 * beamEnv;
        beam.rotation.y += 0.03;
        core.rotation.y -= 0.06;

        // Rings
        for (const r of rings) {
            const rt = Math.max(0, Math.min(1, (t - r.delay) / (DURATION - r.delay)));
            r.mesh.material.opacity = 0.85 * (1 - rt);
            r.mesh.scale.setScalar(1 + rt * 4.5);
        }

        // Motes
        for (const p of motes) {
            const pt = (t - p.userData.delay) / 1000;
            if (pt < 0 || pt > p.userData.life) { p.visible = false; continue; }
            p.visible = true;
            const u = pt / p.userData.life;
            const angle = p.userData.baseAngle + pt * p.userData.angularSpeed;
            const r = p.userData.baseRadius * (1 - u * 0.3);
            p.position.set(
                REVIVE_POS.x + Math.cos(angle) * r,
                0.05 + pt * p.userData.riseSpeed,
                REVIVE_POS.z + Math.sin(angle) * r
            );
            p.material.opacity = (1 - u) * 0.95;
            p.scale.setScalar(1 - u * 0.35);
        }

        // Materialize flash
        const mf = Math.max(0, 1 - Math.abs(t - MATERIALIZE_AT) / 280);
        flashMat.opacity = 0.9 * mf;
        flash.scale.setScalar(1 + (1 - mf) * 1.8);

        // Piece pop-in
        if (t > MATERIALIZE_AT) {
            const pt = Math.min((t - MATERIALIZE_AT) / 900, 1);
            const e = 1 - Math.pow(1 - pt, 3);
            revived.position.y = -1.0 * (1 - e);
            revived.scale.setScalar(0.05 + 0.95 * e);
            revived.rotation.y = -Math.PI * 2 * (1 - e);
        }

        requestAnimationFrame(animate);
    };
    animate();
}

// ── Individual effect players ──
// ── Pawn effect ───────────────────────────────────────────────
function setupPawnEffect() {
    const CYCLE = 2800;
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
                // ★ Full cross-explosion showcase
                spawnCrossBurst(pawn.position.x, pawn.position.z);
                return;
            }
            requestAnimationFrame(step);
        };
        step();
    });
}

// ★ Enhanced cross burst — 4-direction explosion grid
//   matches the in-game "charge explosion" cross AoE
function spawnCrossBurst(x, z) {
    const burstStart = performance.now();
    const DURATION = 1100;
    const SQ = 0.6;                       // wiki-grid square size
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    // ── 1. Four beams extending one square out from the centre ──
    const beams = [];
    for (const [dr, dc] of dirs) {
        const beamGeo = new THREE.BoxGeometry(
            dr !== 0 ? SQ * 1.05 : 0.16,
            0.10,
            dc !== 0 ? SQ * 1.05 : 0.16
        );
        const beamMat = new THREE.MeshBasicMaterial({
            color: 0xff6622, transparent: true, opacity: 0.95,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.set(x + dr * SQ * 0.5, 0.10, z + dc * SQ * 0.5);
        beam.renderOrder = 15;
        wikiEffectRoot.add(beam);
        beams.push(beam);
    }

    // ── 2. Hot "hit plates" on the 4 outer cells (shows the AoE) ──
    const plates = [];
    for (const [dr, dc] of dirs) {
        // Fill plate
        const plateGeo = new THREE.PlaneGeometry(SQ * 0.95, SQ * 0.95);
        const plateMat = new THREE.MeshBasicMaterial({
            color: 0xff2200, transparent: true, opacity: 0,
            side: THREE.DoubleSide, depthWrite: false,
        });
        const plate = new THREE.Mesh(plateGeo, plateMat);
        plate.rotation.x = -Math.PI / 2;
        plate.position.set(x + dr * SQ, 0.05, z + dc * SQ);
        plate.renderOrder = 16;
        wikiEffectRoot.add(plate);
        plates.push(plate);

        // Pulsing ring outline on each hit cell
        const ringGeo = new THREE.RingGeometry(SQ * 0.28, SQ * 0.42, 24);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xffaa00, transparent: true, opacity: 0,
            side: THREE.DoubleSide, depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x + dr * SQ, 0.06, z + dc * SQ);
        ring.renderOrder = 17;
        wikiEffectRoot.add(ring);
        plates.push(ring);
    }

    // ── 3. Center hotspot ──
    const centerGeo = new THREE.CircleGeometry(SQ * 0.5, 24);
    const centerMat = new THREE.MeshBasicMaterial({
        color: 0xffcc44, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const centerDisc = new THREE.Mesh(centerGeo, centerMat);
    centerDisc.rotation.x = -Math.PI / 2;
    centerDisc.position.set(x, 0.045, z);
    centerDisc.renderOrder = 17;
    wikiEffectRoot.add(centerDisc);

    // ── 4. Bright flash sphere ──
    const flashGeo = new THREE.SphereGeometry(0.42, 16, 16);
    const flashMat = new THREE.MeshBasicMaterial({
        color: 0xffffaa, transparent: true, opacity: 1,
        depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(x, 0.4, z);
    wikiEffectRoot.add(flash);

    // ── 5. Particles flying along each arm ──
    const particles = [];
    for (const [dr, dc] of dirs) {
        for (let i = 0; i < 12; i++) {
            const pg = new THREE.SphereGeometry(0.035 + Math.random() * 0.03, 5, 5);
            const pm = new THREE.MeshBasicMaterial({
                color: new THREE.Color().setHSL(0.05 + Math.random() * 0.08, 1, 0.55 + Math.random() * 0.25),
                transparent: true, opacity: 1, depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            const p = new THREE.Mesh(pg, pm);
            p.position.set(x + dr * 0.08, 0.1, z + dc * 0.08);
            const lateral = (Math.random() - 0.5) * 0.4;
            p.userData.vel = new THREE.Vector3(
                dr * (2.5 + Math.random() * 2.5) + (dc !== 0 ? lateral : 0),
                1.6 + Math.random() * 2.5,
                dc * (2.5 + Math.random() * 2.5) + (dr !== 0 ? lateral : 0)
            );
            p.renderOrder = 20;
            wikiEffectRoot.add(p);
            particles.push(p);
        }
    }

    // ── Animation ──
    const loop = () => {
        const t = (performance.now() - burstStart) / DURATION;
        if (t >= 1) return;

        // Beams: quick flash then fade
        const beamAlpha = Math.max(0, 1 - t * 2.2);
        for (const b of beams) {
            b.material.opacity = 0.95 * beamAlpha;
            b.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.15);
        }

        // Plates: bloom in then fade, with a slow pulse
        const bloom = Math.min(t * 6, 1) * Math.max(0, 1 - t * 1.4);
        for (let i = 0; i < 4; i++) {
            plates[i * 2].material.opacity = bloom * 0.55;
            plates[i * 2 + 1].material.opacity = bloom * (0.7 + 0.3 * Math.sin(t * 30));
            plates[i * 2 + 1].scale.setScalar(1 + t * 1.2);
        }
        centerDisc.material.opacity = bloom * (0.6 + 0.4 * Math.sin(t * 24));
        centerDisc.scale.setScalar(1 + t * 1.6);

        // Flash
        flash.scale.setScalar(1 + t * 5.5);
        flash.material.opacity = Math.max(0, 1 - t * 2.6);

        // Particles
        for (const p of particles) {
            p.position.addScaledVector(p.userData.vel, 0.02);
            p.userData.vel.y -= 0.14;
            p.material.opacity = Math.max(0, 1 - t * 1.2);
            p.scale.setScalar(1 - t * 0.3);
        }

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

// ── Bishop effect ─────────────────────────────────────────────
function setupBishopEffect() {
    const CYCLE = 4200;
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

        const startT = performance.now();
        const DURATION = 750;

        // ★ Fire up the full lava-crack trail along the leap path
        spawnBishopLeapTrail(start, end, DURATION / 1000);

        const jump = () => {
            const t = Math.min((performance.now() - startT) / DURATION, 1);
            const ease = t * (2 - t);
            bishop.position.lerpVectors(start, end, ease);
            bishop.position.y = Math.sin(t * Math.PI) * 1.1;

            if (t >= 0.5 && !jump._hitScreen) {
                jump._hitScreen = true;
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
                setTimeout(() => { screen.visible = true; }, 1000);
            }
        };
        jump._hitScreen = false;
        jump();
    });
}

// ★ Full "lava-crack trail" for the bishop leap — matches in-game effect
function spawnBishopLeapTrail(start, end, leapDurationSec) {
    const startT = performance.now();
    const TOTAL = 3.2;   // total lifetime (seconds)

    const state = {
        cracks: [], lava: [], embers: [], rings: [], glows: [],
        disposed: false,
    };

    // Compute path nodes
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(3, Math.round(len / 0.5));
    const nodes = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        nodes.push({
            x: start.x + dx * t,
            z: start.z + dz * t,
            delay: t * leapDurationSec,
            isLanding: i === steps,
        });
    }

    // Helper: ground-aligned segment
    const makeGroundSegment = (p1, p2, width, mat, y) => {
        const ddx = p2.x - p1.x, ddz = p2.z - p1.z;
        const L = Math.hypot(ddx, ddz);
        if (L < 1e-4) return null;
        const geo = new THREE.PlaneGeometry(L, width);
        const mesh = new THREE.Mesh(geo, mat);
        const dirV = new THREE.Vector3(ddx, 0, ddz).normalize();
        const perp = new THREE.Vector3(-dirV.z, 0, dirV.x);
        const up = new THREE.Vector3(0, 1, 0);
        const mtx = new THREE.Matrix4().makeBasis(dirV, perp, up);
        mesh.quaternion.setFromRotationMatrix(mtx);
        mesh.position.set((p1.x + p2.x) / 2, y, (p1.z + p2.z) / 2);
        return mesh;
    };

    const buildCrackCluster = (cx, cz, delay, sizeMul) => {
        const baseAngle = Math.random() * Math.PI * 2;
        const mainLen = (0.5 + Math.random() * 0.25) * sizeMul;
        const segs = 5;
        const mainPts = [];
        for (let s = 0; s <= segs; s++) {
            const tt = s / segs - 0.5;
            const jitter = (Math.random() - 0.5) * 0.10;
            mainPts.push(new THREE.Vector3(
                cx + Math.cos(baseAngle) * mainLen * tt + Math.cos(baseAngle + Math.PI / 2) * jitter,
                0,
                cz + Math.sin(baseAngle) * mainLen * tt + Math.sin(baseAngle + Math.PI / 2) * jitter
            ));
        }

        const meshes = [];
        const darkMat = new THREE.MeshBasicMaterial({
            color: 0x080200, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
        });
        const lavaMat = new THREE.MeshBasicMaterial({
            color: 0xff8822, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });

        for (let s = 0; s < mainPts.length - 1; s++) {
            const p1 = mainPts[s], p2 = mainPts[s + 1];
            const dm = makeGroundSegment(p1, p2, 0.075, darkMat, 0.018);
            if (dm) { dm.renderOrder = 10; wikiEffectRoot.add(dm); meshes.push({ mesh: dm, kind: 'dark' }); }
            const lm = makeGroundSegment(p1, p2, 0.045, lavaMat, 0.030);
            if (lm) { lm.renderOrder = 11; wikiEffectRoot.add(lm); meshes.push({ mesh: lm, kind: 'lava' }); }
        }

        // Branches
        for (let b = 0; b < 3; b++) {
            const startIdx = 1 + Math.floor(Math.random() * (mainPts.length - 2));
            const sp = mainPts[startIdx];
            const branchAngle = baseAngle + (Math.random() < 0.5 ? 1 : -1) * (0.5 + Math.random() * 1.1);
            const branchLen = (0.15 + Math.random() * 0.2) * sizeMul;
            const bPts = [sp.clone()];
            for (let s = 1; s <= 3; s++) {
                const tt = s / 3;
                const j = (Math.random() - 0.5) * 0.05;
                bPts.push(new THREE.Vector3(
                    sp.x + Math.cos(branchAngle) * branchLen * tt + j,
                    0,
                    sp.z + Math.sin(branchAngle) * branchLen * tt + j
                ));
            }

            const darkBMat = new THREE.MeshBasicMaterial({
                color: 0x080200, transparent: true, opacity: 0,
                depthWrite: false, side: THREE.DoubleSide,
            });
            const lavaBMat = new THREE.MeshBasicMaterial({
                color: 0xff6611, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
            });
            for (let s = 0; s < bPts.length - 1; s++) {
                const p1 = bPts[s], p2 = bPts[s + 1];
                const dm = makeGroundSegment(p1, p2, 0.05, darkBMat, 0.018);
                if (dm) { dm.renderOrder = 10; wikiEffectRoot.add(dm); meshes.push({ mesh: dm, kind: 'dark' }); }
                const lm = makeGroundSegment(p1, p2, 0.03, lavaBMat, 0.030);
                if (lm) { lm.renderOrder = 11; wikiEffectRoot.add(lm); meshes.push({ mesh: lm, kind: 'lava' }); }
            }
        }

        state.cracks.push({
            meshes, bornAt: delay,
            pulsePhase: Math.random() * Math.PI * 2,
            lifeStart: delay + 0.4,
            fadeDuration: TOTAL - delay - 0.4,
        });
    };

    // ---- Build cracks along every node ----
    for (const node of nodes) {
        buildCrackCluster(node.x, node.z, node.delay, node.isLanding ? 1.25 : 1.0);
    }

    // ---- Lava, embers, rings, heat per node ----
    for (const node of nodes) {
        // Lava particles
        const lavaCount = node.isLanding ? 26 : 12;
        for (let i = 0; i < lavaCount; i++) {
            const pg = new THREE.SphereGeometry(0.035 + Math.random() * 0.04, 5, 5);
            const pm = new THREE.MeshBasicMaterial({
                color: 0xffcc44, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const mesh = new THREE.Mesh(pg, pm);
            mesh.renderOrder = 20;
            mesh.position.set(
                node.x + (Math.random() - 0.5) * 0.3,
                0.08,
                node.z + (Math.random() - 0.5) * 0.3
            );
            wikiEffectRoot.add(mesh);
            const a = Math.random() * Math.PI * 2;
            const spread = 0.6 + Math.random() * 1.2;
            const upSpeed = node.isLanding ? (3.0 + Math.random() * 2.5) : (2.0 + Math.random() * 1.8);
            state.lava.push({
                mesh,
                vel: new THREE.Vector3(Math.cos(a) * spread * 0.7, upSpeed, Math.sin(a) * spread * 0.7),
                bornAt: node.delay + Math.random() * 0.12,
                life: 0.9 + Math.random() * 0.7,
            });
        }

        // Embers
        for (let i = 0; i < 6; i++) {
            const pg = new THREE.SphereGeometry(0.018 + Math.random() * 0.02, 4, 4);
            const pm = new THREE.MeshBasicMaterial({
                color: 0xffaa33, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const mesh = new THREE.Mesh(pg, pm);
            mesh.renderOrder = 20;
            mesh.position.set(
                node.x + (Math.random() - 0.5) * 0.3,
                0.06,
                node.z + (Math.random() - 0.5) * 0.3
            );
            wikiEffectRoot.add(mesh);
            state.embers.push({
                mesh,
                velY: 0.6 + Math.random() * 1.2,
                driftX: (Math.random() - 0.5) * 0.5,
                driftZ: (Math.random() - 0.5) * 0.5,
                bornAt: node.delay + Math.random() * 0.15,
                life: 1.4 + Math.random() * 0.8,
            });
        }

        // Shock ring per non-landing node
        if (!node.isLanding) {
            const rg = new THREE.RingGeometry(0.08, 0.2, 20);
            const rm = new THREE.MeshBasicMaterial({
                color: 0xff7700, transparent: true, opacity: 0,
                side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const ring = new THREE.Mesh(rg, rm);
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(node.x, 0.035, node.z);
            ring.renderOrder = 12;
            wikiEffectRoot.add(ring);
            state.rings.push({
                mesh: ring, bornAt: node.delay, duration: 0.4,
                startScale: 1, endScale: 3, maxOpacity: 0.6,
            });
        }

        // Ground heat disc
        const hg = new THREE.CircleGeometry(0.4, 18);
        const hm = new THREE.MeshBasicMaterial({
            color: 0xff5500, transparent: true, opacity: 0,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const heat = new THREE.Mesh(hg, hm);
        heat.rotation.x = -Math.PI / 2;
        heat.position.set(node.x, 0.022, node.z);
        heat.renderOrder = 8;
        wikiEffectRoot.add(heat);
        state.glows.push({
            mesh: heat, bornAt: node.delay,
            duration: TOTAL - node.delay,
            maxOpacity: node.isLanding ? 0.85 : 0.5,
            pulsePhase: Math.random() * Math.PI * 2,
        });
    }

    // ---- Landing big shock ring ----
    {
        const lrg = new THREE.RingGeometry(0.14, 0.3, 36);
        const lrm = new THREE.MeshBasicMaterial({
            color: 0xffcc66, transparent: true, opacity: 0,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const lr = new THREE.Mesh(lrg, lrm);
        lr.rotation.x = -Math.PI / 2;
        lr.position.set(end.x, 0.045, end.z);
        lr.renderOrder = 12;
        wikiEffectRoot.add(lr);
        state.rings.push({
            mesh: lr, bornAt: leapDurationSec, duration: 0.7,
            startScale: 1, endScale: 4.5, maxOpacity: 0.85,
        });
    }

    // ---- Animation ----
    const loop = () => {
        if (state.disposed) return;
        const elapsed = (performance.now() - startT) / 1000;
        if (elapsed >= TOTAL) {
            state.disposed = true;
            return;
        }

        // Cracks
        for (const c of state.cracks) {
            const t = elapsed - c.bornAt;
            if (t < 0) {
                for (const e of c.meshes) e.mesh.material.opacity = 0;
                continue;
            }
            const growT = Math.min(t / 0.2, 1);
            const fadeStart = c.lifeStart - c.bornAt;
            const fadeT = t < fadeStart ? 1 : Math.max(0, 1 - (t - fadeStart) / c.fadeDuration);
            const pulse = 0.72 + 0.28 * Math.sin(elapsed * 20 + c.pulsePhase);
            for (const e of c.meshes) {
                if (e.kind === 'dark') e.mesh.material.opacity = growT * fadeT * 0.95;
                else e.mesh.material.opacity = growT * fadeT * pulse;
            }
        }

        // Lava
        for (const p of state.lava) {
            const t = elapsed - p.bornAt;
            if (t < 0 || t > p.life) { p.mesh.visible = false; continue; }
            p.mesh.visible = true;
            p.mesh.position.x += p.vel.x * 0.016;
            p.mesh.position.y += p.vel.y * 0.016;
            p.mesh.position.z += p.vel.z * 0.016;
            p.vel.y -= 0.2;
            const lt = t / p.life;
            p.mesh.material.opacity = 1 - lt;
            p.mesh.material.color.setHSL(0.135 - lt * 0.085, 1, 0.78 - lt * 0.34);
            p.mesh.scale.setScalar(1 - lt * 0.35);
        }

        // Embers
        for (const e of state.embers) {
            const t = elapsed - e.bornAt;
            if (t < 0 || t > e.life) { e.mesh.visible = false; continue; }
            e.mesh.visible = true;
            e.mesh.position.y += e.velY * 0.016;
            e.mesh.position.x += e.driftX * 0.016;
            e.mesh.position.z += e.driftZ * 0.016;
            const lt = t / e.life;
            e.mesh.material.opacity = (1 - lt) * 0.85;
            e.mesh.material.color.setHSL(0.08 - lt * 0.03, 1, 0.7 - lt * 0.25);
            e.mesh.scale.setScalar(0.9 + Math.sin(t * 24) * 0.25);
        }

        // Rings
        for (const r of state.rings) {
            const t = elapsed - r.bornAt;
            if (t < 0 || t > r.duration) { r.mesh.material.opacity = 0; continue; }
            const progress = t / r.duration;
            const eased = 1 - Math.pow(1 - progress, 3);
            r.mesh.scale.setScalar(r.startScale + (r.endScale - r.startScale) * eased);
            r.mesh.material.opacity = r.maxOpacity * (1 - progress);
        }

        // Ground heat
        for (const g of state.glows) {
            const t = elapsed - g.bornAt;
            if (t < 0) continue;
            const progress = Math.min(t / g.duration, 1);
            const fadeIn = Math.min(t / 0.2, 1);
            const pulse = 0.75 + 0.25 * Math.sin(elapsed * 14 + g.pulsePhase);
            g.mesh.material.opacity = g.maxOpacity * fadeIn * (1 - progress) * pulse;
            g.mesh.scale.setScalar(1 + progress * 0.8);
        }

        requestAnimationFrame(loop);
    };
    loop();

    return state;
}

// ── King effect — slow black domain wave expanding from the king ──
function setupKingEffect() {
    const CYCLE = 4200;
    wikiLoop(CYCLE, () => {
        clearEffectScene();
        wikiEffectRoot.add(makeWikiGround());

        // King sits in the middle
        const king = createPieceModel('king', 'white', 100, 100, PIECE_PARAMS.king || {});
        king.position.set(0, 0, 0);
        wikiEffectRoot.add(king);

        // A "checker" piece on the far side (gets excluded from the tint)
        const checker = createPieceModel('rook', 'black', 100, 100, PIECE_PARAMS.rook || {});
        checker.position.set(0.6, 0, -0.6);
        wikiEffectRoot.add(checker);

        // ── Pure black expanding disc ──
        const discMat = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
        });
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 96), discMat);
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = 0.04;
        disc.scale.set(0.001, 0.001, 1);
        disc.renderOrder = 5;
        wikiEffectRoot.add(disc);

        // ── Main black wavefront ring ──
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 96), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.06;
        ring.scale.set(0.001, 0.001, 1);
        ring.renderOrder = 8;
        wikiEffectRoot.add(ring);

        // ── Purple rim-light on the wavefront edge ──
        const rimMat = new THREE.MeshBasicMaterial({
            color: 0x4a1a6a,
            transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        const rim = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.08, 96), rimMat);
        rim.rotation.x = -Math.PI / 2;
        rim.position.y = 0.07;
        rim.scale.set(0.001, 0.001, 1);
        rim.renderOrder = 9;
        wikiEffectRoot.add(rim);

        // ── Transparent shadow dome (half-sphere) ──
        const domeGeo = new THREE.SphereGeometry(
            1, 64, 32,
            0, Math.PI * 2,
            0, Math.PI / 2
        );
        const domeMat = new THREE.MeshBasicMaterial({
            color: 0x05000a,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const dome = new THREE.Mesh(domeGeo, domeMat);
        dome.position.y = 0.02;
        dome.scale.setScalar(0.001);
        dome.renderOrder = 6;
        wikiEffectRoot.add(dome);

        const domeInnerGeo = new THREE.SphereGeometry(
            1, 48, 24,
            0, Math.PI * 2,
            0, Math.PI / 2
        );
        const domeInnerMat = new THREE.MeshBasicMaterial({
            color: 0x2a0a4a,
            transparent: true,
            opacity: 0,
            side: THREE.BackSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const domeInner = new THREE.Mesh(domeInnerGeo, domeInnerMat);
        domeInner.position.y = 0.02;
        domeInner.scale.setScalar(0.001);
        domeInner.renderOrder = 7;
        wikiEffectRoot.add(domeInner);

        const startT = performance.now();
        const DURATION = 3400;
        const MAX_R = 3.6;

        const animate = () => {
            const t = performance.now() - startT;
            if (t >= DURATION) return;
            const p = Math.min(t / (DURATION - 400), 1);
            // Slow quartic ease
            const ease = 1 - Math.pow(1 - p, 4);
            const r = MAX_R * ease;

            // Transparent shadow dome
            const domeR = Math.max(0.001, r * 1.15);
            dome.scale.setScalar(domeR);
            domeMat.opacity = 0.42 * Math.min(1, p * 1.5) * (1 - p * 0.15);

            domeInner.scale.setScalar(domeR * 1.01);
            domeInnerMat.opacity = 0.22 * Math.min(1, p * 1.8);

            disc.scale.set(Math.max(0.001, r), Math.max(0.001, r), 1);
            discMat.opacity = 0.72 * Math.min(1, p * 1.6);

            ring.scale.set(Math.max(0.001, r), Math.max(0.001, r), 1);
            ringMat.opacity = 0.95 * (1 - p * 0.2);

            rim.scale.set(Math.max(0.001, r), Math.max(0.001, r), 1);
            rimMat.opacity = 0.75 * Math.sin(Math.PI * Math.min(p * 1.1, 1));

            requestAnimationFrame(animate);
        };
        animate();
    });
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