// ============================================================
// DRAW TOGETHER — Guess Mode Client
// ============================================================

// --- Constants ---
const CANVAS_W = 1280;
const CANVAS_H = 720;

// --- Persistent User ID ---
const userId = (() => {
  let id = localStorage.getItem("draw-together-uid");
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("draw-together-uid", id);
  }
  return id;
})();

// --- Socket ---
const socket = io();
let hasJoined = false;

// --- DOM ---
const board = document.getElementById("guess-board");
const ctx = board.getContext("2d");
const roomInput = document.getElementById("room-input");
const joinBtn = document.getElementById("join-btn");
const newRoomBtn = document.getElementById("new-room-btn");
const copyButton = document.getElementById("copy-link");
const presenceText = document.getElementById("presence");
const roomText = document.getElementById("room-code");
const modesWrap = document.getElementById("modes-wrap");
const modesBtn = document.getElementById("modes-btn");
const darkToggle = document.getElementById("dark-toggle");
const playerListEl = document.getElementById("player-list");
const gameSettingsEl = document.getElementById("game-settings");
const timeSelect = document.getElementById("time-select");
const roundsSelect = document.getElementById("rounds-select");
const startBtn = document.getElementById("start-btn");
const settingsInfo = document.getElementById("settings-info");
const wordDisplay = document.getElementById("word-display");
const timerDisplay = document.getElementById("timer-display");
const timerText = document.getElementById("timer-text");
const drawingIndicator = document.getElementById("drawing-indicator");
const drawingToolsEl = document.getElementById("drawing-tools");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const wordPickOverlay = document.getElementById("word-pick-overlay");
const wordOptionsEl = document.getElementById("word-options");
const pickTimerText = document.getElementById("pick-timer-text");
const roundResultOverlay = document.getElementById("round-result-overlay");
const roundResultTitle = document.getElementById("round-result-title");
const roundResultWord = document.getElementById("round-result-word");
const gameOverOverlay = document.getElementById("game-over-overlay");
const finalScoresEl = document.getElementById("final-scores");
const eraserBtn = document.getElementById("g-eraser-btn");
const undoBtn = document.getElementById("g-undo-btn");
const clearBtn = document.getElementById("g-clear-btn");
const customColorInput = document.getElementById("g-custom-color");
const diffBtns = document.querySelectorAll(".diff-btn");
const sizeBtns = document.querySelectorAll(".size-btn");
const swatches = document.querySelectorAll(".swatch");

// --- State ---
let roomId = "";
let myName = localStorage.getItem("draw-together-guess-name") || "";
let players = {};       // { odUserId: { name, score, connected, isDrawing } }
let turnOrder = [];
let isHost = false;
let gameStarted = false;
let amDrawer = false;
let currentWord = "";   // only set for drawer
let wordBlanks = "";    // blanks for guessers
let hasGuessedCorrectly = false;
let guessedPlayerIds = new Set();

// Drawing state
let drawing = false;
let lastPoint = null;
let activePointerId = null;
let currentColor = "#000000";
let currentSize = 5;
let erasing = false;
let strokeGroups = [];     // local undo: array of arrays of segments
let currentStroke = null;

// Settings
let settings = { timePerRound: 80, difficulty: "normal", maxRounds: 3 };

// ============================================================
// INITIALIZATION
// ============================================================
setupCanvas();
applyDarkMode();
setupRoom();
setupSocket();
setupUI();

