import {
  emptyState,
  summarize,
  validState,
  estimateRatingChange,
  savedDupr,
} from "./model.js";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const key = "court-notes-v1";
let state = emptyState(),
  view = "sessions",
  selected = null,
  user = null,
  revision = 0,
  saving = false,
  refreshing = false,
  blocked = false;

const accountBar = document.createElement("div");
accountBar.className = "account-bar";
$("header").after(accountBar);

async function request(path, method = "GET", body) {
  const response = await fetch(`./api/${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(
      response.status === 404
        ? "The account API is unavailable. Stop the old server with Ctrl+C, run npm start again, then refresh this page."
        : "The server returned an unexpected response. Restart the app server and try again.",
    );
  }
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error || "Request failed."), {
      status: response.status,
    });
  return data;
}

function showAccount(message = "Saved to your account") {
  accountBar.innerHTML = user
    ? `<span>${esc(user.username)}</span><span role="status">${esc(message)}</span>`
    : "";
}

async function save() {
  if (saving || blocked || !user) return false;
  saving = true;
  document.body.classList.add("saving");
  $(".app").inert = true;
  $("#modal").inert = true;
  showAccount("Saving…");
  try {
    const result = await request("journal", "PUT", {
      state,
      revision,
      username: user.username,
    });
    revision = result.revision;
    showAccount();
    return true;
  } catch (error) {
    blocked = true;
    $("#modal").close();
    render();
    showAccount("Not saved — export a backup before reloading");
    alert(
      `${error.message}\nYour changes remain on this screen. Use the menu to export a backup, then reload to reconnect. Editing is paused to protect your journal.`,
    );
    return false;
  } finally {
    saving = false;
    document.body.classList.remove("saving");
    $(".app").inert = false;
    $("#modal").inert = false;
  }
}

function acceptJournal(data) {
  user = data.user;
  state = data.state;
  revision = data.revision;
  blocked = false;
  $("nav").hidden = false;
  $("nav").inert = false;
  showAccount();
  render();
}

function renderAuth(register = false, message = "") {
  user = null;
  state = emptyState();
  selected = null;
  showAccount();
  $("nav").hidden = true;
  $("#main").inert = false;
  $("#main").innerHTML =
    `<section class="auth-card"><div class="eyebrow">YOUR GAME. EVERY DEVICE.</div><h1>${register ? "Join the court." : "Welcome back."}</h1><p class="intro">Log in to keep your sessions, scores, and reflections together on your phone and computer.</p><form id="auth-form">${field("Username", "username", "", 'required minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]+" autocomplete="username" autocapitalize="none" spellcheck="false"')}${field("Password", "password", "", `type="password" required autocomplete="${register ? "new-password" : "current-password"}"`)}${register ? '<p class="form-help">Save your password somewhere safe; password recovery is not available yet.</p>' : ""}<p id="auth-error" class="auth-error" role="alert">${esc(message)}</p><button class="primary full">${register ? "Create account" : "Log in"}</button></form><button id="switch-auth" class="text-button full">${register ? "Already have an account? Log in" : "New here? Create an account"}</button></section>`;
  $("#switch-auth").onclick = () => renderAuth(!register);
  $("#auth-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    form.querySelector("button").disabled = true;
    $("#switch-auth").disabled = true;
    $("#auth-error").textContent = "";
    try {
      const result = await request(register ? "register" : "login", "POST", {
        username: data.get("username"),
        password: data.get("password"),
      });
      acceptJournal(result);
      offerLocalImport();
    } catch (error) {
      $("#auth-error").textContent = error.message;
      form.querySelector("button").disabled = false;
      $("#switch-auth").disabled = false;
    }
  };
}

function offerLocalImport() {
  let local;
  try {
    local = JSON.parse(localStorage.getItem(key));
  } catch {
    return;
  }
  if (
    !validState(local) ||
    (!local.sessions.length && !local.players.length) ||
    state.sessions.length ||
    state.players.length
  )
    return;
  modal(
    "Bring your games with you",
    `<p class="settings-copy">This browser has ${local.sessions.length} local sessions and ${local.players.length} players. Copy them to your new account? The original local copy will be kept.</p><button class="primary full">Import local journal</button>`,
    async () => {
      state = local;
      if (!(await save())) return;
      $("#modal").close();
      render();
      toast("Your local games are now in your account.");
    },
  );
}

async function refreshJournal() {
  if (document.activeElement?.closest("#dashboard-dupr")) return;
  if (
    !user ||
    saving ||
    refreshing ||
    blocked ||
    $("#modal").open ||
    document.hidden
  )
    return;
  refreshing = true;
  const startingRevision = revision;
  const startingUser = user.username;
  try {
    const data = await request("journal");
    if (
      !saving &&
      !blocked &&
      !$("#modal").open &&
      revision === startingRevision &&
      user?.username === startingUser
    ) {
      if (data.user.username !== user?.username) {
        location.reload();
        return;
      }
      if (data.revision !== revision) acceptJournal(data);
      else showAccount();
    }
  } catch (error) {
    if (error.status === 401 && !saving && !blocked && !$("#modal").open) {
      renderAuth(
        false,
        "Your session ended. Log in again to open your journal.",
      );
    } else {
      showAccount("Connection lost — reconnect before editing");
    }
  } finally {
    refreshing = false;
  }
}
const uid = () =>
    crypto.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
const date = (s) =>
  new Date(s + "T12:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 2500);
}
function modal(title, body, onSubmit) {
  $("#modal").innerHTML =
    `<form id="form"><div class="dialog-head"><h2>${title}</h2><button type="button" id="close" class="icon-button" aria-label="Close dialog">×</button></div>${body}</form>`;
  $("#close").onclick = () => $("#modal").close();
  $("#form").onsubmit = (e) => {
    e.preventDefault();
    onSubmit(new FormData(e.target));
  };
  $("#modal").showModal();
}
const field = (label, name, value = "", attrs = "") =>
  `<label>${label}<input name="${name}" value="${esc(value)}" ${attrs}></label>`;
function render() {
  if (!user) return;
  $("#main").inert = blocked;
  $("nav").inert = blocked;
  document
    .querySelectorAll("nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "sessions") renderSessions();
  if (view === "players") renderPlayers();
  if (view === "insights") renderInsights();
}
function renderSessions() {
  const session = state.sessions.find((s) => s.id === selected);
  if (session) {
    renderSession(session);
    return;
  }
  const all = state.sessions.flatMap((s) => s.games),
    stats = summarize(all);
  $("#main").innerHTML =
    `<div class="eyebrow">YOUR PICKLEBALL JOURNAL</div><div class="heading"><h1>More play.<br><span>More perspective.</span></h1></div><p class="intro">The score tells half the story. Remember the rest.</p><form id="dashboard-dupr" class="dupr-card"><div><label for="dashboard-dupr-input">My DUPR</label><p>Saved to your account. Used automatically for new games.</p></div><div class="dupr-controls"><input id="dashboard-dupr-input" name="myDupr" type="number" min="2" max="8" step="0.001" inputmode="decimal" required placeholder="3.50" value="${esc(savedDupr(state))}"><button class="primary" type="submit">Save</button></div></form><section class="hero"><div><div class="eyebrow">NEXT TIME YOU HIT THE COURT</div><h2>Play it. Log it.<br>Learn from it.</h2><p>One session. Every game. All the little things.</p><button id="new-session" class="primary">＋ Start a session</button></div><div class="court" aria-hidden="true"><div class="court-line"></div><div class="ball">●</div></div></section><div class="stats"><div><strong>${stats.played}</strong><span>games played</span></div><div><strong>${stats.wins}<small> / ${stats.losses}</small></strong><span>wins / losses</span></div><div><strong>${stats.rate}<small>%</small></strong><span>win rate</span></div></div><div class="section-heading"><h2>Your sessions <small>${state.sessions.length}</small></h2><span>Latest first</span></div><div class="session-list">${
      state.sessions.length
        ? [...state.sessions]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((s) => {
              const st = summarize(s.games);
              return `<button class="session-card" data-session="${esc(s.id)}"><span class="calendar">${new Date(s.date + "T12:00:00").toLocaleDateString(undefined, { month: "short" })}<strong>${new Date(s.date + "T12:00:00").getDate()}</strong></span><span class="session-info"><strong>${esc(s.name)}</strong><span>${esc(s.location || "Open play")} · ${st.played} games</span></span><span class="record">${st.wins}W <span>${st.losses}L</span><b>↗</b></span></button>`;
            })
            .join("")
        : `<div class="empty"><span class="empty-icon">▦</span><h3>Your next session starts here</h3><p>Add a session when you arrive, then log each game<br>while it’s still fresh.</p></div>`
    }</div><p class="footnote">A little reflection goes a long way. See you on the court.</p>`;
  $("#dashboard-dupr").onsubmit = async (event) => {
    event.preventDefault();
    state.myDupr = new FormData(event.target).get("myDupr");
    if (!(await save())) return;
    render();
    toast("Your DUPR is saved for future games.");
  };
  $("#new-session").onclick = () => sessionForm();
  document.querySelectorAll("[data-session]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.session;
        render();
      }),
  );
}
function sessionForm(s) {
  modal(
    s ? "Edit session" : "Start a session",
    `${field("Session name", "name", s?.name || "Open play", 'required maxlength="80"')}${field("Date", "date", s?.date || today(), 'type="date" required')}${field("Court / location", "location", s?.location || "", 'maxlength="120" placeholder="e.g. Riverside courts"')}<button class="primary full">${s ? "Save changes" : "Start session"}</button>`,
    async (f) => {
      const values = {
        name: f.get("name").trim(),
        date: f.get("date"),
        location: f.get("location").trim(),
      };
      if (!values.name) return;
      if (s) Object.assign(s, values);
      else {
        const item = { id: uid(), ...values, games: [] };
        state.sessions.push(item);
        selected = item.id;
      }
      if (!(await save())) return;
      $("#modal").close();
      render();
    },
  );
}
function renderSession(s) {
  const stats = summarize(s.games);
  $("#main").innerHTML =
    `<button class="back" id="back">← All sessions</button><div class="eyebrow">${esc(date(s.date))} · ${esc(s.location || "OPEN PLAY")}</div><div class="heading"><h1>${esc(s.name)}</h1><button id="edit-session" class="secondary">Edit</button></div><p class="intro">${stats.played} games · ${stats.wins} wins · ${stats.losses} losses</p><button class="primary full" id="add-game">＋ Log a game</button><div class="section-heading"><h2>The play-by-play</h2><span>Newest first</span></div>${
      s.games.length
        ? [...s.games]
            .reverse()
            .map(
              (g, i) =>
                `<article class="game"><div class="game-top"><span class="badge ${g.ours > g.theirs ? "win" : "loss"}">${g.ours > g.theirs ? "WIN" : "LOSS"}</span><span>GAME ${s.games.length - i} · ${g.mode.toUpperCase()}</span><button class="text-button" data-edit="${g.id}">Edit</button></div><div class="score"><div><span>Your team</span><strong>${g.ours}</strong></div><span class="dash">–</span><div><span>Opponents</span><strong>${g.theirs}</strong></div></div><p class="lineup">You${g.mode === "doubles" ? ` + ${playerLabel(g.players[0])}` : ""}<span>vs</span>${g.players
                  .slice(g.mode === "doubles" ? 1 : 0)
                  .map(playerLabel)
                  .join(
                    " + ",
                  )}</p>${ratingEstimate(g)}${g.good ? `<div class="note"><b>↗ What went well</b><p>${esc(g.good)}</p></div>` : ""}${g.improve ? `<div class="note"><b>↝ Work on next time</b><p>${esc(g.improve)}</p></div>` : ""}${g.notes ? `<div class="note"><b>Game notes</b><p>${esc(g.notes)}</p></div>` : ""}</article>`,
            )
            .join("")
        : '<div class="empty"><h3>A fresh court. A clean slate.</h3><p>Log your first game to start the story.</p></div>'
    }<button id="delete-session" class="danger">Delete session</button>`;
  $("#back").onclick = () => {
    selected = null;
    render();
  };
  $("#add-game").onclick = () => gameForm(s);
  $("#edit-session").onclick = () => sessionForm(s);
  document.querySelectorAll("[data-edit]").forEach(
    (b) =>
      (b.onclick = () =>
        gameForm(
          s,
          s.games.find((g) => g.id === b.dataset.edit),
        )),
  );
  $("#delete-session").onclick = async () => {
    if (confirm("Delete this session and all its games?")) {
      state.sessions = state.sessions.filter((x) => x.id !== s.id);
      selected = null;
      if (!(await save())) return;
      render();
    }
  };
}
function playerLabel(p) {
  return `${esc(p?.name || "Unknown")}${p?.dupr ? ` <small>(${esc(p.dupr)})</small>` : ""}`;
}
function ratingEstimate(game) {
  const myDupr = game.myDupr || savedDupr(state);
  const estimate = estimateRatingChange({ ...game, myDupr });
  if (!estimate)
    return '<div class="rating-estimate"><b>Estimated DUPR change</b><p>Enter your rating and every player’s rating to see a practice estimate.</p></div>';
  const change = Math.round(estimate.change * 1000) / 1000;
  return `<div class="rating-estimate"><b>Estimated DUPR change <strong>${change > 0 ? "+" : ""}${change.toFixed(3)}</strong></b><p>${Number(myDupr).toFixed(3)} → ${estimate.after.toFixed(3)}${!game.myDupr ? " · Using your saved DUPR" : ""} · Practice model only, not an official DUPR prediction.</p></div>`;
}
function duprForm(onSaved = () => {}) {
  modal(
    "Your DUPR",
    `${field("Your current DUPR", "myDupr", savedDupr(state), 'type="number" min="2" max="8" step="0.001" inputmode="decimal" required placeholder="3.50"')}<p class="form-help">Saved to your account and used automatically for new games. You can update it here when your official rating changes. Past games keep their original rating.</p><button class="primary full">Save DUPR</button>`,
    async (data) => {
      state.myDupr = data.get("myDupr");
      if (!(await save())) return;
      $("#modal").close();
      render();
      onSaved();
    },
  );
}
function gameForm(s, g) {
  const myDupr = g?.myDupr || savedDupr(state);
  if (!myDupr) {
    duprForm(() => gameForm(s, g));
    return;
  }
  const mode = g?.mode || "doubles";
  modal(
    g ? "Edit game" : "Log a game",
    `<label>Format<select name="mode" id="mode"><option value="doubles" ${mode === "doubles" ? "selected" : ""}>Doubles · 2 vs 2</option><option value="singles" ${mode === "singles" ? "selected" : ""}>Singles · 1 vs 1</option></select></label><div class="form-row">${field("Your score", "ours", g?.ours ?? "", 'type="number" min="0" max="999" required inputmode="numeric"')}${field("Opponent score", "theirs", g?.theirs ?? "", 'type="number" min="0" max="999" required inputmode="numeric"')}</div><p class="form-help">Your DUPR: <strong>${esc(myDupr)}</strong> - Saved rating. Update your current rating on the dashboard.</p><div id="lineup-fields"></div><div id="rating-preview" aria-live="polite"></div><datalist id="player-options">${state.players.map((p) => `<option value="${esc(p.name)}"></option>`).join("")}</datalist><label>What went well?<textarea name="good" placeholder="e.g. Patient dinks, deep returns…" maxlength="2000">${esc(g?.good || "")}</textarea></label><label>What could be better?<textarea name="improve" placeholder="e.g. Reset before speeding up…" maxlength="2000">${esc(g?.improve || "")}</textarea></label><label>Other game notes<textarea name="notes" placeholder="Anything you want to remember" maxlength="2000">${esc(g?.notes || "")}</textarea></label><button class="primary full">Save game</button>${g ? '<button type="button" id="delete-game" class="danger full">Delete game</button>' : ""}`,
    async (f) => {
      const ours = Number(f.get("ours")),
        theirs = Number(f.get("theirs"));
      if (ours === theirs) {
        toast("Enter a final score without a tie.");
        return;
      }
      const currentMode = f.get("mode"),
        count = currentMode === "doubles" ? 3 : 1,
        players = Array.from({ length: count }, (_, i) => ({
          name: f.get("p" + i).trim(),
          dupr: f.get("d" + i),
        }));
      if (players.some((p) => !p.name)) {
        toast("Please enter every player’s name.");
        return;
      }
      const values = {
        mode: currentMode,
        ours,
        theirs,
        players,
        myDupr,
        good: f.get("good").trim(),
        improve: f.get("improve").trim(),
        notes: f.get("notes").trim(),
      };
      if (!state.myDupr) state.myDupr = savedDupr(state) || myDupr;
      if (g) Object.assign(g, values);
      else s.games.push({ id: uid(), ...values });
      for (const p of players) {
        const existing = state.players.find(
          (x) => x.name.toLowerCase() === p.name.toLowerCase(),
        );
        if (existing) {
          if (p.dupr) existing.dupr = p.dupr;
        } else state.players.push({ id: uid(), ...p });
      }
      if (!(await save())) return;
      $("#modal").close();
      render();
      toast("Game saved. Keep playing.");
    },
  );
  const lineup = () => {
    const doubles = $("#mode").value === "doubles";
    $("#lineup-fields").innerHTML = Array.from(
      { length: doubles ? 3 : 1 },
      (_, i) => {
        const p = g?.mode === $("#mode").value ? g.players[i] : null;
        return `<div class="player-fields"><div class="form-row">${field(doubles && i === 0 ? "Your partner" : `Opponent ${doubles ? i : ""}`, "p" + i, p?.name || "", 'required maxlength="80" list="player-options" autocomplete="off"')}${field("DUPR (optional)", "d" + i, p?.dupr || "", 'type="number" min="2" max="8" step="0.001" inputmode="decimal" placeholder="3.50"')}</div></div>`;
      },
    ).join("");
    $("#lineup-fields")
      .querySelectorAll('[name^="p"]')
      .forEach((input) =>
        input.addEventListener("change", () => {
          const p = state.players.find(
            (p) => p.name.toLowerCase() === input.value.toLowerCase(),
          );
          if (p) $(`[name="d${input.name.slice(1)}"]`).value = p.dupr;
        }),
      );
  };
  const preview = () => {
    const data = new FormData($("#form"));
    const mode = data.get("mode");
    const count = mode === "doubles" ? 3 : 1;
    $("#rating-preview").innerHTML = ratingEstimate({
      mode,
      myDupr,
      ours: data.get("ours") === "" ? NaN : Number(data.get("ours")),
      theirs: data.get("theirs") === "" ? NaN : Number(data.get("theirs")),
      players: Array.from({ length: count }, (_, i) => ({
        dupr: data.get("d" + i),
      })),
    });
  };
  $("#mode").onchange = () => {
    lineup();
    preview();
  };
  $("#form").addEventListener("input", preview);
  $("#form").addEventListener("change", preview);
  lineup();
  preview();
  if (g)
    $("#delete-game").onclick = async () => {
      if (confirm("Delete this game?")) {
        s.games = s.games.filter((x) => x.id !== g.id);
        if (!(await save())) return;
        $("#modal").close();
        render();
      }
    };
}
function renderPlayers() {
  $("#main").innerHTML =
    `<div class="eyebrow">FAMILIAR FACES</div><div class="heading"><h1>Your court crew.</h1><button id="add-player" class="primary">＋ Add</button></div><p class="intro">Less typing between games. More time on court.</p><input id="search" type="search" placeholder="Search players" aria-label="Search players"><div id="players-list"></div><p class="footnote">DUPRs are manually entered references, not official ratings.</p>`;
  function list() {
    const term = $("#search").value.toLowerCase();
    $("#players-list").innerHTML =
      state.players
        .filter((p) => p.name.toLowerCase().includes(term))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
          (p) =>
            `<button class="session-card" data-player="${p.id}"><span class="avatar">${esc(p.name.charAt(0).toUpperCase())}</span><span class="session-info"><strong>${esc(p.name)}</strong><span>Player profile</span></span><span class="dupr">${esc(p.dupr || "—")}<small>DUPR</small></span></button>`,
        )
        .join("") ||
      '<div class="empty"><h3>No players yet</h3><p>Players you log in games appear here automatically.</p></div>';
    document
      .querySelectorAll("[data-player]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            playerForm(state.players.find((p) => p.id === b.dataset.player))),
      );
  }
  $("#search").oninput = list;
  $("#add-player").onclick = () => playerForm();
  list();
}
function playerForm(p) {
  modal(
    p ? "Edit player" : "Add player",
    `${field("Name", "name", p?.name || "", 'required maxlength="80"')}${field("DUPR (optional)", "dupr", p?.dupr || "", 'type="number" min="2" max="8" step="0.001" inputmode="decimal"')}<p class="form-help">Changes apply to future games. Past games keep the details recorded at the time.</p><button class="primary full">Save player</button>`,
    async (f) => {
      const name = f.get("name").trim();
      if (!name) return;
      if (
        state.players.some(
          (x) => x.id !== p?.id && x.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        toast("A player with this name already exists.");
        return;
      }
      const values = { name, dupr: f.get("dupr") };
      if (p) Object.assign(p, values);
      else state.players.push({ id: uid(), ...values });
      if (!(await save())) return;
      $("#modal").close();
      render();
    },
  );
}
function renderInsights() {
  const games = state.sessions.flatMap((s) => s.games),
    st = summarize(games);
  $("#main").innerHTML =
    `<div class="eyebrow">THE BIGGER PICTURE</div><h1>Every game adds up.</h1><p class="intro">A look at your play, and the lessons you’re collecting.</p><div class="stats"><div><strong>${st.played}</strong><span>games</span></div><div><strong>${st.rate}%</strong><span>win rate</span></div><div><strong>${state.sessions.length}</strong><span>sessions</span></div></div><div class="section-heading"><h2>Your reflections</h2></div>${
      [...state.sessions]
        .sort((a, b) => b.date.localeCompare(a.date))
        .flatMap((s) =>
          s.games
            .filter((g) => g.good || g.improve)
            .map(
              (g) =>
                `<article class="game"><div class="eyebrow">${esc(date(s.date))} · ${esc(s.name)}</div>${g.good ? `<div class="note"><b>↗ Keep doing</b><p>${esc(g.good)}</p></div>` : ""}${g.improve ? `<div class="note"><b>↝ Next time</b><p>${esc(g.improve)}</p></div>` : ""}</article>`,
            ),
        )
        .join("") ||
      '<div class="empty"><h3>Notice something. Write it down.</h3><p>Your game reflections will collect here.</p></div>'
    }`;
}
document.querySelectorAll("nav button").forEach(
  (b) =>
    (b.onclick = () => {
      view = b.dataset.view;
      selected = null;
      render();
      window.scrollTo(0, 0);
    }),
);
$("#settings").onclick = () => {
  if (!user) {
    toast("Log in to manage your journal and backups.");
    return;
  }
  modal(
    "Your journal, your data",
    `<p class="settings-copy">Signed in as <strong>${esc(user.username)}</strong>. Your journal is saved to your account on the server. Log in at the same website on another device to access it. An internet connection is required to load and save games.</p><p class="settings-copy">Your DUPR: <strong>${esc(savedDupr(state) || "Not set")}</strong></p><button type="button" class="secondary full" id="edit-dupr" ${blocked ? "disabled" : ""}>Update my DUPR</button><button type="button" class="secondary full" id="export">↓ Export backup</button><label class="import-label">Restore a backup<input type="file" id="import" accept="application/json,.json" ${blocked ? "disabled" : ""}></label><button type="button" class="secondary full" id="logout" ${blocked ? "disabled" : ""}>Log out</button><div class="install-note"><h3>Take it to the court</h3><p>On iPhone, open in Safari and choose Share → Add to Home Screen. On Android, choose Install app or Add to Home screen in your browser menu.</p><p>Phone installation requires HTTPS hosting. Open the same hosted address on both devices.</p></div>`,
    () => {},
  );
  $("#edit-dupr").onclick = () => {
    $("#modal").close();
    duprForm();
  };
  $("#logout").onclick = async () => {
    try {
      await request("logout", "POST", {});
      $("#modal").close();
      view = "sessions";
      renderAuth();
    } catch (error) {
      toast(error.message);
    }
  };
  $("#export").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `court-notes-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("#import").onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5000000) throw Error();
      const data = JSON.parse(await file.text());
      if (!validState(data)) throw Error();
      if (
        confirm(
          `Replace your journal with ${data.sessions.length} sessions and ${data.players.length} players from this backup? Export your current data first if needed.`,
        )
      ) {
        state = data;
        if (!(await save())) return;
        selected = null;
        $("#modal").close();
        render();
        toast("Backup restored.");
      }
    } catch {
      toast("This file is not a valid Court Notes backup.");
    }
  };
};
$("#main").innerHTML = '<p class="intro">Opening your journal...</p>';
$("nav").hidden = true;
try {
  acceptJournal(await request("journal"));
} catch (error) {
  renderAuth(
    false,
    error.status === 401
      ? ""
      : error.message ||
          "Could not reach the server. Check your connection and try logging in.",
  );
}
window.addEventListener("focus", refreshJournal);
setInterval(refreshJournal, 15000);
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});
