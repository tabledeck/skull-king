import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { Route } from "./+types/_index";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import type { GameMode } from "~/domain/game-state";
import { BtnPrimary } from "~/components/tabledeck/BtnPrimary";
import { BtnSecondary } from "~/components/tabledeck/BtnSecondary";

export function meta() {
  return [
    { title: "Skull King Online — Free Multiplayer Trick-Taking Card Game" },
    { name: "description", content: "Play Skull King online free with 2–8 players. The swashbuckling trick-taking card game by Grandpa Beck's Games. No download — share a link and play instantly." },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Tabledeck" },
    { property: "og:title", content: "Skull King Online — Free Multiplayer Trick-Taking Card Game" },
    { property: "og:description", content: "Play Skull King online free with 2–8 players. No download — share a link and play instantly." },
    { property: "og:url", content: "https://skull.tabledeck.us" },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: "Skull King Online — Free Multiplayer Card Game" },
    { name: "twitter:description", content: "Play Skull King online free with 2–8 players. Share a link and play instantly." },
  ];
}

export const links: Route.LinksFunction = () => [
  { rel: "canonical", href: "https://skull.tabledeck.us" },
];

export async function loader({ context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  return { user: user ? { name: user.name, email: user.email } : null };
}

const PRESET_STORAGE_KEY = "tabledeck.skull-king.presets.v1";
const MAX_PRESETS = 8;
const GAME_KEY = "skull-king";

interface SkullKingPreset {
  id: string;
  name: string;
  playerCount: number;
  gameMode: GameMode;
  scoringStyle: "single" | "distributed";
  createdAt: number;
}

interface AccountSetupPreset {
  id: string;
  name: string;
  settings: unknown;
  createdAt: string;
  updatedAt: string;
}

function getAccountPresetEndpoint() {
  if (typeof window === "undefined") return "";
  const { hostname, protocol } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:3000/api/account/setup-presets";
  }
  if (hostname.endsWith(".tabledeck.us") || hostname === "tabledeck.us") {
    return "https://tabledeck.us/api/account/setup-presets";
  }
  return `${protocol}//${hostname}/api/account/setup-presets`;
}

function readPresets(): SkullKingPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(PRESET_STORAGE_KEY) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((preset): preset is SkullKingPreset => {
      const p = preset as Partial<SkullKingPreset>;
      return (
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        typeof p.playerCount === "number" &&
        p.playerCount >= 2 &&
        p.playerCount <= 8 &&
        (p.gameMode === "digital" || p.gameMode === "scorekeeper") &&
        (p.scoringStyle === "single" || p.scoringStyle === "distributed") &&
        typeof p.createdAt === "number"
      );
    });
  } catch {
    return [];
  }
}

function writePresets(presets: SkullKingPreset[]) {
  window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
}

function isPresetSettings(value: unknown): value is {
  playerCount: number;
  gameMode: GameMode;
  scoringStyle: "single" | "distributed";
} {
  if (!value || typeof value !== "object") return false;
  const settings = value as Record<string, unknown>;
  return (
    typeof settings.playerCount === "number" &&
    settings.playerCount >= 2 &&
    settings.playerCount <= 8 &&
    (settings.gameMode === "digital" || settings.gameMode === "scorekeeper") &&
    (settings.scoringStyle === "single" || settings.scoringStyle === "distributed")
  );
}

function fromAccountPreset(preset: AccountSetupPreset): SkullKingPreset | null {
  if (!isPresetSettings(preset.settings)) return null;
  return {
    id: preset.id,
    name: preset.name,
    playerCount: preset.settings.playerCount,
    gameMode: preset.settings.gameMode,
    scoringStyle: preset.settings.scoringStyle,
    createdAt:
      Date.parse(preset.updatedAt) ||
      Date.parse(preset.createdAt) ||
      Date.now(),
  };
}

function mergePresets(
  accountPresets: SkullKingPreset[],
  localPresets: SkullKingPreset[],
) {
  const byName = new Map<string, SkullKingPreset>();
  for (const preset of [...localPresets].reverse()) byName.set(preset.name, preset);
  for (const preset of [...accountPresets].reverse()) byName.set(preset.name, preset);
  return [...byName.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_PRESETS);
}

