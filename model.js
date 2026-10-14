export const emptyState = () => ({ version: 1, sessions: [], players: [] });

export function savedDupr(state) {
  if (state.myDupr) return state.myDupr;
  const sessions = [...state.sessions].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  for (const session of sessions) {
    const game = [...session.games].reverse().find((game) => game.myDupr);
    if (game) return game.myDupr;
  }
  return "";
}

// An illustrative point-share model, not DUPR's proprietary calculation.
export function estimateRatingChange(game) {
  const rating = (value) =>
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 2 &&
    Number(value) <= 8;
  const count = game.mode === "doubles" ? 3 : game.mode === "singles" ? 1 : 0;
  if (
    !count ||
    !rating(game.myDupr) ||
    !Array.isArray(game.players) ||
    game.players.length !== count ||
    game.players.some((p) => !p || !rating(p.dupr)) ||
    !Number.isInteger(game.ours) ||
    !Number.isInteger(game.theirs) ||
    game.ours < 0 ||
    game.theirs < 0 ||
    game.ours === game.theirs
  )
    return null;
  const mine = Number(game.myDupr);
  const team = count === 3 ? (mine + Number(game.players[0].dupr)) / 2 : mine;
  const opponents =
    count === 3
      ? (Number(game.players[1].dupr) + Number(game.players[2].dupr)) / 2
      : Number(game.players[0].dupr);
  const expectedShare = 1 / (1 + 10 ** ((opponents - team) / 1.5));
  const actualShare = game.ours / (game.ours + game.theirs);
  const after = Math.max(
    2,
    Math.min(8, mine + 0.1 * (actualShare - expectedShare)),
  );
  return { change: after - mine, after, expectedShare, actualShare };
}
export function summarize(games) {
  const wins = games.filter((g) => g.ours > g.theirs).length;
  return {
    played: games.length,
    wins,
    losses: games.filter((g) => g.ours < g.theirs).length,
    rate: games.length ? Math.round((wins / games.length) * 100) : 0,
  };
}
export function validState(data) {
  const text = (value, max) => typeof value === "string" && value.length <= max;
  const id = (value) =>
    typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
  const dupr = (value) =>
    typeof value === "string" &&
    (value === "" ||
      (value.trim() !== "" &&
        Number.isFinite(Number(value)) &&
        Number(value) >= 2 &&
        Number(value) <= 8));
  const player = (p) =>
    p && text(p.name, 80) && p.name.trim().length > 0 && dupr(p.dupr);
  return (
    data?.version === 1 &&
    (data.myDupr === undefined || dupr(data.myDupr)) &&
    Array.isArray(data.sessions) &&
    Array.isArray(data.players) &&
    data.players.every((p) => p && id(p.id) && player(p)) &&
    data.sessions.every(
      (s) =>
        s &&
        id(s.id) &&
        text(s.name, 80) &&
        s.name.trim().length > 0 &&
        (s.location === undefined || text(s.location, 120)) &&
        typeof s.date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(s.date) &&
        Number.isFinite(Date.parse(s.date + "T12:00:00Z")) &&
        Array.isArray(s.games) &&
        s.games.every(
          (g) =>
            g &&
            id(g.id) &&
            ["singles", "doubles"].includes(g.mode) &&
            (g.myDupr === undefined || dupr(g.myDupr)) &&
            Number.isInteger(g.ours) &&
            g.ours >= 0 &&
            g.ours <= 999 &&
            Number.isInteger(g.theirs) &&
            g.theirs >= 0 &&
            g.theirs <= 999 &&
            g.ours !== g.theirs &&
            Array.isArray(g.players) &&
            g.players.length === (g.mode === "doubles" ? 3 : 1) &&
            g.players.every(player) &&
            text(g.good, 2000) &&
            text(g.improve, 2000) &&
            text(g.notes, 2000),
        ),
    )
  );
}
