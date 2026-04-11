import { useState, useCallback, useEffect, useRef } from "react";
import { data, redirect, useFetcher } from "react-router";
import type { Route } from "./+types/game.$gameId";
import { getPrisma } from "~/db.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import type { ServerMessage } from "~/domain/messages";
import { CHAT_PRESETS } from "~/domain/messages";
import { useGameWebSocket } from "@tabledeck/game-room/client";
import type { PublicGameState } from "~/domain/game-state";
import { getCard } from "~/domain/cards";
import type { Card } from "~/domain/cards";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `Game ${params.gameId} — Skull King` }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { gameId } = params;
  const db = getPrisma(context);

  const game = await db.game.findUnique({
    where: { id: gameId },
    include: { players: { include: { user: true } } },
  });

  if (!game) throw redirect("/");

  const user = getOptionalUserFromContext(context);
  const settings = JSON.parse(game.settings) as {
    seed: number;
    maxPlayers: number;
    mode: string;
    scoringStyle?: "single" | "distributed";
  };

  // Determine this visitor's seat
  let mySeat = -1;
  let myName = "Guest";

  if (user) {
    const myPlayer = game.players.find((p) => p.userId === user.id);
    if (myPlayer) {
      mySeat = myPlayer.seat;
      myName = user.name || user.email;
    } else if (
      game.players.length < game.maxPlayers &&
      game.status === "waiting"
    ) {
      const usedSeats = new Set(game.players.map((p) => p.seat));
      for (let s = 0; s < game.maxPlayers; s++) {
        if (!usedSeats.has(s)) {
          mySeat = s;
          break;
        }
      }
      myName = user.name || user.email;
      if (mySeat >= 0) {
        await db.gamePlayer.create({
          data: { gameId, userId: user.id, seat: mySeat },
        });
      }
    }
  } else {
    // Check for a guest session cookie from a previous join
    const cookieHeader = request.headers.get("Cookie") ?? "";
    const cookieName = `sk_${gameId}`;
    const match = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${cookieName}=`));
    if (match) {
      const [rawSeat, ...nameParts] = match.slice(cookieName.length + 1).split(":");
      const savedSeat = parseInt(rawSeat, 10);
      const savedName = decodeURIComponent(nameParts.join(":"));
      const existing = game.players.find((p) => p.seat === savedSeat && p.guestName === savedName);
      if (existing) {
        mySeat = savedSeat;
        myName = savedName;
      }
    }
  }

  const url = new URL(request.url);
  const shareUrl = `${url.protocol}//${url.host}/game/${gameId}`;

  // Fetch initial state from Durable Object for SSR
  let doState: PublicGameState | null = null;
  try {
    const env = (context as any).cloudflare?.env as Env | undefined;
    if (env) {
      const doId = env.SKULL_KING_ROOM.idFromName(gameId);
      const stub = env.SKULL_KING_ROOM.get(doId);
      const stateRes = await stub.fetch(new Request("http://internal/state"));
      if (stateRes.ok) {
        const stateData = (await stateRes.json()) as { state: PublicGameState };
        doState = stateData.state ?? null;
      }
    }
  } catch {
    // DO not initialized yet
  }

  return data({
    gameId,
    mySeat,
    myName,
    shareUrl,
    settings,
    gameStatus: game.status,
    gameMode: game.mode,
    scoringStyle: settings.scoringStyle ?? "distributed",
    maxPlayers: game.maxPlayers,
    dbPlayers: game.players.map((p) => ({
      seat: p.seat,
      name: p.user?.name || p.user?.email || p.guestName || "Guest",
    })),
    doState,
  });
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const { gameId } = params;
  const body = (await request.json()) as { guestName?: string };

  if (body.guestName) {
    const db = getPrisma(context);
    const game = await db.game.findUnique({
      where: { id: gameId },
      include: { players: true },
    });
    if (!game) return data({ error: "Game not found" }, { status: 404 });
    if (game.status === "finished") return data({ error: "Game is over" }, { status: 400 });

    const usedSeats = new Set(game.players.map((p) => p.seat));
    let seat = -1;
    for (let s = 0; s < game.maxPlayers; s++) {
      if (!usedSeats.has(s)) {
        seat = s;
        break;
      }
    }
    if (seat === -1) return data({ error: "Game is full" }, { status: 400 });

    await db.gamePlayer.create({
      data: { gameId, guestName: body.guestName, seat },
    });

    // Notify the DO so it can apply the join and broadcast player_joined to all WS clients
    try {
      const env = (context as any).cloudflare?.env as Env | undefined;
      if (env) {
        const doId = env.SKULL_KING_ROOM.idFromName(gameId);
        const stub = env.SKULL_KING_ROOM.get(doId);
        await stub.fetch(new Request("http://internal/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seat, name: body.guestName }),
        }));
      }
    } catch {
      // Non-fatal — client will still get state on WS connect
    }

    const cookieName = `sk_${gameId}`;
    const cookieValue = `${seat}:${encodeURIComponent(body.guestName)}`;
    return data(
      { seat, name: body.guestName },
      {
        headers: {
          "Set-Cookie": `${cookieName}=${cookieValue}; Path=/; Max-Age=86400; SameSite=Lax`,
        },
      },
    );
  }

  return data({ error: "Unknown action" }, { status: 400 });
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlayerDisplay {
  seat: number;
  name: string;
  bid: number | null;
  won: number;
  score: number;
  connected?: boolean;
}