// ============================================================
// CANVAS SETUP
// ============================================================
function setupCanvas() {
  board.width = CANVAS_W;
  board.height = CANVAS_H;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function clearCanvas() {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  strokeGroups = [];
  currentStroke = null;
}

// ============================================================
// ROOM MANAGEMENT
// ============================================================
function getRoomFromUrl() {
  const r = new URLSearchParams(window.location.search).get("room");
  return r ? r.trim().slice(0, 20) : "";
}

function generateRoomCode() {
  return Math.random().toString(36).slice(2, 8);
}

function setupRoom() {
  roomId = getRoomFromUrl() || localStorage.getItem("draw-together-room") || "";
  if (!roomId) roomId = generateRoomCode();
  applyRoom(roomId);
}

function applyRoom(code) {
  roomId = code;
  localStorage.setItem("draw-together-room", roomId);
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  window.history.replaceState({}, "", url);
  if (roomText) roomText.textContent = "Room: " + roomId;
  if (roomInput) roomInput.value = roomId;
  // Reset state
  players = {};
  turnOrder = [];
  gameStarted = false;
  amDrawer = false;
  hasGuessedCorrectly = false;
  guessedPlayerIds.clear();
  clearCanvas();
  hideAllOverlays();
  socket.emit("guess_join", { roomId, odUserId: userId, name: myName || "" });
  hasJoined = true;
}

// ============================================================
// SOCKET EVENTS
// ============================================================
function setupSocket() {
  socket.on("connect", () => {
    if (hasJoined && roomId) {
      socket.emit("guess_join", { roomId, odUserId: userId, name: myName || "" });
    }
  });

  // Full state sync
  socket.on("guess_state", (state) => {
    players = state.players || {};
    turnOrder = state.turnOrder || [];
    isHost = state.host === userId;
    gameStarted = state.gameStarted;
    settings = state.settings || settings;
    guessedPlayerIds = new Set(state.guessedPlayers || []);
    hasGuessedCorrectly = guessedPlayerIds.has(userId);

    applySettingsUI();
    renderPlayers();
    updateGameUI();

    // Replay drawing history
    if (state.drawHistory && state.drawHistory.length > 0) {
      clearCanvas();
      for (const seg of state.drawHistory) {
        drawSegmentLocal(seg, false);
      }
    }

    // If currently in word pick phase and I'm the drawer
    if (state.currentDrawer === userId && state.wordOptions && state.wordOptions.length > 0) {
      showWordPick(state.wordOptions, state.pickTimeRemaining || 10);
    }

    if (state.wordDisplay) {
      wordBlanks = state.wordDisplay;
      showWordDisplay(wordBlanks);
    }

    if (state.currentDrawer === userId && state.actualWord) {
      currentWord = state.actualWord;
      showWordDisplay(currentWord);
    }
  });

  // Player list update
  socket.on("guess_players", (data) => {
    players = data.players || {};
    turnOrder = data.turnOrder || [];
    isHost = data.host === userId;
    renderPlayers();
    updateStartButton();
  });

  // Settings update
  socket.on("guess_settings", (s) => {
    settings = s;
    applySettingsUI();
  });

  // Turn start — drawer gets word options
  socket.on("guess_turn_start", (data) => {
    hideAllOverlays();
    gameStarted = true;
    amDrawer = data.drawerId === userId;
    guessedPlayerIds.clear();
    hasGuessedCorrectly = false;
    currentWord = "";
    wordBlanks = "";
    clearCanvas();
    strokeGroups = [];

    updateGameUI();

    if (amDrawer && data.wordOptions) {
      showWordPick(data.wordOptions, 10);
    } else {
      addChatMessage(null, (data.drawerName || "Someone") + " is picking a word...", "system");
    }

    renderPlayers();
  });

  // Word picked → show blanks
  socket.on("guess_word_picked", (data) => {
    hideAllOverlays();
    wordBlanks = data.blanks;
    if (amDrawer) {
      currentWord = data.word;
      showWordDisplay(currentWord);
    } else {
      showWordDisplay(wordBlanks);
    }
    timerDisplay.style.display = "flex";
    drawingToolsEl.style.display = amDrawer ? "flex" : "none";
    board.classList.toggle("not-drawer", !amDrawer);
    chatInput.disabled = amDrawer;
    chatInput.placeholder = amDrawer ? "You are drawing!" : "Type your guess...";
  });

  // Drawing segments from others
  socket.on("guess_draw", (seg) => {
    drawSegmentLocal(seg, false);
  });

  // Canvas clear
  socket.on("guess_canvas_clear", () => {
    clearCanvas();
  });

  // Undo from drawer
  socket.on("guess_undo", (data) => {
    // Re-draw from history
    clearCanvas();
    if (data.drawHistory) {
      for (const seg of data.drawHistory) {
        drawSegmentLocal(seg, false);
      }
    }
  });

  // Timer tick
  socket.on("guess_timer", (data) => {
    timerText.textContent = data.time;
    timerDisplay.classList.toggle("urgent", data.time <= 10);
  });

  // Pick timer tick
  socket.on("guess_pick_timer", (data) => {
    if (pickTimerText) pickTimerText.textContent = data.time;
  });

  // Chat message
  socket.on("guess_chat", (msg) => {
    addChatMessage(msg.name, msg.text, msg.type || "normal");
  });

  // Correct guess
  socket.on("guess_correct", (data) => {
    guessedPlayerIds.add(data.odUserId);
    if (data.odUserId === userId) {
      hasGuessedCorrectly = true;
      chatInput.disabled = true;
      chatInput.placeholder = "You guessed it!";
    }
    addChatMessage(data.name, "guessed correctly!", "correct");
    // Update scores
    if (data.players) {
      players = data.players;
    }
    renderPlayers();
  });

  // Close guess (the guess was close)
  socket.on("guess_close", (data) => {
    addChatMessage(null, data.name + "'s guess is close!", "close");
  });

  // Round end
  socket.on("guess_round_end", (data) => {
    showRoundResult(data.word, data.reason);
    amDrawer = false;
    drawingToolsEl.style.display = "none";
    board.classList.add("not-drawer");
    timerDisplay.style.display = "none";
    if (data.players) {
      players = data.players;
      renderPlayers();
    }
  });

  // Game end
  socket.on("guess_game_end", (data) => {
    hideAllOverlays();
    showGameOver(data.players);
    gameStarted = false;
    amDrawer = false;
    drawingToolsEl.style.display = "none";
    board.classList.add("not-drawer");
    timerDisplay.style.display = "none";
    wordDisplay.classList.remove("visible");
    if (data.players) {
      players = data.players;
      renderPlayers();
    }
    gameSettingsEl.style.display = "flex";
    updateStartButton();
  });

  // Presence
  socket.on("guess_presence", (data) => {
    if (presenceText) {
      presenceText.textContent = data.count === 1
        ? "Just you — share the code!"
        : data.count + " players in lobby";
    }
  });
}

// ============================================================
// COORDINATE CONVERSION
// ============================================================
function getCanvasPoint(e) {
  const rect = board.getBoundingClientRect();
  const scaleX = CANVAS_W / rect.width;
  const scaleY = CANVAS_H / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

// ============================================================
// DRAWING
// ============================================================
function drawSegmentLocal(seg, addToGroup) {
  ctx.save();
  if (seg.erase) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#000";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = seg.color;
  }
  ctx.lineWidth = seg.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(seg.from.x * CANVAS_W, seg.from.y * CANVAS_H);
  ctx.lineTo(seg.to.x * CANVAS_W, seg.to.y * CANVAS_H);
  ctx.stroke();
  ctx.restore();

  if (addToGroup && currentStroke) {
    currentStroke.push(seg);
  }
}

function setupPointerHandlers() {
  board.addEventListener("pointerdown", onPointerDown);
  board.addEventListener("pointermove", onPointerMove);
  board.addEventListener("pointerup", onPointerUp);
  board.addEventListener("pointercancel", onPointerUp);
  board.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "touch" && drawing && e.pointerId === activePointerId) {
      finishStroke();
    }
  });
  board.addEventListener("contextmenu", (e) => e.preventDefault());
}

