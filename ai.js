// ============================================================
//  ai.js — AI opponent logic (rebuilt)
// ============================================================
//  Difficulty mapping:
//    'noob'  → "Easy"   : greedy capture + basic defense (1-ply)
//    'easy'  → "Normal" : + king hunting + no team damage (2-ply)
//    'hard'  → "Hard"   : + deep search + threat prediction (4-ply)
//
//  Rule summary:
//   • Easy   : eat opponent pieces, block/counter their active pieces
//   • Normal : Easy + hunt the king, avoid team damage
//   • Hard   : Normal + never self-damage, aggressively chase the
//              king & pieces, lookahead to punish opponent's best reply
//
//  Dependencies (declared in main.js):
//    gameState, currentMode, playerColor, gameOverFlag,
//    PIECE_VALUES, isAbilityEnabledForColor,
//    getPushableVictims, checkGameStatus,
//    executeKnightAbilityMove, attemptAbility, attemptMove,
//    selectedPiece, validMoves, abilityTargets
// ============================================================

// ============================================================
//  AI GLOBAL STATE
// ============================================================
let aiDifficulty = 'easy';
let aiThinking = false;

// ============================================================
//  DIFFICULTY CONFIGURATIONS
// ============================================================
const AI_CONFIGS = {
    // ── "Easy" rules ──
    // Greedy 1-ply: eat pieces, block opponent, with heavy randomness
    noob: {
        maxDepth: 1,
        timeLimit: 800,
        randomness: 0.35,
        captureWeight: 1.2,
        damageWeight: 0.9,
        selfDamageWeight: 1.5,
        kingCaptureBonus: 5000,
        threatWeight: 0.6,           // penalty for own pieces being attacked
        ownKingSafetyWeight: 1.5,
        checkWeight: 1.0,
    },

    // ── "Normal" rules ──
    // Easy + king hunting + no team damage (2-ply minimax)
    easy: {
        maxDepth: 2,
        timeLimit: 1800,
        randomness: 0.05,
        captureWeight: 1.3,
        damageWeight: 1.1,
        selfDamageWeight: 3.5,       // strong self-damage penalty
        kingCaptureBonus: 25000,     // big reward for hurting the king
        threatWeight: 1.2,
        ownKingSafetyWeight: 3.0,
        checkWeight: 1.5,
    },

    // ── "Hard" rules ──
    // Normal + 4-ply lookahead, near-zero self damage, aggressive king/piece hunting
    hard: {
        // ★ On low-end devices (2 cores / ≤2 GB RAM) use 3-ply:
        //   depth 4 is too heavy for cheap phones and can lock the UI
        //   for the full 3 s budget. `IS_LOW_END` is defined in main.js.
        maxDepth: (typeof IS_LOW_END !== 'undefined' && IS_LOW_END) ? 3 : 4,
        timeLimit: (typeof IS_LOW_END !== 'undefined' && IS_LOW_END) ? 2000 : 3000,
        randomness: 0,
        captureWeight: 1.6,
        damageWeight: 1.3,
        selfDamageWeight: 8.0,       // caster's own HP cost
        kingCaptureBonus: 100000,
        threatWeight: 2.0,
        ownKingSafetyWeight: 6.0,
        checkWeight: 2.5,
        aggressionBonus: 0,
        friendlyFireStrict: true,    // ★ document the enforced policy
    },
};

// ============================================================
//  AI YIELD HELPER
//  The synchronous minimax search blocks the main thread, which
//  freezes the render loop and every input handler (camera drag,
//  pinch-zoom, hover). We periodically hand control back to the
//  browser via setTimeout(0) so rAF + pointer events can run.
// ============================================================
const AI_YIELD_EVERY_MS = 40;   // ≈ 2–3 frames at 60 fps
let _aiLastYieldTs = 0;

// Runs synchronously when it's not time to yield yet — no micro-task
// overhead on the common path.
async function aiMaybeYield() {
    const now = performance.now();
    if (now - _aiLastYieldTs < AI_YIELD_EVERY_MS) return;
    _aiLastYieldTs = now;
    await new Promise(resolve => setTimeout(resolve, 0));
}