interface ChatMessage {
  seat: number;
  presetId: number;
  playerName: string;
  timestamp: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function GameRoom({ loaderData }: Route.ComponentProps) {
  const {
    gameId,
    mySeat: initialSeat,
    myName: initialName,
    shareUrl,
    settings,
    gameStatus,
    gameMode,
    scoringStyle,
    maxPlayers,
    dbPlayers,
    doState,
  } = loaderData;

  const [mySeat, setMySeat] = useState(initialSeat);
  const [myName, setMyName] = useState(initialName);
  const [guestName, setGuestName] = useState("");
  const isSingleScorer = gameMode === "scorekeeper" && scoringStyle === "single";
  const [showNameModal, setShowNameModal] = useState(
    initialSeat === -1 && gameStatus === "waiting" && !isSingleScorer,
  );
  const joinFetcher = useFetcher<typeof action>();

  // Game state
  const [phase, setPhase] = useState(doState?.phase ?? "lobby");
  const [round, setRound] = useState(doState?.round ?? 0);
  const [status, setStatus] = useState(gameStatus);
  const [players, setPlayers] = useState<PlayerDisplay[]>(() =>
    dbPlayers.map((p) => ({ ...p, bid: null, won: 0, score: 0 })),
  );
  const [myHand, setMyHand] = useState<number[]>([]);
  const [trickCards, setTrickCards] = useState<
    { seat: number; cardId: number; tigressChoice?: string }[]
  >([]);
  const [currentSeat, setCurrentSeat] = useState(0);
  const [cumulativeScores, setCumulativeScores] = useState<number[]>(
    Array(maxPlayers).fill(0),
  );
  const [roundData, setRoundData] = useState<
    { bid: number | null; won: number }[]
  >(Array(maxPlayers).fill({ bid: null, won: 0 }));
  const [winner, setWinner] = useState<number | null>(null);
  const [lastTrickWinner, setLastTrickWinner] = useState<number | null>(null);

  // Scorekeeper mode state
  const [skBids, setSkBids] = useState<number[]>(Array(maxPlayers).fill(0));
  const [skWon, setSkWon] = useState<number[]>(Array(maxPlayers).fill(0));
  const [skBonuses, setSkBonuses] = useState(
    Array(maxPlayers).fill(null).map(() => ({
      standardFourteen: 0,
      blackFourteen: 0,
      loot: 0,
      pirateMermaidCapture: 0,
      skullKingPirateCapture: 0,
      mermaidSkullKingCapture: 0,
    })),
  );

  // UI state
  const [myBid, setMyBid] = useState<number | null>(null);
  const [bidSubmitted, setBidSubmitted] = useState(false);
  const [showRoundResult, setShowRoundResult] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tigressCardId, setTigressCardId] = useState<number | null>(null);
  const [singleScorerNames, setSingleScorerNames] = useState<string[]>(
    Array(maxPlayers).fill(""),
  );

  const joinedRef = useRef(false);

  // Update from doState on mount
  useEffect(() => {
    if (doState) {
      setPhase(doState.phase);
      setRound(doState.round);
      setCumulativeScores(doState.cumulativeScores);
      setCurrentSeat(doState.currentSeat);
      setTrickCards(doState.trickCards);
      setRoundData(doState.roundData.map((rd) => ({ bid: rd.bid, won: rd.won })));
    }
  }, []);

