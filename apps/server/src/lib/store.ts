import crypto from "node:crypto";

import type mysql from "mysql2/promise";

import {
  addPlayerToRoom,
  createRoomState,
  renamePlayer,
  setPlayerConnection,
  toPublicRoomState,
  updateRoomOptions,
  startGame,
  startNextRound,
  chooseTrump,
  submitBid,
  playCard,
} from "@wizard/shared";
import type { CardSuit, PublicRoomState, RoomAvailability, RoomOptions, RoomState } from "@wizard/shared";

import { seedSimulatedBots, stepSimulatedRoom } from "./simulation.js";

export class RoomStore {
  constructor(private readonly pool: mysql.Pool) {}

  async createRoom(
    hostName: string,
    options: Partial<RoomOptions>,
    simulateBots = false,
  ): Promise<{ playerId: string; room: PublicRoomState }> {
    const roomCode = await this.generateUniqueRoomCode();
    const playerId = createPlayerId();
    const roomOptions = simulateBots ? { ...options, playerCount: Math.max(options.playerCount ?? 4, 4) } : options;
    let room = createRoomState(roomCode, playerId, sanitizeName(hostName), roomOptions);

    if (simulateBots) {
      room = seedSimulatedBots(room, createPlayerId);
    }

    await this.saveRoom(room);
    return {
      playerId,
      room: toPublicRoomState(room, playerId),
    };
  }

  async joinRoom(code: string, playerName: string, requestedPlayerId?: string): Promise<{ playerId: string; room: PublicRoomState }> {
    const room = await this.getRoom(code);
    if (!room) {
      throw new Error("Room not found.");
    }

    const playerId = requestedPlayerId ?? createPlayerId();
    const existingPlayer = room.players.find((player) => player.id === playerId);
    if (!existingPlayer && room.status !== "lobby") {
      throw new Error("Game already started.");
    }

    const nextRoom = addPlayerToRoom(room, playerId, sanitizeName(playerName));
    await this.saveRoom(nextRoom);

    return {
      playerId,
      room: toPublicRoomState(nextRoom, playerId),
    };
  }

  async getPublicRoom(code: string, playerId: string): Promise<PublicRoomState> {
    const room = await this.getRoom(code);
    if (!room) {
      throw new Error("Room not found.");
    }

    return toPublicRoomState(room, playerId);
  }

  async getRoomAvailability(code: string): Promise<RoomAvailability> {
    const room = await this.getRoom(code);
    if (!room) {
      throw new Error("Room not found.");
    }

    const joinedCount = room.players.length;
    let reason: string | null = null;
    if (room.status !== "lobby") {
      reason = "Game already started.";
    } else if (joinedCount >= room.options.playerCount) {
      reason = "Room is full.";
    }

    return {
      code: room.code,
      status: room.status,
      playerCount: room.options.playerCount,
      joinedCount,
      joinable: reason === null,
      reason,
    };
  }

  async setConnected(code: string, playerId: string, connected: boolean): Promise<RoomState | null> {
    const room = await this.getRoom(code);
    if (!room) {
      return null;
    }

    const nextRoom = setPlayerConnection(room, playerId, connected);
    await this.saveRoom(nextRoom);
    return nextRoom;
  }

  async updateOptions(code: string, playerId: string, options: Partial<RoomOptions>): Promise<RoomState> {
    return this.mutateRoom(code, (room) => updateRoomOptions(room, playerId, options));
  }

  async renamePlayer(code: string, playerId: string, playerName: string): Promise<RoomState> {
    return this.mutateRoom(code, (room) => renamePlayer(room, playerId, sanitizeName(playerName)));
  }

  async startGame(code: string, playerId: string): Promise<RoomState> {
    return this.mutateRoom(code, (room) => {
      if (room.hostPlayerId !== playerId) {
        throw new Error("Only the host can start the game.");
      }

      return startGame(room);
    });
  }

  async chooseTrump(code: string, playerId: string, suit: CardSuit): Promise<RoomState> {
    return this.mutateRoom(code, (room) => chooseTrump(room, playerId, suit));
  }

  async submitBid(code: string, playerId: string, bid: number): Promise<RoomState> {
    return this.mutateRoom(code, (room) => submitBid(room, playerId, bid));
  }

  async playCard(code: string, playerId: string, cardId: string): Promise<RoomState> {
    return this.mutateRoom(code, (room) => playCard(room, playerId, cardId));
  }

  async startNextRound(code: string, playerId: string): Promise<RoomState> {
    return this.mutateRoom(code, (room) => startNextRound(room, playerId));
  }

  async advanceSimulationStep(code: string): Promise<RoomState | null> {
    const room = await this.getRoom(code);
    if (!room) {
      throw new Error("Room not found.");
    }

    const nextRoom = stepSimulatedRoom(room);
    if (!nextRoom) {
      return null;
    }

    await this.saveRoom(nextRoom);
    return nextRoom;
  }

  async getRoom(code: string): Promise<RoomState | null> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT state_json FROM rooms WHERE code = ? LIMIT 1",
      [code.toUpperCase()],
    );

    if (rows.length === 0) {
      return null;
    }

    return JSON.parse(rows[0].state_json as string) as RoomState;
  }

  async saveRoom(room: RoomState): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO rooms (code, host_player_id, status, state_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          host_player_id = VALUES(host_player_id),
          status = VALUES(status),
          state_json = VALUES(state_json),
          created_at = VALUES(created_at),
          updated_at = VALUES(updated_at)
      `,
      [
        room.code,
        room.hostPlayerId,
        room.status,
        JSON.stringify(room),
        isoToMysql(room.createdAt),
        isoToMysql(room.updatedAt),
      ],
    );
  }

  private async mutateRoom(
    code: string,
    updater: (room: RoomState) => RoomState,
    options?: { allowUnchanged?: boolean },
  ): Promise<RoomState> {
    const room = await this.getRoom(code);
    if (!room) {
      throw new Error("Room not found.");
    }

    const nextRoom = updater(room);
    if (options?.allowUnchanged && nextRoom === room) {
      return room;
    }
    await this.saveRoom(nextRoom);
    return nextRoom;
  }

  private async generateUniqueRoomCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = randomRoomCode();
      const existing = await this.getRoom(code);
      if (!existing) {
        return code;
      }
    }

    throw new Error("Unable to create a unique room code.");
  }
}

function randomRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  }
  return code;
}

function createPlayerId(): string {
  return crypto.randomUUID();
}

function sanitizeName(name: string): string {
  const trimmed = name.trim().slice(0, 24);
  if (trimmed.length < 2) {
    throw new Error("Name must be at least 2 characters.");
  }
  return trimmed;
}

function isoToMysql(iso: string): string {
  return iso.slice(0, 23).replace("T", " ");
}
