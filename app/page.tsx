'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Chess, Square } from 'chess.js';
import {
  Brain,
  CloudUpload,
  FolderSync,
  RotateCcw,
  FlipHorizontal,
  Volume2,
  VolumeX,
  Download,
  Trash2,
  Sparkles,
  Target,
  Clock,
  Sun,
  Moon,
  Smartphone,
  Upload,
  Check,
  AlertTriangle,
  Play,
  FileText,
} from 'lucide-react';
import { User } from 'firebase/auth';
import {
  initAuth,
  googleSignIn,
  getAccessToken,
  logout,
} from '@/lib/firebase-auth';
import {
  AnalyzedGame,
  BlunderEvent,
  EngineCandidate,
  INITIAL_ANALYZED_GAMES,
  computeTacticalPatternStats,
  enrichPgnWithAnalysis,
  getTopEngineCandidates,
  parseAndAnalyzePgn,
  selectBotMoveByElo,
} from '@/lib/chess-engine';
import { ChessBoard, playChessSound } from '@/components/chess-board';
import { TrendCharts } from '@/components/trend-charts';
import { usePWAInstall, useOnlineStatus } from '@/hooks/use-pwa';

type ActiveTab = 'arena' | 'heatmaps' | 'tactics' | 'trends' | 'archive';

interface CoachAdvice {
  bestMoveSan: string;
  tacticalMotif: string;
  explanation: string;
  blunderWarning: string;
  positionalPlan: string;
}

interface DrivePgnFile {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
  description?: string;
}

const ELO_PRESETS = [
  { elo: 700, label: '700 · Novice Club' },
  { elo: 1100, label: '1100 · Intermediate' },
  { elo: 1500, label: '1500 · Tactical Club' },
  { elo: 1900, label: '1900 · Candidate Master' },
  { elo: 2300, label: '2300 · Grandmaster Bot' },
];

const TAB_ITEMS: { id: ActiveTab; label: string }[] = [
  { id: 'arena', label: 'Arena & AI Coach' },
  { id: 'heatmaps', label: 'Blunder Heatmaps' },
  { id: 'tactics', label: 'Tactical Motifs' },
  { id: 'trends', label: 'Trends & Elo' },
  { id: 'archive', label: 'Sync & Drive Vault' },
];

const LOCAL_STORAGE_GAMES_KEY = 'glasschess_analyzed_games_v1';