  const { send } = useGameWebSocket({
    gameId,
    seat: mySeat,
    name: myName,
    onMessage: useCallback(
      (rawMsg: unknown) => {
        const msg = rawMsg as ServerMessage;
        switch (msg.type) {
          case "game_state": {
            const s = msg.state as PublicGameState;
            if (!s) break;
            setPhase(s.phase);
            setRound(s.round);
            setStatus(s.status);
            setCumulativeScores(s.cumulativeScores);
            setCurrentSeat(s.currentSeat);
            setTrickCards(s.trickCards);
            setRoundData(s.roundData.map((rd) => ({ bid: rd.bid, won: rd.won })));
            if (s.players) {
              setPlayers(
                s.players
                  .map((p, i) =>
                    p
                      ? {
                          seat: i,
                          name: p.name,
                          bid: s.roundData[i]?.bid ?? null,
                          won: s.roundData[i]?.won ?? 0,
                          score: s.cumulativeScores[i] ?? 0,
                          connected: p.connected,
                        }
                      : null,
                  )
                  .filter((p): p is PlayerDisplay => p !== null),
              );
            }
            if (msg.yourHand) {
              setMyHand(msg.yourHand as number[]);
              setBidSubmitted(false);
              setMyBid(null);
            }
            break;
          }
          case "next_round_ready": {
            const s = (msg as any).state as PublicGameState;
            if (s) {
              setPhase(s.phase);
              setRound(s.round);
              setCurrentSeat(s.currentSeat);
              setTrickCards([]);
              setRoundData(s.roundData.map((rd) => ({ bid: rd.bid, won: rd.won })));
              if (s.players) {
                setPlayers(
                  s.players
                    .map((p, i) =>
                      p
                        ? {
                            seat: i,
                            name: p.name,
                            bid: null,
                            won: 0,
                            score: s.cumulativeScores[i] ?? 0,
                            connected: p.connected,
                          }
                        : null,
                    )
                    .filter((p): p is PlayerDisplay => p !== null),
                );
              }
            }
            if ((msg as any).yourHand) {
              setMyHand((msg as any).yourHand as number[]);
            }
            setBidSubmitted(false);
            setMyBid(null);
            setLastTrickWinner(null);
            setShowRoundResult(false);
            break;
          }
          case "hand_dealt":
            setMyHand((msg as any).hand ?? []);
            setBidSubmitted(false);
            setMyBid(null);
            break;
          case "bid_reveal": {
            const bids = (msg as any).bids as (number | null)[];
            setRoundData((prev) =>
              prev.map((rd, i) => ({ ...rd, bid: bids[i] ?? rd.bid })),
            );
            setPhase("playing");
            break;
          }
          case "card_played": {
            const { seat, cardId, tigressChoice } = msg as any;
            setTrickCards((prev) => [...prev, { seat, cardId, tigressChoice }]);
            break;
          }
          case "trick_result": {
            const { winner: trickWinner, scores } = msg as any;
            setLastTrickWinner(trickWinner);
            if (scores) setCumulativeScores(scores);
            // Clear trick after short delay
            setTimeout(() => setTrickCards([]), 1500);
            break;
          }
          case "round_score": {
            const { scores, roundData: rd } = msg as any;
            if (scores) setCumulativeScores(scores);
            if (rd) setRoundData(rd.map((r: any) => ({ bid: r.bid, won: r.won })));
            setShowRoundResult(true);
            setPhase("scoring");
            break;
          }
          case "game_over": {
            const { finalScores, winner: w } = msg as any;
            if (finalScores) setCumulativeScores(finalScores);
            setWinner(w);
            setStatus("finished");
            setPhase("complete");
            break;
          }
          case "player_joined": {
            const { seat, name } = msg as any;
            setPlayers((prev) => {
              const exists = prev.find((p) => p.seat === seat);
              if (exists) return prev.map((p) => (p.seat === seat ? { ...p, name } : p));
              return [...prev, { seat, name, bid: null, won: 0, score: 0 }];
            });
            break;
          }
          case "player_disconnected": {
            const { seat } = msg as any;
            setPlayers((prev) =>
              prev.map((p) => (p.seat === seat ? { ...p, connected: false } : p)),
            );
            break;
          }
          case "chat_broadcast": {
            const { seat, presetId, playerName } = msg as any;
            setChatMessages((prev) => [
              ...prev,
              { seat, presetId, playerName, timestamp: Date.now() },
            ]);
            break;
          }
        }
      },
      [],
    ),
  });

