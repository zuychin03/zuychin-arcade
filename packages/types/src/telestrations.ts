export type TelestrationsScoringMode = 'none' | 'friendly' | 'competitive';
export type TelestrationsPhase = 'prompt' | 'draw' | 'guess' | 'reveal' | 'scoring' | 'round_end' | 'game_over';
export interface TelestrationsDrawing {
    strokes: {
        color: number;
        width: number;
        points: [
            number,
            number
        ][];
    }[];
}
export type TelestrationsContent = string | TelestrationsDrawing;
export interface TelestrationsPlayer {
    id: string;
    displayName: string;
    score: number;
    forfeited: boolean;
}
export interface TelestrationsPage {
    kind: 'draw' | 'guess';
    authorId: string;
    content: TelestrationsContent;
}
export interface TelestrationsBook {
    ownerId: string;
    prompt: string;
    pages: TelestrationsPage[];
}
export interface TelestrationsOptions {
    scoringMode?: TelestrationsScoringMode;
    category?: string;
    direction?: 1 | -1;
}
export interface TelestrationsDraft {
    revision: number;
    content: TelestrationsContent | null;
    submitted: boolean;
}
export interface TelestrationsState {
    gameId: 'telestrations';
    roomCode: string;
    revision: number;
    epoch: number;
    windowId: string;
    phase: TelestrationsPhase;
    players: TelestrationsPlayer[];
    seats: string[];
    scoringMode: TelestrationsScoringMode;
    category: string | null;
    direction: 1 | -1;
    completedRounds: number;
    step: number;
    books: TelestrationsBook[];
    choices: Record<string, string[]>;
    drafts: Record<string, TelestrationsDraft>;
    revealBook: number;
    revealPage: number;
    pendingScores: Record<string, number>;
    winnerIds: string[];
    endReason: 'completed' | 'insufficient_players' | null;
    cancelledRounds: {
        epoch: number;
        forfeitedIds: string[];
    }[];
}
export interface TelestrationsSubmission {
    windowId: string;
    seatToken: string;
    draftRevision: number;
    content: TelestrationsContent;
}
export interface TelestrationsScoreVerdict {
    expectedRevision: number;
    favouriteDrawing?: number;
    favouriteGuess?: number;
    matches?: boolean[];
    finalMatch?: boolean;
}
export type TelestrationsResult = {
    ok: true;
} | {
    ok: false;
    error: string;
};
export interface TelestrationsPublicState {
    gameId: 'telestrations';
    roomCode: string;
    revision: number;
    phase: TelestrationsPhase;
    players: TelestrationsPlayer[];
    seats: string[];
    scoringMode: TelestrationsScoringMode;
    category: string | null;
    direction: 1 | -1;
    completedRounds: number;
    step: number;
    readyIds: string[];
    revealBook: number;
    revealPage: number;
    revealOwnerId: string | null;
    revealed: TelestrationsPage | {
        kind: 'prompt';
        content: string;
    } | null;
    scoringPages: {
        index: number;
        kind: 'draw' | 'guess';
        authorId: string;
    }[];
    pendingScores: Record<string, number>;
    winnerIds: string[];
    endReason: TelestrationsState['endReason'];
    cancelledRounds: TelestrationsState['cancelledRounds'];
}
export interface TelestrationsPrivateState {
    gameId: 'telestrations';
    roomCode: string;
    playerId: string;
    revision: number;
    windowId: string | null;
    seatToken: string | null;
    choices: string[];
    draft: TelestrationsDraft | null;
    predecessor: TelestrationsPage | {
        kind: 'prompt';
        content: string;
    } | null;
}
