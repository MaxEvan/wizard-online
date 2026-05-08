import { describe, expect, it } from "vitest";

import { addPlayerToRoom, createRoomState, resolveTrick, startGame } from "../src/game.js";
import type { TrickPlay } from "../src/types.js";

describe("resolveTrick", () => {
  it("gives the trick to the first wizard played", () => {
    const plays: TrickPlay[] = [
      { playerId: "a", card: { id: "spades-10", kind: "number", suit: "spades", rank: 10, label: "10S" } },
      { playerId: "b", card: { id: "wizard-1", kind: "wizard", label: "W" } },
      { playerId: "c", card: { id: "wizard-2", kind: "wizard", label: "W" } },
    ];

    expect(resolveTrick(plays, "hearts").winnerId).toBe("b");
  });

  it("treats a leading jester as a null card until a suit is established", () => {
    const plays: TrickPlay[] = [
      { playerId: "a", card: { id: "jester-1", kind: "jester", label: "J" } },
      { playerId: "b", card: { id: "clubs-9", kind: "number", suit: "clubs", rank: 9, label: "9C" } },
      { playerId: "c", card: { id: "clubs-12", kind: "number", suit: "clubs", rank: 12, label: "QC" } },
    ];

    const result = resolveTrick(plays, null);
    expect(result.leadSuit).toBe("clubs");
    expect(result.winnerId).toBe("c");
  });

  it("lets the first jester win if only jesters are played", () => {
    const plays: TrickPlay[] = [
      { playerId: "a", card: { id: "jester-1", kind: "jester", label: "J" } },
      { playerId: "b", card: { id: "jester-2", kind: "jester", label: "J" } },
      { playerId: "c", card: { id: "jester-3", kind: "jester", label: "J" } },
    ];

    expect(resolveTrick(plays, "spades").winnerId).toBe("a");
  });
});

describe("startGame", () => {
  it("randomizes seat positions and the opening dealer", () => {
    const room = addPlayerToRoom(
      addPlayerToRoom(addPlayerToRoom(createRoomState("ABC123", "host", "Host", { playerCount: 4 }), "p2", "P2"), "p3", "P3"),
      "p4",
      "P4",
    );
    const randomValues = [0.8, 0.4, 0.1, 0.6, 0.2];
    let cursor = 0;

    const started = startGame(room, () => randomValues[cursor++] ?? 0);

    expect(started.players.map((player) => player.id)).toEqual(["p3", "host", "p2", "p4"]);
    expect(started.players.map((player) => player.seat)).toEqual([0, 1, 2, 3]);
    expect(started.game?.playerOrder).toEqual(["p3", "host", "p2", "p4"]);
    expect(started.game?.dealerIndex).toBe(2);
  });
});
