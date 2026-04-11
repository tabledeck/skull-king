import { redirect } from "react-router";
import type { Route } from "./+types/profile";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { getPrisma } from "~/db.server";

export function meta() {
  return [{ title: "Profile — Skull King" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  if (!user) throw redirect("/login");

  const db = getPrisma(context);
  const gamePlayers = await db.gamePlayer.findMany({
    where: { userId: user.id },
    include: {
      game: { select: { id: true, status: true, mode: true, createdAt: true, maxPlayers: true } },
    },
    orderBy: { game: { createdAt: "desc" } },
    take: 20,
  });

  const games = gamePlayers.map((gp) => ({
    gameId: gp.gameId,
    mode: gp.game.mode,
    status: gp.game.status,
    seat: gp.seat,
    finalScore: gp.finalScore,
    maxPlayers: gp.game.maxPlayers,
    createdAt: gp.game.createdAt.toISOString(),
  }));

  const finishedGames = games.filter((g) => g.status === "finished");
  const wins = finishedGames.filter((g, _i, arr) => {
    // Win = highest score in the game (approximated by finalScore — full check needs all players)
    return g.finalScore > 0;
  }).length;

  return {
    user: { name: user.name, email: user.email },
    games,
    stats: {
      played: games.length,
      finished: finishedGames.length,
    },
  };
}

export default function Profile({ loaderData }: Route.ComponentProps) {
  const { user, games, stats } = loaderData;

  return (
    <div className="min-h-screen bg-gray-950 p-4">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-6 pt-4">
          <a href="/" className="text-gray-400 hover:text-white text-sm">
            ← Home
          </a>
          <a
            href="/logout"
            className="text-gray-500 hover:text-gray-300 text-sm"
          >
            Logout
          </a>
        </div>

        <div className="text-center mb-8">
          <div className="text-5xl mb-2">☠️</div>
          <h1 className="text-2xl font-bold text-white">
            {user.name || user.email}
          </h1>
          <p className="text-gray-400 text-sm">{user.email}</p>
        </div>

        <div className="flex gap-4 mb-8">
          <div className="flex-1 bg-gray-900 rounded-xl p-4 text-center border border-gray-800">
            <p className="text-3xl font-bold text-white">{stats.played}</p>
            <p className="text-gray-400 text-sm">Games</p>
          </div>
          <div className="flex-1 bg-gray-900 rounded-xl p-4 text-center border border-gray-800">
            <p className="text-3xl font-bold text-white">{stats.finished}</p>
            <p className="text-gray-400 text-sm">Finished</p>
          </div>
        </div>

        <h2 className="text-white font-semibold mb-3">Recent Games</h2>
        {games.length === 0 ? (
          <p className="text-gray-500 text-sm">No games yet. Go pillage!</p>
        ) : (
          <div className="space-y-2">
            {games.map((g) => (
              <a
                key={g.gameId}
                href={`/game/${g.gameId}`}
                className="flex items-center justify-between bg-gray-900 rounded-xl p-4 border border-gray-800 hover:border-gray-600 transition-colors"
              >
                <div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full mr-2 ${
                      g.mode === "digital"
                        ? "bg-amber-900 text-amber-300"
                        : "bg-blue-900 text-blue-300"
                    }`}
                  >
                    {g.mode === "digital" ? "Online" : "Score Tracker"}
                  </span>
                  <span className="text-white text-sm font-medium">
                    {g.gameId}
                  </span>
                  <p className="text-gray-500 text-xs mt-0.5">
                    {g.maxPlayers} players ·{" "}
                    {new Date(g.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`text-xs ${
                      g.status === "finished"
                        ? "text-green-400"
                        : g.status === "active"
                          ? "text-amber-400"
                          : "text-gray-500"
                    }`}
                  >
                    {g.status}
                  </span>
                  {g.finalScore !== 0 && (
                    <p className="text-white font-bold text-sm">{g.finalScore} pts</p>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
