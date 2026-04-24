import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "react-toastify";
import { data, redirect, useFetcher } from "react-router";
import type { Route } from "./+types/game.$gameId";
import { getPrisma } from "~/db.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import type { ServerMessage } from "~/domain/messages";
import { useGameWebSocket } from "@tabledeck/game-room/client";
import type { PublicGameState } from "~/domain/game-state";
import { getCard } from "~/domain/cards";
import type { Card } from "~/domain/cards";
import { Scroll } from "~/components/tabledeck/Scroll";
import { Seal } from "~/components/tabledeck/Seal";
import { Ticket } from "~/components/tabledeck/Ticket";
import { BtnPrimary } from "~/components/tabledeck/BtnPrimary";
import { BtnSecondary } from "~/components/tabledeck/BtnSecondary";
import { Card as TDCard } from "~/components/tabledeck/Card";
import { CrownIcon } from "~/components/icons/skull-king/CrownIcon";
import { ParrotIcon } from "~/components/icons/skull-king/ParrotIcon";

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
        await db.user.upsert({
          where: { id: user.id },
          create: { id: user.id, email: user.email, name: user.name || "" },
          update: { name: user.name || "", email: user.email },
        });
        await db.gamePlayer.create({
          data: { gameId, userId: user.id, seat: mySeat },
        });
      }
    }
  } else {
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

  if (mySeat >= 0) {
    try {
      const env = (context as any).cloudflare?.env as Env | undefined;
      if (env) {
        const doId = env.SKULL_KING_ROOM.idFromName(gameId);
        const stub = env.SKULL_KING_ROOM.get(doId);
        await stub.fetch(new Request("http://internal/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seat: mySeat, name: myName }),
        }));
      }
    } catch {
      // Non-fatal
    }
  }

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
      // Non-fatal
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
  text: string;
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
  const [leadSeat, setLeadSeat] = useState(doState?.leadSeat ?? 0);
  const [cumulativeScores, setCumulativeScores] = useState<number[]>(
    Array(maxPlayers).fill(0),
  );
  const [roundData, setRoundData] = useState<
    { bid: number | null; won: number }[]
  >(Array(maxPlayers).fill({ bid: null, won: 0 }));
  const [winner, setWinner] = useState<number | null>(null);
  const [lastTrickWinner, setLastTrickWinner] = useState<number | null>(null);

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

  const [myBid, setMyBid] = useState<number | null>(null);
  const [bidSubmitted, setBidSubmitted] = useState(false);
  const [showRoundResult, setShowRoundResult] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [tigressCardId, setTigressCardId] = useState<number | null>(null);
  // Locks the hand after clicking a card so double-clicks can't submit
  // two play_card messages for a single trick. Cleared when the server
  // broadcasts our card_played (or the turn moves off us).
  const [pendingPlayCardId, setPendingPlayCardId] = useState<number | null>(null);
  const [singleScorerNames, setSingleScorerNames] = useState<string[]>(
    Array(maxPlayers).fill(""),
  );

  const joinedRef = useRef(false);
  const mySeatRef = useRef(mySeat);
  useEffect(() => { mySeatRef.current = mySeat; }, [mySeat]);

  useEffect(() => {
    if (doState) {
      setPhase(doState.phase);
      setRound(doState.round);
      setCumulativeScores(doState.cumulativeScores);
      setCurrentSeat(doState.currentSeat);
      setLeadSeat(doState.leadSeat);
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
            setLeadSeat(s.leadSeat);
            setTrickCards(s.trickCards);
            setRoundData(s.roundData.map((rd) => ({ bid: rd.bid, won: rd.won })));
            if (s.players) {
              setPlayers(
                s.players
                  .flatMap((p, i): PlayerDisplay[] =>
                    p
                      ? [{
                          seat: i,
                          name: p.name,
                          bid: s.roundData[i]?.bid ?? null,
                          won: s.roundData[i]?.won ?? 0,
                          score: s.cumulativeScores[i] ?? 0,
                          connected: p.connected,
                        }]
                      : [],
                  ),
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
              setLeadSeat(s.leadSeat);
              setTrickCards([]);
              setRoundData(s.roundData.map((rd) => ({ bid: rd.bid, won: rd.won })));
              if (s.players) {
                setPlayers(
                  s.players
                    .flatMap((p, i): PlayerDisplay[] =>
                      p
                        ? [{
                            seat: i,
                            name: p.name,
                            bid: null,
                            won: 0,
                            score: s.cumulativeScores[i] ?? 0,
                            connected: p.connected,
                          }]
                        : [],
                    ),
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
            const { seat, cardId, tigressChoice, currentSeat: nextSeat } = msg as any;
            setTrickCards((prev) => [...prev, { seat, cardId, tigressChoice }]);
            if (nextSeat !== undefined) setCurrentSeat(nextSeat);
            if (seat === mySeatRef.current) {
              setMyHand((prev) => prev.filter((id) => id !== cardId));
              // Our play was accepted — release the hand lock
              setPendingPlayCardId(null);
            }
            break;
          }
          case "trick_result": {
            const { winner: trickWinner, scores } = msg as any;
            setLastTrickWinner(trickWinner);
            if (scores) setCumulativeScores(scores);
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
            const { seat, text, playerName } = msg as any;
            setChatMessages((prev) => [
              ...prev,
              { seat, text, playerName, timestamp: Date.now() },
            ]);
            break;
          }
          case "error": {
            toast.error((msg as any).message, { theme: "dark" });
            // If a play was rejected, release the lock so the user can retry
            setPendingPlayCardId(null);
            break;
          }
        }
      },
      [],
    ),
  });

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
    // Guard against double-submits from rapid clicks
    if (pendingPlayCardId !== null) return;
    if (tigressChoice === undefined) {
      const card = getCard(cardId);
      if (card.type === "tigress") {
        setTigressCardId(cardId);
        return;
      }
    }
    setPendingPlayCardId(cardId);
    send({ type: "play_card", cardId, tigressChoice });
    setTigressCardId(null);
  };
  const handleScorekeeperSubmitBids = () => {
    send({ type: "scorekeeper_bid", bids: skBids });
  };
  const handleScorekeeperSubmitResult = () => {
    send({ type: "scorekeeper_result", won: skWon, bonuses: skBonuses });
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
  const leaderSeat = cumulativeScores.indexOf(Math.max(...cumulativeScores));

  // ─── Modals ────────────────────────────────────────────────────────────────

  return (
    <div className="td-table min-h-screen" style={{ padding: "20px" }}>

      {/* ── Guest name modal ─── */}
      {showNameModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
          <div className="td-auth-card relative">
            <h2 className="font-serif font-bold text-xl mb-1" style={{ color: "var(--ink)" }}>Join Game</h2>
            <p className="font-sans text-sm mb-4" style={{ color: "var(--ink-soft)", opacity: 0.75 }}>
              Enter a pirate name to play as guest, or{" "}
              <a href="/login" className="underline" style={{ color: "var(--gold-lo)" }}>
                sign in
              </a>{" "}
              for a profile.
            </p>
            {(joinFetcher.data as any)?.error && (
              <p className="text-sm mb-3" style={{ color: "var(--copper)" }}>
                {(joinFetcher.data as any).error}
              </p>
            )}
            <label className="td-input-label">Pirate name</label>
            <input
              autoFocus
              type="text"
              placeholder="Your pirate name"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoinAsGuest()}
              maxLength={20}
              disabled={joinFetcher.state !== "idle"}
              className="td-input mb-4"
            />
            <BtnPrimary
              onClick={handleJoinAsGuest}
              disabled={joinFetcher.state !== "idle" || !guestName.trim()}
              fullWidth
            >
              {joinFetcher.state !== "idle" ? "Boarding…" : "Board the ship!"}
            </BtnPrimary>
            <a
              href="/"
              className="block w-full text-center font-sans text-sm mt-3 py-2"
              style={{ color: "var(--ink-soft)", opacity: 0.65 }}
            >
              Cancel
            </a>
          </div>
        </div>
      )}

      {/* ── Tigress choice modal ─── */}
      {tigressCardId !== null && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
          <div className="td-auth-card text-center">
            <h2 className="font-serif font-bold text-xl mb-2" style={{ color: "var(--ink)" }}>Tigress</h2>
            <p className="font-sans text-sm mb-6" style={{ color: "var(--ink-soft)", opacity: 0.75 }}>
              Play the Tigress as Escape or Pirate?
            </p>
            <div className="flex gap-3">
              <BtnSecondary
                onClick={() => handlePlayCard(tigressCardId!, "escape")}
                fullWidth
              >
                Escape
              </BtnSecondary>
              <BtnPrimary
                onClick={() => handlePlayCard(tigressCardId!, "pirate")}
                fullWidth
              >
                Pirate
              </BtnPrimary>
            </div>
          </div>
        </div>
      )}

      {/* ── Round result modal ─── */}
      {showRoundResult && phase === "scoring" && (
        <div className="fixed inset-0 flex items-center justify-center z-40 p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
          <div className="td-scroll relative" style={{ maxWidth: "380px", width: "100%" }}>
            <Seal animate />
            <div className="td-scroll-header">
              <h2>Round {round} Complete</h2>
              <div className="td-scroll-rule" />
            </div>
            <ul className="td-score-list mb-5 mt-2">
              {sortedPlayers.map((p) => {
                const score = cumulativeScores[p.seat] ?? 0;
                return (
                  <li key={p.seat} className={`td-score-row ${p.seat === mySeat ? "td-active" : ""}`}>
                    <div className="td-player-col">
                      <span className="td-player-name">
                        {p.name}{p.seat === mySeat ? " (you)" : ""}
                      </span>
                    </div>
                    <div>
                      <span className="td-score-val">{score}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
            {round < 10 ? (
              <BtnPrimary
                fullWidth
                onClick={() => {
                  setShowRoundResult(false);
                  send({ type: "next_round" });
                }}
              >
                Next Round ({round + 1})
              </BtnPrimary>
            ) : (
              <BtnSecondary
                fullWidth
                onClick={() => setShowRoundResult(false)}
              >
                See Final Scores
              </BtnSecondary>
            )}
          </div>
        </div>
      )}

      {/* ── Game over modal ─── */}
      {status === "finished" && phase === "complete" && !showRoundResult && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
          <div className="td-scroll relative" style={{ maxWidth: "380px", width: "100%" }}>
            <Seal animate />
            <div className="td-scroll-header">
              <h2>Game Over</h2>
              <div className="td-scroll-rule" />
            </div>
            {winner !== null && (
              <p className="font-serif text-lg text-center mb-4 font-semibold" style={{ color: "var(--gold)" }}>
                <CrownIcon className="inline-block mr-1 align-middle" size={20} />
                {players.find((p) => p.seat === winner)?.name ?? "Unknown"} wins!
              </p>
            )}
            <ul className="td-score-list mb-5">
              {sortedPlayers
                .sort((a, b) => (cumulativeScores[b.seat] ?? 0) - (cumulativeScores[a.seat] ?? 0))
                .map((p) => (
                  <li key={p.seat} className={`td-score-row ${p.seat === mySeat ? "td-active" : ""}`}>
                    <div className="td-player-col">
                      <span className="td-player-name">
                        {p.name}{p.seat === mySeat ? " (you)" : ""}
                      </span>
                    </div>
                    <div>
                      <span className="td-score-val">{cumulativeScores[p.seat] ?? 0}</span>
                    </div>
                  </li>
                ))}
            </ul>
            <a href="/" className="td-btn-primary w-full flex items-center justify-center mt-4">
              New Game
            </a>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════
          MAIN STAGE
          ═══════════════════════════════════════════ */}

      {/* ── Top bar ─── */}
      <div className="td-top-bar" style={{ maxWidth: "1400px", margin: "0 auto 0" }}>
        {/* Wordmark */}
        <div className="td-wordmark">
          <svg className="td-insignia" viewBox="0 0 64 64" aria-hidden="true">
            <defs>
              <radialGradient id="game-gold-rg" cx="50%" cy="40%" r="55%">
                <stop offset="0%" stopColor="#e8c872" />
                <stop offset="55%" stopColor="#c9a24a" />
                <stop offset="100%" stopColor="#7f5a17" />
              </radialGradient>
            </defs>
            <g stroke="url(#game-gold-rg)" strokeWidth="2.4" strokeLinecap="round" fill="none">
              <line x1="10" y1="12" x2="54" y2="56" />
              <line x1="54" y1="12" x2="10" y2="56" />
              <circle cx="10" cy="12" r="2.5" fill="url(#game-gold-rg)" stroke="none" />
              <circle cx="54" cy="12" r="2.5" fill="url(#game-gold-rg)" stroke="none" />
            </g>
            <path d="M32 18c-10 0-16 7-16 15 0 4 2 7 4 9v4c0 2 1 3 3 3h3v-3h2v3h8v-3h2v3h3c2 0 3-1 3-3v-4c2-2 4-5 4-9 0-8-6-15-16-15z"
              fill="#f4e9d0" stroke="#1a1612" strokeWidth="1.4" />
            <circle cx="26" cy="34" r="3.2" fill="#1a1612" />
            <circle cx="38" cy="34" r="3.2" fill="#1a1612" />
          </svg>
          <div>
            <div className="td-name">Skull King</div>
            {round > 0 && (
              <div className="td-sub">Round {round} of 10</div>
            )}
          </div>
        </div>

        {/* Tickets + copy link */}
        <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
          {round > 0 && (
            <>
              <Ticket label="Round" value={round} dim={`/ 10`} />
              {phase === "playing" && trickCards.length > 0 && (
                <Ticket label="Trick" value={trickCards.length} />
              )}
            </>
          )}
          <button
            onClick={handleCopyLink}
            className="td-btn-secondary"
            style={{ marginTop: 0, padding: "7px 14px", fontSize: "11px" }}
          >
            {copied ? "Copied!" : "Invite"}
          </button>
        </div>
      </div>

      {/* ── 3-column stage (lobby collapses to 1 col) ─── */}
      {phase !== "lobby" ? (
        <div className="td-stage">

          {/* LEFT: Scoreboard ledger */}
          <aside className="td-scroll" style={{ position: "relative" }}>
            <Seal />
            <div className="td-scroll-header">
              <h2>Ledger</h2>
              <div className="td-scroll-rule" />
            </div>

            <ul className="td-score-list">
              {sortedPlayers.map((p) => {
                const rd = roundData[p.seat];
                const isActive = p.seat === currentSeat && phase === "playing";
                const isLeader = p.seat === leaderSeat && players.length > 0;
                return (
                  <li
                    key={p.seat}
                    className={`td-score-row ${p.seat === mySeat ? "td-active" : ""} ${isActive ? "td-active-pulse" : ""}`}
                  >
                    <div className="td-player-col">
                      <span className="td-player-name">
                        {isLeader && (
                          <CrownIcon className="td-crown-mark" />
                        )}
                        {p.name}
                        {p.seat === mySeat ? " ✦" : ""}
                      </span>
                      <span className="td-trick-bid">
                        Bid <span className="td-mono">{rd?.bid !== null && rd?.bid !== undefined ? rd.bid : "–"}</span>
                        {" · "}
                        Won <span className="td-mono">{rd?.won ?? 0}</span>
                      </span>
                    </div>
                    <div>
                      <span className="td-score-val">{cumulativeScores[p.seat] ?? 0}</span>
                    </div>
                  </li>
                );
              })}
            </ul>

            {phase === "playing" && isMyTurn && (
              <BtnPrimary fullWidth onClick={() => {}}>
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 12l6 6L20 6" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
                </svg>
                Your Turn
              </BtnPrimary>
            )}
          </aside>

          {/* CENTER: Play surface */}
          <section className="td-table-center t-felt">
            {/* Phase banner */}
            <div className="td-phase-banner">
              <span className="td-phase-chip">
                {phase === "bidding" && "Bidding Phase"}
                {phase === "playing" && "Playing"}
                {phase === "scoring" && "Scoring"}
                {phase === "complete" && "Game Over"}
              </span>
              {phase === "playing" && (
                <span className="td-phase-sub">
                  {isMyTurn
                    ? "Your turn — play a card from your hand"
                    : `Awaiting ${players.find((p) => p.seat === currentSeat)?.name ?? "..."}`}
                </span>
              )}
              {phase === "bidding" && (
                <span className="td-phase-sub">
                  {bidSubmitted ? `You bid ${myBid} — waiting for others...` : "Predict the tricks you will take"}
                </span>
              )}
            </div>

            {/* Trick pile */}
            {gameMode === "digital" && phase === "playing" && (
              <>
                {lastTrickWinner !== null && trickCards.length === 0 && (
                  <div className="flex justify-center mb-3">
                    <span className="td-awaiting">
                      {players.find((p) => p.seat === lastTrickWinner)?.name ?? "?"} won the trick!
                    </span>
                  </div>
                )}
                {trickCards.length > 0 && (
                  <>
                    <div className="td-trick-label">— The Trick —</div>
                    <div className="td-trick-pile">
                      {trickCards.map((tc, i) => {
                        const card = getCard(tc.cardId);
                        const playerName = players.find((p) => p.seat === tc.seat)?.name ?? "?";
                        const rot = (i - Math.floor(trickCards.length / 2)) * 5;
                        return (
                          <div
                            key={i}
                            className="td-trick-slot"
                            style={{ "--r": `${rot}deg` } as React.CSSProperties}
                          >
                            <span className="td-stamp">{playerName}</span>
                            <CardDisplay
                              card={card}
                              tigressChoice={tc.tigressChoice as any}
                              rotation={rot}
                              played
                            />
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                {trickCards.length === 0 && lastTrickWinner === null && (
                  <div className="flex justify-center items-center" style={{ minHeight: "180px" }}>
                    <span className="td-sc">Waiting for cards…</span>
                  </div>
                )}
              </>
            )}

            {/* Awaiting turn */}
            {phase === "playing" && !isMyTurn && (
              <div className="flex justify-center mt-4">
                <span className="td-awaiting">
                  Awaiting{" "}
                  <em style={{ fontStyle: "italic", color: "var(--parchment)" }}>
                    {players.find((p) => p.seat === currentSeat)?.name ?? "..."}
                  </em>
                </span>
              </div>
            )}

            {/* Scorekeeper non-host waiting */}
            {gameMode === "scorekeeper" && mySeat !== 0 && !isSingleScorer && (
              <div className="flex justify-center items-center" style={{ minHeight: "200px" }}>
                <span className="td-sc">
                  {phase === "bidding"
                    ? "Waiting for host to enter bids…"
                    : "Waiting for host to enter round results…"}
                </span>
              </div>
            )}
          </section>

          {/* RIGHT: Bid tracker or info */}
          <aside className="td-scroll">
            {gameMode === "digital" && phase === "bidding" && mySeat >= 0 && (
              <>
                <div className="td-scroll-header">
                  <h2>Your Bid</h2>
                  <div className="td-scroll-rule" />
                </div>
                <p className="td-sc mb-3" style={{ color: "var(--ink-soft)" }}>
                  Predict the tricks you will take.
                </p>
                {!bidSubmitted ? (
                  <>
                    <div className="td-bid-grid-wrap">
                      <div className="td-bid-grid">
                        {Array.from({ length: round + 1 }, (_, i) => (
                          <button
                            key={i}
                            onClick={() => handleBid(i)}
                            className={`td-bid-chip ${myBid === i ? "td-selected" : ""}`}
                          >
                            {i}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="td-bid-flavor">"Your fate, sealed in ink…"</div>
                  </>
                ) : (
                  <div className="td-bid-flavor">
                    Bid locked: {myBid}<br />
                    <span className="td-sc">Awaiting all pirates…</span>
                  </div>
                )}
              </>
            )}

            {gameMode === "digital" && phase === "playing" && (
              <>
                <div className="td-scroll-header">
                  <h2>This Round</h2>
                  <div className="td-scroll-rule" />
                </div>
                {mySeat >= 0 && (
                  <div style={{ borderTop: "1px dashed rgba(26,22,18,0.2)", borderBottom: "1px dashed rgba(26,22,18,0.2)", padding: "10px 0", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span className="font-serif font-semibold" style={{ color: "var(--ink)" }}>Tricks won</span>
                    <span className="font-mono font-bold" style={{ fontSize: "20px", color: "var(--ink)" }}>
                      {roundData[mySeat]?.won ?? 0} / {roundData[mySeat]?.bid ?? "–"}
                    </span>
                  </div>
                )}
              </>
            )}

            {/* Card reference accordion */}
            {gameMode === "digital" && mySeat >= 0 && (
              <CardInfoPanel />
            )}

            {/* Scorekeeper panel lives in right rail */}
            {gameMode === "scorekeeper" && (mySeat === 0 || isSingleScorer) && (
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
          </aside>

          {/* BOTTOM: Hand */}
          {gameMode === "digital" && mySeat >= 0 && myHand.length > 0 && (
            <div className="td-hand-row">
              <div className="td-hand-panel">
                <div className="td-hand-head">
                  <span className="td-hand-title">Your hand</span>
                  <div className="td-hand-rule" />
                  <span className="td-hand-count">{myHand.length} cards</span>
                </div>
                <div className="td-hand">
                  {myHand.map((cardId, idx) => {
                    const card = getCard(cardId);
                    const rot = (idx - Math.floor(myHand.length / 2)) * 3;
                    const canPlay =
                      isMyTurn && phase === "playing" && pendingPlayCardId === null;
                    return (
                      <button
                        key={cardId}
                        onClick={() => canPlay && handlePlayCard(cardId)}
                        disabled={!canPlay}
                        style={{ background: "none", border: "none", padding: 0, cursor: canPlay ? "pointer" : "default" }}
                        aria-label={`Play card ${card.name ?? card.type}`}
                      >
                        <CardDisplay
                          card={card}
                          rotation={rot}
                          playable={canPlay}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── LOBBY ── */
        <div style={{ maxWidth: "600px", margin: "0 auto", paddingTop: "20px" }}>

          {/* Single-scorer: host enters names */}
          {isSingleScorer && (mySeat === 0 || mySeat === -1) && (
            <div className="td-scroll">
              <div className="td-scroll-header">
                <h2>Enter player names</h2>
                <div className="td-scroll-rule" />
              </div>
              <p className="font-sans text-xs mb-4" style={{ color: "var(--ink-soft)", opacity: 0.7 }}>
                You'll score for everyone at the table
              </p>
              <div className="space-y-3 mb-5">
                {Array.from({ length: maxPlayers }).map((_, i) => (
                  <div key={i}>
                    <label className="td-input-label">Player {i + 1}</label>
                    <input
                      type="text"
                      placeholder={`Player ${i + 1}`}
                      value={singleScorerNames[i] ?? ""}
                      onChange={(e) =>
                        setSingleScorerNames((prev) =>
                          prev.map((n, idx) => (idx === i ? e.target.value : n)),
                        )
                      }
                      maxLength={20}
                      className="td-input"
                    />
                  </div>
                ))}
              </div>
              <BtnPrimary
                fullWidth
                onClick={handleSingleScorerStart}
                disabled={singleScorerNames.filter((n) => n.trim()).length < 2}
              >
                Start Scoring
              </BtnPrimary>
            </div>
          )}

          {/* Single-scorer: non-host waiting */}
          {isSingleScorer && mySeat > 0 && (
            <div className="td-scroll text-center">
              <p className="font-sans text-sm" style={{ color: "var(--ink-soft)" }}>
                Waiting for host to start the game…
              </p>
            </div>
          )}

          {/* Distributed: players join */}
          {!isSingleScorer && (
            <div className="td-scroll">
              <div className="td-scroll-header">
                <h2>Waiting for crew ({sortedPlayers.length}/{maxPlayers})</h2>
                <div className="td-scroll-rule" />
              </div>
              <ul className="td-score-list mb-4">
                {sortedPlayers.map((p) => (
                  <li key={p.seat} className="td-score-row">
                    <div className="td-player-col">
                      <span className="td-player-name" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--forest)", display: "inline-block", flexShrink: 0 }} />
                        {p.name}
                        {p.seat === mySeat ? " (you)" : ""}
                      </span>
                    </div>
                  </li>
                ))}
                {Array.from({ length: maxPlayers - sortedPlayers.length }).map((_, i) => (
                  <li key={i} className="td-score-row" style={{ opacity: 0.4 }}>
                    <div className="td-player-col">
                      <span className="td-player-name" style={{ display: "flex", alignItems: "center", gap: "8px", fontStyle: "italic" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--parchment-edge)", display: "inline-block", flexShrink: 0, opacity: 0.4 }} />
                        Waiting…
                      </span>
                    </div>
                  </li>
                ))}
              </ul>

              <BtnSecondary fullWidth onClick={handleCopyLink} style={{ marginBottom: "12px" }}>
                {copied ? "Copied!" : "Copy invite link"}
              </BtnSecondary>

              {mySeat === 0 && sortedPlayers.length >= 2 && (
                <BtnPrimary fullWidth onClick={handleStartGame}>
                  Start Game ({sortedPlayers.length} players)
                </BtnPrimary>
              )}
              {mySeat === 0 && sortedPlayers.length < 2 && (
                <p className="font-sans text-sm text-center" style={{ color: "var(--ink-faint)" }}>
                  Need at least 2 players to start
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Chat ─── */}
      <div className="fixed bottom-4 right-4 z-30">
        {chatOpen && (
          <div className="td-chat-panel mb-2">
            <div style={{ maxHeight: "192px", overflowY: "auto" }} className="space-y-1 mb-2">
              {chatMessages.slice(-20).map((m, i) => (
                <p key={i} className="font-sans text-xs" style={{ color: "var(--ink-soft)" }}>
                  <span className="font-semibold" style={{ color: "var(--gold-lo)" }}>{m.playerName}:</span>{" "}
                  {m.text}
                </p>
              ))}
              {chatMessages.length === 0 && (
                <p className="font-sans text-xs italic" style={{ color: "var(--ink-faint)" }}>No messages yet</p>
              )}
            </div>
            {mySeat >= 0 && (
              <div className="flex gap-1" style={{ borderTop: "1px solid rgba(26,22,18,0.15)", paddingTop: "8px" }}>
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && chatInput.trim()) {
                      send({ type: "chat", text: chatInput.trim() });
                      setChatInput("");
                    }
                  }}
                  placeholder="Type a message…"
                  maxLength={200}
                  className="td-input flex-1 text-xs"
                  style={{ fontSize: "12px" }}
                />
                <button
                  onClick={() => {
                    if (chatInput.trim()) {
                      send({ type: "chat", text: chatInput.trim() });
                      setChatInput("");
                    }
                  }}
                  disabled={!chatInput.trim()}
                  className="td-btn-primary"
                  style={{ padding: "4px 10px", fontSize: "11px", marginTop: 0 }}
                >
                  Send
                </button>
              </div>
            )}
          </div>
        )}
        <button
          onClick={() => setChatOpen((v) => !v)}
          className="td-btn-secondary"
          style={{ marginTop: 0, padding: "6px 14px", fontSize: "12px" }}
          aria-label="Toggle chat"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 4h16v12H4z" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4 16l4 4v-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          {chatMessages.length > 0 && !chatOpen ? ` ${chatMessages.length}` : ""}
        </button>
      </div>
    </div>
  );
}

// ─── CardDisplay ─────────────────────────────────────────────────────────────

function CardDisplay({
  card,
  tigressChoice,
  rotation = 0,
  playable = false,
  played = false,
}: {
  card: Card;
  tigressChoice?: "escape" | "pirate";
  rotation?: number;
  playable?: boolean;
  played?: boolean;
}) {
  // Map domain card types / suits to Tabledeck Card props
  const suitMap: Record<string, "parrot" | "chest" | "map" | "jolly"> = {
    parrots: "parrot",
    maps: "map",
    treasure_chests: "chest",
    jolly_rogers: "jolly",
  };

  const effectiveType = tigressChoice ?? card.type;

  if (card.type === "numbered" && card.suit) {
    const suit = suitMap[card.suit] ?? "parrot";
    return (
      <TDCard
        suit={suit}
        value={card.value}
        variant="numbered"
        rotation={rotation}
        playable={playable}
        played={played}
      />
    );
  }

  const variantMap: Record<string, "pirate" | "mermaid" | "skull-king" | "tigress" | "escape"> = {
    pirate: "pirate",
    mermaid: "mermaid",
    skull_king: "skull-king",
    tigress: "tigress",
    escape: "escape",
  };

  const variant = variantMap[effectiveType] ?? "escape";
  return (
    <TDCard
      variant={variant}
      rotation={rotation}
      playable={playable}
      played={played}
    />
  );
}

// ─── Card Info Panel ─────────────────────────────────────────────────────────

function CardInfoPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: "14px" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="td-sc w-full flex items-center justify-between"
        style={{ cursor: "pointer", background: "none", border: "none", padding: "8px 0", borderTop: "1px dashed rgba(26,22,18,0.2)" }}
      >
        <span>Card reference</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: "10px" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="font-sans text-xs space-y-3 pt-2" style={{ color: "var(--ink-soft)" }}>
          <div>
            <p className="td-sc mb-2">Suits (1–14)</p>
            <div className="grid grid-cols-1 gap-1">
              <span style={{ color: "var(--burgundy)" }}>Parrots — regular</span>
              <span style={{ color: "var(--copper)" }}>Maps — regular</span>
              <span style={{ color: "var(--forest)" }}>Treasure Chests — regular</span>
              <span style={{ color: "var(--navy-mid)" }}>Jolly Rogers — trump (beats other suits)</span>
            </div>
          </div>
          <div>
            <p className="td-sc mb-2">Who wins the trick</p>
            <ol className="space-y-1 list-none">
              <li>1. Mermaid beats Skull King</li>
              <li>2. Skull King beats all Pirates</li>
              <li>3. Pirate beats all numbered</li>
              <li>4. Jolly Rogers (trump) beats other suits</li>
              <li>5. Highest card of lead suit</li>
              <li>6. Escape always loses</li>
            </ol>
          </div>
          <div>
            <p className="td-sc mb-1">Tigress</p>
            <p>Choose when played: acts as Escape or Pirate.</p>
          </div>
        </div>
      )}
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
      <>
        <div className="td-scroll-header">
          <h2>Round {round} — Bids</h2>
          <div className="td-scroll-rule" />
        </div>
        <div className="space-y-3">
          {players.map((p) => (
            <div key={p.seat} className="flex items-center justify-between">
              <span className="font-serif font-semibold text-sm" style={{ color: "var(--ink)" }}>{p.name}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onBidChange(p.seat, Math.max(0, bids[p.seat] - 1))}
                  className="td-spinner-btn"
                >
                  −
                </button>
                <span className="font-mono font-bold w-8 text-center" style={{ color: "var(--ink)", fontSize: "18px" }}>
                  {bids[p.seat]}
                </span>
                <button
                  onClick={() => onBidChange(p.seat, Math.min(round, bids[p.seat] + 1))}
                  className="td-spinner-btn"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
        <BtnPrimary fullWidth onClick={onSubmitBids}>
          Start Round
        </BtnPrimary>
      </>
    );
  }

  if (phase === "playing") {
    const bonusKeys: { key: string; label: string }[] = [
      { key: "standardFourteen", label: "14 captured (+10)" },
      { key: "blackFourteen", label: "Black 14 captured (+20)" },
      { key: "pirateMermaidCapture", label: "Mermaid by Pirate (+20)" },
      { key: "skullKingPirateCapture", label: "Pirate by Skull King (+30)" },
      { key: "mermaidSkullKingCapture", label: "Skull King by Mermaid (+40)" },
    ];

    return (
      <>
        <div className="td-scroll-header">
          <h2>Round {round} — Results</h2>
          <div className="td-scroll-rule" />
        </div>
        <div className="space-y-4">
          {players.map((p) => (
            <div key={p.seat} style={{ borderBottom: "1px dashed rgba(26,22,18,0.18)", paddingBottom: "12px" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-serif font-semibold text-sm" style={{ color: "var(--ink)" }}>{p.name}</span>
                <div className="flex items-center gap-2">
                  <span className="td-sc">Won:</span>
                  <button
                    onClick={() => onWonChange(p.seat, Math.max(0, won[p.seat] - 1))}
                    className="td-spinner-btn"
                  >
                    −
                  </button>
                  <span className="font-mono font-bold w-6 text-center" style={{ color: "var(--ink)" }}>
                    {won[p.seat]}
                  </span>
                  <button
                    onClick={() => onWonChange(p.seat, Math.min(round, won[p.seat] + 1))}
                    className="td-spinner-btn"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {bonusKeys.map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="font-sans" style={{ fontSize: "11px", color: "var(--ink-faint)" }}>{label}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          onBonusChange(p.seat, key, Math.max(0, (bonuses[p.seat][key] ?? 0) - 1))
                        }
                        className="td-spinner-btn"
                        style={{ width: "22px", height: "22px", fontSize: "12px" }}
                      >
                        −
                      </button>
                      <span className="font-mono" style={{ fontSize: "11px", width: "18px", textAlign: "center", color: "var(--ink)" }}>
                        {bonuses[p.seat][key] ?? 0}
                      </span>
                      <button
                        onClick={() =>
                          onBonusChange(p.seat, key, (bonuses[p.seat][key] ?? 0) + 1)
                        }
                        className="td-spinner-btn"
                        style={{ width: "22px", height: "22px", fontSize: "12px" }}
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
        <BtnPrimary fullWidth onClick={onSubmitResult}>
          Score Round
        </BtnPrimary>
      </>
    );
  }

  return null;
}
