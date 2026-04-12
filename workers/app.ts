import { createRequestHandler, RouterContextProvider } from "react-router";
export { SkullKingRoomDO } from "./game-room";

// @ts-expect-error - build output has no type declarations
const buildImport = () => import("../build/server/index.js");

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Route WebSocket upgrades to the Durable Object
    // Pattern: /game/:gameId/ws
    const wsMatch = url.pathname.match(/^\/game\/([^/]+)\/ws$/);
    if (wsMatch && request.headers.get("Upgrade") === "websocket") {
      const gameId = wsMatch[1];
      const id = env.SKULL_KING_ROOM.idFromName(gameId);
      const stub = env.SKULL_KING_ROOM.get(id);
      const doUrl = new URL(request.url);
      doUrl.pathname = "/ws";
      return stub.fetch(new Request(doUrl.toString(), request));
    }

    // Bridge Cloudflare env bindings into process.env
    Object.assign(process.env, env);

    const context = new RouterContextProvider();
    (context as any).cloudflare = { env, ctx };

    return createRequestHandler(buildImport, "production")(request, context);
  },
} satisfies ExportedHandler<Env>;
