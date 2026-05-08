import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

import Fastify from "fastify";
import { Server } from "socket.io";

import { toPublicRoomState, type Card, type CardSuit, type DevTimelineEntry, type RoomOptions, type RoomState } from "@wizard/shared";

import { createDatabasePool } from "./lib/db.js";
import { RoomStore } from "./lib/store.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(currentDir, "../../../.env") });

const port = Number(process.env.PORT ?? 3001);
const devSimulationEnabled = process.env.NODE_ENV !== "production";
const devActionDelayMs = 500;

const pool = await createDatabasePool({
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "wizard",
  password: process.env.MYSQL_PASSWORD ?? "wizard",
  database: process.env.MYSQL_DATABASE ?? "wizard_online",
});

const roomStore = new RoomStore(pool);
const app = Fastify({ logger: true });
const roomActionQueues = new Map<string, Promise<void>>();

app.get("/api/health", async () => ({ ok: true }));

app.post<{
  Body: { name: string; options?: Partial<RoomOptions>; simulateBots?: boolean };
}>("/api/rooms", async (request, reply) => {
  try {
    return await roomStore.createRoom(
      request.body.name,
      request.body.options ?? {},
      devSimulationEnabled && request.body.simulateBots === true,
    );
  } catch (error) {
    return reply.code(400).send({ error: getErrorMessage(error) });
  }
});

app.post<{
  Params: { code: string };
  Body: { name: string; playerId?: string };
}>("/api/rooms/:code/join", async (request, reply) => {
  try {
    return await roomStore.joinRoom(request.params.code, request.body.name, request.body.playerId);
  } catch (error) {
    return reply.code(400).send({ error: getErrorMessage(error) });
  }
});

app.get<{
  Params: { code: string };
  Querystring: { playerId: string };
}>("/api/rooms/:code", async (request, reply) => {
  try {
    return await roomStore.getPublicRoom(request.params.code, request.query.playerId);
  } catch (error) {
    return reply.code(404).send({ error: getErrorMessage(error) });
  }
});

const io = new Server(app.server, {
  path: "/api/socket.io",
});

const socketPresence = new Map<string, number>();

io.on("connection", (socket) => {
  socket.on("room:subscribe", async ({ code, playerId }: { code: string; playerId: string }) => {
    const room = await roomStore.setConnected(code, playerId, true);
    if (!room) {
      socket.emit("room:error", "Room not found.");
      return;
    }

    socket.data.roomCode = room.code;
    socket.data.playerId = playerId;
    socket.join(room.code);
    socketPresence.set(playerId, (socketPresence.get(playerId) ?? 0) + 1);
    await broadcastRoom(room.code);
  });

  socket.on("room:update-options", async ({ code, playerId, options }: ActionPayload<{ options: Partial<RoomOptions> }>) => {
    await handleSocketAction(socket, code, async () => roomStore.updateOptions(code, playerId, options));
  });

  socket.on("room:rename-player", async ({ code, playerId, name }: ActionPayload<{ name: string }>) => {
    await handleSocketAction(socket, code, async () => roomStore.renamePlayer(code, playerId, name));
  });

  socket.on("game:start", async ({ code, playerId }: ActionPayload) => {
    await handleSocketAction(socket, code, async () => roomStore.startGame(code, playerId));
  });

  socket.on("game:choose-trump", async ({ code, playerId, suit }: ActionPayload<{ suit: CardSuit }>) => {
    await handleSocketAction(socket, code, async () => roomStore.chooseTrump(code, playerId, suit));
  });

  socket.on("game:bid", async ({ code, playerId, bid }: ActionPayload<{ bid: number }>) => {
    await handleSocketAction(socket, code, async () => roomStore.submitBid(code, playerId, bid));
  });

  socket.on("game:play-card", async ({ code, playerId, cardId }: ActionPayload<{ cardId: string }>) => {
    await handleSocketAction(socket, code, async () => roomStore.playCard(code, playerId, cardId));
  });

  socket.on("disconnect", async () => {
    const code = socket.data.roomCode as string | undefined;
    const playerId = socket.data.playerId as string | undefined;
    if (!code || !playerId) {
      return;
    }

    const nextCount = (socketPresence.get(playerId) ?? 1) - 1;
    if (nextCount <= 0) {
      socketPresence.delete(playerId);
      await roomStore.setConnected(code, playerId, false);
      await broadcastRoom(code);
      return;
    }

    socketPresence.set(playerId, nextCount);
  });
});