async function loadAccountPresets(): Promise<SkullKingPreset[]> {
  const endpoint = getAccountPresetEndpoint();
  if (!endpoint) return [];
  const response = await fetch(`${endpoint}?gameKey=${GAME_KEY}`, {
    credentials: "include",
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { presets?: AccountSetupPreset[] };
  return (body.presets ?? [])
    .map((preset) => fromAccountPreset(preset))
    .filter((preset): preset is SkullKingPreset => preset !== null);
}

async function saveAccountPreset(
  preset: SkullKingPreset,
): Promise<SkullKingPreset | null> {
  const endpoint = getAccountPresetEndpoint();
  if (!endpoint) return null;
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gameKey: GAME_KEY,
      name: preset.name,
      settings: {
        playerCount: preset.playerCount,
        gameMode: preset.gameMode,
        scoringStyle: preset.scoringStyle,
      },
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { preset?: AccountSetupPreset };
  return body.preset ? fromAccountPreset(body.preset) : null;
}

async function deleteAccountPreset(presetId: string) {
  const endpoint = getAccountPresetEndpoint();
  if (!endpoint) return;
  await fetch(`${endpoint}?id=${encodeURIComponent(presetId)}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export default function Index({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [playerCount, setPlayerCount] = useState(4);
  const [gameMode, setGameMode] = useState<GameMode>("digital");
  const [scoringStyle, setScoringStyle] = useState<"single" | "distributed">("single");
  const [presets, setPresets] = useState<SkullKingPreset[]>([]);
  const [presetName, setPresetName] = useState("");

  useEffect(() => {
    const localPresets = readPresets();
    setPresets(localPresets);
    loadAccountPresets()
      .then((accountPresets) => {
        if (accountPresets.length === 0) return;
        const merged = mergePresets(accountPresets, readPresets());
        writePresets(merged);
        setPresets(merged);
      })
      .catch(() => {
        // Local presets remain available when the account API is unreachable.
      });
  }, []);

  const savePreset = async () => {
    const localPreset: SkullKingPreset = {
      id: crypto.randomUUID(),
      name:
        presetName.trim() ||
        `${playerCount}-player ${gameMode === "digital" ? "online" : "score"} game`,
      playerCount,
      gameMode,
      scoringStyle,
      createdAt: Date.now(),
    };
    const accountPreset = await saveAccountPreset(localPreset).catch(() => null);
    const nextPreset = accountPreset ?? localPreset;
    const nextPresets = [
      nextPreset,
      ...presets.filter((preset) => preset.name !== nextPreset.name),
    ].slice(0, MAX_PRESETS);
    writePresets(nextPresets);
    setPresets(nextPresets);
    setPresetName("");
  };

  const applyPreset = (preset: SkullKingPreset) => {
    setPlayerCount(preset.playerCount);
    setGameMode(preset.gameMode);
    setScoringStyle(preset.scoringStyle);
  };

  const deletePreset = (presetId: string) => {
    const nextPresets = presets.filter((preset) => preset.id !== presetId);
    writePresets(nextPresets);
    setPresets(nextPresets);
    deleteAccountPreset(presetId).catch(() => {
      // The local delete already happened; account sync will retry on the next save.
    });
  };

  const createGame = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxPlayers: playerCount,
          mode: gameMode,
          scoringStyle: gameMode === "scorekeeper" ? scoringStyle : "distributed",
        }),
      });
      const { gameId } = (await res.json()) as { gameId: string };
      navigate(`/game/${gameId}`);
    } catch {
      setCreating(false);
    }
  };

  return (
    <div className="td-table min-h-screen flex flex-col items-center justify-center p-4 relative">
      {/* Nav */}
      <a
        href="https://tabledeck.us"
        className="absolute top-4 left-4 font-serif"
        style={{ fontVariant: "small-caps", letterSpacing: "0.18em", fontSize: "12px", color: "var(--parchment)", opacity: 0.55 }}
      >
        ← tabledeck.us
      </a>
      <div className="absolute top-4 right-4 flex gap-3 items-center">
        {user ? (
          <>
            <a href="/profile" className="font-sans text-sm" style={{ color: "var(--parchment)", opacity: 0.8 }}>
              {user.name || user.email}
            </a>
            <a href="/logout" className="font-sans text-sm" style={{ color: "var(--parchment)", opacity: 0.5 }}>
              Logout
            </a>
          </>
        ) : (
          <>
            <a href="/login" className="font-sans text-sm" style={{ color: "var(--parchment)", opacity: 0.75 }}>
              Login
            </a>
            <a href="/signup" className="font-sans text-sm font-semibold" style={{ color: "var(--gold-hi)" }}>
              Sign Up
            </a>
          </>
        )}
      </div>

      {/* Hero */}
      <div className="text-center mb-10">
        {/* Insignia wordmark */}
        <div className="td-wordmark justify-center mb-4">
          <svg className="td-insignia" viewBox="0 0 64 64" aria-hidden="true">
            <defs>
              <radialGradient id="lobby-gold-rg" cx="50%" cy="40%" r="55%">
                <stop offset="0%" stopColor="#e8c872" />
                <stop offset="55%" stopColor="#c9a24a" />
                <stop offset="100%" stopColor="#7f5a17" />
              </radialGradient>
            </defs>
            <g stroke="url(#lobby-gold-rg)" strokeWidth="2.4" strokeLinecap="round" fill="none">
              <line x1="10" y1="12" x2="54" y2="56" />
              <line x1="54" y1="12" x2="10" y2="56" />
              <circle cx="10" cy="12" r="2.5" fill="url(#lobby-gold-rg)" stroke="none" />
              <circle cx="54" cy="12" r="2.5" fill="url(#lobby-gold-rg)" stroke="none" />
            </g>
            <path d="M32 18c-10 0-16 7-16 15 0 4 2 7 4 9v4c0 2 1 3 3 3h3v-3h2v3h8v-3h2v3h3c2 0 3-1 3-3v-4c2-2 4-5 4-9 0-8-6-15-16-15z"
              fill="#f4e9d0" stroke="#1a1612" strokeWidth="1.4" />
            <circle cx="26" cy="34" r="3.2" fill="#1a1612" />
            <circle cx="38" cy="34" r="3.2" fill="#1a1612" />
            <path d="M29 42c1 1.5 2 2.5 3 2.5s2-1 3-2.5" stroke="#1a1612" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
          <div>
            <div className="td-name">Skull King</div>
            <div className="td-sub">Tabledeck · Multiplayer</div>
          </div>
        </div>
        <p
          className="font-sans text-lg max-w-md mx-auto"
          style={{ color: "var(--parchment)", opacity: 0.6 }}
        >
          The swashbuckling trick-taking game — bid your tricks, plunder your
          enemies, and outwit the Skull King. Share a link to play anywhere.
        </p>
      </div>

      {/* Create Game card */}
      <div className="td-lobby-card">
        <h2
          className="font-serif font-semibold text-xl mb-5"
          style={{ fontVariant: "small-caps", letterSpacing: "0.12em", color: "var(--ink)" }}
        >
          New Game
        </h2>

        {/* Mode selector */}
        <label className="td-input-label mb-2 block">Game Mode</label>
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setGameMode("digital")}
            className={`td-mode-chip ${gameMode === "digital" ? "td-mode-active" : ""}`}
          >
            Play Online
          </button>
          <button
            onClick={() => setGameMode("scorekeeper")}
            className={`td-mode-chip ${gameMode === "scorekeeper" ? "td-mode-active" : ""}`}
          >
            Score Tracker
          </button>
        </div>
        <p className="font-sans text-xs mb-5 -mt-2" style={{ color: "var(--ink-faint)" }}>
          {gameMode === "digital"
            ? "Full online game — cards dealt and played digitally"
            : "Physical cards at the table, phones for real-time scoring"}
        </p>

        {/* Scoring style (scorekeeper only) */}
        {gameMode === "scorekeeper" && (
          <>
            <label className="td-input-label mb-2 block">Who scores?</label>
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setScoringStyle("single")}
                className={`td-mode-chip ${scoringStyle === "single" ? "td-mode-active" : ""}`}
              >
                One scorer
              </button>
              <button
                onClick={() => setScoringStyle("distributed")}
                className={`td-mode-chip ${scoringStyle === "distributed" ? "td-mode-active" : ""}`}
              >
                Everyone scores
              </button>
            </div>
            <p className="font-sans text-xs mb-4 -mt-2" style={{ color: "var(--ink-faint)" }}>
              {scoringStyle === "single"
                ? "Host enters all names and scores for the whole table"
                : "Each player joins and enters their own bids and results"}
            </p>
          </>
        )}

        {/* Player count */}
        <label className="td-input-label mb-2 block">Players</label>
        <div className="td-bid-grid mb-6" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
          {[2, 3, 4, 5, 6, 7, 8].map((n) => (
            <button
              key={n}
              onClick={() => setPlayerCount(n)}
              className={`td-bid-chip ${playerCount === n ? "td-selected" : ""}`}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Saved setups */}
        <label className="td-input-label mb-2 block">Saved Setups</label>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Setup name"
            maxLength={32}
            className="td-input"
            style={{ flex: 1 }}
          />
          <BtnSecondary
            onClick={savePreset}
            type="button"
            style={{ padding: "7px 12px", flexShrink: 0 }}
          >
            Save
          </BtnSecondary>
        </div>

        {presets.length > 0 && (
          <div className="flex flex-col gap-2 mb-5">
            {presets.map((preset) => (
              <div
                key={preset.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "rgba(26,22,18,0.05)",
                  border: "1px solid rgba(26,22,18,0.1)",
                }}
              >
                <button
                  type="button"
                  onClick={() => applyPreset(preset)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: "none",
                    background: "transparent",
                    textAlign: "left",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <span
                    className="font-serif"
                    style={{
                      display: "block",
                      fontWeight: 600,
                      fontStyle: "italic",
                      fontSize: 14,
                      color: "var(--ink)",
                    }}
                  >
                    {preset.name}
                  </span>
                  <span
                    className="font-sans"
                    style={{
                      display: "block",
                      fontSize: 11,
                      color: "var(--ink-faint)",
                    }}
                  >
                    {preset.playerCount} players · {preset.gameMode === "digital" ? "Online" : "Score tracker"} · {preset.scoringStyle === "single" ? "One scorer" : "Everyone scores"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => deletePreset(preset.id)}
                  aria-label={`Delete ${preset.name}`}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--ink-faint)",
                    cursor: "pointer",
                    padding: "2px 4px",
                    fontSize: 16,
                    lineHeight: 1,
                  }}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        <BtnPrimary onClick={createGame} disabled={creating} fullWidth>
          {creating ? "Creating..." : "Create Game"}
        </BtnPrimary>

        <p className="font-sans text-xs text-center mt-4" style={{ color: "var(--ink-faint)" }}>
          You'll get a shareable link to send to your crew
        </p>
      </div>

      {/* Rules link */}
      <div className="mt-8 text-center">
        <a
          href="https://www.grandpabecksgames.com/pages/skull-king"
          target="_blank"
          rel="noopener noreferrer"
          className="font-serif underline"
          style={{ fontVariant: "small-caps", letterSpacing: "0.14em", fontSize: "12px", color: "var(--parchment)", opacity: 0.45 }}
        >
          How to play Skull King
        </a>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "VideoGame",
            name: "Skull King",
            description: "The swashbuckling trick-taking card game — bid your tricks, plunder your enemies, and outwit the Skull King.",
            url: "https://skull.tabledeck.us",
            genre: "Card Game",
            numberOfPlayers: { "@type": "QuantitativeValue", minValue: 2, maxValue: 8 },
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            publisher: { "@type": "Organization", name: "Tabledeck" },
          }),
        }}
      />
    </div>
  );
}
