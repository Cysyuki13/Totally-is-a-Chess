// ============================================================
//  animation.js — All visual effects & cinematics
// ============================================================
//  Everything here used to live inside main.js. It has been
//  moved out so main.js only contains game logic + UI wiring.
//
//  Sections:
//    1.  Selection aura system
//    2.  Floating damage / heal text + Queen speech bubble
//    3.  Cooldown sprite + stun visuals
//    4.  Bishop "Cannon Leap" ground effect
//    5.  Knight visual effects (dash, charge, impact, ghosts)
//    6.  Victim push / bump animations
//    7.  Queen heal + revive effects
//    8.  Cannon / cross-explosion visuals
//    9.  Domain-expansion glow outlines
//   10.  Domain-expansion cinematic
//   11.  Kill themes + kill cinematics
//   12.  VS screen + mini piece renderer
//
//  All functions rely on globals defined in main.js:
//    scene, camera, clock, gameState, pieceObjects, piecesGroup,
//    highlightsGroup, ghostLineGroup, get3DPosition,
//    syncPiecesAfterMove, deselectPiece, updateTurnIndicator,
//    checkGameStatus, switchTimer, stopTimer, updateCameraTargets,
//    showDamageEffect, playerColor, currentMode, peerConnection,
//    isAnimating, aiThinking, battleState, kingSkillState,
//    PIECE_PARAMS, createPieceModel, playSFX, speakQueenLine,
//    getBishopPathPieces, getPushableVictims, QUEEN_REVIVE_ABILITY,
//    KING_DOMAIN_COOLDOWN, findCheckingPieces, openBattleMenu
// ============================================================


/* ═══════════════════════════════════════════════════════════
   1.  SELECTION AURA — animated glow around selected piece
   ═══════════════════════════════════════════════════════════ */
let selectionAuraGroup = null;
let selectionAuraKind = null;
let selectionAuraStart = 0;
let selectionAuraParts = { rings: [], orbs: [], sparks: [] };
let selectionAuraPiece = null;

const AURA_STYLES = {
    pawn: { primary: 0xff6622, secondary: 0xffcc44, style: 'embers' },
    rook: { primary: 0x7ac8ff, secondary: 0xffffff, style: 'rings' },
    knight: { primary: 0xffcc44, secondary: 0xff6622, style: 'streaks' },
    bishop: { primary: 0xc44dff, secondary: 0xff66cc, style: 'orbs' },
    queen: { primary: 0xff69b4, secondary: 0x6dffb0, style: 'dualOrb' },
    king: { primary: 0xd9a6ff, secondary: 0xffe27a, style: 'crown' },
};

function clearSelectionAura() {
    if (selectionAuraGroup) {
        scene.remove(selectionAuraGroup);
        selectionAuraGroup.traverse(n => {
            if (n.geometry) n.geometry.dispose();
            if (n.material) {
                if (Array.isArray(n.material)) n.material.forEach(m => m.dispose());
                else n.material.dispose();
            }
        });
    }
    selectionAuraGroup = null;
    selectionAuraKind = null;
    selectionAuraParts = { rings: [], orbs: [], sparks: [] };
    selectionAuraPiece = null;
}

function createSelectionAura(pieceObj, type) {
    clearSelectionAura();
    if (!pieceObj || !scene) return;

    const style = AURA_STYLES[type] || AURA_STYLES.pawn;
    const group = new THREE.Group();
    group.position.set(pieceObj.position.x, 0, pieceObj.position.z);
    scene.add(group);

    const parts = { rings: [], orbs: [], sparks: [] };
    const c1 = new THREE.Color(style.primary);
    const c2 = new THREE.Color(style.secondary);

    // ── Ground ring (shared by every type) ──
    const ringMat = new THREE.MeshBasicMaterial({
        color: c1, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.5, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    group.add(ring);
    parts.rings.push({ mesh: ring, baseScale: 1, phase: 0, type: 'main' });

    // ══════════════════════════════════════════════════════════
    //  STYLE-SPECIFIC DECORATIONS
    // ══════════════════════════════════════════════════════════

    if (style.style === 'rings') {
        // Rook: rotating hexagonal reticle + vertical torus
        const ringMat2 = new THREE.MeshBasicMaterial({
            color: c2, transparent: true, opacity: 0.7,
            side: THREE.DoubleSide, depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.6, 6), ringMat2);
        ring2.rotation.x = -Math.PI / 2;
        ring2.position.y = 0.062;
        group.add(ring2);
        parts.rings.push({ mesh: ring2, baseScale: 1, phase: Math.PI, rotSpeed: 0.9 });

        const vRingMat = new THREE.MeshBasicMaterial({
            color: c1, transparent: true, opacity: 0.55,
            side: THREE.DoubleSide, depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const vRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 8, 40), vRingMat);
        vRing.position.y = 0.4;
        group.add(vRing);
        parts.rings.push({ mesh: vRing, baseScale: 1, phase: 0, type: 'vertical', rotSpeed: 1.6 });
    }

    if (style.style === 'crown') {
        // King: double ring + crown spikes that bob up/down
        const ringMat2 = new THREE.MeshBasicMaterial({
            color: c2, transparent: true, opacity: 0.7,
            side: THREE.DoubleSide, depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.6, 48), ringMat2);
        ring2.rotation.x = -Math.PI / 2;
        ring2.position.y = 0.062;
        group.add(ring2);
        parts.rings.push({ mesh: ring2, baseScale: 1, phase: Math.PI, rotSpeed: 0.5 });

        const spikeCount = 8;
        for (let i = 0; i < spikeCount; i++) {
            const a = (i / spikeCount) * Math.PI * 2;
            const spikeGeo = new THREE.ConeGeometry(0.045, 0.22, 6);
            const spikeMat = new THREE.MeshBasicMaterial({
                color: c2, transparent: true, opacity: 0.85,
                depthWrite: false, blending: THREE.AdditiveBlending,
            });
            const spike = new THREE.Mesh(spikeGeo, spikeMat);
            spike.position.set(Math.cos(a) * 0.36, 0.14, Math.sin(a) * 0.36);
            spike.userData = { phase: a, baseY: 0.14 };
            group.add(spike);
            parts.orbs.push(spike);
        }
    }

    if (style.style === 'embers' || style.style === 'streaks') {
        // Pawn / Knight: rising spiral sparks
        const isStreak = style.style === 'streaks';
        const count = isStreak ? 18 : 26;
        for (let i = 0; i < count; i++) {
            const sparkGeo = new THREE.SphereGeometry(0.024 + Math.random() * 0.022, 5, 5);
            const sparkMat = new THREE.MeshBasicMaterial({
                color: Math.random() < 0.5 ? c1 : c2,
                transparent: true, opacity: 0.9,
                depthWrite: false, blending: THREE.AdditiveBlending,
            });
            const spark = new THREE.Mesh(sparkGeo, sparkMat);
            const a = Math.random() * Math.PI * 2;
            const r = 0.08 + Math.random() * 0.32;
            spark.position.set(Math.cos(a) * r, 0.05 + Math.random() * 0.5, Math.sin(a) * r);
            spark.userData = {
                baseAngle: a,
                baseRadius: r,
                phase: Math.random() * Math.PI * 2,
                riseSpeed: isStreak ? 1.3 + Math.random() * 1.5 : 0.7 + Math.random() * 0.9,
                spinSpeed: isStreak ? 2.5 + Math.random() * 2.5 : 0.8 + Math.random() * 1.2,
            };
            group.add(spark);
            parts.sparks.push(spark);
        }
    }

    if (style.style === 'orbs' || style.style === 'dualOrb') {
        // Bishop / Queen: orbiting orbs
        const isDual = style.style === 'dualOrb';
        const orbCount = isDual ? 6 : 4;
        for (let i = 0; i < orbCount; i++) {
            const orbGeo = new THREE.SphereGeometry(0.06 + Math.random() * 0.02, 8, 8);
            const orbMat = new THREE.MeshBasicMaterial({
                color: i % 2 === 0 ? c1 : c2,
                transparent: true, opacity: 0.9,
                depthWrite: false, blending: THREE.AdditiveBlending,
            });
            const orb = new THREE.Mesh(orbGeo, orbMat);
            orb.userData = {
                baseAngle: (i / orbCount) * Math.PI * 2,
                radius: isDual ? 0.42 : 0.38,
                yOffset: 0.2 + Math.random() * 0.35,
                speed: isDual ? (i % 2 === 0 ? 1.4 : -1.4) : 1.3,
                bobPhase: Math.random() * Math.PI * 2,
            };
            group.add(orb);
            parts.orbs.push(orb);
        }
        // Queen gets an extra soft ground-glow disc
        if (isDual) {
            const glowMat = new THREE.MeshBasicMaterial({
                color: c2, transparent: true, opacity: 0.35,
                side: THREE.DoubleSide, depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            const glowDisc = new THREE.Mesh(new THREE.CircleGeometry(0.55, 32), glowMat);
            glowDisc.rotation.x = -Math.PI / 2;
            glowDisc.position.y = 0.055;
            group.add(glowDisc);
            parts.rings.push({ mesh: glowDisc, baseScale: 1, phase: 0, type: 'glow' });
        }
    }

    selectionAuraGroup = group;
    selectionAuraKind = style.style;
    selectionAuraStart = clock ? clock.getElapsedTime() : performance.now() / 1000;
    selectionAuraParts = parts;
    selectionAuraPiece = pieceObj;
}

function updateSelectionAura() {
    if (!selectionAuraGroup || !selectionAuraPiece) return;

    // Safety: if the piece was destroyed (re-created by syncPiecesAfterMove),
    // tear the aura down rather than let it hang in the wrong place.
    if (!selectionAuraPiece.parent || selectionAuraPiece.parent !== piecesGroup) {
        clearSelectionAura();
        return;
    }

    // Follow the piece (moves during animation)
    selectionAuraGroup.position.x = selectionAuraPiece.position.x;
    selectionAuraGroup.position.z = selectionAuraPiece.position.z;

    const now = clock ? clock.getElapsedTime() : performance.now() / 1000;
    const t = now - selectionAuraStart;
    const boost = 1.6;

    // ── Rings ──
    for (const r of selectionAuraParts.rings) {
        if (r.type === 'vertical') {
            r.mesh.rotation.y = t * (r.rotSpeed || 1.5);
            r.mesh.rotation.x = Math.sin(t * 0.8) * 0.4;
        } else if (r.type === 'glow') {
            const pulse = 0.5 + 0.5 * Math.sin(t * 3);
            r.mesh.material.opacity = (0.25 + 0.25 * pulse) * boost;
            r.mesh.scale.setScalar(0.9 + 0.2 * pulse);
        } else {
            if (r.rotSpeed !== undefined) r.mesh.rotation.z = t * r.rotSpeed;
            const pulse = 0.5 + 0.5 * Math.sin(t * 4 + r.phase);
            r.mesh.material.opacity = (0.55 + 0.35 * pulse) * boost;
            const s = 1 + 0.08 * pulse;
            r.mesh.scale.set(s, s, 1);
        }
    }

    // ── Rising sparks ──
    for (const s of selectionAuraParts.sparks) {
        const rise = (t * s.userData.riseSpeed + s.userData.phase * 0.4) % 1;
        const y = 0.05 + rise * 0.95;
        const angle = s.userData.baseAngle + t * s.userData.spinSpeed;
        const r = s.userData.baseRadius * (1 + rise * 0.45);
        s.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
        const fade = Math.sin(Math.PI * rise);
        s.material.opacity = fade * 0.95 * boost;
        s.scale.setScalar(0.7 + 0.6 * fade);
    }

    // ── Orbs (orbiting) & Crown spikes (bobbing) ──
    for (const o of selectionAuraParts.orbs) {
        if (o.userData.radius !== undefined) {
            const angle = o.userData.baseAngle + t * o.userData.speed;
            const r = o.userData.radius;
            const y = o.userData.yOffset + Math.sin(t * 2 + o.userData.bobPhase) * 0.08;
            o.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
            const pulse = 0.7 + 0.3 * Math.sin(t * 5 + o.userData.bobPhase);
            o.material.opacity = pulse * 0.9 * boost;
            o.scale.setScalar(0.9 + 0.2 * pulse);
        } else if (o.userData.baseY !== undefined) {
            o.position.y = o.userData.baseY + Math.sin(t * 3 + o.userData.phase * 2) * 0.04;
            const pulse = 0.6 + 0.4 * Math.sin(t * 4 + o.userData.phase * 3);
            o.material.opacity = pulse * 0.85 * boost;
        }
    }
}


/* ═══════════════════════════════════════════════════════════
   2.  FLOATING DAMAGE / HEAL TEXT + QUEEN SPEECH BUBBLE
   ═══════════════════════════════════════════════════════════ */
function showFloatingDamage(row, col, damage) {
    const pos = get3DPosition(row, col, 1.0);
    pos.project(camera);
    const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (pos.y * -0.5 + 0.5) * window.innerHeight;
    const el = document.createElement('div');
    el.textContent = `-${damage}`;
    el.style.position = 'absolute';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.color = '#ff3333';
    el.style.fontWeight = '900';
    el.style.fontSize = '26px';
    el.style.textShadow = '0 0 10px black, 0 0 10px black';
    el.style.transform = 'translate(-50%, -50%)';
    el.style.transition = 'all 1s cubic-bezier(0.25, 1, 0.5, 1)';
    document.getElementById('damageOverlay').appendChild(el);
    setTimeout(() => {
        el.style.transform = 'translate(-50%, -100px) scale(1.5)';
        el.style.opacity = '0';
    }, 50);
    setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
    }, 1050);
}

function showFloatingHeal(row, col, amount) {
    const pos = get3DPosition(row, col, 1.0);
    pos.project(camera);
    const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (pos.y * -0.5 + 0.5) * window.innerHeight;
    const el = document.createElement('div');
    el.textContent = `+${amount}`;
    el.style.position = 'absolute';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.color = '#2ecc71';
    el.style.fontWeight = '900';
    el.style.fontSize = '28px';
    el.style.textShadow = '0 0 10px black, 0 0 10px black, 0 0 18px #2ecc71';
    el.style.transform = 'translate(-50%, -50%)';
    el.style.transition = 'all 1.1s cubic-bezier(0.25, 1, 0.5, 1)';
    document.getElementById('damageOverlay').appendChild(el);
    setTimeout(() => {
        el.style.transform = 'translate(-50%, -110px) scale(1.35)';
        el.style.opacity = '0';
    }, 50);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1150);
}

function showQueenSpeech(row, col, text, duration = 2400) {
    if (!camera || !renderer) return;

    const pos = get3DPosition(row, col, 1.55);
    pos.project(camera);
    const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (pos.y * -0.5 + 0.5) * window.innerHeight;

    const bubble = document.createElement('div');
    bubble.className = 'queen-speech-bubble';
    bubble.textContent = text;
    bubble.style.left = `${x}px`;
    bubble.style.top = `${y}px`;
    document.body.appendChild(bubble);

    speakQueenLine(text);
    requestAnimationFrame(() => bubble.classList.add('visible'));

    let rafId = null;
    const start = performance.now();
    const track = () => {
        if (!bubble.parentNode) return;
        const p = get3DPosition(row, col, 1.55);
        p.project(camera);
        bubble.style.left = ((p.x * 0.5 + 0.5) * window.innerWidth) + 'px';
        bubble.style.top = ((p.y * -0.5 + 0.5) * window.innerHeight) + 'px';
        if (performance.now() - start < duration + 400) {
            rafId = requestAnimationFrame(track);
        }
    };
    rafId = requestAnimationFrame(track);

    setTimeout(() => {
        bubble.classList.remove('visible');
        bubble.classList.add('fading');
        if (rafId) cancelAnimationFrame(rafId);
        setTimeout(() => {
            if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
        }, 420);
    }, duration);
}


/* ═══════════════════════════════════════════════════════════
   3.  COOLDOWN SPRITE + STUN VISUALS
   ═══════════════════════════════════════════════════════════ */
function createCooldownSprite(cooldown, colorHex = 0x7ac8ff) {
    const cssColor = '#' + colorHex.toString(16).padStart(6, '0');
    const canvas = document.createElement('canvas');
    canvas.width = 80; canvas.height = 80;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(10, 20, 40, 0.85)';
    ctx.beginPath();
    ctx.arc(40, 40, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = cssColor;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = cssColor;
    ctx.font = 'bold 42px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(cooldown), 40, 43);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.24, 0.24, 1);
    sprite.position.set(0.32, 0.95, 0);
    sprite.renderOrder = 1000;
    return sprite;
}

function applyCannonStun(piece) {
    if (!piece) return;
    piece.stunned = 1;
    piece.justStunned = true;
}

function createStunSprite() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);

    const glow = ctx.createRadialGradient(64, 64, 6, 64, 64, 58);
    glow.addColorStop(0, 'rgba(174, 241, 255, 0.65)');
    glow.addColorStop(0.5, 'rgba(122, 200, 255, 0.28)');
    glow.addColorStop(1, 'rgba(122, 200, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = '#7ac8ff';
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.moveTo(76, 18);
    ctx.lineTo(46, 62);
    ctx.lineTo(70, 62);
    ctx.lineTo(40, 112);
    ctx.lineTo(54, 72);
    ctx.lineTo(32, 72);
    ctx.lineTo(64, 18);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#7ac8ff';
    ctx.lineJoin = 'round';
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        opacity: 0.98,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.5, 0.5, 1);
    sprite.position.set(0, 1.4, 0);
    sprite.renderOrder = 1002;
    return sprite;
}

let _stunStarTexture = null;
function _getStunStarTexture() {
    if (_stunStarTexture) return _stunStarTexture;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    const cx = 32, cy = 32, outer = 26, inner = 11;
    ctx.shadowColor = '#7ac8ff';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
        const r = k % 2 === 0 ? outer : inner;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#d8f4ff';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#7ac8ff';
    ctx.stroke();
    const t = new THREE.CanvasTexture(canvas);
    t.needsUpdate = true;
    t.anisotropy = 4;
    _stunStarTexture = t;
    return t;
}

