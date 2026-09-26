// ============================================================
//  GLOBALS
// ============================================================
let scene, camera, renderer, raycaster, clock;
let boardGroup, piecesGroup, highlightsGroup, ghostLineGroup;
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
let _pinchStartDist = null;
let _pinchStartRadius = null;

// ★ 棋子唯一 ID（用來推算「已陣亡棋子」，供皇后復活使用）
let _pieceIdCounter = 0;
// ★ 皇后復活選擇中的暫存狀態
let pendingRevive = null;

// ============================================================
//  ★ Queen voice — Web Speech API wrapper
// ============================================================
const QUEEN_VOICE_PREFS = [
    'Google UK English Female',
    'Google US English',
    'Samantha',
    'Karen',
    'Moira',
    'Tessa',
    'Fiona',
    'Victoria',
    'Microsoft Zira',
    'Microsoft Hazel',
    'Microsoft Aria',
    'Female',
];

let queenVoice = null;
let queenVoiceMuted = false;
try { queenVoiceMuted = localStorage.getItem('queenVoiceMuted') === '1'; } catch (_) { }

function initQueenVoice() {
    if (!('speechSynthesis' in window)) return;

    const pickVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        if (!voices || voices.length === 0) return;
        for (const pref of QUEEN_VOICE_PREFS) {
            const v = voices.find(v =>
                v.name.toLowerCase().includes(pref.toLowerCase()));
            if (v) { queenVoice = v; return; }
        }
        const anyEn = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en'));
        if (anyEn) { queenVoice = anyEn; return; }
        queenVoice = voices[0];
    };

    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
}

function speakQueenLine(text) {
    if (queenVoiceMuted) return;
    if (!('speechSynthesis' in window)) return;

    try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        if (queenVoice) u.voice = queenVoice;
        u.lang = (queenVoice && queenVoice.lang) || 'en-GB';
        u.pitch = 1.35;
        u.rate = 0.92;
        u.volume = 1.0;
        window.speechSynthesis.speak(u);
    } catch (err) {
        console.warn('🔇 Speech failed:', err);
    }
}

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

let hostKnownClientSessionId = null;
let isReconnecting = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let reconnectGraceTimer = null;

const MAX_RECONNECT_ATTEMPTS = 20;
const RECONNECT_INTERVAL_MS = 2500;
const RECONNECT_GRACE_MS = 60000;

let _mobileFsAttempted = false;

async function enterMobileFullscreen() {
    if (IS_STANDALONE) return;

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
    } catch (err) { }

    try {
        if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape').catch(() => { });
        }
    } catch (_) { }

    if (IS_IOS && !IS_STANDALONE) {
        window.scrollTo(0, 1);
        setTimeout(() => window.scrollTo(0, 1), 120);
    }
}

// ============================================================
//  ★ Auto-Force Landscape System
// ============================================================
let _landscapeLockAttempted = false;

function isPortraitOrientation() {
    if (screen.orientation && typeof screen.orientation.type === 'string') {
        return screen.orientation.type.startsWith('portrait');
    }
    return window.innerHeight > window.innerWidth;
}

async function tryLockLandscape() {
    if (!screen.orientation || !screen.orientation.lock) return false;
    const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (!inFs) return false;
    try {
        await screen.orientation.lock('landscape');
        return true;
    } catch (_) {
        return false;
    }
}

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

async function enforceLandscape() {
    _landscapeLockAttempted = true;

    if (IS_MOBILE && !IS_STANDALONE) {
        try { await enterMobileFullscreen(); } catch (_) { }
    }

    await tryLockLandscape();
    updateRotateOverlay();
}

function setupForceLandscape() {
    if (!IS_MOBILE) return;

    const firstTap = () => {
        if (_landscapeLockAttempted) return;
        enforceLandscape();
        document.removeEventListener('touchend', firstTap, true);
        document.removeEventListener('click', firstTap, true);
    };
    document.addEventListener('touchend', firstTap, { capture: true, passive: true });
    document.addEventListener('click', firstTap, { capture: true, passive: true });

    const onFsChange = () => {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            tryLockLandscape();
        }
        updateRotateOverlay();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('mozfullscreenchange', onFsChange);
    document.addEventListener('MSFullscreenChange', onFsChange);

    if (screen.orientation && screen.orientation.addEventListener) {
        screen.orientation.addEventListener('change', updateRotateOverlay);
    }
    window.addEventListener('orientationchange', () => {
        setTimeout(updateFullscreenBtnPosition, 120);
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateFullscreenBtnPosition);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            updateRotateOverlay();
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                tryLockLandscape();
            }
        }
    });

    updateRotateOverlay();
}

