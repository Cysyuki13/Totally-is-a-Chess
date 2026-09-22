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
        skillName: '衝鋒爆炸 (Charge Explosion)',
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

    // ★ FIX: remove the queen skill label (it's a DOM node, not part of
    //   the Three.js scene, so clearEffectScene() never touches it).
    //   Queen's setup will recreate it if needed.
    const container = document.getElementById('wikiEffect');
    if (container) {
        const staleLabel = container.querySelector('.wiki-effect-label');
        if (staleLabel) staleLabel.remove();
    }

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
    if (type === 'king') setupKingEffect();
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
            updateQueenSkillLabel('heal');
        } else {
            playQueenReviveDemo();
            updateQueenSkillLabel('revive');
        }
        _queenDemoPhase = 1 - _queenDemoPhase;
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

// ── Knight effect — ENHANCED CINEMATIC ─────────────────────────
//   Timeline:
//     0.00 – 0.70s  CHARGE    knight pulses + spiral particles converge
//     0.70 – 1.30s  DASH      ghost afterimages + helix drill wind
//     1.30 – 2.10s  IMPACT    shockwave rings + dust burst + knockback
//     2.10 – 3.80s  AFTERMATH everything fades, victim settles
function setupKnightEffect() {
    const CYCLE = 4200;

    wikiLoop(CYCLE, () => {
        clearEffectScene();
        wikiEffectRoot.add(makeWikiGround());

        // ══════════════════════════════════════════════════════════
        //  TIMELINE (seconds)
        // ══════════════════════════════════════════════════════════
        const T_CHARGE = 0.70;   // wind-up
        const T_DASH = 1.30;   // dash + arrival
        const T_PUSH = 2.10;   // knockback
        const T_TOTAL = 3.80;   // fade-out

        // ══════════════════════════════════════════════════════════
        //  POSITIONS
        // ══════════════════════════════════════════════════════════
        const START = new THREE.Vector3(-1.2, 0, 1.2);
        const LAND = new THREE.Vector3(0.0, 0, 0.0);
        const VIC_A = new THREE.Vector3(0.6, 0, -0.6);
        const VIC_B = new THREE.Vector3(1.8, 0, -1.8);

        const dashVec = new THREE.Vector3().subVectors(LAND, START);
        const dashDir = dashVec.clone().normalize();
        const dashQuat = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0), dashDir
        );

        // ══════════════════════════════════════════════════════════
        //  PIECES
        // ══════════════════════════════════════════════════════════
        const knight = createPieceModel('knight', 'white', 100, 100, PIECE_PARAMS.knight);
        knight.position.copy(START);
        wikiEffectRoot.add(knight);

        const victim = createPieceModel('pawn', 'black', 100, 100, PIECE_PARAMS.pawn);
        victim.position.copy(VIC_A);
        wikiEffectRoot.add(victim);

        // ══════════════════════════════════════════════════════════
        //  LANDING ZONE — 3 pulsing rings + soft disc
        // ══════════════════════════════════════════════════════════
        const landRings = [];
        for (let i = 0; i < 3; i++) {
            const radius = 0.30 + i * 0.10;
            const mat = new THREE.MeshBasicMaterial({
                color: i === 0 ? 0xffffff : 0xe8c547,
                transparent: true, opacity: 0,
                depthWrite: false, side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            });
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(radius, radius + 0.055, 48), mat
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(LAND.x, 0.035 + i * 0.004, LAND.z);
            wikiEffectRoot.add(ring);
            landRings.push({ mesh: ring, mat, phase: i * 0.8 });
        }

        const landDiscMat = new THREE.MeshBasicMaterial({
            color: 0xe8c547, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        const landDisc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), landDiscMat);
        landDisc.rotation.x = -Math.PI / 2;
        landDisc.position.set(LAND.x, 0.03, LAND.z);
        wikiEffectRoot.add(landDisc);

        // ══════════════════════════════════════════════════════════
        //  CHARGE — rune ring at the knight's feet
        // ══════════════════════════════════════════════════════════
        const chargeRingMat = new THREE.MeshBasicMaterial({
            color: 0xb8ecff, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        const chargeRing = new THREE.Mesh(
            new THREE.RingGeometry(0.28, 0.38, 40), chargeRingMat
        );
        chargeRing.rotation.x = -Math.PI / 2;
        chargeRing.position.set(START.x, 0.04, START.z);
        wikiEffectRoot.add(chargeRing);

        // ══════════════════════════════════════════════════════════
        //  CHARGE PARTICLES — spiral inward toward the knight
        // ══════════════════════════════════════════════════════════
        const chargeParticles = [];
        for (let i = 0; i < 40; i++) {
            const geo = new THREE.SphereGeometry(0.024 + Math.random() * 0.025, 5, 5);
            const mat = new THREE.MeshBasicMaterial({
                color: Math.random() < 0.5 ? 0xb8ecff : 0xffffff,
                transparent: true, opacity: 0,
                depthWrite: false, blending: THREE.AdditiveBlending,
            });
            const p = new THREE.Mesh(geo, mat);
            const a = Math.random() * Math.PI * 2;
            const r = 0.9 + Math.random() * 0.8;
            p.position.set(
                START.x + Math.cos(a) * r,
                0.2 + Math.random() * 1.1,
                START.z + Math.sin(a) * r
            );
            p.userData = {
                startAngle: a,
                startRadius: r,
                startY: p.position.y,
                spinSpeed: 3 + Math.random() * 5,
                delay: Math.random() * 0.35,
            };
            wikiEffectRoot.add(p);
            chargeParticles.push(p);
        }

        // ══════════════════════════════════════════════════════════
        //  GHOST AFTERIMAGES — 4 spectral knights trailing the dash
        // ══════════════════════════════════════════════════════════
        const ghosts = [];
        for (let i = 0; i < 4; i++) {
            const g = createPieceModel('knight', 'white', 100, 100, PIECE_PARAMS.knight);
            g.position.copy(START);
            g.traverse(n => {
                if (n.isMesh && n.material && n.material.color) {
                    n.material.transparent = true;
                    n.material.opacity = 0;
                    n.material.depthWrite = false;
                    n.material.blending = THREE.AdditiveBlending;
                    n.material.color.lerp(new THREE.Color(0x9fe8ff), 0.7);
                    if (n.material.emissive) {
                        n.material.emissive = new THREE.Color(0x9fe8ff);
                        n.material.emissiveIntensity = 0.65;
                    }
                }
            });
            wikiEffectRoot.add(g);
            ghosts.push({
                mesh: g,
                delay: (i + 1) * 0.045,
                peakOpacity: 0.55 - i * 0.10,
            });
        }

        // ══════════════════════════════════════════════════════════
        //  DASH WIND — helix spiral drill around the knight
        // ══════════════════════════════════════════════════════════
        const dashGroup = new THREE.Group();
        wikiEffectRoot.add(dashGroup);

        const DRILL_LEN = 1.6;
        const DRILL_RADIUS = 0.45;
        const HELIX_TURNS = 2.5;
        const STRANDS = 3;
        const PER_STRAND = 20;

        const helixParticles = [];
        for (let s = 0; s < STRANDS; s++) {
            const strandOffset = (s / STRANDS) * Math.PI * 2;
            for (let i = 0; i < PER_STRAND; i++) {
                const tt = i / (PER_STRAND - 1);
                const geo = new THREE.SphereGeometry(0.026 + Math.random() * 0.02, 5, 5);
                const mat = new THREE.MeshBasicMaterial({
                    color: 0xb8ecff, transparent: true, opacity: 0,
                    depthWrite: false, blending: THREE.AdditiveBlending,
                });
                const p = new THREE.Mesh(geo, mat);
                p.userData = {
                    strandOffset,
                    localY: -DRILL_LEN / 2 + tt * DRILL_LEN,
                    radiusAtT: DRILL_RADIUS * (1 - tt * 0.7),
                };
                dashGroup.add(p);
                helixParticles.push(p);
            }
        }

        // Bright nose spark at the drill's tip
        const noseMat = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const nose = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), noseMat);
        nose.position.y = DRILL_LEN / 2;
        dashGroup.add(nose);

        // ══════════════════════════════════════════════════════════
        //  IMPACT SHOCKWAVE — 3 expanding rings + white flash
        // ══════════════════════════════════════════════════════════
        const shockRings = [];
        for (let i = 0; i < 3; i++) {
            const mat = new THREE.MeshBasicMaterial({
                color: [0xffffff, 0xb8ecff, 0xe8c547][i],
                transparent: true, opacity: 0,
                depthWrite: false, side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            });
            const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.34, 48), mat);
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(LAND.x, 0.05 + i * 0.006, LAND.z);
            wikiEffectRoot.add(ring);
            shockRings.push({ mesh: ring, mat, delay: i * 0.06 });
        }

        const flashMat = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const flash = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 14), flashMat);
        flash.position.set(LAND.x, 0.35, LAND.z);
        wikiEffectRoot.add(flash);

        // ══════════════════════════════════════════════════════════
        //  DUST BURST — warm sparks kicked up from the landing
        // ══════════════════════════════════════════════════════════
        const dust = [];
        for (let i = 0; i < 26; i++) {
            const geo = new THREE.SphereGeometry(0.028 + Math.random() * 0.03, 4, 4);
            const mat = new THREE.MeshBasicMaterial({
                color: 0xd4b896, transparent: true, opacity: 0,
                depthWrite: false, blending: THREE.AdditiveBlending,
            });
            const p = new THREE.Mesh(geo, mat);
            p.position.set(LAND.x, 0.05, LAND.z);
            const a = Math.random() * Math.PI * 2;
            const speed = 1.0 + Math.random() * 1.8;
            const maxLife = 0.7 + Math.random() * 0.4;
            p.userData = {
                vel: new THREE.Vector3(
                    Math.cos(a) * speed,
                    0.7 + Math.random() * 1.3,
                    Math.sin(a) * speed
                ),
                life: maxLife,
                maxLife,
            };
            wikiEffectRoot.add(p);
            dust.push(p);
        }

        // ══════════════════════════════════════════════════════════
        //  KNOCKBACK TRAIL — hot sparks following the victim
        // ══════════════════════════════════════════════════════════
        const knockTrail = [];
        for (let i = 0; i < 18; i++) {
            const geo = new THREE.SphereGeometry(0.028 + Math.random() * 0.025, 5, 5);
            const mat = new THREE.MeshBasicMaterial({
                color: Math.random() < 0.5 ? 0xff6644 : 0xffcc44,
                transparent: true, opacity: 0,
                depthWrite: false, blending: THREE.AdditiveBlending,
            });
            const p = new THREE.Mesh(geo, mat);
            p.position.copy(VIC_A);
            p.position.y = 0.2;
            p.visible = false;
            p.userData = {
                delay: i * 0.030,
                life: 0.5,
                drift: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.4,
                    (Math.random() - 0.5) * 0.3,
                    (Math.random() - 0.5) * 0.4
                ),
            };
            wikiEffectRoot.add(p);
            knockTrail.push(p);
        }

        // ══════════════════════════════════════════════════════════
        //  ANIMATION LOOP
        // ══════════════════════════════════════════════════════════
        const startTime = performance.now();

        const animate = () => {
            const t = (performance.now() - startTime) / 1000;
            if (t > T_TOTAL) return;

            // ──────────────────────────────────────────────
            //  PHASE 1 — CHARGE
            // ──────────────────────────────────────────────
            if (t < T_CHARGE) {
                const k = t / T_CHARGE;
                const pulse = 0.7 + 0.3 * Math.sin(t * 24);

                // Knight "breathing" — subtle scale pulse
                knight.scale.setScalar(1 + 0.05 * (k * pulse));

                // Charge ring at feet
                chargeRingMat.opacity = k * 0.75 * (0.6 + 0.4 * Math.sin(t * 12));
                chargeRing.scale.setScalar(1 + Math.sin(t * 8) * 0.15);

                // Landing zone pulses in
                for (const lr of landRings) {
                    lr.mat.opacity = k * 0.75 * (0.7 + 0.3 * Math.sin(t * 9 + lr.phase));
                    const s = 1 + Math.sin(t * 7 + lr.phase) * 0.08;
                    lr.mesh.scale.set(s, s, 1);
                }
                landDiscMat.opacity = k * 0.22;

                // Spiral charge particles converge
                for (const p of chargeParticles) {
                    const pt = t - p.userData.delay;
                    if (pt < 0) { p.material.opacity = 0; continue; }
                    const lk = Math.min(1, pt / 0.65);
                    const a = p.userData.startAngle + pt * p.userData.spinSpeed;
                    const r = p.userData.startRadius * (1 - lk) * (1 - lk * 0.3);
                    const y = p.userData.startY * (1 - lk) + 0.16 * lk;
                    p.position.set(
                        START.x + Math.cos(a) * r,
                        y,
                        START.z + Math.sin(a) * r
                    );
                    p.material.opacity = (1 - lk) * 0.95;
                    p.scale.setScalar(1 - lk * 0.5);
                }
            }
            // ──────────────────────────────────────────────
            //  PHASE 2 — DASH
            // ──────────────────────────────────────────────
            else if (t < T_DASH) {
                const k = (t - T_CHARGE) / (T_DASH - T_CHARGE);
                const ease = 1 - Math.pow(1 - k, 3);   // ease-out

                knight.scale.setScalar(1);
                knight.position.lerpVectors(START, LAND, ease);
                knight.position.y = Math.sin(k * Math.PI) * 0.75;

                // Charge particles die quickly
                for (const p of chargeParticles) p.material.opacity *= 0.82;

                // Charge ring fades
                chargeRingMat.opacity *= 0.85;

                // Landing rings pulse harder
                for (const lr of landRings) {
                    lr.mat.opacity = 0.85 * (0.7 + 0.3 * Math.sin(t * 18 + lr.phase));
                }
                landDiscMat.opacity = 0.30;

                // Ghost afterimages follow with delay
                for (const gh of ghosts) {
                    const gt = k - gh.delay;
                    if (gt <= 0 || gt >= 1) {
                        gh.mesh.traverse(n => {
                            if (n.isMesh && n.material) n.material.opacity = 0;
                        });
                        continue;
                    }
                    const ge = 1 - Math.pow(1 - gt, 3);
                    gh.mesh.position.lerpVectors(START, LAND, ge);
                    gh.mesh.position.y = Math.sin(gt * Math.PI) * 0.75;
                    const fade = Math.sin(Math.PI * gt);
                    gh.mesh.traverse(n => {
                        if (n.isMesh && n.material) {
                            n.material.opacity = fade * gh.peakOpacity;
                        }
                    });
                }

                // Helix drill wind follows the knight
                dashGroup.position.copy(knight.position);
                dashGroup.position.y = 0.6;
                dashGroup.quaternion.copy(dashQuat);

                const spin = t * 26;
                const windAmp = Math.sin(k * Math.PI);   // 0 → 1 → 0
                for (const p of helixParticles) {
                    const angle = p.userData.strandOffset + spin;
                    const r = p.userData.radiusAtT;
                    p.position.set(
                        Math.cos(angle) * r,
                        p.userData.localY,
                        Math.sin(angle) * r
                    );
                    p.material.opacity = windAmp * 0.95;
                }
                noseMat.opacity = windAmp * 0.95;
                nose.scale.setScalar(0.8 + 0.5 * windAmp);
            }
            // ──────────────────────────────────────────────
            //  PHASE 3 — IMPACT + KNOCKBACK
            // ──────────────────────────────────────────────
            else if (t < T_PUSH) {
                knight.position.copy(LAND);
                knight.position.y = 0;

                const it = t - T_DASH;
                const ip = Math.min(1, it / 0.45);

                // Shockwave rings expand
                for (const sr of shockRings) {
                    const st = Math.max(0, (it - sr.delay) / 0.5);
                    if (st >= 1) { sr.mat.opacity = 0; continue; }
                    sr.mat.opacity = 0.9 * (1 - st);
                    const s = 1 + st * 4.5;
                    sr.mesh.scale.set(s, s, 1);
                }

                // White flash pop
                flashMat.opacity = Math.max(0, 1 - ip * 2.2);
                flash.scale.setScalar(1 + ip * 3.5);

                // Dust burst
                for (const d of dust) {
                    if (d.userData.life <= 0) { d.material.opacity = 0; continue; }
                    d.userData.life -= 0.016;
                    d.position.addScaledVector(d.userData.vel, 0.016);
                    d.userData.vel.y -= 0.10;
                    d.userData.vel.multiplyScalar(0.94);
                    d.material.opacity =
                        Math.max(0, d.userData.life / d.userData.maxLife) * 0.9;
                }

                // Landing rings / disc fade out
                for (const lr of landRings) lr.mat.opacity *= 0.88;
                landDiscMat.opacity *= 0.85;

                // Helix, ghosts, charge all fade
                for (const p of helixParticles) p.material.opacity *= 0.82;
                noseMat.opacity *= 0.82;
                for (const gh of ghosts) {
                    gh.mesh.traverse(n => {
                        if (n.isMesh && n.material) n.material.opacity *= 0.88;
                    });
                }
                for (const p of chargeParticles) p.material.opacity *= 0.85;

                // Push victim along the knockback path
                const pushK = Math.min(1, it / 0.7);
                const pe = pushK * pushK;
                victim.position.lerpVectors(VIC_A, VIC_B, pe);
                victim.position.y = Math.sin(pushK * Math.PI) * 0.2;
                victim.rotation.y = pushK * Math.PI * 1.4;
                victim.rotation.z = Math.sin(pushK * Math.PI * 2) * 0.25;

                // Knockback trail follows the victim
                for (const kt of knockTrail) {
                    const ktt = it - kt.userData.delay;
                    if (ktt < 0 || ktt > kt.userData.life) {
                        kt.visible = false;
                        continue;
                    }
                    kt.visible = true;
                    const targetPos = victim.position.clone().add(kt.userData.drift);
                    kt.position.lerp(targetPos, 0.4);
                    kt.material.opacity = (1 - ktt / kt.userData.life) * 0.9;
                    kt.scale.setScalar(1 - ktt / kt.userData.life * 0.4);
                }
            }
            // ──────────────────────────────────────────────
            //  PHASE 4 — AFTERMATH (fade everything out)
            // ──────────────────────────────────────────────
            else {
                // Victim settles from the tumble
                victim.rotation.y *= 0.92;
                victim.rotation.z *= 0.92;
                victim.position.y *= 0.88;

                // Global fade-out
                for (const sr of shockRings) sr.mat.opacity *= 0.85;
                flashMat.opacity *= 0.80;
                for (const d of dust) d.material.opacity *= 0.90;
                for (const kt of knockTrail) {
                    if (kt.visible) kt.material.opacity *= 0.88;
                }
                for (const gh of ghosts) {
                    gh.mesh.traverse(n => {
                        if (n.isMesh && n.material) n.material.opacity *= 0.85;
                    });
                }
                for (const p of helixParticles) p.material.opacity *= 0.85;
                noseMat.opacity *= 0.85;
                for (const lr of landRings) lr.mat.opacity *= 0.85;
                landDiscMat.opacity *= 0.90;
                chargeRingMat.opacity *= 0.85;
            }

            requestAnimationFrame(animate);
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

// ── King effect — full Domain Expansion cinematic (matches main.js) ──
//    Cycles between the WHITE-KING (radiant) and BLACK-KING (abyssal)
//    domain so both themes are visible in the encyclopedia.
function setupKingEffect() {
    const CYCLE = 6800;
    let phase = 0;                       // 0 = white king, 1 = black king

    wikiLoop(CYCLE, () => {
        clearEffectScene();
        wikiEffectRoot.add(makeWikiGround());

        const isWhiteDomain = (phase === 0);
        phase = 1 - phase;

        playDomainExpansionDemo(isWhiteDomain);
        updateDomainThemeLabel(isWhiteDomain);
    });
}

// Small on-canvas label that switches between 「光輝領域」 and 「漆黑領域」
function updateDomainThemeLabel(isWhiteDomain) {
    const container = document.getElementById('wikiEffect');
    if (!container) return;
    let label = container.querySelector('.wiki-effect-label');
    if (!label) {
        label = document.createElement('div');
        label.className = 'wiki-effect-label';
        container.appendChild(label);
    }
    label.textContent = isWhiteDomain ? '⚪ 光輝領域 (白王)' : '⚫ 漆黑領域 (黑王)';
    label.style.color = isWhiteDomain ? '#ffe27a' : '#c44dff';
    label.style.borderColor = isWhiteDomain ? 'rgba(255,226,122,0.6)' : 'rgba(196,77,255,0.6)';
    label.style.animation = 'none';
    void label.offsetWidth;
    label.style.animation = 'wikiEffectLabelPop 0.5s ease-out';
}

// Full domain-expansion cinematic, scaled to fit the wiki preview canvas.
function playDomainExpansionDemo(isWhiteDomain) {
    // ══════════════════════════════════════════════════════════
    //  THEME — same palette pair as main.js
    // ══════════════════════════════════════════════════════════
    const THEME = isWhiteDomain ? {
        DISC: 0xc8bca0, WAVE: 0xd4c9a8, RIM: 0x9a7a2a, HAZE: 0xb09a58,
        WAVE2: 0x4a7a9c,
        BLADE_BODY: 0xc0b8a0, BLADE_SEAM: 0x8a6a20,
        BLADE_AURA: 0xa88830, BLADE_CORE: 0xb0a078,
        RUNE_A: 0xa88830, RUNE_B: 0x8a6a20,
        CHARGE_A: 0xa88830, CHARGE_B: 0xb0a078,
        PILLAR_BODY: 0x8a8680, PILLAR_RIM: 0x8a6a20,
        DOME_OUTER: 0xa89e8c, DOME_INNER: 0x9a7a2a, DOME_RIM: 0x8a6a20,
        LIGHTNING: 0xb0a078,
        SHARD_A: 0xb0a078, SHARD_B: 0x8a6a20,
        FLASH: 0xc9a44a,
        TINT: new THREE.Color(0xb0a078),
    } : {
        DISC: 0x000000, WAVE: 0x000000, RIM: 0x9b4ddb, HAZE: 0x6a2a9a,
        WAVE2: 0xc44dff,
        BLADE_BODY: 0x000000, BLADE_SEAM: 0x8b0033,
        BLADE_AURA: 0xff1e4a, BLADE_CORE: 0xff5577,
        RUNE_A: 0x9b4ddb, RUNE_B: 0xc44dff,
        CHARGE_A: 0xc44dff, CHARGE_B: 0x9b4ddb,
        PILLAR_BODY: 0x0a0a14, PILLAR_RIM: 0xc44dff,
        DOME_OUTER: 0x05000a, DOME_INNER: 0x6a2a9a, DOME_RIM: 0x9b4ddb,
        LIGHTNING: 0xc44dff,
        SHARD_A: 0x000000, SHARD_B: 0xc44dff,
        FLASH: 0xffffff,
        TINT: new THREE.Color(0x000000),
    };

    // ══════════════════════════════════════════════════════════
    //  PIECES — the king plus a spread of pieces to be tinted
    // ══════════════════════════════════════════════════════════
    const kingColor = isWhiteDomain ? 'white' : 'black';
    const enemyColor = isWhiteDomain ? 'black' : 'white';

    const king = createPieceModel('king', kingColor, 100, 100, PIECE_PARAMS.king || {});
    king.position.set(0, 0, 0);
    wikiEffectRoot.add(king);

    // A ring of enemy pieces around the king → they'll get swallowed by the wave
    const tintTargets = [];
    const PIECE_SLOTS = [
        [-1.2, 1.2, 'rook'], [1.2, 1.2, 'pawn'],
        [-1.2, -1.2, 'pawn'], [1.2, -1.2, 'knight'],
        [0.0, 1.6, 'pawn'], [1.6, 0.0, 'pawn'],
        [-1.6, 0.0, 'pawn'], [0.0, -1.6, 'pawn'],
    ];
    for (const [x, z, type] of PIECE_SLOTS) {
        const p = createPieceModel(type, enemyColor, 100, 100, PIECE_PARAMS[type] || {});
        p.position.set(x, 0, z);
        wikiEffectRoot.add(p);

        const mats = [];
        p.traverse(n => {
            if (n.isMesh && n.material && n.material.color) {
                n.material = n.material.clone();
                mats.push({
                    mesh: n,
                    color: n.material.color.clone(),
                    emissive: n.material.emissive ? n.material.emissive.clone() : null,
                });
            }
        });
        tintTargets.push({ obj: p, dist: Math.hypot(x, z), mats, tint: 0, opacity: 1 });
    }

    // ══════════════════════════════════════════════════════════
    //  TIMELINE
    // ══════════════════════════════════════════════════════════
    const startT = performance.now();
    const CHARGE_END = 750;
    const EXPAND_END = 4600;
    const TOTAL = 6600;
    const MAX_R = 2.25;
    const SHATTER_AT = 0.82;   // fraction of expand phase

    // ══════════════════════════════════════════════════════════
    //  LAYER 1 — Ground disc (fill under the wave)
    // ══════════════════════════════════════════════════════════
    const discMat = new THREE.MeshBasicMaterial({
        color: THEME.DISC, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 96), discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.04;
    disc.scale.set(0.001, 0.001, 1);
    disc.renderOrder = 5;
    wikiEffectRoot.add(disc);

    // ══════════════════════════════════════════════════════════
    //  LAYER 2 — Main wavefront ring
    // ══════════════════════════════════════════════════════════
    const ringMat = new THREE.MeshBasicMaterial({
        color: THEME.WAVE, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 96), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    ring.scale.set(0.001, 0.001, 1);
    ring.renderOrder = 10;
    wikiEffectRoot.add(ring);

    // ══════════════════════════════════════════════════════════
    //  LAYER 3 — Colored rim on the wavefront edge
    // ══════════════════════════════════════════════════════════
    const rimMat = new THREE.MeshBasicMaterial({
        color: THEME.RIM, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const rim = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.06, 96), rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.075;
    rim.scale.set(0.001, 0.001, 1);
    rim.renderOrder = 11;
    wikiEffectRoot.add(rim);

    // ══════════════════════════════════════════════════════════
    //  LAYER 4 — Outer haze
    // ══════════════════════════════════════════════════════════
    const hazeMat = new THREE.MeshBasicMaterial({
        color: THEME.HAZE, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const haze = new THREE.Mesh(new THREE.RingGeometry(0.55, 1.45, 96), hazeMat);
    haze.rotation.x = -Math.PI / 2;
    haze.position.y = 0.055;
    haze.scale.set(0.001, 0.001, 1);
    haze.renderOrder = 9;
    wikiEffectRoot.add(haze);

    // ══════════════════════════════════════════════════════════
    //  LAYER 5 — Secondary wavefront (lags the main ring)
    // ══════════════════════════════════════════════════════════
    const ring2Mat = new THREE.MeshBasicMaterial({
        color: THEME.WAVE2, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.15, 96), ring2Mat);
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.y = 0.06;
    ring2.scale.set(0.001, 0.001, 1);
    ring2.renderOrder = 9.5;
    wikiEffectRoot.add(ring2);

    // ══════════════════════════════════════════════════════════
    //  LAYER 6 — Scattered upside-down swords (radial)
    //            tip buried in the ground, random orientation
    // ══════════════════════════════════════════════════════════
    const scatteredSwords = [];
    const SCATTER_COUNT = 14;

    for (let i = 0; i < SCATTER_COUNT; i++) {
        const a = Math.random() * Math.PI * 2;
        const dist = 0.55 + Math.random() * 1.55;
        const px = Math.cos(a) * dist;
        const pz = Math.sin(a) * dist;

        const g = new THREE.Group();
        g.position.set(px, 0, pz);
        g.rotation.y = Math.random() * Math.PI * 2;
        g.rotation.z = (Math.random() - 0.5) * 0.55;
        g.rotation.x = (Math.random() - 0.5) * 0.55;
        const scl = 0.55 + Math.random() * 0.45;
        g.userData.baseScale = scl;
        g.scale.setScalar(0.001);

        const bodyMat = new THREE.MeshBasicMaterial({
            color: THEME.BLADE_BODY, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
        });
        const seamMat = new THREE.MeshBasicMaterial({
            color: THEME.BLADE_SEAM, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        const auraMat = new THREE.MeshBasicMaterial({
            color: THEME.BLADE_AURA, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
        });
        const coreMat = new THREE.MeshBasicMaterial({
            color: THEME.BLADE_CORE, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });

        const BH = 0.62, BW = 0.07, BD = 0.032, GY = 0.14;

        // Blade body (points down)
        const blade = new THREE.Mesh(new THREE.BoxGeometry(BW, BH, BD), bodyMat);
        blade.position.y = GY - BH / 2;
        g.add(blade);

        // Flipped tip cone
        const tip = new THREE.Mesh(new THREE.ConeGeometry(BW * 0.65, 0.16, 4), bodyMat);
        tip.position.y = GY - BH - 0.08;
        tip.rotation.y = Math.PI / 4;
        tip.rotation.z = Math.PI;
        g.add(tip);

        // Cross-guard
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.045, 0.06), bodyMat);
        guard.position.y = GY;
        g.add(guard);

        // Grip
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.18, 8), bodyMat);
        grip.position.y = GY + 0.09;
        g.add(grip);

        // Pommel
        const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 8), bodyMat);
        pommel.position.y = GY + 0.19;
        g.add(pommel);

        // Glow seam
        const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.30), seamMat);
        seam.position.set(0, GY - 0.17, BD / 2 + 0.002);
        g.add(seam);

        // Outer aura
        const aura = new THREE.Mesh(new THREE.BoxGeometry(BW * 2.8, BH * 1.05, BD * 2.8), auraMat);
        aura.position.y = GY - BH / 2;
        aura.renderOrder = 998;
        g.add(aura);

        // Inner core glow
        const core = new THREE.Mesh(new THREE.BoxGeometry(BW * 1.7, BH * 0.9, BD * 1.7), coreMat);
        core.position.y = GY - BH / 2;
        core.renderOrder = 999;
        g.add(core);

        wikiEffectRoot.add(g);
        scatteredSwords.push({
            group: g, bodyMat, seamMat, auraMat, coreMat,
            spawnDelay: Math.random() * 0.55,
            index: i,
        });
    }

    // ══════════════════════════════════════════════════════════
    //  LAYER 7 — Pillar swords stabbed in a ring
    // ══════════════════════════════════════════════════════════
    const pillars = [];
    const PILLAR_COUNT = 14;
    const SWORD_BLADE_W = 0.075;
    const SWORD_BLADE_D = 0.024;
    const SWORD_BLADE_H = 0.95;

    for (let i = 0; i < PILLAR_COUNT; i++) {
        const angle = (i / PILLAR_COUNT) * Math.PI * 2;

        const g = new THREE.Group();

        const darkMat = new THREE.MeshBasicMaterial({
            color: THEME.PILLAR_BODY, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
        });
        const pRimMat = new THREE.MeshBasicMaterial({
            color: THEME.PILLAR_RIM, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });

        // Pommel (bottom of hilt)
        {
            const pommelMesh = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 8), darkMat);
            pommelMesh.position.set(0, 0.042, 0);
            g.add(pommelMesh);
        }
        // Grip
        {
            const gripMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.26, 8), darkMat);
            gripMesh.position.set(0, 0.17, 0);
            g.add(gripMesh);
        }
        // Cross-guard
        {
            const guardMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.045, 0.06), darkMat);
            guardMesh.position.set(0, 0.33, 0);
            g.add(guardMesh);
        }
        // Blade
        {
            const bladeMesh = new THREE.Mesh(
                new THREE.BoxGeometry(SWORD_BLADE_W, SWORD_BLADE_H, SWORD_BLADE_D),
                darkMat
            );
            bladeMesh.position.set(0, 0.35 + SWORD_BLADE_H / 2, 0);
            g.add(bladeMesh);
        }

        // Tip (4-sided)
        const tipMesh = new THREE.Mesh(new THREE.ConeGeometry(SWORD_BLADE_W * 0.7, 0.16, 4), darkMat);
        tipMesh.position.y = 0.35 + SWORD_BLADE_H + 0.08;
        tipMesh.rotation.y = Math.PI / 4;
        g.add(tipMesh);
        // Blade-edge rim
        const rimGeo = new THREE.PlaneGeometry(0.016, SWORD_BLADE_H);
        for (const sgn of [-1, 1]) {
            const r = new THREE.Mesh(rimGeo, pRimMat);
            r.position.set(sgn * (SWORD_BLADE_W * 0.5 + 0.001), 0.35 + SWORD_BLADE_H / 2, 0);
            g.add(r);
        }

        // Broad face outward
        g.position.set(1, 0, 0);
        g.rotation.y = Math.PI / 2 - angle;
        g.rotation.z = (Math.random() - 0.5) * 0.10;
        g.scale.set(1, 0.001, 1);

        wikiEffectRoot.add(g);
        pillars.push({ group: g, darkMat, rimMat: pRimMat, angle });
    }

    // ══════════════════════════════════════════════════════════
    //  LAYER 8 — Shadow dome (outer shell + inner glow + rim)
    // ══════════════════════════════════════════════════════════
    const domeGeo = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshBasicMaterial({
        color: THEME.DOME_OUTER, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.y = 0.02;
    dome.scale.setScalar(0.001);
    dome.renderOrder = 6;
    wikiEffectRoot.add(dome);

    const domeInnerMat = new THREE.MeshBasicMaterial({
        color: THEME.DOME_INNER, transparent: true, opacity: 0,
        side: THREE.BackSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const domeInner = new THREE.Mesh(
        new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2),
        domeInnerMat
    );
    domeInner.position.y = 0.02;
    domeInner.scale.setScalar(0.001);
    domeInner.renderOrder = 7;
    wikiEffectRoot.add(domeInner);

    const domeRimMat = new THREE.MeshBasicMaterial({
        color: THEME.DOME_RIM, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const domeRim = new THREE.Mesh(new THREE.RingGeometry(0.97, 1.04, 72), domeRimMat);
    domeRim.rotation.x = -Math.PI / 2;
    domeRim.position.y = 0.065;
    domeRim.scale.set(0.001, 0.001, 1);
    domeRim.renderOrder = 10;
    wikiEffectRoot.add(domeRim);

    // ══════════════════════════════════════════════════════════
    //  LAYER 9 — Lightning arcs crawling on the dome
    // ══════════════════════════════════════════════════════════
    const lightningBolts = [];
    for (let i = 0; i < 4; i++) {
        const segMat = new THREE.MeshBasicMaterial({
            color: THEME.LIGHTNING, transparent: true, opacity: 0.9,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const seg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.022, 0.022, 1, 5, 1, true),
            segMat
        );
        seg.visible = false;
        wikiEffectRoot.add(seg);
        lightningBolts.push({
            seg, mat: segMat,
            nextJumpAt: 0,
            currentAngle: Math.random() * Math.PI * 2,
            baseR: 1, height: 1,
        });
    }

    // ══════════════════════════════════════════════════════════
    //  LAYER 10 — Flash at the king (brief pop at expand start)
    // ══════════════════════════════════════════════════════════
    const flashMat = new THREE.MeshBasicMaterial({
        color: THEME.FLASH, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 16), flashMat);
    flash.position.set(0, 0.42, 0);
    flash.visible = false;
    wikiEffectRoot.add(flash);

    // ══════════════════════════════════════════════════════════
    //  LAYER 11 — Charge particles spiraling inward
    // ══════════════════════════════════════════════════════════
    const chargeParticles = [];
    for (let i = 0; i < 30; i++) {
        const pg = new THREE.SphereGeometry(0.024 + Math.random() * 0.024, 5, 5);
        const pm = new THREE.MeshBasicMaterial({
            color: Math.random() < 0.5 ? THEME.CHARGE_A : THEME.CHARGE_B,
            transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const p = new THREE.Mesh(pg, pm);
        const a = Math.random() * Math.PI * 2;
        const r = 2.4 + Math.random() * 1.6;
        const y0 = 0.10 + Math.random() * 1.2;
        p.position.set(Math.cos(a) * r, y0, Math.sin(a) * r);
        p.userData = {
            startR: r, startAngle: a, startY: y0,
            duration: 0.5 + Math.random() * 0.25,
            delay: Math.random() * 0.22,
            orbit: (Math.random() - 0.5) * 0.8,
        };
        wikiEffectRoot.add(p);
        chargeParticles.push(p);
    }

    // ══════════════════════════════════════════════════════════
    //  LAYER 12 — Rune circle under the king
    // ══════════════════════════════════════════════════════════
    const runeGroup = new THREE.Group();
    runeGroup.position.y = 0.055;
    wikiEffectRoot.add(runeGroup);

    const runeMat1 = new THREE.MeshBasicMaterial({
        color: THEME.RUNE_A, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const runeRing1 = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.43, 48), runeMat1);
    runeRing1.rotation.x = -Math.PI / 2;
    runeGroup.add(runeRing1);

    const runeMat2 = new THREE.MeshBasicMaterial({
        color: THEME.RUNE_B, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const runeRing2 = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.68, 48), runeMat2);
    runeRing2.rotation.x = -Math.PI / 2;
    runeRing2.position.y = 0.001;
    runeGroup.add(runeRing2);

    const runeTicks = [];
    for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const tm = new THREE.MeshBasicMaterial({
            color: THEME.RUNE_B, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.024), tm);
        tick.position.set(Math.cos(a) * 0.53, 0.001, Math.sin(a) * 0.53);
        tick.rotation.x = -Math.PI / 2;
        tick.rotation.z = -a;
        runeGroup.add(tick);
        runeTicks.push({ mesh: tick, mat: tm });
    }

    // ══════════════════════════════════════════════════════════
    //  LAYER 13 — Shatter shards (peak burst)
    // ══════════════════════════════════════════════════════════
    const shards = [];
    for (let i = 0; i < 22; i++) {
        const sg = new THREE.TetrahedronGeometry(0.07 + Math.random() * 0.08, 0);
        const sm = new THREE.MeshBasicMaterial({
            color: Math.random() < 0.5 ? THEME.SHARD_A : THEME.SHARD_B,
            transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const shard = new THREE.Mesh(sg, sm);
        shard.visible = false;
        shard.renderOrder = 25;
        wikiEffectRoot.add(shard);
        const a = Math.random() * Math.PI * 2;
        shards.push({
            mesh: shard,
            dirX: Math.cos(a), dirZ: Math.sin(a),
            upSpeed: 1.3 + Math.random() * 1.6,
            spin: (Math.random() - 0.5) * 8,
            bornAt: 0,
        });
    }

    let shatterFired = false;

    // ══════════════════════════════════════════════════════════
    //  ANIMATION LOOP
    // ══════════════════════════════════════════════════════════
    const animate = () => {
        const t = performance.now() - startT;
        if (t >= TOTAL) return;

        // ─── CHARGE PHASE ──────────────────────────────────
        if (t < CHARGE_END) {
            const k = t / CHARGE_END;
            const ease = 1 - Math.pow(1 - k, 3);

            runeMat1.opacity = 0.75 * ease;
            runeMat2.opacity = 0.55 * ease;
            for (const tk of runeTicks) tk.mat.opacity = 0.85 * ease;
            runeGroup.rotation.y += 0.05;

            for (const p of chargeParticles) {
                const pt = t - p.userData.delay * 1000;
                if (pt < 0) { p.material.opacity = 0; continue; }
                const lk = Math.min(1, pt / (p.userData.duration * 1000));
                const a = p.userData.startAngle + lk * 3.0 * p.userData.orbit * Math.PI;
                const r = p.userData.startR * (1 - lk) * (1 - lk * 0.4);
                const y = p.userData.startY * (1 - lk) + 0.4 * lk;
                p.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
                p.material.opacity = 0.95 * (1 - Math.pow(lk, 3));
                p.scale.setScalar(1 - lk * 0.5);
            }

            disc.scale.set(0.4, 0.4, 1);
            discMat.opacity = 0.15 * ease;
        }
        // ─── EXPAND PHASE ──────────────────────────────────
        else {
            const expT = t - CHARGE_END;
            const expDur = EXPAND_END - CHARGE_END;
            const tRaw = Math.min(expT / expDur, 1);
            const ease = 1 - Math.pow(1 - tRaw, 2);
            const radius = MAX_R * ease;

            // Rune fades as the wave grows
            const runeFade = Math.max(0, 1 - tRaw * 2.0);
            runeMat1.opacity = 0.75 * runeFade;
            runeMat2.opacity = 0.55 * runeFade;
            for (const tk of runeTicks) tk.mat.opacity = 0.85 * runeFade;
            runeGroup.rotation.y += 0.05;

            // Charge particles burn off
            for (const p of chargeParticles) {
                if (p.material.opacity > 0) {
                    p.material.opacity = Math.max(0, p.material.opacity - 0.05);
                }
            }

            // Disc
            disc.scale.set(Math.max(0.001, radius), Math.max(0.001, radius), 1);
            discMat.opacity = 0.78 * Math.min(1, tRaw * 1.6);

            // Main ring
            ring.scale.set(Math.max(0.001, radius), Math.max(0.001, radius), 1);
            const ringPulse = 0.85 + 0.15 * Math.sin(t / 80);
            ringMat.opacity = 0.98 * (1 - tRaw * 0.2) * ringPulse;

            // Rim
            rim.scale.set(Math.max(0.001, radius), Math.max(0.001, radius), 1);
            rimMat.opacity = 0.85 * Math.sin(Math.PI * Math.min(tRaw * 1.1, 1));

            // Haze
            haze.scale.set(Math.max(0.001, radius), Math.max(0.001, radius), 1);
            hazeMat.opacity = 0.40 * (1 - tRaw * 0.35);

            // Secondary wavefront
            const tRaw2 = Math.max(0, (expT - 420) / (expDur - 420));
            const r2 = MAX_R * (1 - Math.pow(1 - Math.min(tRaw2, 1), 3.5));
            ring2.scale.set(Math.max(0.001, r2), Math.max(0.001, r2), 1);
            ring2Mat.opacity = 0.55 * (1 - tRaw * 0.8);

            // Pillar swords ride the ring
            for (const p of pillars) {
                const px = Math.cos(p.angle) * radius;
                const pz = Math.sin(p.angle) * radius;
                p.group.position.set(px, 0, pz);

                const pillarFade = Math.max(0, 1 - tRaw * 1.1);
                p.darkMat.opacity = 0.95 * pillarFade;
                p.rimMat.opacity = 0.90 * pillarFade;
                p.group.scale.set(1, 0.5 + tRaw * 0.9, 1);
            }

            // Scattered swords stab in
            for (const c of scatteredSwords) {
                const growT = Math.max(0, Math.min(1,
                    (expT / 1000 - c.spawnDelay) / 0.25));
                const holdFade = Math.max(0, 1 - tRaw * 0.9);
                const alpha = growT * holdFade;

                const base = c.group.userData.baseScale || 1;
                c.group.scale.setScalar(base * (0.3 + 0.7 * growT));

                c.bodyMat.opacity = 0.95 * alpha;
                c.seamMat.opacity = 0.90 * alpha * (0.7 + 0.3 * Math.sin(t / 70 + c.index));
                c.auraMat.opacity = 0.85 * alpha * (0.7 + 0.3 * Math.sin(t / 120 + c.index * 1.3));
                c.coreMat.opacity = 0.95 * alpha * (0.72 + 0.28 * Math.sin(t / 55 + c.index * 0.7));
            }

            // Shadow dome
            const domeR = Math.max(0.001, radius);
            dome.scale.setScalar(domeR);
            domeMat.opacity = 0.45 * Math.min(1, tRaw * 1.5) * (1 - tRaw * 0.12);

            domeInner.scale.setScalar(domeR * 1.01);
            domeInnerMat.opacity = 0.24 * Math.min(1, tRaw * 1.8);

            domeRim.scale.set(domeR, domeR, 1);
            domeRimMat.opacity = 0.75 * Math.min(1, tRaw * 1.4) * (1 - tRaw * 0.25);

            // Lightning arcs
            for (const b of lightningBolts) {
                if (t >= b.nextJumpAt) {
                    b.nextJumpAt = t + 80 + Math.random() * 180;
                    b.currentAngle = Math.random() * Math.PI * 2;
                    b.baseR = domeR * (0.85 + Math.random() * 0.15);
                    b.height = domeR * (0.6 + Math.random() * 0.35);
                }
                if (tRaw < 0.15 || tRaw > 0.95) {
                    b.seg.visible = false;
                    continue;
                }
                b.seg.visible = true;
                const bx = Math.cos(b.currentAngle) * b.baseR;
                const bz = Math.sin(b.currentAngle) * b.baseR;
                const by = 0.10;
                const tx = Math.cos(b.currentAngle + 0.2) * b.baseR * 0.6;
                const tz = Math.sin(b.currentAngle + 0.2) * b.baseR * 0.6;
                const ty = by + b.height;

                const dirV = new THREE.Vector3(tx - bx, ty - by, tz - bz);
                const len = dirV.length();
                b.seg.position.set((bx + tx) / 2, (by + ty) / 2, (bz + tz) / 2);
                b.seg.quaternion.setFromUnitVectors(
                    new THREE.Vector3(0, 1, 0),
                    dirV.clone().normalize()
                );
                b.seg.scale.set(1, len, 1);
                b.mat.opacity = 0.9 * Math.min(1, tRaw * 2) * Math.max(0, 1 - tRaw * 0.6);
            }

            // Flash
            if (expT < 400) {
                flash.visible = true;
                const ft = expT / 400;
                flashMat.opacity = 0.95 * (1 - ft);
                flash.scale.setScalar(1 + ft * 3.0);
            } else {
                flash.visible = false;
            }

            // Piece tinting / dissolve as the wave passes over them
            const EDGE = 0.32;
            const MIN_OP = 0.15;
            for (const p of tintTargets) {
                const behind = radius - p.dist;
                let targetTint, targetOpacity;
                if (behind <= 0) { targetTint = 0; targetOpacity = 1; }
                else if (behind < EDGE) {
                    const kk = behind / EDGE;
                    targetTint = kk;
                    targetOpacity = 1 - (1 - MIN_OP) * kk;
                } else { targetTint = 1; targetOpacity = MIN_OP; }

                if (Math.abs(p.tint - targetTint) > 0.005) {
                    p.tint = targetTint;
                    p.opacity = targetOpacity;
                    for (const m of p.mats) {
                        const c1 = m.color.clone();
                        c1.lerp(THEME.TINT, targetTint);
                        m.mesh.material.color.copy(c1);
                        m.mesh.material.opacity = targetOpacity;
                        m.mesh.material.transparent = targetOpacity < 0.99;
                        m.mesh.material.depthWrite = targetOpacity > 0.92;
                        m.mesh.material.needsUpdate = true;
                    }
                }
            }

            // Shatter burst (one-shot)
            if (tRaw >= SHATTER_AT && !shatterFired) {
                shatterFired = true;
                for (const s of shards) {
                    s.mesh.visible = true;
                    s.mesh.material.opacity = 0.9;
                    s.mesh.position.set(0, 0.4, 0);
                    s.bornAt = t;
                }
            }
        }

        // ─── SHARD PHYSICS ─────────────────────────────────
        for (const s of shards) {
            if (!s.mesh.visible) continue;
            const st = (t - s.bornAt) / 1000;
            if (st < 0 || st > 1) { s.mesh.visible = false; continue; }
            const dist = 2.4 * Math.sqrt(st);
            s.mesh.position.x = s.dirX * dist;
            s.mesh.position.z = s.dirZ * dist;
            s.mesh.position.y = 0.4 + s.upSpeed * st - 2.5 * st * st;
            s.mesh.rotation.x += s.spin * 0.02;
            s.mesh.rotation.y += s.spin * 0.03;
            s.mesh.material.opacity = 0.95 * (1 - st);
            s.mesh.scale.setScalar(1 - st * 0.3);
        }

        requestAnimationFrame(animate);
    };
    animate();
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