export default function GlassChessTacticianApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('arena');

  // Theme state
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  // PWA & Offline Status
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const isOnline = useOnlineStatus();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // Firebase Google Auth & Drive state
  const [user, setUser] = useState<User | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DrivePgnFile[]>([]);
  const [driveStatus, setDriveStatus] = useState<string | null>(null);
  const [isSyncingDrive, setIsSyncingDrive] = useState(false);

  // Mandatory destructive operation confirmation modal state
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  // Analyzed Games Archive (persisted offline in localStorage; deterministic SSR initial state)
  const [games, setGames] = useState<AnalyzedGame[]>(INITIAL_ANALYZED_GAMES);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(LOCAL_STORAGE_GAMES_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setGames(parsed);
          }
        }
      } catch {
        // Fallback to initial games
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const saveGamesToLocal = useCallback((updated: AnalyzedGame[]) => {
    setGames(updated);
    try {
      localStorage.setItem(LOCAL_STORAGE_GAMES_KEY, JSON.stringify(updated));
    } catch {
      // Ignore quota errors
    }
  }, []);

  // Chess.com & Lichess Import controls
  const [importPlatform, setImportPlatform] = useState<'lichess' | 'chesscom'>('lichess');
  const [importUsername, setImportUsername] = useState('DrNykterstein');
  const [isImporting, setIsImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [customPgnInput, setCustomPgnInput] = useState('');
  const [showPgnModal, setShowPgnModal] = useState(false);
  const [visibleGamesLimit, setVisibleGamesLimit] = useState<number>(50);

  // Active Live Chess Game vs Adjustable Elo Bot
  const [gameFen, setGameFen] = useState<string>(() => new Chess().fen());
  const [gamePgn, setGamePgn] = useState<string>('');
  const [playerSide, setPlayerSide] = useState<'w' | 'b'>('w');
  const [botElo, setBotElo] = useState<number>(1500);
  const [boardFlipped, setBoardFlipped] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const moveStartTimestampRef = useRef<number>(0);
  const [lastMoveDurationSec, setLastMoveDurationSec] = useState<number>(0);

  useEffect(() => {
    moveStartTimestampRef.current = Date.now();
  }, []);

  // Real-Time AI Coach State
  const [coachAdvice, setCoachAdvice] = useState<CoachAdvice | null>(null);
  const [isCoachLoading, setIsCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [autoCoachEnabled, setAutoCoachEnabled] = useState(true);

  // Heatmap Lab State
  const [heatmapFilter, setHeatmapFilter] = useState<
    'opening_blunder' | 'missed_win' | 'all'
  >('opening_blunder');
  const [inspectedSquare, setInspectedSquare] = useState<Square | null>('e4');
  const [heatmapPreviewFen, setHeatmapPreviewFen] = useState<string>(
    INITIAL_ANALYZED_GAMES[0].blunders[0].fen
  );

  // Derived Chess instance for the Arena
  const activeChess = useMemo(() => {
    const c = new Chess();
    if (gamePgn) {
      try {
        c.loadPgn(gamePgn);
        return c;
      } catch {
        // fallback to FEN
      }
    }
    try {
      c.load(gameFen);
    } catch {
      // default starting
    }
    return c;
  }, [gameFen, gamePgn]);

  const isBotThinking = !activeChess.isGameOver() && activeChess.turn() !== playerSide;

  // Top 3 Local Engine Candidates (works 100% offline + feeds AI Coach)
  const engineCandidates: EngineCandidate[] = useMemo(() => {
    return getTopEngineCandidates(activeChess.fen(), 2);
  }, [activeChess]);

  // All blunder events across analyzed games
  const allBlunderEvents: BlunderEvent[] = useMemo(() => {
    return games.flatMap((g) => g.blunders);
  }, [games]);

  // Tactical struggle statistics
  const tacticalStats = useMemo(() => {
    return computeTacticalPatternStats(games);
  }, [games]);

  // Load Google Drive PGN files
  const fetchDriveFiles = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return;
    }
    try {
      const res = await fetch('/api/drive', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        setNeedsAuth(true);
        return;
      }
      const data = await res.json();
      if (data.files) {
        setDriveFiles(data.files);
      }
    } catch (err) {
      console.error('Failed to list Drive files:', err);
    }
  }, []);

  useEffect(() => {
    const unsub = initAuth(
      (authedUser) => {
        setUser(authedUser);
        setNeedsAuth(false);
        fetchDriveFiles();
      },
      () => {
        setUser(null);
        setNeedsAuth(true);
      }
    );
    return () => unsub();
  }, [fetchDriveFiles]);

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setDriveStatus(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setNeedsAuth(false);
        setDriveStatus('Connected to Google Drive');
        await fetchDriveFiles();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In was cancelled.';
      setDriveStatus(msg);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await logout();
    setUser(null);
    setNeedsAuth(true);
    setDriveFiles([]);
    setDriveStatus('Signed out of Google Drive');
  };

  // Request AI Coach advice on current board position
  const requestCoachAdvice = useCallback(
    async (fenToAnalyze: string, pgnToAnalyze: string) => {
      const tempChess = new Chess(fenToAnalyze);
      if (tempChess.isGameOver()) return;

      const localTop = getTopEngineCandidates(fenToAnalyze, 2);
      const legalMoves = tempChess.moves();

      // If offline, provide instant local engine coaching
      if (!navigator.onLine) {
        const best = localTop[0];
        if (best) {
          setCoachAdvice({
            bestMoveSan: best.san,
            tacticalMotif: best.motifHint,
            explanation: `Offline Engine Analysis (${best.evalFormatted}): Playing ${best.san} from ${best.from} to ${best.to} optimizes piece coordination and central control.`,
            blunderWarning:
              'Watch for undefended minor pieces and avoid weakening your king shelter.',
            positionalPlan: `Follow up ${best.san} by contesting open files and coordinating rooks.`,
          });
        }
        return;
      }

      setIsCoachLoading(true);
      setCoachError(null);
      try {
        const res = await fetch('/api/coach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fen: fenToAnalyze,
            pgn: pgnToAnalyze,
            turn: tempChess.turn(),
            legalMoves,
            engineCandidates: localTop,
            playerStruggles: tacticalStats.slice(0, 3).map((s) => s.motif),
            mode: 'realtime',
          }),
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || 'Coach unavailable');
        }
        setCoachAdvice(data);
      } catch (err: unknown) {
        const best = localTop[0];
        if (best) {
          setCoachAdvice({
            bestMoveSan: best.san,
            tacticalMotif: best.motifHint,
            explanation: `Local Engine Recommendation (${best.evalFormatted}): ${best.san} seizes space and addresses tactical tension on ${best.to}.`,
            blunderWarning: 'Avoid leaving central pawns or back-rank squares unguarded.',
            positionalPlan: 'Activate remaining minor pieces and connect your rooks.',
          });
        }
        setCoachError(
          err instanceof Error ? err.message : 'Using local engine evaluation.'
        );
      } finally {
        setIsCoachLoading(false);
      }
    },
    [tacticalStats]
  );

  // Trigger bot move if it's bot's turn
  useEffect(() => {
    if (activeChess.isGameOver()) return;
    if (activeChess.turn() !== playerSide) {
      const timer = setTimeout(() => {
        const c = new Chess();
        if (gamePgn) {
          try {
            c.loadPgn(gamePgn);
          } catch {
            c.load(gameFen);
          }
        } else {
          c.load(gameFen);
        }

        const botMove = selectBotMoveByElo(c.fen(), botElo);
        if (botMove) {
          const executed = c.move(botMove);
          if (executed) {
            setGameFen(c.fen());
            setGamePgn(c.pgn());
            setLastMove({ from: executed.from, to: executed.to });
            moveStartTimestampRef.current = Date.now();
            if (soundEnabled) {
              if (c.isCheckmate()) playChessSound('victory');
              else if (c.inCheck()) playChessSound('check');
              else if (executed.captured) playChessSound('capture');
              else playChessSound('move');
            }
            if (autoCoachEnabled && !c.isGameOver()) {
              requestCoachAdvice(c.fen(), c.pgn());
            }
          }
        }
      }, 450);

      return () => clearTimeout(timer);
    }
  }, [
    activeChess,
    playerSide,
    botElo,
    gameFen,
    gamePgn,
    soundEnabled,
    autoCoachEnabled,
    requestCoachAdvice,
  ]);

  // Legal destinations for selected square
  const legalDestinations: Square[] = useMemo(() => {
    if (!selectedSquare) return [];
    const moves = activeChess.moves({ square: selectedSquare, verbose: true });
    return moves.map((m) => m.to);
  }, [activeChess, selectedSquare]);

  // Coach suggested move coordinates on the board
  const coachSuggestedMoveCoords = useMemo(() => {
    const targetSan = coachAdvice?.bestMoveSan || engineCandidates[0]?.san;
    if (!targetSan) return null;
    const legal = activeChess.moves({ verbose: true });
    const matched = legal.find(
      (m) => m.san === targetSan || m.san.replace(/[+#]/g, '') === targetSan.replace(/[+#]/g, '')
    );
    if (!matched) return null;
    return { from: matched.from, to: matched.to, san: matched.san };
  }, [activeChess, coachAdvice, engineCandidates]);

  // Handle square click in Arena
  const handleArenaSquareClick = (sq: Square) => {
    if (isBotThinking || activeChess.isGameOver()) return;

    if (selectedSquare && legalDestinations.includes(sq)) {
      const c = new Chess();
      if (gamePgn) {
        try {
          c.loadPgn(gamePgn);
        } catch {
          c.load(gameFen);
        }
      } else {
        c.load(gameFen);
      }

      try {
        const moveResult = c.move({
          from: selectedSquare,
          to: sq,
          promotion: 'q',
        });

        if (moveResult) {
          const elapsedSec = Math.max(
            1,
            Math.round((Date.now() - moveStartTimestampRef.current) / 1000)
          );
          setLastMoveDurationSec(elapsedSec);
          setGameFen(c.fen());
          setGamePgn(c.pgn());
          setSelectedSquare(null);
          setLastMove({ from: moveResult.from, to: moveResult.to });

          if (soundEnabled) {
            if (c.isCheckmate()) playChessSound('victory');
            else if (c.inCheck()) playChessSound('check');
            else if (moveResult.captured) playChessSound('capture');
            else playChessSound('move');
          }
          return;
        }
      } catch {
        // Not a valid move
      }
    }

    const piece = activeChess.get(sq);
    if (piece && piece.color === activeChess.turn()) {
      setSelectedSquare(sq);
    } else {
      setSelectedSquare(null);
    }
  };

  // Play the AI Coach's recommended move immediately
  const playCoachRecommendedMove = () => {
    if (!coachSuggestedMoveCoords || isBotThinking || activeChess.isGameOver()) return;
    const c = new Chess();
    if (gamePgn) {
      try {
        c.loadPgn(gamePgn);
      } catch {
        c.load(gameFen);
      }
    } else {
      c.load(gameFen);
    }

    const moveResult = c.move({
      from: coachSuggestedMoveCoords.from,
      to: coachSuggestedMoveCoords.to,
      promotion: 'q',
    });

    if (moveResult) {
      setGameFen(c.fen());
      setGamePgn(c.pgn());
      setSelectedSquare(null);
      setLastMove({ from: moveResult.from, to: moveResult.to });
      if (soundEnabled) playChessSound(moveResult.captured ? 'capture' : 'move');
    }
  };

  const resetArenaGame = (newSide: 'w' | 'b' = playerSide, customFen?: string) => {
    const fresh = new Chess(customFen);
    setPlayerSide(newSide);
    setBoardFlipped(newSide === 'b');
    setGameFen(fresh.fen());
    setGamePgn('');
    setSelectedSquare(null);
    setLastMove(null);
    setCoachAdvice(null);
    moveStartTimestampRef.current = Date.now();
    setLastMoveDurationSec(0);
  };

  // Save current arena match into archive (and optionally Google Drive)
  const saveCurrentArenaMatch = async (alsoUploadToDrive = false) => {
    const history = activeChess.history();
    if (history.length === 0) {
      setDriveStatus('Play at least one move before saving PGN.');
      return;
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const pgnWithHeaders = `[Event "Practice vs GlassChess Bot (${botElo} Elo)"]\n[Site "GlassChess Tactician"]\n[Date "${dateStr.replace(/-/g, '.')}"]\n[White "${playerSide === 'w' ? user?.displayName || 'You' : `Bot_${botElo}`}"]\n[Black "${playerSide === 'b' ? user?.displayName || 'You' : `Bot_${botElo}`}"]\n[Result "${activeChess.isCheckmate() ? (activeChess.turn() === 'w' ? '0-1' : '1-0') : '*'}"]\n[WhiteElo "${playerSide === 'w' ? 1580 : botElo}"]\n[BlackElo "${playerSide === 'b' ? 1580 : botElo}"]\n[Opening "Tactical Training Session"]\n\n${activeChess.pgn()}`;

    const analyzed = parseAndAnalyzePgn(
      pgnWithHeaders,
      'local',
      user?.displayName || 'You',
      games.length + 1
    );

    if (analyzed) {
      const updated = [analyzed, ...games];
      saveGamesToLocal(updated);
      setDriveStatus('Saved match to local offline archive.');

      if (alsoUploadToDrive) {
        await uploadSingleGameToDrive(analyzed);
      }
    }
  };

  // Helper to analyze a list of raw PGNs in non-blocking chunks
  const analyzePgnsInChunks = async (
    rawPgns: string[],
    source: 'chess.com' | 'lichess.org' | 'local',
    username: string,
    seedOffset = 0,
    onProgress?: (analyzedSoFar: number, total: number) => void
  ): Promise<AnalyzedGame[]> => {
    const results: AnalyzedGame[] = [];
    const chunkSize = 20;
    for (let i = 0; i < rawPgns.length; i += chunkSize) {
      const slice = rawPgns.slice(i, i + chunkSize);
      slice.forEach((raw, idx) => {
        const parsed = parseAndAnalyzePgn(raw, source, username, seedOffset + i + idx);
        if (parsed) results.push(parsed);
      });
      if (onProgress) {
        onProgress(Math.min(i + chunkSize, rawPgns.length), rawPgns.length);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return results;
  };

  // Import ALL real games from Chess.com or Lichess
  const handleImportExternalGames = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = importUsername.trim();
    if (!cleanUser) return;

    setIsImporting(true);
    setImportFeedback(
      `Connecting to ${importPlatform === 'chesscom' ? 'Chess.com' : 'Lichess.org'} for "${cleanUser}"...`
    );

    try {
      if (importPlatform === 'chesscom') {
        const archRes = await fetch(
          `/api/import-games?platform=chesscom&username=${encodeURIComponent(
            cleanUser
          )}&mode=archives`
        );
        const archData = await archRes.json();

        if (!archRes.ok || archData.error) {
          throw new Error(archData.error || 'Could not fetch Chess.com archives.');
        }

        const archiveUrls: string[] = archData.archives || [];
        if (archiveUrls.length === 0) {
          setImportFeedback(`No public game archives found for "${cleanUser}" on Chess.com.`);
          return;
        }

        const allAnalyzed: AnalyzedGame[] = [];

        for (let m = 0; m < archiveUrls.length; m++) {
          const url = archiveUrls[m];
          const monthLabel = url.split('/').slice(-2).join('/');
          setImportFeedback(
            `Fetching & analyzing Chess.com archive ${m + 1} of ${archiveUrls.length} (${monthLabel}) · ${allAnalyzed.length} games analyzed...`
          );

          const monthRes = await fetch(
            `/api/import-games?platform=chesscom&archiveUrl=${encodeURIComponent(url)}`
          );
          if (!monthRes.ok) continue;
          const monthData = await monthRes.json();
          const monthPgns: string[] = monthData.pgns || [];

          if (monthPgns.length > 0) {
            const analyzedMonth = await analyzePgnsInChunks(
              monthPgns,
              'chess.com',
              cleanUser,
              allAnalyzed.length
            );
            allAnalyzed.push(...analyzedMonth);
          }
        }

        if (allAnalyzed.length === 0) {
          setImportFeedback('Fetched archives did not contain standard PGN moves.');
          return;
        }

        saveGamesToLocal(allAnalyzed);
        setImportFeedback(
          `Completed full analysis of all ${allAnalyzed.length} games across ${archiveUrls.length} monthly archive(s) from Chess.com (${cleanUser}).`
        );
      } else {
        const res = await fetch(
          `/api/import-games?platform=lichess&username=${encodeURIComponent(cleanUser)}`
        );
        const data = await res.json();

        if (!res.ok || data.error) {
          throw new Error(data.error || 'Could not import games from Lichess.');
        }

        const rawPgns: string[] = data.pgns || [];
        if (rawPgns.length === 0) {
          setImportFeedback(`No public PGN games found for "${cleanUser}" on Lichess.`);
          return;
        }

        const analyzedList = await analyzePgnsInChunks(
          rawPgns,
          'lichess.org',
          cleanUser,
          0,
          (done, total) => {
            setImportFeedback(`Analyzing Lichess game ${done} of ${total}...`);
          }
        );

        if (analyzedList.length === 0) {
          setImportFeedback('Fetched archive did not contain standard PGN moves.');
          return;
        }

        saveGamesToLocal(analyzedList);
        setImportFeedback(
          `Completed full analysis of all ${analyzedList.length} games from Lichess.org (${cleanUser}). Heatmaps and trends updated.`
        );
      }
    } catch (err: unknown) {
      setImportFeedback(
        err instanceof Error ? err.message : 'Failed to fetch games.'
      );
    } finally {
      setIsImporting(false);
    }
  };

  // Manual PGN paste analysis
  const handleAnalyzeCustomPgn = async () => {
    if (!customPgnInput.trim()) return;
    const chunks = customPgnInput
      .trim()
      .split(/\n\n+(?=\[Event |\[Analyzer )/)
      .map((c) => c.trim())
      .filter((c) => c.length > 10);

    const rawList = chunks.length > 0 ? chunks : [customPgnInput.trim()];
    const analyzedBatch = await analyzePgnsInChunks(
      rawList,
      'local',
      user?.displayName || 'Player',
      games.length + 1
    );

    if (analyzedBatch.length === 0) {
      setImportFeedback('Invalid PGN format. Please check move notation.');
      return;
    }
    const updated = [...analyzedBatch, ...games];
    saveGamesToLocal(updated);
    setCustomPgnInput('');
    setShowPgnModal(false);
    setImportFeedback(
      `Analyzed ${analyzedBatch.length} custom PGN game(s) and added to Heatmaps.`
    );
  };

  // Upload a single analyzed game to Google Drive as a .pgn file
  const uploadSingleGameToDrive = async (game: AnalyzedGame) => {
    const token = await getAccessToken();
    if (!token) {
      setNeedsAuth(true);
      setDriveStatus('Please sign in with Google to save PGN files to Google Drive.');
      return;
    }

    const performUpload = async () => {
      setIsSyncingDrive(true);
      setDriveStatus(`Saving ${game.opening} PGN to Google Drive...`);
      try {
        const enrichedPgn = enrichPgnWithAnalysis(game);
        const safeOpening = game.opening.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 28);
        const fileName = `GlassChess_${game.date}_${safeOpening}_${game.id.slice(-4)}.pgn`;

        const res = await fetch('/api/drive', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            fileName,
            pgnContent: enrichedPgn,
            existingFileId: game.driveFileId,
            description: `${game.white} vs ${game.black} (${game.result}) | Accuracy: ${game.accuracy}% | Opening: ${game.opening}`,
          }),
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || 'Drive upload failed');
        }

        const updatedGames = games.map((g) =>
          g.id === game.id ? { ...g, driveFileId: data.file.id } : g
        );
        saveGamesToLocal(updatedGames);
        setDriveStatus(`Saved "${fileName}" to Google Drive.`);
        await fetchDriveFiles();
      } catch (err: unknown) {
        setDriveStatus(
          err instanceof Error ? err.message : 'Failed to upload PGN to Google Drive.'
        );
      } finally {
        setIsSyncingDrive(false);
      }
    };

    if (game.driveFileId) {
      setConfirmDialog({
        title: 'Overwrite Existing PGN in Google Drive?',
        description: `This will update the existing Google Drive PGN file for "${game.white} vs ${game.black}" (${game.opening}) with the latest tactical analysis metadata.`,
        confirmLabel: 'Confirm Overwrite',
        onConfirm: async () => {
          setConfirmDialog(null);
          await performUpload();
        },
      });
    } else {
      await performUpload();
    }
  };

  // Batch sync all games to Google Drive as PGN bundle
  const handleSyncAllGamesToDrive = async () => {
    const token = await getAccessToken();
    if (!token) {
      setNeedsAuth(true);
      setDriveStatus('Sign in with Google first to archive all PGNs to Google Drive.');
      return;
    }

    setIsSyncingDrive(true);
    setDriveStatus(`Archiving ${games.length} analyzed PGN games to Google Drive...`);
    try {
      const combinedPgn = games.map((g) => enrichPgnWithAnalysis(g)).join('\n\n');
      const dateStamp = new Date().toISOString().slice(0, 10);
      const fileName = `GlassChess_Full_Archive_${dateStamp}_${games.length}games.pgn`;

      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileName,
          pgnContent: combinedPgn,
          description: `Complete PGN bundle of ${games.length} analyzed games from GlassChess Tactician.`,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Batch PGN upload failed.');
      }

      setDriveStatus(`Archived all ${games.length} games as "${fileName}" in Google Drive.`);
      await fetchDriveFiles();
    } catch (err: unknown) {
      setDriveStatus(
        err instanceof Error ? err.message : 'Failed to sync archive to Google Drive.'
      );
    } finally {
      setIsSyncingDrive(false);
    }
  };

  // Delete a PGN file from Google Drive WITH MANDATORY CONFIRMATION DIALOG
  const requestDeleteDriveFile = (file: DrivePgnFile) => {
    setConfirmDialog({
      title: 'Delete PGN File from Google Drive?',
      description: `Are you sure you want to permanently delete "${file.name}" from your Google Drive? This action cannot be undone.`,
      confirmLabel: 'Delete from Google Drive',
      onConfirm: async () => {
        setConfirmDialog(null);
        const token = await getAccessToken();
        if (!token) {
          setNeedsAuth(true);
          return;
        }
        setIsSyncingDrive(true);
        try {
          const res = await fetch(
            `/api/drive?fileId=${encodeURIComponent(file.id)}`,
            {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to delete file.');
          }
          setDriveFiles((prev) => prev.filter((f) => f.id !== file.id));
          setDriveStatus(`Deleted "${file.name}" from Google Drive.`);
        } catch (err: unknown) {
          setDriveStatus(
            err instanceof Error ? err.message : 'Could not delete Drive file.'
          );
        } finally {
          setIsSyncingDrive(false);
        }
      },
    });
  };

  // Load a PGN file from Google Drive into the analyzer
  const loadPgnFromDrive = async (file: DrivePgnFile) => {
    const token = await getAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return;
    }
    setIsSyncingDrive(true);
    setDriveStatus(`Loading "${file.name}" from Google Drive...`);
    try {
      const res = await fetch(
        `/api/drive?fileId=${encodeURIComponent(file.id)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await res.json();
      if (!res.ok || !data.pgn) {
        throw new Error(data.error || 'Could not read PGN content.');
      }

      const chunks = data.pgn
        .split(/\n\n+(?=\[Event |\[Analyzer )/)
        .map((c: string) => c.trim())
        .filter((c: string) => c.length > 20);

      const loadedGames = await analyzePgnsInChunks(
        chunks,
        'local',
        user?.displayName || 'You',
        0,
        (done, total) => {
          setDriveStatus(`Analyzing game ${done} of ${total} from "${file.name}"...`);
        }
      );

      loadedGames.forEach((g) => {
        g.driveFileId = file.id;
      });

      if (loadedGames.length > 0) {
        const merged = [...loadedGames, ...games];
        saveGamesToLocal(merged);
        setDriveStatus(
          `Loaded and analyzed all ${loadedGames.length} game(s) from "${file.name}".`
        );
      } else {
        setDriveStatus(`Loaded "${file.name}".`);
      }
    } catch (err: unknown) {
      setDriveStatus(
        err instanceof Error ? err.message : 'Failed to load PGN from Drive.'
      );
    } finally {
      setIsSyncingDrive(false);
    }
  };

  // Heatmap filtered events and inspected square details
  const filteredHeatmapEvents = useMemo(() => {
    return allBlunderEvents.filter((ev) =>
      heatmapFilter === 'all' ? true : ev.type === heatmapFilter
    );
  }, [allBlunderEvents, heatmapFilter]);

  const squareEventsForInspection = useMemo(() => {
    if (!inspectedSquare) return [];
    return filteredHeatmapEvents.filter((ev) => ev.square === inspectedSquare);
  }, [filteredHeatmapEvents, inspectedSquare]);

  const heatmapChessInstance = useMemo(() => {
    try {
      return new Chess(heatmapPreviewFen);
    } catch {
      return new Chess();
    }
  }, [heatmapPreviewFen]);

  // Download PGN locally for offline backup
  const downloadPgnLocally = (game: AnalyzedGame) => {
    const content = enrichPgnWithAnalysis(game);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GlassChess_${game.date}_${game.eco}.pgn`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Summary metrics
  const latestElo = games[0]?.playerElo || 1585;
  const avgAccuracy = Math.round(
    games.reduce((acc, g) => acc + g.accuracy, 0) / Math.max(1, games.length)
  );
  const openingBlunderCount = allBlunderEvents.filter(
    (b) => b.type === 'opening_blunder'
  ).length;
  const missedWinCount = allBlunderEvents.filter((b) => b.type === 'missed_win').length;

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Offline Mode Connectivity Banner */}
      {!isOnline && (
        <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl liquid-glass-strong px-4 py-2.5 text-xs font-medium text-amber-600 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Offline Mode Active · Bot practice, local engine coach, and cached PGN analysis are fully available.
          </span>
        </div>
      )}

      {/* Top Navigation Bar — Strict 3-Zone Contract */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-4 sm:px-8 py-3 liquid-glass border-b border-slate-200/80 dark:border-slate-800/80">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => setActiveTab('arena')}
          className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 text-left cursor-pointer"
          style={{ fontFamily: 'var(--font-display), sans-serif' }}
        >
          GlassChess Tactician
        </button>

        {/* Zone 2: 5 concise single-line navigation links switching active tab */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-300">
          {TAB_ITEMS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab.id
                  ? 'text-sky-600 dark:text-sky-400 font-semibold underline underline-offset-8'
                  : 'hover:text-slate-900 dark:hover:text-white hover:underline underline-offset-8'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: Primary Action (Official Google Sign-In or Drive Sync Action) */}
        <div className="flex items-center gap-3 shrink-0">
          {needsAuth ? (
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isLoggingIn}
              className="gsi-material-button"
            >
              <div className="gsi-material-button-state"></div>
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    style={{ display: 'block' }}
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    ></path>
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    ></path>
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    ></path>
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    ></path>
                    <path fill="none" d="M0 0h48v48H0z"></path>
                  </svg>
                </div>
                <span className="gsi-material-button-contents">
                  {isLoggingIn ? 'Connecting...' : 'Sign in with Google'}
                </span>
              </div>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSyncAllGamesToDrive}
              disabled={isSyncingDrive}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              <CloudUpload className="w-4 h-4" />
              <span>{isSyncingDrive ? 'Syncing PGNs...' : 'Backup All to Drive'}</span>
            </button>
          )}
        </div>
      </header>

      {/* Workspace Tab Bar & Quick Utility Controls */}
      <div className="w-full max-w-[1380px] mx-auto px-3 sm:px-8 pt-3 flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex items-center gap-1 p-1 rounded-xl liquid-glass overflow-x-auto max-w-full"
          role="tablist"
          aria-label="Workspace Function Tabs"
        >
          {TAB_ITEMS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {!isInstalled && isInstallable && (
            <button
              type="button"
              onClick={install}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium whitespace-nowrap shrink-0"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Install App</span>
            </button>
          )}

          {!isInstalled && !isInstallable && isIOS && (
            <button
              type="button"
              onClick={() => setShowIOSGuide(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium whitespace-nowrap shrink-0"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Install on iOS</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsDark(!isDark)}
            aria-label="Toggle Light or Dark Liquid Glass theme"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg liquid-glass text-xs font-medium whitespace-nowrap shrink-0"
          >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isDark ? 'Light Glass' : 'Dark Glass'}</span>
          </button>
        </div>
      </div>

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-[1380px] mx-auto px-3 sm:px-8 py-3 sm:py-5">
        {/* TAB 1: ARENA & AI COACH
            - Landscape: Playable Game and AI Suggestions & Remarks SIDE BY SIDE
            - Portrait: Playable Game is 2/3 height and AI Suggestions & Remarks is 1/3 height */}
        {activeTab === 'arena' && (
          <section
            aria-label="Playable Game and AI Coach Suggestions"
            className="flex flex-col portrait:h-[calc(100dvh-9rem)] landscape:flex-row lg:flex-row gap-3 sm:gap-5 items-stretch"
          >
            {/* Playable Game Panel: 2/3 in portrait mode, side-by-side (2/3 width) in landscape mode */}
            <div className="portrait:h-2/3 portrait:basis-2/3 flex-[2] landscape:w-7/12 lg:w-7/12 min-h-0 liquid-glass rounded-2xl p-3 sm:p-5 flex flex-col justify-between gap-2 overflow-hidden">
              {/* Top Bar: Opponent Bot Strength & Game Turn Status */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200/70 dark:border-slate-800/80 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                    Bot Opponent
                  </span>
                  <select
                    aria-label="Opponent Bot Strength"
                    value={botElo}
                    onChange={(e) => setBotElo(Number(e.target.value))}
                    className="px-2 py-1 rounded-lg text-xs font-mono font-semibold bg-white/90 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  >
                    {ELO_PRESETS.map((preset) => (
                      <option key={preset.elo} value={preset.elo}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="text-xs font-mono tabular-nums text-sky-600 dark:text-sky-400 whitespace-nowrap">
                  {isBotThinking
                    ? 'Bot thinking...'
                    : activeChess.isCheckmate()
                    ? 'Checkmate!'
                    : activeChess.inCheck()
                    ? 'Check!'
                    : `${activeChess.turn() === 'w' ? 'White' : 'Black'} to move`}
                </div>
              </div>

              {/* Centered Interactive Chessboard */}
              <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
                <ChessBoard
                  board={activeChess.board()}
                  flipped={boardFlipped}
                  selectedSquare={selectedSquare}
                  legalDestinations={legalDestinations}
                  lastMove={lastMove}
                  coachSuggestedMove={coachSuggestedMoveCoords}
                  onSquareClick={handleArenaSquareClick}
                  heatmapMode="none"
                />
              </div>

              {/* Bottom Player Bar & Compact Action Controls */}
              <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <span className="font-semibold text-slate-900 dark:text-white">
                    You ({playerSide === 'w' ? 'White' : 'Black'})
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {lastMoveDurationSec}s
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => resetArenaGame(playerSide === 'w' ? 'b' : 'w')}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 text-xs font-medium whitespace-nowrap shrink-0"
                  >
                    Switch Side
                  </button>
                  <button
                    type="button"
                    onClick={() => setBoardFlipped(!boardFlipped)}
                    aria-label="Flip board orientation"
                    className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-200/60 dark:hover:bg-slate-800/60"
                  >
                    <FlipHorizontal className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSoundEnabled(!soundEnabled)}
                    aria-label="Toggle move audio"
                    className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-200/60 dark:hover:bg-slate-800/60"
                  >
                    {soundEnabled ? (
                      <Volume2 className="w-3.5 h-3.5" />
                    ) : (
                      <VolumeX className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => resetArenaGame(playerSide)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 text-xs font-medium whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => saveCurrentArenaMatch(!needsAuth)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                  >
                    <CloudUpload className="w-3 h-3" />
                    <span>Save PGN</span>
                  </button>
                </div>
              </div>
            </div>

            {/* AI Coach Suggestions & Remarks Panel: 1/3 in portrait mode, side-by-side (1/3+ width) in landscape mode */}
            <div className="portrait:h-1/3 portrait:basis-1/3 flex-[1] landscape:w-5/12 lg:w-5/12 min-h-0 liquid-glass rounded-2xl p-3.5 sm:p-5 flex flex-col justify-between gap-3 overflow-y-auto">
              <div className="space-y-3">
                {/* Coach Header & Controls */}
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/70 dark:border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-sky-500 shrink-0" />
                    <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                      AI Coach Suggestions & Remarks
                    </h2>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAutoCoachEnabled(!autoCoachEnabled)}
                      className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                        autoCoachEnabled
                          ? 'bg-emerald-600 text-white'
                          : 'border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {autoCoachEnabled ? 'Auto: ON' : 'Auto: OFF'}
                    </button>
                    <button
                      type="button"
                      onClick={() => requestCoachAdvice(activeChess.fen(), activeChess.pgn())}
                      disabled={isCoachLoading}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold whitespace-nowrap shrink-0"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>{isCoachLoading ? 'Thinking...' : 'Ask Coach'}</span>
                    </button>
                  </div>
                </div>

                {/* Primary AI Move Suggestion & Tactical Remarks */}
                <div className="rounded-xl p-3 bg-slate-200/50 dark:bg-slate-900/70 border border-slate-300/70 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      Suggested Best Move:{' '}
                      <strong className="font-mono text-sm">
                        {coachAdvice?.bestMoveSan || engineCandidates[0]?.san || 'e4'}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={playCoachRecommendedMove}
                      disabled={isBotThinking || activeChess.isGameOver()}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                    >
                      <Play className="w-3 h-3" />
                      <span>Play Move</span>
                    </button>
                  </div>

                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    {coachAdvice?.explanation ||
                      `Make a move or tap "Ask Coach" for real-time grandmaster remarks tailored to your ${
                        tacticalStats[0]?.motif || 'tactical'
                      } profile.`}
                  </p>

                  {coachAdvice && (
                    <div className="pt-2 border-t border-slate-300/60 dark:border-slate-800 grid grid-cols-1 gap-1 text-xs">
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-white">
                          Motif:{' '}
                        </span>
                        <span className="text-slate-600 dark:text-slate-300">
                          {coachAdvice.tacticalMotif}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-rose-600 dark:text-rose-400">
                          Blunder Warning:{' '}
                        </span>
                        <span className="text-slate-600 dark:text-slate-300">
                          {coachAdvice.blunderWarning}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-sky-600 dark:text-sky-400">
                          Plan:{' '}
                        </span>
                        <span className="text-slate-600 dark:text-slate-300">
                          {coachAdvice.positionalPlan}
                        </span>
                      </div>
                    </div>
                  )}

                  {coachError && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      Note: {coachError}
                    </p>
                  )}
                </div>

                {/* Top 3 Real-Time Candidate Continuations */}
                <div>
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                    Candidate Moves & Evaluation
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 landscape:grid-cols-1 gap-1.5">
                    {engineCandidates.map((cand, idx) => (
                      <div
                        key={`${cand.san}-${idx}`}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-200/60 dark:bg-slate-800/60 text-xs"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-sky-600 dark:text-sky-400">
                            #{idx + 1} {cand.san}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            ({cand.from}→{cand.to})
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-600 dark:text-slate-300 truncate max-w-[120px]">
                            {cand.motifHint}
                          </span>
                          <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                            {cand.evalFormatted}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Compact Live PGN Move Notation Log */}
              <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/80">
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  <span>Match PGN Notation</span>
                  <span className="font-mono tabular-nums">
                    {activeChess.history().length} plies
                  </span>
                </div>
                <div className="max-h-16 overflow-y-auto rounded-lg p-2 bg-slate-200/50 dark:bg-slate-900/60 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                  {activeChess.pgn() || '1. Make a move on the board to begin...'}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* TAB 2: 8x8 HEATMAPS OF OPENING BLUNDERS & MISSED WINS */}
        {activeTab === 'heatmaps' && (
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div>
                <h1
                  className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white"
                  style={{ fontFamily: 'var(--font-display), sans-serif' }}
                >
                  Opening Blunder & Missed Win Heatmaps ({games.length} Games Analyzed)
                </h1>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                  Click any highlighted square on the 8x8 heatmap to inspect exact centipawn losses, opening lines, and practice the corrective position.
                </p>
              </div>

              <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-200/80 dark:bg-slate-800/90 self-start">
                <button
                  type="button"
                  onClick={() => setHeatmapFilter('opening_blunder')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    heatmapFilter === 'opening_blunder'
                      ? 'bg-rose-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Opening Blunders ({openingBlunderCount})
                </button>
                <button
                  type="button"
                  onClick={() => setHeatmapFilter('missed_win')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    heatmapFilter === 'missed_win'
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Missed Wins ({missedWinCount})
                </button>
                <button
                  type="button"
                  onClick={() => setHeatmapFilter('all')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    heatmapFilter === 'all'
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  All Critical Squares ({allBlunderEvents.length})
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-6 liquid-glass rounded-2xl p-4 sm:p-6 flex flex-col justify-between space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                  <span>
                    Mode:{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {heatmapFilter === 'opening_blunder'
                        ? 'Opening Blunders (Moves 1–12)'
                        : heatmapFilter === 'missed_win'
                        ? 'Missed Tactical Wins'
                        : 'Combined Blunders & Missed Wins'}
                    </strong>
                  </span>
                  <span className="font-mono">
                    Square: <strong>{inspectedSquare || 'None'}</strong>
                  </span>
                </div>

                <ChessBoard
                  board={heatmapChessInstance.board()}
                  selectedSquare={null}
                  legalDestinations={[]}
                  lastMove={null}
                  onSquareClick={(sq) => {
                    setInspectedSquare(sq);
                    const matching = filteredHeatmapEvents.find((e) => e.square === sq);
                    if (matching) {
                      setHeatmapPreviewFen(matching.fen);
                    }
                  }}
                  heatmapMode={heatmapFilter}
                  blunderEvents={allBlunderEvents}
                  inspectedSquare={inspectedSquare}
                />

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200/70 dark:border-slate-800/80">
                  <span>Red Squares: Opening Blunders (&ge;115cp loss)</span>
                  <span>Amber Squares: Missed Winning Continuations</span>
                </div>
              </div>

              <div className="lg:col-span-6 liquid-glass rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200/70 dark:border-slate-800/80">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      Critical Event Log ({filteredHeatmapEvents.length} Detected)
                    </h3>
                    {inspectedSquare && squareEventsForInspection.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setInspectedSquare(null)}
                        className="text-xs font-mono text-sky-600 dark:text-sky-400 hover:underline"
                      >
                        Showing square {inspectedSquare} (Show All)
                      </button>
                    )}
                  </div>

                  <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                    {(squareEventsForInspection.length > 0
                      ? squareEventsForInspection
                      : filteredHeatmapEvents
                    ).map((ev) => (
                      <div
                        key={ev.id}
                        onClick={() => {
                          setInspectedSquare(ev.square);
                          setHeatmapPreviewFen(ev.fen);
                        }}
                        className={`p-3.5 rounded-xl border transition-colors cursor-pointer ${
                          inspectedSquare === ev.square
                            ? 'bg-sky-500/10 border-sky-500/50'
                            : 'bg-slate-200/40 dark:bg-slate-900/50 border-slate-300/60 dark:border-slate-800 hover:border-slate-400'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-1">
                          <div className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
                            <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                              Square {ev.square}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>Move {ev.moveNumber}</span>
                            <span aria-hidden="true">·</span>
                            <span>{ev.openingName}</span>
                          </div>
                          <span className="font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
                            -{ev.cpLoss}cp · {ev.timeSpentSec}s spent
                          </span>
                        </div>

                        <div className="text-xs text-slate-600 dark:text-slate-300 mb-2">
                          {ev.explanation}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/70 text-xs">
                          <div className="font-mono">
                            <span className="text-rose-600 dark:text-rose-400">
                              Played: {ev.san}
                            </span>
                            <span className="mx-2 text-slate-400">→</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                              Best: {ev.bestMoveSan}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              resetArenaGame(ev.color, ev.fen);
                              setActiveTab('arena');
                            }}
                            className="px-2.5 py-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium whitespace-nowrap shrink-0"
                          >
                            Practice Position in Arena
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* TAB 3: TACTICAL PATTERN STRUGGLE IDENTIFICATION */}
        {activeTab === 'tactics' && (
          <section className="space-y-4">
            <div>
              <h1
                className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white"
                style={{ fontFamily: 'var(--font-display), sans-serif' }}
              >
                Tactical Pattern Struggle Matrix
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                Specific tactical motifs ranked by recurrence rate and centipawn impact across all {games.length} analyzed matches. Load any drill directly into the Arena tab.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {tacticalStats.map((stat) => (
                <div
                  key={stat.motif}
                  className="liquid-glass rounded-2xl p-5 flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                        {stat.motif}
                      </h3>
                      <span
                        className={`text-xs font-mono tabular-nums font-semibold ${
                          stat.struggleRate >= 35
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {stat.struggleRate}% Struggle Rate
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      <span>{stat.missedCount} missed in matches</span>
                      <span aria-hidden="true">·</span>
                      <span>Avg -{stat.avgCpLoss}cp impact</span>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed pt-1">
                      {stat.description}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-200/70 dark:border-slate-800/80 space-y-2.5">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      <strong className="text-slate-700 dark:text-slate-200">Drill: </strong>
                      {stat.drillObjective}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        resetArenaGame('w', stat.drillFen);
                        setActiveTab('arena');
                      }}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-sky-600 dark:hover:bg-sky-600 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                    >
                      <Target className="w-3.5 h-3.5" />
                      <span>Practice {stat.motif} in Arena</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* TAB 4: DASHBOARD TRENDS OVER TIME */}
        {activeTab === 'trends' && (
          <section className="space-y-6">
            <div>
              <h1
                className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white"
                style={{ fontFamily: 'var(--font-display), sans-serif' }}
              >
                Performance Trends: Elo Rating, Win Rates & Critical Move Time
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                Longitudinal telemetry tracking your rating progression, White/Black conversion efficiency, and time spent on critical tactical decisions across {games.length} matches.
              </p>
            </div>

            {/* KPI Summary Cards */}
            <div className="liquid-glass rounded-2xl p-5 grid grid-cols-2 sm:grid-cols-4 gap-6">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Current Rating</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                  {latestElo} Elo
                </div>
                <div className="text-xs text-emerald-600 dark:text-emerald-400 font-mono tabular-nums mt-0.5">
                  Tracked across {games.length} matches
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Mean Move Accuracy</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                  {avgAccuracy}%
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Evaluated across {games.length} PGNs
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Opening Blunders</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400 mt-0.5">
                  {openingBlunderCount}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Moves 1–12 (&ge;115cp loss)
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Missed Tactical Wins</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-0.5">
                  {missedWinCount}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Top struggle: {tacticalStats[0]?.motif || 'Knight Fork'}
                </div>
              </div>
            </div>

            <TrendCharts games={games} />
          </section>
        )}

        {/* TAB 5: CHESS.COM / LICHESS SYNC & GOOGLE DRIVE PGN VAULT */}
        {activeTab === 'archive' && (
          <section className="space-y-6">
            {/* Import & Sync Toolbar Card */}
            <div className="liquid-glass rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                  <h1
                    className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white"
                    style={{ fontFamily: 'var(--font-display), sans-serif' }}
                  >
                    Chess.com & Lichess Full History Sync + Google Drive PGN Vault
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                    Import and analyze every game you have played on Chess.com or Lichess, and archive annotated PGN files to your Google Drive.
                  </p>
                </div>

                <form
                  onSubmit={handleImportExternalGames}
                  className="flex flex-wrap sm:flex-nowrap items-center gap-2"
                >
                  <div className="flex items-center p-1 rounded-lg bg-slate-200/80 dark:bg-slate-800/90">
                    <button
                      type="button"
                      onClick={() => setImportPlatform('lichess')}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        importPlatform === 'lichess'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Lichess
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportPlatform('chesscom')}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        importPlatform === 'chesscom'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Chess.com
                    </button>
                  </div>

                  <input
                    type="text"
                    value={importUsername}
                    onChange={(e) => setImportUsername(e.target.value)}
                    placeholder="Username (e.g. Hikaru)"
                    aria-label="Chess.com or Lichess username"
                    className="px-3 py-2 text-xs rounded-lg bg-white/90 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-2 focus:outline-sky-500 w-40 sm:w-44"
                  />

                  <button
                    type="submit"
                    disabled={isImporting}
                    className="px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                  >
                    {isImporting ? 'Analyzing All...' : 'Sync All Games'}
                  </button>
                </form>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200/70 dark:border-slate-800/80">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPgnModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 text-xs font-medium whitespace-nowrap shrink-0"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Paste Custom PGN</span>
                  </button>

                  {!needsAuth && (
                    <button
                      type="button"
                      onClick={fetchDriveFiles}
                      disabled={isSyncingDrive}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 text-xs font-medium whitespace-nowrap shrink-0"
                    >
                      <FolderSync className="w-3.5 h-3.5" />
                      <span>Refresh Drive Files</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleSyncAllGamesToDrive}
                    disabled={isSyncingDrive}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                  >
                    <CloudUpload className="w-3.5 h-3.5" />
                    <span>Archive All {games.length} Games as PGN to Drive</span>
                  </button>
                </div>

                {user && (
                  <button
                    type="button"
                    onClick={handleGoogleLogout}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0"
                  >
                    Sign Out ({user.email?.split('@')[0]})
                  </button>
                )}
              </div>

              {(importFeedback || driveStatus) && (
                <div className="pt-2 text-xs font-medium text-sky-600 dark:text-sky-400">
                  {importFeedback || driveStatus}
                </div>
              )}
            </div>

            {/* Saved Google Drive PGN Files List (when authenticated) */}
            {!needsAuth && driveFiles.length > 0 && (
              <div className="liquid-glass rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Google Drive PGN Files ({driveFiles.length} Stored)
                  </h3>
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">
                    Synced with Google Drive
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {driveFiles.map((file) => (
                    <div
                      key={file.id}
                      className="p-3.5 rounded-xl bg-slate-200/50 dark:bg-slate-900/60 border border-slate-300/70 dark:border-slate-800 flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white truncate">
                          <FileText className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                          <span className="truncate">{file.name}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                          {file.description || 'Annotated Chess PGN file'}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-300/50 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => loadPgnFromDrive(file)}
                          className="text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap"
                        >
                          Load into Analyzer
                        </button>
                        <button
                          type="button"
                          onClick={() => requestDeleteDriveFile(file)}
                          aria-label={`Delete ${file.name} from Google Drive`}
                          className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400 hover:underline whitespace-nowrap"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* High-Density Analyzed Match Table */}
            <div className="liquid-glass rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200/80 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      <th className="py-3.5 px-4">Date & Source</th>
                      <th className="py-3.5 px-4">Matchup & Elo</th>
                      <th className="py-3.5 px-4">Opening (ECO)</th>
                      <th className="py-3.5 px-4 text-right">Outcome</th>
                      <th className="py-3.5 px-4 text-right">Accuracy</th>
                      <th className="py-3.5 px-4 text-right">Critical Clock</th>
                      <th className="py-3.5 px-4 text-right">PGN & Drive Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/70 text-xs">
                    {games.slice(0, visibleGamesLimit).map((g) => (
                      <tr
                        key={g.id}
                        className="hover:bg-slate-200/40 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                          <div className="text-slate-900 dark:text-slate-100 font-medium">
                            {g.date}
                          </div>
                          <div className="text-slate-500 dark:text-slate-400">{g.source}</div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900 dark:text-white">
                            {g.white} vs {g.black}
                          </div>
                          <div className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            Player: {g.playerElo} Elo · Opp: {g.opponentElo} Elo
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-800 dark:text-slate-200">
                            {g.opening}
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 font-mono">
                            {g.eco} · {g.blunders.length} critical event(s)
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          <span
                            className={`font-semibold ${
                              g.outcome === 'win'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : g.outcome === 'loss'
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {g.outcome.toUpperCase()} ({g.result})
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold">
                          {g.accuracy}%
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          <span className="inline-flex items-center gap-1 justify-end">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {g.avgCriticalMoveTimeSec}s
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => downloadPgnLocally(g)}
                              title="Download annotated PGN file"
                              className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-800"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => uploadSingleGameToDrive(g)}
                              disabled={isSyncingDrive}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium whitespace-nowrap"
                            >
                              {g.driveFileId ? (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Update Drive</span>
                                </>
                              ) : (
                                <>
                                  <CloudUpload className="w-3.5 h-3.5" />
                                  <span>Save to Drive</span>
                                </>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {games.length > visibleGamesLimit && (
                <div className="px-4 py-3 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-4 text-xs">
                  <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    Showing {visibleGamesLimit} of {games.length} analyzed games (100% included in Heatmaps & Trends)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setVisibleGamesLimit((prev) => prev + 50)}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 font-medium whitespace-nowrap"
                    >
                      Show 50 More
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisibleGamesLimit(games.length)}
                      className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold whitespace-nowrap"
                    >
                      Show All ({games.length})
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {/* Modal 1: Mandatory Explicit User Confirmation Dialog for Destructive / Mutating Google Drive Operations */}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <div className="w-full max-w-md liquid-glass-strong rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 id="confirm-dialog-title" className="text-base font-bold">
                {confirmDialog.title}
              </h3>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {confirmDialog.description}
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-200/60 dark:hover:bg-slate-800/60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Paste Custom PGN for Instant Blunder & Tactical Analysis */}
      {showPgnModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg liquid-glass-strong rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Analyze Custom PGN Game
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Paste any standard PGN from Chess.com, Lichess, or over-the-board notation to detect opening blunders, missed wins, and tactical motifs.
            </p>
            <textarea
              rows={7}
              value={customPgnInput}
              onChange={(e) => setCustomPgnInput(e.target.value)}
              placeholder={`[Event "Live Chess"]\n[White "Player1"]\n[Black "Player2"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6...`}
              className="w-full rounded-xl p-3 font-mono text-xs bg-white/90 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            />
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowPgnModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAnalyzeCustomPgn}
                className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
              >
                Run Tactical Analysis
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: iOS Safari PWA Home Screen Installation Guide */}
      {showIOSGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm liquid-glass-strong rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Install GlassChess on iPhone / iPad
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              1. Tap the <strong>Share</strong> button in your Safari toolbar.
              <br />
              2. Scroll down and tap <strong>Add to Home Screen</strong> for full-screen offline bot practice and PGN analysis.
            </p>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full py-2 rounded-lg bg-sky-600 text-white text-xs font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
