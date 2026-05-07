import { startTransition, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";

import { resolveTrick } from "@wizard/shared";
import type { Card, CardSuit, PublicGameState, PublicRoomState, RoomOptions } from "@wizard/shared";

import { createRoom, joinRoom, loadRoom } from "./lib/api";
import { getStoredName, getStoredPlayerId, storeName, storePlayerId } from "./lib/storage";

const DEFAULT_OPTIONS: RoomOptions = {
  playerCount: 4,
  hiddenBids: false,
  dealerBidRule: "none",
  scoreBonus: 20,
  exactTrickPoints: 10,
  missPenalty: 10,
};

const SUIT_LABELS: Record<CardSuit, string> = {
  clubs: "Clubs",
  diamonds: "Diamonds",
  hearts: "Hearts",
  spades: "Spades",
};

const SUIT_SYMBOLS: Record<CardSuit, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};
const PLAYER_COUNT_OPTIONS = [3, 4, 5, 6];
const SIMULATED_PLAYER_COUNT_OPTIONS = [4, 5, 6];

export default function App() {
  const showDevSimulation = import.meta.env.DEV;
  const [name, setName] = useState(getStoredName);
  const [renameDraft, setRenameDraft] = useState("");
  const [joinCode, setJoinCode] = useState(currentRoomCode() ?? "");
  const [playerId, setPlayerId] = useState<string | null>(() => {
    const code = currentRoomCode();
    return code ? getStoredPlayerId(code) : null;
  });
  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [draftOptions, setDraftOptions] = useState<RoomOptions>(DEFAULT_OPTIONS);
  const [simulateBots, setSimulateBots] = useState(showDevSimulation);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [showTableMenu, setShowTableMenu] = useState(false);
  const self = room?.players.find((player) => player.id === playerId) ?? null;
  const game = room?.game ?? null;
  const isHost = room?.hostPlayerId === playerId;
  const canStart = !!room && room.players.length === room.options.playerCount && room.status === "lobby";
  const activePlayer = game?.players.find((player) => player.id === game.activePlayerId) ?? null;
  const canRenameSelf = room?.status === "lobby" && !!playerId;

  useEffect(() => {
    if (!room) {
      return;
    }

    setDraftOptions(room.options);
  }, [room]);

  useEffect(() => {
    setRenameDraft(self?.name ?? "");
  }, [self?.name]);

  useEffect(() => {
    if (!room) {
      return;
    }

    setShowTableMenu(room.status === "lobby");
  }, [room?.status]);

  useEffect(() => {
    const code = currentRoomCode();
    if (!code) {
      return;
    }

    const knownPlayerId = getStoredPlayerId(code);
    if (!knownPlayerId) {
      return;
    }

    loadRoom(code, knownPlayerId)
      .then((loadedRoom) => {
        startTransition(() => {
          setPlayerId(knownPlayerId);
          setRoom(loadedRoom);
          setJoinCode(code);
        });
      })
      .catch(() => {
        setError("Unable to restore the room session.");
      });
  }, []);

  useEffect(() => {
    if (!room || !playerId) {
      socket?.disconnect();
      setSocket(null);
      return;
    }

    const nextSocket = io(import.meta.env.VITE_API_URL ?? window.location.origin, {
      transports: ["websocket"],
    });

    nextSocket.on("connect", () => {
      nextSocket.emit("room:subscribe", { code: room.code, playerId });
    });

    nextSocket.on("room:state", (nextRoom: PublicRoomState) => {
      startTransition(() => {
        setRoom(nextRoom);
        setError(null);
      });
    });

    nextSocket.on("room:error", (message: string) => {
      setError(message);
    });

    setSocket(nextSocket);
    return () => {
      nextSocket.disconnect();
    };
  }, [playerId, room?.code]);

  async function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      storeName(name);
      const response = await createRoom(name, draftOptions, showDevSimulation && simulateBots);
      completeRoomAuth(response.room, response.playerId);
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      storeName(name);
      const code = joinCode.trim().toUpperCase();
      const response = await joinRoom(code, name, getStoredPlayerId(code) ?? undefined);
      completeRoomAuth(response.room, response.playerId);
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  function completeRoomAuth(nextRoom: PublicRoomState, nextPlayerId: string) {
    storePlayerId(nextRoom.code, nextPlayerId);
    window.history.replaceState({}, "", `/room/${nextRoom.code}`);
    setPlayerId(nextPlayerId);
    setJoinCode(nextRoom.code);
    setRoom(nextRoom);
  }

  function emit(event: string, payload: Record<string, unknown>) {
    if (!socket || !room || !playerId) {
      return;
    }

    socket.emit(event, {
      code: room.code,
      playerId,
      ...payload,
    });
  }

  function handleRenameSelf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = renameDraft.trim();
    if (!canRenameSelf || !nextName) {
      return;
    }

    storeName(nextName);
    setName(nextName);
    emit("room:rename-player", { name: nextName });
  }

  return (
    <main className="min-h-screen px-4 py-6 text-parchment md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-3 rounded-[28px] border border-white/10 bg-black/20 p-6 shadow-table backdrop-blur md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-body text-sm uppercase tracking-[0.24em] text-brass">Wizard Online</p>
            <h1 className="font-display text-4xl font-semibold">Real-time Wizard, room codes, full trick play.</h1>
          </div>
          <div className="rounded-2xl border border-brass/30 bg-brass/10 px-4 py-3 text-sm text-brass">
            {room ? `Room ${room.code}` : "Create a room or join an existing code"}
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div> : null}

        {!room ? (
          <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <form onSubmit={handleCreateRoom} className="rounded-[28px] border border-white/10 bg-black/20 p-6 shadow-table backdrop-blur">
              <h2 className="font-display text-2xl">Create a table</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 md:col-span-2">
                  <span className="text-sm text-brass">Display name</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-parchment outline-none transition focus:border-brass/60"
                    placeholder="Table Mage"
                    minLength={2}
                    maxLength={24}
                    required
                  />
                </label>
                <OptionField label="Players">
                  <select
                    value={draftOptions.playerCount}
                    onChange={(event) =>
                      setDraftOptions((current) => ({ ...current, playerCount: Number(event.target.value) }))
                    }
                    className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-parchment outline-none"
                  >
                    {(showDevSimulation && simulateBots ? SIMULATED_PLAYER_COUNT_OPTIONS : PLAYER_COUNT_OPTIONS).map((count) => (
                      <option key={count} value={count} className="bg-ink">
                        {count}
                      </option>
                    ))}
                  </select>
                </OptionField>
                {showDevSimulation ? (
                  <OptionField label="Dev simulation">
                    <label className="flex h-full items-center justify-between rounded-2xl border border-white/15 bg-white/5 px-4 py-3">
                      <span>{simulateBots ? `1 human + ${draftOptions.playerCount - 1} CPU players` : "Manual seats only"}</span>
                      <input
                        type="checkbox"
                        checked={simulateBots}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setSimulateBots(checked);
                          if (checked) {
                            setDraftOptions((current) => ({
                              ...current,
                              playerCount: Math.max(current.playerCount, 4),
                            }));
                          }
                        }}
                      />
                    </label>
                  </OptionField>
                ) : null}
                <OptionField label="Hidden bids">
                  <label className="flex h-full items-center justify-between rounded-2xl border border-white/15 bg-white/5 px-4 py-3">
                    <span>{draftOptions.hiddenBids ? "Enabled" : "Open bidding"}</span>
                    <input
                      type="checkbox"
                      checked={draftOptions.hiddenBids}
                      onChange={(event) =>
                        setDraftOptions((current) => ({ ...current, hiddenBids: event.target.checked }))
                      }
                    />
                  </label>
                </OptionField>
                <OptionField label="Dealer bid rule">
                  <select
                    value={draftOptions.dealerBidRule}
                    onChange={(event) =>
                      setDraftOptions((current) => ({
                        ...current,
                        dealerBidRule: event.target.value as RoomOptions["dealerBidRule"],
                      }))
                    }
                    className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-parchment outline-none"
                  >
                    <option value="none" className="bg-ink">
                      Standard
                    </option>
                    <option value="no-equal-total" className="bg-ink">
                      Last bidder cannot go even
                    </option>
                    <option value="canadian" className="bg-ink">
                      Canadian rule
                    </option>
                  </select>
                </OptionField>
                <NumberOption
                  label="Exact bid bonus"
                  value={draftOptions.scoreBonus}
                  onChange={(value) => setDraftOptions((current) => ({ ...current, scoreBonus: value }))}
                />
                <NumberOption
                  label="Points per trick"
                  value={draftOptions.exactTrickPoints}
                  onChange={(value) => setDraftOptions((current) => ({ ...current, exactTrickPoints: value }))}
                />
                <NumberOption
                  label="Miss penalty"
                  value={draftOptions.missPenalty}
                  onChange={(value) => setDraftOptions((current) => ({ ...current, missPenalty: value }))}
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="mt-6 rounded-2xl bg-brass px-5 py-3 font-semibold text-ink transition hover:bg-[#e0bb77] disabled:opacity-60"
              >
                Create room
              </button>
            </form>

            <form onSubmit={handleJoinRoom} className="rounded-[28px] border border-white/10 bg-black/20 p-6 shadow-table backdrop-blur">
              <h2 className="font-display text-2xl">Join by code</h2>
              <div className="mt-5 grid gap-4">
                <label className="flex flex-col gap-2">
                  <span className="text-sm text-brass">Display name</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-parchment outline-none"
                    placeholder="Card Oracle"
                    minLength={2}
                    maxLength={24}
                    required
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm text-brass">Room code</span>
                  <input
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                    className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-parchment outline-none uppercase tracking-[0.3em]"
                    placeholder="AB12CD"
                    minLength={6}
                    maxLength={6}
                    required
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="mt-6 rounded-2xl border border-brass/60 px-5 py-3 font-semibold text-brass transition hover:bg-brass/10 disabled:opacity-60"
              >
                Join room
              </button>
            </form>
          </section>
        ) : (
          <section className="grid gap-6">
            <div className="rounded-[28px] border border-white/10 bg-black/25 p-4 shadow-table backdrop-blur">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge label={`Room ${room.code}`} />
                  <Badge label={room.status === "lobby" ? "Lobby" : formatPhaseLabel(game, activePlayer)} />
                  <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75">
                    {room.status === "lobby"
                      ? `${room.players.length}/${room.options.playerCount} seated`
                      : `Dealer: ${game ? game.players.find((player) => player.seat === game.dealerIndex)?.name ?? "?" : "?"}`}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75">
                    You: <span className="font-semibold text-parchment">{self?.name ?? "Unknown"}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowTableMenu((current) => !current)}
                    className="rounded-full border border-brass/40 bg-brass/10 px-4 py-2 text-sm font-semibold text-brass transition hover:bg-brass/20"
                  >
                    {showTableMenu ? "Hide table menu" : "Show table menu"}
                  </button>
                </div>
              </div>
            </div>

            <div className={`grid gap-6 ${showTableMenu ? "xl:grid-cols-[minmax(0,1fr)_340px]" : ""}`}>
              <section className="flex min-w-0 flex-col gap-6">
                {room.status === "lobby" ? (
                  <Panel title="Lobby">
                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_300px]">
                      <div className="grid gap-4">
                        <div className="rounded-[24px] border border-brass/20 bg-[linear-gradient(145deg,rgba(201,165,99,0.18),rgba(8,18,22,0.2))] p-5">
                          <div className="text-xs uppercase tracking-[0.22em] text-brass">Match ready</div>
                          <div className="mt-3 max-w-2xl font-display text-3xl leading-tight">
                            Seat the table, confirm the rules in the menu, then start as soon as everyone is in.
                          </div>
                          <div className="mt-4 text-sm text-white/75">
                            Waiting for {room.options.playerCount} players. Joined: {room.players.length}.
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {room.players
                            .slice()
                            .sort((left, right) => left.seat - right.seat)
                            .map((player) => (
                              <PlayerLobbyCard key={player.id} player={player} isSelf={player.id === playerId} />
                            ))}
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
                        <div className="text-xs uppercase tracking-[0.22em] text-brass">Next action</div>
                        <div className="mt-3 text-lg font-semibold">
                          {canStart ? "The table is full." : "More players need to join before the match can start."}
                        </div>
                        <div className="mt-2 text-sm text-white/70">
                          {isHost
                            ? "Use the start button when the roster looks right."
                            : "Only the host can start. You can still rename yourself in the table menu."}
                        </div>
                        <button
                          disabled={!isHost || !canStart}
                          onClick={() => emit("game:start", {})}
                          className="mt-6 w-full rounded-2xl bg-brass px-5 py-4 font-semibold text-ink transition hover:bg-[#e0bb77] disabled:opacity-60"
                        >
                          Start match
                        </button>
                      </div>
                    </div>
                  </Panel>
                ) : null}

                {game ? (
                  <GameBoard
                    game={game}
                    selfPlayerId={playerId}
                    roomCode={room.code}
                    showDevTimeline={showDevSimulation}
                    onChooseTrump={(suit) => emit("game:choose-trump", { suit })}
                    onBid={(bid) => emit("game:bid", { bid })}
                    onPlayCard={(cardId) => emit("game:play-card", { cardId })}
                  />
                ) : null}

                {game?.previousRoundSummary ? (
                  <Panel title={`Last hand: ${game.previousRoundSummary.handSize} card${game.previousRoundSummary.handSize > 1 ? "s" : ""}`}>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {game.previousRoundSummary && game.players.map((player) => (
                        <div key={player.id} className="rounded-[22px] border border-white/10 bg-white/5 p-4 text-sm">
                          <div className="font-semibold">{player.name}</div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-white/70">
                            <StatPill label={`Bid ${game.previousRoundSummary?.bids[player.id] ?? 0}`} />
                            <StatPill label={`Took ${game.previousRoundSummary?.taken[player.id] ?? 0}`} />
                          </div>
                          <div className="mt-4 text-lg font-semibold text-brass">
                            {signed(game.previousRoundSummary?.scoreDeltas[player.id] ?? 0)} pts
                          </div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                ) : null}
              </section>

              {showTableMenu ? (
                <aside className="flex min-w-0 flex-col gap-6">
                  <Panel title="Table menu">
                    <div className="grid gap-5 text-sm">
                      <MenuSection title="Table">
                        <div className="grid gap-3">
                          <MenuStat label="Room code" value={room.code} emphasize />
                          <MenuStat label="You" value={self?.name ?? "Unknown"} />
                        </div>
                        {room.status === "lobby" ? (
                          <form onSubmit={handleRenameSelf} className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                            <label className="flex flex-col gap-2">
                              <span className="text-xs uppercase tracking-[0.2em] text-brass">Change your name</span>
                              <input
                                value={renameDraft}
                                onChange={(event) => setRenameDraft(event.target.value)}
                                minLength={2}
                                maxLength={24}
                                required
                                className="rounded-2xl border border-white/15 bg-black/20 px-4 py-3 text-parchment outline-none transition focus:border-brass/60"
                              />
                            </label>
                            <button
                              type="submit"
                              disabled={!canRenameSelf || renameDraft.trim().length < 2}
                              className="mt-3 w-full rounded-2xl border border-brass/60 px-4 py-3 font-semibold text-brass transition hover:bg-brass/10 disabled:opacity-60"
                            >
                              Update name
                            </button>
                          </form>
                        ) : null}
                      </MenuSection>

                      <MenuSection title="Players">
                        <ul className="grid gap-2">
                          {room.players
                            .slice()
                            .sort((left, right) => left.seat - right.seat)
                            .map((player) => (
                              <li key={player.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                                <span className="font-medium">{player.name}</span>
                                <span className="text-xs text-brass">
                                  {player.isBot ? "CPU • " : ""}
                                  {player.connected ? "Online" : "Away"}
                                  {player.isHost ? " • Host" : ""}
                                </span>
                              </li>
                            ))}
                        </ul>
                      </MenuSection>

                      <MenuSection title="Rules">
                        <div className="grid gap-3">
                          <OptionField label="Players">
                            <select
                              disabled={!isHost || room.status !== "lobby"}
                              value={draftOptions.playerCount}
                              onChange={(event) =>
                                setDraftOptions((current) => ({ ...current, playerCount: Number(event.target.value) }))
                              }
                              className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-parchment outline-none disabled:opacity-60"
                            >
                              {PLAYER_COUNT_OPTIONS.map((count) => (
                                <option key={count} value={count} className="bg-ink">
                                  {count}
                                </option>
                              ))}
                            </select>
                          </OptionField>
                          <OptionField label="Hidden bids">
                            <label className="flex items-center justify-between rounded-2xl border border-white/15 bg-white/5 px-4 py-3">
                              <span>{draftOptions.hiddenBids ? "Enabled" : "Disabled"}</span>
                              <input
                                disabled={!isHost || room.status !== "lobby"}
                                type="checkbox"
                                checked={draftOptions.hiddenBids}
                                onChange={(event) =>
                                  setDraftOptions((current) => ({ ...current, hiddenBids: event.target.checked }))
                                }
                              />
                            </label>
                          </OptionField>
                          <OptionField label="Dealer bid rule">
                            <select
                              disabled={!isHost || room.status !== "lobby"}
                              value={draftOptions.dealerBidRule}
                              onChange={(event) =>
                                setDraftOptions((current) => ({
                                  ...current,
                                  dealerBidRule: event.target.value as RoomOptions["dealerBidRule"],
                                }))
                              }
                              className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-parchment outline-none disabled:opacity-60"
                            >
                              <option value="none" className="bg-ink">
                                Standard
                              </option>
                              <option value="no-equal-total" className="bg-ink">
                                No even total
                              </option>
                              <option value="canadian" className="bg-ink">
                                Canadian
                              </option>
                            </select>
                          </OptionField>
                          <NumberOption
                            disabled={!isHost || room.status !== "lobby"}
                            label="Exact bid bonus"
                            value={draftOptions.scoreBonus}
                            onChange={(value) => setDraftOptions((current) => ({ ...current, scoreBonus: value }))}
                          />
                          <NumberOption
                            disabled={!isHost || room.status !== "lobby"}
                            label="Points per trick"
                            value={draftOptions.exactTrickPoints}
                            onChange={(value) => setDraftOptions((current) => ({ ...current, exactTrickPoints: value }))}
                          />
                          <NumberOption
                            disabled={!isHost || room.status !== "lobby"}
                            label="Miss penalty"
                            value={draftOptions.missPenalty}
                            onChange={(value) => setDraftOptions((current) => ({ ...current, missPenalty: value }))}
                          />
                          {isHost && room.status === "lobby" ? (
                            <button
                              onClick={() => emit("room:update-options", { options: draftOptions })}
                              className="rounded-2xl border border-brass/60 px-4 py-3 font-semibold text-brass transition hover:bg-brass/10"
                            >
                              Save options
                            </button>
                          ) : null}
                        </div>
                      </MenuSection>
                    </div>
                  </Panel>
                </aside>
              ) : null}
            </div>
          </section>
        )}

        {game && activePlayer ? (
          <footer className="rounded-[28px] border border-white/10 bg-black/20 px-5 py-4 text-sm shadow-table backdrop-blur">
            Active turn: <span className="font-semibold text-brass">{activePlayer.name}</span>
          </footer>
        ) : null}
      </div>
    </main>
  );
}