// ============================================================
//  FRIENDLY-FIRE DETECTION
//  Returns the total HP damage an ability would deal to `side`'s
//  own pieces (the caster's team). Used to (a) hard-filter
//  friendly-fire actions and (b) apply a massive scoring penalty.
// ============================================================
function getAbilityFriendlyDamage(game, action, side) {
    if (action.type !== 'ability') return 0;
    const ability = action.ability;
    if (!ability) return 0;

    // Heal / Revive help the team → never penalized.
    const abId = ability.id;
    if (abId === 'heal' || abId === 'revive') return 0;

    const piece = game.getPiece(action.fromR, action.fromC);
    if (!piece) return 0;

    const b = game.board;
    let dmg = 0;

    // ── Bishop "Cannon Leap" — damages every piece on the path ──
    if (piece.type === 'bishop' && ability.name === '炮躍 (Cannon Leap)') {
        const dr = Math.sign(action.r - action.fromR);
        const dc = Math.sign(action.c - action.fromC);
        const steps = Math.abs(action.r - action.fromR);
        for (let i = 1; i < steps; i++) {
            const r = action.fromR + dr * i;
            const c = action.fromC + dc * i;
            if (!game.isInBounds(r, c)) continue;
            const t = b[r][c];
            if (t && t.color === side && t !== piece) {
                dmg += Math.min(ability.damage || 0, t.hp);
            }
        }
        return dmg;
    }

    // ── Pawn "charge explosion" — cross of 4 around landing ──
    //    (Currently the ruleset only hits enemies, but check anyway so
    //     the penalty survives any future rule change.)
    if (piece.type === 'pawn' && ability.name === '衝鋒爆炸') {
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dr, dc] of dirs) {
            const tr = action.r + dr, tc = action.c + dc;
            if (!game.isInBounds(tr, tc)) continue;
            const t = b[tr][tc];
            if (t && t.color === side && t !== piece) {
                dmg += Math.min(ability.damage || 0, t.hp);
            }
        }
        return dmg;
    }

    // ── Single-target abilities (rook cannon, etc.) ──
    const target = b[action.r] && b[action.r][action.c];
    if (target && target.color === side && target !== piece) {
        dmg += Math.min(ability.damage || 0, target.hp);
    }

    return dmg;
}

// ============================================================
//  ACTION GENERATION
// ============================================================
function generateActions(game, color) {
    const moves = game.getAllLegalMoves(color);
    const abilities = [];
    if (isAbilityEnabledForColor(color)) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = game.getPiece(r, c);
                if (!p || p.color !== color) continue;
                if (p.type === 'knight' || p.type === 'king') continue;

                for (const ab of game.getLegalAbilities(r, c)) {
                    const target = game.getPiece(ab.r, ab.c);
                    const abId = ab.ability && ab.ability.id;
                    const isHeal = abId === 'heal';
                    const isRevive = abId === 'revive';

                    // Reject friendly fire — heal/revive are the exceptions.
                    if (target && target.color === color &&
                        target !== p && !isHeal && !isRevive) continue;

                    // ★ NEW — Reject any ability that would damage a friendly
                    //   piece anywhere along its path or area.
                    if (getAbilityFriendlyDamage(game, ab, color) > 0) continue;

                    abilities.push(ab);
                }
            }
        }
    }
    return [...moves, ...abilities];
}

// ============================================================
//  ACTION SIMULATION  (mirrors real game effects closely enough
//  for search purposes)
// ============================================================
function simulateAction(game, action) {
    const clone = game.clone();
    if (action.type === 'move') {
        applyMoveToClone(clone, action);
    } else {
        applyAbilityToClone(clone, action);
    }
    return clone;
}

function applyMoveToClone(game, action) {
    const piece = game.board[action.fromR][action.fromC];
    if (!piece) return;
    const toR = action.toR, toC = action.toC;
    const move = action.move || {};

    // En-passant capture
    if (move.enPassant) {
        const epRow = piece.color === 'white' ? toR - 1 : toR + 1;
        game.board[epRow][toC] = null;
    }

    // Castling rook hop
    if (move.castling) {
        const homeRow = piece.color === 'white' ? 0 : 7;
        if (move.castling === 'kingside') {
            game.board[homeRow][5] = game.board[homeRow][7];
            game.board[homeRow][7] = null;
        } else {
            game.board[homeRow][3] = game.board[homeRow][0];
            game.board[homeRow][0] = null;
        }
    }

    // Move piece
    const captured = game.board[toR][toC];
    game.board[action.fromR][action.fromC] = null;
    game.board[toR][toC] = { ...piece, hasMoved: true };

    // Half-move clock
    if (piece.type === 'pawn' || captured) game.halfMoveClock = 0;
    else game.halfMoveClock++;

    // Castling rights updates
    if (piece.type === 'king') {
        if (piece.color === 'white') {
            game.castlingRights.whiteKingside = false;
            game.castlingRights.whiteQueenside = false;
        } else {
            game.castlingRights.blackKingside = false;
            game.castlingRights.blackQueenside = false;
        }
    }
    if (piece.type === 'rook') {
        if (action.fromR === 0 && action.fromC === 0) game.castlingRights.whiteQueenside = false;
        if (action.fromR === 0 && action.fromC === 7) game.castlingRights.whiteKingside = false;
        if (action.fromR === 7 && action.fromC === 0) game.castlingRights.blackQueenside = false;
        if (action.fromR === 7 && action.fromC === 7) game.castlingRights.blackKingside = false;
    }

    // En-passant target
    game.enPassantTarget = (piece.type === 'pawn' && move.doublePawnPush)
        ? { r: (action.fromR + toR) / 2, c: toC }
        : null;

    // Knight push — only when the knockback skill is off cooldown
    if (piece.type === 'knight' &&
        isAbilityEnabledForColor(piece.color) &&
        (piece.skillCooldown || 0) === 0) {
        const pushed = applyKnightPushSim(game, action.fromR, action.fromC, toR, toC, piece.color);
        if (pushed) {
            const movedKnight = game.board[toR][toC];
            game.putOnSkillCooldown(movedKnight);
        }
    }

    // Turn advance (also ticks skill cooldowns for the new current player)
    game.flipTurn();
}

