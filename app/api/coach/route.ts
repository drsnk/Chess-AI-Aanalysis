import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      fen,
      pgn,
      turn,
      legalMoves,
      engineCandidates,
      playerStruggles,
      mode = 'realtime',
    } = body;

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not configured in Settings > Secrets.' },
        { status: 500 }
      );
    }

    if (mode === 'summary') {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Analyze this chess player's recent game archive and tactical profile:
Player Tactical Struggles: ${JSON.stringify(playerStruggles || [])}
Sample PGN / Recent Game Context: ${pgn || 'Various Blitz/Rapid games'}

Provide a concise, actionable grandmaster coaching plan covering:
1. Primary opening leak to fix immediately.
2. Core tactical pattern drill recommendation.
3. Time management habit for critical middlegame transitions.`,
        config: {
          systemInstruction:
            'You are a Grandmaster Chess Strategy Coach. Provide direct, concrete, high-signal chess advice grounded in board squares, opening structures, and tactical motifs.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              openingDiagnosis: { type: Type.STRING },
              tacticalPrescription: { type: Type.STRING },
              timeManagementRule: { type: Type.STRING },
            },
            required: [
              'headline',
              'openingDiagnosis',
              'tacticalPrescription',
              'timeManagementRule',
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      return NextResponse.json(parsed);
    }

    const prompt = `Current Chess Position (FEN): ${fen}
Side to Move: ${turn === 'w' ? 'White' : 'Black'}
Move History (PGN): ${pgn || 'Opening position'}
Legal Moves Available: ${(legalMoves || []).slice(0, 30).join(', ')}
Local Engine Top Candidates: ${JSON.stringify(engineCandidates || [])}
Player's Known Tactical Weaknesses: ${JSON.stringify(playerStruggles || [])}

Select the best move from the legal moves, explain the strategic and tactical reasoning in 1-2 crisp sentences, highlight any immediate opponent threat or tactical motif (Fork, Pin, Skewer, Back-Rank, Outpost, Center Control), and warn against a common blunder in this structure.`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are an elite real-time Chess Coach. Always recommend a move that exists in the provided Legal Moves list. Keep explanations sharp, specific to squares, and immediately helpful during gameplay.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            bestMoveSan: {
              type: Type.STRING,
              description: 'Recommended move in Standard Algebraic Notation from legalMoves.',
            },
            tacticalMotif: {
              type: Type.STRING,
              description: 'Primary tactical or positional theme (e.g. Knight Outpost, Pin on f6, Central Break).',
            },
            explanation: {
              type: Type.STRING,
              description: 'Concise 1-2 sentence explanation of why this move works.',
            },
            blunderWarning: {
              type: Type.STRING,
              description: 'Specific trap or mistake to avoid on this turn.',
            },
            positionalPlan: {
              type: Type.STRING,
              description: 'Next 2-3 move strategic goal for the active player.',
            },
          },
          required: [
            'bestMoveSan',
            'tacticalMotif',
            'explanation',
            'blunderWarning',
            'positionalPlan',
          ],
        },
      },
    });

    const jsonText = (response.text ?? '{}').trim();
    const data = JSON.parse(jsonText);
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to generate AI coach insight.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