function GameBoard({
  game,
  selfPlayerId,
  roomCode,
  showDevTimeline,
  onChooseTrump,
  onBid,
  onPlayCard,
}: {
  game: PublicGameState;
  selfPlayerId: string | null;
  roomCode: string;
  showDevTimeline: boolean;
  onChooseTrump: (suit: CardSuit) => void;
  onBid: (bid: number) => void;
  onPlayCard: (cardId: string) => void;
}) {
  const self = game.players.find((player) => player.id === selfPlayerId) ?? null;
  const dealer = game.players.find((player) => player.seat === game.dealerIndex) ?? null;
  const isTrumpChooser = game.phase === "choose-trump" && dealer?.id === selfPlayerId;
  const isActive = game.activePlayerId === selfPlayerId;
  const orderedPlayers = self ? getPlayersRelativeToSelf(game, self.id) : game.players;
  const winningCard = getCurrentWinningCard(game);

  return (
    <Panel title={`Hand ${game.roundNumber} of ${game.maxRounds}`}>
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge label={`Room ${roomCode}`} />
          <Badge label={`Dealer: ${dealer?.name ?? "?"}`} />
          <Badge label={game.trumpSuit ? `Trump: ${SUIT_LABELS[game.trumpSuit]}` : "No trump"} />
          <Badge label={`Tricks ${game.completedTrickCount}/${game.handSize}`} />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_320px]">
          <div className="grid gap-5">
            <div className="rounded-[28px] border border-white/10 bg-felt/80 p-4 shadow-inner shadow-black/20">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {orderedPlayers.map((player) => {
                  const isSelfPlayer = player.id === selfPlayerId;
                  const isTurn = player.id === game.activePlayerId;

                  return (
                    <div
                      key={player.id}
                      className={`rounded-[22px] border px-4 py-4 text-sm backdrop-blur ${
                        isTurn
                          ? "border-brass/70 bg-brass/15 shadow-[0_0_0_1px_rgba(201,165,99,0.25)]"
                          : "border-white/10 bg-black/30"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold">{player.name}</span>
                        <span className="text-brass">{player.score} pts</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.14em] text-white/70">
                        <span>{player.bid === null ? "Bid ?" : `Bid ${player.bid}`}</span>
                        <span>{`Taken ${player.taken}`}</span>
                        <span>{`${player.handCount} left`}</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          {!isSelfPlayer ? <CardBackStack count={player.handCount} compact /> : null}
                          {isSelfPlayer ? <span className="text-xs uppercase tracking-[0.18em] text-brass">You</span> : null}
                          {player.isBot ? <span className="text-xs uppercase tracking-[0.18em] text-white/55">CPU</span> : null}
                        </div>
                        {isTurn ? <span className="text-xs uppercase tracking-[0.18em] text-brass">Active</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06),transparent_45%),linear-gradient(180deg,rgba(9,44,32,0.52),rgba(6,27,20,0.5))] p-5">
                  <div className="text-xs uppercase tracking-[0.22em] text-brass">Center trick</div>
                  <div className="mt-4 flex min-h-[240px] items-center justify-center">
                    {game.currentTrick.length > 0 ? (
                      <div className="flex flex-wrap justify-center gap-3">
                        {game.currentTrick.map((play) => {
                          const player = game.players.find((entry) => entry.id === play.playerId);
                          return (
                            <div key={`${play.playerId}-${play.card.id}`} className="flex flex-col items-center gap-2">
                              <PlayingCard card={play.card} size="sm" faceUp />
                              <div className="text-xs text-white/75">{player?.name ?? play.playerId}</div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="max-w-sm text-center text-sm text-white/70">
                        Lead card will appear here. Keep your next play close to the center so the table stays readable.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/10 bg-black/25 p-5">
                  <div className="text-xs uppercase tracking-[0.22em] text-brass">Trump</div>
                  <div className="mt-4 flex items-center gap-4">
                    {game.trumpCard ? (
                      <PlayingCard card={game.trumpCard} size="sm" faceUp />
                    ) : (
                      <div className="flex h-[112px] w-[80px] items-center justify-center rounded-[18px] border border-dashed border-white/15 bg-white/5 text-xs uppercase tracking-[0.18em] text-white/50">
                        None
                      </div>
                    )}
                    <div className="text-sm text-white/80">
                      {game.needsDealerChoice
                        ? "Wizard turned up. The dealer must choose trump."
                        : game.trumpSuit
                          ? `${SUIT_LABELS[game.trumpSuit]} are trump this hand.`
                          : "This hand is no trump."}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-brass">{self ? `${self.name}'s hand` : "Your hand"}</div>
                  <div className="mt-1 text-sm text-white/70">
                    {isActive && game.phase === "playing"
                      ? "Playable cards are lifted. Pick one to play."
                      : "Your hand stays anchored below the trick so your next move is always nearby."}
                  </div>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75">
                  {game.yourHand.length} cards
                </div>
              </div>

              <div className="overflow-x-auto pb-2">
                <div className="flex min-w-max items-end gap-0 px-2 pt-6">
                  {game.yourHand.map((card) => {
                    const playable = game.playableCardIds.includes(card.id);
                    const matchesWinningCard =
                      !!winningCard &&
                      ((winningCard.kind === "number" && card.kind === "number" && card.suit === winningCard.suit) ||
                        (winningCard.kind === "wizard" && card.kind === "wizard") ||
                        (winningCard.kind === "jester" && card.kind === "jester"));
                    return (
                      <button
                        key={card.id}
                        type="button"
                        disabled={game.phase !== "playing" || !isActive || !playable}
                        onClick={() => onPlayCard(card.id)}
                        className={`-ml-5 first:ml-0 ${playable && isActive ? "translate-y-[-10px]" : "translate-y-0 opacity-90"} ${matchesWinningCard ? "z-10" : ""} transition hover:z-10 hover:translate-y-[-18px] disabled:hover:translate-y-0`}
                        aria-label={`Play ${formatCard(card)}`}
                      >
                        <PlayingCard
                          card={card}
                          size="lg"
                          faceUp
                          interactive={playable && isActive}
                          className={`${playable && isActive ? "shadow-2xl" : "shadow-lg opacity-80"} ${matchesWinningCard ? "ring-2 ring-sky-300/85 ring-offset-2 ring-offset-transparent" : ""}`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <ActionRail
            game={game}
            selfPlayerId={selfPlayerId}
            isActive={isActive}
            isTrumpChooser={isTrumpChooser}
            showDevTimeline={showDevTimeline}
            onChooseTrump={onChooseTrump}
            onBid={onBid}
          />
        </div>
      </div>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-black/20 p-6 shadow-table backdrop-blur">
      <h2 className="font-display text-2xl">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function OptionField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm text-brass">{label}</span>
      {children}
    </label>
  );
}

function NumberOption({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <OptionField label={label}>
      <input
        type="number"
        min={0}
        max={100}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-parchment outline-none disabled:opacity-60"
      />
    </OptionField>
  );
}

function Badge({ label }: { label: string }) {
  return <span className="rounded-full border border-brass/35 bg-brass/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-brass">{label}</span>;
}

function StatPill({ label }: { label: string }) {
  return <span className="rounded-full bg-white/10 px-3 py-1">{label}</span>;
}

function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-brass">{title}</div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MenuStat({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <span className="text-white/70">{label}</span>
      <span className={emphasize ? "font-semibold tracking-[0.24em] text-brass" : "font-semibold"}>{value}</span>
    </div>
  );
}

function PlayerLobbyCard({
  player,
  isSelf,
}: {
  player: PublicRoomState["players"][number];
  isSelf: boolean;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold">{player.name}</div>
        <span className="text-xs uppercase tracking-[0.18em] text-brass">Seat {player.seat + 1}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.16em] text-white/70">
        {isSelf ? <StatPill label="You" /> : null}
        {player.isBot ? <StatPill label="CPU" /> : null}
        {player.connected ? <StatPill label="Online" /> : <StatPill label="Away" />}
        {player.isHost ? <StatPill label="Host" /> : null}
      </div>
    </div>
  );
}

function ActionRail({
  game,
  selfPlayerId,
  isActive,
  isTrumpChooser,
  showDevTimeline,
  onChooseTrump,
  onBid,
}: {
  game: PublicGameState;
  selfPlayerId: string | null;
  isActive: boolean;
  isTrumpChooser: boolean;
  showDevTimeline: boolean;
  onChooseTrump: (suit: CardSuit) => void;
  onBid: (bid: number) => void;
}) {
  const activePlayer = game.players.find((player) => player.id === game.activePlayerId) ?? null;
  const self = game.players.find((player) => player.id === selfPlayerId) ?? null;

  return (
    <aside className="grid gap-4">
      <section className="rounded-[28px] border border-brass/25 bg-[linear-gradient(160deg,rgba(201,165,99,0.18),rgba(11,26,33,0.92))] p-5">
        <div className="text-xs uppercase tracking-[0.22em] text-brass">Current action</div>
        <div className="mt-3 text-2xl font-semibold leading-tight">
          {game.phase === "choose-trump"
            ? isTrumpChooser
              ? "Choose the trump suit."
              : `Waiting for ${activePlayer?.name ?? "the dealer"} to choose trump.`
            : game.phase === "bidding"
              ? isActive
                ? "Lock in your bid."
                : `Waiting for ${activePlayer?.name ?? "the next player"} to bid.`
              : game.phase === "playing"
                ? isActive
                  ? "Play one card."
                  : `Waiting for ${activePlayer?.name ?? "the next player"} to play.`
                : "Match complete."}
        </div>
        <div className="mt-3 text-sm text-white/75">
          {game.phase === "choose-trump"
            ? "The wizard turn-up changed the normal flow. Resolve trump first so bidding can start."
            : game.phase === "bidding"
              ? "Bid controls stay here so the choice is adjacent to the trick and score state."
              : game.phase === "playing"
                ? isActive
                  ? "Your playable cards are highlighted in your hand below."
                  : `${activePlayer?.name ?? "Another player"} is on the move.`
                : `Winner${game.winnerIds && game.winnerIds.length > 1 ? "s" : ""}: ${game.players
                    .filter((player) => game.winnerIds?.includes(player.id))
                    .map((player) => player.name)
                    .join(", ")}`}
        </div>

        {isTrumpChooser ? (
          <div className="mt-5 grid grid-cols-2 gap-2">
            {(Object.keys(SUIT_LABELS) as CardSuit[]).map((suit) => (
              <button
                key={suit}
                onClick={() => onChooseTrump(suit)}
                className="rounded-2xl border border-brass/40 px-4 py-3 text-sm font-semibold text-brass transition hover:bg-brass/10"
              >
                {SUIT_SYMBOLS[suit]} {SUIT_LABELS[suit]}
              </button>
            ))}
          </div>
        ) : null}

        {game.phase === "bidding" && isActive ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {game.allowedBids.map((bid) => (
              <button
                key={bid}
                onClick={() => onBid(bid)}
                className="min-w-12 rounded-2xl bg-brass px-4 py-3 text-sm font-semibold text-ink transition hover:bg-[#e0bb77]"
              >
                {bid}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-[24px] border border-white/10 bg-black/20 p-5">
        <div className="text-xs uppercase tracking-[0.22em] text-brass">Round state</div>
        <div className="mt-4 grid gap-3">
          {game.players.map((player) => (
            <div key={player.id} className={`rounded-2xl border p-4 text-sm ${player.id === self?.id ? "border-brass/30 bg-brass/10" : "border-white/10 bg-white/5"}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{player.name}</span>
                <span className="text-brass">{player.score} pts</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <StatPill label={`Bid ${player.bid ?? "?"}`} />
                <StatPill label={`Taken ${player.taken}`} />
                <StatPill label={`${player.handCount} left`} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {showDevTimeline ? (
        <section className="rounded-[24px] border border-sky-300/20 bg-sky-400/5 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.22em] text-sky-200">Dev timeline</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-sky-100/70">0.5s step delay</div>
          </div>
          <div className="mt-4 grid max-h-[360px] gap-3 overflow-y-auto pr-1">
            {game.devTimeline.length > 0 ? (
              game.devTimeline
                .slice()
                .reverse()
                .map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-sky-200/10 bg-black/20 px-4 py-3 text-sm">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-sky-200/70">Hand {entry.handNumber}</div>
                    <div className="mt-1 text-white/85">{entry.message}</div>
                  </div>
                ))
            ) : (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/60">
                Actions will appear here as the hand progresses.
              </div>
            )}
          </div>
        </section>
      ) : null}
    </aside>
  );
}

function PlayingCard({
  card,
  size,
  faceUp,
  interactive = false,
  className = "",
}: {
  card: Card;
  size: "sm" | "lg";
  faceUp: boolean;
  interactive?: boolean;
  className?: string;
}) {
  const palette = getCardPalette(card);
  const dimensions = size === "lg" ? "h-[180px] w-[124px] rounded-[24px] p-4" : "h-[112px] w-[80px] rounded-[18px] p-3";
  const cornerSize = size === "lg" ? "text-sm" : "text-[11px]";
  const centerSize = size === "lg" ? "text-[2.295rem]" : "text-[1.44rem]";

  if (!faceUp) {
    return (
      <div
        className={`${dimensions} ${className} relative overflow-hidden border border-[#f3d69b]/20 bg-[linear-gradient(145deg,#20394a,#10212c)] shadow-lg`}
      >
        <div className="absolute inset-2 rounded-[inherit] border border-[#f3d69b]/20 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.1),transparent_35%),repeating-linear-gradient(135deg,rgba(201,165,99,0.14)_0,rgba(201,165,99,0.14)_8px,transparent_8px,transparent_16px)]" />
        <div className="absolute inset-0 flex items-center justify-center font-display text-xl text-brass/90">W</div>
      </div>
    );
  }

  return (
    <div
      className={`${dimensions} ${className} relative flex flex-col justify-between overflow-hidden border bg-[#fffaf0] text-ink ${
        interactive ? "border-brass/70 ring-1 ring-brass/30" : "border-black/10"
      }`}
    >
      <div className={`absolute inset-0 opacity-90 ${palette.background}`} />
      <div className="relative flex items-start justify-between">
        <div className={`font-semibold leading-none ${palette.textClass}`}>
          <div className={cornerSize}>{cardRank(card)}</div>
          <div className={cornerSize}>{cardSuitMark(card)}</div>
        </div>
      </div>
      <div className="relative flex flex-1 items-center justify-center">
        {card.kind === "number" ? <div className={`${centerSize} leading-none ${palette.textClass}`}>{SUIT_SYMBOLS[card.suit]}</div> : null}
      </div>
      <div className="relative flex justify-end">
        <div className={`rotate-180 font-semibold leading-none ${cornerSize} ${palette.textClass}`}>
          <div>{cardRank(card)}</div>
          <div>{cardSuitMark(card)}</div>
        </div>
      </div>
    </div>
  );
}

function CardBackStack({ count, compact = false }: { count: number; compact?: boolean }) {
  const visibleCount = Math.min(Math.max(count, 1), compact ? 3 : 4);
  return (
    <div className={`relative ${compact ? "h-[72px] w-[54px]" : "h-[84px] w-[64px]"}`}>
      {Array.from({ length: visibleCount }).map((_, index) => (
        <div key={index} className="absolute" style={{ left: index * 5, top: index * 3 }}>
          <PlayingCard
            card={{ id: `back-${index}`, kind: "wizard", label: "W" }}
            size="sm"
            faceUp={false}
            interactive={false}
          />
        </div>
      ))}
    </div>
  );
}

function formatCard(card: PublicGameState["yourHand"][number]): string {
  if (card.kind === "wizard") {
    return "Wizard";
  }

  if (card.kind === "jester") {
    return "Jester";
  }

  return card.label;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function currentRoomCode(): string | null {
  const match = window.location.pathname.match(/\/room\/([A-Z0-9]{6})/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}

function formatPhaseLabel(game: PublicGameState | null, activePlayer: PublicGameState["players"][number] | null) {
  if (!game) {
    return "In progress";
  }

  if (game.phase === "choose-trump") {
    return "Choose trump";
  }

  if (game.phase === "bidding") {
    return activePlayer ? `${activePlayer.name} bidding` : "Bidding";
  }

  if (game.phase === "playing") {
    return activePlayer ? `${activePlayer.name} playing` : "Playing";
  }

  return "Game over";
}

function getCurrentWinningCard(game: PublicGameState): Card | null {
  if (game.currentTrick.length === 0) {
    return null;
  }

  const result = resolveTrick(game.currentTrick, game.trumpSuit);
  return result.plays.find((play) => play.playerId === result.winnerId)?.card ?? null;
}

function getPlayersRelativeToSelf(game: PublicGameState, selfPlayerId: string) {
  const self = game.players.find((player) => player.id === selfPlayerId);
  if (!self) {
    return game.players;
  }

  return game.players
    .slice()
    .sort((left, right) => ((left.seat - self.seat + game.players.length) % game.players.length) - ((right.seat - self.seat + game.players.length) % game.players.length));
}

function cardRank(card: Card) {
  if (card.kind === "wizard") {
    return "W";
  }

  if (card.kind === "jester") {
    return "J";
  }

  if (card.kind !== "number") {
    return card.label;
  }

  const { rank } = card;

  if (rank <= 10) {
    return `${rank}`;
  }

  const faceRanks: Record<number, string> = {
    11: "J",
    12: "Q",
    13: "K",
    14: "A",
  };

  return faceRanks[rank] ?? `${rank}`;
}

function cardSuitMark(card: Card) {
  if (card.kind !== "number") {
    return "★";
  }

  return SUIT_SYMBOLS[card.suit];
}

function getCardPalette(card: Card) {
  if (card.kind === "wizard") {
    return {
      textClass: "text-[#143a6b]",
      background: "bg-[linear-gradient(180deg,#fefefe_0%,#d8ebff_100%)]",
    };
  }

  if (card.kind === "jester") {
    return {
      textClass: "text-[#6a1f1f]",
      background: "bg-[linear-gradient(180deg,#fff7ec_0%,#f5d8bf_100%)]",
    };
  }

  if (card.kind !== "number") {
    return {
      textClass: "text-[#182534]",
      background: "bg-[linear-gradient(180deg,#ffffff_0%,#e9eff5_100%)]",
    };
  }

  const { suit } = card;

  if (suit === "hearts" || suit === "diamonds") {
    return {
      textClass: "text-[#b42323]",
      background: "bg-[linear-gradient(180deg,#fffdfc_0%,#ffe5e0_100%)]",
    };
  }

  return {
    textClass: "text-[#182534]",
    background: "bg-[linear-gradient(180deg,#ffffff_0%,#e9eff5_100%)]",
  };
}
