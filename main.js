// ============================================================
//  GLOBALS
// ============================================================
let scene, camera, renderer, raycaster, clock;
let boardGroup, piecesGroup, highlightsGroup, ghostLineGroup;
let boardSquares = [];
let pieceObjects = {};
let selectedPiece = null;
let validMoves = [];
let abilityTargets = [];
let actionMode = 'move';
let gameState = null;
let currentMode = null;
// NOTE: aiDifficulty and aiThinking now live in ai.js
let isAnimating = false;
let cameraTarget = { pos: new THREE.Vector3(0, 9, 7), lookAt: new THREE.Vector3(0, 0, 0) };
let cameraSmoothPos = new THREE.Vector3(0, 9, 7);
let cameraSmoothLookAt = new THREE.Vector3(0, 0, 0);
let peer = null;
let peerConnection = null;
let isHost = false;
let roomCode = null;
let playerColor = 'white';
let gameOverFlag = false;
let pendingPromotion = null;
let mouse = new THREE.Vector2();
let touchActive = false;
let selectedPiecePulse = 0;

// ★ 棋子唯一 ID（用來推算「已陣亡棋子」，供皇后復活使用）
let _pieceIdCounter = 0;
// ★ 皇后復活選擇中的暫存狀態
let pendingRevive = null;

// ============================================================
//  ★ Queen voice — Web Speech API wrapper
// ============================================================
const QUEEN_VOICE_PREFS = [
    // Preferred female English voices, in order. First match wins.
    'Google UK English Female',
    'Google US English',
    'Samantha',           // macOS / iOS
    'Karen',              // macOS AU
    'Moira',              // macOS IE
    'Tessa',              // macOS ZA
    'Fiona',              // macOS
    'Victoria',           // macOS
    'Microsoft Zira',     // Windows
    'Microsoft Hazel',    // Windows UK
    'Microsoft Aria',     // Windows newer
    'Female',             // generic
];

let queenVoice = null;
let queenVoiceMuted = false;
try { queenVoiceMuted = localStorage.getItem('queenVoiceMuted') === '1'; } catch (_) { }

function initQueenVoice() {
    if (!('speechSynthesis' in window)) return;

    const pickVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        if (!voices || voices.length === 0) return;
        // 1) Try the preference list
        for (const pref of QUEEN_VOICE_PREFS) {
            const v = voices.find(v =>
                v.name.toLowerCase().includes(pref.toLowerCase()));
            if (v) { queenVoice = v; return; }
        }
        // 2) Fallback: any English voice
        const anyEn = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en'));
        if (anyEn) { queenVoice = anyEn; return; }
        // 3) Last resort: default voice
        queenVoice = voices[0];
    };

    pickVoice();
    // Voices load asynchronously in Chrome / Edge
    window.speechSynthesis.onvoiceschanged = pickVoice;
}

// Speak a line as the Queen. Safe to call even if TTS isn't supported.
function speakQueenLine(text) {
    if (queenVoiceMuted) return;
    if (!('speechSynthesis' in window)) return;

    try {
        // Cancel anything still talking so lines don't queue up
        window.speechSynthesis.cancel();

        const u = new SpeechSynthesisUtterance(text);
        if (queenVoice) u.voice = queenVoice;
        u.lang = (queenVoice && queenVoice.lang) || 'en-GB';
        u.pitch = 1.35;   // slightly high — regal / feminine
        u.rate = 0.92;    // a touch slower, dramatic
        u.volume = 1.0;

        window.speechSynthesis.speak(u);
    } catch (err) {
        console.warn('🔇 Speech failed:', err);
    }
}

// Toggle helper (wired to a keyboard shortcut + a console command)
function setQueenVoiceMuted(muted) {
    queenVoiceMuted = !!muted;
    try { localStorage.setItem('queenVoiceMuted', queenVoiceMuted ? '1' : '0'); } catch (_) { }
    if (queenVoiceMuted && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
    console.log(`🔊 皇后語音: %c${queenVoiceMuted ? '關閉' : '開啟'}`,
        queenVoiceMuted
            ? 'color:#e74c3c;font-weight:bold;'
            : 'color:#2ecc71;font-weight:bold;');
}

let isAiming = false;
let ghostLine = null;
let aimWorldPos = null;
let aimTargetPiece = null;
let aimValid = false;
let lastAimedPieceKeys = new Set();

let remoteAimActive = false;
let remoteAimFromR = -1, remoteAimFromC = -1;
let remoteAimTargetX = 0, remoteAimTargetZ = 0;
let remoteAimTimer = null;
let aimMoveThrottleTimer = null;
let lastAimSendX = 0, lastAimSendZ = 0;
const AIM_SEND_THROTTLE = 60;

let cameraTheta = 0.5;
let cameraPhi = 0.8;
let cameraRadius = 12;
let isFreeCameraActive = true;
let isDraggingCamera = false;
let dragStartX = 0, dragStartY = 0;
let dragMoved = false;
let suppressClick = false;
let settingsReceived = false;
let settingsTimeout = null;

let myReady = false;
let opponentReady = false;
let gameStarted = false;

const DRAG_THRESHOLD = 6;
const TARGET_RADIUS = 0.7;
const PIECE_VALUES = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 20000 };

const CANNON_RANGE = 4;

const IS_MOBILE = ('ontouchstart' in window) && window.matchMedia('(pointer: coarse)').matches;

// ============================================================
//  ★ Mobile auto-fullscreen
//  Browsers require a user gesture, so we hook the very first
//  tap anywhere on the page. Android Chrome → real fullscreen.
//  iPhone Safari → no Fullscreen API; we do the URL-bar-hide
//  scroll trick instead (see IS_IPHONE below).
// ============================================================
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_IPHONE = /iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && !/iPad/.test(navigator.userAgent));
const IS_STANDALONE = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

// ============================================================
//  ★ MULTIPLAYER RECONNECTION STATE
// ============================================================
//  A persistent session ID lets the host recognize a returning
//  client (even across a page reload) so it can hand back the
//  current board state instead of starting a fresh game.
let clientSessionId;
try {
    clientSessionId = localStorage.getItem('chessSessionId');
    if (!clientSessionId) {
        clientSessionId = 'sess-' + Math.random().toString(36).slice(2, 10) +
            Date.now().toString(36);
        localStorage.setItem('chessSessionId', clientSessionId);
    }
} catch (_) {
    clientSessionId = 'sess-' + Math.random().toString(36).slice(2, 10);
}

// Host-side: remembers which session was the active client
let hostKnownClientSessionId = null;

// Client-side: reconnection loop state
let isReconnecting = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let reconnectGraceTimer = null;

const MAX_RECONNECT_ATTEMPTS = 20;
const RECONNECT_INTERVAL_MS = 2500;
const RECONNECT_GRACE_MS = 60000;   // 1 min for host to wait for client

let _mobileFsAttempted = false;

/**
 * Request fullscreen + landscape lock. Must be called from inside a
 * user-gesture handler (tap/click/touchstart).
 */
async function enterMobileFullscreen() {
    if (IS_STANDALONE) return;                 // already app-mode

    const el = document.documentElement;
    try {
        if (!document.fullscreenElement) {
            if (el.requestFullscreen) {
                await el.requestFullscreen({ navigationUI: 'hide' });
            } else if (el.webkitRequestFullscreen) {
                el.webkitRequestFullscreen();
            } else if (el.mozRequestFullScreen) {
                el.mozRequestFullScreen();
            } else if (el.msRequestFullscreen) {
                el.msRequestFullscreen();
            }
        }
    } catch (err) {
        // Silent — user gesture wasn't accepted, or API unsupported
    }

    // Orientation lock — only effective in real fullscreen, and not on iOS
    try {
        if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape').catch(() => { });
        }
    } catch (_) { }

    // iPhone Safari has no Fullscreen API — hide the URL bar with a scroll nudge
    if (IS_IOS && !IS_STANDALONE) {
        window.scrollTo(0, 1);
        setTimeout(() => window.scrollTo(0, 1), 120);
    }
}

// ============================================================
//  ★ Auto-Force Landscape System
// ============================================================
//  三層防護：
//    1. 第一次觸控 → 進全屏 + 鎖定 landscape
//    2. 全屏狀態變化 → 重新鎖定（Android Chrome 退出全屏時會解除鎖定）
//    3. 若鎖定失敗（iOS）→ 用 CSS 顯示「請旋轉」遮罩
// ============================================================

let _landscapeLockAttempted = false;

/** 檢查目前是否直向 */
function isPortraitOrientation() {
    if (screen.orientation && typeof screen.orientation.type === 'string') {
        return screen.orientation.type.startsWith('portrait');
    }
    return window.innerHeight > window.innerWidth;
}

/** 嘗試鎖定 landscape；回傳 Promise<boolean> 表示是否成功 */
async function tryLockLandscape() {
    // 沒有 API → 失敗
    if (!screen.orientation || !screen.orientation.lock) return false;

    // 必須處於全屏才能鎖定（Chrome / Android 的要求）
    const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (!inFs) return false;

    try {
        await screen.orientation.lock('landscape');
        return true;
    } catch (_) {
        return false;
    }
}

/** 依「手機 + 直向」判斷是否顯示旋轉遮罩 */
function updateRotateOverlay() {
    if (!IS_MOBILE) {
        document.body.classList.remove('force-landscape');
        return;
    }
    if (isPortraitOrientation()) {
        document.body.classList.add('force-landscape');
    } else {
        document.body.classList.remove('force-landscape');
    }
}

/**
 * 主動嘗試一次：進全屏（若尚未）+ 鎖定 landscape + 更新遮罩。
 * 必須在使用者手勢中呼叫。
 */
async function enforceLandscape() {
    _landscapeLockAttempted = true;

    // 1) 進全屏（若還沒）
    if (IS_MOBILE && !IS_STANDALONE) {
        try {
            await enterMobileFullscreen();
        } catch (_) { }
    }

    // 2) 鎖定 landscape
    await tryLockLandscape();

    // 3) 更新視覺遮罩
    updateRotateOverlay();
}

/** 掛載所有監聽器 — 在 window.onload 呼叫一次即可 */
function setupForceLandscape() {
    if (!IS_MOBILE) return;

    // ── 第一次觸控：主動出擊 ──
    const firstTap = () => {
        if (_landscapeLockAttempted) return;
        enforceLandscape();
        document.removeEventListener('touchend', firstTap, true);
        document.removeEventListener('click', firstTap, true);
    };
    document.addEventListener('touchend', firstTap, { capture: true, passive: true });
    document.addEventListener('click', firstTap, { capture: true, passive: true });

    // ── 全屏狀態變化：重新鎖定（Chrome 退出全屏會自動解鎖） ──
    const onFsChange = () => {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            // 進入全屏 → 再次鎖定
            tryLockLandscape();
        }
        updateRotateOverlay();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('mozfullscreenchange', onFsChange);
    document.addEventListener('MSFullscreenChange', onFsChange);

    // ── 螢幕旋轉 / 尺寸變化：更新遮罩 ──
    if (screen.orientation && screen.orientation.addEventListener) {
        screen.orientation.addEventListener('change', updateRotateOverlay);
    }
    window.addEventListener('orientationchange', () => {
        setTimeout(updateFullscreenBtnPosition, 120);
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateFullscreenBtnPosition);
    }

    // ── 視窗重新取得焦點時（從背景切回）再檢查一次 ──
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            updateRotateOverlay();
            // 若已進全屏，再嘗試鎖定一次
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                tryLockLandscape();
            }
        }
    });

    // ── 初始檢查 ──
    updateRotateOverlay();
}

/** Attach the one-shot first-tap listener. Call once on page load. */
function setupMobileAutoFullscreen() {
    if (!IS_MOBILE || IS_STANDALONE) return;

    const handler = () => {
        if (_mobileFsAttempted) return;
        _mobileFsAttempted = true;
        enterMobileFullscreen();
        document.removeEventListener('touchend', handler, true);
        document.removeEventListener('click', handler, true);
    };

    // Capture phase → our handler runs *before* any game buttons
    document.addEventListener('touchend', handler, { capture: true, passive: true });
    document.addEventListener('click', handler, { capture: true, passive: true });

    // Re-arm: if the user exits fullscreen (swipes out), the next tap restores it
    const rearm = () => {
        if (!document.fullscreenElement) _mobileFsAttempted = false;
    };
    document.addEventListener('fullscreenchange', rearm);
    document.addEventListener('webkitfullscreenchange', rearm);
    document.addEventListener('mozfullscreenchange', rearm);
    document.addEventListener('MSFullscreenChange', rearm);

    if (IS_IPHONE && !IS_STANDALONE) showIOSFullscreenHintOnce();
}

function showIOSFullscreenHintOnce() {
    if (!IS_IPHONE || IS_STANDALONE) return;
    try {
        if (localStorage.getItem('iosFsHintShown') === '1') return;
        localStorage.setItem('iosFsHintShown', '1');
    } catch (_) { }

    const hint = document.createElement('div');
    hint.textContent = '📱 點「分享」→「加入主畫面」以獲得全螢幕體驗';
    Object.assign(hint.style, {
        position: 'fixed',
        left: '50%',
        bottom: '20px',
        transform: 'translateX(-50%)',
        zIndex: '500',
        background: 'rgba(22,33,62,0.95)',
        color: '#e8c547',
        padding: '10px 18px',
        borderRadius: '14px',
        border: '2px solid #e8c547',
        fontSize: '0.85rem',
        fontWeight: '700',
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        transition: 'opacity 0.4s',
    });
    document.body.appendChild(hint);
    setTimeout(() => { hint.style.opacity = '0'; }, 6000);
    setTimeout(() => hint.remove(), 6600);
}

let joystickState = {
    active: false, touchId: null, baseCenterX: 0, baseCenterY: 0,
    knobOffsetX: 0, knobOffsetY: 0, baseRadius: 55, moveSpeed: 4.5,
};
let joystickSetup = false;
let lastFrameTime = 0;

let cannonRangeGroup = null;

// ============================================================
//  ★ SELECTION AURA — per-piece animated glow around selected piece
// ============================================================
let selectionAuraGroup = null;
let selectionAuraKind = null;
let selectionAuraStart = 0;
let selectionAuraParts = { rings: [], orbs: [], sparks: [] };
let selectionAuraPiece = null;

// Per-piece-type aura identity: unique color pair + unique animation style
const AURA_STYLES = {
    // Pawn  — fiery orange embers rising upward
    pawn: { primary: 0xff6622, secondary: 0xffcc44, style: 'embers' },
    // Rook  — cold steel-blue targeting rings (rotating)
    rook: { primary: 0x7ac8ff, secondary: 0xffffff, style: 'rings' },
    // Knight — hot gold streak-sparks (fast swirl)
    knight: { primary: 0xffcc44, secondary: 0xff6622, style: 'streaks' },
    // Bishop — violet orbiting orbs (mystic)
    bishop: { primary: 0xc44dff, secondary: 0xff66cc, style: 'orbs' },
    // Queen  — pink/green dual-layer orbs + soft glow disc
    queen: { primary: 0xff69b4, secondary: 0x6dffb0, style: 'dualOrb' },
    // King   — regal violet crown spikes
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
                // Queen alternates directions (dual tone)
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
            // Orbiting orb
            const angle = o.userData.baseAngle + t * o.userData.speed;
            const r = o.userData.radius;
            const y = o.userData.yOffset + Math.sin(t * 2 + o.userData.bobPhase) * 0.08;
            o.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
            const pulse = 0.7 + 0.3 * Math.sin(t * 5 + o.userData.bobPhase);
            o.material.opacity = pulse * 0.9 * boost;
            o.scale.setScalar(0.9 + 0.2 * pulse);
        } else if (o.userData.baseY !== undefined) {
            // Crown spike — subtle bob + pulse
            o.position.y = o.userData.baseY + Math.sin(t * 3 + o.userData.phase * 2) * 0.04;
            const pulse = 0.6 + 0.4 * Math.sin(t * 4 + o.userData.phase * 3);
            o.material.opacity = pulse * 0.85 * boost;
        }
    }
}

// ★ 主教地板特效 registry — 讓殘留特效可被新動作強制提早淡出
let activeBishopLeapEffects = [];

function triggerBishopLeapFadeOut() {
    for (const fx of activeBishopLeapEffects) {
        if (!fx.fadingOut) {
            fx.fadingOut = true;
            fx.fadeStartTime = clock.getElapsedTime();
        }
    }
}


// ★ 騎士技能狀態（三步驟：landing → victim → direction）
let knightAbilityActive = false;
let knightAbilityState = null;
let knockbackArrowGroup = null;

// ★ 擊退時，被阻擋的目標受到的傷害
const KNOCKBACK_BLOCK_DAMAGE = 25;

// ★ 技能冷卻：使用技能後需要等待自己方 N 步才能再次使用
//   （只有該棋子自己的隊伍行動時才會倒數）
const SKILL_COOLDOWNS = {
    pawn: 1,
    knight: 2,
    bishop: 2,
    rook: 1,
    queen: 2,       // ★ 皇后「治癒」冷卻
    king: 1,
};

// ★ 皇后「復活」獨立冷卻（10 步）
const QUEEN_REVIVE_COOLDOWN = 10;

function getSkillCooldown(type) {
    return SKILL_COOLDOWNS[type] || 0;
}

// ============================================================
//  CHESS GAME CLASS
// ============================================================
class ChessGame {
    constructor() {
        this.board = [];
        this.turn = 'white';
        this.castlingRights = { whiteKingside: true, whiteQueenside: true, blackKingside: true, blackQueenside: true };
        this.enPassantTarget = null;
        this.moveHistory = [];
        this.gameOver = false;
        this.gameResult = null;
        this.halfMoveClock = 0;
        this.fullMoveNumber = 1;
        this.initBoard();
    }

    initBoard() {
        this.board = Array(8).fill(null).map(() => Array(8).fill(null));
        this.initialPieces = [];   // ★ 開局所有棋子的身分證（用於推算陣亡名單）

        const makePiece = (type, color) => {
            const p = {
                id: ++_pieceIdCounter,
                type, color,
                hasMoved: false,
                hp: 100, maxHp: 100,
                skillCooldown: 0,
                reviveCooldown: 0,
                justUsedSkill: false,
                justUsedRevive: false,
            };
            this.initialPieces.push({ id: p.id, type, color });
            return p;
        };

        const backRow = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
        for (let c = 0; c < 8; c++) {
            this.board[0][c] = makePiece(backRow[c], 'white');
            this.board[1][c] = makePiece('pawn', 'white');
            this.board[6][c] = makePiece('pawn', 'black');
            this.board[7][c] = makePiece(backRow[c], 'black');
        }
    }

    clone() {
        // ★ 使用 Object.create 避免每次都跑 initBoard（效能 + 保持 ID 一致）
        const g = Object.create(ChessGame.prototype);
        g.board = this.board.map(row => row.map(p => p ? { ...p } : null));
        g.turn = this.turn;
        g.castlingRights = { ...this.castlingRights };
        g.enPassantTarget = this.enPassantTarget;
        g.moveHistory = [...this.moveHistory];
        g.gameOver = this.gameOver;
        g.gameResult = this.gameResult;
        g.halfMoveClock = this.halfMoveClock;
        g.fullMoveNumber = this.fullMoveNumber;
        g.initialPieces = (this.initialPieces || []).map(p => ({ ...p }));
        return g;
    }

    // ★ 取得某顏色已陣亡的棋子清單
    getDeadPieces(color) {
        const alive = new Set();
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p && p.id !== undefined) alive.add(p.id);
            }
        }
        return (this.initialPieces || []).filter(p => p.color === color && !alive.has(p.id));
    }

    // ★★★ RESTORED ★★★
    getPiece(r, c) { return this.board[r][c]; }

    isInBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

    // ★ 切換回合，並在「新一方的回合開始時」倒數他們的技能冷卻
    flipTurn() {
        if (this.turn === 'black') this.fullMoveNumber++;
        this.turn = this.turn === 'white' ? 'black' : 'white';
        this.tickSkillCooldowns(this.turn);
    }

    tickSkillCooldowns(color) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (!p || p.color !== color) continue;

                // ★ 上一回合才剛施放 → 本回合先不倒數
                if (p.justUsedSkill) p.justUsedSkill = false;
                else if ((p.skillCooldown || 0) > 0) p.skillCooldown--;

                if (p.justUsedRevive) p.justUsedRevive = false;
                else if ((p.reviveCooldown || 0) > 0) p.reviveCooldown--;
            }
        }
    }

    findKing(color) {
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p && p.type === 'king' && p.color === color) return { r, c };
            }
        return null;
    }
    getAttackedSquares(color, board) {
        const b = board || this.board;
        const attacked = new Set();
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++) {
                const p = b[r][c];
                if (p && p.color === color) {
                    const moves = this.getPseudoLegalMoves(r, c, b, true);
                    moves.forEach(m => attacked.add(m.r + ',' + m.c));
                }
            }
        return attacked;
    }
    isSquareAttacked(r, c, byColor, board) {
        const b = board || this.board;
        const attacked = this.getAttackedSquares(byColor, b);
        return attacked.has(r + ',' + c);
    }
    isInCheck(color, board) {
        const b = board || this.board;
        const king = this.findKing(color);
        if (!king) return false;
        const enemyColor = color === 'white' ? 'black' : 'white';
        return this.isSquareAttacked(king.r, king.c, enemyColor, b);
    }
    getPseudoLegalMoves(r, c, board, skipCastling = false) {
        const b = board || this.board;
        const piece = b[r][c];
        if (!piece) return [];
        const moves = [];
        const color = piece.color;
        const enemy = color === 'white' ? 'black' : 'white';
        const addMove = (tr, tc) => {
            if (this.isInBounds(tr, tc)) {
                const target = b[tr][tc];
                if (!target || target.color === enemy) moves.push({ r: tr, c: tc, capture: !!target });
            }
        };
        switch (piece.type) {
            case 'pawn': {
                const dir = color === 'white' ? 1 : -1;
                const startRow = color === 'white' ? 1 : 6;
                if (this.isInBounds(r + dir, c) && !b[r + dir][c]) {
                    moves.push({ r: r + dir, c, capture: false, enPassant: false });
                    if (r === startRow && !b[r + 2 * dir][c]) {
                        moves.push({ r: r + 2 * dir, c, capture: false, enPassant: false, doublePawnPush: true });
                    }
                }
                for (const dc of [-1, 1]) {
                    const tc = c + dc;
                    const tr = r + dir;
                    if (this.isInBounds(tr, tc)) {
                        const target = b[tr][tc];
                        if (target && target.color === enemy) {
                            moves.push({ r: tr, c: tc, capture: true, enPassant: false });
                        } else if (!target && this.enPassantTarget &&
                            this.enPassantTarget.r === tr && this.enPassantTarget.c === tc) {
                            moves.push({ r: tr, c: tc, capture: true, enPassant: true });
                        }
                    }
                }
                break;
            }
            case 'knight': {
                const knightMoves = [
                    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
                    [1, -2], [1, 2], [2, -1], [2, 1]
                ];
                knightMoves.forEach(([dr, dc]) => addMove(r + dr, c + dc));
                break;
            }
            case 'bishop': {
                for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
                    for (let i = 1; i < 8; i++) {
                        const tr = r + dr * i, tc = c + dc * i;
                        if (!this.isInBounds(tr, tc)) break;
                        const target = b[tr][tc];
                        if (!target) moves.push({ r: tr, c: tc, capture: false });
                        else if (target.color === enemy) { moves.push({ r: tr, c: tc, capture: true }); break; }
                        else break;
                    }
                }
                break;
            }
            case 'rook': {
                for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                    for (let i = 1; i < 8; i++) {
                        const tr = r + dr * i, tc = c + dc * i;
                        if (!this.isInBounds(tr, tc)) break;
                        const target = b[tr][tc];
                        if (!target) moves.push({ r: tr, c: tc, capture: false });
                        else if (target.color === enemy) { moves.push({ r: tr, c: tc, capture: true }); break; }
                        else break;
                    }
                }
                break;
            }
            case 'queen': {
                for (const [dr, dc] of [
                    [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]
                ]) {
                    for (let i = 1; i < 8; i++) {
                        const tr = r + dr * i, tc = c + dc * i;
                        if (!this.isInBounds(tr, tc)) break;
                        const target = b[tr][tc];
                        if (!target) moves.push({ r: tr, c: tc, capture: false });
                        else if (target.color === enemy) { moves.push({ r: tr, c: tc, capture: true }); break; }
                        else break;
                    }
                }
                break;
            }
            case 'king': {
                for (const [dr, dc] of [
                    [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]
                ]) {
                    addMove(r + dr, c + dc);
                }
                if (!skipCastling) {
                    const ks = color === 'white' ? this.castlingRights.whiteKingside : this.castlingRights.blackKingside;
                    const qs = color === 'white' ? this.castlingRights.whiteQueenside : this.castlingRights.blackQueenside;
                    const homeRow = color === 'white' ? 0 : 7;
                    if (r === homeRow && c === 4 && ks && !b[homeRow][5] && !b[homeRow][6] &&
                        !this.isSquareAttacked(homeRow, 4, enemy, b) &&
                        !this.isSquareAttacked(homeRow, 5, enemy, b) &&
                        !this.isSquareAttacked(homeRow, 6, enemy, b)) {
                        moves.push({ r: homeRow, c: 6, capture: false, castling: 'kingside' });
                    }
                    if (r === homeRow && c === 4 && qs && !b[homeRow][1] && !b[homeRow][2] && !b[homeRow][3] &&
                        !this.isSquareAttacked(homeRow, 4, enemy, b) &&
                        !this.isSquareAttacked(homeRow, 3, enemy, b) &&
                        !this.isSquareAttacked(homeRow, 2, enemy, b)) {
                        moves.push({ r: homeRow, c: 2, capture: false, castling: 'queenside' });
                    }
                }
                break;
            }
        }
        return moves.map(m => ({ ...m, type: 'move' }));
    }
    getLegalMoves(r, c) {
        const piece = this.board[r][c];
        if (!piece) return [];
        const pseudo = this.getPseudoLegalMoves(r, c);
        const legal = [];
        for (const move of pseudo) {
            const tempBoard = this.board.map(row => row.map(p => p ? { ...p } : null));
            const movingPiece = { ...tempBoard[r][c] };
            tempBoard[r][c] = null;
            tempBoard[move.r][move.c] = movingPiece;
            if (move.enPassant) {
                const epRow = movingPiece.color === 'white' ? move.r - 1 : move.r + 1;
                tempBoard[epRow][move.c] = null;
            }
            if (move.castling) {
                const homeRow = movingPiece.color === 'white' ? 0 : 7;
                if (move.castling === 'kingside') {
                    tempBoard[homeRow][5] = { ...tempBoard[homeRow][7] };
                    tempBoard[homeRow][7] = null;
                } else {
                    tempBoard[homeRow][3] = { ...tempBoard[homeRow][0] };
                    tempBoard[homeRow][0] = null;
                }
            }
            const kingPos = (() => {
                for (let rr = 0; rr < 8; rr++)
                    for (let cc = 0; cc < 8; cc++) {
                        const pp = tempBoard[rr][cc];
                        if (pp && pp.type === 'king' && pp.color === movingPiece.color) return { r: rr, c: cc };
                    }
                return null;
            })();
            if (!kingPos) continue;
            const enemyColor = movingPiece.color === 'white' ? 'black' : 'white';
            const tempGameObj = Object.create(ChessGame.prototype);
            tempGameObj.board = tempBoard;
            tempGameObj.enPassantTarget = null;
            tempGameObj.castlingRights = this.castlingRights;
            if (!tempGameObj.isSquareAttacked(kingPos.r, kingPos.c, enemyColor, tempBoard)) {
                legal.push(move);
            }
        }
        return legal;
    }

    useAbility(fromR, fromC, targetR, targetC, ability, deferFlip = false) {
        const caster = this.board[fromR][fromC];
        const targetPiece = this.board[targetR][targetC];
        if (targetPiece) {
            targetPiece.hp -= ability.damage;
            if (targetPiece.hp <= 0) {
                this.board[targetR][targetC] = null;
            }
        }
        // ★ 施放者進入冷卻（含 justUsedSkill 標記）
        this.putOnSkillCooldown(caster);
        this.halfMoveClock++;
        // ★ deferFlip = true 時，把回合切換延後到動畫播完才做，
        //   這樣冷卻數字才不會在技能動畫還沒播完時就先跳動。
        if (!deferFlip) this.flipTurn();
        this.moveHistory.push({
            type: 'ability',
            abilityName: ability.name,
            fromR, fromC, targetR, targetC,
            damageDealt: ability.damage
        });
        return true;
    }

    makeMove(fromR, fromC, toR, toC, promotionType = null, deferFlip = false) {
        const piece = this.board[fromR][fromC];
        if (!piece) return false;
        const legalMoves = this.getLegalMoves(fromR, fromC);
        const move = legalMoves.find(m => m.r === toR && m.c === toC);
        if (!move) return false;

        const captured = this.board[toR][toC];
        const prevEnPassant = this.enPassantTarget;
        const prevCastling = { ...this.castlingRights };
        this.enPassantTarget = null;

        if (piece.type === 'pawn' && move.doublePawnPush) {
            this.enPassantTarget = { r: (fromR + toR) / 2, c: toC };
        }
        if (piece.type === 'king') {
            if (piece.color === 'white') {
                this.castlingRights.whiteKingside = false;
                this.castlingRights.whiteQueenside = false;
            } else {
                this.castlingRights.blackKingside = false;
                this.castlingRights.blackQueenside = false;
            }
        }
        if (piece.type === 'rook') {
            if (fromR === 0 && fromC === 0) this.castlingRights.whiteQueenside = false;
            if (fromR === 0 && fromC === 7) this.castlingRights.whiteKingside = false;
            if (fromR === 7 && fromC === 0) this.castlingRights.blackQueenside = false;
            if (fromR === 7 && fromC === 7) this.castlingRights.blackKingside = false;
        }
        if (move.castling) {
            const homeRow = piece.color === 'white' ? 0 : 7;
            if (move.castling === 'kingside') {
                this.board[homeRow][5] = { ...this.board[homeRow][7] };
                this.board[homeRow][5].hasMoved = true;
                this.board[homeRow][7] = null;
            } else {
                this.board[homeRow][3] = { ...this.board[homeRow][0] };
                this.board[homeRow][3].hasMoved = true;
                this.board[homeRow][0] = null;
            }
        }
        this.board[fromR][fromC] = null;

        if (move.enPassant) {
            const epRow = piece.color === 'white' ? toR - 1 : toR + 1;
            const epCaptured = this.board[epRow][toC];
            this.board[epRow][toC] = null;
            this.moveHistory.push({
                fromR, fromC, toR, toC,
                piece: { ...piece },
                captured: epCaptured,
                enPassant: true,
                castling: null,
                promotion: null,
                prevEnPassant, prevCastling
            });
        } else {
            const newPiece = { ...piece, hasMoved: true };
            if (promotionType) newPiece.type = promotionType;
            this.board[toR][toC] = newPiece;
            this.moveHistory.push({
                fromR, fromC, toR, toC,
                piece: { ...piece },
                captured,
                enPassant: false,
                castling: move.castling || null,
                promotion: promotionType || null,
                prevEnPassant, prevCastling
            });
        }
        if (piece.type === 'pawn' || captured) this.halfMoveClock = 0;
        else this.halfMoveClock++;

        if (!deferFlip) this.flipTurn();
        return true;
    }
    getGameStatus() {
        const whiteKing = this.findKing('white');
        const blackKing = this.findKing('black');
        if (!whiteKing) return { over: true, winner: 'black', reason: '國王陣亡' };
        if (!blackKing) return { over: true, winner: 'white', reason: '國王陣亡' };
        if (this.isInCheck('white') && this.getAllLegalMoves('white').length === 0) return { over: true, winner: 'black', reason: '將死' };
        if (this.isInCheck('black') && this.getAllLegalMoves('black').length === 0) return { over: true, winner: 'white', reason: '將死' };
        if (!this.isInCheck('white') && this.getAllLegalMoves('white').length === 0) return { over: true, winner: 'draw', reason: '和棋（無子可動）' };
        if (!this.isInCheck('black') && this.getAllLegalMoves('black').length === 0) return { over: true, winner: 'draw', reason: '和棋（無子可動）' };
        if (this.halfMoveClock >= 100) return { over: true, winner: 'draw', reason: '五十回合規則' };
        return { over: false, winner: null, reason: null };
    }
    getAllLegalMoves(color) {
        const all = [];
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p && p.color === color) {
                    const moves = this.getLegalMoves(r, c);
                    moves.forEach(m => all.push({ fromR: r, fromC: c, toR: m.r, toC: m.c, move: m, type: 'move' }));
                }
            }
        return all;
    }
}

// ★ 一個地方統一設定「技能進入冷卻 + 標記為剛使用」，
//   避免各處忘了帶 flag。
ChessGame.prototype.putOnSkillCooldown = function (piece, abilityId) {
    if (!piece) return;
    if (abilityId === 'revive') {
        piece.reviveCooldown = QUEEN_REVIVE_COOLDOWN;
        piece.justUsedRevive = true;
    } else {
        piece.skillCooldown = getSkillCooldown(piece.type);
        piece.justUsedSkill = true;
    }
};

// ============================================================
//  ABILITIES
// ============================================================
const ABILITIES = {
    pawn: {
        name: '衝鋒爆炸',
        damage: 25,
        selfDamage: 50,
        getTargets: (game, r, c) => {
            const piece = game.getPiece(r, c);
            if (!piece) return [];
            const dir = piece.color === 'white' ? 1 : -1;
            const startRow = piece.color === 'white' ? 1 : 6;
            let maxSteps = 0;
            if (game.isInBounds(r + dir, c) && !game.getPiece(r + dir, c)) {
                maxSteps = 1;
                if (r === startRow && game.isInBounds(r + 2 * dir, c) && !game.getPiece(r + 2 * dir, c)) {
                    maxSteps = 2;
                }
            }
            if (maxSteps > 0) {
                const targetR = r + dir * (maxSteps + 1);
                if (game.isInBounds(targetR, c) && !game.getPiece(targetR, c)) {
                    return [{ r: targetR, c: c }];
                }
                const fallbackR = r + dir * maxSteps;
                if (game.isInBounds(fallbackR, c) && !game.getPiece(fallbackR, c)) {
                    return [{ r: fallbackR, c: c }];
                }
            }
            return [{ r: r, c: c }];
        }
    },
    rook: {
        name: '加農炮 (Cannon)',
        damage: 35,
        getTargets: (game, r, c) => {
            let targets = [];
            for (let i = 0; i < 8; i++) {
                for (let j = 0; j < 8; j++) {
                    if (i === r && j === c) continue;
                    const tp = game.getPiece(i, j);
                    if (tp) targets.push({ r: i, c: j });
                }
            }
            return targets;
        }
    },
    knight: {
        name: '擊退 (Knockback)',
        damage: 0,
        getTargets: (game, r, c) => game.getLegalMoves(r, c),
    },
    bishop: {
        name: '炮躍 (Cannon Leap)',
        damage: 50,
        getTargets: (game, r, c) => {
            const piece = game.getPiece(r, c);
            if (!piece) return [];
            const targets = [];
            const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

            for (const [dr, dc] of dirs) {
                // Walk outward along this diagonal
                let hasPiece = false;   // true once we've passed ≥1 piece
                for (let step = 1; step < 8; step++) {
                    const tr = r + dr * step;
                    const tc = c + dc * step;
                    if (!game.isInBounds(tr, tc)) break;

                    const target = game.getPiece(tr, tc);
                    if (target) {
                        // Any piece (friend or foe) counts as a screen
                        hasPiece = true;
                    } else if (hasPiece) {
                        // Empty square with at least one piece behind it → valid landing
                        targets.push({ r: tr, c: tc });
                    }
                }
            }
            return targets;
        }
    },
    queen: {
        id: 'heal',
        name: '治癒 (Heal)',
        damage: 0,
        healAmount: 100,
        getTargets: (game, r, c) => getQueenHealTargets(game, r, c),
    },

    // ★ NEW: King — Domain Expansion. Only offered when actually in check.
    king: {
        id: 'domain',
        name: '領域展開 (Domain Expansion)',
        damage: 0,
        getTargets: (game, r, c) => {
            const piece = game.getPiece(r, c);
            if (!piece) return [];

            // Uses exhausted?
            if (kingSkillState.uses[piece.color] <= 0) return [];

            // Cooldown?
            const movesSince = game.fullMoveNumber - kingSkillState.lastUsedMove[piece.color];
            if (movesSince < KING_DOMAIN_COOLDOWN) return [];

            // Must actually be in check — this is what gates the button
            if (!game.isInCheck(piece.color)) return [];

            // Each checking piece is a valid "target"
            return findCheckingPieces(piece.color, game).map(ch => ({ r: ch.r, c: ch.c }));
        },
    },

    default: {
        name: '普通攻擊 (Strike)',
        damage: 40,
        getTargets: (game, r, c) => {
            let targets = [];
            for (const dr of [-1, 0, 1]) {
                for (const dc of [-1, 0, 1]) {
                    if (dr === 0 && dc === 0) continue;
                    if (game.isInBounds(r + dr, c + dc)) targets.push({ r: r + dr, c: c + dc });
                }
            }
            return targets;
        }
    }
};

// ★ 皇后第二技能：復活
const QUEEN_REVIVE_ABILITY = {
    id: 'revive',
    name: '復活 (Revive)',
    damage: 0,
};

// ============================================================
//  ★ 皇后技能輔助
// ============================================================

// 皇后「治癒」：她移動範圍內（每條射線上第一個棋子）的受損友方棋子
function getQueenHealTargets(game, r, c) {
    const piece = game.getPiece(r, c);
    if (!piece) return [];
    const targets = [];
    const dirs = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1], [0, 1],
        [1, -1], [1, 0], [1, 1],
    ];
    for (const [dr, dc] of dirs) {
        for (let i = 1; i < 8; i++) {
            const tr = r + dr * i;
            const tc = c + dc * i;
            if (!game.isInBounds(tr, tc)) break;
            const t = game.getPiece(tr, tc);
            if (!t) continue;
            if (t.color === piece.color && t !== piece && t.hp < t.maxHp) {
                targets.push({ r: tr, c: tc });
            }
            break;   // 被擋住，射線結束
        }
    }
    return targets;
}

// 皇后「復活」：自身周圍 8 格中的空格
function getReviveSquares(game, r, c) {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const tr = r + dr;
            const tc = c + dc;
            if (!game.isInBounds(tr, tc)) continue;
            if (game.getPiece(tr, tc)) continue;
            out.push({ r: tr, c: tc });
        }
    }
    return out;
}

// ============================================================
//  ★ 騎士擊退輔助函式
// ============================================================

// 計算「從落點出發，位於 3×3（不含中心）內所有可被擊退的敵方棋子」
function getPushableVictims(game, landingR, landingC, fromR, fromC, casterColor) {
    const victims = [];
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const vr = landingR + dr;
            const vc = landingC + dc;
            if (!game.isInBounds(vr, vc)) continue;
            const piece = game.getPiece(vr, vc);
            if (!piece || piece.color === casterColor) continue;

            const directions = getPushDirections(game, landingR, landingC, vr, vc, fromR, fromC, casterColor);
            if (directions.length > 0) {
                victims.push({ r: vr, c: vc, directions });
            }
        }
    }
    return victims;
}

// ★ 計算「該敵人能往哪些方向被推」
function getPushDirections(game, landingR, landingC, victimR, victimC, fromR, fromC, casterColor) {
    const sdr = landingR - victimR;
    const sdc = landingC - victimC;
    const fdr = landingR - fromR;
    const fdc = landingC - fromC;

    const dirs = [];
    for (let pr = -1; pr <= 1; pr++) {
        for (let pc = -1; pc <= 1; pc++) {
            if (pr === 0 && pc === 0) continue;
            if (pr * sdr + pc * sdc > 0) continue;

            const tr = victimR + pr;
            const tc = victimC + pc;
            if (!game.isInBounds(tr, tc)) continue;
            if (tr === landingR && tc === landingC) continue;
            if ((tr - landingR) * fdr + (tc - landingC) * fdc < 0) continue;

            let blocked = false;
            let blocker = null;

            const tp = game.getPiece(tr, tc);
            if (tp) {
                if (tp.color === casterColor) continue;
                blocked = true;
                blocker = { r: tr, c: tc };
            }

            dirs.push({ dirR: pr, dirC: pc, targetR: tr, targetC: tc, blocked, blocker });
        }
    }
    return dirs;
}

// 取得騎士所有「可擊退的落點」
function getKnightPushLandings(game, fromR, fromC) {
    const piece = game.getPiece(fromR, fromC);
    if (!piece) return [];
    const moves = game.getLegalMoves(fromR, fromC);
    return moves.filter(m => {
        const victims = getPushableVictims(game, m.r, m.c, fromR, fromC, piece.color);
        return victims.length > 0;
    });
}

// ★ 取得騎士/主教「跳躍路徑上」的所有棋子（不含起點與落點）
function getBishopPathPieces(game, fromR, fromC, toR, toC) {
    const pieces = [];
    if (Math.abs(toR - fromR) !== Math.abs(toC - fromC)) return pieces;
    const dr = Math.sign(toR - fromR);
    const dc = Math.sign(toC - fromC);
    if (dr === 0 || dc === 0) return pieces;
    const steps = Math.abs(toR - fromR);
    for (let i = 1; i < steps; i++) {
        const r = fromR + dr * i;
        const c = fromC + dc * i;
        const p = game.getPiece(r, c);
        if (p) pieces.push({ r, c, piece: p });
    }
    return pieces;
}

// ============================================================
//  ROOM SETTINGS
// ============================================================
let roomSettings = {
    gameMode: 'totally',
    abilityPermissions: { white: true, black: true },
    timePerPlayer: 300,
};

function isAbilityEnabledForColor(color) {
    if (roomSettings.gameMode === 'normal') return false;
    return roomSettings.abilityPermissions[color] === true;
}

// ★ AI mode toggle state — reflects the switch in the AI difficulty menu.
//   true  = skills enabled ("totally")
//   false = no skills      ("normal")
let aiGameModeEnabled = true;

// ★ AI mode player color choice — which colour the human plays in singleplayer.
//   'white' = human moves first, 'black' = human moves second (AI moves first).
let aiPlayerColorChoice = 'white';

function setAIPlayerColor(color) {
    aiPlayerColorChoice = (color === 'black') ? 'black' : 'white';
    document.querySelectorAll('#aiDifficultyMenu .ai-color-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.color === aiPlayerColorChoice);
    });
}

function onAIModeToggleChange() {
    const cb = document.getElementById('aiGameModeToggle');
    aiGameModeEnabled = !!cb.checked;
    updateAIModeUI();
}

function updateAIModeUI() {
    const panel = document.querySelector('#aiDifficultyMenu .panel');
    if (panel) panel.dataset.mode = aiGameModeEnabled ? 'totally' : 'normal';
    const hint = document.getElementById('aiModeHint');
    if (hint) {
        hint.innerHTML = aiGameModeEnabled
            ? '目前：<strong>技能模式</strong> — 棋子可使用特殊技能'
            : '目前：<strong>純西洋棋</strong> — 不啟用任何特殊技能';
    }
}

function pieceHasAbility(piece) {
    if (!piece) return false;
    if (!isAbilityEnabledForColor(piece.color)) return false;
    return ABILITIES[piece.type] !== undefined;
}

ChessGame.prototype.getLegalAbilities = function (r, c) {
    const piece = this.getPiece(r, c);
    if (!piece) return [];
    if (!isAbilityEnabledForColor(piece.color)) return [];
    // ★ 皇后有兩招，不能因為單一冷卻就全部鎖死
    if (piece.type !== 'queen' && (piece.skillCooldown || 0) > 0) return [];

    const abilityDef = ABILITIES[piece.type];
    if (!abilityDef) return [];

    if (piece.type === 'pawn') {
        const targets = abilityDef.getTargets(this, r, c);
        return targets.map(t => ({
            type: 'ability', fromR: r, fromC: c, r: t.r, c: t.c, ability: abilityDef
        }));
    }

    // ★ Bishop: leap targets (empty squares) — must NOT go through the
    //   default enemy-filter fallback below.
    if (piece.type === 'bishop') {
        const targets = abilityDef.getTargets(this, r, c);
        return targets.map(t => ({
            type: 'ability', fromR: r, fromC: c, r: t.r, c: t.c, ability: abilityDef
        }));
    }

    if (piece.type === 'knight') {
        const landings = getKnightPushLandings(this, r, c);
        return landings.map(m => ({
            type: 'ability', fromR: r, fromC: c, r: m.r, c: m.c, ability: abilityDef
        }));
    }

    // ★ King — Domain Expansion targets (= checking pieces)
    if (piece.type === 'king') {
        const targets = abilityDef.getTargets(this, r, c);
        return targets.map(t => ({
            type: 'ability', fromR: r, fromC: c, r: t.r, c: t.c, ability: abilityDef
        }));
    }

    // ★ 皇后：治癒 + 復活
    if (piece.type === 'queen') {
        const out = [];

        // ── 治癒 ──
        if ((piece.skillCooldown || 0) === 0) {
            for (const t of getQueenHealTargets(this, r, c)) {
                out.push({
                    type: 'ability', fromR: r, fromC: c, r: t.r, c: t.c,
                    ability: ABILITIES.queen,
                });
            }
        }

        // ── 復活 ──
        if ((piece.reviveCooldown || 0) === 0 && this.getDeadPieces(piece.color).length > 0) {
            for (const sq of getReviveSquares(this, r, c)) {
                out.push({
                    type: 'ability', fromR: r, fromC: c, r: sq.r, c: sq.c,
                    ability: QUEEN_REVIVE_ABILITY,
                });
            }
        }

        return out;
    }

    if (piece.type === 'rook') {
        const targets = [];
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                if (i === r && j === c) continue;
                const targetPiece = this.board[i][j];
                if (targetPiece && isWithinCannonRange(r, c, i, j)) {
                    targets.push({ type: 'ability', fromR: r, fromC: c, r: i, c: j, ability: abilityDef });
                }
            }
        }
        return targets;
    }

    const targets = abilityDef.getTargets(this, r, c);
    const validTargets = [];
    targets.forEach(t => {
        const targetPiece = this.board[t.r][t.c];
        if (targetPiece && targetPiece.color !== piece.color) {
            validTargets.push({ type: 'ability', fromR: r, fromC: c, r: t.r, c: t.c, ability: abilityDef });
        }
    });
    return validTargets;
};

// ============================================================
//  TIMER
// ============================================================
let timerState = {
    white: 300, black: 300, active: false, interval: null,
    currentPlayer: null, paused: false, isInfinite: false,
};

function formatTime(seconds) {
    if (seconds === Infinity || seconds === -1) return '∞';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateTimerDisplay() {
    const wEl = document.getElementById('timerWhiteText');
    const bEl = document.getElementById('timerBlackText');
    const wItem = document.getElementById('timerWhite');
    const bItem = document.getElementById('timerBlack');
    if (wEl) {
        const val = timerState.isInfinite ? -1 : Math.max(0, timerState.white);
        wEl.textContent = formatTime(val);
        wEl.classList.toggle('infinity', timerState.isInfinite || val === -1);
    }
    if (bEl) {
        const val = timerState.isInfinite ? -1 : Math.max(0, timerState.black);
        bEl.textContent = formatTime(val);
        bEl.classList.toggle('infinity', timerState.isInfinite || val === -1);
    }
    if (wItem && bItem) {
        const showActive = timerState.active && !timerState.paused;
        wItem.classList.toggle('active', timerState.currentPlayer === 'white' && showActive);
        bItem.classList.toggle('active', timerState.currentPlayer === 'black' && showActive);
    }
    if (wEl && !timerState.isInfinite) wEl.classList.toggle('warning', timerState.white < 30);
    if (bEl && !timerState.isInfinite) bEl.classList.toggle('warning', timerState.black < 30);
}

function startTimer() {
    if (timerState.isInfinite || roomSettings.timePerPlayer <= 0 || currentMode !== 'multiplayer') { stopTimer(); return; }
    if (timerState.interval) { clearInterval(timerState.interval); timerState.interval = null; }
    if (!timerState.currentPlayer) timerState.currentPlayer = 'white';
    timerState.active = true;
    timerState.paused = false;
    updateTimerDisplay();
    timerState.interval = setInterval(() => {
        if (timerState.paused || gameOverFlag || isAnimating || aiThinking) return;
        const player = timerState.currentPlayer;
        if (!timerState.isInfinite && timerState[player] > 0) {
            timerState[player] -= 1;
            updateTimerDisplay();
            if (timerState[player] <= 0) {
                timerState[player] = 0;
                updateTimerDisplay();
                timerOutGameOver(player);
            }
        }
    }, 1000);
}

function pauseTimer() {
    timerState.paused = true;
    // ★ Truly stop the interval so no time is consumed while paused.
    //   Setting the flag alone leaves the interval alive (it fires
    //   once per second and immediately returns), which means a fast
    //   reconnect or an in-flight animation could un-pause it and
    //   silently drain the clock.
    if (timerState.interval) {
        clearInterval(timerState.interval);
        timerState.interval = null;
    }
    updateTimerDisplay();
}

function resumeTimer() {
    timerState.paused = false;
    // ★ Recreate the interval if pauseTimer() killed it.
    //   startTimer() re-checks all the guards (infinite mode,
    //   timePerPlayer, currentMode) internally, so it's safe to call.
    if (!timerState.interval &&
        !timerState.isInfinite &&
        roomSettings.timePerPlayer > 0 &&
        currentMode === 'multiplayer' &&
        !gameOverFlag) {
        startTimer();
    }
    updateTimerDisplay();
}

function switchTimer(nextPlayer) {
    timerState.currentPlayer = nextPlayer;

    // ★ Don't touch the pause state if we're mid-reconnect. The
    //   state_sync from the host will resume us at the right moment.
    if (isReconnecting) {
        updateTimerDisplay();
        return;
    }

    timerState.active = true;
    timerState.paused = false;
    updateTimerDisplay();
    if (!timerState.isInfinite && !timerState.interval) startTimer();
}

function stopTimer() {
    if (timerState.interval) { clearInterval(timerState.interval); timerState.interval = null; }
    timerState.active = false;
    timerState.paused = false;
}

function resetTimers(timePerPlayer) {
    stopTimer();
    timerState.isInfinite = (timePerPlayer <= 0);
    timerState.white = timerState.isInfinite ? Infinity : timePerPlayer;
    timerState.black = timerState.isInfinite ? Infinity : timePerPlayer;
    timerState.currentPlayer = 'white';
    timerState.active = false;
    timerState.paused = false;
    updateTimerDisplay();
}

function timerOutGameOver(player) {
    if (gameOverFlag) return;
    gameOverFlag = true;
    stopTimer();
    const winner = player === 'white' ? 'black' : 'white';
    document.getElementById('gameOverOverlay').classList.remove('hidden');
    document.getElementById('gameOverReason').textContent = `${player === 'white' ? '白方' : '黑方'} 時間用盡`;
    const text = document.getElementById('gameOverText');
    if (currentMode === 'ai' || currentMode === 'multiplayer') {
        if (winner === playerColor) { text.textContent = '你贏了! (時間勝)'; text.className = 'game-over-text win'; }
        else { text.textContent = '你輸了... (時間用盡)'; text.className = 'game-over-text lose'; }
    } else {
        text.textContent = (winner === 'white' ? '白方' : '黑方') + ' 獲勝! (時間)';
        text.className = 'game-over-text win';
    }
    if (currentMode === 'multiplayer' && peerConnection?.open) peerConnection.send({ type: 'gameover' });
}

// ============================================================
//  PIECE PARAMS
// ============================================================
const PIECE_PARAMS = {
    "pawn": {
        "baseRadius": 0.12,
        "baseHeight": 0.28,
        "topRadius": 0.185,
        "topHeight": 0.04,
        "sphereRadius": 0.18,
        "color": "#f5f0e1",
        "roughness": 0.25,
        "metalness": 0.2,
        "position": {
            "x": -4.2,
            "y": 0,
            "z": 0
        }
    },
    "rook": {
        "bodyRadius": 0.2,
        "bodyHeight": 0.44,
        "crownRadius": 0.285,
        "crownHeight": 0.13,
        "color": "#f5f0e1",
        "roughness": 0.25,
        "metalness": 0.2,
        "position": {
            "x": -2.52,
            "y": 0.02,
            "z": 0
        },
        "parts": {
            "custom_1002": {
                "type": "box",
                "geometryParams": {
                    "width": 0.2,
                    "height": 0.2,
                    "depth": 0.2
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": -0.21,
                    "y": 0.62,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 1.56,
                    "z": 0
                },
                "scale": {
                    "x": 1,
                    "y": 1,
                    "z": 0.4
                },
                "name": "Box Copy Copy Copy"
            },
            "custom_1000": {
                "type": "box",
                "geometryParams": {
                    "width": 0.2,
                    "height": 0.2,
                    "depth": 0.2
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.62,
                    "z": 0.21
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1,
                    "y": 1,
                    "z": 0.4
                },
                "name": "Box Copy"
            },
            "custom_1001": {
                "type": "box",
                "geometryParams": {
                    "width": 0.2,
                    "height": 0.2,
                    "depth": 0.2
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0.21,
                    "y": 0.62,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 1.56,
                    "z": 0
                },
                "scale": {
                    "x": 1,
                    "y": 1,
                    "z": 0.4
                },
                "name": "Box Copy Copy"
            },
            "custom_1003": {
                "type": "box",
                "geometryParams": {
                    "width": 0.2,
                    "height": 0.2,
                    "depth": 0.2
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.62,
                    "z": -0.21
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1,
                    "y": 1,
                    "z": 0.4
                },
                "name": "Box Copy Copy"
            }
        }
    },
    "knight": {
        "bodyRadius": 0.26,
        "bodyHeight": 0.38,
        "neckWidth": 0.22,
        "neckHeight": 0.3,
        "neckDepth": 0.22,
        "headWidth": 0.16,
        "headHeight": 0.22,
        "headDepth": 0.3,
        "color": "#f5f0e1",
        "roughness": 0.25,
        "metalness": 0.2,
        "position": {
            "x": -0.84,
            "y": 0.02,
            "z": 0
        },
        "parts": {
            "body": {
                "deleted": true
            },
            "neck": {
                "deleted": true
            },
            "head": {
                "deleted": true
            },
            "custom_1022": {
                "type": "sphere",
                "geometryParams": {
                    "radius": 0.15
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.17,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 2,
                    "y": 0.69,
                    "z": 2
                },
                "name": "Sphere"
            },
            "custom_1023": {
                "type": "cone",
                "geometryParams": {
                    "radius": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.3229,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1.85,
                    "y": 0.8,
                    "z": 1.85
                },
                "name": "Cone"
            },
            "custom_1024": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.53,
                    "z": -0.03
                },
                "rotation": {
                    "x": -0.38,
                    "y": 0.17,
                    "z": -0.04
                },
                "scale": {
                    "x": 0.92,
                    "y": 1.77,
                    "z": 0.92
                },
                "name": "Cylinder"
            },
            "custom_1030": {
                "type": "octahedron",
                "geometryParams": {
                    "radius": 0.2,
                    "detail": 0
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": -0.0818,
                    "y": 0.94,
                    "z": -0.18
                },
                "rotation": {
                    "x": -0.05,
                    "y": 0.03,
                    "z": 0.19
                },
                "scale": {
                    "x": 0.43,
                    "y": 1,
                    "z": 0.63
                },
                "name": "Octa"
            },
            "custom_1031": {
                "type": "octahedron",
                "geometryParams": {
                    "radius": 0.2,
                    "detail": 0
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0.0794,
                    "y": 0.94,
                    "z": -0.18
                },
                "rotation": {
                    "x": -0.05,
                    "y": 0.03,
                    "z": -0.19
                },
                "scale": {
                    "x": 0.43,
                    "y": 1,
                    "z": 0.63
                },
                "name": "Octa Copy"
            },
            "custom_1033": {
                "type": "box",
                "geometryParams": {
                    "width": 0.2,
                    "height": 0.2,
                    "depth": 0.2
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.4314,
                    "z": -0.0939
                },
                "rotation": {
                    "x": -0.6105,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.3144,
                    "y": 1.7371,
                    "z": 1
                },
                "name": "Box"
            },
            "custom_1034": {
                "type": "box",
                "geometryParams": {
                    "width": 0.2,
                    "height": 0.2,
                    "depth": 0.2
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.5162,
                    "z": -0.1167
                },
                "rotation": {
                    "x": -0.6105,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.3144,
                    "y": 1.7371,
                    "z": 1
                },
                "name": "Box Copy"
            },
            "custom_1035": {
                "type": "box",
                "geometryParams": {
                    "width": 0.2,
                    "height": 0.2,
                    "depth": 0.2
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.5942,
                    "z": -0.1273
                },
                "rotation": {
                    "x": -0.6105,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.3144,
                    "y": 1.7371,
                    "z": 1
                },
                "name": "Box Copy Copy"
            },
            "custom_1036": {
                "type": "box",
                "geometryParams": {
                    "width": 0.2,
                    "height": 0.2,
                    "depth": 0.2
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.7013,
                    "z": -0.1437
                },
                "rotation": {
                    "x": -0.6105,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.3144,
                    "y": 1.7371,
                    "z": 1
                },
                "name": "Box Copy Copy Copy"
            },
            "custom_1037": {
                "type": "box",
                "geometryParams": {
                    "width": 0.2,
                    "height": 0.2,
                    "depth": 0.2
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.6559,
                    "z": -0.142
                },
                "rotation": {
                    "x": -0.6105,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.3144,
                    "y": 1.7371,
                    "z": 1
                },
                "name": "Box Copy Copy Copy Copy"
            },
            "custom_1038": {
                "type": "box",
                "geometryParams": {
                    "width": 0.2,
                    "height": 0.2,
                    "depth": 0.2
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.7539,
                    "z": -0.142
                },
                "rotation": {
                    "x": -0.6105,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.3144,
                    "y": 1.7371,
                    "z": 1
                },
                "name": "Box Copy Copy Copy Copy Copy"
            },
            "custom_1040": {
                "type": "box",
                "geometryParams": {
                    "width": 0.2,
                    "height": 0.2,
                    "depth": 0.2
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.8542,
                    "z": -0.1892
                },
                "rotation": {
                    "x": -0.6105,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.3144,
                    "y": 1.2543,
                    "z": 0.6819
                },
                "name": "Box Copy Copy Copy Copy Copy Copy"
            },
            "custom_1041": {
                "type": "box",
                "geometryParams": {
                    "width": 0.2,
                    "height": 0.2,
                    "depth": 0.2
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.8718,
                    "z": -0.133
                },
                "rotation": {
                    "x": -0.6105,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.3144,
                    "y": 1.7371,
                    "z": 1
                },
                "name": "Box Copy Copy Copy Copy Copy Copy Copy"
            },
            "custom_1043": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.33,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1.6,
                    "y": 0.06,
                    "z": 1.6
                },
                "name": "Cylinder"
            },
            "custom_1045": {
                "type": "cone",
                "geometryParams": {
                    "radius": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.47,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1.45,
                    "y": 1,
                    "z": 1.45
                },
                "name": "Cone"
            },
            "custom_1046": {
                "type": "sphere",
                "geometryParams": {
                    "radius": 0.15
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0.11,
                    "y": 0.92,
                    "z": 0.02
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.35,
                    "y": 0.35,
                    "z": 0.35
                },
                "name": "Sphere"
            },
            "custom_1047": {
                "type": "sphere",
                "geometryParams": {
                    "radius": 0.15
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": -0.1088,
                    "y": 0.92,
                    "z": 0.02
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.35,
                    "y": 0.35,
                    "z": 0.35
                },
                "name": "Sphere Copy"
            },
            "custom_1048": {
                "type": "dodecahedron",
                "geometryParams": {
                    "radius": 0.2,
                    "detail": 0
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.985,
                    "z": -0.0815
                },
                "rotation": {
                    "x": 0.2342,
                    "y": -0.0241,
                    "z": -0.0591
                },
                "scale": {
                    "x": -0.1606,
                    "y": 0.7488,
                    "z": 1.174
                },
                "name": "Dodeca"
            },
            "custom_1049": {
                "type": "icosahedron",
                "geometryParams": {
                    "radius": 0.2,
                    "detail": 0
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.5253,
                    "z": -0.0958
                },
                "rotation": {
                    "x": -0.1055,
                    "y": 0,
                    "z": -0.04
                },
                "scale": {
                    "x": 0.9458,
                    "y": 1.725,
                    "z": 0.9099
                },
                "name": "Icosa"
            },
            "custom_1052": {
                "type": "air",
                "geometryParams": {
                    "width": 0.3,
                    "height": 0.3,
                    "depth": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.7179,
                    "z": 0.3185
                },
                "rotation": {
                    "x": 0.25,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.7,
                    "y": 0.13,
                    "z": 0.51
                },
                "name": "Air"
            },
            "custom_1056": {
                "type": "air",
                "geometryParams": {
                    "width": 0.3,
                    "height": 0.3,
                    "depth": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.6574,
                    "z": 0.3201
                },
                "rotation": {
                    "x": -0.456,
                    "y": 0.0381,
                    "z": 0.0083
                },
                "scale": {
                    "x": 1,
                    "y": 0.1215,
                    "z": 0.3373
                },
                "name": "Air Copy"
            },
            "custom_1064": {
                "type": "dodecahedron",
                "geometryParams": {
                    "radius": 0.2,
                    "detail": 0
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.5887,
                    "z": -0.0514
                },
                "rotation": {
                    "x": -0.468,
                    "y": 0.091,
                    "z": 0.0164
                },
                "scale": {
                    "x": 1.0629,
                    "y": 2.18,
                    "z": 0.8604
                },
                "name": "Dodeca"
            },
            "custom_1065": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": -0.04,
                    "y": 0.75,
                    "z": 0.37
                },
                "rotation": {
                    "x": 1.64,
                    "y": 0.02,
                    "z": -0.07
                },
                "scale": {
                    "x": 0.1,
                    "y": 0.1,
                    "z": 0.1
                },
                "name": "Cylinder"
            },
            "custom_1066": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0.04,
                    "y": 0.75,
                    "z": 0.37
                },
                "rotation": {
                    "x": 1.64,
                    "y": 0.02,
                    "z": -0.07
                },
                "scale": {
                    "x": 0.1,
                    "y": 0.1,
                    "z": 0.1
                },
                "name": "Cylinder Copy"
            },
            "custom_1070": {
                "type": "cone",
                "geometryParams": {
                    "radius": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.18,
                    "z": 0
                },
                "rotation": {
                    "x": -3.14,
                    "y": -0.29,
                    "z": 0
                },
                "scale": {
                    "x": 1.45,
                    "y": 1,
                    "z": 1.45
                },
                "name": "Cone Copy"
            },
            "custom_2000": {
                "type": "frustum",
                "name": "Frustum",
                "geometryParams": {},
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.8282,
                    "z": 0.0959
                },
                "rotation": {
                    "x": 1.95,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.928,
                    "y": 1.95,
                    "z": 0.72
                }
            }
        }
    },
    "bishop": {
        "bodyRadius": 0.22,
        "bodyHeight": 0.42,
        "sphereRadius": 0.1,
        "color": "#ffffff",
        "roughness": 0.25,
        "metalness": 0.2,
        "position": {
            "x": 0.84,
            "y": 0.02,
            "z": 0
        },
        "parts": {
            "body": {
                "deleted": true
            },
            "sphere": {
                "deleted": true
            },
            "custom_1000": {
                "type": "cone",
                "geometryParams": {
                    "radius": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0.002,
                    "y": 0.2385,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1.9999,
                    "y": 0.9193,
                    "z": 1.9931
                },
                "name": "Cone"
            },
            "custom_1001": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.1306,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1.2957,
                    "y": 1,
                    "z": 1.2146
                },
                "name": "Cylinder"
            },
            "custom_1003": {
                "type": "cone",
                "geometryParams": {
                    "radius": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.52,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1.25,
                    "y": 2.91,
                    "z": 1.25
                },
                "name": "Cone"
            },
            "custom_1004": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.59,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.65,
                    "y": 1.25,
                    "z": 0.65
                },
                "name": "Cylinder"
            },
            "custom_1005": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.6888,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1,
                    "y": -0.0615,
                    "z": 1
                },
                "name": "Cylinder"
            },
            "custom_1006": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.7085,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.8292,
                    "y": -0.0999,
                    "z": 0.8503
                },
                "name": "Cylinder Copy"
            },
            "custom_1007": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.7318,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.5847,
                    "y": 0.0505,
                    "z": 0.612
                },
                "name": "Cylinder"
            },
            "custom_1009": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 1.016,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.51,
                    "y": 0.15,
                    "z": 0.56
                },
                "name": "Cylinder"
            },
            "custom_1010": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.9859,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.3,
                    "y": 0.0559,
                    "z": 0.3
                },
                "name": "Cylinder Copy"
            },
            "base": {
                "position": {
                    "x": 0,
                    "y": 0.06,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1,
                    "y": 1,
                    "z": 1
                }
            },
            "custom_1016": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.7763,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.5847,
                    "y": 0.0505,
                    "z": 0.612
                },
                "name": "Cylinder Copy"
            },
            "custom_1017": {
                "type": "cone",
                "geometryParams": {
                    "radius": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.9228,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.85,
                    "y": 0.7,
                    "z": 0.85
                },
                "name": "Cone"
            },
            "custom_1018": {
                "type": "cone",
                "geometryParams": {
                    "radius": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.754,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 3.15
                },
                "scale": {
                    "x": 0.85,
                    "y": 0.45,
                    "z": 0.85
                },
                "name": "Cone Copy"
            },
            "custom_1021": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.7686,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.8292,
                    "y": -0.0999,
                    "z": 0.8503
                },
                "name": "Cylinder Copy Copy"
            },
            "custom_2000": {
                "type": "air",
                "name": "Air Cut",
                "geometryParams": {
                    "width": 0.3,
                    "height": 0.3,
                    "depth": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": -0.0439,
                    "y": 0.9095,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": -0.6966
                },
                "scale": {
                    "x": 0.5051,
                    "y": 0.0664,
                    "z": 0.5818
                }
            }
        }
    },
    "queen": {
        "bodyRadius": 0.22,
        "bodyHeight": 0.52,
        "crownRadius": 0.27,
        "crownHeight": 0.2,
        "spikeRadius": 0.13,
        "color": "#f5f0e1",
        "roughness": 0.25,
        "metalness": 0.2,
        "position": {
            "x": 2.52,
            "y": 0.03,
            "z": 0
        },
        "parts": {
            "custom_1000": {
                "type": "torus",
                "geometryParams": {
                    "radius": 0.15,
                    "tube": 0.05
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.57,
                    "z": 0
                },
                "rotation": {
                    "x": -1.56,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1.56,
                    "y": 1.58,
                    "z": 1.12
                },
                "name": "Torus"
            },
            "custom_1001": {
                "type": "cone",
                "geometryParams": {
                    "radius": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.62,
                    "z": 0
                },
                "rotation": {
                    "x": -3.14,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 2.12,
                    "y": 0.5,
                    "z": 1
                },
                "name": "Cone"
            },
            "custom_1002": {
                "type": "cone",
                "geometryParams": {
                    "radius": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.62,
                    "z": 0
                },
                "rotation": {
                    "x": -3.14,
                    "y": -1.58,
                    "z": 0
                },
                "scale": {
                    "x": 2.16,
                    "y": 0.5,
                    "z": 1
                },
                "name": "Cone"
            },
            "spike": {
                "position": {
                    "x": 0,
                    "y": 0.79,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1,
                    "y": 1,
                    "z": 1
                }
            },
            "crown": {
                "position": {
                    "x": 0,
                    "y": 0.52,
                    "z": 0
                },
                "rotation": {
                    "x": -3.14,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1,
                    "y": 0.48,
                    "z": 1
                }
            },
            "body": {
                "position": {
                    "x": 0,
                    "y": 0.32,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.7,
                    "y": 1,
                    "z": 0.7
                }
            }
        }
    },
    "king": {
        "bodyRadius": 0.235,
        "bodyHeight": 0.5,
        "crownRadius": 0.25,
        "crownHeight": 0.12,
        "crossWidth": 0.07,
        "crossHeight": 0.28,
        "crossDepth": 0.105,
        "color": "#ffffff",
        "roughness": 0.25,
        "metalness": 0.2,
        "position": {
            "x": 4.2,
            "y": 0.04,
            "z": 0
        },
        "parts": {
            "base": {
                "position": {
                    "x": 0,
                    "y": 0.06,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1,
                    "y": 1,
                    "z": 1
                }
            },
            "body": {
                "deleted": true
            },
            "crown": {
                "deleted": true
            },
            "crossV": {
                "deleted": true
            },
            "crossH": {
                "deleted": true
            },
            "custom_1000": {
                "type": "cone",
                "geometryParams": {
                    "radius": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0.002,
                    "y": 0.2539,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1.9999,
                    "y": 0.9193,
                    "z": 1.9931
                },
                "name": "Cone"
            },
            "custom_1001": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.1491,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1.2957,
                    "y": 1,
                    "z": 1.2146
                },
                "name": "Cylinder"
            },
            "custom_1003": {
                "type": "cone",
                "geometryParams": {
                    "radius": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.4262,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1.0914,
                    "y": 2.9097,
                    "z": 1.2881
                },
                "name": "Cone"
            },
            "custom_1004": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.5664,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.4607,
                    "y": 1.5936,
                    "z": 0.52
                },
                "name": "Cylinder"
            },
            "custom_1005": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.736,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 1,
                    "y": -0.0615,
                    "z": 1
                },
                "name": "Cylinder"
            },
            "custom_1006": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.7539,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.8292,
                    "y": -0.0999,
                    "z": 0.8503
                },
                "name": "Cylinder Copy"
            },
            "custom_1007": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.8041,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.5847,
                    "y": 0.0505,
                    "z": 0.612
                },
                "name": "Cylinder"
            },
            "custom_1008": {
                "type": "cone",
                "geometryParams": {
                    "radius": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.8217,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": -3.15
                },
                "scale": {
                    "x": 1,
                    "y": 1,
                    "z": 1
                },
                "name": "Cone"
            },
            "custom_1009": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.9791,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.51,
                    "y": 0.0552,
                    "z": 0.5632
                },
                "name": "Cylinder"
            },
            "custom_1010": {
                "type": "cylinder",
                "geometryParams": {
                    "radiusTop": 0.15,
                    "radiusBottom": 0.15,
                    "height": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.9859,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.3,
                    "y": 0.0559,
                    "z": 0.3
                },
                "name": "Cylinder Copy"
            },
            "custom_1012": {
                "type": "box",
                "geometryParams": {
                    "width": 0.2,
                    "height": 0.2,
                    "depth": 0.2
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 1.0719,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.9734,
                    "y": 0.3662,
                    "z": 0.2203
                },
                "name": "Box"
            },
            "custom_1013": {
                "type": "box",
                "geometryParams": {
                    "width": 0.2,
                    "height": 0.2,
                    "depth": 0.2
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 1.07,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": -1.58
                },
                "scale": {
                    "x": 0.8,
                    "y": 0.37,
                    "z": 0.22
                },
                "name": "Box Copy"
            },
            "custom_1015": {
                "type": "frustum",
                "geometryParams": {
                    "radiusTop": 0.08,
                    "radiusBottom": 0.18,
                    "height": 0.3,
                    "segments": 16
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 1.17,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.25,
                    "y": 0.14,
                    "z": 0.15
                },
                "name": "Frustum"
            },
            "custom_1016": {
                "type": "sphere",
                "geometryParams": {
                    "radius": 0.15
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": 0,
                    "y": 0.523,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.5268,
                    "y": 0.6517,
                    "z": 0.6517
                },
                "name": "Sphere"
            }
        }
    }
};

const GEO_CACHE = new Map();
function getGeo(key, factory) {
    let g = GEO_CACHE.get(key);
    if (!g) { g = factory(); GEO_CACHE.set(key, g); }
    return g;
}

const gCyl = (rt, rb, h, s) => getGeo(`cyl_${rt}_${rb}_${h}_${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const gBox = (w, h, d) => getGeo(`box_${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d));
const gSph = (r, w, h) => getGeo(`sph_${r}_${w}_${h}`, () => new THREE.SphereGeometry(r, w, h));
const gCone = (r, h, s) => getGeo(`cone_${r}_${h}_${s}`, () => new THREE.ConeGeometry(r, h, s));
const gTorus = (r, t, rs, ts) => getGeo(`tor_${r}_${t}_${rs}_${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts));

// ============================================================
//  CSG LIBRARY — same math as chessEditor.html, used for
//  air-block subtraction on pieces (e.g. the bishop).
// ============================================================
(function (global) {
    const EPSILON = 1e-5;
    const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;

    class Vector {
        constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
        clone() { return new Vector(this.x, this.y, this.z); }
        negated() { return new Vector(-this.x, -this.y, -this.z); }
        plus(a) { return new Vector(this.x + a.x, this.y + a.y, this.z + a.z); }
        minus(a) { return new Vector(this.x - a.x, this.y - a.y, this.z - a.z); }
        times(a) { return new Vector(this.x * a, this.y * a, this.z * a); }
        dividedBy(a) { return new Vector(this.x / a, this.y / a, this.z / a); }
        dot(a) { return this.x * a.x + this.y * a.y + this.z * a.z; }
        lerp(a, t) { return this.plus(a.minus(this).times(t)); }
        length() { return Math.sqrt(this.dot(this)); }
        unit() { return this.dividedBy(this.length()); }
        cross(a) {
            return new Vector(
                this.y * a.z - this.z * a.y,
                this.z * a.x - this.x * a.z,
                this.x * a.y - this.y * a.x
            );
        }
    }

    class Vertex {
        constructor(pos, normal) { this.pos = pos; this.normal = normal; }
        clone() { return new Vertex(this.pos.clone(), this.normal.clone()); }
        flip() { this.normal = this.normal.negated(); }
        interpolate(other, t) {
            return new Vertex(this.pos.lerp(other.pos, t), this.normal.lerp(other.normal, t));
        }
    }

    class Plane {
        constructor(normal, w) { this.normal = normal; this.w = w; }
        static fromPoints(a, b, c) {
            const n = b.minus(a).cross(c.minus(a)).unit();
            return new Plane(n, n.dot(a));
        }
        clone() { return new Plane(this.normal.clone(), this.w); }
        flip() { this.normal = this.normal.negated(); this.w = -this.w; }
        splitPolygon(polygon, coplanarFront, coplanarBack, front, back) {
            let polygonType = 0;
            const types = [];
            for (const v of polygon.vertices) {
                const t = this.normal.dot(v.pos) - this.w;
                const type = t < -EPSILON ? BACK : (t > EPSILON ? FRONT : COPLANAR);
                polygonType |= type;
                types.push(type);
            }
            switch (polygonType) {
                case COPLANAR:
                    (this.normal.dot(polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
                    break;
                case FRONT: front.push(polygon); break;
                case BACK: back.push(polygon); break;
                case SPANNING: {
                    const f = [], b = [];
                    for (let i = 0; i < polygon.vertices.length; i++) {
                        const j = (i + 1) % polygon.vertices.length;
                        const ti = types[i], tj = types[j];
                        const vi = polygon.vertices[i], vj = polygon.vertices[j];
                        if (ti !== BACK) f.push(vi);
                        if (ti !== FRONT) b.push(ti !== BACK ? vi.clone() : vi);
                        if ((ti | tj) === SPANNING) {
                            const t = (this.w - this.normal.dot(vi.pos)) /
                                this.normal.dot(vj.pos.minus(vi.pos));
                            const v = vi.interpolate(vj, t);
                            f.push(v);
                            b.push(v.clone());
                        }
                    }
                    if (f.length >= 3) front.push(new Polygon(f, polygon.shared));
                    if (b.length >= 3) back.push(new Polygon(b, polygon.shared));
                    break;
                }
            }
        }
    }

    class Polygon {
        constructor(vertices, shared) {
            this.vertices = vertices;
            this.shared = shared;
            this._plane = null;
        }
        clone() { return new Polygon(this.vertices.map(v => v.clone()), this.shared); }
        flip() {
            this.vertices.reverse().forEach(v => v.flip());
            if (this._plane) this._plane.flip();
        }
        get plane() {
            if (!this._plane) {
                this._plane = Plane.fromPoints(
                    this.vertices[0].pos,
                    this.vertices[1].pos,
                    this.vertices[2].pos
                );
            }
            return this._plane;
        }
    }

    class Node {
        constructor(polygons) {
            this.plane = null;
            this.front = null;
            this.back = null;
            this.polygons = [];
            if (polygons) this.build(polygons);
        }
        clone() {
            const n = new Node();
            n.plane = this.plane && this.plane.clone();
            n.front = this.front && this.front.clone();
            n.back = this.back && this.back.clone();
            n.polygons = this.polygons.map(p => p.clone());
            return n;
        }
        invert() {
            for (const p of this.polygons) p.flip();
            if (this.plane) this.plane.flip();
            if (this.front) this.front.invert();
            if (this.back) this.back.invert();
            const temp = this.front; this.front = this.back; this.back = temp;
        }
        clipPolygons(polygons) {
            if (!this.plane) return polygons.slice();
            let front = [], back = [];
            for (const p of polygons) this.plane.splitPolygon(p, front, back, front, back);
            if (this.front) front = this.front.clipPolygons(front);
            back = this.back ? this.back.clipPolygons(back) : [];
            return front.concat(back);
        }
        clipTo(bsp) {
            this.polygons = bsp.clipPolygons(this.polygons);
            if (this.front) this.front.clipTo(bsp);
            if (this.back) this.back.clipTo(bsp);
        }
        allPolygons() {
            let polygons = this.polygons.slice();
            if (this.front) polygons = polygons.concat(this.front.allPolygons());
            if (this.back) polygons = polygons.concat(this.back.allPolygons());
            return polygons;
        }
        build(polygons) {
            if (!polygons.length) return;
            if (!this.plane) this.plane = polygons[0].plane.clone();
            const front = [], back = [];
            for (const p of polygons) {
                this.plane.splitPolygon(p, this.polygons, this.polygons, front, back);
            }
            if (front.length) {
                if (!this.front) this.front = new Node();
                this.front.build(front);
            }
            if (back.length) {
                if (!this.back) this.back = new Node();
                this.back.build(back);
            }
        }
    }

    function subtract(polysA, polysB) {
        const A = new Node(polysA.map(p => p.clone()));
        const B = new Node(polysB.map(p => p.clone()));
        A.invert();
        A.clipTo(B);
        B.clipTo(A);
        B.invert();
        B.clipTo(A);
        B.invert();
        A.build(B.allPolygons());
        A.invert();
        return A.allPolygons();
    }

    global.CSG = { Vector, Vertex, Plane, Polygon, Node, subtract };
})(window);

// ── Three.js ↔ CSG interop ──────────────────────────────────

function meshToCSGPolygons(mesh) {
    mesh.updateMatrixWorld(true);
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const posAttr = geo.attributes.position;
    const normAttr = geo.attributes.normal;
    const matrix = mesh.matrixWorld;
    const nrmMatrix = new THREE.Matrix3().getNormalMatrix(matrix);

    // ★ If the mesh's world matrix has a negative determinant (e.g. mirrored
    //   by a negative scale), triangle winding flips. Swap two vertices per
    //   triangle so the winding stays "CCW seen from outside".
    const flipWinding = matrix.determinant() < 0;

    const polys = [];
    for (let i = 0; i < posAttr.count; i += 3) {
        const order = flipWinding ? [0, 2, 1] : [0, 1, 2];

        const positions = order.map(k => new THREE.Vector3()
            .fromBufferAttribute(posAttr, i + k)
            .applyMatrix4(matrix));

        const normals = normAttr
            ? order.map(k => new THREE.Vector3()
                .fromBufferAttribute(normAttr, i + k)
                .applyMatrix3(nrmMatrix)
                .normalize())
            : null;

        // Face normal computed from the (possibly reordered) positions so it
        // always matches the winding.
        const faceN = new THREE.Vector3()
            .subVectors(positions[1], positions[0])
            .cross(new THREE.Vector3().subVectors(positions[2], positions[0]))
            .normalize();

        const verts = [0, 1, 2].map(j => {
            const n = normals ? normals[j] : faceN;
            return new CSG.Vertex(
                new CSG.Vector(positions[j].x, positions[j].y, positions[j].z),
                new CSG.Vector(n.x, n.y, n.z)
            );
        });
        polys.push(new CSG.Polygon(verts, mesh));
    }
    return polys;
}

function csgPolygonsToGeometry(polys, mesh) {
    mesh.updateMatrixWorld(true);
    const invMatrix = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    const nrmMatrix = new THREE.Matrix3().getNormalMatrix(invMatrix);

    const positions = [];
    const normals = [];

    for (const poly of polys) {
        const vs = poly.vertices;
        for (let i = 2; i < vs.length; i++) {
            const tri = [vs[0], vs[i - 1], vs[i]];
            for (const v of tri) {
                const p = new THREE.Vector3(v.pos.x, v.pos.y, v.pos.z)
                    .applyMatrix4(invMatrix);
                const n = new THREE.Vector3(v.normal.x, v.normal.y, v.normal.z)
                    .applyMatrix3(nrmMatrix).normalize();
                positions.push(p.x, p.y, p.z);
                normals.push(n.x, n.y, n.z);
            }
        }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
}

function isSolidGeometry(geo) {
    if (!geo) return false;
    const t = geo.type;
    if (t === 'RingGeometry' || t === 'PlaneGeometry' || t === 'CircleGeometry') return false;
    return true;
}

// Apply air-block CSG on every mesh in the group (except air markers).
// Also removes the air marker meshes afterwards so they don't render.
function applyAirBlockCSGToGroup(group) {
    const airMeshes = [];
    const solidMeshes = [];
    for (const child of group.children) {
        if (!child.isMesh) continue;
        if (child.userData.isAir) airMeshes.push(child);
        else solidMeshes.push(child);
    }
    if (airMeshes.length === 0) return;

    group.updateMatrixWorld(true);

    const airData = airMeshes.map(air => {
        const bbox = new THREE.Box3().setFromObject(air);
        bbox.expandByScalar(0.03);
        return { polys: meshToCSGPolygons(air), bbox };
    });

    for (const part of solidMeshes) {
        if (!isSolidGeometry(part.geometry)) continue;

        const partBox = new THREE.Box3().setFromObject(part);
        partBox.expandByScalar(0.03);

        const overlapping = airData.filter(a => partBox.intersectsBox(a.bbox));
        if (overlapping.length === 0) continue;

        let polys = meshToCSGPolygons(part);
        for (const air of overlapping) {
            try {
                polys = CSG.subtract(polys, air.polys);
            } catch (e) {
                console.warn('CSG subtract failed on part', part.userData.partKey, e);
            }
        }

        if (polys && polys.length > 0) {
            const newGeo = csgPolygonsToGeometry(polys, part);
            // ★ Recompute face normals — this guarantees consistent outward
            //   shading for the carved surface (avoids the "solid block"
            //   appearance caused by stale / interpolated normals).
            newGeo.computeVertexNormals();
            if (part.geometry.dispose) part.geometry.dispose();
            part.geometry = newGeo;
        } else {
            const empty = new THREE.BufferGeometry();
            empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
            empty.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
            if (part.geometry.dispose) part.geometry.dispose();
            part.geometry = empty;
        }
    }

    // Remove the air markers from the group so they don't draw.
    for (const air of airMeshes) group.remove(air);
}

const _CORES = navigator.hardwareConcurrency || 4;
const _MEM = navigator.deviceMemory || 4;
const IS_LOW_END = IS_MOBILE || _CORES <= 2 || _MEM <= 2;
const USE_SHADOWS = !IS_LOW_END;
const MAX_PIXEL_RATIO = IS_MOBILE ? 1.5 : Math.min(window.devicePixelRatio, 2);
const SHADOW_MAP_SIZE = IS_LOW_END ? 512 : 1024;

// ============================================================
//  THREE.JS INIT
// ============================================================
function initThree() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 12, 35);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(4, 7, 9);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(MAX_PIXEL_RATIO);
    if (USE_SHADOWS) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = IS_MOBILE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    } else {
        renderer.shadowMap.enabled = false;
    }

    document.getElementById('gameCanvas').appendChild(renderer.domElement);

    raycaster = new THREE.Raycaster();
    clock = new THREE.Clock();

    const hemiLight = new THREE.HemisphereLight(0xffeedd, 0x443322, 1.2);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.2);
    dirLight.position.set(5, 15, 8);
    dirLight.castShadow = USE_SHADOWS;
    dirLight.shadow.mapSize.width = SHADOW_MAP_SIZE;
    dirLight.shadow.mapSize.height = SHADOW_MAP_SIZE;
    dirLight.shadow.bias = -0.0001;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x8899cc, 0.5);
    fillLight.position.set(-3, 5, -4);
    scene.add(fillLight);

    isFreeCameraActive = true;
    updateFreeCamButton();

    window.addEventListener('resize', onResize);
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: false });
    renderer.domElement.addEventListener('touchend', onTouchEnd, { passive: false });
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    renderer.domElement.addEventListener('wheel', (event) => {
        if (isFreeCameraActive) {
            event.preventDefault();
            cameraRadius = Math.min(20, Math.max(4, cameraRadius + event.deltaY * 0.01));
        }
    }, { passive: false });

    ghostLineGroup = new THREE.Group();
    scene.add(ghostLineGroup);

    if (!knockbackArrowGroup) {
        knockbackArrowGroup = new THREE.Group();
        scene.add(knockbackArrowGroup);
    }

    animate();
}

function getPiecesInRadius(worldPos, radius) {
    const results = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = gameState.getPiece(r, c);
            if (!p) continue;
            const pos = get3DPosition(r, c, 0);
            const dist = new THREE.Vector3(worldPos.x, 0, worldPos.z).distanceTo(new THREE.Vector3(pos.x, 0, pos.z));
            if (dist < radius) results.push({ r, c, piece: p, dist });
        }
    }
    return results;
}

function updateFreeCamButton() {
    const btn = document.getElementById('freeCamBtn');
    if (isFreeCameraActive) {
        btn.textContent = '📷 自由';
        btn.classList.add('btn-danger');
        btn.classList.remove('btn-secondary');
    } else {
        btn.textContent = '📷 鎖定';
        btn.classList.add('btn-secondary');
        btn.classList.remove('btn-danger');
    }
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    requestAnimationFrame(updateFullscreenBtnPosition);
}

// ============================================================
//  BOARD & PIECES 3D
// ============================================================
function createBoard3D() {
    if (boardGroup) scene.remove(boardGroup);
    boardGroup = new THREE.Group();
    boardSquares = [];
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xd4b896, roughness: 0.4 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.4 });
    for (let r = 0; r < 8; r++) {
        boardSquares[r] = [];
        for (let c = 0; c < 8; c++) {
            const isLight = (r + c) % 2 === 0;
            const geo = getGeo('boardSquare', () => new THREE.BoxGeometry(0.98, 0.1, 0.98));
            const square = new THREE.Mesh(geo, isLight ? lightMat : darkMat);
            square.position.set(c - 3.5, -0.05, 3.5 - r);
            square.receiveShadow = true;
            square.userData = { row: r, col: c, type: 'square' };
            boardGroup.add(square);
            boardSquares[r][c] = square;
        }
    }
    const borderGeo = getGeo('boardBorder', () => new THREE.BoxGeometry(8.6, 0.15, 8.6));
    const borderMat = new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 0.3 });
    const border = new THREE.Mesh(borderGeo, borderMat);
    border.position.set(0, -0.12, 0);
    border.receiveShadow = true;
    boardGroup.add(border);

    const FILES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const labelY = -0.03;
    const labelOffset = 4.25;
    const flipLabels = (playerColor === 'black');

    for (let c = 0; c < 8; c++) {
        const x = c - 3.5;
        const letter = FILES[c];
        const nearLabel = createTextLabel(letter, '#e8c547', 0.40, flipLabels);
        nearLabel.position.set(x, labelY, labelOffset);
        boardGroup.add(nearLabel);
        const farLabel = createTextLabel(letter, '#e8c547', 0.40, flipLabels);
        farLabel.position.set(x, labelY, -labelOffset);
        boardGroup.add(farLabel);
    }
    for (let r = 0; r < 8; r++) {
        const z = 3.5 - r;
        const rankNum = String(r + 1);
        const leftLabel = createTextLabel(rankNum, '#e8c547', 0.40, flipLabels);
        leftLabel.position.set(-labelOffset, labelY, z);
        boardGroup.add(leftLabel);
        const rightLabel = createTextLabel(rankNum, '#e8c547', 0.40, flipLabels);
        rightLabel.position.set(labelOffset, labelY, z);
        boardGroup.add(rightLabel);
    }
    scene.add(boardGroup);
}

function createHealthBarTexture(hp, maxHp) {
    const canvas = document.createElement('canvas');
    canvas.width = 72; canvas.height = 14;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#666'; ctx.lineWidth = 0.5;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
    const ratio = Math.max(0, hp / maxHp);
    const barWidth = Math.max(0, (canvas.width - 4) * ratio);
    const color = ratio > 0.5 ? '#2ecc71' : (ratio > 0.2 ? '#f1c40f' : '#e74c3c');
    ctx.fillStyle = color;
    ctx.fillRect(2, 2, barWidth, canvas.height - 4);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 8px Arial';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 2;
    ctx.fillText(hp, canvas.width - 4, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

function updateHealthBarTexture(sprite, hp, maxHp) {
    if (!sprite || !sprite.material || !sprite.material.map) return;
    const texture = sprite.material.map;
    const canvas = texture.image;
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#666'; ctx.lineWidth = 0.5;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
    const ratio = Math.max(0, hp / maxHp);
    const barWidth = Math.max(0, (canvas.width - 4) * ratio);
    const color = ratio > 0.5 ? '#2ecc71' : (ratio > 0.2 ? '#f1c40f' : '#e74c3c');
    ctx.fillStyle = color;
    ctx.fillRect(2, 2, barWidth, canvas.height - 4);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 8px Arial';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 2;
    ctx.fillText(hp, canvas.width - 4, canvas.height / 2);
    texture.needsUpdate = true;
}

function addHealthBarToModel(model, hp = 100, maxHp = 100) {
    if (hp >= maxHp) return;
    const texture = createHealthBarTexture(hp, maxHp);
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.6, 0.12, 1);
    sprite.position.set(0, 1.15, 0);
    sprite.renderOrder = 999;
    model.add(sprite);
    model.userData.hpSprite = sprite;
}

function createGeometryFromPart(type, params) {
    const key = `part_${type}_${params.radius || 0}_${params.height || 0}_${params.width || 0}_${params.depth || 0}_${params.radiusTop || 0}_${params.radiusBottom || 0}_${params.tube || 0}_${params.innerRadius || 0}_${params.outerRadius || 0}_${params.thetaSegments || 0}_${params.detail || 0}_${params.segments || 0}`;
    return getGeo(key, () => {
        switch (type) {
            case 'box':
                return new THREE.BoxGeometry(params.width || 0.2, params.height || 0.2, params.depth || 0.2);
            case 'sphere':
                return new THREE.SphereGeometry(params.radius || 0.15, 16, 16);
            case 'cylinder':
                return new THREE.CylinderGeometry(params.radiusTop || 0.15, params.radiusBottom || 0.15, params.height || 0.3, 16);
            case 'cone':
                return new THREE.ConeGeometry(params.radius || 0.15, params.height || 0.3, 16);
            case 'torus':
                return new THREE.TorusGeometry(params.radius || 0.15, params.tube || 0.05, 12, 16);
            // ★ 從編輯器同步：圓錐台（上下半徑不同的圓柱）
            case 'frustum':
                return new THREE.CylinderGeometry(
                    params.radiusTop ?? 0.08,
                    params.radiusBottom ?? 0.18,
                    params.height || 0.3,
                    params.segments || 16
                );
            // ★ 從編輯器同步：柏拉圖多面體
            case 'tetrahedron':
                return new THREE.TetrahedronGeometry(params.radius || 0.2, params.detail || 0);
            case 'octahedron':
                return new THREE.OctahedronGeometry(params.radius || 0.2, params.detail || 0);
            case 'dodecahedron':
                return new THREE.DodecahedronGeometry(params.radius || 0.2, params.detail || 0);
            case 'icosahedron':
                return new THREE.IcosahedronGeometry(params.radius || 0.2, params.detail || 0);
            // ★ 從編輯器同步：平面環 / 平面
            case 'ring':
                return new THREE.RingGeometry(
                    params.innerRadius ?? 0.1,
                    params.outerRadius ?? 0.22,
                    params.thetaSegments || 24
                );
            case 'plane':
                return new THREE.PlaneGeometry(params.width || 0.3, params.height || 0.3);
            default:
                return new THREE.BoxGeometry(0.2, 0.2, 0.2);
        }
    });
}

function createTextLabel(text, color = '#e8c547', size = 0.40, flipped = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.font = 'bold 92px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (flipped) {
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(Math.PI);
        ctx.translate(-canvas.width / 2, -canvas.height / 2);
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        ctx.restore();
    } else {
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(size, size);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
}

function createPieceModel(type, color, hp, maxHp, params) {
    const group = new THREE.Group();
    const baseColor = color === 'white' ? 0xf5f0e1 : 0x2a2a2a;
    const accentColor = color === 'white' ? 0xe8dcc8 : 0x3a3a3a;
    const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.25, metalness: 0.2 });
    const matDark = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.3, metalness: 0.15 });
    const p = params || PIECE_PARAMS[type] || {};

    const addMesh = (geo, matUsed, x, y, z, partKey, rot) => {
        // ★ 內建部件可以被「刪除」（以 deleted:true 標記），此時不要生成
        if (p.parts && p.parts[partKey] && p.parts[partKey].deleted) return null;

        const materialClone = matUsed.clone();
        const mesh = new THREE.Mesh(geo, materialClone);
        mesh.position.set(x, y, z);
        if (rot) mesh.rotation.copy(rot);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.origColor = materialClone.color.getHex();
        if (p.parts && p.parts[partKey]) {
            const trans = p.parts[partKey];
            if (trans.position) mesh.position.set(trans.position.x || 0, trans.position.y || 0, trans.position.z || 0);
            if (trans.rotation) mesh.rotation.set(trans.rotation.x || 0, trans.rotation.y || 0, trans.rotation.z || 0);
            if (trans.scale) mesh.scale.set(trans.scale.x || 1, trans.scale.y || 1, trans.scale.z || 1);
        }
        group.add(mesh);
        return mesh;
    };

    const baseRadius = type === 'king' || type === 'queen' ? 0.35 : 0.3;
    addMesh(gCyl(baseRadius, baseRadius * 1.15, 0.12, 16), mat, 0, 0.06, 0, 'base');

    switch (type) {
        case 'pawn': {
            const { baseRadius: br, baseHeight: bh, topRadius: tr, topHeight: th, sphereRadius: sr } = p;
            addMesh(gCyl(br, br * 1.2, bh, 12), mat, 0, 0.06 + bh / 2, 0, 'body');
            addMesh(gCyl(tr * 1.1, tr, th, 12), matDark, 0, 0.06 + bh + th / 2, 0, 'top');
            addMesh(gSph(sr, 12, 12), mat, 0, 0.06 + bh + th + sr * 0.7, 0, 'sphere');
            break;
        }
        case 'rook': {
            const { bodyRadius: br, bodyHeight: bh, crownRadius: cr, crownHeight: ch } = p;
            addMesh(gCyl(br, br * 1.15, bh, 16), mat, 0, 0.06 + bh / 2, 0, 'body');
            addMesh(gCyl(cr, cr * 1.05, ch, 16), matDark, 0, 0.06 + bh + ch / 2, 0, 'crown');
            break;
        }
        case 'knight': {
            const { bodyRadius: br, bodyHeight: bh, neckWidth: nw, neckHeight: nh, neckDepth: nd, headWidth: hw, headHeight: hh, headDepth: hd } = p;
            addMesh(gCyl(br, br * 1.15, bh, 16), mat, 0, 0.06 + bh / 2, 0, 'body');
            addMesh(gBox(nw, nh, nd), mat, 0.05, 0.06 + bh + nh / 2, -0.02, 'neck', new THREE.Euler(-0.3, 0, 0));
            addMesh(gBox(hw, hh, hd), matDark, 0.12, 0.06 + bh + nh + hh / 2 - 0.02, 0.08, 'head', new THREE.Euler(-0.15, 0, 0));
            break;
        }
        case 'bishop': {
            const { bodyRadius: br, bodyHeight: bh, sphereRadius: sr } = p;
            addMesh(gCone(br, bh, 16), mat, 0, 0.06 + bh / 2, 0, 'body');
            addMesh(gSph(sr, 10, 10), matDark, 0, 0.06 + bh + sr * 0.7, 0, 'sphere');
            break;
        }
        case 'queen': {
            const { bodyRadius: br, bodyHeight: bh, crownRadius: cr, crownHeight: ch, spikeRadius: spr } = p;
            addMesh(gCyl(br, br * 1.12, bh, 16), mat, 0, 0.06 + bh / 2, 0, 'body');
            addMesh(gCyl(cr, cr * 1.15, ch, 16), matDark, 0, 0.06 + bh + ch / 2, 0, 'crown');
            addMesh(gSph(spr, 8, 8), matDark, 0, 0.06 + bh + ch + spr * 1.2, 0, 'spike');
            const qCrownBaseY = 0.90;
            const qCrownRadius = 0.11;
            const qSpikeCount = 6;
            const qSpikeRadius = 0.022;
            const qSpikeHeight = 0.075;
            addMesh(gTorus(qCrownRadius, 0.018, 8, 24), matDark, 0, qCrownBaseY, 0, 'qCrownBand', new THREE.Euler(Math.PI / 2, 0, 0));
            for (let i = 0; i < qSpikeCount; i++) {
                const a = (i / qSpikeCount) * Math.PI * 2;
                addMesh(gCone(qSpikeRadius, qSpikeHeight, 6), matDark,
                    Math.cos(a) * qCrownRadius,
                    qCrownBaseY + qSpikeHeight * 0.55,
                    Math.sin(a) * qCrownRadius,
                    'qCrownSpike' + i);
            }
            addMesh(gSph(0.03, 8, 8), matDark, 0, qCrownBaseY + qSpikeHeight + 0.04, 0, 'qCrownTip');
            break;
        }
        case 'king': {
            const { bodyRadius: br, bodyHeight: bh, crownRadius: cr, crownHeight: ch, crossWidth: cw, crossHeight: ch2, crossDepth: cd } = p;
            addMesh(gCyl(br, br * 1.12, bh, 16), mat, 0, 0.06 + bh / 2, 0, 'body');
            addMesh(gCyl(cr, cr * 1.05, ch, 16), matDark, 0, 0.06 + bh + ch / 2, 0, 'crown');
            addMesh(gBox(cw, ch2, cd), matDark, 0, 0.06 + bh + ch + ch2 / 2, 0, 'crossV');
            addMesh(gBox(ch2 * 0.7, ch2 * 0.3, cd * 0.6), matDark, 0, 0.06 + bh + ch + ch2 * 0.75, 0, 'crossH');
            break;
        }
    }

    if (p.parts) {
        for (const [id, partData] of Object.entries(p.parts)) {
            if (['base', 'body', 'neck', 'head', 'top', 'sphere', 'crown', 'spike', 'crossV', 'crossH'].includes(id)) continue;
            // ★ 已刪除的部件 → 跳過
            if (partData.deleted) continue;

            // ★ 挖空塊：加入一個不可見的 marker mesh，讓 CSG 使用。
            //   它本身不繪製，CSG 運算完成後會被移除。
            if (partData.type === 'air') {
                const gp = partData.geometryParams || {};
                const airGeo = new THREE.BoxGeometry(
                    gp.width || 0.3,
                    gp.height || 0.3,
                    gp.depth || 0.3
                );
                const airMesh = new THREE.Mesh(
                    airGeo,
                    new THREE.MeshBasicMaterial({ visible: false })
                );
                airMesh.position.set(partData.position?.x || 0, partData.position?.y || 0, partData.position?.z || 0);
                airMesh.rotation.set(partData.rotation?.x || 0, partData.rotation?.y || 0, partData.rotation?.z || 0);
                airMesh.scale.set(partData.scale?.x || 1, partData.scale?.y || 1, partData.scale?.z || 1);
                airMesh.visible = false;               // never rendered
                airMesh.castShadow = false;
                airMesh.receiveShadow = false;
                airMesh.userData.isAir = true;
                airMesh.userData.partKey = id;
                group.add(airMesh);
                continue;
            }

            const geo = createGeometryFromPart(partData.type, partData.geometryParams || {});
            let partColor;
            if (!partData.color || partData.color === 'piece') partColor = baseColor;
            else if (partData.color === 'accent') partColor = accentColor;
            else partColor = partData.color;
            const partMat = new THREE.MeshStandardMaterial({
                color: partColor,
                roughness: partData.roughness ?? 0.5,
                metalness: partData.metalness ?? 0.2,
            });
            const mesh = new THREE.Mesh(geo, partMat);
            mesh.position.set(partData.position?.x || 0, partData.position?.y || 0, partData.position?.z || 0);
            mesh.rotation.set(partData.rotation?.x || 0, partData.rotation?.y || 0, partData.rotation?.z || 0);
            mesh.scale.set(partData.scale?.x || 1, partData.scale?.y || 1, partData.scale?.z || 1);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.isCustom = true;
            mesh.userData.origColor = partMat.color.getHex();
            group.add(mesh);
        }
    }

    // ★ 若存在挖空塊，對整個棋子套用 CSG 減法
    //   注意：必須在 addHealthBarToModel 之前、且未旋轉棋盤之前執行
    if (group.children.some(c => c.userData && c.userData.isAir)) {
        try {
            applyAirBlockCSGToGroup(group);
        } catch (e) {
            console.warn('Air block CSG failed for', type, e);
        }
    }

    addHealthBarToModel(group, hp, maxHp);

    if (type === 'knight' || type === 'king') {
        if (color === 'white') group.rotation.y = Math.PI;
        if (color === 'black') group.rotation.y = 0;
    }

    return group;
}

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

function createPieces3D() {
    clearSelectionAura();

    if (piecesGroup) scene.remove(piecesGroup);
    piecesGroup = new THREE.Group();
    pieceObjects = {};
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = gameState.getPiece(r, c);
            if (piece) {
                const params = PIECE_PARAMS[piece.type] || {};
                const obj = createPieceModel(piece.type, piece.color, piece.hp, piece.maxHp, params);
                obj.position.set(c - 3.5, 0, 3.5 - r);
                obj.userData = {
                    row: r, col: c, type: 'piece', color: piece.color,
                    baseScale: new THREE.Vector3(1, 1, 1)
                };
                // ★ 冷卻中 → 在棋子右上角顯示剩餘回合 (respect user preference)
                if (gameSettings.showCooldownNumbers) {
                    const cd = piece.skillCooldown || 0;
                    if (cd > 0) {
                        const cdSprite = createCooldownSprite(cd);
                        obj.add(cdSprite);
                        obj.userData.cooldownSprite = cdSprite;
                    }
                }
                // ★ 皇后復活冷卻（紫色，另一側）
                const cdRev = piece.reviveCooldown || 0;
                if (cdRev > 0) {
                    const revSprite = createCooldownSprite(cdRev, 0xc38bff);
                    revSprite.position.set(-0.32, 0.95, 0);
                    obj.add(revSprite);
                    obj.userData.reviveCooldownSprite = revSprite;
                }
                piecesGroup.add(obj);

                // ★ 國王 — 領域展開冷卻
                //   The king uses kingSkillState (uses / lastUsedMove) instead of
                //   the generic skillCooldown field. Show a sprite while the domain
                //   is recharging, and a "no uses left" badge once exhausted.
                if (piece.type === 'king' && typeof kingSkillState !== 'undefined') {
                    const movesSince = gameState.fullMoveNumber - kingSkillState.lastUsedMove[piece.color];
                    const domainCd = Math.max(0, KING_DOMAIN_COOLDOWN - movesSince);
                    const usesLeft = kingSkillState.uses[piece.color];

                    if (domainCd > 0) {
                        const cdSprite = createCooldownSprite(domainCd, 0xd9a6ff); // purple
                        obj.add(cdSprite);
                        obj.userData.cooldownSprite = cdSprite;
                    } else if (usesLeft <= 0) {
                        // 3 uses used up — grey "0" badge on the same slot
                        const cdSprite = createCooldownSprite(0, 0x666666);
                        obj.add(cdSprite);
                        obj.userData.cooldownSprite = cdSprite;
                    }
                }

                pieceObjects[`${r},${c}`] = obj;
                updateHealthVisuals(r, c, piece.hp, piece.maxHp);
            }
        }
    }
    scene.add(piecesGroup);
    if (!highlightsGroup) {
        highlightsGroup = new THREE.Group();
        scene.add(highlightsGroup);
    }
}

function updateHealthVisuals(row, col, hp, maxHp) {
    const pieceObj = pieceObjects[`${row},${col}`];
    if (pieceObj && pieceObj.userData.hpSprite) {
        const sprite = pieceObj.userData.hpSprite;
        if (hp >= maxHp) sprite.visible = false;
        else {
            sprite.visible = true;
            updateHealthBarTexture(sprite, hp, maxHp);
        }
    }
}

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

// ============================================================
//  ★ Queen speech bubble — a small message pops above the queen
// ============================================================
function showQueenSpeech(row, col, text, duration = 2400) {
    if (!camera || !renderer) return;

    // Anchor the bubble a bit above the queen's head
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

    // ★ Speak the line at the same moment the bubble appears
    speakQueenLine(text);

    // Animate in on the next frame (so transition fires)
    requestAnimationFrame(() => bubble.classList.add('visible'));

    // Keep the bubble glued to the queen while the camera may still be easing
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

    // Fade out and remove
    setTimeout(() => {
        bubble.classList.remove('visible');
        bubble.classList.add('fading');
        if (rafId) cancelAnimationFrame(rafId);
        setTimeout(() => {
            if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
        }, 420);
    }, duration);
}

function get3DPosition(r, c, yOffset = 0) {
    return new THREE.Vector3(c - 3.5, yOffset, 3.5 - r);
}

function isWithinCannonRange(fromR, fromC, toR, toC) {
    const a = get3DPosition(fromR, fromC, 0);
    const b = get3DPosition(toR, toC, 0);
    return a.distanceTo(b) <= CANNON_RANGE + 1e-6;
}

function showCannonRange(row, col) {
    hideCannonRange();
    if (!scene) return;
    const g = new THREE.Group();
    g.position.set(col - 3.5, 0.07, 3.5 - row);
    const edge = new THREE.Mesh(
        new THREE.RingGeometry(CANNON_RANGE - 0.07, CANNON_RANGE, 96),
        new THREE.MeshBasicMaterial({ color: 0xff2b2b, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    edge.rotation.x = -Math.PI / 2;
    g.add(edge);
    const glow = new THREE.Mesh(
        new THREE.RingGeometry(CANNON_RANGE - 0.28, CANNON_RANGE - 0.07, 96),
        new THREE.MeshBasicMaterial({ color: 0xff2b2b, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.004;
    g.add(glow);
    scene.add(g);
    cannonRangeGroup = g;
}

function hideCannonRange() {
    if (!cannonRangeGroup) return;
    if (scene) scene.remove(cannonRangeGroup);
    cannonRangeGroup.traverse(n => { if (n.material) n.material.dispose(); });
    cannonRangeGroup = null;
}

// ============================================================
//  HIGHLIGHTS
// ============================================================
function showValidMoveHighlights(moves, selectedR, selectedC) {
    clearHighlights();
    const dotMat = new THREE.MeshBasicMaterial({
        color: 0x2ecc71, transparent: true, opacity: 0.55,
        depthWrite: false, side: THREE.DoubleSide,
    });
    const capMat = new THREE.MeshBasicMaterial({
        color: 0xe74c3c, transparent: true, opacity: 0.55,
        depthWrite: false, side: THREE.DoubleSide,
    });

    // ★ Nearly the full grid square (board cells are 0.98 wide, so 0.9
    //   leaves a thin visual gap but is far easier to click/tap).
    const SQUARE_SIZE = 0.9;

    moves.forEach(m => {
        const isCapture = m.capture;
        const mat = isCapture ? capMat : dotMat;

        // ★ Flat square covering the whole cell — replaces the small
        //   circle (cylinder) and thin torus ring.
        const geo = new THREE.PlaneGeometry(SQUARE_SIZE, SQUARE_SIZE);
        const highlight = new THREE.Mesh(geo, mat);
        highlight.rotation.x = -Math.PI / 2;               // lay flat on board
        highlight.position.set(m.c - 3.5, 0.04, 3.5 - m.r); // just above squares
        highlight.userData = { row: m.r, col: m.c, type: 'highlight' };
        highlightsGroup.add(highlight);
    });
    const selMat = new THREE.MeshBasicMaterial({ color: 0xe8c547, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const selRing = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 32, 1, true), selMat);
    selRing.position.set(selectedC - 3.5, 0.03, 3.5 - selectedR);
    highlightsGroup.add(selRing);
}

// ============================================================
//  ★ Domain Expansion — glowing outline on the involved pieces
// ============================================================
function buildDomainGlowOutline(targetObj, color, thickness = 1.10) {
    const added = [];
    if (!targetObj) return added;
    targetObj.traverse(n => {
        if (!n.isMesh) return;
        if (n.userData.isAir) return;
        if (!n.geometry) return;
        // Skip invisible meshes (e.g. health-bar sprite proxies)
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
        // Same local transform as the source mesh, just slightly bigger.
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
        // NOTE: geometry is shared with the source mesh → do NOT dispose it.
    }
    outlines.length = 0;
}

function showAbilityHighlights(targets, selectedR, selectedC) {
    clearHighlights();
    const caster = gameState.getPiece(selectedR, selectedC);
    const casterType = caster ? caster.type : null;
    const pulseMeshes = [];

    const makePulse = (geo, color, minOp, maxOp, y, x = 0, z = 0) => {
        const mat = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: (minOp + maxOp) / 2,
            depthWrite: false, side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, y, z);
        mesh.userData.minOpacity = minOp;
        mesh.userData.maxOpacity = maxOp;
        pulseMeshes.push(mesh);
        return mesh;
    };

    const makeHitPlate = (x, z) => {
        const plate = new THREE.Mesh(
            new THREE.PlaneGeometry(0.95, 0.95),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
        );
        plate.rotation.x = -Math.PI / 2;
        plate.position.set(x, 0.05, z);
        return plate;
    };

    for (const target of targets) {
        const abilityId = target.ability && target.ability.id;
        const isHeal = abilityId === 'heal';
        const isRevive = abilityId === 'revive';
        const mainColor = isHeal ? 0x2ecc71 : (isRevive ? 0xb06cff : 0xe8c547);
        const ringColor = isHeal ? 0xa8ffcc : (isRevive ? 0xe0b3ff : 0xe8c547);

        const zone = new THREE.Group();
        zone.position.set(target.c - 3.5, 0, 3.5 - target.r);
        zone.userData = {
            row: target.r, col: target.c, type: 'ability-target',
            abilityId: abilityId || null,
        };

        zone.add(makePulse(new THREE.CircleGeometry(0.44, 24), mainColor, 0.25, 0.55, 0.032));
        zone.add(makePulse(new THREE.RingGeometry(0.40, 0.46, 24), ringColor, 0.65, 1.00, 0.040));

        if (isHeal || isRevive) {
            // 地上的十字標記
            zone.add(makePulse(new THREE.PlaneGeometry(0.13, 0.50), 0xffffff, 0.45, 0.85, 0.044));
            zone.add(makePulse(new THREE.PlaneGeometry(0.50, 0.13), 0xffffff, 0.45, 0.85, 0.045));
        }

        if (casterType === 'pawn') {
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dr, dc] of dirs) {
                const nr = target.r + dr;
                const nc = target.c + dc;
                if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
                const offX = dc;
                const offZ = -dr;
                zone.add(makePulse(new THREE.CircleGeometry(0.44, 24), 0xff2200, 0.30, 0.60, 0.033, offX, offZ));
                zone.add(makePulse(new THREE.RingGeometry(0.40, 0.46, 24), 0xff6600, 0.65, 1.00, 0.041, offX, offZ));
                const isAlongZ = (dc === 0);
                const beamGeo = isAlongZ
                    ? new THREE.PlaneGeometry(0.30, 1.00)
                    : new THREE.PlaneGeometry(1.00, 0.30);
                zone.add(makePulse(beamGeo, 0xff3300, 0.45, 0.85, 0.044, offX / 2, offZ / 2));
                zone.add(makeHitPlate(offX, offZ));
            }
            zone.add(makePulse(new THREE.CircleGeometry(0.16, 20), 0xff8800, 0.70, 1.00, 0.046));
        }
        zone.add(makeHitPlate(0, 0));
        highlightsGroup.add(zone);
    }

    const selRing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.45, 0.06, 32, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xe8c547, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    selRing.position.set(selectedC - 3.5, 0.03, 3.5 - selectedR);
    highlightsGroup.add(selRing);
    highlightsGroup.userData.pulseMeshes = pulseMeshes;
}

function clearHighlights() {
    if (!highlightsGroup) return;
    highlightsGroup.userData.pulseMeshes = null;
    while (highlightsGroup.children.length > 0) {
        const child = highlightsGroup.children[0];
        highlightsGroup.remove(child);
        child.traverse(node => {
            if (node.material) {
                if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
                else node.material.dispose();
            }
        });
    }
}

// ★ 騎士技能視覺：Step 1 落點
function showKnightLandingHighlights(landings, fromR, fromC) {
    clearHighlights();
    const pulseMeshes = [];
    for (const m of landings) {
        const zone = new THREE.Group();
        zone.position.set(m.c - 3.5, 0, 3.5 - m.r);
        zone.userData = { row: m.r, col: m.c, type: 'knight-landing' };

        const circle = new THREE.Mesh(
            new THREE.CircleGeometry(0.44, 24),
            new THREE.MeshBasicMaterial({ color: 0xe8c547, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide })
        );
        circle.rotation.x = -Math.PI / 2;
        circle.position.y = 0.033;
        circle.userData.minOpacity = 0.2;
        circle.userData.maxOpacity = 0.55;
        zone.add(circle);
        pulseMeshes.push(circle);

        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.40, 0.46, 24),
            new THREE.MeshBasicMaterial({ color: 0xe8c547, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.041;
        ring.userData.minOpacity = 0.6;
        ring.userData.maxOpacity = 1.0;
        zone.add(ring);
        pulseMeshes.push(ring);

        const plate = new THREE.Mesh(
            new THREE.PlaneGeometry(0.98, 0.98),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
        );
        plate.rotation.x = -Math.PI / 2;
        plate.position.y = 0.05;
        zone.add(plate);
        highlightsGroup.add(zone);
    }
    const selRing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.45, 0.06, 32, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xe8c547, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    selRing.position.set(fromC - 3.5, 0.03, 3.5 - fromR);
    highlightsGroup.add(selRing);
    highlightsGroup.userData.pulseMeshes = pulseMeshes;
}

// ★ 騎士技能視覺：Step 2 可擊退目標
function showKnightVictimHighlights(victims, landingR, landingC, fromR, fromC, selectedVictim) {
    clearHighlights();
    const pulseMeshes = [];

    const landGroup = new THREE.Group();
    landGroup.position.set(landingC - 3.5, 0, 3.5 - landingR);
    const landRing = new THREE.Mesh(
        new THREE.RingGeometry(0.40, 0.46, 24),
        new THREE.MeshBasicMaterial({ color: 0xe8c547, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })
    );
    landRing.rotation.x = -Math.PI / 2;
    landRing.position.y = 0.04;
    landGroup.add(landRing);
    highlightsGroup.add(landGroup);

    for (const v of victims) {
        const isSelected = selectedVictim && selectedVictim.r === v.r && selectedVictim.c === v.c;
        const zone = new THREE.Group();
        zone.position.set(v.c - 3.5, 0, 3.5 - v.r);
        zone.userData = { row: v.r, col: v.c, type: 'knight-victim' };

        const circle = new THREE.Mesh(
            new THREE.CircleGeometry(0.44, 24),
            new THREE.MeshBasicMaterial({
                color: isSelected ? 0xff5500 : 0xff2200,
                transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide
            })
        );
        circle.rotation.x = -Math.PI / 2;
        circle.position.y = 0.033;
        circle.userData.minOpacity = 0.25;
        circle.userData.maxOpacity = 0.55;
        zone.add(circle);
        pulseMeshes.push(circle);

        const hoverRing = new THREE.Mesh(
            new THREE.TorusGeometry(0.5, 0.055, 8, 32),
            new THREE.MeshBasicMaterial({
                color: isSelected ? 0xffcc00 : 0xff4400,
                transparent: true, opacity: 0.9, depthWrite: false
            })
        );
        hoverRing.rotation.x = Math.PI / 2;
        hoverRing.position.y = isSelected ? 0.75 : 0.55;
        hoverRing.userData.minOpacity = 0.55;
        hoverRing.userData.maxOpacity = 1.0;
        zone.add(hoverRing);
        pulseMeshes.push(hoverRing);

        const plate = new THREE.Mesh(
            new THREE.PlaneGeometry(1.0, 1.0),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
        );
        plate.rotation.x = -Math.PI / 2;
        plate.position.y = 0.05;
        zone.add(plate);
        highlightsGroup.add(zone);
    }
    highlightsGroup.userData.pulseMeshes = pulseMeshes;
}

// ============================================================
//  AIMING SYSTEM
// ============================================================
function getFreeAimPosition(clientX, clientY) {
    mouse.x = (clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersectPoint = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(plane, intersectPoint);
    if (!hit) return null;
    const x = intersectPoint.x;
    const z = intersectPoint.z;
    if (x < -4.5 || x > 4.5 || z < -4.5 || z > 4.5) return null;
    let targetPiece = null;
    let targetRow = -1, targetCol = -1;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = gameState.getPiece(r, c);
            if (!p) continue;
            const pos = get3DPosition(r, c, 0);
            const dist = new THREE.Vector3(x, 0, z).distanceTo(new THREE.Vector3(pos.x, 0, pos.z));
            if (dist < TARGET_RADIUS) { targetPiece = p; targetRow = r; targetCol = c; break; }
        }
        if (targetPiece) break;
    }
    return { position: intersectPoint.clone(), targetPiece, targetRow, targetCol, isValid: true };
}

function createGhostLine() {
    if (ghostLine) {
        ghostLineGroup.remove(ghostLine);
        ghostLine.geometry.dispose();
        ghostLine.material.dispose();
    }
    const points = [];
    for (let i = 0; i <= 50; i++) points.push(new THREE.Vector3(0, 0, 0));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.9, linewidth: 2 });
    ghostLine = new THREE.Line(geometry, material);
    ghostLine.frustumCulled = false;
    ghostLineGroup.add(ghostLine);

    const ringGeo = new THREE.RingGeometry(0.5, TARGET_RADIUS, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.visible = false;
    ghostLineGroup.add(ring);
    ghostLine.userData.ring = ring;

    const glowRingGeo = new THREE.RingGeometry(0.2, 0.5, 32);
    const glowRingMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    const glowRing = new THREE.Mesh(glowRingGeo, glowRingMat);
    glowRing.rotation.x = -Math.PI / 2;
    glowRing.position.y = 0.025;
    glowRing.visible = false;
    ghostLineGroup.add(glowRing);
    ghostLine.userData.glowRing = glowRing;

    const vLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.4, 0)]);
    const vLineMat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.3 });
    const vLine = new THREE.Line(vLineGeo, vLineMat);
    vLine.visible = false;
    ghostLineGroup.add(vLine);
    ghostLine.userData.vLine = vLine;

    const blastGeo = new THREE.CircleGeometry(TARGET_RADIUS, 32);
    const blastMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.15, depthWrite: false, side: THREE.DoubleSide });
    const blastDisc = new THREE.Mesh(blastGeo, blastMat);
    blastDisc.rotation.x = -Math.PI / 2;
    blastDisc.position.y = 0.016;
    blastDisc.visible = false;
    ghostLineGroup.add(blastDisc);
    ghostLine.userData.blastDisc = blastDisc;

    return ghostLine;
}

function setPieceHitEffect(row, col, active) {
    const key = `${row},${col}`;
    const pieceObj = pieceObjects[key];
    if (!pieceObj) return;
    pieceObj.traverse(child => {
        if (child.isMesh && child !== pieceObj.userData.hpSprite) {
            if (!child.userData.origColor) child.userData.origColor = child.material.color.getHex();
            if (active) {
                child.material.color.setHex(0xff3333);
                if (child.material.emissive) {
                    child.material.emissive.setHex(0xff0000);
                    child.material.emissiveIntensity = 0.6;
                }
            } else {
                child.material.color.setHex(child.userData.origColor);
                if (child.material.emissive) {
                    child.material.emissive.setHex(0x000000);
                    child.material.emissiveIntensity = 0;
                }
            }
        }
    });
}

function updateAimTarget(worldPos) {
    if (!isAiming || !selectedPiece) return;
    const startPos = get3DPosition(selectedPiece.row, selectedPiece.col, 0.6);
    const endPos = worldPos.clone();
    endPos.y = 0.05;
    const inBoard = worldPos.x >= -4.5 && worldPos.x <= 4.5 && worldPos.z >= -4.5 && worldPos.z <= 4.5;
    const casterPos = get3DPosition(selectedPiece.row, selectedPiece.col, 0);
    const distFromCaster = Math.hypot(worldPos.x - casterPos.x, worldPos.z - casterPos.z);
    const inRange = distFromCaster <= CANNON_RANGE;
    const rawTargets = (inBoard && inRange) ? getPiecesInRadius(worldPos, TARGET_RADIUS) : [];
    const newTargets = rawTargets.filter(t => isWithinCannonRange(selectedPiece.row, selectedPiece.col, t.r, t.c));
    const newTargetKeys = new Set(newTargets.map(t => `${t.r},${t.c}`));
    for (const key of lastAimedPieceKeys) {
        if (!newTargetKeys.has(key)) {
            const [r, c] = key.split(',').map(Number);
            setPieceHitEffect(r, c, false);
        }
    }
    for (const key of newTargetKeys) {
        if (!lastAimedPieceKeys.has(key)) {
            const [r, c] = key.split(',').map(Number);
            setPieceHitEffect(r, c, true);
        }
    }
    lastAimedPieceKeys = newTargetKeys;
    aimTargetPiece = newTargets.length > 0 ? newTargets[0].piece : null;
    const canFire = inBoard && inRange;
    const hasHit = newTargets.length > 0;
    aimValid = canFire;
    aimWorldPos = worldPos.clone();
    updateGhostLine(startPos, endPos, canFire, hasHit);
}

function updateGhostLine(startPos, endPos, canFire, hasHit) {
    if (!ghostLine) createGhostLine();
    const positions = ghostLine.geometry.attributes.position.array;
    const segments = 50;
    const heightScale = 2.5;
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const x = startPos.x + (endPos.x - startPos.x) * t;
        const z = startPos.z + (endPos.z - startPos.z) * t;
        const y = startPos.y + (endPos.y - startPos.y) * t + Math.sin(t * Math.PI) * heightScale;
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
    }
    ghostLine.geometry.attributes.position.needsUpdate = true;
    ghostLine.geometry.setDrawRange(0, segments + 1);
    let color, opacity;
    if (!canFire) { color = 0xff4444; opacity = 0.5; }
    else if (hasHit) { color = 0x00ff88; opacity = 0.9; }
    else { color = 0xffaa00; opacity = 0.9; }
    ghostLine.material.color.setHex(color);
    ghostLine.material.opacity = opacity;
    ghostLine.visible = true;
    const ring = ghostLine.userData.ring;
    const glowRing = ghostLine.userData.glowRing;
    const vLine = ghostLine.userData.vLine;
    const blastDisc = ghostLine.userData.blastDisc;
    if (ring) { ring.position.x = endPos.x; ring.position.z = endPos.z; ring.material.color.setHex(color); ring.visible = true; }
    if (glowRing) { glowRing.position.x = endPos.x; glowRing.position.z = endPos.z; glowRing.material.color.setHex(color); glowRing.visible = true; }
    if (vLine) { vLine.position.x = endPos.x; vLine.position.z = endPos.z; vLine.material.color.setHex(color); vLine.visible = canFire; }
    if (blastDisc) { blastDisc.position.x = endPos.x; blastDisc.position.z = endPos.z; blastDisc.material.color.setHex(color); blastDisc.visible = true; }
}

function hideGhostLine() {
    for (const key of lastAimedPieceKeys) {
        const [r, c] = key.split(',').map(Number);
        setPieceHitEffect(r, c, false);
    }
    lastAimedPieceKeys.clear();
    if (ghostLine) {
        ghostLine.visible = false;
        if (ghostLine.userData.ring) ghostLine.userData.ring.visible = false;
        if (ghostLine.userData.glowRing) ghostLine.userData.glowRing.visible = false;
        if (ghostLine.userData.vLine) ghostLine.userData.vLine.visible = false;
        if (ghostLine.userData.blastDisc) ghostLine.userData.blastDisc.visible = false;
    }
}

function clearGhostLine() {
    for (const key of lastAimedPieceKeys) {
        const [r, c] = key.split(',').map(Number);
        setPieceHitEffect(r, c, false);
    }
    lastAimedPieceKeys.clear();
    if (ghostLine) {
        ghostLineGroup.remove(ghostLine);
        ghostLine.geometry.dispose();
        ghostLine.material.dispose();
        ghostLine = null;
    }
    while (ghostLineGroup.children.length > 0) {
        const child = ghostLineGroup.children[0];
        ghostLineGroup.remove(child);
        if (child.material) child.material.dispose();
    }
}

// ============================================================
//  ★ 騎士擊退技能 — 三步驟流程
// ============================================================
function enterKnightAbilityMode() {
    if (!selectedPiece) return;
    const fromR = selectedPiece.row;
    const fromC = selectedPiece.col;
    const landings = getKnightPushLandings(gameState, fromR, fromC);

    if (landings.length === 0) { cancelKnightAbilityMode(); return; }

    knightAbilityActive = true;
    knightAbilityState = {
        fromR, fromC,
        landingR: null, landingC: null,
        victims: [],
        selectedVictim: null
    };

    clearHighlights();
    hideCannonRange();
    hideKnockbackArrows();

    const hint = document.getElementById('aimHint');
    hint.innerHTML = '🐴 <b>步驟 1/3</b>：選擇騎士要跳到的格子<br><span style="opacity:0.75;font-size:0.85rem;">只顯示 3×3 內有敵方棋子可被擊退的落點</span>';
    hint.classList.add('visible');

    showKnightLandingHighlights(landings, fromR, fromC);
}

function cancelKnightAbilityMode() {
    knightAbilityActive = false;
    knightAbilityState = null;
    hideKnockbackArrows();
    document.getElementById('aimHint').classList.remove('visible');

    actionMode = 'move';
    clearSelectionAura();
    if (selectedPiece) {
        const hasAbility = pieceHasAbility(selectedPiece.piece);
        if (hasAbility) {
            const cooldown = selectedPiece.piece.skillCooldown || 0;
            updateActionBar(true, abilityTargets.length > 0, cooldown);
        }
        showValidMoveHighlights(validMoves, selectedPiece.row, selectedPiece.col);
    }
    updateActionButtonStates();
}

// Step 1 → Step 2
function selectKnightLanding(row, col) {
    if (!selectedPiece || !knightAbilityState) return;
    const fromR = knightAbilityState.fromR;
    const fromC = knightAbilityState.fromC;
    const casterColor = selectedPiece.piece.color;

    const victims = getPushableVictims(gameState, row, col, fromR, fromC, casterColor);
    if (victims.length === 0) return;

    knightAbilityState.landingR = row;
    knightAbilityState.landingC = col;
    knightAbilityState.victims = victims;
    knightAbilityState.selectedVictim = null;

    hideKnockbackArrows();
    showKnightVictimHighlights(victims, row, col, fromR, fromC, null);

    const hint = document.getElementById('aimHint');
    hint.innerHTML = '🎯 <b>步驟 2/3</b>：點擊要擊退的敵方棋子<br><span style="opacity:0.75;font-size:0.85rem;">紅色光環標示可被擊退的目標</span>';
}

// Step 2 → Step 3
function selectKnightVictim(row, col) {
    if (!knightAbilityState) return;
    const victim = knightAbilityState.victims.find(v => v.r === row && v.c === col);
    if (!victim) return;

    knightAbilityState.selectedVictim = victim;

    showKnightVictimHighlights(
        knightAbilityState.victims,
        knightAbilityState.landingR,
        knightAbilityState.landingC,
        knightAbilityState.fromR,
        knightAbilityState.fromC,
        victim
    );

    showKnockbackArrows(victim);

    const hint = document.getElementById('aimHint');
    hint.innerHTML = '🏹 <b>步驟 3/3</b>：點擊箭頭選擇擊退方向<br>' +
        '<span style="opacity:0.75;font-size:0.85rem;">' +
        '🟠 一般擊退 · 🔴 目標被阻擋（棋子彈回，障礙方 -25 HP）' +
        '</span>';
}

// ============================================================
//  ARROW VISUALS
// ============================================================
function showKnockbackArrows(victim) {
    hideKnockbackArrows();
    if (!knockbackArrowGroup) {
        knockbackArrowGroup = new THREE.Group();
        scene.add(knockbackArrowGroup);
    }
    for (const dir of victim.directions) {
        const opt = {
            r: victim.r,
            c: victim.c,
            dirR: dir.dirR,
            dirC: dir.dirC,
            targetR: dir.targetR,
            targetC: dir.targetC,
            blocked: !!dir.blocked,
            blocker: dir.blocker || null
        };
        knockbackArrowGroup.add(createKnockbackArrow(opt));
    }
}

function hideKnockbackArrows() {
    if (!knockbackArrowGroup) return;
    while (knockbackArrowGroup.children.length > 0) {
        const child = knockbackArrowGroup.children[0];
        knockbackArrowGroup.remove(child);
        child.traverse(n => {
            if (n.geometry) n.geometry.dispose();
            if (n.material) n.material.dispose();
        });
    }
}

function createKnockbackArrow(opt) {
    const group = new THREE.Group();

    const pushWorld = new THREE.Vector3(opt.dirC, 0, -opt.dirR).normalize().multiplyScalar(0.28);
    const basePos = get3DPosition(opt.r, opt.c, 0.55).add(pushWorld);
    group.position.copy(basePos);
    group.userData.basePos = basePos.clone();

    const dir = new THREE.Vector3(opt.dirC, 0.35, -opt.dirR).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    group.quaternion.setFromUnitVectors(up, dir);

    const shaftColor = opt.blocked ? 0xff2b2b : 0xff8800;
    const headColor = opt.blocked ? 0xff6644 : 0xffcc00;
    const tailColor = opt.blocked ? 0xaa1100 : 0xff4400;

    const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.45, 8),
        new THREE.MeshBasicMaterial({ color: shaftColor, depthWrite: false, transparent: true, opacity: 0.95 })
    );
    shaft.position.y = 0.32;
    group.add(shaft);

    const head = new THREE.Mesh(
        new THREE.ConeGeometry(0.13, 0.26, 12),
        new THREE.MeshBasicMaterial({ color: headColor, depthWrite: false, transparent: true, opacity: 0.95 })
    );
    head.position.y = 0.65;
    group.add(head);

    const tail = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 8),
        new THREE.MeshBasicMaterial({ color: tailColor, depthWrite: false, transparent: true, opacity: 0.9 })
    );
    tail.position.y = 0.05;
    group.add(tail);

    const hit = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 8, 8),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hit.position.y = 0.5;
    group.add(hit);

    const meta = { type: 'knockback-arrow', option: opt };
    group.userData = Object.assign(group.userData, meta);
    shaft.userData = meta;
    head.userData = meta;
    tail.userData = meta;
    hit.userData = meta;

    return group;
}

// ============================================================
//  ★ 擊退動畫
// ============================================================
function animateVictimPush(fromR, fromC, toR, toC, onComplete) {
    const obj = pieceObjects[`${fromR},${fromC}`];
    if (!obj) { onComplete(); return; }
    const startPos = obj.position.clone();
    const targetPos = get3DPosition(toR, toC, 0);
    const duration = 0.25;                 // slightly longer for the trail
    const startTime = clock.getElapsedTime();
    let lastSparkTime = 0;

    // Save the original orientation so the tumble is purely cosmetic
    const baseRotY = obj.rotation.y;
    const baseRotZ = obj.rotation.z;

    const animate = () => {
        const now = clock.getElapsedTime();
        const t = Math.min((now - startTime) / duration, 1);
        const ease = x => x * (2 - x);
        obj.position.lerpVectors(startPos, targetPos, ease(t));

        // ★ Arc + tumble
        obj.position.y = Math.sin(t * Math.PI) * 0.25;
        obj.rotation.y = baseRotY + t * Math.PI * 1.2;
        obj.rotation.z = baseRotZ + Math.sin(t * Math.PI * 2) * 0.30;

        // ★ Hot spark trail behind the victim
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

        // ★ Slight recoil tumble
        obj.rotation.z = baseRotZ + Math.sin(t * Math.PI) * 0.32 * rotDir;

        // ★ Red-tinted sparks fly off the bump
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

// ============================================================
//  ★ 騎士衝刺旋風特效 (Spiral Drill Dash)
// ============================================================
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

// ============================================================
//  ★ KNIGHT CHARGE EFFECT — rune ring + inward spiral particles
//    Plays during the wind-up before the dash. Leaves the piece
//    in place, purely a visual "gathering energy" beat.
// ============================================================
function spawnKnightChargeEffect(pieceObj, duration) {
    if (!pieceObj || !scene) return;

    const anchor = pieceObj.position.clone();
    const group = new THREE.Group();
    group.position.set(anchor.x, 0, anchor.z);
    scene.add(group);

    // ── Outer rune ring (icy blue) ──
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xb8ecff, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.38, 44), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    group.add(ring);

    // ── Inner ring (white) ──
    const ring2Mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.48, 44), ring2Mat);
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.y = 0.045;
    group.add(ring2);

    // ── Spiral charge particles (converge inward) ──
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

        // Rings: fade in, gentle pulse
        ringMat.opacity = Math.min(1, k * 2.2) * 0.85 * (0.6 + 0.4 * Math.sin(t * 14)) * fadeOut;
        ring2Mat.opacity = Math.min(1, k * 2.2) * 0.65 * (0.6 + 0.4 * Math.sin(t * 10 + 1)) * fadeOut;
        ring.scale.setScalar(1 + Math.sin(t * 10) * 0.12);
        ring2.scale.setScalar(1 + Math.sin(t * 8 + 1) * 0.15);

        // Particles spiral inward
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

// ============================================================
//  ★ KNIGHT IMPACT EFFECT — landing shockwave + dust + flash
//    Fires at the moment the knight touches down. Themed in
//    ice-blue (matching the knight identity) with warm dust.
// ============================================================
function spawnKnightImpactEffect(row, col, color) {
    if (!scene) return;

    const center = get3DPosition(row, col, 0);
    const group = new THREE.Group();
    group.position.set(center.x, 0, center.z);
    scene.add(group);

    // ── 3 expanding shockwave rings ──
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

    // ── White flash sphere at the landing ──
    const flashMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 14), flashMat);
    flash.position.y = 0.35;
    group.add(flash);

    // ── Warm dust burst (ground kick-up) ──
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

    // ── Ice-blue knight sparks (identity colour) ──
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

        // Shockwave rings expand outward
        for (const r of rings) {
            const st = Math.max(0, (t - r.delay) / 0.5);
            if (st >= 1) { r.mat.opacity = 0; continue; }
            r.mat.opacity = 0.9 * (1 - st);
            const s = 1 + st * 4.5;
            r.mesh.scale.set(s, s, 1);
        }

        // Flash pop
        flashMat.opacity = Math.max(0, 0.95 - t * 3.0);
        flash.scale.setScalar(1 + t * 3.5);

        // Dust + sparks
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

// ============================================================
//  ★ KNOCKBACK SPARK — tiny reusable particle used by the
//    victim push / bump trail. Self-manages its lifetime.
// ============================================================
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

// ============================================================
//  ★ Knight Ghost Squad — 4 spectral mini-knights in an ARROW
//    formation pointing along the dash direction.
//    Main knight = tip of the arrow; ghosts = trailing wings
//    (inner pair closer+tighter, outer pair further+wider).
//    Pure visual — NO collision, NO damage, NO game effect.
// ============================================================
function spawnKnightGhostSquad(pieceObj, color, dashDuration, fromPos, toPos) {
    const squadGroup = new THREE.Group();
    scene.add(squadGroup);

    // ── Travel direction (world X/Z) + its perpendicular "right" ──
    const travel = new THREE.Vector3().subVectors(toPos, fromPos);
    travel.y = 0;
    if (travel.lengthSq() < 1e-6) travel.set(0, 0, 1);   // safety
    travel.normalize();
    const right = new THREE.Vector3(-travel.z, 0, travel.x);

    // ── Arrow formation: 2 wings per side, trailing behind the knight ──
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

    // ══════════════════════════════════════════════════════════
    //  ★ COLOR-AWARE GHOST APPEARANCE
    //    White knight → bright ethereal ice-blue wisp (additive)
    //    Black knight → dark abyssal violet wraith  (normal blend)
    // ══════════════════════════════════════════════════════════
    const isWhiteKnight = (color === 'white');

    // Base tint colour that the piece's own colours get lerped toward
    const ghostTint = isWhiteKnight
        ? new THREE.Color(0x9fe8ff)      // ethereal ice-blue
        : new THREE.Color(0x7a1fd9);     // abyssal violet (dark)

    const tintStrength = isWhiteKnight ? 0.65 : 0.55;

    // Opacity + blend mode:
    //   • white  → additive glow, lower opacity (still very bright)
    //   • black  → normal blend so the dark colour is actually visible
    //              (additive blending would make a black ghost invisible)
    const ghostOpacity = isWhiteKnight ? 0.55 : 0.80;
    const ghostBlend = isWhiteKnight
        ? THREE.AdditiveBlending
        : THREE.NormalBlending;

    // Inner emissive glow — bright cyan for white, deep violet for black
    const ghostEmissive = isWhiteKnight
        ? new THREE.Color(0x9fe8ff)
        : new THREE.Color(0x3a0060);

    const emissiveIntensity = isWhiteKnight ? 0.6 : 0.5;

    const ghosts = [];

    for (let i = 0; i < 4; i++) {
        const ghost = createPieceModel(
            'knight', color, 100, 100, PIECE_PARAMS.knight || {}
        );

        // Strip health-bar sprite (defensive; full-HP should have none)
        if (ghost.userData.hpSprite) {
            ghost.remove(ghost.userData.hpSprite);
            ghost.userData.hpSprite = null;
        }

        // Ghostify → transparent, tinted, no shadows
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
        ghost.scale.setScalar(0.001);       // invisible until pop-in
        ghost.renderOrder = 5;

        ghost.userData.offset = offsets[i];
        ghost.userData.spawnDelay = (i < 2 ? 0.00 : 0.06) + (i % 2) * 0.03;
        ghost.userData.baseOpacity = ghostOpacity;   // ← used by the fade loop

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

    // ── Follow loop: glue the squad to the main knight + flicker + fade ──
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
    // Dispose after the fade completes
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

// ============================================================
//  ★ 執行騎士技能（移動 + 擊退 / 撞牆）
// ============================================================
function executeKnightAbilityMove(fromR, fromC, landingR, landingC, knockbackOption, isRemote = false) {
    triggerBishopLeapFadeOut();
    if (isAnimating) return;
    isAnimating = true;

    document.getElementById('aimHint').classList.remove('visible');
    hideKnockbackArrows();
    knightAbilityActive = false;
    knightAbilityState = null;

    const pieceObj = pieceObjects[`${fromR},${fromC}`];
    if (!pieceObj) { isAnimating = false; return; }

    const startPos = pieceObj.position.clone();
    const targetPos = get3DPosition(landingR, landingC, 0);
    const duration = 0.35;
    const startTime = clock.getElapsedTime();

    // ★ GHOST — spawn the spectral squad + dash wind on real ability casts
    let ghostSquad = null;
    if (knockbackOption) {
        spawnKnightDashWind(fromR, fromC, landingR, landingC, duration);
        ghostSquad = spawnKnightGhostSquad(
            pieceObj,
            pieceObj.userData.color || 'white',
            duration,
            startPos,       // ← added
            targetPos       // ← added
        );
    }
    // 只有本地玩家才送出網路訊息（避免回音迴圈）
    if (currentMode === 'multiplayer' && peerConnection?.open && !isRemote) {
        peerConnection.send({
            type: 'knight_move',
            fromR, fromC,
            landingR, landingC,
            knockback: knockbackOption ? {
                fromR: knockbackOption.r,
                fromC: knockbackOption.c,
                toR: knockbackOption.targetR,
                toC: knockbackOption.targetC,
                dirR: knockbackOption.dirR,
                dirC: knockbackOption.dirC,
                blocked: !!knockbackOption.blocked
            } : null
        });
    }

    const finishAll = () => {
        // ★ GHOST — safety: if fade never triggered (early exit), do it now
        if (ghostSquad && !ghostSquad.fadingOut && !ghostSquad.disposed) {
            fadeOutKnightGhostSquad(ghostSquad);
        }
        isAnimating = false;

        // ★ 擊退動畫、撞牆動畫都跑完了，這時候才把回合交給對手
        gameState.flipTurn();

        syncPiecesAfterMove();
        deselectPiece();
        switchTimer(gameState.turn);
        checkGameStatus();
        if (!gameOverFlag) {
            updateCameraTargets();
            if (currentMode === 'ai' && gameState.turn !== playerColor && !kingSkillState.active) {
                aiThinking = true;
                setTimeout(makeAIMove, 500);
            }
        }
        updateTurnIndicator();
    };

    const animateMove = () => {
        const now = clock.getElapsedTime();
        const progress = Math.min((now - startTime) / duration, 1);
        const ease = t => t * (2 - t);
        const t = ease(progress);
        pieceObj.position.lerpVectors(startPos, targetPos, t);

        if (progress < 1) {
            requestAnimationFrame(animateMove);
        } else {
            pieceObj.position.copy(targetPos);

            gameState.makeMove(fromR, fromC, landingR, landingC, null, true);

            if (knockbackOption) {
                const landedKnight = gameState.getPiece(landingR, landingC);
                if (landedKnight && landedKnight.type === 'knight') {
                    gameState.putOnSkillCooldown(landedKnight);
                }
            }

            // ★ GHOST — the moment the push begins, dissolve the squad
            if (ghostSquad) fadeOutKnightGhostSquad(ghostSquad);

            if (knockbackOption) {
                const enemyPiece = gameState.getPiece(knockbackOption.r, knockbackOption.c);
                if (enemyPiece) {
                    if (knockbackOption.blocked) {
                        animateVictimBump(knockbackOption.r, knockbackOption.c, knockbackOption.dirR, knockbackOption.dirC, () => {
                            const blocker = gameState.getPiece(knockbackOption.targetR, knockbackOption.targetC);
                            if (blocker) {
                                blocker.hp -= KNOCKBACK_BLOCK_DAMAGE;
                                if (blocker.hp < 0) blocker.hp = 0;
                                showDamageEffect(knockbackOption.targetR, knockbackOption.targetC, KNOCKBACK_BLOCK_DAMAGE);
                                if (blocker.hp <= 0) {
                                    gameState.board[knockbackOption.targetR][knockbackOption.targetC] = null;
                                }
                            }
                            gameState.moveHistory.push({
                                type: 'knockback',
                                fromR: knockbackOption.r,
                                fromC: knockbackOption.c,
                                toR: knockbackOption.r,
                                toC: knockbackOption.c,
                                blocked: true,
                                blockR: knockbackOption.targetR,
                                blockC: knockbackOption.targetC,
                                blockDamage: KNOCKBACK_BLOCK_DAMAGE,
                                piece: { ...enemyPiece }
                            });
                            finishAll();
                        });
                        return;
                    } else {
                        animateVictimPush(knockbackOption.r, knockbackOption.c, knockbackOption.targetR, knockbackOption.targetC, () => {
                            gameState.board[knockbackOption.targetR][knockbackOption.targetC] = enemyPiece;
                            gameState.board[knockbackOption.r][knockbackOption.c] = null;
                            gameState.moveHistory.push({
                                type: 'knockback',
                                fromR: knockbackOption.r,
                                fromC: knockbackOption.c,
                                toR: knockbackOption.targetR,
                                toC: knockbackOption.targetC,
                                piece: { ...enemyPiece }
                            });
                            finishAll();
                        });
                        return;
                    }
                }
            }
            finishAll();
        }
    };
    animateMove();
}

// ============================================================
//  ★ 主教「炮躍」技能（跳過棋子 + 路徑震地傷害）
// ============================================================
function executeBishopAbility(fromR, fromC, toR, toC, ability, isRemote = false) {
    if (isAnimating) return;
    isAnimating = true;

    // ★ 施放者進入冷卻（在移動前先抓原 ref，跟兵/騎士一致）
    const casterBishop = gameState.getPiece(fromR, fromC);
    gameState.putOnSkillCooldown(casterBishop);

    const pieceObj = pieceObjects[`${fromR},${fromC}`];
    if (!pieceObj) { isAnimating = false; return; }

    // 防守：落點必須是空的
    if (gameState.getPiece(toR, toC)) { isAnimating = false; return; }

    // ★ 路徑棋子必須在「移動前」算好，因為移動後棋盤會變
    const pathPieces = getBishopPathPieces(gameState, fromR, fromC, toR, toC);

    // ── 網路同步（使用既有的 'ability' 訊息格式） ──
    if (currentMode === 'multiplayer' && peerConnection?.open && !isRemote) {
        sendAbilityToPeer(
            fromR, fromC,
            [{ r: toR, c: toC }],
            ability.name, ability.damage, 0
        );
    }

    // ── 視覺：震地路徑 + 落地衝擊波 ──
    spawnBishopLeapEffect(fromR, fromC, toR, toC);

    // ── 跳躍動畫（拋物線） ──
    const startPos = pieceObj.position.clone();
    const targetPos = get3DPosition(toR, toC, 0);
    const duration = 0.4;
    const startTime = clock.getElapsedTime();
    const arcHeight = 1.2;

    const animateJump = () => {
        const now = clock.getElapsedTime();
        const progress = Math.min((now - startTime) / duration, 1);
        const ease = t => t * (2 - t);
        const t = ease(progress);
        const x = startPos.x + (targetPos.x - startPos.x) * t;
        const z = startPos.z + (targetPos.z - startPos.z) * t;
        const y = startPos.y + (targetPos.y - startPos.y) * t +
            Math.sin(progress * Math.PI) * arcHeight;
        pieceObj.position.set(x, y, z);

        if (progress < 1) {
            requestAnimationFrame(animateJump);
        } else {
            pieceObj.position.copy(targetPos);

            // ── 遊戲狀態：手動移動主教（不是合法 getLegalMoves 走法） ──
            const piece = gameState.getPiece(fromR, fromC);
            if (!piece) { isAnimating = false; return; }
            gameState.board[fromR][fromC] = null;
            gameState.board[toR][toC] = piece;
            piece.hasMoved = true;
            delete pieceObjects[`${fromR},${fromC}`];
            pieceObjects[`${toR},${toC}`] = pieceObj;
            pieceObj.userData.row = toR;
            pieceObj.userData.col = toC;

            // ── 套用路徑震地傷害 ──
            for (const pp of pathPieces) {
                const target = gameState.getPiece(pp.r, pp.c);
                if (target) {
                    target.hp -= ability.damage;
                    if (target.hp <= 0) gameState.board[pp.r][pp.c] = null;
                    showDamageEffect(pp.r, pp.c, ability.damage);
                }
            }

            // ── 動畫結束後才 flipTurn ──
            gameState.flipTurn();
            gameState.moveHistory.push({
                type: 'bishop_leap',
                fromR, fromC, toR, toC,
                damageDealt: ability.damage,
                victims: pathPieces.map(p => ({ r: p.r, c: p.c }))
            });

            deselectPiece();
            isAnimating = false;
            syncPiecesAfterMove();
            switchTimer(gameState.turn);
            checkGameStatus();
            updateTurnIndicator();
            if (!gameOverFlag) {
                updateCameraTargets();
                if (currentMode === 'ai' && gameState.turn !== playerColor && !kingSkillState.active) {
                    aiThinking = true;
                    setTimeout(makeAIMove, 500);
                }
            }
        }
    };
    animateJump();
}

// ============================================================
//  ★ 皇后「治癒」技能
// ============================================================
function executeQueenHeal(fromR, fromC, toR, toC, ability, isRemote = false) {
    playSFX('heal');

    if (isAnimating) return;
    const caster = gameState.getPiece(fromR, fromC);
    const target = gameState.getPiece(toR, toC);
    if (!caster || !target) return;
    if (target.color !== caster.color) return;

    isAnimating = true;
    gameState.putOnSkillCooldown(caster, 'heal');

    if (currentMode === 'multiplayer' && peerConnection?.open && !isRemote) {
        sendAbilityToPeer(fromR, fromC, [{ r: toR, c: toC }], ability.name, 0, 0, null);
    }

    const healAmount = ability.healAmount || 100;
    const amount = Math.min(healAmount, target.maxHp - target.hp);
    target.hp = Math.min(target.maxHp, target.hp + healAmount);

    spawnHealEffect(toR, toC);
    showFloatingHeal(toR, toC, amount);
    updateHealthVisuals(toR, toC, target.hp, target.maxHp);

    gameState.moveHistory.push({
        type: 'ability', abilityName: ability.name,
        fromR, fromC, targetR: toR, targetC: toC,
        damageDealt: 0, healAmount: amount,
    });

    setTimeout(() => {
        gameState.flipTurn();
        deselectPiece();
        isAnimating = false;
        syncPiecesAfterMove();
        switchTimer(gameState.turn);
        checkGameStatus();
        updateTurnIndicator();
        if (!gameOverFlag) {
            updateCameraTargets();
            if (currentMode === 'ai' && gameState.turn !== playerColor && !kingSkillState.active) {
                aiThinking = true;
                setTimeout(makeAIMove, 500);
            }
        }
    }, 1050);
}

// 治癒視覺：綠色光柱 + 地面擴散環 + 上升粒子
function spawnHealEffect(row, col) {
    const center = get3DPosition(row, col, 0);
    const group = new THREE.Group();
    group.position.set(center.x, 0, center.z);
    scene.add(group);

    const startTime = clock.getElapsedTime();
    const DURATION = 1.0;

    // ── 地面擴散環 ──
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

    // ── 光柱 ──
    const colMat = new THREE.MeshBasicMaterial({
        color: 0x6dffb0, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.5, 2.2, 20, 1, true), colMat);
    column.position.y = 1.1;
    group.add(column);

    // ── 上升粒子 ──
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

// ============================================================
//  ★ 皇后「復活」技能
// ============================================================
function executeQueenRevive(fromR, fromC, toR, toC, ability, reviveType = null, isRemote = false) {
    playSFX('heal');

    if (isAnimating) return;
    const caster = gameState.getPiece(fromR, fromC);
    if (!caster) return;
    if (gameState.getPiece(toR, toC)) return;   // 必須是空格

    const dead = gameState.getDeadPieces(caster.color);
    if (dead.length === 0) return;

    // 選擇要復活的棋子
    let chosen = null;
    if (reviveType) chosen = dead.find(d => d.type === reviveType) || null;
    if (!chosen) {
        let bestVal = -1;
        for (const d of dead) {
            const v = PIECE_VALUES[d.type] || 0;
            if (v > bestVal) { bestVal = v; chosen = d; }
        }
    }

    if (!chosen) return;

    isAnimating = true;
    gameState.putOnSkillCooldown(caster, 'revive');

    // ★ Consume this dead entry — it can't be revived a second time.
    //   Once we create the brand-new piece below it gets its own ID,
    //   so if IT dies later, that new ID will be the one in the list.
    const _origIdx = gameState.initialPieces.findIndex(p => p.id === chosen.id);
    if (_origIdx >= 0) gameState.initialPieces.splice(_origIdx, 1);

    if (currentMode === 'multiplayer' && peerConnection?.open && !isRemote) {
        sendAbilityToPeer(fromR, fromC, [{ r: toR, c: toC }], ability.name, 0, 0, chosen.type);
    }

    // ── 建立新棋子（滿血） ──
    const newPiece = {
        id: ++_pieceIdCounter,
        type: chosen.type,
        color: caster.color,
        hasMoved: true,
        hp: 100, maxHp: 100,
        skillCooldown: 0, reviveCooldown: 0,
        justUsedSkill: false, justUsedRevive: false,
    };
    gameState.board[toR][toC] = newPiece;
    gameState.initialPieces.push({ id: newPiece.id, type: chosen.type, color: caster.color });

    gameState.moveHistory.push({
        type: 'ability', abilityName: ability.name,
        fromR, fromC, targetR: toR, targetC: toC,
        reviveType: chosen.type,
    });

    // ── 重建 3D 並播放甦生動畫 ──
    syncPiecesAfterMove();
    spawnReviveEffect(toR, toC);

    // ★ 皇后說話：「Your duty is not over!」
    showQueenSpeech(fromR, fromC, 'Your duty is not over!');

    const obj = pieceObjects[`${toR},${toC}`];
    const baseRotY = obj ? obj.rotation.y : 0;
    if (obj) {
        obj.scale.set(0.05, 0.05, 0.05);
        obj.position.y = -1.1;
        obj.rotation.y = baseRotY - Math.PI * 2;
    }

    const startTime = clock.getElapsedTime();
    const REVIVE_ANIM = 0.9;

    const finish = () => {
        gameState.flipTurn();
        deselectPiece();
        isAnimating = false;
        switchTimer(gameState.turn);
        checkGameStatus();
        updateTurnIndicator();
        if (!gameOverFlag) {
            updateCameraTargets();
            if (currentMode === 'ai' && gameState.turn !== playerColor && !kingSkillState.active) {
                aiThinking = true;
                setTimeout(makeAIMove, 500);
            }
        }
    };

    const anim = () => {
        const t = Math.min((clock.getElapsedTime() - startTime) / REVIVE_ANIM, 1);
        const e = 1 - Math.pow(1 - t, 3);
        if (obj) {
            obj.position.y = -1.1 * (1 - e);
            obj.scale.setScalar(0.05 + 0.95 * e);
            obj.rotation.y = baseRotY - Math.PI * 2 * (1 - e);
        }
        if (t < 1) requestAnimationFrame(anim);
        else {
            if (obj) {
                obj.position.y = 0;
                obj.scale.set(1, 1, 1);
                obj.rotation.y = baseRotY;
            }
            // ★ spawnReviveEffect 總長 1.6s，棋子 0.9s 現形，
            //   再等 0.75s 讓復活法陣播完才交棒給對手
            setTimeout(finish, 750);
        }
    };
    anim();
}

// ============================================================
//  ★ 皇后「復活」技能 — 加強版視覺效果
//   layering (bottom → top):
//     1. ground rune circle   (dark + gold glow, slowly rotating)
//     2. three expanding shock rings
//     3. wide sky beam + core beam
//     4. descending halo (drops from above to the ground)
//     5. radial light rays around the beam
//     6. upward-spiraling motes + falling sparkles
//     7. bright materialize flash (peaks as the piece appears)
// ============================================================
function spawnReviveEffect(row, col) {
    const center = get3DPosition(row, col, 0);
    const group = new THREE.Group();
    group.position.set(center.x, 0, center.z);
    scene.add(group);

    const startTime = clock.getElapsedTime();
    const DURATION = 1.6;         // extended for extra drama
    const MATERIALIZE_AT = 0.35;  // piece starts appearing here

    // ── 1. Ground rune circle ────────────────────────────────
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

    // Spokes (radial ticks)
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

    // ── 2. Shock rings (expand outward, staggered) ──────────
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

    // ── 3. Sky beam (wide) + core beam ──────────────────────
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

    // ── 4. Descending halo ──────────────────────────────────
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

    // ── 5. Radial light rays (near the ground, spinning) ────
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

    // ── 6a. Rising spiral motes ─────────────────────────────
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

    // ── 6b. Falling sparkles ────────────────────────────────
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

    // ── 7. Materialize flash ────────────────────────────────
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

    // ── Animation loop ──────────────────────────────────────
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

        // Rune circle: fade in then fade out, slowly rotate
        const runeFade = Math.min(t / 0.3, 1) * Math.max(0, 1 - prog * 1.1);
        runeOuter.material.opacity = 0.85 * runeFade;
        runeInner.material.opacity = 0.95 * runeFade;
        for (const s of spokes) s.material.opacity = 0.75 * runeFade;
        runeGroup.rotation.y += 0.035;

        // Beams
        const beamEnvelope = Math.sin(Math.PI * Math.min(prog / 0.8, 1));
        beamMat.opacity = 0.55 * beamEnvelope;
        coreMat.opacity = 0.95 * beamEnvelope;
        beam.rotation.y += 0.025;
        core.rotation.y -= 0.06;

        // Halo descends from y=4.0 → y=0.05
        const haloProg = Math.min(t / 0.75, 1);
        const haloY = 4.0 * (1 - haloProg) + 0.05;
        halo.position.y = haloY;
        haloInner.position.y = haloY;
        halo.material.opacity = 0.9 * Math.sin(Math.PI * Math.min(haloProg * 1.2, 1));
        haloInner.material.opacity = 1.0 * Math.sin(Math.PI * Math.min(haloProg * 1.2, 1));
        const haloScale = 1 + haloProg * 0.6;
        halo.scale.setScalar(haloScale);
        haloInner.scale.setScalar(haloScale);

        // Radial rays (bright early, fade later)
        const rayAlpha = Math.max(0, 1 - prog * 1.4) * Math.min(t / 0.2, 1);
        for (const m of rays) {
            m.material.opacity = 0.55 * rayAlpha;
        }
        // Slow spin of the ray group (rotate each individually around origin)
        const raySpin = t * 0.6;
        for (let i = 0; i < rays.length; i++) {
            const a = (i / rays.length) * Math.PI * 2 + raySpin;
            rays[i].position.set(Math.cos(a) * 0.35, 0.06, Math.sin(a) * 0.35);
            rays[i].rotation.z = -a;
        }

        // Shock rings
        for (const r of rings) {
            const rt = Math.max(0, Math.min(1, (t - r.delay) / (DURATION - r.delay)));
            r.mesh.material.opacity = 0.85 * (1 - rt);
            r.mesh.scale.setScalar(1 + rt * 5.0);
        }

        // Rising motes (spiral upward)
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

        // Falling sparkles
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

        // Materialize flash — sharp peak near MATERIALIZE_AT
        const mf = Math.max(0, 1 - Math.abs(t - MATERIALIZE_AT) / 0.25);
        flash.material.opacity = 0.9 * mf;
        flash.scale.setScalar(1 + (1 - mf) * 1.5);
        flashSphere.material.opacity = 0.85 * mf;
        flashSphere.scale.setScalar(1 + (1 - mf) * 2.2);

        requestAnimationFrame(loop);
    };
    loop();
}

// ============================================================
//  ★ 皇后復活選擇視窗
// ============================================================
function showReviveChooser() {
    if (!pendingRevive || !gameState || !selectedPiece) { pendingRevive = null; return; }
    const dead = gameState.getDeadPieces(selectedPiece.piece.color);
    if (dead.length === 0) { pendingRevive = null; return; }

    const counts = new Map();
    for (const d of dead) counts.set(d.type, (counts.get(d.type) || 0) + 1);

    const entries = [...counts.entries()]
        .sort((a, b) => (PIECE_VALUES[b[0]] || 0) - (PIECE_VALUES[a[0]] || 0));

    const GLYPH = { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' };
    const container = document.getElementById('reviveChoices');
    container.innerHTML = '';

    for (const [type, count] of entries) {
        const btn = document.createElement('button');
        btn.className = 'promotion-btn';
        btn.innerHTML =
            `<span style="line-height:1;">${GLYPH[type] || '?'}</span>` +
            `<span class="revive-count">×${count}</span>`;
        btn.onclick = () => chooseRevive(type);
        container.appendChild(btn);
    }

    document.getElementById('reviveOverlay').classList.remove('hidden');
}

function chooseRevive(type) {
    document.getElementById('reviveOverlay').classList.add('hidden');
    if (!pendingRevive) return;
    const { fromR, fromC, toR, toC } = pendingRevive;
    pendingRevive = null;
    attemptAbility(fromR, fromC, toR, toC, QUEEN_REVIVE_ABILITY, false, type);
}

function cancelRevive() {
    pendingRevive = null;
    const el = document.getElementById('reviveOverlay');
    if (el) el.classList.add('hidden');
}

// ★ 視覺：主教「熔岩裂地」技能特效
//   LONG cracks / lava / residual heat, but SHORT + SMALL landing boom
//   + can be force-faded early when the next action starts
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
    const EARLY_FADE_DURATION = 0.4;   // ★ fade speed when next action starts

    // ★ Register this effect so it can be force-faded
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

        // ★ Compute global fade multiplier if the effect is being force-faded
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

        // ── Cracks ──
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

        // ── Lava ──
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

        // ── Embers ──
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

        // ── Shock rings ──
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

        // ── Residual ground heat ──
        for (const rg of residualGlows) {
            const t = elapsed - rg.bornAt;
            if (t < 0) continue;
            const progress = Math.min(t / rg.duration, 1);
            const fadeIn = Math.min(t / 0.25, 1);
            const pulse = 0.75 + 0.25 * Math.sin(elapsed * 14 + rg.pulsePhase);
            rg.mesh.material.opacity = rg.maxOpacity * fadeIn * (1 - progress) * pulse * fadeMul;
            rg.mesh.scale.setScalar(1 + progress * 0.8);
        }

        // ── Landing glow ──
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

// ============================================================
//  CANNON / ABILITY EXECUTION
// ============================================================
function fireAimedCannon() {
    if (!isAiming) return;

    // ★ 讓發射的城堡進入冷卻
    const casterRook = gameState.getPiece(selectedPiece.row, selectedPiece.col);
    gameState.putOnSkillCooldown(casterRook);

    const worldPos = aimWorldPos.clone();
    worldPos.y = 0.05;
    const casterPos = get3DPosition(selectedPiece.row, selectedPiece.col, 0);
    const distFromCaster = Math.hypot(worldPos.x - casterPos.x, worldPos.z - casterPos.z);
    const inRange = distFromCaster <= CANNON_RANGE;
    let targets = inRange ? getPiecesInRadius(worldPos, TARGET_RADIUS) : [];
    targets = targets.filter(t => isWithinCannonRange(selectedPiece.row, selectedPiece.col, t.r, t.c));

    for (const key of lastAimedPieceKeys) {
        const [r, c] = key.split(',').map(Number);
        setPieceHitEffect(r, c, false);
    }
    lastAimedPieceKeys.clear();

    const fromR = selectedPiece.row;
    const fromC = selectedPiece.col;
    const abilityDef = ABILITIES.rook;
    const targetData = targets.map(t => ({ r: t.r, c: t.c }));
    const targetWorldX = worldPos.x;
    const targetWorldZ = worldPos.z;

    if (currentMode === 'multiplayer' && peerConnection?.open) {
        peerConnection.send({
            type: 'aim_fire',
            fromR, fromC,
            targetX: targetWorldX,
            targetZ: targetWorldZ,
            targets: targetData,
            abilityName: abilityDef.name,
            damage: abilityDef.damage
        });
    }

    cancelAiming();

    const startPos = get3DPosition(fromR, fromC, 0.6);
    const endPos = worldPos.clone();
    endPos.y = 0.05;

    if (targets.length === 0) {
        isAnimating = true;
        flyCannonball(startPos, endPos, () => {
            createEmptyExplosion(worldPos);
            gameState.flipTurn();
            gameState.moveHistory.push({
                type: 'areaAbility', abilityName: abilityDef.name,
                fromR, fromC, targets: [], damageDealt: 0, missed: true
            });
            isAnimating = false;
            deselectPiece();
            syncPiecesAfterMove();
            switchTimer(gameState.turn);
            checkGameStatus();
            if (!gameOverFlag) {
                updateCameraTargets();
                if (currentMode === 'ai' && gameState.turn !== playerColor && !kingSkillState.active) {
                    aiThinking = true;
                    setTimeout(makeAIMove, 500);
                }
            }
            updateTurnIndicator();
        });
        return;
    }

    isAnimating = true;
    flyCannonball(startPos, endPos, () => {
        fireAreaCannonVisual(worldPos, targets, abilityDef.damage, () => {
            for (const target of targets) {
                const targetPiece = gameState.getPiece(target.r, target.c);
                if (targetPiece) {
                    targetPiece.hp -= abilityDef.damage;
                    if (targetPiece.hp <= 0) gameState.board[target.r][target.c] = null;
                    showDamageEffect(target.r, target.c, abilityDef.damage);
                }
            }
            gameState.flipTurn();
            gameState.moveHistory.push({
                type: 'areaAbility', abilityName: abilityDef.name,
                fromR, fromC,
                targets: targets.map(t => ({ r: t.r, c: t.c })),
                damageDealt: abilityDef.damage
            });
            deselectPiece();
            isAnimating = false;
            syncPiecesAfterMove();
            switchTimer(gameState.turn);
            checkGameStatus();
            if (!gameOverFlag) {
                updateCameraTargets();
                if (currentMode === 'ai' && gameState.turn !== playerColor && !kingSkillState.active) {
                    aiThinking = true;
                    setTimeout(makeAIMove, 500);
                }
            }
            updateTurnIndicator();
        });
    });
}

function fireAreaCannonVisual(centerPos, targets, damage, callback) {
    playSFX('explosion');

    const boomGroup = new THREE.Group();
    boomGroup.position.copy(centerPos);
    boomGroup.position.y += 0.3;
    scene.add(boomGroup);
    const mainBoomGeo = new THREE.SphereGeometry(1.2, 20, 20);
    const mainBoomMat = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.9, depthWrite: false });
    const mainBoom = new THREE.Mesh(mainBoomGeo, mainBoomMat);
    mainBoom.scale.set(0.1, 0.1, 0.1);
    boomGroup.add(mainBoom);
    const outerBoomGeo = new THREE.SphereGeometry(2.0, 20, 20);
    const outerBoomMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.4, depthWrite: false });
    const outerBoom = new THREE.Mesh(outerBoomGeo, outerBoomMat);
    outerBoom.scale.set(0.1, 0.1, 0.1);
    boomGroup.add(outerBoom);
    const flashGeo = new THREE.SphereGeometry(0.4, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    boomGroup.add(flash);
    const particleCount = 80;
    const particles = [];
    for (let i = 0; i < particleCount; i++) {
        const pGeo = new THREE.SphereGeometry(0.08, 4, 4);
        const pMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(0.05 + Math.random() * 0.1, 1, 0.5 + Math.random() * 0.3),
            transparent: true, opacity: 1, depthWrite: false
        });
        const p = new THREE.Mesh(pGeo, pMat);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        const r = 0.8 + Math.random() * 0.8;
        p.position.set(Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r * 0.5 + 0.5, Math.sin(phi) * Math.sin(theta) * r);
        p.userData.vel = new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 6 + 2, (Math.random() - 0.5) * 8);
        p.userData.life = 1;
        boomGroup.add(p);
        particles.push(p);
    }
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);
    for (const target of targets) {
        const pos = get3DPosition(target.r, target.c, 0.3);
        const markerGeo = new THREE.SphereGeometry(0.2, 8, 8);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.8, depthWrite: false });
        const marker = new THREE.Mesh(markerGeo, markerMat);
        marker.position.copy(pos);
        markerGroup.add(marker);
    }
    const boomStart = clock.getElapsedTime();
    const animateBoom = () => {
        const bt = (clock.getElapsedTime() - boomStart) / 0.6;
        if (bt >= 1) {
            scene.remove(boomGroup);
            scene.remove(markerGroup);
            setTimeout(callback, 300);
            return;
        }
        const s = 1 + bt * 10;
        mainBoom.scale.setScalar(s);
        mainBoom.material.opacity = 0.9 * (1 - bt * 1.2);
        outerBoom.scale.setScalar(s * 2.2);
        outerBoom.material.opacity = 0.4 * (1 - bt * 1.1);
        flash.scale.setScalar(1 + bt * 4);
        flash.material.opacity = 1 - bt * 2;
        for (const p of particles) {
            p.position.add(p.userData.vel.clone().multiplyScalar(0.025));
            p.userData.vel.y -= 0.06;
            p.material.opacity = 1 - bt * 1.2;
            p.scale.setScalar(1 - bt * 0.3);
        }
        for (const child of markerGroup.children) {
            child.material.opacity = 0.8 * (1 - bt);
            child.scale.setScalar(1 + bt * 2);
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
        if (bt >= 1) { scene.remove(boomGroup); return; }
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
            for (const p of trailParticles) scene.remove(p);
            scene.remove(proj);
            scene.remove(glow);
            callback();
        }
    };
    animateProj();
}

// ============================================================
//  REMOTE AIM
// ============================================================
function showRemoteAim(fromR, fromC, targetX, targetZ) {
    const fromPos = get3DPosition(fromR, fromC, 0.6);
    const targetPos = new THREE.Vector3(targetX, 0.05, targetZ);
    const fromScreen = fromPos.clone(); fromScreen.project(camera);
    const targetScreen = targetPos.clone(); targetScreen.project(camera);
    const fromX = (fromScreen.x * 0.5 + 0.5) * window.innerWidth;
    const fromY = (-fromScreen.y * 0.5 + 0.5) * window.innerHeight;
    const toX = (targetScreen.x * 0.5 + 0.5) * window.innerWidth;
    const toY = (-targetScreen.y * 0.5 + 0.5) * window.innerHeight;
    const indicator = document.getElementById('remoteAimIndicator');
    indicator.style.display = 'block';
    indicator.style.left = (toX - 20) + 'px';
    indicator.style.top = (toY - 20) + 'px';
    indicator.style.width = '40px';
    indicator.style.height = '40px';
    const line = document.getElementById('remoteAimLine');
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    line.style.display = 'block';
    line.style.left = fromX + 'px';
    line.style.top = fromY + 'px';
    line.style.width = len + 'px';
    line.style.transform = `rotate(${angle}rad)`;
    remoteAimActive = true;
    remoteAimFromR = fromR;
    remoteAimFromC = fromC;
    remoteAimTargetX = targetX;
    remoteAimTargetZ = targetZ;
}

function hideRemoteAim() {
    document.getElementById('remoteAimIndicator').style.display = 'none';
    document.getElementById('remoteAimLine').style.display = 'none';
    remoteAimActive = false;
    if (remoteAimTimer) { clearTimeout(remoteAimTimer); remoteAimTimer = null; }
}

function updateRemoteAimPosition(targetX, targetZ) {
    if (!remoteAimActive) return;
    const fromPos = get3DPosition(remoteAimFromR, remoteAimFromC, 0.6);
    const targetPos = new THREE.Vector3(targetX, 0.05, targetZ);
    const fromScreen = fromPos.clone(); fromScreen.project(camera);
    const targetScreen = targetPos.clone(); targetScreen.project(camera);
    const fromX = (fromScreen.x * 0.5 + 0.5) * window.innerWidth;
    const fromY = (-fromScreen.y * 0.5 + 0.5) * window.innerHeight;
    const toX = (targetScreen.x * 0.5 + 0.5) * window.innerWidth;
    const toY = (-targetScreen.y * 0.5 + 0.5) * window.innerHeight;
    const indicator = document.getElementById('remoteAimIndicator');
    indicator.style.left = (toX - 20) + 'px';
    indicator.style.top = (toY - 20) + 'px';
    const line = document.getElementById('remoteAimLine');
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    line.style.width = len + 'px';
    line.style.transform = `rotate(${angle}rad)`;
    remoteAimTargetX = targetX;
    remoteAimTargetZ = targetZ;
}

function playRemoteCannonFire(fromR, fromC, targetX, targetZ, targets, damage) {
    // ★ 讓對方（同時也是我方畫面中）的城堡進入冷卻
    const remoteRook = gameState.getPiece(fromR, fromC);
    gameState.putOnSkillCooldown(remoteRook);

    const startPos = get3DPosition(fromR, fromC, 0.6);
    const endPos = new THREE.Vector3(targetX, 0.05, targetZ);

    const actualTargets = targets ? targets.map(t => ({ r: t.r, c: t.c })) : [];

    // ── 套用傷害 + 記錄歷史（回合切換延後到動畫之後） ──
    if (actualTargets.length > 0) {
        for (const t of actualTargets) {
            const targetPiece = gameState.getPiece(t.r, t.c);
            if (targetPiece) {
                targetPiece.hp -= damage;
                if (targetPiece.hp <= 0) gameState.board[t.r][t.c] = null;
                showDamageEffect(t.r, t.c, damage);
            }
        }
        gameState.moveHistory.push({
            type: 'areaAbility', abilityName: '加農炮 (Cannon)',
            fromR, fromC, targets: actualTargets, damageDealt: damage
        });
    } else {
        // ★ 就算打空也要記錄 + 換手，否則雙方回合會不同步
        gameState.moveHistory.push({
            type: 'areaAbility', abilityName: '加農炮 (Cannon)',
            fromR, fromC, targets: [], damageDealt: 0, missed: true
        });
    }

    isAnimating = true;

    // ★ 動畫播完後才 flipTurn → tickSkillCooldowns，
    //   這樣我方棋子的冷卻不會在對手的動畫還沒結束時就先倒數。
    const finalize = () => {
        gameState.flipTurn();
        syncPiecesAfterMove();
        switchTimer(gameState.turn);
        checkGameStatus();
        updateTurnIndicator();
        if (!gameOverFlag) updateCameraTargets();
        isAnimating = false;
        hideRemoteAim();
    };

    flyCannonball(startPos, endPos, () => {
        if (actualTargets.length > 0) {
            const worldPos = new THREE.Vector3(targetX, 0.05, targetZ);
            fireAreaCannonVisual(worldPos, actualTargets, damage, finalize);
        } else {
            const worldPos = new THREE.Vector3(targetX, 0.05, targetZ);
            createEmptyExplosion(worldPos);
            setTimeout(finalize, 250);
        }
    });
}

// ============================================================
//  ACTION BAR & UI
// ============================================================
function isPlayerTurn() {
    if (gameOverFlag || isAnimating || aiThinking) return false;
    if (currentMode === 'ai' || currentMode === 'multiplayer') return gameState.turn === playerColor;
    return true;
}

function updateActionBar(show, hasTargets, cooldown = 0) {
    const bar = document.getElementById('actionBar');
    const attackBtn = document.getElementById('btnActionAttack');
    const noTargetTip = document.getElementById('noTargetTip');
    if (show) {
        bar.classList.add('visible');
        bar.style.display = 'flex';
        attackBtn.classList.remove('cooldown');
        if (cooldown > 0) {
            attackBtn.disabled = true;
            attackBtn.classList.remove('active');
            attackBtn.classList.add('cooldown');
            attackBtn.textContent = `⏳ 冷卻中 (${cooldown})`;
            noTargetTip.classList.add('hidden');
        } else if (hasTargets) {
            attackBtn.disabled = false;
            attackBtn.textContent = '⚔️ 特殊技能';
            noTargetTip.classList.add('hidden');
        } else {
            attackBtn.disabled = true;
            attackBtn.classList.remove('active');
            attackBtn.textContent = '⚔️ 特殊技能';
            noTargetTip.classList.remove('hidden');
        }
    } else {
        bar.classList.remove('visible');
        bar.style.display = 'none';
        attackBtn.disabled = false;
        attackBtn.classList.remove('cooldown');
        attackBtn.textContent = '⚔️ 特殊技能';
        noTargetTip.classList.add('hidden');
    }
}

function updateActionButtonStates() {
    const moveBtn = document.getElementById('btnActionMove');
    const attackBtn = document.getElementById('btnActionAttack');
    if (!moveBtn || !attackBtn) return;
    moveBtn.classList.toggle('active', actionMode === 'move');
    attackBtn.classList.toggle('active', actionMode === 'attack');
}

function setActionMode(mode) {
    if (isAiming) cancelAiming();
    if (knightAbilityActive && mode !== 'attack') {
        knightAbilityActive = false;
        knightAbilityState = null;
        hideKnockbackArrows();
        document.getElementById('aimHint').classList.remove('visible');
    }

    // Attack chosen but there is nothing to attack → fall back to move,
    // and make sure no aura is left hanging.
    if (mode === 'attack' && abilityTargets.length === 0) {
        actionMode = 'move';
        hideCannonRange();
        clearSelectionAura();        // ★ no targets → no aura
        if (selectedPiece) showValidMoveHighlights(validMoves, selectedPiece.row, selectedPiece.col);
        updateActionButtonStates();
        return;
    }

    actionMode = mode;

    if (mode === 'move') {
        hideCannonRange();
        document.getElementById('aimHint').classList.remove('visible');
        hideGhostLine();
        clearSelectionAura();        // ★ back to move → remove the aura
        if (selectedPiece) showValidMoveHighlights(validMoves, selectedPiece.row, selectedPiece.col);
    } else {
        document.getElementById('aimHint').classList.remove('visible');

        // ★ NEW — attack mode: this is the only place the aura is born.
        if (selectedPiece && pieceObjects[`${selectedPiece.row},${selectedPiece.col}`]) {
            createSelectionAura(
                pieceObjects[`${selectedPiece.row},${selectedPiece.col}`],
                selectedPiece.piece.type
            );
        }

        const piece = gameState.getPiece(selectedPiece.row, selectedPiece.col);
        if (piece && piece.type === 'rook') {
            showCannonRange(selectedPiece.row, selectedPiece.col);
            enterAimingMode();
        } else if (piece && piece.type === 'knight') {
            enterKnightAbilityMode();
        } else {
            hideCannonRange();
            showAbilityHighlights(abilityTargets, selectedPiece.row, selectedPiece.col);
        }
    }
    updateActionButtonStates();
}

// ============================================================
//  MOBILE JOYSTICK
// ============================================================
function setupMobileCannonControls() {
    if (joystickSetup) return;
    joystickSetup = true;
    const base = document.getElementById('joystickBase');
    const knob = document.getElementById('joystickKnob');
    const fireBtn = document.getElementById('fireBtn');
    const cancelBtn = document.getElementById('cancelCannonBtn');
    if (!base || !knob || !fireBtn || !cancelBtn) return;

    const onStart = (e) => {
        e.preventDefault(); e.stopPropagation();
        const touch = e.changedTouches ? e.changedTouches[0] : e;
        const rect = base.getBoundingClientRect();
        joystickState.active = true;
        joystickState.touchId = touch.identifier !== undefined ? touch.identifier : null;
        joystickState.baseCenterX = rect.left + rect.width / 2;
        joystickState.baseCenterY = rect.top + rect.height / 2;
        updateKnob(touch.clientX, touch.clientY);
    };
    const onMove = (e) => {
        if (!joystickState.active) return;
        e.preventDefault(); e.stopPropagation();
        let touch = null;
        if (e.changedTouches) {
            for (const t of e.changedTouches) {
                if (joystickState.touchId === null || t.identifier === joystickState.touchId) { touch = t; break; }
            }
        } else touch = e;
        if (touch) updateKnob(touch.clientX, touch.clientY);
    };
    const onEnd = (e) => {
        if (!joystickState.active) return;
        e.preventDefault(); e.stopPropagation();
        if (e.changedTouches && joystickState.touchId !== null) {
            let ended = false;
            for (const t of e.changedTouches) {
                if (t.identifier === joystickState.touchId) { ended = true; break; }
            }
            if (!ended) return;
        }
        resetJoystick();
    };
    base.addEventListener('touchstart', onStart, { passive: false });
    base.addEventListener('touchmove', onMove, { passive: false });
    base.addEventListener('touchend', onEnd, { passive: false });
    base.addEventListener('touchcancel', onEnd, { passive: false });

    const doFire = (e) => {
        e.preventDefault(); e.stopPropagation();
        fireBtn.classList.add('pressed');
        setTimeout(() => fireBtn.classList.remove('pressed'), 120);
        if (isAiming) fireAimedCannon();
    };
    fireBtn.addEventListener('touchstart', doFire, { passive: false });
    fireBtn.addEventListener('click', doFire);

    const doCancel = (e) => {
        e.preventDefault(); e.stopPropagation();
        cancelAiming();
    };
    cancelBtn.addEventListener('touchstart', doCancel, { passive: false });
    cancelBtn.addEventListener('click', doCancel);
}

function updateKnob(clientX, clientY) {
    const dx = clientX - joystickState.baseCenterX;
    const dy = clientY - joystickState.baseCenterY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxR = joystickState.baseRadius;
    let nx = dx, ny = dy;
    if (dist > maxR && dist > 0) {
        nx = (dx / dist) * maxR;
        ny = (dy / dist) * maxR;
    }
    joystickState.knobOffsetX = nx;
    joystickState.knobOffsetY = ny;
    const knob = document.getElementById('joystickKnob');
    if (knob) knob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
}

function resetJoystick() {
    joystickState.active = false;
    joystickState.touchId = null;
    joystickState.knobOffsetX = 0;
    joystickState.knobOffsetY = 0;
    const knob = document.getElementById('joystickKnob');
    if (knob) knob.style.transform = 'translate(-50%, -50%)';
}

function updateJoystickAim(dt) {
    if (!IS_MOBILE || !isAiming || !joystickState.active) return;
    if (!selectedPiece) return;
    const maxR = joystickState.baseRadius;
    const nx = joystickState.knobOffsetX / maxR;
    const ny = joystickState.knobOffsetY / maxR;
    if (Math.abs(nx) < 0.06 && Math.abs(ny) < 0.06) return;
    const camForward = new THREE.Vector3();
    camera.getWorldDirection(camForward);
    camForward.y = 0;
    if (camForward.lengthSq() < 0.0001) camForward.set(0, 0, -1);
    camForward.normalize();
    const camRight = new THREE.Vector3();
    camRight.crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();
    const moveDir = camRight.clone().multiplyScalar(nx).add(camForward.clone().multiplyScalar(-ny));
    if (!aimWorldPos) aimWorldPos = new THREE.Vector3(0, 0.05, 0);
    aimWorldPos.addScaledVector(moveDir, joystickState.moveSpeed * dt);
    aimWorldPos.x = Math.max(-4.5, Math.min(4.5, aimWorldPos.x));
    aimWorldPos.z = Math.max(-4.5, Math.min(4.5, aimWorldPos.z));
    const casterPos = get3DPosition(selectedPiece.row, selectedPiece.col, 0);
    const dx = aimWorldPos.x - casterPos.x;
    const dz = aimWorldPos.z - casterPos.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > CANNON_RANGE * CANNON_RANGE) {
        const d = Math.sqrt(distSq);
        const k = CANNON_RANGE / d;
        aimWorldPos.x = casterPos.x + dx * k;
        aimWorldPos.z = casterPos.z + dz * k;
    }
    aimWorldPos.y = 0.05;
    updateAimTarget(aimWorldPos);
    if (currentMode === 'multiplayer' && peerConnection?.open) {
        const now = Date.now();
        if (!aimMoveThrottleTimer || now - aimMoveThrottleTimer > AIM_SEND_THROTTLE) {
            peerConnection.send({ type: 'aim_move', targetX: aimWorldPos.x, targetZ: aimWorldPos.z });
            aimMoveThrottleTimer = now;
        }
    }
}

function enterAimingMode() {
    isAiming = true;
    clearHighlights();
    createGhostLine();
    document.getElementById('actionBar').classList.remove('visible');
    document.getElementById('actionBar').style.display = 'none';

    if (IS_MOBILE) {
        document.getElementById('aimHint').classList.remove('visible');
        document.getElementById('mobileCannonControls').classList.add('active');
        setupMobileCannonControls();
        resetJoystick();
        const casterPos = get3DPosition(selectedPiece.row, selectedPiece.col, 0);
        aimWorldPos = new THREE.Vector3(casterPos.x, 0.05, casterPos.z);
        updateAimTarget(aimWorldPos);
    } else {
        document.getElementById('aimHint').classList.remove('visible');
        if (!aimWorldPos) {
            const casterPos = get3DPosition(selectedPiece.row, selectedPiece.col, 0);
            aimWorldPos = new THREE.Vector3(casterPos.x, 0.05, casterPos.z);
        } else {
            const casterPos = get3DPosition(selectedPiece.row, selectedPiece.col, 0);
            const dx = aimWorldPos.x - casterPos.x;
            const dz = aimWorldPos.z - casterPos.z;
            const d = Math.hypot(dx, dz);
            if (d > CANNON_RANGE) {
                const k = CANNON_RANGE / d;
                aimWorldPos.x = casterPos.x + dx * k;
                aimWorldPos.z = casterPos.z + dz * k;
                aimWorldPos.y = 0.05;
            }
        }
        updateAimTarget(aimWorldPos);
    }

    if (currentMode === 'multiplayer' && peerConnection?.open && selectedPiece) {
        peerConnection.send({ type: 'aim_start', fromR: selectedPiece.row, fromC: selectedPiece.col });
    }
}

function cancelAiming() {
    if (isAiming) {
        if (currentMode === 'multiplayer' && peerConnection?.open) peerConnection.send({ type: 'aim_cancel' });
    }
    isAiming = false;
    document.getElementById('aimHint').classList.remove('visible');
    document.getElementById('mobileCannonControls').classList.remove('active');
    resetJoystick();
    clearGhostLine();
    aimTargetPiece = null;
    aimValid = false;
    actionMode = 'move';
    clearSelectionAura();
    hideCannonRange();
    if (selectedPiece) {
        const hasAbility = pieceHasAbility(selectedPiece.piece);
        if (hasAbility) {
            const hasTargets = abilityTargets.length > 0;
            const cooldown = selectedPiece.piece.skillCooldown || 0;
            updateActionBar(true, hasTargets, cooldown);
        }
        showValidMoveHighlights(validMoves, selectedPiece.row, selectedPiece.col);
        document.getElementById('actionBar').classList.add('visible');
        document.getElementById('actionBar').style.display = 'flex';
    }
    updateActionButtonStates();
    hideRemoteAim();
}

function selectPiece(row, col) {
    const piece = gameState.getPiece(row, col);
    if (!piece || piece.color !== gameState.turn) return;
    if (!isPlayerTurn()) return;
    if (isAiming) cancelAiming();
    if (knightAbilityActive) cancelKnightAbilityMode();

    clearSelectionAura();

    selectedPiece = { row, col, piece };
    validMoves = gameState.getLegalMoves(row, col);
    abilityTargets = gameState.getLegalAbilities(row, col);

    const hasAbility = pieceHasAbility(piece);
    const hasTargets = abilityTargets.length > 0;

    // ★ Default cooldown comes from the piece's own skillCooldown field.
    //   Queen has two skills — take the smaller of the two so the button
    //   re-enables as soon as *either* skill is off cooldown.
    let cooldown = piece.skillCooldown || 0;
    if (piece.type === 'queen') {
        const c1 = piece.skillCooldown || 0;
        const c2 = piece.reviveCooldown || 0;
        cooldown = hasTargets ? 0 : ((c1 > 0 && c2 > 0) ? Math.min(c1, c2) : 0);
    }

    // ★ King — Domain Expansion uses kingSkillState
    //   (10-move cooldown, 3 total uses per match).
    if (piece.type === 'king') {
        if (kingSkillState.uses[piece.color] <= 0) {
            cooldown = 0;   // out of uses → targets empty, button stays disabled
        } else {
            const movesSince = gameState.fullMoveNumber - kingSkillState.lastUsedMove[piece.color];
            cooldown = Math.max(0, KING_DOMAIN_COOLDOWN - movesSince);
        }
    }
    hideCannonRange();

    if (hasAbility) updateActionBar(true, hasTargets, cooldown);
    else updateActionBar(false, false);

    actionMode = 'move';
    document.getElementById('aimHint').classList.remove('visible');
    hideGhostLine();
    showValidMoveHighlights(validMoves, row, col);
    updateActionButtonStates();

    if (pieceObjects[`${row},${col}`]) {
        selectedPiecePulse = 0;
        // ★ The aura is only created when the player switches to
        //   "特殊技能" mode (see setActionMode). Just picking a piece
        //   does NOT show the aura.
    }
}

function deselectPiece() {
    if (pendingRevive) cancelRevive();
    clearSelectionAura();
    if (isAiming) cancelAiming();
    if (knightAbilityActive) {
        knightAbilityActive = false;
        knightAbilityState = null;
        hideKnockbackArrows();
    }
    hideCannonRange();
    selectedPiece = null;
    validMoves = [];
    abilityTargets = [];
    actionMode = 'move';
    clearHighlights();
    updateActionBar(false, false);
    updateActionButtonStates();
    document.getElementById('aimHint').classList.remove('visible');
    updateCameraTargets();
}

// ============================================================
//  MOVE / ABILITY EXECUTION
// ============================================================
function attemptMove(fromR, fromC, toR, toC) {
    const move = validMoves.find(m => m.r === toR && m.c === toC);
    if (!move) return;
    const piece = gameState.getPiece(fromR, fromC);
    const isPromotion = piece.type === 'pawn' && (toR === 0 || toR === 7);
    if (isPromotion && (currentMode !== 'multiplayer' || isPlayerTurn())) {
        pendingPromotion = { fromR, fromC, toR, toC };
        document.getElementById('promotionOverlay').classList.remove('hidden');
        return;
    }
    executeMove(fromR, fromC, toR, toC, isPromotion ? 'queen' : null, move);
}

function showDamageEffect(r, c, damage) {
    const pieceState = gameState.getPiece(r, c);
    const pieceObj = pieceObjects[`${r},${c}`];
    showFloatingDamage(r, c, damage);
    if (pieceObj) {
        pieceObj.traverse(child => {
            if (child.isMesh && child !== pieceObj.userData.hpSprite) {
                if (child.userData.origColor === undefined) child.userData.origColor = child.material.color.getHex();
                child.material.color.setHex(0xff0000);
                setTimeout(() => {
                    if (child.material) {
                        const key = `${r},${c}`;
                        if (isAiming && lastAimedPieceKeys.has(key)) {
                            child.material.color.setHex(0xff3333);
                            if (child.material.emissive) {
                                child.material.emissive.setHex(0xff0000);
                                child.material.emissiveIntensity = 0.6;
                            }
                        } else {
                            child.material.color.setHex(child.userData.origColor);
                            if (child.material.emissive) {
                                child.material.emissive.setHex(0x000000);
                                child.material.emissiveIntensity = 0;
                            }
                        }
                    }
                }, 300);
            }
        });
        if (pieceState) updateHealthVisuals(r, c, pieceState.hp, pieceState.maxHp);
        else {
            updateHealthVisuals(r, c, 0, 100);
            pieceObj.scale.set(0.1, 0.1, 0.1);
            setTimeout(() => {
                if (pieceObj.parent) piecesGroup.remove(pieceObj);
                delete pieceObjects[`${r},${c}`];
            }, 300);
        }
    }
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
                    for (const p of trailParticles) scene.remove(p);
                    scene.remove(proj);
                    scene.remove(glow);
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

function executePawnAbility(fromR, fromC, toR, toC, ability, isRemote = false) {
    if (isAnimating) return;
    isAnimating = true;

    // ★ 讓施放技能的兵進入冷卻
    const casterPawn = gameState.getPiece(fromR, fromC);
    gameState.putOnSkillCooldown(casterPawn);

    const pieceObj = pieceObjects[`${fromR},${fromC}`];

    if (!pieceObj && isRemote) {
        const enemyColor = ability.damage > 0 ? (gameState.getPiece(fromR, fromC)?.color === 'white' ? 'black' : 'white') : null;
        const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        const targets = [];
        for (const [dr, dc] of directions) {
            const tr = fromR + dr, tc = fromC + dc;
            if (gameState.isInBounds(tr, tc)) {
                const target = gameState.getPiece(tr, tc);
                if (target && target.color === enemyColor) targets.push({ r: tr, c: tc });
            }
        }
        for (const t of targets) {
            const p = gameState.getPiece(t.r, t.c);
            if (p) {
                p.hp -= ability.damage;
                if (p.hp <= 0) gameState.board[t.r][t.c] = null;
                showFloatingDamage(t.r, t.c, ability.damage);
            }
        }
        const pawnPos = (fromR === toR && fromC === toC) ? { r: fromR, c: fromC } : { r: toR, c: toC };
        const pawn = gameState.getPiece(pawnPos.r, pawnPos.c);
        if (pawn) {
            pawn.hp -= ability.selfDamage;
            if (pawn.hp <= 0) gameState.board[pawnPos.r][pawnPos.c] = null;
            showFloatingDamage(pawnPos.r, pawnPos.c, ability.selfDamage);
        }
        gameState.flipTurn();
        gameState.moveHistory.push({
            type: 'ability', abilityName: ability.name,
            fromR, fromC, targetR: toR, targetC: toC,
            damageDealt: ability.damage, selfDamage: ability.selfDamage
        });
        deselectPiece();
        isAnimating = false;
        syncPiecesAfterMove();
        switchTimer(gameState.turn);
        checkGameStatus();
        updateTurnIndicator();
        if (!gameOverFlag) {
            updateCameraTargets();
            if (currentMode === 'ai' && gameState.turn !== playerColor && !kingSkillState.active) {
                aiThinking = true;
                setTimeout(makeAIMove, 500);
            }
        }
        return;
    }

    if (!pieceObj) { isAnimating = false; return; }

    if (fromR === toR && fromC === toC) {
        createCrossExplosion(toR, toC, ability.damage, ability.selfDamage, () => {
            const pawn = gameState.getPiece(toR, toC);
            if (pawn) {
                pawn.hp -= ability.selfDamage;
                if (pawn.hp <= 0) {
                    gameState.board[toR][toC] = null;
                    if (pieceObjects[`${toR},${toC}`]) {
                        piecesGroup.remove(pieceObjects[`${toR},${toC}`]);
                        delete pieceObjects[`${toR},${toC}`];
                    }
                    showFloatingDamage(toR, toC, ability.selfDamage);
                } else {
                    updateHealthVisuals(toR, toC, pawn.hp, pawn.maxHp);
                    showFloatingDamage(toR, toC, ability.selfDamage);
                }
            }
            gameState.flipTurn();
            gameState.moveHistory.push({
                type: 'ability', abilityName: ability.name,
                fromR, fromC, targetR: toR, targetC: toC,
                damageDealt: ability.damage, selfDamage: ability.selfDamage
            });
            deselectPiece();
            isAnimating = false;
            syncPiecesAfterMove();
            switchTimer(gameState.turn);
            checkGameStatus();
            updateTurnIndicator();
            if (!gameOverFlag) {
                updateCameraTargets();
                if (currentMode === 'ai' && gameState.turn !== playerColor && !kingSkillState.active) {
                    aiThinking = true;
                    setTimeout(makeAIMove, 500);
                }
                if (currentMode === 'multiplayer' && !isRemote) {
                    sendAbilityToPeer(fromR, fromC, [{ r: toR, c: toC }], ability.name, ability.damage, ability.selfDamage);
                }
            }
        });
        return;
    }

    const startPos = pieceObj.position.clone();
    const targetPos = get3DPosition(toR, toC, 0);
    const duration = 0.3;
    const startTime = clock.getElapsedTime();
    const animateMove = () => {
        const now = clock.getElapsedTime();
        const progress = Math.min((now - startTime) / duration, 1);
        const ease = t => t * (2 - t);
        const t = ease(progress);
        pieceObj.position.lerpVectors(startPos, targetPos, t);
        if (progress < 1) requestAnimationFrame(animateMove);
        else {
            pieceObj.position.copy(targetPos);
            const piece = gameState.getPiece(fromR, fromC);
            gameState.board[fromR][fromC] = null;
            gameState.board[toR][toC] = piece;
            piece.hasMoved = true;
            delete pieceObjects[`${fromR},${fromC}`];
            pieceObjects[`${toR},${toC}`] = pieceObj;
            pieceObj.userData.row = toR;
            pieceObj.userData.col = toC;
            createCrossExplosion(toR, toC, ability.damage, ability.selfDamage, () => {
                const pawn = gameState.getPiece(toR, toC);
                if (pawn) {
                    pawn.hp -= ability.selfDamage;
                    if (pawn.hp <= 0) {
                        gameState.board[toR][toC] = null;
                        if (pieceObjects[`${toR},${toC}`]) {
                            piecesGroup.remove(pieceObjects[`${toR},${toC}`]);
                            delete pieceObjects[`${toR},${toC}`];
                        }
                        showFloatingDamage(toR, toC, ability.selfDamage);
                    } else {
                        updateHealthVisuals(toR, toC, pawn.hp, pawn.maxHp);
                        showFloatingDamage(toR, toC, ability.selfDamage);
                    }
                }
                gameState.flipTurn();
                gameState.moveHistory.push({
                    type: 'ability', abilityName: ability.name,
                    fromR, fromC, targetR: toR, targetC: toC,
                    damageDealt: ability.damage, selfDamage: ability.selfDamage
                });
                deselectPiece();
                isAnimating = false;
                syncPiecesAfterMove();
                switchTimer(gameState.turn);
                checkGameStatus();
                updateTurnIndicator();
                if (!gameOverFlag) {
                    updateCameraTargets();
                    if (currentMode === 'ai' && gameState.turn !== playerColor && !kingSkillState.active) {
                        aiThinking = true;
                        setTimeout(makeAIMove, 500);
                    }
                    if (currentMode === 'multiplayer' && !isRemote) {
                        sendAbilityToPeer(fromR, fromC, [{ r: toR, c: toC }], ability.name, ability.damage, ability.selfDamage);
                    }
                }
            });
        }
    };
    animateMove();
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

function attemptAbility(fromR, fromC, targetR, targetC, ability, isRemote = false, reviveType = null) {
    if (isAnimating) return;

    playSFX('skill');

    const piece = gameState.getPiece(fromR, fromC);

    // ★ King — Domain Expansion (triggered by the skill button, no prompt)
    if (piece && piece.type === 'king' && ability.id === 'domain') {
        if (!gameState.isInCheck(piece.color)) return;
        if (kingSkillState.uses[piece.color] <= 0) return;
        const movesSince = gameState.fullMoveNumber - kingSkillState.lastUsedMove[piece.color];
        if (movesSince < KING_DOMAIN_COOLDOWN) return;

        const checker = findCheckingPieces(piece.color)
            .find(ch => ch.r === targetR && ch.c === targetC);
        if (!checker) return;

        // Clear selection UI before the domain takes over the screen
        deselectPiece();

        // Reset the pending-prompt context (no longer used)
        kingSkillState.context = { color: piece.color, checker };

        acceptDomainExpansion(piece.color, checker);
        return;
    }

    // ★ 皇后 — 治癒
    if (piece && piece.type === 'queen' && ability.id === 'heal') {
        executeQueenHeal(fromR, fromC, targetR, targetC, ability, isRemote);
        return;
    }

    // ★ 皇后 — 復活   ← 新增這段
    if (piece && piece.type === 'queen' && ability.id === 'revive') {
        executeQueenRevive(fromR, fromC, targetR, targetC, ability, reviveType, isRemote);
        return;
    }

    if (piece && piece.type === 'pawn' && ability.name === '衝鋒爆炸') {
        executePawnAbility(fromR, fromC, targetR, targetC, ability, isRemote);
        return;
    }

    // ★ 主教跳躍技能
    if (piece && piece.type === 'bishop' && ability.name === '炮躍 (Cannon Leap)') {
        executeBishopAbility(fromR, fromC, targetR, targetC, ability, isRemote);
        return;
    }

    if (piece && piece.type === 'knight') {
        const victims = getPushableVictims(gameState, targetR, targetC, fromR, fromC, piece.color);
        let opt = null;
        if (victims.length > 0) {
            const victim = victims[Math.floor(Math.random() * victims.length)];
            const openDirs = victim.directions.filter(d => !d.blocked);
            const pool = openDirs.length > 0 ? openDirs : victim.directions;
            const dir = pool[Math.floor(Math.random() * pool.length)];
            opt = {
                r: victim.r, c: victim.c,
                dirR: dir.dirR, dirC: dir.dirC,
                targetR: dir.targetR, targetC: dir.targetC,
                blocked: !!dir.blocked
            };
        }
        executeKnightAbilityMove(fromR, fromC, targetR, targetC, opt, isRemote);
        return;
    }

    isAnimating = true;
    // ★ 先結算傷害與冷卻，但把「切換回合」延到動畫播完再做
    gameState.useAbility(fromR, fromC, targetR, targetC, ability, true);
    const finishVisuals = () => {
        // ★ 動畫結束後才切換回合 — 冷卻數字從此刻起才隸屬於下一方
        gameState.flipTurn();
        deselectPiece();
        isAnimating = false;
        syncPiecesAfterMove();
        switchTimer(gameState.turn);
        checkGameStatus();
        if (!gameOverFlag) {
            updateCameraTargets();
            if (currentMode === 'ai' && gameState.turn !== playerColor && !kingSkillState.active) {
                aiThinking = true;
                setTimeout(makeAIMove, 500);
            }
            if (currentMode === 'multiplayer' && !isRemote) {
                sendAbilityToPeer(fromR, fromC, [{ r: targetR, c: targetC }], ability.name, ability.damage, 0);
            }
        }
        updateTurnIndicator();
    };

    if (ability.name.includes('Cannon')) {
        fireCannonVisual(fromR, fromC, targetR, targetC, ability.damage, finishVisuals);
    } else {
        showDamageEffect(targetR, targetC, ability.damage);
        setTimeout(finishVisuals, 400);
    }
}

function executeMove(fromR, fromC, toR, toC, promotionType, moveData, isRemote = false) {
    triggerBishopLeapFadeOut();
    if (isAnimating) return;
    isAnimating = true;

    const targetPiece = gameState.getPiece(toR, toC);

    if (targetPiece) {
        playSFX('capture');
        showDamageEffect(toR, toC, targetPiece.hp);
    } else {
        playSFX('move');
    }

    if (targetPiece) showDamageEffect(toR, toC, targetPiece.hp);
    const pieceObj = pieceObjects[`${fromR},${fromC}`];
    if (!pieceObj) { isAnimating = false; return; }
    const targetPos = get3DPosition(toR, toC, 0);
    const startPos = pieceObj.position.clone();
    const duration = 0.35;
    const startTime = clock.getElapsedTime();
    const isCapture = !!targetPiece;
    const animateMove = () => {
        const now = clock.getElapsedTime();
        const progress = Math.min((now - startTime) / duration, 1);
        const easeOutQuad = t => t * (2 - t);
        const t = easeOutQuad(progress);
        pieceObj.position.lerpVectors(startPos, targetPos, t);
        if (isCapture) pieceObj.position.y = Math.sin(t * Math.PI) * 0.5;
        if (progress < 1) requestAnimationFrame(animateMove);
        else {
            pieceObj.position.copy(targetPos);
            gameState.makeMove(fromR, fromC, toR, toC, promotionType);
            syncPiecesAfterMove();
            isAnimating = false;
            deselectPiece();

            switchTimer(gameState.turn);

            // ★ Send the move BEFORE the local game-status check so the opponent
            //   always learns about the final move (which may end the game).
            if (currentMode === 'multiplayer' && !isRemote) {
                sendMoveToPeer(fromR, fromC, toR, toC, promotionType);
            }

            checkGameStatus();
            if (!gameOverFlag) {
                updateCameraTargets();
                if (currentMode === 'ai' && gameState.turn !== playerColor && !kingSkillState.active) {
                    aiThinking = true;
                    setTimeout(makeAIMove, 500);
                }
            }
            updateTurnIndicator();
        }
    };
    animateMove();
}

function choosePromotion(type) {
    document.getElementById('promotionOverlay').classList.add('hidden');
    if (pendingPromotion) {
        const { fromR, fromC, toR, toC } = pendingPromotion;
        pendingPromotion = null;
        executeMove(fromR, fromC, toR, toC, type, null);
    }
}

function syncPiecesAfterMove() {
    for (const key of lastAimedPieceKeys) {
        const [r, c] = key.split(',').map(Number);
        setPieceHitEffect(r, c, false);
    }
    lastAimedPieceKeys.clear();
    createPieces3D();
}

function checkGameStatus() {
    const status = gameState.getGameStatus();
    if (status.over) {
        gameOverFlag = true;
        stopTimer();

        if (status.winner === 'draw') {
            playSFX('gameover');
        } else if (currentMode === 'ai' || currentMode === 'multiplayer') {
            if (status.winner === playerColor) playSFX('victory');
            else playSFX('gameover');
        } else {
            playSFX('victory');
        }

        document.getElementById('gameOverOverlay').classList.remove('hidden');
        document.getElementById('gameOverReason').textContent = status.reason;
        const text = document.getElementById('gameOverText');
        if (status.winner === 'draw') {
            text.textContent = '和局!';
            text.className = 'game-over-text draw';
        } else if (currentMode === 'ai' || currentMode === 'multiplayer') {
            if (status.winner === playerColor) {
                text.textContent = '你贏了!';
                text.className = 'game-over-text win';
            } else {
                text.textContent = '你輸了...';
                text.className = 'game-over-text lose';
            }
        } else {
            text.textContent = (status.winner === 'white' ? '白方' : '黑方') + ' 獲勝!';
            text.className = 'game-over-text win';
        }
        return;
    }

    // ★ KING PASSIVE — offer Domain Expansion whenever the
    //   current side's king is in check.
    if (!gameOverFlag && !kingSkillState.active) {
        maybeOfferDomainExpansion();
    }
}

function updateTurnIndicator() {
    const turnText = document.getElementById('turnText');
    const turnDot = document.getElementById('turnDot');
    if (gameState.turn === 'white') {
        turnText.textContent = currentMode === 'ai' && playerColor === 'black' ? 'AI 回合 (白)' : '白方回合';
        turnDot.className = 'turn-dot white';
    } else {
        turnText.textContent = currentMode === 'ai' && playerColor === 'white' ? 'AI 回合 (黑)' : '黑方回合';
        turnDot.className = 'turn-dot black';
    }
    updateTurnMessage();
    updateRoomCodeDisplay();
}

// ============================================================
//  Top Bar — show / hide / close (universal, all devices)
// ============================================================
//   showTopBar()  → 顯示選單（遊戲開始 / 回到對局時由遊戲邏輯呼叫）
//   hideTopBar()  → 隱藏選單（例如回主選單時由遊戲邏輯呼叫）
//   closeTopBar() → 玩家按下 ✕ ，隱藏選單但保留 ☰ 可以叫回來
//   updateTopBarReopenBtn() → 依目前狀態決定 ☰ 要不要出現
// ============================================================

function showTopBar() {
    if (!currentMode) return;

    document.getElementById('topBar')?.classList.remove('hidden');
    updateTopBarReopenBtn();
    requestAnimationFrame(updateFullscreenBtnPosition);
}

function hideTopBar() {
    document.getElementById('topBar')?.classList.add('hidden');
    updateTopBarReopenBtn();
    requestAnimationFrame(updateFullscreenBtnPosition);
}

/** 玩家按 ✕ */
function closeTopBar() {
    document.getElementById('topBar')?.classList.add('hidden');
    updateTopBarReopenBtn();
    requestAnimationFrame(updateFullscreenBtnPosition);
}

/** ☰ 只在「遊戲中 + 選單被關掉」時顯示 */
function updateTopBarReopenBtn() {
    const reopen = document.getElementById('topBarReopenBtn');
    const bar = document.getElementById('topBar');
    if (!reopen || !bar) return;

    const shouldShow = !!currentMode && bar.classList.contains('hidden');
    reopen.classList.toggle('hidden', !shouldShow);

    // ⛶ follows the ☰ state — but wait a tick so the ☰ has time to appear
    requestAnimationFrame(updateFullscreenBtnPosition);
}

function updateFullscreenBtnPosition() {
    const btn = document.getElementById('globalFullscreenBtn');
    const bar = document.getElementById('topBar');
    const reopen = document.getElementById('topBarReopenBtn');
    if (!btn) return;

    const barVisible = !!bar && !bar.classList.contains('hidden');
    const reopenVisible = !!reopen && !reopen.classList.contains('hidden');

    // ── 舊的 class 保留（給任何還依賴它們的樣式用） ──
    btn.classList.toggle('below-topbar', barVisible);
    btn.classList.toggle('below-reopen', !barVisible && reopenVisible);

    // ── 動態量測「應該從哪裡開始往下放」 ──
    let topPx = 10;   // fallback：選單畫面時回到最上方

    if (barVisible && bar) {
        // 用 getBoundingClientRect 拿「top bar 底部」的真實 viewport 座標
        const rect = bar.getBoundingClientRect();
        // +8 是留給按鈕和 top bar 之間的間距
        topPx = Math.round(rect.bottom + 8);
    } else if (reopenVisible && reopen) {
        const rect = reopen.getBoundingClientRect();
        topPx = Math.round(rect.bottom + 8);
    }

    // ── 直接寫 inline style，優先權高於任何 media query ──
    btn.style.top = topPx + 'px';
}

// ★ Alias — called from startAIGame / backToMenu / initNewGame.
//   Keeps the ☰ reopen button in sync whenever the top bar toggles.
function updateTopBarToggleVisibility() {
    updateTopBarReopenBtn();
}

// ============================================================
//  ★ Room code display in the top bar (multiplayer only)
// ============================================================
function updateRoomCodeDisplay() {
    const wrap = document.getElementById('roomCodeDisplay');
    const val = document.getElementById('roomCodeValue');
    if (!wrap || !val) return;

    const show = currentMode === 'multiplayer' && !!roomCode;
    wrap.classList.toggle('hidden', !show);
    if (show) val.textContent = roomCode;
}

// ============================================================
//  ★ Game-state serialization (for reconnect sync)
// ============================================================
function serializeGameState() {
    if (!gameState) return null;
    return {
        board: gameState.board.map(row => row.map(p => p ? { ...p } : null)),
        turn: gameState.turn,
        castlingRights: { ...gameState.castlingRights },
        enPassantTarget: gameState.enPassantTarget,
        moveHistory: gameState.moveHistory,
        halfMoveClock: gameState.halfMoveClock,
        fullMoveNumber: gameState.fullMoveNumber,
        initialPieces: gameState.initialPieces,
        kingSkillState: {
            uses: { ...kingSkillState.uses },
            lastUsedMove: { ...kingSkillState.lastUsedMove },
            // Never resume mid-domain-battle on reconnect — just abort it
            active: false,
            context: null,
        },
        timerState: {
            white: timerState.white,
            black: timerState.black,
            currentPlayer: timerState.currentPlayer,
            isInfinite: timerState.isInfinite,
        },
        roomSettings: { ...roomSettings },
    };
}

function applySerializedState(state) {
    if (!state) return;

    // Rebuild gameState without re-running initBoard()
    gameState = Object.create(ChessGame.prototype);
    gameState.board = state.board.map(row => row.map(p => p ? { ...p } : null));
    gameState.turn = state.turn;
    gameState.castlingRights = state.castlingRights;
    gameState.enPassantTarget = state.enPassantTarget || null;
    gameState.moveHistory = state.moveHistory || [];
    gameState.halfMoveClock = state.halfMoveClock || 0;
    gameState.fullMoveNumber = state.fullMoveNumber || 1;
    gameState.initialPieces = state.initialPieces || [];
    gameState.gameOver = false;
    gameState.gameResult = null;

    if (state.kingSkillState) {
        kingSkillState.uses = state.kingSkillState.uses;
        kingSkillState.lastUsedMove = state.kingSkillState.lastUsedMove;
        kingSkillState.active = false;
        kingSkillState.context = null;
    }
    if (state.timerState) {
        timerState.white = state.timerState.white;
        timerState.black = state.timerState.black;
        timerState.currentPlayer = state.timerState.currentPlayer;
        timerState.isInfinite = state.timerState.isInfinite;
    }
    if (state.roomSettings) {
        roomSettings = { ...state.roomSettings };
    }

    // Reset all transient state
    gameOverFlag = false;
    isAnimating = false;
    aiThinking = false;
    selectedPiece = null;
    validMoves = [];
    abilityTargets = [];
    actionMode = 'move';
    pendingPromotion = null;
    pendingRevive = null;
    knightAbilityActive = false;
    knightAbilityState = null;

    // Rebuild the 3D view
    createBoard3D();
    createPieces3D();
    resetCameraForPlayer();
    updateTurnIndicator();
    updateTimerDisplay();
    updateCameraTargets();
    clearHighlights();
    clearSelectionAura();
    hideCannonRange();
    hideKnockbackArrows();
    updateActionBar(false, false);

    // Show the timer if the game uses one
    if (roomSettings.timePerPlayer > 0) {
        document.getElementById('timerDisplay').style.display = 'flex';
    }
}

// ============================================================
//  ★ Reconnect overlay UI
// ============================================================
function showReconnectOverlay(isHostSide) {
    let overlay = document.getElementById('reconnectOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'reconnectOverlay';
        overlay.className = 'overlay';
        overlay.innerHTML = `
            <div class="panel" style="max-width: 440px; text-align:center;">
                <h2>📡 連線中斷</h2>
                <p id="reconnectMessage" style="opacity:0.9;">
                    <span class="reconnect-spinner"></span>
                    正在嘗試重新連線...
                </p>
                <p id="reconnectAttempt"
                   style="opacity:0.55; font-size:0.85rem; font-family:'Courier New',monospace;">
                    嘗試次數：0
                </p>
                <p id="reconnectRoomHint"
                   style="opacity:0.65; font-size:0.85rem; margin-top:10px;">
                </p>
                <div class="btn-row" style="margin-top:18px;">
                    <button class="btn btn-danger" onclick="giveUpReconnect()">
                        ✕ 放棄連線
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    overlay.classList.remove('hidden');

    const msg = document.getElementById('reconnectMessage');
    const hint = document.getElementById('reconnectRoomHint');
    if (isHostSide) {
        msg.innerHTML =
            `<span class="reconnect-spinner"></span>等待對手重新連線...`;
        if (hint) hint.textContent =
            `請對手使用房號 ${roomCode || '----'} 重新加入`;
    } else {
        msg.innerHTML =
            `<span class="reconnect-spinner"></span>正在嘗試重新連線至房主...`;
        if (hint) hint.textContent =
            `房號：${roomCode || '----'}`;
    }
}

function hideReconnectOverlay() {
    const overlay = document.getElementById('reconnectOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function updateReconnectAttempt(n) {
    const el = document.getElementById('reconnectAttempt');
    if (el) el.textContent = `嘗試次數：${n}`;
}

function giveUpReconnect() {
    isReconnecting = false;
    stopReconnectLoop();
    stopReconnectGraceTimer();
    hideReconnectOverlay();

    destroyPeer();
    gameOverFlag = true;
    stopTimer();

    document.getElementById('gameOverOverlay').classList.remove('hidden');
    document.getElementById('gameOverReason').textContent = '連線中斷（放棄重連）';
    const text = document.getElementById('gameOverText');
    if (isHost) {
        text.textContent = '對手已離線';
        text.className = 'game-over-text win';
    } else {
        text.textContent = '與房主的連線已中斷';
        text.className = 'game-over-text lose';
    }
}

// ============================================================
//  ★ Client-side reconnect loop
// ============================================================
function stopReconnectLoop() {
    if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
    }
}

function startClientReconnectLoop() {
    stopReconnectLoop();
    reconnectAttempts = 0;

    const attempt = () => {
        if (!isReconnecting) return;
        if (gameOverFlag) { stopReconnectLoop(); return; }

        reconnectAttempts++;
        updateReconnectAttempt(reconnectAttempts);

        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
            giveUpReconnect();
            return;
        }
        tryReconnectToHost();
    };

    // First attempt immediately, then every interval
    attempt();
    reconnectTimer = setInterval(attempt, RECONNECT_INTERVAL_MS);
}

function tryReconnectToHost() {
    if (!roomCode) return;

    // Tear down whatever is left over from the old session
    if (peerConnection) {
        try { peerConnection.close(); } catch (_) { }
        peerConnection = null;
    }
    if (peer) {
        try { peer.destroy(); } catch (_) { }
        peer = null;
    }

    peer = new Peer({ debug: 1, config: ICE_SERVERS });

    peer.on('open', () => {
        const targetId = PEER_ID_PREFIX + roomCode;
        const conn = peer.connect(targetId, { reliable: true });
        if (!conn) return;

        peerConnection = conn;
        setupPeerConnection();

        conn.on('open', () => {
            peerConnection.send({
                type: 'hello',
                color: playerColor,
                sessionId: clientSessionId,
                reconnecting: true,
            });
        });
    });

    peer.on('error', (err) => {
        // Silently retry — the interval will fire again
        console.warn('Reconnect attempt failed:', err.type);
    });
}

// ============================================================
//  ★ Host-side reconnect grace timer
// ============================================================
function stopReconnectGraceTimer() {
    if (reconnectGraceTimer) {
        clearTimeout(reconnectGraceTimer);
        reconnectGraceTimer = null;
    }
}

function startReconnectGraceTimer() {
    stopReconnectGraceTimer();
    reconnectGraceTimer = setTimeout(() => {
        if (!peerConnection || !peerConnection.open) {
            // Opponent never came back — end the game
            isReconnecting = false;
            hideReconnectOverlay();
            gameOverFlag = true;
            stopTimer();

            document.getElementById('gameOverOverlay').classList.remove('hidden');
            document.getElementById('gameOverReason').textContent =
                '對手已斷開連線（重連逾時）';
            const text = document.getElementById('gameOverText');
            text.textContent = '你贏了!';
            text.className = 'game-over-text win';
        }
    }, RECONNECT_GRACE_MS);
}

// Expose for the inline onclick
window.giveUpReconnect = giveUpReconnect;

function updateTurnMessage() {
    const el = document.getElementById('checkWarning');
    if (!el) return;
    if (currentMode === 'ai' || currentMode === 'multiplayer') {
        if (gameState.turn === playerColor) {
            el.textContent = '🎯 輪到你了!';
            el.style.display = 'inline-block';
        } else el.style.display = 'none';
    } else {
        el.textContent = gameState.turn === 'white' ? '⚪ 輪到白方!' : '⚫ 輪到黑方!';
        el.style.display = 'inline-block';
    }
}

// ============================================================
//  CAMERA
// ============================================================
function updateCameraTargets() {
    if (isFreeCameraActive) return;
    let tz = 0, tx = 0, ty = 8;
    if (currentMode === 'ai' || currentMode === 'multiplayer') {
        if (playerColor === 'black') { tz = -7; ty = 9; }
        else { tz = 7; ty = 9; }
    } else {
        if (gameState.turn === 'black') { tz = -7; ty = 9; }
        else { tz = 7; ty = 9; }
    }
    cameraTarget.pos.set(tx, ty, tz);
}

function resetCameraForPlayer() {
    if (playerColor === 'black') cameraTheta = Math.PI + 0.5;
    else cameraTheta = 0.5;
    cameraPhi = 0.8;
    cameraRadius = 12;
    isFreeCameraActive = true;
    updateFreeCamButton();
}

async function toggleFullscreen() {
    // If we're already in fullscreen → exit (and unlock orientation)
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        try {
            if (screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
            }
        } catch (_) { }
        if (document.exitFullscreen) await document.exitFullscreen().catch(() => { });
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
        return;
    }
    // Otherwise → enter
    _mobileFsAttempted = true;      // suppress the auto-listener for this tap
    await enterMobileFullscreen();
}

function toggleFreeCamera() {
    isFreeCameraActive = !isFreeCameraActive;
    updateFreeCamButton();
    if (!isFreeCameraActive) {
        updateCameraTargets();
        resetCameraForPlayer();
    }
}

// ============================================================
//  INPUT HANDLING
// ============================================================
function processInput(clientX, clientY) {
    if (isAnimating || aiThinking || gameOverFlag || !!pendingPromotion || pendingRevive || suppressClick) return;
    if (currentMode === 'multiplayer' && !isPlayerTurn()) return;

    if (knightAbilityActive) {
        mouse.x = (clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        const targets = [boardGroup, piecesGroup, highlightsGroup];
        if (knockbackArrowGroup) targets.push(knockbackArrowGroup);

        const intersects = raycaster.intersectObjects(targets, true);

        for (const inter of intersects) {
            let obj = inter.object;
            while (obj.parent && !obj.userData.type) obj = obj.parent;
            if (obj.userData.type === 'knockback-arrow') {
                const opt = obj.userData.option;
                executeKnightAbilityMove(
                    knightAbilityState.fromR, knightAbilityState.fromC,
                    knightAbilityState.landingR, knightAbilityState.landingC,
                    opt
                );
                return;
            }
        }

        if (knightAbilityState && knightAbilityState.victims.length > 0) {
            for (const inter of intersects) {
                let obj = inter.object;
                while (obj.parent && !obj.userData.type) obj = obj.parent;
                const t = obj.userData.type;
                if (t === 'knight-victim' || t === 'piece') {
                    const r = obj.userData.row;
                    const c = obj.userData.col;
                    const victim = knightAbilityState.victims.find(v => v.r === r && v.c === c);
                    if (victim) {
                        selectKnightVictim(r, c);
                        return;
                    }
                }
            }
        }

        for (const inter of intersects) {
            let obj = inter.object;
            while (obj.parent && !obj.userData.type) obj = obj.parent;
            if (obj.userData.type === 'knight-landing') {
                selectKnightLanding(obj.userData.row, obj.userData.col);
                return;
            }
        }

        if (knightAbilityState) {
            if (knightAbilityState.selectedVictim) {
                knightAbilityState.selectedVictim = null;
                hideKnockbackArrows();
                showKnightVictimHighlights(
                    knightAbilityState.victims,
                    knightAbilityState.landingR,
                    knightAbilityState.landingC,
                    knightAbilityState.fromR,
                    knightAbilityState.fromC,
                    null
                );
                document.getElementById('aimHint').innerHTML = '🎯 <b>步驟 2/3</b>：點擊要擊退的敵方棋子<br><span style="opacity:0.75;font-size:0.85rem;">紅色光環標示可被擊退的目標</span>';
                return;
            } else if (knightAbilityState.landingR !== null) {
                knightAbilityState.landingR = null;
                knightAbilityState.landingC = null;
                knightAbilityState.victims = [];
                const landings = getKnightPushLandings(gameState, knightAbilityState.fromR, knightAbilityState.fromC);
                showKnightLandingHighlights(landings, knightAbilityState.fromR, knightAbilityState.fromC);
                document.getElementById('aimHint').innerHTML = '🐴 <b>步驟 1/3</b>：選擇騎士要跳到的格子<br><span style="opacity:0.75;font-size:0.85rem;">只顯示 3×3 內有敵方棋子可被擊退的落點</span>';
                return;
            }
        }
        cancelKnightAbilityMode();
        return;
    }

    if (isAiming) {
        const aimData = getFreeAimPosition(clientX, clientY);
        if (aimData) {
            updateAimTarget(aimData.position);
            if (currentMode === 'multiplayer' && peerConnection?.open) {
                const now = Date.now();
                if (!aimMoveThrottleTimer || now - aimMoveThrottleTimer > AIM_SEND_THROTTLE) {
                    const dx = aimData.position.x - lastAimSendX;
                    const dz = aimData.position.z - lastAimSendZ;
                    if (Math.abs(dx) > 0.05 || Math.abs(dz) > 0.05) {
                        peerConnection.send({ type: 'aim_move', targetX: aimData.position.x, targetZ: aimData.position.z });
                        lastAimSendX = aimData.position.x;
                        lastAimSendZ = aimData.position.z;
                        aimMoveThrottleTimer = now;
                    }
                }
            }
        } else hideGhostLine();
        return;
    }

    mouse.x = (clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects([boardGroup, piecesGroup, highlightsGroup], true);
    if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj.parent && !obj.userData.type) obj = obj.parent;
        const data = obj.userData;

        if (data.type === 'highlight' && actionMode === 'move') {
            attemptMove(selectedPiece.row, selectedPiece.col, data.row, data.col);
        } else if (data.type === 'ability-target' && actionMode === 'attack') {
            const target = abilityTargets.find(t => t.r === data.row && t.c === data.col);
            if (target) handleAbilityTargetClick(target);
        } else if (data.type === 'square' && actionMode === 'attack' && selectedPiece) {
            const target = abilityTargets.find(t => t.r === data.row && t.c === data.col);
            if (target) handleAbilityTargetClick(target);
        } else if (data.type === 'piece') {
            const piece = gameState.getPiece(data.row, data.col);
            if (actionMode === 'attack' && selectedPiece) {
                const target = abilityTargets.find(t => t.r === data.row && t.c === data.col);
                if (target) {
                    handleAbilityTargetClick(target);
                    return;
                }
            }
            if (piece.color === gameState.turn && isPlayerTurn()) {
                selectPiece(data.row, data.col);
            } else if (selectedPiece && piece.color !== gameState.turn) {
                handleSquareClick(data.row, data.col);
            }
        }
    } else deselectPiece();
}

function handleSquareClick(row, col) {
    const target = abilityTargets.find(t => t.r === row && t.c === col);
    if (target && actionMode === 'attack') {
        handleAbilityTargetClick(target);
        return;
    }
    if (actionMode === 'move') attemptMove(selectedPiece.row, selectedPiece.col, row, col);
}

// ★ 統一的技能目標點擊處理（皇后復活需要先彈出選擇視窗）
function handleAbilityTargetClick(target) {
    const abilityId = target.ability && target.ability.id;
    if (abilityId === 'revive') {
        pendingRevive = {
            fromR: target.fromR, fromC: target.fromC,
            toR: target.r, toC: target.c,
        };
        showReviveChooser();
        return;
    }
    attemptAbility(target.fromR, target.fromC, target.r, target.c, target.ability);
}

function onClick(e) {
    if (touchActive || dragMoved) return;
    if (isAiming) {
        if (aimValid) fireAimedCannon();
        return;
    }
    processInput(e.clientX, e.clientY);
}

function onMouseDown(e) {
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    isDraggingCamera = e.button === 2 || isFreeCameraActive;
    dragMoved = false;
    if (e.button === 2 && isAiming) { cancelAiming(); e.preventDefault(); }
    if (e.button === 2 && knightAbilityActive) { cancelKnightAbilityMode(); e.preventDefault(); }
}

function onMouseUp(e) {
    isDraggingCamera = false;
    setTimeout(() => { suppressClick = false; }, 50);
}

function onMouseMove(e) {
    if (isAiming && !isDraggingCamera) {
        const aimData = getFreeAimPosition(e.clientX, e.clientY);
        if (aimData) {
            updateAimTarget(aimData.position);
            if (currentMode === 'multiplayer' && peerConnection?.open) {
                const now = Date.now();
                if (!aimMoveThrottleTimer || now - aimMoveThrottleTimer > AIM_SEND_THROTTLE) {
                    const dx = aimData.position.x - lastAimSendX;
                    const dz = aimData.position.z - lastAimSendZ;
                    if (Math.abs(dx) > 0.05 || Math.abs(dz) > 0.05) {
                        peerConnection.send({ type: 'aim_move', targetX: aimData.position.x, targetZ: aimData.position.z });
                        lastAimSendX = aimData.position.x;
                        lastAimSendZ = aimData.position.z;
                        aimMoveThrottleTimer = now;
                    }
                }
            }
        } else hideGhostLine();
        return;
    }
    if (isDraggingCamera) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) dragMoved = true;
        if (dragMoved && isFreeCameraActive) {
            cameraTheta -= dx * 0.008;
            cameraPhi -= dy * 0.008;
            cameraPhi = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, cameraPhi));
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            suppressClick = true;
        }
    }
}

function onTouchStart(e) {
    touchActive = true;
    if (e.touches.length === 1) {
        dragStartX = e.touches[0].clientX;
        dragStartY = e.touches[0].clientY;
        dragMoved = false;
    }
    if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        window._pinchStartDist = Math.sqrt(dx * dx + dy * dy);
        window._pinchStartRadius = cameraRadius;
        dragMoved = false;
    }
}

function onTouchMove(e) {
    if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const currentDist = Math.sqrt(dx * dx + dy * dy);
        if (window._pinchStartDist && window._pinchStartDist > 0 && currentDist > 0) {
            // ★ INVERTED: pinch-out (fingers apart, currentDist > start)
            //   → scale < 1 → smaller cameraRadius → zoom IN.
            //   Pinch-in (fingers together) → zoom OUT.
            const scale = window._pinchStartDist / currentDist;
            cameraRadius = Math.min(20, Math.max(4, window._pinchStartRadius * scale));
        }
        return;
    }
    if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - dragStartX;
        const dy = e.touches[0].clientY - dragStartY;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) dragMoved = true;
        if (dragMoved && isFreeCameraActive) {
            e.preventDefault();
            cameraTheta -= dx * 0.008;
            cameraPhi -= dy * 0.008;
            cameraPhi = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, cameraPhi));
            dragStartX = e.touches[0].clientX;
            dragStartY = e.touches[0].clientY;
        } else if (isAiming && !IS_MOBILE) {
            e.preventDefault();
            const aimData = getFreeAimPosition(e.touches[0].clientX, e.touches[0].clientY);
            if (aimData) {
                updateAimTarget(aimData.position);
                if (currentMode === 'multiplayer' && peerConnection?.open) {
                    const now = Date.now();
                    if (!aimMoveThrottleTimer || now - aimMoveThrottleTimer > AIM_SEND_THROTTLE) {
                        const dx2 = aimData.position.x - lastAimSendX;
                        const dz2 = aimData.position.z - lastAimSendZ;
                        if (Math.abs(dx2) > 0.05 || Math.abs(dz2) > 0.05) {
                            peerConnection.send({ type: 'aim_move', targetX: aimData.position.x, targetZ: aimData.position.z });
                            lastAimSendX = aimData.position.x;
                            lastAimSendZ = aimData.position.z;
                            aimMoveThrottleTimer = now;
                        }
                    }
                }
            }
        }
    }
}

function onTouchEnd(e) {
    setTimeout(() => { touchActive = false; }, 200);

    // ★ Remember whether this touchend came from a 2-finger pinch
    const wasPinching = (window._pinchStartDist !== null);

    window._pinchStartDist = null;
    window._pinchStartRadius = null;

    // ★ Pinch → single-finger transition:
    //   re-anchor the drag reference to the *remaining* finger so the next
    //   move doesn't compute `dx` against a stale position and jolt the camera.
    //   Also mark dragMoved so the eventual touchend doesn't fire a stray tap.
    if (wasPinching && e.touches && e.touches.length === 1) {
        dragStartX = e.touches[0].clientX;
        dragStartY = e.touches[0].clientY;
        dragMoved = true;
        return;
    }

    if (!dragMoved && e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        if (isAiming) {
            if (!IS_MOBILE && aimValid) fireAimedCannon();
        } else processInput(touch.clientX, touch.clientY);
    }
}

// ============================================================
//  RENDER LOOP
// ============================================================
function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = lastFrameTime ? Math.min((now - lastFrameTime) / 1000, 0.05) : 0.016;
    lastFrameTime = now;

    if (IS_MOBILE) updateJoystickAim(dt);

    updateSelectionAura();

    if (isFreeCameraActive) {
        const x = cameraRadius * Math.sin(cameraPhi) * Math.sin(cameraTheta);
        const y = cameraRadius * Math.cos(cameraPhi);
        const z = cameraRadius * Math.sin(cameraPhi) * Math.cos(cameraTheta);
        camera.position.set(x, Math.max(1, y), z);
        camera.lookAt(0, 0, 0);
    } else {
        cameraSmoothPos.lerp(cameraTarget.pos, 0.08);
        cameraSmoothLookAt.lerp(cameraTarget.lookat, 0.08);
        camera.position.copy(cameraSmoothPos);
        camera.lookAt(cameraSmoothLookAt);
    }

    if (highlightsGroup && highlightsGroup.userData.pulseMeshes) {
        const pulse = 0.5 + 0.5 * Math.sin((now / 1000) * 4);
        for (const mesh of highlightsGroup.userData.pulseMeshes) {
            const min = mesh.userData.minOpacity ?? 0;
            const max = mesh.userData.maxOpacity ?? 1;
            mesh.material.opacity = min + (max - min) * pulse;
        }
    }

    if (knockbackArrowGroup && knockbackArrowGroup.children.length > 0) {
        const bob = Math.sin(now / 300) * 0.08;
        for (const arrow of knockbackArrowGroup.children) {
            const base = arrow.userData.basePos;
            if (base) arrow.position.set(base.x, base.y + bob, base.z);
        }
    }

    // ★ DOMAIN EXPANSION — camera shake
    if (window._domainShake && window._domainShake.intensity > 0) {
        const s = window._domainShake.intensity;
        camera.position.x += (Math.random() - 0.5) * s;
        camera.position.y += (Math.random() - 0.5) * s * 0.5;
        camera.position.z += (Math.random() - 0.5) * s;
        camera.rotation.z += (Math.random() - 0.5) * s * 0.6;
    }

    renderer.render(scene, camera);
}

// ============================================================
//  MENU / UI FUNCTIONS
// ============================================================
function showAIDifficulty() {
    // ★ Refresh the toggle to its default state (skills ON) each time we open the menu
    const cb = document.getElementById('aiGameModeToggle');
    if (cb) cb.checked = true;
    aiGameModeEnabled = true;
    updateAIModeUI();

    // ★ Reset player colour choice to White
    aiPlayerColorChoice = 'white';
    document.querySelectorAll('#aiDifficultyMenu .ai-color-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.color === 'white');
    });

    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('aiDifficultyMenu').classList.remove('hidden');
}

function showMultiplayerSetup() {
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('aiDifficultyMenu').classList.add('hidden');
    document.getElementById('multiplayerMenu').classList.remove('hidden');
    document.getElementById('multiplayerStatus').textContent = '';
    document.getElementById('roomCodeInput').value = '';
}

function backToMenu() {
    if (pendingRevive) cancelRevive();
    stopTimer();
    destroyPeer();
    hideRemoteAim();
    hideCannonRange();
    hideKnockbackArrows();
    knightAbilityActive = false;
    knightAbilityState = null;
    settingsReceived = false;
    myReady = false;
    opponentReady = false;
    gameStarted = false;

    // ★ FIX: reset currentMode / gameOverFlag BEFORE touching the
    //         top bar and the ☰ reopen button, otherwise
    //         updateTopBarReopenBtn() sees the stale value
    //         ('ai' / 'multiplayer') and shows ☰ on the main menu.
    currentMode = null;
    gameOverFlag = false;

    document.getElementById('mainMenu').classList.remove('hidden');
    document.getElementById('aiDifficultyMenu').classList.add('hidden');
    document.getElementById('multiplayerMenu').classList.add('hidden');
    document.getElementById('roomSettings').classList.add('hidden');
    document.getElementById('waitingOverlay').classList.add('hidden');
    document.getElementById('gameOverOverlay').classList.add('hidden');
    document.getElementById('gameOverStatusBar')?.classList.add('hidden');
    document.getElementById('restartConfirmOverlay').classList.add('hidden');
    document.getElementById('backToMenuConfirmOverlay').classList.add('hidden');
    document.getElementById('battleSurrenderConfirmOverlay')?.classList.add('hidden');

    document.getElementById('settingsOverlay').classList.add('hidden');
    _settingsOpenedFrom = null;

    document.getElementById('topBar').classList.add('hidden');
    updateTopBarToggleVisibility();
    hideReconnectOverlay();
    isReconnecting = false;
    stopReconnectLoop();
    stopReconnectGraceTimer();
    hostKnownClientSessionId = null;
    try { localStorage.removeItem('chessRoomCode'); } catch (_) { }
    updateRoomCodeDisplay();

    document.getElementById('actionBar').classList.remove('visible');
    document.getElementById('aimHint').classList.remove('visible');
    if (boardGroup) scene.remove(boardGroup);
    if (piecesGroup) scene.remove(piecesGroup);
    clearHighlights();
    clearGhostLine();

    // ★ FIX (belt & suspenders): re-sync both floating buttons on the next
    //         frame, once all the classList changes above have settled.
    requestAnimationFrame(() => {
        updateTopBarReopenBtn();
        updateFullscreenBtnPosition();
    });
}

function backToMultiplayerMenu() {
    document.getElementById('roomSettings').classList.add('hidden');
    document.getElementById('multiplayerMenu').classList.remove('hidden');
}

function showRoomSettings() {
    roomSettings.gameMode = 'totally';
    roomSettings.abilityPermissions = { white: true, black: true };
    roomSettings.timePerPlayer = 300;
    document.getElementById('multiplayerMenu').classList.add('hidden');
    document.getElementById('roomSettings').classList.remove('hidden');
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.mode-btn[data-mode="totally"]').classList.add('active');
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.time-btn[data-time="300"]').classList.add('active');
    document.getElementById('abilityWhite').checked = true;
    document.getElementById('abilityBlack').checked = true;
    updateAbilitySettingsVisibility();
}

function setRoomGameMode(mode) {
    roomSettings.gameMode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    updateAbilitySettingsVisibility();
}

function updateAbilitySettingsVisibility() {
    const group = document.getElementById('abilitySettingsGroup');
    if (roomSettings.gameMode === 'totally') group.style.display = 'block';
    else group.style.display = 'none';
}

function setRoomTimeLimit(seconds) {
    roomSettings.timePerPlayer = seconds;
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.getAttribute('data-time')) === seconds);
    });
}

// ============================================================
//  PEERJS HELPERS
// ============================================================
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ]
};

const PEER_ID_PREFIX = 'chess-totally-';

function destroyPeer() {
    if (peerConnection) {
        try { peerConnection.close(); } catch (e) { console.warn(e); }
        peerConnection = null;
    }
    if (peer) {
        try { peer.destroy(); } catch (e) { console.warn(e); }
        peer = null;
    }
    if (settingsTimeout) {
        clearTimeout(settingsTimeout);
        settingsTimeout = null;
    }
}

function sendSettingsToPeer() {
    if (!peerConnection?.open) return;
    peerConnection.send({
        type: 'settings',
        settings: {
            gameMode: roomSettings.gameMode,
            abilityPermissions: roomSettings.abilityPermissions,
            timePerPlayer: roomSettings.timePerPlayer
        }
    });
}

function handleDisconnect() {
    if (gameOverFlag) return;

    const waitingStatusEl = document.getElementById('waitingStatus');
    if (waitingStatusEl) waitingStatusEl.textContent = '⚠️ 對手已斷開連線';

    // ── Lobby phase: nothing to preserve ──
    if (currentMode !== 'multiplayer' || !gameStarted) {
        return;
    }

    // ── In-game disconnect — pause and try to recover ──
    pauseTimer();
    isReconnecting = true;
    showReconnectOverlay(isHost);

    if (isHost) {
        // Keep our Peer ID alive; wait for the client to reconnect
        startReconnectGraceTimer();
    } else {
        // Try to re-establish the connection to the host
        startClientReconnectLoop();
    }
}

function createRoomWithSettings() {
    roomSettings.abilityPermissions.white = document.getElementById('abilityWhite').checked;
    roomSettings.abilityPermissions.black = document.getElementById('abilityBlack').checked;
    roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    isHost = true;
    playerColor = 'white';
    myReady = false;
    opponentReady = false;
    gameStarted = false;
    settingsReceived = true;

    destroyPeer();
    document.getElementById('roomSettings').classList.add('hidden');
    document.getElementById('waitingCodeDisplay').textContent = roomCode;
    document.getElementById('waitingOverlay').classList.remove('hidden');
    document.getElementById('waitingStatus').textContent = '⏳ 正在初始化連線...';
    updateReadyUI();
    updateRoomCodeDisplay();

    const hostId = PEER_ID_PREFIX + roomCode;
    peer = new Peer(hostId, { debug: 2, config: ICE_SERVERS });

    peer.on('open', (id) => {
        document.getElementById('waitingStatus').textContent = '⏳ 等待對手加入...';
    });

    const syncState = () => {
        sendSettingsToPeer();
        if (myReady && conn.open) conn.send({ type: 'ready' });
    };

    peer.on('connection', (conn) => {
        if (peerConnection && peerConnection.open) {
            conn.close();
            return;
        }
        peerConnection = conn;
        currentMode = 'multiplayer';

        // ★ If we were waiting for the client to come back, keep it that way
        //   until we see a matching sessionId in their hello message.
        //   (The hello handler decides whether to resume or start fresh.)

        setupPeerConnection();
        if (conn.open) syncState();
        else conn.on('open', syncState);
        updateReadyUI();
        document.getElementById('topBar').classList.remove('hidden');
        updateRoomCodeDisplay();
    });

    peer.on('error', (err) => {
        let msg = '⚠️ 創建房間失敗：' + (err.type || err.message);
        if (err.type === 'unavailable-id') msg = '⚠️ 房號衝突，請重新嘗試';
        else if (err.type === 'network') msg = '⚠️ 網路錯誤，請檢查連線';
        document.getElementById('waitingStatus').textContent = msg;
    });
    peer.on('disconnected', () => {
        setTimeout(() => {
            if (peer && !peer.destroyed) {
                try { peer.reconnect(); } catch (e) { console.warn(e); }
            }
        }, 1000);
    });
}

function joinRoom() {
    const code = document.getElementById('roomCodeInput').value.trim();
    if (!/^\d{4}$/.test(code)) {
        document.getElementById('multiplayerStatus').textContent = '⚠️ 請輸入完整的4位房號';
        return;
    }
    roomCode = code;
    isHost = false;
    playerColor = 'black';
    myReady = false;
    opponentReady = false;
    gameStarted = false;
    settingsReceived = false;
    document.getElementById('multiplayerStatus').textContent = '⏳ 正在初始化連線...';

    destroyPeer();
    peer = new Peer({ debug: 2, config: ICE_SERVERS });

    peer.on('open', (id) => {
        const targetId = PEER_ID_PREFIX + code;
        document.getElementById('multiplayerStatus').textContent = '🔄 正在連線到房號 ' + code + ' ...';
        const conn = peer.connect(targetId, { reliable: true });
        if (!conn) {
            document.getElementById('multiplayerStatus').textContent = '⚠️ 無法建立連線，請確認房號';
            return;
        }
        peerConnection = conn;
        setupPeerConnection();

        conn.on('open', () => {
            document.getElementById('multiplayerStatus').textContent = '✅ 連線成功！等待房間設定...';
            document.getElementById('waitingCodeDisplay').textContent = code;
            document.getElementById('waitingOverlay').classList.remove('hidden');
            document.getElementById('topBar').classList.remove('hidden');
            updateReadyUI();
            updateRoomCodeDisplay();

            // ★ Persist room code so we can attempt reconnection later
            try { localStorage.setItem('chessRoomCode', code); } catch (_) { }

            setTimeout(() => {
                if (peerConnection?.open) {
                    peerConnection.send({
                        type: 'hello',
                        color: playerColor,
                        sessionId: clientSessionId,
                        reconnecting: false,
                    });
                }
            }, 100);
        });

        conn.on('close', () => {
            handleDisconnect();
        });
        if (settingsTimeout) clearTimeout(settingsTimeout);
        settingsTimeout = setTimeout(() => {
            if (!settingsReceived && !gameStarted) {
                document.getElementById('waitingStatus').textContent = '⚠️ 等待房間設定超時，請確認房主仍在等待';
            }
        }, 15000);
    });
    peer.on('error', (err) => {
        let msg = '⚠️ 連線失敗: ' + (err.type || err.message);
        if (err.type === 'peer-unavailable') msg = '⚠️ 找不到該房號，請確認對方已創建房間';
        else if (err.type === 'network') msg = '⚠️ 網路錯誤，請檢查連線';
        document.getElementById('multiplayerStatus').textContent = msg;
        setTimeout(() => {
            document.getElementById('multiplayerStatus').textContent = '請輸入房號重新加入';
        }, 3000);
    });
    peer.on('disconnected', () => {
        setTimeout(() => {
            if (peer && !peer.destroyed) {
                try { peer.reconnect(); } catch (e) { console.warn(e); }
            }
        }, 1000);
    });
}

function setupPeerConnection() {
    peerConnection.on('data', (data) => {
        if (data.type === 'hello') {
            if (isHost) {
                const incomingSession = data.sessionId || null;
                const isReturningClient =
                    !!hostKnownClientSessionId &&
                    incomingSession === hostKnownClientSessionId;

                if (!hostKnownClientSessionId) {
                    // First ever client for this room
                    hostKnownClientSessionId = incomingSession;
                } else if (isReturningClient) {
                    // ★ Client is coming back — resume the existing game
                    console.log('🔁 Client reconnected with matching session');
                } else {
                    // Different session — treat as a brand-new client
                    console.warn('⚠️ New session connected to same room (replacing previous).');
                    hostKnownClientSessionId = incomingSession;
                }

                sendSettingsToPeer();
                if (myReady && peerConnection?.open) {
                    peerConnection.send({ type: 'ready' });
                }

                // ★ If the client reconnected mid-game, push the full state
                if (isReturningClient && gameStarted && gameState) {
                    const state = serializeGameState();
                    if (state && peerConnection?.open) {
                        peerConnection.send({ type: 'state_sync', state });
                    }

                    // Stop showing the "waiting for opponent" overlay on host
                    isReconnecting = false;
                    stopReconnectGraceTimer();
                    hideReconnectOverlay();
                    resumeTimer();
                    updateRoomCodeDisplay();
                }
            }
            return;
        }

        // ★ FIX — handle the opponent's "ready" signal.
        //   Without this, opponentReady is never set to true and
        //   checkBothReady() can never fire.
        if (data.type === 'ready') {
            opponentReady = true;
            updateReadyUI();
            checkBothReady();
            return;
        }

        if (data.type === 'settings') {
            if (settingsTimeout) { clearTimeout(settingsTimeout); settingsTimeout = null; }
            roomSettings = data.settings;
            settingsReceived = true;
            resetTimers(roomSettings.timePerPlayer);
            if (roomSettings.timePerPlayer <= 0) {
                timerState.isInfinite = true;
                document.getElementById('timerWhiteText').textContent = '∞';
                document.getElementById('timerBlackText').textContent = '∞';
                document.getElementById('timerWhiteText').classList.add('infinity');
                document.getElementById('timerBlackText').classList.add('infinity');
                stopTimer();
            } else {
                timerState.isInfinite = false;
                document.getElementById('timerWhiteText').classList.remove('infinity');
                document.getElementById('timerBlackText').classList.remove('infinity');
            }
            updateTimerDisplay();
            if (!isHost) {
                currentMode = 'multiplayer';
                const overlays = ['mainMenu', 'aiDifficultyMenu', 'multiplayerMenu', 'roomSettings'];
                overlays.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.classList.add('hidden');
                });
                document.getElementById('waitingCodeDisplay').textContent = roomCode;
                document.getElementById('waitingOverlay').classList.remove('hidden');
                document.getElementById('topBar').classList.remove('hidden');
                const statusEl = document.getElementById('multiplayerStatus');
                if (statusEl) statusEl.textContent = '';
                updateReadyUI();
            }
            return;
        }
        // ★ The host pushed us the current game state after a reconnect
        if (data.type === 'state_sync') {
            applySerializedState(data.state);

            // Reconnection succeeded — stop the retry loop
            isReconnecting = false;
            stopReconnectLoop();
            hideReconnectOverlay();
            resumeTimer();
            updateRoomCodeDisplay();

            // Flash a small success toast
            const toast = document.createElement('div');
            toast.textContent = '✅ 已重新連線';
            Object.assign(toast.style, {
                position: 'fixed',
                top: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: '950',
                background: 'rgba(46, 204, 113, 0.95)',
                color: '#fff',
                padding: '10px 24px',
                borderRadius: '12px',
                fontWeight: '900',
                letterSpacing: '1px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                transition: 'opacity 0.4s',
            });
            document.body.appendChild(toast);
            setTimeout(() => { toast.style.opacity = '0'; }, 1800);
            setTimeout(() => toast.remove(), 2400);

            return;
        }
        if (data.type === 'move') {
            executeMove(data.fromR, data.fromC, data.toR, data.toC, data.promotion, null, true);
            return;
        }

        // ★ 騎士擊退：複合訊息（含被阻擋的情況）
        if (data.type === 'knight_move') {
            executeKnightAbilityMove(
                data.fromR, data.fromC,
                data.landingR, data.landingC,
                data.knockback ? {
                    r: data.knockback.fromR,
                    c: data.knockback.fromC,
                    dirR: data.knockback.dirR,
                    dirC: data.knockback.dirC,
                    targetR: data.knockback.toR,
                    targetC: data.knockback.toC,
                    blocked: !!data.knockback.blocked
                } : null,
                true
            );
            return;
        }

        if (data.type === 'ability') {
            const abilityName = data.abilityName || '普通攻擊 (Strike)';
            const damage = (data.damage !== undefined && data.damage !== null) ? data.damage : 40;
            const selfDamage = data.selfDamage || 0;
            const targets = data.targets || [{ r: data.targetR, c: data.targetC }];
            const fromR = data.fromR;
            const fromC = data.fromC;

            // ★ 皇后治癒
            if (abilityName === '治癒 (Heal)' && targets.length > 0) {
                executeQueenHeal(
                    fromR, fromC, targets[0].r, targets[0].c,
                    { id: 'heal', name: abilityName, damage: 0, healAmount: 100 },
                    true
                );
                return;
            }

            // ★ 皇后復活
            if (abilityName === '復活 (Revive)' && targets.length > 0) {
                executeQueenRevive(
                    fromR, fromC, targets[0].r, targets[0].c,
                    { id: 'revive', name: abilityName, damage: 0 },
                    data.reviveType || null,
                    true
                );
                return;
            }

            if (abilityName === '衝鋒爆炸' && targets.length > 0) {
                const ability = { name: abilityName, damage, selfDamage };
                const firstTarget = targets[0];
                if (firstTarget) executePawnAbility(fromR, fromC, firstTarget.r, firstTarget.c, ability, true);
                return;
            }
            const ability = { name: abilityName, damage, selfDamage: selfDamage || 0 };
            for (const t of targets) attemptAbility(fromR, fromC, t.r, t.c, ability, true);
            return;
        }
        // ★ Opponent is expanding their domain — watch the animation
        if (data.type === 'domain_start') {
            const color = data.color;
            const checkerPiece = gameState.board[data.checkerR][data.checkerC];
            if (checkerPiece) {
                kingSkillState.uses[color] = Math.max(0, kingSkillState.uses[color] - 1);
                kingSkillState.lastUsedMove[color] = gameState.fullMoveNumber;
                kingSkillState.active = true;
                const checker = { r: data.checkerR, c: data.checkerC, piece: checkerPiece };
                kingSkillState.context = { color, checker };
                // Play the visuals only — the defender's side decides the outcome
                startDomainExpansion(color, checker);
            }
            return;
        }

        // ★ Opponent picked their RPS choice — store it and try to resolve
        if (data.type === 'domain_choice') {
            onOpponentChoiceReceived(data.choice);
            return;
        }

        // ★ Opponent surrendered the domain battle
        if (data.type === 'domain_surrender') {
            onOpponentSurrenderReceived(data.role);
            return;
        }

        if (data.type === 'domain_result') {
            if (data.winner === 'attacker') {
                // The attacker (us) won — the defender's king died
                gameOverFlag = true;
                stopTimer();
                document.getElementById('gameOverOverlay').classList.remove('hidden');
                document.getElementById('gameOverReason').textContent = '對手國王在領域對決中敗北';
                document.getElementById('gameOverText').textContent = '你贏了!';
                document.getElementById('gameOverText').className = 'game-over-text win';
            } else if (data.winner === 'defender') {
                // Our checker was killed — remove it from our board.
                // Guarded so it's a no-op if our own kill animation
                // already removed it.
                const r = data.checkerR, c = data.checkerC;
                if (r !== undefined && c !== undefined && gameState.board[r][c]) {
                    gameState.board[r][c] = null;
                    gameState.moveHistory.push({ type: 'domain_kill', r, c });
                    syncPiecesAfterMove();
                }

                // ★ 領域展開算一步棋 — 遠端也要同步翻轉回合
                gameState.flipTurn();

                kingSkillState.active = false;
                kingSkillState.context = null;
                battleState = null;
                isAnimating = false;
                updateTurnIndicator();
                checkGameStatus();
            }
            return;
        }

        if (data.type === 'rematch') {
            document.getElementById('gameOverOverlay').classList.add('hidden');
            resetTimers(roomSettings.timePerPlayer);
            initNewGame();
            return;
        }
        if (data.type === 'gameover') {
            gameOverFlag = true;
            stopTimer();
            document.getElementById('gameOverOverlay').classList.remove('hidden');
            document.getElementById('gameOverReason').textContent = '對手認輸或投降';
            document.getElementById('gameOverText').textContent = '你贏了!';
            document.getElementById('gameOverText').className = 'game-over-text win';
            return;
        }
        if (data.type === 'aim_start') {
            remoteAimFromR = data.fromR;
            remoteAimFromC = data.fromC;
            const pos = get3DPosition(data.fromR, data.fromC, 0.6);
            pos.project(camera);
            const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
            const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
            const indicator = document.getElementById('remoteAimIndicator');
            indicator.style.display = 'block';
            indicator.style.left = (x - 25) + 'px';
            indicator.style.top = (y - 25) + 'px';
            indicator.style.width = '50px';
            indicator.style.height = '50px';
            if (data.targetX !== undefined && data.targetZ !== undefined) {
                updateRemoteAimPosition(data.targetX, data.targetZ);
            } else {
                document.getElementById('remoteAimLine').style.display = 'none';
                remoteAimActive = true;
            }
            if (remoteAimTimer) clearTimeout(remoteAimTimer);
            remoteAimTimer = setTimeout(() => hideRemoteAim(), 10000);
            return;
        }
        if (data.type === 'aim_move') {
            updateRemoteAimPosition(data.targetX, data.targetZ);
            if (remoteAimTimer) {
                clearTimeout(remoteAimTimer);
                remoteAimTimer = setTimeout(() => hideRemoteAim(), 10000);
            }
            return;
        }
        if (data.type === 'aim_cancel') { hideRemoteAim(); return; }
        if (data.type === 'aim_fire') {
            const targets = data.targets || [];
            playRemoteCannonFire(data.fromR, data.fromC, data.targetX, data.targetZ, targets, data.damage || ABILITIES.rook.damage);
            return;
        }
    });
    peerConnection.on('close', () => handleDisconnect());
    peerConnection.on('error', (err) => console.error('❌ 資料通道錯誤:', err));
}

function cancelWaiting() {
    destroyPeer();
    myReady = false;
    opponentReady = false;
    gameStarted = false;

    isReconnecting = false;
    stopReconnectLoop();
    stopReconnectGraceTimer();
    hideReconnectOverlay();
    hostKnownClientSessionId = null;
    try { localStorage.removeItem('chessRoomCode'); } catch (_) { }

    document.getElementById('waitingOverlay').classList.add('hidden');
    document.getElementById('multiplayerMenu').classList.remove('hidden');
    updateRoomCodeDisplay();
}

function setReady() {
    if (myReady || gameStarted) return;
    myReady = true;
    updateReadyUI();
    if (peerConnection?.open) peerConnection.send({ type: 'ready' });
    checkBothReady();
}

function updateReadyUI() {
    const myDot = document.getElementById('myReadyDot');
    const myText = document.getElementById('myReadyText');
    const oppDot = document.getElementById('opponentReadyDot');
    const oppText = document.getElementById('opponentReadyText');
    const status = document.getElementById('waitingStatus');
    const btn = document.getElementById('readyBtn');

    if (myReady) {
        myDot.className = 'ready-dot ready';
        myText.textContent = '已準備 ✓';
        btn.disabled = true;
        btn.textContent = '✅ 已準備';
    } else {
        myDot.className = 'ready-dot not-ready';
        myText.textContent = '未準備';
        btn.disabled = false;
        btn.textContent = '✅ 準備';
    }

    const isOpponentConnected = !!peerConnection;
    if (opponentReady) {
        oppDot.className = 'ready-dot ready';
        oppText.textContent = '已準備 ✓';
    } else if (isOpponentConnected) {
        oppDot.className = 'ready-dot waiting';
        oppText.textContent = '等待準備...';
    } else {
        oppDot.className = 'ready-dot waiting';
        oppText.textContent = '等待加入...';
    }

    if (myReady && opponentReady) {
        status.textContent = '🎮 雙方已準備！遊戲即將開始...';
        status.style.color = '#2ecc71';
    } else if (opponentReady) {
        status.textContent = '👤 對手已準備，請點擊「準備」開始！';
        status.style.color = '#f1c40f';
    } else if (myReady) {
        status.textContent = '⏳ 等待對手準備...';
        status.style.color = '#f1c40f';
    } else if (isOpponentConnected) {
        status.textContent = '👥 對手已加入！請點擊「準備」開始';
        status.style.color = '#f0e6d3';
    } else {
        status.textContent = '⏳ 等待對手加入...';
        status.style.color = '#f0e6d3';
    }
}

function checkBothReady() {
    if (myReady && opponentReady && !gameStarted) {
        gameStarted = true;
        setTimeout(() => {
            if (currentMode === 'multiplayer') {
                document.getElementById('waitingOverlay').classList.add('hidden');
                document.getElementById('topBar').classList.remove('hidden');
                initNewGame();
            }
        }, 300);
    }
}

function sendMoveToPeer(fromR, fromC, toR, toC, promotion) {
    if (peerConnection?.open) peerConnection.send({ type: 'move', fromR, fromC, toR, toC, promotion });
}

function sendAbilityToPeer(fromR, fromC, targets, abilityName, damage, selfDamage, reviveType) {
    if (peerConnection?.open) {
        const targetList = Array.isArray(targets) ? targets : [targets];
        peerConnection.send({
            type: 'ability',
            fromR, fromC,
            targets: targetList,
            abilityName: abilityName || '普通攻擊 (Strike)',
            damage: damage ?? 40,
            selfDamage: selfDamage || 0,
            reviveType: reviveType || null,
        });
    }
}

// ============================================================
//  GAME INIT / RESTART
// ============================================================
function startAIGame(difficulty) {
    // aiDifficulty is declared in ai.js (loaded after main.js)
    aiDifficulty = difficulty;
    currentMode = 'ai';

    // ★ Use the player's colour choice from the menu
    playerColor = aiPlayerColorChoice;

    // ★ Read mode from the toggle switch
    roomSettings.gameMode = aiGameModeEnabled ? 'totally' : 'normal';
    roomSettings.abilityPermissions = { white: true, black: true };
    roomSettings.timePerPlayer = 0;

    aiPassivityTracker.opponentPassiveTurns = 0;

    gameState = new ChessGame();
    resetKingSkillState();
    gameOverFlag = false;
    aiThinking = false;

    createBoard3D();
    createPieces3D();

    document.getElementById('aiDifficultyMenu').classList.add('hidden');
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('topBar').classList.remove('hidden');
    updateTopBarToggleVisibility();

    document.getElementById('timerDisplay').style.display = 'none';
    resetCameraForPlayer();
    stopTimer();
    updateTurnIndicator();

    // ★ NEW — If the human chose Black, the AI (White) must make the opening move.
    if (currentMode === 'ai' && gameState.turn !== playerColor && !kingSkillState.active) {
        aiThinking = true;
        setTimeout(makeAIMove, 500);
    }
}

function confirmBackToMenu() {
    const overlay = document.getElementById('backToMenuConfirmOverlay');
    if (!overlay) { backToMenu(); return; }   // safety fallback
    overlay.classList.remove('hidden');
}

function cancelBackToMenuConfirm() {
    const overlay = document.getElementById('backToMenuConfirmOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function doBackToMenuConfirm() {
    const overlay = document.getElementById('backToMenuConfirmOverlay');
    if (overlay) overlay.classList.add('hidden');
    backToMenu();
}

function restartGame() {
    document.getElementById('gameOverOverlay').classList.add('hidden');
    document.getElementById('gameOverStatusBar')?.classList.add('hidden');   // ★ NEW
    resetTimers(roomSettings.timePerPlayer);
    initNewGame();
    if (currentMode === 'multiplayer' && peerConnection?.open) {
        peerConnection.send({ type: 'rematch' });
    }
}

// ============================================================
//  ★ Game Over — "view final board" mode
//  Hides the game-over overlay and shows a small floating bar
//  with the result + reason so the player can inspect the
//  final board freely (camera drag / pinch-zoom still works).
// ============================================================
function viewFinalBoard() {
    const overlay = document.getElementById('gameOverOverlay');
    if (overlay) overlay.classList.add('hidden');

    const textEl = document.getElementById('gameOverText');
    const reasonEl = document.getElementById('gameOverReason');
    const bar = document.getElementById('gameOverStatusBar');
    const barResult = document.getElementById('gameOverStatusResult');
    const barReason = document.getElementById('gameOverStatusReason');

    if (barResult && textEl) {
        barResult.textContent = (textEl.textContent || '遊戲結束').trim();

        // Carry over win / lose / draw class from the overlay text
        const extra = (textEl.className || '')
            .replace('game-over-text', '')
            .trim();
        barResult.className =
            'game-over-status-result' + (extra ? ' ' + extra : '');
    }

    if (barReason && reasonEl) {
        const r = (reasonEl.textContent || '').trim();
        barReason.textContent = r ? '· ' + r : '';
    }

    if (bar) bar.classList.remove('hidden');
}

function showGameOverMenu() {
    const bar = document.getElementById('gameOverStatusBar');
    if (bar) bar.classList.add('hidden');

    const overlay = document.getElementById('gameOverOverlay');
    if (overlay) overlay.classList.remove('hidden');
}

// ============================================================
//  Restart confirmation dialog
//  (wired to the 🔄 重開 button in the top bar)
// ============================================================
function confirmRestart() {
    const overlay = document.getElementById('restartConfirmOverlay');
    if (!overlay) { restartGame(); return; }   // safety fallback
    overlay.classList.remove('hidden');
}

function cancelRestartConfirm() {
    const overlay = document.getElementById('restartConfirmOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function doRestartConfirm() {
    const overlay = document.getElementById('restartConfirmOverlay');
    if (overlay) overlay.classList.add('hidden');
    restartGame();
}

function initNewGame() {
    document.getElementById('topBar').classList.remove('hidden');
    document.getElementById('gameOverStatusBar')?.classList.add('hidden');
    updateTopBarToggleVisibility();
    updateRoomCodeDisplay();

    gameState = new ChessGame();
    resetKingSkillState();
    gameOverFlag = false;
    selectedPiece = null;
    validMoves = [];
    abilityTargets = [];
    actionMode = 'move';
    isAnimating = false;
    aiThinking = false;
    pendingPromotion = null;
    if (isAiming) cancelAiming();
    if (knightAbilityActive) {
        knightAbilityActive = false;
        knightAbilityState = null;
        hideKnockbackArrows();
    }
    hideRemoteAim();
    hideCannonRange();
    updateActionButtonStates();

    if (currentMode === 'multiplayer') {
        document.getElementById('timerDisplay').style.display = 'flex';
        if (settingsReceived) {
            resetTimers(roomSettings.timePerPlayer);
            if (roomSettings.timePerPlayer <= 0) {
                timerState.isInfinite = true;
                document.getElementById('timerWhiteText').textContent = '∞';
                document.getElementById('timerBlackText').textContent = '∞';
                document.getElementById('timerWhiteText').classList.add('infinity');
                document.getElementById('timerBlackText').classList.add('infinity');
                stopTimer();
            }
        } else {
            stopTimer();
            timerState.isInfinite = false;
            document.getElementById('timerWhiteText').textContent = '--:--';
            document.getElementById('timerBlackText').textContent = '--:--';
            document.getElementById('timerWhiteText').classList.remove('infinity');
            document.getElementById('timerBlackText').classList.remove('infinity');
        }
        updateTimerDisplay();
    } else {
        document.getElementById('timerDisplay').style.display = 'none';
        stopTimer();
    }

    createBoard3D();
    createPieces3D();
    resetCameraForPlayer();
    updateTurnIndicator();
    updateCameraTargets();

    if (currentMode === 'multiplayer' && settingsReceived && roomSettings.timePerPlayer > 0) {
        timerState.currentPlayer = 'white';
        startTimer();
    }
    if (currentMode === 'ai' && gameState.turn !== playerColor && !kingSkillState.active) {
        aiThinking = true;
        setTimeout(makeAIMove, 500);
    }
}

// ============================================================
//  ★ Developer Console Tool — open chess editor in a new tab
//  Usage (in DevTools console):
//      openChessEditor()
//      openChessEditor('someOtherEditor.html')
// ============================================================
window.openChessEditor = function (filename = 'chessEditor.html') {
    const url = new URL(filename, window.location.href);

    // If a game is currently in progress, carry the board state over
    // so the editor can pre-load the exact position.
    if (typeof gameState !== 'undefined' && gameState && Array.isArray(gameState.board)) {
        try {
            url.hash = 'board=' + encodeBoardStateForEditor(gameState.board) +
                '&turn=' + (gameState.turn || 'white');
        } catch (err) {
            console.warn('⚠️ 無法序列化棋盤狀態:', err);
        }
    }

    const win = window.open(url.href, '_blank', 'noopener');
    if (!win) {
        console.warn('⚠️ 瀏覽器阻擋了彈出視窗，請允許本站彈出視窗後再試一次。');
    }
    return win;
};

/**
 * Encode the 8x8 board array into a compact FEN-style string.
 * Example: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"
 *   - lowercase = black piece
 *   - UPPERCASE = white piece
 *   - digits    = consecutive empty squares
 *
 * This is the board portion of FEN — the editor can parse it
 * and reconstruct the position. Read it back with:
 *     new URLSearchParams(location.hash.slice(1)).get('board')
 */
function encodeBoardStateForEditor(board) {
    const LETTER = {
        king: 'k',
        queen: 'q',
        rook: 'r',
        bishop: 'b',
        knight: 'n',
        pawn: 'p',
    };

    const rows = [];
    for (let r = 0; r < 8; r++) {
        let row = '';
        let emptyRun = 0;

        for (let c = 0; c < 8; c++) {
            const p = board[r][c];
            if (!p) {
                emptyRun++;
                continue;
            }
            if (emptyRun > 0) { row += emptyRun; emptyRun = 0; }
            const ch = LETTER[p.type] || '?';
            row += (p.color === 'white') ? ch.toUpperCase() : ch;
        }

        if (emptyRun > 0) row += emptyRun;
        rows.push(row);
    }
    return rows.join('/');
}

// ============================================================
//  ★ Console Help Banner
//  Lists every developer console command available.
// ============================================================
window.chessHelp = function () {
    const gold = 'color:#e8c547; font-weight:bold; font-size:13px;';
    const title = 'color:#e8c547; font-weight:bold; font-size:16px;';
    const cmd = 'color:#7ac8ff; font-weight:bold; font-family:monospace;';
    const desc = 'color:#f0e6d3; font-family:monospace;';
    const dim = 'color:#888; font-style:italic; font-family:monospace;';

    console.log('%c♞ 西洋棋 — 開發者指令列表', title);
    console.log('%c─────────────────────────────────────────', gold);

    // ── Editor / Tools ──
    console.log('%c📝 編輯器 / 工具', gold);
    console.log('  %copenChessEditor(filename?)%c  → 在新分頁開啟棋盤編輯器', cmd, desc);
    console.log('  %copenChessEditor()%c  → 在新分頁開啟棋盤編輯器', cmd, desc);
    console.log('  %c                              %c     預設檔名: chessEditor.html', dim, desc);
    console.log('  %c                              %c     會附帶當前棋盤狀態 (board=…&turn=…)', dim, desc);

    // ── Game State ──
    console.log('%c🎮 遊戲狀態', gold);
    console.log('  %cgameState%c                   → 當前 ChessGame 物件 (棋盤、回合、歷史…)', cmd, desc);
    console.log('  %ccurrentMode%c                 → 目前模式: "ai" | "multiplayer" | null', cmd, desc);
    console.log('  %cplayerColor%c                 → 你的顏色: "white" | "black"', cmd, desc);
    console.log('  %caiDifficulty%c                → AI 難度: "noob" | "easy" | "hard"', cmd, desc);
    console.log('  %croomSettings%c                → 房間設定 (模式、時間、技能權限)', cmd, desc);

    // ── Debug ──
    console.log('%c🐞 除錯 / 除錯用', gold);
    console.log('  %cprintBoard()%c                → 在 console 以文字印出棋盤', cmd, desc);
    console.log('  %ctoggleShadows()%c             → 開關陰影 (效能測試用)', cmd, desc);
    console.log('  %cgetFPS()%c                    → 顯示目前 FPS', cmd, desc);

    // ── Modifiers (dangerous) ──
    console.log('%c⚠️  危險指令 (會改變遊戲狀態)', '#e74c3c');
    console.log('  %csetTurn("white"|"black")%c    → 強制切換回合', cmd, desc);
    console.log('  %chealAll()%c                   → 將所有棋子補滿 HP', cmd, desc);
    console.log('  %cclearBoard()%c                → 清空棋盤 (慎用)', cmd, desc);
    console.log('  %cforceWin()%c                  → 立即強制獲勝（結束對局）', cmd, desc);
    console.log('  %cforceLose()%c                 → 立即強制認輸（結束對局）', cmd, desc);

    console.log('%c─────────────────────────────────────────', gold);
    console.log('%c輸入 chessHelp() 可再次顯示此列表', dim);

    // ── Domain Expansion ──
    console.log('%c👑 領域展開 (Domain Expansion)', gold);
    console.log('  %cforceDomainExpansion(color?, type?)%c → 強制觸發國王領域展開', cmd, desc);
    console.log('  %cforceDomainExpansion()%c', cmd, desc);
    console.log('  %c                                    %c     color: "white" | "black" (預設當前回合)', dim, desc);
    console.log('  %c                                    %c     type : 敵方棋子類型 (e.g. "queen", 預設隨機)', dim, desc);
};

// Auto-print the banner once on page load
window.addEventListener('load', () => {
    // Slight delay so it prints after Three.js init logs
    setTimeout(() => window.chessHelp(), 200);
});

window.chooseRevive = chooseRevive;
window.cancelRevive = cancelRevive;

// ============================================================
//  ★ Optional Debug Helpers
// ============================================================

// Pretty-print the board in the console
window.printBoard = function () {
    if (!gameState) return console.warn('⚠️ 沒有進行中的遊戲');
    const GLYPH = {
        white: { king: '♔', queen: '♕', rook: '♖', bishop: '♗', knight: '♘', pawn: '♙' },
        black: { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' },
    };
    let out = '\n   A B C D E F G H\n';
    for (let r = 0; r < 8; r++) {
        out += (8 - r) + '  ';
        for (let c = 0; c < 8; c++) {
            const p = gameState.board[r][c];
            out += (p ? GLYPH[p.color][p.type] : '·') + ' ';
        }
        out += ' ' + (8 - r) + '\n';
    }
    out += '   A B C D E F G H\n';
    console.log('%c' + out, 'font-family:monospace; font-size:14px; color:#e8c547;');
    console.log(`  回合: %c${gameState.turn}%c  |  歷史步數: ${gameState.moveHistory.length}`,
        'color:#7ac8ff; font-weight:bold;', 'color:#f0e6d3;');
};

// Toggle shadows for perf testing
window.toggleShadows = function () {
    if (!renderer) return;
    const on = !renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = on;
    renderer.shadowMap.needsUpdate = true;
    scene.traverse(n => { if (n.material) n.material.needsUpdate = true; });
    console.log(`陰影: %c${on ? '開啟' : '關閉'}`,
        on ? 'color:#2ecc71;font-weight:bold;' : 'color:#e74c3c;font-weight:bold;');
};

// Simple FPS meter
window.getFPS = function (samples = 60) {
    let frames = 0;
    const start = performance.now();
    let raf;
    const tick = () => {
        frames++;
        const elapsed = performance.now() - start;
        if (frames >= samples) {
            const fps = (frames / elapsed) * 1000;
            console.log(`FPS: %c${fps.toFixed(1)}`,
                'color:#7ac8ff;font-weight:bold;font-size:14px;');
            return;
        }
        raf = requestAnimationFrame(tick);
    };
    tick();
};

// Force turn switch
window.setTurn = function (color) {
    if (!gameState) return console.warn('⚠️ 沒有進行中的遊戲');
    if (color !== 'white' && color !== 'black')
        return console.warn('⚠️ 用法: setTurn("white") 或 setTurn("black")');
    gameState.turn = color;
    updateTurnIndicator();
    console.log(`回合已切換為: %c${color}`, 'color:#e8c547;font-weight:bold;');
};

// Heal everything
window.healAll = function () {
    if (!gameState) return console.warn('⚠️ 沒有進行中的遊戲');
    let count = 0;
    for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++) {
            const p = gameState.board[r][c];
            if (p) { p.hp = p.maxHp; count++; }
        }
    syncPiecesAfterMove();
    console.log(`已補滿 %c${count}%c 個棋子`, 'color:#2ecc71;font-weight:bold;', 'color:#f0e6d3;');
};

// Empty the board (very destructive)
window.clearBoard = function () {
    if (!gameState) return console.warn('⚠️ 沒有進行中的遊戲');
    if (!confirm('⚠️ 確定要清空整個棋盤嗎？此操作無法復原。')) return;
    for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++) gameState.board[r][c] = null;
    syncPiecesAfterMove();
    console.log('棋盤已清空。');
};

// ============================================================
//  ★ Force Domain Expansion — developer console command
// ────────────────────────────────────────────────────────────
//  Usage:
//    forceDomainExpansion()                 → current turn's king vs random enemy
//    forceDomainExpansion('white')          → white king vs random black piece
//    forceDomainExpansion('black', 'queen') → black king vs a random white queen
//
//  Notes:
//   • Does NOT consume a use — safe to spam for testing.
//   • Does NOT require the king to actually be in check.
//   • Works in local / AI / multiplayer (broadcasts to peer if it's your side).
// ============================================================
window.forceDomainExpansion = function (color, targetType) {
    if (!gameState) {
        return console.warn('⚠️ 沒有進行中的遊戲');
    }
    if (kingSkillState.active) {
        return console.warn('⚠️ 領域展開已經在進行中，請等它播完');
    }

    // Default to whichever side is currently on the clock
    color = color || gameState.turn;
    if (color !== 'white' && color !== 'black') {
        return console.warn('⚠️ 用法: forceDomainExpansion("white" | "black" [, enemyType])');
    }

    const king = gameState.findKing(color);
    if (!king) {
        return console.warn(`⚠️ 找不到 ${color} 的國王`);
    }

    // Collect every enemy piece as a candidate "checker"
    const enemy = color === 'white' ? 'black' : 'white';
    const candidates = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = gameState.board[r][c];
            if (!p || p.color !== enemy) continue;
            if (targetType && p.type !== targetType) continue;
            candidates.push({ r, c, piece: p });
        }
    }

    if (candidates.length === 0) {
        return console.warn(
            targetType
                ? `⚠️ 棋盤上找不到敵方 ${targetType}`
                : '⚠️ 棋盤上沒有任何敵方棋子可以當作對手'
        );
    }

    // Pick a random one
    const checker = candidates[Math.floor(Math.random() * candidates.length)];

    // ── Set up domain state (deliberately NOT decrementing uses) ──
    kingSkillState.active = true;
    kingSkillState.context = { color, checker };
    kingSkillState.lastUsedMove[color] = gameState.fullMoveNumber;

    // ── Broadcast to the remote peer if this is our side ──
    if (currentMode === 'multiplayer' && peerConnection?.open && color === playerColor) {
        peerConnection.send({
            type: 'domain_start',
            color,
            checkerR: checker.r,
            checkerC: checker.c,
        });
    }

    console.log(
        `%c👑 強制領域展開！%c  ${color.toUpperCase()} King  ⚔  ` +
        `${checker.piece.color.toUpperCase()} ${checker.piece.type} ` +
        `@ (${checker.r}, ${checker.c})`,
        'color:#d9a6ff;font-weight:bold;font-size:14px;',
        'color:#f0e6d3;font-family:monospace;'
    );

    startDomainExpansion(color, checker);
};

// ============================================================
//  ★ Force Win / Lose — developer console commands
// ============================================================
//  Usage (in DevTools console):
//      forceWin()   → instantly ends the game with your victory
//      forceLose()  → instantly ends the game with your defeat
//
//  Notes:
//   • Works in local / AI / multiplayer modes.
//   • In multiplayer, the opponent is notified via the 'gameover'
//     message (they'll see "對手認輸或投降" and win).
//   • Does nothing if the game is already over.
// ============================================================

window.forceWin = function () {
    if (!gameState) {
        return console.warn('⚠️ 沒有進行中的遊戲');
    }
    if (gameOverFlag) {
        return console.warn('⚠️ 遊戲已經結束了');
    }

    gameOverFlag = true;
    stopTimer();

    document.getElementById('gameOverOverlay').classList.remove('hidden');
    document.getElementById('gameOverReason').textContent = '（開發者指令：強制勝利）';

    const text = document.getElementById('gameOverText');
    text.textContent = '你贏了!';
    text.className = 'game-over-text win';

    playSFX('victory');

    if (currentMode === 'multiplayer' && peerConnection?.open) {
        peerConnection.send({ type: 'gameover' });
    }

    console.log(
        '%c🏆 強制勝利！%c  gameOverFlag = true',
        'color:#2ecc71;font-weight:bold;font-size:14px;',
        'color:#f0e6d3;font-family:monospace;'
    );
};

window.forceLose = function () {
    if (!gameState) {
        return console.warn('⚠️ 沒有進行中的遊戲');
    }
    if (gameOverFlag) {
        return console.warn('⚠️ 遊戲已經結束了');
    }

    gameOverFlag = true;
    stopTimer();

    document.getElementById('gameOverOverlay').classList.remove('hidden');
    document.getElementById('gameOverReason').textContent = '（開發者指令：強制失敗）';

    const text = document.getElementById('gameOverText');
    text.textContent = '你輸了...';
    text.className = 'game-over-text lose';

    playSFX('gameover');

    if (currentMode === 'multiplayer' && peerConnection?.open) {
        peerConnection.send({ type: 'gameover' });
    }

    console.log(
        '%c💀 強制失敗！%c  gameOverFlag = true',
        'color:#e74c3c;font-weight:bold;font-size:14px;',
        'color:#f0e6d3;font-family:monospace;'
    );
};

// ============================================================
//  KING PASSIVE SKILL — Domain Expansion (領域展開)
// ============================================================
//
//  • Passive — only triggers when the king is CHECKED.
//  • 3 uses per match (per color).
//  • 10 full-move cooldown between uses.
//  • On activation:
//       1. Domain expansion circle animation
//       2. VS screen (white on right, black on left)
//       3. Rock-paper-scissors battle screen
// //       4. King = 2 hearts, checker = 1 heart
//  • Result:
//       - King loses all hearts → king's player loses the chess game.
//       - Checker loses all hearts → checker dies, chess resumes.

const KING_DOMAIN_MAX_USES = 3;
const KING_DOMAIN_COOLDOWN = 10;   // in full moves

const kingSkillState = {
    uses: { white: KING_DOMAIN_MAX_USES, black: KING_DOMAIN_MAX_USES },
    lastUsedMove: { white: -999, black: -999 },
    active: false,
    context: null,
};

// ★ NEW — call this whenever a fresh match starts
function resetKingSkillState() {
    kingSkillState.uses = { white: KING_DOMAIN_MAX_USES, black: KING_DOMAIN_MAX_USES };
    kingSkillState.lastUsedMove = { white: -999, black: -999 };
    kingSkillState.active = false;
    kingSkillState.context = null;
    // Any in-flight battle is also abandoned
    battleState = null;
}

let battleState = null;
let vsRenderers = { left: null, right: null };
let battleRenderers = { player: null, opponent: null };

// ── Find every enemy piece currently giving check to `color` ──
function findCheckingPieces(color, game) {
    const g = game || gameState;
    const king = g.findKing(color);
    if (!king) return [];
    const enemy = color === 'white' ? 'black' : 'white';
    const out = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = g.board[r][c];
            if (!p || p.color !== enemy) continue;
            const moves = g.getPseudoLegalMoves(r, c, g.board, true);
            if (moves.some(m => m.r === king.r && m.c === king.c)) {
                out.push({ r, c, piece: p });
            }
        }
    }
    return out;
}

// ── Passive trigger — called from checkGameStatus ──
function maybeOfferDomainExpansion() {
    if (gameOverFlag || kingSkillState.active) return;
    if (currentMode === null) return;

    const color = gameState.turn;
    if (!gameState.isInCheck(color)) return;
    if (kingSkillState.uses[color] <= 0) return;

    const movesSince = gameState.fullMoveNumber - kingSkillState.lastUsedMove[color];
    if (movesSince < KING_DOMAIN_COOLDOWN) return;

    const checkers = findCheckingPieces(color);
    if (checkers.length === 0) return;

    // ★ Multiplayer: BOTH sides are human → never auto-trigger.
    //   The defender must click their own king's skill button.
    if (currentMode === 'multiplayer') return;

    // ★ Local hot-seat mode: also manual only (a human decides either side).
    if (currentMode !== 'ai') return;

    // ★ AI mode: only the AI's own king auto-triggers.
    //   (If it's OUR king, we press the button ourselves.)
    if (color === playerColor) return;

    kingSkillState.active = true;
    kingSkillState.context = { color, checker: checkers[0] };

    setTimeout(() => {
        if (gameOverFlag) return;   // (active check removed — already true)
        acceptDomainExpansion(color, checkers[0]);
    }, 750);
}

function showDomainPrompt(color, checker) {
    kingSkillState.context = { color, checker };
    document.getElementById('domainPromptUses').textContent = kingSkillState.uses[color];
    const movesSince = gameState.fullMoveNumber - kingSkillState.lastUsedMove[color];
    const cd = Math.max(0, KING_DOMAIN_COOLDOWN - movesSince);
    document.getElementById('domainPromptCd').textContent = cd;
    document.getElementById('domainPromptOverlay').classList.remove('hidden');
}

function acceptDomainExpansion(color, checker) {
    document.getElementById('domainPromptOverlay').classList.add('hidden');

    // Fall back to stored context if called with no args
    if (!color) {
        const ctx = kingSkillState.context;
        if (!ctx) return;
        color = ctx.color;
        checker = ctx.checker;
    }
    if (!color || !checker) return;

    // Consume a use + start cooldown
    kingSkillState.uses[color]--;
    kingSkillState.lastUsedMove[color] = gameState.fullMoveNumber;
    kingSkillState.active = true;
    kingSkillState.context = { color, checker };

    // Notify remote
    if (currentMode === 'multiplayer' && peerConnection?.open && color === playerColor) {
        peerConnection.send({
            type: 'domain_start',
            color,
            checkerR: checker.r,
            checkerC: checker.c,
        });
    }

    startDomainExpansion(color, checker);
}

function declineDomainExpansion() {
    document.getElementById('domainPromptOverlay').classList.add('hidden');
    kingSkillState.context = null;
}

// ── Domain expansion animation (3D) — BLACK DOMAIN 2.0 ──
//  Cinematic timeline:
//    CHARGE  (0.8s) : rune circle + inward-spiraling particles
//    EXPAND  (3.3s) : 2 wavefronts, 16 pillars, 10 cracks,
//                     lightning arcs on the dome, tinting pieces
//    BURST   (0.8s) : shatter shards + shake spike, then VS screen
function startDomainExpansion(color, checker) {
    isAnimating = true;

    const king = gameState.findKing(color);
    if (!king) {
        showVsScreen(color, checker);
        return;
    }

    const kingPos = get3DPosition(king.r, king.c, 0);
    const t0 = clock.getElapsedTime();

    // ── Palette — themed by the king's color ──
    //    white king → radiant light domain
    //    black king → abyssal dark domain (original look)
    const isWhiteDomain = (color === 'white');

    const THEME = isWhiteDomain ? {
        // ─── SOFT LIGHT THEME (white king) — toned down to avoid blowout ───
        //  All additive layers deliberately sit around 55–70% brightness
        //  so they don't stack into a pure white nuke.
        DISC: 0xc8bca0,             // warm beige — was 0xffffff
        WAVE: 0xd4c9a8,             // soft cream  — was 0xfff8e0
        RIM: 0x9a7a2a,              // muted gold  — was 0xe8c547
        HAZE: 0xb09a58,             // dim gold    — was 0xfff0b0
        WAVE2: 0x4a7a9c,            // muted blue  — was 0x7ac8ff
        BLADE_BODY: 0xc0b8a0,       // grey-cream  — was 0xf5f5f5
        BLADE_SEAM: 0x8a6a20,       // dark gold   — was 0xe8c547
        BLADE_AURA: 0xa88830,       // dim gold    — was 0xffe27a
        BLADE_CORE: 0xb0a078,       // warm grey   — was 0xffffff  ★ KEY
        GROUND_IMPACT: 0xa88830,
        GROUND_RING: 0x8a6a20,
        RUNE_A: 0xa88830,
        RUNE_B: 0x8a6a20,
        CHARGE_A: 0xa88830,
        CHARGE_B: 0xb0a078,         // warm grey   — was 0xffffff  ★ KEY
        PILLAR_BODY: 0x8a8680,      // muted grey  — was 0xe0e0e8
        PILLAR_RIM: 0x8a6a20,
        DOME_OUTER: 0xa89e8c,       // grey-cream  — was 0xfffaf0
        DOME_INNER: 0x9a7a2a,
        DOME_RIM: 0x8a6a20,
        LIGHTNING: 0xb0a078,        // warm grey   — was 0xffffff  ★ KEY
        SHARD_A: 0xb0a078,          // warm grey   — was 0xffffff  ★ KEY
        SHARD_B: 0x8a6a20,
        TINT: new THREE.Color(0xb0a078),   // warmer + dimmer than 0xffffff
        KING_GLOW: 0xc9a44a,
        CHECKER_GLOW: 0xd94868,
        VIGNETTE: 'radial-gradient(circle at 50% 50%,'
            + 'rgba(230,220,190,0) 28%,'
            + 'rgba(200,180,140,0.35) 68%,'
            + 'rgba(180,160,120,0.75) 100%)',
    } : {
        // ─── DARK THEME (black king) — original ───
        DISC: 0x000000,
        WAVE: 0x000000,
        RIM: 0x9b4ddb,
        HAZE: 0x6a2a9a,
        WAVE2: 0xc44dff,
        BLADE_BODY: 0x000000,
        BLADE_SEAM: 0x8b0033,
        BLADE_AURA: 0xff1e4a,
        BLADE_CORE: 0xff5577,
        GROUND_IMPACT: 0xff3344,
        GROUND_RING: 0xff8866,
        RUNE_A: 0x9b4ddb,
        RUNE_B: 0xc44dff,
        CHARGE_A: 0xc44dff,
        CHARGE_B: 0x9b4ddb,
        PILLAR_BODY: 0x0a0a14,
        PILLAR_RIM: 0xc44dff,
        DOME_OUTER: 0x05000a,
        DOME_INNER: 0x6a2a9a,
        DOME_RIM: 0x9b4ddb,
        LIGHTNING: 0xc44dff,
        SHARD_A: 0x000000,
        SHARD_B: 0xc44dff,
        TINT: new THREE.Color(0x000000),
        KING_GLOW: 0xffe27a,
        CHECKER_GLOW: 0xff3366,
        VIGNETTE: 'radial-gradient(circle at 50% 50%,'
            + 'rgba(0,0,0,0) 28%,'
            + 'rgba(10,0,25,0.55) 68%,'
            + 'rgba(0,0,0,0.95) 100%)',
    };

    // ── Bookkeeping ──
    const created = [];   // { obj, geo, mat }
    const track = (obj, geo, mat) => {
        created.push({
            obj,
            geo: geo || (obj && obj.geometry),
            mat: mat || (obj && obj.material),
        });
        return obj;
    };
    let shatterFired = false;

    // ═══════════════════════════════════════════════════════════
    //  VIGNETTE (DOM overlay — cheap, dramatic)
    // ═══════════════════════════════════════════════════════════
    const vignette = document.createElement('div');
    vignette.style.cssText = `
        position: fixed; inset: 0; pointer-events: none; z-index: 490;
        background: ${THEME.VIGNETTE};
        opacity: 0; transition: opacity 0.6s ease;
    `;
    document.body.appendChild(vignette);
    requestAnimationFrame(() => { vignette.style.opacity = '1'; });

    // ═══════════════════════════════════════════════════════════
    //  LAYER 1 — Ground disc (fill under the wave)
    // ═══════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════
    //  LAYER 2 — Main wavefront (thick black ring)
    // ═══════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════
    //  LAYER 3 — Bright purple rim on the wavefront edge
    // ═══════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════
    //  LAYER 4 — Outer purple haze
    // ═══════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════
    //  LAYER 5 — Secondary magenta wavefront (lags the main ring)
    // ═══════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════
    //  LAYER 6 — Scattered swords inside the corridor
    //            from the king → the checking piece
    //            (direction preserved, placement random)
    // ═══════════════════════════════════════════════════════════
    const checkerPos = get3DPosition(checker.r, checker.c, 0);
    const pathDX = checkerPos.x - kingPos.x;
    const pathDZ = checkerPos.z - kingPos.z;
    const pathLength = Math.hypot(pathDX, pathDZ);
    const pathAngle = Math.atan2(pathDZ, pathDX);
    const perpAngle = pathAngle + Math.PI / 2;

    // Number of swords scales with corridor length
    const CRACK_COUNT = Math.max(8, Math.min(22, Math.floor(pathLength / 0.28)));
    const cracks = [];

    for (let i = 0; i < CRACK_COUNT; i++) {
        // ── Fully random position along the corridor ──
        // t = 0 → at the king,  t = 1 → at the checker
        const t = Math.random();

        // Distance from the king along the path direction
        // (leave a small buffer near the king so swords don't sit on him)
        const alongDist = 0.55 + t * (pathLength - 0.55);

        // ── Perpendicular scatter ──
        // The band widens as you get further from the king, so the swords
        // fan out loosely toward the checker instead of hugging the line.
        const perpHalfWidth = 0.20 + t * 1.10;
        const perpOffset = (Math.random() - 0.5) * 2 * perpHalfWidth;

        // ── Small forward / back noise ──
        // Breaks up the "sorted by distance" feel even more.
        const alongNoise = (Math.random() - 0.5) * 0.55;

        const px = kingPos.x
            + Math.cos(pathAngle) * (alongDist + alongNoise)
            + Math.cos(perpAngle) * perpOffset;
        const pz = kingPos.z
            + Math.sin(pathAngle) * (alongDist + alongNoise)
            + Math.sin(perpAngle) * perpOffset;

        // ── One upside-down sword, tip buried in the board ──
        const swordGroup = new THREE.Group();
        swordGroup.position.set(px, 0, pz);

        // Random yaw + wider tilt so they never align as a neat row
        swordGroup.rotation.y = Math.random() * Math.PI * 2;
        swordGroup.rotation.z = (Math.random() - 0.5) * 0.60;
        swordGroup.rotation.x = (Math.random() - 0.5) * 0.60;

        // Random uniform scale — some blades longer, some shorter
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

        // Dimensions (blade points DOWN into the board)
        const BLADE_H = 0.75;
        const BLADE_W = 0.085;
        const BLADE_D = 0.038;
        const GUARD_Y = 0.16;

        // ── Blade — buried, points DOWN ──
        const bladeGeo = new THREE.BoxGeometry(BLADE_W, BLADE_H, BLADE_D);
        const blade = new THREE.Mesh(bladeGeo, swordMat);
        blade.position.y = GUARD_Y - BLADE_H / 2;
        swordGroup.add(blade);
        track(blade, bladeGeo, swordMat);

        // ── Blade tip — 4-sided cone flipped to point DOWN ──
        const tipGeo = new THREE.ConeGeometry(BLADE_W * 0.65, 0.18, 4);
        const tip = new THREE.Mesh(tipGeo, swordMat);
        tip.position.y = GUARD_Y - BLADE_H - 0.09;
        tip.rotation.y = Math.PI / 4;
        tip.rotation.z = Math.PI;
        swordGroup.add(tip);
        track(tip, tipGeo, swordMat);

        // ── Cross-guard ──
        const guardGeo = new THREE.BoxGeometry(0.24, 0.05, 0.07);
        const guard = new THREE.Mesh(guardGeo, swordMat);
        guard.position.y = GUARD_Y;
        swordGroup.add(guard);
        track(guard, guardGeo, swordMat);

        // ── Grip ──
        const gripGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8);
        const grip = new THREE.Mesh(gripGeo, swordMat);
        grip.position.y = GUARD_Y + 0.11;
        swordGroup.add(grip);
        track(grip, gripGeo, swordMat);

        // ── Pommel ──
        const pommelGeo = new THREE.SphereGeometry(0.045, 8, 8);
        const pommel = new THREE.Mesh(pommelGeo, swordMat);
        pommel.position.y = GUARD_Y + 0.22 + 0.03;
        swordGroup.add(pommel);
        track(pommel, pommelGeo, swordMat);

        // ── Red glow seam ──
        const seamGeo = new THREE.PlaneGeometry(0.02, 0.35);
        const seam = new THREE.Mesh(seamGeo, swordGlowMat);
        seam.position.set(0, GUARD_Y - 0.20, BLADE_D / 2 + 0.002);
        swordGroup.add(seam);
        track(seam, seamGeo, swordGlowMat);

        // ═══════════════════════════════════════════════════════
        //  ★ NEW — Blade glow aura + ground impact glow
        // ═══════════════════════════════════════════════════════

        // ── 1. Outer blade aura (soft red halo, additive) ──
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

        // ── 2. Bright inner core glow (narrower, hotter) ──
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

        // ── 3. Ground impact disc — flat on the floor, NOT rotated ──
        //    (added to the scene directly so it stays parallel to the ground)
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

        // ── 4. Expanding ground shock ring on stab-in ──
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
            swordGroup,
            swordMat,
            glowMat: swordGlowMat,

            auraMat,
            coreGlowMat,
            groundImpactMat,
            groundImpact,
            groundRingMat,
            groundRing,

            index: i,
            // Random chaotic stab-in moment
            spawnDelay: Math.random() * (CRACK_COUNT * 0.10),
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  LAYER 7 — Rotating rune circle under the king (pre-wave)
    // ═══════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════
    //  LAYER 8 — Charge-up particles (spiral inward)
    // ═══════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════
    //  LAYER 9 — 16 dark swords stabbed into the ground
    // ═══════════════════════════════════════════════════════════
    const pillarGroup = new THREE.Group();
    pillarGroup.position.set(kingPos.x, 0, kingPos.z);
    scene.add(pillarGroup);
    const PILLAR_COUNT = 16;
    const pillars = [];

    // Sword proportions (total height = 2.40, base at y = 0)
    const SWORD_BLADE_W = 0.11;
    const SWORD_BLADE_D = 0.035;
    const SWORD_BLADE_H = 1.65;

    for (let i = 0; i < PILLAR_COUNT; i++) {
        const angle = (i / PILLAR_COUNT) * Math.PI * 2;

        const swordGroup = new THREE.Group();

        // Shared materials (one per sword → single fade control point)
        const darkMat = new THREE.MeshBasicMaterial({
            color: THEME.PILLAR_BODY, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
        });
        const rimMat = new THREE.MeshBasicMaterial({
            color: THEME.PILLAR_RIM, transparent: true, opacity: 0,
            depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });

        // ── Pommel (bottom of hilt) ──
        const pommelGeo = new THREE.SphereGeometry(0.06, 8, 8);
        const pommel = new THREE.Mesh(pommelGeo, darkMat);
        pommel.position.y = 0.06;
        swordGroup.add(pommel);
        track(pommel, pommelGeo, darkMat);

        // ── Grip ──
        const gripGeo = new THREE.CylinderGeometry(0.034, 0.034, 0.40, 8);
        const grip = new THREE.Mesh(gripGeo, darkMat);
        grip.position.y = 0.26;
        swordGroup.add(grip);
        track(grip, gripGeo, darkMat);

        // ── Cross-guard ──
        const guardGeo = new THREE.BoxGeometry(0.32, 0.06, 0.08);
        const guard = new THREE.Mesh(guardGeo, darkMat);
        guard.position.y = 0.49;
        swordGroup.add(guard);
        track(guard, guardGeo, darkMat);

        // ── Blade ──
        const bladeGeo = new THREE.BoxGeometry(SWORD_BLADE_W, SWORD_BLADE_H, SWORD_BLADE_D);
        const blade = new THREE.Mesh(bladeGeo, darkMat);
        blade.position.y = 0.52 + SWORD_BLADE_H / 2;      // 1.345
        swordGroup.add(blade);
        track(blade, bladeGeo, darkMat);

        // ── Blade tip (4-sided cone) ──
        const tipGeo = new THREE.ConeGeometry(SWORD_BLADE_W * 0.7, 0.23, 4);
        const tip = new THREE.Mesh(tipGeo, darkMat);
        tip.position.y = 0.52 + SWORD_BLADE_H + 0.115;    // 2.285
        tip.rotation.y = Math.PI / 4;
        swordGroup.add(tip);
        track(tip, tipGeo, darkMat);

        // ── Magenta edge glow (both blade edges) ──
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

        // Position + orientation:
        //   rotation.y = π/2 - angle  →  blade's broad face points OUTWARD
        //   (change to `-angle` if you'd rather see the edge-on silhouette)
        swordGroup.position.set(1, 0, 0);
        swordGroup.rotation.y = Math.PI / 2 - angle;
        // Tiny random tilt for a "just-stabbed-in" look
        swordGroup.rotation.z = (Math.random() - 0.5) * 0.12;

        pillarGroup.add(swordGroup);

        pillars.push({ group: swordGroup, darkMat, rimMat, angle });
    }

    // ═══════════════════════════════════════════════════════════
    //  LAYER 10 — Shadow dome (double shell + ground rim)
    // ═══════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════
    //  LAYER 11 — Lightning arcs crawling on the dome surface
    // ═══════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════
    //  LAYER 12 — Flash at the king (brief white pop)
    // ═══════════════════════════════════════════════════════════
    const flashGeo = new THREE.SphereGeometry(0.55, 20, 20);
    const flashMat = new THREE.MeshBasicMaterial({
        // ★ Light branch gets a warm amber pop instead of a white flashbang.
        //   Dark branch keeps the original white spark.
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

    // ═══════════════════════════════════════════════════════════
    //  LAYER 13 — Shatter shards (peak burst)
    // ═══════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════
    //  Collect pieces to tint (skip king + checkers)
    // ═══════════════════════════════════════════════════════════
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
            const sprites = [];          // ★ NEW: health bars + cooldown badges
            obj.traverse(n => {
                if (n.isMesh && n.material && n.material.color) {
                    n.material = n.material.clone();
                    savedMats.push({
                        mesh: n,
                        color: n.material.color.clone(),
                        emissive: n.material.emissive ? n.material.emissive.clone() : null,
                    });
                } else if (n.isSprite && n.material) {
                    // Sprites are not `isMesh` → they were silently skipped before.
                    sprites.push(n);
                }
            });
            piecesToTint.push({
                obj, dist: distFromKing, tintAmount: 0, opacityAmount: 1,
                savedMats, sprites,
            });
        }
    }

    // ── Glow outlines on the two involved pieces ──
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

    // ═══════════════════════════════════════════════════════════
    //  TIMELINE
    // ═══════════════════════════════════════════════════════════
    const CHARGE_END = 0.8;
    const EXPAND_END = CHARGE_END + 7.0;
    const TOTAL = EXPAND_END + 0.8;
    const MAX_RADIUS = 14;
    const TINT_RAMP = 0.9;

    // ── Register camera shake ──
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

        // ═══════════════ PHASE: CHARGE ═══════════════
        if (elapsed < CHARGE_END) {
            const k = elapsed / CHARGE_END;
            const ease = 1 - Math.pow(1 - k, 3);

            // Rune circle fades in
            runeRings[0].material.opacity = 0.75 * ease;
            runeRings[1].material.opacity = 0.55 * ease;
            for (const t of runeTicks) t.material.opacity = 0.85 * ease;
            runeGroup.rotation.y += 0.05;
            runeGroup.children.forEach(ch => {
                // counter-rotate inner ring visually
            });

            // Charge particles spiral inward
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

            // Faint disc creep
            disc.scale.set(0.5, 0.5, 1);
            discMat.opacity = 0.15 * ease;

            // Gentle shake ramp
            shakeHandle.intensity = 0.015 * ease;
        }
        // ═══════════════ PHASE: EXPAND ═══════════════
        else {
            const expElapsed = elapsed - CHARGE_END;
            const tRaw = Math.min(expElapsed / (EXPAND_END - CHARGE_END), 1);
            const ease = 1 - Math.pow(1 - tRaw, 2);
            const radius = MAX_RADIUS * ease;

            // Rune fades out as the wave grows
            const runeFade = Math.max(0, 1 - tRaw * 2.0);
            runeRings[0].material.opacity = 0.75 * runeFade;
            runeRings[1].material.opacity = 0.55 * runeFade;
            for (const t of runeTicks) t.material.opacity = 0.85 * runeFade;
            runeGroup.rotation.y += 0.05;

            // Charge particles burn off
            for (const p of chargeParticles) {
                if (p.material.opacity > 0) {
                    p.material.opacity = Math.max(0, p.material.opacity - 0.08);
                }
            }

            // Disc
            disc.scale.set(Math.max(0.001, radius), Math.max(0.001, radius), 1);
            discMat.opacity = 0.78 * Math.min(1, tRaw * 1.6);

            // Main ring
            ring.scale.set(Math.max(0.001, radius), Math.max(0.001, radius), 1);
            const ringPulse = 0.85 + 0.15 * Math.sin(elapsed * 10);
            ringMat.opacity = 0.98 * (1 - tRaw * 0.2) * ringPulse;

            // Purple rim
            rim.scale.set(Math.max(0.001, radius), Math.max(0.001, radius), 1);
            rimMat.opacity = 0.85 * Math.sin(Math.PI * Math.min(tRaw * 1.1, 1));

            // Outer glow
            glow.scale.set(Math.max(0.001, radius), Math.max(0.001, radius), 1);
            glowMat.opacity = 0.4 * (1 - tRaw * 0.35);

            // Secondary wavefront (lags the main one by 0.25s)
            const tRaw2 = Math.max(0, (expElapsed - 0.45) / (EXPAND_END - CHARGE_END - 0.45));
            const radius2 = MAX_RADIUS * (1 - Math.pow(1 - Math.min(tRaw2, 1), 3.5));

            ring2.scale.set(Math.max(0.001, radius2), Math.max(0.001, radius2), 1);
            ring2Mat.opacity = 0.55 * (1 - tRaw * 0.8);

            // Pillars
            // Pillars (swords)
            for (const p of pillars) {
                const px = Math.cos(p.angle) * radius;
                const pz = Math.sin(p.angle) * radius;
                p.group.position.set(px, 0, pz);

                const pillarFade = Math.max(0, 1 - tRaw * 1.1);
                p.darkMat.opacity = 0.95 * pillarFade;
                p.rimMat.opacity = 0.90 * pillarFade;

                p.group.scale.set(1, 0.6 + tRaw * 0.9, 1);
            }

            // ── Scattered swords (path corridor) — chaotic stab-in ──
            for (const c of cracks) {
                const appearT = c.spawnDelay;
                const growT = Math.max(0, Math.min(1, (expElapsed - appearT) / 0.28));
                const holdFade = Math.max(0, 1 - tRaw * 0.9);
                const alpha = growT * holdFade;

                // Stab-in pop, multiplied by the sword's own random base scale
                const base = c.swordGroup.userData.baseScale || 1;
                const pop = base * (0.35 + 0.65 * growT);
                c.swordGroup.scale.setScalar(pop);

                // Blade body / seam
                c.swordMat.opacity = 0.95 * alpha;
                c.glowMat.opacity = 0.90 * alpha * (0.7 + 0.3 * Math.sin(elapsed * 14 + c.index));

                // ═══════════════════════════════════════════════════
                //  ★ NEW — Pulsing glow aura around the blade
                // ═══════════════════════════════════════════════════
                if (c.auraMat) {
                    // Slow deep pulse — like the blade is radiating heat
                    const pulse = 0.7 + 0.3 * Math.sin(elapsed * 8 + c.index * 1.3);
                    c.auraMat.opacity = 0.85 * alpha * pulse;
                }
                if (c.coreGlowMat) {
                    // Faster, brighter flicker on the inner core
                    const flicker = 0.72 + 0.28 * Math.sin(elapsed * 18 + c.index * 0.7);
                    c.coreGlowMat.opacity = 0.95 * alpha * flicker;
                }

                // ═══════════════════════════════════════════════════
                //  ★ NEW — Ground impact glow on stab-in
                // ═══════════════════════════════════════════════════
                if (c.groundImpactMat) {
                    // Bright white-hot flash the instant the sword lands,
                    // then settle into a soft pulsing ember
                    const stabFlash = Math.max(0, 1 - growT * 3.2);
                    const settle = 0.55 + 0.45 * Math.sin(elapsed * 5 + c.index);
                    c.groundImpactMat.opacity = alpha * (0.30 * settle + 0.95 * stabFlash);

                    // The disc breathes a little
                    const s = 1 + 0.15 * Math.sin(elapsed * 4 + c.index);
                    c.groundImpact.scale.setScalar(s);
                }
                if (c.groundRingMat && c.groundRing) {
                    // Expanding shock ring — starts at scale 1, blows out
                    // over ~0.55s right after the sword hits
                    const stabT = Math.max(0, Math.min(1, (expElapsed - appearT) / 0.55));
                    c.groundRing.scale.setScalar(1 + stabT * 2.6);
                    c.groundRingMat.opacity = alpha * Math.max(0, 1 - stabT * 1.15) * 0.95;
                }
            }

            // Shadow dome
            const domeR = Math.max(0.001, radius);
            dome.scale.setScalar(domeR);
            domeMat.opacity = 0.45 * Math.min(1, tRaw * 1.5) * (1 - tRaw * 0.12);

            domeInner.scale.setScalar(domeR * 1.01);
            domeInnerMat.opacity = 0.24 * Math.min(1, tRaw * 1.8);

            domeRim.scale.set(domeR, domeR, 1);
            domeRimMat.opacity = 0.75 * Math.min(1, tRaw * 1.4) * (1 - tRaw * 0.25);

            // ── Lightning arcs on the dome ──
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

            // ── Flash at the king (very brief pop at expansion start) ──
            if (expElapsed < 0.4) {
                flash.visible = true;
                const ft = expElapsed / 0.4;
                flashMat.opacity = 0.98 * (1 - ft);
                flash.scale.setScalar(1 + ft * 3.5);
            } else {
                flash.visible = false;
            }

            // ── Camera shake ──
            const shakeRamp = tRaw < 0.15
                ? tRaw / 0.15
                : Math.max(0, 1 - (tRaw - 0.15) / 0.6);
            shakeHandle.intensity = 0.06 * shakeRamp;

            // ── Tint / dissolve pieces as the wavefront passes over them ──
            //   • Before the wave touches a piece → fully visible, no tint
            //   • The instant the wave reaches it → quick fade down to 10%
            //     opacity (90% transparent) with a full dark tint
            //   • After the wave has passed → stays at 10% opacity
            const EDGE_SMOOTH = 0.35;   // transition band, in world units
            const MIN_OPACITY = 0.1;    // 10% remains visible after the wave passes
            for (const p of piecesToTint) {
                const behind = radius - p.dist;   // > 0 → wave has reached this piece
                let targetTint, targetOpacity;
                if (behind <= 0) {
                    // Wave hasn't reached this piece yet — leave it alone
                    targetTint = 0;
                    targetOpacity = 1;
                } else if (behind < EDGE_SMOOTH) {
                    // Wavefront is actively passing over this piece → ramp to 10%
                    const k = behind / EDGE_SMOOTH;              // 0 → 1 across the band
                    targetTint = k;
                    targetOpacity = 1 - (1 - MIN_OPACITY) * k;   // 1 → 0.1
                } else {
                    // Wave has fully passed → settle at 10% opacity
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
                        // ★ When near-invisible, stop writing to the depth buffer so the
                        //   dome / beams / cracks behind the piece still render through it.
                        sm.mesh.material.depthWrite = targetOpacity > 0.92;
                        sm.mesh.material.needsUpdate = true;
                    }

                    // ★ Hide the health bar + cooldown sprites along with the piece
                    for (const sp of p.sprites) {
                        sp.material.transparent = true;
                        sp.material.opacity = targetOpacity;
                        sp.material.needsUpdate = true;
                        sp.visible = targetOpacity > 0.15;
                    }
                }
            }

            // ── SHATTER BURST (one-shot at tRaw ≈ 0.85) ──
            if (tRaw >= 0.85 && !shatterFired) {
                shatterFired = true;
                for (const s of shards) {
                    s.mesh.visible = true;
                    s.mesh.material.opacity = 0.9;
                    s.mesh.position.set(kingPos.x, 0.4, kingPos.z);
                    s.bornAt = elapsed;
                }
                // Sharp one-shot camera kick
                shakeHandle.intensity = 0.20;
            }
        }

        // ═══════════ SHARD PHYSICS (any phase) ═══════════
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

        // ═══════════ Breathing pulse on glow outlines ═══════════
        const glowPulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(elapsed * 4.5));
        for (const o of glowOutlineEntries) {
            if (o.material) o.material.opacity = glowPulse;
        }

        requestAnimationFrame(animateExpand);
    };

    animateExpand();
}

// ── VS screen ──
function showVsScreen(color, checker) {
    const overlay = document.getElementById('vsOverlay');
    overlay.classList.remove('hidden');

    // ★ Player is LEFT, Opponent is RIGHT.
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
    }, 3200); // Increased duration to let the new animations play out fully
}

function showPlayerChoiceBubble(choice) {
    const bubble = document.getElementById('battlePlayerChoiceBubble');
    if (!bubble) return;
    bubble.textContent = BATTLE_GLYPHS[choice] || '?';
    bubble.classList.remove('show');
    void bubble.offsetWidth;
    bubble.classList.add('show');
}

function hidePlayerChoiceBubble() {
    const bubble = document.getElementById('battlePlayerChoiceBubble');
    if (bubble) bubble.classList.remove('show');
}

// ── Battle UI ──
function openBattleMenu(color, checker) {
    document.getElementById('battleOverlay').classList.remove('hidden');
    hideOpponentChoiceBubble();
    hidePlayerChoiceBubble();

    const battleEl = document.getElementById('battleOverlay');
    battleEl.classList.toggle('domain-white', color === 'white');
    battleEl.classList.toggle('domain-black', color === 'black');

    document.getElementById('battleSurrenderConfirmOverlay')?.classList.add('hidden');

    // Reset new visual elements
    document.getElementById('battleShockwave').classList.remove('trigger');
    document.getElementById('battleFlash').classList.remove('trigger');
    document.getElementById('battleVsCenter').classList.remove('slam');
    document.getElementById('battleOpponent').classList.remove('hit-shake', 'victory-zoom');
    document.getElementById('battlePlayer').classList.remove('hit-shake', 'victory-zoom');

    // Trigger the VS slam animation
    setTimeout(() => {
        document.getElementById('battleVsCenter').classList.add('slam');
        playSFX('explosion'); // Add a heavy impact sound
    }, 100);

    // Is the king (defender) on this client?
    const defenderIsLocal =
        (color === playerColor) ||
        (currentMode !== 'ai' && currentMode !== 'multiplayer');

    battleState = {
        defenderColor: color,
        attackerColor: color === 'white' ? 'black' : 'white',
        checker,
        defenderHearts: 2,
        attackerHearts: 1,
        isDefenderLocal: defenderIsLocal,
        busy: false,
        over: false,
        round: 0,
        myChoice: null,
        opponentChoice: null,
        comboCount: 0,
    };

    // ─────────────────────────────────────────────────────────
    // ★ Bottom-left  → LOCAL player's own piece (always their color)
    // ★ Top-right    → OPPONENT's piece (always the other color)
    // ─────────────────────────────────────────────────────────
    const myColor = playerColor;
    const oppColor = playerColor === 'white' ? 'black' : 'white';

    const playerPiece = myColor === color
        ? { type: 'king', color: myColor }
        : { type: checker.piece.type, color: myColor };

    const opponentPiece = oppColor === color
        ? { type: 'king', color: oppColor }
        : { type: checker.piece.type, color: oppColor };

    if (battleRenderers.player) { battleRenderers.player.dispose(); battleRenderers.player = null; }
    if (battleRenderers.opponent) { battleRenderers.opponent.dispose(); battleRenderers.opponent = null; }

    battleRenderers.player = createMiniPieceRenderer(
        document.getElementById('battlePlayerCanvas'),
        playerPiece.type, playerPiece.color
    );
    battleRenderers.opponent = createMiniPieceRenderer(
        document.getElementById('battleOpponentCanvas'),
        opponentPiece.type, opponentPiece.color
    );

    document.getElementById('battlePlayerName').textContent =
        (playerPiece.color === 'white' ? '白方' : '黑方') + ' ' +
        playerPiece.type.charAt(0).toUpperCase() + playerPiece.type.slice(1);
    document.getElementById('battleOpponentName').textContent =
        (opponentPiece.color === 'white' ? '白方' : '黑方') + ' ' +
        opponentPiece.type.charAt(0).toUpperCase() + opponentPiece.type.slice(1);

    updateBattleHealthBars();

    renderBattleHearts();
    setBattleMessage('選擇你的出拳！');
    enableBattleButtons();
}

// Helper: re-enable the RPS buttons and rebind their handlers
function enableBattleButtons() {
    document.querySelectorAll('.battle-menu-btn').forEach(b => {
        if (!b.dataset.choice) return;
        b.disabled = false;
        b.onclick = () => onBattleChoice(b.dataset.choice);
    });
    // ★ Re-enable the surrender button too
    const surBtn = document.getElementById('battleSurrenderBtn');
    if (surBtn) surBtn.disabled = false;
}

function renderBattleHearts() {
    if (!battleState) return;
    const mk = (n, total) => {
        let s = '';
        for (let i = 0; i < total; i++) {
            s += i < n
                ? '<span class="heart full">❤</span>'
                : '<span class="heart empty">♡</span>';
        }
        return s;
    };
    // Local player's piece = bottom-left; opponent's = top-right
    const myHearts = battleState.isDefenderLocal
        ? battleState.defenderHearts
        : battleState.attackerHearts;
    const oppHearts = battleState.isDefenderLocal
        ? battleState.attackerHearts
        : battleState.defenderHearts;

    const myMax = battleState.isDefenderLocal ? 2 : 1;
    const oppMax = battleState.isDefenderLocal ? 1 : 2;

    const overlay = document.getElementById('battleOverlay');
    const myRatio = myHearts / myMax;
    const oppRatio = oppHearts / oppMax;

    overlay.classList.toggle('player-losing', myRatio <= 0.5);
    overlay.classList.toggle('opponent-losing', oppRatio <= 0.5);

    document.getElementById('battlePlayerHearts').innerHTML = mk(myHearts, myMax);
    document.getElementById('battleOpponentHearts').innerHTML = mk(oppHearts, oppMax);
}

function setBattleMessage(msg) {
    const el = document.getElementById('battleMessage');
    if (el) el.textContent = msg;
}

// ★ Show a big badge of what the opponent chose next to their piece
const BATTLE_GLYPHS = { rock: '🪨', paper: '📄', scissors: '✂️' };

function showOpponentChoiceBubble(choice) {
    const bubble = document.getElementById('battleOpponentChoiceBubble');
    if (!bubble) return;
    bubble.textContent = BATTLE_GLYPHS[choice] || '?';
    // Force re-trigger of the pop animation
    bubble.classList.remove('show');
    void bubble.offsetWidth;
    bubble.classList.add('show');
}

function hideOpponentChoiceBubble() {
    const bubble = document.getElementById('battleOpponentChoiceBubble');
    if (bubble) bubble.classList.remove('show');
}

function onBattleChoice(playerChoice) {
    if (!battleState || battleState.over || battleState.busy) return;
    if (battleState.myChoice) return;

    battleState.myChoice = playerChoice;
    showPlayerChoiceBubble(playerChoice);

    // Add a satisfying button press effect
    const btn = document.querySelector(`.battle-menu-btn[data-choice="${playerChoice}"]`);
    if (btn) {
        btn.style.transform = 'translateY(4px) scale(0.95)';
        setTimeout(() => btn.style.transform = '', 200);
    }

    document.querySelectorAll('.battle-menu-btn').forEach(b => b.disabled = true);
    setBattleMessage('等待對手出拳...');

    if (currentMode === 'multiplayer' && peerConnection?.open) {
        peerConnection.send({ type: 'domain_choice', choice: playerChoice });
    }

    if (currentMode === 'ai') {
        const opts = ['rock', 'paper', 'scissors'];
        battleState.opponentChoice = opts[Math.floor(Math.random() * opts.length)];
    }

    tryResolveBattle();
}

// Called when the opponent's choice arrives over the wire
function onOpponentChoiceReceived(choice) {
    if (!battleState || battleState.over) return;
    battleState.opponentChoice = choice;
    tryResolveBattle();
}

// ★ Local player clicks "放棄" (Give Up)
//   - If I'm the KING (defender)  → I lose the entire chess game.
//   - If I'm the CHECKER (attacker) → my checker piece dies, chess resumes.
function onBattleSurrender() {
    if (!battleState || battleState.over || battleState.busy) return;

    // ★ Show the in-game confirmation modal (instead of window.confirm)
    const confirmOverlay = document.getElementById('battleSurrenderConfirmOverlay');
    if (confirmOverlay) confirmOverlay.classList.remove('hidden');
}

// Player pressed "✅ 確定放棄" on the confirm modal
function doBattleSurrenderConfirm() {
    const confirmOverlay = document.getElementById('battleSurrenderConfirmOverlay');
    if (confirmOverlay) confirmOverlay.classList.add('hidden');

    if (!battleState || battleState.over || battleState.busy) return;

    // Lock the battle immediately
    battleState.over = true;
    battleState.myChoice = null;
    battleState.opponentChoice = null;

    document.querySelectorAll('.battle-menu-btn').forEach(b => b.disabled = true);
    hideOpponentChoiceBubble();
    hidePlayerChoiceBubble();

    // Tell the opponent which role I play
    if (currentMode === 'multiplayer' && peerConnection?.open) {
        const myRole = battleState.isDefenderLocal ? 'defender' : 'attacker';
        peerConnection.send({ type: 'domain_surrender', role: myRole });
    }

    setBattleMessage('🏳 你放棄了對決...');

    setTimeout(() => {
        if (!battleState) return;

        if (battleState.isDefenderLocal) {
            // I'm the king → king's hearts emptied → I lose everything
            battleState.defenderHearts = 0;
            resolveDomainDefenderLose();
        } else {
            // I'm the checker → checker dies, king wins this battle
            battleState.attackerHearts = 0;
            resolveDomainCheckerDies();
        }
    }, 1200);
}

// Player pressed "✕ 取消" on the confirm modal
function cancelBattleSurrenderConfirm() {
    const confirmOverlay = document.getElementById('battleSurrenderConfirmOverlay');
    if (confirmOverlay) confirmOverlay.classList.add('hidden');
}

// ★ Opponent surrendered — resolve from our perspective
function onOpponentSurrenderReceived(senderRole) {
    if (!battleState || battleState.over) return;

    battleState.over = true;
    document.querySelectorAll('.battle-menu-btn').forEach(b => b.disabled = true);
    hideOpponentChoiceBubble();
    hidePlayerChoiceBubble();

    setBattleMessage('🏳 對手放棄了對決！');

    setTimeout(() => {
        if (!battleState) return;

        if (senderRole === 'defender') {
            // Opponent was the king and gave up → king loses
            battleState.defenderHearts = 0;
            resolveDomainDefenderLose();
        } else {
            // Opponent was the checker and gave up → checker dies
            battleState.attackerHearts = 0;
            resolveDomainCheckerDies();
        }
    }, 1200);
}

// Resolve the round once both picks are known
function tryResolveBattle() {
    if (!battleState || battleState.over || battleState.busy) return;
    if (!battleState.myChoice || !battleState.opponentChoice) return;

    battleState.busy = true;
    battleState.round++;

    const myChoice = battleState.myChoice;
    const oppChoice = battleState.opponentChoice;
    battleState.myChoice = null;
    battleState.opponentChoice = null;

    showOpponentChoiceBubble(oppChoice);

    // ── CLASH ANIMATION SEQUENCE ──
    // 1. Shake the screen
    document.querySelector('.battle-overlay').classList.add('screen-shake');

    // 2. Trigger the white flash
    document.getElementById('battleFlash').classList.add('trigger');

    // 3. Trigger the shockwave from center
    setTimeout(() => {
        document.getElementById('battleShockwave').classList.add('trigger');
    }, 100);

    // 4. Play clash sound
    playSFX('skill'); // Or a custom clash sound

    // Reset shake after animation
    setTimeout(() => {
        document.querySelector('.battle-overlay').classList.remove('screen-shake');
    }, 500);

    // Determine results
    const isKingMe = battleState.isDefenderLocal;
    const kingChoice = isKingMe ? myChoice : oppChoice;
    const checkerChoice = isKingMe ? oppChoice : myChoice;
    const kingResult = rpsResult(kingChoice, checkerChoice);
    const myResult = rpsResult(myChoice, oppChoice);

    if (myResult === 'tie') {
        setBattleMessage(`對手出了「${zhChoice(oppChoice)}」— 平手！再來一次。`);
        setTimeout(() => {
            battleState.busy = false;
            if (battleState.over) return;
            hideOpponentChoiceBubble();
            hidePlayerChoiceBubble();
            enableBattleButtons();
            setBattleMessage('選擇你的出拳！');
            // Reset health bars just in case
            updateBattleHealthBars();
        }, 1400);
        return;
    }

    // Apply damage
    if (kingResult === 'win') battleState.attackerHearts--;
    else if (kingResult === 'lose') battleState.defenderHearts--;

    const localIsKing = battleState.isDefenderLocal;
    const iLost = (kingResult === 'win' && !localIsKing) ||
        (kingResult === 'lose' && localIsKing);

    // ── DAMAGE ANIMATION SEQUENCE ──
    setTimeout(() => {
        // Shake the loser
        const loserEl = document.querySelector(iLost ? '#battlePlayer' : '#battleOpponent');
        if (loserEl) loserEl.classList.add('hit-shake');

        // Update health bars and hearts
        updateBattleHealthBars();
        renderBattleHearts();

        // Trigger heavy flash
        document.getElementById('battleFlash').classList.add('trigger');

        // Play damage sound
        playSFX('capture');

        // Floating damage number
        const rect = document.getElementById('battleOverlay').getBoundingClientRect();
        const midX = rect.left + rect.width * (iLost ? 0.28 : 0.72);
        const midY = rect.top + rect.height * (iLost ? 0.42 : 0.32);
        spawnBattleDamageNumber(midX, midY, '-1 ♥', iLost ? '#ff4466' : '#ffcc00');

        // Combo badge
        if (!iLost) {
            battleState.comboCount = (battleState.comboCount || 0) + 1;
            showComboBadge(battleState.comboCount);
        } else {
            battleState.comboCount = 0;
        }

        // Heart shatter animation
        const heartsEl = document.querySelector(iLost ? '#battlePlayerHearts' : '#battleOpponentHearts');
        if (heartsEl) {
            const hearts = heartsEl.querySelectorAll('.heart.full');
            const last = hearts[hearts.length - 1];
            if (last) {
                last.classList.remove('full');
                last.classList.add('shatter');
                setTimeout(() => {
                    last.classList.remove('shatter');
                    last.classList.add('empty');
                    last.textContent = '♡';
                }, 650);
            }
        }

        setBattleMessage(`對手出了「${zhChoice(oppChoice)}」— ${iLost ? '敗...' : '勝！'}`);
    }, 400); // Wait for the clash animation to peak

    // ── RESOLVE ROUND ──
    setTimeout(() => {
        if (battleState.defenderHearts <= 0) {
            resolveDomainDefenderLose();
            return;
        }
        if (battleState.attackerHearts <= 0) {
            resolveDomainCheckerDies();
            return;
        }

        // Continue to next round
        battleState.busy = false;
        const remaining = isKingMe ? battleState.defenderHearts : battleState.attackerHearts;
        setBattleMessage(`剩餘生命：${remaining}。再來一局！`);

        setTimeout(() => {
            if (battleState.over) return;
            hideOpponentChoiceBubble();
            hidePlayerChoiceBubble();
            enableBattleButtons();
            setBattleMessage('選擇你的出拳！');
            updateBattleHealthBars(); // Reset visual health if needed
        }, 1200);
    }, 1800);
}

function updateBattleHealthBars() {
    if (!battleState) return;

    const myMax = battleState.isDefenderLocal ? 2 : 1;
    const oppMax = battleState.isDefenderLocal ? 1 : 2;

    const myHearts = battleState.isDefenderLocal ? battleState.defenderHearts : battleState.attackerHearts;
    const oppHearts = battleState.isDefenderLocal ? battleState.attackerHearts : battleState.defenderHearts;

    const myRatio = myHearts / myMax;
    const oppRatio = oppHearts / oppMax;

    // Update Player Health Bar
    const playerFill = document.getElementById('battlePlayerHealthFill');
    if (playerFill) {
        playerFill.style.width = `${myRatio * 100}%`;
        // Change color based on health
        if (myRatio <= 0.5) {
            playerFill.style.background = 'linear-gradient(90deg, #ff4466, #ff8080)';
            playerFill.style.boxShadow = '0 0 20px #ff4466';
        } else {
            playerFill.style.background = 'linear-gradient(90deg, #e8c547, #f0d860)';
            playerFill.style.boxShadow = '0 0 10px #e8c547';
        }
    }

    // Update Opponent Health Bar
    const oppFill = document.getElementById('battleOpponentHealthFill');
    if (oppFill) {
        oppFill.style.width = `${oppRatio * 100}%`;
        if (oppRatio <= 0.5) {
            oppFill.style.background = 'linear-gradient(90deg, #ff4466, #ff8080)';
            oppFill.style.boxShadow = '0 0 20px #ff4466';
        } else {
            oppFill.style.background = 'linear-gradient(90deg, #ff5050, #ff8080)';
            oppFill.style.boxShadow = '0 0 10px #ff5050';
        }
    }

    // Update hearts display
    const mk = (n, total) => {
        let s = '';
        for (let i = 0; i < total; i++) {
            s += i < n
                ? '<span class="heart full">❤</span>'
                : '<span class="heart empty">♡</span>';
        }
        return s;
    };

    document.getElementById('battlePlayerHearts').innerHTML = mk(myHearts, myMax);
    document.getElementById('battleOpponentHearts').innerHTML = mk(oppHearts, oppMax);
}

function rpsResult(a, b) {
    if (a === b) return 'tie';
    if ((a === 'rock' && b === 'scissors') ||
        (a === 'paper' && b === 'rock') ||
        (a === 'scissors' && b === 'paper')) return 'win';
    return 'lose';
}

function zhChoice(c) {
    return { rock: '石頭', paper: '布', scissors: '剪刀' }[c] || c;
}

function resolveDomainCheckerDies() {
    battleState.over = true;
    setBattleMessage('👑 國王勝！將軍者被消滅。');

    // ★ Local player is the WINNER if they own the king (the defender).
    const localIsDefender = !!battleState.isDefenderLocal;
    const playerEl = document.getElementById('battlePlayer');
    const oppEl = document.getElementById('battleOpponent');

    if (localIsDefender) {
        if (playerEl) playerEl.classList.add('victory-zoom');
        if (oppEl) oppEl.classList.add('hit-shake');
    } else {
        if (playerEl) playerEl.classList.add('hit-shake');
        if (oppEl) oppEl.classList.add('victory-zoom');
    }

    playSFX(localIsDefender ? 'victory' : 'gameover');

    setTimeout(() => {
        document.getElementById('battleOverlay').classList.add('hidden');
        if (battleRenderers.player) { battleRenderers.player.dispose(); battleRenderers.player = null; }
        if (battleRenderers.opponent) { battleRenderers.opponent.dispose(); battleRenderers.opponent = null; }
        const ctx = kingSkillState.context;
        if (ctx) playKillAnimation(ctx.color, ctx.checker);
    }, 2500);
}

function resolveDomainDefenderLose() {
    battleState.over = true;
    setBattleMessage('💀 國王生命耗盡...');

    // ★ Local player is the WINNER if they own the checker (the attacker).
    const localIsDefender = !!battleState.isDefenderLocal;
    const playerEl = document.getElementById('battlePlayer');
    const oppEl = document.getElementById('battleOpponent');

    if (localIsDefender) {
        if (playerEl) playerEl.classList.add('hit-shake');
        if (oppEl) oppEl.classList.add('victory-zoom');
    } else {
        if (playerEl) playerEl.classList.add('victory-zoom');
        if (oppEl) oppEl.classList.add('hit-shake');
    }

    playSFX(localIsDefender ? 'gameover' : 'victory');

    setTimeout(() => {
        document.getElementById('battleOverlay').classList.add('hidden');
        if (battleRenderers.player) { battleRenderers.player.dispose(); battleRenderers.player = null; }
        if (battleRenderers.opponent) { battleRenderers.opponent.dispose(); battleRenderers.opponent = null; }

        const ctx = kingSkillState.context;
        const kingColor = (battleState && battleState.defenderColor)
            || (ctx && ctx.color)
            || 'white';
        const checker = ctx && ctx.checker;

        if (checker) {
            kingSkillState.context = { color: kingColor, checker };
            playKillKingAnimation(kingColor, checker);
        } else {
            kingSkillState.active = false;
            kingSkillState.context = null;
            battleState = null;
            isAnimating = false;

            gameOverFlag = true;
            stopTimer();
            document.getElementById('gameOverOverlay').classList.remove('hidden');
            document.getElementById('gameOverReason').textContent = '國王在領域對決中敗北';
            const winner = kingColor === 'white' ? 'black' : 'white';
            const text = document.getElementById('gameOverText');
            if (currentMode === 'ai' || currentMode === 'multiplayer') {
                if (winner === playerColor) { text.textContent = '你贏了!'; text.className = 'game-over-text win'; }
                else { text.textContent = '你輸了...'; text.className = 'game-over-text lose'; }
            } else {
                text.textContent = (winner === 'white' ? '白方' : '黑方') + ' 獲勝!';
                text.className = 'game-over-text win';
            }
        }
    }, 2500);
}

// ═══════════════════════════════════════════════════════════════
//  KILL THEMES — shared palettes for both execution animations
//  • "light" → the killer is a WHITE piece
//  • "dark"  → the killer is a BLACK piece
// ═══════════════════════════════════════════════════════════════
const KILL_THEMES = {
    light: {
        // ground rune
        runeA: 0xffe27a, runeB: 0xfff8d0,
        // energy pillar
        pillarBody: 0xffe9a8, pillarCore: 0xffffff,
        // charging orb
        orbCore: 0xffffff, orbGlow: 0xffe27a,
        orbAura: 0xfff4c0, orbTorusA: 0xffe27a, orbTorusB: 0xfff4c0,
        // beam (king only)
        beamCore: 0xffffff, beamMid: 0xffe27a, beamOuter: 0xfff4d0,
        // impact shock rings
        shockA: 0xffffff, shockB: 0xffe27a, shockC: 0xfff4d0,
        // charge-in particles
        chargeA: 0xffe27a, chargeB: 0xffffff,
        // caster body glow
        casterGlow: 0xffe27a, casterAura: 0xfff4c0, casterLerp: 0.95,
        // blade ring (checker only)
        bladeCore: 0xffffff, bladeEdge: 0xffe27a, bladeHalo: 0xfff4c0,
        // shards
        shardHue: 0.13, shardHueRange: 0.08, shardLight: 0.78,
        // soul motes
        soulHue: 0.13, soulHueRange: 0.08,
        // screen effects
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

// ═══════════════════════════════════════════════════════════════
//  playKillAnimation — the KING executes the checker (beam style)
//  Theme follows the king's own color.
// ═══════════════════════════════════════════════════════════════
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

    // ★ Theme by the KING'S own color (the killer)
    const themeKey = kingColor === 'white' ? 'light' : 'dark';
    const T = KILL_THEMES[themeKey];
    const isWhiteKing = (kingColor === 'white');

    const ORB_HEIGHT = 1.55;
    const IMPACT_Y = 0.45;

    const orbPos = new THREE.Vector3(kingPos.x, ORB_HEIGHT, kingPos.z);
    const impactPos = new THREE.Vector3(checkerPos.x, IMPACT_Y, checkerPos.z);

    const created = [];
    const track = (obj) => { created.push(obj); return obj; };

    // ── DOM overlays ──
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

    // ── Snapshot the king's materials so we can animate its glow ──
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

    // ── Victim becomes transparent so we can flash it white ──
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

    // ═════════════════════════════════════════════════════════
    //  1. Ground rune under the king
    // ═════════════════════════════════════════════════════════
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

    // ═════════════════════════════════════════════════════════
    //  2. Rising energy pillar under the king
    // ═════════════════════════════════════════════════════════
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

    // ═════════════════════════════════════════════════════════
    //  3. Charging orb (nested spheres + 2 rotating torus rings)
    // ═════════════════════════════════════════════════════════
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

    // ═════════════════════════════════════════════════════════
    //  4. Charge-in particles
    // ═════════════════════════════════════════════════════════
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

    // ═════════════════════════════════════════════════════════
    //  5. Beam (king → checker)
    // ═════════════════════════════════════════════════════════
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

    // Spiral helix around the beam
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

    // ═════════════════════════════════════════════════════════
    //  6. Impact — shock rings + flash
    // ═════════════════════════════════════════════════════════
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

    // ═════════════════════════════════════════════════════════
    //  7. Shard burst
    // ═════════════════════════════════════════════════════════
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

    // ═════════════════════════════════════════════════════════
    //  8. Soul motes
    // ═════════════════════════════════════════════════════════
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

    // ═════════════════════════════════════════════════════════
    //  9. Explosion spark cloud
    // ═════════════════════════════════════════════════════════
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

    // ═════════════════════════════════════════════════════════
    //  TIMELINE
    // ═════════════════════════════════════════════════════════
    const t0 = clock.getElapsedTime();
    const CHARGE_END = 1.10;
    const FIRE_AT = 1.10;
    const IMPACT_AT = 1.22;
    const VICTIM_HIDE_AT = 1.30;
    const TOTAL = 3.40;

    // Themed king's glow during charge-up
    const KING_GLOW = new THREE.Color(T.casterGlow);
    const KING_AURA = new THREE.Color(T.casterAura);
    const KING_COLOR_LERP = T.casterLerp;
    const KING_AURA_POWER = isWhiteKing ? 1.00 : 1.35;

    const VICTIM_FLASH = new THREE.Color(T.flashColor);

    const animate = () => {
        const t = clock.getElapsedTime() - t0;

        // ── King glow ramp ──
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

        // ── Ground rune ──
        {
            const appear = Math.min(1, t / 0.35);
            const fadeOut = Math.max(0, 1 - Math.max(0, t - CHARGE_END + 0.3) / 0.4);
            const k = appear * fadeOut;
            runeMat1.opacity = 0.85 * k;
            runeMat2.opacity = 0.70 * k;
            for (const tk of runeTicks) tk.mat.opacity = 0.85 * k;
            runeGroup.rotation.y += 0.025;
        }

        // ── Energy pillar ──
        {
            const up = Math.min(1, t / 0.5);
            const fade = Math.max(0, 1 - Math.max(0, t - CHARGE_END + 0.2) / 0.4);
            pillarMat.opacity = 0.42 * up * fade;
            corePillarMat.opacity = 0.85 * up * fade;
            pillar.rotation.y += 0.04;
            corePillar.rotation.y -= 0.08;
        }

        // ── CHARGE phase ──
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

        // ── FIRE phase ──
        if (t >= FIRE_AT && t < FIRE_AT + 0.35) {
            const ft = t - FIRE_AT;
            const fade = Math.max(0, 1 - ft / 0.32);
            const pulse = 0.85 + 0.15 * Math.sin(ft * 60);

            beamCoreMat.opacity = 0.98 * fade * pulse;
            beamMidMat.opacity = 0.80 * fade;
            beamOuterMat.opacity = 0.45 * fade;

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
                p.material.opacity = 0.95 * fade;
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

        // Orb collapse
        if (t >= FIRE_AT) {
            const killK = Math.min(1, (t - FIRE_AT) / 0.15);
            orbCoreMat.opacity = Math.max(0, 0.95 * (1 - killK));
            orbGlowMat.opacity = Math.max(0, 0.75 * (1 - killK));
            orbAuraMat.opacity = Math.max(0, 0.35 * (1 - killK));
            orbTorusMat1.opacity = Math.max(0, orbTorusMat1.opacity * (1 - killK * 2));
            orbTorusMat2.opacity = Math.max(0, orbTorusMat2.opacity * (1 - killK * 2));
        }

        // ── IMPACT trigger ──
        if (t >= IMPACT_AT && !explosionSpawned) {
            explosionSpawned = true;
            spawnExplosion();
        }

        // ── Screen flash ──
        if (t >= IMPACT_AT && t < IMPACT_AT + 0.18) {
            screenFlash.style.opacity = String(1 - (t - IMPACT_AT) / 0.18);
        } else if (t >= IMPACT_AT + 0.18) {
            screenFlash.style.opacity = '0';
        }

        // ── Impact flash sphere ──
        if (t >= IMPACT_AT && t < IMPACT_AT + 0.55) {
            const it = (t - IMPACT_AT) / 0.55;
            impactMat.opacity = 0.98 * (1 - it) * (1 - it);
            impactSphere.scale.setScalar(0.5 + it * 5.5);
        } else if (t >= IMPACT_AT + 0.55) {
            impactMat.opacity = 0;
        }

        // ── Shock rings ──
        for (const sr of shockRings) {
            const st = t - IMPACT_AT - sr.delay;
            if (st < 0 || st > 0.75) { sr.mat.opacity = 0; continue; }
            const prog = st / 0.75;
            sr.mat.opacity = 0.9 * (1 - prog);
            const s = 1 + prog * sr.maxScale;
            sr.mesh.scale.set(s, s, 1);
        }

        // ── Victim flash ──
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

        // ── Hide victim + fly shards/souls ──
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

        // ── Explosion particles ──
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

// ── Apply the kill to the game state & resume play ──
function finalizeDomainKill(defenderColor, checker) {
    const r = checker.r, c = checker.c;
    const victimPiece = gameState.board[r][c];

    if (victimPiece) {
        gameState.board[r][c] = null;
        gameState.moveHistory.push({
            type: 'domain_kill',
            r, c,
            piece: { ...victimPiece },
        });
    }

    syncPiecesAfterMove();

    // ★ 領域展開算一步棋 — 將軍者被消滅後，回合交給對手
    gameState.flipTurn();

    // Broadcast result to the opponent
    if (currentMode === 'multiplayer' && peerConnection?.open && defenderColor === playerColor) {
        peerConnection.send({
            type: 'domain_result',
            winner: 'defender',
            checkerR: r,
            checkerC: c,
        });
    }

    kingSkillState.active = false;
    kingSkillState.context = null;
    battleState = null;

    // Release the input lock that startDomainExpansion set
    isAnimating = false;

    updateTurnIndicator();
    checkGameStatus();

    if (!gameOverFlag && currentMode === 'ai' && gameState.turn !== playerColor) {
        aiThinking = true;
        setTimeout(makeAIMove, 500);
    }
}

// ═══════════════════════════════════════════════════════════════
//  playKillKingAnimation — the CHECKER executes the king.
//  Completely different style from the king's beam:
//  the checker charges up, then 12 energy blades materialise
//  in a ring around the king, spin briefly, and all dart inward
//  at once. Theme follows the CHECKER's color.
// ═══════════════════════════════════════════════════════════════
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

    // ★ The attacker's color is the opposite of the king's.
    //   White attacker → light theme.  Black attacker → dark theme.
    const attackerColor = kingColor === 'white' ? 'black' : 'white';
    const themeKey = attackerColor === 'white' ? 'light' : 'dark';
    const T = KILL_THEMES[themeKey];

    const created = [];
    const track = (obj) => { created.push(obj); return obj; };

    // ── DOM overlays ──
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

    // ── Snapshot the attacker's materials so it can glow during charge ──
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

    // ── The victim king becomes transparent so we can flash it ──
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

    // ═════════════════════════════════════════════════════════
    //  1. Ground rune under the ATTACKER
    // ═════════════════════════════════════════════════════════
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

    // ═════════════════════════════════════════════════════════
    //  2. Charging motes that spiral into the attacker
    // ═════════════════════════════════════════════════════════
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

    // ═════════════════════════════════════════════════════════
    //  3. THE BLADE RING — 12 energy blades around the king
    // ═════════════════════════════════════════════════════════
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

        // Point the blade's local +Y toward the centre (and slightly down)
        const inwardDir = new THREE.Vector3(
            -Math.cos(angle), -0.22, -Math.sin(angle)
        ).normalize();
        bladeGroup.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0), inwardDir
        );

        // ── Blade body (dark/coloured slab) ──
        const bodyMat = new THREE.MeshBasicMaterial({
            color: T.bladeEdge, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
            side: THREE.DoubleSide,
        });
        const bodyGeo = new THREE.BoxGeometry(0.08, 0.85, 0.03);
        const body = track(new THREE.Mesh(bodyGeo, bodyMat));
        body.position.y = 0.425;                 // extends outward from base
        body.renderOrder = 70;
        bladeGroup.add(body);

        // ── Bright core along the blade ──
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

        // ── Outer halo (soft glow) ──
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

        // ── Tip (small cone at the far end) ──
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
            // stagger the "materialise" moment
            spawnDelay: i * 0.035,
            // every blade spins around its own long axis
            spin: (i % 2 === 0 ? 1 : -1) * (4 + Math.random() * 3),
        });
    }

    // ═════════════════════════════════════════════════════════
    //  4. Impact — shock rings + flash sphere
    // ═════════════════════════════════════════════════════════
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

    // ═════════════════════════════════════════════════════════
    //  5. Shards + soul motes + explosion cloud
    // ═════════════════════════════════════════════════════════
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

    // ═════════════════════════════════════════════════════════
    //  TIMELINE
    //   0.00 – 1.05  CHARGE  (rune + spiral motes)
    //   1.05 – 1.45  SPIN    (blades materialise + spin)
    //   1.45 – 1.75  SPIN 2  (blades drift a tiny bit inward)
    //   1.75 – 1.90  STRIKE  (blades dart inward together)
    //   1.90         IMPACT  (king flash + explosion)
    //   1.95         shards/souls launch
    //   3.40         END
    // ═════════════════════════════════════════════════════════
    const t0 = clock.getElapsedTime();
    const CHARGE_END = 1.05;
    const BLADE_IN_END = 1.45;
    const SPIN_END = 1.75;
    const STRIKE_END = 1.90;      // == IMPACT_AT
    const VICTIM_HIDE_AT = 1.96;
    const TOTAL = 3.40;

    const CASTER_GLOW = new THREE.Color(T.casterGlow);
    const CASTER_AURA = new THREE.Color(T.casterAura);
    const VICTIM_FLASH = new THREE.Color(T.flashColor);

    const animate = () => {
        const t = clock.getElapsedTime() - t0;

        // ── Attacker glow ramp ──
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

        // ── Rune circle ──
        {
            const appear = Math.min(1, t / 0.35);
            const fadeOut = Math.max(0, 1 - Math.max(0, t - CHARGE_END + 0.3) / 0.4);
            const k = appear * fadeOut;
            runeMat1.opacity = 0.85 * k;
            runeMat2.opacity = 0.65 * k;
            for (const tk of runeTicks) tk.mat.opacity = 0.85 * k;
            runeGroup.rotation.y += 0.04;
        }

        // ── Charge motes spiral into the attacker ──
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

        // ── Blade ring ──
        {
            // Overall blade alpha curve: 0 → 1 during BLADE_IN, then hold,
            // then 0 after strike.
            const inProgress = Math.max(0, Math.min(1,
                (t - CHARGE_END) / (BLADE_IN_END - CHARGE_END)));

            // Global reveal envelope
            const reveal =
                t < CHARGE_END ? 0 :
                    t < BLADE_IN_END ? inProgress :
                        t < VICTIM_HIDE_AT ? 1 :
                            Math.max(0, 1 - (t - VICTIM_HIDE_AT) / 0.25);

            // Inward radius: OUTER_R → INNER_R during STRIKE window
            const strikeProgress = (t >= SPIN_END && t <= STRIKE_END)
                ? (t - SPIN_END) / (STRIKE_END - SPIN_END)
                : (t > STRIKE_END ? 1 : 0);
            const eased = strikeProgress * strikeProgress;   // ease-in (fast finish)
            const radius = OUTER_R + (INNER_R - OUTER_R) * eased;

            // Gentle spin applied to the whole ring during the charge
            const ringSpin = t * 0.6;

            for (const b of blades) {
                const localReveal = Math.max(0, Math.min(1,
                    (t - CHARGE_END - b.spawnDelay) / 0.20));
                const alpha = localReveal * reveal;

                // Compute this blade's current position on the ring
                const angle = b.angle + ringSpin;
                const px = kingPos.x + Math.cos(angle) * radius;
                const pz = kingPos.z + Math.sin(angle) * radius;
                b.group.position.set(px, BLADE_Y, pz);

                // Keep the blade pointing at the king
                const inward = new THREE.Vector3(
                    -Math.cos(angle), -0.22, -Math.sin(angle)
                ).normalize();
                b.group.quaternion.setFromUnitVectors(
                    new THREE.Vector3(0, 1, 0), inward
                );

                // Self-spin around its own long axis
                b.group.rotateY(t * b.spin);

                // Fade in / out
                b.bodyMat.opacity = alpha * 0.95;
                b.coreMat.opacity = alpha * (0.85 + 0.15 * Math.sin(t * 24 + b.angle));
                b.haloMat.opacity = alpha * 0.55;
                b.tipMat.opacity = alpha * 0.95;
            }
        }

        // ── IMPACT trigger ──
        if (t >= STRIKE_END && !explosionSpawned) {
            explosionSpawned = true;
            spawnExplosion();
        }

        // ── Screen flash ──
        if (t >= STRIKE_END && t < STRIKE_END + 0.18) {
            screenFlash.style.opacity = String(1 - (t - STRIKE_END) / 0.18);
        } else if (t >= STRIKE_END + 0.18) {
            screenFlash.style.opacity = '0';
        }

        // ── Impact flash sphere ──
        if (t >= STRIKE_END && t < STRIKE_END + 0.55) {
            const it = (t - STRIKE_END) / 0.55;
            impactMat.opacity = 0.98 * (1 - it) * (1 - it);
            impactSphere.scale.setScalar(0.5 + it * 5.8);
        } else if (t >= STRIKE_END + 0.55) {
            impactMat.opacity = 0;
        }

        // ── Shock rings ──
        for (const sr of shockRings) {
            const st = t - STRIKE_END - sr.delay;
            if (st < 0 || st > 0.75) { sr.mat.opacity = 0; continue; }
            const prog = st / 0.75;
            sr.mat.opacity = 0.9 * (1 - prog);
            const s = 1 + prog * sr.maxScale;
            sr.mesh.scale.set(s, s, 1);
        }

        // ── King white-flash ──
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

        // ── Hide king, fly shards + souls ──
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

        // ── Explosion particles ──
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

// ── Apply the king's death to the game state & show game over ──
function finalizeKingKill(kingColor, checker) {
    const king = gameState.findKing(kingColor);
    if (king) {
        const kingPiece = gameState.board[king.r][king.c];
        if (kingPiece) {
            gameState.board[king.r][king.c] = null;
            gameState.moveHistory.push({
                type: 'domain_kill_king',
                r: king.r, c: king.c,
                piece: { ...kingPiece },
            });
        }
    }

    syncPiecesAfterMove();

    // Broadcast the loss to the opponent
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

// ── Mini 3D piece renderer for VS / battle screens ──
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

// ============================================================
//  ★ SETTINGS SYSTEM
//  Persists to localStorage and applies to audio / renderer.
// ============================================================
const DEFAULT_GAME_SETTINGS = {
    musicEnabled: true,
    musicVolume: 30,        // 0–100
    sfxVolume: 80,          // 0–100
    queenVoice: true,
    graphicsQuality: 'medium', // 'low' | 'medium' | 'high'
    showCooldownNumbers: true,
};

let gameSettings = { ...DEFAULT_GAME_SETTINGS };

function loadGameSettings() {
    try {
        const raw = localStorage.getItem('chessGameSettings');
        if (raw) {
            const parsed = JSON.parse(raw);
            gameSettings = { ...DEFAULT_GAME_SETTINGS, ...parsed };
        }
    } catch (e) {
        console.warn('Failed to load settings:', e);
    }
    // Keep the queen-voice mute flag in sync with our own setting
    queenVoiceMuted = !gameSettings.queenVoice;
    try { localStorage.setItem('queenVoiceMuted', queenVoiceMuted ? '1' : '0'); } catch (_) { }
}

function saveGameSettings() {
    try {
        localStorage.setItem('chessGameSettings', JSON.stringify(gameSettings));
    } catch (e) {
        console.warn('Failed to save settings:', e);
    }
}

// ── Track where the settings panel was opened from, so closing
//    it returns to the right place. 'menu' | 'game' | null
let _settingsOpenedFrom = null;

function openSettings() {
    // Decide the origin BEFORE we change any visibility
    // (a game is "in progress" when currentMode is set and the
    //  game hasn't ended yet).
    if (currentMode && !gameOverFlag) {
        _settingsOpenedFrom = 'game';
    } else {
        _settingsOpenedFrom = 'menu';
    }

    // Only hide the main menu when we're actually on the menu —
    // during a game mainMenu is already hidden.
    if (_settingsOpenedFrom === 'menu') {
        const mm = document.getElementById('mainMenu');
        if (mm) mm.classList.add('hidden');
    }

    const overlay = document.getElementById('settingsOverlay');
    if (overlay) overlay.classList.remove('hidden');

    syncSettingsUI();

    // Try to (re)start the menu music on this user gesture.
    // This does NOT affect the game in any way.
    startMenuMusic();
}

function closeSettings() {
    const overlay = document.getElementById('settingsOverlay');
    if (overlay) overlay.classList.add('hidden');

    if (_settingsOpenedFrom === 'menu') {
        const mm = document.getElementById('mainMenu');
        if (mm) mm.classList.remove('hidden');
    }
    // If it was 'game' → we simply do nothing else. The game
    // canvas, timer, animations etc. were never touched.

    _settingsOpenedFrom = null;
}

// Push the current settings values into the UI controls.
function syncSettingsUI() {
    const mToggle = document.getElementById('musicEnabledToggle');
    const mSlider = document.getElementById('musicVolumeSlider');
    const sSlider = document.getElementById('sfxVolumeSlider');
    const qToggle = document.getElementById('queenVoiceToggle');
    const cdToggle = document.getElementById('showCooldownToggle');

    if (mToggle) mToggle.checked = !!gameSettings.musicEnabled;
    if (mSlider) {
        mSlider.value = gameSettings.musicVolume;
        document.getElementById('musicVolumeValue').textContent = gameSettings.musicVolume + '%';
    }
    if (sSlider) {
        sSlider.value = gameSettings.sfxVolume;
        document.getElementById('sfxVolumeValue').textContent = gameSettings.sfxVolume + '%';
    }
    if (qToggle) qToggle.checked = !!gameSettings.queenVoice;
    if (cdToggle) cdToggle.checked = !!gameSettings.showCooldownNumbers;

    document.querySelectorAll('#settingsOverlay .mode-btn[data-quality]').forEach(b => {
        b.classList.toggle('active', b.dataset.quality === gameSettings.graphicsQuality);
    });
}

// ── Individual setters ──
function setMusicEnabled(enabled) {
    gameSettings.musicEnabled = !!enabled;
    saveGameSettings();
    if (enabled) startMenuMusic();
    else stopMenuMusic();
    updateMusicVolume();
}

function setMusicVolume(v) {
    gameSettings.musicVolume = Math.max(0, Math.min(100, parseInt(v) || 0));
    document.getElementById('musicVolumeValue').textContent = gameSettings.musicVolume + '%';
    saveGameSettings();
    updateMusicVolume();
}

function setSfxVolume(v) {
    gameSettings.sfxVolume = Math.max(0, Math.min(100, parseInt(v) || 0));
    document.getElementById('sfxVolumeValue').textContent = gameSettings.sfxVolume + '%';
    saveGameSettings();
}

function setQueenVoiceEnabled(enabled) {
    gameSettings.queenVoice = !!enabled;
    // Reuse the existing mechanism (which also persists the flag)
    setQueenVoiceMuted(!enabled);
    saveGameSettings();
}

function setShowCooldownNumbers(enabled) {
    gameSettings.showCooldownNumbers = !!enabled;
    saveGameSettings();
    // Refresh any pieces currently on the board so sprites update immediately
    if (typeof createPieces3D === 'function' && gameState) {
        try { createPieces3D(); } catch (_) { }
    }
}

function setGraphicsQuality(quality) {
    if (!['low', 'medium', 'high'].includes(quality)) return;
    gameSettings.graphicsQuality = quality;
    document.querySelectorAll('#settingsOverlay .mode-btn[data-quality]').forEach(b => {
        b.classList.toggle('active', b.dataset.quality === quality);
    });
    saveGameSettings();
    applyGraphicsQuality(quality);
}

function applyGraphicsQuality(quality) {
    if (!renderer || !scene) return;

    let pixelRatio, shadowOn, shadowType;
    if (quality === 'low') {
        pixelRatio = 1;
        shadowOn = false;
    } else if (quality === 'high') {
        pixelRatio = Math.min(window.devicePixelRatio, 2);
        shadowOn = true;
        shadowType = THREE.PCFSoftShadowMap;
    } else {
        pixelRatio = Math.min(window.devicePixelRatio, 1.5);
        shadowOn = true;
        shadowType = THREE.PCFShadowMap;
    }

    renderer.setPixelRatio(pixelRatio);
    renderer.shadowMap.enabled = shadowOn;
    if (shadowOn && shadowType !== undefined) {
        renderer.shadowMap.type = shadowType;
    }
    renderer.shadowMap.needsUpdate = true;
    scene.traverse(n => { if (n.material) n.material.needsUpdate = true; });
}

function resetSettingsToDefaults() {
    if (!confirm('確定要將所有設定重設為預設值嗎？')) return;
    gameSettings = { ...DEFAULT_GAME_SETTINGS };
    saveGameSettings();

    // Sync back to the queen-voice mute mechanism
    queenVoiceMuted = false;
    try { localStorage.setItem('queenVoiceMuted', '0'); } catch (_) { }

    syncSettingsUI();
    applyGraphicsQuality(gameSettings.graphicsQuality);
    updateMusicVolume();
    if (gameSettings.musicEnabled) startMenuMusic();
}

// ============================================================
//  ★ Background music — preloaded at page load, played on first gesture
// ============================================================
let bgmAudio = null;
let bgmWantsToPlay = false;   // set true when a gesture or setting change
// asks for playback, even if the file isn't
// buffered yet

/**
 * Create the Audio element EARLY — during window.onload — so the browser
 * starts downloading the MP3 immediately, in parallel with the rest of
 * the page. Do NOT wait for the first user gesture.
 *
 * Call this once from window.onload, right after loadGameSettings().
 */
function preloadBGM() {
    if (bgmAudio) return;
    bgmAudio = new Audio('assets/sounds/Midnight_On_The_Board.mp3');
    bgmAudio.loop = true;
    bgmAudio.preload = 'auto';                    // allow full download
    bgmAudio.volume = gameSettings.musicVolume / 100;

    // Force the browser to start the request now
    try { bgmAudio.load(); } catch (_) { }

    // If a gesture asked for playback before the file was ready,
    // auto-play the moment the browser has enough data.
    bgmAudio.addEventListener('canplaythrough', () => {
        if (bgmWantsToPlay && bgmAudio.paused) {
            bgmAudio.play().catch(err => {
                console.warn('🎵 BGM 播放被阻擋:', err.message);
            });
        }
    });
}

function startMenuMusic() {
    if (!gameSettings.musicEnabled) return;
    if (gameSettings.musicVolume <= 0) return;

    if (!bgmAudio) preloadBGM();          // safety net if called too early

    bgmWantsToPlay = true;

    // ★ If the file is already buffered (thanks to preloadBGM) → play now.
    //   readyState ≥ 3 means HAVE_FUTURE_DATA (enough data to play through).
    if (bgmAudio.readyState >= 3) {
        if (bgmAudio.paused) {
            bgmAudio.play().catch(err => {
                console.warn('🎵 BGM 播放被阻擋:', err.message);
            });
        }
    }
    // ★ Otherwise the 'canplaythrough' listener above will fire when ready.
}

function stopMenuMusic() {
    if (!bgmAudio) return;
    bgmWantsToPlay = false;
    bgmAudio.pause();
    // 保留 currentTime，下次 resume 時從中斷處繼續
}

function updateMusicVolume() {
    if (!bgmAudio) return;
    bgmAudio.volume = gameSettings.musicEnabled
        ? gameSettings.musicVolume / 100
        : 0;
}

// Public helper so any future SFX system can respect the user's volume.
function getSfxVolume() {
    return gameSettings.sfxVolume / 100;
}

// ============================================================
//  ★ Battle/Vs — visual FX triggers
// ============================================================

/** Flash the whole arena + shake the stage + ring sparks. */
function triggerBattleImpact(intensity = 1) {
    const flash = document.getElementById('battleScreenFlash');
    const stage = document.querySelector('#battleOverlay .battle-stage');
    const sparks = document.getElementById('battleHitSparks');

    if (flash) {
        flash.classList.remove('trigger');
        void flash.offsetWidth;
        flash.classList.add('trigger');
    }
    if (stage) {
        stage.classList.remove('shake');
        void stage.offsetWidth;
        stage.classList.add('shake');
    }
    if (sparks) {
        sparks.classList.remove('trigger');
        void sparks.offsetWidth;
        sparks.classList.add('trigger');
    }
}

/** Show the combo badge ("COMBO x2" etc.) — optional flair. */
function showComboBadge(count) {
    if (count < 2) return;
    const el = document.getElementById('battleComboBadge');
    if (!el) return;
    el.textContent = `COMBO ×${count}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
}

/** Spawn a floating damage number in the arena. */
function spawnBattleDamageNumber(x, y, text, color = '#ffcc00') {
    const layer = document.getElementById('battleDamageLayer');
    if (!layer) return;
    const el = document.createElement('div');
    el.className = 'battle-damage-num';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.color = color;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

/** Mark a combatant as "hit" (shake + white flash). */
function markBattleCombatantHit(which) {
    const el = document.querySelector(
        which === 'player' ? '.battle-player' : '.battle-opponent'
    );
    if (!el) return;
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');

    const stats = el.querySelector('.battle-stats');
    if (stats) {
        stats.classList.remove('hit');
        void stats.offsetWidth;
        stats.classList.add('hit');
    }
}

// ============================================================
//  BOOT
// ============================================================
window.onload = () => {
    initThree();

    // ★ NEW — load saved settings before anything else uses them
    loadGameSettings();
    applyGraphicsQuality(gameSettings.graphicsQuality);

    // ★ NEW — start downloading the BGM immediately, so by the time
    //         the user taps anything the file is already buffered.
    preloadBGM();

    initQueenVoice();
    hideRemoteAim();
    updateActionButtonStates();
    if (IS_MOBILE) setupMobileCannonControls();

    // ★ NEW — hook the first user gesture to start menu music
    //   (browsers block AudioContext before any interaction)
    const startMusicOnFirstGesture = () => {
        startMenuMusic();
        document.removeEventListener('pointerdown', startMusicOnFirstGesture, true);
        document.removeEventListener('touchstart', startMusicOnFirstGesture, true);
        document.removeEventListener('keydown', startMusicOnFirstGesture, true);
    };
    document.addEventListener('pointerdown', startMusicOnFirstGesture, { capture: true, passive: true });
    document.addEventListener('touchstart', startMusicOnFirstGesture, { capture: true, passive: true });
    document.addEventListener('keydown', startMusicOnFirstGesture, { capture: true });

    setupMobileAutoFullscreen();
    setupForceLandscape();
    updateAIModeUI();
    updateTopBarReopenBtn();
    updateFullscreenBtnPosition();

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // ★ Surrender confirm sits on top of the battle overlay — check it first
            const surrenderOverlay = document.getElementById('battleSurrenderConfirmOverlay');
            if (surrenderOverlay && !surrenderOverlay.classList.contains('hidden')) {
                e.preventDefault();
                cancelBattleSurrenderConfirm();
                return;
            }
            const menuOverlay = document.getElementById('backToMenuConfirmOverlay');
            if (menuOverlay && !menuOverlay.classList.contains('hidden')) {
                e.preventDefault();
                cancelBackToMenuConfirm();
                return;
            }
            const overlay = document.getElementById('restartConfirmOverlay');
            if (overlay && !overlay.classList.contains('hidden')) {
                e.preventDefault();
                cancelRestartConfirm();
                return;
            }
            // ★ NEW — ESC also closes the settings panel
            const settingsOverlay = document.getElementById('settingsOverlay');
            if (settingsOverlay && !settingsOverlay.classList.contains('hidden')) {
                e.preventDefault();
                closeSettings();
            }
        }
    });
};