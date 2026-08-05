/**
 * ====================================
 * PDF GENERATOR (Shared)
 * ====================================
 * Generates comprehensive tournament PDF reports.
 * Used by statistics.html (lightweight and full) and full/god.html.
 *
 * Dependencies:
 *   - window.gameState (tournament data)
 *   - window.jspdf (jsPDF 2.5.x UMD)
 *   - jspdf-autotable plugin
 *   - GAMES_CONFIG (shared/scripts/games-config.js)
 *   - showToast (shared/scripts/toast.js)
 *
 * DOM requirements:
 *   - #pdfOverlay (.pdf-overlay with .hidden toggle)
 *   - #pdfProgressText (progress message element)
 */

(function () {
    'use strict';

    const MIN_DURATION_MINUTES = 5;

    // ---- Helpers (self-contained, no external deps) ----

    function _getTeamById(gs, teamId) {
        if (!gs?.teams) return null;
        return gs.teams.find(t => String(t.id) === String(teamId));
    }

    function _getTeamName(gs, teamId) {
        const team = _getTeamById(gs, teamId);
        return team?.name || `Team ${teamId}`;
    }

    function _getGameDisplayName(gs, gameId) {
        if (gs?.gameDefinitions && gs.gameDefinitions[gameId]) {
            return gs.gameDefinitions[gameId].name;
        }
        if (typeof GAMES_CONFIG !== 'undefined') {
            const game = GAMES_CONFIG.getGame(gameId);
            if (game) return game.name;
        }
        return gameId || 'Unknown';
    }

    // Resolve any player ID (p_xxx or UID) to the registry entry
    function _resolvePlayer(gs, playerId) {
        if (!playerId || !gs?.players) return null;
        // Direct registry lookup
        if (gs.players[playerId]) return gs.players[playerId];
        // Reverse lookup by UID
        for (const p of Object.values(gs.players)) {
            if (p.uid === playerId) return p;
        }
        return null;
    }

    function _getPlayerNameById(gs, playerId) {
        if (!playerId) return 'Unknown';
        const player = _resolvePlayer(gs, playerId);
        if (player?.name) return player.name;
        // PlayerUtils (handles both formats)
        if (window.PlayerUtils) {
            const info = window.PlayerUtils.getPlayerDisplayInfo(gs, playerId);
            if (info?.name && info.name !== 'Unknown') return info.name;
        }
        // Fallback: check team player arrays
        for (const team of (gs?.teams || [])) {
            for (const p of (team.players || [])) {
                if (p.uid === playerId || p.id === playerId) return p.name || 'Unknown';
            }
        }
        return 'Unknown';
    }

    function _calculateAllPlayerStats(gs) {
        if (!gs?.players) return {};
        const history = gs.gameHistory || [];
        const stats = {};

        // Build UID -> registryId reverse map for matches that store UIDs
        const uidToId = {};
        Object.entries(gs.players).forEach(([playerId, player]) => {
            if (player.uid) uidToId[player.uid] = playerId;
        });
        // Resolve a match player ID to a registry ID
        function resolveId(id) {
            if (stats[id]) return id;
            return uidToId[id] || id;
        }

        Object.entries(gs.players).forEach(([playerId, player]) => {
            stats[playerId] = {
                id: playerId,
                name: player.name,
                teamId: player.teamId,
                gamesPlayed: 0, wins: 0, losses: 0, winRate: 0,
                currentStreak: { type: null, count: 0 },
                bestWinStreak: 0, bestLossStreak: 0,
                byGame: {}, byFormat: {},
                challenges: { played: 0, won: 0, lost: 0 },
                recentMatches: [],
                vsOpponents: {}, withTeammates: {},
                matchDurations: []
            };
        });

        const sortedHistory = [...history].sort((a, b) =>
            new Date(a.timestamp) - new Date(b.timestamp)
        );

        sortedHistory.forEach(match => {
            const winningPlayerIds = (match.winningPlayerIds || []).map(resolveId);
            const losingPlayerIds = (match.losingPlayerIds || []).map(resolveId);
            const game = match.game || 'Unknown';
            const format = match.playType || 'Unknown';
            const isChallenge = match.isChallenge || false;
            const duration = match.matchDuration?.durationMinutes ?? null;
            const hasDuration = duration != null;

            winningPlayerIds.forEach(playerId => {
                if (!stats[playerId]) return;
                const ps = stats[playerId];
                ps.gamesPlayed++; ps.wins++;
                if (ps.currentStreak.type === 'win') ps.currentStreak.count++;
                else ps.currentStreak = { type: 'win', count: 1 };
                ps.bestWinStreak = Math.max(ps.bestWinStreak, ps.currentStreak.count);
                if (!ps.byGame[game]) ps.byGame[game] = { played: 0, won: 0, lost: 0 };
                ps.byGame[game].played++; ps.byGame[game].won++;
                if (!ps.byFormat[format]) ps.byFormat[format] = { played: 0, won: 0, lost: 0 };
                ps.byFormat[format].played++; ps.byFormat[format].won++;
                if (isChallenge) { ps.challenges.played++; ps.challenges.won++; }
                if (hasDuration) ps.matchDurations.push(duration);
                ps.recentMatches.push({ matchId: match.id, result: 'win', game, format, timestamp: match.timestamp, opponents: losingPlayerIds });
                losingPlayerIds.forEach(opId => {
                    if (!stats[opId]) return;
                    if (!ps.vsOpponents[opId]) ps.vsOpponents[opId] = { played: 0, won: 0, lost: 0 };
                    ps.vsOpponents[opId].played++; ps.vsOpponents[opId].won++;
                });
                winningPlayerIds.forEach(tmId => {
                    if (tmId === playerId || !stats[tmId]) return;
                    if (!ps.withTeammates[tmId]) ps.withTeammates[tmId] = { played: 0, won: 0, lost: 0 };
                    ps.withTeammates[tmId].played++; ps.withTeammates[tmId].won++;
                });
            });

            losingPlayerIds.forEach(playerId => {
                if (!stats[playerId]) return;
                const ps = stats[playerId];
                ps.gamesPlayed++; ps.losses++;
                if (ps.currentStreak.type === 'loss') ps.currentStreak.count++;
                else ps.currentStreak = { type: 'loss', count: 1 };
                ps.bestLossStreak = Math.max(ps.bestLossStreak, ps.currentStreak.count);
                if (!ps.byGame[game]) ps.byGame[game] = { played: 0, won: 0, lost: 0 };
                ps.byGame[game].played++; ps.byGame[game].lost++;
                if (!ps.byFormat[format]) ps.byFormat[format] = { played: 0, won: 0, lost: 0 };
                ps.byFormat[format].played++; ps.byFormat[format].lost++;
                if (isChallenge) { ps.challenges.played++; ps.challenges.lost++; }
                if (hasDuration) ps.matchDurations.push(duration);
                ps.recentMatches.push({ matchId: match.id, result: 'loss', game, format, timestamp: match.timestamp, opponents: winningPlayerIds });
                winningPlayerIds.forEach(opId => {
                    if (!stats[opId]) return;
                    if (!ps.vsOpponents[opId]) ps.vsOpponents[opId] = { played: 0, won: 0, lost: 0 };
                    ps.vsOpponents[opId].played++; ps.vsOpponents[opId].lost++;
                });
                losingPlayerIds.forEach(tmId => {
                    if (tmId === playerId || !stats[tmId]) return;
                    if (!ps.withTeammates[tmId]) ps.withTeammates[tmId] = { played: 0, won: 0, lost: 0 };
                    ps.withTeammates[tmId].played++; ps.withTeammates[tmId].lost++;
                });
            });
        });

        Object.values(stats).forEach(ps => {
            ps.winRate = ps.gamesPlayed > 0 ? (ps.wins / ps.gamesPlayed) * 100 : 0;
            ps.recentMatches = ps.recentMatches.slice(-10).reverse();
            const validDurations = ps.matchDurations.filter(d => d >= MIN_DURATION_MINUTES);
            ps.avgDuration = validDurations.length > 0
                ? Math.round(validDurations.reduce((a, b) => a + b, 0) / validDurations.length)
                : null;
            ps.durationDataPoints = validDurations.length;
            ps.durationTotalPoints = ps.matchDurations.length;
        });

        return stats;
    }

    // ---- Image loading ----

    function loadImageForPDF(src, roundCorners = false) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                if (roundCorners) {
                    const w = canvas.width, h = canvas.height;
                    const r = Math.min(w, h) * 0.18;
                    ctx.beginPath();
                    ctx.moveTo(r, 0); ctx.lineTo(w - r, 0);
                    ctx.quadraticCurveTo(w, 0, w, r); ctx.lineTo(w, h - r);
                    ctx.quadraticCurveTo(w, h, w - r, h); ctx.lineTo(r, h);
                    ctx.quadraticCurveTo(0, h, 0, h - r); ctx.lineTo(0, r);
                    ctx.quadraticCurveTo(0, 0, r, 0);
                    ctx.closePath(); ctx.clip();
                }
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }

    // ---- Main PDF generation ----

    async function generatePDF() {
        const gameState = window.gameState;
        if (!gameState) {
            if (typeof showToast === 'function') showToast('No tournament selected', 'warning');
            return;
        }

        const overlay = document.getElementById('pdfOverlay');
        const progressText = document.getElementById('pdfProgressText');
        if (overlay) overlay.classList.remove('hidden');

        try {
            // Pre-load logo and game icons
            if (progressText) progressText.textContent = 'Loading assets...';
            const logoDataUrl = await loadImageForPDF((window.BOARDGAME_BASE || '.') + '/shared/images/favicon/android-chrome-192x192.png', true);

            const gameIconMap = {};
            const gamesUsed = new Set();
            (gameState.gameHistory || []).forEach(m => { if (m.game) gamesUsed.add(m.game); });
            await Promise.all([...gamesUsed].map(async (gameId) => {
                let imagePath = null;
                if (gameState.gameDefinitions?.[gameId]?.image) {
                    imagePath = gameState.gameDefinitions[gameId].image;
                } else if (typeof GAMES_CONFIG !== 'undefined') {
                    const game = GAMES_CONFIG.getGame(gameId);
                    if (game?.image) imagePath = game.image;
                }
                if (imagePath) {
                    const resolvedPath = (typeof GAMES_CONFIG !== 'undefined' && GAMES_CONFIG.resolveImagePath)
                        ? GAMES_CONFIG.resolveImagePath(imagePath)
                        : (window.BOARDGAME_BASE || '.') + '/' + imagePath;
                    const dataUrl = await loadImageForPDF(resolvedPath, true);
                    if (dataUrl) gameIconMap[gameId] = dataUrl;
                }
            }));

            // Compute player stats
            const playerStatsCache = _calculateAllPlayerStats(gameState);

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

            const pageW = doc.internal.pageSize.getWidth();
            const pageH = doc.internal.pageSize.getHeight();
            const margin = 15;
            const contentW = pageW - margin * 2;

            // Color palette
            const C = {
                bg:         [5, 7, 16],
                bgDeep:     [8, 11, 20],
                panel:      [16, 20, 32],
                panelLight: [20, 24, 38],
                panelAlt:   [12, 15, 26],
                cardBg:     [14, 17, 28],
                headerBg:   [30, 34, 50],
                gold:       [200, 179, 126],
                goldBright: [232, 216, 168],
                goldDim:    [140, 125, 88],
                text:       [200, 204, 214],
                textBright: [242, 244, 247],
                textMuted:  [106, 112, 136],
                textDim:    [58, 63, 82],
                win:        [0, 216, 128],
                winDim:     [0, 160, 96],
                loss:       [192, 56, 64],
                lossDim:    [140, 44, 50],
                border:     [40, 44, 60],
                borderGold: [80, 72, 50],
                white:      [255, 255, 255]
            };

            // ---- HELPERS ----
            function hexToRgb(hex) {
                hex = (hex || '#666666').replace('#', '');
                if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
                return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
            }

            function getTeamIndex(teamId) {
                if (!gameState?.teams) return 999;
                const idx = gameState.teams.findIndex(t => String(t.id) === String(teamId));
                return idx >= 0 ? idx : 999;
            }

            function drawPageBg() {
                doc.setFillColor(...C.bg);
                doc.rect(0, 0, pageW, pageH, 'F');
            }

            function drawPageLogo() {
                if (logoDataUrl) {
                    doc.addImage(logoDataUrl, 'PNG', margin, 3, 8, 8);
                }
            }

            // Monkey-patch addPage for auto dark bg + logo
            const _origDocAddPage = doc.addPage.bind(doc);
            doc.addPage = function(...args) {
                _origDocAddPage(...args);
                drawPageBg();
                drawPageLogo();
                return doc;
            };

            function addPage() {
                doc.addPage();
                return margin + 4;
            }

            function checkPage(y, needed = 20) {
                if (y + needed > pageH - margin - 6) return addPage();
                return y;
            }

            function wrColor(rateNum) {
                if (rateNum >= 60) return C.win;
                if (rateNum >= 40) return C.goldBright;
                return C.loss;
            }

            function parseWinRate(str) {
                const n = parseInt(str);
                return isNaN(n) ? 50 : n;
            }

            function sectionTitle(y, title) {
                y = checkPage(y, 18);
                doc.setFillColor(...C.gold);
                doc.circle(margin + 1.5, y - 1.5, 1.2, 'F');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(12);
                doc.setTextColor(...C.gold);
                doc.text(title.toUpperCase(), margin + 5, y);
                y += 2.5;
                doc.setDrawColor(...C.gold);
                doc.setLineWidth(0.4);
                doc.line(margin, y, margin + contentW * 0.4, y);
                doc.setDrawColor(...C.borderGold);
                doc.setLineWidth(0.15);
                doc.line(margin + contentW * 0.4, y, margin + contentW, y);
                return y + 7;
            }

            function playerHeader(y, name, teamName, teamColorRgb) {
                doc.setFillColor(28, 32, 46);
                doc.roundedRect(margin, y - 4, contentW, 10, 2, 2, 'F');
                doc.setDrawColor(...C.borderGold);
                doc.setLineWidth(0.3);
                doc.roundedRect(margin, y - 4, contentW, 10, 2, 2, 'S');
                doc.setFillColor(...(teamColorRgb || C.gold));
                doc.rect(margin, y - 4, 1.5, 10, 'F');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.setTextColor(...C.goldBright);
                doc.text(name, margin + 5, y + 2);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8);
                doc.setTextColor(...(teamColorRgb || C.textMuted));
                doc.text(teamName, margin + 5 + doc.getTextWidth(name) + 4, y + 2);
                return y + 10;
            }

            function bodyText(y, text, opts = {}) {
                y = checkPage(y, 6);
                doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
                doc.setFontSize(opts.size || 8.5);
                doc.setTextColor(...(opts.color || C.text));
                doc.text(String(text), opts.x || margin + 2, y);
                return y + (opts.lineHeight || 4.5);
            }

            function drawStatBox(x, y, w, h, value, label) {
                doc.setFillColor(...C.panelLight);
                doc.roundedRect(x, y, w, h, 2, 2, 'F');
                doc.setDrawColor(...C.border);
                doc.setLineWidth(0.15);
                doc.roundedRect(x, y, w, h, 2, 2, 'S');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(14);
                doc.setTextColor(...C.goldBright);
                doc.text(String(value), x + w / 2, y + h * 0.42, { align: 'center' });
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(6.5);
                doc.setTextColor(...C.textMuted);
                doc.text(label, x + w / 2, y + h * 0.75, { align: 'center' });
            }

            const GAME_ICON_SIZE = 5;

            function gameIconCellHook(colIndex, gameIdFn) {
                return function(data) {
                    if (data.section === 'body' && data.column.index === colIndex) {
                        const gameId = gameIdFn(data.row.index);
                        const iconData = gameIconMap[gameId];
                        if (iconData) {
                            const iconY = data.cell.y + (data.cell.height - GAME_ICON_SIZE) / 2;
                            doc.addImage(iconData, 'PNG', data.cell.x + 2, iconY, GAME_ICON_SIZE, GAME_ICON_SIZE);
                        }
                    }
                };
            }

            const tableBase = {
                fillColor: C.panel, textColor: C.text, lineColor: C.border,
                lineWidth: 0.15, fontSize: 8, cellPadding: 3, font: 'helvetica'
            };
            const tableHeadBase = {
                fillColor: C.headerBg, textColor: C.gold, fontStyle: 'bold', fontSize: 7.5
            };
            const tableAltRow = { fillColor: C.panelAlt };
            const subTableBase = {
                fillColor: [10, 13, 22], textColor: C.text, lineColor: [28, 32, 46],
                lineWidth: 0.1, fontSize: 7.5, cellPadding: 2, font: 'helvetica'
            };
            const subTableHead = {
                fillColor: C.panelLight, textColor: C.gold, fontStyle: 'bold', fontSize: 7
            };

            function winRateHook(colIndex) {
                return function(data) {
                    if (data.section === 'body' && data.column.index === colIndex) {
                        const rate = parseWinRate(data.cell.raw);
                        data.cell.styles.textColor = wrColor(rate);
                        data.cell.styles.fontStyle = 'bold';
                    }
                };
            }

            const teamColorMap = {};
            (gameState.teams || []).forEach(t => {
                teamColorMap[t.id] = hexToRgb(t.color);
            });

            // ========================================================
            // PAGE 1: COVER
            // ========================================================
            if (progressText) progressText.textContent = 'Building cover page...';
            drawPageBg();

            const tournamentName = gameState.name || gameState.tournamentId || 'Tournament';
            const history = (gameState.gameHistory || []).filter(m => !m.isBreak);
            const teams = gameState.teams || [];

            // Top decorative gold bar
            doc.setFillColor(...C.gold);
            doc.rect(0, 0, pageW, 2.5, 'F');

            if (logoDataUrl) {
                doc.addImage(logoDataUrl, 'PNG', pageW / 2 - 12, 10, 24, 24);
            }

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(24);
            doc.setTextColor(...C.goldBright);
            doc.text(tournamentName, pageW / 2, 42, { align: 'center' });

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.setTextColor(...C.text);
            doc.text('Tournament Statistics Report', pageW / 2, 50, { align: 'center' });

            // ---- HEX BOARD ----
            const boardCenterX = pageW / 2;
            const boardCenterY = 118;
            const hexR = 4.8;
            const sqrt3 = Math.sqrt(3);
            const rot = 30 * Math.PI / 180;
            const cosR = Math.cos(rot);
            const sinR = Math.sin(rot);

            const mountainHeart = 'q0r0';
            const sideHearts = ['q-4r2', 'q-2r-2', 'q2r-4', 'q4r-2', 'q2r2', 'q-2r4'];
            const startingLocs = ['q0r-5', 'q5r-5', 'q5r0', 'q0r5', 'q-5r5', 'q-5r0'];

            const hexDefaultFill = [40, 44, 56];
            const hexStartFill = [55, 55, 65];
            const hexHeartFill = [130, 40, 55];
            const hexSideHeartFill = [120, 55, 75];
            const hexBorderColor = [24, 28, 40];

            function drawHex(cx, cy, r, fillRgb, strokeRgb) {
                const points = [];
                for (let i = 0; i < 6; i++) {
                    const angle = Math.PI / 3 * i + rot;
                    points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
                }
                doc.setFillColor(...fillRgb);
                doc.setDrawColor(...(strokeRgb || hexBorderColor));
                doc.setLineWidth(0.3);
                const deltas = [];
                for (let i = 1; i < points.length; i++) {
                    deltas.push([points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]]);
                }
                doc.lines(deltas, points[0][0], points[0][1], [1, 1], 'FD', true);
            }

            function drawHeartMarker(cx, cy, size, rgb) {
                doc.setFillColor(...rgb);
                doc.circle(cx, cy, size, 'F');
            }

            for (let q = -5; q <= 5; q++) {
                const r1 = Math.max(-5, -q - 5);
                const r2 = Math.min(5, -q + 5);
                for (let r = r1; r <= r2; r++) {
                    const coord = `q${q}r${r}`;
                    const px = hexR * (3 / 2) * q;
                    const py = hexR * sqrt3 * (r + q / 2);
                    const rx = px * cosR - py * sinR;
                    const ry = px * sinR + py * cosR;
                    const cx = boardCenterX + rx;
                    const cy = boardCenterY + ry;

                    let fill = hexDefaultFill;
                    const teamId = gameState.board?.[coord];
                    if (teamId && teamColorMap[teamId]) {
                        const tc = teamColorMap[teamId];
                        fill = [Math.round(tc[0] * 0.7 + 20), Math.round(tc[1] * 0.7 + 20), Math.round(tc[2] * 0.7 + 20)];
                    } else if (coord === mountainHeart) {
                        fill = hexHeartFill;
                    } else if (sideHearts.includes(coord)) {
                        fill = hexSideHeartFill;
                    } else if (startingLocs.includes(coord)) {
                        fill = hexStartFill;
                    }

                    drawHex(cx, cy, hexR * 0.92, fill, hexBorderColor);

                    if (coord === mountainHeart) {
                        drawHeartMarker(cx - 1.2, cy, 1.2, [255, 255, 255]);
                        drawHeartMarker(cx + 1.2, cy, 1.2, [255, 255, 255]);
                    } else if (sideHearts.includes(coord)) {
                        drawHeartMarker(cx, cy, 1.0, [255, 255, 255]);
                    }
                }
            }

            // ---- META INFO BELOW BOARD ----
            const metaY = boardCenterY + 58;
            doc.setFontSize(8);
            doc.setTextColor(...C.textMuted);
            const metaText = `Rounds: ${gameState.currentRound || 0}  |  Matches: ${history.length}  |  Players: ${Object.keys(gameState.players || {}).length}`;
            doc.text(metaText, pageW / 2, metaY, { align: 'center' });

            const genDate = `Generated: ${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
            doc.text(genDate, pageW / 2, metaY + 5, { align: 'center' });

            // ---- TEAMS WITH PLAYERS ----
            if (teams.length > 0) {
                const teamsY = metaY + 14;
                const colW = contentW / teams.length;
                teams.forEach((team, i) => {
                    const tx = margin + colW * i + colW / 2;
                    const rgb = teamColorMap[team.id] || C.textMuted;
                    doc.setFillColor(...rgb);
                    doc.circle(tx, teamsY, 2, 'F');
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(7.5);
                    doc.setTextColor(...rgb);
                    doc.text(team.name || 'Team', tx, teamsY + 5.5, { align: 'center' });
                    const teamPlayers = Object.values(gameState.players || {})
                        .filter(p => String(p.teamId) === String(team.id));
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(6.5);
                    doc.setTextColor(...C.text);
                    teamPlayers.forEach((player, j) => {
                        doc.text(player.name || 'Player', tx, teamsY + 10 + j * 4, { align: 'center' });
                    });
                });
            }

            doc.setFontSize(7);
            doc.setTextColor(...C.textDim);
            doc.text('BoardGame Tournament System', pageW / 2, pageH - 15, { align: 'center' });

            // ========================================================
            // PAGE 2: TEAM STANDINGS + SUMMARY + H2H
            // ========================================================
            if (progressText) progressText.textContent = 'Building team standings...';
            let y = addPage();
            y = sectionTitle(y, 'Team Standings');

            if (teams.length > 0) {
                // `points` already includes the +1 per match win; gamesWon is
                // a tiebreaker only, never part of the total (double-count).
                const sortedTeams = [...teams].sort((a, b) => {
                    const totalA = (a.points || 0);
                    const totalB = (b.points || 0);
                    if (totalB !== totalA) return totalB - totalA;
                    return (b.gamesWon || 0) - (a.gamesWon || 0);
                });

                const sortedTeamColors = sortedTeams.map(t => teamColorMap[t.id] || C.text);

                const standingsData = sortedTeams.map((team, i) => {
                    // `points` is the whole score (wins + heart income).
                    // Derive the split — each win is +1 — instead of summing
                    // two sources, which counted every win twice.
                    const totalPts = team.points || 0;
                    const victoryPts = Math.min(team.gamesWon || 0, totalPts);
                    const hexPts = Math.max(0, totalPts - victoryPts);
                    const wins = team.gamesWon || 0;
                    const losses = team.gamesLost || 0;
                    const played = team.gamesPlayed || (wins + losses);
                    const winRate = played > 0 ? ((wins / played) * 100).toFixed(0) + '%' : '0%';
                    const hexCount = Object.values(gameState.board || {}).filter(t => t === team.id).length;
                    return [String(i + 1), team.name || 'Team ' + team.id, String(totalPts), String(victoryPts), String(hexPts), `${wins}-${losses}`, winRate, String(hexCount)];
                });

                doc.autoTable({
                    startY: y,
                    margin: { left: margin, right: margin },
                    head: [['#', 'Team', 'Total', 'Wins', 'Hex Pts', 'W-L', 'Win %', 'Hexes']],
                    body: standingsData,
                    styles: { ...tableBase, fontSize: 9, cellPadding: 3.5 },
                    headStyles: { ...tableHeadBase, fontSize: 8 },
                    alternateRowStyles: tableAltRow,
                    columnStyles: {
                        0: { halign: 'center', cellWidth: 10 },
                        2: { halign: 'center', fontStyle: 'bold', textColor: C.goldBright },
                        3: { halign: 'center' }, 4: { halign: 'center' },
                        5: { halign: 'center' }, 6: { halign: 'center' }, 7: { halign: 'center' }
                    },
                    didParseCell: function(data) {
                        if (data.section === 'body' && data.column.index === 0) {
                            const rank = parseInt(data.cell.raw);
                            if (rank === 1) data.cell.styles.textColor = [255, 215, 0];
                            else if (rank === 2) data.cell.styles.textColor = [192, 192, 192];
                            else if (rank === 3) data.cell.styles.textColor = [205, 127, 50];
                        }
                        if (data.section === 'body' && data.column.index === 1) {
                            data.cell.styles.textColor = sortedTeamColors[data.row.index] || C.textBright;
                            data.cell.styles.fontStyle = 'bold';
                        }
                        if (data.section === 'body' && data.column.index === 6) {
                            const rate = parseWinRate(data.cell.raw);
                            data.cell.styles.textColor = wrColor(rate);
                            data.cell.styles.fontStyle = 'bold';
                        }
                    }
                });
                y = doc.lastAutoTable.finalY + 12;
            }

            // ---- TOURNAMENT SUMMARY ----
            y = sectionTitle(y, 'Tournament Summary');

            const pdfAllDurations = history
                .filter(m => m.matchDuration?.durationMinutes != null)
                .map(m => m.matchDuration.durationMinutes);
            const pdfDurations = pdfAllDurations.filter(d => d >= MIN_DURATION_MINUTES);
            const avgDuration = pdfDurations.length > 0
                ? Math.round(pdfDurations.reduce((a, b) => a + b, 0) / pdfDurations.length)
                : null;
            const challenges = history.filter(m => m.isChallenge).length;

            const summaryData = [
                [String(history.length), 'Total Matches'],
                [String(gameState.currentRound || 0), 'Total Rounds'],
                [avgDuration ? `${avgDuration}m` : 'N/A', avgDuration ? `Avg Duration (${pdfDurations.length}/${pdfAllDurations.length})` : 'Avg Duration'],
                [String(challenges), 'Challenges'],
                [String(Object.keys(gameState.players || {}).length), 'Players'],
                [String(teams.length), 'Teams']
            ];

            y = checkPage(y, 30);
            const boxW = (contentW - 10) / 3;
            const boxH = 18;
            const boxGap = 5;
            summaryData.forEach(([value, label], i) => {
                const col = i % 3;
                const row = Math.floor(i / 3);
                const bx = margin + col * (boxW + boxGap);
                const by = y + row * (boxH + boxGap);
                drawStatBox(bx, by, boxW, boxH, value, label);
            });
            y += 2 * (boxH + boxGap) + 6;

            // ---- HEAD-TO-HEAD MATRIX ----
            y = sectionTitle(y, 'Head-to-Head Records');

            if (teams.length > 0 && history.length > 0) {
                const h2h = {};
                teams.forEach(t1 => {
                    h2h[t1.id] = {};
                    teams.forEach(t2 => { h2h[t1.id][t2.id] = { wins: 0, losses: 0 }; });
                });
                history.forEach(match => {
                    const winners = match.winningTeamIds || [];
                    const losers = match.losingTeamIds || [];
                    winners.forEach(winnerId => {
                        losers.forEach(loserId => {
                            if (h2h[winnerId]?.[loserId]) h2h[winnerId][loserId].wins++;
                            if (h2h[loserId]?.[winnerId]) h2h[loserId][winnerId].losses++;
                        });
                    });
                });

                const h2hHead = [['', ...teams.map(t => t.name || 'T' + t.id)]];
                const h2hBody = teams.map(rowTeam => {
                    const row = [rowTeam.name || 'Team ' + rowTeam.id];
                    teams.forEach(colTeam => {
                        if (rowTeam.id === colTeam.id) row.push('-');
                        else {
                            const record = h2h[rowTeam.id][colTeam.id];
                            row.push(`${record.wins}-${record.losses}`);
                        }
                    });
                    return row;
                });

                doc.autoTable({
                    startY: y,
                    margin: { left: margin, right: margin },
                    head: h2hHead, body: h2hBody,
                    styles: { ...tableBase, fontSize: 8, halign: 'center' },
                    headStyles: tableHeadBase,
                    alternateRowStyles: tableAltRow,
                    columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
                    didParseCell: function(data) {
                        if (data.section === 'body' && data.column.index === 0) {
                            data.cell.styles.textColor = teamColorMap[teams[data.row.index]?.id] || C.textBright;
                        }
                        if (data.section === 'head' && data.column.index > 0) {
                            data.cell.styles.textColor = teamColorMap[teams[data.column.index - 1]?.id] || C.gold;
                        }
                        if (data.section === 'body' && data.column.index > 0) {
                            const cellText = data.cell.raw;
                            if (cellText === '-') {
                                data.cell.styles.textColor = C.textDim;
                            } else {
                                const parts = cellText.split('-').map(Number);
                                if (parts.length === 2) {
                                    if (parts[0] > parts[1]) data.cell.styles.textColor = C.win;
                                    else if (parts[0] < parts[1]) data.cell.styles.textColor = C.loss;
                                    else data.cell.styles.textColor = C.goldDim;
                                }
                            }
                        }
                    }
                });
                y = doc.lastAutoTable.finalY + 14;
            }

            // ========================================================
            // INDIVIDUAL PLAYER STATISTICS
            // ========================================================
            if (progressText) progressText.textContent = 'Building player statistics...';
            y = addPage();
            y = sectionTitle(y, 'Individual Player Statistics');

            if (playerStatsCache && Object.keys(playerStatsCache).length > 0) {
                const allPlayers = Object.values(playerStatsCache)
                    .filter(p => p.gamesPlayed > 0)
                    .sort((a, b) => {
                        const teamDiff = getTeamIndex(a.teamId) - getTeamIndex(b.teamId);
                        if (teamDiff !== 0) return teamDiff;
                        return b.wins - a.wins;
                    });

                const playerTableData = allPlayers.map((player, i) => {
                    const team = _getTeamById(gameState, player.teamId);
                    const winRate = player.gamesPlayed > 0 ? (player.winRate).toFixed(0) + '%' : '0%';
                    return [String(i + 1), player.name, team?.name || 'Unknown', String(player.gamesPlayed), String(player.wins), String(player.losses), winRate, String(player.bestWinStreak)];
                });

                const playerTeamColors = allPlayers.map(p => teamColorMap[p.teamId] || C.text);

                doc.autoTable({
                    startY: y,
                    margin: { left: margin, right: margin },
                    head: [['#', 'Player', 'Team', 'Games', 'Wins', 'Losses', 'Win %', 'Streak']],
                    body: playerTableData,
                    styles: { ...tableBase, cellPadding: 2.8 },
                    headStyles: tableHeadBase,
                    alternateRowStyles: tableAltRow,
                    columnStyles: {
                        0: { halign: 'center', cellWidth: 8 }, 1: { fontStyle: 'bold' },
                        3: { halign: 'center' }, 4: { halign: 'center', textColor: C.win },
                        5: { halign: 'center', textColor: C.loss }, 6: { halign: 'center' }, 7: { halign: 'center' }
                    },
                    didParseCell: function(data) {
                        if (data.section !== 'body') return;
                        const rowIdx = data.row.index;
                        const tc = playerTeamColors[rowIdx];
                        if (data.column.index === 1) data.cell.styles.textColor = tc;
                        if (data.column.index === 2) data.cell.styles.textColor = tc;
                        if (data.column.index === 0) {
                            const rank = parseInt(data.cell.raw);
                            if (rank === 1) data.cell.styles.textColor = [255, 215, 0];
                            else if (rank === 2) data.cell.styles.textColor = [192, 192, 192];
                            else if (rank === 3) data.cell.styles.textColor = [205, 127, 50];
                        }
                        if (data.column.index === 6) {
                            const rate = parseWinRate(data.cell.raw);
                            data.cell.styles.textColor = wrColor(rate);
                            data.cell.styles.fontStyle = 'bold';
                        }
                    }
                });
                y = doc.lastAutoTable.finalY + 12;

                // ---- DETAILED PLAYER CARDS ----
                if (progressText) progressText.textContent = 'Building detailed player profiles...';

                for (const player of allPlayers) {
                    y = addPage();
                    const team = _getTeamById(gameState, player.teamId);
                    const tc = teamColorMap[player.teamId] || C.gold;
                    y = playerHeader(y, player.name, team?.name || 'Unknown Team', tc);

                    const winRate = player.gamesPlayed > 0 ? player.winRate.toFixed(0) : '0';
                    const statsLine = [
                        `Games: ${player.gamesPlayed}`, `Wins: ${player.wins}`,
                        `Losses: ${player.losses}`, `Win Rate: ${winRate}%`,
                        `Best Streak: ${player.bestWinStreak}`
                    ].join('  |  ');
                    y = bodyText(y, statsLine);

                    if (player.avgDuration) {
                        y = bodyText(y, `Avg Match Duration: ${player.avgDuration} min (${player.durationDataPoints}/${player.durationTotalPoints} matches)`);
                    }
                    if (player.challenges.played > 0) {
                        y = bodyText(y, `Challenges: ${player.challenges.won}W - ${player.challenges.lost}L (${player.challenges.played} total)`);
                    }

                    // Performance by game
                    const gameEntries = Object.entries(player.byGame);
                    if (gameEntries.length > 0) {
                        y += 2;
                        const sortedPlayerGames = gameEntries.sort((a, b) => b[1].played - a[1].played);
                        const playerGameIds = sortedPlayerGames.map(([game]) => game);
                        const gameData = sortedPlayerGames.map(([game, stats]) => {
                            const wr = stats.played > 0 ? ((stats.won / stats.played) * 100).toFixed(0) + '%' : '0%';
                            return ['  ' + _getGameDisplayName(gameState, game), `${stats.won}-${stats.lost}`, wr];
                        });

                        doc.autoTable({
                            startY: y,
                            margin: { left: margin + 2, right: margin + 2 },
                            head: [['Game', 'W-L', 'Win %']],
                            body: gameData,
                            styles: subTableBase,
                            headStyles: subTableHead,
                            alternateRowStyles: { fillColor: [14, 17, 28] },
                            columnStyles: {
                                0: { cellPadding: { left: GAME_ICON_SIZE + 3, top: 2, right: 2, bottom: 2 } },
                                1: { halign: 'center' }, 2: { halign: 'center' }
                            },
                            tableWidth: contentW * 0.55,
                            didParseCell: winRateHook(2),
                            didDrawCell: gameIconCellHook(0, (rowIdx) => playerGameIds[rowIdx])
                        });
                        y = doc.lastAutoTable.finalY + 4;
                    }

                    // H2H vs opponents
                    const opponentEntries = Object.entries(player.vsOpponents).filter(([_, r]) => r.played > 0);
                    if (opponentEntries.length > 0) {
                        const h2hData = opponentEntries
                            .sort((a, b) => b[1].played - a[1].played)
                            .map(([opId, record]) => {
                                const opName = playerStatsCache[opId]?.name || 'Unknown';
                                const wr = record.played > 0 ? ((record.won / record.played) * 100).toFixed(0) + '%' : '0%';
                                return [opName, `${record.won}-${record.lost}`, wr];
                            });

                        doc.autoTable({
                            startY: y,
                            margin: { left: margin + 2, right: margin + 2 },
                            head: [['Opponent', 'W-L', 'Win %']],
                            body: h2hData,
                            styles: subTableBase,
                            headStyles: subTableHead,
                            alternateRowStyles: { fillColor: [14, 17, 28] },
                            columnStyles: { 0: {}, 1: { halign: 'center' }, 2: { halign: 'center' } },
                            tableWidth: contentW * 0.55,
                            didParseCell: function(data) {
                                if (data.section === 'body' && data.column.index === 2) {
                                    const rate = parseWinRate(data.cell.raw);
                                    data.cell.styles.textColor = wrColor(rate);
                                    data.cell.styles.fontStyle = 'bold';
                                }
                                if (data.section === 'body' && data.column.index === 0) {
                                    const opName = data.cell.raw;
                                    const opEntry = Object.values(playerStatsCache).find(p => p.name === opName);
                                    if (opEntry) {
                                        data.cell.styles.textColor = teamColorMap[opEntry.teamId] || C.text;
                                    }
                                }
                            }
                        });
                        y = doc.lastAutoTable.finalY + 4;
                    }
                }
            }

            // ========================================================
            // MATCH HISTORY
            // ========================================================
            if (progressText) progressText.textContent = 'Building match history...';
            y = addPage();
            y = sectionTitle(y, 'Match History');

            if (history.length > 0) {
                const sortedMatches = [...history].sort((a, b) =>
                    new Date(a.timestamp) - new Date(b.timestamp)
                );

                function pdfResolvePlayers(match, side) {
                    if (side === 'winners') {
                        if (match.winningPlayerIds?.length > 0)
                            return match.winningPlayerIds.map(id => _getPlayerNameById(gameState, id)).filter(n => n !== 'Unknown').join(', ');
                        if (match.winningPlayers?.length > 0)
                            return match.winningPlayers.map(p => p.name || '?').join(', ');
                        return (match.winningTeamIds || []).map(id => _getTeamName(gameState, id)).join(' & ');
                    } else {
                        if (match.losingPlayerIds?.length > 0)
                            return match.losingPlayerIds.map(id => _getPlayerNameById(gameState, id)).filter(n => n !== 'Unknown').join(', ');
                        if (match.losingPlayers?.length > 0)
                            return match.losingPlayers.map(p => p.name || '?').join(', ');
                        return (match.losingTeamIds || []).map(id => _getTeamName(gameState, id)).join(' & ');
                    }
                }

                function resolvePlayerColorList(playerIds, fallbackPlayers, teamIds) {
                    const results = [];
                    if (playerIds?.length > 0) {
                        playerIds.forEach(id => {
                            const player = _resolvePlayer(gameState, id);
                            const name = player?.name || _getPlayerNameById(gameState, id);
                            const color = player?.teamId ? (teamColorMap[player.teamId] || C.text) : C.text;
                            results.push({ name, color });
                        });
                    } else if (fallbackPlayers?.length > 0) {
                        fallbackPlayers.forEach(p => { results.push({ name: p.name || '?', color: C.text }); });
                    } else if (teamIds?.length > 0) {
                        teamIds.forEach(id => { results.push({ name: _getTeamName(gameState, id), color: teamColorMap[id] || C.text }); });
                    }
                    return results;
                }

                const matchPlayerColors = sortedMatches.map(match => ({
                    winners: resolvePlayerColorList(match.winningPlayerIds, match.winningPlayers, match.winningTeamIds),
                    losers: resolvePlayerColorList(match.losingPlayerIds, match.losingPlayers, match.losingTeamIds)
                }));

                const matchData = sortedMatches.map(match => {
                    function pdfFormatDT(ts) {
                        if (!ts) return '-';
                        const d = new Date(ts);
                        if (isNaN(d)) return '-';
                        const hh = String(d.getHours()).padStart(2, '0');
                        const mm = String(d.getMinutes()).padStart(2, '0');
                        const dd = String(d.getDate()).padStart(2, '0');
                        const mo = String(d.getMonth() + 1).padStart(2, '0');
                        return `${hh}:${mm} ${dd}.${mo}`;
                    }

                    const duration = match.matchDuration?.durationMinutes ? `${match.matchDuration.durationMinutes} min` : '-';
                    const startStr = pdfFormatDT(match.matchDuration?.startedAt);
                    const endStr = pdfFormatDT(match.matchDuration?.endedAt || match.timestamp);

                    return [
                        '#' + (match.id || match.matchNumber || '?'),
                        '  ' + _getGameDisplayName(gameState, match.game),
                        match.playType || '-',
                        pdfResolvePlayers(match, 'winners'),
                        pdfResolvePlayers(match, 'losers'),
                        duration,
                        startStr !== '-' ? startStr : '-',
                        endStr
                    ];
                });

                doc.autoTable({
                    startY: y,
                    margin: { left: margin, right: margin },
                    head: [['#', 'Game', 'Format', 'Winners', 'Losers', 'Min', 'Started', 'Ended']],
                    body: matchData,
                    styles: { ...tableBase, fontSize: 6.5, cellPadding: 2.2 },
                    headStyles: { ...tableHeadBase, fontSize: 6.5 },
                    alternateRowStyles: tableAltRow,
                    columnStyles: {
                        0: { cellWidth: 9, halign: 'center' },
                        1: { cellPadding: { left: GAME_ICON_SIZE + 3, top: 2.2, right: 2.2, bottom: 2.2 } },
                        2: { cellWidth: 12, halign: 'center' },
                        3: { fontSize: 6.5 },
                        5: { cellWidth: 11, halign: 'center' },
                        6: { cellWidth: 26, halign: 'center', fontSize: 6 },
                        7: { cellWidth: 26, halign: 'center', fontSize: 6 }
                    },
                    didParseCell: function(data) {
                        if (data.section !== 'body') return;
                        if (data.column.index === 3 || data.column.index === 4) {
                            data.cell.styles.textColor = data.cell.styles.fillColor || C.panel;
                        }
                    },
                    didDrawCell: function(data) {
                        if (data.section === 'body' && data.column.index === 1) {
                            const gameId = sortedMatches[data.row.index]?.game;
                            const iconData = gameIconMap[gameId];
                            if (iconData) {
                                const iconY = data.cell.y + (data.cell.height - GAME_ICON_SIZE) / 2;
                                doc.addImage(iconData, 'PNG', data.cell.x + 2, iconY, GAME_ICON_SIZE, GAME_ICON_SIZE);
                            }
                        }
                        if (data.section === 'body' && (data.column.index === 3 || data.column.index === 4)) {
                            const pc = matchPlayerColors[data.row.index];
                            const players = data.column.index === 3 ? pc?.winners : pc?.losers;
                            if (players?.length > 0) {
                                const fs = data.cell.styles.fontSize || 6.5;
                                doc.setFontSize(fs);
                                doc.setFont('helvetica', 'normal');
                                const padLeft = typeof data.cell.padding === 'function' ? data.cell.padding('left') : 2.2;
                                let curX = data.cell.x + padLeft;
                                const textY = data.cell.y + data.cell.height / 2 + fs * 0.353 / 2;
                                players.forEach((p, idx) => {
                                    doc.setTextColor(...p.color);
                                    doc.text(p.name, curX, textY);
                                    curX += doc.getTextWidth(p.name);
                                    if (idx < players.length - 1) {
                                        doc.setTextColor(...C.textMuted);
                                        doc.text(', ', curX, textY);
                                        curX += doc.getTextWidth(', ');
                                    }
                                });
                            }
                        }
                    }
                });
                y = doc.lastAutoTable.finalY + 14;
            }

            // ========================================================
            // GAME ANALYSIS
            // ========================================================
            y = addPage();
            y = sectionTitle(y, 'Game Analysis');

            if (history.length > 0) {
                const gameCounts = {};
                const gameDurations = {};
                history.forEach(match => {
                    const game = match.game || 'Unknown';
                    gameCounts[game] = (gameCounts[game] || 0) + 1;
                    if (match.matchDuration?.durationMinutes != null) {
                        gameDurations[game] = gameDurations[game] || [];
                        gameDurations[game].push(match.matchDuration.durationMinutes);
                    }
                });

                const sortedGameEntries = Object.entries(gameCounts).sort((a, b) => b[1] - a[1]);
                const gameAnalysisIds = sortedGameEntries.map(([game]) => game);
                const gameData = sortedGameEntries.map(([game, count]) => {
                    const allDur = gameDurations[game] || [];
                    const validDur = allDur.filter(d => d >= MIN_DURATION_MINUTES);
                    const avg = validDur.length > 0
                        ? Math.round(validDur.reduce((a, b) => a + b, 0) / validDur.length) + `m (${validDur.length}/${allDur.length})`
                        : '-';
                    const pct = ((count / history.length) * 100).toFixed(0) + '%';
                    return ['  ' + _getGameDisplayName(gameState, game), String(count), pct, avg];
                });

                doc.autoTable({
                    startY: y,
                    margin: { left: margin, right: margin },
                    head: [['Game', 'Matches', '% of Total', 'Avg Duration']],
                    body: gameData,
                    styles: { ...tableBase, fontSize: 9, cellPadding: 3.5 },
                    headStyles: { ...tableHeadBase, fontSize: 8 },
                    alternateRowStyles: tableAltRow,
                    columnStyles: {
                        0: { fontStyle: 'bold', textColor: C.textBright, cellPadding: { left: GAME_ICON_SIZE + 4, top: 3.5, right: 3.5, bottom: 3.5 } },
                        1: { halign: 'center', fontStyle: 'bold', textColor: C.goldBright },
                        2: { halign: 'center' }, 3: { halign: 'center' }
                    },
                    tableWidth: contentW * 0.75,
                    didDrawCell: gameIconCellHook(0, (rowIdx) => gameAnalysisIds[rowIdx])
                });

                y = doc.lastAutoTable.finalY + 3;
                doc.setFontSize(6.5);
                doc.setFont('helvetica', 'italic');
                doc.setTextColor(...C.textDim);
                doc.text(`* Avg duration counts only matches with ${MIN_DURATION_MINUTES}+ minutes playtime`, margin, y);
            }

            // ========================================================
            // FOOTER on all pages
            // ========================================================
            const totalPages = doc.internal.getNumberOfPages();
            for (let i = 1; i <= totalPages; i++) {
                doc.setPage(i);
                doc.setDrawColor(...C.borderGold);
                doc.setLineWidth(0.2);
                doc.line(margin + 20, pageH - 13, pageW - margin - 20, pageH - 13);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7);
                doc.setTextColor(...C.textMuted);
                doc.text(
                    `${tournamentName} — Tournament Statistics Report — Page ${i} of ${totalPages}`,
                    pageW / 2, pageH - 8, { align: 'center' }
                );
            }

            // Save
            if (progressText) progressText.textContent = 'Downloading PDF...';
            doc.save(`${(tournamentName || 'tournament').replace(/[^a-zA-Z0-9]/g, '_')}_statistics.pdf`);

            if (overlay) overlay.classList.add('hidden');
            if (typeof showToast === 'function') showToast('PDF generated successfully!', 'success');

        } catch (error) {
            console.error('PDF generation error:', error);
            if (overlay) overlay.classList.add('hidden');
            if (typeof showToast === 'function') showToast('Failed to generate PDF: ' + error.message, 'error');
        }
    }

    // Expose globally
    window.generatePDF = generatePDF;
    window.loadImageForPDF = loadImageForPDF;
})();
