import type {
  Card,
  CardSuit,
  DealerBidRule,
  GameState,
  PublicGameState,
  PublicPlayerState,
  PublicRoomState,
  RoomOptions,
  RoomPlayer,
  RoomState,
  RoundState,
  RoundSummary,
  RoundHistoryEntry,
  TrickPlay,
  TrickResult,
} from "./types.js";

const SUITS: CardSuit[] = ["clubs", "diamonds", "hearts", "spades"];
const SUIT_LABELS: Record<CardSuit, string> = {
  clubs: "C",
  diamonds: "D",
  hearts: "H",
  spades: "S",
};

export const DEFAULT_ROOM_OPTIONS: RoomOptions = {
  playerCount: 4,
  hiddenBids: false,
  dealerBidRule: "none",
  scoreBonus: 20,
  exactTrickPoints: 10,
  missPenalty: 10,
};

export function calculateMaxRounds(playerCount: number): number {
  return Math.floor(60 / playerCount);
}

export function normalizeOptions(input: Partial<RoomOptions>): RoomOptions {
  const playerCount = clamp(input.playerCount ?? DEFAULT_ROOM_OPTIONS.playerCount, 3, 6);

  return {
    playerCount,
    hiddenBids: input.hiddenBids ?? DEFAULT_ROOM_OPTIONS.hiddenBids,
    dealerBidRule: input.dealerBidRule ?? DEFAULT_ROOM_OPTIONS.dealerBidRule,
    scoreBonus: clamp(input.scoreBonus ?? DEFAULT_ROOM_OPTIONS.scoreBonus, 0, 100),
    exactTrickPoints: clamp(input.exactTrickPoints ?? DEFAULT_ROOM_OPTIONS.exactTrickPoints, 0, 50),
    missPenalty: clamp(input.missPenalty ?? DEFAULT_ROOM_OPTIONS.missPenalty, 0, 50),
  };
}

export function createDeck(): Card[] {
  const deck: Card[] = [];

  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank += 1) {
      deck.push({
        id: `${suit}-${rank}`,
        kind: "number",
        suit,
        rank,
        label: `${rankToLabel(rank)}${SUIT_LABELS[suit]}`,
      });
    }
  }

  for (let index = 0; index < 4; index += 1) {
    deck.push({ id: `wizard-${index}`, kind: "wizard", label: "W" });
    deck.push({ id: `jester-${index}`, kind: "jester", label: "J" });
  }

  return deck;
}

export function shuffleDeck(deck: Card[], random = Math.random): Card[] {
  return shuffleArray(deck, random);
}

