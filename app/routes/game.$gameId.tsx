import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "react-toastify";
import { data, redirect, useFetcher, useNavigate } from "react-router";
import type { Route } from "./+types/game.$gameId";
import { getPrisma } from "~/db.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import type { ServerMessage } from "~/domain/messages";
import { useGameWebSocket } from "@tabledeck/game-room/client";
import type { PublicGameState } from "~/domain/game-state";
import { getCard } from "~/domain/cards";
import type { Card } from "~/domain/cards";
import { validatePlayCard } from "~/domain/validation";
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
  const navigate = useNavigate();

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
  const [creatingRematch, setCreatingRematch] = useState(false);
  const [tigressCardId, setTigressCardId] = useState<number | null>(null);
  // Locks the hand after clicking a card so double-clicks can't submit
  // two play_card messages for a single trick. Cleared when the server
  // broadcasts our card_played (or the turn moves off us).
  const [pendingPlayCardId, setPendingPlayCardId] = useState<number | null>(null);
  const [singleScorerNames, setSingleScorerNames] = useState<string[]>(
    Array(maxPlayers).fill(""),
  );
  const [trickNumber, setTrickNumber] = useState(doState?.trick ?? 1);
  const [bidWaiting, setBidWaiting] = useState<string[]>([]);
  const [bidProgressSeen, setBidProgressSeen] = useState(false);
  const [roundDeltas, setRoundDeltas] = useState<number[]>([]);
  const [pendingBid, setPendingBid] = useState<number | null>(null);
  const [rematchOffer, setRematchOffer] = useState<{ gameId: string; name: string } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  const [roundAdvanceSent, setRoundAdvanceSent] = useState(false);
  const [compactHand, setCompactHand] = useState(false);
  const scoresRef = useRef(cumulativeScores);

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
      setTrickNumber(doState.trick ?? 1);
    }
  }, []);

  useEffect(() => {
    scoresRef.current = cumulativeScores;
  }, [cumulativeScores]);

  useEffect(() => {
    if (phase !== "scoring") setRoundAdvanceSent(false);
  }, [phase]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 800px)");
    const apply = () => setCompactHand(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
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
            setTrickNumber(s.trick ?? 1);
            setRoundData(s.roundData.map((rd) => ({ bid: rd.bid, won: rd.won })));
            if (s.phase !== "bidding") {
              setBidWaiting([]);
              setBidProgressSeen(false);
              setPendingBid(null);
            }
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
              setTrickNumber(s.trick ?? 1);
              setRoundData(s.roundData.map((rd) => ({ bid: rd.bid, won: rd.won })));
              setBidWaiting([]);
              setBidProgressSeen(false);
              setPendingBid(null);
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
            setPendingBid(null);
            setBidWaiting([]);
            setBidProgressSeen(false);
            break;
          case "bid_progress": {
            const waiting = (msg as { waiting?: unknown }).waiting;
            if (Array.isArray(waiting)) {
              setBidWaiting(waiting.filter((name): name is string => typeof name === "string"));
              setBidProgressSeen(true);
            }
            break;
          }
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
            if (scores) {
              const prev = scoresRef.current;
              setRoundDeltas(scores.map((score: number, i: number) => score - (prev[i] ?? 0)));
              setCumulativeScores(scores);
            }
            if (rd) setRoundData(rd.map((r: any) => ({ bid: r.bid, won: r.won })));
            setShowRoundResult(true);
            setPhase("scoring");
            break;
          }
          case "rematch_ready": {
            const offeredId = (msg as { gameId?: unknown }).gameId;
            const offeredBy = (msg as { name?: unknown }).name;
            if (typeof offeredId === "string") {
              setRematchOffer({
                gameId: offeredId,
                name: typeof offeredBy === "string" ? offeredBy : "A pirate",
              });
            }
            break;
          }
          case "game_over": {
            const { finalScores, winner: w } = msg as any;
            if (finalScores) setCumulativeScores(finalScores);
            setWinner(w);
            setShowRoundResult(false);
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
            const raw = String((msg as { message?: unknown }).message ?? "Something went wrong");
            toast.error(raw.replace(/_/g, " "), { theme: "dark", autoClose: 2800 });
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
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareOpen(true);
      toast.error("Select the invite link and copy it", { theme: "dark" });
    }
  };
  const handleNativeShare = async () => {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
      setShareOpen(true);
      await handleCopyLink();
      return;
    }
    try {
      await navigator.share({
        title: "Skull King",
        text: "Join my Skull King table",
        url: shareUrl,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setShareOpen(true);
    }
  };
  const handleRematch = async () => {
    if (creatingRematch) return;
    setCreatingRematch(true);
    try {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rematchOf: gameId }),
      });
      const result = (await res.json()) as { gameId?: string; error?: string };
      if (!res.ok || !result.gameId) {
        throw new Error(result.error || "Could not create rematch");
      }
      send({ type: "announce_rematch", gameId: result.gameId });
      setRematchOffer({ gameId: result.gameId, name: myName });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create rematch", {
        theme: "dark",
      });
    } finally {
      setCreatingRematch(false);
    }
  };

  const isMyTurn = phase === "playing" && currentSeat === mySeat;
  const sortedPlayers = [...players].sort((a, b) => a.seat - b.seat);
  const maxScore = cumulativeScores.length ? Math.max(...cumulativeScores) : 0;
  const leaderSeat =
    cumulativeScores.filter((score) => score === maxScore).length === 1
      ? cumulativeScores.indexOf(maxScore)
      : -1;
  const currentName = players.find((p) => p.seat === currentSeat)?.name ?? "the next pirate";
  const othersWaiting = bidWaiting.filter((name) => name !== myName);
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  let statusTitle = "";
  let statusDetail = "";
  let statusTurn: "you" | "wait" | "info" = "info";
  const iAmScorer = mySeat === 0 || isSingleScorer;
  if (gameMode === "scorekeeper") {
    if (phase === "bidding") {
      statusTitle = iAmScorer ? "Enter every bid" : "Waiting for the scorer";
      statusDetail = iAmScorer
        ? "Set each pirate's bid, then start the round."
        : "The host is writing down bids.";
      statusTurn = iAmScorer ? "you" : "wait";
    } else if (phase === "playing") {
      statusTitle = iAmScorer ? "Enter the round" : "Waiting for the round result";
      statusDetail = iAmScorer
        ? "Count tricks won, then any bonus captures."
        : "Play the cards at the table. The host will score them.";
      statusTurn = iAmScorer ? "you" : "wait";
    } else if (phase === "scoring") {
      statusTitle = `Round ${round} scored`;
      statusDetail = "Check the tally before the next round.";
    } else if (phase === "complete") {
      statusTitle = "Game over";
      statusDetail = "The ledger is final.";
    }
  } else if (phase === "bidding") {
    if (bidSubmitted) {
      statusTitle = `Bid locked at ${myBid}`;
      statusDetail = othersWaiting.length
        ? `Waiting for ${othersWaiting.join(", ")}`
        : "Waiting for the rest of the crew";
      statusTurn = "wait";
    } else if (mySeat >= 0) {
      statusTitle = "Place your bid";
      statusDetail = `How many tricks will you win? Pick 0–${round}, then lock it in.`;
      statusTurn = "you";
    }
  } else if (phase === "playing") {
    if (isMyTurn) {
      statusTitle = "Your turn";
      statusDetail = trickCards.length === 0
        ? "You lead. Tap a card to play it."
        : "Follow the lead suit if you can.";
      statusTurn = "you";
    } else {
      statusTitle = `Waiting for ${currentName}`;
      statusDetail = "Their card lands in the center.";
      statusTurn = "wait";
    }
  } else if (phase === "scoring") {
    statusTitle = `Round ${round} scored`;
    statusDetail = "See who hit their bid, then continue.";
  } else if (phase === "complete") {
    statusTitle = "Game over";
    statusDetail = "The ledger is final.";
  }

  const asideKind =
    gameMode === "scorekeeper" && iAmScorer && (phase === "bidding" || phase === "playing")
      ? "score"
      : gameMode === "digital" && phase === "bidding" && mySeat >= 0
        ? "bid"
        : gameMode === "digital" && phase === "playing"
          ? "round"
          : "empty";

  const shareFields = (fieldId: string) => (
    <div className="td-share-block">
      <label className="td-input-label" htmlFor={fieldId}>Invite link</label>
      <div className="td-share-row">
        <input
          id={fieldId}
          readOnly
          className="td-input"
          value={shareUrl}
          onFocus={(e) => e.currentTarget.select()}
        />
        <BtnSecondary type="button" onClick={handleCopyLink} style={{ flexShrink: 0 }}>
          {copied ? "Copied" : "Copy"}
        </BtnSecondary>
      </div>
      <p className="td-room-code">
        Room code <strong>{gameId}</strong>
      </p>
      {canNativeShare && (
        <BtnPrimary type="button" fullWidth onClick={handleNativeShare}>
          Share with your crew
        </BtnPrimary>
      )}
    </div>
  );

  return (
    <div className="td-game td-table">
      {showNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(4,8,16,0.72)" }} role="dialog" aria-modal="true" aria-labelledby="join-title">
          <div className="td-auth-card relative">
            <h2 id="join-title" className="font-serif font-bold text-xl mb-1" style={{ color: "var(--ink)" }}>Join the table</h2>
            <p className="font-sans text-sm mb-4" style={{ color: "var(--ink-soft)" }}>
              Pick a pirate name, or{" "}
              <a href="/login" className="underline" style={{ color: "var(--gold-lo)" }}>sign in</a>
              {" "}to keep your scores.
            </p>
            {(joinFetcher.data as { error?: string } | undefined)?.error && (
              <p className="td-join-error">{(joinFetcher.data as { error?: string }).error}</p>
            )}
            <label className="td-input-label" htmlFor="pirate-name">Pirate name</label>
            <input
              id="pirate-name"
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
              {joinFetcher.state !== "idle" ? "Boarding…" : "Take a seat"}
            </BtnPrimary>
            <a href="/" className="block w-full text-center font-sans text-sm mt-3 py-2" style={{ color: "var(--ink-soft)", minHeight: 44 }}>
              Cancel
            </a>
          </div>
        </div>
      )}

      {tigressCardId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(4,8,16,0.72)" }} role="dialog" aria-modal="true" aria-labelledby="tigress-title">
          <div className="td-auth-card text-center">
            <h2 id="tigress-title" className="font-serif font-bold text-xl mb-2" style={{ color: "var(--ink)" }}>Tigress</h2>
            <p className="font-sans text-sm mb-6" style={{ color: "var(--ink-soft)" }}>
              Escape loses the trick. Pirate can capture it.
            </p>
            <div className="flex gap-3">
              <BtnSecondary onClick={() => handlePlayCard(tigressCardId, "escape")} fullWidth>
                Escape
              </BtnSecondary>
              <BtnPrimary onClick={() => handlePlayCard(tigressCardId, "pirate")} fullWidth>
                Pirate
              </BtnPrimary>
            </div>
          </div>
        </div>
      )}

      {showReference && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(4,8,16,0.72)" }} role="dialog" aria-modal="true" aria-labelledby="rules-title">
          <div className="td-scroll relative" style={{ maxWidth: 420, width: "100%" }}>
            <div className="td-scroll-header">
              <h2 id="rules-title">Card reference</h2>
              <div className="td-scroll-rule" />
            </div>
            <CardInfoPanel />
            <BtnSecondary fullWidth onClick={() => setShowReference(false)} style={{ marginTop: 16 }}>
              Close
            </BtnSecondary>
          </div>
        </div>
      )}

      {showLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(4,8,16,0.72)" }} role="dialog" aria-modal="true" aria-labelledby="leave-title">
          <div className="td-auth-card">
            <h2 id="leave-title" className="font-serif font-bold text-xl mb-2" style={{ color: "var(--ink)" }}>Leave the table?</h2>
            <p className="font-sans text-sm mb-4" style={{ color: "var(--ink-soft)" }}>
              The game keeps going. Use the same link to sit back down.
            </p>
            <BtnPrimary fullWidth onClick={() => navigate("/")}>Leave</BtnPrimary>
            <BtnSecondary fullWidth onClick={() => setShowLeave(false)}>Stay</BtnSecondary>
          </div>
        </div>
      )}

      {showRoundResult && phase === "scoring" && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: "rgba(4,8,16,0.72)" }} role="dialog" aria-modal="true" aria-labelledby="round-title">
          <div className="td-scroll relative" style={{ maxWidth: 440, width: "100%" }}>
            <Seal animate />
            <div className="td-scroll-header">
              <h2 id="round-title">Round {round} complete</h2>
              <div className="td-scroll-rule" />
            </div>
            <table className="td-round-table">
              <thead>
                <tr>
                  <th>Pirate</th>
                  <th>Bid</th>
                  <th>Won</th>
                  <th>Round</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((p) => {
                  const rd = roundData[p.seat];
                  const delta = roundDeltas[p.seat] ?? 0;
                  return (
                    <tr key={p.seat} className={p.seat === mySeat ? "td-active" : ""}>
                      <td>{p.name}{p.seat === mySeat ? " (you)" : ""}</td>
                      <td>{rd?.bid ?? "–"}</td>
                      <td>{rd?.won ?? 0}</td>
                      <td className={delta < 0 ? "td-score-delta td-neg" : "td-score-delta"} style={{ display: "table-cell" }}>
                        {delta > 0 ? `+${delta}` : delta}
                      </td>
                      <td>{cumulativeScores[p.seat] ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {round < 10 ? (
              <BtnPrimary
                fullWidth
                disabled={roundAdvanceSent}
                onClick={() => {
                  if (roundAdvanceSent) return;
                  setRoundAdvanceSent(true);
                  send({ type: "next_round" });
                }}
              >
                {roundAdvanceSent ? "Continuing…" : `Continue to round ${round + 1}`}
              </BtnPrimary>
            ) : (
              <BtnSecondary fullWidth onClick={() => setShowRoundResult(false)}>
                See final scores
              </BtnSecondary>
            )}
          </div>
        </div>
      )}

      {status === "finished" && phase === "complete" && !showRoundResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(4,8,16,0.72)" }} role="dialog" aria-modal="true" aria-labelledby="over-title">
          <div className="td-scroll relative" style={{ maxWidth: 420, width: "100%" }}>
            <Seal animate />
            <div className="td-scroll-header">
              <h2 id="over-title">Game over</h2>
              <div className="td-scroll-rule" />
            </div>
            {winner !== null && (
              <p className="font-serif text-lg text-center mb-4 font-semibold" style={{ color: "var(--gold-lo)" }}>
                <CrownIcon className="inline-block mr-1 align-middle" size={20} />
                {players.find((p) => p.seat === winner)?.name ?? "Unknown"} wins
              </p>
            )}
            <ul className="td-score-list mb-4">
              {[...sortedPlayers]
                .sort((a, b) => (cumulativeScores[b.seat] ?? 0) - (cumulativeScores[a.seat] ?? 0))
                .map((p) => (
                  <li key={p.seat} className={`td-score-row ${p.seat === mySeat ? "td-active" : ""}`}>
                    <span className="td-player-name">{p.name}{p.seat === mySeat ? " (you)" : ""}</span>
                    <span className="td-score-val">{cumulativeScores[p.seat] ?? 0}</span>
                  </li>
                ))}
            </ul>
            {rematchOffer ? (
              <a href={`/game/${rematchOffer.gameId}`} className="td-btn-primary w-full mt-4">
                Join rematch
              </a>
            ) : (
              <BtnPrimary fullWidth onClick={handleRematch} disabled={creatingRematch}>
                {creatingRematch ? "Charting rematch…" : "Rematch with the same rules"}
              </BtnPrimary>
            )}
            <p className="font-sans text-xs text-center mt-3" style={{ color: "var(--ink-faint)" }}>
              Everyone still at the table gets the rematch link.
            </p>
            <a href="/" className="td-btn-secondary w-full flex items-center justify-center mt-3" style={{ minHeight: 44 }}>
              New setup
            </a>
          </div>
        </div>
      )}

      <header className="td-game-bar">
        <a
          href="/"
          className="td-game-brand"
          onClick={(event) => {
            if (phase !== "lobby" && phase !== "complete" && status !== "finished") {
              event.preventDefault();
              setShowLeave(true);
            }
          }}
        >
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
            </g>
            <path d="M32 18c-10 0-16 7-16 15 0 4 2 7 4 9v4c0 2 1 3 3 3h3v-3h2v3h8v-3h2v3h3c2 0 3-1 3-3v-4c2-2 4-5 4-9 0-8-6-15-16-15z" fill="#f4e9d0" stroke="#1a1612" strokeWidth="1.4" />
            <circle cx="26" cy="34" r="3.2" fill="#1a1612" />
            <circle cx="38" cy="34" r="3.2" fill="#1a1612" />
          </svg>
          <span>
            <span className="td-name">Skull King</span>
            {round > 0 && <span className="td-sub">Round {round} of 10</span>}
          </span>
        </a>
        <div className="td-game-bar-actions">
          {round > 0 && <Ticket label="Round" value={round} dim="/ 10" />}
          <button type="button" className="td-btn-secondary td-bar-btn" onClick={() => setShowReference(true)}>
            Rules
          </button>
          <button type="button" className="td-btn-secondary td-bar-btn" onClick={() => setShareOpen((open) => !open)} aria-expanded={shareOpen}>
            Invite
          </button>
          <button type="button" className="td-btn-secondary td-bar-btn" onClick={() => setChatOpen((open) => !open)} aria-expanded={chatOpen}>
            Chat{chatMessages.length > 0 && !chatOpen ? ` ${chatMessages.length}` : ""}
          </button>
          <button
            type="button"
            className="td-btn-secondary td-bar-btn"
            onClick={() => {
              if (phase === "lobby" || phase === "complete" || status === "finished") navigate("/");
              else setShowLeave(true);
            }}
          >
            Leave
          </button>
          {shareOpen && (
            <div className="td-share-pop" role="dialog" aria-label="Invite your crew">
              {shareFields("invite-pop")}
              <button type="button" className="td-sc mt-3" onClick={() => setShareOpen(false)} style={{ background: "none", border: "none", minHeight: 44 }}>
                Close
              </button>
            </div>
          )}
        </div>
      </header>

      {rematchOffer && (
        <div className="td-banner" role="status">
          <span className="font-serif">{rematchOffer.name} opened a rematch.</span>
          <a href={`/game/${rematchOffer.gameId}`} className="td-btn-primary" style={{ minHeight: 44 }}>
            Join rematch
          </a>
        </div>
      )}

      {phase !== "lobby" && statusTitle && (
        <div className="td-status" role="status" aria-live="polite" data-turn={statusTurn}>
          <strong>{statusTitle}</strong>
          <span>{statusDetail}</span>
        </div>
      )}

      {chatOpen && (
        <div className="td-chat-sheet">
          <div className="td-chat-panel">
            <div className="td-chat-log space-y-1 mb-2">
              {chatMessages.slice(-20).map((m, i) => (
                <p key={`${m.timestamp}-${i}`} className="font-sans text-xs" style={{ color: "var(--ink-soft)" }}>
                  <span className="font-semibold" style={{ color: "var(--gold-lo)" }}>{m.playerName}:</span> {m.text}
                </p>
              ))}
              {chatMessages.length === 0 && (
                <p className="font-sans text-xs italic" style={{ color: "var(--ink-faint)" }}>No messages yet. Say ahoy.</p>
              )}
            </div>
            {mySeat >= 0 && (
              <form
                className="flex gap-2"
                style={{ borderTop: "1px solid rgba(26,22,18,0.15)", paddingTop: 8 }}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!chatInput.trim()) return;
                  send({ type: "chat", text: chatInput.trim() });
                  setChatInput("");
                }}
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Message the table"
                  maxLength={200}
                  className="td-input flex-1"
                  aria-label="Chat message"
                />
                <BtnPrimary type="submit" disabled={!chatInput.trim()} style={{ marginTop: 0 }}>
                  Send
                </BtnPrimary>
              </form>
            )}
          </div>
        </div>
      )}

      {phase !== "lobby" ? (
        <div className="td-play" data-phase={phase} data-mode={gameMode}>
          <aside className="td-scroll td-ledger" aria-label="Score ledger">
            <Seal />
            <div className="td-scroll-header">
              <h2>Ledger</h2>
              <div className="td-scroll-rule" />
            </div>
            <ul className="td-score-list">
              {sortedPlayers.map((p) => {
                const rd = roundData[p.seat];
                const isActive = p.seat === currentSeat && phase === "playing";
                const bidIn = phase === "bidding" && bidProgressSeen && !bidWaiting.includes(p.name);
                return (
                  <li
                    key={p.seat}
                    className={`td-score-row ${p.seat === mySeat ? "td-active" : ""} ${isActive ? "td-active-pulse" : ""}`}
                  >
                    <div className="td-player-col">
                      <span className="td-player-name">
                        {p.seat === leaderSeat && maxScore !== 0 && <CrownIcon className="td-crown-mark" />}
                        {p.name}
                        {p.seat === mySeat ? " (you)" : ""}
                        {isActive && <span className="td-turn-tag">Turn</span>}
                        {bidIn && <span className="td-bid-tag">Bid in</span>}
                        {p.connected === false && <span className="td-away-tag">Away</span>}
                      </span>
                      <span className="td-trick-bid">
                        Bid <span className="td-mono">{rd?.bid !== null && rd?.bid !== undefined ? rd.bid : "–"}</span>
                        {" · "}
                        Won <span className="td-mono">{rd?.won ?? 0}</span>
                      </span>
                    </div>
                    <span className="td-score-val">{cumulativeScores[p.seat] ?? 0}</span>
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="td-table-center t-felt td-felt" aria-label="Trick">
            {gameMode === "digital" && phase === "bidding" && (
              <div className="td-trick-prompt">
                Count the tricks in your hand, then lock a bid.
              </div>
            )}
            {gameMode === "digital" && phase === "playing" && (
              <>
                {trickCards.length > 0 ? (
                  <>
                    <div className="td-trick-label">Trick {trickNumber}</div>
                    <div className="td-trick-pile">
                      {trickCards.map((tc, i) => {
                        const card = getCard(tc.cardId);
                        const playerName = players.find((p) => p.seat === tc.seat)?.name ?? "?";
                        const rot = compactHand ? 0 : (i - Math.floor(trickCards.length / 2)) * 4;
                        return (
                          <div key={`${tc.seat}-${tc.cardId}`} className="td-trick-slot" style={{ "--r": `${rot}deg` } as React.CSSProperties}>
                            <span className="td-stamp">{playerName}</span>
                            <CardDisplay card={card} tigressChoice={tc.tigressChoice as "escape" | "pirate" | undefined} rotation={rot} played />
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="td-trick-prompt">
                    {lastTrickWinner !== null
                      ? `${players.find((p) => p.seat === lastTrickWinner)?.name ?? "Someone"} took the trick`
                      : isMyTurn
                        ? "You lead this trick"
                        : `${currentName} leads`}
                  </div>
                )}
              </>
            )}
            {gameMode === "scorekeeper" && !iAmScorer && (
              <div className="td-trick-prompt">
                {phase === "bidding" ? "Waiting for the host to enter bids" : "Waiting for the host to enter results"}
              </div>
            )}
            {gameMode === "scorekeeper" && iAmScorer && (
              <div className="td-trick-prompt">
                {phase === "bidding" ? "Write every bid, then start the round." : "Enter tricks won and bonus captures."}
              </div>
            )}
          </section>

          {gameMode === "digital" && mySeat >= 0 && myHand.length > 0 && (
            <div className="td-hand-dock">
              <div className={`td-hand-panel ${isMyTurn ? "td-hand-live" : ""}`}>
                <div className="td-hand-head">
                  <span className="td-hand-title">{isMyTurn ? "Your turn" : "Your hand"}</span>
                  <div className="td-hand-rule" />
                  <span className="td-hand-count">{myHand.length} {myHand.length === 1 ? "card" : "cards"}</span>
                </div>
                {isMyTurn && trickCards.length > 0 && (
                  <p className="td-hand-hint">Dimmed cards don't follow suit.</p>
                )}
                <div className="td-hand">
                  {myHand.map((cardId, idx) => {
                    const card = getCard(cardId);
                    const rot = compactHand ? 0 : (idx - Math.floor(myHand.length / 2)) * 2;
                    const check = validatePlayCard(
                      cardId,
                      myHand,
                      trickCards.map((tc) => ({
                        seat: tc.seat,
                        cardId: tc.cardId,
                        tigressChoice:
                          tc.tigressChoice === "pirate" || tc.tigressChoice === "escape"
                            ? tc.tigressChoice
                            : undefined,
                      })),
                      card.type === "tigress" ? "escape" : undefined,
                    );
                    const legal = isMyTurn && pendingPlayCardId === null && check.valid;
                    const label = card.name ?? (card.value ? `${card.value} of ${(card.suit ?? "").replace(/_/g, " ")}` : card.type);
                    return (
                      <button
                        key={cardId}
                        type="button"
                        className="td-card-hit"
                        disabled={!isMyTurn || pendingPlayCardId !== null}
                        aria-label={legal ? `Play ${label}` : `${label}. ${check.reason ?? "Not playable yet"}`}
                        onClick={() => {
                          if (!isMyTurn || pendingPlayCardId !== null) return;
                          if (!check.valid) {
                            toast.error(check.reason ?? "You can't play that card", { theme: "dark" });
                            return;
                          }
                          handlePlayCard(cardId);
                        }}
                      >
                        <CardDisplay
                          card={card}
                          rotation={rot}
                          playable={legal}
                          className={isMyTurn && !check.valid ? "td-unplayable" : ""}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <aside className="td-scroll td-side" data-aside={asideKind}>
            {asideKind === "bid" && (
              <>
                <div className="td-scroll-header">
                  <h2>Your bid</h2>
                  <div className="td-scroll-rule" />
                </div>
                {!bidSubmitted ? (
                  <>
                    <p className="font-sans text-sm mb-3" style={{ color: "var(--ink-soft)" }}>
                      Choose a number, then lock it in. You can change it until you lock.
                    </p>
                    <div className="td-bid-grid" aria-label="Bid amount">
                      {Array.from({ length: round + 1 }, (_, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setPendingBid(i)}
                          className={`td-bid-chip ${pendingBid === i ? "td-selected" : ""}`}
                          aria-pressed={pendingBid === i}
                        >
                          {i}
                        </button>
                      ))}
                    </div>
                    <BtnPrimary fullWidth disabled={pendingBid === null} onClick={() => pendingBid !== null && handleBid(pendingBid)}>
                      {pendingBid === null ? "Choose a bid" : `Lock in bid ${pendingBid}`}
                    </BtnPrimary>
                  </>
                ) : (
                  <p className="font-serif text-lg" style={{ color: "var(--ink)" }}>
                    Bid locked at {myBid}.
                    <span className="block font-sans text-sm mt-2" style={{ color: "var(--ink-soft)" }}>
                      {othersWaiting.length ? `Still waiting on ${othersWaiting.join(", ")}.` : "Waiting for the rest of the crew."}
                    </span>
                  </p>
                )}
              </>
            )}

            {asideKind === "round" && mySeat >= 0 && (
              <>
                <div className="td-scroll-header">
                  <h2>This round</h2>
                  <div className="td-scroll-rule" />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 0" }}>
                  <span className="font-serif font-semibold" style={{ color: "var(--ink)" }}>Tricks won</span>
                  <span className="font-mono font-bold" style={{ fontSize: 22, color: "var(--ink)" }}>
                    {roundData[mySeat]?.won ?? 0} / {roundData[mySeat]?.bid ?? "–"}
                  </span>
                </div>
                <p className="font-sans text-sm" style={{ color: "var(--ink-soft)" }}>
                  Hit your bid exactly. A zero bid pays {round * 10} if you take nothing.
                </p>
              </>
            )}

            {asideKind === "score" && (
              <ScorekeeperPanel
                phase={phase}
                round={round}
                maxPlayers={maxPlayers}
                players={sortedPlayers}
                bids={skBids}
                won={skWon}
                bonuses={skBonuses}
                onBidChange={(seat, val) => setSkBids((prev) => prev.map((b, i) => (i === seat ? val : b)))}
                onWonChange={(seat, val) => setSkWon((prev) => prev.map((w, i) => (i === seat ? val : w)))}
                onBonusChange={(seat, key, val) =>
                  setSkBonuses((prev) => prev.map((b, i) => (i === seat ? { ...b, [key]: val } : b)))
                }
                onSubmitBids={handleScorekeeperSubmitBids}
                onSubmitResult={handleScorekeeperSubmitResult}
              />
            )}
          </aside>

        </div>
      ) : (
        <div style={{ width: "min(560px, 100%)", margin: "8px auto 0" }}>
          {isSingleScorer && (mySeat === 0 || mySeat === -1) && (
            <div className="td-scroll">
              <div className="td-scroll-header">
                <h2>Who's at the table?</h2>
                <div className="td-scroll-rule" />
              </div>
              <p className="font-sans text-sm mb-4" style={{ color: "var(--ink-soft)" }}>
                You'll enter bids and scores for everyone. At least two names.
              </p>
              <div className="space-y-3 mb-2">
                {Array.from({ length: maxPlayers }).map((_, i) => (
                  <div key={i}>
                    <label className="td-input-label" htmlFor={`seat-name-${i}`}>Player {i + 1}</label>
                    <input
                      id={`seat-name-${i}`}
                      type="text"
                      placeholder={`Player ${i + 1}`}
                      value={singleScorerNames[i] ?? ""}
                      onChange={(e) =>
                        setSingleScorerNames((prev) => prev.map((n, idx) => (idx === i ? e.target.value : n)))
                      }
                      maxLength={20}
                      className="td-input"
                    />
                  </div>
                ))}
              </div>
              <BtnPrimary fullWidth onClick={handleSingleScorerStart} disabled={singleScorerNames.filter((n) => n.trim()).length < 2}>
                Start scoring
              </BtnPrimary>
            </div>
          )}

          {isSingleScorer && mySeat > 0 && (
            <div className="td-scroll text-center">
              <p className="font-serif text-lg" style={{ color: "var(--ink)" }}>Waiting for the host to start scoring.</p>
            </div>
          )}

          {!isSingleScorer && (
            <div className="td-scroll">
              <div className="td-scroll-header">
                <h2>Waiting for crew ({sortedPlayers.length}/{maxPlayers})</h2>
                <div className="td-scroll-rule" />
              </div>
              <ul className="td-score-list mb-4">
                {sortedPlayers.map((p) => (
                  <li key={p.seat} className="td-score-row">
                    <span className="td-player-name">
                      {p.name}
                      {p.seat === mySeat ? " (you)" : ""}
                      {p.seat === 0 ? " · host" : ""}
                    </span>
                  </li>
                ))}
                {Array.from({ length: Math.max(0, maxPlayers - sortedPlayers.length) }).map((_, i) => (
                  <li key={`empty-${i}`} className="td-score-row" style={{ opacity: 0.55 }}>
                    <span className="td-player-name" style={{ fontStyle: "italic" }}>Open seat</span>
                  </li>
                ))}
              </ul>
              {shareFields("invite-lobby")}
              {mySeat === 0 && sortedPlayers.length >= 2 && (
                <BtnPrimary fullWidth onClick={handleStartGame}>
                  Start game ({sortedPlayers.length} players)
                </BtnPrimary>
              )}
              {mySeat === 0 && sortedPlayers.length < 2 && (
                <p className="font-sans text-sm text-center mt-3" style={{ color: "var(--ink-soft)" }}>
                  Need at least two pirates. Send the link, then start when they sit down.
                </p>
              )}
              {mySeat !== 0 && (
                <p className="font-sans text-sm text-center mt-4" style={{ color: "var(--ink-soft)" }}>
                  Waiting for the host to start. You'll bid as soon as the cards are dealt.
                </p>
              )}
            </div>
          )}
        </div>
      )}
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
  className = "",
}: {
  card: Card;
  tigressChoice?: "escape" | "pirate";
  rotation?: number;
  playable?: boolean;
  played?: boolean;
  className?: string;
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
        className={className}
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
      className={className}
    />
  );
}

// ─── Card Info Panel ─────────────────────────────────────────────────────────

function CardInfoPanel() {
  return (
    <div>
      <div className="font-sans text-xs space-y-3" style={{ color: "var(--ink-soft)" }}>
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
