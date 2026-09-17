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
        maxDepth: 3,
        timeLimit: 2000,
        randomness: 0,
        captureWeight: 1.6,
        damageWeight: 1.3,
        selfDamageWeight: 8.0,       // essentially forbidden
        kingCaptureBonus: 100000,    // extremely aggressive king hunting
        threatWeight: 2.0,           // punish any threat against us
        ownKingSafetyWeight: 6.0,
        checkWeight: 2.5,
    },
};

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
                // Knights use normal moves (executor handles push automatically)
                if (p.type === 'knight') continue;

                for (const ab of game.getLegalAbilities(r, c)) {
                    const target = game.getPiece(ab.r, ab.c);
                    const abId = ab.ability && ab.ability.id;
                    const isHeal = abId === 'heal';

                    // ★ Reject friendly fire — but healing allies is the exception.
                    if (target && target.color === color && target !== p && !isHeal) continue;

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
    if (piece.type === 'pawn' && ability.name === '冲锋爆炸') {
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
//  BOARD EVALUATION
// ============================================================
function evaluateBoard(game, side, cfg) {
    const enemy = side === 'white' ? 'black' : 'white';

    // Terminal: either king gone
    const wK = game.findKing('white');
    const bK = game.findKing('black');
    if (!wK) return side === 'black' ? Infinity : -Infinity;
    if (!bK) return side === 'white' ? Infinity : -Infinity;

    let score = 0;

    // 1. Material × HP ratio
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = game.board[r][c];
            if (!p) continue;
            const val = PIECE_VALUES[p.type] * (p.hp / p.maxHp);
            const sign = (p.color === side) ? 1 : -1;
            score += sign * val;

            // Pawn advancement
            if (p.type === 'pawn') {
                const advance = p.color === 'white' ? r : (7 - r);
                score += sign * advance * 6;
            }
        }
    }

    // 2. King hunting — reward low enemy king HP
    const ekp = game.findKing(enemy);
    if (ekp) {
        const ek = game.getPiece(ekp.r, ekp.c);
        if (ek) {
            const hpLost = 1 - ek.hp / ek.maxHp;
            score += hpLost * cfg.kingCaptureBonus;
        }
    }

    // 3. Own king safety — penalise damage taken
    const okp = game.findKing(side);
    if (okp) {
        const ok = game.getPiece(okp.r, okp.c);
        if (ok) {
            const hpLost = 1 - ok.hp / ok.maxHp;
            score -= hpLost * cfg.ownKingSafetyWeight * PIECE_VALUES.king * 0.15;
        }
    }

    // 4. Check bonus
    if (game.isInCheck(enemy, game.board)) score += cfg.checkWeight * 100;
    if (game.isInCheck(side, game.board)) score -= cfg.checkWeight * 100;

    // 5. Threats on our pieces — this is what makes the AI "stop opponent's plans"
    const threats = computeThreats(game, side);
    for (const t of threats) {
        const val = PIECE_VALUES[t.piece.type] * (t.piece.hp / t.piece.maxHp);
        if (t.piece.type === 'king') {
            // ★ King under attack = captured next move (capturing the king ends
            //   the game here). Penalty must dwarf any material gain so the AI
            //   resolves the threat instead of greedily chipping a piece.
            score -= PIECE_VALUES.king * 20 * (cfg.ownKingSafetyWeight / 6);
        } else {
            score -= val * cfg.threatWeight;
        }
    }

    return score;
}