function setupMobileAutoFullscreen() {
    if (!IS_MOBILE || IS_STANDALONE) return;

    const handler = () => {
        if (_mobileFsAttempted) return;
        _mobileFsAttempted = true;
        enterMobileFullscreen();
        document.removeEventListener('touchend', handler, true);
        document.removeEventListener('click', handler, true);
    };

    document.addEventListener('touchend', handler, { capture: true, passive: true });
    document.addEventListener('click', handler, { capture: true, passive: true });

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

let knightAbilityActive = false;
let knightAbilityState = null;
let knockbackArrowGroup = null;

const KNOCKBACK_BLOCK_DAMAGE = 25;

const SKILL_COOLDOWNS = {
    pawn: 1,
    knight: 2,
    bishop: 2,
    rook: 1,
    queen: 2,
    king: 1,
};

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
        this.initialPieces = [];

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
                stunned: 0,
                justStunned: false,
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

    getPiece(r, c) { return this.board[r][c]; }

    isInBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

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

                if (p.justUsedSkill) p.justUsedSkill = false;
                else if ((p.skillCooldown || 0) > 0) p.skillCooldown--;

                if (p.justUsedRevive) p.justUsedRevive = false;
                else if ((p.reviveCooldown || 0) > 0) p.reviveCooldown--;

                if (p.justStunned) p.justStunned = false;
                else if ((p.stunned || 0) > 0) p.stunned--;
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
        if ((piece.stunned || 0) > 0) return [];

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
            tempGameObj.moveHistory = this.moveHistory;      // ← add these
            tempGameObj.fullMoveNumber = this.fullMoveNumber;
            tempGameObj.halfMoveClock = this.halfMoveClock;
            tempGameObj.turn = this.turn;
            tempGameObj.initialPieces = this.initialPieces;
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
            } else if (caster && caster.type === 'rook') {
                targetPiece.stunned = 1;
                targetPiece.justStunned = true;
            }
        }
        this.putOnSkillCooldown(caster);
        this.halfMoveClock++;

        // FIX: Expire en passant status when a skill is used
        this.enPassantTarget = null;
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

            // FIX: Place the capturing pawn onto the target square (E3)
            const newPiece = { ...piece, hasMoved: true };
            this.board[toR][toC] = newPiece;

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
        name: '城堡 (Rook)', glyph: '♜',
        skillName: '雷霆加農炮 (Thunder Cannon)',
        description:
            '城堡發射雷霆加農炮，可自由瞄準 4 格範圍內的任意位置。\n' +
            '命中範圍內所有敵方棋子各受到 <b>35</b> 點傷害，' +
            '並且存活的目標會被<b>麻痺 1 回合</b>（無法移動、無法使用技能）。\n' +
            '冷卻 1 回合。',
        damage: 35, selfDamage: 0, cooldown: 1,
        board: () => {
            const caster = { r: 4, c: 4 };
            const damage = [];
            for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
                const d = Math.hypot(r - caster.r, c - caster.c);
                if (d === 0) continue;
                if (d <= 4) damage.push({ r, c });
            }
            return {
                caster: { ...caster, type: 'rook', color: 'white', icon: '♜' },
                damage,
                landing: { r: 2, c: 6 }
            };
        },
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
                let hasPiece = false;
                for (let step = 1; step < 8; step++) {
                    const tr = r + dr * step;
                    const tc = c + dc * step;
                    if (!game.isInBounds(tr, tc)) break;

                    const target = game.getPiece(tr, tc);
                    if (target) {
                        hasPiece = true;
                    } else if (hasPiece) {
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
    king: {
        id: 'domain',
        name: '領域展開 (Domain Expansion)',
        damage: 0,
        getTargets: (game, r, c) => {
            const piece = game.getPiece(r, c);
            if (!piece) return [];

            if (kingSkillState.uses[piece.color] <= 0) return [];

            const movesSince = game.fullMoveNumber - kingSkillState.lastUsedMove[piece.color];
            if (movesSince < KING_DOMAIN_COOLDOWN) return [];

            if (!game.isInCheck(piece.color)) return [];

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

const QUEEN_REVIVE_ABILITY = {
    id: 'revive',
    name: '復活 (Revive)',
    damage: 0,
};

// ============================================================
//  ★ 皇后技能輔助
// ============================================================
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
            break;
        }
    }
    return targets;
}

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

function getKnightPushLandings(game, fromR, fromC) {
    const piece = game.getPiece(fromR, fromC);
    if (!piece) return [];
    const moves = game.getLegalMoves(fromR, fromC);
    return moves.filter(m => {
        const victims = getPushableVictims(game, m.r, m.c, fromR, fromC, piece.color);
        return victims.length > 0;
    });
}

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

let aiGameModeEnabled = true;
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
    if ((piece.stunned || 0) > 0) return [];


    if (!isAbilityEnabledForColor(piece.color)) return [];
    if (piece.type !== 'queen' && (piece.skillCooldown || 0) > 0) return [];

    const abilityDef = ABILITIES[piece.type];
    if (!abilityDef) return [];

    if (piece.type === 'pawn') {
        const targets = abilityDef.getTargets(this, r, c);
        return targets.map(t => ({
            type: 'ability', fromR: r, fromC: c, r: t.r, c: t.c, ability: abilityDef
        }));
    }

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

    if (piece.type === 'king') {
        const targets = abilityDef.getTargets(this, r, c);
        return targets.map(t => ({
            type: 'ability', fromR: r, fromC: c, r: t.r, c: t.c, ability: abilityDef
        }));
    }

    if (piece.type === 'queen') {
        const out = [];

        if ((piece.skillCooldown || 0) === 0) {
            for (const t of getQueenHealTargets(this, r, c)) {
                out.push({
                    type: 'ability', fromR: r, fromC: c, r: t.r, c: t.c,
                    ability: ABILITIES.queen,
                });
            }
        }

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
    if (timerState.interval) {
        clearInterval(timerState.interval);
        timerState.interval = null;
    }
    updateTimerDisplay();
}

function resumeTimer() {
    timerState.paused = false;
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
        "position": { "x": -4.2, "y": 0, "z": 0 }
    },
    "rook": {
        "bodyRadius": 0.2,
        "bodyHeight": 0.44,
        "crownRadius": 0.285,
        "crownHeight": 0.13,
        "color": "#f5f0e1",
        "roughness": 0.25,
        "metalness": 0.2,
        "position": { "x": -2.52, "y": 0.02, "z": 0 },
        "parts": {
            "custom_1002": { "type": "box", "geometryParams": { "width": 0.2, "height": 0.2, "depth": 0.2 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": -0.21, "y": 0.62, "z": 0 }, "rotation": { "x": 0, "y": 1.56, "z": 0 }, "scale": { "x": 1, "y": 1, "z": 0.4 }, "name": "Box Copy Copy Copy" },
            "custom_1000": { "type": "box", "geometryParams": { "width": 0.2, "height": 0.2, "depth": 0.2 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.62, "z": 0.21 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1, "y": 1, "z": 0.4 }, "name": "Box Copy" },
            "custom_1001": { "type": "box", "geometryParams": { "width": 0.2, "height": 0.2, "depth": 0.2 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0.21, "y": 0.62, "z": 0 }, "rotation": { "x": 0, "y": 1.56, "z": 0 }, "scale": { "x": 1, "y": 1, "z": 0.4 }, "name": "Box Copy Copy" },
            "custom_1003": { "type": "box", "geometryParams": { "width": 0.2, "height": 0.2, "depth": 0.2 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.62, "z": -0.21 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1, "y": 1, "z": 0.4 }, "name": "Box Copy Copy" }
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
        "position": { "x": -0.84, "y": 0.02, "z": 0 },
        "parts": {
            "body": { "deleted": true },
            "neck": { "deleted": true },
            "head": { "deleted": true },
            "custom_1022": { "type": "sphere", "geometryParams": { "radius": 0.15 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.17, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 2, "y": 0.69, "z": 2 }, "name": "Sphere" },
            "custom_1023": { "type": "cone", "geometryParams": { "radius": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.3229, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1.85, "y": 0.8, "z": 1.85 }, "name": "Cone" },
            "custom_1024": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.53, "z": -0.03 }, "rotation": { "x": -0.38, "y": 0.17, "z": -0.04 }, "scale": { "x": 0.92, "y": 1.77, "z": 0.92 }, "name": "Cylinder" },
            "custom_1030": { "type": "octahedron", "geometryParams": { "radius": 0.2, "detail": 0 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": -0.0818, "y": 0.94, "z": -0.18 }, "rotation": { "x": -0.05, "y": 0.03, "z": 0.19 }, "scale": { "x": 0.43, "y": 1, "z": 0.63 }, "name": "Octa" },
            "custom_1031": { "type": "octahedron", "geometryParams": { "radius": 0.2, "detail": 0 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0.0794, "y": 0.94, "z": -0.18 }, "rotation": { "x": -0.05, "y": 0.03, "z": -0.19 }, "scale": { "x": 0.43, "y": 1, "z": 0.63 }, "name": "Octa Copy" },
            "custom_1033": { "type": "box", "geometryParams": { "width": 0.2, "height": 0.2, "depth": 0.2 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.4314, "z": -0.0939 }, "rotation": { "x": -0.6105, "y": 0, "z": 0 }, "scale": { "x": 0.3144, "y": 1.7371, "z": 1 }, "name": "Box" },
            "custom_1034": { "type": "box", "geometryParams": { "width": 0.2, "height": 0.2, "depth": 0.2 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.5162, "z": -0.1167 }, "rotation": { "x": -0.6105, "y": 0, "z": 0 }, "scale": { "x": 0.3144, "y": 1.7371, "z": 1 }, "name": "Box Copy" },
            "custom_1035": { "type": "box", "geometryParams": { "width": 0.2, "height": 0.2, "depth": 0.2 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.5942, "z": -0.1273 }, "rotation": { "x": -0.6105, "y": 0, "z": 0 }, "scale": { "x": 0.3144, "y": 1.7371, "z": 1 }, "name": "Box Copy Copy" },
            "custom_1036": { "type": "box", "geometryParams": { "width": 0.2, "height": 0.2, "depth": 0.2 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.7013, "z": -0.1437 }, "rotation": { "x": -0.6105, "y": 0, "z": 0 }, "scale": { "x": 0.3144, "y": 1.7371, "z": 1 }, "name": "Box Copy Copy Copy" },
            "custom_1037": { "type": "box", "geometryParams": { "width": 0.2, "height": 0.2, "depth": 0.2 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.6559, "z": -0.142 }, "rotation": { "x": -0.6105, "y": 0, "z": 0 }, "scale": { "x": 0.3144, "y": 1.7371, "z": 1 }, "name": "Box Copy Copy Copy Copy" },
            "custom_1038": { "type": "box", "geometryParams": { "width": 0.2, "height": 0.2, "depth": 0.2 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.7539, "z": -0.142 }, "rotation": { "x": -0.6105, "y": 0, "z": 0 }, "scale": { "x": 0.3144, "y": 1.7371, "z": 1 }, "name": "Box Copy Copy Copy Copy Copy" },
            "custom_1040": { "type": "box", "geometryParams": { "width": 0.2, "height": 0.2, "depth": 0.2 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.8542, "z": -0.1892 }, "rotation": { "x": -0.6105, "y": 0, "z": 0 }, "scale": { "x": 0.3144, "y": 1.2543, "z": 0.6819 }, "name": "Box Copy Copy Copy Copy Copy Copy" },
            "custom_1041": { "type": "box", "geometryParams": { "width": 0.2, "height": 0.2, "depth": 0.2 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.8718, "z": -0.133 }, "rotation": { "x": -0.6105, "y": 0, "z": 0 }, "scale": { "x": 0.3144, "y": 1.7371, "z": 1 }, "name": "Box Copy Copy Copy Copy Copy Copy Copy" },
            "custom_1043": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.33, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1.6, "y": 0.06, "z": 1.6 }, "name": "Cylinder" },
            "custom_1045": { "type": "cone", "geometryParams": { "radius": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.47, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1.45, "y": 1, "z": 1.45 }, "name": "Cone" },
            "custom_1046": { "type": "sphere", "geometryParams": { "radius": 0.15 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0.11, "y": 0.92, "z": 0.02 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.35, "y": 0.35, "z": 0.35 }, "name": "Sphere" },
            "custom_1047": { "type": "sphere", "geometryParams": { "radius": 0.15 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": -0.1088, "y": 0.92, "z": 0.02 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.35, "y": 0.35, "z": 0.35 }, "name": "Sphere Copy" },
            "custom_1048": { "type": "dodecahedron", "geometryParams": { "radius": 0.2, "detail": 0 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.985, "z": -0.0815 }, "rotation": { "x": 0.2342, "y": -0.0241, "z": -0.0591 }, "scale": { "x": -0.1606, "y": 0.7488, "z": 1.174 }, "name": "Dodeca" },
            "custom_1049": { "type": "icosahedron", "geometryParams": { "radius": 0.2, "detail": 0 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.5253, "z": -0.0958 }, "rotation": { "x": -0.1055, "y": 0, "z": -0.04 }, "scale": { "x": 0.9458, "y": 1.725, "z": 0.9099 }, "name": "Icosa" },
            "custom_1052": { "type": "air", "geometryParams": { "width": 0.3, "height": 0.3, "depth": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.7179, "z": 0.3185 }, "rotation": { "x": 0.25, "y": 0, "z": 0 }, "scale": { "x": 0.7, "y": 0.13, "z": 0.51 }, "name": "Air" },
            "custom_1056": { "type": "air", "geometryParams": { "width": 0.3, "height": 0.3, "depth": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.6574, "z": 0.3201 }, "rotation": { "x": -0.456, "y": 0.0381, "z": 0.0083 }, "scale": { "x": 1, "y": 0.1215, "z": 0.3373 }, "name": "Air Copy" },
            "custom_1064": { "type": "dodecahedron", "geometryParams": { "radius": 0.2, "detail": 0 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.5887, "z": -0.0514 }, "rotation": { "x": -0.468, "y": 0.091, "z": 0.0164 }, "scale": { "x": 1.0629, "y": 2.18, "z": 0.8604 }, "name": "Dodeca" },
            "custom_1065": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": -0.04, "y": 0.75, "z": 0.37 }, "rotation": { "x": 1.64, "y": 0.02, "z": -0.07 }, "scale": { "x": 0.1, "y": 0.1, "z": 0.1 }, "name": "Cylinder" },
            "custom_1066": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0.04, "y": 0.75, "z": 0.37 }, "rotation": { "x": 1.64, "y": 0.02, "z": -0.07 }, "scale": { "x": 0.1, "y": 0.1, "z": 0.1 }, "name": "Cylinder Copy" },
            "custom_1070": { "type": "cone", "geometryParams": { "radius": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.18, "z": 0 }, "rotation": { "x": -3.14, "y": -0.29, "z": 0 }, "scale": { "x": 1.45, "y": 1, "z": 1.45 }, "name": "Cone Copy" },
            "custom_2000": { "type": "frustum", "name": "Frustum", "geometryParams": {}, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.8282, "z": 0.0959 }, "rotation": { "x": 1.95, "y": 0, "z": 0 }, "scale": { "x": 0.928, "y": 1.95, "z": 0.72 } }
        }
    },
    "bishop": {
        "bodyRadius": 0.22,
        "bodyHeight": 0.42,
        "sphereRadius": 0.1,
        "color": "#ffffff",
        "roughness": 0.25,
        "metalness": 0.2,
        "position": { "x": 0.84, "y": 0.02, "z": 0 },
        "parts": {
            "body": { "deleted": true },
            "sphere": { "deleted": true },
            "custom_1000": { "type": "cone", "geometryParams": { "radius": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0.002, "y": 0.2385, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1.9999, "y": 0.9193, "z": 1.9931 }, "name": "Cone" },
            "custom_1001": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.1306, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1.2957, "y": 1, "z": 1.2146 }, "name": "Cylinder" },
            "custom_1003": { "type": "cone", "geometryParams": { "radius": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.52, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1.25, "y": 2.91, "z": 1.25 }, "name": "Cone" },
            "custom_1004": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.59, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.65, "y": 1.25, "z": 0.65 }, "name": "Cylinder" },
            "custom_1005": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.6888, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1, "y": -0.0615, "z": 1 }, "name": "Cylinder" },
            "custom_1006": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.7085, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.8292, "y": -0.0999, "z": 0.8503 }, "name": "Cylinder Copy" },
            "custom_1007": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.7318, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.5847, "y": 0.0505, "z": 0.612 }, "name": "Cylinder" },
            "custom_1009": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 1.016, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.51, "y": 0.15, "z": 0.56 }, "name": "Cylinder" },
            "custom_1010": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.9859, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.3, "y": 0.0559, "z": 0.3 }, "name": "Cylinder Copy" },
            "base": { "position": { "x": 0, "y": 0.06, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1, "y": 1, "z": 1 } },
            "custom_1016": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.7763, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.5847, "y": 0.0505, "z": 0.612 }, "name": "Cylinder Copy" },
            "custom_1017": { "type": "cone", "geometryParams": { "radius": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.9228, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.85, "y": 0.7, "z": 0.85 }, "name": "Cone" },
            "custom_1018": { "type": "cone", "geometryParams": { "radius": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.754, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 3.15 }, "scale": { "x": 0.85, "y": 0.45, "z": 0.85 }, "name": "Cone Copy" },
            "custom_1021": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.7686, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.8292, "y": -0.0999, "z": 0.8503 }, "name": "Cylinder Copy Copy" },
            "custom_2000": { "type": "air", "name": "Air Cut", "geometryParams": { "width": 0.3, "height": 0.3, "depth": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": -0.0439, "y": 0.9095, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": -0.6966 }, "scale": { "x": 0.5051, "y": 0.0664, "z": 0.5818 } }
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
        "position": { "x": 2.52, "y": 0.03, "z": 0 },
        "parts": {
            "custom_1000": { "type": "torus", "geometryParams": { "radius": 0.15, "tube": 0.05 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.57, "z": 0 }, "rotation": { "x": -1.56, "y": 0, "z": 0 }, "scale": { "x": 1.56, "y": 1.58, "z": 1.12 }, "name": "Torus" },
            "custom_1001": { "type": "cone", "geometryParams": { "radius": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.62, "z": 0 }, "rotation": { "x": -3.14, "y": 0, "z": 0 }, "scale": { "x": 2.12, "y": 0.5, "z": 1 }, "name": "Cone" },
            "custom_1002": { "type": "cone", "geometryParams": { "radius": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.62, "z": 0 }, "rotation": { "x": -3.14, "y": -1.58, "z": 0 }, "scale": { "x": 2.16, "y": 0.5, "z": 1 }, "name": "Cone" },
            "spike": { "position": { "x": 0, "y": 0.79, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1, "y": 1, "z": 1 } },
            "crown": { "position": { "x": 0, "y": 0.52, "z": 0 }, "rotation": { "x": -3.14, "y": 0, "z": 0 }, "scale": { "x": 1, "y": 0.48, "z": 1 } },
            "body": { "position": { "x": 0, "y": 0.32, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.7, "y": 1, "z": 0.7 } }
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
        "position": { "x": 4.2, "y": 0.04, "z": 0 },
        "parts": {
            "base": { "position": { "x": 0, "y": 0.06, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1, "y": 1, "z": 1 } },
            "body": { "deleted": true },
            "crown": { "deleted": true },
            "crossV": { "deleted": true },
            "crossH": { "deleted": true },
            "custom_1000": { "type": "cone", "geometryParams": { "radius": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0.002, "y": 0.2539, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1.9999, "y": 0.9193, "z": 1.9931 }, "name": "Cone" },
            "custom_1001": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.1491, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1.2957, "y": 1, "z": 1.2146 }, "name": "Cylinder" },
            "custom_1003": { "type": "cone", "geometryParams": { "radius": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.4262, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1.0914, "y": 2.9097, "z": 1.2881 }, "name": "Cone" },
            "custom_1004": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.5664, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.4607, "y": 1.5936, "z": 0.52 }, "name": "Cylinder" },
            "custom_1005": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.736, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1, "y": -0.0615, "z": 1 }, "name": "Cylinder" },
            "custom_1006": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.7539, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.8292, "y": -0.0999, "z": 0.8503 }, "name": "Cylinder Copy" },
            "custom_1007": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.8041, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.5847, "y": 0.0505, "z": 0.612 }, "name": "Cylinder" },
            "custom_1008": { "type": "cone", "geometryParams": { "radius": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.8217, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": -3.15 }, "scale": { "x": 1, "y": 1, "z": 1 }, "name": "Cone" },
            "custom_1009": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.9791, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.51, "y": 0.0552, "z": 0.5632 }, "name": "Cylinder" },
            "custom_1010": { "type": "cylinder", "geometryParams": { "radiusTop": 0.15, "radiusBottom": 0.15, "height": 0.3 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.9859, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.3, "y": 0.0559, "z": 0.3 }, "name": "Cylinder Copy" },
            "custom_1012": { "type": "box", "geometryParams": { "width": 0.2, "height": 0.2, "depth": 0.2 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 1.0719, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.9734, "y": 0.3662, "z": 0.2203 }, "name": "Box" },
            "custom_1013": { "type": "box", "geometryParams": { "width": 0.2, "height": 0.2, "depth": 0.2 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 1.07, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": -1.58 }, "scale": { "x": 0.8, "y": 0.37, "z": 0.22 }, "name": "Box Copy" },
            "custom_1015": { "type": "frustum", "geometryParams": { "radiusTop": 0.08, "radiusBottom": 0.18, "height": 0.3, "segments": 16 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 1.17, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.25, "y": 0.14, "z": 0.15 }, "name": "Frustum" },
            "custom_1016": { "type": "sphere", "geometryParams": { "radius": 0.15 }, "roughness": 0.5, "metalness": 0.2, "position": { "x": 0, "y": 0.523, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 0.5268, "y": 0.6517, "z": 0.6517 }, "name": "Sphere" }
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
//  CSG LIBRARY
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

function meshToCSGPolygons(mesh) {
    mesh.updateMatrixWorld(true);
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const posAttr = geo.attributes.position;
    const normAttr = geo.attributes.normal;
    const matrix = mesh.matrixWorld;
    const nrmMatrix = new THREE.Matrix3().getNormalMatrix(matrix);

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
        for (let c = 0; c < 8; c++) {
            const isLight = (r + c) % 2 === 0;
            const geo = getGeo('boardSquare', () => new THREE.BoxGeometry(0.98, 0.1, 0.98));
            const square = new THREE.Mesh(geo, isLight ? lightMat : darkMat);
            square.position.set(c - 3.5, -0.05, 3.5 - r);
            square.receiveShadow = true;
            square.userData = { row: r, col: c, type: 'square' };
            boardGroup.add(square);
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
            case 'frustum':
                return new THREE.CylinderGeometry(
                    params.radiusTop ?? 0.08,
                    params.radiusBottom ?? 0.18,
                    params.height || 0.3,
                    params.segments || 16
                );
            case 'tetrahedron':
                return new THREE.TetrahedronGeometry(params.radius || 0.2, params.detail || 0);
            case 'octahedron':
                return new THREE.OctahedronGeometry(params.radius || 0.2, params.detail || 0);
            case 'dodecahedron':
                return new THREE.DodecahedronGeometry(params.radius || 0.2, params.detail || 0);
            case 'icosahedron':
                return new THREE.IcosahedronGeometry(params.radius || 0.2, params.detail || 0);
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
            if (partData.deleted) continue;

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
                airMesh.visible = false;
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

function createPieces3D() {
    clearSelectionAura();

    if (piecesGroup) {
        piecesGroup.traverse(n => {
            if (n.userData && n.userData.__stunAuraState) {
                n.userData.__stunAuraState.dispose();
            }
        });
        scene.remove(piecesGroup);
    }
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
                if (gameSettings.showCooldownNumbers) {
                    const cd = piece.skillCooldown || 0;
                    if (cd > 0) {
                        const cdSprite = createCooldownSprite(cd);
                        obj.add(cdSprite);
                        obj.userData.cooldownSprite = cdSprite;
                    }
                }
                const cdRev = piece.reviveCooldown || 0;
                if (cdRev > 0) {
                    const revSprite = createCooldownSprite(cdRev, 0xc38bff);
                    revSprite.position.set(-0.32, 0.95, 0);
                    obj.add(revSprite);
                    obj.userData.reviveCooldownSprite = revSprite;
                }
                piecesGroup.add(obj);

                if (gameSettings.showCooldownNumbers &&
                    piece.type === 'king' &&
                    typeof kingSkillState !== 'undefined') {
                    // ★ De-dup: if the generic block above already attached a sprite,
                    //   remove it so the king's domain badge doesn't overlap.
                    if (obj.userData.cooldownSprite) {
                        obj.remove(obj.userData.cooldownSprite);
                        if (obj.userData.cooldownSprite.material) {
                            if (obj.userData.cooldownSprite.material.map) {
                                obj.userData.cooldownSprite.material.map.dispose();
                            }
                            obj.userData.cooldownSprite.material.dispose();
                        }
                        obj.userData.cooldownSprite = null;
                    }

                    const movesSince = gameState.fullMoveNumber - kingSkillState.lastUsedMove[piece.color];
                    const domainCd = Math.max(0, KING_DOMAIN_COOLDOWN - movesSince);
                    const usesLeft = kingSkillState.uses[piece.color];

                    if (domainCd > 0) {
                        const cdSprite = createCooldownSprite(domainCd, 0xd9a6ff);
                        obj.add(cdSprite);
                        obj.userData.cooldownSprite = cdSprite;
                    } else if (usesLeft <= 0) {
                        const cdSprite = createCooldownSprite(0, 0x666666);
                        obj.add(cdSprite);
                        obj.userData.cooldownSprite = cdSprite;
                    }
                }

                if ((piece.stunned || 0) > 0) {
                    const stunAura = createStunAura();
                    obj.add(stunAura.group);
                    obj.userData.stunAura = stunAura;
                    stunAura.group.userData.__stunAuraState = stunAura;
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
    if (!pieceObj) return;

    // ── No sprite yet? Create one on demand ──
    if (!pieceObj.userData.hpSprite) {
        if (hp >= maxHp) return;          // still full HP → no bar needed
        addHealthBarToModel(pieceObj, hp, maxHp);
        return;
    }

    const sprite = pieceObj.userData.hpSprite;
    if (hp >= maxHp) {
        sprite.visible = false;
    } else {
        sprite.visible = true;
        updateHealthBarTexture(sprite, hp, maxHp);
    }
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

    const SQUARE_SIZE = 0.9;

    moves.forEach(m => {
        const isCapture = m.capture;
        const mat = isCapture ? capMat : dotMat;

        const geo = new THREE.PlaneGeometry(SQUARE_SIZE, SQUARE_SIZE);
        const highlight = new THREE.Mesh(geo, mat);
        highlight.rotation.x = -Math.PI / 2;
        highlight.position.set(m.c - 3.5, 0.04, 3.5 - m.r);
        highlight.userData = { row: m.r, col: m.c, type: 'highlight' };
        highlightsGroup.add(highlight);
    });
    const selMat = new THREE.MeshBasicMaterial({ color: 0xe8c547, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const selRing = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 32, 1, true), selMat);
    selRing.position.set(selectedC - 3.5, 0.03, 3.5 - selectedR);
    highlightsGroup.add(selRing);
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

    let ghostSquad = null;
    if (knockbackOption) {
        spawnKnightDashWind(fromR, fromC, landingR, landingC, duration);
        ghostSquad = spawnKnightGhostSquad(
            pieceObj,
            pieceObj.userData.color || 'white',
            duration,
            startPos,
            targetPos
        );
    }
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
        if (ghostSquad && !ghostSquad.fadingOut && !ghostSquad.disposed) {
            fadeOutKnightGhostSquad(ghostSquad);
        }
        isAnimating = false;

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

    const casterBishop = gameState.getPiece(fromR, fromC);
    gameState.putOnSkillCooldown(casterBishop);

    const pieceObj = pieceObjects[`${fromR},${fromC}`];
    if (!pieceObj) { isAnimating = false; return; }

    if (gameState.getPiece(toR, toC)) { isAnimating = false; return; }

    const pathPieces = getBishopPathPieces(gameState, fromR, fromC, toR, toC);

    if (currentMode === 'multiplayer' && peerConnection?.open && !isRemote) {
        sendAbilityToPeer(
            fromR, fromC,
            [{ r: toR, c: toC }],
            ability.name, ability.damage, 0
        );
    }

    spawnBishopLeapEffect(fromR, fromC, toR, toC);

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

            const piece = gameState.getPiece(fromR, fromC);
            if (!piece) { isAnimating = false; return; }
            gameState.board[fromR][fromC] = null;
            gameState.board[toR][toC] = piece;
            piece.hasMoved = true;
            delete pieceObjects[`${fromR},${fromC}`];
            pieceObjects[`${toR},${toC}`] = pieceObj;
            pieceObj.userData.row = toR;
            pieceObj.userData.col = toC;

            for (const pp of pathPieces) {
                const target = gameState.getPiece(pp.r, pp.c);
                if (target) {
                    target.hp -= ability.damage;
                    if (target.hp <= 0) gameState.board[pp.r][pp.c] = null;
                    showDamageEffect(pp.r, pp.c, ability.damage);
                }
            }

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

// ============================================================
//  ★ 皇后「復活」技能
// ============================================================
function executeQueenRevive(fromR, fromC, toR, toC, ability, reviveType = null, isRemote = false) {
    playSFX('heal');

    if (isAnimating) return;
    const caster = gameState.getPiece(fromR, fromC);
    if (!caster) return;
    if (gameState.getPiece(toR, toC)) return;

    const dead = gameState.getDeadPieces(caster.color);
    if (dead.length === 0) return;

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

    const _origIdx = gameState.initialPieces.findIndex(p => p.id === chosen.id);
    if (_origIdx >= 0) gameState.initialPieces.splice(_origIdx, 1);

    if (currentMode === 'multiplayer' && peerConnection?.open && !isRemote) {
        sendAbilityToPeer(fromR, fromC, [{ r: toR, c: toC }], ability.name, 0, 0, chosen.type);
    }

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

    syncPiecesAfterMove();
    spawnReviveEffect(toR, toC);

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
            setTimeout(finish, 750);
        }
    };
    anim();
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

// ============================================================
//  CANNON / ABILITY EXECUTION
// ============================================================
function fireAimedCannon() {
    if (!isAiming) return;

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
                    if (targetPiece.hp <= 0) {
                        gameState.board[target.r][target.c] = null;
                    } else {
                        applyCannonStun(targetPiece);
                    }
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
    const remoteRook = gameState.getPiece(fromR, fromC);
    gameState.putOnSkillCooldown(remoteRook);

    const startPos = get3DPosition(fromR, fromC, 0.6);
    const endPos = new THREE.Vector3(targetX, 0.05, targetZ);

    const actualTargets = targets ? targets.map(t => ({ r: t.r, c: t.c })) : [];

    if (actualTargets.length > 0) {
        for (const t of actualTargets) {
            const targetPiece = gameState.getPiece(t.r, t.c);
            if (targetPiece) {
                targetPiece.hp -= damage;
                if (targetPiece.hp <= 0) {
                    gameState.board[t.r][t.c] = null;
                } else {
                    applyCannonStun(targetPiece);
                }
                showDamageEffect(t.r, t.c, damage);
            }
        }
        gameState.moveHistory.push({
            type: 'areaAbility', abilityName: '加農炮 (Cannon)',
            fromR, fromC, targets: actualTargets, damageDealt: damage
        });
    } else {
        gameState.moveHistory.push({
            type: 'areaAbility', abilityName: '加農炮 (Cannon)',
            fromR, fromC, targets: [], damageDealt: 0, missed: true
        });
    }

    isAnimating = true;

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

    if (mode === 'attack' && abilityTargets.length === 0) {
        actionMode = 'move';
        hideCannonRange();
        clearSelectionAura();
        if (selectedPiece) showValidMoveHighlights(validMoves, selectedPiece.row, selectedPiece.col);
        updateActionButtonStates();
        return;
    }

    actionMode = mode;

    if (mode === 'move') {
        hideCannonRange();
        document.getElementById('aimHint').classList.remove('visible');
        hideGhostLine();
        clearSelectionAura();
        if (selectedPiece) showValidMoveHighlights(validMoves, selectedPiece.row, selectedPiece.col);
    } else {
        document.getElementById('aimHint').classList.remove('visible');

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

    let cooldown = piece.skillCooldown || 0;
    if (piece.type === 'queen') {
        const c1 = piece.skillCooldown || 0;
        const c2 = piece.reviveCooldown || 0;
        cooldown = hasTargets ? 0 : ((c1 > 0 && c2 > 0) ? Math.min(c1, c2) : 0);
    }

    if (piece.type === 'king') {
        if (kingSkillState.uses[piece.color] <= 0) {
            cooldown = 0;
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

function executePawnAbility(fromR, fromC, toR, toC, ability, isRemote = false) {
    if (isAnimating) return;
    isAnimating = true;

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

function attemptAbility(fromR, fromC, targetR, targetC, ability, isRemote = false, reviveType = null) {
    if (isAnimating) return;

    playSFX('skill');

    const piece = gameState.getPiece(fromR, fromC);

    if (piece && piece.type === 'king' && ability.id === 'domain') {
        if (!gameState.isInCheck(piece.color)) return;
        if (kingSkillState.uses[piece.color] <= 0) return;
        const movesSince = gameState.fullMoveNumber - kingSkillState.lastUsedMove[piece.color];
        if (movesSince < KING_DOMAIN_COOLDOWN) return;

        const checker = findCheckingPieces(piece.color)
            .find(ch => ch.r === targetR && ch.c === targetC);
        if (!checker) return;

        deselectPiece();

        kingSkillState.context = { color: piece.color, checker };

        acceptDomainExpansion(piece.color, checker);
        return;
    }

    if (piece && piece.type === 'queen' && ability.id === 'heal') {
        executeQueenHeal(fromR, fromC, targetR, targetC, ability, isRemote);
        return;
    }

    if (piece && piece.type === 'queen' && ability.id === 'revive') {
        executeQueenRevive(fromR, fromC, targetR, targetC, ability, reviveType, isRemote);
        return;
    }

    if (piece && piece.type === 'pawn' && ability.name === '衝鋒爆炸') {
        executePawnAbility(fromR, fromC, targetR, targetC, ability, isRemote);
        return;
    }

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

    // ★ NEW — Rook Thunder Cannon (AI / non-aimed path).
    //   The player's rook uses fireAimedCannon(); the AI (and any code
    //   that calls attemptAbility directly for a rook) reaches here.
    //   Route it through the SAME visuals the player sees, by reusing
    //   playRemoteCannonFire() — which is exactly flyCannonball() +
    //   fireAreaCannonVisual().
    if (piece && piece.type === 'rook') {
        const targetPos = get3DPosition(targetR, targetC, 0);
        const worldX = targetPos.x;
        const worldZ = targetPos.z;

        // Everything the blast should hit — same AOE rules as the player's
        // aimed cannon (all pieces within TARGET_RADIUS of the impact).
        const nearby = getPiecesInRadius(
            new THREE.Vector3(worldX, 0.05, worldZ),
            TARGET_RADIUS
        );
        const targets = nearby
            .filter(t => isWithinCannonRange(fromR, fromC, t.r, t.c))
            .map(t => ({ r: t.r, c: t.c }));

        // If this is a local rook in multiplayer, tell the opponent
        // (in AI mode this is a no-op).
        if (currentMode === 'multiplayer' && peerConnection?.open && !isRemote) {
            peerConnection.send({
                type: 'aim_fire',
                fromR, fromC,
                targetX: worldX,
                targetZ: worldZ,
                targets,
                abilityName: ability.name,
                damage: ability.damage,
            });
        }

        // Same visual pipeline as the player's cannon — cannonball flies,
        // electric AOE explosion plays, then turn flips.
        playRemoteCannonFire(fromR, fromC, worldX, worldZ, targets, ability.damage);
        return;
    }

    isAnimating = true;
    gameState.useAbility(fromR, fromC, targetR, targetC, ability, true);
    const finishVisuals = () => {
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

    showDamageEffect(targetR, targetC, ability.damage);
    setTimeout(finishVisuals, 400);
}

function executeMove(fromR, fromC, toR, toC, promotionType, moveData, isRemote = false) {
    triggerBishopLeapFadeOut();
    if (isAnimating) return;
    isAnimating = true;

    const targetPiece = gameState.getPiece(toR, toC);

    if (targetPiece) {
        playSFX('capture');
        // ★ Show the victim's current HP as the damage number.
        //   That is what the piece "had left" and it visually reads as
        //   "this piece is dead", which is the point of the number.
        //   (If you ever want actual damage dealt, replace with
        //    `targetPiece.maxHp - (targetPiece.hp - targetPiece.maxHp)`
        //    or a fixed "-K.O." label — but current behaviour is fine.)
        showDamageEffect(toR, toC, targetPiece.hp);
        spawnCaptureSignature(
            targetPiece.type, toR, toC,
            gameState.getPiece(fromR, fromC)?.color || playerColor
        );
    } else {
        playSFX('move');
    }

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

function spawnCaptureSignature(capturingType, row, col, capturingColor) {
    // ⚠️ 這裡「不再」呼叫 buildKillSignature。
    // 處決風格只在領域展開最終戰播放（見 animation.js 的
    // playKillAnimation / playKillKingAnimation）。
    // 平常吃子只留一個輕量光環，避免每次吃子都在播大秀。
    const center = get3DPosition(row, col, 0.4);
    const color = capturingColor === 'white' ? 0xffe27a : 0xb44dff;

    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.35, 32),
        new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.9,
            side: THREE.DoubleSide, depthWrite: false,
            blending: THREE.AdditiveBlending,
        })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(center.x, 0.06, center.z);
    scene.add(ring);

    const t0 = clock.getElapsedTime();
    const tick = () => {
        const t = (clock.getElapsedTime() - t0) / 0.45;
        if (t >= 1) {
            scene.remove(ring);
            ring.geometry.dispose();
            ring.material.dispose();
            return;
        }
        ring.scale.setScalar(1 + t * 3);
        ring.material.opacity = 0.9 * (1 - t);
        requestAnimationFrame(tick);
    };
    tick();
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
//  Top Bar
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

function closeTopBar() {
    document.getElementById('topBar')?.classList.add('hidden');
    updateTopBarReopenBtn();
    requestAnimationFrame(updateFullscreenBtnPosition);
}

function updateTopBarReopenBtn() {
    const reopen = document.getElementById('topBarReopenBtn');
    const bar = document.getElementById('topBar');
    if (!reopen || !bar) return;

    const shouldShow = !!currentMode && bar.classList.contains('hidden');
    reopen.classList.toggle('hidden', !shouldShow);

    requestAnimationFrame(updateFullscreenBtnPosition);
}

function updateFullscreenBtnPosition() {
    const btn = document.getElementById('globalFullscreenBtn');
    const bar = document.getElementById('topBar');
    const reopen = document.getElementById('topBarReopenBtn');
    if (!btn) return;

    const barVisible = !!bar && !bar.classList.contains('hidden');
    const reopenVisible = !!reopen && !reopen.classList.contains('hidden');

    btn.classList.toggle('below-topbar', barVisible);
    btn.classList.toggle('below-reopen', !barVisible && reopenVisible);

    let topPx = 10;

    if (barVisible && bar) {
        const rect = bar.getBoundingClientRect();
        topPx = Math.round(rect.bottom + 8);
    } else if (reopenVisible && reopen) {
        const rect = reopen.getBoundingClientRect();
        topPx = Math.round(rect.bottom + 8);
    }

    btn.style.top = topPx + 'px';
}

function updateTopBarToggleVisibility() {
    updateTopBarReopenBtn();
}

// ============================================================
//  ★ Room code display
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
//  ★ Game-state serialization
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

        recorder: (window.gameRecorder && {
            playerColor: window.gameRecorder.playerColor,
            aiColor: window.gameRecorder.aiColor,
            difficulty: window.gameRecorder.difficulty,
            startTime: window.gameRecorder.startTime,
            lastRecordedIndex: window.gameRecorder.lastRecordedIndex,
            records: window.gameRecorder.records,
            result: window.gameRecorder.result,
        }) || null,
    };
}

function applySerializedState(state) {
    if (!state) return;

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

    if (state.recorder && window.gameRecorder) {
        Object.assign(window.gameRecorder, state.recorder);
        window.gameRecorder.active = true;
    }

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

    attempt();
    reconnectTimer = setInterval(attempt, RECONNECT_INTERVAL_MS);
}

function tryReconnectToHost() {
    if (!roomCode) return;

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
    _mobileFsAttempted = true;
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

    const wasPinching = (window._pinchStartDist !== null);

    window._pinchStartDist = null;
    window._pinchStartRadius = null;

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
    const cb = document.getElementById('aiGameModeToggle');
    if (cb) cb.checked = true;
    aiGameModeEnabled = true;
    updateAIModeUI();

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

    if (currentMode !== 'multiplayer' || !gameStarted) {
        return;
    }

    pauseTimer();
    isReconnecting = true;
    showReconnectOverlay(isHost);

    if (isHost) {
        startReconnectGraceTimer();
    } else {
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

    // ★ Free mini-renderer WebGL contexts — they are NOT released by
    //   just hiding the overlays. Without this, opening/closing the
    //   domain expansion a few times exhausts the browser's WebGL
    //   context limit and rendering silently breaks.
    if (vsRenderers.left) { vsRenderers.left.dispose(); vsRenderers.left = null; }
    if (vsRenderers.right) { vsRenderers.right.dispose(); vsRenderers.right = null; }
    if (battleRenderers.player) { battleRenderers.player.dispose(); battleRenderers.player = null; }
    if (battleRenderers.opponent) { battleRenderers.opponent.dispose(); battleRenderers.opponent = null; }

    // Make sure the overlays are hidden so no stale canvas stays visible
    document.getElementById('vsOverlay')?.classList.add('hidden');
    document.getElementById('battleOverlay')?.classList.add('hidden');
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
        // ★ Prefer the incoming connection. If the old socket is still
        //   marked "open" but is in fact dead (LTE→WiFi handoff, dropped
        //   ICE), we'd otherwise permanently refuse the legit reconnect.
        if (peerConnection) {
            try { peerConnection.close(); } catch (_) { /* ignore */ }
            peerConnection = null;
        }
        peerConnection = conn;
        currentMode = 'multiplayer';

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
                    hostKnownClientSessionId = incomingSession;
                } else if (isReturningClient) {
                    console.log('🔁 Client reconnected with matching session');
                } else {
                    console.warn('⚠️ New session connected to same room (replacing previous).');
                    hostKnownClientSessionId = incomingSession;
                }

                sendSettingsToPeer();
                if (myReady && peerConnection?.open) {
                    peerConnection.send({ type: 'ready' });
                }

                if (isReturningClient && gameStarted && gameState) {
                    const state = serializeGameState();
                    if (state && peerConnection?.open) {
                        peerConnection.send({ type: 'state_sync', state });
                    }

                    isReconnecting = false;
                    stopReconnectGraceTimer();
                    hideReconnectOverlay();
                    resumeTimer();
                    updateRoomCodeDisplay();
                }
            }
            return;
        }

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
        if (data.type === 'state_sync') {
            applySerializedState(data.state);

            isReconnecting = false;
            stopReconnectLoop();
            hideReconnectOverlay();
            resumeTimer();
            updateRoomCodeDisplay();

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

            if (abilityName === '治癒 (Heal)' && targets.length > 0) {
                executeQueenHeal(
                    fromR, fromC, targets[0].r, targets[0].c,
                    { id: 'heal', name: abilityName, damage: 0, healAmount: 100 },
                    true
                );
                return;
            }

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
        if (data.type === 'domain_start') {
            const color = data.color;
            const checkerPiece = gameState.board[data.checkerR][data.checkerC];
            if (checkerPiece) {
                kingSkillState.uses[color] = Math.max(0, kingSkillState.uses[color] - 1);
                kingSkillState.lastUsedMove[color] = gameState.fullMoveNumber;
                kingSkillState.active = true;
                const checker = { r: data.checkerR, c: data.checkerC, piece: checkerPiece };
                kingSkillState.context = { color, checker };
                startDomainExpansion(color, checker);
            }
            return;
        }

        if (data.type === 'domain_choice') {
            onOpponentChoiceReceived(data.choice);
            return;
        }

        if (data.type === 'domain_surrender') {
            onOpponentSurrenderReceived(data.role);
            return;
        }

        if (data.type === 'domain_result') {
            if (data.winner === 'attacker') {
                gameOverFlag = true;
                stopTimer();
                document.getElementById('gameOverOverlay').classList.remove('hidden');
                document.getElementById('gameOverReason').textContent = '對手國王在領域對決中敗北';
                document.getElementById('gameOverText').textContent = '你贏了!';
                document.getElementById('gameOverText').className = 'game-over-text win';
            } else if (data.winner === 'defender') {
                // ★ IMPORTANT — Both peers have ALREADY removed the checker and
                //   flipped the turn locally inside:
                //       playKillAnimation() → finalizeDomainKill()
                //   Flipping the turn again here would desync the two clients:
                //   the local side would flip an extra time and end up waiting for
                //   a turn that the opponent never sees. That is what caused the
                //   "everything frozen, nobody can move" bug.
                //
                //   The message is only a safety net; keep the redundant checker
                //   removal (no-op if already gone) but DO NOT call flipTurn().

                const r = data.checkerR, c = data.checkerC;
                if (r !== undefined && c !== undefined && gameState.board[r][c]) {
                    gameState.board[r][c] = null;
                    gameState.moveHistory.push({
                        type: 'domain_kill',
                        fromR: data.defenderKingR ?? null,   // ★ NEW
                        fromC: data.defenderKingC ?? null,   // ★ NEW
                        toR: r,
                        toC: c,
                        r, c,
                    });
                    syncPiecesAfterMove();
                }

                kingSkillState.active = false;
                kingSkillState.context = null;
                battleState = null;
                isAnimating = false;
                switchTimer(gameState.turn);
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
            try {
                const targets = data.targets || [];
                playRemoteCannonFire(
                    data.fromR, data.fromC,
                    data.targetX, data.targetZ,
                    targets,
                    data.damage || ABILITIES.rook.damage
                );
            } catch (err) {
                console.error('playRemoteCannonFire threw:', err);
            }
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
    aiDifficulty = difficulty;
    currentMode = 'ai';

    playerColor = aiPlayerColorChoice;

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

    if (currentMode === 'ai' && gameState.turn !== playerColor && !kingSkillState.active) {
        aiThinking = true;
        setTimeout(makeAIMove, 500);
    }
}

function confirmBackToMenu() {
    const overlay = document.getElementById('backToMenuConfirmOverlay');
    if (!overlay) { backToMenu(); return; }
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
    document.getElementById('gameOverStatusBar')?.classList.add('hidden');
    resetTimers(roomSettings.timePerPlayer);
    initNewGame();
    if (currentMode === 'multiplayer' && peerConnection?.open) {
        peerConnection.send({ type: 'rematch' });
    }
}

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

function confirmRestart() {
    const overlay = document.getElementById('restartConfirmOverlay');
    if (!overlay) { restartGame(); return; }
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
//  ★ Developer Console Tool
// ============================================================
window.openChessEditor = function (filename = 'chessEditor.html') {
    const url = new URL(filename, window.location.href);

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

window.chessHelp = function () {
    const gold = 'color:#e8c547; font-weight:bold; font-size:13px;';
    const title = 'color:#e8c547; font-weight:bold; font-size:16px;';
    const cmd = 'color:#7ac8ff; font-weight:bold; font-family:monospace;';
    const desc = 'color:#f0e6d3; font-family:monospace;';
    const dim = 'color:#888; font-style:italic; font-family:monospace;';

    console.log('%c♞ 西洋棋 — 開發者指令列表', title);
    console.log('%c─────────────────────────────────────────', gold);

    console.log('%c📝 編輯器 / 工具', gold);
    console.log('  %copenChessEditor(filename?)%c  → 在新分頁開啟棋盤編輯器', cmd, desc);
    console.log('  %copenChessEditor()%c  → 在新分頁開啟棋盤編輯器', cmd, desc);
    console.log('  %c                              %c     預設檔名: chessEditor.html', dim, desc);
    console.log('  %c                              %c     會附帶當前棋盤狀態 (board=…&turn=…)', dim, desc);

    console.log('%c🎮 遊戲狀態', gold);
    console.log('  %cgameState%c                   → 當前 ChessGame 物件 (棋盤、回合、歷史…)', cmd, desc);
    console.log('  %ccurrentMode%c                 → 目前模式: "ai" | "multiplayer" | null', cmd, desc);
    console.log('  %cplayerColor%c                 → 你的顏色: "white" | "black"', cmd, desc);
    console.log('  %caiDifficulty%c                → AI 難度: "noob" | "easy" | "hard"', cmd, desc);
    console.log('  %croomSettings%c                → 房間設定 (模式、時間、技能權限)', cmd, desc);

    console.log('%c🐞 除錯 / 除錯用', gold);
    console.log('  %cprintBoard()%c                → 在 console 以文字印出棋盤', cmd, desc);
    console.log('  %ctoggleShadows()%c             → 開關陰影 (效能測試用)', cmd, desc);
    console.log('  %cgetFPS()%c                    → 顯示目前 FPS', cmd, desc);

    console.log('%c⚠️  危險指令 (會改變遊戲狀態)', '#e74c3c');
    console.log('  %csetTurn("white"|"black")%c    → 強制切換回合', cmd, desc);
    console.log('  %chealAll()%c                   → 將所有棋子補滿 HP', cmd, desc);
    console.log('  %cclearBoard()%c                → 清空棋盤 (慎用)', cmd, desc);
    console.log('  %cforceWin()%c                  → 立即強制獲勝（結束對局）', cmd, desc);
    console.log('  %cforceLose()%c                 → 立即強制認輸（結束對局）', cmd, desc);

    console.log('%c─────────────────────────────────────────', gold);
    console.log('%c輸入 chessHelp() 可再次顯示此列表', dim);

    console.log('%c👑 領域展開 (Domain Expansion)', gold);
    console.log('  %cforceDomainExpansion(color?, type?)%c → 強制觸發國王領域展開', cmd, desc);
    console.log('  %cforceDomainExpansion()%c', cmd, desc);
    console.log('  %c                                    %c     color: "white" | "black" (預設當前回合)', dim, desc);
    console.log('  %c                                    %c     type : 敵方棋子類型 (e.g. "queen", 預設隨機)', dim, desc);

    console.log('%c🤖 AI 對戰專用', gold);
    console.log('  %cforceAISkill(type, pieceIndex?, targetIndex?)%c  → 強制 AI 使用指定棋子的技能',
        cmd, desc);
    console.log('  %c                                    %c     type       : "pawn"|"rook"|"knight"|"bishop"|"queen"|"king"',
        dim, desc);
    console.log('  %c                                    %c     pieceIndex : 同類型棋子中第幾隻（預設 0，可省略）',
        dim, desc);
    console.log('  %c                                    %c     targetIndex: 目標清單中第幾個（預設 0，可省略）',
        dim, desc);
    console.log('  %c                                    %c     例: forceAISkill("rook")',
        dim, desc);
    console.log('  %c                                    %c     例: forceAISkill("knight", 0, 1)',
        dim, desc);
};

window.addEventListener('load', () => {
    setTimeout(() => window.chessHelp(), 200);
});

window.chooseRevive = chooseRevive;
window.cancelRevive = cancelRevive;

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

window.toggleShadows = function () {
    if (!renderer) return;
    const on = !renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = on;
    renderer.shadowMap.needsUpdate = true;
    scene.traverse(n => { if (n.material) n.material.needsUpdate = true; });
    console.log(`陰影: %c${on ? '開啟' : '關閉'}`,
        on ? 'color:#2ecc71;font-weight:bold;' : 'color:#e74c3c;font-weight:bold;');
};

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

window.setTurn = function (color) {
    if (!gameState) return console.warn('⚠️ 沒有進行中的遊戲');
    if (color !== 'white' && color !== 'black')
        return console.warn('⚠️ 用法: setTurn("white") 或 setTurn("black")');
    gameState.turn = color;
    updateTurnIndicator();
    console.log(`回合已切換為: %c${color}`, 'color:#e8c547;font-weight:bold;');
};

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

window.clearBoard = function () {
    if (!gameState) return console.warn('⚠️ 沒有進行中的遊戲');
    if (!confirm('⚠️ 確定要清空整個棋盤嗎？此操作無法復原。')) return;
    for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++) gameState.board[r][c] = null;
    syncPiecesAfterMove();
    console.log('棋盤已清空。');
};

window.forceDomainExpansion = function (color, targetType) {
    if (!gameState) {
        return console.warn('⚠️ 沒有進行中的遊戲');
    }
    if (kingSkillState.active) {
        return console.warn('⚠️ 領域展開已經在進行中，請等它播完');
    }

    color = color || gameState.turn;
    if (color !== 'white' && color !== 'black') {
        return console.warn('⚠️ 用法: forceDomainExpansion("white" | "black" [, enemyType])');
    }

    const king = gameState.findKing(color);
    if (!king) {
        return console.warn(`⚠️ 找不到 ${color} 的國王`);
    }

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

    const checker = candidates[Math.floor(Math.random() * candidates.length)];

    kingSkillState.active = true;
    kingSkillState.context = { color, checker };
    kingSkillState.lastUsedMove[color] = gameState.fullMoveNumber;

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
//  ★ Developer Tool — Force AI to use a specific skill
// ============================================================
window.forceAISkill = function (pieceType, pieceIndex = 0, targetIndex = 0) {
    // ── Basic guards ──
    if (!gameState) {
        return console.warn('⚠️ 沒有進行中的遊戲');
    }
    if (currentMode !== 'ai') {
        return console.warn('⚠️ 此指令僅適用於 AI 對戰模式 (currentMode === "ai")');
    }
    if (gameOverFlag) {
        return console.warn('⚠️ 遊戲已經結束');
    }
    if (isAnimating) {
        return console.warn('⚠️ 動畫播放中，請稍後再試');
    }
    if (aiThinking) {
        return console.warn('⚠️ AI 正在思考，請稍後再試');
    }
    if (kingSkillState.active) {
        return console.warn('⚠️ 領域展開進行中，請稍後再試');
    }

    const VALID = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
    if (!pieceType || !VALID.includes(pieceType)) {
        console.warn(
            '⚠️ 用法: forceAISkill("pawn"|"rook"|"knight"|"bishop"|"queen"|"king" ' +
            '[, pieceIndex] [, targetIndex])'
        );
        console.log('%c📖 例如: forceAISkill("rook")', 'color:#7ac8ff;font-family:monospace;');
        console.log('%c📖 例如: forceAISkill("knight", 0, 1)  // 第 1 隻騎士、第 2 個目標',
            'color:#7ac8ff;font-family:monospace;');
        return;
    }

    // ── Must be the AI's turn ──
    const aiColor = playerColor === 'white' ? 'black' : 'white';
    if (gameState.turn !== aiColor) {
        return console.warn(
            `⚠️ 現在是 ${gameState.turn} 的回合，不是 AI (${aiColor}) 的回合。` +
            ` 請等 AI 輪到再試，或使用 setTurn("${aiColor}") 強制切換（不建議）`
        );
    }

    // ── Collect every AI piece of that type that can actually cast now ──
    const candidates = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = gameState.getPiece(r, c);
            if (!p || p.color !== aiColor || p.type !== pieceType) continue;
            if ((p.stunned || 0) > 0) continue;

            const abilities = gameState.getLegalAbilities(r, c);
            if (abilities.length > 0) {
                candidates.push({ r, c, piece: p, abilities });
            }
        }
    }

    if (candidates.length === 0) {
        return console.warn(
            `⚠️ AI 目前沒有可施放技能的 ${pieceType}` +
            `（可能已陣亡、被麻痺、技能冷卻中，或無有效目標）`
        );
    }

    // ── Pick the piece / target (clamped to valid range) ──
    const pIdx = Math.max(0, Math.min(pieceIndex | 0, candidates.length - 1));
    const pick = candidates[pIdx];

    const tIdx = Math.max(0, Math.min(targetIndex | 0, pick.abilities.length - 1));
    const target = pick.abilities[tIdx];

    // ── Log what we're about to do ──
    console.log(
        `%c🎯 強制 AI 使用技能%c  ` +
        `${pieceType.toUpperCase()} @ (${pick.r}, ${pick.c})  →  ` +
        `目標 (${target.r}, ${target.c})  [${target.ability.name}]`,
        'color:#e8c547;font-weight:bold;font-size:14px;',
        'color:#f0e6d3;font-family:monospace;'
    );

    if (candidates.length > 1) {
        console.log(
            `%c   ℹ️ 此類型共有 ${candidates.length} 隻可用，目前選第 ${pIdx} 隻`,
            'color:#888;font-family:monospace;'
        );
    }
    if (pick.abilities.length > 1) {
        console.log(
            `%c   ℹ️ 此棋子有 ${pick.abilities.length} 個目標，目前選第 ${tIdx} 個`,
            'color:#888;font-family:monospace;'
        );
    }

    // ── Route through the standard ability pipeline ──
    //    This handles every piece type correctly:
    //      • rook    → cannonball + AOE explosion (playRemoteCannonFire)
    //      • knight  → 3-step knockback flow (executeKnightAbilityMove)
    //      • bishop  → arc jump + path damage (executeBishopAbility)
    //      • pawn    → cross explosion (executePawnAbility)
    //      • queen   → heal OR revive (executeQueenHeal / executeQueenRevive)
    //      • king    → domain expansion (acceptDomainExpansion)
    aiThinking = false;
    attemptAbility(
        target.fromR,
        target.fromC,
        target.r,
        target.c,
        target.ability
    );
};

// ============================================================
//  KING PASSIVE SKILL — Domain Expansion (領域展開)
// ============================================================
const KING_DOMAIN_MAX_USES = 3;
const KING_DOMAIN_COOLDOWN = 10;

const kingSkillState = {
    uses: { white: KING_DOMAIN_MAX_USES, black: KING_DOMAIN_MAX_USES },
    lastUsedMove: { white: -999, black: -999 },
    active: false,
    context: null,
};

function resetKingSkillState() {
    kingSkillState.uses = { white: KING_DOMAIN_MAX_USES, black: KING_DOMAIN_MAX_USES };
    kingSkillState.lastUsedMove = { white: -999, black: -999 };
    kingSkillState.active = false;
    kingSkillState.context = null;
    battleState = null;
}

let battleState = null;
let vsRenderers = { left: null, right: null };
let battleRenderers = { player: null, opponent: null };

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

    if (currentMode === 'multiplayer') return;
    if (currentMode !== 'ai') return;
    if (color === playerColor) return;

    kingSkillState.active = true;
    kingSkillState.context = { color, checker: checkers[0] };

    setTimeout(() => {
        if (gameOverFlag) return;
        acceptDomainExpansion(color, checkers[0]);
    }, 750);
}

function acceptDomainExpansion(color, checker) {
    document.getElementById('domainPromptOverlay').classList.add('hidden');

    if (!color) {
        const ctx = kingSkillState.context;
        if (!ctx) return;
        color = ctx.color;
        checker = ctx.checker;
    }
    if (!color || !checker) return;

    kingSkillState.uses[color]--;
    kingSkillState.lastUsedMove[color] = gameState.fullMoveNumber;
    kingSkillState.active = true;
    kingSkillState.context = { color, checker };

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

    document.getElementById('battleShockwave').classList.remove('trigger');
    document.getElementById('battleFlash').classList.remove('trigger');
    document.getElementById('battleVsCenter').classList.remove('slam');
    document.getElementById('battleOpponent').classList.remove('hit-shake', 'victory-zoom');
    document.getElementById('battlePlayer').classList.remove('hit-shake', 'victory-zoom');

    setTimeout(() => {
        document.getElementById('battleVsCenter').classList.add('slam');
        playSFX('explosion');
    }, 100);

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

function enableBattleButtons() {
    document.querySelectorAll('.battle-menu-btn').forEach(b => {
        if (!b.dataset.choice) return;
        b.disabled = false;
        b.onclick = () => onBattleChoice(b.dataset.choice);
    });
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

const BATTLE_GLYPHS = { rock: '🪨', paper: '📄', scissors: '✂️' };

function showOpponentChoiceBubble(choice) {
    const bubble = document.getElementById('battleOpponentChoiceBubble');
    if (!bubble) return;
    bubble.textContent = BATTLE_GLYPHS[choice] || '?';
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

function onOpponentChoiceReceived(choice) {
    if (!battleState || battleState.over) return;
    battleState.opponentChoice = choice;
    tryResolveBattle();
}

function onBattleSurrender() {
    if (!battleState || battleState.over || battleState.busy) return;

    const confirmOverlay = document.getElementById('battleSurrenderConfirmOverlay');
    if (confirmOverlay) confirmOverlay.classList.remove('hidden');
}

/* ═══════════════════════════════════════════════════════════
   ★ 投降時的「血量歸零」動畫
     與猜拳輸掉同一套視覺（震動 / 閃光 / 傷害數字 / 心臟碎裂 / 血條歸零）
   ═══════════════════════════════════════════════════════════ */
function playSurrenderDrainAnimation(localSurrendering) {
    if (!battleState) return;

    const sideSelector = localSurrendering ? '#battlePlayer' : '#battleOpponent';
    const heartsId = localSurrendering ? 'battlePlayerHearts' : 'battleOpponentHearts';
    const fillId = localSurrendering ? 'battlePlayerHealthFill' : 'battleOpponentHealthFill';

    // ── 1. 對應方「被打到」的震動 ──
    const loserEl = document.querySelector(sideSelector);
    if (loserEl) {
        loserEl.classList.remove('hit-shake');
        void loserEl.offsetWidth;
        loserEl.classList.add('hit-shake');
    }

    // ── 2. 全畫面閃光 ──
    const flash = document.getElementById('battleFlash');
    if (flash) {
        flash.classList.remove('trigger');
        void flash.offsetWidth;
        flash.classList.add('trigger');
    }

    // ── 3. 音效（跟猜拳失手一樣）──
    playSFX('capture');

    // ── 4. 傷害數字（標示投降）──
    const rect = document.getElementById('battleOverlay').getBoundingClientRect();
    const midX = rect.left + rect.width * (localSurrendering ? 0.28 : 0.72);
    const midY = rect.top + rect.height * (localSurrendering ? 0.42 : 0.32);
    spawnBattleDamageNumber(midX, midY, '🏳 -1 ♥', '#ff4466');

    // ── 5. 心臟逐顆碎裂（延遲 220ms 讓它像被連續打擊）──
    const heartsEl = document.getElementById(heartsId);
    if (heartsEl) {
        const hearts = heartsEl.querySelectorAll('.heart.full');
        hearts.forEach((h, idx) => {
            setTimeout(() => {
                h.classList.remove('full');
                h.classList.add('shatter');
                setTimeout(() => {
                    h.classList.remove('shatter');
                    h.classList.add('empty');
                    h.textContent = '♡';
                }, 650);
            }, idx * 220);
        });
    }

    // ── 6. 血條平滑歸零 + 轉紅 ──
    const fillEl = document.getElementById(fillId);
    if (fillEl) {
        fillEl.style.transition = 'width 0.8s ease-out, background 0.4s, box-shadow 0.4s';
        setTimeout(() => {
            fillEl.style.width = '0%';
            fillEl.style.background = 'linear-gradient(90deg, #ff4466, #ff8080)';
            fillEl.style.boxShadow = '0 0 20px #ff4466';
        }, 200);
    }

    // ── 7. 對應方的整個頭像也來個勝利/失敗 zoom 前的震動 ──
    // 讓「勝方」稍微放大提示（若對手投降，自己贏）
    const winnerEl = document.querySelector(localSurrendering ? '#battleOpponent' : '#battlePlayer');
    if (winnerEl) {
        setTimeout(() => {
            winnerEl.classList.add('victory-zoom');
        }, 500);
    }
}

function doBattleSurrenderConfirm() {
    const confirmOverlay = document.getElementById('battleSurrenderConfirmOverlay');
    if (confirmOverlay) confirmOverlay.classList.add('hidden');

    if (!battleState || battleState.over || battleState.busy) return;

    battleState.over = true;
    battleState.myChoice = null;
    battleState.opponentChoice = null;

    document.querySelectorAll('.battle-menu-btn').forEach(b => b.disabled = true);
    hideOpponentChoiceBubble();
    hidePlayerChoiceBubble();

    if (currentMode === 'multiplayer' && peerConnection?.open) {
        const myRole = battleState.isDefenderLocal ? 'defender' : 'attacker';
        peerConnection.send({ type: 'domain_surrender', role: myRole });
    }

    setBattleMessage('🏳 你放棄了對決...');

    // ★ 新增：投降方血量歸零動畫（自己投降 → 自己的心臟碎裂）
    playSurrenderDrainAnimation(true);

    setTimeout(() => {
        if (!battleState) return;

        if (battleState.isDefenderLocal) {
            battleState.defenderHearts = 0;
            resolveDomainDefenderLose();
        } else {
            battleState.attackerHearts = 0;
            resolveDomainCheckerDies();
        }
    }, 1800);
}

function cancelBattleSurrenderConfirm() {
    const confirmOverlay = document.getElementById('battleSurrenderConfirmOverlay');
    if (confirmOverlay) confirmOverlay.classList.add('hidden');
}

function onOpponentSurrenderReceived(senderRole) {
    if (!battleState || battleState.over) return;

    battleState.over = true;
    document.querySelectorAll('.battle-menu-btn').forEach(b => b.disabled = true);
    hideOpponentChoiceBubble();
    hidePlayerChoiceBubble();

    setBattleMessage('🏳 對手放棄了對決！');

    // ★ 新增：對手投降 → 對手的心臟碎裂
    playSurrenderDrainAnimation(false);

    setTimeout(() => {
        if (!battleState) return;

        if (senderRole === 'defender') {
            battleState.defenderHearts = 0;
            resolveDomainDefenderLose();
        } else {
            battleState.attackerHearts = 0;
            resolveDomainCheckerDies();
        }
    }, 1800);
}

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

    document.querySelector('.battle-overlay').classList.add('screen-shake');
    document.getElementById('battleFlash').classList.add('trigger');

    setTimeout(() => {
        document.getElementById('battleShockwave').classList.add('trigger');
    }, 100);

    playSFX('skill');

    setTimeout(() => {
        document.querySelector('.battle-overlay').classList.remove('screen-shake');
    }, 500);

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
            updateBattleHealthBars();
        }, 1400);
        return;
    }

    if (kingResult === 'win') battleState.attackerHearts--;
    else if (kingResult === 'lose') battleState.defenderHearts--;

    const localIsKing = battleState.isDefenderLocal;
    const iLost = (kingResult === 'win' && !localIsKing) ||
        (kingResult === 'lose' && localIsKing);

    setTimeout(() => {
        const loserEl = document.querySelector(iLost ? '#battlePlayer' : '#battleOpponent');
        if (loserEl) loserEl.classList.add('hit-shake');

        updateBattleHealthBars();
        renderBattleHearts();

        document.getElementById('battleFlash').classList.add('trigger');

        playSFX('capture');

        const rect = document.getElementById('battleOverlay').getBoundingClientRect();
        const midX = rect.left + rect.width * (iLost ? 0.28 : 0.72);
        const midY = rect.top + rect.height * (iLost ? 0.42 : 0.32);
        spawnBattleDamageNumber(midX, midY, '-1 ♥', iLost ? '#ff4466' : '#ffcc00');

        if (!iLost) {
            battleState.comboCount = (battleState.comboCount || 0) + 1;
            showComboBadge(battleState.comboCount);
        } else {
            battleState.comboCount = 0;
        }

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
    }, 400);

    setTimeout(() => {
        if (battleState.defenderHearts <= 0) {
            resolveDomainDefenderLose();
            return;
        }
        if (battleState.attackerHearts <= 0) {
            resolveDomainCheckerDies();
            return;
        }

        battleState.busy = false;
        const remaining = isKingMe ? battleState.defenderHearts : battleState.attackerHearts;
        setBattleMessage(`剩餘生命：${remaining}。再來一局！`);

        setTimeout(() => {
            if (battleState.over) return;
            hideOpponentChoiceBubble();
            hidePlayerChoiceBubble();
            enableBattleButtons();
            setBattleMessage('選擇你的出拳！');
            updateBattleHealthBars();
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

    const playerFill = document.getElementById('battlePlayerHealthFill');
    if (playerFill) {
        playerFill.style.width = `${myRatio * 100}%`;
        if (myRatio <= 0.5) {
            playerFill.style.background = 'linear-gradient(90deg, #ff4466, #ff8080)';
            playerFill.style.boxShadow = '0 0 20px #ff4466';
        } else {
            playerFill.style.background = 'linear-gradient(90deg, #e8c547, #f0d860)';
            playerFill.style.boxShadow = '0 0 10px #e8c547';
        }
    }

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

// ============================================================
//  ★ SETTINGS SYSTEM
// ============================================================
const DEFAULT_GAME_SETTINGS = {
    musicEnabled: true,
    musicVolume: 30,
    sfxVolume: 80,
    queenVoice: true,
    graphicsQuality: 'medium',
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

let _settingsOpenedFrom = null;

function openSettings() {
    if (currentMode && !gameOverFlag) {
        _settingsOpenedFrom = 'game';
    } else {
        _settingsOpenedFrom = 'menu';
    }

    if (_settingsOpenedFrom === 'menu') {
        const mm = document.getElementById('mainMenu');
        if (mm) mm.classList.add('hidden');
    }

    const overlay = document.getElementById('settingsOverlay');
    if (overlay) overlay.classList.remove('hidden');

    syncSettingsUI();

    startMenuMusic();
}

function closeSettings() {
    const overlay = document.getElementById('settingsOverlay');
    if (overlay) overlay.classList.add('hidden');

    if (_settingsOpenedFrom === 'menu') {
        const mm = document.getElementById('mainMenu');
        if (mm) mm.classList.remove('hidden');
    }

    _settingsOpenedFrom = null;
}

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
    if (typeof updateSFXVolume === 'function') updateSFXVolume();
}

function setQueenVoiceEnabled(enabled) {
    gameSettings.queenVoice = !!enabled;
    setQueenVoiceMuted(!enabled);
    saveGameSettings();
}

function setShowCooldownNumbers(enabled) {
    gameSettings.showCooldownNumbers = !!enabled;
    saveGameSettings();
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

    // ── Resize shadow maps to match the quality tier ──
    let shadowSize;
    if (quality === 'low') shadowSize = 0;      // shadows off
    else if (quality === 'high') shadowSize = 2048;
    else shadowSize = 1024;

    if (shadowOn) {
        scene.traverse(n => {
            if (n.isDirectionalLight && n.castShadow && n.shadow) {
                if (n.shadow.map) { n.shadow.map.dispose(); n.shadow.map = null; }
                n.shadow.mapSize.width = shadowSize;
                n.shadow.mapSize.height = shadowSize;
            }
        });
    }

    renderer.shadowMap.needsUpdate = true;
    scene.traverse(n => { if (n.material) n.material.needsUpdate = true; });
}

function resetSettingsToDefaults() {
    if (!confirm('確定要將所有設定重設為預設值嗎？')) return;
    gameSettings = { ...DEFAULT_GAME_SETTINGS };
    saveGameSettings();

    queenVoiceMuted = false;
    try { localStorage.setItem('queenVoiceMuted', '0'); } catch (_) { }

    syncSettingsUI();
    applyGraphicsQuality(gameSettings.graphicsQuality);
    updateMusicVolume();
    if (typeof updateSFXVolume === 'function') updateSFXVolume();
    if (gameSettings.musicEnabled) startMenuMusic();
}

// ============================================================
//  ★ Background music
// ============================================================
let bgmAudio = null;
let bgmWantsToPlay = false;

function preloadBGM() {
    if (bgmAudio) return;
    bgmAudio = new Audio('assets/sounds/Midnight_On_The_Board.mp3');
    bgmAudio.loop = true;
    bgmAudio.preload = 'auto';
    bgmAudio.volume = gameSettings.musicVolume / 100;

    try { bgmAudio.load(); } catch (_) { }

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

    if (!bgmAudio) preloadBGM();

    bgmWantsToPlay = true;

    if (bgmAudio.readyState >= 3) {
        if (bgmAudio.paused) {
            bgmAudio.play().catch(err => {
                console.warn('🎵 BGM 播放被阻擋:', err.message);
            });
        }
    }
}

function stopMenuMusic() {
    if (!bgmAudio) return;
    bgmWantsToPlay = false;
    bgmAudio.pause();
}

function updateMusicVolume() {
    if (!bgmAudio) return;
    bgmAudio.volume = gameSettings.musicEnabled
        ? gameSettings.musicVolume / 100
        : 0;
}

function getSfxVolume() {
    return gameSettings.sfxVolume / 100;
}

// ============================================================
//  ★ Battle/Vs — visual FX triggers
// ============================================================
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

function showComboBadge(count) {
    if (count < 2) return;
    const el = document.getElementById('battleComboBadge');
    if (!el) return;
    el.textContent = `COMBO ×${count}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
}

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

    loadGameSettings();
    applyGraphicsQuality(gameSettings.graphicsQuality);

    preloadBGM();

    initQueenVoice();
    hideRemoteAim();
    updateActionButtonStates();
    if (IS_MOBILE) setupMobileCannonControls();

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
            const settingsOverlay = document.getElementById('settingsOverlay');
            if (settingsOverlay && !settingsOverlay.classList.contains('hidden')) {
                e.preventDefault();
                closeSettings();
            }
        }
    });
};