function onPointerDown(e) {
  if (!amDrawer) return;
  if (e.button !== 0) return;
  if (e.pointerType === "touch") e.preventDefault();
  try { board.setPointerCapture(e.pointerId); } catch {}
  drawing = true;
  activePointerId = e.pointerId;
  lastPoint = getCanvasPoint(e);
  currentStroke = [];
}

function onPointerMove(e) {
  if (!amDrawer || !drawing || e.pointerId !== activePointerId) return;
  if (e.pointerType === "touch") e.preventDefault();
  const pt = getCanvasPoint(e);
  const seg = {
    from: { x: lastPoint.x / CANVAS_W, y: lastPoint.y / CANVAS_H },
    to: { x: pt.x / CANVAS_W, y: pt.y / CANVAS_H },
    color: currentColor,
    size: currentSize,
    erase: erasing
  };
  drawSegmentLocal(seg, true);
  const isFirst = currentStroke && currentStroke.length === 1;
  socket.emit("guess_draw", { roomId, seg, strokeStart: isFirst });
  lastPoint = pt;
}

function onPointerUp(e) {
  if (!drawing || e.pointerId !== activePointerId) return;
  if (e.pointerType === "touch") e.preventDefault();
  try { board.releasePointerCapture(e.pointerId); } catch {}
  finishStroke();
}

