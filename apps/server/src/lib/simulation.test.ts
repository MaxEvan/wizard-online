import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseTrump,
  createRoomState,
  getAllowedBids,
  getPlayableCardIds,
  playCard,
  startGame,
  submitBid,
  type RoomState,
} from "@wizard/shared";

import { advanceSimulatedRoom, seedSimulatedBots } from "./simulation.js";

test("seedSimulatedBots fills the room with connected CPU seats", () => {
  const room = seedSimulatedBots(
    createRoomState("ABC123", "human-1", "Human", { playerCount: 4 }),
    createTestPlayerIdFactory(),
  );

  assert.equal(room.players.length, 4);
  assert.equal(room.players.filter((player) => player.isBot).length, 3);
  assert.ok(room.players.every((player) => player.connected));
  assert.deepEqual(
    room.players.map((player) => player.seat),
    [0, 1, 2, 3],
  );
});

test("advanceSimulatedRoom stops on the next human decision point", () => {
  const seededRoom = seedSimulatedBots(
    createRoomState("ABC123", "human-1", "Human", { playerCount: 4 }),
    createTestPlayerIdFactory(),
  );

  let room = advanceSimulatedRoom(startGame(seededRoom, () => 0));
  room = resolveHumanDecision(room);

  assert.ok(room.game);
  assert.notEqual(room.game.phase, "game-over");

  const activePlayerId =
    room.game.phase === "choose-trump"
      ? room.game.playerOrder[room.game.currentRound.dealerIndex]
      : room.game.playerOrder[room.game.currentRound.activePlayerIndex];

  const activePlayer = room.players.find((player) => player.id === activePlayerId);
  assert.ok(activePlayer);
  assert.equal(activePlayer.isBot, false);
});

function resolveHumanDecision(room: RoomState): RoomState {
  if (!room.game) {
    return room;
  }

  if (room.game.phase === "choose-trump") {
    return advanceSimulatedRoom(chooseTrump(room, room.hostPlayerId, "spades"));
  }

  if (room.game.phase === "bidding") {
    const bid = getAllowedBids(room.game, room.hostPlayerId)[0];
    assert.notEqual(bid, undefined);
    return advanceSimulatedRoom(submitBid(room, room.hostPlayerId, bid));
  }

  if (room.game.phase === "playing") {
    const cardId = getPlayableCardIds(room.game, room.hostPlayerId)[0];
    assert.notEqual(cardId, undefined);
    return advanceSimulatedRoom(playCard(room, room.hostPlayerId, cardId));
  }

  return room;
}

function createTestPlayerIdFactory(): () => string {
  let index = 1;
  return () => `bot-${index++}`;
}
