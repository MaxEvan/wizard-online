import { startTransition, useEffect, useRef, useState, type CSSProperties, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { io, type Socket } from "socket.io-client";

import { createDeck, resolveTrick } from "@wizard/shared";
import type { Card, CardSuit, PublicGameState, PublicRoomState, RoomAvailability, RoomOptions } from "@wizard/shared";

import { createRoom, joinRoom, loadRoom, loadRoomAvailability } from "./lib/api";
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
const FULL_DECK = createDeck();

export default function App() {
  const showDevSimulation = import.meta.env.DEV;
  const routedJoinCode = currentJoinCode();
  const [name, setName] = useState(getStoredName);
  const [renameDraft, setRenameDraft] = useState("");
  const [joinCode, setJoinCode] = useState(routedJoinCode ?? "");
  const [playerId, setPlayerId] = useState<string | null>(() => {
    const code = currentRoomCode();
    return code ? getStoredPlayerId(code) : null;
  });
  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [roomAvailability, setRoomAvailability] = useState<RoomAvailability | null>(null);
  const [draftOptions, setDraftOptions] = useState<RoomOptions>(DEFAULT_OPTIONS);
  const [simulateBots, setSimulateBots] = useState(showDevSimulation);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [showFullDeck, setShowFullDeck] = useState(false);
  const [showRoundHistory, setShowRoundHistory] = useState(false);
  const [systemToastMessage, setSystemToastMessage] = useState<string | null>(null);
  const self = room?.players.find((player) => player.id === playerId) ?? null;
  const game = room?.game ?? null;
  const isHost = room?.hostPlayerId === playerId;
  const canStart = !!room && room.players.length === room.options.playerCount && room.status === "lobby";
  const activePlayer = game?.players.find((player) => player.id === game.activePlayerId) ?? null;
  const canRenameSelf = room?.status === "lobby" && !!playerId;
  const normalizedJoinCode = joinCode.trim().toUpperCase();
  const joinBlockedReason = roomAvailability && roomAvailability.code === normalizedJoinCode ? roomAvailability.reason : null;
  const canSubmitJoin = normalizedJoinCode.length === 6 && !busy && joinBlockedReason === null;
  const showJoinOnlyLanding = !!routedJoinCode;

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

    setShowTableMenu(room.status === "lobby" && room.hostPlayerId === playerId);
  }, [playerId, room]);

  useEffect(() => {
    if (!systemToastMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSystemToastMessage(null);
    }, 2200);

    return () => window.clearTimeout(timeoutId);
  }, [systemToastMessage]);

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
    if (room || normalizedJoinCode.length !== 6) {
      setRoomAvailability(null);
      return;
    }

    let canceled = false;
    loadRoomAvailability(normalizedJoinCode)
      .then((availability) => {
        if (!canceled) {
          setRoomAvailability(availability);
          setError(null);
        }
      })
      .catch((nextError) => {
        if (!canceled) {
          setRoomAvailability(null);
          if (routedJoinCode === normalizedJoinCode) {
            setError(getErrorMessage(nextError));
          }
        }
      });

    return () => {
      canceled = true;
    };
  }, [normalizedJoinCode, room, routedJoinCode]);

  useEffect(() => {
    if (!room || !playerId) {
      socket?.disconnect();
      setSocket(null);
      return;
    }

    const nextSocket = io({
      path: "/api/socket.io",
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
    if (!canSubmitJoin) {
      return;
    }

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

  function handleSaveOptions() {
    emit("room:update-options", { options: draftOptions });
    setShowTableMenu(false);
    setSystemToastMessage("Saved successfully");
  }

  async function handleCopyInviteLink() {
    if (!room) {
      return;
    }

    try {
      await navigator.clipboard.writeText(joinRoomUrl(room.code));
      setSystemToastMessage("Invite link copied");
    } catch {
      setError("Unable to copy the invite link.");
    }
  }

  async function handleCopyRoomCode() {
    if (!room) {
      return;
    }

    try {
      await navigator.clipboard.writeText(room.code);
      setSystemToastMessage("Room code copied");
    } catch {
      setError("Unable to copy the room code.");
    }
  }

  return (
    <main className="min-h-screen px-4 py-6 text-parchment md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-3 rounded-[28px] border border-white/10 bg-black/20 p-6 shadow-table backdrop-blur md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-body text-sm uppercase tracking-[0.24em] text-brass">Wizard Online</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {game && game.roundHistory.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowRoundHistory(true)}
                className="rounded-full border border-brass/40 bg-brass/10 px-4 py-3 text-sm font-semibold text-brass transition hover:bg-brass/20"
              >
                Full rounds history
              </button>
            ) : null}
            {room ? (
              <button
                type="button"
                onClick={() => setShowFullDeck(true)}
                className="rounded-full border border-brass/40 bg-brass/10 px-4 py-3 text-sm font-semibold text-brass transition hover:bg-brass/20"
              >
                Deck Reference
              </button>
            ) : null}
            {!room ? (
              <div className="rounded-full border border-brass/30 bg-brass/10 px-4 py-3 text-sm text-brass">
                {showJoinOnlyLanding ? `Joining room ${routedJoinCode}` : "Create a room or join an existing code"}
              </div>
            ) : null}
            {room ? (
              <button
                type="button"
                onClick={() => setShowTableMenu((current) => !current)}
                className="rounded-full border border-brass/40 bg-brass/10 px-4 py-3 text-sm font-semibold text-brass transition hover:bg-brass/20"
              >
                {showTableMenu ? "Hide table options" : "Show table options"}
              </button>
            ) : null}
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div> : null}

        {!room ? (
          <section className={showJoinOnlyLanding ? "mx-auto w-full max-w-2xl" : "grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"}>
            {showJoinOnlyLanding ? null : (
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
            )}

            <form onSubmit={handleJoinRoom} className="rounded-[28px] border border-white/10 bg-black/20 p-6 shadow-table backdrop-blur">
              <h2 className="font-display text-2xl">Join by code</h2>
              {routedJoinCode ? (
                <p className="mt-3 text-sm text-white/70">
                  This invite link opens room <span className="font-semibold tracking-[0.2em] text-brass">{routedJoinCode}</span>.
                </p>
              ) : null}
              <div className="mt-5 grid gap-4">
                <label className="flex flex-col gap-2">
                  <span className="text-sm text-brass">Display name</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-parchment outline-none"
                    placeholder="Enter your name"
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
              {roomAvailability && roomAvailability.code === normalizedJoinCode ? (
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/75">
                  {roomAvailability.joinable
                    ? `Open seats: ${roomAvailability.playerCount - roomAvailability.joinedCount}.`
                    : roomAvailability.reason}
                </div>
              ) : null}
              <button
                type="submit"
                disabled={!canSubmitJoin}
                className="mt-6 rounded-2xl border border-brass/60 px-5 py-3 font-semibold text-brass transition hover:bg-brass/10 disabled:opacity-60"
              >
                Join room
              </button>
            </form>
          </section>
        ) : (
          <section className="grid gap-6">
            <div className="grid gap-6">
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
                        {isHost ? (
                          <div className="mt-6 grid gap-3">
                            <button
                              type="button"
                              onClick={() => void handleCopyInviteLink()}
                              className="w-full rounded-2xl border border-brass/40 bg-brass/10 px-5 py-3 text-sm font-semibold text-brass transition hover:bg-brass/20"
                            >
                              Copy invite link
                            </button>
                          </div>
                        ) : null}
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
                    isHost={isHost}
                    onChooseTrump={(suit) => emit("game:choose-trump", { suit })}
                    onBid={(bid) => emit("game:bid", { bid })}
                    onPlayCard={(cardId) => emit("game:play-card", { cardId })}
                    onNextRound={() => emit("game:next-round", {})}
                  />
                ) : null}

              </section>
            </div>
          </section>
        )}

        {room && showTableMenu ? (
          <TableMenuDialog
            room={room}
            self={self}
            isHost={isHost}
            canRenameSelf={canRenameSelf}
            renameDraft={renameDraft}
            setRenameDraft={setRenameDraft}
            handleRenameSelf={handleRenameSelf}
            draftOptions={draftOptions}
            setDraftOptions={setDraftOptions}
            onSaveOptions={handleSaveOptions}
            onClose={() => setShowTableMenu(false)}
          />
        ) : null}
        {room && showFullDeck ? (
          <FullDeckDialog onClose={() => setShowFullDeck(false)} />
        ) : null}
        {game && showRoundHistory ? (
          <RoundHistoryDialog
            history={game.roundHistory}
            players={game.players}
            onClose={() => setShowRoundHistory(false)}
          />
        ) : null}
        {systemToastMessage ? <SystemToast message={systemToastMessage} /> : null}

      </div>
    </main>
  );
}