function applyAbilityToClone(game, action) {
    const piece = game.getPiece(action.fromR, action.fromC);
    if (!piece) return;
    const ability = action.ability;
    const enemyColor = piece.color === 'white' ? 'black' : 'white';

    // ── Queen "Heal" ──
    if (ability.id === 'heal') {
        const ally = game.getPiece(action.r, action.c);
        if (ally) ally.hp = Math.min(ally.maxHp, ally.hp + (ability.healAmount || 100));
        game.putOnSkillCooldown(piece, 'heal');
        game.halfMoveClock++;
        game.flipTurn();
        game.moveHistory.push({
            type: 'ability', abilityName: ability.name,
            fromR: action.fromR, fromC: action.fromC,
            targetR: action.r, targetC: action.c, healAmount: ability.healAmount || 100,
        });
        return;
    }

    // ── Queen "Revive" ──
    if (ability.id === 'revive') {
        const dead = game.getDeadPieces(piece.color);
        if (dead.length > 0) {
            let best = dead[0], bestVal = -1;
            for (const d of dead) {
                const v = PIECE_VALUES[d.type] || 0;
                if (v > bestVal) { bestVal = v; best = d; }
            }
            const np = {
                id: ++_pieceIdCounter,
                type: best.type,
                color: piece.color,
                hasMoved: true,
                hp: 100, maxHp: 100,
                skillCooldown: 0, reviveCooldown: 0,
                justUsedSkill: false, justUsedRevive: false,
            };
            game.board[action.r][action.c] = np;
            game.initialPieces.push({ id: np.id, type: best.type, color: piece.color });
        }
        game.putOnSkillCooldown(piece, 'revive');
        game.halfMoveClock++;
        game.flipTurn();
        game.moveHistory.push({
            type: 'ability', abilityName: ability.name,
            fromR: action.fromR, fromC: action.fromC,
            targetR: action.r, targetC: action.c,
        });
        return;
    }

    // ── Pawn "charge explosion": move + cross AoE + self-damage ──
    if (piece.type === 'pawn' && ability.name === '衝鋒爆炸') {
        const toR = action.r, toC = action.c;

        if (toR !== action.fromR || toC !== action.fromC) {
            game.board[action.fromR][action.fromC] = null;
            game.board[toR][toC] = piece;
            piece.hasMoved = true;
        }

        // Cross damage
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dr, dc] of dirs) {
            const tr = toR + dr, tc = toC + dc;
            if (!game.isInBounds(tr, tc)) continue;
            const t = game.board[tr][tc];
            if (t && t.color === enemyColor) {
                t.hp -= ability.damage;
                if (t.hp <= 0) game.board[tr][tc] = null;
            }
        }

        // Self-damage
        const self = game.board[toR][toC];
        if (self === piece) {
            piece.hp -= ability.selfDamage;
            if (piece.hp <= 0) game.board[toR][toC] = null;
        }

        // ★ 施放技能的兵進入冷卻
        const pawnRef = game.board[toR][toC];
        if (pawnRef && pawnRef.type === 'pawn') {
            game.putOnSkillCooldown(pawnRef);
        }

        game.halfMoveClock++;
        game.flipTurn();
        game.moveHistory.push({
            type: 'ability', abilityName: ability.name,
            fromR: action.fromR, fromC: action.fromC, targetR: toR, targetC: toC,
        });
        return;
    }

    // ── Bishop "Cannon Leap": jump past the first piece, damage path ──
    if (piece.type === 'bishop' && ability.name === '炮躍 (Cannon Leap)') {
        const toR = action.r, toC = action.c;
        const dr = Math.sign(toR - action.fromR);
        const dc = Math.sign(toC - action.fromC);
        const steps = Math.abs(toR - action.fromR);

        // Damage every piece on the path (exclusive of start & landing)
        for (let i = 1; i < steps; i++) {
            const r = action.fromR + dr * i;
            const c = action.fromC + dc * i;
            if (!game.isInBounds(r, c)) continue;
            const t = game.board[r][c];
            if (t) {
                t.hp -= ability.damage;
                if (t.hp <= 0) game.board[r][c] = null;
            }
        }

        // Move the bishop
        game.board[action.fromR][action.fromC] = null;
        game.board[toR][toC] = { ...piece, hasMoved: true };
        const landed = game.board[toR][toC];
        game.putOnSkillCooldown(landed);

        game.halfMoveClock++;
        game.flipTurn();
        game.moveHistory.push({
            type: 'bishop_leap',
            fromR: action.fromR, fromC: action.fromC,
            toR, toC, damageDealt: ability.damage
        });
        return;
    }

    // ── Rook cannon / default strike: single-target approximation ──
    game.useAbility(action.fromR, action.fromC, action.r, action.c, ability);
}

