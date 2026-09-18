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

let joystickState = {
    active: false, touchId: null, baseCenterX: 0, baseCenterY: 0,
    knobOffsetX: 0, knobOffsetY: 0, baseRadius: 55, moveSpeed: 4.5,
};
let joystickSetup = false;
let lastFrameTime = 0;

let cannonRangeGroup = null;

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

// ★ 皇后「復活」獨立冷卻（8 步）
const QUEEN_REVIVE_COOLDOWN = 8;

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

    makeMove(fromR, fromC, toR, toC, promotionType = null) {
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

        this.flipTurn();
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
        name: '冲锋爆炸',
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
        wItem.classList.toggle('active', timerState.currentPlayer === 'white' && timerState.active);
        bItem.classList.toggle('active', timerState.currentPlayer === 'black' && timerState.active);
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

function pauseTimer() { timerState.paused = true; }
function resumeTimer() { timerState.paused = false; }

function switchTimer(nextPlayer) {
    timerState.currentPlayer = nextPlayer;
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
                "position": {
                    "x": 0,
                    "y": 0.21,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.5,
                    "y": 1.02,
                    "z": 0.84
                }
            },
            "neck": {
                "position": {
                    "x": 0,
                    "y": 0.54,
                    "z": 0.13
                },
                "rotation": {
                    "x": 0.22,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.58,
                    "y": 2.44,
                    "z": 1.12
                }
            },
            "head": {
                "position": {
                    "x": 0,
                    "y": 0.76,
                    "z": 0.25
                },
                "rotation": {
                    "x": -0.08,
                    "y": 0,
                    "z": 0
                },
                "scale": {
                    "x": 0.98,
                    "y": 1.2,
                    "z": 1.76
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
            "custom_1020": {
                "type": "air",
                "geometryParams": {
                    "width": 0.3,
                    "height": 0.3,
                    "depth": 0.3
                },
                "roughness": 0.5,
                "metalness": 0.2,
                "position": {
                    "x": -0.0613,
                    "y": 0.9222,
                    "z": 0
                },
                "rotation": {
                    "x": 0,
                    "y": 0,
                    "z": -2.4597
                },
                "scale": {
                    "x": 0.0918,
                    "y": 0.6278,
                    "z": 2.5012
                },
                "name": "Air"
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
                // ★ 冷卻中 → 在棋子右上角顯示剩餘回合
                const cd = piece.skillCooldown || 0;
                if (cd > 0) {
                    const cdSprite = createCooldownSprite(cd);
                    obj.add(cdSprite);
                    obj.userData.cooldownSprite = cdSprite;
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
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.6, depthWrite: false });
    const capMat = new THREE.MeshBasicMaterial({ color: 0xe74c3c, transparent: true, opacity: 0.5, depthWrite: false });
    moves.forEach(m => {
        const isCapture = m.capture;
        const mat = isCapture ? capMat : dotMat;
        const geo = isCapture
            ? new THREE.TorusGeometry(0.4, 0.05, 8, 24)
            : new THREE.CylinderGeometry(0.15, 0.15, 0.04, 16);
        const highlight = new THREE.Mesh(geo, mat);
        highlight.position.set(m.c - 3.5, 0.04, 3.5 - m.r);
        if (isCapture) highlight.rotation.x = Math.PI / 2;
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
    const duration = 0.18;
    const startTime = clock.getElapsedTime();
    const animate = () => {
        const now = clock.getElapsedTime();
        const t = Math.min((now - startTime) / duration, 1);
        const ease = x => x * (2 - x);
        obj.position.lerpVectors(startPos, targetPos, ease(t));
        if (t < 1) requestAnimationFrame(animate);
        else { obj.position.copy(targetPos); onComplete(); }
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
    const duration = 0.18;
    const startTime = clock.getElapsedTime();
    const animate = () => {
        const now = clock.getElapsedTime();
        const t = Math.min((now - startTime) / duration, 1);
        const phase = t < 0.5 ? t * 2 : (1 - t) * 2;
        obj.position.lerpVectors(startPos, peakPos, phase);
        if (t < 1) requestAnimationFrame(animate);
        else { obj.position.copy(startPos); onComplete(); }
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
    // Rotate travel -90° around Y → right-hand perpendicular
    const right = new THREE.Vector3(-travel.z, 0, travel.x);

    // ── Arrow formation: 2 wings per side, trailing behind the knight ──
    //    Order matters for the staggered fade-in:
    //      [0] inner-left, [1] inner-right,
    //      [2] outer-left, [3] outer-right
    const INNER_BACK = 0.32;   // how far behind the tip the inner pair sits
    const INNER_SIDE = 0.34;   // lateral spread of the inner pair
    const OUTER_BACK = 0.72;   // further back
    const OUTER_SIDE = 0.68;   // wider spread

    const offsets = [
        travel.clone().multiplyScalar(-INNER_BACK).add(right.clone().multiplyScalar(-INNER_SIDE)),
        travel.clone().multiplyScalar(-INNER_BACK).add(right.clone().multiplyScalar(INNER_SIDE)),
        travel.clone().multiplyScalar(-OUTER_BACK).add(right.clone().multiplyScalar(-OUTER_SIDE)),
        travel.clone().multiplyScalar(-OUTER_BACK).add(right.clone().multiplyScalar(OUTER_SIDE)),
    ];

    // All ghosts face the travel direction (local +Z → travel)
    const facingYaw = Math.atan2(travel.x, travel.z);

    const ghosts = [];
    const ghostTint = new THREE.Color(0x9fe8ff);   // spectral cyan

    for (let i = 0; i < 4; i++) {
        const ghost = createPieceModel(
            'knight', color, 100, 100, PIECE_PARAMS.knight || {}
        );

        // Strip health bar sprite (defensive; full-HP should have none)
        if (ghost.userData.hpSprite) {
            ghost.remove(ghost.userData.hpSprite);
            ghost.userData.hpSprite = null;
        }

        // Ghostify → transparent, additive, cyan-tinted, no shadows
        ghost.traverse(n => {
            if (!n.isMesh || !n.material || !n.material.color) return;
            n.material = n.material.clone();
            n.material.transparent = true;
            n.material.opacity = 0.55;
            n.material.depthWrite = false;
            n.material.blending = THREE.AdditiveBlending;
            n.material.color.lerp(ghostTint, 0.65);
            if (n.material.emissive) {
                n.material.emissive = ghostTint.clone();
                n.material.emissiveIntensity = 0.6;
            }
            n.castShadow = false;
            n.receiveShadow = false;
        });

        ghost.rotation.y = facingYaw;
        ghost.scale.setScalar(0.001);       // invisible until pop-in
        ghost.renderOrder = 5;

        ghost.userData.offset = offsets[i];
        // Stagger so the arrow "assembles" outward from the tip:
        //   inner pair first, then outer pair.
        ghost.userData.spawnDelay = (i < 2 ? 0.00 : 0.06) + (i % 2) * 0.03;
        ghost.userData.baseOpacity = 0.55;

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

            // Ride in formation relative to the knight's current position
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
        syncPiecesAfterMove();
        deselectPiece();
        switchTimer(gameState.turn);
        checkGameStatus();
        if (!gameOverFlag) {
            updateCameraTargets();
            if (currentMode === 'ai' && gameState.turn !== playerColor) {
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

            gameState.makeMove(fromR, fromC, landingR, landingC, null);

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
                if (currentMode === 'ai' && gameState.turn !== playerColor) {
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
            if (currentMode === 'ai' && gameState.turn !== playerColor) {
                aiThinking = true;
                setTimeout(makeAIMove, 500);
            }
        }
    }, 680);
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
            if (currentMode === 'ai' && gameState.turn !== playerColor) {
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
            finish();
        }
    };
    anim();
}

// 復活視覺：紫色天光 + 金環 + 大量上升光點
function spawnReviveEffect(row, col) {
    const center = get3DPosition(row, col, 0);
    const group = new THREE.Group();
    group.position.set(center.x, 0, center.z);
    scene.add(group);

    const startTime = clock.getElapsedTime();
    const DURATION = 1.35;

    // 外層光柱
    const beamMat = new THREE.MeshBasicMaterial({
        color: 0xd9a6ff, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.55, 4.0, 24, 1, true), beamMat);
    beam.position.y = 2.0;
    group.add(beam);

    // 內層核心
    const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.18, 4.0, 16, 1, true), coreMat);
    core.position.y = 2.0;
    group.add(core);

    // 地面衝擊環
    const rings = [];
    for (let i = 0; i < 3; i++) {
        const mat = new THREE.MeshBasicMaterial({
            color: i % 2 === 0 ? 0xb06cff : 0xffe27a,
            transparent: true, opacity: 0, depthWrite: false,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.3, 40), mat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        group.add(ring);
        rings.push({ mesh: ring, delay: i * 0.15 });
    }

    // 上升光點
    const particles = [];
    for (let i = 0; i < 56; i++) {
        const pg = new THREE.SphereGeometry(0.025 + Math.random() * 0.04, 5, 5);
        const pm = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(
                0.72 + Math.random() * 0.13, 0.95, 0.6 + Math.random() * 0.3
            ),
            transparent: true, opacity: 0, depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const p = new THREE.Mesh(pg, pm);
        const a = Math.random() * Math.PI * 2;
        const r = 0.1 + Math.random() * 0.42;
        p.position.set(Math.cos(a) * r, 0.05, Math.sin(a) * r);
        p.userData = {
            vel: new THREE.Vector3(Math.cos(a) * 0.3, 1.4 + Math.random() * 1.8, Math.sin(a) * 0.3),
            delay: Math.random() * 0.35,
            life: 0.7 + Math.random() * 0.5,
        };
        group.add(p);
        particles.push(p);
    }

    // 底部閃光
    const flashMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const flash = new THREE.Mesh(new THREE.CircleGeometry(0.55, 28), flashMat);
    flash.rotation.x = -Math.PI / 2;
    flash.position.y = 0.07;
    group.add(flash);

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

        beamMat.opacity = 0.5 * Math.sin(Math.PI * Math.min(prog / 0.75, 1));
        coreMat.opacity = 0.85 * Math.sin(Math.PI * Math.min(prog / 0.6, 1));
        beam.rotation.y += 0.03;
        core.rotation.y -= 0.05;

        for (const r of rings) {
            const rt = Math.max(0, Math.min(1, (t - r.delay) / (DURATION - r.delay)));
            r.mesh.material.opacity = 0.85 * (1 - rt);
            r.mesh.scale.setScalar(1 + rt * 4.0);
        }

        flashMat.opacity = Math.max(0, 0.85 - prog * 2.2);

        for (const p of particles) {
            const pt = t - p.userData.delay;
            if (pt < 0 || pt > p.userData.life) { p.visible = false; continue; }
            p.visible = true;
            p.position.addScaledVector(p.userData.vel, 0.016);
            p.userData.vel.y -= 0.015;
            const lt = pt / p.userData.life;
            p.material.opacity = (1 - lt) * 0.95;
            p.scale.setScalar(1 - lt * 0.35);
        }

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
                if (currentMode === 'ai' && gameState.turn !== playerColor) {
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
                if (currentMode === 'ai' && gameState.turn !== playerColor) {
                    aiThinking = true;
                    setTimeout(makeAIMove, 500);
                }
            }
            updateTurnIndicator();
        });
    });
}

function fireAreaCannonVisual(centerPos, targets, damage, callback) {
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
    if (mode === 'attack' && abilityTargets.length === 0) {
        actionMode = 'move';
        hideCannonRange();
        if (selectedPiece) showValidMoveHighlights(validMoves, selectedPiece.row, selectedPiece.col);
        updateActionButtonStates();
        return;
    }
    actionMode = mode;
    if (mode === 'move') {
        hideCannonRange();
        document.getElementById('aimHint').classList.remove('visible');
        hideGhostLine();
        if (selectedPiece) showValidMoveHighlights(validMoves, selectedPiece.row, selectedPiece.col);
    } else {
        document.getElementById('aimHint').classList.remove('visible');
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
    hideCannonRange();

    if (hasAbility) updateActionBar(true, hasTargets, cooldown);
    else updateActionBar(false, false);

    actionMode = 'move';
    document.getElementById('aimHint').classList.remove('visible');
    hideGhostLine();
    showValidMoveHighlights(validMoves, row, col);
    updateActionButtonStates();

    if (pieceObjects[`${row},${col}`]) selectedPiecePulse = 0;
}

function deselectPiece() {
    if (pendingRevive) cancelRevive();
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
            if (currentMode === 'ai' && gameState.turn !== playerColor) {
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
                if (currentMode === 'ai' && gameState.turn !== playerColor) {
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
                    if (currentMode === 'ai' && gameState.turn !== playerColor) {
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
    const piece = gameState.getPiece(fromR, fromC);

    // ★ 皇后 — 治癒
    if (piece && piece.type === 'queen' && ability.id === 'heal') {
        executeQueenHeal(fromR, fromC, targetR, targetC, ability, isRemote);
        return;
    }

    // ★ 皇后 — 復活
    if (piece && piece.type === 'queen' && ability.id === 'revive') {
        executeQueenRevive(fromR, fromC, targetR, targetC, ability, reviveType, isRemote);
        return;
    }

    if (piece && piece.type === 'pawn' && ability.name === '冲锋爆炸') {
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
            if (currentMode === 'ai' && gameState.turn !== playerColor) {
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
            checkGameStatus();
            if (!gameOverFlag) {
                updateCameraTargets();
                if (currentMode === 'ai' && gameState.turn !== playerColor) {
                    aiThinking = true;
                    setTimeout(makeAIMove, 500);
                }
                if (currentMode === 'multiplayer' && !isRemote) {
                    sendMoveToPeer(fromR, fromC, toR, toC, promotionType);
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
        if (currentMode === 'multiplayer') {
            if (peerConnection?.open) peerConnection.send({ type: 'gameover' });
        }
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
}

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

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        const el = document.documentElement;
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        else if (el.msRequestFullscreen) el.msRequestFullscreen();
        if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').catch(() => { });
        }
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
    }
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
        if (window._pinchStartDist && window._pinchStartDist > 0) {
            const scale = currentDist / window._pinchStartDist;
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
    window._pinchStartDist = null;
    window._pinchStartRadius = null;
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
    document.getElementById('mainMenu').classList.remove('hidden');
    document.getElementById('aiDifficultyMenu').classList.add('hidden');
    document.getElementById('multiplayerMenu').classList.add('hidden');
    document.getElementById('roomSettings').classList.add('hidden');
    document.getElementById('waitingOverlay').classList.add('hidden');
    document.getElementById('gameOverOverlay').classList.add('hidden');
    document.getElementById('restartConfirmOverlay').classList.add('hidden');
    document.getElementById('topBar').classList.add('hidden');
    document.getElementById('actionBar').classList.remove('visible');
    document.getElementById('aimHint').classList.remove('visible');
    if (boardGroup) scene.remove(boardGroup);
    if (piecesGroup) scene.remove(piecesGroup);
    clearHighlights();
    clearGhostLine();
    currentMode = null;
    gameOverFlag = false;
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
    if (waitingStatusEl) waitingStatusEl.textContent = '⚠️ 对手已断开连线';
    if (gameStarted) {
        gameOverFlag = true;
        stopTimer();
        document.getElementById('gameOverOverlay').classList.remove('hidden');
        document.getElementById('gameOverReason').textContent = '对手断线';
        document.getElementById('gameOverText').textContent = '你赢了!';
        document.getElementById('gameOverText').className = 'game-over-text win';
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
    document.getElementById('waitingStatus').textContent = '⏳ 正在初始化连线...';
    updateReadyUI();

    const hostId = PEER_ID_PREFIX + roomCode;
    peer = new Peer(hostId, { debug: 2, config: ICE_SERVERS });

    peer.on('open', (id) => {
        document.getElementById('waitingStatus').textContent = '⏳ 等待对手加入...';
    });
    peer.on('connection', (conn) => {
        if (peerConnection && peerConnection.open) {
            conn.close();
            return;
        }
        peerConnection = conn;
        currentMode = 'multiplayer';
        setupPeerConnection();
        if (conn.open) sendSettingsToPeer();
        else conn.on('open', () => sendSettingsToPeer());
        updateReadyUI();
        document.getElementById('topBar').classList.remove('hidden');
    });
    peer.on('error', (err) => {
        let msg = '⚠️ 创建房间失败：' + (err.type || err.message);
        if (err.type === 'unavailable-id') msg = '⚠️ 房号冲突，请重新尝试';
        else if (err.type === 'network') msg = '⚠️ 网络错误，请检查连线';
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
        document.getElementById('multiplayerStatus').textContent = '⚠️ 请输入完整的4位房号';
        return;
    }
    roomCode = code;
    isHost = false;
    playerColor = 'black';
    myReady = false;
    opponentReady = false;
    gameStarted = false;
    settingsReceived = false;
    document.getElementById('multiplayerStatus').textContent = '⏳ 正在初始化连线...';

    destroyPeer();
    peer = new Peer({ debug: 2, config: ICE_SERVERS });

    peer.on('open', (id) => {
        const targetId = PEER_ID_PREFIX + code;
        document.getElementById('multiplayerStatus').textContent = '🔄 正在连接到房号 ' + code + ' ...';
        const conn = peer.connect(targetId, { reliable: true });
        if (!conn) {
            document.getElementById('multiplayerStatus').textContent = '⚠️ 无法建立连接，请确认房号';
            return;
        }
        peerConnection = conn;
        setupPeerConnection();
        conn.on('open', () => {
            document.getElementById('multiplayerStatus').textContent = '✅ 连接成功！等待房间设定...';
            document.getElementById('waitingCodeDisplay').textContent = code;
            document.getElementById('waitingOverlay').classList.remove('hidden');
            document.getElementById('topBar').classList.remove('hidden');
            updateReadyUI();
            setTimeout(() => {
                if (peerConnection?.open) {
                    peerConnection.send({ type: 'hello', color: playerColor });
                }
            }, 100);
        });
        conn.on('close', () => {
            handleDisconnect();
        });
        if (settingsTimeout) clearTimeout(settingsTimeout);
        settingsTimeout = setTimeout(() => {
            if (!settingsReceived && !gameStarted) {
                document.getElementById('waitingStatus').textContent = '⚠️ 等待房间设定超时，请确认房主仍在等待';
            }
        }, 15000);
    });
    peer.on('error', (err) => {
        let msg = '⚠️ 连接失败: ' + (err.type || err.message);
        if (err.type === 'peer-unavailable') msg = '⚠️ 找不到该房号，请确认对方已创建房间';
        else if (err.type === 'network') msg = '⚠️ 网络错误，请检查连线';
        document.getElementById('multiplayerStatus').textContent = msg;
        setTimeout(() => {
            document.getElementById('multiplayerStatus').textContent = '请输入房号重新加入';
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
            if (isHost) sendSettingsToPeer();
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
        if (data.type === 'ready') {
            opponentReady = true;
            updateReadyUI();
            checkBothReady();
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

            if (abilityName === '冲锋爆炸' && targets.length > 0) {
                const ability = { name: abilityName, damage, selfDamage };
                const firstTarget = targets[0];
                if (firstTarget) executePawnAbility(fromR, fromC, firstTarget.r, firstTarget.c, ability, true);
                return;
            }
            const ability = { name: abilityName, damage, selfDamage: selfDamage || 0 };
            for (const t of targets) attemptAbility(fromR, fromC, t.r, t.c, ability, true);
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
            document.getElementById('gameOverReason').textContent = '对手认输或投降';
            document.getElementById('gameOverText').textContent = '你赢了!';
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
    peerConnection.on('error', (err) => console.error('❌ 数据通道错误:', err));
}

function cancelWaiting() {
    destroyPeer();
    myReady = false;
    opponentReady = false;
    gameStarted = false;
    document.getElementById('waitingOverlay').classList.add('hidden');
    document.getElementById('multiplayerMenu').classList.remove('hidden');
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
    playerColor = 'white';

    // ★ Read mode from the toggle switch
    roomSettings.gameMode = aiGameModeEnabled ? 'totally' : 'normal';
    roomSettings.abilityPermissions = { white: true, black: true };
    roomSettings.timePerPlayer = 0;

    gameState = new ChessGame();
    gameOverFlag = false;
    aiThinking = false;

    createBoard3D();
    createPieces3D();

    document.getElementById('aiDifficultyMenu').classList.add('hidden');
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('topBar').classList.remove('hidden');

    document.getElementById('timerDisplay').style.display = 'none';
    resetCameraForPlayer();
    stopTimer();
    updateTurnIndicator();
}

function confirmRestart() {
    // ★ Was: if (confirm('確定要重新開始遊戲嗎？')) restartGame();
    //   Now: show our own styled in-game modal.
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

function restartGame() {
    document.getElementById('gameOverOverlay').classList.add('hidden');
    resetTimers(roomSettings.timePerPlayer);
    initNewGame();
    if (currentMode === 'multiplayer' && peerConnection?.open) {
        peerConnection.send({ type: 'rematch' });
    }
}

function initNewGame() {
    document.getElementById('topBar').classList.remove('hidden');
    gameState = new ChessGame();
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
    if (currentMode === 'ai' && gameState.turn !== playerColor) {
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

    console.log('%c─────────────────────────────────────────', gold);
    console.log('%c輸入 chessHelp() 可再次顯示此列表', dim);
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
//  BOOT
// ============================================================
window.onload = () => {
    initThree();
    initQueenVoice();
    hideRemoteAim();
    updateActionButtonStates();
    if (IS_MOBILE) setupMobileCannonControls();

    // ★ Initialize AI mode toggle UI
    updateAIModeUI();

    // ★ ESC closes the restart confirmation modal
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const overlay = document.getElementById('restartConfirmOverlay');
            if (overlay && !overlay.classList.contains('hidden')) {
                e.preventDefault();
                cancelRestartConfirm();
            }
        }
    });
};