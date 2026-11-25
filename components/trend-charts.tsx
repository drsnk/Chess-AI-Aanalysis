'use client';

import React from 'react';
import { AnalyzedGame } from '@/lib/chess-engine';

interface TrendChartsProps {
  games: AnalyzedGame[];
}

export const TrendCharts: React.FC<TrendChartsProps> = ({ games }) => {
  const chronological = [...games].sort((a, b) => a.date.localeCompare(b.date));

  // If there are many games, sample up to 40 evenly distributed points for visual clarity while preserving exact start/peak/end
  const sampledForElo =
    chronological.length <= 40
      ? chronological
      : chronological.filter(
          (_, idx) =>
            idx === 0 ||
            idx === chronological.length - 1 ||
            idx % Math.ceil(chronological.length / 38) === 0
        );

  const allElos = chronological.map((g) => g.playerElo);
  const minElo = (allElos.length > 0 ? Math.min(...allElos) : 1400) - 30;
  const maxElo = (allElos.length > 0 ? Math.max(...allElos) : 1650) + 30;
  const peakElo = allElos.length > 0 ? Math.max(...allElos) : 1500;
  const eloRange = Math.max(100, maxElo - minElo);

  const svgWidth = 560;
  const svgHeight = 190;
  const padX = 42;
  const padY = 24;
  const innerW = svgWidth - padX * 2;
  const innerH = svgHeight - padY * 2;

  const eloPoints = sampledForElo.map((g, idx) => {
    const x =
      sampledForElo.length > 1
        ? padX + (idx / (sampledForElo.length - 1)) * innerW
        : padX + innerW / 2;
    const y = padY + innerH - ((g.playerElo - minElo) / eloRange) * innerH;
    return { x, y, game: g };
  });

  const polylineStr = eloPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const labelStep = Math.max(1, Math.ceil(eloPoints.length / 7));

  // Sample up to 20 games for the bar chart display while computing average across all games
  const barGames =
    chronological.length <= 20
      ? chronological
      : chronological.filter(
          (_, idx) =>
            idx === 0 ||
            idx === chronological.length - 1 ||
            idx % Math.ceil(chronological.length / 18) === 0
        );

  const maxTime =
    Math.max(...barGames.map((g) => g.avgCriticalMoveTimeSec), 45) + 5;

  // Win / Draw / Loss breakdown across ALL analyzed games
  const total = Math.max(1, games.length);
  const wins = games.filter((g) => g.outcome === 'win').length;
  const draws = games.filter((g) => g.outcome === 'draw').length;
  const losses = games.filter((g) => g.outcome === 'loss').length;

  const winRate = Math.round((wins / total) * 100);
  const drawRate = Math.round((draws / total) * 100);
  const lossRate = Math.max(0, 100 - winRate - drawRate);

  const whiteGames = games.filter((g) => g.playerColor === 'w');
  const blackGames = games.filter((g) => g.playerColor === 'b');
  const whiteWinRate =
    whiteGames.length > 0
      ? Math.round(
          (whiteGames.filter((g) => g.outcome === 'win').length / whiteGames.length) * 100
        )
      : 0;
  const blackWinRate =
    blackGames.length > 0
      ? Math.round(
          (blackGames.filter((g) => g.outcome === 'win').length / blackGames.length) * 100
        )
      : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* 1. Elo Rating Progression Over Time */}
      <div className="liquid-glass rounded-2xl p-5 flex flex-col justify-between">
        <div>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Elo Rating Trajectory ({games.length} Games)
            </h3>
            <span className="text-xs font-mono tabular-nums text-sky-600 dark:text-sky-400">
              Peak {peakElo} Elo
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
            Complete rating progression across all synced Chess.com & Lichess matches
          </p>
        </div>

        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-44 overflow-visible"
            role="img"
            aria-label="Elo rating trend line chart"
          >
            {/* Horizontal grid lines */}
            {[0, 0.5, 1].map((ratio, i) => {
              const y = padY + ratio * innerH;
              const val = Math.round(maxElo - ratio * eloRange);
              return (
                <g key={i}>
                  <line
                    x1={padX}
                    y1={y}
                    x2={svgWidth - padX}
                    y2={y}
                    stroke="currentColor"
                    className="text-slate-300 dark:text-slate-800"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                  <text
                    x={padX - 8}
                    y={y + 4}
                    textAnchor="end"
                    className="text-[11px] font-mono fill-slate-500 dark:fill-slate-400"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {/* Solid polyline (no gradients) */}
            {eloPoints.length > 1 && (
              <polyline
                fill="none"
                stroke="#0284C7"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={polylineStr}
              />
            )}

            {/* Data nodes */}
            {eloPoints.map((pt, i) => {
              const showLabel =
                i === 0 || i === eloPoints.length - 1 || i % labelStep === 0;
              return (
                <g key={pt.game.id}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={eloPoints.length > 20 ? '3.5' : '5'}
                    className={
                      pt.game.outcome === 'win'
                        ? 'fill-emerald-500 stroke-slate-950'
                        : pt.game.outcome === 'loss'
                        ? 'fill-rose-500 stroke-slate-950'
                        : 'fill-amber-400 stroke-slate-950'
                    }
                    strokeWidth="1.5"
                  />
                  {showLabel && (
                    <>
                      <text
                        x={pt.x}
                        y={pt.y - 9}
                        textAnchor="middle"
                        className="text-[10px] font-mono fill-slate-700 dark:fill-slate-300"
                      >
                        {pt.game.playerElo}
                      </text>
                      <text
                        x={pt.x}
                        y={svgHeight - 4}
                        textAnchor="middle"
                        className="text-[10px] font-mono fill-slate-500 dark:fill-slate-400"
                      >
                        {pt.game.date.slice(5)}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* 2. Win / Draw / Loss Rates & Color Split */}
      <div className="liquid-glass rounded-2xl p-5 flex flex-col justify-between">
        <div>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Win Rates & Color Efficiency
            </h3>
            <span className="text-xs font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {winRate}% Win Rate
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
            Outcome distribution across all {games.length} analyzed games
          </p>
        </div>

        <div className="space-y-4">
          {/* Segmented solid bar */}
          <div>
            <div className="flex justify-between text-xs font-mono tabular-nums mb-1.5">
              <span className="text-emerald-600 dark:text-emerald-400">
                Won: {wins} ({winRate}%)
              </span>
              <span className="text-amber-600 dark:text-amber-400">
                Drawn: {draws} ({drawRate}%)
              </span>
              <span className="text-rose-600 dark:text-rose-400">
                Lost: {losses} ({lossRate}%)
              </span>
            </div>
            <div className="w-full h-3.5 rounded-lg overflow-hidden flex bg-slate-200 dark:bg-slate-800">
              <div
                style={{ width: `${winRate}%` }}
                className="bg-emerald-600 h-full"
                title={`Wins: ${winRate}%`}
              />
              <div
                style={{ width: `${drawRate}%` }}
                className="bg-amber-500 h-full"
                title={`Draws: ${drawRate}%`}
              />
              <div
                style={{ width: `${lossRate}%` }}
                className="bg-rose-600 h-full"
                title={`Losses: ${lossRate}%`}
              />
            </div>
          </div>

          {/* White vs Black conversion */}
          <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/80 space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-700 dark:text-slate-300 font-medium">
                  Playing as White ({whiteGames.length} games)
                </span>
                <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100 font-semibold">
                  {whiteWinRate}% Wins
                </span>
              </div>
              <div className="w-full h-2.5 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  style={{ width: `${whiteWinRate}%` }}
                  className="h-full bg-sky-500"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-700 dark:text-slate-300 font-medium">
                  Playing as Black ({blackGames.length} games)
                </span>
                <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100 font-semibold">
                  {blackWinRate}% Wins
                </span>
              </div>
              <div className="w-full h-2.5 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  style={{ width: `${blackWinRate}%` }}
                  className="h-full bg-indigo-500"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Time Spent on Critical Moves */}
      <div className="liquid-glass rounded-2xl p-5 flex flex-col justify-between">
        <div>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Time Spent on Critical Moves
            </h3>
            <span className="text-xs font-mono tabular-nums text-amber-600 dark:text-amber-400">
              Avg{' '}
              {Math.round(
                chronological.reduce((a, g) => a + g.avgCriticalMoveTimeSec, 0) /
                  Math.max(1, chronological.length)
              )}
              s / move
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
            Seconds burned on tactical turning points (&gt;30s correlates with clock blunders)
          </p>
        </div>

        <div className="flex items-end justify-between gap-1.5 h-40 pt-4 px-2 border-b border-slate-300 dark:border-slate-800">
          {barGames.map((g) => {
            const heightPct = Math.min(
              100,
              Math.round((g.avgCriticalMoveTimeSec / maxTime) * 100)
            );
            const isTimeTrouble = g.avgCriticalMoveTimeSec >= 30;
            return (
              <div
                key={g.id}
                className="flex-1 flex flex-col items-center justify-end h-full group"
              >
                {barGames.length <= 12 && (
                  <span className="text-[10px] font-mono tabular-nums text-slate-600 dark:text-slate-400 mb-1">
                    {g.avgCriticalMoveTimeSec}s
                  </span>
                )}
                <div
                  style={{ height: `${heightPct}%` }}
                  className={`w-full max-w-[28px] rounded-t-md transition-opacity ${
                    isTimeTrouble ? 'bg-rose-500' : 'bg-sky-500'
                  }`}
                  title={`${g.date} · ${g.opening}: ${g.avgCriticalMoveTimeSec}s avg on critical moves (${g.accuracy}% accuracy)`}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400 pt-2">
          <span>Blue: Optimal Pacing (&lt;30s)</span>
          <span>Red: Clock Pressure (&ge;30s)</span>
        </div>
      </div>
    </div>
  );
};