await app.listen({ port, host: "0.0.0.0" });

async function handleSocketAction(
  socket: Parameters<Server["on"]>[1] extends (socket: infer T) => void ? T : never,
  code: string,
  action: () => Promise<RoomState>,
): Promise<void> {
  const normalizedCode = code.toUpperCase();

  await enqueueRoomAction(normalizedCode, async () => {
    try {
      const previousRoom = await roomStore.getRoom(normalizedCode);
      const nextRoom = await action();
      const annotatedRoom = await persistDevTimeline(previousRoom, nextRoom);
      await broadcastRoomState(annotatedRoom);
      await advanceAutomatedSteps(normalizedCode, annotatedRoom);
    } catch (error) {
      socket.emit("room:error", getErrorMessage(error));
    }
  });
}

async function broadcastRoom(code: string): Promise<void> {
  const normalizedCode = code.toUpperCase();
  const room = await roomStore.getRoom(normalizedCode);
  if (!room) {
    return;
  }

  await broadcastRoomState(room);
}

async function broadcastRoomState(room: RoomState): Promise<void> {
  const normalizedCode = room.code.toUpperCase();

  const playersBySocket = await io.in(normalizedCode).fetchSockets();
  for (const socket of playersBySocket) {
    const playerId = socket.data.playerId as string | undefined;
    if (!playerId) {
      continue;
    }

    socket.emit("room:state", toPublicRoomState(room, playerId));
  }
}

async function advanceAutomatedSteps(code: string, room: RoomState): Promise<void> {
  let currentRoom = room;

  while (true) {
    const nextRoom = await roomStore.advanceSimulationStep(code);
    if (!nextRoom) {
      return;
    }

    if (devSimulationEnabled) {
      await wait(devActionDelayMs);
    }

    currentRoom = await persistDevTimeline(currentRoom, nextRoom);
    await broadcastRoomState(currentRoom);
  }
}

async function persistDevTimeline(previousRoom: RoomState | null, nextRoom: RoomState): Promise<RoomState> {
  if (!devSimulationEnabled || !nextRoom.game) {
    return nextRoom;
  }

  const entries = describeTransition(previousRoom, nextRoom);
  if (entries.length === 0) {
    return nextRoom;
  }

  const annotatedRoom: RoomState = {
    ...nextRoom,
    game: {
      ...nextRoom.game,
      devTimeline: [...nextRoom.game.devTimeline, ...entries].slice(-160),
    },
  };

  await roomStore.saveRoom(annotatedRoom);
  return annotatedRoom;
}

function describeTransition(previousRoom: RoomState | null, nextRoom: RoomState): DevTimelineEntry[] {
  const previousGame = previousRoom?.game ?? null;
  const nextGame = nextRoom.game;
  if (!nextGame) {
    return [];
  }

  const entries: DevTimelineEntry[] = [];
  if (!previousGame) {
    entries.push(createTimelineEntry(nextGame.roundNumber, describeHandStart(nextRoom, nextGame.roundNumber)));
    return entries;
  }

  const previousPlayersById = new Map(previousRoom?.players.map((player) => [player.id, player.name]) ?? []);

  if (
    previousGame.phase === "choose-trump" &&
    !nextGame.currentRound.trump.needsDealerChoice &&
    previousGame.currentRound.trump.trumpSuit !== nextGame.currentRound.trump.trumpSuit &&
    nextGame.currentRound.trump.trumpSuit
  ) {
    const dealerId = nextGame.playerOrder[nextGame.currentRound.dealerIndex]!;
    entries.push(
      createTimelineEntry(
        nextGame.roundNumber,
        `${playerName(nextRoom, dealerId)} chose ${suitLabel(nextGame.currentRound.trump.trumpSuit)} as trump.`,
      ),
    );
  }

  for (const playerId of nextGame.playerOrder) {
    const previousBid = previousGame.currentRound.bids[playerId];
    const nextBid = nextGame.currentRound.bids[playerId];
    if (previousBid === null && nextBid !== null) {
      entries.push(createTimelineEntry(nextGame.roundNumber, `${playerName(nextRoom, playerId)} bid ${nextBid}.`));
    }
  }

  if (nextGame.currentRound.currentTrick.length > previousGame.currentRound.currentTrick.length) {
    const play = nextGame.currentRound.currentTrick.at(-1);
    if (play) {
      entries.push(createTimelineEntry(nextGame.roundNumber, `${playerName(nextRoom, play.playerId)} played ${formatCard(play.card)}.`));
    }
  }

  if (nextGame.currentRound.completedTricks.length > previousGame.currentRound.completedTricks.length) {
    const trick = nextGame.currentRound.completedTricks.at(-1);
    if (trick) {
      const winningPlay = trick.plays.find((play) => play.playerId === trick.winnerId);
      entries.push(
        createTimelineEntry(
          previousGame.roundNumber,
          `Trick ${nextGame.currentRound.completedTricks.length} went to ${playerName(nextRoom, trick.winnerId)} with ${formatCard(
            winningPlay?.card ?? trick.plays[0]!.card,
          )}.`,
        ),
      );
    }
  }

  if (nextGame.previousRoundSummary && previousGame.roundNumber !== nextGame.roundNumber) {
    entries.push(createTimelineEntry(previousGame.roundNumber, describeHandEnd(nextRoom, nextGame.previousRoundSummary.scoreDeltas, previousPlayersById)));
    entries.push(createTimelineEntry(nextGame.roundNumber, describeHandStart(nextRoom, nextGame.roundNumber)));
  } else if (nextGame.previousRoundSummary && nextGame.phase === "game-over" && previousGame.phase !== "game-over") {
    entries.push(createTimelineEntry(previousGame.roundNumber, describeHandEnd(nextRoom, nextGame.previousRoundSummary.scoreDeltas, previousPlayersById)));
  }

  return entries;
}

