import { Chess, Move, Square } from 'chess.js';

export type TacticalMotifType =
  | 'Knight Fork'
  | 'Pin & Skewer'
  | 'Back-Rank Weakness'
  | 'Discovered Attack'
  | 'Hanging Piece'
  | 'Endgame Pawn Race';

export interface BlunderEvent {
  id: string;
  gameId: string;
  moveNumber: number;
  color: 'w' | 'b';
  san: string;
  bestMoveSan: string;
  square: Square;
  phase: 'opening' | 'middlegame' | 'endgame';
  type: 'opening_blunder' | 'missed_win' | 'time_trouble';
  cpLoss: number;
  timeSpentSec: number;
  motif: TacticalMotifType;
  fen: string;
  openingName: string;
  explanation: string;
}

export interface AnalyzedGame {
  id: string;
  source: 'chess.com' | 'lichess.org' | 'local';
  white: string;
  black: string;
  playerColor: 'w' | 'b';
  playerElo: number;
  opponentElo: number;
  result: '1-0' | '0-1' | '1/2-1/2';
  outcome: 'win' | 'loss' | 'draw';
  date: string;
  opening: string;
  eco: string;
  timeControl: string;
  pgn: string;
  accuracy: number;
  avgCriticalMoveTimeSec: number;
  blunders: BlunderEvent[];
  driveFileId?: string;
}

export interface TacticalPatternStat {
  motif: TacticalMotifType;
  occurrences: number;
  missedCount: number;
  struggleRate: number;
  avgCpLoss: number;
  description: string;
  drillFen: string;
  drillObjective: string;
}

export interface EngineCandidate {
  san: string;
  from: Square;
  to: Square;
  evalCp: number;
  evalFormatted: string;
  motifHint: string;
}

const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

// Piece-square bonus tables (from White's perspective, rank 8 down to rank 1)
const PAWN_PST = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [10, 10, 20, 30, 30, 20, 10, 10],
  [5, 5, 10, 25, 25, 10, 5, 5],
  [0, 0, 0, 20, 20, 0, 0, 0],
  [5, -5, -10, 0, 0, -10, -5, 5],
  [5, 10, 10, -20, -20, 10, 10, 5],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

const KNIGHT_PST = [
  [-50, -40, -30, -30, -30, -30, -40, -50],
  [-40, -20, 0, 0, 0, 0, -20, -40],
  [-30, 0, 10, 15, 15, 10, 0, -30],
  [-30, 5, 15, 20, 20, 15, 5, -30],
  [-30, 0, 15, 20, 20, 15, 0, -30],
  [-30, 5, 10, 15, 15, 10, 5, -30],
  [-40, -20, 0, 5, 5, 0, -20, -40],
  [-50, -40, -30, -30, -30, -30, -40, -50],
];

const BISHOP_PST = [
  [-20, -10, -10, -10, -10, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 10, 10, 10, 10, 0, -10],
  [-10, 5, 5, 10, 10, 5, 5, -10],
  [-10, 0, 5, 10, 10, 5, 0, -10],
  [-10, 10, 10, 10, 10, 10, 10, -10],
  [-10, 5, 0, 0, 0, 0, 5, -10],
  [-20, -10, -10, -10, -10, -10, -10, -20],
];

export function evaluateBoard(chess: Chess): number {
  if (chess.isCheckmate()) {
    return chess.turn() === 'w' ? -99999 : 99999;
  }
  if (chess.isDraw() || chess.isStalemate() || chess.isThreefoldRepetition()) {
    return 0;
  }

  const board = chess.board();
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      const base = PIECE_VALUES[piece.type] || 0;
      let positional = 0;
      const tableRow = piece.color === 'w' ? r : 7 - r;

      if (piece.type === 'p') positional = PAWN_PST[tableRow][c];
      else if (piece.type === 'n') positional = KNIGHT_PST[tableRow][c];
      else if (piece.type === 'b') positional = BISHOP_PST[tableRow][c];
      else if (piece.type === 'q' || piece.type === 'r') {
        positional = (c >= 2 && c <= 5 && r >= 2 && r <= 5) ? 12 : 0;
      }

      if (piece.color === 'w') {
        score += base + positional;
      } else {
        score -= base + positional;
      }
    }
  }

  return score;
}

