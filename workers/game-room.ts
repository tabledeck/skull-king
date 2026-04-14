import { BaseGameRoomDO } from "@tabledeck/game-room/server";
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

export class SkullKingRoomDO extends BaseGameRoomDO<GameState, GameSettings, Env> {
  // ── Abstract implementations ─────────────────────────────────────────────

  protected initializeState(settings: GameSettings): GameState {
    return initializeGame(settings);
  }

  protected serializeState(state: GameState): Record<string, unknown> {
    return serializeGameState(state) as unknown as Record<string, unknown>;
  }

  protected deserializeState(data: Record<string, unknown>): GameState {
    return deserializeGameState(data as any);
  }

  protected isPlayerSeated(state: GameState, seat: number): boolean {
    return !!state.players[seat];
  }

  protected getPlayerName(state: GameState, seat: number): string | null {
    return state.players[seat]?.name ?? null;
  }

  protected seatPlayer(state: GameState, seat: number, name: string): GameState {
    const newPlayers = [...state.players];
    newPlayers[seat] = { seat, name, connected: true };
    return { ...state, players: newPlayers };
  }

  protected getSeatedCount(state: GameState): number {
    return state.players.filter(Boolean).length;
  }

  protected async onAllPlayersSeated(): Promise<void> {
    // Skull King requires an explicit start_game message — nothing to do here
  }

  protected async onGameMessage(
    ws: WebSocket,
    rawMsg: unknown,
    seat: number,
    playerName: string,
  ): Promise<void> {
    if (!this.gameState || !this.settings) return;

    const result = ClientMessage.safeParse(rawMsg);
    if (!result.success) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
      return;
    }

    const msg = result.data;

    switch (msg.type) {
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
      case "set_player_names":
        await this.handleSetPlayerNames(ws, seat, msg.names);
        break;
      case "scorekeeper_bid":
        await this.handleScorekeeperBid(ws, seat, msg.bids);
        break;
      case "scorekeeper_result":
        await this.handleScorekeeperResult(ws, seat, msg.won, msg.bonuses);
        break;
      case "chat":
        this.broadcast(JSON.stringify({
          type: "chat_broadcast",
          seat,
          presetId: msg.presetId,
          playerName: this.gameState.players[seat]?.name ?? playerName,
        }));
        break;
    }
  }

  protected getPrivateStateForSeat(seat: number): Record<string, unknown> {
    return {
      yourHand: seat >= 0 ? (this.gameState?.hands[seat] ?? []) : [],
    };
  }

  protected onPlayerDisconnected(seat: number): void {
    if (this.gameState?.players[seat]) {
      this.gameState.players[seat]!.connected = false;
    }
  }

  // ── Game message handlers ────────────────────────────────────────────────

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
      this.gameState = startScorekeeperRound(this.gameState);
    } else {
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

    const allBid = this.gameState.roundData.every((rd) => rd.bid !== null);
    if (allBid) {
      const bids = this.gameState.roundData.map((rd) => rd.bid);
      this.broadcast(JSON.stringify({ type: "bid_reveal", bids, allBids: bids }));
      this.broadcastStateWithPrivateHands("game_state");
    }
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

    const playMove: MoveRecord = {
      seat,
      sequence: this.nextSequence++,
      moveType: "play_card",
      data: { type: "play_card", cardId, tigressChoice },
    };

    this.gameState = applyMove(this.gameState, playMove);
    await this.persistState();
    await this.persistMoveToDB(playMove);

    this.broadcast(JSON.stringify({ type: "card_played", seat, cardId, tigressChoice, currentSeat: this.gameState.currentSeat }));

    const trickComplete = this.gameState.trickCards.length === 0 &&
      this.gameState.phase !== "lobby";
    if (trickComplete) {
      this.broadcast(JSON.stringify({
        type: "trick_result",
        winner: this.gameState.leadSeat,
        trickCards: [],
        scores: this.gameState.cumulativeScores,
      }));
    }

    if (this.gameState.phase === "scoring" || this.gameState.phase === "complete") {
      this.broadcast(JSON.stringify({
        type: "round_score",
        scores: this.gameState.cumulativeScores,
        roundData: this.gameState.roundData,
      }));
    }

    if (this.gameState.phase === "complete") {
      await this.syncStatusToDB("finished");
      this.broadcast(JSON.stringify({
        type: "game_over",
        finalScores: this.gameState.cumulativeScores,
        winner: this.gameState.winner,
      }));
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

  private async handleSetPlayerNames(ws: WebSocket, seat: number, names: string[]) {
    if (!this.gameState || !this.settings) return;
    if (seat !== 0 && seat !== -1) {
      ws.send(JSON.stringify({ type: "error", message: "Only the host can set player names" }));
      return;
    }
    if (this.gameState.phase !== "lobby") return;

    for (let i = 0; i < Math.min(names.length, this.settings.maxPlayers); i++) {
      const name = names[i]?.trim();
      if (!name) continue;
      const joinMove: MoveRecord = {
        seat: i,
        sequence: this.nextSequence++,
        moveType: "join",
        data: { type: "join", name },
      };
      this.gameState = applyMove(this.gameState, joinMove);
      await this.persistMoveToDB(joinMove);
    }

    this.gameState = startScorekeeperRound(this.gameState);
    await this.persistState();
    await this.syncStatusToDB("active");

    this.broadcast(JSON.stringify({
      type: "game_state",
      state: serializeGameState(this.gameState),
      yourHand: [],
    }));
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

    this.broadcast(JSON.stringify({
      type: "bid_reveal",
      bids: this.gameState.roundData.map((rd) => rd.bid),
      allBids: bids,
    }));
    this.broadcast(JSON.stringify({
      type: "game_state",
      state: serializeGameState(this.gameState),
      yourHand: [],
    }));
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

    this.broadcast(JSON.stringify({
      type: "round_score",
      scores: this.gameState.cumulativeScores,
      roundData: this.gameState.roundData,
    }));

    if (this.gameState.phase === "complete") {
      await this.syncStatusToDB("finished");
      this.broadcast(JSON.stringify({
        type: "game_over",
        finalScores: this.gameState.cumulativeScores,
        winner: this.gameState.winner,
      }));
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private broadcastStateWithPrivateHands(messageType: string) {
    if (!this.gameState) return;
    const publicState = serializeGameState(this.gameState);
    for (const ws of this.state.getWebSockets()) {
      const tags = this.state.getTags(ws);
      const seat = parseInt(tags[0] ?? "-1");
      const hand = seat >= 0 ? (this.gameState.hands[seat] ?? []) : [];
      try {
        ws.send(JSON.stringify({ type: messageType, state: publicState, yourHand: hand }));
      } catch {
        // Socket closed
      }
    }
  }

  // ── Persistence ──────────────────────────────────────────────────────────

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