function describeHandStart(room: RoomState, handNumber: number): string {
  const game = room.game;
  if (!game) {
    return `Hand ${handNumber} started.`;
  }

  const dealerId = game.playerOrder[game.currentRound.dealerIndex]!;
  const trumpCard = game.currentRound.trump.trumpCard;
  const trumpText = game.currentRound.trump.needsDealerChoice
    ? `Turn-up is ${formatCard(trumpCard)}. Dealer chooses trump.`
    : trumpCard
      ? `Turn-up is ${formatCard(trumpCard)}.`
      : "No turn-up card.";

  return `Hand ${handNumber} started. Dealer: ${playerName(room, dealerId)}. ${trumpText}`;
}

function describeHandEnd(
  room: RoomState,
  scoreDeltas: Record<string, number>,
  previousPlayersById: Map<string, string>,
): string {
  const parts = Object.entries(scoreDeltas).map(([playerId, delta]) => `${previousPlayersById.get(playerId) ?? playerName(room, playerId)} ${signed(delta)}`);
  return `Hand finished. ${parts.join(", ")}.`;
}

function createTimelineEntry(handNumber: number, message: string): DevTimelineEntry {
  return {
    id: `${handNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    handNumber,
    message,
  };
}

function playerName(room: RoomState, playerId: string): string {
  return room.players.find((player) => player.id === playerId)?.name ?? playerId;
}

function formatCard(card: Card | null | undefined): string {
  if (!card) {
    return "unknown card";
  }

  if (card.kind === "wizard") {
    return "Wizard";
  }

  if (card.kind === "jester") {
    return "Jester";
  }

  if (card.kind !== "number") {
    return card.label;
  }

  return `${rankLabel(card.rank)}${suitSymbol(card.suit)}`;
}

function rankLabel(rank: number): string {
  if (rank <= 10) {
    return `${rank}`;
  }

  if (rank === 11) {
    return "J";
  }

  if (rank === 12) {
    return "Q";
  }

  if (rank === 13) {
    return "K";
  }

  return "A";
}

function suitSymbol(suit: CardSuit): string {
  return {
    clubs: "♣",
    diamonds: "♦",
    hearts: "♥",
    spades: "♠",
  }[suit];
}

function suitLabel(suit: CardSuit): string {
  return {
    clubs: "clubs",
    diamonds: "diamonds",
    hearts: "hearts",
    spades: "spades",
  }[suit];
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function enqueueRoomAction(code: string, task: () => Promise<void>): Promise<void> {
  const previousTask = roomActionQueues.get(code) ?? Promise.resolve();
  const nextTask = previousTask
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (roomActionQueues.get(code) === nextTask) {
        roomActionQueues.delete(code);
      }
    });

  roomActionQueues.set(code, nextTask);
  await nextTask;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}

type ActionPayload<T extends object = Record<string, never>> = {
  code: string;
  playerId: string;
} & T;