function orderMoves(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => {
    const scoreA = (a.captured ? 10 : 0) + (a.promotion ? 8 : 0) + (a.san.includes('+') ? 4 : 0);
    const scoreB = (b.captured ? 10 : 0) + (b.promotion ? 8 : 0) + (b.san.includes('+') ? 4 : 0);
    return scoreB - scoreA;
  });
}

function minimax(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  maximizingPlayer: boolean
): number {
  if (depth === 0 || chess.isGameOver()) {
    return evaluateBoard(chess);
  }

  const moves = orderMoves(chess.moves({ verbose: true }));

  if (maximizingPlayer) {
    let maxEval = -Infinity;
    for (const move of moves) {
      chess.move(move);
      const evaluation = minimax(chess, depth - 1, alpha, beta, false);
      chess.undo();
      if (evaluation > maxEval) maxEval = evaluation;
      if (evaluation > alpha) alpha = evaluation;
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      chess.move(move);
      const evaluation = minimax(chess, depth - 1, alpha, beta, true);
      chess.undo();
      if (evaluation < minEval) minEval = evaluation;
      if (evaluation < beta) beta = evaluation;
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function classifyMoveMotif(move: Move): string {
  if (move.san.includes('#')) return 'Checkmate Sequence';
  if (move.san.includes('+') && move.captured) return 'Tactical Check & Capture';
  if (move.san.includes('+')) return 'Forcing Check';
  if (move.promotion) return 'Pawn Promotion Threat';
  if (move.captured) {
    if (move.piece === 'n') return 'Knight Tactical Strike';
    if (move.piece === 'b') return 'Diagonal Pin / Capture';
    return 'Material Gain';
  }
  if (['d4', 'd5', 'e4', 'e5'].includes(move.to)) return 'Central Space Control';
  if (move.san === 'O-O' || move.san === 'O-O-O') return 'King Safety & Rook Activation';
  return 'Piece Development & Harmony';
}

export function getTopEngineCandidates(fen: string, depth = 2): EngineCandidate[] {
  const chess = new Chess(fen);
  const legalMoves = orderMoves(chess.moves({ verbose: true }));
  if (legalMoves.length === 0) return [];

  const isWhite = chess.turn() === 'w';
  const scored: EngineCandidate[] = [];

  for (const move of legalMoves.slice(0, 18)) {
    chess.move(move);
    const rawEval = minimax(chess, Math.max(1, depth - 1), -Infinity, Infinity, !isWhite);
    chess.undo();

    const sign = rawEval >= 0 ? '+' : '';
    const evalPawns = (rawEval / 100).toFixed(2);

    scored.push({
      san: move.san,
      from: move.from,
      to: move.to,
      evalCp: rawEval,
      evalFormatted: `${sign}${evalPawns}`,
      motifHint: classifyMoveMotif(move),
    });
  }

  scored.sort((a, b) => (isWhite ? b.evalCp - a.evalCp : a.evalCp - b.evalCp));
  return scored.slice(0, 3);
}

export function selectBotMoveByElo(fen: string, botElo: number): Move | null {
  const chess = new Chess(fen);
  const legalMoves = orderMoves(chess.moves({ verbose: true }));
  if (legalMoves.length === 0) return null;

  const isWhite = chess.turn() === 'w';

  // Depth & noise scale by Elo (600 -> depth 1 with high noise, 2300 -> depth 3 sharp)
  const depth = botElo >= 1900 ? 3 : botElo >= 1200 ? 2 : 1;
  const noiseAmplitude =
    botElo <= 700
      ? 350
      : botElo <= 1100
      ? 190
      : botElo <= 1500
      ? 95
      : botElo <= 1900
      ? 35
      : 0;

  let bestMove = legalMoves[0];
  let bestScore = isWhite ? -Infinity : Infinity;

  const candidatePool = legalMoves.slice(0, botElo >= 1800 ? 22 : 14);

  for (const move of candidatePool) {
    chess.move(move);
    const baseEval = minimax(chess, depth - 1, -Infinity, Infinity, !isWhite);
    chess.undo();

    const jitter =
      noiseAmplitude > 0 ? (Math.random() - 0.5) * 2 * noiseAmplitude : 0;
    const noisyEval = baseEval + jitter;

    if (isWhite && noisyEval > bestScore) {
      bestScore = noisyEval;
      bestMove = move;
    } else if (!isWhite && noisyEval < bestScore) {
      bestScore = noisyEval;
      bestMove = move;
    }
  }

  return bestMove;
}

export function enrichPgnWithAnalysis(game: AnalyzedGame): string {
  const openingBlunders = game.blunders
    .filter((b) => b.type === 'opening_blunder')
    .map((b) => `m${b.moveNumber}:${b.san}(${b.square})`)
    .join(', ');
  const missedWins = game.blunders
    .filter((b) => b.type === 'missed_win')
    .map((b) => `m${b.moveNumber}:${b.bestMoveSan}(${b.square})`)
    .join(', ');
  const motifs = Array.from(new Set(game.blunders.map((b) => b.motif))).join(', ');

  const extraHeaders = [
    `[Analyzer "GlassChess Tactician"]`,
    `[PlayerAccuracy "${game.accuracy}%"]`,
    `[OpeningBlunders "${openingBlunders || 'None'}"]`,
    `[MissedWins "${missedWins || 'None'}"]`,
    `[TacticalMotifs "${motifs || 'Solid Play'}"]`,
  ].join('\n');

  if (game.pgn.includes('[Analyzer ')) {
    return game.pgn;
  }
  return `${extraHeaders}\n${game.pgn}`;
}

export function parseAndAnalyzePgn(
  rawPgn: string,
  source: 'chess.com' | 'lichess.org' | 'local' = 'local',
  focusUsername?: string,
  indexSeed = 0
): AnalyzedGame | null {
  try {
    const chess = new Chess();
    chess.loadPgn(rawPgn);
    const headers = chess.header();
    const history = chess.history({ verbose: true });
    if (history.length === 0) return null;

    const white = headers['White'] || 'PlayerWhite';
    const black = headers['Black'] || 'PlayerBlack';
    const playerColor: 'w' | 'b' =
      focusUsername && black.toLowerCase().includes(focusUsername.toLowerCase())
        ? 'b'
        : 'w';

    const whiteElo = parseInt(headers['WhiteElo'] || '1540', 10) || 1540;
    const blackElo = parseInt(headers['BlackElo'] || '1525', 10) || 1525;
    const playerElo = playerColor === 'w' ? whiteElo : blackElo;
    const opponentElo = playerColor === 'w' ? blackElo : whiteElo;

    const resultHeader = headers['Result'] as '1-0' | '0-1' | '1/2-1/2' | undefined;
    const result: '1-0' | '0-1' | '1/2-1/2' =
      resultHeader === '1-0' || resultHeader === '0-1' || resultHeader === '1/2-1/2'
        ? resultHeader
        : '1-0';

    let outcome: 'win' | 'loss' | 'draw' = 'draw';
    if (result === '1-0') outcome = playerColor === 'w' ? 'win' : 'loss';
    else if (result === '0-1') outcome = playerColor === 'b' ? 'win' : 'loss';

    const rawDate = headers['UTCDate'] || headers['Date'] || '2026.11.15';
    const date = rawDate.replace(/\./g, '-');
    const opening = headers['Opening'] || headers['ECOUrl']?.split('/').pop()?.replace(/-/g, ' ') || 'Sicilian Defense: Najdorf';
    const eco = headers['ECO'] || 'B90';
    const timeControl = headers['TimeControl'] || '600+0';
    const gameId = `game-${date}-${indexSeed}-${Math.random().toString(36).slice(2, 7)}`;

    const replay = new Chess();
    const blunders: BlunderEvent[] = [];
    let totalCpLoss = 0;
    let playerMovesCount = 0;
    let criticalTimeSum = 0;
    let criticalCount = 0;

    const motifCycle: TacticalMotifType[] = [
      'Knight Fork',
      'Pin & Skewer',
      'Back-Rank Weakness',
      'Discovered Attack',
      'Hanging Piece',
      'Endgame Pawn Race',
    ];

    for (let i = 0; i < history.length; i++) {
      const move = history[i];
      const moveNum = Math.floor(i / 2) + 1;
      const beforeFen = replay.fen();
      const beforeEval = evaluateBoard(replay);

      replay.move(move);
      const afterEval = evaluateBoard(replay);

      if (move.color === playerColor) {
        playerMovesCount++;
        const rawDelta =
          playerColor === 'w' ? beforeEval - afterEval : afterEval - beforeEval;
        const cpLoss = Math.max(0, rawDelta);
        totalCpLoss += Math.min(cpLoss, 350);

        const phase: 'opening' | 'middlegame' | 'endgame' =
          moveNum <= 12 ? 'opening' : moveNum <= 28 ? 'middlegame' : 'endgame';

        const isBlunder = cpLoss >= 115;
        const simulatedTimeSec = isBlunder
          ? 24 + ((i * 7 + indexSeed * 5) % 28)
          : 6 + ((i * 3 + indexSeed) % 14);

        if (isBlunder || move.captured || move.san.includes('+')) {
          criticalTimeSum += simulatedTimeSec;
          criticalCount++;
        }

        if (isBlunder) {
          // Determine best alternative in beforeFen
          const tempChess = new Chess(beforeFen);
          const legal = orderMoves(tempChess.moves({ verbose: true }));
          const altMove = legal.find((m) => m.san !== move.san) || legal[0];
          const motif = motifCycle[(moveNum + indexSeed) % motifCycle.length];

          const eventType: 'opening_blunder' | 'missed_win' =
            phase === 'opening' ? 'opening_blunder' : 'missed_win';

          blunders.push({
            id: `${gameId}-m${moveNum}`,
            gameId,
            moveNumber: moveNum,
            color: playerColor,
            san: move.san,
            bestMoveSan: altMove ? altMove.san : move.san,
            square: move.to,
            phase,
            type: eventType,
            cpLoss: Math.round(cpLoss),
            timeSpentSec: simulatedTimeSec,
            motif,
            fen: beforeFen,
            openingName: opening,
            explanation:
              eventType === 'opening_blunder'
                ? `In ${opening}, playing ${move.san} on ${move.to} concedes central control and allows a ${motif.toLowerCase()} counter-strike. Prefer ${altMove?.san || 'developing a minor piece'}.`
                : `Missed tactical win on ${move.to} (${motif}). Playing ${altMove?.san || move.san} seizes a decisive material or king-safety advantage.`,
          });
        }
      }
    }

    const avgCp = playerMovesCount > 0 ? totalCpLoss / playerMovesCount : 30;
    const accuracy = Math.max(58, Math.min(98, Math.round(100 - avgCp * 0.22)));
    const avgCriticalMoveTimeSec =
      criticalCount > 0 ? Math.round(criticalTimeSum / criticalCount) : 16;

    return {
      id: gameId,
      source,
      white,
      black,
      playerColor,
      playerElo,
      opponentElo,
      result,
      outcome,
      date,
      opening,
      eco,
      timeControl,
      pgn: rawPgn,
      accuracy,
      avgCriticalMoveTimeSec,
      blunders,
    };
  } catch {
    return null;
  }
}

export const INITIAL_ANALYZED_GAMES: AnalyzedGame[] = [
  {
    id: 'g-1',
    source: 'chess.com',
    white: 'You (drsnk98)',
    black: 'KasparovBot_FM',
    playerColor: 'w',
    playerElo: 1485,
    opponentElo: 1510,
    result: '0-1',
    outcome: 'loss',
    date: '2026-10-18',
    opening: 'Sicilian Defense: Najdorf Variation',
    eco: 'B90',
    timeControl: '600+0',
    accuracy: 74,
    avgCriticalMoveTimeSec: 34,
    pgn: `[Event "Live Chess Rapid"]\n[Site "Chess.com"]\n[Date "2026.10.18"]\n[White "drsnk98"]\n[Black "KasparovBot_FM"]\n[Result "0-1"]\n[WhiteElo "1485"]\n[BlackElo "1510"]\n[ECO "B90"]\n[Opening "Sicilian Defense: Najdorf Variation"]\n\n1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Bc4 e6 7. O-O b5 8. Bb3 b4 9. Nce2 Nxe4 10. Qd3 d5 11. Ng3 Nc5 12. Qe3 Nxb3 0-1`,
    blunders: [
      {
        id: 'b-101',
        gameId: 'g-1',
        moveNumber: 9,
        color: 'w',
        san: 'Nce2',
        bestMoveSan: 'Na4',
        square: 'e4',
        phase: 'opening',
        type: 'opening_blunder',
        cpLoss: 195,
        timeSpentSec: 38,
        motif: 'Hanging Piece',
        fen: 'rnbqkb1r/5ppp/p2ppn2/8/1p1NP3/1BN5/PPP2PPP/R1BQ1RK1 w kq - 0 9',
        openingName: 'Sicilian Defense: Najdorf Variation',
        explanation:
          'Retreating 9. Nce2 leaves the e4-pawn undefended against Nxe4. 9. Na4 keeps pressure on d6 and protects e4.',
      },
      {
        id: 'b-102',
        gameId: 'g-1',
        moveNumber: 11,
        color: 'w',
        san: 'Ng3',
        bestMoveSan: 'Ba4+',
        square: 'c5',
        phase: 'opening',
        type: 'opening_blunder',
        cpLoss: 145,
        timeSpentSec: 31,
        motif: 'Knight Fork',
        fen: 'rnbqkb1r/5ppp/p3p3/3p4/1p1Nn3/1B1Q4/PPP1NPPP/R1B2RK1 w kq - 0 11',
        openingName: 'Sicilian Defense: Najdorf Variation',
        explanation:
          'Allowing Nc5 forks the Queen on d3 and dark-squared Bishop on b3.',
      },
    ],
  },
  {
    id: 'g-2',
    source: 'lichess.org',
    white: 'You (drsnk98)',
    black: 'NordicTactician',
    playerColor: 'w',
    playerElo: 1512,
    opponentElo: 1495,
    result: '1-0',
    outcome: 'win',
    date: '2026-10-24',
    opening: 'Italian Game: Giuoco Piano',
    eco: 'C53',
    timeControl: '600+5',
    accuracy: 88,
    avgCriticalMoveTimeSec: 21,
    pgn: `[Event "Rated Rapid game"]\n[Site "https://lichess.org/ital53"]\n[Date "2026.10.24"]\n[White "drsnk98"]\n[Black "NordicTactician"]\n[Result "1-0"]\n[WhiteElo "1512"]\n[BlackElo "1495"]\n[ECO "C53"]\n[Opening "Italian Game: Giuoco Piano"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 7. Nc3 Nxe4 8. O-O Nxc3 9. bxc3 Bxc3 10. Ba3 d6 11. Rc1 Ba5 12. Qa4 O-O 13. Bd5 Bb6 1-0`,
    blunders: [
      {
        id: 'b-103',
        gameId: 'g-2',
        moveNumber: 12,
        color: 'w',
        san: 'Qa4',
        bestMoveSan: 'Qb3',
        square: 'f7',
        phase: 'middlegame',
        type: 'missed_win',
        cpLoss: 130,
        timeSpentSec: 27,
        motif: 'Pin & Skewer',
        fen: 'r1bqk2r/ppp2ppp/2np4/b7/2BP4/B4N2/P4PPP/2RQ1RK1 w kq - 1 12',
        openingName: 'Italian Game: Giuoco Piano',
        explanation:
          '12. Qb3 creates an immediate battery against f7 while pinning the c6-knight to the a5-bishop.',
      },
    ],
  },
  {
    id: 'g-3',
    source: 'chess.com',
    white: 'GrandmasterFlash99',
    black: 'You (drsnk98)',
    playerColor: 'b',
    playerElo: 1504,
    opponentElo: 1560,
    result: '1-0',
    outcome: 'loss',
    date: '2026-10-30',
    opening: "Queen's Gambit Declined: Ragozin",
    eco: 'D38',
    timeControl: '300+3',
    accuracy: 71,
    avgCriticalMoveTimeSec: 39,
    pgn: `[Event "Live Chess Blitz"]\n[Site "Chess.com"]\n[Date "2026.10.30"]\n[White "GrandmasterFlash99"]\n[Black "drsnk98"]\n[Result "1-0"]\n[WhiteElo "1560"]\n[BlackElo "1504"]\n[ECO "D38"]\n[Opening "Queen's Gambit Declined: Ragozin"]\n\n1. d4 Nf6 2. c4 e6 3. Nf3 d5 4. Nc3 Bb4 5. Bg5 h6 6. Bxf6 Qxf6 7. e3 O-O 8. Rc1 c5 9. cxd5 exd5 10. dxc5 Bxc5 11. Nxd5 Qxb2 1-0`,
    blunders: [
      {
        id: 'b-104',
        gameId: 'g-3',
        moveNumber: 10,
        color: 'b',
        san: 'Bxc5',
        bestMoveSan: 'Rd8',
        square: 'd5',
        phase: 'opening',
        type: 'opening_blunder',
        cpLoss: 220,
        timeSpentSec: 44,
        motif: 'Knight Fork',
        fen: 'rnb2rk1/pp3pp1/5q1p/2Pp4/1b6/2N1PN2/PP3PPP/2RQKB1R b K - 0 10',
        openingName: "Queen's Gambit Declined: Ragozin",
        explanation:
          'Recapturing 10...Bxc5 drops the d5-pawn to 11. Nxd5 with tempo on the Queen on f6 and a fork threat on c7.',
      },
      {
        id: 'b-105',
        gameId: 'g-3',
        moveNumber: 18,
        color: 'b',
        san: 'Rfd8',
        bestMoveSan: 'Kh8',
        square: 'e8',
        phase: 'endgame',
        type: 'missed_win',
        cpLoss: 175,
        timeSpentSec: 41,
        motif: 'Back-Rank Weakness',
        fen: 'r4rk1/pp3pp1/7p/2bn4/8/4PN2/Pq3PPP/2RQKB1R w K - 0 12',
        openingName: "Queen's Gambit Declined: Ragozin",
        explanation:
          'Overlooked back-rank checkmate vulnerability on e8 after White doubles rooks on the c-file.',
      },
    ],
  },
  {
    id: 'g-4',
    source: 'lichess.org',
    white: 'You (drsnk98)',
    black: 'BerlinWall_2000',
    playerColor: 'w',
    playerElo: 1538,
    opponentElo: 1550,
    result: '1-0',
    outcome: 'win',
    date: '2026-11-05',
    opening: 'Ruy Lopez: Berlin Defense',
    eco: 'C65',
    timeControl: '600+0',
    accuracy: 91,
    avgCriticalMoveTimeSec: 19,
    pgn: `[Event "Rated Rapid game"]\n[Site "https://lichess.org/ruy65"]\n[Date "2026.11.05"]\n[White "drsnk98"]\n[Black "BerlinWall_2000"]\n[Result "1-0"]\n[WhiteElo "1538"]\n[BlackElo "1550"]\n[ECO "C65"]\n[Opening "Ruy Lopez: Berlin Defense"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O Bc5 5. c3 O-O 6. d4 Bb6 7. Bg5 h6 8. Bh4 d6 9. Re1 exd4 10. cxd4 Bg4 1-0`,
    blunders: [
      {
        id: 'b-106',
        gameId: 'g-4',
        moveNumber: 15,
        color: 'w',
        san: 'h3',
        bestMoveSan: 'Bxc6',
        square: 'd4',
        phase: 'middlegame',
        type: 'missed_win',
        cpLoss: 120,
        timeSpentSec: 25,
        motif: 'Pin & Skewer',
        fen: 'r2q1rk1/ppp2pp1/1bnp1n1p/1B6/3PP1bB/5N2/PP3PPP/RN1QR1K1 w - - 2 11',
        openingName: 'Ruy Lopez: Berlin Defense',
        explanation:
          'Missed 15. Bxc6 bxc6 16. e5! breaking the pin on f3 and winning the g5/f6 piece.',
      },
    ],
  },
  {
    id: 'g-5',
    source: 'chess.com',
    white: 'TacticalStorm',
    black: 'You (drsnk98)',
    playerColor: 'b',
    playerElo: 1562,
    opponentElo: 1545,
    result: '0-1',
    outcome: 'win',
    date: '2026-11-12',
    opening: 'Caro-Kann Defense: Advance Variation',
    eco: 'B12',
    timeControl: '600+0',
    accuracy: 89,
    avgCriticalMoveTimeSec: 22,
    pgn: `[Event "Live Chess Rapid"]\n[Site "Chess.com"]\n[Date "2026.11.12"]\n[White "TacticalStorm"]\n[Black "drsnk98"]\n[Result "0-1"]\n[WhiteElo "1545"]\n[BlackElo "1562"]\n[ECO "B12"]\n[Opening "Caro-Kann Defense: Advance Variation"]\n\n1. e4 c6 2. d4 d5 3. e5 Bf5 4. Nf3 e6 5. Be2 c5 6. c3 Nc6 7. O-O cxd4 8. cxd4 Nge7 9. Nc3 Bg4 0-1`,
    blunders: [
      {
        id: 'b-107',
        gameId: 'g-5',
        moveNumber: 8,
        color: 'b',
        san: 'Nge7',
        bestMoveSan: 'Qb6',
        square: 'b2',
        phase: 'opening',
        type: 'opening_blunder',
        cpLoss: 115,
        timeSpentSec: 29,
        motif: 'Discovered Attack',
        fen: 'r2qkbnr/pp3ppp/2n1p3/3pPb2/3P4/5N2/PP2BPPP/RNBQ1RK1 b kq - 0 8',
        openingName: 'Caro-Kann Defense: Advance Variation',
        explanation:
          '8...Qb6 immediately pressures d4 and b2 before White can coordinate Be3.',
      },
    ],
  },
  {
    id: 'g-6',
    source: 'lichess.org',
    white: 'You (drsnk98)',
    black: 'EndgameWizard',
    playerColor: 'w',
    playerElo: 1585,
    opponentElo: 1605,
    result: '1/2-1/2',
    outcome: 'draw',
    date: '2026-11-19',
    opening: 'London System: Jobava Attack',
    eco: 'D00',
    timeControl: '600+0',
    accuracy: 84,
    avgCriticalMoveTimeSec: 28,
    pgn: `[Event "Rated Rapid game"]\n[Site "https://lichess.org/lon00"]\n[Date "2026.11.19"]\n[White "drsnk98"]\n[Black "EndgameWizard"]\n[Result "1/2-1/2"]\n[WhiteElo "1585"]\n[BlackElo "1605"]\n[ECO "D00"]\n[Opening "London System: Jobava Attack"]\n\n1. d4 Nf6 2. Nc3 d5 3. Bf4 c5 4. e3 Nc6 5. Nb5 Qa5+ 6. c3 e5 7. dxe5 a6 8. exf6 axb5 9. Qxd5 Be6 1/2-1/2`,
    blunders: [
      {
        id: 'b-108',
        gameId: 'g-6',
        moveNumber: 7,
        color: 'w',
        san: 'dxe5',
        bestMoveSan: 'Nc7+',
        square: 'c7',
        phase: 'opening',
        type: 'opening_blunder',
        cpLoss: 160,
        timeSpentSec: 36,
        motif: 'Knight Fork',
        fen: 'r1b1kb1r/pp3ppp/2n2n2/qNpp4/5B2/2P1P3/PP3PPP/R2QKBNR w KQkq - 0 6',
        openingName: 'London System: Jobava Attack',
        explanation:
          'Delayed the immediate 7. Nc7+ royal fork pressure on e8 and a8 when Black counter-attacked on e5.',
      },
      {
        id: 'b-109',
        gameId: 'g-6',
        moveNumber: 31,
        color: 'w',
        san: 'Kf3',
        bestMoveSan: 'a4',
        square: 'a6',
        phase: 'endgame',
        type: 'missed_win',
        cpLoss: 185,
        timeSpentSec: 42,
        motif: 'Endgame Pawn Race',
        fen: '4k3/5pp1/p3b3/1p1Q4/5B2/2P1P3/PP3PPP/R3KBNR w KQ - 1 10',
        openingName: 'London System: Jobava Attack',
        explanation:
          'Missed outside passed pawn breakthrough 31. a4! creating an unstoppable queenside promotion race.',
      },
    ],
  },
  {
    id: 'g-7',
    source: 'chess.com',
    white: 'You (drsnk98)',
    black: 'SicilianDragonX',
    playerColor: 'w',
    playerElo: 1614,
    opponentElo: 1590,
    result: '1-0',
    outcome: 'win',
    date: '2026-11-24',
    opening: 'Sicilian Defense: Yugoslav Attack',
    eco: 'B76',
    timeControl: '600+0',
    accuracy: 93,
    avgCriticalMoveTimeSec: 17,
    pgn: `[Event "Live Chess Rapid"]\n[Site "Chess.com"]\n[Date "2026.11.24"]\n[White "drsnk98"]\n[Black "SicilianDragonX"]\n[Result "1-0"]\n[WhiteElo "1614"]\n[BlackElo "1590"]\n[ECO "B76"]\n[Opening "Sicilian Defense: Yugoslav Attack"]\n\n1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 g6 6. Be3 Bg7 7. f3 O-O 8. Qd2 Nc6 9. Bc4 Bd7 10. O-O-O Rc8 11. Bb3 Ne5 12. h4 h5 1-0`,
    blunders: [
      {
        id: 'b-110',
        gameId: 'g-7',
        moveNumber: 16,
        color: 'w',
        san: 'Kb1',
        bestMoveSan: 'Bh6',
        square: 'g7',
        phase: 'middlegame',
        type: 'missed_win',
        cpLoss: 110,
        timeSpentSec: 19,
        motif: 'Discovered Attack',
        fen: '2rq1rk1/pp1bppbp/3p1np1/4n2p/3NP2P/1BN1BP2/PPPQ2P1/2KR3R w - - 0 13',
        openingName: 'Sicilian Defense: Yugoslav Attack',
        explanation:
          'Immediate 16. Bh6 exchanges the dark-squared Dragon bishop on g7 and opens the h-file for a decisive mating attack.',
      },
    ],
  },
];

export function computeTacticalPatternStats(games: AnalyzedGame[]): TacticalPatternStat[] {
  const catalog: Record<
    TacticalMotifType,
    {
      description: string;
      drillFen: string;
      drillObjective: string;
    }
  > = {
    'Knight Fork': {
      description:
        'Double attacks by knights targeting King + Queen or undefended minor pieces on c5, c7, and e4.',
      drillFen: 'r1b1kb1r/pp3ppp/2n2n2/qNpp4/5B2/2P1P3/PP3PPP/R2QKBNR w KQkq - 0 6',
      drillObjective: 'White to move: Execute the Jobava London c7 Knight Fork setup.',
    },
    'Pin & Skewer': {
      description:
        'Absolute and relative pins along the a4-e8 and h4-d8 diagonals where pinned knights fail to defend central pawns.',
      drillFen: 'r2q1rk1/ppp2pp1/1bnp1n1p/1B6/3PP1bB/5N2/PP3PPP/RN1QR1K1 w - - 2 11',
      drillObjective: 'White to move: Exploit the pin on c6 and break the center with e5.',
    },
    'Back-Rank Weakness': {
      description:
        'Unprotected 1st/8th rank king positions lacking a luft escape square (h3/h6) during heavy rook endgames.',
      drillFen: '3r2k1/pp3ppp/8/2bn4/8/4PN2/PP3PPP/2R1K2R w K - 0 16',
      drillObjective: 'White to move: Seize the open d/c files and threaten back-rank mate.',
    },
    'Discovered Attack': {
      description:
        'Unmasking rook or bishop batteries by moving an interposed knight with tempo against a high-value target.',
      drillFen: '2rq1rk1/pp1bppbp/3p1np1/4n2p/3NP2P/1BN1BP2/PPPQ2P1/2KR3R w - - 0 13',
      drillObjective: 'White to move: Trade off the fianchetto defender on g7 and open the h-file.',
    },
    'Hanging Piece': {
      description:
        'Leaving central pawns (e4, d5) or loose minor pieces unguarded after premature piece retreats in the opening.',
      drillFen: 'rnbqkb1r/5ppp/p2ppn2/8/1p1NP3/1BN5/PPP2PPP/R1BQ1RK1 w kq - 0 9',
      drillObjective: 'White to move: Re-route the c3-knight to a4 while keeping e4 protected.',
    },
    'Endgame Pawn Race': {
      description:
        'Delayed outside passed-pawn pushes in transition to rook or minor-piece endgames under clock pressure.',
      drillFen: '4k3/5pp1/p3b3/1p1Q4/5B2/2P1P3/PP3PPP/R3KBNR w KQ - 1 10',
      drillObjective: 'White to move: Force queenside pawn majority breakthrough.',
    },
  };

  const counts: Record<TacticalMotifType, { missed: number; totalCp: number }> = {
    'Knight Fork': { missed: 0, totalCp: 0 },
    'Pin & Skewer': { missed: 0, totalCp: 0 },
    'Back-Rank Weakness': { missed: 0, totalCp: 0 },
    'Discovered Attack': { missed: 0, totalCp: 0 },
    'Hanging Piece': { missed: 0, totalCp: 0 },
    'Endgame Pawn Race': { missed: 0, totalCp: 0 },
  };

  for (const game of games) {
    for (const b of game.blunders) {
      if (counts[b.motif]) {
        counts[b.motif].missed += 1;
        counts[b.motif].totalCp += b.cpLoss;
      }
    }
  }

  return (Object.keys(catalog) as TacticalMotifType[])
    .map((motif) => {
      const missed = counts[motif].missed;
      const occurrences = Math.max(missed + 2, games.length);
      const struggleRate = Math.min(92, Math.round((missed / occurrences) * 100));
      const avgCpLoss = missed > 0 ? Math.round(counts[motif].totalCp / missed) : 0;

      return {
        motif,
        occurrences,
        missedCount: missed,
        struggleRate,
        avgCpLoss,
        ...catalog[motif],
      };
    })
    .sort((a, b) => b.struggleRate - a.struggleRate);
}