function applyKnightPushSim(game, fromR, fromC, landR, landC, color) {
    const victims = getPushableVictims(game, landR, landC, fromR, fromC, color);
    if (victims.length === 0) return false;

    // Pick most valuable victim
    let bestVictim = victims[0], bestVal = -1;
    for (const v of victims) {
        const vp = game.getPiece(v.r, v.c);
        const val = vp ? PIECE_VALUES[vp.type] * (vp.hp / vp.maxHp) : 0;
        if (val > bestVal) { bestVal = val; bestVictim = v; }
    }

    // Prefer unblocked direction (deterministic for search)
    const openDirs = bestVictim.directions.filter(d => !d.blocked);
    const dirs = openDirs.length > 0 ? openDirs : bestVictim.directions;
    if (dirs.length === 0) return;
    const dir = dirs[0];

    const victimPiece = game.getPiece(bestVictim.r, bestVictim.c);
    if (!victimPiece) return false;

    if (dir.blocked) {
        // Blocker takes knockback-block damage (25)
        const blocker = game.getPiece(dir.targetR, dir.targetC);
        if (blocker) {
            blocker.hp -= 25;
            if (blocker.hp <= 0) game.board[dir.targetR][dir.targetC] = null;
        }
    } else {
        game.board[dir.targetR][dir.targetC] = victimPiece;
        game.board[bestVictim.r][bestVictim.c] = null;
    }
    return true;
}

// ============================================================
//  THREAT DETECTION
//  Returns every piece of `side` currently attacked by the enemy
// ============================================================
function computeThreats(game, side) {
    const enemy = side === 'white' ? 'black' : 'white';
    const attacked = game.getAttackedSquares(enemy, game.board);
    const threats = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = game.board[r][c];
            if (p && p.color === side && attacked.has(r + ',' + c)) {
                threats.push({ r, c, piece: p });
            }
        }
    }
    return threats;
}

// ============================================================
//  ATTACK / DEFENSE MAP
//  For every occupied square, gather who attacks it and who defends it.
//  This is the foundation for "which of my two pieces do I save?".
// ============================================================
function computeAttackDefenseMap(game) {
    const b = game.board;
    const attackMap = {};   // "r,c" → [ { r, c, piece } ]
    const defendMap = {};   // "r,c" → [ { r, c, piece } ]

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = b[r][c];
            if (!p) continue;
            // skipCastling = true so castling targets don't pollute the map
            const moves = game.getPseudoLegalMoves(r, c, b, true);
            for (const m of moves) {
                const target = b[m.r][m.c];
                if (!target) continue;               // empty square = no defender/attacker entry
                const key = m.r + ',' + m.c;
                if (target.color === p.color) {
                    (defendMap[key] || (defendMap[key] = [])).push({ r, c, piece: p });
                } else {
                    (attackMap[key] || (attackMap[key] = [])).push({ r, c, piece: p });
                }
            }
        }
    }
    return { attackMap, defendMap };
}

// ============================================================
//  MATERIAL RISK
//  Static-exchange-style estimate: how much material would `side`
//  actually lose if it had to sit here and let the opponent take
//  whatever they want? Correctly handles:
//    • undefended piece          → full value lost
//    • outnumbered piece         → 90% of value lost
//    • attacked by stronger piece→ tiny tempo threat
//    • recapture with weaker piece → we win the trade, no penalty
//    • recapture with stronger piece → lose the difference
// ============================================================
function computeMaterialRisk(b, side, maps) {
    const { attackMap, defendMap } = maps;
    let risk = 0;

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = b[r][c];
            if (!p || p.color !== side) continue;
            if (p.type === 'king') continue;         // handled by king-safety term

            const key = r + ',' + c;
            const attackers = attackMap[key];
            if (!attackers || attackers.length === 0) continue;

            const defenders = defendMap[key] || [];
            const pVal = PIECE_VALUES[p.type] * (p.hp / p.maxHp);

            let minAtk = Infinity;
            for (const a of attackers) {
                const av = PIECE_VALUES[a.piece.type];
                if (av < minAtk) minAtk = av;
            }
            let minDef = Infinity;
            for (const d of defenders) {
                const dv = PIECE_VALUES[d.piece.type];
                if (dv < minDef) minDef = dv;
            }

            const numAtk = attackers.length;
            const numDef = defenders.length;

            if (numDef === 0) risk += pVal;                       // free capture
            else if (numAtk > numDef) risk += pVal * 0.9;                 // overwhelmed
            else if (minAtk >= pVal) risk += pVal * 0.15;                // low-priority threat
            else if (minDef > minAtk) risk += Math.max(0, pVal - minAtk) * 0.6;
            // else: we can recapture with a cheaper/equal piece → safe
        }
    }
    return risk;
}

// ============================================================
//  OPPONENT PASSIVITY TRACKER
//  If the human keeps playing harmless moves, ramping aggression
//  makes the AI attack instead of mirroring the shuffle.
// ============================================================
const aiPassivityTracker = { opponentPassiveTurns: 0 };