function GameBoard({
  game: incomingGame,
  selfPlayerId,
  roomCode,
  isHost,
  onChooseTrump,
  onBid,
  onPlayCard,
  onNextRound,
}: {
  game: PublicGameState;
  selfPlayerId: string | null;
  roomCode: string;
  isHost: boolean;
  onChooseTrump: (suit: CardSuit) => void;
  onBid: (bid: number) => void;
  onPlayCard: (cardId: string) => void;
  onNextRound: () => void;
}) {
  const [game, setGame] = useState(incomingGame);
  const self = game.players.find((player) => player.id === selfPlayerId) ?? null;
  const dealer = game.players.find((player) => player.seat === game.dealerIndex) ?? null;
  const isWaitingForNextRound = incomingGame.phase === "round-summary";
  const isTrumpChooser = game.phase === "choose-trump" && dealer?.id === selfPlayerId;
  const isActive = game.activePlayerId === selfPlayerId;
  const turnToastMessage = getTurnToastMessage(game, selfPlayerId, dealer?.id ?? null, self?.isBot ?? false);
  const visibleBidCount = game.players.filter((player) => player.bid !== null).length;
  const visibleBidTotal = game.players.reduce((sum, player) => sum + (player.bid ?? 0), 0);
  const totalTurnsInHand = game.handSize * game.players.length;
  const currentTurnInHand =
    game.phase === "playing"
      ? Math.min(totalTurnsInHand, game.completedTrickCount * game.players.length + game.currentTrick.length + 1)
      : game.phase === "round-summary" || game.phase === "game-over"
        ? totalTurnsInHand
        : 0;
  const orderedPlayers = self ? getPlayersRelativeToSelf(game, self.id) : game.players;
  const seatPositions = getTableSeatPositions(orderedPlayers.length);
  const winningCard = getCurrentWinningCard(game);
  const trickCardScale = getCenterTrickCardScale(game.players.length);
  const [activeDialog, setActiveDialog] = useState<"hand" | "bid" | "trump" | null>(null);
  const [trickCollectAnimation, setTrickCollectAnimation] = useState<TrickCollectAnimation | null>(null);
  const [finalTrickAnimation, setFinalTrickAnimation] = useState<FinalTrickAnimation | null>(null);
  const [roundSummaryDialog, setRoundSummaryDialog] = useState<PublicGameState["previousRoundSummary"] | null>(null);
  const [pendingSelfPlayCard, setPendingSelfPlayCard] = useState<Card | null>(null);
  const displayedGameRef = useRef(game);
  const previousTurnRef = useRef<{ phase: PublicGameState["phase"]; activePlayerId: string }>({
    phase: game.phase,
    activePlayerId: game.activePlayerId,
  });
  const animationInFlightRef = useRef(false);
  const queuedGameRef = useRef<PublicGameState | null>(null);
  const entryAnimationTimeoutRef = useRef<number | null>(null);
  const trickCollectTimeoutRef = useRef<number | null>(null);
  const finalSequenceTimeoutRef = useRef<number | null>(null);
  const primarySeatAction =
    game.phase === "choose-trump" && isTrumpChooser
      ? { label: "Choose trump", dialog: "trump" as const }
      : game.phase === "bidding" && isActive
        ? { label: "Take bid", dialog: "bid" as const }
        : { label: "Show hand", dialog: "hand" as const };
  const seatActions = [primarySeatAction];

  useEffect(() => {
    setActiveDialog(null);
  }, [game.roundNumber, game.phase, selfPlayerId]);

  useEffect(() => {
    if (!game.previousRoundSummary) {
      setRoundSummaryDialog(null);
    }
  }, [game.previousRoundSummary]);

  useEffect(() => {
    displayedGameRef.current = game;
  }, [game]);

  useEffect(() => {
    const previousTurn = previousTurnRef.current;
    const isSelfTurnToPlay = game.phase === "playing" && game.activePlayerId === selfPlayerId;
    const wasSelfTurnToPlay = previousTurn.phase === "playing" && previousTurn.activePlayerId === selfPlayerId;

    if (isSelfTurnToPlay && !wasSelfTurnToPlay) {
      setActiveDialog("hand");
    }

    previousTurnRef.current = {
      phase: game.phase,
      activePlayerId: game.activePlayerId,
    };
  }, [game.activePlayerId, game.phase, selfPlayerId]);

  useEffect(() => {
    if (animationInFlightRef.current) {
      queuedGameRef.current = incomingGame;
      return;
    }

    if (incomingGame === displayedGameRef.current) {
      return;
    }

    const displayedGame = displayedGameRef.current;
    const trickResolved = didResolveTrick(displayedGame, incomingGame);

    if (!trickResolved || !incomingGame.lastResolvedTrick) {
      setGame(incomingGame);
      if (incomingGame.previousRoundSummary && !displayedGame.previousRoundSummary) {
        setRoundSummaryDialog(incomingGame.previousRoundSummary);
      }
      setPendingSelfPlayCard(null);
      return;
    }

    const resolvedTrick = incomingGame.lastResolvedTrick;
    const stagedGame = buildResolvedTrickDisplayGame(displayedGame, incomingGame, selfPlayerId, resolvedTrick);
    const lastPlay = resolvedTrick.plays[resolvedTrick.plays.length - 1]!;
    const winnerId = resolvedTrick.winnerId;
    const sourcePlayerIndex = orderedPlayers.findIndex((player) => player.id === lastPlay.playerId);
    const winnerPlayerIndex = orderedPlayers.findIndex((player) => player.id === winnerId);
    const sourceSeat = seatPositions[sourcePlayerIndex >= 0 ? sourcePlayerIndex : 0] ?? seatPositions[0]!;
    const targetSeat = seatPositions[winnerPlayerIndex >= 0 ? winnerPlayerIndex : 0] ?? seatPositions[0]!;
    const trickPosition = getResolvedTrickPosition(resolvedTrick, orderedPlayers, seatPositions);
    const targetPosition = getWonTrickPileAnchor(targetSeat);
    const isFinalTrick = incomingGame.roundNumber > displayedGame.roundNumber;

    animationInFlightRef.current = true;
    queuedGameRef.current = incomingGame;
    setGame(stagedGame);
    setPendingSelfPlayCard(null);

    if (entryAnimationTimeoutRef.current) {
      window.clearTimeout(entryAnimationTimeoutRef.current);
    }

    entryAnimationTimeoutRef.current = window.setTimeout(() => {
      setGame((current) => ({
        ...current,
        currentTrick: [],
      }));

      if (isFinalTrick) {
        setFinalTrickAnimation({
          id: `${displayedGame.roundNumber}-${resolvedTrick.plays.length}-${winnerId}`,
          source: sourceSeat,
          trick: trickPosition,
          target: targetPosition,
          card: lastPlay.card,
        });

        if (finalSequenceTimeoutRef.current) {
          window.clearTimeout(finalSequenceTimeoutRef.current);
        }

        finalSequenceTimeoutRef.current = window.setTimeout(() => {
          const nextGame = queuedGameRef.current ?? incomingGame;
          setFinalTrickAnimation(null);
          setGame(nextGame);
          if (nextGame.previousRoundSummary) {
            setRoundSummaryDialog(nextGame.previousRoundSummary);
          }
          animationInFlightRef.current = false;
          queuedGameRef.current = null;
          finalSequenceTimeoutRef.current = null;
        }, FINAL_TRICK_ANIMATION_MS);

        return;
      }

      setTrickCollectAnimation({
        id: `${incomingGame.roundNumber}-${incomingGame.completedTrickCount}-${winnerId}`,
        source: trickPosition,
        target: targetPosition,
      });

      if (trickCollectTimeoutRef.current) {
        window.clearTimeout(trickCollectTimeoutRef.current);
      }

      trickCollectTimeoutRef.current = window.setTimeout(() => {
        const nextGame = queuedGameRef.current ?? incomingGame;
        setTrickCollectAnimation(null);
        setGame(nextGame);
        animationInFlightRef.current = false;
        queuedGameRef.current = null;
        trickCollectTimeoutRef.current = null;
      }, TRICK_COLLECT_ANIMATION_MS);
    }, TRICK_ENTRY_ANIMATION_MS);
  }, [incomingGame, orderedPlayers, seatPositions, selfPlayerId]);

  useEffect(() => {
    return () => {
      animationInFlightRef.current = false;
      if (entryAnimationTimeoutRef.current) {
        window.clearTimeout(entryAnimationTimeoutRef.current);
      }
      if (trickCollectTimeoutRef.current) {
        window.clearTimeout(trickCollectTimeoutRef.current);
      }
      if (finalSequenceTimeoutRef.current) {
        window.clearTimeout(finalSequenceTimeoutRef.current);
      }
    };
  }, []);

  return (
    <Panel title={`Hand ${game.roundNumber} of ${game.maxRounds}`}>
      <div className="grid gap-5">
        <div className="grid gap-5">
          <div className="flex items-center justify-center">
            <div className="rounded-full border border-brass/30 bg-black/20 px-5 py-2 text-center shadow-[0_12px_28px_rgba(0,0,0,0.2)] backdrop-blur">
              <div className="text-[10px] uppercase tracking-[0.2em] text-brass">Turn In Hand</div>
              <div className="mt-1 text-sm font-semibold text-parchment">
                {currentTurnInHand} of {totalTurnsInHand}
              </div>
            </div>
          </div>
          <div className="rounded-[32px] border border-[#e3c98d]/18 bg-[radial-gradient(circle_at_50%_45%,rgba(255,255,255,0.08),transparent_40%),radial-gradient(circle_at_50%_50%,rgba(8,33,24,0.2),transparent_58%),linear-gradient(180deg,rgba(18,78,60,0.96),rgba(6,38,29,0.98))] p-3 shadow-[inset_0_2px_0_rgba(255,255,255,0.08),inset_0_-24px_80px_rgba(0,0,0,0.28),0_30px_80px_rgba(2,12,10,0.42)] sm:p-5">
            <div className="rounded-[28px] border border-[#f1d7a1]/12 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06),transparent_42%),linear-gradient(180deg,rgba(14,66,50,0.58),rgba(6,27,20,0.8))] px-3 py-4 sm:px-5 sm:py-6">
              <div className="relative min-h-[720px] overflow-hidden rounded-[24px] border border-black/15 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_28%),radial-gradient(circle_at_50%_48%,rgba(2,20,15,0.4),transparent_62%),repeating-radial-gradient(circle_at_center,rgba(255,255,255,0.025)_0,rgba(255,255,255,0.025)_2px,transparent_2px,transparent_10px)] px-2 py-3 sm:min-h-[780px]">
                  <div className="pointer-events-none absolute inset-[7%] rounded-[999px] border border-[#f1d7a1]/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04),inset_0_36px_60px_rgba(255,255,255,0.02),inset_0_-36px_80px_rgba(0,0,0,0.22)]" />
                  <div className="pointer-events-none absolute inset-x-[18%] top-[16%] h-[16%] rounded-full bg-white/5 blur-3xl" />

                  {orderedPlayers.map((player, index) => {
                    const isSelfPlayer = player.id === selfPlayerId;
                    const isTurn = player.id === game.activePlayerId;
                    const isDealer = player.seat === game.dealerIndex;
                    const seatPosition = seatPositions[index] ?? seatPositions[0]!;
                    const seatStyle: CSSProperties = {
                      left: `${seatPosition.x}%`,
                      top: `${seatPosition.y}%`,
                      width: isSelfPlayer ? "min(320px, calc(100% - 32px))" : "min(220px, calc(100% - 48px))",
                    };
                    const seatCard = (
                      <div
                        className={`rounded-[24px] border px-4 py-4 text-sm shadow-[0_18px_42px_rgba(0,0,0,0.28)] backdrop-blur ${
                          isTurn
                            ? "active-seat-pulse border-brass/70 bg-[linear-gradient(180deg,rgba(201,165,99,0.24),rgba(21,19,10,0.46))] shadow-[0_0_0_1px_rgba(201,165,99,0.22),0_18px_42px_rgba(0,0,0,0.28)]"
                            : "border-white/10 bg-[linear-gradient(180deg,rgba(0,0,0,0.38),rgba(0,0,0,0.28))]"
                        } ${isSelfPlayer ? "min-h-[148px]" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">{player.name}</div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em] text-white/70">
                              <span>{player.bid === null ? "Bid ?" : `Bid ${player.bid}`}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-brass">{player.score} pts</div>
                          </div>
                        </div>
                        <div className="mt-4 flex items-end justify-between gap-3">
                          <WonTrickPile count={player.taken} />
                          <div className="text-[11px] uppercase tracking-[0.16em] text-white/60">
                            {player.taken === 1 ? "1 trick" : `${player.taken} tricks`}
                          </div>
                        </div>
                      </div>
                    );

                    return (
                      <div
                        key={player.id}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 ${isSelfPlayer ? "z-30" : "z-20"}`}
                        style={seatStyle}
                      >
                        {isDealer ? (
                          <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-[70%] rounded-full border border-[#f5dc9f]/45 bg-[linear-gradient(180deg,rgba(255,242,201,0.94),rgba(197,157,78,0.92))] px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#432b11] shadow-[0_8px_18px_rgba(0,0,0,0.28)]">
                            Dealer
                          </div>
                        ) : null}
                        {seatCard}
                        {isSelfPlayer ? (
                          <div className="mt-3 flex justify-center gap-2">
                            {seatActions.map((action, index) => (
                              <button
                                key={`${action.label}-${index}`}
                                type="button"
                                onClick={() => setActiveDialog(action.dialog)}
                                className="rounded-full border border-brass/45 bg-[linear-gradient(180deg,rgba(201,165,99,0.22),rgba(70,51,18,0.5))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-brass shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition hover:bg-[linear-gradient(180deg,rgba(201,165,99,0.32),rgba(70,51,18,0.65))]"
                                aria-haspopup="dialog"
                                aria-expanded={activeDialog === action.dialog}
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  <div className="absolute left-1/2 top-[46%] z-10 w-[min(380px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06),transparent_45%),linear-gradient(180deg,rgba(9,44,32,0.52),rgba(6,27,20,0.5))] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.3)]">
                    <div className="text-center text-xs uppercase tracking-[0.22em] text-brass">Center trick</div>
                    <div className="relative mt-4 min-h-[280px]">
                      {game.currentTrick.length > 0 ? (
                        game.currentTrick.map((play) => {
                          const playerIndex = orderedPlayers.findIndex((entry) => entry.id === play.playerId);
                          const seatPosition = seatPositions[playerIndex >= 0 ? playerIndex : 0] ?? seatPositions[0]!;
                          const trickPosition = getTrickPositionFromSeat(seatPosition);
                          const isWinningPlay = winningCard?.id === play.card.id;
                          const entryOffsetX = `${(seatPosition.x - trickPosition.x) * 4}px`;
                          const entryOffsetY = `${(seatPosition.y - trickPosition.y) * 4}px`;
                          return (
                            <div
                              key={`${play.playerId}-${play.card.id}`}
                              className="trick-card-entry absolute -translate-x-1/2 -translate-y-1/2"
                              style={
                                {
                                  left: `${trickPosition.x}%`,
                                  top: `${trickPosition.y}%`,
                                  "--trick-entry-x": entryOffsetX,
                                  "--trick-entry-y": entryOffsetY,
                                } as CSSProperties
                              }
                            >
                              <div style={{ transform: `scale(${trickCardScale})`, transformOrigin: "center" }}>
                                <PlayingCard
                                  card={play.card}
                                  size="sm"
                                  faceUp
                                  className={isWinningPlay ? "ring-2 ring-sky-300/85 ring-offset-2 ring-offset-transparent" : ""}
                                />
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="flex min-h-[250px] items-center justify-center">
                          <div className="max-w-sm text-center text-sm text-white/70">
                            Lead card will land in the middle of the felt. Seats stay in table order so the trick reads clockwise.
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="absolute right-1 top-1 z-20 rounded-[18px] border border-white/10 bg-black/40 px-2.5 py-2 shadow-[0_12px_28px_rgba(0,0,0,0.24)] backdrop-blur sm:right-2 sm:top-2">
                    <div className="flex flex-col items-center text-center">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-brass">Trump</div>
                      <div className="mt-1 flex justify-center">
                      {game.trumpCard ? (
                        <div className="flex justify-center">
                          <div className="origin-center scale-[0.72]">
                          <PlayingCard card={game.trumpCard} size="sm" faceUp />
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-[80px] w-[58px] items-center justify-center rounded-[14px] border border-dashed border-white/15 bg-white/5 text-[10px] uppercase tracking-[0.18em] text-white/50">
                          None
                        </div>
                      )}
                      </div>
                      <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/70">
                        {game.trumpSuit ? SUIT_LABELS[game.trumpSuit] : "None"}
                      </div>
                    </div>
                  </div>
                  <div className="absolute left-1 top-1 z-20 rounded-[18px] border border-white/10 bg-black/40 px-3 py-2 shadow-[0_12px_28px_rgba(0,0,0,0.24)] backdrop-blur sm:left-2 sm:top-2">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-brass">Total bids</div>
                    <div className="mt-1 text-lg font-semibold text-parchment">{visibleBidTotal}</div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-white/70">
                      {visibleBidCount} of {game.players.length} shown
                    </div>
                  </div>
                  {trickCollectAnimation ? (
                    <div
                      key={trickCollectAnimation.id}
                      className="trick-collect-card absolute z-40"
                      style={
                        {
                          left: `${trickCollectAnimation.source.x}%`,
                          top: `${trickCollectAnimation.source.y}%`,
                          "--trick-collect-x": `${(trickCollectAnimation.target.x - trickCollectAnimation.source.x) * 1.1}%`,
                          "--trick-collect-y": `${(trickCollectAnimation.target.y - trickCollectAnimation.source.y) * 1.1}%`,
                        } as CSSProperties
                      }
                    >
                      <div className="trick-collect-card-face">
                        <PlayingCard
                          card={{ id: "trick-collect-back", kind: "wizard", label: "W" }}
                          size="sm"
                          faceUp={false}
                        />
                      </div>
                    </div>
                  ) : null}
                  {finalTrickAnimation ? (
                    <div
                      key={finalTrickAnimation.id}
                      className="final-trick-card absolute z-40"
                      style={
                        {
                          left: `${finalTrickAnimation.source.x}%`,
                          top: `${finalTrickAnimation.source.y}%`,
                          "--final-trick-mid-x": `${finalTrickAnimation.trick.x - finalTrickAnimation.source.x}%`,
                          "--final-trick-mid-y": `${finalTrickAnimation.trick.y - finalTrickAnimation.source.y}%`,
                          "--final-trick-end-x": `${finalTrickAnimation.target.x - finalTrickAnimation.source.x}%`,
                          "--final-trick-end-y": `${finalTrickAnimation.target.y - finalTrickAnimation.source.y}%`,
                        } as CSSProperties
                      }
                    >
                      <div className="final-trick-card-shell">
                        <div className="final-trick-card-face final-trick-card-front">
                          <PlayingCard
                            card={finalTrickAnimation.card ?? { id: "final-trick-front", kind: "wizard", label: "W" }}
                            size="sm"
                            faceUp={!!finalTrickAnimation.card}
                          />
                        </div>
                        <div className="final-trick-card-face final-trick-card-back">
                          <PlayingCard
                            card={{ id: "final-trick-back", kind: "wizard", label: "W" }}
                            size="sm"
                            faceUp={false}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
      {activeDialog ? (
        <ActionDialog
          mode={activeDialog}
          game={game}
          self={self}
          isActive={isActive}
          isTrumpChooser={isTrumpChooser}
          winningCard={winningCard}
          onClose={() => setActiveDialog(null)}
          onChooseTrump={(suit) => {
            onChooseTrump(suit);
            setActiveDialog(null);
          }}
          onBid={(bid) => {
            onBid(bid);
            setActiveDialog(null);
          }}
          onPlayCard={(cardId) => {
            setPendingSelfPlayCard(game.yourHand.find((card) => card.id === cardId) ?? null);
            onPlayCard(cardId);
            setActiveDialog(null);
          }}
        />
      ) : null}
      {roundSummaryDialog ? (
        <RoundSummaryDialog
          summary={roundSummaryDialog}
          players={game.players}
          canAdvance={isHost && isWaitingForNextRound}
          onAdvance={onNextRound}
          onClose={() => setRoundSummaryDialog(null)}
        />
      ) : null}
      {turnToastMessage ? <ActionToast message={turnToastMessage} onClick={() => setActiveDialog(primarySeatAction.dialog)} /> : null}
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

function ActionDialog({
  mode,
  game,
  self,
  isActive,
  isTrumpChooser,
  winningCard,
  onClose,
  onChooseTrump,
  onBid,
  onPlayCard,
}: {
  mode: "hand" | "bid" | "trump";
  game: PublicGameState;
  self: PublicGameState["players"][number] | null;
  isActive: boolean;
  isTrumpChooser: boolean;
  winningCard: Card | null;
  onClose: () => void;
  onChooseTrump: (suit: CardSuit) => void;
  onBid: (bid: number) => void;
  onPlayCard: (cardId: string) => void;
}) {
  let title = self ? `${self.name}'s hand` : "Your hand";
  let description = "Review your cards.";

  useEscapeToClose(onClose);

  if (mode === "bid") {
    title = "Take bid";
    description = "Choose the number of tricks you expect to take this hand, then review your cards below.";
  } else if (mode === "trump") {
    title = "Choose trump";
    description = "Pick the trump suit for this hand, then review your cards below if needed.";
  } else if (game.phase === "playing" && isActive) {
    description = "Playable cards are highlighted. Choose one card to play.";
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,10,8,0.72)] px-4 py-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      {game.trumpCard && mode !== "trump" ? (
        <div className="pointer-events-none fixed right-4 top-4 z-[60] rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,26,32,0.96),rgba(7,15,20,0.98))] px-3 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.38)] sm:right-6 sm:top-6">
          <div className="text-center text-[10px] uppercase tracking-[0.2em] text-brass">Trump</div>
          <div className="mt-2 flex justify-center">
            <div className="origin-center scale-[0.8]">
              <PlayingCard card={game.trumpCard} size="sm" faceUp />
            </div>
          </div>
          <div className="mt-1 text-center text-[10px] uppercase tracking-[0.18em] text-white/70">
            {game.trumpSuit ? SUIT_LABELS[game.trumpSuit] : "None"}
          </div>
        </div>
      ) : null}
      <div
        className="w-full max-w-4xl rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,26,32,0.96),rgba(7,15,20,0.98))] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.42)] sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-brass">{title}</div>
            <div className="mt-2 text-sm text-white/72">{description}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
          >
            Close
          </button>
        </div>

        {mode === "trump" ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {(Object.keys(SUIT_LABELS) as CardSuit[]).map((suit) => (
              <button
                key={suit}
                type="button"
                disabled={!isTrumpChooser}
                onClick={() => onChooseTrump(suit)}
                className="rounded-[22px] border border-brass/35 bg-brass/10 px-4 py-4 text-left transition hover:bg-brass/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="text-lg font-semibold text-brass">
                  {SUIT_SYMBOLS[suit]} {SUIT_LABELS[suit]}
                </div>
                <div className="mt-1 text-sm text-white/65">Set this suit as trump.</div>
              </button>
            ))}
          </div>
        ) : null}

        {mode === "bid" ? (
          <div className="mt-5 flex flex-wrap gap-3">
            {game.allowedBids.map((bid) => (
              <button
                key={bid}
                type="button"
                disabled={!isActive || game.phase !== "bidding"}
                onClick={() => onBid(bid)}
                className="min-w-10 rounded-2xl bg-brass px-3 py-2 text-[0.72rem] font-semibold text-ink transition hover:bg-[#e0bb77] disabled:cursor-not-allowed disabled:bg-brass/35"
              >
                {bid}
              </button>
            ))}
          </div>
        ) : null}

        {mode === "hand" || mode === "bid" || mode === "trump" ? (
          <HandCardFan
            cards={game.yourHand}
            winningCard={winningCard}
            isActive={isActive}
            isPlayingPhase={game.phase === "playing"}
            playableCardIds={game.playableCardIds}
            onPlayCard={onPlayCard}
          />
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function ActionToast({ message, onClick }: { message: string; onClick?: () => void }) {
  const toastClassName =
    "turn-toast rounded-full border border-brass/35 bg-[linear-gradient(180deg,rgba(18,26,32,0.92),rgba(8,15,20,0.96))] px-7 py-4 text-center text-[1.3125rem] font-semibold text-parchment shadow-[0_18px_42px_rgba(0,0,0,0.32)] backdrop-blur";

  return (
    <div className={`fixed inset-x-0 bottom-6 z-40 flex translate-y-[15%] justify-center px-4 ${onClick ? "" : "pointer-events-none"}`}>
      {onClick ? (
        <button type="button" className={toastClassName} onClick={onClick}>
          {message}
        </button>
      ) : (
        <div className={toastClassName}>{message}</div>
      )}
    </div>
  );
}

function SystemToast({ message }: { message: string }) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex max-w-sm justify-end sm:right-6 sm:top-6">
      <div className="flex min-w-[260px] items-start gap-3 rounded-2xl border border-white/10 bg-[rgba(20,28,34,0.96)] px-4 py-3 text-sm text-parchment shadow-[0_14px_32px_rgba(0,0,0,0.28)] backdrop-blur">
        <div className="mt-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(74,222,128,0.12)]" />
        <div className="min-w-0">
          <div className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-white/45">Notification</div>
          <div className="mt-1 font-medium text-white/92">{message}</div>
        </div>
      </div>
    </div>
  );
}

function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
}

function TableMenuDialog({
  room,
  self,
  isHost,
  canRenameSelf,
  renameDraft,
  setRenameDraft,
  handleRenameSelf,
  draftOptions,
  setDraftOptions,
  onSaveOptions,
  onClose,
}: {
  room: PublicRoomState;
  self: PublicRoomState["players"][number] | null;
  isHost: boolean;
  canRenameSelf: boolean;
  renameDraft: string;
  setRenameDraft: Dispatch<SetStateAction<string>>;
  handleRenameSelf: (event: FormEvent<HTMLFormElement>) => void;
  draftOptions: RoomOptions;
  setDraftOptions: Dispatch<SetStateAction<RoomOptions>>;
  onSaveOptions: () => void;
  onClose: () => void;
}) {
  useEscapeToClose(onClose);

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-[rgba(4,10,8,0.72)] px-4 py-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div className="flex min-h-full items-start justify-center sm:items-center">
      <div
        className="flex max-h-[calc(100vh-3rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,26,32,0.96),rgba(7,15,20,0.98))] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.42)] sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-brass">Table Options</div>
            <div className="mt-2 text-sm text-white/72">Room details, players, and lobby rules.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <div className="mt-5 min-h-0 overflow-y-auto pr-1 text-sm">
          <div className="grid gap-5">
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
                    Standard (dealer may match total bids)
                  </option>
                  <option value="no-equal-total" className="bg-ink">
                    No even total (dealer cannot make bids add up)
                  </option>
                  <option value="canadian" className="bg-ink">
                    Canadian (dealer chooses after others, cannot match total)
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
                  onClick={onSaveOptions}
                  className="rounded-2xl border border-brass/60 px-4 py-3 font-semibold text-brass transition hover:bg-brass/10"
                >
                  Save options
                </button>
              ) : null}
            </div>
          </MenuSection>
        </div>
        </div>
      </div>
      </div>
    </div>,
    document.body,
  );
}

function RoundSummaryDialog({
  summary,
  players,
  canAdvance,
  onAdvance,
  onClose,
}: {
  summary: NonNullable<PublicGameState["previousRoundSummary"]>;
  players: PublicGameState["players"];
  canAdvance: boolean;
  onAdvance: () => void;
  onClose: () => void;
}) {
  useEscapeToClose(() => {
    if (!canAdvance) {
      onClose();
    }
  });

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,10,8,0.72)] px-4 py-6 backdrop-blur-sm"
      onMouseDown={() => {
        if (!canAdvance) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-4xl rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,26,32,0.96),rgba(7,15,20,0.98))] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.42)] sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-brass">
              Hand Summary
            </div>
            <div className="mt-2 text-sm text-white/72">
              {summary.handSize} card{summary.handSize === 1 ? "" : "s"} played. Scores have been updated.
            </div>
          </div>
          {canAdvance ? (
            <button
              type="button"
              onClick={onAdvance}
              className="rounded-full bg-brass px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink transition hover:bg-[#e0bb77]"
            >
              Next round
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
            >
              Close
            </button>
          )}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {players.map((player) => (
            <div key={player.id} className="rounded-[22px] border border-white/10 bg-white/5 p-4 text-sm">
              <div className="font-semibold">{player.name}</div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-white/70">
                <StatPill label={`Bid ${summary.bids[player.id] ?? 0}`} />
                <StatPill label={`Took ${summary.taken[player.id] ?? 0}`} />
              </div>
              <div className="mt-4 text-lg font-semibold text-brass">
                {signed(summary.scoreDeltas[player.id] ?? 0)} pts
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function FullDeckDialog({ onClose }: { onClose: () => void }) {
  useEscapeToClose(onClose);

  const deckSections: Array<{ title: string; cards: Card[] }> = [
    {
      title: "Special",
      cards: [
        ...FULL_DECK.filter((card) => card.kind === "jester"),
        ...FULL_DECK.filter((card) => card.kind === "wizard"),
      ],
    },
    {
      title: "Clubs",
      cards: FULL_DECK.filter((card): card is Extract<Card, { kind: "number" }> => card.kind === "number" && card.suit === "clubs"),
    },
    {
      title: "Diamonds",
      cards: FULL_DECK.filter((card): card is Extract<Card, { kind: "number" }> => card.kind === "number" && card.suit === "diamonds"),
    },
    {
      title: "Hearts",
      cards: FULL_DECK.filter((card): card is Extract<Card, { kind: "number" }> => card.kind === "number" && card.suit === "hearts"),
    },
    {
      title: "Spades",
      cards: FULL_DECK.filter((card): card is Extract<Card, { kind: "number" }> => card.kind === "number" && card.suit === "spades"),
    },
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,10,8,0.72)] px-4 py-6 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="w-full max-w-6xl rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,26,32,0.96),rgba(7,15,20,0.98))] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.42)] sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-brass">Full Deck</div>
            <div className="mt-2 text-sm text-white/72">Reference view for every card in Wizard, including the special cards.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <div className="mt-5 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid gap-5">
            {deckSections.map((section) => (
              <section key={section.title} className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.22em] text-brass">{section.title}</div>
                <div className="mt-4 flex flex-wrap gap-3">
                  {section.cards.map((card) => (
                    <div key={card.id} className="origin-top-left scale-[0.85]">
                      <PlayingCard card={card} size="sm" faceUp />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RoundHistoryDialog({
  history,
  players,
  onClose,
}: {
  history: PublicGameState["roundHistory"];
  players: PublicGameState["players"];
  onClose: () => void;
}) {
  useEscapeToClose(onClose);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,10,8,0.72)] px-4 py-6 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="w-full max-w-6xl rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,26,32,0.96),rgba(7,15,20,0.98))] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.42)] sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-brass">Full Rounds History</div>
            <div className="mt-2 text-sm text-white/72">Every completed hand, with bids, tricks taken, score delta, and cumulative scores.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <div className="mt-5 max-h-[70vh] overflow-y-auto pr-1">
          {history.length > 0 ? (
            <div className="grid gap-4">
              {history.map((entry) => (
                <section key={entry.roundNumber} className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.22em] text-brass">Hand {entry.roundNumber}</div>
                    <div className="text-sm text-white/65">{entry.handSize} card{entry.handSize === 1 ? "" : "s"}</div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {players.map((player) => (
                      <div key={`${entry.roundNumber}-${player.id}`} className="rounded-[20px] border border-white/10 bg-black/20 p-4 text-sm">
                        <div className="font-semibold">{player.name}</div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-white/70">
                          <StatPill label={`Bid ${entry.bids[player.id] ?? 0}`} />
                          <StatPill label={`Took ${entry.taken[player.id] ?? 0}`} />
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <div className="text-lg font-semibold text-brass">{signed(entry.scoreDeltas[player.id] ?? 0)} pts</div>
                          <div className="text-xs uppercase tracking-[0.16em] text-white/55">
                            Total {entry.scoresAfter[player.id] ?? 0}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-5 text-sm text-white/70">
              No rounds completed yet.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function WonTrickPile({ count }: { count: number }) {
  if (count <= 0) {
    return <div className="h-[24px] text-[10px] uppercase tracking-[0.18em] text-white/35">No tricks</div>;
  }

  return (
    <div className="flex items-end">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className={`won-trick-card relative ${index === 0 ? "" : "-ml-6"}`}
          style={{ zIndex: index + 1 }}
        >
          <PlayingCard
            card={{ id: `won-trick-${index}`, kind: "wizard", label: "W" }}
            size="sm"
            faceUp={false}
            className="scale-[0.52] origin-bottom-left shadow-[0_10px_24px_rgba(0,0,0,0.24)]"
          />
        </div>
      ))}
    </div>
  );
}

function HandCardFan({
  cards,
  winningCard,
  isActive,
  isPlayingPhase,
  playableCardIds,
  onPlayCard,
}: {
  cards: PublicGameState["yourHand"];
  winningCard: Card | null;
  isActive: boolean;
  isPlayingPhase: boolean;
  playableCardIds: string[];
  onPlayCard: (cardId: string) => void;
}) {
  return (
    <div className="mt-5 overflow-x-auto pb-2">
      <div className="flex min-w-max items-end gap-2 px-2 pt-3">
        {cards.map((card) => {
          const playable = playableCardIds.includes(card.id);
          const matchesWinningCard =
            !!winningCard &&
            ((winningCard.kind === "number" && card.kind === "number" && card.suit === winningCard.suit) ||
              (winningCard.kind === "wizard" && card.kind === "wizard") ||
              (winningCard.kind === "jester" && card.kind === "jester"));

          return (
            <button
              key={card.id}
              type="button"
              disabled={!isPlayingPhase || !isActive || !playable}
              onClick={() => onPlayCard(card.id)}
              className={`flex h-[100px] w-[68px] items-end justify-center ${playable && isActive ? "translate-y-[-6px]" : "translate-y-0 opacity-90"} ${matchesWinningCard ? "z-10" : ""} transition hover:z-10 hover:translate-y-[-10px] disabled:cursor-default disabled:hover:translate-y-0`}
              aria-label={`Play ${formatCard(card)}`}
            >
              <div style={{ transform: "scale(0.55)", transformOrigin: "bottom center" }}>
                <PlayingCard
                  card={card}
                  size="lg"
                  faceUp
                  interactive={playable && isActive}
                  className={`${playable && isActive ? "shadow-2xl" : "shadow-lg opacity-80"} ${matchesWinningCard ? "ring-2 ring-sky-300/85 ring-offset-2 ring-offset-transparent" : ""}`}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
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
  const cornerSize = size === "lg" ? "text-[1.3125rem]" : "text-[1rem]";
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
        </div>
      </div>
      <div className="relative flex flex-1 items-center justify-center">
        {card.kind === "number" ? <div className={`${centerSize} leading-none ${palette.textClass}`}>{SUIT_SYMBOLS[card.suit]}</div> : null}
        {card.kind === "wizard" ? <div className={`${centerSize} leading-none ${palette.textClass}`}>★</div> : null}
        {card.kind === "jester" ? <div className={`${centerSize} leading-none ${palette.textClass}`}>⊘</div> : null}
      </div>
      <div className="relative flex justify-end">
        <div className={`rotate-180 font-semibold leading-none ${cornerSize} ${palette.textClass}`}>
          <div>{cardRank(card)}</div>
        </div>
      </div>
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

function currentJoinCode(): string | null {
  const match = window.location.pathname.match(/\/join\/([A-Z0-9]{6})/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function joinRoomUrl(code: string): string {
  return `${window.location.origin}/join/${code.toUpperCase()}`;
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

function getTableSeatPositions(playerCount: number) {
  return Array.from({ length: playerCount }, (_, index) => {
    const angle = (Math.PI / 2) + ((Math.PI * 2) / playerCount) * index;
    return {
      x: 50 + Math.cos(angle) * 37,
      y: 50 + Math.sin(angle) * 34,
    };
  });
}

function getTrickPositionFromSeat(seatPosition: { x: number; y: number }) {
  return {
    x: 50 + (seatPosition.x - 50) * 0.8349,
    y: 50 + (seatPosition.y - 50) * 0.8349,
  };
}

function getWonTrickPileAnchor(seatPosition: { x: number; y: number }) {
  return {
    x: seatPosition.x,
    y: seatPosition.y + (seatPosition.y > 50 ? -8 : 8),
  };
}

function getCenterTrickCardScale(playerCount: number) {
  return Math.max(0.4, 1 - Math.max(0, playerCount - 4) * 0.15);
}

function getTurnToastMessage(
  game: PublicGameState,
  selfPlayerId: string | null,
  dealerId: string | null,
  isSelfBot: boolean,
) {
  if (!selfPlayerId || isSelfBot) {
    return null;
  }

  if (game.phase === "choose-trump" && dealerId === selfPlayerId) {
    return "Choose the trump suit.";
  }

  if (game.phase === "bidding" && game.activePlayerId === selfPlayerId) {
    return "Your turn to take a bid.";
  }

  if (game.phase === "playing" && game.activePlayerId === selfPlayerId) {
    return "Your turn to play a card.";
  }

  return null;
}

type TrickCollectAnimation = {
  id: string;
  source: { x: number; y: number };
  target: { x: number; y: number };
};

type FinalTrickAnimation = {
  id: string;
  source: { x: number; y: number };
  trick: { x: number; y: number };
  target: { x: number; y: number };
  card: Card | null;
};

const TRICK_ENTRY_ANIMATION_MS = 260;
const TRICK_COLLECT_ANIMATION_MS = 560;
const FINAL_TRICK_ANIMATION_MS = 980;

function didResolveTrick(previousGame: PublicGameState, nextGame: PublicGameState) {
  return nextGame.roundNumber > previousGame.roundNumber || nextGame.completedTrickCount > previousGame.completedTrickCount;
}

function buildResolvedTrickDisplayGame(
  previousGame: PublicGameState,
  nextGame: PublicGameState,
  selfPlayerId: string | null,
  resolvedTrick: NonNullable<PublicGameState["lastResolvedTrick"]>,
): PublicGameState {
  const lastPlay = resolvedTrick.plays[resolvedTrick.plays.length - 1] ?? null;
  const yourHand =
    lastPlay && selfPlayerId === lastPlay.playerId
      ? previousGame.yourHand.filter((card) => card.id !== lastPlay.card.id)
      : previousGame.yourHand;

  return {
    ...previousGame,
    currentTrick: resolvedTrick.plays,
    yourHand,
    lastResolvedTrick: nextGame.lastResolvedTrick,
    playableCardIds: [],
  };
}

function getResolvedTrickPosition(
  resolvedTrick: NonNullable<PublicGameState["lastResolvedTrick"]>,
  orderedPlayers: PublicGameState["players"],
  seatPositions: { x: number; y: number }[],
) {
  const positions = resolvedTrick.plays.map((play) => {
    const playerIndex = orderedPlayers.findIndex((player) => player.id === play.playerId);
    const seatPosition = seatPositions[playerIndex >= 0 ? playerIndex : 0] ?? seatPositions[0]!;
    return getTrickPositionFromSeat(seatPosition);
  });

  const total = positions.reduce(
    (sum, position) => ({
      x: sum.x + position.x,
      y: sum.y + position.y,
    }),
    { x: 0, y: 0 },
  );

  return {
    x: total.x / positions.length,
    y: total.y / positions.length,
  };
}

function cardRank(card: Card) {
  if (card.kind === "wizard") {
    return "W";
  }

  if (card.kind === "jester") {
    return "S";
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
  if (card.kind === "jester") {
    return "⊘";
  }

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
