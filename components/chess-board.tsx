'use client';

import React from 'react';
import { Square } from 'chess.js';
import { BlunderEvent } from '@/lib/chess-engine';

interface BoardPiece {
  type: string;
  color: 'w' | 'b';
}

interface ChessBoardProps {
  board: (BoardPiece | null)[][];
  flipped?: boolean;
  selectedSquare: Square | null;
  legalDestinations: Square[];
  lastMove: { from: Square; to: Square } | null;
  coachSuggestedMove?: { from?: Square; to?: Square; san?: string } | null;
  onSquareClick: (square: Square) => void;
  heatmapMode?: 'none' | 'opening_blunder' | 'missed_win' | 'all';
  blunderEvents?: BlunderEvent[];
  inspectedSquare?: Square | null;
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

const PIECE_SYMBOLS: Record<string, string> = {
  wp: '♙\uFE0E',
  wn: '♘\uFE0E',
  wb: '♗\uFE0E',
  wr: '♖\uFE0E',
  wq: '♕\uFE0E',
  wk: '♔\uFE0E',
  bp: '♙\uFE0E',
  bn: '♘\uFE0E',
  bb: '♗\uFE0E',
  br: '♖\uFE0E',
  bq: '♕\uFE0E',
  bk: '♔\uFE0E',
};

export function playChessSound(type: 'move' | 'capture' | 'check' | 'victory') {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'move') {
      osc.frequency.setValueAtTime(320, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'capture') {
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.setValueAtTime(160, now + 0.04);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'check') {
      osc.frequency.setValueAtTime(580, now);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
    } else if (type === 'victory') {
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554, now + 0.1);
      osc.frequency.setValueAtTime(659, now + 0.2);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    }
  } catch {
    // Ignore audio context restriction errors
  }
}