function updatePassivityTracker(game, aiSide) {
    const enemy = aiSide === 'white' ? 'black' : 'white';
    const hist = game.moveHistory;
    if (!hist || hist.length === 0) { aiPassivityTracker.opponentPassiveTurns = 0; return; }

    const last = hist[hist.length - 1];
    if (!last) { aiPassivityTracker.opponentPassiveTurns = 0; return; }

    // Aggressive actions → reset
    if (last.captured ||
        last.type === 'ability' || last.type === 'areaAbility' ||
        last.type === 'knockback' || last.type === 'bishop_leap' ||
        last.castling) {
        aiPassivityTracker.opponentPassiveTurns = 0;
        return;
    }

    // Classify a normal move
    const mp = last.piece;
    if (mp && mp.color === enemy) {
        const backRank = mp.color === 'white' ? 0 : 7;
        // Developing a knight / bishop off the back rank
        if ((mp.type === 'knight' || mp.type === 'bishop') && last.fromR === backRank) {
            aiPassivityTracker.opponentPassiveTurns =
                Math.max(0, aiPassivityTracker.opponentPassiveTurns - 1);
            return;
        }
        // Central pawn push
        if (mp.type === 'pawn' && (last.toC === 3 || last.toC === 4)) {
            aiPassivityTracker.opponentPassiveTurns =
                Math.max(0, aiPassivityTracker.opponentPassiveTurns - 1);
            return;
        }
        // Any pawn advancing
        if (mp.type === 'pawn') {
            const forward = mp.color === 'white'
                ? (last.toR - last.fromR) > 0
                : (last.toR - last.fromR) < 0;
            if (forward) return;      // neutral, don't count either way
        }
    }

    // Anything else = passive (piece shuffle / retreat)
    aiPassivityTracker.opponentPassiveTurns =
        Math.min(6, aiPassivityTracker.opponentPassiveTurns + 1);
}

function getAggressionMultiplier() {
    const n = aiPassivityTracker.opponentPassiveTurns;
    if (n === 0) return 0;
    // 1→0.15, 2→0.30, 3→0.45, 4→0.60, 5→0.70, 6→0.80
    return Math.min(0.8, n * 0.15);
}

// ============================================================
//  BOARD EVALUATION
// ============================================================
function evaluateBoard(game, side, cfg) {
    const enemy = side === 'white' ? 'black' : 'white';
    const b = game.board;

    // Terminal: either king gone
    const wK = game.findKing('white');
    const bK = game.findKing('black');
    if (!wK) return side === 'black' ? Infinity : -Infinity;
    if (!bK) return side === 'white' ? Infinity : -Infinity;

    let score = 0;

    // ── 1. Material × HP ratio, pawn advancement, opening development ──
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = b[r][c];
            if (!p) continue;
            const val = PIECE_VALUES[p.type] * (p.hp / p.maxHp);
            const sign = (p.color === side) ? 1 : -1;
            score += sign * val;

            if (p.type === 'pawn') {
                const advance = p.color === 'white' ? r : (7 - r);
                score += sign * advance * 6;
                // Fight for the centre
                if (c === 3 || c === 4) score += sign * 5;
            }

            // Development bonus — encourages knights/bishops off the back rank
            const backRank = p.color === 'white' ? 0 : 7;
            if ((p.type === 'knight' || p.type === 'bishop') && r !== backRank) {
                score += sign * 14;
            }
            // Discourage early queen sorties
            if (p.type === 'queen') {
                const startRow = p.color === 'white' ? 0 : 7;
                if (r !== startRow && game.fullMoveNumber < 8) {
                    score -= sign * 8;
                }
            }
        }
    }

    // ── 2. King hunting — reward low enemy king HP ──
    const ekp = game.findKing(enemy);
    if (ekp) {
        const ek = game.getPiece(ekp.r, ekp.c);
        if (ek) score += (1 - ek.hp / ek.maxHp) * cfg.kingCaptureBonus;
    }

    // ── 3. Own king safety ──
    const okp = game.findKing(side);
    if (okp) {
        const ok = game.getPiece(okp.r, okp.c);
        if (ok) {
            const hpLost = 1 - ok.hp / ok.maxHp;
            score -= hpLost * cfg.ownKingSafetyWeight * PIECE_VALUES.king * 0.15;
        }
    }

    // ── 4. Check bonus ──
    if (game.isInCheck(enemy, b)) score += cfg.checkWeight * 100;
    if (game.isInCheck(side, b)) score -= cfg.checkWeight * 100;

    // ── 5. Material at risk (the fork / double-attack term) ──
    //    This is what makes the AI *choose* which of two attacked pieces
    //    is more important to save — a rook risk costs more than a knight risk.
    const maps = computeAttackDefenseMap(game);
    const ourRisk = computeMaterialRisk(b, side, maps);
    const enemyRisk = computeMaterialRisk(b, enemy, maps);

    const aggr = cfg.aggressionBonus || 0;
    // As aggression rises: relax own defence a touch, reward enemy exposure
    score -= ourRisk * cfg.threatWeight * (0.55 - aggr * 0.10);
    score += enemyRisk * cfg.threatWeight * (0.55 + aggr * 0.35);

    return score;
}