function createStunAura() {
    const group = new THREE.Group();

    const groundMat = new THREE.MeshBasicMaterial({
        color: 0x7ac8ff, transparent: true, opacity: 0.28,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const ground = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.46, 40), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.04;
    group.add(ground);

    const dizzyStars = [];
    const STAR_COUNT = 4;
    const STAR_ORBIT_R = 0.30;
    const STAR_ORBIT_Y = 1.85;
    const starTex = _getStunStarTexture();
    for (let i = 0; i < STAR_COUNT; i++) {
        const mat = new THREE.SpriteMaterial({
            map: starTex, transparent: true, opacity: 0.95,
            depthTest: false,
        });
        const s = new THREE.Sprite(mat);
        s.scale.setScalar(0.22);
        s.renderOrder = 1003;
        s.userData = { baseAngle: (i / STAR_COUNT) * Math.PI * 2 };
        group.add(s);
        dizzyStars.push(s);
    }

    const BOLT_COUNT = 12;
    const bolts = [];

    const buildJaggedPath = (a, b, segs, jitter) => {
        const pts = [a.clone()];
        for (let s = 1; s < segs; s++) {
            const t = s / segs;
            const p = a.clone().lerp(b, t);
            p.x += (Math.random() - 0.5) * jitter;
            p.y += (Math.random() - 0.5) * jitter * 0.6;
            p.z += (Math.random() - 0.5) * jitter;
            pts.push(p);
        }
        pts.push(b.clone());
        return pts;
    };
    const buildBoltGeometry = (pts, radius) => {
        const curve = new THREE.CatmullRomCurve3(pts);
        return new THREE.TubeGeometry(curve, pts.length * 3, radius, 4, false);
    };

    for (let i = 0; i < BOLT_COUNT; i++) {
        const mat = new THREE.MeshBasicMaterial({
            color: 0xd8f4ff, transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        mesh.visible = false;
        group.add(mesh);

        const branchMat = new THREE.MeshBasicMaterial({
            color: 0xa8e0ff, transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const branchMesh = new THREE.Mesh(new THREE.BufferGeometry(), branchMat);
        branchMesh.visible = false;
        group.add(branchMesh);

        bolts.push({
            mesh, mat, branchMesh, branchMat,
            hasBranch: Math.random() < 0.5,
            nextFlashAt: Math.random() * 0.6,
            flashDur: 0.045 + Math.random() * 0.055,
            flashStart: -1,
            radius: 0.010 + Math.random() * 0.010,
        });
    }

    const sparks = [];
    const SPARK_COUNT = 22;
    for (let i = 0; i < SPARK_COUNT; i++) {
        const sg = new THREE.SphereGeometry(0.014 + Math.random() * 0.018, 4, 4);
        const sm = new THREE.MeshBasicMaterial({
            color: Math.random() < 0.5 ? 0xd8f4ff : 0xa8e0ff,
            transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const m = new THREE.Mesh(sg, sm);
        group.add(m);
        sparks.push({
            mesh: m, mat: sm,
            baseAngle: Math.random() * Math.PI * 2,
            radius: 0.22 + Math.random() * 0.24,
            spinSpeed: (Math.random() < 0.5 ? 1 : -1) * (1.5 + Math.random() * 2.5),
            cycleOffset: Math.random(),
            cycleSpeed: 0.9 + Math.random() * 0.8,
            maxY: 1.0 + Math.random() * 0.5,
            flickerRate: 14 + Math.random() * 18,
        });
    }

    const state = {
        group, ground, groundMat,
        dizzyStars, bolts, sparks,
        startTime: (typeof clock !== 'undefined' && clock)
            ? clock.getElapsedTime()
            : performance.now() / 1000,
        disposed: false,
    };

    const animate = () => {
        if (state.disposed || !group.parent) return;

        const now = (typeof clock !== 'undefined' && clock)
            ? clock.getElapsedTime()
            : performance.now() / 1000;
        const t = now - state.startTime;

        const gp = 0.5 + 0.35 * Math.sin(t * 9) + 0.15 * Math.sin(t * 23);
        groundMat.opacity = 0.18 + 0.22 * Math.max(0, gp);
        ground.scale.setScalar(1 + 0.04 * gp);

        for (const s of state.dizzyStars) {
            const a = s.userData.baseAngle + t * 1.4;
            const r = STAR_ORBIT_R;
            const y = STAR_ORBIT_Y + Math.sin(t * 3 + s.userData.baseAngle) * 0.05;
            s.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
            const tw = 0.7 + 0.3 * Math.sin(t * 8 + s.userData.baseAngle * 3);
            s.material.opacity = tw;
            s.scale.setScalar(0.20 + 0.04 * tw);
        }

        for (const b of state.bolts) {
            if (b.flashStart < 0 && t >= b.nextFlashAt) {
                const a1 = Math.random() * Math.PI * 2;
                const a2 = a1 + Math.PI + (Math.random() - 0.5) * 0.8;

                const r1 = 0.65 + Math.random() * 0.35;
                const y1 = 0.55 + Math.random() * 0.9;
                const r2 = 0.05 + Math.random() * 0.15;
                const y2 = 0.20 + Math.random() * 0.55;

                const start = new THREE.Vector3(
                    Math.cos(a1) * r1, y1, Math.sin(a1) * r1
                );
                const end = new THREE.Vector3(
                    Math.cos(a2) * r2, y2, Math.sin(a2) * r2
                );

                const segs = 6 + Math.floor(Math.random() * 3);
                const jitter = 0.08 + Math.random() * 0.09;
                const pts = buildJaggedPath(start, end, segs, jitter);

                if (b.mesh.geometry) b.mesh.geometry.dispose();
                b.mesh.geometry = buildBoltGeometry(pts, b.radius);

                if (b.hasBranch && pts.length > 3) {
                    const midIdx = 1 + Math.floor(Math.random() * (pts.length - 2));
                    const mid = pts[midIdx];
                    const bEnd = mid.clone().add(new THREE.Vector3(
                        (Math.random() - 0.5) * 0.35,
                        (Math.random() - 0.5) * 0.30,
                        (Math.random() - 0.5) * 0.35,
                    ));
                    const bPts = buildJaggedPath(
                        mid, bEnd, 3 + Math.floor(Math.random() * 2), jitter * 0.7
                    );
                    if (b.branchMesh.geometry) b.branchMesh.geometry.dispose();
                    b.branchMesh.geometry = buildBoltGeometry(bPts, b.radius * 0.6);
                }

                b.flashStart = t;
            }

            if (b.flashStart >= 0) {
                const age = t - b.flashStart;
                if (age < b.flashDur) {
                    const k = age / b.flashDur;
                    const a = Math.sin(Math.PI * k);
                    const flick = Math.random() < 0.35 ? 0.15 : 1.0;
                    b.mat.opacity = a * flick;
                    b.branchMat.opacity = a * flick * 0.7;
                    b.mesh.visible = true;
                    b.branchMesh.visible = b.hasBranch;
                } else {
                    b.mat.opacity = 0;
                    b.branchMat.opacity = 0;
                    b.mesh.visible = false;
                    b.branchMesh.visible = false;
                    b.flashStart = -1;
                    b.nextFlashAt = t + 0.12 + Math.random() * 0.45;
                }
            }
        }

        for (const s of state.sparks) {
            const cycleT = ((t * s.cycleSpeed + s.cycleOffset) % 1);
            if (cycleT > 0.75) {
                s.mesh.visible = false;
                continue;
            }
            s.mesh.visible = true;

            const fallT = cycleT / 0.75;
            const y = s.maxY * (1 - fallT);
            const angle = s.baseAngle + t * s.spinSpeed;
            const r = s.radius * (1 + fallT * 0.3);
            s.mesh.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);

            const flick = 0.5 + 0.5 * Math.sin(t * s.flickerRate + s.baseAngle * 4);
            const fade = Math.sin(Math.PI * fallT);
            s.mat.opacity = flick * fade;
            s.mesh.scale.setScalar(0.7 + 0.4 * flick);
        }

        requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);

    state.dispose = () => {
        if (state.disposed) return;
        state.disposed = true;
        if (group.parent) group.parent.remove(group);
        group.traverse(n => {
            if (n.geometry) n.geometry.dispose();
            if (n.material) {
                if (Array.isArray(n.material)) n.material.forEach(m => m.dispose());
                else n.material.dispose();
            }
        });
    };

    return state;
}


/* ═══════════════════════════════════════════════════════════
   4.  BISHOP "CANNON LEAP" GROUND EFFECT
   ═══════════════════════════════════════════════════════════ */
let activeBishopLeapEffects = [];

function triggerBishopLeapFadeOut() {
    for (const fx of activeBishopLeapEffects) {
        if (!fx.fadingOut) {
            fx.fadingOut = true;
            fx.fadeStartTime = clock.getElapsedTime();
        }
    }
}

function spawnBishopLeapEffect(fromR, fromC, toR, toC) {
    const dr = Math.sign(toR - fromR);
    const dc = Math.sign(toC - fromC);
    const steps = Math.abs(toR - fromR);

    const effectGroup = new THREE.Group();
    scene.add(effectGroup);

    const startTime = clock.getElapsedTime();
    const LEAP_DURATION = 0.4;
    const TOTAL_DURATION = 3.6;
    const LANDING_FX_DURATION = 0.7;
    const EARLY_FADE_DURATION = 0.4;

    const effectState = {
        group: effectGroup,
        fadingOut: false,
        fadeStartTime: 0,
        disposed: false
    };
    activeBishopLeapEffects.push(effectState);

    const disposeEffect = () => {
        if (effectState.disposed) return;
        effectState.disposed = true;
        scene.remove(effectGroup);
        effectGroup.traverse(n => {
            if (n.geometry) n.geometry.dispose();
            if (n.material) {
                if (Array.isArray(n.material)) n.material.forEach(m => m.dispose());
                else n.material.dispose();
            }
        });
        const idx = activeBishopLeapEffects.indexOf(effectState);
        if (idx >= 0) activeBishopLeapEffects.splice(idx, 1);
    };

    const cracks = [];
    const lavaParticles = [];
    const embers = [];
    const shockRings = [];
    const residualGlows = [];

    const makeGroundSegment = (p1, p2, width, mat, y) => {
        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.0001) return null;
        const geo = new THREE.PlaneGeometry(len, width);
        const mesh = new THREE.Mesh(geo, mat);
        const dir = new THREE.Vector3(dx, 0, dz).normalize();
        const perp = new THREE.Vector3(-dir.z, 0, dir.x);
        const up = new THREE.Vector3(0, 1, 0);
        const m = new THREE.Matrix4().makeBasis(dir, perp, up);
        mesh.quaternion.setFromRotationMatrix(m);
        mesh.position.set((p1.x + p2.x) / 2, y, (p1.z + p2.z) / 2);
        return mesh;
    };

    const buildCrackCluster = (cx, cz, delay, sizeMul) => {
        const baseAngle = Math.random() * Math.PI * 2;
        const mainLen = (0.65 + Math.random() * 0.3) * sizeMul;
        const segments = 6;

        const mainPts = [];
        for (let s = 0; s <= segments; s++) {
            const t = s / segments - 0.5;
            const jitter = (Math.random() - 0.5) * 0.14;
            mainPts.push(new THREE.Vector3(
                cx + Math.cos(baseAngle) * mainLen * t + Math.cos(baseAngle + Math.PI / 2) * jitter,
                0,
                cz + Math.sin(baseAngle) * mainLen * t + Math.sin(baseAngle + Math.PI / 2) * jitter
            ));
        }

        const meshes = [];
        const darkMainMat = new THREE.MeshBasicMaterial({
            color: 0x080200, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide
        });
        const lavaMainMat = new THREE.MeshBasicMaterial({
            color: 0xff8822, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        });

        for (let s = 0; s < mainPts.length - 1; s++) {
            const p1 = mainPts[s], p2 = mainPts[s + 1];
            const dm = makeGroundSegment(p1, p2, 0.085, darkMainMat, 0.018);
            if (dm) { dm.renderOrder = 10; effectGroup.add(dm); meshes.push({ mesh: dm, kind: 'dark' }); }
            const lm = makeGroundSegment(p1, p2, 0.055, lavaMainMat, 0.030);
            if (lm) { lm.renderOrder = 11; effectGroup.add(lm); meshes.push({ mesh: lm, kind: 'lava' }); }
        }

        const branchCount = 3 + Math.floor(Math.random() * 2);
        for (let b = 0; b < branchCount; b++) {
            const startIdx = 1 + Math.floor(Math.random() * (mainPts.length - 2));
            const startPt = mainPts[startIdx];
            const branchAngle = baseAngle + (Math.random() < 0.5 ? 1 : -1) * (0.5 + Math.random() * 1.1);
            const branchLen = (0.20 + Math.random() * 0.25) * sizeMul;
            const bSegs = 3;

            const bPts = [startPt.clone()];
            for (let s = 1; s <= bSegs; s++) {
                const t = s / bSegs;
                const j = (Math.random() - 0.5) * 0.06;
                bPts.push(new THREE.Vector3(
                    startPt.x + Math.cos(branchAngle) * branchLen * t + j,
                    0,
                    startPt.z + Math.sin(branchAngle) * branchLen * t + j
                ));
            }

            const darkBranchMat = new THREE.MeshBasicMaterial({
                color: 0x080200, transparent: true, opacity: 0,
                depthWrite: false, side: THREE.DoubleSide
            });
            const lavaBranchMat = new THREE.MeshBasicMaterial({
                color: 0xff6611, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
            });

            for (let s = 0; s < bPts.length - 1; s++) {
                const p1 = bPts[s], p2 = bPts[s + 1];
                const dm = makeGroundSegment(p1, p2, 0.060, darkBranchMat, 0.018);
                if (dm) { dm.renderOrder = 10; effectGroup.add(dm); meshes.push({ mesh: dm, kind: 'dark' }); }
                const lm = makeGroundSegment(p1, p2, 0.038, lavaBranchMat, 0.030);
                if (lm) { lm.renderOrder = 11; effectGroup.add(lm); meshes.push({ mesh: lm, kind: 'lava' }); }
            }
        }

        cracks.push({
            meshes,
            bornAt: delay,
            pulsePhase: Math.random() * Math.PI * 2,
            lifeStart: delay + 0.5,
            fadeDuration: TOTAL_DURATION - delay - 0.5
        });
    };

    for (let i = 0; i <= steps; i++) {
        const r = fromR + dr * i;
        const c = fromC + dc * i;
        const pos = get3DPosition(r, c, 0);
        const delay = (i / steps) * LEAP_DURATION;
        const isLanding = (i === steps);

        buildCrackCluster(pos.x, pos.z, delay, isLanding ? 1.25 : 1.05);

        const lavaCount = isLanding
            ? (28 + Math.floor(Math.random() * 8))
            : (14 + Math.floor(Math.random() * 6));
        for (let p = 0; p < lavaCount; p++) {
            const pGeo = new THREE.SphereGeometry(0.045 + Math.random() * 0.055, 6, 6);
            const pMat = new THREE.MeshBasicMaterial({
                color: 0xffcc44, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false
            });
            const mesh = new THREE.Mesh(pGeo, pMat);
            mesh.renderOrder = 20;
            mesh.position.set(
                pos.x + (Math.random() - 0.5) * 0.4,
                0.08,
                pos.z + (Math.random() - 0.5) * 0.4
            );
            effectGroup.add(mesh);

            const angle = Math.random() * Math.PI * 2;
            const spread = 0.6 + Math.random() * 1.4;
            const upSpeed = isLanding
                ? (3.2 + Math.random() * 3.2)
                : (2.2 + Math.random() * 2.0);

            lavaParticles.push({
                mesh,
                vel: new THREE.Vector3(
                    Math.cos(angle) * spread * 0.75,
                    upSpeed,
                    Math.sin(angle) * spread * 0.75
                ),
                bornAt: delay + Math.random() * 0.15,
                life: 1.2 + Math.random() * 0.9
            });
        }

        const emberCount = 8 + Math.floor(Math.random() * 5);
        for (let e = 0; e < emberCount; e++) {
            const pGeo = new THREE.SphereGeometry(0.020 + Math.random() * 0.026, 4, 4);
            const pMat = new THREE.MeshBasicMaterial({
                color: 0xffaa33, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false
            });
            const mesh = new THREE.Mesh(pGeo, pMat);
            mesh.renderOrder = 20;
            mesh.position.set(
                pos.x + (Math.random() - 0.5) * 0.35,
                0.06,
                pos.z + (Math.random() - 0.5) * 0.35
            );
            effectGroup.add(mesh);

            embers.push({
                mesh,
                velY: 0.7 + Math.random() * 1.4,
                driftX: (Math.random() - 0.5) * 0.6,
                driftZ: (Math.random() - 0.5) * 0.6,
                bornAt: delay + Math.random() * 0.2,
                life: 1.8 + Math.random() * 1.0
            });
        }

        if (!isLanding) {
            const rGeo = new THREE.RingGeometry(0.10, 0.26, 24);
            const rMat = new THREE.MeshBasicMaterial({
                color: 0xff7700, transparent: true, opacity: 0,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending, depthWrite: false
            });
            const ring = new THREE.Mesh(rGeo, rMat);
            ring.renderOrder = 12;
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(pos.x, 0.035, pos.z);
            effectGroup.add(ring);

            shockRings.push({
                mesh: ring,
                bornAt: delay,
                duration: 0.45,
                startScale: 1,
                endScale: 3.2,
                maxOpacity: 0.6
            });
        }

        const heatGeo = new THREE.CircleGeometry(0.55, 20);
        const heatMat = new THREE.MeshBasicMaterial({
            color: 0xff5500, transparent: true, opacity: 0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        const heat = new THREE.Mesh(heatGeo, heatMat);
        heat.renderOrder = 8;
        heat.rotation.x = -Math.PI / 2;
        heat.position.set(pos.x, 0.022, pos.z);
        effectGroup.add(heat);

        residualGlows.push({
            mesh: heat,
            bornAt: delay,
            duration: TOTAL_DURATION - delay,
            maxOpacity: isLanding ? 0.85 : 0.55,
            pulsePhase: Math.random() * Math.PI * 2
        });
    }

    const landingPos = get3DPosition(toR, toC, 0);

    const landRingGeo = new THREE.RingGeometry(0.16, 0.34, 40);
    const landRingMat = new THREE.MeshBasicMaterial({
        color: 0xffcc66, transparent: true, opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const landRing = new THREE.Mesh(landRingGeo, landRingMat);
    landRing.renderOrder = 12;
    landRing.rotation.x = -Math.PI / 2;
    landRing.position.set(landingPos.x, 0.045, landingPos.z);
    effectGroup.add(landRing);

    shockRings.push({
        mesh: landRing,
        bornAt: LEAP_DURATION,
        duration: LANDING_FX_DURATION,
        startScale: 1,
        endScale: 4.5,
        maxOpacity: 0.85
    });

    const landRing2Geo = new THREE.RingGeometry(0.24, 0.40, 40);
    const landRing2Mat = new THREE.MeshBasicMaterial({
        color: 0xff4400, transparent: true, opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const landRing2 = new THREE.Mesh(landRing2Geo, landRing2Mat);
    landRing2.renderOrder = 12;
    landRing2.rotation.x = -Math.PI / 2;
    landRing2.position.set(landingPos.x, 0.035, landingPos.z);
    effectGroup.add(landRing2);

    shockRings.push({
        mesh: landRing2,
        bornAt: LEAP_DURATION + 0.08,
        duration: LANDING_FX_DURATION + 0.1,
        startScale: 1,
        endScale: 3.0,
        maxOpacity: 0.5
    });

    const glowGeo = new THREE.CircleGeometry(0.55, 32);
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0xff5500, transparent: true, opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const glowDisc = new THREE.Mesh(glowGeo, glowMat);
    glowDisc.renderOrder = 9;
    glowDisc.rotation.x = -Math.PI / 2;
    glowDisc.position.set(landingPos.x, 0.025, landingPos.z);
    effectGroup.add(glowDisc);

    const animateFx = () => {
        if (effectState.disposed) return;

        const nowT = clock.getElapsedTime();
        const elapsed = nowT - startTime;

        let fadeMul = 1;
        if (effectState.fadingOut) {
            const fadeElapsed = nowT - effectState.fadeStartTime;
            if (fadeElapsed >= EARLY_FADE_DURATION) {
                disposeEffect();
                return;
            }
            fadeMul = 1 - (fadeElapsed / EARLY_FADE_DURATION);
        }

        if (elapsed >= TOTAL_DURATION) {
            disposeEffect();
            return;
        }

        for (const c of cracks) {
            const t = elapsed - c.bornAt;
            if (t < 0) {
                for (const entry of c.meshes) entry.mesh.material.opacity = 0;
                continue;
            }
            const growT = Math.min(t / 0.22, 1);
            const fadeStart = c.lifeStart - c.bornAt;
            const fadeT = t < fadeStart
                ? 1
                : Math.max(0, 1 - (t - fadeStart) / c.fadeDuration);
            const pulse = 0.72 + 0.28 * Math.sin(elapsed * 20 + c.pulsePhase);
            for (const entry of c.meshes) {
                if (entry.kind === 'dark') {
                    entry.mesh.material.opacity = growT * fadeT * 0.95 * fadeMul;
                } else {
                    entry.mesh.material.opacity = growT * fadeT * 1.0 * pulse * fadeMul;
                }
            }
        }

        for (const p of lavaParticles) {
            const t = elapsed - p.bornAt;
            if (t < 0 || t > p.life) { p.mesh.visible = false; continue; }
            p.mesh.visible = true;
            p.mesh.position.x += p.vel.x * 0.016;
            p.mesh.position.y += p.vel.y * 0.016;
            p.mesh.position.z += p.vel.z * 0.016;
            p.vel.y -= 0.20;
            const lifeT = t / p.life;
            p.mesh.material.opacity = (1 - lifeT) * 1.0 * fadeMul;
            const hue = 0.135 - lifeT * 0.085;
            const light = 0.78 - lifeT * 0.34;
            p.mesh.material.color.setHSL(hue, 1, light);
            p.mesh.scale.setScalar(1 - lifeT * 0.35);
        }

        for (const e of embers) {
            const t = elapsed - e.bornAt;
            if (t < 0 || t > e.life) { e.mesh.visible = false; continue; }
            e.mesh.visible = true;
            e.mesh.position.y += e.velY * 0.016;
            e.mesh.position.x += e.driftX * 0.016;
            e.mesh.position.z += e.driftZ * 0.016;
            const lifeT = t / e.life;
            e.mesh.material.opacity = (1 - lifeT) * 0.85 * fadeMul;
            e.mesh.material.color.setHSL(0.08 - lifeT * 0.03, 1, 0.7 - lifeT * 0.25);
            e.mesh.scale.setScalar(0.9 + Math.sin(t * 24) * 0.25);
        }

        for (const sr of shockRings) {
            const t = elapsed - sr.bornAt;
            if (t < 0 || t > sr.duration) {
                sr.mesh.material.opacity = 0;
                continue;
            }
            const progress = t / sr.duration;
            const eased = 1 - Math.pow(1 - progress, 3);
            const scale = sr.startScale + (sr.endScale - sr.startScale) * eased;
            sr.mesh.scale.setScalar(scale);
            sr.mesh.material.opacity = sr.maxOpacity * (1 - progress) * fadeMul;
        }

        for (const rg of residualGlows) {
            const t = elapsed - rg.bornAt;
            if (t < 0) continue;
            const progress = Math.min(t / rg.duration, 1);
            const fadeIn = Math.min(t / 0.25, 1);
            const pulse = 0.75 + 0.25 * Math.sin(elapsed * 14 + rg.pulsePhase);
            rg.mesh.material.opacity = rg.maxOpacity * fadeIn * (1 - progress) * pulse * fadeMul;
            rg.mesh.scale.setScalar(1 + progress * 0.8);
        }

        const glowT = (elapsed - LEAP_DURATION) / LANDING_FX_DURATION;
        if (glowT > 0 && glowT < 1) {
            const pulse = 0.65 + 0.35 * Math.sin(elapsed * 20);
            glowDisc.material.opacity = 0.7 * (1 - glowT) * pulse * fadeMul;
            glowDisc.scale.setScalar(1 + glowT * 1.2);
        } else if (glowT >= 1) {
            glowDisc.material.opacity = 0;
        }

        requestAnimationFrame(animateFx);
    };
    animateFx();
}


/* ═══════════════════════════════════════════════════════════
   5.  KNIGHT VISUAL EFFECTS
   ═══════════════════════════════════════════════════════════ */
function spawnKnightDashWind(fromR, fromC, landingR, landingC, duration) {
    const fromPos = get3DPosition(fromR, fromC, 0);
    const toPos = get3DPosition(landingR, landingC, 0);
    const delta = new THREE.Vector3().subVectors(toPos, fromPos);
    if (delta.lengthSq() < 1e-6) return;
    const travelDir = delta.clone().normalize();

    const orient = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        travelDir
    );

    const windGroup = new THREE.Group();
    scene.add(windGroup);

    const DRILL_LENGTH = 1.7;
    const DRILL_BASE_RADIUS = 0.5;
    const ROTATION_SPEED = 22;
    const HELIX_TURNS = 3.0;
    const DRILL_FORWARD_OFFSET = DRILL_LENGTH / 2;

    const localBaseY = -DRILL_LENGTH / 2 + DRILL_FORWARD_OFFSET;
    const localTipY = DRILL_LENGTH / 2 + DRILL_FORWARD_OFFSET;

    const coneGeo = new THREE.ConeGeometry(DRILL_BASE_RADIUS, DRILL_LENGTH, 32, 1, true);
    const coneMat = new THREE.MeshBasicMaterial({
        color: 0x9fdcff, transparent: true, opacity: 0.26,
        depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const drillCone = new THREE.Mesh(coneGeo, coneMat);
    drillCone.position.y = DRILL_FORWARD_OFFSET;
    windGroup.add(drillCone);

    const coreGeo = new THREE.ConeGeometry(DRILL_BASE_RADIUS * 0.6, DRILL_LENGTH * 0.85, 20, 1, true);
    const coreMat = new THREE.MeshBasicMaterial({
        color: 0xd8f4ff, transparent: true, opacity: 0.4,
        depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const coreCone = new THREE.Mesh(coreGeo, coreMat);
    coreCone.position.y = DRILL_FORWARD_OFFSET;
    windGroup.add(coreCone);

    const STRANDS = 4;
    const PER_STRAND = 28;
    const helixParticles = [];
    for (let s = 0; s < STRANDS; s++) {
        const strandOffset = (s / STRANDS) * Math.PI * 2;
        for (let i = 0; i < PER_STRAND; i++) {
            const t = i / (PER_STRAND - 1);
            const pGeo = new THREE.SphereGeometry(0.03 + Math.random() * 0.025, 5, 5);
            const pMat = new THREE.MeshBasicMaterial({
                color: 0xb8ecff, transparent: true, opacity: 0.95,
                depthWrite: false, blending: THREE.AdditiveBlending,
            });
            const p = new THREE.Mesh(pGeo, pMat);
            p.userData = {
                strandOffset, t,
                localY: localBaseY + t * DRILL_LENGTH,
                radiusAtT: DRILL_BASE_RADIUS * (1 - t) * 1.02,
            };
            windGroup.add(p);
            helixParticles.push(p);
        }
    }

    const RING_COUNT = 22;
    const ringParticles = [];
    for (let i = 0; i < RING_COUNT; i++) {
        const a = (i / RING_COUNT) * Math.PI * 2;
        const pGeo = new THREE.SphereGeometry(0.055 + Math.random() * 0.03, 5, 5);
        const pMat = new THREE.MeshBasicMaterial({
            color: 0x7ac8ff, transparent: true, opacity: 0.85,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const p = new THREE.Mesh(pGeo, pMat);
        p.userData = { baseAngle: a, radiusMul: 1.0 + Math.random() * 0.25 };
        windGroup.add(p);
        ringParticles.push(p);
    }

    const sparkGeo = new THREE.SphereGeometry(0.14, 10, 10);
    const sparkMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const spark = new THREE.Mesh(sparkGeo, sparkMat);
    spark.position.y = localTipY;
    windGroup.add(spark);

    const noseGeo = new THREE.ConeGeometry(0.09, 0.3, 12);
    const noseMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.9,
        depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.position.y = localTipY + 0.15;
    windGroup.add(nose);

    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(travelDir, up);
    if (side.lengthSq() < 0.0001) side.set(1, 0, 0);
    side.normalize();

    const trailCount = 16;
    const trailParticles = [];
    for (let i = 0; i < trailCount; i++) {
        const f = i / trailCount;
        const anchor = new THREE.Vector3().lerpVectors(fromPos, toPos, f);
        const pGeo = new THREE.SphereGeometry(0.05 + Math.random() * 0.05, 5, 5);
        const pMat = new THREE.MeshBasicMaterial({
            color: 0x88ccff, transparent: true, opacity: 0.6,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const p = new THREE.Mesh(pGeo, pMat);
        const sign = Math.random() < 0.5 ? -1 : 1;
        p.userData = {
            anchor,
            sideOffset: side.clone().multiplyScalar(sign * (0.15 + Math.random() * 0.35)),
            upOffset: 0.2 + Math.random() * 0.5,
            bornAt: duration * (1 - Math.sqrt(1 - f)) + 0.03,
            life: 0.4,
            driftDir: side.clone().multiplyScalar(sign * (0.3 + Math.random() * 0.4)),
        };
        p.visible = false;
        scene.add(p);
        trailParticles.push(p);
    }

    const startTime = clock.getElapsedTime();
    const totalDuration = duration + 0.4;

    const animateWind = () => {
        const now = clock.getElapsedTime();
        const elapsed = now - startTime;
        if (elapsed >= totalDuration) {
            scene.remove(windGroup);
            windGroup.traverse(n => {
                if (n.geometry) n.geometry.dispose();
                if (n.material) n.material.dispose();
            });
            for (const p of trailParticles) {
                scene.remove(p);
                if (p.geometry) p.geometry.dispose();
                if (p.material) p.material.dispose();
            }
            return;
        }

        const tKnight = Math.min(elapsed / duration, 1);
        const easedKnight = tKnight * (2 - tKnight);
        const knightPos = new THREE.Vector3().lerpVectors(fromPos, toPos, easedKnight);

        windGroup.position.set(knightPos.x, 0.55, knightPos.z);
        windGroup.quaternion.copy(orient);

        const fade = elapsed < duration ? 1 : Math.max(0, 1 - (elapsed - duration) / 0.4);
        const shrink = 0.75 + 0.25 * fade;

        drillCone.material.opacity = 0.26 * fade;
        drillCone.scale.set(shrink, 1, shrink);
        coreCone.material.opacity = 0.4 * fade;
        coreCone.scale.set(shrink, 1, shrink);

        const spin = elapsed * ROTATION_SPEED;
        for (const p of helixParticles) {
            const t = p.userData.t;
            const angle = p.userData.strandOffset + spin + t * Math.PI * 2 * HELIX_TURNS;
            const r = p.userData.radiusAtT;
            p.position.set(Math.cos(angle) * r, p.userData.localY, Math.sin(angle) * r);
            p.material.opacity = 0.95 * fade;
        }

        for (const p of ringParticles) {
            const angle = p.userData.baseAngle + spin * 0.7;
            const r = DRILL_BASE_RADIUS * p.userData.radiusMul;
            p.position.set(Math.cos(angle) * r, localBaseY, Math.sin(angle) * r);
            p.material.opacity = 0.85 * fade;
            p.scale.setScalar(1 + Math.sin(elapsed * 20 + p.userData.baseAngle) * 0.18);
        }

        spark.material.opacity = 0.95 * fade * (0.7 + 0.3 * Math.sin(elapsed * 30));
        spark.scale.setScalar(1 + Math.sin(elapsed * 25) * 0.3);
        nose.material.opacity = 0.9 * fade;
        nose.scale.setScalar(1 + Math.sin(elapsed * 22) * 0.15);

        for (const p of trailParticles) {
            const age = elapsed - p.userData.bornAt;
            if (age < 0 || age > p.userData.life) { p.visible = false; continue; }
            p.visible = true;
            const lifeT = age / p.userData.life;
            const drift = p.userData.driftDir.clone().multiplyScalar(lifeT * 0.5);
            const b = p.userData.anchor;
            p.position.set(
                b.x + p.userData.sideOffset.x + drift.x,
                b.y + p.userData.upOffset + lifeT * 0.25,
                b.z + p.userData.sideOffset.z + drift.z
            );
            p.material.opacity = 0.6 * (1 - lifeT);
            p.scale.setScalar(1 + lifeT * 1.2);
        }

        requestAnimationFrame(animateWind);
    };
    animateWind();
}

function spawnKnightChargeEffect(pieceObj, duration) {
    if (!pieceObj || !scene) return;

    const anchor = pieceObj.position.clone();
    const group = new THREE.Group();
    group.position.set(anchor.x, 0, anchor.z);
    scene.add(group);

    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xb8ecff, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.38, 44), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    group.add(ring);

    const ring2Mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.48, 44), ring2Mat);
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.y = 0.045;
    group.add(ring2);

    const particles = [];
    for (let i = 0; i < 36; i++) {
        const pg = new THREE.SphereGeometry(0.022 + Math.random() * 0.022, 5, 5);
        const pm = new THREE.MeshBasicMaterial({
            color: Math.random() < 0.5 ? 0xb8ecff : 0xffffff,
            transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const p = new THREE.Mesh(pg, pm);
        const a = Math.random() * Math.PI * 2;
        const r = 0.85 + Math.random() * 0.7;
        const y0 = 0.20 + Math.random() * 1.0;
        p.position.set(Math.cos(a) * r, y0, Math.sin(a) * r);
        p.userData = {
            startAngle: a,
            startRadius: r,
            startY: y0,
            spinSpeed: 4 + Math.random() * 5,
            delay: Math.random() * (duration * 0.4),
        };
        group.add(p);
        particles.push(p);
    }

    const startTime = clock.getElapsedTime();
    const FADE_TAIL = 0.12;
    const totalDuration = duration + FADE_TAIL;

    const animate = () => {
        const t = clock.getElapsedTime() - startTime;
        if (t >= totalDuration) {
            scene.remove(group);
            group.traverse(n => {
                if (n.geometry) n.geometry.dispose();
                if (n.material) n.material.dispose();
            });
            return;
        }

        const k = Math.min(1, t / duration);
        const fadeOut = Math.max(0, 1 - Math.max(0, t - duration) / FADE_TAIL);

        ringMat.opacity = Math.min(1, k * 2.2) * 0.85 * (0.6 + 0.4 * Math.sin(t * 14)) * fadeOut;
        ring2Mat.opacity = Math.min(1, k * 2.2) * 0.65 * (0.6 + 0.4 * Math.sin(t * 10 + 1)) * fadeOut;
        ring.scale.setScalar(1 + Math.sin(t * 10) * 0.12);
        ring2.scale.setScalar(1 + Math.sin(t * 8 + 1) * 0.15);

        for (const p of particles) {
            const pt = t - p.userData.delay;
            if (pt < 0) { p.material.opacity = 0; continue; }
            const lk = Math.min(1, pt / (duration * 0.85));
            const a = p.userData.startAngle + pt * p.userData.spinSpeed;
            const r = p.userData.startRadius * (1 - lk) * (1 - lk * 0.3);
            const y = p.userData.startY * (1 - lk) + 0.16 * lk;
            p.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
            p.material.opacity = (1 - lk) * 0.95 * fadeOut;
            p.scale.setScalar(1 - lk * 0.5);
        }

        requestAnimationFrame(animate);
    };
    animate();
}

function spawnKnightImpactEffect(row, col, color) {
    if (!scene) return;

    const center = get3DPosition(row, col, 0);
    const group = new THREE.Group();
    group.position.set(center.x, 0, center.z);
    scene.add(group);

    const rings = [];
    const ringColors = [0xffffff, 0xb8ecff, 0xe8c547];
    for (let i = 0; i < 3; i++) {
        const mat = new THREE.MeshBasicMaterial({
            color: ringColors[i],
            transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        const r = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.34, 48), mat);
        r.rotation.x = -Math.PI / 2;
        r.position.y = 0.05 + i * 0.006;
        group.add(r);
        rings.push({ mesh: r, mat, delay: i * 0.06 });
    }

    const flashMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 14), flashMat);
    flash.position.y = 0.35;
    group.add(flash);

    const dust = [];
    for (let i = 0; i < 24; i++) {
        const pg = new THREE.SphereGeometry(0.028 + Math.random() * 0.030, 4, 4);
        const pm = new THREE.MeshBasicMaterial({
            color: 0xd4b896, transparent: true, opacity: 1,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const p = new THREE.Mesh(pg, pm);
        p.position.y = 0.05;
        const a = Math.random() * Math.PI * 2;
        const speed = 1.0 + Math.random() * 1.8;
        p.userData = {
            vel: new THREE.Vector3(
                Math.cos(a) * speed,
                0.7 + Math.random() * 1.3,
                Math.sin(a) * speed
            ),
            life: 0.7 + Math.random() * 0.4,
            maxLife: 0,
        };
        p.userData.maxLife = p.userData.life;
        group.add(p);
        dust.push(p);
    }

    for (let i = 0; i < 18; i++) {
        const pg = new THREE.SphereGeometry(0.024 + Math.random() * 0.022, 4, 4);
        const pm = new THREE.MeshBasicMaterial({
            color: 0xb8ecff, transparent: true, opacity: 1,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const p = new THREE.Mesh(pg, pm);
        p.position.y = 0.10;
        const a = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 2.0;
        p.userData = {
            vel: new THREE.Vector3(
                Math.cos(a) * speed,
                1.0 + Math.random() * 1.5,
                Math.sin(a) * speed
            ),
            life: 0.5 + Math.random() * 0.3,
            maxLife: 0,
        };
        p.userData.maxLife = p.userData.life;
        group.add(p);
        dust.push(p);
    }

    const startTime = clock.getElapsedTime();
    const DURATION = 0.9;

    const animate = () => {
        const t = clock.getElapsedTime() - startTime;
        if (t >= DURATION) {
            scene.remove(group);
            group.traverse(n => {
                if (n.geometry) n.geometry.dispose();
                if (n.material) n.material.dispose();
            });
            return;
        }

        for (const r of rings) {
            const st = Math.max(0, (t - r.delay) / 0.5);
            if (st >= 1) { r.mat.opacity = 0; continue; }
            r.mat.opacity = 0.9 * (1 - st);
            const s = 1 + st * 4.5;
            r.mesh.scale.set(s, s, 1);
        }

        flashMat.opacity = Math.max(0, 0.95 - t * 3.0);
        flash.scale.setScalar(1 + t * 3.5);

        for (const d of dust) {
            d.userData.life -= 0.016;
            if (d.userData.life <= 0) { d.material.opacity = 0; continue; }
            d.position.addScaledVector(d.userData.vel, 0.016);
            d.userData.vel.y -= 0.10;
            d.userData.vel.multiplyScalar(0.94);
            d.material.opacity = Math.max(0, d.userData.life / d.userData.maxLife) * 0.9;
        }

        requestAnimationFrame(animate);
    };
    animate();
}

function spawnKnockbackSpark(worldPos, color) {
    if (!scene) return;

    const geo = new THREE.SphereGeometry(0.026 + Math.random() * 0.024, 5, 5);
    const mat = new THREE.MeshBasicMaterial({
        color: color || (Math.random() < 0.5 ? 0xff6644 : 0xffcc44),
        transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const p = new THREE.Mesh(geo, mat);
    p.position.copy(worldPos);
    p.position.x += (Math.random() - 0.5) * 0.14;
    p.position.y += 0.10 + Math.random() * 0.15;
    p.position.z += (Math.random() - 0.5) * 0.14;
    scene.add(p);

    const startTime = clock.getElapsedTime();
    const LIFE = 0.5;
    const driftVel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.6,
        0.4 + Math.random() * 0.5,
        (Math.random() - 0.5) * 0.6
    );

    const animate = () => {
        const t = clock.getElapsedTime() - startTime;
        if (t >= LIFE) {
            scene.remove(p);
            p.geometry.dispose();
            p.material.dispose();
            return;
        }
        p.position.addScaledVector(driftVel, 0.016);
        driftVel.y -= 0.05;
        const lt = t / LIFE;
        p.material.opacity = (1 - lt) * 0.95;
        p.scale.setScalar(1 - lt * 0.4);
        requestAnimationFrame(animate);
    };
    animate();
}

function spawnKnightGhostSquad(pieceObj, color, dashDuration, fromPos, toPos) {
    const squadGroup = new THREE.Group();
    scene.add(squadGroup);

    const travel = new THREE.Vector3().subVectors(toPos, fromPos);
    travel.y = 0;
    if (travel.lengthSq() < 1e-6) travel.set(0, 0, 1);
    travel.normalize();
    const right = new THREE.Vector3(-travel.z, 0, travel.x);

    const INNER_BACK = 0.32;
    const INNER_SIDE = 0.34;
    const OUTER_BACK = 0.72;
    const OUTER_SIDE = 0.68;

    const offsets = [
        travel.clone().multiplyScalar(-INNER_BACK).add(right.clone().multiplyScalar(-INNER_SIDE)),
        travel.clone().multiplyScalar(-INNER_BACK).add(right.clone().multiplyScalar(INNER_SIDE)),
        travel.clone().multiplyScalar(-OUTER_BACK).add(right.clone().multiplyScalar(-OUTER_SIDE)),
        travel.clone().multiplyScalar(-OUTER_BACK).add(right.clone().multiplyScalar(OUTER_SIDE)),
    ];

    const facingYaw = Math.atan2(travel.x, travel.z);

    const isWhiteKnight = (color === 'white');
    const ghostTint = isWhiteKnight
        ? new THREE.Color(0x9fe8ff)
        : new THREE.Color(0x7a1fd9);
    const tintStrength = isWhiteKnight ? 0.65 : 0.55;
    const ghostOpacity = isWhiteKnight ? 0.55 : 0.80;
    const ghostBlend = isWhiteKnight
        ? THREE.AdditiveBlending
        : THREE.NormalBlending;
    const ghostEmissive = isWhiteKnight
        ? new THREE.Color(0x9fe8ff)
        : new THREE.Color(0x3a0060);
    const emissiveIntensity = isWhiteKnight ? 0.6 : 0.5;

    const ghosts = [];

    for (let i = 0; i < 4; i++) {
        const ghost = createPieceModel(
            'knight', color, 100, 100, PIECE_PARAMS.knight || {}
        );

        if (ghost.userData.hpSprite) {
            ghost.remove(ghost.userData.hpSprite);
            ghost.userData.hpSprite = null;
        }

        ghost.traverse(n => {
            if (!n.isMesh || !n.material || !n.material.color) return;
            n.material = n.material.clone();
            n.material.transparent = true;
            n.material.opacity = ghostOpacity;
            n.material.depthWrite = false;
            n.material.blending = ghostBlend;
            n.material.color.lerp(ghostTint, tintStrength);
            if (n.material.emissive) {
                n.material.emissive = ghostEmissive.clone();
                n.material.emissiveIntensity = emissiveIntensity;
            }
            n.castShadow = false;
            n.receiveShadow = false;
        });

        ghost.rotation.y = facingYaw;
        ghost.scale.setScalar(0.001);
        ghost.renderOrder = 5;

        ghost.userData.offset = offsets[i];
        ghost.userData.spawnDelay = (i < 2 ? 0.00 : 0.06) + (i % 2) * 0.03;
        ghost.userData.baseOpacity = ghostOpacity;

        squadGroup.add(ghost);
        ghosts.push(ghost);
    }

    const state = {
        group: squadGroup,
        ghosts,
        startTime: clock.getElapsedTime(),
        dashDuration,
        disposed: false,
        fadingOut: false,
        fadeStartTime: 0,
    };

    const track = () => {
        if (state.disposed) return;
        const now = clock.getElapsedTime();
        const t = now - state.startTime;

        const fade = state.fadingOut
            ? Math.max(0, 1 - (now - state.fadeStartTime) / 0.28)
            : 1;

        for (const g of ghosts) {
            const off = g.userData.offset;
            const localT = Math.max(0, Math.min(1,
                (t - g.userData.spawnDelay) / 0.12));

            const targetScale = 0.5 * localT * fade;
            g.scale.setScalar(Math.max(0.001, targetScale));

            g.position.set(
                pieceObj.position.x + off.x,
                pieceObj.position.y + 0.05,
                pieceObj.position.z + off.z
            );

            const flicker = 0.82 + 0.18 * Math.sin(t * 28 + g.userData.spawnDelay * 40);
            const alpha = g.userData.baseOpacity * fade * flicker;
            g.traverse(n => {
                if (n.isMesh && n.material) n.material.opacity = alpha;
            });
        }

        requestAnimationFrame(track);
    };
    requestAnimationFrame(track);

    return state;
}

function fadeOutKnightGhostSquad(state) {
    if (!state || state.disposed || state.fadingOut) return;
    state.fadingOut = true;
    state.fadeStartTime = clock.getElapsedTime();
    setTimeout(() => disposeKnightGhostSquad(state), 320);
}

function disposeKnightGhostSquad(state) {
    if (!state || state.disposed) return;
    state.disposed = true;
    if (state.group) {
        scene.remove(state.group);
        state.group.traverse(n => {
            if (n.geometry) n.geometry.dispose();
            if (n.material) {
                if (Array.isArray(n.material)) n.material.forEach(m => m.dispose());
                else n.material.dispose();
            }
        });
    }
}


/* ═══════════════════════════════════════════════════════════
   6.  VICTIM PUSH / BUMP ANIMATIONS
   ═══════════════════════════════════════════════════════════ */
function animateVictimPush(fromR, fromC, toR, toC, onComplete) {
    const obj = pieceObjects[`${fromR},${fromC}`];
    if (!obj) { onComplete(); return; }
    const startPos = obj.position.clone();
    const targetPos = get3DPosition(toR, toC, 0);
    const duration = 0.25;
    const startTime = clock.getElapsedTime();
    let lastSparkTime = 0;

    const baseRotY = obj.rotation.y;
    const baseRotZ = obj.rotation.z;

    const animate = () => {
        const now = clock.getElapsedTime();
        const t = Math.min((now - startTime) / duration, 1);
        const ease = x => x * (2 - x);
        obj.position.lerpVectors(startPos, targetPos, ease(t));

        obj.position.y = Math.sin(t * Math.PI) * 0.25;
        obj.rotation.y = baseRotY + t * Math.PI * 1.2;
        obj.rotation.z = baseRotZ + Math.sin(t * Math.PI * 2) * 0.30;

        if (now - lastSparkTime > 0.028) {
            lastSparkTime = now;
            spawnKnockbackSpark(obj.position);
        }

        if (t < 1) requestAnimationFrame(animate);
        else {
            obj.position.copy(targetPos);
            obj.position.y = 0;
            obj.rotation.y = baseRotY;
            obj.rotation.z = baseRotZ;
            onComplete();
        }
    };
    animate();
}

function animateVictimBump(victimR, victimC, dirR, dirC, onComplete) {
    const obj = pieceObjects[`${victimR},${victimC}`];
    if (!obj) { onComplete(); return; }
    const startPos = obj.position.clone();
    const peakPos = startPos.clone();
    peakPos.x += dirC * 0.42;
    peakPos.z += -dirR * 0.42;
    const duration = 0.22;
    const startTime = clock.getElapsedTime();

    const baseRotZ = obj.rotation.z;
    const rotDir = (dirR !== 0 ? 1 : -1);
    let sparkCooldown = 0;

    const animate = () => {
        const now = clock.getElapsedTime();
        const t = Math.min((now - startTime) / duration, 1);
        const phase = t < 0.5 ? t * 2 : (1 - t) * 2;
        obj.position.lerpVectors(startPos, peakPos, phase);

        obj.rotation.z = baseRotZ + Math.sin(t * Math.PI) * 0.32 * rotDir;

        sparkCooldown -= 0.016;
        if (t < 0.55 && sparkCooldown <= 0) {
            sparkCooldown = 0.035;
            spawnKnockbackSpark(obj.position, 0xff5544);
        }

        if (t < 1) requestAnimationFrame(animate);
        else {
            obj.position.copy(startPos);
            obj.rotation.z = baseRotZ;
            onComplete();
        }
    };
    animate();
}


/* ═══════════════════════════════════════════════════════════
   7.  QUEEN EFFECTS — HEAL + REVIVE
   ═══════════════════════════════════════════════════════════ */
function spawnHealEffect(row, col) {
    const center = get3DPosition(row, col, 0);
    const group = new THREE.Group();
    group.position.set(center.x, 0, center.z);
    scene.add(group);

    const startTime = clock.getElapsedTime();
    const DURATION = 1.0;

    const rings = [];
    for (let i = 0; i < 2; i++) {
        const mat = new THREE.MeshBasicMaterial({
            color: i === 0 ? 0x2ecc71 : 0xa8ffcc,
            transparent: true, opacity: 0, depthWrite: false,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.34, 40), mat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.04 + i * 0.008;
        group.add(ring);
        rings.push({ mesh: ring, delay: i * 0.12 });
    }

    const colMat = new THREE.MeshBasicMaterial({
        color: 0x6dffb0, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.5, 2.2, 20, 1, true), colMat);
    column.position.y = 1.1;
    group.add(column);

    const particles = [];
    for (let i = 0; i < 34; i++) {
        const pg = new THREE.SphereGeometry(0.028 + Math.random() * 0.035, 5, 5);
        const pm = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(0.36 + Math.random() * 0.08, 0.9, 0.6 + Math.random() * 0.25),
            transparent: true, opacity: 0, depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const p = new THREE.Mesh(pg, pm);
        const a = Math.random() * Math.PI * 2;
        const r = 0.08 + Math.random() * 0.34;
        p.position.set(Math.cos(a) * r, 0.05, Math.sin(a) * r);
        p.userData = {
            vel: new THREE.Vector3(Math.cos(a) * 0.25, 1.1 + Math.random() * 1.6, Math.sin(a) * 0.25),
            delay: Math.random() * 0.25,
            life: 0.6 + Math.random() * 0.45,
        };
        group.add(p);
        particles.push(p);
    }

    const loop = () => {
        const t = clock.getElapsedTime() - startTime;
        if (t >= DURATION) {
            scene.remove(group);
            group.traverse(n => {
                if (n.geometry) n.geometry.dispose();
                if (n.material) n.material.dispose();
            });
            return;
        }

        for (const r of rings) {
            const rt = Math.max(0, Math.min(1, (t - r.delay) / (DURATION - r.delay)));
            r.mesh.material.opacity = 0.85 * (1 - rt);
            r.mesh.scale.setScalar(1 + rt * 3.2);
        }

        const ct = Math.min(1, t / (DURATION * 0.6));
        colMat.opacity = 0.45 * Math.sin(Math.PI * ct);
        column.rotation.y += 0.06;

        for (const p of particles) {
            const pt = t - p.userData.delay;
            if (pt < 0 || pt > p.userData.life) { p.visible = false; continue; }
            p.visible = true;
            p.position.addScaledVector(p.userData.vel, 0.016);
            p.userData.vel.y -= 0.02;
            const lt = pt / p.userData.life;
            p.material.opacity = (1 - lt) * 0.95;
            p.scale.setScalar(1 - lt * 0.4);
        }

        requestAnimationFrame(loop);
    };
    loop();
}

function spawnReviveEffect(row, col) {
    const center = get3DPosition(row, col, 0);
    const group = new THREE.Group();
    group.position.set(center.x, 0, center.z);
    scene.add(group);

    const startTime = clock.getElapsedTime();
    const DURATION = 1.6;
    const MATERIALIZE_AT = 0.35;

    const runeGroup = new THREE.Group();
    runeGroup.position.y = 0.02;
    group.add(runeGroup);

    const runeOuter = new THREE.Mesh(
        new THREE.RingGeometry(0.62, 0.72, 64),
        new THREE.MeshBasicMaterial({
            color: 0xd9a6ff, transparent: true, opacity: 0,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
        })
    );
    runeOuter.rotation.x = -Math.PI / 2;
    runeGroup.add(runeOuter);

    const runeInner = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.47, 48),
        new THREE.MeshBasicMaterial({
            color: 0xffe27a, transparent: true, opacity: 0,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
        })
    );
    runeInner.rotation.x = -Math.PI / 2;
    runeInner.position.y = 0.004;
    runeGroup.add(runeInner);

    const spokes = [];
    const SPOKE_COUNT = 12;
    for (let i = 0; i < SPOKE_COUNT; i++) {
        const a = (i / SPOKE_COUNT) * Math.PI * 2;
        const geo = new THREE.PlaneGeometry(0.10, 0.012);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xffe27a, transparent: true, opacity: 0,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const m = new THREE.Mesh(geo, mat);
        m.position.set(Math.cos(a) * 0.55, 0.008, Math.sin(a) * 0.55);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = -a;
        runeGroup.add(m);
        spokes.push(m);
    }

    const rings = [];
    for (let i = 0; i < 3; i++) {
        const mat = new THREE.MeshBasicMaterial({
            color: i % 2 === 0 ? 0xb06cff : 0xffe27a,
            transparent: true, opacity: 0, depthWrite: false,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.30, 48), mat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05 + i * 0.006;
        group.add(ring);
        rings.push({ mesh: ring, delay: i * 0.14 });
    }

    const beamMat = new THREE.MeshBasicMaterial({
        color: 0xd9a6ff, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.62, 5.0, 32, 1, true),
        beamMat
    );
    beam.position.y = 2.5;
    group.add(beam);

    const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const core = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.16, 5.0, 20, 1, true),
        coreMat
    );
    core.position.y = 2.5;
    group.add(core);

    const haloMat = new THREE.MeshBasicMaterial({
        color: 0xffe27a, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.30, 0.46, 48), haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 4.0;
    group.add(halo);

    const haloInner = new THREE.Mesh(
        new THREE.RingGeometry(0.14, 0.20, 40),
        new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        })
    );
    haloInner.rotation.x = -Math.PI / 2;
    haloInner.position.y = 4.0;
    group.add(haloInner);

    const rays = [];
    const RAY_COUNT = 8;
    for (let i = 0; i < RAY_COUNT; i++) {
        const a = (i / RAY_COUNT) * Math.PI * 2;
        const geo = new THREE.PlaneGeometry(1.4, 0.06);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xd9a6ff, transparent: true, opacity: 0,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const m = new THREE.Mesh(geo, mat);
        m.position.set(Math.cos(a) * 0.35, 0.06, Math.sin(a) * 0.35);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = -a;
        group.add(m);
        rays.push(m);
    }

    const motes = [];
    const MOTE_COUNT = 72;
    for (let i = 0; i < MOTE_COUNT; i++) {
        const pg = new THREE.SphereGeometry(0.022 + Math.random() * 0.035, 5, 5);
        const pm = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(
                0.72 + Math.random() * 0.13, 0.95, 0.6 + Math.random() * 0.3
            ),
            transparent: true, opacity: 0, depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const p = new THREE.Mesh(pg, pm);
        const a = Math.random() * Math.PI * 2;
        const r = 0.05 + Math.random() * 0.45;
        p.position.set(Math.cos(a) * r, 0.05, Math.sin(a) * r);
        p.userData = {
            baseAngle: a,
            baseRadius: r,
            angularSpeed: 1.6 + Math.random() * 2.4,
            riseSpeed: 1.2 + Math.random() * 2.2,
            delay: Math.random() * 0.35,
            life: 0.8 + Math.random() * 0.55,
        };
        group.add(p);
        motes.push(p);
    }

    const sparkles = [];
    const SPARKLE_COUNT = 28;
    for (let i = 0; i < SPARKLE_COUNT; i++) {
        const pg = new THREE.SphereGeometry(0.02 + Math.random() * 0.025, 4, 4);
        const pm = new THREE.MeshBasicMaterial({
            color: 0xffe27a, transparent: true, opacity: 0, depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const p = new THREE.Mesh(pg, pm);
        const a = Math.random() * Math.PI * 2;
        const r = 0.15 + Math.random() * 0.5;
        p.position.set(Math.cos(a) * r, 3.2 + Math.random() * 0.8, Math.sin(a) * r);
        p.userData = {
            fallSpeed: 2.4 + Math.random() * 2.0,
            delay: Math.random() * 0.5,
            life: 1.0,
        };
        group.add(p);
        sparkles.push(p);
    }

    const flashMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const flash = new THREE.Mesh(new THREE.CircleGeometry(0.8, 32), flashMat);
    flash.rotation.x = -Math.PI / 2;
    flash.position.y = 0.08;
    group.add(flash);

    const flashSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 20, 20),
        new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
            blending: THREE.AdditiveBlending,
        })
    );
    flashSphere.position.y = 0.5;
    group.add(flashSphere);

    const loop = () => {
        const t = clock.getElapsedTime() - startTime;
        if (t >= DURATION) {
            scene.remove(group);
            group.traverse(n => {
                if (n.geometry) n.geometry.dispose();
                if (n.material) n.material.dispose();
            });
            return;
        }
        const prog = t / DURATION;

        const runeFade = Math.min(t / 0.3, 1) * Math.max(0, 1 - prog * 1.1);
        runeOuter.material.opacity = 0.85 * runeFade;
        runeInner.material.opacity = 0.95 * runeFade;
        for (const s of spokes) s.material.opacity = 0.75 * runeFade;
        runeGroup.rotation.y += 0.035;

        const beamEnvelope = Math.sin(Math.PI * Math.min(prog / 0.8, 1));
        beamMat.opacity = 0.55 * beamEnvelope;
        coreMat.opacity = 0.95 * beamEnvelope;
        beam.rotation.y += 0.025;
        core.rotation.y -= 0.06;

        const haloProg = Math.min(t / 0.75, 1);
        const haloY = 4.0 * (1 - haloProg) + 0.05;
        halo.position.y = haloY;
        haloInner.position.y = haloY;
        halo.material.opacity = 0.9 * Math.sin(Math.PI * Math.min(haloProg * 1.2, 1));
        haloInner.material.opacity = 1.0 * Math.sin(Math.PI * Math.min(haloProg * 1.2, 1));
        const haloScale = 1 + haloProg * 0.6;
        halo.scale.setScalar(haloScale);
        haloInner.scale.setScalar(haloScale);

        const rayAlpha = Math.max(0, 1 - prog * 1.4) * Math.min(t / 0.2, 1);
        for (const m of rays) m.material.opacity = 0.55 * rayAlpha;
        const raySpin = t * 0.6;
        for (let i = 0; i < rays.length; i++) {
            const a = (i / rays.length) * Math.PI * 2 + raySpin;
            rays[i].position.set(Math.cos(a) * 0.35, 0.06, Math.sin(a) * 0.35);
            rays[i].rotation.z = -a;
        }

        for (const r of rings) {
            const rt = Math.max(0, Math.min(1, (t - r.delay) / (DURATION - r.delay)));
            r.mesh.material.opacity = 0.85 * (1 - rt);
            r.mesh.scale.setScalar(1 + rt * 5.0);
        }

        for (const p of motes) {
            const pt = t - p.userData.delay;
            if (pt < 0 || pt > p.userData.life) { p.visible = false; continue; }
            p.visible = true;
            const u = pt / p.userData.life;
            const angle = p.userData.baseAngle + pt * p.userData.angularSpeed;
            const r = p.userData.baseRadius * (1 - u * 0.3);
            p.position.set(
                Math.cos(angle) * r,
                0.05 + pt * p.userData.riseSpeed,
                Math.sin(angle) * r
            );
            p.material.opacity = (1 - u) * 0.95;
            p.scale.setScalar(1 - u * 0.35);
        }

        for (const s of sparkles) {
            const st = t - s.userData.delay;
            if (st < 0 || st > s.userData.life) { s.visible = false; continue; }
            s.visible = true;
            s.position.y -= s.userData.fallSpeed * 0.016;
            const u = st / s.userData.life;
            s.material.opacity = (1 - u) * 0.9;
            s.scale.setScalar(1 - u * 0.3);
            if (s.position.y < 0.05) s.visible = false;
        }

        const mf = Math.max(0, 1 - Math.abs(t - MATERIALIZE_AT) / 0.25);
        flash.material.opacity = 0.9 * mf;
        flash.scale.setScalar(1 + (1 - mf) * 1.5);
        flashSphere.material.opacity = 0.85 * mf;
        flashSphere.scale.setScalar(1 + (1 - mf) * 2.2);

        requestAnimationFrame(loop);
    };
    loop();
}


/* ═══════════════════════════════════════════════════════════
   8.  CANNON / EXPLOSION VISUALS
   ═══════════════════════════════════════════════════════════ */
function fireAreaCannonVisual(centerPos, targets, damage, callback) {
    playSFX('explosion');
    playSFX('skill');

    if (!window._domainShake) window._domainShake = { intensity: 0 };
    const shakeHandle = window._domainShake;
    const shakeStart = clock.getElapsedTime();
    const SHAKE_DURATION = 0.65;
    const origShakeIntensity = shakeHandle.intensity;
    shakeHandle.intensity = Math.max(origShakeIntensity, 0.32);

    const boomGroup = new THREE.Group();
    boomGroup.position.copy(centerPos);
    boomGroup.position.y += 0.35;
    scene.add(boomGroup);

    const coreGeo = new THREE.SphereGeometry(0.9, 24, 24);
    const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.scale.setScalar(0.1);
    boomGroup.add(core);

    const mainGeo = new THREE.SphereGeometry(1.4, 24, 24);
    const mainMat = new THREE.MeshBasicMaterial({
        color: 0x7ac8ff, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const main = new THREE.Mesh(mainGeo, mainMat);
    main.scale.setScalar(0.1);
    boomGroup.add(main);

    const outerGeo = new THREE.SphereGeometry(2.2, 20, 20);
    const outerMat = new THREE.MeshBasicMaterial({
        color: 0x4fd4ff, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const outer = new THREE.Mesh(outerGeo, outerMat);
    outer.scale.setScalar(0.1);
    boomGroup.add(outer);

    const groundRings = [];
    for (let i = 0; i < 4; i++) {
        const rGeo = new THREE.RingGeometry(0.3, 0.5, 48);
        const rMat = new THREE.MeshBasicMaterial({
            color: i % 2 === 0 ? 0xffffff : 0x7ac8ff,
            transparent: true, opacity: 0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const ring = new THREE.Mesh(rGeo, rMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(centerPos);
        ring.position.y = 0.06 + i * 0.004;
        scene.add(ring);
        groundRings.push({ mesh: ring, mat: rMat, delay: i * 0.06 });
    }

    const lightningArcs = [];
    const ARC_COUNT = 10;
    for (let i = 0; i < ARC_COUNT; i++) {
        const angle = (i / ARC_COUNT) * Math.PI * 2 + Math.random() * 0.3;
        const arcLength = 1.6 + Math.random() * 1.4;

        const points = [new THREE.Vector3(0, 0.1, 0)];
        const segs = 7;
        for (let s = 1; s <= segs; s++) {
            const t = s / segs;
            const jitter = 0.28 * (1 - t);
            const p = new THREE.Vector3(
                Math.cos(angle) * arcLength * t + (Math.random() - 0.5) * jitter,
                0.1 + Math.random() * 0.25 + t * 0.4,
                Math.sin(angle) * arcLength * t + (Math.random() - 0.5) * jitter
            );
            points.push(p);
        }

        const curve = new THREE.CatmullRomCurve3(points);
        const tubeGeo = new THREE.TubeGeometry(curve, 20, 0.035, 5, false);
        const tubeMat = new THREE.MeshBasicMaterial({
            color: 0xd8f4ff, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const tube = new THREE.Mesh(tubeGeo, tubeMat);
        boomGroup.add(tube);
        lightningArcs.push({ mesh: tube, mat: tubeMat, delay: i * 0.025 });
    }

    const shards = [];
    for (let i = 0; i < 60; i++) {
        const sg = new THREE.TetrahedronGeometry(0.06 + Math.random() * 0.10, 0);
        const sm = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(
                0.55 + Math.random() * 0.08, 0.9, 0.55 + Math.random() * 0.35
            ),
            transparent: true, opacity: 1,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const shard = new THREE.Mesh(sg, sm);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        const r = 0.5 + Math.random() * 0.5;
        shard.position.set(
            Math.sin(phi) * Math.cos(theta) * r,
            Math.cos(phi) * r * 0.5 + 0.4,
            Math.sin(phi) * Math.sin(theta) * r
        );
        shard.userData.vel = new THREE.Vector3(
            (Math.random() - 0.5) * 11,
            Math.random() * 8 + 3,
            (Math.random() - 0.5) * 11
        );
        shard.userData.spin = new THREE.Vector3(
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20,
        );
        boomGroup.add(shard);
        shards.push(shard);
    }

    const sparks = [];
    for (let i = 0; i < 80; i++) {
        const pg = new THREE.SphereGeometry(0.04 + Math.random() * 0.05, 5, 5);
        const pm = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(0.55 + Math.random() * 0.1, 1, 0.7 + Math.random() * 0.3),
            transparent: true, opacity: 1,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const p = new THREE.Mesh(pg, pm);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        const r = 0.3 + Math.random() * 0.6;
        p.position.set(
            Math.sin(phi) * Math.cos(theta) * r,
            Math.cos(phi) * r * 0.5 + 0.4,
            Math.sin(phi) * Math.sin(theta) * r
        );
        p.userData.vel = new THREE.Vector3(
            (Math.random() - 0.5) * 13,
            Math.random() * 9 + 2,
            (Math.random() - 0.5) * 13
        );
        boomGroup.add(p);
        sparks.push(p);
    }

    const markerGroup = new THREE.Group();
    scene.add(markerGroup);
    const targetMarkers = [];
    for (const target of targets) {
        const pos = get3DPosition(target.r, target.c, 0.3);

        const beaconGeo = new THREE.CylinderGeometry(0.06, 0.16, 1.6, 10, 1, true);
        const beaconMat = new THREE.MeshBasicMaterial({
            color: 0x7ac8ff, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
            side: THREE.DoubleSide,
        });
        const beacon = new THREE.Mesh(beaconGeo, beaconMat);
        beacon.position.set(pos.x, 0.8, pos.z);
        markerGroup.add(beacon);

        const plateGeo = new THREE.PlaneGeometry(0.9, 0.9);
        const plateMat = new THREE.MeshBasicMaterial({
            color: 0xff3366, transparent: true, opacity: 0,
            side: THREE.DoubleSide, depthWrite: false,
        });
        const plate = new THREE.Mesh(plateGeo, plateMat);
        plate.rotation.x = -Math.PI / 2;
        plate.position.set(pos.x, 0.06, pos.z);
        markerGroup.add(plate);

        const ringGeo = new THREE.RingGeometry(0.35, 0.45, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xd8f4ff, transparent: true, opacity: 0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(pos.x, 0.07, pos.z);
        markerGroup.add(ring);

        targetMarkers.push({ beacon, beaconMat, plate, plateMat, ring, ringMat });
    }

    const flashEl = document.createElement('div');
    flashEl.style.cssText = `
        position: fixed; inset: 0; pointer-events: none;
        background: radial-gradient(circle at 50% 50%,
            rgba(255,255,255,0.95) 0%,
            rgba(122,200,255,0.7) 22%,
            rgba(79,212,255,0.35) 45%,
            transparent 72%);
        opacity: 0; z-index: 250;
        transition: opacity 0.06s ease-out;
    `;
    document.body.appendChild(flashEl);

    const boomStart = clock.getElapsedTime();
    const DURATION = 0.95;

    const animateBoom = () => {
        const now = clock.getElapsedTime();
        const bt = (now - boomStart) / DURATION;

        if (bt >= 1) {
            scene.remove(boomGroup);
            scene.remove(markerGroup);
            boomGroup.traverse(n => {
                if (n.geometry) n.geometry.dispose();
                if (n.material) {
                    if (Array.isArray(n.material)) n.material.forEach(m => m.dispose());
                    else n.material.dispose();
                }
            });
            markerGroup.traverse(n => {
                if (n.geometry) n.geometry.dispose();
                if (n.material) {
                    if (Array.isArray(n.material)) n.material.forEach(m => m.dispose());
                    else n.material.dispose();
                }
            });
            for (const r of groundRings) {
                if (r.mesh.geometry) r.mesh.geometry.dispose();
                if (r.mat) r.mat.dispose();
            }
            if (flashEl.parentNode) flashEl.remove();

            if (shakeHandle === window._domainShake) {
                shakeHandle.intensity = origShakeIntensity;
            }

            setTimeout(callback, 320);
            return;
        }

        if (bt < 0.25) {
            flashEl.style.opacity = String(1 - bt / 0.25);
        } else {
            flashEl.style.opacity = '0';
        }

        const shakeElapsed = now - shakeStart;
        if (shakeElapsed < SHAKE_DURATION) {
            const ramp = Math.max(0, 1 - shakeElapsed / SHAKE_DURATION);
            shakeHandle.intensity = Math.max(
                shakeHandle.intensity,
                origShakeIntensity + 0.32 * ramp
            );
        } else {
            shakeHandle.intensity = origShakeIntensity;
        }

        const s = 1 + bt * 9;
        core.scale.setScalar(s);
        coreMat.opacity = 0.95 * (1 - bt * 1.6);
        main.scale.setScalar(s * 1.5);
        mainMat.opacity = 0.95 * (1 - bt * 1.3);
        outer.scale.setScalar(s * 2.4);
        outerMat.opacity = 0.40 * (1 - bt * 1.1);

        for (const r of groundRings) {
            const rt = Math.max(0, (bt - r.delay) / 0.7);
            if (rt >= 1) { r.mat.opacity = 0; continue; }
            const eased = 1 - Math.pow(1 - rt, 3);
            r.mesh.scale.setScalar(1 + eased * 9);
            r.mat.opacity = 0.9 * (1 - rt);
        }

        for (const arc of lightningArcs) {
            const at = Math.max(0, (bt - arc.delay) / 0.55);
            if (at >= 1) { arc.mat.opacity = 0; continue; }
            const flash = Math.sin(at * Math.PI * 3.5);
            arc.mat.opacity = Math.abs(flash) * 0.95 * (1 - at * 0.7);
            arc.mesh.scale.setScalar(1 + at * 0.5);
        }

        for (const shard of shards) {
            shard.position.addScaledVector(shard.userData.vel, 0.022);
            shard.userData.vel.y -= 0.28;
            shard.userData.vel.multiplyScalar(0.97);
            shard.rotation.x += shard.userData.spin.x * 0.02;
            shard.rotation.y += shard.userData.spin.y * 0.02;
            shard.rotation.z += shard.userData.spin.z * 0.02;
            shard.material.opacity = Math.max(0, 1 - bt * 1.15);
            shard.scale.setScalar(Math.max(0.1, 1 - bt * 0.45));
        }

        for (const p of sparks) {
            p.position.addScaledVector(p.userData.vel, 0.02);
            p.userData.vel.y -= 0.22;
            p.userData.vel.multiplyScalar(0.96);
            p.material.opacity = Math.max(0, 1 - bt * 1.4);
            p.scale.setScalar(Math.max(0.1, 1 - bt * 0.5));
        }

        for (let i = 0; i < targetMarkers.length; i++) {
            const tm = targetMarkers[i];
            const tt = Math.min(1, bt / 0.55);
            tm.beaconMat.opacity = Math.max(0, 1 - tt) * 0.9;
            tm.beacon.scale.setScalar(0.6 + tt * 1.4);
            tm.plateMat.opacity = Math.max(0, 1 - bt * 1.1) * 0.55;
            tm.ringMat.opacity = Math.max(0, 1 - bt * 1.2) * 0.95;
            tm.ring.scale.setScalar(1 + bt * 5);
        }

        requestAnimationFrame(animateBoom);
    };
    animateBoom();
}

function createEmptyExplosion(position) {
    const boomGroup = new THREE.Group();
    boomGroup.position.copy(position);
    boomGroup.position.y += 0.3;
    scene.add(boomGroup);
    const mainBoomGeo = new THREE.SphereGeometry(0.6, 16, 16);
    const mainBoomMat = new THREE.MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.8, depthWrite: false });
    const mainBoom = new THREE.Mesh(mainBoomGeo, mainBoomMat);
    mainBoom.scale.set(0.1, 0.1, 0.1);
    boomGroup.add(mainBoom);
    const outerBoomGeo = new THREE.SphereGeometry(1.0, 16, 16);
    const outerBoomMat = new THREE.MeshBasicMaterial({ color: 0x88ddff, transparent: true, opacity: 0.3, depthWrite: false });
    const outerBoom = new THREE.Mesh(outerBoomGeo, outerBoomMat);
    outerBoom.scale.set(0.1, 0.1, 0.1);
    boomGroup.add(outerBoom);
    const flashGeo = new THREE.SphereGeometry(0.25, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    boomGroup.add(flash);
    const particleCount = 40;
    const particles = [];
    for (let i = 0; i < particleCount; i++) {
        const pGeo = new THREE.SphereGeometry(0.05, 4, 4);
        const pMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(0.55 + Math.random() * 0.1, 1, 0.6),
            transparent: true, opacity: 1, depthWrite: false
        });
        const p = new THREE.Mesh(pGeo, pMat);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        const r = 0.3 + Math.random() * 0.4;
        p.position.set(Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r * 0.5 + 0.3, Math.sin(phi) * Math.sin(theta) * r);
        p.userData.vel = new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4 + 1.5, (Math.random() - 0.5) * 5);
        p.userData.life = 1;
        boomGroup.add(p);
        particles.push(p);
    }
    const boomStart = clock.getElapsedTime();
    const animateBoom = () => {
        const bt = (clock.getElapsedTime() - boomStart) / 0.5;
        if (bt >= 1) {
            scene.remove(boomGroup);
            boomGroup.traverse(n => {
                if (n.geometry) n.geometry.dispose();
                if (n.material) {
                    if (Array.isArray(n.material)) n.material.forEach(m => m.dispose());
                    else n.material.dispose();
                }
            });
            return;
        }
        const s = 1 + bt * 7;
        mainBoom.scale.setScalar(s);
        mainBoom.material.opacity = 0.8 * (1 - bt * 1.2);
        outerBoom.scale.setScalar(s * 2.0);
        outerBoom.material.opacity = 0.3 * (1 - bt * 1.1);
        flash.scale.setScalar(1 + bt * 2.5);
        flash.material.opacity = 1 - bt * 2;
        for (const p of particles) {
            p.position.add(p.userData.vel.clone().multiplyScalar(0.025));
            p.userData.vel.y -= 0.05;
            p.material.opacity = 1 - bt * 1.2;
            p.scale.setScalar(1 - bt * 0.3);
        }
        requestAnimationFrame(animateBoom);
    };
    animateBoom();
}

function flyCannonball(startPos, endPos, callback) {
    const projGeo = new THREE.SphereGeometry(0.24, 20, 20);
    const projMat = new THREE.MeshStandardMaterial({
        color: 0xaef1ff,
        emissive: 0x4fd4ff,
        emissiveIntensity: 2.2,
        roughness: 0.15,
        metalness: 0.4,
    });
    const proj = new THREE.Mesh(projGeo, projMat);
    proj.position.copy(startPos);
    proj.castShadow = true;
    scene.add(proj);

    const coreGeo = new THREE.SphereGeometry(0.15, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    scene.add(core);

    const glowGeo = new THREE.SphereGeometry(0.55, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0x7ac8ff, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    scene.add(glow);

    const arcs = [];
    for (let i = 0; i < 6; i++) {
        const arcGeo = new THREE.TorusGeometry(0.32 + Math.random() * 0.08, 0.012, 6, 18);
        const arcMat = new THREE.MeshBasicMaterial({
            color: 0xd8f4ff, transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const arc = new THREE.Mesh(arcGeo, arcMat);
        arc.userData = {
            axis: new THREE.Vector3(
                Math.random() - 0.5,
                Math.random() - 0.5,
                Math.random() - 0.5
            ).normalize(),
            spinSpeed: 4 + Math.random() * 4,
        };
        scene.add(arc);
        arcs.push(arc);
    }

    const trailCount = 40;
    const trail = [];
    for (let i = 0; i < trailCount; i++) {
        const pGeo = new THREE.SphereGeometry(0.03 + Math.random() * 0.03, 5, 5);
        const pMat = new THREE.MeshBasicMaterial({
            color: Math.random() < 0.5 ? 0x7ac8ff : 0xffffff,
            transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const p = new THREE.Mesh(pGeo, pMat);
        p.position.copy(startPos);
        p.userData.life = 0;
        scene.add(p);
        trail.push(p);
    }

    const helixCount = 30;
    const helix = [];
    for (let i = 0; i < helixCount; i++) {
        const pGeo = new THREE.SphereGeometry(0.022, 5, 5);
        const pMat = new THREE.MeshBasicMaterial({
            color: 0xb8ecff, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const p = new THREE.Mesh(pGeo, pMat);
        p.userData = {
            offset: (i / helixCount) * Math.PI * 4,
            radius: 0.35 + Math.random() * 0.15,
            delay: i * 0.025,
        };
        scene.add(p);
        helix.push(p);
    }

    const duration = 0.55;
    const startTime = clock.getElapsedTime();
    let trailIndex = 0;

    const animateProj = () => {
        const now = clock.getElapsedTime();
        const t = Math.min((now - startTime) / duration, 1);
        const easeT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const height = Math.sin(t * Math.PI) * 2.6;
        const currentPos = new THREE.Vector3().lerpVectors(startPos, endPos, easeT);
        currentPos.y += height;

        proj.position.copy(currentPos);
        core.position.copy(currentPos);
        glow.position.copy(currentPos);

        proj.rotation.x += 0.28;
        proj.rotation.z += 0.22;
        core.scale.setScalar(0.9 + Math.sin(now * 40) * 0.15);
        glow.scale.setScalar(1 + t * 0.8);

        const spinAngle = now * 12;
        for (const arc of arcs) {
            arc.position.copy(currentPos);
            arc.quaternion.setFromAxisAngle(arc.userData.axis, spinAngle * arc.userData.spinSpeed * 0.3);
            arc.scale.setScalar(1 + Math.sin(now * 25) * 0.15);
        }

        if (t < 0.98 && Math.floor(t * 40) > trailIndex) {
            trailIndex = Math.floor(t * 40);
            const idx = trailIndex % trailCount;
            const p = trail[idx];
            p.position.copy(currentPos);
            p.userData.life = 1.0;
            p.scale.setScalar(1 + Math.random() * 0.5);
            p.material.opacity = 0.95;
        }
        for (const p of trail) {
            if (p.userData.life > 0) {
                p.userData.life -= 0.028;
                p.position.y += 0.012;
                p.scale.setScalar(Math.max(0.1, p.userData.life));
                p.material.opacity = Math.max(0, p.userData.life * 0.9);
            } else p.visible = false;
        }

        for (const p of helix) {
            const ht = t - p.userData.delay;
            if (ht < 0 || ht > 0.7) { p.material.opacity = 0; continue; }
            const fade = Math.sin((ht / 0.7) * Math.PI);
            const behind = Math.max(0, 1 - ht * 2.2);
            const angle = p.userData.offset + now * 20;
            p.position.copy(currentPos);
            p.position.x += Math.cos(angle) * p.userData.radius * behind;
            p.position.z += Math.sin(angle) * p.userData.radius * behind;
            p.position.y += (Math.random() - 0.5) * 0.1 * behind;
            p.material.opacity = fade * 0.95;
        }

        if (t < 1) requestAnimationFrame(animateProj);
        else {
            for (const p of trail) scene.remove(p);
            for (const p of helix) scene.remove(p);
            for (const a of arcs) { scene.remove(a); a.geometry.dispose(); a.material.dispose(); }
            scene.remove(proj); scene.remove(core); scene.remove(glow);
            proj.geometry.dispose(); proj.material.dispose();
            core.geometry.dispose(); core.material.dispose();
            glow.geometry.dispose(); glow.material.dispose();
            callback();
        }
    };
    animateProj();
}

function fireCannonVisual(fR, fC, tR, tC, damage, callback) {
    const startPos = get3DPosition(fR, fC, 0.6);
    const endPos = get3DPosition(tR, tC, 0.6);
    const projGeo = new THREE.SphereGeometry(0.22, 16, 16);
    const projMat = new THREE.MeshStandardMaterial({ color: 0xff5500, emissive: 0xff3300, emissiveIntensity: 0.8, roughness: 0.2 });
    const proj = new THREE.Mesh(projGeo, projMat);
    proj.position.copy(startPos);
    proj.castShadow = true;
    scene.add(proj);
    const glowGeo = new THREE.SphereGeometry(0.35, 12, 12);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.25, depthWrite: false });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.copy(startPos);
    scene.add(glow);
    const trailCount = 25;
    const trailParticles = [];
    for (let i = 0; i < trailCount; i++) {
        const pGeo = new THREE.SphereGeometry(0.04, 4, 4);
        const pMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.6, depthWrite: false });
        const p = new THREE.Mesh(pGeo, pMat);
        p.position.copy(startPos);
        p.userData.life = 0;
        scene.add(p);
        trailParticles.push(p);
    }
    const duration = 0.5;
    const startTime = clock.getElapsedTime();
    let trailIndex = 0;
    const animateProj = () => {
        const now = clock.getElapsedTime();
        const t = Math.min((now - startTime) / duration, 1);
        const easeT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const height = Math.sin(t * Math.PI) * 2.5;
        const currentPos = new THREE.Vector3().lerpVectors(startPos, endPos, easeT);
        currentPos.y += height;
        proj.position.copy(currentPos);
        glow.position.copy(currentPos);
        glow.scale.setScalar(1 + t * 0.6);
        proj.rotation.x += 0.2;
        proj.rotation.z += 0.15;
        if (t < 0.95 && Math.floor(t * 30) > trailIndex) {
            trailIndex = Math.floor(t * 30);
            const idx = trailIndex % trailCount;
            const p = trailParticles[idx];
            p.position.copy(currentPos);
            p.userData.life = 1.0;
            p.scale.setScalar(1);
            p.material.opacity = 0.7;
        }
        for (const p of trailParticles) {
            if (p.userData.life > 0) {
                p.userData.life -= 0.025;
                p.position.y += 0.01;
                p.scale.setScalar(Math.max(0.1, p.userData.life));
                p.material.opacity = Math.max(0, p.userData.life * 0.7);
            } else p.visible = false;
        }
        if (t < 1) requestAnimationFrame(animateProj);
        else {
            const boomGroup = new THREE.Group();
            boomGroup.position.copy(endPos);
            boomGroup.position.y += 0.3;
            scene.add(boomGroup);
            const mainBoomGeo = new THREE.SphereGeometry(0.8, 16, 16);
            const mainBoomMat = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.9, depthWrite: false });
            const mainBoom = new THREE.Mesh(mainBoomGeo, mainBoomMat);
            mainBoom.scale.set(0.1, 0.1, 0.1);
            boomGroup.add(mainBoom);
            const outerBoomGeo = new THREE.SphereGeometry(1.2, 16, 16);
            const outerBoomMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.4, depthWrite: false });
            const outerBoom = new THREE.Mesh(outerBoomGeo, outerBoomMat);
            outerBoom.scale.set(0.1, 0.1, 0.1);
            boomGroup.add(outerBoom);
            const flashGeo = new THREE.SphereGeometry(0.3, 8, 8);
            const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false });
            const flash = new THREE.Mesh(flashGeo, flashMat);
            boomGroup.add(flash);
            const particleCount = 60;
            const particles = [];
            for (let i = 0; i < particleCount; i++) {
                const pGeo = new THREE.SphereGeometry(0.06, 4, 4);
                const pMat = new THREE.MeshBasicMaterial({
                    color: new THREE.Color().setHSL(0.05 + Math.random() * 0.1, 1, 0.5),
                    transparent: true, opacity: 1, depthWrite: false
                });
                const p = new THREE.Mesh(pGeo, pMat);
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.random() * Math.PI;
                const r = 0.5 + Math.random() * 0.5;
                p.position.set(Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r * 0.5 + 0.3, Math.sin(phi) * Math.sin(theta) * r);
                p.userData.vel = new THREE.Vector3((Math.random() - 0.5) * 7, Math.random() * 5 + 2, (Math.random() - 0.5) * 7);
                p.userData.life = 1;
                boomGroup.add(p);
                particles.push(p);
            }
            const boomStart = clock.getElapsedTime();
            const animateBoom = () => {
                const bt = (clock.getElapsedTime() - boomStart) / 0.6;
                if (bt >= 1) {
                    scene.remove(boomGroup);
                    boomGroup.traverse(n => {
                        if (n.geometry) n.geometry.dispose();
                        if (n.material) {
                            if (Array.isArray(n.material)) n.material.forEach(m => m.dispose());
                            else n.material.dispose();
                        }
                    });
                    for (const p of trailParticles) {
                        scene.remove(p);
                        if (p.geometry) p.geometry.dispose();
                        if (p.material) p.material.dispose();
                    }
                    scene.remove(proj);
                    scene.remove(glow);
                    proj.geometry.dispose(); proj.material.dispose();
                    glow.geometry.dispose(); glow.material.dispose();
                    showDamageEffect(tR, tC, damage);
                    setTimeout(callback, 300);
                    return;
                }
                const s = 1 + bt * 9;
                mainBoom.scale.setScalar(s);
                mainBoom.material.opacity = 0.9 * (1 - bt * 1.2);
                outerBoom.scale.setScalar(s * 2.0);
                outerBoom.material.opacity = 0.4 * (1 - bt * 1.1);
                flash.scale.setScalar(1 + bt * 3);
                flash.material.opacity = 1 - bt * 2;
                for (const p of particles) {
                    p.position.add(p.userData.vel.clone().multiplyScalar(0.02));
                    p.userData.vel.y -= 0.04;
                    p.material.opacity = 1 - bt * 1.2;
                    p.scale.setScalar(1 - bt * 0.3);
                }
                requestAnimationFrame(animateBoom);
            };
            animateBoom();
        }
    };
    animateProj();
}

function createCrossExplosion(row, col, damage, selfDamage, callback) {
    playSFX('explosion');

    const centerPos = get3DPosition(row, col, 0.3);
    const boomGroup = new THREE.Group();
    boomGroup.position.copy(centerPos);
    scene.add(boomGroup);
    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    const particles = [];
    for (const [dr, dc] of directions) {
        for (let i = 0; i < 6; i++) {
            const pGeo = new THREE.SphereGeometry(0.09, 6, 6);
            const pMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.9, depthWrite: false });
            const p = new THREE.Mesh(pGeo, pMat);
            p.position.set(dr * 0.08, (Math.random() - 0.5) * 0.08, dc * 0.08);
            const speed = 8 + Math.random() * 4;
            const angle = (Math.random() - 0.5) * 0.15;
            const dirX = dr * Math.cos(angle) - dc * Math.sin(angle);
            const dirZ = dr * Math.sin(angle) + dc * Math.cos(angle);
            p.userData.vel = new THREE.Vector3(dirX * speed, Math.random() * 2 + 1, dirZ * speed);
            p.userData.life = 1;
            boomGroup.add(p);
            particles.push(p);
        }
    }
    const flashGeo = new THREE.SphereGeometry(0.7, 12, 12);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffff88, transparent: true, opacity: 1, depthWrite: false });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.scale.set(0.1, 0.1, 0.1);
    boomGroup.add(flash);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.9, depthWrite: false });
    const beamLen = 0.5;
    const beamThick = 0.1;
    for (const [dr, dc] of directions) {
        const beam = new THREE.Mesh(
            new THREE.BoxGeometry(dr !== 0 ? beamLen * 2 : beamThick, 0.06, dc !== 0 ? beamLen * 2 : beamThick),
            beamMat
        );
        beam.position.set(dr * beamLen * 0.5, 0.08, dc * beamLen * 0.5);
        boomGroup.add(beam);
    }
    const piece = gameState.getPiece(row, col);
    const color = piece?.color;
    const enemyColor = color === 'white' ? 'black' : 'white';
    const targets = [];
    for (const [dr, dc] of directions) {
        const tr = row + dr, tc = col + dc;
        if (gameState.isInBounds(tr, tc)) {
            const target = gameState.getPiece(tr, tc);
            if (target && target.color === enemyColor) targets.push({ r: tr, c: tc });
        }
    }
    for (const t of targets) {
        const p = gameState.getPiece(t.r, t.c);
        if (p) {
            p.hp -= damage;
            if (p.hp <= 0) gameState.board[t.r][t.c] = null;
            showFloatingDamage(t.r, t.c, damage);
        }
    }
    const startTime = clock.getElapsedTime();
    const duration = 0.6;
    const animateBoom = () => {
        const bt = (clock.getElapsedTime() - startTime) / duration;
        if (bt >= 1) {
            scene.remove(boomGroup);
            for (const t of targets) {
                const key = `${t.r},${t.c}`;
                if (!gameState.getPiece(t.r, t.c) && pieceObjects[key]) {
                    piecesGroup.remove(pieceObjects[key]);
                    delete pieceObjects[key];
                }
            }
            callback();
            return;
        }
        flash.scale.setScalar(1 + bt * 8);
        flash.material.opacity = 1 - bt * 1.5;
        boomGroup.children.forEach(child => {
            if (child.isMesh && child !== flash && child.material) {
                child.material.opacity = 0.9 * (1 - bt * 0.9);
                child.scale.setScalar(1 + bt * 2);
            }
        });
        for (const p of particles) {
            p.position.add(p.userData.vel.clone().multiplyScalar(0.025));
            p.userData.vel.y -= 0.07;
            p.material.opacity = 1 - bt * 1.3;
            p.scale.setScalar(1 - bt * 0.2);
        }
        requestAnimationFrame(animateBoom);
    };
    animateBoom();
}


/* ═══════════════════════════════════════════════════════════
   9.  DOMAIN EXPANSION — GLOW OUTLINES
   ═══════════════════════════════════════════════════════════ */
function buildDomainGlowOutline(targetObj, color, thickness = 1.10) {
    const added = [];
    if (!targetObj) return added;
    targetObj.traverse(n => {
        if (!n.isMesh) return;
        if (n.userData.isAir) return;
        if (!n.geometry) return;
        if (n.material && n.material.transparent && n.material.opacity === 0) return;

        const glowMat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.85,
            side: THREE.BackSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const outline = new THREE.Mesh(n.geometry, glowMat);
        outline.position.copy(n.position);
        outline.quaternion.copy(n.quaternion);
        outline.scale.copy(n.scale).multiplyScalar(thickness);
        outline.userData._domainGlow = true;
        outline.renderOrder = 998;
        if (n.parent) n.parent.add(outline);
        added.push(outline);
    });
    return added;
}

function disposeDomainGlowOutlines(outlines) {
    if (!outlines) return;
    for (const o of outlines) {
        if (o.parent) o.parent.remove(o);
        if (o.material && o.material.dispose) o.material.dispose();
    }
    outlines.length = 0;
}


/* ═══════════════════════════════════════════════════════════
   10.  DOMAIN EXPANSION CINEMATIC
   ═══════════════════════════════════════════════════════════ */
function startDomainExpansion(color, checker) {
    isAnimating = true;

    const king = gameState.findKing(color);
    if (!king) {
        showVsScreen(color, checker);
        return;
    }

    const kingPos = get3DPosition(king.r, king.c, 0);
    const t0 = clock.getElapsedTime();

    const isWhiteDomain = (color === 'white');

    const THEME = isWhiteDomain ? {
        DISC: 0xc8bca0, WAVE: 0xd4c9a8, RIM: 0x9a7a2a, HAZE: 0xb09a58,
        WAVE2: 0x4a7a9c,
        BLADE_BODY: 0xc0b8a0, BLADE_SEAM: 0x8a6a20,
        BLADE_AURA: 0xa88830, BLADE_CORE: 0xb0a078,
        GROUND_IMPACT: 0xa88830, GROUND_RING: 0x8a6a20,
        RUNE_A: 0xa88830, RUNE_B: 0x8a6a20,
        CHARGE_A: 0xa88830, CHARGE_B: 0xb0a078,
        PILLAR_BODY: 0x8a8680, PILLAR_RIM: 0x8a6a20,
        DOME_OUTER: 0xa89e8c, DOME_INNER: 0x9a7a2a, DOME_RIM: 0x8a6a20,
        LIGHTNING: 0xb0a078,
        SHARD_A: 0xb0a078, SHARD_B: 0x8a6a20,
        TINT: new THREE.Color(0xb0a078),
        KING_GLOW: 0xc9a44a,
        CHECKER_GLOW: 0xd94868,
        VIGNETTE: 'radial-gradient(circle at 50% 50%,'
            + 'rgba(230,220,190,0) 28%,'
            + 'rgba(200,180,140,0.35) 68%,'
            + 'rgba(180,160,120,0.75) 100%)',
    } : {
        DISC: 0x000000, WAVE: 0x000000, RIM: 0x9b4ddb, HAZE: 0x6a2a9a,
        WAVE2: 0xc44dff,
        BLADE_BODY: 0x000000, BLADE_SEAM: 0x8b0033,
        BLADE_AURA: 0xff1e4a, BLADE_CORE: 0xff5577,
        GROUND_IMPACT: 0xff3344, GROUND_RING: 0xff8866,
        RUNE_A: 0x9b4ddb, RUNE_B: 0xc44dff,
        CHARGE_A: 0xc44dff, CHARGE_B: 0x9b4ddb,
        PILLAR_BODY: 0x0a0a14, PILLAR_RIM: 0xc44dff,
        DOME_OUTER: 0x05000a, DOME_INNER: 0x6a2a9a, DOME_RIM: 0x9b4ddb,
        LIGHTNING: 0xc44dff,
        SHARD_A: 0x000000, SHARD_B: 0xc44dff,
        TINT: new THREE.Color(0x000000),
        KING_GLOW: 0xffe27a, CHECKER_GLOW: 0xff3366,
        VIGNETTE: 'radial-gradient(circle at 50% 50%,'
            + 'rgba(0,0,0,0) 28%,'
            + 'rgba(10,0,25,0.55) 68%,'
            + 'rgba(0,0,0,0.95) 100%)',
    };

    const created = [];
    const track = (obj, geo, mat) => {
        created.push({
            obj,
            geo: geo || (obj && obj.geometry),
            mat: mat || (obj && obj.material),
        });
        return obj;
    };
    let shatterFired = false;

    const vignette = document.createElement('div');
    vignette.style.cssText = `
        position: fixed; inset: 0; pointer-events: none; z-index: 490;
        background: ${THEME.VIGNETTE};
        opacity: 0; transition: opacity 0.6s ease;
    `;
    document.body.appendChild(vignette);
    requestAnimationFrame(() => { vignette.style.opacity = '1'; });

    const discGeo = new THREE.CircleGeometry(1, 128);
    const discMat = new THREE.MeshBasicMaterial({
        color: THEME.DISC, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(kingPos.x, 0.05, kingPos.z);
    disc.scale.set(0.001, 0.001, 1);
    disc.renderOrder = 5;
    scene.add(disc);
    track(disc, discGeo, discMat);

    const ringGeo = new THREE.RingGeometry(0.85, 1.0, 128);
    const ringMat = new THREE.MeshBasicMaterial({
        color: THEME.WAVE, transparent: true, opacity: 0.95,
        depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(kingPos.x, 0.09, kingPos.z);
    ring.scale.set(0.001, 0.001, 1);
    ring.renderOrder = 10;
    scene.add(ring);
    track(ring, ringGeo, ringMat);

    const rimGeo = new THREE.RingGeometry(1.0, 1.06, 128);
    const rimMat = new THREE.MeshBasicMaterial({
        color: THEME.RIM, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(kingPos.x, 0.095, kingPos.z);
    rim.scale.set(0.001, 0.001, 1);
    rim.renderOrder = 11;
    scene.add(rim);
    track(rim, rimGeo, rimMat);

    const glowGeo = new THREE.RingGeometry(0.55, 1.45, 128);
    const glowMat = new THREE.MeshBasicMaterial({
        color: THEME.HAZE, transparent: true, opacity: 0.4,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(kingPos.x, 0.075, kingPos.z);
    glow.scale.set(0.001, 0.001, 1);
    glow.renderOrder = 9;
    scene.add(glow);
    track(glow, glowGeo, glowMat);

    const ring2Geo = new THREE.RingGeometry(0.6, 1.15, 128);
    const ring2Mat = new THREE.MeshBasicMaterial({
        color: THEME.WAVE2, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.set(kingPos.x, 0.083, kingPos.z);
    ring2.scale.set(0.001, 0.001, 1);
    ring2.renderOrder = 9.5;
    scene.add(ring2);
    track(ring2, ring2Geo, ring2Mat);

    const checkerPos = get3DPosition(checker.r, checker.c, 0);
    const pathDX = checkerPos.x - kingPos.x;
    const pathDZ = checkerPos.z - kingPos.z;
    const pathLength = Math.hypot(pathDX, pathDZ);
    const pathAngle = Math.atan2(pathDZ, pathDX);
    const perpAngle = pathAngle + Math.PI / 2;

    const CRACK_COUNT = Math.max(8, Math.min(22, Math.floor(pathLength / 0.28)));
    const cracks = [];

    for (let i = 0; i < CRACK_COUNT; i++) {
        const t = Math.random();
        const alongDist = 0.55 + t * (pathLength - 0.55);
        const perpHalfWidth = 0.20 + t * 1.10;
        const perpOffset = (Math.random() - 0.5) * 2 * perpHalfWidth;
        const alongNoise = (Math.random() - 0.5) * 0.55;
        const px = kingPos.x
            + Math.cos(pathAngle) * (alongDist + alongNoise)
            + Math.cos(perpAngle) * perpOffset;
        const pz = kingPos.z
            + Math.sin(pathAngle) * (alongDist + alongNoise)
            + Math.sin(perpAngle) * perpOffset;

        const swordGroup = new THREE.Group();
        swordGroup.position.set(px, 0, pz);
        swordGroup.rotation.y = Math.random() * Math.PI * 2;
        swordGroup.rotation.z = (Math.random() - 0.5) * 0.60;
        swordGroup.rotation.x = (Math.random() - 0.5) * 0.60;
        const swordScale = 0.72 + Math.random() * 0.6;
        swordGroup.userData.baseScale = swordScale;

        const swordMat = new THREE.MeshBasicMaterial({
            color: THEME.BLADE_BODY, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
        });
        const swordGlowMat = new THREE.MeshBasicMaterial({
            color: THEME.BLADE_SEAM, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });

        const BLADE_H = 0.75, BLADE_W = 0.085, BLADE_D = 0.038, GUARD_Y = 0.16;

        const bladeGeo = new THREE.BoxGeometry(BLADE_W, BLADE_H, BLADE_D);
        const blade = new THREE.Mesh(bladeGeo, swordMat);
        blade.position.y = GUARD_Y - BLADE_H / 2;
        swordGroup.add(blade);
        track(blade, bladeGeo, swordMat);

        const tipGeo = new THREE.ConeGeometry(BLADE_W * 0.65, 0.18, 4);
        const tip = new THREE.Mesh(tipGeo, swordMat);
        tip.position.y = GUARD_Y - BLADE_H - 0.09;
        tip.rotation.y = Math.PI / 4;
        tip.rotation.z = Math.PI;
        swordGroup.add(tip);
        track(tip, tipGeo, swordMat);

        const guardGeo = new THREE.BoxGeometry(0.24, 0.05, 0.07);
        const guard = new THREE.Mesh(guardGeo, swordMat);
        guard.position.y = GUARD_Y;
        swordGroup.add(guard);
        track(guard, guardGeo, swordMat);

        const gripGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8);
        const grip = new THREE.Mesh(gripGeo, swordMat);
        grip.position.y = GUARD_Y + 0.11;
        swordGroup.add(grip);
        track(grip, gripGeo, swordMat);

        const pommelGeo = new THREE.SphereGeometry(0.045, 8, 8);
        const pommel = new THREE.Mesh(pommelGeo, swordMat);
        pommel.position.y = GUARD_Y + 0.22 + 0.03;
        swordGroup.add(pommel);
        track(pommel, pommelGeo, swordMat);

        const seamGeo = new THREE.PlaneGeometry(0.02, 0.35);
        const seam = new THREE.Mesh(seamGeo, swordGlowMat);
        seam.position.set(0, GUARD_Y - 0.20, BLADE_D / 2 + 0.002);
        swordGroup.add(seam);
        track(seam, seamGeo, swordGlowMat);

        const auraGeo = new THREE.BoxGeometry(BLADE_W * 2.8, BLADE_H * 1.05, BLADE_D * 2.8);
        const auraMat = new THREE.MeshBasicMaterial({
            color: THEME.BLADE_AURA, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
        });
        const aura = new THREE.Mesh(auraGeo, auraMat);
        aura.position.y = GUARD_Y - BLADE_H / 2;
        aura.renderOrder = 998;
        swordGroup.add(aura);
        track(aura, auraGeo, auraMat);

        const coreGlowGeo = new THREE.BoxGeometry(BLADE_W * 1.7, BLADE_H * 0.9, BLADE_D * 1.7);
        const coreGlowMat = new THREE.MeshBasicMaterial({
            color: THEME.BLADE_CORE, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        const coreGlow = new THREE.Mesh(coreGlowGeo, coreGlowMat);
        coreGlow.position.y = GUARD_Y - BLADE_H / 2;
        coreGlow.renderOrder = 999;
        swordGroup.add(coreGlow);
        track(coreGlow, coreGlowGeo, coreGlowMat);

        const impactGeo = new THREE.CircleGeometry(0.24, 24);
        const groundImpactMat = new THREE.MeshBasicMaterial({
            color: THEME.GROUND_IMPACT, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        const groundImpact = new THREE.Mesh(impactGeo, groundImpactMat);
        groundImpact.rotation.x = -Math.PI / 2;
        groundImpact.position.set(px, 0.015, pz);
        groundImpact.renderOrder = 21;
        scene.add(groundImpact);
        track(groundImpact, impactGeo, groundImpactMat);

        const groundRingGeo = new THREE.RingGeometry(0.12, 0.20, 24);
        const groundRingMat = new THREE.MeshBasicMaterial({
            color: THEME.GROUND_RING, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        const groundRing = new THREE.Mesh(groundRingGeo, groundRingMat);
        groundRing.rotation.x = -Math.PI / 2;
        groundRing.position.set(px, 0.02, pz);
        groundRing.renderOrder = 22;
        scene.add(groundRing);
        track(groundRing, groundRingGeo, groundRingMat);

        swordGroup.scale.setScalar(swordScale);
        track(swordGroup);
        scene.add(swordGroup);

        cracks.push({
            swordGroup, swordMat,
            glowMat: swordGlowMat,
            auraMat, coreGlowMat,
            groundImpactMat, groundImpact,
            groundRingMat, groundRing,
            index: i,
            spawnDelay: Math.random() * (CRACK_COUNT * 0.10),
        });
    }

    const runeGroup = new THREE.Group();
    runeGroup.position.set(kingPos.x, 0.08, kingPos.z);
    scene.add(runeGroup);
    const runeRings = [];
    for (let i = 0; i < 2; i++) {
        const rGeo = new THREE.RingGeometry(
            i === 0 ? 0.55 : 0.85,
            i === 0 ? 0.60 : 0.92,
            64
        );
        const rMat = new THREE.MeshBasicMaterial({
            color: i === 0 ? THEME.RUNE_A : THEME.RUNE_B,
            transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        const rMesh = new THREE.Mesh(rGeo, rMat);
        rMesh.rotation.x = -Math.PI / 2;
        runeGroup.add(rMesh);
        track(rMesh, rGeo, rMat);
        runeRings.push(rMesh);
    }
    const runeTicks = [];
    const TICK_COUNT = 16;
    for (let i = 0; i < TICK_COUNT; i++) {
        const a = (i / TICK_COUNT) * Math.PI * 2;
        const tg = new THREE.PlaneGeometry(0.16, 0.035);
        const tm = new THREE.MeshBasicMaterial({
            color: THEME.RUNE_B, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        const tick = new THREE.Mesh(tg, tm);
        tick.position.set(Math.cos(a) * 0.72, 0.001, Math.sin(a) * 0.72);
        tick.rotation.x = -Math.PI / 2;
        tick.rotation.z = -a;
        runeGroup.add(tick);
        track(tick, tg, tm);
        runeTicks.push(tick);
    }

    const chargeParticles = [];
    const CHARGE_COUNT = 32;
    for (let i = 0; i < CHARGE_COUNT; i++) {
        const pg = new THREE.SphereGeometry(0.04 + Math.random() * 0.04, 5, 5);
        const pm = new THREE.MeshBasicMaterial({
            color: Math.random() < 0.5 ? THEME.CHARGE_A : THEME.CHARGE_B,
            transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const p = new THREE.Mesh(pg, pm);
        const a = Math.random() * Math.PI * 2;
        const r = 3.5 + Math.random() * 3.0;
        const y0 = 0.15 + Math.random() * 1.8;
        p.position.set(kingPos.x + Math.cos(a) * r, y0, kingPos.z + Math.sin(a) * r);
        p.userData = {
            startR: r, startAngle: a, startY: y0,
            duration: 0.55 + Math.random() * 0.3,
            delay: Math.random() * 0.25,
            orbit: (Math.random() - 0.5) * 0.8,
        };
        p.renderOrder = 30;
        scene.add(p);
        track(p, pg, pm);
        chargeParticles.push(p);
    }

    const pillarGroup = new THREE.Group();
    pillarGroup.position.set(kingPos.x, 0, kingPos.z);
    scene.add(pillarGroup);
    const PILLAR_COUNT = 16;
    const pillars = [];
    const SWORD_BLADE_W = 0.11;
    const SWORD_BLADE_D = 0.035;
    const SWORD_BLADE_H = 1.65;

    for (let i = 0; i < PILLAR_COUNT; i++) {
        const angle = (i / PILLAR_COUNT) * Math.PI * 2;
        const swordGroup = new THREE.Group();
        const darkMat = new THREE.MeshBasicMaterial({
            color: THEME.PILLAR_BODY, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
        });
        const rimMat = new THREE.MeshBasicMaterial({
            color: THEME.PILLAR_RIM, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });

        const pommelGeo = new THREE.SphereGeometry(0.06, 8, 8);
        const pommel = new THREE.Mesh(pommelGeo, darkMat);
        pommel.position.y = 0.06;
        swordGroup.add(pommel);
        track(pommel, pommelGeo, darkMat);

        const gripGeo = new THREE.CylinderGeometry(0.034, 0.034, 0.40, 8);
        const grip = new THREE.Mesh(gripGeo, darkMat);
        grip.position.y = 0.26;
        swordGroup.add(grip);
        track(grip, gripGeo, darkMat);

        const guardGeo = new THREE.BoxGeometry(0.32, 0.06, 0.08);
        const guard = new THREE.Mesh(guardGeo, darkMat);
        guard.position.y = 0.49;
        swordGroup.add(guard);
        track(guard, guardGeo, darkMat);

        const bladeGeo = new THREE.BoxGeometry(SWORD_BLADE_W, SWORD_BLADE_H, SWORD_BLADE_D);
        const blade = new THREE.Mesh(bladeGeo, darkMat);
        blade.position.y = 0.52 + SWORD_BLADE_H / 2;
        swordGroup.add(blade);
        track(blade, bladeGeo, darkMat);

        const tipGeo = new THREE.ConeGeometry(SWORD_BLADE_W * 0.7, 0.23, 4);
        const tip = new THREE.Mesh(tipGeo, darkMat);
        tip.position.y = 0.52 + SWORD_BLADE_H + 0.115;
        tip.rotation.y = Math.PI / 4;
        swordGroup.add(tip);
        track(tip, tipGeo, darkMat);

        const rimGeo = new THREE.PlaneGeometry(0.022, SWORD_BLADE_H);
        for (const sgn of [-1, 1]) {
            const rim = new THREE.Mesh(rimGeo, rimMat);
            rim.position.set(
                sgn * (SWORD_BLADE_W * 0.5 + 0.001),
                0.52 + SWORD_BLADE_H / 2,
                0
            );
            swordGroup.add(rim);
            track(rim, rimGeo, rimMat);
        }

        swordGroup.position.set(1, 0, 0);
        swordGroup.rotation.y = Math.PI / 2 - angle;
        swordGroup.rotation.z = (Math.random() - 0.5) * 0.12;
        pillarGroup.add(swordGroup);
        pillars.push({ group: swordGroup, darkMat, rimMat, angle });
    }

    const domeGeo = new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshBasicMaterial({
        color: THEME.DOME_OUTER, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.set(kingPos.x, 0.02, kingPos.z);
    dome.scale.setScalar(0.001);
    dome.renderOrder = 6;
    scene.add(dome);
    track(dome, domeGeo, domeMat);

    const domeInnerGeo = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeInnerMat = new THREE.MeshBasicMaterial({
        color: THEME.DOME_INNER, transparent: true, opacity: 0,
        side: THREE.BackSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const domeInner = new THREE.Mesh(domeInnerGeo, domeInnerMat);
    domeInner.position.set(kingPos.x, 0.02, kingPos.z);
    domeInner.scale.setScalar(0.001);
    domeInner.renderOrder = 7;
    scene.add(domeInner);
    track(domeInner, domeInnerGeo, domeInnerMat);

    const domeRimGeo = new THREE.RingGeometry(0.97, 1.04, 96);
    const domeRimMat = new THREE.MeshBasicMaterial({
        color: THEME.DOME_RIM, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const domeRim = new THREE.Mesh(domeRimGeo, domeRimMat);
    domeRim.rotation.x = -Math.PI / 2;
    domeRim.position.set(kingPos.x, 0.06, kingPos.z);
    domeRim.scale.set(0.001, 0.001, 1);
    domeRim.renderOrder = 10;
    scene.add(domeRim);
    track(domeRim, domeRimGeo, domeRimMat);

    const lightningBolts = [];
    const BOLT_COUNT = 5;
    for (let i = 0; i < BOLT_COUNT; i++) {
        const segGeo = new THREE.CylinderGeometry(0.028, 0.028, 1, 5, 1, true);
        const segMat = new THREE.MeshBasicMaterial({
            color: THEME.LIGHTNING, transparent: true, opacity: 0.9,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const seg = new THREE.Mesh(segGeo, segMat);
        seg.visible = false;
        scene.add(seg);
        track(seg, segGeo, segMat);
        lightningBolts.push({
            seg, nextJumpAt: 0,
            currentAngle: Math.random() * Math.PI * 2,
            baseR: 1, height: 1,
        });
    }

    const flashGeo = new THREE.SphereGeometry(0.55, 20, 20);
    const flashMat = new THREE.MeshBasicMaterial({
        color: isWhiteDomain ? 0xc9a44a : 0xffffff,
        transparent: true,
        opacity: isWhiteDomain ? 0.55 : 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(kingPos.x, 0.4, kingPos.z);
    flash.visible = false;
    scene.add(flash);
    track(flash, flashGeo, flashMat);

    const shards = [];
    const SHARD_COUNT = 24;
    for (let i = 0; i < SHARD_COUNT; i++) {
        const sg = new THREE.TetrahedronGeometry(0.10 + Math.random() * 0.12, 0);
        const sm = new THREE.MeshBasicMaterial({
            color: Math.random() < 0.5 ? THEME.SHARD_A : THEME.SHARD_B,
            transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const shard = new THREE.Mesh(sg, sm);
        shard.visible = false;
        shard.renderOrder = 25;
        scene.add(shard);
        track(shard, sg, sm);
        const a = Math.random() * Math.PI * 2;
        shards.push({
            mesh: shard,
            dirX: Math.cos(a), dirZ: Math.sin(a),
            upSpeed: 1.5 + Math.random() * 2.0,
            spin: (Math.random() - 0.5) * 8,
            bornAt: 0, life: 1.0,
        });
    }

    const exemptKeys = new Set();
    exemptKeys.add(`${king.r},${king.c}`);
    const allCheckers = findCheckingPieces(color);
    for (const ch of allCheckers) exemptKeys.add(`${ch.r},${ch.c}`);
    if (checker) exemptKeys.add(`${checker.r},${checker.c}`);

    const piecesToTint = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const key = `${r},${c}`;
            if (exemptKeys.has(key)) continue;
            const obj = pieceObjects[key];
            if (!obj) continue;

            const worldPos = get3DPosition(r, c, 0);
            const distFromKing = Math.hypot(worldPos.x - kingPos.x, worldPos.z - kingPos.z);

            const savedMats = [];
            const sprites = [];
            obj.traverse(n => {
                if (n.isMesh && n.material && n.material.color) {
                    n.material = n.material.clone();
                    savedMats.push({
                        mesh: n,
                        color: n.material.color.clone(),
                        emissive: n.material.emissive ? n.material.emissive.clone() : null,
                    });
                } else if (n.isSprite && n.material) {
                    sprites.push(n);
                }
            });
            piecesToTint.push({
                obj, dist: distFromKing, tintAmount: 0, opacityAmount: 1,
                savedMats, sprites,
            });
        }
    }

    const glowOutlineEntries = [];
    const kingObj = pieceObjects[`${king.r},${king.c}`];
    if (kingObj) glowOutlineEntries.push(...buildDomainGlowOutline(kingObj, THEME.KING_GLOW, 1.12));
    for (const ch of allCheckers) {
        const chObj = pieceObjects[`${ch.r},${ch.c}`];
        if (!chObj) continue;
        glowOutlineEntries.push(...buildDomainGlowOutline(chObj, THEME.CHECKER_GLOW, 1.12));
    }
    if (checker) {
        const ck = `${checker.r},${checker.c}`;
        if (!allCheckers.some(ch => `${ch.r},${ch.c}` === ck)) {
            const chObj = pieceObjects[ck];
            if (chObj) glowOutlineEntries.push(...buildDomainGlowOutline(chObj, THEME.CHECKER_GLOW, 1.12));
        }
    }

    const CHARGE_END = 0.8;
    const EXPAND_END = CHARGE_END + 7.0;
    const TOTAL = EXPAND_END + 0.8;
    const MAX_RADIUS = 14;

    const shakeHandle = { intensity: 0 };
    window._domainShake = shakeHandle;

    const disposeAll = () => {
        if (vignette.parentNode) {
            vignette.style.opacity = '0';
            setTimeout(() => vignette.remove(), 600);
        }
        window._domainShake = null;
        for (const e of created) {
            if (e.obj && e.obj.parent) e.obj.parent.remove(e.obj);
            if (e.geo && e.geo.dispose) e.geo.dispose();
            if (e.mat && e.mat.dispose) e.mat.dispose();
        }
        disposeDomainGlowOutlines(glowOutlineEntries);
    };

    const animateExpand = () => {
        const elapsed = clock.getElapsedTime() - t0;

        if (elapsed >= TOTAL) {
            disposeAll();
            showVsScreen(color, checker);
            return;
        }

        if (elapsed < CHARGE_END) {
            const k = elapsed / CHARGE_END;
            const ease = 1 - Math.pow(1 - k, 3);

            runeRings[0].material.opacity = 0.75 * ease;
            runeRings[1].material.opacity = 0.55 * ease;
            for (const t of runeTicks) t.material.opacity = 0.85 * ease;
            runeGroup.rotation.y += 0.05;

            for (const p of chargeParticles) {
                const pt = elapsed - p.userData.delay;
                if (pt < 0) { p.material.opacity = 0; continue; }
                const lk = Math.min(1, pt / p.userData.duration);
                const a = p.userData.startAngle + lk * 3.0 * p.userData.orbit * Math.PI;
                const r = p.userData.startR * (1 - lk) * (1 - lk * 0.4);
                const y = p.userData.startY * (1 - lk) + 0.5 * lk;
                p.position.set(
                    kingPos.x + Math.cos(a) * r,
                    y,
                    kingPos.z + Math.sin(a) * r
                );
                p.material.opacity = 0.95 * (1 - Math.pow(lk, 3));
                p.scale.setScalar(1 - lk * 0.5);
            }

            disc.scale.set(0.5, 0.5, 1);
            discMat.opacity = 0.15 * ease;
            shakeHandle.intensity = 0.015 * ease;
        }
        else {
            const expElapsed = elapsed - CHARGE_END;
            const tRaw = Math.min(expElapsed / (EXPAND_END - CHARGE_END), 1);
            const ease = 1 - Math.pow(1 - tRaw, 2);
            const radius = MAX_RADIUS * ease;

            const runeFade = Math.max(0, 1 - tRaw * 2.0);
            runeRings[0].material.opacity = 0.75 * runeFade;
            runeRings[1].material.opacity = 0.55 * runeFade;
            for (const t of runeTicks) t.material.opacity = 0.85 * runeFade;
            runeGroup.rotation.y += 0.05;

            for (const p of chargeParticles) {
                if (p.material.opacity > 0) {
                    p.material.opacity = Math.max(0, p.material.opacity - 0.08);
                }
            }

            disc.scale.set(Math.max(0.001, radius), Math.max(0.001, radius), 1);
            discMat.opacity = 0.78 * Math.min(1, tRaw * 1.6);

            ring.scale.set(Math.max(0.001, radius), Math.max(0.001, radius), 1);
            const ringPulse = 0.85 + 0.15 * Math.sin(elapsed * 10);
            ringMat.opacity = 0.98 * (1 - tRaw * 0.2) * ringPulse;

            rim.scale.set(Math.max(0.001, radius), Math.max(0.001, radius), 1);
            rimMat.opacity = 0.85 * Math.sin(Math.PI * Math.min(tRaw * 1.1, 1));

            glow.scale.set(Math.max(0.001, radius), Math.max(0.001, radius), 1);
            glowMat.opacity = 0.4 * (1 - tRaw * 0.35);

            const tRaw2 = Math.max(0, (expElapsed - 0.45) / (EXPAND_END - CHARGE_END - 0.45));
            const radius2 = MAX_RADIUS * (1 - Math.pow(1 - Math.min(tRaw2, 1), 3.5));
            ring2.scale.set(Math.max(0.001, radius2), Math.max(0.001, radius2), 1);
            ring2Mat.opacity = 0.55 * (1 - tRaw * 0.8);

            for (const p of pillars) {
                const px = Math.cos(p.angle) * radius;
                const pz = Math.sin(p.angle) * radius;
                p.group.position.set(px, 0, pz);

                const pillarFade = Math.max(0, 1 - tRaw * 1.1);
                p.darkMat.opacity = 0.95 * pillarFade;
                p.rimMat.opacity = 0.90 * pillarFade;
                p.group.scale.set(1, 0.6 + tRaw * 0.9, 1);
            }

            for (const c of cracks) {
                const appearT = c.spawnDelay;
                const growT = Math.max(0, Math.min(1, (expElapsed - appearT) / 0.28));
                const holdFade = Math.max(0, 1 - tRaw * 0.9);
                const alpha = growT * holdFade;

                const base = c.swordGroup.userData.baseScale || 1;
                const pop = base * (0.35 + 0.65 * growT);
                c.swordGroup.scale.setScalar(pop);

                c.swordMat.opacity = 0.95 * alpha;
                c.glowMat.opacity = 0.90 * alpha * (0.7 + 0.3 * Math.sin(elapsed * 14 + c.index));

                if (c.auraMat) {
                    const pulse = 0.7 + 0.3 * Math.sin(elapsed * 8 + c.index * 1.3);
                    c.auraMat.opacity = 0.85 * alpha * pulse;
                }
                if (c.coreGlowMat) {
                    const flicker = 0.72 + 0.28 * Math.sin(elapsed * 18 + c.index * 0.7);
                    c.coreGlowMat.opacity = 0.95 * alpha * flicker;
                }

                if (c.groundImpactMat) {
                    const stabFlash = Math.max(0, 1 - growT * 3.2);
                    const settle = 0.55 + 0.45 * Math.sin(elapsed * 5 + c.index);
                    c.groundImpactMat.opacity = alpha * (0.30 * settle + 0.95 * stabFlash);
                    const s = 1 + 0.15 * Math.sin(elapsed * 4 + c.index);
                    c.groundImpact.scale.setScalar(s);
                }
                if (c.groundRingMat && c.groundRing) {
                    const stabT = Math.max(0, Math.min(1, (expElapsed - appearT) / 0.55));
                    c.groundRing.scale.setScalar(1 + stabT * 2.6);
                    c.groundRingMat.opacity = alpha * Math.max(0, 1 - stabT * 1.15) * 0.95;
                }
            }

            const domeR = Math.max(0.001, radius);
            dome.scale.setScalar(domeR);
            domeMat.opacity = 0.45 * Math.min(1, tRaw * 1.5) * (1 - tRaw * 0.12);
            domeInner.scale.setScalar(domeR * 1.01);
            domeInnerMat.opacity = 0.24 * Math.min(1, tRaw * 1.8);
            domeRim.scale.set(domeR, domeR, 1);
            domeRimMat.opacity = 0.75 * Math.min(1, tRaw * 1.4) * (1 - tRaw * 0.25);

            const boltNow = clock.getElapsedTime();
            for (const b of lightningBolts) {
                if (boltNow >= b.nextJumpAt) {
                    b.nextJumpAt = boltNow + 0.08 + Math.random() * 0.18;
                    b.currentAngle = Math.random() * Math.PI * 2;
                    b.baseR = domeR * (0.85 + Math.random() * 0.15);
                    b.height = domeR * (0.6 + Math.random() * 0.35);
                }
                if (tRaw < 0.15 || tRaw > 0.95) {
                    b.seg.visible = false;
                    continue;
                }
                b.seg.visible = true;
                const bx = kingPos.x + Math.cos(b.currentAngle) * b.baseR;
                const bz = kingPos.z + Math.sin(b.currentAngle) * b.baseR;
                const by = 0.1;
                const tx = kingPos.x + Math.cos(b.currentAngle + 0.2) * b.baseR * 0.6;
                const tz = kingPos.z + Math.sin(b.currentAngle + 0.2) * b.baseR * 0.6;
                const ty = by + b.height;

                const dirV = new THREE.Vector3(tx - bx, ty - by, tz - bz);
                const len = dirV.length();
                const mid = new THREE.Vector3((bx + tx) / 2, (by + ty) / 2, (bz + tz) / 2);
                b.seg.position.copy(mid);
                b.seg.quaternion.setFromUnitVectors(
                    new THREE.Vector3(0, 1, 0),
                    dirV.clone().normalize()
                );
                b.seg.scale.set(1, len, 1);
                b.seg.material.opacity =
                    0.9 * Math.min(1, tRaw * 2) * Math.max(0, 1 - tRaw * 0.6);
            }

            if (expElapsed < 0.4) {
                flash.visible = true;
                const ft = expElapsed / 0.4;
                flashMat.opacity = 0.98 * (1 - ft);
                flash.scale.setScalar(1 + ft * 3.5);
            } else {
                flash.visible = false;
            }

            const shakeRamp = tRaw < 0.15
                ? tRaw / 0.15
                : Math.max(0, 1 - (tRaw - 0.15) / 0.6);
            shakeHandle.intensity = 0.06 * shakeRamp;

            const EDGE_SMOOTH = 0.35;
            const MIN_OPACITY = 0.1;
            for (const p of piecesToTint) {
                const behind = radius - p.dist;
                let targetTint, targetOpacity;
                if (behind <= 0) {
                    targetTint = 0;
                    targetOpacity = 1;
                } else if (behind < EDGE_SMOOTH) {
                    const k = behind / EDGE_SMOOTH;
                    targetTint = k;
                    targetOpacity = 1 - (1 - MIN_OPACITY) * k;
                } else {
                    targetTint = 1;
                    targetOpacity = MIN_OPACITY;
                }

                if (Math.abs(p.tintAmount - targetTint) > 0.005 ||
                    Math.abs(p.opacityAmount - targetOpacity) > 0.005) {
                    p.tintAmount = targetTint;
                    p.opacityAmount = targetOpacity;

                    for (const sm of p.savedMats) {
                        const c1 = sm.color.clone();
                        c1.lerp(THEME.TINT, p.tintAmount);
                        sm.mesh.material.color.copy(c1);
                        if (sm.mesh.material.emissive && sm.emissive) {
                            sm.mesh.material.emissive.copy(sm.emissive);
                            sm.mesh.material.emissive.multiplyScalar(1 - p.tintAmount);
                        }
                        sm.mesh.material.opacity = targetOpacity;
                        sm.mesh.material.transparent =
                            targetOpacity < 0.99 || p.tintAmount > 0.01;
                        sm.mesh.material.depthWrite = targetOpacity > 0.92;
                        sm.mesh.material.needsUpdate = true;
                    }

                    for (const sp of p.sprites) {
                        sp.material.transparent = true;
                        sp.material.opacity = targetOpacity;
                        sp.material.needsUpdate = true;
                        sp.visible = targetOpacity > 0.15;
                    }
                }
            }

            if (tRaw >= 0.85 && !shatterFired) {
                shatterFired = true;
                for (const s of shards) {
                    s.mesh.visible = true;
                    s.mesh.material.opacity = 0.9;
                    s.mesh.position.set(kingPos.x, 0.4, kingPos.z);
                    s.bornAt = elapsed;
                }
                shakeHandle.intensity = 0.20;
            }
        }

        for (const s of shards) {
            if (!s.mesh.visible) continue;
            const st = elapsed - s.bornAt;
            if (st < 0 || st > s.life) { s.mesh.visible = false; continue; }
            const lt = st / s.life;
            const dist = 3.0 * Math.sqrt(lt);
            s.mesh.position.x = kingPos.x + s.dirX * dist;
            s.mesh.position.z = kingPos.z + s.dirZ * dist;
            s.mesh.position.y = 0.4 + s.upSpeed * st - 2.5 * st * st;
            s.mesh.rotation.x += s.spin * 0.02;
            s.mesh.rotation.y += s.spin * 0.03;
            s.mesh.material.opacity = 0.95 * (1 - lt);
            s.mesh.scale.setScalar(1 - lt * 0.3);
        }

        const glowPulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(elapsed * 4.5));
        for (const o of glowOutlineEntries) {
            if (o.material) o.material.opacity = glowPulse;
        }

        requestAnimationFrame(animateExpand);
    };

    animateExpand();
}


/* ═══════════════════════════════════════════════════════════
   11.  KILL THEMES + KILL CINEMATICS
   ═══════════════════════════════════════════════════════════ */
const KILL_THEMES = {
    light: {
        runeA: 0xffe27a, runeB: 0xfff8d0,
        pillarBody: 0xffe9a8, pillarCore: 0xffffff,
        orbCore: 0xffffff, orbGlow: 0xffe27a,
        orbAura: 0xfff4c0, orbTorusA: 0xffe27a, orbTorusB: 0xfff4c0,
        beamCore: 0xffffff, beamMid: 0xffe27a, beamOuter: 0xfff4d0,
        shockA: 0xffffff, shockB: 0xffe27a, shockC: 0xfff4d0,
        chargeA: 0xffe27a, chargeB: 0xffffff,
        casterGlow: 0xffe27a, casterAura: 0xfff4c0, casterLerp: 0.95,
        bladeCore: 0xffffff, bladeEdge: 0xffe27a, bladeHalo: 0xfff4c0,
        shardHue: 0.13, shardHueRange: 0.08, shardLight: 0.78,
        soulHue: 0.13, soulHueRange: 0.08,
        flashColor: 0xffffff,
        vignetteBg:
            'radial-gradient(circle at 50% 50%,' +
            'rgba(255,240,200,0) 30%,' +
            'rgba(180,140,60,0.55) 70%,' +
            'rgba(40,24,0,0.94) 100%)',
    },
    dark: {
        runeA: 0x9b4ddb, runeB: 0x6a1fcf,
        pillarBody: 0x4a10a0, pillarCore: 0xd9a6ff,
        orbCore: 0xd9a6ff, orbGlow: 0x7a1fd9,
        orbAura: 0x4a10a0, orbTorusA: 0xb44dff, orbTorusB: 0x8a1fd9,
        beamCore: 0xd9a6ff, beamMid: 0x8a1fd9, beamOuter: 0x4a10a0,
        shockA: 0xb44dff, shockB: 0x6a1fcf, shockC: 0x4a10a0,
        chargeA: 0x9b4ddb, chargeB: 0xb44dff,
        casterGlow: 0xb44dff, casterAura: 0x7a1fd9, casterLerp: 0.85,
        bladeCore: 0xd9a6ff, bladeEdge: 0x8a1fd9, bladeHalo: 0x4a10a0,
        shardHue: 0.78, shardHueRange: 0.10, shardLight: 0.60,
        soulHue: 0.78, soulHueRange: 0.10,
        flashColor: 0xb44dff,
        vignetteBg:
            'radial-gradient(circle at 50% 50%,' +
            'rgba(80,20,140,0) 30%,' +
            'rgba(30,5,60,0.75) 70%,' +
            'rgba(0,0,0,0.96) 100%)',
    },
};

/* ═══════════════════════════════════════════════════════════
   KILL SIGNATURE — 依棋子種類的遊戲結束處決風格
   ═══════════════════════════════════════════════════════════ */

const KILL_SIGNATURE_BUILDERS = {
    pawn: buildPawnKillSignature,
    rook: buildRookKillSignature,
    knight: buildKnightKillSignature,
    bishop: buildBishopKillSignature,
    queen: buildQueenKillSignature,
    king: buildKingKillSignature,
};

function buildKillSignature(pieceType, ctx) {
    const builder = KILL_SIGNATURE_BUILDERS[pieceType];
    if (!builder) return null;
    try { return builder(ctx); }
    catch (err) {
        console.warn('Kill signature failed for', pieceType, err);
        return null;
    }
}

function _sigMat(color, opacity = 0) {
    return new THREE.MeshBasicMaterial({
        color, transparent: true, opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
}


/* ── 🐣 PAWN — 自爆獻祭 (Cross Detonation) ─────────────── */
function buildPawnKillSignature(ctx) {
    const { scene, track, T, isKingKill,
        orbPos, impactPos, CHARGE_END, FIRE_AT, IMPACT_AT } = ctx;

    const chargeMat = _sigMat(T.orbGlow, 0);
    const chargeOrb = track(new THREE.Mesh(
        new THREE.SphereGeometry(isKingKill ? 0.55 : 0.35, 18, 18), chargeMat
    ));
    chargeOrb.position.copy(orbPos);
    scene.add(chargeOrb);

    const ARM_COUNT = isKingKill ? 8 : 4;
    const ARM_LEN = isKingKill ? 2.8 : 1.7;
    const arms = [];
    for (let i = 0; i < ARM_COUNT; i++) {
        const a = (i / ARM_COUNT) * Math.PI * 2;
        const mat = _sigMat(i % 2 === 0 ? T.beamMid : T.beamOuter, 0);
        const mesh = track(new THREE.Mesh(
            new THREE.BoxGeometry(ARM_LEN, 0.11, 0.11), mat
        ));
        mesh.position.set(
            impactPos.x + Math.cos(a) * ARM_LEN * 0.5,
            0.18,
            impactPos.z + Math.sin(a) * ARM_LEN * 0.5
        );
        mesh.rotation.y = -a;
        mesh.renderOrder = 64;
        scene.add(mesh);
        arms.push({ mesh, mat });
    }

    const groundMat = _sigMat(T.runeA, 0);
    const groundCross = track(new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.42, 4), groundMat
    ));
    groundCross.rotation.x = -Math.PI / 2;
    groundCross.rotation.z = Math.PI / 4;
    groundCross.position.set(impactPos.x, 0.05, impactPos.z);
    groundCross.renderOrder = 5;
    scene.add(groundCross);

    const DET_COUNT = isKingKill ? 8 : 4;
    const DET_R = isKingKill ? 1.5 : 1.0;
    const dets = [];
    for (let i = 0; i < DET_COUNT; i++) {
        const a = (i / DET_COUNT) * Math.PI * 2;
        const mat = _sigMat(T.shockA, 0);
        const mesh = track(new THREE.Mesh(
            new THREE.SphereGeometry(0.24, 12, 12), mat
        ));
        mesh.position.set(
            impactPos.x + Math.cos(a) * DET_R,
            0.28,
            impactPos.z + Math.sin(a) * DET_R
        );
        mesh.renderOrder = 66;
        scene.add(mesh);
        dets.push({ mesh, mat, angle: a });
    }

    return {
        tick(t) {
            if (t < CHARGE_END) {
                const k = t / CHARGE_END;
                chargeMat.opacity = 0.9 * k;
                const pulse = 1 + 0.12 * Math.sin(t * 34);
                chargeOrb.scale.setScalar((0.2 + k * (isKingKill ? 0.9 : 0.55)) * pulse);
            } else {
                chargeMat.opacity = Math.max(0, chargeMat.opacity - 0.09);
                chargeOrb.scale.multiplyScalar(1.05);
            }

            if (t >= FIRE_AT && t < FIRE_AT + 0.5) {
                const k = (t - FIRE_AT) / 0.5;
                const fade = 1 - k;
                for (const a of arms) {
                    a.mat.opacity = 0.95 * fade;
                    a.mesh.scale.set(1 + k * 2.4, 1, 1 + k * 2.4);
                }
                groundMat.opacity = 0.9 * fade;
                groundCross.scale.setScalar(1 + k * 3.6);
            } else if (t >= FIRE_AT + 0.5) {
                for (const a of arms) a.mat.opacity = 0;
                groundMat.opacity = 0;
            }

            if (t >= IMPACT_AT) {
                const k = Math.min(1, (t - IMPACT_AT) / 0.6);
                const fade = 1 - k;
                for (const d of dets) {
                    d.mat.opacity = 0.95 * fade;
                    d.mesh.scale.setScalar(1 + k * 3.5);
                    const r = DET_R + k * 1.6;
                    d.mesh.position.x = impactPos.x + Math.cos(d.angle) * r;
                    d.mesh.position.z = impactPos.z + Math.sin(d.angle) * r;
                }
            }
        }
    };
}


/* ── 🏰 ROOK — 軌道砲擊 (Orbital Barrage) ──────────────── */
function buildRookKillSignature(ctx) {
    const { scene, track, T, isKingKill,
        orbPos, impactPos, FIRE_AT, IMPACT_AT } = ctx;

    const shells = [];
    const SHELL_COUNT = isKingKill ? 12 : 6;
    for (let i = 0; i < SHELL_COUNT; i++) {
        const mat = _sigMat(T.orbGlow, 0);
        const mesh = track(new THREE.Mesh(
            new THREE.SphereGeometry(0.09, 10, 10), mat
        ));
        scene.add(mesh);
        shells.push({ mesh, mat, baseAngle: (i / SHELL_COUNT) * Math.PI * 2 });
    }

    const bolts = [];
    if (!isKingKill) {
        const mat = _sigMat(T.beamMid, 0);
        const pillar = track(new THREE.Mesh(
            new THREE.CylinderGeometry(0.42, 0.65, 9, 22, 1, true), mat
        ));
        pillar.position.set(impactPos.x, 4.5, impactPos.z);
        pillar.renderOrder = 60;
        scene.add(pillar);
        bolts.push({ mesh: pillar, mat, type: 'pillar' });
    } else {
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const mat = _sigMat(i % 2 ? T.beamMid : T.beamOuter, 0);
            const mesh = track(new THREE.Mesh(
                new THREE.BoxGeometry(1.9, 0.12, 0.12), mat
            ));
            mesh.position.set(
                impactPos.x + Math.cos(a) * 1.1,
                0.75,
                impactPos.z + Math.sin(a) * 1.1
            );
            mesh.rotation.y = -a;
            mesh.renderOrder = 60;
            scene.add(mesh);
            bolts.push({ mesh, mat, type: 'laser' });
        }
    }

    const impactMat = _sigMat(T.flashColor, 0);
    const impactSphere = track(new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 16, 16), impactMat
    ));
    impactSphere.position.copy(impactPos);
    scene.add(impactSphere);

    return {
        tick(t) {
            if (t < FIRE_AT) {
                const k = Math.min(1, t / Math.max(0.1, FIRE_AT));
                for (const s of shells) {
                    const a = s.baseAngle + t * 5.5;
                    const r = (isKingKill ? 1.0 : 0.8) * (1 - k * 0.35);
                    s.mesh.position.set(
                        orbPos.x + Math.cos(a) * r,
                        orbPos.y + Math.sin(t * 8 + s.baseAngle) * 0.16,
                        orbPos.z + Math.sin(a) * r
                    );
                    s.mat.opacity = 0.9 * k;
                }
            } else {
                for (const s of shells) s.mat.opacity = 0;
            }

            if (t >= FIRE_AT && t < FIRE_AT + 0.4) {
                const k = (t - FIRE_AT) / 0.4;
                const fade = 1 - k;
                for (const b of bolts) {
                    b.mat.opacity = 0.95 * fade;
                    if (b.type === 'pillar') b.mesh.scale.set(1 + k * 1.6, 1, 1 + k * 1.6);
                    else b.mesh.scale.set(1 + k * 3.2, 1, 1 + k * 3.2);
                }
            } else if (t >= FIRE_AT + 0.4) {
                for (const b of bolts) b.mat.opacity = 0;
            }

            if (t >= IMPACT_AT) {
                const k = Math.min(1, (t - IMPACT_AT) / 0.6);
                impactMat.opacity = 0.98 * (1 - k) * (1 - k);
                impactSphere.scale.setScalar(0.5 + k * 6);
            }
        }
    };
}


/* ── 🐴 KNIGHT — 幻影衝鋒 (Spectral Charge) ───────────── */
function buildKnightKillSignature(ctx) {
    const { scene, track, T, isKingKill,
        impactPos, FIRE_AT, IMPACT_AT, isWhiteKing } = ctx;

    // Determine the attacker's color (opposite of the king's color)
    const attackerColor = isWhiteKing ? 'black' : 'white';
    const tint = attackerColor === 'white' ? 0x9fe8ff : 0xb46cff;

    const ghosts = [];
    const COUNT = isKingKill ? 12 : 4;

    for (let i = 0; i < COUNT; i++) {
        const ghostGroup = new THREE.Group();

        // Create the actual 3D knight model
        const knightModel = createPieceModel(
            'knight', attackerColor, 100, 100, PIECE_PARAMS.knight || {}
        );

        // Remove the health bar sprite if it exists
        if (knightModel.userData.hpSprite) {
            knightModel.remove(knightModel.userData.hpSprite);
            knightModel.userData.hpSprite = null;
        }

        // Apply ghost material to all meshes and track them for cleanup
        const ghostMats = [];
        knightModel.traverse(n => {
            if (n.isMesh) {
                const meshMat = new THREE.MeshBasicMaterial({
                    color: tint, transparent: true, opacity: 0,
                    depthWrite: false, blending: THREE.AdditiveBlending,
                });
                n.material = meshMat;
                n.castShadow = false;
                n.receiveShadow = false;
                track(n); // Track each mesh for geometry/material disposal
                ghostMats.push(meshMat);
            }
        });

        // Force the knight's front to face +Z locally.
        // createPieceModel applies Math.PI to white knights, so we add another Math.PI
        // to make the total rotation 0 (facing +Z). Black knights are already at 0.
        knightModel.rotation.y = attackerColor === 'white' ? Math.PI : 0;

        ghostGroup.add(knightModel);
        ghostGroup.renderOrder = 68;
        track(ghostGroup); // Track the group for removal from the scene
        scene.add(ghostGroup);

        const startAngle = (i / COUNT) * Math.PI * 2;
        const startRadius = isKingKill ? 2.4 : 1.2;
        const startPos = new THREE.Vector3(
            impactPos.x + Math.cos(startAngle) * startRadius,
            impactPos.y + 0.6,
            impactPos.z + Math.sin(startAngle) * startRadius
        );

        ghosts.push({
            mesh: ghostGroup,
            mats: ghostMats,
            startPos,
            delay: i * (isKingKill ? 0.06 : 0.05)
        });
    }

    const impactMat = _sigMat(T.flashColor, 0);
    const impactRing = track(new THREE.Mesh(
        new THREE.RingGeometry(0.35, 0.6, 48), impactMat
    ));
    impactRing.rotation.x = -Math.PI / 2;
    impactRing.position.set(impactPos.x, 0.06, impactPos.z);
    impactRing.renderOrder = 66;
    scene.add(impactRing);

    return {
        tick(t) {
            if (t < FIRE_AT) {
                for (const g of ghosts) {
                    for (const m of g.mats) m.opacity = 0;
                }
                return;
            }
            const ft = t - FIRE_AT;
            const window = isKingKill ? 0.9 : 0.4;

            if (ft > window + 0.4) {
                for (const g of ghosts) {
                    for (const m of g.mats) m.opacity = 0;
                }
            } else {
                for (const g of ghosts) {
                    const k = Math.max(0, Math.min(1,
                        (ft - g.delay) / (isKingKill ? 0.28 : 0.35)));
                    if (k <= 0) {
                        for (const m of g.mats) m.opacity = 0;
                        continue;
                    }

                    const target = new THREE.Vector3(
                        impactPos.x, impactPos.y + 0.35, impactPos.z);
                    g.mesh.position.lerpVectors(g.startPos, target, k);

                    // Make the ghost group look at the target. Since the knight's
                    // front is +Z locally, this makes the horse face the target.
                    g.mesh.lookAt(target);

                    const fadeOut = k > 0.9 ? (1 - (k - 0.9) / 0.1) : 1;

                    // Update opacity for all cloned materials
                    for (const m of g.mats) m.opacity = 0.95 * fadeOut;

                    // Scale down the full model to match the original cone's visual weight
                    const baseScale = 0.5;
                    g.mesh.scale.setScalar(baseScale * (0.85 + (1 - k) * 0.4));
                }
            }

            if (t >= IMPACT_AT) {
                const k = Math.min(1, (t - IMPACT_AT) / 0.55);
                impactMat.opacity = 0.95 * (1 - k);
                impactRing.scale.setScalar(1 + k * 5.5);
            }
        }
    };
}

/* ── ⛪ BISHOP — 聖光／虛空斬擊 (Diagonal Slash) ──────── */
function buildBishopKillSignature(ctx) {
    const { scene, track, T, isKingKill,
        orbPos, impactPos, CHARGE_END, FIRE_AT, IMPACT_AT } = ctx;

    const baseAngle = Math.atan2(
        impactPos.z - orbPos.z,
        impactPos.x - orbPos.x
    );
    const slashCount = isKingKill ? 3 : 1;

    const slashes = [];
    for (let s = 0; s < slashCount; s++) {
        const angleOffset = isKingKill ? (s - 1) * (Math.PI / 3) : 0;
        const a = baseAngle + angleOffset;

        const mat = _sigMat(T.beamMid, 0);
        const beamLen = 4.2;
        const beam = track(new THREE.Mesh(
            new THREE.BoxGeometry(beamLen, 0.10, 0.34), mat
        ));
        beam.position.set(impactPos.x, impactPos.y + 0.35, impactPos.z);
        beam.rotation.y = -a;
        beam.renderOrder = 62;
        scene.add(beam);

        const haloMat = _sigMat(T.beamOuter, 0);
        const halo = track(new THREE.Mesh(
            new THREE.BoxGeometry(beamLen * 1.05, 0.02, 0.62), haloMat
        ));
        halo.position.copy(beam.position);
        halo.rotation.y = -a;
        halo.position.y += 0.01;
        halo.renderOrder = 61;
        scene.add(halo);

        slashes.push({ beam, mat, halo, haloMat });
    }

    const crackMat = _sigMat(T.runeA, 0);
    const crack = track(new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 0.18), crackMat
    ));
    crack.rotation.x = -Math.PI / 2;
    crack.rotation.z = -baseAngle;
    crack.position.set(impactPos.x, 0.04, impactPos.z);
    crack.renderOrder = 5;
    scene.add(crack);

    const impactMat = _sigMat(T.flashColor, 0);
    const impactSphere = track(new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 16, 16), impactMat
    ));
    impactSphere.position.copy(impactPos);
    scene.add(impactSphere);

    return {
        tick(t) {
            if (t < CHARGE_END) {
                crackMat.opacity = 0.6 * (t / CHARGE_END);
                for (const s of slashes) {
                    s.mat.opacity = 0;
                    s.haloMat.opacity = 0;
                }
                impactMat.opacity = 0;
                return;
            }

            if (t >= CHARGE_END && t < FIRE_AT + 0.2) {
                const k = Math.min(1, (t - CHARGE_END) / 0.15);
                const fade = Math.max(0, 1 - (t - CHARGE_END) / 0.8);
                for (const s of slashes) {
                    s.mat.opacity = 0.98 * fade * k;
                    s.haloMat.opacity = 0.5 * fade * k;
                    s.beam.scale.set(1, 1, 0.6 + k * 0.6);
                    s.halo.scale.set(1, 1, 0.6 + k * 0.6);
                }
                crackMat.opacity = 0.9 * fade;
            } else if (t >= FIRE_AT + 0.2) {
                for (const s of slashes) {
                    s.mat.opacity = Math.max(0, s.mat.opacity - 0.08);
                    s.haloMat.opacity = Math.max(0, s.haloMat.opacity - 0.05);
                }
                crackMat.opacity = Math.max(0, crackMat.opacity - 0.06);
            }

            if (t >= IMPACT_AT) {
                const k = Math.min(1, (t - IMPACT_AT) / 0.55);
                impactMat.opacity = 0.95 * (1 - k) * (1 - k);
                impactSphere.scale.setScalar(0.5 + k * 5);
            }
        }
    };
}


/* ── 👑 QUEEN — 帝王宣判 (Royal Judgement) ────────────── */
function buildQueenKillSignature(ctx) {
    const { scene, track, T, isKingKill,
        orbPos, impactPos, CHARGE_END, FIRE_AT, IMPACT_AT } = ctx;

    const throne = new THREE.Group();
    throne.position.set(orbPos.x, 0.02, orbPos.z);
    scene.add(throne);
    track(throne);

    const throneMat = _sigMat(T.runeA, 0);

    const back = track(new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 1.6, 0.08), throneMat
    ));
    back.position.set(0, 0.9, -0.35);
    throne.add(back);

    const seat = track(new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.08, 0.5), throneMat
    ));
    seat.position.set(0, 0.35, 0);
    throne.add(seat);

    for (const sx of [-0.4, 0.4]) {
        for (const sz of [-0.3, 0.3]) {
            const col = track(new THREE.Mesh(
                new THREE.BoxGeometry(0.06, 0.4, 0.06), throneMat
            ));
            col.position.set(sx, 0.18, sz);
            throne.add(col);
        }
    }
    const crownCount = isKingKill ? 8 : 5;
    for (let i = 0; i < crownCount; i++) {
        const a = -Math.PI / 2 + (i / (crownCount - 1) - 0.5) * 1.6;
        const spike = track(new THREE.Mesh(
            new THREE.ConeGeometry(0.05, 0.22, 6), throneMat
        ));
        spike.position.set(Math.cos(a) * 0.42, 1.78, -0.35);
        throne.add(spike);
    }

    const beamMat = _sigMat(T.beamCore, 0);
    const beam = track(new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.62, 7, 20, 1, true), beamMat
    ));
    beam.position.set(impactPos.x, 3.5, impactPos.z);
    beam.renderOrder = 60;
    scene.add(beam);

    const swords = [];
    if (isKingKill) {
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const mat = _sigMat(i % 2 ? T.orbTorusA : T.orbTorusB, 0);
            const geo = new THREE.BoxGeometry(1.6, 0.06, 0.06);
            const mesh = track(new THREE.Mesh(geo, mat));
            mesh.position.set(
                impactPos.x + Math.cos(a) * 2.4,
                1.0,
                impactPos.z + Math.sin(a) * 2.4
            );
            mesh.rotation.y = -a;
            mesh.renderOrder = 64;
            scene.add(mesh);
            swords.push({ mesh, mat, angle: a });
        }
    }

    const haloMat = _sigMat(T.runeB, 0);
    const halo = track(new THREE.Mesh(
        new THREE.RingGeometry(0.4, 0.55, 56), haloMat
    ));
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(impactPos.x, 0.06, impactPos.z);
    halo.renderOrder = 5;
    scene.add(halo);

    const impactMat = _sigMat(T.flashColor, 0);
    const impactSphere = track(new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 18, 18), impactMat
    ));
    impactSphere.position.copy(impactPos);
    scene.add(impactSphere);

    return {
        tick(t) {
            if (t < CHARGE_END) {
                const k = t / CHARGE_END;
                throneMat.opacity = 0.85 * k;
                throne.position.y = 0.02 + (1 - k) * -0.6;
                beamMat.opacity = 0;
                for (const s of swords) s.mat.opacity = 0;
                haloMat.opacity = 0;
                impactMat.opacity = 0;
                return;
            }

            if (t >= CHARGE_END && t < FIRE_AT + 0.35) {
                const k = Math.min(1, (t - CHARGE_END) / 0.2);
                const fade = Math.max(0, 1 - (t - CHARGE_END) / 0.6);
                beamMat.opacity = 0.95 * k * fade;
                beam.scale.set(1 + k * 0.4, 1, 1 + k * 0.4);
                haloMat.opacity = 0.85 * fade;
                halo.scale.setScalar(1 + k * 4);
                throneMat.opacity = Math.max(0, throneMat.opacity - 0.06);

                for (const s of swords) {
                    const sk = Math.min(1, (t - CHARGE_END) / 0.4);
                    const r = 2.4 - sk * 1.8;
                    s.mesh.position.x = impactPos.x + Math.cos(s.angle) * r;
                    s.mesh.position.z = impactPos.z + Math.sin(s.angle) * r;
                    s.mesh.rotation.z = sk * Math.PI * 0.9;
                    s.mat.opacity = 0.95 * fade;
                }
            } else if (t >= FIRE_AT + 0.35) {
                beamMat.opacity = Math.max(0, beamMat.opacity - 0.08);
                haloMat.opacity = Math.max(0, haloMat.opacity - 0.05);
                for (const s of swords) {
                    s.mat.opacity = Math.max(0, s.mat.opacity - 0.08);
                }
            }

            if (t >= IMPACT_AT) {
                const k = Math.min(1, (t - IMPACT_AT) / 0.6);
                impactMat.opacity = 0.98 * (1 - k) * (1 - k);
                impactSphere.scale.setScalar(0.5 + k * 6);
            }
        }
    };
}


/* ── ♚ KING — 領域裁決（保留現有風格，小升級） ───────── */
function buildKingKillSignature(ctx) {
    const { scene, track, T, impactPos,
        CHARGE_END, IMPACT_AT } = ctx;

    const domeMat = _sigMat(T.runeA, 0);
    const dome = track(new THREE.Mesh(
        new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
        domeMat
    ));
    dome.position.set(impactPos.x, 0.05, impactPos.z);
    dome.renderOrder = 6;
    scene.add(dome);

    const rimMat = _sigMat(T.flashColor, 0);
    const rim = track(new THREE.Mesh(
        new THREE.RingGeometry(0.94, 1.05, 56), rimMat
    ));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(impactPos.x, 0.07, impactPos.z);
    rim.renderOrder = 67;
    scene.add(rim);

    const sparks = [];
    for (let i = 0; i < 20; i++) {
        const mat = _sigMat(T.chargeA, 0);
        const mesh = track(new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 6, 6), mat
        ));
        mesh.renderOrder = 68;
        scene.add(mesh);
        sparks.push({
            mesh, mat,
            a: (i / 20) * Math.PI * 2,
            y: 1.6 + Math.random() * 1.2,
        });
    }

    return {
        tick(t) {
            if (t < CHARGE_END) {
                const k = Math.min(1, t / CHARGE_END);
                dome.scale.setScalar(0.6 + k * 0.3);
                domeMat.opacity = 0.35 * k;
                rimMat.opacity = 0;
                for (const s of sparks) s.mat.opacity = 0;
                return;
            }
            const it = t - IMPACT_AT;
            if (it < 0) {
                const downT = (t - CHARGE_END) / Math.max(0.01, IMPACT_AT - CHARGE_END);
                const k = Math.max(0, Math.min(1, downT));
                dome.scale.setScalar(0.9 - k * 0.5);
                domeMat.opacity = 0.35 + 0.55 * k;
                for (const s of sparks) {
                    const sk = Math.max(0, k - 0.2) / 0.8;
                    const r = 1.6 * (1 - sk);
                    s.mesh.position.set(
                        impactPos.x + Math.cos(s.a) * r,
                        Math.max(0.1, s.y * (1 - sk)),
                        impactPos.z + Math.sin(s.a) * r
                    );
                    s.mat.opacity = 0.9 * sk;
                }
                rimMat.opacity = 0;
                return;
            }
            const k = Math.min(it / 0.7, 1);
            const fade = 1 - k;
            dome.scale.setScalar(0.4 + k * 1.8);
            domeMat.opacity = 0.9 * fade;
            rimMat.opacity = 0.95 * fade;
            rim.scale.setScalar(1 + k * 4.0);
            for (const s of sparks) {
                s.mat.opacity *= 0.8;
                s.mesh.position.y += 0.02;
            }
        }
    };
}

function playKillAnimation(kingColor, checker) {
    isAnimating = true;

    const king = gameState.findKing(kingColor);
    if (!king) {
        finalizeDomainKill(kingColor, checker);
        return;
    }

    const kingPos = get3DPosition(king.r, king.c, 0);
    const checkerPos = get3DPosition(checker.r, checker.c, 0);
    const kingObj = pieceObjects[`${king.r},${king.c}`];
    const victimObj = pieceObjects[`${checker.r},${checker.c}`];

    const themeKey = kingColor === 'white' ? 'light' : 'dark';
    const T = KILL_THEMES[themeKey];
    const isWhiteKing = (kingColor === 'white');

    const ORB_HEIGHT = 1.55;
    const IMPACT_Y = 0.45;
    const orbPos = new THREE.Vector3(kingPos.x, ORB_HEIGHT, kingPos.z);
    const impactPos = new THREE.Vector3(checkerPos.x, IMPACT_Y, checkerPos.z);

    const created = [];
    const track = (obj) => { created.push(obj); return obj; };

    const vignette = document.createElement('div');
    vignette.style.cssText = `
        position: fixed; inset: 0; pointer-events: none; z-index: 490;
        background: ${T.vignetteBg};
        opacity: 0; transition: opacity 0.5s ease;
    `;
    document.body.appendChild(vignette);
    requestAnimationFrame(() => { vignette.style.opacity = '1'; });

    const flashHex = '#' + T.flashColor.toString(16).padStart(6, '0');
    const screenFlash = document.createElement('div');
    screenFlash.style.cssText = `
        position: fixed; inset: 0; pointer-events: none; z-index: 495;
        background: radial-gradient(circle at 50% 50%,
            ${flashHex} 0%,
            ${flashHex}cc 25%,
            ${flashHex}55 50%,
            rgba(0,0,0,0) 75%);
        opacity: 0;
    `;
    document.body.appendChild(screenFlash);

    const kingMats = [];
    if (kingObj) {
        kingObj.traverse(n => {
            if (n.isMesh && n.material && n.material.color) {
                kingMats.push({
                    mesh: n,
                    color: n.material.color.clone(),
                    emissive: n.material.emissive ? n.material.emissive.clone() : null,
                });
            }
        });
    }

    const victimMats = [];
    if (victimObj) {
        victimObj.traverse(n => {
            if (n.isMesh && n.material && n.material.color) {
                n.material.transparent = true;
                victimMats.push({
                    mesh: n,
                    color: n.material.color.clone(),
                    emissive: n.material.emissive ? n.material.emissive.clone() : null,
                });
            }
        });
    }

    // Ground rune
    const runeGroup = track(new THREE.Group());
    runeGroup.position.set(kingPos.x, 0.08, kingPos.z);
    scene.add(runeGroup);

    const runeMat1 = new THREE.MeshBasicMaterial({
        color: T.runeA, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const runeRing1 = track(new THREE.Mesh(new THREE.RingGeometry(0.66, 0.74, 64), runeMat1));
    runeRing1.rotation.x = -Math.PI / 2;
    runeGroup.add(runeRing1);

    const runeMat2 = new THREE.MeshBasicMaterial({
        color: T.runeB, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const runeRing2 = track(new THREE.Mesh(new THREE.RingGeometry(0.94, 1.0, 64), runeMat2));
    runeRing2.rotation.x = -Math.PI / 2;
    runeRing2.position.y = 0.004;
    runeGroup.add(runeRing2);

    const runeTicks = [];
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const tm = new THREE.MeshBasicMaterial({
            color: T.runeB, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        const tick = track(new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.035), tm));
        tick.position.set(Math.cos(a) * 0.83, 0.002, Math.sin(a) * 0.83);
        tick.rotation.x = -Math.PI / 2;
        tick.rotation.z = -a;
        runeGroup.add(tick);
        runeTicks.push({ mesh: tick, mat: tm });
    }

    // Energy pillar
    const pillarMat = new THREE.MeshBasicMaterial({
        color: T.pillarBody, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide,
    });
    const pillar = track(new THREE.Mesh(
        new THREE.CylinderGeometry(0.38, 0.62, 3.6, 24, 1, true),
        pillarMat
    ));
    pillar.position.set(kingPos.x, 1.8, kingPos.z);
    pillar.renderOrder = 30;
    scene.add(pillar);

    const corePillarMat = new THREE.MeshBasicMaterial({
        color: T.pillarCore, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide,
    });
    const corePillar = track(new THREE.Mesh(
        new THREE.CylinderGeometry(0.10, 0.20, 3.6, 16, 1, true),
        corePillarMat
    ));
    corePillar.position.set(kingPos.x, 1.8, kingPos.z);
    corePillar.renderOrder = 31;
    scene.add(corePillar);

    // Charging orb
    const orbCoreMat = new THREE.MeshBasicMaterial({
        color: T.orbCore, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const orbCore = track(new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 20), orbCoreMat));
    orbCore.position.copy(orbPos);
    orbCore.renderOrder = 50;
    scene.add(orbCore);

    const orbGlowMat = new THREE.MeshBasicMaterial({
        color: T.orbGlow, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const orbGlow = track(new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 20), orbGlowMat));
    orbGlow.position.copy(orbPos);
    orbGlow.renderOrder = 49;
    scene.add(orbGlow);

    const orbAuraMat = new THREE.MeshBasicMaterial({
        color: T.orbAura, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide,
    });
    const orbAura = track(new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 20), orbAuraMat));
    orbAura.position.copy(orbPos);
    orbAura.renderOrder = 48;
    scene.add(orbAura);

    const orbTorusMat1 = new THREE.MeshBasicMaterial({
        color: T.orbTorusA, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide,
    });
    const orbTorus1 = track(new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.018, 8, 40), orbTorusMat1));
    orbTorus1.position.copy(orbPos);
    orbTorus1.renderOrder = 47;
    scene.add(orbTorus1);

    const orbTorusMat2 = new THREE.MeshBasicMaterial({
        color: T.orbTorusB, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide,
    });
    const orbTorus2 = track(new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.014, 8, 40), orbTorusMat2));
    orbTorus2.position.copy(orbPos);
    orbTorus2.renderOrder = 47;
    scene.add(orbTorus2);

    // Charge-in particles
    const chargeParticles = [];
    for (let i = 0; i < 48; i++) {
        const pg = new THREE.SphereGeometry(0.020 + Math.random() * 0.024, 5, 5);
        const pm = new THREE.MeshBasicMaterial({
            color: Math.random() < 0.5 ? T.chargeA : T.chargeB,
            transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const p = track(new THREE.Mesh(pg, pm));
        p.position.copy(orbPos);
        p.renderOrder = 51;
        const a = Math.random() * Math.PI * 2;
        const r = 1.0 + Math.random() * 1.3;
        const y = ORB_HEIGHT - 0.8 + Math.random() * 1.6;
        p.userData = {
            baseAngle: a, baseRadius: r, baseY: y,
            spinSpeed: 3 + Math.random() * 5,
            delay: Math.random() * 0.7,
        };
        scene.add(p);
        chargeParticles.push(p);
    }

    // Beam
    const beamDir = new THREE.Vector3().subVectors(impactPos, orbPos);
    const beamLen = beamDir.length();
    const beamMid = new THREE.Vector3().addVectors(orbPos, impactPos).multiplyScalar(0.5);
    const beamQuat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        beamDir.clone().normalize()
    );

    const beamCoreMat = new THREE.MeshBasicMaterial({
        color: T.beamCore, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const beamCore = track(new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, beamLen, 12, 1, true),
        beamCoreMat
    ));
    beamCore.position.copy(beamMid);
    beamCore.quaternion.copy(beamQuat);
    beamCore.renderOrder = 60;
    scene.add(beamCore);

    const beamMidMat = new THREE.MeshBasicMaterial({
        color: T.beamMid, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide,
    });
    const beamMidMesh = track(new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, beamLen, 12, 1, true),
        beamMidMat
    ));
    beamMidMesh.position.copy(beamMid);
    beamMidMesh.quaternion.copy(beamQuat);
    beamMidMesh.renderOrder = 59;
    scene.add(beamMidMesh);

    const beamOuterMat = new THREE.MeshBasicMaterial({
        color: T.beamOuter, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide,
    });
    const beamOuter = track(new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.34, beamLen, 12, 1, true),
        beamOuterMat
    ));
    beamOuter.position.copy(beamMid);
    beamOuter.quaternion.copy(beamQuat);
    beamOuter.renderOrder = 58;
    scene.add(beamOuter);

    const beamHelix = [];
    const beamDirN = beamDir.clone().normalize();
    const beamRight = new THREE.Vector3(beamDirN.z, 0, -beamDirN.x);
    if (beamRight.lengthSq() < 0.001) beamRight.set(1, 0, 0);
    beamRight.normalize();
    const beamUp = new THREE.Vector3().crossVectors(beamDirN, beamRight).normalize();

    for (let i = 0; i < 36; i++) {
        const tLocal = i / 35;
        const pg = new THREE.SphereGeometry(0.028 + Math.random() * 0.022, 5, 5);
        const pm = new THREE.MeshBasicMaterial({
            color: Math.random() < 0.5 ? T.beamCore : T.beamMid,
            transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const p = track(new THREE.Mesh(pg, pm));
        p.renderOrder = 61;
        p.userData = { tLocal };
        scene.add(p);
        beamHelix.push(p);
    }

    // Shock rings
    const shockRings = [];
    const shockColors = [T.shockA, T.shockB, T.shockC];
    for (let i = 0; i < 3; i++) {
        const rm = new THREE.MeshBasicMaterial({
            color: shockColors[i], transparent: true, opacity: 0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const r = track(new THREE.Mesh(new THREE.RingGeometry(0.30, 0.48, 64), rm));
        r.rotation.x = -Math.PI / 2;
        r.position.set(impactPos.x, 0.05 + i * 0.01, impactPos.z);
        r.renderOrder = 55 + i;
        scene.add(r);
        shockRings.push({ mesh: r, mat: rm, delay: i * 0.10, maxScale: 5.0 + i * 1.5 });
    }

    const impactMat = new THREE.MeshBasicMaterial({
        color: T.flashColor, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const impactSphere = track(new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 20, 20),
        impactMat
    ));
    impactSphere.position.copy(impactPos);
    impactSphere.renderOrder = 62;
    scene.add(impactSphere);

    // Shards
    const shards = [];
    for (let i = 0; i < 40; i++) {
        const sg = new THREE.TetrahedronGeometry(0.045 + Math.random() * 0.08, 0);
        const sm = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(
                T.shardHue + Math.random() * T.shardHueRange,
                1.0,
                T.shardLight - 0.20 + Math.random() * 0.30
            ),
            transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const shard = track(new THREE.Mesh(sg, sm));
        shard.renderOrder = 65;
        shard.position.copy(impactPos);
        shard.userData.vel = new THREE.Vector3(
            (Math.random() - 0.5) * 6,
            2.2 + Math.random() * 4.5,
            (Math.random() - 0.5) * 6
        );
        shard.userData.spin = new THREE.Vector3(
            (Math.random() - 0.5) * 14,
            (Math.random() - 0.5) * 14,
            (Math.random() - 0.5) * 14
        );
        scene.add(shard);
        shards.push(shard);
    }

    // Souls
    const souls = [];
    for (let i = 0; i < 28; i++) {
        const sg = new THREE.SphereGeometry(0.022 + Math.random() * 0.028, 5, 5);
        const sm = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(
                T.soulHue + Math.random() * T.soulHueRange,
                0.9,
                0.65 + Math.random() * 0.25
            ),
            transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const soul = track(new THREE.Mesh(sg, sm));
        soul.renderOrder = 66;
        const a = Math.random() * Math.PI * 2;
        const r = 0.10 + Math.random() * 0.35;
        soul.position.set(
            impactPos.x + Math.cos(a) * r,
            impactPos.y + Math.random() * 0.2,
            impactPos.z + Math.sin(a) * r
        );
        soul.userData.vel = new THREE.Vector3(
            Math.cos(a) * 0.30,
            1.6 + Math.random() * 1.8,
            Math.sin(a) * 0.30
        );
        soul.userData.life = 1.0 + Math.random() * 0.6;
        soul.userData.phase = Math.random() * Math.PI * 2;
        scene.add(soul);
        souls.push(soul);
    }

    // Explosion particles
    const explosionParticles = [];
    let explosionSpawned = false;
    const spawnExplosion = () => {
        for (let i = 0; i < 80; i++) {
            const pg = new THREE.SphereGeometry(0.030 + Math.random() * 0.055, 5, 5);
            const hue = T.shardHue + Math.random() * T.shardHueRange;
            const pm = new THREE.MeshBasicMaterial({
                color: new THREE.Color().setHSL(hue, 1.0, 0.55 + Math.random() * 0.35),
                transparent: true, opacity: 1,
                blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const p = track(new THREE.Mesh(pg, pm));
            p.position.copy(impactPos);
            p.renderOrder = 63;
            const a = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI;
            const speed = 2.5 + Math.random() * 5.5;
            p.userData.vel = new THREE.Vector3(
                Math.sin(phi) * Math.cos(a) * speed,
                Math.abs(Math.cos(phi)) * speed * 1.3 + 1.5,
                Math.sin(phi) * Math.sin(a) * speed
            );
            p.userData.bornAt = clock.getElapsedTime();
            p.userData.life = 0.9 + Math.random() * 0.7;
            scene.add(p);
            explosionParticles.push(p);
        }
    };

    const t0 = clock.getElapsedTime();
    const CHARGE_END = 1.10;
    const FIRE_AT = 1.10;
    const IMPACT_AT = 1.22;
    const VICTIM_HIDE_AT = 1.30;
    const TOTAL = 3.40;

    const KING_GLOW = new THREE.Color(T.casterGlow);
    const KING_AURA = new THREE.Color(T.casterAura);
    const KING_COLOR_LERP = T.casterLerp;
    const KING_AURA_POWER = isWhiteKing ? 1.00 : 1.35;
    const VICTIM_FLASH = new THREE.Color(T.flashColor);

    // ★ 依「將軍者的棋子類型」挑選處決風格
    const killSignature = buildKillSignature(
        (checker.piece && checker.piece.type) || 'pawn',
        {
            scene, track, T,
            kingPos, checkerPos, orbPos, impactPos,
            isWhiteKing,
            isKingKill: false,
            CHARGE_END, FIRE_AT, IMPACT_AT, VICTIM_HIDE_AT, TOTAL,
        }
    );

    const animate = () => {
        const t = clock.getElapsedTime() - t0;

        if (killSignature) killSignature.tick(t);

        if (kingMats.length > 0) {
            const k = Math.min(1, t / CHARGE_END);
            const pulse = 0.5 + 0.5 * Math.sin(t * 20);
            for (const m of kingMats) {
                const c = m.color.clone().lerp(KING_GLOW, k * KING_COLOR_LERP);
                m.mesh.material.color.copy(c);
                if (m.mesh.material.emissive) {
                    m.mesh.material.emissive.copy(KING_AURA)
                        .multiplyScalar(k * (0.35 + pulse * 0.4) * KING_AURA_POWER);
                    m.mesh.material.emissiveIntensity = 1;
                }
            }
        }

        {
            const appear = Math.min(1, t / 0.35);
            const fadeOut = Math.max(0, 1 - Math.max(0, t - CHARGE_END + 0.3) / 0.4);
            const k = appear * fadeOut;
            runeMat1.opacity = 0.85 * k;
            runeMat2.opacity = 0.70 * k;
            for (const tk of runeTicks) tk.mat.opacity = 0.85 * k;
            runeGroup.rotation.y += 0.025;
        }

        {
            const up = Math.min(1, t / 0.5);
            const fade = Math.max(0, 1 - Math.max(0, t - CHARGE_END + 0.2) / 0.4);
            pillarMat.opacity = 0.42 * up * fade;
            corePillarMat.opacity = 0.85 * up * fade;
            pillar.rotation.y += 0.04;
            corePillar.rotation.y -= 0.08;
        }

        if (t < CHARGE_END) {
            const k = Math.min(1, t / CHARGE_END);
            const ease = 1 - Math.pow(1 - k, 3);

            orbCoreMat.opacity = 0.95 * ease;
            orbGlowMat.opacity = 0.75 * ease * (0.7 + 0.3 * Math.sin(t * 24));
            orbAuraMat.opacity = 0.35 * ease;

            orbCore.scale.setScalar(0.6 + 0.5 * ease);
            orbGlow.scale.setScalar(0.8 + 0.4 * ease);
            orbAura.scale.setScalar(0.85 + 0.35 * ease);

            orbTorusMat1.opacity = 0.75 * ease * (0.7 + 0.3 * Math.sin(t * 8));
            orbTorusMat2.opacity = 0.55 * ease * (0.7 + 0.3 * Math.sin(t * 8 + 1));
            orbTorus1.rotation.x = t * 2.5;
            orbTorus1.rotation.y = t * 3.2;
            orbTorus2.rotation.x = -t * 2.0;
            orbTorus2.rotation.z = t * 2.8;

            for (const p of chargeParticles) {
                const pt = t - p.userData.delay;
                if (pt < 0) { p.material.opacity = 0; continue; }
                const lk = Math.min(1, pt / 0.9);
                const angle = p.userData.baseAngle + pt * p.userData.spinSpeed;
                const r = p.userData.baseRadius * (1 - lk) * (1 - lk * 0.2);
                const y = p.userData.baseY + (ORB_HEIGHT - p.userData.baseY) * lk;
                p.position.set(
                    kingPos.x + Math.cos(angle) * r,
                    y,
                    kingPos.z + Math.sin(angle) * r
                );
                p.material.opacity = (1 - lk) * 0.95;
                p.scale.setScalar(1 - lk * 0.5);
            }
        }

        if (t >= FIRE_AT && t < FIRE_AT + 0.35) {
            const ft = t - FIRE_AT;
            const fade = Math.max(0, 1 - ft / 0.32);
            const pulse = 0.85 + 0.15 * Math.sin(ft * 60);

            // ★ 若有 signature，關掉通用光束
            const beamMult = killSignature ? 0 : 1;

            beamCoreMat.opacity = 0.98 * fade * pulse * beamMult;
            beamMidMat.opacity = 0.80 * fade * beamMult;
            beamOuterMat.opacity = 0.45 * fade * beamMult;

            const wob = 1 + 0.15 * Math.sin(ft * 40);
            beamOuter.scale.set(wob, 1, wob);

            const helixSpin = ft * 30;
            for (const p of beamHelix) {
                const tLocal = p.userData.tLocal;
                const angle = helixSpin + tLocal * Math.PI * 6;
                const taper = 1 - tLocal * 0.5;
                const worldPos = orbPos.clone()
                    .add(beamDirN.clone().multiplyScalar(tLocal * beamLen))
                    .add(beamRight.clone().multiplyScalar(Math.cos(angle) * 0.28 * taper))
                    .add(beamUp.clone().multiplyScalar(Math.sin(angle) * 0.28 * taper));
                p.position.copy(worldPos);
                p.material.opacity = 0.95 * fade * beamMult;
                p.scale.setScalar(0.7 + 0.5 * fade);
            }
        } else if (t >= FIRE_AT + 0.35) {
            beamCoreMat.opacity = 0;
            beamMidMat.opacity = 0;
            beamOuterMat.opacity = 0;
            for (const p of beamHelix) p.material.opacity = 0;
        } else {
            for (const p of beamHelix) p.material.opacity = 0;
        }

        if (t >= FIRE_AT) {
            const killK = Math.min(1, (t - FIRE_AT) / 0.15);
            orbCoreMat.opacity = Math.max(0, 0.95 * (1 - killK));
            orbGlowMat.opacity = Math.max(0, 0.75 * (1 - killK));
            orbAuraMat.opacity = Math.max(0, 0.35 * (1 - killK));
            orbTorusMat1.opacity = Math.max(0, orbTorusMat1.opacity * (1 - killK * 2));
            orbTorusMat2.opacity = Math.max(0, orbTorusMat2.opacity * (1 - killK * 2));
        }

        if (t >= IMPACT_AT && !explosionSpawned) {
            explosionSpawned = true;
            spawnExplosion();
        }

        if (t >= IMPACT_AT && t < IMPACT_AT + 0.18) {
            screenFlash.style.opacity = String(1 - (t - IMPACT_AT) / 0.18);
        } else if (t >= IMPACT_AT + 0.18) {
            screenFlash.style.opacity = '0';
        }

        if (t >= IMPACT_AT && t < IMPACT_AT + 0.55) {
            const it = (t - IMPACT_AT) / 0.55;
            impactMat.opacity = 0.98 * (1 - it) * (1 - it);
            impactSphere.scale.setScalar(0.5 + it * 5.5);
        } else if (t >= IMPACT_AT + 0.55) {
            impactMat.opacity = 0;
        }

        for (const sr of shockRings) {
            const st = t - IMPACT_AT - sr.delay;
            if (st < 0 || st > 0.75) { sr.mat.opacity = 0; continue; }
            const prog = st / 0.75;
            sr.mat.opacity = 0.9 * (1 - prog);
            const s = 1 + prog * sr.maxScale;
            sr.mesh.scale.set(s, s, 1);
        }

        if (t >= IMPACT_AT && victimMats.length > 0 && victimObj) {
            const vt = Math.min(1, (t - IMPACT_AT) / 0.10);
            const flashMix = Math.min(1, vt * 2.5);
            for (const m of victimMats) {
                const c = m.color.clone().lerp(VICTIM_FLASH, flashMix);
                m.mesh.material.color.copy(c);
                if (m.mesh.material.emissive) {
                    m.mesh.material.emissive.copy(VICTIM_FLASH);
                    m.mesh.material.emissiveIntensity = flashMix * 2.0;
                }
                m.mesh.material.opacity = Math.max(0.05, 1 - vt * 0.8);
            }
        }

        if (t >= VICTIM_HIDE_AT) {
            if (victimObj && victimObj.visible) victimObj.visible = false;
            const st = t - VICTIM_HIDE_AT;

            for (const shard of shards) {
                if (st > 2.0) { shard.material.opacity = 0; continue; }
                shard.position.addScaledVector(shard.userData.vel, 0.016);
                shard.userData.vel.y -= 0.22;
                shard.rotation.x += shard.userData.spin.x * 0.016;
                shard.rotation.y += shard.userData.spin.y * 0.016;
                shard.rotation.z += shard.userData.spin.z * 0.016;
                const lifeT = Math.min(1, st / 1.8);
                shard.material.opacity = Math.max(0, 1 - lifeT);
                shard.scale.setScalar(Math.max(0.1, 1 - lifeT * 0.7));
            }

            for (const soul of souls) {
                const lt = st / soul.userData.life;
                if (lt < 0 || lt > 1) { soul.material.opacity = 0; continue; }
                soul.position.addScaledVector(soul.userData.vel, 0.016);
                soul.userData.vel.y -= 0.02;
                soul.position.x += Math.sin(st * 5 + soul.userData.phase) * 0.003;
                soul.position.z += Math.cos(st * 5 + soul.userData.phase) * 0.003;
                soul.material.opacity = (1 - lt) * 0.95;
                soul.scale.setScalar(1 - lt * 0.4);
            }
        }

        const now = clock.getElapsedTime();
        for (const p of explosionParticles) {
            const age = now - p.userData.bornAt;
            if (age >= p.userData.life) { p.visible = false; continue; }
            p.visible = true;
            p.position.addScaledVector(p.userData.vel, 0.016);
            p.userData.vel.y -= 0.20;
            const lt = age / p.userData.life;
            p.material.opacity = Math.max(0, 1 - lt) * (1 - lt);
            p.scale.setScalar(1 - lt * 0.4);
        }

        if (t < TOTAL) {
            requestAnimationFrame(animate);
        } else {
            disposeAll();
            finalizeDomainKill(kingColor, checker);
        }
    };

    const disposeAll = () => {
        if (vignette.parentNode) {
            vignette.style.opacity = '0';
            setTimeout(() => vignette.remove(), 600);
        }
        if (screenFlash.parentNode) screenFlash.remove();
        for (const obj of created) {
            if (obj.parent) obj.parent.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        }
    };

    animate();
}

function finalizeDomainKill(defenderColor, checker) {
    const r = checker.r, c = checker.c;
    const victimPiece = gameState.board[r][c];

    if (victimPiece) {
        gameState.board[r][c] = null;
        gameState.moveHistory.push({
            type: 'domain_kill',
            fromR: defenderKing ? defenderKing.r : null,      // ★ NEW
            fromC: defenderKing ? defenderKing.c : null,      // ★ NEW
            toR: r,                                           // ★ NEW
            toC: c,                                           // ★ NEW
            r, c,
            piece: { ...victimPiece },
        });
    }

    syncPiecesAfterMove();
    gameState.flipTurn();
    switchTimer(gameState.turn);

    if (currentMode === 'multiplayer' && peerConnection?.open && defenderColor === playerColor) {
        peerConnection.send({
            type: 'domain_result',
            winner: 'defender',
            checkerR: r,
            checkerC: c,
            defenderKingR: dk ? dk.r : null,
            defenderKingC: dk ? dk.c : null,
        });
    }

    kingSkillState.active = false;
    kingSkillState.context = null;
    battleState = null;
    isAnimating = false;

    updateTurnIndicator();
    checkGameStatus();

    if (!gameOverFlag && currentMode === 'ai' && gameState.turn !== playerColor) {
        aiThinking = true;
        setTimeout(makeAIMove, 500);
    }
}

function playKillKingAnimation(kingColor, checker) {
    isAnimating = true;

    const king = gameState.findKing(kingColor);
    if (!king) {
        finalizeKingKill(kingColor, checker);
        return;
    }

    const kingPos = get3DPosition(king.r, king.c, 0);
    const attackerPos = get3DPosition(checker.r, checker.c, 0);
    const kingObj = pieceObjects[`${king.r},${king.c}`];
    const attackerObj = pieceObjects[`${checker.r},${checker.c}`];

    const attackerColor = kingColor === 'white' ? 'black' : 'white';
    const themeKey = attackerColor === 'white' ? 'light' : 'dark';
    const T = KILL_THEMES[themeKey];

    const created = [];
    const track = (obj) => { created.push(obj); return obj; };

    const vignette = document.createElement('div');
    vignette.style.cssText = `
        position: fixed; inset: 0; pointer-events: none; z-index: 490;
        background: ${T.vignetteBg};
        opacity: 0; transition: opacity 0.5s ease;
    `;
    document.body.appendChild(vignette);
    requestAnimationFrame(() => { vignette.style.opacity = '1'; });

    const flashHex = '#' + T.flashColor.toString(16).padStart(6, '0');
    const screenFlash = document.createElement('div');
    screenFlash.style.cssText = `
        position: fixed; inset: 0; pointer-events: none; z-index: 495;
        background: radial-gradient(circle at 50% 50%,
            ${flashHex} 0%,
            ${flashHex}cc 25%,
            ${flashHex}55 50%,
            rgba(0,0,0,0) 75%);
        opacity: 0;
    `;
    document.body.appendChild(screenFlash);

    const attackerMats = [];
    if (attackerObj) {
        attackerObj.traverse(n => {
            if (n.isMesh && n.material && n.material.color) {
                attackerMats.push({
                    mesh: n,
                    color: n.material.color.clone(),
                    emissive: n.material.emissive ? n.material.emissive.clone() : null,
                });
            }
        });
    }

    const kingMats = [];
    if (kingObj) {
        kingObj.traverse(n => {
            if (n.isMesh && n.material && n.material.color) {
                n.material.transparent = true;
                kingMats.push({
                    mesh: n,
                    color: n.material.color.clone(),
                    emissive: n.material.emissive ? n.material.emissive.clone() : null,
                });
            }
        });
    }

    // Rune under attacker
    const runeGroup = track(new THREE.Group());
    runeGroup.position.set(attackerPos.x, 0.08, attackerPos.z);
    scene.add(runeGroup);

    const runeMat1 = new THREE.MeshBasicMaterial({
        color: T.runeA, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const runeRing1 = track(new THREE.Mesh(new THREE.RingGeometry(0.55, 0.62, 64), runeMat1));
    runeRing1.rotation.x = -Math.PI / 2;
    runeGroup.add(runeRing1);

    const runeMat2 = new THREE.MeshBasicMaterial({
        color: T.runeB, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const runeRing2 = track(new THREE.Mesh(new THREE.RingGeometry(0.80, 0.86, 64), runeMat2));
    runeRing2.rotation.x = -Math.PI / 2;
    runeRing2.position.y = 0.004;
    runeGroup.add(runeRing2);

    const runeTicks = [];
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const tm = new THREE.MeshBasicMaterial({
            color: T.runeB, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        const tick = track(new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.032), tm));
        tick.position.set(Math.cos(a) * 0.71, 0.002, Math.sin(a) * 0.71);
        tick.rotation.x = -Math.PI / 2;
        tick.rotation.z = -a;
        runeGroup.add(tick);
        runeTicks.push({ mesh: tick, mat: tm });
    }

    const chargeMotes = [];
    for (let i = 0; i < 40; i++) {
        const pg = new THREE.SphereGeometry(0.020 + Math.random() * 0.022, 5, 5);
        const pm = new THREE.MeshBasicMaterial({
            color: Math.random() < 0.5 ? T.chargeA : T.chargeB,
            transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const p = track(new THREE.Mesh(pg, pm));
        p.position.set(attackerPos.x, 0.5, attackerPos.z);
        p.renderOrder = 51;
        const a = Math.random() * Math.PI * 2;
        const r = 1.2 + Math.random() * 1.4;
        p.userData = {
            baseAngle: a, startR: r,
            spinSpeed: 4 + Math.random() * 5,
            startY: 0.4 + Math.random() * 1.6,
            delay: Math.random() * 0.6,
        };
        scene.add(p);
        chargeMotes.push(p);
    }

    // Blade ring
    const BLADE_COUNT = 12;
    const OUTER_R = 1.75;
    const INNER_R = 0.15;
    const BLADE_Y = 0.85;
    const blades = [];

    for (let i = 0; i < BLADE_COUNT; i++) {
        const angle = (i / BLADE_COUNT) * Math.PI * 2;

        const bladeGroup = new THREE.Group();
        bladeGroup.position.set(
            kingPos.x + Math.cos(angle) * OUTER_R,
            BLADE_Y,
            kingPos.z + Math.sin(angle) * OUTER_R
        );

        const inwardDir = new THREE.Vector3(
            -Math.cos(angle), -0.22, -Math.sin(angle)
        ).normalize();
        bladeGroup.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0), inwardDir
        );

        const bodyMat = new THREE.MeshBasicMaterial({
            color: T.bladeEdge, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
            side: THREE.DoubleSide,
        });
        const bodyGeo = new THREE.BoxGeometry(0.08, 0.85, 0.03);
        const body = track(new THREE.Mesh(bodyGeo, bodyMat));
        body.position.y = 0.425;
        body.renderOrder = 70;
        bladeGroup.add(body);

        const coreMat = new THREE.MeshBasicMaterial({
            color: T.bladeCore, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
            side: THREE.DoubleSide,
        });
        const coreGeo = new THREE.BoxGeometry(0.035, 0.82, 0.014);
        const coreMesh = track(new THREE.Mesh(coreGeo, coreMat));
        coreMesh.position.y = 0.425;
        coreMesh.renderOrder = 71;
        bladeGroup.add(coreMesh);

        const haloMat = new THREE.MeshBasicMaterial({
            color: T.bladeHalo, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
            side: THREE.BackSide,
        });
        const haloGeo = new THREE.BoxGeometry(0.22, 0.95, 0.16);
        const halo = track(new THREE.Mesh(haloGeo, haloMat));
        halo.position.y = 0.425;
        halo.renderOrder = 69;
        bladeGroup.add(halo);

        const tipMat = new THREE.MeshBasicMaterial({
            color: T.bladeCore, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const tipGeo = new THREE.ConeGeometry(0.06, 0.18, 4);
        const tip = track(new THREE.Mesh(tipGeo, tipMat));
        tip.position.y = 0.85 + 0.08;
        tip.rotation.y = Math.PI / 4;
        tip.renderOrder = 72;
        bladeGroup.add(tip);

        scene.add(bladeGroup);

        blades.push({
            group: bladeGroup,
            bodyMat, coreMat, haloMat, tipMat,
            angle,
            spawnDelay: i * 0.035,
            spin: (i % 2 === 0 ? 1 : -1) * (4 + Math.random() * 3),
        });
    }

    // Shock rings
    const shockRings = [];
    const shockColors = [T.shockA, T.shockB, T.shockC];
    for (let i = 0; i < 3; i++) {
        const rm = new THREE.MeshBasicMaterial({
            color: shockColors[i], transparent: true, opacity: 0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const r = track(new THREE.Mesh(new THREE.RingGeometry(0.30, 0.48, 64), rm));
        r.rotation.x = -Math.PI / 2;
        r.position.set(kingPos.x, 0.05 + i * 0.01, kingPos.z);
        r.renderOrder = 55 + i;
        scene.add(r);
        shockRings.push({ mesh: r, mat: rm, delay: i * 0.10, maxScale: 5.5 + i * 1.6 });
    }

    const impactMat = new THREE.MeshBasicMaterial({
        color: T.flashColor, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const impactSphere = track(new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 20, 20),
        impactMat
    ));
    impactSphere.position.set(kingPos.x, 0.65, kingPos.z);
    impactSphere.renderOrder = 62;
    scene.add(impactSphere);

    // Shards
    const shards = [];
    for (let i = 0; i < 48; i++) {
        const sg = new THREE.TetrahedronGeometry(0.045 + Math.random() * 0.09, 0);
        const sm = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(
                T.shardHue + Math.random() * T.shardHueRange,
                1.0,
                T.shardLight - 0.20 + Math.random() * 0.30
            ),
            transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const shard = track(new THREE.Mesh(sg, sm));
        shard.renderOrder = 65;
        shard.position.set(kingPos.x, 0.65, kingPos.z);
        shard.userData.vel = new THREE.Vector3(
            (Math.random() - 0.5) * 7,
            2.5 + Math.random() * 5.0,
            (Math.random() - 0.5) * 7
        );
        shard.userData.spin = new THREE.Vector3(
            (Math.random() - 0.5) * 16,
            (Math.random() - 0.5) * 16,
            (Math.random() - 0.5) * 16
        );
        scene.add(shard);
        shards.push(shard);
    }

    // Souls
    const souls = [];
    for (let i = 0; i < 32; i++) {
        const sg = new THREE.SphereGeometry(0.022 + Math.random() * 0.028, 5, 5);
        const sm = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(
                T.soulHue + Math.random() * T.soulHueRange,
                0.9,
                0.65 + Math.random() * 0.25
            ),
            transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const soul = track(new THREE.Mesh(sg, sm));
        soul.renderOrder = 66;
        const a = Math.random() * Math.PI * 2;
        const r = 0.10 + Math.random() * 0.35;
        soul.position.set(
            kingPos.x + Math.cos(a) * r,
            0.65 + Math.random() * 0.2,
            kingPos.z + Math.sin(a) * r
        );
        soul.userData.vel = new THREE.Vector3(
            Math.cos(a) * 0.30,
            1.6 + Math.random() * 1.8,
            Math.sin(a) * 0.30
        );
        soul.userData.life = 1.0 + Math.random() * 0.6;
        soul.userData.phase = Math.random() * Math.PI * 2;
        scene.add(soul);
        souls.push(soul);
    }

    // Explosion particles
    const explosionParticles = [];
    let explosionSpawned = false;
    const spawnExplosion = () => {
        for (let i = 0; i < 90; i++) {
            const pg = new THREE.SphereGeometry(0.030 + Math.random() * 0.055, 5, 5);
            const hue = T.shardHue + Math.random() * T.shardHueRange;
            const pm = new THREE.MeshBasicMaterial({
                color: new THREE.Color().setHSL(hue, 1.0, 0.55 + Math.random() * 0.35),
                transparent: true, opacity: 1,
                blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const p = track(new THREE.Mesh(pg, pm));
            p.position.set(kingPos.x, 0.65, kingPos.z);
            p.renderOrder = 63;
            const a = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI;
            const speed = 2.5 + Math.random() * 5.5;
            p.userData.vel = new THREE.Vector3(
                Math.sin(phi) * Math.cos(a) * speed,
                Math.abs(Math.cos(phi)) * speed * 1.3 + 1.5,
                Math.sin(phi) * Math.sin(a) * speed
            );
            p.userData.bornAt = clock.getElapsedTime();
            p.userData.life = 0.9 + Math.random() * 0.7;
            scene.add(p);
            explosionParticles.push(p);
        }
    };

    const t0 = clock.getElapsedTime();
    const CHARGE_END = 1.05;
    const BLADE_IN_END = 1.45;
    const SPIN_END = 1.75;
    const STRIKE_END = 1.90;
    const VICTIM_HIDE_AT = 1.96;
    const TOTAL = 3.40;

    const CASTER_GLOW = new THREE.Color(T.casterGlow);
    const CASTER_AURA = new THREE.Color(T.casterAura);
    const VICTIM_FLASH = new THREE.Color(T.flashColor);

    // ★ 依「攻擊者的棋子類型」挑選處決國王的風格
    //   注意：這裡 kingPos 是「被處決的國王」、attackerPos 是「施術者」
    //   ctx 傳入時，把 attacker 當作施術方、king 當作受害者
    const killSignature = buildKillSignature(
        (checker.piece && checker.piece.type) || 'pawn',
        {
            scene, track, T,
            kingPos: attackerPos,
            checkerPos: kingPos,
            orbPos: new THREE.Vector3(attackerPos.x, 1.55, attackerPos.z),
            impactPos: new THREE.Vector3(kingPos.x, 0.45, kingPos.z),
            isWhiteKing: kingColor === 'white',
            isKingKill: true,
            CHARGE_END,
            FIRE_AT: STRIKE_END,
            IMPACT_AT: STRIKE_END,
            VICTIM_HIDE_AT, TOTAL,
        }
    );

    const animate = () => {
        const t = clock.getElapsedTime() - t0;
        if (killSignature) killSignature.tick(t);

        if (attackerMats.length > 0) {
            const k = Math.min(1, t / CHARGE_END);
            const pulse = 0.5 + 0.5 * Math.sin(t * 20);
            for (const m of attackerMats) {
                const c = m.color.clone().lerp(CASTER_GLOW, k * 0.85);
                m.mesh.material.color.copy(c);
                if (m.mesh.material.emissive) {
                    m.mesh.material.emissive.copy(CASTER_AURA)
                        .multiplyScalar(k * (0.35 + pulse * 0.5));
                    m.mesh.material.emissiveIntensity = 1;
                }
            }
        }

        {
            const appear = Math.min(1, t / 0.35);
            const fadeOut = Math.max(0, 1 - Math.max(0, t - CHARGE_END + 0.3) / 0.4);
            const k = appear * fadeOut;
            runeMat1.opacity = 0.85 * k;
            runeMat2.opacity = 0.65 * k;
            for (const tk of runeTicks) tk.mat.opacity = 0.85 * k;
            runeGroup.rotation.y += 0.04;
        }

        if (t < CHARGE_END + 0.2) {
            for (const p of chargeMotes) {
                const pt = t - p.userData.delay;
                if (pt < 0) { p.material.opacity = 0; continue; }
                const lk = Math.min(1, pt / 0.9);
                const angle = p.userData.baseAngle + pt * p.userData.spinSpeed;
                const r = p.userData.startR * (1 - lk) * (1 - lk * 0.3);
                const y = p.userData.startY + (0.4 - p.userData.startY) * lk;
                p.position.set(
                    attackerPos.x + Math.cos(angle) * r,
                    y,
                    attackerPos.z + Math.sin(angle) * r
                );
                p.material.opacity = (1 - lk) * 0.95;
                p.scale.setScalar(1 - lk * 0.5);
            }
        }

        {
            const inProgress = Math.max(0, Math.min(1,
                (t - CHARGE_END) / (BLADE_IN_END - CHARGE_END)));

            const reveal =
                t < CHARGE_END ? 0 :
                    t < BLADE_IN_END ? inProgress :
                        t < VICTIM_HIDE_AT ? 1 :
                            Math.max(0, 1 - (t - VICTIM_HIDE_AT) / 0.25);

            const strikeProgress = (t >= SPIN_END && t <= STRIKE_END)
                ? (t - SPIN_END) / (STRIKE_END - SPIN_END)
                : (t > STRIKE_END ? 1 : 0);
            const eased = strikeProgress * strikeProgress;
            const radius = OUTER_R + (INNER_R - OUTER_R) * eased;

            const ringSpin = t * 0.6;

            for (const b of blades) {
                const localReveal = Math.max(0, Math.min(1,
                    (t - CHARGE_END - b.spawnDelay) / 0.20));
                // ★ 若這顆棋子有自己的處決 signature，就不再顯示通用「12 之劍」
                const alpha = killSignature ? 0 : (localReveal * reveal);

                const angle = b.angle + ringSpin;
                const px = kingPos.x + Math.cos(angle) * radius;
                const pz = kingPos.z + Math.sin(angle) * radius;
                b.group.position.set(px, BLADE_Y, pz);

                const inward = new THREE.Vector3(
                    -Math.cos(angle), -0.22, -Math.sin(angle)
                ).normalize();
                b.group.quaternion.setFromUnitVectors(
                    new THREE.Vector3(0, 1, 0), inward
                );

                b.group.rotateY(t * b.spin);

                b.bodyMat.opacity = alpha * 0.95;
                b.coreMat.opacity = alpha * (0.85 + 0.15 * Math.sin(t * 24 + b.angle));
                b.haloMat.opacity = alpha * 0.55;
                b.tipMat.opacity = alpha * 0.95;
            }
        }

        if (t >= STRIKE_END && !explosionSpawned) {
            explosionSpawned = true;
            spawnExplosion();
        }

        if (t >= STRIKE_END && t < STRIKE_END + 0.18) {
            screenFlash.style.opacity = String(1 - (t - STRIKE_END) / 0.18);
        } else if (t >= STRIKE_END + 0.18) {
            screenFlash.style.opacity = '0';
        }

        if (t >= STRIKE_END && t < STRIKE_END + 0.55) {
            const it = (t - STRIKE_END) / 0.55;
            impactMat.opacity = 0.98 * (1 - it) * (1 - it);
            impactSphere.scale.setScalar(0.5 + it * 5.8);
        } else if (t >= STRIKE_END + 0.55) {
            impactMat.opacity = 0;
        }

        for (const sr of shockRings) {
            const st = t - STRIKE_END - sr.delay;
            if (st < 0 || st > 0.75) { sr.mat.opacity = 0; continue; }
            const prog = st / 0.75;
            sr.mat.opacity = 0.9 * (1 - prog);
            const s = 1 + prog * sr.maxScale;
            sr.mesh.scale.set(s, s, 1);
        }

        if (t >= STRIKE_END && kingMats.length > 0 && kingObj) {
            const vt = Math.min(1, (t - STRIKE_END) / 0.10);
            const flashMix = Math.min(1, vt * 2.5);
            for (const m of kingMats) {
                const c = m.color.clone().lerp(VICTIM_FLASH, flashMix);
                m.mesh.material.color.copy(c);
                if (m.mesh.material.emissive) {
                    m.mesh.material.emissive.copy(VICTIM_FLASH);
                    m.mesh.material.emissiveIntensity = flashMix * 2.2;
                }
                m.mesh.material.opacity = Math.max(0.05, 1 - vt * 0.8);
            }
        }

        if (t >= VICTIM_HIDE_AT) {
            if (kingObj && kingObj.visible) kingObj.visible = false;
            const st = t - VICTIM_HIDE_AT;

            for (const shard of shards) {
                if (st > 2.0) { shard.material.opacity = 0; continue; }
                shard.position.addScaledVector(shard.userData.vel, 0.016);
                shard.userData.vel.y -= 0.22;
                shard.rotation.x += shard.userData.spin.x * 0.016;
                shard.rotation.y += shard.userData.spin.y * 0.016;
                shard.rotation.z += shard.userData.spin.z * 0.016;
                const lifeT = Math.min(1, st / 1.8);
                shard.material.opacity = Math.max(0, 1 - lifeT);
                shard.scale.setScalar(Math.max(0.1, 1 - lifeT * 0.7));
            }

            for (const soul of souls) {
                const lt = st / soul.userData.life;
                if (lt < 0 || lt > 1) { soul.material.opacity = 0; continue; }
                soul.position.addScaledVector(soul.userData.vel, 0.016);
                soul.userData.vel.y -= 0.02;
                soul.position.x += Math.sin(st * 5 + soul.userData.phase) * 0.003;
                soul.position.z += Math.cos(st * 5 + soul.userData.phase) * 0.003;
                soul.material.opacity = (1 - lt) * 0.95;
                soul.scale.setScalar(1 - lt * 0.4);
            }
        }

        const now = clock.getElapsedTime();
        for (const p of explosionParticles) {
            const age = now - p.userData.bornAt;
            if (age >= p.userData.life) { p.visible = false; continue; }
            p.visible = true;
            p.position.addScaledVector(p.userData.vel, 0.016);
            p.userData.vel.y -= 0.20;
            const lt = age / p.userData.life;
            p.material.opacity = Math.max(0, 1 - lt) * (1 - lt);
            p.scale.setScalar(1 - lt * 0.4);
        }

        if (t < TOTAL) {
            requestAnimationFrame(animate);
        } else {
            disposeAll();
            finalizeKingKill(kingColor, checker);
        }
    };

    const disposeAll = () => {
        if (vignette.parentNode) {
            vignette.style.opacity = '0';
            setTimeout(() => vignette.remove(), 600);
        }
        if (screenFlash.parentNode) screenFlash.remove();
        for (const obj of created) {
            if (obj.parent) obj.parent.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        }
    };

    animate();
}

function finalizeKingKill(kingColor, checker) {
    const king = gameState.findKing(kingColor);
    if (king) {
        const kingPiece = gameState.board[king.r][king.c];
        if (kingPiece) {
            gameState.board[king.r][king.c] = null;
            gameState.moveHistory.push({
                type: 'domain_kill_king',
                fromR: checker ? checker.r : null,            // ★ NEW
                fromC: checker ? checker.c : null,            // ★ NEW
                toR: king.r,                                  // ★ NEW
                toC: king.c,                                  // ★ NEW
                r: king.r, c: king.c,
                piece: { ...kingPiece },
            });
        }
    }

    syncPiecesAfterMove();

    if (currentMode === 'multiplayer' && peerConnection?.open &&
        kingColor === playerColor) {
        peerConnection.send({ type: 'domain_result', winner: 'attacker' });
    }

    kingSkillState.active = false;
    kingSkillState.context = null;
    battleState = null;
    isAnimating = false;

    gameOverFlag = true;
    stopTimer();

    const winner = kingColor === 'white' ? 'black' : 'white';

    document.getElementById('gameOverOverlay').classList.remove('hidden');
    document.getElementById('gameOverReason').textContent = '國王在領域對決中敗北，遭到將軍者消滅';

    const text = document.getElementById('gameOverText');
    if (currentMode === 'ai' || currentMode === 'multiplayer') {
        if (winner === playerColor) {
            text.textContent = '你贏了!';
            text.className = 'game-over-text win';
        } else {
            text.textContent = '你輸了...';
            text.className = 'game-over-text lose';
        }
    } else {
        text.textContent = (winner === 'white' ? '白方' : '黑方') + ' 獲勝!';
        text.className = 'game-over-text win';
    }
}


/* ═══════════════════════════════════════════════════════════
   12.  VS SCREEN + MINI PIECE RENDERER
   ═══════════════════════════════════════════════════════════ */
function showVsScreen(color, checker) {
    const overlay = document.getElementById('vsOverlay');
    overlay.classList.remove('hidden');

    const leftColor = playerColor;
    const rightColor = playerColor === 'white' ? 'black' : 'white';

    const leftPiece = leftColor === color
        ? { type: 'king', color: leftColor }
        : { type: checker.piece.type, color: leftColor };

    const rightPiece = rightColor === color
        ? { type: 'king', color: rightColor }
        : { type: checker.piece.type, color: rightColor };

    if (vsRenderers.left) { vsRenderers.left.dispose(); vsRenderers.left = null; }
    if (vsRenderers.right) { vsRenderers.right.dispose(); vsRenderers.right = null; }

    vsRenderers.left = createMiniPieceRenderer(document.getElementById('vsCanvasLeft'), leftPiece.type, leftPiece.color);
    vsRenderers.right = createMiniPieceRenderer(document.getElementById('vsCanvasRight'), rightPiece.type, rightPiece.color);

    const lEl = document.getElementById('vsLabelLeft');
    lEl.textContent = leftColor.toUpperCase();
    lEl.className = 'vs-label vs-label-' + leftColor;
    const rEl = document.getElementById('vsLabelRight');
    rEl.textContent = rightColor.toUpperCase();
    rEl.className = 'vs-label vs-label-' + rightColor;

    overlay.classList.remove('animate');
    void overlay.offsetWidth;
    overlay.classList.add('animate');

    setTimeout(() => {
        overlay.classList.add('hidden');
        openBattleMenu(color, checker);
    }, 3200);
}

function createMiniPieceRenderer(canvasEl, type, color) {
    const rect = canvasEl.getBoundingClientRect();
    const w = Math.max(rect.width || 260, 100);
    const h = Math.max(rect.height || 260, 100);

    const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    camera.position.set(0, 1.0, 2.7);
    camera.lookAt(0, 0.45, 0);

    scene.add(new THREE.HemisphereLight(0xffeedd, 0x443322, 1.6));
    const dir = new THREE.DirectionalLight(0xffffff, 2.4);
    dir.position.set(2, 4, 3);
    scene.add(dir);
    const rim = new THREE.DirectionalLight(0x8899cc, 1.2);
    rim.position.set(-2, 1, -3);
    scene.add(rim);

    const model = createPieceModel(type, color, 100, 100, PIECE_PARAMS[type] || {});
    scene.add(model);

    let rafId = null;
    const startT = performance.now();
    const loop = () => {
        rafId = requestAnimationFrame(loop);
        const t = (performance.now() - startT) / 1000;
        model.rotation.y = Math.sin(t * 0.7) * 0.4;
        model.position.y = Math.sin(t * 1.4) * 0.03;
        renderer.render(scene, camera);
    };
    loop();

    const updateSize = () => {
        const r = canvasEl.getBoundingClientRect();
        const w2 = Math.max(r.width || 260, 100);
        const h2 = Math.max(r.height || 260, 100);
        renderer.setSize(w2, h2, false);
        camera.aspect = w2 / h2;
        camera.updateProjectionMatrix();
    };
    setTimeout(updateSize, 70);

    return {
        renderer, scene, camera, model, updateSize,
        dispose() {
            if (rafId) cancelAnimationFrame(rafId);
            renderer.dispose();
        }
    };
}