// ============================================================
//  IMMEDIATE ACTION SCORE  (move ordering + Easy AI greedy)
// ============================================================
function scoreActionImmediate(game, action, side, cfg) {
    const enemy = side === 'white' ? 'black' : 'white';
    let score = 0;

    if (action.type === 'move') {
        const cap = game.getPiece(action.toR, action.toC);
        if (cap && cap.color === enemy) {
            score += PIECE_VALUES[cap.type] * (cap.hp / cap.maxHp) * cfg.captureWeight;
            if (cap.type === 'king') score += cfg.kingCaptureBonus;
        }
        // Knight push value (best case)
        // Knight push value (best case)
        const piece = game.getPiece(action.fromR, action.fromC);
        if (piece && piece.type === 'knight' &&
            isAbilityEnabledForColor(piece.color)) {
            const canPush = (piece.skillCooldown || 0) === 0;
            const victims = getPushableVictims(game, action.toR, action.toC, action.fromR, action.fromC, piece.color);
            for (const v of victims) {
                const vp = game.getPiece(v.r, v.c);
                if (vp) score += PIECE_VALUES[vp.type] * (vp.hp / vp.maxHp) * 0.4;
            }
        }
    }

    if (action.type === 'ability') {
        const target = game.getPiece(action.r, action.c);
        const movingPiece = game.getPiece(action.fromR, action.fromC);
        const ab = action.ability;

                // ★ Queen Heal
        if (ab.id === 'heal') {
            const t = game.getPiece(action.r, action.c);
            if (t) {
                const healed = Math.min(ab.healAmount || 100, t.maxHp - t.hp);
                score += (healed / 100) * (PIECE_VALUES[t.type] || 100) * 0.6 * cfg.damageWeight;
            }
            return score;
        }

        // ★ Queen Revive
        if (ab.id === 'revive') {
            const dead = game.getDeadPieces(side);
            let bestVal = 0;
            for (const d of dead) bestVal = Math.max(bestVal, PIECE_VALUES[d.type] || 0);
            score += bestVal * 0.9 * cfg.captureWeight;
            return score;
        }

        // ★ Bishop leap: sum path damage; penalise friendly fire
        if (movingPiece && movingPiece.type === 'bishop' &&
            ab.name === '炮躍 (Cannon Leap)') {
            const dr = Math.sign(action.r - action.fromR);
            const dc = Math.sign(action.c - action.fromC);
            const steps = Math.abs(action.r - action.fromR);
            for (let i = 1; i < steps; i++) {
                const pr = action.fromR + dr * i;
                const pc = action.fromC + dc * i;
                if (!game.isInBounds(pr, pc)) continue;
                const p = game.getPiece(pr, pc);
                if (!p) continue;
                const ratio = Math.min(1, ab.damage / p.hp);
                if (p.color === enemy) {
                    score += PIECE_VALUES[p.type] * ratio * cfg.damageWeight;
                    if (p.type === 'king') score += cfg.kingCaptureBonus * ratio;
                } else if (p !== movingPiece) {
                    // Friendly fire — heavy penalty (same as existing)
                    score -= PIECE_VALUES[p.type] * ratio * 10.0;
                }
            }
            return score;
        }

        if (target && target.color === enemy) {
            // Enemy hit — reward
            const ratio = Math.min(1, ab.damage / target.hp);
            score += PIECE_VALUES[target.type] * ratio * cfg.damageWeight;
            if (target.type === 'king') score += cfg.kingCaptureBonus * ratio;
        } else if (target && target.color === side && target !== movingPiece) {
            // ★ Friendly fire — massive penalty. Never worth it.
            const ratio = Math.min(1, ab.damage / target.hp);
            score -= PIECE_VALUES[target.type] * ratio * 10.0;
        }

        if (ab.selfDamage) score -= ab.selfDamage * cfg.selfDamageWeight;
    }

    return score;
}