// ============================================================
//  IMMEDIATE ACTION SCORE  (move ordering + Easy AI greedy)
// ============================================================
function scoreActionImmediate(game, action, side, cfg) {
    const enemy = side === 'white' ? 'black' : 'white';
    const b = game.board;
    let score = 0;

    // Precompute attacked squares once — cheap way to detect escaping
    const attackedByEnemy = game.getAttackedSquares(enemy, b);

    if (action.type === 'move') {
        const piece = game.getPiece(action.fromR, action.fromC);
        const cap = game.getPiece(action.toR, action.toC);

        // ── Capture value (MVV) ──
        if (cap && cap.color === enemy) {
            score += PIECE_VALUES[cap.type] * (cap.hp / cap.maxHp) * cfg.captureWeight;
            if (cap.type === 'king') score += cfg.kingCaptureBonus;
        }

        // ── Escape bonus: moving a threatened piece to safety ──
        if (piece) {
            const srcKey = action.fromR + ',' + action.fromC;
            const dstKey = action.toR + ',' + action.toC;
            const srcUnderAttack = attackedByEnemy.has(srcKey);
            const dstUnderAttack = attackedByEnemy.has(dstKey);
            if (srcUnderAttack) {
                const pVal = PIECE_VALUES[piece.type] * (piece.hp / piece.maxHp);
                score += dstUnderAttack ? pVal * 0.10 : pVal * 0.45;
            }
        }

        // ── Fork / new-threat bonus ──
        // Count how many enemy pieces this piece would attack from its new square
        // (cheap approximation: pretend the piece is already there).
        if (piece && (action.toR !== action.fromR || action.toC !== action.fromC)) {
            const savedFrom = b[action.fromR][action.fromC];
            const savedTo = b[action.toR][action.toC];
            // Simulate the move on a shallow copy for threat check
            b[action.fromR][action.fromC] = null;
            b[action.toR][action.toC] = piece;
            try {
                const newMoves = game.getPseudoLegalMoves(action.toR, action.toC, b, true);
                let hits = 0, totalVal = 0;
                for (const m of newMoves) {
                    const t = b[m.r][m.c];
                    if (!t || t.color !== enemy) continue;
                    if (t.type === 'king') continue;
                    const tv = PIECE_VALUES[t.type] * (t.hp / t.maxHp);
                    if (tv > PIECE_VALUES[piece.type] * 0.5) {
                        hits++;
                        totalVal += tv;
                    }
                }
                if (hits >= 2) score += totalVal * 0.30;   // fork!
                else if (hits === 1) score += totalVal * 0.08;
            } finally {
                b[action.fromR][action.fromC] = savedFrom;
                b[action.toR][action.toC] = savedTo;
            }
        }

        // ── Knight push value ──
        if (piece && piece.type === 'knight' && isAbilityEnabledForColor(piece.color)) {
            const victims = getPushableVictims(game, action.toR, action.toC,
                action.fromR, action.fromC, piece.color);
            for (const v of victims) {
                const vp = game.getPiece(v.r, v.c);
                if (vp) score += PIECE_VALUES[vp.type] * (vp.hp / vp.maxHp) * 0.4;
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    //  ABILITY SCORING
    // ══════════════════════════════════════════════════════════
    if (action.type === 'ability') {
        const target = game.getPiece(action.r, action.c);
        const movingPiece = game.getPiece(action.fromR, action.fromC);
        const ab = action.ability;
        if (!ab) return score;

        // ── Queen Heal — reward restoring HP to a valuable ally ──
        if (ab.id === 'heal') {
            if (target) {
                const healed = Math.min(ab.healAmount || 100, target.maxHp - target.hp);
                score += (healed / 100)
                    * (PIECE_VALUES[target.type] || 100)
                    * 0.6
                    * cfg.damageWeight;
            }
            return score;   // heal never hurts the team → skip ff check
        }

        // ── Queen Revive — reward bringing back the most valuable corpse ──
        if (ab.id === 'revive') {
            const dead = game.getDeadPieces(side);
            let bestVal = 0;
            for (const d of dead) {
                const v = PIECE_VALUES[d.type] || 0;
                if (v > bestVal) bestVal = v;
            }
            score += bestVal * 0.9 * cfg.captureWeight;
            return score;   // revive never hurts the team → skip ff check
        }

        // ── Bishop Cannon Leap — sum ONLY enemy path damage here.
        //    Team damage is applied by the unified penalty below. ──
        if (movingPiece && movingPiece.type === 'bishop'
            && ab.name === '炮躍 (Cannon Leap)') {
            const dr = Math.sign(action.r - action.fromR);
            const dc = Math.sign(action.c - action.fromC);
            const steps = Math.abs(action.r - action.fromR);
            for (let i = 1; i < steps; i++) {
                const pr = action.fromR + dr * i;
                const pc = action.fromC + dc * i;
                if (!game.isInBounds(pr, pc)) continue;
                const p = game.getPiece(pr, pc);
                if (!p) continue;
                if (p.color !== enemy) continue;              // friend → handled below
                const ratio = Math.min(1, ab.damage / p.hp);
                score += PIECE_VALUES[p.type] * ratio * cfg.damageWeight;
                if (p.type === 'king') score += cfg.kingCaptureBonus * ratio;
            }
        }
        // ── Single-target damage (rook cannon / default strike) ──
        else if (target && target.color === enemy) {
            const ratio = Math.min(1, ab.damage / target.hp);
            score += PIECE_VALUES[target.type] * ratio * cfg.damageWeight;
            if (target.type === 'king') score += cfg.kingCaptureBonus * ratio;
        }

        // ── Caster's own HP cost (pawn charge, etc.) ──
        if (ab.selfDamage) {
            score -= ab.selfDamage * cfg.selfDamageWeight;
        }

        // ══════════════════════════════════════════════════════
        //  ★ UNIFIED FRIENDLY-FIRE PENALTY
        //  Runs for EVERY offensive ability, so no early-return
        //  branch can skip it. Covers:
        //    • Bishop Cannon Leap  → every piece on the diagonal
        //    • Pawn charge         → cross AoE around the landing
        //    • Rook cannon / strike→ landing square only
        //  The magnitude (200×) dwarfs any possible reward, so the
        //  ability is effectively impossible to pick if it hurts
        //  our own team.
        // ══════════════════════════════════════════════════════
        const ffDamage = getAbilityFriendlyDamage(game, action, side);
        if (ffDamage > 0) {
            score -= ffDamage * 200;
        }
    }

    return score;
}

// ============================================================
//  MINIMAX WITH ALPHA-BETA
// ============================================================
async function minimax(game, depth, alpha, beta, isMax, aiSide, startTime, timeLimit, cfg) {
    // ★ Yield here — this is the hot path, hit thousands of times
    //   per search. Cheap synchronous check when not due.
    await aiMaybeYield();

    if (performance.now() - startTime > timeLimit)
        return evaluateBoard(game, aiSide, cfg);

    if (!game.findKing('white') || !game.findKing('black'))
        return evaluateBoard(game, aiSide, cfg);

    if (depth === 0)
        return evaluateBoard(game, aiSide, cfg);

    const side = isMax ? aiSide : (aiSide === 'white' ? 'black' : 'white');
    const actions = generateActions(game, side);

    if (actions.length === 0) {
        return game.isInCheck(side, game.board)
            ? (side === aiSide ? -Infinity : Infinity)
            : 0;
    }

    actions.sort((a, b) =>
        scoreActionImmediate(game, b, side, cfg) -
        scoreActionImmediate(game, a, side, cfg)
    );

    const branchLimit = depth >= 3 ? 14 : (depth === 2 ? 18 : 24);
    const searchList = actions.length > branchLimit ? actions.slice(0, branchLimit) : actions;

    if (isMax) {
        let best = -Infinity;
        for (const action of searchList) {
            await aiMaybeYield();                                   // ★
            if (performance.now() - startTime > timeLimit) break;
            const next = simulateAction(game, action);
            const val = await minimax(                              // ★ await
                next, depth - 1, alpha, beta, false,
                aiSide, startTime, timeLimit, cfg
            );
            if (val > best) best = val;
            if (best > alpha) alpha = best;
            if (beta <= alpha) break;
        }
        return best;
    } else {
        let best = Infinity;
        for (const action of searchList) {
            await aiMaybeYield();                                   // ★
            if (performance.now() - startTime > timeLimit) break;
            const next = simulateAction(game, action);
            const val = await minimax(                              // ★ await
                next, depth - 1, alpha, beta, true,
                aiSide, startTime, timeLimit, cfg
            );
            if (val < best) best = val;
            if (best < beta) beta = best;
            if (beta <= alpha) break;
        }
        return best;
    }
}

// ============================================================
//  ROOT SELECTION
// ============================================================
async function selectBestAction(game, aiSide, cfg) {
    const actions = generateActions(game, aiSide);
    if (actions.length === 0) return null;

    const startTime = performance.now();

    actions.sort((a, b) =>
        scoreActionImmediate(game, b, aiSide, cfg) -
        scoreActionImmediate(game, a, aiSide, cfg)
    );

    // ── Easy AI: 1-ply greedy (too fast to need yielding) ──
    if (cfg.maxDepth === 1) {
        const scored = actions.map(a => ({
            action: a,
            score: scoreActionImmediate(game, a, aiSide, cfg),
        }));
        if (cfg.randomness > 0) {
            const noise = 250 * cfg.randomness;
            for (const s of scored) s.score += (Math.random() - 0.5) * noise * 2;
        }
        scored.sort((a, b) => b.score - a.score);
        if (cfg.randomness > 0 && Math.random() < cfg.randomness * 0.5 && scored.length > 1) {
            const idx = Math.min(scored.length - 1, 1 + Math.floor(Math.random() * 2));
            return scored[idx].action;
        }
        return scored[0].action;
    }

    // ── Normal / Hard: iterative deepening ──
    let bestAction = actions[0];
    let bestScore = -Infinity;

    for (let depth = 1; depth <= cfg.maxDepth; depth++) {
        let depthBest = null;
        let depthBestScore = -Infinity;
        let depthCompleted = true;

        for (const action of actions) {
            await aiMaybeYield();                                   // ★
            if (performance.now() - startTime > cfg.timeLimit) {
                depthCompleted = false; break;
            }
            const next = simulateAction(game, action);
            const val = await minimax(                              // ★ await
                next, depth - 1, -Infinity, Infinity, false,
                aiSide, startTime, cfg.timeLimit, cfg
            );
            if (val > depthBestScore) { depthBestScore = val; depthBest = action; }
            if (performance.now() - startTime > cfg.timeLimit) {
                depthCompleted = false; break;
            }
        }

        if (depthBest && (depthCompleted || depth === 1)) {
            bestAction = depthBest;
            bestScore = depthBestScore;
        }
        if (!depthCompleted) break;

        if (depthBest) {
            const idx = actions.indexOf(depthBest);
            if (idx > 0) { actions.splice(idx, 1); actions.unshift(depthBest); }
        }
        if (bestScore === Infinity) break;
        if (performance.now() - startTime > cfg.timeLimit) break;
    }

    if (cfg.randomness > 0 && Math.random() < cfg.randomness) {
        const pool = actions.slice(0, Math.min(3, actions.length));
        return pool[Math.floor(Math.random() * pool.length)];
    }
    return bestAction;
}

// ============================================================
//  MAIN AI ENTRY POINT  (non-blocking indicator + yield)
// ============================================================
async function makeAIMove() {
    if (gameOverFlag || currentMode !== 'ai') { aiThinking = false; return; }
    aiThinking = true;
    showAIThinking(true);

    // ★ Wait for two frames so the "AI thinking" badge is committed
    //   to the screen before we begin the heavy search.
    await new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    try {
        const baseCfg = AI_CONFIGS[aiDifficulty] || AI_CONFIGS.easy;
        const aiSide = gameState.turn;

        updatePassivityTracker(gameState, aiSide);
        const aggression = getAggressionMultiplier();

        const cfg = Object.assign({}, baseCfg, {
            aggressionBonus: aggression,
            kingCaptureBonus: baseCfg.kingCaptureBonus * (1 + aggression * 0.30),
            captureWeight: baseCfg.captureWeight * (1 + aggression * 0.20),
        });

        if (aggression > 0 && aiDifficulty === 'hard') {
            console.log(`🔥 AI aggression boost: ${(aggression * 100).toFixed(0)}% ` +
                `(opponent passive for ${aiPassivityTracker.opponentPassiveTurns} turns)`);
        }

        // ★ IMPORTANT: this now yields every ~40 ms; camera input
        //   keeps firing during the whole search.
        const action = await selectBestAction(gameState, aiSide, cfg);

        if (!action) {
            aiThinking = false;
            showAIThinking(false);
            checkGameStatus();
            return;
        }

        aiThinking = false;
        showAIThinking(false);
        executeChosenAction(action);
    } catch (err) {
        console.error('❌ AI move error:', err);
        aiThinking = false;
        showAIThinking(false);
    }
}

// ============================================================
//  AI THINKING INDICATOR
// ============================================================
function showAIThinking(show) {
    const el = document.getElementById('aiThinkingIndicator');
    if (!el) return;
    el.classList.toggle('hidden', !show);
}

// ============================================================
//  DISPATCH CHOSEN ACTION TO MAIN.JS EXECUTORS
// ============================================================
function executeChosenAction(action) {
    const movingPiece = gameState.getPiece(action.fromR, action.fromC);
    if (!movingPiece) return;

    // ── Knight: always route through the push-aware executor ──
    if (movingPiece.type === 'knight') {
        const landR = action.type === 'move' ? action.toR : action.r;
        const landC = action.type === 'move' ? action.toC : action.c;

        // ★ Knockback is the knight's special skill → if it's cooling down,
        //   treat this as a plain move (no victims, no push, no cooldown reset).
        const canPush = isAbilityEnabledForColor(movingPiece.color) &&
            (movingPiece.skillCooldown || 0) === 0;
        const victims = canPush
            ? getPushableVictims(gameState, landR, landC, action.fromR, action.fromC, movingPiece.color)
            : [];

        selectedPiece = { row: action.fromR, col: action.fromC, piece: movingPiece };
        validMoves = gameState.getLegalMoves(action.fromR, action.fromC);

        let opt = null;
        if (victims.length > 0) {
            // Pick most valuable victim
            let bestVictim = victims[0], bestVal = -1;
            for (const v of victims) {
                const vp = gameState.getPiece(v.r, v.c);
                const val = vp ? PIECE_VALUES[vp.type] * (vp.hp / vp.maxHp) : 0;
                if (val > bestVal) { bestVal = val; bestVictim = v; }
            }
            // Prefer unblocked direction; otherwise random
            const openDirs = bestVictim.directions.filter(d => !d.blocked);
            const dirs = openDirs.length > 0 ? openDirs : bestVictim.directions;
            if (dirs.length > 0) {
                const dir = dirs[Math.floor(Math.random() * dirs.length)];
                opt = {
                    r: bestVictim.r, c: bestVictim.c,
                    dirR: dir.dirR, dirC: dir.dirC,
                    targetR: dir.targetR, targetC: dir.targetC,
                    blocked: !!dir.blocked,
                };
            }
        }
        executeKnightAbilityMove(action.fromR, action.fromC, landR, landC, opt);
        return;
    }

    // ── Ability ──
    if (action.type === 'ability') {
        selectedPiece = {
            row: action.fromR, col: action.fromC,
            piece: movingPiece,
        };
        abilityTargets = gameState.getLegalAbilities(action.fromR, action.fromC);
        attemptAbility(action.fromR, action.fromC, action.r, action.c, action.ability);
        return;
    }

    // ── Normal move ──
    selectedPiece = {
        row: action.fromR, col: action.fromC,
        piece: movingPiece,
    };
    validMoves = gameState.getLegalMoves(action.fromR, action.fromC);
    attemptMove(action.fromR, action.fromC, action.toR, action.toC);
}