  // Join on mount
  useEffect(() => {
    if (!joinedRef.current && mySeat >= 0) {
      joinedRef.current = true;
      setTimeout(() => send({ type: "join_game", name: myName }), 500);
    }
  }, [mySeat, myName, send]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleJoinAsGuest = () => {
    if (!guestName.trim() || joinFetcher.state !== "idle") return;
    joinFetcher.submit(
      { guestName: guestName.trim() },
      { method: "POST", encType: "application/json" },
    );
  };

  useEffect(() => {
    if (joinFetcher.state !== "idle" || !joinFetcher.data) return;
    const result = joinFetcher.data as { seat?: number; name?: string; error?: string };
    if (result.seat !== undefined && result.name) {
      setMySeat(result.seat);
      setMyName(result.name);
      setShowNameModal(false);
      // Optimistically add ourselves to the player list immediately
      setPlayers((prev) => {
        if (prev.find((p) => p.seat === result.seat)) return prev;
        return [...prev, { seat: result.seat!, name: result.name!, bid: null, won: 0, score: 0 }];
      });
    }
  }, [joinFetcher.state, joinFetcher.data]);

  const handleStartGame = () => send({ type: "start_game" });

  const handleBid = (amount: number) => {
    setMyBid(amount);
    setBidSubmitted(true);
    send({ type: "bid", amount });
  };

  const handlePlayCard = (cardId: number, tigressChoice?: "escape" | "pirate") => {
    if (tigressChoice === undefined) {
      const card = getCard(cardId);
      if (card.type === "tigress") {
        setTigressCardId(cardId);
        return;
      }
    }
    send({ type: "play_card", cardId, tigressChoice });
    setMyHand((prev) => prev.filter((id) => id !== cardId));
    setTigressCardId(null);
  };

  const handleScorekeeperSubmitBids = () => {
    send({ type: "scorekeeper_bid", bids: skBids });
  };

  const handleScorekeeperSubmitResult = () => {
    send({
      type: "scorekeeper_result",
      won: skWon,
      bonuses: skBonuses,
    });
    setSkWon(Array(maxPlayers).fill(0));
    setSkBonuses(
      Array(maxPlayers).fill(null).map(() => ({
        standardFourteen: 0,
        blackFourteen: 0,
        loot: 0,
        pirateMermaidCapture: 0,
        skullKingPirateCapture: 0,
        mermaidSkullKingCapture: 0,
      })),
    );
  };

  const handleSingleScorerStart = () => {
    const filledNames = singleScorerNames.map((n, i) => n.trim() || `Player ${i + 1}`);
    const validCount = singleScorerNames.filter((n) => n.trim()).length;
    if (validCount < 2) return;
    send({ type: "set_player_names", names: filledNames });
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isMyTurn = phase === "playing" && currentSeat === mySeat;
  const sortedPlayers = [...players].sort((a, b) => a.seat - b.seat);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center p-2 gap-3 pb-20">
      {/* Guest name modal */}
      {showNameModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-sm border border-gray-700">
            <h2 className="text-white font-bold text-xl mb-1">Join Game</h2>
            <p className="text-gray-400 text-sm mb-4">
              Enter a pirate name to play as guest, or{" "}
              <a href="/login" className="text-amber-400 hover:underline">
                sign in
              </a>{" "}
              for a profile.
            </p>
            {(joinFetcher.data as any)?.error && (
              <p className="text-red-400 text-sm mb-3">
                {(joinFetcher.data as any).error}
              </p>
            )}
            <input
              autoFocus
              type="text"
              placeholder="Your pirate name"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoinAsGuest()}
              maxLength={20}
              disabled={joinFetcher.state !== "idle"}
              className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-amber-500 mb-3 disabled:opacity-50"
            />
            <button
              onClick={handleJoinAsGuest}
              disabled={joinFetcher.state !== "idle" || !guestName.trim()}
              className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-3"
            >
              {joinFetcher.state !== "idle" ? "Boarding…" : "Board the ship!"}
            </button>
            <a
              href="/"
              className="block w-full text-center text-gray-400 hover:text-white text-sm mt-3 py-2"
            >
              Cancel
            </a>
          </div>
        </div>
      )}

