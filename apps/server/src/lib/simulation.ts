import {
  addPlayerToRoom,
  chooseTrump,
  getAllowedBids,
  getPlayableCardIds,
  playCard,
  submitBid,
  type Card,
  type CardSuit,
  type GameState,
  type RoomState,
} from "@wizard/shared";

const BOT_NAMES = [
  "Clockwork Crow",
  "Arc Lamp",
  "Tin Fox",
  "North Wind",
  "Salt Bishop",
];

const SUITS: CardSuit[] = ["clubs", "diamonds", "hearts", "spades"];
const MAX_SIMULATION_STEPS = 512;

export function seedSimulatedBots(room: RoomState, createPlayerId: () => string): RoomState {
  let nextRoom = room;
  const missingPlayers = room.options.playerCount - room.players.length;

  for (let index = 0; index < missingPlayers; index += 1) {
    const name = BOT_NAMES[index] ?? `Bot ${index + 1}`;
    nextRoom = addPlayerToRoom(nextRoom, createPlayerId(), name, true);
  }

  return nextRoom;
}

export function advanceSimulatedRoom(room: RoomState): RoomState {
  if (!room.game) {
    return room;
  }

  let nextRoom = room;

  for (let step = 0; step < MAX_SIMULATION_STEPS; step += 1) {
    const nextStep = stepSimulatedRoom(nextRoom);
    if (!nextStep) {
      return nextRoom;
    }
    nextRoom = nextStep;
  }

  throw new Error("Simulated game exceeded the maximum number of automated steps.");
}

export function stepSimulatedRoom(room: RoomState): RoomState | null {
  const game = room.game;
  if (!game || game.phase === "game-over") {
    return null;
  }

  if (game.phase === "choose-trump") {
    const dealerId = game.playerOrder[game.currentRound.dealerIndex]!;
    const dealer = room.players.find((player) => player.id === dealerId);
    if (!dealer?.isBot) {
      return null;
    }

    return chooseTrump(room, dealerId, pickTrumpSuit(game, dealerId));
  }

  const activePlayerId = game.playerOrder[game.currentRound.activePlayerIndex]!;
  const activePlayer = room.players.find((player) => player.id === activePlayerId);
  if (!activePlayer?.isBot) {
    return null;
  }

  if (game.phase === "bidding") {
    return submitBid(room, activePlayerId, pickBid(game, activePlayerId));
  }

  if (game.phase === "playing") {
    return playCard(room, activePlayerId, pickCard(game, activePlayerId));
  }

  return null;
}

function pickTrumpSuit(game: GameState, playerId: string): CardSuit {
  const hand = game.currentRound.hands[playerId] ?? [];
  const scores = new Map<CardSuit, number>(SUITS.map((suit) => [suit, 0]));

  for (const card of hand) {
    if (card.kind === "number") {
      scores.set(card.suit, (scores.get(card.suit) ?? 0) + card.rank);
      continue;
    }

    if (card.kind === "wizard") {
      for (const suit of SUITS) {
        scores.set(suit, (scores.get(suit) ?? 0) + 8);
      }
    }
  }

  return SUITS.reduce((best, suit) => ((scores.get(suit) ?? 0) > (scores.get(best) ?? 0) ? suit : best), SUITS[0]!);
}

function pickBid(game: GameState, playerId: string): number {
  const allowedBids = getAllowedBids(game, playerId);
  if (allowedBids.length === 0) {
    throw new Error("Simulated bidder has no legal bids.");
  }

  const hand = game.currentRound.hands[playerId] ?? [];
  const trumpSuit = game.currentRound.trump.trumpSuit;
  const projectedTricks = hand.reduce((total, card) => total + estimateTrickValue(card, trumpSuit), 0);
  const targetBid = Math.max(0, Math.min(game.currentRound.handSize, Math.round(projectedTricks)));

  return allowedBids.reduce((best, bid) => {
    const bestDistance = Math.abs(best - targetBid);
    const nextDistance = Math.abs(bid - targetBid);
    if (nextDistance !== bestDistance) {
      return nextDistance < bestDistance ? bid : best;
    }

    return bid < best ? bid : best;
  }, allowedBids[0]!);
}

function pickCard(game: GameState, playerId: string): string {
  const playableCardIds = new Set(getPlayableCardIds(game, playerId));
  const playableCards = (game.currentRound.hands[playerId] ?? []).filter((card) => playableCardIds.has(card.id));

  if (playableCards.length === 0) {
    throw new Error("Simulated player has no legal cards.");
  }

  const bid = game.currentRound.bids[playerId] ?? 0;
  const taken = game.currentRound.taken[playerId] ?? 0;
  const leadSuit = getLeadSuit(game.currentRound.currentTrick);
  const trumpSuit = game.currentRound.trump.trumpSuit;
  const shouldChaseTrick = taken < bid;
  const sortedCards = playableCards
    .slice()
    .sort((left, right) => cardStrength(left, trumpSuit, leadSuit) - cardStrength(right, trumpSuit, leadSuit));

  return (shouldChaseTrick ? sortedCards.at(-1) : sortedCards[0])!.id;
}

function estimateTrickValue(card: Card, trumpSuit: CardSuit | null): number {
  if (card.kind === "wizard") {
    return 1;
  }

  if (card.kind === "jester") {
    return 0;
  }

  const numberCard = card as Extract<Card, { kind: "number" }>;
  let score = 0;
  if (numberCard.rank >= 13) {
    score += 0.75;
  } else if (numberCard.rank >= 11) {
    score += 0.5;
  } else if (numberCard.rank >= 9) {
    score += 0.25;
  }

  if (trumpSuit !== null && numberCard.suit === trumpSuit) {
    score += 0.5;
  }

  return score;
}

function cardStrength(card: Card, trumpSuit: CardSuit | null, leadSuit: CardSuit | null): number {
  if (card.kind === "wizard") {
    return 10_000;
  }

  if (card.kind === "jester") {
    return -1;
  }

  const numberCard = card as Extract<Card, { kind: "number" }>;
  let score = numberCard.rank;
  if (leadSuit !== null && numberCard.suit === leadSuit) {
    score += 100;
  }
  if (trumpSuit !== null && numberCard.suit === trumpSuit) {
    score += 200;
  }

  return score;
}

function getLeadSuit(currentTrick: GameState["currentRound"]["currentTrick"]): CardSuit | null {
  for (const play of currentTrick) {
    if (play.card.kind === "wizard") {
      return null;
    }

    if (play.card.kind === "number") {
      return play.card.suit;
    }
  }

  return null;
}