function finishStroke() {
  drawing = false;
  lastPoint = null;
  activePointerId = null;
  if (currentStroke && currentStroke.length > 0) {
    strokeGroups.push(currentStroke);
  }
  currentStroke = null;
}

function handleUndo() {
  if (!amDrawer) return;
  if (strokeGroups.length === 0) return;
  strokeGroups.pop();
  socket.emit("guess_undo", { roomId });
}

// ============================================================
// PLAYER LIST RENDERING
// ============================================================
function renderPlayers() {
  playerListEl.innerHTML = "";
  const order = turnOrder.length > 0 ? turnOrder : Object.keys(players);

  for (const pid of order) {
    const p = players[pid];
    if (!p) continue;

    const item = document.createElement("div");
    item.className = "player-item";
    if (p.isDrawing) item.classList.add("is-drawing");
    if (guessedPlayerIds.has(pid)) item.classList.add("guessed-correct");
    if (!p.connected) item.classList.add("disconnected");

    // Score
    const scoreEl = document.createElement("span");
    scoreEl.className = "player-score";
    scoreEl.textContent = p.score || 0;
    item.appendChild(scoreEl);

    // Name wrap
    const nameWrap = document.createElement("div");
    nameWrap.className = "player-name-wrap";

    const nameSpan = document.createElement("span");
    nameSpan.className = "player-name";
    nameSpan.textContent = p.name || ("Player " + (order.indexOf(pid) + 1));
    nameWrap.appendChild(nameSpan);

    if (pid === userId) {
      const youBadge = document.createElement("span");
      youBadge.className = "player-you-badge";
      youBadge.textContent = "(You)";
      nameWrap.appendChild(youBadge);
    }

    if (p.isDrawing) {
      const drawBadge = document.createElement("span");
      drawBadge.className = "player-drawing-badge";
      drawBadge.textContent = "✏️";
      nameWrap.appendChild(drawBadge);
    }

    if (!p.connected) {
      const dcIcon = document.createElement("span");
      dcIcon.className = "player-dc-icon";
      dcIcon.textContent = "⚡";
      dcIcon.title = "Disconnected";
      nameWrap.appendChild(dcIcon);
    }

    item.appendChild(nameWrap);

    // Edit button (only for self)
    if (pid === userId) {
      const editBtn = document.createElement("button");
      editBtn.className = "player-edit-btn";
      editBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
      editBtn.title = "Edit name";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        startEditName(item, nameSpan, pid);
      });
      item.appendChild(editBtn);
    }

    playerListEl.appendChild(item);
  }
}

function startEditName(item, nameSpan, pid) {
  const currentName = players[pid]?.name || "";
  const input = document.createElement("input");
  input.className = "player-name-input";
  input.value = currentName;
  input.maxLength = 20;
  input.placeholder = "Your name";

  const nameWrap = nameSpan.parentElement;
  nameWrap.innerHTML = "";
  nameWrap.appendChild(input);
  input.focus();
  input.select();

  function saveName() {
    const newName = input.value.trim().slice(0, 20) || ("Player");
    myName = newName;
    localStorage.setItem("draw-together-guess-name", myName);
    socket.emit("guess_update_name", { roomId, odUserId: userId, name: myName });
    // Will re-render when guess_players event comes back
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveName();
    if (e.key === "Escape") renderPlayers();
  });
  input.addEventListener("blur", saveName);
}

// ============================================================
// SETTINGS UI
// ============================================================
function applySettingsUI() {
  timeSelect.value = settings.timePerRound;
  roundsSelect.value = settings.maxRounds;
  diffBtns.forEach(b => b.classList.toggle("active", b.dataset.diff === settings.difficulty));

  if (gameStarted) {
    gameSettingsEl.style.display = "none";
  } else {
    gameSettingsEl.style.display = "flex";
  }
  updateStartButton();
}

