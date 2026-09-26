// ============================================================
//  recorder.js — Single-player (AI) match recording,
//                end-of-match stats, and image export.
// ============================================================
//  Hooks into main.js via safe window-level overrides:
//    • startAIGame()          → begin a fresh recording
//    • syncPiecesAfterMove()  → capture new moveHistory entries
//    • checkGameStatus()      → stop recording on game over
// ============================================================

(function () {
    'use strict';

    // ────────────────────────────────────────────────────────
    //  STATE
    // ────────────────────────────────────────────────────────
    const recorder = {
        active: false,
        playerColor: 'white',
        aiColor: 'black',
        // ★ NEW — difficulty of the AI opponent, captured at game start
        difficulty: null,         // 'noob' | 'easy' | 'hard' | null
        startTime: 0,
        endTime: 0,
        lastRecordedIndex: 0,
        records: [],
        result: null,             // 'win' | 'lose' | 'draw'
    };

    window.gameRecorder = recorder;

    const FILE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const PIECE_GLYPHS = {
        white: { king: '♔', queen: '♕', rook: '♖', bishop: '♗', knight: '♘', pawn: '♙' },
        black: { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' },
    };
    const PREVIEW_GLYPHS = {
        white: { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' },
        black: { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' },
    };

    // ★ NEW — human-readable AI difficulty labels
    const AI_DIFFICULTY_LABELS = {
        noob: '簡單',
        easy: '悠閒',
        hard: '困難',
    };

    function difficultyLabel(d) {
        if (!d) return '—';
        return AI_DIFFICULTY_LABELS[d] || d;
    }

    // ★ NEW — export toggle (whether the PNG includes the move list)
    let exportIncludeMoves = true;

    // ────────────────────────────────────────────────────────
    //  PLAYER NAME PERSISTENCE
    // ────────────────────────────────────────────────────────
    const DEFAULT_NAME = '無名棋士';

    function getPlayerName() {
        try { return localStorage.getItem('chessPlayerName') || DEFAULT_NAME; }
        catch (_) { return DEFAULT_NAME; }
    }

    function setPlayerName(name) {
        const cleaned = (name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
        const final = cleaned || DEFAULT_NAME;
        try { localStorage.setItem('chessPlayerName', final); } catch (_) { }
        return final;
    }

    // ────────────────────────────────────────────────────────
    //  HELPERS
    // ────────────────────────────────────────────────────────
    function squareName(r, c) {
        if (r == null || c == null || r < 0 || r > 7 || c < 0 || c > 7) return '??';
        return FILE_LETTERS[c] + (r + 1);
    }

    function glyphFor(color, type) {
        if (!color || !type) return '?';
        return (PIECE_GLYPHS[color] || {})[type] || '?';
    }

    function formatDuration(ms) {
        if (!isFinite(ms) || ms < 0) ms = 0;
        const totalSec = Math.floor(ms / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (h > 0) return `${h} 時 ${m} 分`;
        if (m > 0) return `${m} 分 ${s} 秒`;
        return `${s} 秒`;
    }

    function resultLabel(r) {
        if (r === 'win') return '勝利';
        if (r === 'lose') return '落敗';
        if (r === 'draw') return '和局';
        return '—';
    }

    function resultColor(r) {
        if (r === 'win') return '#2ecc71';
        if (r === 'lose') return '#e74c3c';
        if (r === 'draw') return '#f39c12';
        return '#e8c547';
    }

    function snapshotBoard(board) {
        const out = new Array(64);
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                out[r * 8 + c] = p ? { type: p.type, color: p.color } : null;
            }
        }
        return out;
    }

    // ────────────────────────────────────────────────────────
    //  RECORDING CORE
    // ────────────────────────────────────────────────────────
    function startGameRecording(playerColor) {
        recorder.active = true;
        recorder.playerColor = playerColor;
        recorder.aiColor = playerColor === 'white' ? 'black' : 'white';
        recorder.difficulty = (typeof aiDifficulty !== 'undefined') ? aiDifficulty : null;
        recorder.startTime = performance.now();
        recorder.endTime = 0;
        recorder.lastRecordedIndex = 0;
        recorder.records = [];
        recorder.result = null;
    }

    function stopGameRecording(result) {
        if (!recorder.active) return;
        recorder.endTime = performance.now();
        recorder.result = result || recorder.result;
        recorder.active = false;
    }

    function captureNewMoveHistoryEntries() {
        if (!gameState || !Array.isArray(gameState.board)) return;

        const hist = gameState.moveHistory;
        if (recorder.lastRecordedIndex >= hist.length) return;

        if (!recorder.active) {
            recorder.lastRecordedIndex = hist.length;
            return;
        }

        const snap = snapshotBoard(gameState.board);

        for (let i = recorder.lastRecordedIndex; i < hist.length; i++) {
            recordHistoryEntry(hist[i], i, snap);
        }
        recorder.lastRecordedIndex = hist.length;
    }

    function recordHistoryEntry(entry, idx, snapshot) {
        if (!entry) return;

        const piece = entry.piece || null;
        const color = piece ? piece.color : null;
        const type = entry.type || 'move';

        let kind = 'move';
        let skillName = null;

        if (type === 'ability') {
            kind = 'skill';
            skillName = entry.abilityName || '特殊技能';
        } else if (type === 'bishop_leap') {
            kind = 'skill';
            skillName = '炮躍 (Cannon Leap)';
        } else if (type === 'knockback') {
            kind = 'skill';
            skillName = '擊退 (Knockback)';
        } else if (type === 'areaAbility') {
            kind = 'skill';
            skillName = entry.abilityName || '範圍技能';
        } else if (type === 'domain_kill' || type === 'domain_kill_king') {
            kind = 'skill';
            skillName = '領域展開 (Domain Expansion)';
        }

        recorder.records.push({
            idx,
            color,
            pieceType: piece ? piece.type : '?',
            kind,
            skillName,
            fromR: entry.fromR,
            fromC: entry.fromC,
            toR: entry.toR,
            toC: entry.toC,
            captured: entry.captured ? (entry.captured.type || '?') : null,
            abilityName: entry.abilityName || null,
            damageDealt: entry.damageDealt || 0,
            selfDamage: entry.selfDamage || 0,
            blocked: !!entry.blocked,
            blockDamage: entry.blockDamage || 0,
            elapsed: performance.now() - recorder.startTime,
            boardSnapshot: snapshot || null,
        });
    }

    // ────────────────────────────────────────────────────────
    //  STATS
    // ────────────────────────────────────────────────────────
    function computeStats() {
        const recs = recorder.records || [];
        const playerColor = recorder.playerColor;
        const aiColor = recorder.aiColor;

        let playerMoves = 0, aiMoves = 0;
        let playerSkills = 0, aiSkills = 0;
        let playerDamage = 0, aiDamage = 0;
        let playerKills = 0, aiKills = 0;

        for (const r of recs) {
            const isPlayer = r.color === playerColor;
            if (r.kind === 'move') {
                if (isPlayer) playerMoves++; else aiMoves++;
            } else {
                if (isPlayer) playerSkills++; else aiSkills++;
            }
            const dmg = r.damageDealt || 0;
            if (isPlayer) playerDamage += dmg; else aiDamage += dmg;
            if (r.captured) { if (isPlayer) playerKills++; else aiKills++; }
        }

        const duration = (recorder.endTime || performance.now())
            - (recorder.startTime || performance.now());

        return {
            playerMoves, aiMoves,
            playerSkills, aiSkills,
            playerDamage, aiDamage,
            playerKills, aiKills,
            totalMoves: playerMoves + aiMoves,
            totalSkills: playerSkills + aiSkills,
            duration,
            result: recorder.result,
            playerColor,
            aiColor,
            // ★ NEW
            difficulty: recorder.difficulty,
        };
    }

    // ════════════════════════════════════════════════════════
    //  ★ HOVER PREVIEW BOARD
    // ════════════════════════════════════════════════════════
    let previewBoardEl = null;
    let previewCells = null;

    function ensurePreviewBoard() {
        if (previewBoardEl) return;

        previewBoardEl = document.createElement('div');
        previewBoardEl.className = 'move-preview-board';

        previewCells = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const cell = document.createElement('div');
                cell.className = 'move-preview-cell ' +
                    ((r + c) % 2 === 0 ? 'light' : 'dark');
                previewBoardEl.appendChild(cell);
                previewCells.push(cell);
            }
        }
        document.body.appendChild(previewBoardEl);
    }

    function showMovePreview(record, clientX, clientY) {
        ensurePreviewBoard();

        for (let i = 0; i < 64; i++) {
            const cell = previewCells[i];
            cell.innerHTML = '';
            cell.classList.remove('from', 'to');
        }

        const snap = record.boardSnapshot;
        if (snap) {
            for (let i = 0; i < 64; i++) {
                const p = snap[i];
                if (!p) continue;
                const span = document.createElement('span');
                span.className = `preview-piece ${p.color}`;
                span.textContent = (PREVIEW_GLYPHS[p.color] || {})[p.type] || '?';
                previewCells[i].appendChild(span);
            }
        }

        if (record.fromR != null && record.fromC != null) {
            const idx = record.fromR * 8 + record.fromC;
            if (previewCells[idx]) previewCells[idx].classList.add('from');
        }
        if (record.toR != null && record.toC != null) {
            const idx = record.toR * 8 + record.toC;
            if (previewCells[idx]) previewCells[idx].classList.add('to');
        }

        previewBoardEl.classList.add('visible');
        positionPreviewBoard(clientX, clientY);
    }

    function positionPreviewBoard(x, y) {
        if (!previewBoardEl) return;
        const margin = 16;
        const w = previewBoardEl.offsetWidth || 260;
        const h = previewBoardEl.offsetHeight || 260;
        let px = x + margin;
        let py = y + margin;
        if (px + w > window.innerWidth - 8) px = x - w - margin;
        if (py + h > window.innerHeight - 8) py = window.innerHeight - h - 8;
        if (py < 8) py = 8;
        if (px < 8) px = 8;
        previewBoardEl.style.left = px + 'px';
        previewBoardEl.style.top = py + 'px';
    }

    function hideMovePreview() {
        if (previewBoardEl) previewBoardEl.classList.remove('visible');
    }

    // ────────────────────────────────────────────────────────
    //  UI: STATS / EXPORT MENU
    // ────────────────────────────────────────────────────────
    function showGameStats() {
        const overlay = document.getElementById('exportOverlay');
        if (!overlay) return;

        const nameInput = document.getElementById('exportPlayerName');
        if (nameInput) nameInput.value = getPlayerName();

        const toggleEl = document.getElementById('exportIncludeMoves');
        if (toggleEl) toggleEl.checked = !!exportIncludeMoves;

        refreshExportCard();
        overlay.classList.remove('hidden');
    }

    function closeExport() {
        const overlay = document.getElementById('exportOverlay');
        if (overlay) overlay.classList.add('hidden');
        hideMovePreview();
    }

    function refreshExportCard() {
        const stats = computeStats();
        const playerName = getPlayerName();

        const resEl = document.getElementById('exportStatResult');
        if (resEl) {
            resEl.textContent = resultLabel(stats.result);
            resEl.style.color = resultColor(stats.result);
        }

        setText('exportStatTime', formatDuration(stats.duration));
        setText('exportStatPlayerMoves', stats.playerMoves);
        setText('exportStatAiMoves', stats.aiMoves);
        setText('exportStatPlayerSkills', stats.playerSkills);
        setText('exportStatAiSkills', stats.aiSkills);
        setText('exportCardName', playerName);

        // ★ NEW — AI difficulty in the player plate
        setText('exportStatDifficulty', difficultyLabel(stats.difficulty));

        // ── Move list ──
        const movesEl = document.getElementById('exportMoves');
        if (movesEl) {
            movesEl.innerHTML = '';

            if (!recorder.records.length) {
                const empty = document.createElement('div');
                empty.className = 'export-move-empty';
                empty.textContent = '（無對局記錄）';
                movesEl.appendChild(empty);
            } else {
                recorder.records.forEach((r, i) => {
                    const row = document.createElement('div');
                    const sideClass = r.color === 'white' ? 'white-side' : 'black-side';
                    row.className = 'export-move-row ' + sideClass;
                    row.innerHTML = formatMoveRow(r, Math.floor(i / 2) + 1);

                    row.addEventListener('mouseenter', (e) => {
                        showMovePreview(r, e.clientX, e.clientY);
                    });
                    row.addEventListener('mousemove', (e) => {
                        positionPreviewBoard(e.clientX, e.clientY);
                    });
                    row.addEventListener('mouseleave', () => {
                        hideMovePreview();
                    });

                    movesEl.appendChild(row);
                });

                if (!movesEl.__recorderScrollBound) {
                    movesEl.__recorderScrollBound = true;
                    movesEl.addEventListener('scroll', hideMovePreview, { passive: true });
                }
            }
        }

        const dateEl = document.getElementById('exportFooterDate');
        if (dateEl) {
            const d = new Date();
            dateEl.textContent =
                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    }

    function setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function formatMoveRow(r, turnNum) {
        const glyph = glyphFor(r.color, r.pieceType);
        const from = squareName(r.fromR, r.fromC);
        const to = squareName(r.toR, r.toC);
        const numSpan = `<span class="export-move-num">${turnNum}.</span>`;

        if (r.kind === 'skill') {
            const name = r.skillName || '技能';
            return `${numSpan} <span class="export-move-glyph">⚔</span> ` +
                `<span class="export-move-text">${name} ` +
                `<span class="export-move-coord">(${from} → ${to})</span></span>`;
        }

        const arrow = r.captured ? '×' : '→';
        const capGlyph = r.captured
            ? `<span class="export-move-cap">×${glyphFor(r.color === 'white' ? 'black' : 'white', r.captured)}</span>`
            : '';
        return `${numSpan} <span class="export-move-glyph">${glyph}</span> ` +
            `<span class="export-move-text">${from} ${arrow} ${to}${capGlyph}</span>`;
    }

    function setExportIncludeMoves(v) {
        exportIncludeMoves = !!v;
    }

    // ────────────────────────────────────────────────────────
    //  EXPORT AS IMAGE
    // ────────────────────────────────────────────────────────
    function exportAsImage() {
        const inputEl = document.getElementById('exportPlayerName');
        const finalName = setPlayerName(inputEl ? inputEl.value : getPlayerName());
        if (inputEl) inputEl.value = finalName;

        const stats = computeStats();
        drawExportCanvas(stats, finalName);
    }

    function drawExportCanvas(stats, playerName) {
        const W = 1080;
        const SHOW_MOVES = exportIncludeMoves;
        const H = SHOW_MOVES ? 1620 : 1080;

        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');

        drawBackground(ctx, W, H);

        const PAD = 80;
        let y = 130;

        // ── Title ──
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#e8c547';
        ctx.shadowColor = 'rgba(232, 197, 71, 0.55)';
        ctx.shadowBlur = 34;
        ctx.font = 'bold 84px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
        ctx.fillText('西洋棋對局記錄', W / 2, y);
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(232, 197, 71, 0.55)';
        ctx.font = '30px "Microsoft JhengHei", sans-serif';
        ctx.fillText('C H E S S   M A T C H   R E C O R D', W / 2, y + 50);
        ctx.restore();

        y += 130;

        // ── Player name plate (now also holds the AI difficulty) ──
        const plateH = 160;   // ★ was 110 — taller to fit the difficulty line
        roundRectPath(ctx, PAD, y, W - PAD * 2, plateH, 24);
        const plateGrad = ctx.createLinearGradient(PAD, y, W - PAD, y + plateH);
        plateGrad.addColorStop(0, 'rgba(22, 33, 62, 0.92)');
        plateGrad.addColorStop(1, 'rgba(30, 42, 78, 0.92)');
        ctx.fillStyle = plateGrad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(232, 197, 71, 0.7)';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // "玩 家" label
        ctx.fillStyle = 'rgba(232, 197, 71, 0.6)';
        ctx.font = '22px "Microsoft JhengHei", sans-serif';
        ctx.fillText('玩 家', W / 2, y + 30);

        // Player name
        ctx.fillStyle = '#f0e6d3';
        ctx.font = 'bold 54px "Microsoft JhengHei", "PingFang TC", sans-serif';
        ctx.fillText(playerName, W / 2, y + 78);

        // ★ NEW — AI difficulty line
        ctx.font = 'bold 24px "Microsoft JhengHei", "PingFang TC", sans-serif';
        ctx.fillStyle = 'rgba(232, 197, 71, 0.9)';
        ctx.fillText(
            `AI 難度  ·  ${difficultyLabel(stats.difficulty)}`,
            W / 2,
            y + 125
        );

        y += plateH + 46;

        // ── Stats grid ──
        const statItems = [
            { label: '對局結果', value: resultLabel(stats.result), color: resultColor(stats.result) },
            { label: '對局時間', value: formatDuration(stats.duration), color: '#f0e6d3' },
            { label: '我方步數', value: String(stats.playerMoves), color: '#7ac8ff' },
            { label: 'AI 步數', value: String(stats.aiMoves), color: '#c44dff' },
            { label: '我方技能', value: String(stats.playerSkills), color: '#7ac8ff' },
            { label: 'AI 技能', value: String(stats.aiSkills), color: '#c44dff' },
        ];

        const cols = 2, rows = 3;
        const gap = 24;
        const cellW = (W - PAD * 2 - gap * (cols - 1)) / cols;
        const cellH = 130;

        for (let i = 0; i < statItems.length; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = PAD + col * (cellW + gap);
            const yy = y + row * (cellH + gap);

            roundRectPath(ctx, x, yy, cellW, cellH, 18);
            ctx.fillStyle = 'rgba(10, 15, 35, 0.78)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(232, 197, 71, 0.35)';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillStyle = 'rgba(232, 197, 71, 0.7)';
            ctx.font = '22px "Microsoft JhengHei", sans-serif';
            ctx.fillText(statItems[i].label, x + 24, yy + 18);

            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = statItems[i].color;
            ctx.font = 'bold 52px "Microsoft JhengHei", "PingFang TC", sans-serif';
            ctx.fillText(statItems[i].value, x + 24, yy + 100);
        }

        y += rows * cellH + (rows - 1) * gap + 46;

        // ── Moves list (optional) ──
        if (SHOW_MOVES) {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = '#e8c547';
            ctx.font = 'bold 34px "Microsoft JhengHei", sans-serif';
            ctx.fillText('走棋記錄', PAD, y);

            const movesTop = y + 24;
            const movesBottom = H - 170;
            const movesH = movesBottom - movesTop;

            roundRectPath(ctx, PAD, movesTop, W - PAD * 2, movesH, 20);
            ctx.fillStyle = 'rgba(10, 15, 35, 0.78)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(232, 197, 71, 0.35)';
            ctx.lineWidth = 2;
            ctx.stroke();

            const records = recorder.records || [];
            const lineH = 46;
            const maxRows = Math.max(0, Math.floor((movesH - 40) / lineH));
            const truncated = records.length > maxRows - 1;
            const displayRecords = truncated ? records.slice(0, maxRows - 1) : records;

            ctx.textBaseline = 'middle';
            let lineY = movesTop + 32;

            if (displayRecords.length === 0) {
                ctx.fillStyle = 'rgba(240, 230, 211, 0.45)';
                ctx.font = 'italic 26px "Microsoft JhengHei", sans-serif';
                ctx.fillText('（無對局記錄）', PAD + 24, movesTop + movesH / 2);
            } else {
                for (let i = 0; i < displayRecords.length; i++) {
                    const r = displayRecords[i];
                    const turnNum = Math.floor(i / 2) + 1;
                    const sideColor = r.color === 'white' ? '#f0e6d3' : '#c44dff';
                    const glyph = glyphFor(r.color, r.pieceType);
                    const from = squareName(r.fromR, r.fromC);
                    const to = squareName(r.toR, r.toC);

                    ctx.fillStyle = 'rgba(232, 197, 71, 0.6)';
                    ctx.font = '26px "Courier New", monospace';
                    ctx.fillText(String(turnNum).padStart(2, ' ') + '.', PAD + 26, lineY);

                    ctx.fillStyle = sideColor;
                    ctx.font = '34px "Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols 2", serif';
                    ctx.fillText(r.kind === 'skill' ? '⚔' : glyph, PAD + 106, lineY);

                    ctx.fillStyle = sideColor;
                    ctx.font = '26px "Microsoft JhengHei", sans-serif';
                    let text;
                    if (r.kind === 'skill') {
                        text = `${r.skillName || '技能'}   (${from} → ${to})`;
                    } else if (r.captured) {
                        text = `${from} × ${to}`;
                    } else {
                        text = `${from} → ${to}`;
                    }
                    ctx.fillText(text, PAD + 158, lineY);

                    lineY += lineH;
                }

                if (truncated) {
                    ctx.fillStyle = 'rgba(232, 197, 71, 0.55)';
                    ctx.font = 'italic 24px "Microsoft JhengHei", sans-serif';
                    ctx.fillText(`... 還有 ${records.length - displayRecords.length} 步未顯示`,
                        PAD + 26, lineY);
                }
            }
        }

        // ── Footer ──
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(232, 197, 71, 0.9)';
        ctx.font = 'bold 32px "Microsoft JhengHei", sans-serif';
        ctx.fillText('♞   TotallyIsAChess', W / 2, H - 105);

        const d = new Date();
        const dateStr =
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` +
            `  ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        ctx.fillStyle = 'rgba(240, 230, 211, 0.55)';
        ctx.font = '22px "Courier New", monospace';
        ctx.fillText(dateStr, W / 2, H - 58);

        triggerDownload(canvas, `chess-record-${Date.now()}.png`);
    }

    function drawBackground(ctx, W, H) {
        const grad = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.5, W * 0.95);
        grad.addColorStop(0, '#1c2848');
        grad.addColorStop(0.55, '#121a35');
        grad.addColorStop(1, '#080b1a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        ctx.save();
        ctx.globalAlpha = 0.06;
        ctx.strokeStyle = '#e8c547';
        ctx.lineWidth = 2;
        const gridSize = 140;
        ctx.translate(W / 2, H / 2);
        ctx.rotate(Math.PI / 4);
        for (let x = -W * 1.2; x < W * 1.2; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, -H);
            ctx.lineTo(x, H);
            ctx.stroke();
        }
        for (let y = -H * 1.2; y < H * 1.2; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(-W, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }
        ctx.restore();

        const glow = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, W * 0.72);
        glow.addColorStop(0, 'rgba(232, 197, 71, 0.18)');
        glow.addColorStop(0.5, 'rgba(232, 197, 71, 0.05)');
        glow.addColorStop(1, 'rgba(232, 197, 71, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);

        const glyphs = [
            { ch: '♞', x: 0.08, y: 0.09, size: 200 },
            { ch: '♛', x: 0.88, y: 0.06, size: 160 },
            { ch: '♜', x: 0.05, y: 0.31, size: 130 },
            { ch: '♝', x: 0.93, y: 0.29, size: 100 },
            { ch: '♟', x: 0.04, y: 0.58, size: 220 },
            { ch: '♚', x: 0.95, y: 0.56, size: 180 },
            { ch: '♘', x: 0.10, y: 0.84, size: 140 },
            { ch: '♕', x: 0.88, y: 0.87, size: 190 },
        ];
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const g of glyphs) {
            ctx.fillStyle = 'rgba(232, 197, 71, 0.10)';
            ctx.shadowColor = 'rgba(232, 197, 71, 0.28)';
            ctx.shadowBlur = 44;
            ctx.font = `bold ${g.size}px "Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols 2", serif`;
            ctx.fillText(g.ch, g.x * W, g.y * H);
        }
        ctx.restore();

        const vg = ctx.createRadialGradient(W / 2, H / 2, W * 0.35, W / 2, H / 2, W * 1.05);
        vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vg.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);

        ctx.strokeStyle = 'rgba(232, 197, 71, 0.55)';
        ctx.lineWidth = 6;
        ctx.strokeRect(20, 20, W - 40, H - 40);
        ctx.strokeStyle = 'rgba(232, 197, 71, 0.20)';
        ctx.lineWidth = 2;
        ctx.strokeRect(34, 34, W - 68, H - 68);
    }

    function roundRectPath(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function triggerDownload(canvas, filename) {
        canvas.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        }, 'image/png');
    }

    // ────────────────────────────────────────────────────────
    //  HOOKS INTO main.js
    // ────────────────────────────────────────────────────────
    function installHooks() {
        const _startAIGame = window.startAIGame;
        if (typeof _startAIGame === 'function' && !_startAIGame.__recorderWrapped) {
            window.startAIGame = function (difficulty) {
                _startAIGame(difficulty);
                // ★ At this point, main.js has already set `aiDifficulty`,
                //   so startGameRecording can safely read it.
                startGameRecording(playerColor || 'white');
            };
            window.startAIGame.__recorderWrapped = true;
        }

        const _restart = window.restartGame;
        if (typeof _restart === 'function' && !_restart.__recorderWrapped) {
            window.restartGame = function () {
                _restart.apply(this, arguments);
                // restartGame() → initNewGame() → new ChessGame()
                // reset the recorder for the fresh match
                if (currentMode === 'ai') {
                    startGameRecording(playerColor || 'white');
                }
            };
            window.restartGame.__recorderWrapped = true;
        }

        const _sync = window.syncPiecesAfterMove;
        if (typeof _sync === 'function' && !_sync.__recorderWrapped) {
            window.syncPiecesAfterMove = function () {
                _sync.apply(this, arguments);
                try { captureNewMoveHistoryEntries(); }
                catch (err) { console.warn('recorder: capture failed', err); }
            };
            window.syncPiecesAfterMove.__recorderWrapped = true;
        }

        const _check = window.checkGameStatus;
        if (typeof _check === 'function' && !_check.__recorderWrapped) {
            window.checkGameStatus = function () {
                const wasOver = gameOverFlag;
                _check.apply(this, arguments);

                if (gameOverFlag && !wasOver && currentMode === 'ai') {
                    const status = (gameState && typeof gameState.getGameStatus === 'function')
                        ? gameState.getGameStatus()
                        : null;
                    const winner = status ? status.winner : null;

                    let result = 'draw';
                    if (winner && winner === playerColor) result = 'win';
                    else if (winner && winner !== 'draw') result = 'lose';

                    stopGameRecording(result);

                    const btn = document.getElementById('gameStatsBtn');
                    if (btn) btn.style.display = '';
                }
            };
            window.checkGameStatus.__recorderWrapped = true;
        }
    }

    // ────────────────────────────────────────────────────────
    //  NAME INPUT LIVE-UPDATE
    // ────────────────────────────────────────────────────────
    function bindNameInput() {
        const nameInput = document.getElementById('exportPlayerName');
        if (!nameInput || nameInput.__bound) return;
        nameInput.__bound = true;

        nameInput.addEventListener('input', () => {
            const raw = nameInput.value;
            const displayName = raw.trim() || DEFAULT_NAME;
            const cardNameEl = document.getElementById('exportCardName');
            if (cardNameEl) cardNameEl.textContent = displayName;
            try { localStorage.setItem('chessPlayerName', raw.slice(0, 24)); } catch (_) { }
        });

        nameInput.addEventListener('blur', () => {
            nameInput.value = setPlayerName(nameInput.value);
        });
    }

    // ────────────────────────────────────────────────────────
    //  PUBLIC API
    // ────────────────────────────────────────────────────────
    window.showGameStats = showGameStats;
    window.closeExport = closeExport;
    window.exportAsImage = exportAsImage;
    window.refreshExportCard = refreshExportCard;
    window.setExportIncludeMoves = setExportIncludeMoves;

    // ────────────────────────────────────────────────────────
    //  INSTALL
    // ────────────────────────────────────────────────────────
    function init() {
        installHooks();
        bindNameInput();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.addEventListener('load', init);
})();