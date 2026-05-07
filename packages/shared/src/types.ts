export type CardSuit = "clubs" | "diamonds" | "hearts" | "spades";
export type DealerBidRule = "none" | "no-equal-total" | "canadian";

export type Card =
  | {
      id: string;
      kind: "wizard" | "jester";
      label: string;
    }
  | {
      id: string;
      kind: "number";
      suit: CardSuit;
      rank: number;
      label: string;
    };

export type TrickPlay = {
  playerId: string;
  card: Card;
};

export type TrickResult = {
  plays: TrickPlay[];
  winnerId: string;
  leadSuit: CardSuit | null;
};

export type RoomOptions = {
  playerCount: number;
  hiddenBids: boolean;
  dealerBidRule: DealerBidRule;
  scoreBonus: number;
  exactTrickPoints: number;
  missPenalty: number;
};

export type RoomStatus = "lobby" | "in-game" | "finished";

export type RoomPlayer = {
  id: string;
  name: string;
  seat: number;
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
};

export type TrumpState = {
  trumpCard: Card | null;
  trumpSuit: CardSuit | null;
  needsDealerChoice: boolean;
};

export type RoundState = {
  handSize: number;
  dealerIndex: number;
  leaderIndex: number;
  activePlayerIndex: number;
  bids: Record<string, number | null>;
  taken: Record<string, number>;
  hands: Record<string, Card[]>;
  currentTrick: TrickPlay[];
  completedTricks: TrickResult[];
  trump: TrumpState;
};

export type RoundSummary = {
  handSize: number;
  bids: Record<string, number>;
  taken: Record<string, number>;
  scoreDeltas: Record<string, number>;
};

export type DevTimelineEntry = {
  id: string;
  handNumber: number;
  message: string;
};

export type GameState = {
  phase: "choose-trump" | "bidding" | "playing" | "game-over";
  options: RoomOptions;
  playerOrder: string[];
  dealerIndex: number;
  roundNumber: number;
  maxRounds: number;
  scores: Record<string, number>;
  currentRound: RoundState;
  previousRoundSummary: RoundSummary | null;
  winnerIds: string[] | null;
  devTimeline: DevTimelineEntry[];
};

export type RoomState = {
  code: string;
  status: RoomStatus;
  options: RoomOptions;
  hostPlayerId: string;
  players: RoomPlayer[];
  game: GameState | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicPlayerState = RoomPlayer & {
  score: number;
  bid: number | null;
  taken: number;
  handCount: number;
};

export type PublicGameState = {
  phase: GameState["phase"];
  roundNumber: number;
  maxRounds: number;
  dealerIndex: number;
  activePlayerId: string;
  trumpSuit: CardSuit | null;
  trumpCard: Card | null;
  needsDealerChoice: boolean;
  handSize: number;
  currentTrick: TrickPlay[];
  completedTrickCount: number;
  players: PublicPlayerState[];
  yourHand: Card[];
  allowedBids: number[];
  playableCardIds: string[];
  previousRoundSummary: RoundSummary | null;
  winnerIds: string[] | null;
  devTimeline: DevTimelineEntry[];
};

export type PublicRoomState = {
  code: string;
  status: RoomStatus;
  options: RoomOptions;
  hostPlayerId: string;
  players: RoomPlayer[];
  game: PublicGameState | null;
  selfPlayerId: string;
};