function shuffleArray<T>(items: T[], random: () => number): T[] {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

export function createRoomState(code: string, hostPlayerId: string, hostName: string, options: Partial<RoomOptions>): RoomState {
  const normalized = normalizeOptions(options);
  const now = new Date().toISOString();

  return {
    code,
    status: "lobby",
    options: normalized,
    hostPlayerId,
    players: [
      {
        id: hostPlayerId,
        name: hostName,
        seat: 0,
        isHost: true,
        isBot: false,
        connected: true,
      },
    ],
    game: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function addPlayerToRoom(room: RoomState, playerId: string, playerName: string, isBot = false): RoomState {
  if (room.players.some((player) => player.id === playerId)) {
    return touchRoom({
      ...room,
      players: room.players.map((player) =>
        player.id === playerId ? { ...player, name: playerName, isBot, connected: true } : player,
      ),
    });
  }

  if (room.players.length >= room.options.playerCount) {
    throw new Error("Room is full.");
  }

  return touchRoom({
    ...room,
    players: [
      ...room.players,
      {
        id: playerId,
        name: playerName,
        seat: room.players.length,
        isHost: false,
        isBot,
        connected: true,
      },
    ],
  });
}

export function setPlayerConnection(room: RoomState, playerId: string, connected: boolean): RoomState {
  return touchRoom({
    ...room,
    players: room.players.map((player) => (player.id === playerId ? { ...player, connected } : player)),
  });
}

export function renamePlayer(room: RoomState, playerId: string, playerName: string): RoomState {
  if (room.status !== "lobby") {
    throw new Error("Player names can only be changed before the game starts.");
  }

  const hasPlayer = room.players.some((player) => player.id === playerId);
  if (!hasPlayer) {
    throw new Error("Player not found.");
  }

  return touchRoom({
    ...room,
    players: room.players.map((player) => (player.id === playerId ? { ...player, name: playerName } : player)),
  });
}

export function updateRoomOptions(room: RoomState, playerId: string, options: Partial<RoomOptions>): RoomState {
  if (room.hostPlayerId !== playerId) {
    throw new Error("Only the host can change room options.");
  }

  if (room.status !== "lobby") {
    throw new Error("Options can only be changed before the game starts.");
  }

  const nextOptions = normalizeOptions({ ...room.options, ...options });

  if (nextOptions.playerCount < room.players.length) {
    throw new Error("Player count cannot be set below the number of joined players.");
  }

  return touchRoom({
    ...room,
    options: nextOptions,
  });
}

export function startGame(room: RoomState, random = Math.random): RoomState {
  if (room.hostPlayerId !== room.players.find((player) => player.isHost)?.id) {
    throw new Error("Invalid host state.");
  }

  if (room.players.length !== room.options.playerCount) {
    throw new Error("The room must have the configured number of players before starting.");
  }

  const seatedPlayers = shufflePlayersForGame(room.players, random);
  const playerOrder = seatedPlayers.map((player) => player.id);
  const dealerIndex = Math.floor(random() * playerOrder.length);

  const scores = Object.fromEntries(playerOrder.map((playerId) => [playerId, 0]));

  const game = createGameState(playerOrder, dealerIndex, scores, room.options, random);

  return touchRoom({
    ...room,
    status: "in-game",
    players: seatedPlayers,
    game,
  });
}

export function chooseTrump(room: RoomState, playerId: string, suit: CardSuit): RoomState {
  const game = requireGame(room);
  const round = game.currentRound;
  const dealerId = game.playerOrder[round.dealerIndex];

  if (game.phase !== "choose-trump") {
    throw new Error("Trump choice is not pending.");
  }

  if (dealerId !== playerId) {
    throw new Error("Only the dealer can choose trump.");
  }

  const nextGame: GameState = {
    ...game,
    phase: "bidding",
    currentRound: {
      ...round,
      trump: {
        ...round.trump,
        trumpSuit: suit,
        needsDealerChoice: false,
      },
    },
  };

  return withGame(room, nextGame);
}

export function submitBid(room: RoomState, playerId: string, bid: number): RoomState {
  const game = requireGame(room);

  if (game.phase !== "bidding") {
    throw new Error("Bidding is not active.");
  }

  const currentBidderId = getActiveBidderId(game);
  if (currentBidderId !== playerId) {
    throw new Error("It is not your turn to bid.");
  }

  const allowedBids = getAllowedBids(game, playerId);
  if (!allowedBids.includes(bid)) {
    throw new Error("That bid is not allowed.");
  }

  const nextBids = { ...game.currentRound.bids, [playerId]: bid };
  const allBidsPlaced = Object.values(nextBids).every((value) => value !== null);

  const nextRound: RoundState = {
    ...game.currentRound,
    bids: nextBids,
    activePlayerIndex: allBidsPlaced ? game.currentRound.leaderIndex : getNextBidderIndex(game, nextBids),
  };

  const nextGame: GameState = {
    ...game,
    phase: allBidsPlaced ? "playing" : "bidding",
    currentRound: nextRound,
  };

  return withGame(room, nextGame);
}

export function playCard(room: RoomState, playerId: string, cardId: string, random = Math.random): RoomState {
  const game = requireGame(room);

  if (game.phase !== "playing") {
    throw new Error("The round is not in the play phase.");
  }

  const activePlayerId = game.playerOrder[game.currentRound.activePlayerIndex];
  if (activePlayerId !== playerId) {
    throw new Error("It is not your turn to play.");
  }

  const hand = game.currentRound.hands[playerId];
  const card = hand.find((candidate) => candidate.id === cardId);
  if (!card) {
    throw new Error("Card not found in your hand.");
  }

  const playableIds = new Set(getPlayableCardIds(game, playerId));
  if (!playableIds.has(cardId)) {
    throw new Error("That card cannot be played right now.");
  }

  const nextHands = {
    ...game.currentRound.hands,
    [playerId]: hand.filter((candidate) => candidate.id !== cardId),
  };

  const nextTrick = [...game.currentRound.currentTrick, { playerId, card }];
  const trickComplete = nextTrick.length === game.playerOrder.length;

  if (!trickComplete) {
    const nextGame: GameState = {
      ...game,
      lastResolvedTrick: null,
      currentRound: {
        ...game.currentRound,
        hands: nextHands,
        currentTrick: nextTrick,
        activePlayerIndex: getNextSeatIndex(game.currentRound.activePlayerIndex, game.playerOrder.length),
      },
    };

    return withGame(room, nextGame);
  }

  const trickResult = resolveTrick(nextTrick, game.currentRound.trump.trumpSuit);
  const nextTaken = {
    ...game.currentRound.taken,
    [trickResult.winnerId]: game.currentRound.taken[trickResult.winnerId] + 1,
  };

  const completedTricks = [...game.currentRound.completedTricks, trickResult];
  const handFinished = completedTricks.length === game.currentRound.handSize;

  if (!handFinished) {
    const winnerIndex = game.playerOrder.indexOf(trickResult.winnerId);
    const nextGame: GameState = {
      ...game,
      lastResolvedTrick: trickResult,
      currentRound: {
        ...game.currentRound,
        hands: nextHands,
        currentTrick: [],
        completedTricks,
        taken: nextTaken,
        leaderIndex: winnerIndex,
        activePlayerIndex: winnerIndex,
      },
    };

    return withGame(room, nextGame);
  }

  return withGame(room, advanceAfterRound(game, nextHands, nextTaken, completedTricks, random));
}

export function startNextRound(room: RoomState, playerId: string, random = Math.random): RoomState {
  const game = requireGame(room);

  if (room.hostPlayerId !== playerId) {
    throw new Error("Only the host can start the next round.");
  }

  if (game.phase !== "round-summary") {
    throw new Error("The game is not waiting to start the next round.");
  }

  const nextDealerIndex = getNextSeatIndex(game.currentRound.dealerIndex, game.playerOrder.length);
  const nextRoundNumber = game.roundNumber + 1;
  const nextRound = createRound(game.playerOrder, nextDealerIndex, nextRoundNumber, random);

  return withGame(room, {
    ...game,
    phase: nextRound.trump.needsDealerChoice ? "choose-trump" : "bidding",
    dealerIndex: nextDealerIndex,
    roundNumber: nextRoundNumber,
    previousRoundSummary: null,
    winnerIds: null,
    currentRound: nextRound,
  });
}

export function getAllowedBids(game: GameState, playerId: string): number[] {
  if (game.phase !== "bidding") {
    return [];
  }

  const bidderId = getActiveBidderId(game);
  if (bidderId !== playerId) {
    return [];
  }

  const maxBid = game.currentRound.handSize;
  const options = Array.from({ length: maxBid + 1 }, (_, index) => index);
  const isLastBidder = countPlacedBids(game.currentRound.bids) === game.playerOrder.length - 1;

  if (!isLastBidder) {
    return options;
  }

  const priorTotal = sumPlacedBids(game.currentRound.bids);
  const forbiddenBid = game.currentRound.handSize - priorTotal;

  if (forbiddenBid < 0 || forbiddenBid > maxBid) {
    return options;
  }

  if (game.currentRound.bids[playerId] !== null) {
    return [];
  }

  const shouldRestrict = shouldRestrictDealerBid(game, playerId);
  if (!shouldRestrict) {
    return options;
  }

  return options.filter((option) => option === 0 || option !== forbiddenBid);
}

export function getPlayableCardIds(game: GameState, playerId: string): string[] {
  const activePlayerId = game.playerOrder[game.currentRound.activePlayerIndex];
  if (game.phase !== "playing" || activePlayerId !== playerId) {
    return [];
  }

  const hand = game.currentRound.hands[playerId];
  const leadSuit = getCurrentLeadSuit(game.currentRound.currentTrick);

  if (!leadSuit) {
    return hand.map((card) => card.id);
  }

  const suitedCards = hand.filter((card) => card.kind === "number" && card.suit === leadSuit);
  if (suitedCards.length === 0) {
    return hand.map((card) => card.id);
  }

  return hand
    .filter((card) => card.kind !== "number" || card.suit === leadSuit)
    .map((card) => card.id);
}

export function toPublicRoomState(room: RoomState, selfPlayerId: string): PublicRoomState {
  return {
    code: room.code,
    status: room.status,
    options: room.options,
    hostPlayerId: room.hostPlayerId,
    players: room.players,
    game: room.game ? toPublicGameState(room.game, room.players, selfPlayerId, room.options) : null,
    selfPlayerId,
  };
}

export function resolveTrick(plays: TrickPlay[], trumpSuit: CardSuit | null): TrickResult {
  const firstWizard = plays.find((play) => play.card.kind === "wizard");
  if (firstWizard) {
    return {
      plays,
      winnerId: firstWizard.playerId,
      leadSuit: null,
    };
  }

  const trumpCards = plays.filter(
    (play): play is TrickPlay & { card: Extract<Card, { kind: "number" }> } =>
      play.card.kind === "number" && trumpSuit !== null && play.card.suit === trumpSuit,
  );

  if (trumpCards.length > 0) {
    const winningTrump = trumpCards.reduce((best, current) => (current.card.rank > best.card.rank ? current : best));
    return {
      plays,
      winnerId: winningTrump.playerId,
      leadSuit: getLeadSuitFromCompletedTrick(plays),
    };
  }

  const leadSuit = getLeadSuitFromCompletedTrick(plays);
  if (leadSuit) {
    const suitedCards = plays.filter(
      (play): play is TrickPlay & { card: Extract<Card, { kind: "number" }> } =>
        play.card.kind === "number" && play.card.suit === leadSuit,
    );

    const winningCard = suitedCards.reduce((best, current) => (current.card.rank > best.card.rank ? current : best));
    return {
      plays,
      winnerId: winningCard.playerId,
      leadSuit,
    };
  }

  return {
    plays,
    winnerId: plays[0]!.playerId,
    leadSuit: null,
  };
}

function createGameState(
  playerOrder: string[],
  dealerIndex: number,
  scores: Record<string, number>,
  options: RoomOptions,
  random: () => number,
): GameState {
  const round = createRound(playerOrder, dealerIndex, 1, random);

  return {
    phase: round.trump.needsDealerChoice ? "choose-trump" : "bidding",
    options,
    playerOrder,
    dealerIndex,
    roundNumber: 1,
    maxRounds: calculateMaxRounds(options.playerCount),
    scores,
    currentRound: round,
    lastResolvedTrick: null,
    previousRoundSummary: null,
    roundHistory: [],
    winnerIds: null,
    devTimeline: [],
  };
}

function shufflePlayersForGame(players: RoomPlayer[], random: () => number): RoomPlayer[] {
  return shuffleArray(players, random).map((player, seat) => ({
    ...player,
    seat,
  }));
}

function createRound(playerOrder: string[], dealerIndex: number, handSize: number, random: () => number): RoundState {
  const shuffled = shuffleDeck(createDeck(), random);
  const hands: Record<string, Card[]> = {};

  for (const playerId of playerOrder) {
    hands[playerId] = [];
  }

  let cursor = 0;
  for (let cardIndex = 0; cardIndex < handSize; cardIndex += 1) {
    for (let seatOffset = 1; seatOffset <= playerOrder.length; seatOffset += 1) {
      const seatIndex = (dealerIndex + seatOffset) % playerOrder.length;
      const playerId = playerOrder[seatIndex]!;
      hands[playerId].push(shuffled[cursor]!);
      cursor += 1;
    }
  }

  for (const playerId of playerOrder) {
    hands[playerId].sort(compareCardsForHand);
  }

  const turnedCard = cursor < shuffled.length ? shuffled[cursor]! : null;
  const leaderIndex = getNextSeatIndex(dealerIndex, playerOrder.length);

  return {
    handSize,
    dealerIndex,
    leaderIndex,
    activePlayerIndex: leaderIndex,
    bids: Object.fromEntries(playerOrder.map((playerId) => [playerId, null])),
    taken: Object.fromEntries(playerOrder.map((playerId) => [playerId, 0])),
    hands,
    currentTrick: [],
    completedTricks: [],
    trump: {
      trumpCard: turnedCard,
      trumpSuit: turnedCard ? getTrumpSuitFromCard(turnedCard) : null,
      needsDealerChoice: turnedCard?.kind === "wizard",
    },
  };
}

function advanceAfterRound(
  game: GameState,
  hands: Record<string, Card[]>,
  taken: Record<string, number>,
  completedTricks: TrickResult[],
  random: () => number,
): GameState {
  const bids = game.currentRound.bids as Record<string, number>;
  const summary = scoreRound(game.playerOrder, bids, taken, game);
  const nextScores = Object.fromEntries(
    game.playerOrder.map((playerId) => [playerId, game.scores[playerId] + summary.scoreDeltas[playerId]]),
  );
  const historyEntry: RoundHistoryEntry = {
    roundNumber: game.roundNumber,
    handSize: summary.handSize,
    bids: summary.bids,
    taken: summary.taken,
    scoreDeltas: summary.scoreDeltas,
    scoresAfter: nextScores,
  };
  const roundHistory = [...game.roundHistory, historyEntry];

  if (game.roundNumber >= game.maxRounds) {
    const highestScore = Math.max(...Object.values(nextScores));
    const winnerIds = game.playerOrder.filter((playerId) => nextScores[playerId] === highestScore);
    return {
      ...game,
      phase: "game-over",
      scores: nextScores,
      lastResolvedTrick: completedTricks.at(-1) ?? null,
      previousRoundSummary: summary,
      roundHistory,
      winnerIds,
      currentRound: {
        ...game.currentRound,
        hands,
        taken,
        completedTricks,
        currentTrick: [],
      },
    };
  }

  return {
    ...game,
    phase: "round-summary",
    scores: nextScores,
    lastResolvedTrick: completedTricks.at(-1) ?? null,
    previousRoundSummary: summary,
    roundHistory,
    winnerIds: null,
    currentRound: {
      ...game.currentRound,
      hands,
      taken,
      completedTricks,
      currentTrick: [],
    },
  };
}

function scoreRound(
  playerOrder: string[],
  bids: Record<string, number>,
  taken: Record<string, number>,
  game: GameState,
): RoundSummary {
  const scoreDeltas = Object.fromEntries(
    playerOrder.map((playerId) => {
      const bid = bids[playerId];
      const tricks = taken[playerId];
      const delta =
        bid === tricks
          ? game.options.scoreBonus + bid * game.options.exactTrickPoints
          : -Math.abs(bid - tricks) * game.options.missPenalty;
      return [playerId, delta];
    }),
  );

  return {
    handSize: game.currentRound.handSize,
    bids,
    taken,
    scoreDeltas,
  };
}

function shouldRestrictDealerBid(game: GameState, playerId: string): boolean {
  const dealerId = game.playerOrder[game.currentRound.dealerIndex];
  if (dealerId !== playerId) {
    return false;
  }

  const rule: DealerBidRule = game.options.dealerBidRule;

  if (rule === "none") {
    return false;
  }

  if (rule === "no-equal-total") {
    return true;
  }

  const scores = Object.values(game.scores);
  const highestScore = Math.max(...scores);
  const leaders = Object.entries(game.scores).filter(([, score]) => score === highestScore);

  return leaders.length === 1 && leaders[0]![0] === playerId;
}

function toPublicGameState(
  game: GameState,
  players: RoomPlayer[],
  selfPlayerId: string,
  options: RoomOptions,
): PublicGameState {
  const publicPlayers: PublicPlayerState[] = players
    .slice()
    .sort((left, right) => left.seat - right.seat)
    .map((player) => {
      const bid = game.currentRound.bids[player.id];
      const bidsAreVisible = !options.hiddenBids || Object.values(game.currentRound.bids).every((value) => value !== null);

      return {
        ...player,
        score: game.scores[player.id] ?? 0,
        bid: bidsAreVisible ? bid : player.id === selfPlayerId ? bid : null,
        taken: game.currentRound.taken[player.id] ?? 0,
        handCount: game.currentRound.hands[player.id]?.length ?? 0,
      };
    });

  return {
    phase: game.phase,
    roundNumber: game.roundNumber,
    maxRounds: game.maxRounds,
    dealerIndex: game.currentRound.dealerIndex,
    activePlayerId: game.playerOrder[game.currentRound.activePlayerIndex]!,
    trumpSuit: game.currentRound.trump.trumpSuit,
    trumpCard: game.currentRound.trump.trumpCard,
    needsDealerChoice: game.currentRound.trump.needsDealerChoice,
    handSize: game.currentRound.handSize,
    currentTrick: game.currentRound.currentTrick,
    completedTrickCount: game.currentRound.completedTricks.length,
    lastResolvedTrick: game.lastResolvedTrick,
    players: publicPlayers,
    yourHand: game.currentRound.hands[selfPlayerId] ?? [],
    allowedBids: getAllowedBids(game, selfPlayerId),
    playableCardIds: getPlayableCardIds(game, selfPlayerId),
    previousRoundSummary: game.previousRoundSummary,
    roundHistory: game.roundHistory,
    winnerIds: game.winnerIds,
    devTimeline: game.devTimeline,
  };
}

function touchRoom(room: RoomState): RoomState {
  return {
    ...room,
    updatedAt: new Date().toISOString(),
  };
}

function withGame(room: RoomState, game: GameState): RoomState {
  const status = game.phase === "game-over" ? "finished" : "in-game";
  return touchRoom({
    ...room,
    status,
    game,
  });
}

function requireGame(room: RoomState): GameState {
  if (!room.game) {
    throw new Error("The game has not started yet.");
  }

  return room.game;
}

function getTrumpSuitFromCard(card: Card): CardSuit | null {
  if (card.kind === "number") {
    return card.suit;
  }

  if (card.kind === "jester") {
    return null;
  }

  return null;
}

function getLeadSuitFromCompletedTrick(plays: TrickPlay[]): CardSuit | null {
  for (const play of plays) {
    if (play.card.kind === "number") {
      return play.card.suit;
    }
  }

  return null;
}

function getCurrentLeadSuit(plays: TrickPlay[]): CardSuit | null {
  for (const play of plays) {
    if (play.card.kind === "wizard") {
      return null;
    }

    if (play.card.kind === "number") {
      return play.card.suit;
    }
  }

  return null;
}

function getActiveBidderId(game: GameState): string {
  return game.playerOrder[game.currentRound.activePlayerIndex]!;
}

function getNextBidderIndex(game: GameState, bids: Record<string, number | null>): number {
  let seat = game.currentRound.activePlayerIndex;

  for (let count = 0; count < game.playerOrder.length; count += 1) {
    seat = getNextSeatIndex(seat, game.playerOrder.length);
    const playerId = game.playerOrder[seat]!;
    if (bids[playerId] === null) {
      return seat;
    }
  }

  return game.currentRound.leaderIndex;
}

function getNextSeatIndex(currentSeat: number, playerCount: number): number {
  return (currentSeat + 1) % playerCount;
}

function countPlacedBids(bids: Record<string, number | null>): number {
  return Object.values(bids).filter((value) => value !== null).length;
}

function sumPlacedBids(bids: Record<string, number | null>): number {
  return Object.values(bids).reduce<number>((total, bid) => total + (bid ?? 0), 0);
}

function compareCardsForHand(left: Card, right: Card): number {
  const groupOrder = { wizard: 2, number: 1, jester: 0 };
  const groupDelta = groupOrder[left.kind] - groupOrder[right.kind];
  if (groupDelta !== 0) {
    return groupDelta;
  }

  if (left.kind !== "number" || right.kind !== "number") {
    return left.id.localeCompare(right.id);
  }

  if (left.suit !== right.suit) {
    return SUITS.indexOf(left.suit) - SUITS.indexOf(right.suit);
  }

  return left.rank - right.rank;
}

function rankToLabel(rank: number): string {
  switch (rank) {
    case 11:
      return "J";
    case 12:
      return "Q";
    case 13:
      return "K";
    case 14:
      return "A";
    default:
      return String(rank);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
