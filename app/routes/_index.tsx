import { useState } from "react";
import { useNavigate } from "react-router";
import type { Route } from "./+types/_index";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import type { GameMode } from "~/domain/game-state";

export function meta() {
  return [
    { title: "Skull King" },
    { name: "description", content: "Play Skull King online with friends" },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  return { user: user ? { name: user.name, email: user.email } : null };
}

export default function Index({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [playerCount, setPlayerCount] = useState(4);
  const [gameMode, setGameMode] = useState<GameMode>("digital");

  const createGame = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxPlayers: playerCount, mode: gameMode }),
      });
      const { gameId } = (await res.json()) as { gameId: string };
      navigate(`/game/${gameId}`);
    } catch {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="absolute top-4 right-4 flex gap-3">
        {user ? (
          <>
            <a href="/profile" className="text-gray-300 hover:text-white text-sm">
              {user.name || user.email}
            </a>
            <a href="/logout" className="text-gray-500 hover:text-gray-300 text-sm">
              Logout
            </a>
          </>
        ) : (
          <>
            <a href="/login" className="text-gray-300 hover:text-white text-sm">
              Login
            </a>
            <a href="/signup" className="text-amber-400 hover:text-amber-300 text-sm font-medium">
              Sign Up
            </a>
          </>
        )}
      </div>

      {/* Hero */}
      <div className="text-center mb-10">
        <div className="text-6xl mb-3">💀</div>
        <h1 className="text-5xl font-bold text-white mb-3">Skull King</h1>
        <p className="text-gray-400 text-lg max-w-md">
          The swashbuckling trick-taking game — bid your tricks, plunder your
          enemies, and outwit the Skull King. Share a link to play anywhere.
        </p>
      </div>

      {/* Create Game */}
      <div className="bg-gray-900 rounded-2xl p-8 w-full max-w-sm border border-gray-800">
        <h2 className="text-white font-semibold text-xl mb-6">New Game</h2>

        {/* Mode selector */}
        <label className="text-gray-400 text-sm block mb-2">Game Mode</label>
        <div className="flex gap-2 mb-5">
          <button
            onClick={() => setGameMode("digital")}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
              gameMode === "digital"
                ? "bg-amber-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            Play Online
          </button>
          <button
            onClick={() => setGameMode("scorekeeper")}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
              gameMode === "scorekeeper"
                ? "bg-amber-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            Score Tracker
          </button>
        </div>
        <p className="text-gray-500 text-xs mb-5 -mt-3">
          {gameMode === "digital"
            ? "Full online game — cards dealt and played digitally"
            : "Physical cards at the table, phones for real-time scoring"}
        </p>

        {/* Player count */}
        <label className="text-gray-400 text-sm block mb-2">Players</label>
        <div className="flex gap-2 mb-6 flex-wrap">
          {[2, 3, 4, 5, 6, 7, 8].map((n) => (
            <button
              key={n}
              onClick={() => setPlayerCount(n)}
              className={`flex-1 min-w-[2.5rem] py-2 rounded-lg text-sm font-medium transition-colors ${
                playerCount === n
                  ? "bg-amber-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        <button
          onClick={createGame}
          disabled={creating}
          className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-lg transition-colors"
        >
          {creating ? "Creating..." : "Create Game"}
        </button>

        <p className="text-gray-500 text-xs text-center mt-4">
          You'll get a shareable link to send to your crew
        </p>
      </div>

      {/* Rules link */}
      <div className="mt-8 text-center">
        <a
          href="https://www.grandpabecksgames.com/pages/skull-king"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 hover:text-gray-300 text-sm underline"
        >
          How to play Skull King
        </a>
      </div>
    </div>
  );
}