// ============================================================
//  MINIMAX WITH ALPHA-BETA
// ============================================================
function minimax(game, depth, alpha, beta, isMax, aiSide, startTime, timeLimit, cfg) {
    if (performance.now() - startTime > timeLimit)
        return evaluateBoard(game, aiSide, cfg);

    // Terminal: king missing
    if (!game.findKing('white') || !game.findKing('black'))
        return evaluateBoard(game, aiSide, cfg);

    if (depth === 0)
        return evaluateBoard(game, aiSide, cfg);

    const side = isMax ? aiSide : (aiSide === 'white' ? 'black' : 'white');
    const actions = generateActions(game, side);

    if (actions.length === 0) {
        // No moves: checkmate or stalemate
        return game.isInCheck(side, game.board)
            ? (side === aiSide ? -Infinity : Infinity)
            : 0;
    }

    // Move ordering: MVV-LVA-ish (best immediate score first)
    actions.sort((a, b) =>
        scoreActionImmediate(game, b, side, cfg) -
        scoreActionImmediate(game, a, side, cfg)
    );

    // Prune branching on deeper plies (king captures are always ordered first)
    const branchLimit = depth >= 3 ? 14 : (depth === 2 ? 18 : 24);
    const searchList = actions.length > branchLimit ? actions.slice(0, branchLimit) : actions;

    if (isMax) {
        let best = -Infinity;
        for (const action of searchList) {
            if (performance.now() - startTime > timeLimit) break;
            const next = simulateAction(game, action);
            const val = minimax(next, depth - 1, alpha, beta, false, aiSide, startTime, timeLimit, cfg);
            if (val > best) best = val;
            if (best > alpha) alpha = best;
            if (beta <= alpha) break;
        }
        return best;
    } else {
        let best = Infinity;
        for (const action of searchList) {
            if (performance.now() - startTime > timeLimit) break;
            const next = simulateAction(game, action);
            const val = minimax(next, depth - 1, alpha, beta, true, aiSide, startTime, timeLimit, cfg);
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
function selectBestAction(game, aiSide, cfg) {
    const actions = generateActions(game, aiSide);
    if (actions.length === 0) return null;

    const startTime = performance.now();

    // Pre-sort by immediate score for good ordering
    actions.sort((a, b) =>
        scoreActionImmediate(game, b, aiSide, cfg) -
        scoreActionImmediate(game, a, aiSide, cfg)
    );

    // ── Easy AI: 1-ply greedy with noise ──
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

        // Occasionally pick a suboptimal move for variety
        if (cfg.randomness > 0 && Math.random() < cfg.randomness * 0.5 && scored.length > 1) {
            const idx = Math.min(scored.length - 1, 1 + Math.floor(Math.random() * 2));
            return scored[idx].action;
        }
        return scored[0].action;
    }

    // ── Normal / Hard: iterative deepening minimax ──
    let bestAction = actions[0];
    let bestScore = -Infinity;

    for (let depth = 1; depth <= cfg.maxDepth; depth++) {
        let depthBest = null;
        let depthBestScore = -Infinity;
        let depthCompleted = true;

        for (const action of actions) {
            if (performance.now() - startTime > cfg.timeLimit) { depthCompleted = false; break; }
            const next = simulateAction(game, action);
            const val = minimax(next, depth - 1, -Infinity, Infinity, false, aiSide, startTime, cfg.timeLimit, cfg);
            if (val > depthBestScore) { depthBestScore = val; depthBest = action; }
            if (performance.now() - startTime > cfg.timeLimit) { depthCompleted = false; break; }
        }

        // ★ Only trust a depth that finished. If the clock cut the search short,
        //   the remaining candidates were never evaluated — adopting that partial
        //   result makes the AI blindly play the highest-ordered action (the
        //   cannon), which is exactly the "ignores its doomed king" behaviour.
        //   depth 1 is exempt: those are plain static evals, still valid.
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

    // Small residual randomness for Normal (fractional)
    if (cfg.randomness > 0 && Math.random() < cfg.randomness) {
        const pool = actions.slice(0, Math.min(3, actions.length));
        return pool[Math.floor(Math.random() * pool.length)];
    }

    return bestAction;
}

// ============================================================
//  MAIN AI ENTRY POINT  (non-blocking indicator + yield)
// ============================================================
function makeAIMove() {
    if (gameOverFlag || currentMode !== 'ai') { aiThinking = false; return; }
    aiThinking = true;

    // Show the "AI thinking" indicator
    showAIThinking(true);

    // ── Yield to the browser so the indicator is actually painted ──
    //    Two nested rAFs guarantee the current frame is committed,
    //    then setTimeout(0) lets the style/layout pass complete
    //    before we enter the heavy synchronous minimax.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            setTimeout(() => {
                try {
                    const cfg = AI_CONFIGS[aiDifficulty] || AI_CONFIGS.easy;
                    const aiSide = gameState.turn;
                    const action = selectBestAction(gameState, aiSide, cfg);

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
            }, 0);
        });
    });
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