      {/* Tigress choice modal */}
      {tigressCardId !== null && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-sm border border-gray-700 text-center">
            <h2 className="text-white font-bold text-xl mb-2">Tigress</h2>
            <p className="text-gray-400 text-sm mb-6">
              Play the Tigress as Escape or Pirate?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handlePlayCard(tigressCardId!, "escape")}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg py-3"
              >
                Escape
              </button>
              <button
                onClick={() => handlePlayCard(tigressCardId!, "pirate")}
                className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg py-3"
              >
                Pirate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Round result modal */}
      {showRoundResult && phase === "scoring" && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-40 p-4">
          <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-sm border border-gray-700">
            <h2 className="text-white font-bold text-xl mb-1 text-center">
              Round {round} Complete
            </h2>
            <div className="space-y-2 mb-6 mt-4">
              {sortedPlayers.map((p) => {
                const rd = roundData[p.seat];
                const score = cumulativeScores[p.seat] ?? 0;
                return (
                  <div key={p.seat} className="flex justify-between text-white">
                    <span className="text-gray-300">
                      {p.name}
                      {p.seat === mySeat ? " (you)" : ""}
                    </span>
                    <span className="font-bold">{score} pts</span>
                  </div>
                );
              })}
            </div>
            {round < 10 ? (
              <button
                onClick={() => {
                  setShowRoundResult(false);
                  send({ type: "next_round" });
                }}
                className="w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg py-3"
              >
                Next Round ({round + 1})
              </button>
            ) : (
              <button
                onClick={() => setShowRoundResult(false)}
                className="w-full bg-gray-700 text-white font-semibold rounded-lg py-3"
              >
                See Final Scores
              </button>
            )}
          </div>
        </div>
      )}

      {/* Game over modal */}
      {status === "finished" && phase === "complete" && !showRoundResult && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-sm border border-gray-700 text-center">
            <div className="text-5xl mb-2">💀</div>
            <h2 className="text-white font-bold text-2xl mb-2">Game Over!</h2>
            {winner !== null && (
              <p className="text-amber-400 text-lg mb-4">
                {players.find((p) => p.seat === winner)?.name ?? "Unknown"} wins!
              </p>
            )}
            <div className="space-y-2 mb-6">
              {sortedPlayers
                .sort((a, b) => (cumulativeScores[b.seat] ?? 0) - (cumulativeScores[a.seat] ?? 0))
                .map((p) => (
                  <div key={p.seat} className="flex justify-between text-white">
                    <span>
                      {p.name}
                      {p.seat === mySeat ? " (you)" : ""}
                    </span>
                    <span className="font-bold">{cumulativeScores[p.seat] ?? 0} pts</span>
                  </div>
                ))}
            </div>
            <a
              href="/"
              className="block bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg px-4 py-3"
            >
              New Game
            </a>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="w-full max-w-2xl flex items-center justify-between pt-2">
        <a href="/" className="text-gray-400 hover:text-white text-sm">
          ← Home
        </a>
        <div className="text-center">
          <span className="text-white font-bold">💀 Skull King</span>
          {round > 0 && (
            <span className="text-gray-400 text-sm ml-2">
              Round {round}/10
            </span>
          )}
        </div>
        <button
          onClick={handleCopyLink}
          className="text-amber-400 hover:text-amber-300 text-sm"
        >
          {copied ? "Copied!" : "Invite"}
        </button>
      </div>

      {/* Lobby — single-scorer mode: host enters all names */}
      {phase === "lobby" && isSingleScorer && (mySeat === 0 || mySeat === -1) && (
        <div className="bg-gray-900 rounded-xl border border-gray-700 p-5 w-full max-w-2xl">
          <h2 className="text-white font-semibold mb-1">Enter player names</h2>
          <p className="text-gray-500 text-xs mb-4">
            You'll score for everyone at the table
          </p>
          <div className="space-y-2 mb-5">
            {Array.from({ length: maxPlayers }).map((_, i) => (
              <input
                key={i}
                type="text"
                placeholder={`Player ${i + 1}`}
                value={singleScorerNames[i] ?? ""}
                onChange={(e) =>
                  setSingleScorerNames((prev) =>
                    prev.map((n, idx) => (idx === i ? e.target.value : n)),
                  )
                }
                maxLength={20}
                className="w-full bg-gray-800 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-amber-500 text-sm"
              />
            ))}
          </div>
          <button
            onClick={handleSingleScorerStart}
            disabled={singleScorerNames.filter((n) => n.trim()).length < 2}
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3"
          >
            Start Scoring
          </button>
        </div>
      )}

      {/* Lobby — single-scorer mode: non-host waiting */}
      {phase === "lobby" && isSingleScorer && mySeat > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-700 p-5 w-full max-w-2xl text-center">
          <p className="text-gray-400 text-sm">Waiting for host to start the game...</p>
        </div>
      )}

      {/* Lobby — distributed mode: players join individually */}
      {phase === "lobby" && !isSingleScorer && (
        <div className="bg-gray-900 rounded-xl border border-gray-700 p-5 w-full max-w-2xl">
          <h2 className="text-white font-semibold mb-3">
            Waiting for crew ({sortedPlayers.length}/{maxPlayers})
          </h2>
          <div className="space-y-2 mb-4">
            {sortedPlayers.map((p) => (
              <div key={p.seat} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-white text-sm">
                  {p.name}
                  {p.seat === mySeat ? " (you)" : ""}
                </span>
              </div>
            ))}
            {Array.from({ length: maxPlayers - sortedPlayers.length }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-gray-600" />
                <span className="text-gray-600 text-sm italic">Waiting...</span>
              </div>
            ))}
          </div>
          <button
            onClick={handleCopyLink}
            className="w-full bg-gray-800 hover:bg-gray-700 text-amber-400 font-medium rounded-lg py-2 text-sm mb-3"
          >
            {copied ? "Copied!" : "Copy invite link"}
          </button>
          {mySeat === 0 && sortedPlayers.length >= 2 && (
            <button
              onClick={handleStartGame}
              className="w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg py-3"
            >
              Start Game ({sortedPlayers.length} players)
            </button>
          )}
          {mySeat === 0 && sortedPlayers.length < 2 && (
            <p className="text-gray-500 text-sm text-center">
              Need at least 2 players to start
            </p>
          )}
        </div>
      )}

      {/* Score board (always visible when active) */}
      {phase !== "lobby" && (
        <div className="w-full max-w-2xl bg-gray-900 rounded-xl border border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold text-sm">Scoreboard</h3>
            {phase === "bidding" && (
              <span className="text-amber-400 text-xs">Bidding...</span>
            )}
            {phase === "playing" && (
              <span className="text-green-400 text-xs">
                {players.find((p) => p.seat === currentSeat)?.name ?? "?"}&apos;s turn
              </span>
            )}
          </div>
          <div className="grid grid-cols-4 text-xs text-gray-500 mb-1 px-1">
            <span>Player</span>
            <span className="text-center">Bid</span>
            <span className="text-center">Won</span>
            <span className="text-right">Score</span>
          </div>
          {sortedPlayers.map((p) => {
            const rd = roundData[p.seat];
            return (
              <div
                key={p.seat}
                className={`grid grid-cols-4 py-1.5 px-1 rounded text-sm ${
                  p.seat === mySeat ? "bg-gray-800" : ""
                } ${p.seat === currentSeat && phase === "playing" ? "ring-1 ring-amber-500" : ""}`}
              >
                <span className="text-white truncate">{p.name}</span>
                <span className="text-center text-gray-300">
                  {rd?.bid !== null && rd?.bid !== undefined ? rd.bid : "–"}
                </span>
                <span className="text-center text-gray-300">{rd?.won ?? 0}</span>
                <span className="text-right font-bold text-white">
                  {cumulativeScores[p.seat] ?? 0}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Trick area (digital mode, playing phase) */}
      {gameMode === "digital" && phase === "playing" && (
        <div className="w-full max-w-2xl bg-gray-900 rounded-xl border border-gray-700 p-4">
          <h3 className="text-white font-semibold text-sm mb-3">Current Trick</h3>
          {lastTrickWinner !== null && trickCards.length === 0 && (
            <p className="text-amber-400 text-sm text-center mb-2">
              {players.find((p) => p.seat === lastTrickWinner)?.name ?? "?"} won the trick!
            </p>
          )}
          <div className="flex flex-wrap gap-2 min-h-[4rem] items-center justify-center">
            {trickCards.map((tc, i) => {
              const card = getCard(tc.cardId);
              const playerName = players.find((p) => p.seat === tc.seat)?.name ?? "?";
              return (
                <div key={i} className="text-center">
                  <CardDisplay card={card} tigressChoice={tc.tigressChoice as any} />
                  <p className="text-gray-400 text-xs mt-1">{playerName}</p>
                </div>
              );
            })}
            {trickCards.length === 0 && (
              <p className="text-gray-600 text-sm">
                {isMyTurn ? "Your turn — play a card" : "Waiting for cards..."}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Bidding UI */}
      {phase === "bidding" && mySeat >= 0 && gameMode === "digital" && (
        <div className="w-full max-w-2xl bg-gray-900 rounded-xl border border-gray-700 p-4">
          <h3 className="text-white font-semibold mb-3">
            {bidSubmitted ? `You bid ${myBid} — waiting for others...` : "Place your bid"}
          </h3>
          {!bidSubmitted && (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: round + 1 }, (_, i) => (
                <button
                  key={i}
                  onClick={() => handleBid(i)}
                  className="bg-gray-800 hover:bg-amber-600 text-white font-bold w-12 h-12 rounded-lg transition-colors"
                >
                  {i}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Player hand (digital mode) */}
      {gameMode === "digital" && mySeat >= 0 && myHand.length > 0 && (
        <div className="w-full max-w-2xl bg-gray-900 rounded-xl border border-gray-700 p-4">
          <h3 className="text-white font-semibold text-sm mb-3">
            Your Hand
            {!isMyTurn && phase === "playing" && (
              <span className="text-gray-500 font-normal ml-2 text-xs">
                (waiting for your turn)
              </span>
            )}
          </h3>
          <div className="flex flex-wrap gap-2">
            {myHand.map((cardId) => {
              const card = getCard(cardId);
              return (
                <button
                  key={cardId}
                  onClick={() => isMyTurn && handlePlayCard(cardId)}
                  disabled={!isMyTurn || phase !== "playing"}
                  className={`transition-all ${
                    isMyTurn
                      ? "hover:-translate-y-1 hover:ring-2 hover:ring-amber-400 cursor-pointer"
                      : "opacity-70 cursor-default"
                  }`}
                >
                  <CardDisplay card={card} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Scorekeeper mode UI */}
      {gameMode === "scorekeeper" && phase !== "lobby" && (mySeat === 0 || isSingleScorer) && (
        <ScorekeeperPanel
          phase={phase}
          round={round}
          maxPlayers={maxPlayers}
          players={sortedPlayers}
          bids={skBids}
          won={skWon}
          bonuses={skBonuses}
          onBidChange={(seat, val) =>
            setSkBids((prev) => prev.map((b, i) => (i === seat ? val : b)))
          }
          onWonChange={(seat, val) =>
            setSkWon((prev) => prev.map((w, i) => (i === seat ? val : w)))
          }
          onBonusChange={(seat, key, val) =>
            setSkBonuses((prev) =>
              prev.map((b, i) => (i === seat ? { ...b, [key]: val } : b)),
            )
          }
          onSubmitBids={handleScorekeeperSubmitBids}
          onSubmitResult={handleScorekeeperSubmitResult}
        />
      )}

      {/* Scorekeeper: non-host view */}
      {gameMode === "scorekeeper" && phase !== "lobby" && mySeat !== 0 && !isSingleScorer && (
        <div className="w-full max-w-2xl bg-gray-900 rounded-xl border border-gray-700 p-4 text-center">
          <p className="text-gray-400 text-sm">
            {phase === "bidding"
              ? "Waiting for host to enter bids..."
              : "Waiting for host to enter round results..."}
          </p>
        </div>
      )}

      {/* Chat */}
      <div className="fixed bottom-4 right-4 z-30">
        {chatOpen && (
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 mb-2 w-64 max-h-48 overflow-y-auto">
            {chatMessages.slice(-10).map((m, i) => (
              <p key={i} className="text-gray-300 text-xs mb-1">
                <span className="text-amber-400">{m.playerName}:</span>{" "}
                {CHAT_PRESETS[m.presetId] ?? "..."}
              </p>
            ))}
            {chatMessages.length === 0 && (
              <p className="text-gray-600 text-xs italic">No messages yet</p>
            )}
          </div>
        )}
        {mySeat >= 0 && (
          <div className="flex flex-col gap-1 items-end">
            <button
              onClick={() => setChatOpen((v) => !v)}
              className="bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-full px-3 py-1.5 border border-gray-600"
            >
              💬 {chatMessages.length > 0 && !chatOpen ? chatMessages.length : ""}
            </button>
            {chatOpen && (
              <div className="flex flex-wrap gap-1 justify-end max-w-xs">
                {CHAT_PRESETS.map((preset, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      send({ type: "chat", presetId: i });
                    }}
                    className="bg-gray-800 hover:bg-amber-700 text-white text-xs rounded-full px-2 py-1"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Card Display Component ──────────────────────────────────────────────────

function CardDisplay({
  card,
  tigressChoice,
}: {
  card: Card;
  tigressChoice?: "escape" | "pirate";
}) {
  const suitEmoji: Record<string, string> = {
    parrots: "🦜",
    maps: "🗺️",
    treasure_chests: "📦",
    jolly_rogers: "☠️",
  };

  const typeEmoji: Record<string, string> = {
    escape: "🏳️",
    pirate: "⚔️",
    tigress: "🐯",
    skull_king: "💀",
    mermaid: "🧜",
  };

  const suitColors: Record<string, string> = {
    parrots: "text-green-400",
    maps: "text-blue-400",
    treasure_chests: "text-yellow-400",
    jolly_rogers: "text-gray-200",
  };

  if (card.type === "numbered" && card.suit) {
    return (
      <div className="bg-gray-800 border border-gray-600 rounded-lg w-14 h-20 flex flex-col items-center justify-center gap-1">
        <span className="text-lg">{suitEmoji[card.suit]}</span>
        <span className={`text-xl font-bold ${suitColors[card.suit]}`}>
          {card.value}
        </span>
      </div>
    );
  }

  const effectiveType = tigressChoice ?? card.type;
  return (
    <div className="bg-gray-800 border border-gray-600 rounded-lg w-14 h-20 flex flex-col items-center justify-center gap-1">
      <span className="text-2xl">{typeEmoji[effectiveType] ?? "❓"}</span>
      <span className="text-gray-400 text-xs text-center leading-tight px-1">
        {card.name ?? card.type}
      </span>
    </div>
  );
}

// ─── Scorekeeper Panel ───────────────────────────────────────────────────────

interface ScorekeeperPanelProps {
  phase: string;
  round: number;
  maxPlayers: number;
  players: { seat: number; name: string }[];
  bids: number[];
  won: number[];
  bonuses: Record<string, number>[];
  onBidChange: (seat: number, val: number) => void;
  onWonChange: (seat: number, val: number) => void;
  onBonusChange: (seat: number, key: string, val: number) => void;
  onSubmitBids: () => void;
  onSubmitResult: () => void;
}

function ScorekeeperPanel({
  phase,
  round,
  maxPlayers,
  players,
  bids,
  won,
  bonuses,
  onBidChange,
  onWonChange,
  onBonusChange,
  onSubmitBids,
  onSubmitResult,
}: ScorekeeperPanelProps) {
  if (phase === "bidding") {
    return (
      <div className="w-full max-w-2xl bg-gray-900 rounded-xl border border-gray-700 p-4">
        <h3 className="text-white font-semibold mb-4">Round {round} — Enter Bids</h3>
        <div className="space-y-3">
          {players.map((p) => (
            <div key={p.seat} className="flex items-center justify-between">
              <span className="text-gray-300 text-sm w-32 truncate">{p.name}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onBidChange(p.seat, Math.max(0, bids[p.seat] - 1))}
                  className="bg-gray-700 text-white w-8 h-8 rounded-lg font-bold"
                >
                  −
                </button>
                <span className="text-white font-bold w-8 text-center">
                  {bids[p.seat]}
                </span>
                <button
                  onClick={() => onBidChange(p.seat, Math.min(round, bids[p.seat] + 1))}
                  className="bg-gray-700 text-white w-8 h-8 rounded-lg font-bold"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={onSubmitBids}
          className="mt-4 w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg py-3"
        >
          Start Round
        </button>
      </div>
    );
  }

  if (phase === "playing") {
    const bonusKeys: { key: string; label: string }[] = [
      { key: "standardFourteen", label: "14 captured (+10)" },
      { key: "blackFourteen", label: "☠️14 captured (+20)" },
      { key: "pirateMermaidCapture", label: "🧜 by ⚔️ (+20)" },
      { key: "skullKingPirateCapture", label: "⚔️ by 💀 (+30)" },
      { key: "mermaidSkullKingCapture", label: "💀 by 🧜 (+40)" },
    ];

    return (
      <div className="w-full max-w-2xl bg-gray-900 rounded-xl border border-gray-700 p-4">
        <h3 className="text-white font-semibold mb-4">Round {round} — Enter Results</h3>
        <div className="space-y-4">
          {players.map((p) => (
            <div key={p.seat} className="border border-gray-700 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-medium text-sm">{p.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-xs">Tricks won:</span>
                  <button
                    onClick={() => onWonChange(p.seat, Math.max(0, won[p.seat] - 1))}
                    className="bg-gray-700 text-white w-7 h-7 rounded font-bold text-sm"
                  >
                    −
                  </button>
                  <span className="text-white font-bold w-6 text-center">
                    {won[p.seat]}
                  </span>
                  <button
                    onClick={() => onWonChange(p.seat, Math.min(round, won[p.seat] + 1))}
                    className="bg-gray-700 text-white w-7 h-7 rounded font-bold text-sm"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {bonusKeys.map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-gray-400 text-xs">{label}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          onBonusChange(
                            p.seat,
                            key,
                            Math.max(0, (bonuses[p.seat][key] ?? 0) - 1),
                          )
                        }
                        className="bg-gray-700 text-white w-6 h-6 rounded text-xs font-bold"
                      >
                        −
                      </button>
                      <span className="text-white text-xs w-5 text-center">
                        {bonuses[p.seat][key] ?? 0}
                      </span>
                      <button
                        onClick={() =>
                          onBonusChange(
                            p.seat,
                            key,
                            (bonuses[p.seat][key] ?? 0) + 1,
                          )
                        }
                        className="bg-gray-700 text-white w-6 h-6 rounded text-xs font-bold"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={onSubmitResult}
          className="mt-4 w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg py-3"
        >
          Score Round
        </button>
      </div>
    );
  }

  return null;
}
