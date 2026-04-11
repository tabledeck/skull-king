import { nanoid } from "nanoid";
import {
  initializeGame,
  applyMove,
  serializeGameState,
  deserializeGameState,
  startNextRound,
  startScorekeeperRound,
  type GameState,
  type GameSettings,
  type MoveRecord,
} from "../app/domain/game-logic";
import { ClientMessage } from "../app/domain/messages";

export class SkullKingRoomDO {
  private state: DurableObjectState;
  private env: Env;
  private gameState: GameState | null = null;
  private settings: GameSettings | null = null;
  private nextSequence = 0;
  private gameId: string | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade: /ws?seat=N&name=PlayerName
    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      const seatParam = url.searchParams.get("seat");
      const name = url.searchParams.get("name") ?? "Guest";
      const seat = seatParam !== null ? parseInt(seatParam) : -1;

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Store seat and name as tags for hibernation
      this.state.acceptWebSocket(server, [String(seat), name]);

      await this.ensureState();

      // Send current state to connecting player
      if (this.gameState) {
        const hand = seat >= 0 ? (this.gameState.hands[seat] ?? []) : [];
        server.send(
          JSON.stringify({
            type: "game_state",
            state: serializeGameState(this.gameState),
            yourHand: hand,
          }),
        );
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    // Initialize game: POST /create
    if (url.pathname === "/create" && request.method === "POST") {
      const body = (await request.json()) as {
        settings: GameSettings;
        gameId: string;
      };
      this.settings = body.settings;
      this.gameId = body.gameId;
      this.gameState = initializeGame(body.settings);
      await this.persistState();
      return new Response(JSON.stringify({ ok: true }));
    }

    // Get state: GET /state
    if (url.pathname === "/state" && request.method === "GET") {
      await this.ensureState();
      if (!this.gameState) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(
        JSON.stringify({
          state: serializeGameState(this.gameState),
          settings: this.settings,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("Not Found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    const result = ClientMessage.safeParse(parsed);
    if (!result.success) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
      return;
    }

    const msg = result.data;
    const tags = this.state.getTags(ws);
    const seat = parseInt(tags[0] ?? "-1");
    const playerName = tags[1] ?? "Guest";

    await this.ensureState();
    if (!this.gameState || !this.settings) return;

    switch (msg.type) {
      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;

      case "join_game":
        await this.handleJoin(ws, seat, msg.name ?? playerName);
        break;

      case "start_game":
        await this.handleStartGame(ws, seat);
        break;

      case "bid":
        await this.handleBid(ws, seat, msg.amount);
        break;

      case "play_card":
        await this.handlePlayCard(ws, seat, msg.cardId, msg.tigressChoice);
        break;

      case "next_round":
        await this.handleNextRound(ws, seat);
        break;

      case "scorekeeper_bid":
        await this.handleScorekeeperBid(ws, seat, msg.bids);
        break;

      case "scorekeeper_result":
        await this.handleScorekeeperResult(ws, seat, msg.won, msg.bonuses);
        break;

      case "chat":
        this.broadcast(
          JSON.stringify({
            type: "chat_broadcast",
            seat,
            presetId: msg.presetId,
            playerName: this.gameState.players[seat]?.name ?? playerName,
          }),
        );
        break;
    }
  }

  webSocketClose(ws: WebSocket) {
    const tags = this.state.getTags(ws);
    const seat = parseInt(tags[0] ?? "-1");
    if (seat >= 0 && this.gameState?.players[seat]) {
      this.gameState.players[seat]!.connected = false;
      this.broadcast(JSON.stringify({ type: "player_disconnected", seat }));
    }
    ws.close();
  }

  webSocketError(ws: WebSocket) {
    ws.close();
  }

  // ─── Handlers ───────────────────────────────────────────────────────────────

  private async handleJoin(ws: WebSocket, seat: number, name: string) {
    if (!this.gameState || !this.settings) return;

    const availableSeat =
      seat >= 0 && seat < this.settings.maxPlayers ? seat : this.findOpenSeat();
    if (availableSeat === -1) {
      ws.send(JSON.stringify({ type: "error", message: "Game is full" }));
      return;
    }

    const joinMove: MoveRecord = {
      seat: availableSeat,
      sequence: this.nextSequence++,
      moveType: "join",
      data: { type: "join", name },
    };

    this.gameState = applyMove(this.gameState, joinMove);
    await this.persistState();
    await this.persistMoveToDB(joinMove);

    this.broadcast(
      JSON.stringify({ type: "player_joined", seat: availableSeat, name }),
    );
  }

  private async handleStartGame(ws: WebSocket, seat: number) {
    if (!this.gameState || !this.settings) return;
    if (this.gameState.phase !== "lobby") {
      ws.send(JSON.stringify({ type: "error", message: "Game already started" }));
      return;
    }

    const activePlayers = this.gameState.players.filter(Boolean).length;
    if (activePlayers < 2) {
      ws.send(JSON.stringify({ type: "error", message: "Need at least 2 players" }));
      return;
    }

    if (this.gameState.mode === "scorekeeper") {
      // Scorekeeper: just start bidding phase
      this.gameState = startScorekeeperRound(this.gameState);
    } else {
      // Digital: deal cards
      const startMove: MoveRecord = {
        seat,
        sequence: this.nextSequence++,
        moveType: "start_game",
        data: { type: "start_game" },
      };
      this.gameState = applyMove(this.gameState, startMove);
      await this.persistMoveToDB(startMove);
    }

    await this.persistState();
    await this.syncStatusToDB("active");

    this.broadcastStateWithPrivateHands("game_state");
  }

  private async handleBid(ws: WebSocket, seat: number, amount: number) {
    if (!this.gameState) return;
    if (this.gameState.phase !== "bidding") {
      ws.send(JSON.stringify({ type: "error", message: "Not in bidding phase" }));
      return;
    }
    if (amount < 0 || amount > this.gameState.round) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid bid" }));
      return;
    }

    const bidMove: MoveRecord = {
      seat,
      sequence: this.nextSequence++,
      moveType: "bid",
      data: { type: "bid", amount },
    };

    this.gameState = applyMove(this.gameState, bidMove);
    await this.persistState();
    await this.persistMoveToDB(bidMove);

    // Check if all bids are in
    const allBid = this.gameState.roundData.every((rd) => rd.bid !== null);
    if (allBid) {
      // Reveal all bids at once
      const bids = this.gameState.roundData.map((rd) => rd.bid);
      this.broadcast(
        JSON.stringify({ type: "bid_reveal", bids, allBids: bids }),
      );
    }
    // Don't reveal individual bids — wait for all
  }

  private async handlePlayCard(
    ws: WebSocket,
    seat: number,
    cardId: number,
    tigressChoice?: "escape" | "pirate",
  ) {
    if (!this.gameState) return;
    if (this.gameState.phase !== "playing") {
      ws.send(JSON.stringify({ type: "error", message: "Not in playing phase" }));
      return;
    }
    if (this.gameState.currentSeat !== seat) {
      ws.send(JSON.stringify({ type: "error", message: "Not your turn" }));
      return;
    }

    const { validatePlayCard } = await import("../app/domain/validation");
    const validation = validatePlayCard(
      cardId,
      this.gameState.hands[seat] ?? [],
      this.gameState.trickCards,
      tigressChoice,
    );
    if (!validation.valid) {
      ws.send(JSON.stringify({ type: "error", message: validation.reason }));
      return;
    }

    const prevTrickCount = this.gameState.trickCards.length;
    const prevPhase = this.gameState.phase;

    const playMove: MoveRecord = {
      seat,
      sequence: this.nextSequence++,
      moveType: "play_card",
      data: { type: "play_card", cardId, tigressChoice },
    };

    this.gameState = applyMove(this.gameState, playMove);
    await this.persistState();
    await this.persistMoveToDB(playMove);

    // Broadcast the card played
    this.broadcast(
      JSON.stringify({ type: "card_played", seat, cardId, tigressChoice }),
    );

    // If trick just resolved (trickCards reset to empty after being full)
    const trickComplete = prevTrickCount + 1 === this.gameState.maxPlayers;
    if (trickComplete) {
      const rd = this.gameState.roundData;
      this.broadcast(
        JSON.stringify({
          type: "trick_result",
          winner: this.gameState.leadSeat, // leadSeat is now the trick winner
          trickCards: [], // already cleared
          scores: this.gameState.cumulativeScores,
        }),
      );
    }

    // Check if round ended (phase changed to scoring or complete)
    if (this.gameState.phase === "scoring" || this.gameState.phase === "complete") {
      const deltas = this.gameState.roundData.map((rd, seat) => {
        const prev = this.gameState!.cumulativeScores[seat];
        return prev; // cumulative already applied, delta calculation for display
      });
      this.broadcast(
        JSON.stringify({
          type: "round_score",
          scores: this.gameState.cumulativeScores,
          roundData: this.gameState.roundData,
        }),
      );
    }

    if (this.gameState.phase === "complete") {
      await this.syncStatusToDB("finished");
      this.broadcast(
        JSON.stringify({
          type: "game_over",
          finalScores: this.gameState.cumulativeScores,
          winner: this.gameState.winner,
        }),
      );
    }
  }

  private async handleNextRound(ws: WebSocket, seat: number) {
    if (!this.gameState) return;
    if (this.gameState.phase !== "scoring") {
      ws.send(JSON.stringify({ type: "error", message: "Not in scoring phase" }));
      return;
    }

    if (this.gameState.mode === "scorekeeper") {
      this.gameState = startScorekeeperRound(this.gameState);
    } else {
      this.gameState = startNextRound(this.gameState);
    }

    await this.persistState();
    this.broadcastStateWithPrivateHands("next_round_ready");
  }

  private async handleScorekeeperBid(ws: WebSocket, seat: number, bids: number[]) {
    if (!this.gameState) return;
    if (this.gameState.mode !== "scorekeeper") return;

    const bidMove: MoveRecord = {
      seat,
      sequence: this.nextSequence++,
      moveType: "scorekeeper_bid",
      data: { type: "scorekeeper_bid", bids },
    };
    this.gameState = applyMove(this.gameState, bidMove);
    await this.persistState();
    await this.persistMoveToDB(bidMove);

    this.broadcast(
      JSON.stringify({
        type: "bid_reveal",
        bids: this.gameState.roundData.map((rd) => rd.bid),
        allBids: bids,
      }),
    );
    this.broadcast(
      JSON.stringify({
        type: "game_state",
        state: serializeGameState(this.gameState),
        yourHand: [],
      }),
    );
  }

  private async handleScorekeeperResult(
    ws: WebSocket,
    seat: number,
    won: number[],
    bonuses: any[],
  ) {
    if (!this.gameState) return;
    if (this.gameState.mode !== "scorekeeper") return;

    const resultMove: MoveRecord = {
      seat,
      sequence: this.nextSequence++,
      moveType: "scorekeeper_result",
      data: { type: "scorekeeper_result", won, bonuses },
    };
    this.gameState = applyMove(this.gameState, resultMove);
    await this.persistState();
    await this.persistMoveToDB(resultMove);

    this.broadcast(
      JSON.stringify({
        type: "round_score",
        scores: this.gameState.cumulativeScores,
        roundData: this.gameState.roundData,
      }),
    );

    if (this.gameState.phase === "complete") {
      await this.syncStatusToDB("finished");
      this.broadcast(
        JSON.stringify({
          type: "game_over",
          finalScores: this.gameState.cumulativeScores,
          winner: this.gameState.winner,
        }),
      );
    }
  }

  // ─── Broadcast helpers ───────────────────────────────────────────────────────

  private broadcast(message: string) {
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // Socket closed
      }
    }
  }

  private broadcastStateWithPrivateHands(messageType: string) {
    if (!this.gameState) return;
    const publicState = serializeGameState(this.gameState);
    for (const ws of this.state.getWebSockets()) {
      const tags = this.state.getTags(ws);
      const seat = parseInt(tags[0] ?? "-1");
      const hand = seat >= 0 ? (this.gameState!.hands[seat] ?? []) : [];
      try {
        ws.send(
          JSON.stringify({
            type: messageType,
            state: publicState,
            yourHand: hand,
          }),
        );
      } catch {
        // Socket closed
      }
    }
  }

  // ─── Seat helpers ────────────────────────────────────────────────────────────

  private findOpenSeat(): number {
    if (!this.gameState || !this.settings) return -1;
    for (let i = 0; i < this.settings.maxPlayers; i++) {
      if (!this.gameState.players[i]) return i;
    }
    return -1;
  }

  // ─── Persistence ─────────────────────────────────────────────────────────────

  private async ensureState() {
    if (this.gameState) return;

    const stored = await this.state.storage.get<ReturnType<typeof serializeGameState>>("gameState");
    const settings = await this.state.storage.get<GameSettings>("settings");
    const seq = await this.state.storage.get<number>("nextSequence");

    if (stored && settings) {
      this.gameState = deserializeGameState(stored as any);
      this.settings = settings;
      this.nextSequence = seq ?? 0;
      this.gameId = (await this.state.storage.get<string>("gameId")) ?? null;
    }
  }

  private async persistState() {
    if (!this.gameState) return;
    await this.state.storage.put("gameState", serializeGameState(this.gameState));
    await this.state.storage.put("nextSequence", this.nextSequence);
    if (this.settings) await this.state.storage.put("settings", this.settings);
    if (this.gameId) await this.state.storage.put("gameId", this.gameId);
  }

  private async persistMoveToDB(move: MoveRecord) {
    if (!this.gameId) return;
    try {
      await this.env.D1_DATABASE
        .prepare(
          `INSERT INTO Move (id, gameId, seat, sequence, moveType, data, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT (gameId, sequence) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          this.gameId,
          move.seat,
          move.sequence,
          move.moveType,
          JSON.stringify(move.data),
        )
        .run();
    } catch {
      // Non-fatal — DO is authoritative
    }
  }

  private async syncStatusToDB(status: "active" | "finished") {
    if (!this.gameId) return;
    try {
      if (status === "active") {
        await this.env.D1_DATABASE
          .prepare(`UPDATE Game SET status = 'active' WHERE id = ? AND status = 'waiting'`)
          .bind(this.gameId)
          .run();
      } else if (status === "finished" && this.gameState) {
        await this.env.D1_DATABASE
          .prepare(`UPDATE Game SET status = 'finished', finishedAt = datetime('now') WHERE id = ?`)
          .bind(this.gameId)
          .run();
        for (let seat = 0; seat < this.gameState.maxPlayers; seat++) {
          await this.env.D1_DATABASE
            .prepare(`UPDATE GamePlayer SET finalScore = ? WHERE gameId = ? AND seat = ?`)
            .bind(this.gameState.cumulativeScores[seat] ?? 0, this.gameId, seat)
            .run();
        }
      }
    } catch {
      // Non-fatal
    }
  }
}
