import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform') || 'lichess';
  const username = (searchParams.get('username') || '').trim();
  const mode = searchParams.get('mode') || 'all';
  const archiveUrl = searchParams.get('archiveUrl');

  try {
    if (platform === 'chesscom') {
      // If fetching a specific monthly archive URL directly
      if (archiveUrl) {
        if (!archiveUrl.startsWith('https://api.chess.com/pub/player/')) {
          return NextResponse.json({ error: 'Invalid Chess.com archive URL.' }, { status: 400 });
        }
        const gamesRes = await fetch(archiveUrl, {
          headers: {
            'User-Agent': 'GlassChessTactician/1.0',
            Accept: 'application/json',
          },
        });
        if (!gamesRes.ok) {
          return NextResponse.json(
            { error: 'Failed to fetch monthly archive from Chess.com.' },
            { status: gamesRes.status }
          );
        }
        const gamesData = await gamesRes.json();
        const pgns: string[] = (gamesData.games || [])
          .filter((g: { pgn?: string }) => Boolean(g.pgn))
          .map((g: { pgn: string }) => g.pgn)
          .reverse();

        return NextResponse.json({ pgns, source: 'chess.com' });
      }

      if (!username) {
        return NextResponse.json({ error: 'Username is required.' }, { status: 400 });
      }

      const archivesRes = await fetch(
        `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`,
        {
          headers: {
            'User-Agent': 'GlassChessTactician/1.0',
            Accept: 'application/json',
          },
        }
      );

      if (!archivesRes.ok) {
        return NextResponse.json(
          { error: `Chess.com player "${username}" not found or unavailable.` },
          { status: archivesRes.status }
        );
      }

      const archivesData = await archivesRes.json();
      const archives: string[] = archivesData.archives || [];
      if (archives.length === 0) {
        return NextResponse.json({ archives: [], pgns: [], source: 'chess.com', username });
      }

      // If client requests the archive list to stream month-by-month with live progress
      if (mode === 'archives') {
        return NextResponse.json({
          archives: [...archives].reverse(),
          source: 'chess.com',
          username,
        });
      }

      // Otherwise fetch all monthly archives in parallel batches
      const allPgns: string[] = [];
      const reversedArchives = [...archives].reverse();
      const batchSize = 6;

      for (let i = 0; i < reversedArchives.length; i += batchSize) {
        const batch = reversedArchives.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (url) => {
            try {
              const res = await fetch(url, {
                headers: {
                  'User-Agent': 'GlassChessTactician/1.0',
                  Accept: 'application/json',
                },
              });
              if (!res.ok) return [];
              const data = await res.json();
              return (data.games || [])
                .filter((g: { pgn?: string }) => Boolean(g.pgn))
                .map((g: { pgn: string }) => g.pgn)
                .reverse();
            } catch {
              return [];
            }
          })
        );
        for (const monthPgns of batchResults) {
          allPgns.push(...monthPgns);
        }
      }

      return NextResponse.json({ pgns: allPgns, source: 'chess.com', username });
    } else {
      if (!username) {
        return NextResponse.json({ error: 'Username is required.' }, { status: 400 });
      }

      // Lichess public API — fetch all games for user (no 12-game limit)
      const lichessRes = await fetch(
        `https://lichess.org/api/games/user/${encodeURIComponent(
          username
        )}?clocks=true&opening=true`,
        {
          headers: {
            Accept: 'application/x-chess-pgn',
          },
        }
      );

      if (!lichessRes.ok) {
        return NextResponse.json(
          { error: `Lichess player "${username}" not found or rate limited.` },
          { status: lichessRes.status }
        );
      }

      const text = await lichessRes.text();
      const pgns = text
        .split(/\n\n+(?=\[Event )/)
        .map((p) => p.trim())
        .filter((p) => p.length > 20);

      return NextResponse.json({ pgns, source: 'lichess.org', username });
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to fetch games from upstream server.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
