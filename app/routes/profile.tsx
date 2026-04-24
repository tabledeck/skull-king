import { redirect } from "react-router";
import type { Route } from "./+types/profile";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { getPrisma } from "~/db.server";
import { SkullIcon } from "~/components/icons/skull-king/SkullIcon";

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
    <div className="td-table min-h-screen p-4">
      <div style={{ maxWidth: "520px", margin: "0 auto" }}>
        <div className="flex items-center justify-between mb-6 pt-4">
          <a href="/" className="font-sans text-sm" style={{ color: "var(--parchment)", opacity: 0.65 }}>
            ← Home
          </a>
          <a href="/logout" className="font-sans text-sm" style={{ color: "var(--parchment)", opacity: 0.45 }}>
            Logout
          </a>
        </div>

        <div className="text-center mb-8">
          <div className="mb-3 flex justify-center" style={{ color: "var(--gold)" }}>
            <SkullIcon size={52} />
          </div>
          <h1
            className="font-serif font-semibold"
            style={{ fontSize: "26px", color: "var(--parchment)", fontVariant: "small-caps", letterSpacing: "0.08em" }}
          >
            {user.name || user.email}
          </h1>
          <p className="font-sans text-sm" style={{ color: "var(--parchment)", opacity: 0.5 }}>
            {user.email}
          </p>
        </div>

        <div className="flex gap-4 mb-8">
          <div
            className="flex-1 text-center"
            style={{
              background: "var(--parchment)",
              borderRadius: "8px",
              padding: "16px",
              boxShadow: "inset 0 0 0 1px rgba(26,22,18,0.12), 0 4px 12px rgba(0,0,0,0.4)",
            }}
          >
            <p className="font-mono font-bold text-3xl" style={{ color: "var(--ink)" }}>{stats.played}</p>
            <p className="font-serif" style={{ fontVariant: "small-caps", letterSpacing: "0.18em", fontSize: "11px", color: "var(--ink-soft)" }}>Games</p>
          </div>
          <div
            className="flex-1 text-center"
            style={{
              background: "var(--parchment)",
              borderRadius: "8px",
              padding: "16px",
              boxShadow: "inset 0 0 0 1px rgba(26,22,18,0.12), 0 4px 12px rgba(0,0,0,0.4)",
            }}
          >
            <p className="font-mono font-bold text-3xl" style={{ color: "var(--ink)" }}>{stats.finished}</p>
            <p className="font-serif" style={{ fontVariant: "small-caps", letterSpacing: "0.18em", fontSize: "11px", color: "var(--ink-soft)" }}>Finished</p>
          </div>
        </div>

        <h2
          className="font-serif font-semibold mb-3"
          style={{ fontVariant: "small-caps", letterSpacing: "0.14em", color: "var(--parchment)", opacity: 0.9 }}
        >
          Recent Games
        </h2>
        {games.length === 0 ? (
          <p className="font-sans text-sm" style={{ color: "var(--parchment)", opacity: 0.45 }}>
            No games yet. Go pillage!
          </p>
        ) : (
          <div className="space-y-2">
            {games.map((g) => (
              <a
                key={g.gameId}
                href={`/game/${g.gameId}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--parchment)",
                  borderRadius: "6px",
                  padding: "14px 16px",
                  boxShadow: "inset 0 0 0 1px rgba(26,22,18,0.12), 0 3px 8px rgba(0,0,0,0.35)",
                  textDecoration: "none",
                }}
              >
                <div>
                  <span
                    className="font-serif"
                    style={{
                      fontVariant: "small-caps",
                      letterSpacing: "0.14em",
                      fontSize: "10px",
                      padding: "2px 8px",
                      borderRadius: "999px",
                      marginRight: "8px",
                      background: g.mode === "digital" ? "var(--navy-mid)" : "var(--forest)",
                      color: "var(--parchment)",
                    }}
                  >
                    {g.mode === "digital" ? "Online" : "Score Tracker"}
                  </span>
                  <span className="font-mono" style={{ fontSize: "12px", color: "var(--ink)" }}>
                    {g.gameId}
                  </span>
                  <p className="font-sans" style={{ fontSize: "11px", color: "var(--ink-faint)", marginTop: "3px" }}>
                    {g.maxPlayers} players · {new Date(g.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className="font-serif"
                    style={{
                      fontVariant: "small-caps",
                      fontSize: "11px",
                      letterSpacing: "0.1em",
                      color: g.status === "finished" ? "var(--forest)" : g.status === "active" ? "var(--gold)" : "var(--ink-faint)",
                    }}
                  >
                    {g.status}
                  </span>
                  {g.finalScore !== 0 && (
                    <p className="font-mono font-bold" style={{ fontSize: "14px", color: "var(--ink)" }}>
                      {g.finalScore} pts
                    </p>
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