function updateStartButton() {
  const playerCount = Object.values(players).filter(p => p.connected).length;
  startBtn.disabled = !isHost || playerCount < 2 || gameStarted;
  if (!isHost) {
    settingsInfo.textContent = "Waiting for the host to start...";
  } else if (playerCount < 2) {
    settingsInfo.textContent = "Need at least 2 players";
  } else if (gameStarted) {
    settingsInfo.textContent = "Game in progress";
  } else {
    settingsInfo.textContent = "You are the host!";
  }

  // Only host can edit settings
  const canEdit = isHost && !gameStarted;
  timeSelect.disabled = !canEdit;
  roundsSelect.disabled = !canEdit;
  diffBtns.forEach(b => {
    b.disabled = !canEdit;
    b.style.pointerEvents = canEdit ? "auto" : "none";
    b.style.opacity = canEdit ? 1 : 0.6;
  });
}

function sendSettings() {
  if (!isHost) return;
  socket.emit("guess_update_settings", {
    roomId,
    settings: {
      timePerRound: parseInt(timeSelect.value, 10),
      difficulty: document.querySelector(".diff-btn.active")?.dataset.diff || "normal",
      maxRounds: parseInt(roundsSelect.value, 10)
    }
  });
}

// ============================================================
// GAME UI
// ============================================================
function updateGameUI() {
  // Show/hide settings
  if (gameStarted) {
    gameSettingsEl.style.display = "none";
  } else {
    gameSettingsEl.style.display = "flex";
  }

  // Drawing indicator
  const drawerId = Object.keys(players).find(pid => players[pid].isDrawing);
  if (drawerId && gameStarted) {
    const drawerName = players[drawerId]?.name || "Someone";
    if (drawerId === userId) {
      drawingIndicator.textContent = "You are drawing!";
      drawingIndicator.style.display = "block";
    } else {
      drawingIndicator.textContent = drawerName + " is drawing";
      drawingIndicator.style.display = "block";
    }
  } else {
    drawingIndicator.style.display = "none";
  }

  // Canvas interaction
  board.classList.toggle("not-drawer", !amDrawer);
  drawingToolsEl.style.display = amDrawer ? "flex" : "none";

  updateStartButton();
}

function showWordDisplay(text) {
  wordDisplay.textContent = text;
  wordDisplay.classList.add("visible");
}

function showWordPick(wordOptions, timeLeft) {
  hideAllOverlays();
  wordPickOverlay.style.display = "flex";
  wordOptionsEl.innerHTML = "";
  pickTimerText.textContent = timeLeft;

  for (const word of wordOptions) {
    const btn = document.createElement("button");
    btn.className = "word-option-btn";
    btn.textContent = word;
    btn.addEventListener("click", () => {
      socket.emit("guess_pick_word", { roomId, word });
      wordPickOverlay.style.display = "none";
    });
    wordOptionsEl.appendChild(btn);
  }
}

function showRoundResult(word, reason) {
  hideAllOverlays();
  roundResultOverlay.style.display = "flex";
  roundResultTitle.textContent = reason === "all_guessed" ? "Everyone guessed it!" : "Time's up!";
  roundResultWord.textContent = 'The word was: ' + word;
  setTimeout(() => { roundResultOverlay.style.display = "none"; }, 4000);
}

function showGameOver(playerData) {
  hideAllOverlays();
  gameOverOverlay.style.display = "flex";
  finalScoresEl.innerHTML = "";

  // Sort by score descending
  const sorted = Object.entries(playerData).sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
  for (const [pid, p] of sorted) {
    const row = document.createElement("div");
    row.className = "final-score-row";
    const name = document.createElement("span");
    name.textContent = (p.name || "Player") + (pid === userId ? " (You)" : "");
    const score = document.createElement("span");
    score.className = "score-val";
    score.textContent = (p.score || 0) + " pts";
    row.appendChild(name);
    row.appendChild(score);
    finalScoresEl.appendChild(row);
  }

  setTimeout(() => { gameOverOverlay.style.display = "none"; }, 8000);
}

function hideAllOverlays() {
  wordPickOverlay.style.display = "none";
  roundResultOverlay.style.display = "none";
  gameOverOverlay.style.display = "none";
}

// ============================================================
// CHAT
// ============================================================
function addChatMessage(name, text, type) {
  const msg = document.createElement("div");
  msg.className = "chat-msg";
  if (type === "system") msg.classList.add("system-msg");
  if (type === "correct") msg.classList.add("correct-msg");
  if (type === "close") msg.classList.add("close-msg");

  if (name) {
    const nameSpan = document.createElement("span");
    nameSpan.className = "chat-name";
    nameSpan.textContent = name + ":";
    msg.appendChild(nameSpan);
  }
  msg.appendChild(document.createTextNode(text));
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  if (amDrawer || hasGuessedCorrectly) return;
  chatInput.value = "";
  socket.emit("guess_chat", { roomId, odUserId: userId, text });
}

