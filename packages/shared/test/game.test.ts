import { describe, expect, it } from "vitest";

import { resolveTrick } from "../src/game.js";
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
