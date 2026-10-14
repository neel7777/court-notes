import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyState,
  summarize,
  validState,
  estimateRatingChange,
  savedDupr,
} from "./model.js";

test("account DUPR takes precedence and old games provide a fallback", () => {
  const state = emptyState();
  assert.equal(savedDupr(state), "");
  state.sessions = [
    { date: "2026-10-13", games: [{ myDupr: "3.5" }, { myDupr: "3.6" }] },
  ];
  assert.equal(savedDupr(state), "3.6");
  state.myDupr = "4.0";
  assert.equal(savedDupr(state), "4.0");
  assert.equal(state.sessions[0].games[0].myDupr, "3.5");
  assert.ok(validState({ ...emptyState(), myDupr: "4.0" }));
  assert.equal(validState({ ...emptyState(), myDupr: "9.0" }), false);
});

test("practice estimates reflect margin, strength, and complete ratings", () => {
  const game = {
    mode: "singles",
    myDupr: "3.5",
    ours: 11,
    theirs: 9,
    players: [{ dupr: "3.5" }],
  };
  assert.ok(estimateRatingChange(game).change > 0);
  assert.ok(
    estimateRatingChange({ ...game, theirs: 0 }).change >
      estimateRatingChange(game).change,
  );
  assert.ok(
    estimateRatingChange({
      ...game,
      ours: 9,
      theirs: 11,
      players: [{ dupr: "4.5" }],
    }).change > 0,
  );
  assert.ok(
    estimateRatingChange({ ...game, players: [{ dupr: "2.5" }] }).change < 0,
  );
  assert.equal(estimateRatingChange({ ...game, myDupr: "" }), null);
  assert.equal(estimateRatingChange({ ...game, ours: 11, theirs: 11 }), null);
  assert.equal(estimateRatingChange({ ...game, mode: "doubles" }), null);
  const doubles = {
    ...game,
    mode: "doubles",
    players: [{ dupr: "3.5" }, { dupr: "3.5" }, { dupr: "3.5" }],
  };
  assert.equal(
    estimateRatingChange(doubles).change,
    estimateRatingChange(game).change,
  );
  assert.equal(
    estimateRatingChange({ ...game, myDupr: "8", theirs: 0 }).after,
    8,
  );
  assert.equal(
    estimateRatingChange({ ...game, myDupr: "2", ours: 0, theirs: 11 }).after,
    2,
  );
});
test("summaries count wins and losses across sessions", () => {
  assert.deepEqual(
    summarize([
      { ours: 11, theirs: 7 },
      { ours: 8, theirs: 11 },
      { ours: 15, theirs: 13 },
    ]),
    { played: 3, wins: 2, losses: 1, rate: 67 },
  );
  assert.equal(summarize([]).rate, 0);
});
test("backup validation rejects malformed games", () => {
  assert.ok(validState(emptyState()));
  assert.equal(
    validState({
      version: 1,
      players: [],
      sessions: [
        { id: "a", name: "Open play", date: "2026-10-13", games: [{}] },
      ],
    }),
    false,
  );
  assert.equal(validState({ version: 2, players: [], sessions: [] }), false);
});