// ============================================================
// UI SETUP
// ============================================================
function setupUI() {
  setupPointerHandlers();

  // Room
  if (joinBtn) joinBtn.addEventListener("click", () => {
    const code = roomInput.value.trim();
    if (code) applyRoom(code);
  });
  if (roomInput) roomInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinBtn.click(); });
  if (newRoomBtn) newRoomBtn.addEventListener("click", () => applyRoom(generateRoomCode()));

  // Copy link
  if (copyButton) copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copyButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => {
        copyButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
      }, 1200);
    } catch { /* clipboard blocked */ }
  });

  // Modes
  if (modesBtn) modesBtn.addEventListener("click", () => modesWrap.classList.toggle("open"));
  document.getElementById("mode-normal-btn")?.addEventListener("click", () => switchMode("normal"));
  document.getElementById("mode-endless-btn")?.addEventListener("click", () => switchMode("endless"));
  document.getElementById("mode-guess-btn")?.addEventListener("click", () => modesWrap.classList.remove("open"));

  // Dark mode
  if (darkToggle) darkToggle.addEventListener("click", () => {
    const dark = !document.body.classList.contains("dark");
    localStorage.setItem("draw-dark-mode", dark ? "true" : "false");
    applyDarkMode();
  });

  // Settings
  timeSelect.addEventListener("change", sendSettings);
  roundsSelect.addEventListener("change", sendSettings);
  diffBtns.forEach(btn => btn.addEventListener("click", () => {
    diffBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    sendSettings();
  }));

  // Start game
  startBtn.addEventListener("click", () => {
    if (!isHost) return;
    socket.emit("guess_start", { roomId });
  });

  // Drawing tools — colors
  swatches.forEach(s => s.addEventListener("click", () => {
    swatches.forEach(sw => sw.classList.remove("active"));
    s.classList.add("active");
    currentColor = s.dataset.color;
    erasing = false;
    eraserBtn.classList.remove("active");
  }));

  customColorInput.addEventListener("input", () => {
    swatches.forEach(sw => sw.classList.remove("active"));
    currentColor = customColorInput.value;
    erasing = false;
    eraserBtn.classList.remove("active");
  });

  // Sizes
  sizeBtns.forEach(btn => btn.addEventListener("click", () => {
    sizeBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentSize = parseInt(btn.dataset.size, 10);
  }));

  // Eraser
  eraserBtn.addEventListener("click", () => {
    erasing = !erasing;
    eraserBtn.classList.toggle("active", erasing);
    if (erasing) {
      swatches.forEach(sw => sw.classList.remove("active"));
    } else {
      // Restore previous swatch
      const prev = document.querySelector(`.swatch[data-color="${currentColor}"]`);
      if (prev) prev.classList.add("active");
    }
  });

  // Undo
  undoBtn.addEventListener("click", handleUndo);

  // Clear
  clearBtn.addEventListener("click", () => {
    if (!amDrawer) return;
    clearCanvas();
    socket.emit("guess_canvas_clear", { roomId });
  });

  // Chat
  chatSend.addEventListener("click", sendChat);
  chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

  // Close popups
  document.addEventListener("click", (e) => {
    if (modesWrap && !modesWrap.contains(e.target)) modesWrap.classList.remove("open");
  });

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
    if ((e.ctrlKey || e.metaKey) && e.key === "z") { handleUndo(); e.preventDefault(); }
  });

  // Storage sync for dark mode
  window.addEventListener("storage", (e) => {
    if (e.key === "draw-dark-mode") applyDarkMode();
  });
}

function switchMode(mode) {
  const url = new URL(window.location.origin + (mode === "endless" ? "/page2.html" : mode === "guess" ? "/guess.html" : "/index.html"));
  url.searchParams.set("room", roomId);
  window.location.href = url.toString();
}

function applyDarkMode() {
  const setting = localStorage.getItem("draw-dark-mode");
  const dark = setting !== "false";
  document.body.classList.toggle("dark", dark);
  if (darkToggle) darkToggle.textContent = dark ? "\u2600\uFE0F" : "\uD83C\uDF19";
}