export const ChessBoard: React.FC<ChessBoardProps> = ({
  board,
  flipped = false,
  selectedSquare,
  legalDestinations,
  lastMove,
  coachSuggestedMove,
  onSquareClick,
  heatmapMode = 'none',
  blunderEvents = [],
  inspectedSquare = null,
}) => {
  const rowIndices = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const colIndices = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  // Aggregate heatmap counts by square
  const squareEventsMap: Record<string, BlunderEvent[]> = {};
  if (heatmapMode !== 'none') {
    for (const ev of blunderEvents) {
      if (heatmapMode === 'all' || ev.type === heatmapMode) {
        if (!squareEventsMap[ev.square]) squareEventsMap[ev.square] = [];
        squareEventsMap[ev.square].push(ev);
      }
    }
  }

  return (
    <div className="w-full max-w-[min(100%,44vh)] sm:max-w-[min(100%,52vh)] landscape:max-w-[min(100%,60vh)] lg:max-w-[490px] mx-auto select-none">
      <div className="liquid-glass-strong p-2 sm:p-3 rounded-2xl">
        <div
          className="grid grid-cols-8 aspect-square w-full rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700"
          role="grid"
          aria-label="Interactive Chessboard"
        >
          {rowIndices.map((r) =>
            colIndices.map((c) => {
              const sq = `${FILES[c]}${RANKS[r]}` as Square;
              const isLight = (r + c) % 2 === 0;
              const piece = board[r]?.[c] || null;
              const isSelected = selectedSquare === sq;
              const isLegalDest = legalDestinations.includes(sq);
              const isLastMove = lastMove?.from === sq || lastMove?.to === sq;
              const isCoachFrom = coachSuggestedMove?.from === sq;
              const isCoachTo = coachSuggestedMove?.to === sq;
              const isInspected = inspectedSquare === sq;

              const heatEvents = squareEventsMap[sq] || [];
              const heatCount = heatEvents.length;
              const totalCpLoss = heatEvents.reduce((acc, e) => acc + e.cpLoss, 0);

              let baseBg = isLight
                ? 'bg-slate-200/90 dark:bg-slate-700/75'
                : 'bg-slate-400/75 dark:bg-slate-900/90';

              if (isSelected) {
                baseBg = 'bg-sky-500/45 dark:bg-sky-500/50';
              } else if (isCoachTo || isCoachFrom) {
                baseBg = 'bg-emerald-500/35 dark:bg-emerald-500/40';
              } else if (isLastMove) {
                baseBg = 'bg-amber-400/35 dark:bg-amber-500/30';
              }

              // Heatmap solid overlay colors (zero gradients, explicit numeric badges)
              let heatOverlayClass = '';
              if (heatmapMode !== 'none' && heatCount > 0) {
                const hasOpeningBlunder = heatEvents.some((e) => e.type === 'opening_blunder');
                if (hasOpeningBlunder) {
                  heatOverlayClass =
                    heatCount >= 2
                      ? 'bg-rose-600/85 text-white'
                      : 'bg-rose-500/70 text-white';
                } else {
                  heatOverlayClass =
                    heatCount >= 2
                      ? 'bg-amber-600/85 text-white'
                      : 'bg-amber-500/75 text-slate-950';
                }
              }

              return (
                <button
                  key={sq}
                  type="button"
                  onClick={() => onSquareClick(sq)}
                  aria-label={`Square ${sq}${piece ? ` with ${piece.color === 'w' ? 'White' : 'Black'} ${piece.type}` : ''}${heatCount > 0 ? `, ${heatCount} critical events` : ''}`}
                  className={`relative flex items-center justify-center w-full h-full aspect-square transition-transform duration-100 focus-visible:outline-2 focus-visible:outline-sky-500 ${baseBg} ${
                    isInspected ? 'ring-2 ring-inset ring-sky-400 z-10' : ''
                  }`}
                >
                  {/* Coordinate labels on board edges */}
                  {c === (flipped ? 7 : 0) && (
                    <span
                      className={`absolute top-0.5 left-1 text-[10px] font-mono leading-none ${
                        isLight
                          ? 'text-slate-600 dark:text-slate-300'
                          : 'text-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {RANKS[r]}
                    </span>
                  )}
                  {r === (flipped ? 0 : 7) && (
                    <span
                      className={`absolute bottom-0.5 right-1 text-[10px] font-mono leading-none ${
                        isLight
                          ? 'text-slate-600 dark:text-slate-300'
                          : 'text-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {FILES[c]}
                    </span>
                  )}

                  {/* Heatmap square data overlay */}
                  {heatmapMode !== 'none' && heatCount > 0 && (
                    <div
                      className={`absolute inset-1 rounded-md flex flex-col items-center justify-center p-0.5 ${heatOverlayClass}`}
                    >
                      <span className="text-xs sm:text-sm font-bold font-mono tabular-nums leading-none">
                        {heatCount}x
                      </span>
                      <span className="text-[9px] sm:text-[10px] font-mono tabular-nums opacity-95 leading-tight">
                        -{Math.round(totalCpLoss / heatCount)}cp
                      </span>
                    </div>
                  )}

                  {/* Chess piece glyph */}
                  {piece && (heatmapMode === 'none' || heatCount === 0) && (
                    <span
                      className={`text-2xl sm:text-4xl leading-none select-none transition-transform duration-150 ${
                        piece.color === 'w'
                          ? 'text-white drop-shadow-[0_1.5px_2px_rgba(15,23,42,0.95)]'
                          : 'text-slate-950 dark:text-slate-950 drop-shadow-[0_0_2px_rgba(248,250,252,0.9)]'
                      }`}
                    >
                      {PIECE_SYMBOLS[`${piece.color}${piece.type}`]}
                    </span>
                  )}

                  {/* Coach destination indicator */}
                  {isCoachTo && heatmapMode === 'none' && (
                    <span className="absolute top-1 right-1 px-1 py-0.2 bg-emerald-600 text-white text-[9px] font-mono font-semibold rounded">
                      AI
                    </span>
                  )}

                  {/* Legal move target indicator */}
                  {isLegalDest && heatmapMode === 'none' && (
                    <span
                      className={`pointer-events-none ${
                        piece
                          ? 'absolute inset-1 rounded-lg border-2 border-sky-500 dark:border-sky-400'
                          : 'w-3 h-3 rounded-full bg-sky-600/75 dark:bg-sky-400/80'
                      }`}
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
