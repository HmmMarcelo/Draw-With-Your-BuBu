const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_ROOM_SIZE = 10;
const MAX_HISTORY = 50000;
const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 min — room data kept until this

// Room data: { history: [], inactivityTimer }
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { history: [], inactivityTimer: null });
  }
  return rooms.get(roomId);
}

function resetInactivityTimer(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.inactivityTimer) clearTimeout(room.inactivityTimer);
  room.inactivityTimer = setTimeout(() => {
    rooms.delete(roomId);
  }, INACTIVITY_TIMEOUT);
}

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  socket.on("join_room", (data) => {
    let roomId, sUserId, mode;
    if (typeof data === "string") {
      roomId = data;
      sUserId = socket.id;
      mode = "normal";
    } else {
      roomId = data.roomId;
      sUserId = data.userId || socket.id;
      mode = data.mode || "normal";
    }

    if (!roomId || typeof roomId !== "string") {
      socket.emit("join_error", "Invalid room code.");
      return;
    }

    // Leave previous room
    if (socket.data.roomId) {
      socket.leave(socket.data.roomId);
    }

    const ioRoom = io.sockets.adapter.rooms.get(roomId);
    const roomSize = ioRoom ? ioRoom.size : 0;

    if (roomSize >= MAX_ROOM_SIZE) {
      socket.emit("room_full");
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.odUserId = sUserId;
    socket.data.mode = mode;

    const room = getOrCreateRoom(roomId);
    resetInactivityTimer(roomId);

    // Send existing history filtered by mode
    const modeHistory = room.history.filter(h => h.mode === mode);
    if (modeHistory.length > 0) {
      socket.emit("draw_history", modeHistory);
    }

    io.to(roomId).emit("presence", {
      count: io.sockets.adapter.rooms.get(roomId)?.size || 1,
      max: MAX_ROOM_SIZE
    });
  });

  socket.on("draw_segment", (payload) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const entry = {
      ...payload,
      userId: socket.data.odUserId,
      mode: socket.data.mode
    };

    const room = getOrCreateRoom(roomId);
    room.history.push(entry);
    if (room.history.length > MAX_HISTORY) {
      room.history.splice(0, room.history.length - MAX_HISTORY);
    }
    resetInactivityTimer(roomId);

    socket.to(roomId).emit("draw_segment", entry);
  });

  socket.on("clear_canvas", (data) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const mode = (data && data.mode) || socket.data.mode || "normal";
    const cUserId = socket.data.odUserId;

    const room = rooms.get(roomId);
    if (room) {
      // Remove only this user's strokes for this mode
      room.history = room.history.filter(
        h => !(h.userId === cUserId && h.mode === mode)
      );
    }

    // Send remaining history for this mode to ALL in room so they re-render
    const remaining = room ? room.history.filter(h => h.mode === mode) : [];
    io.to(roomId).emit("history_refresh", { mode, history: remaining });
  });

  // ==========================================================
  // GUESS MODE
  // ==========================================================
  setupGuessHandlers(socket);

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    // Handle guess mode disconnect
    handleGuessDisconnect(socket, roomId);

    setTimeout(() => {
      const ioRoom = io.sockets.adapter.rooms.get(roomId);
      if (!ioRoom) {
        // Room empty — keep data alive behind inactivity timer
        resetInactivityTimer(roomId);
        return;
      }
      io.to(roomId).emit("presence", {
        count: ioRoom.size,
        max: MAX_ROOM_SIZE
      });
    }, 0);
  });
});

// =============================================================
// GUESS GAME — Word Lists
// =============================================================
const GUESS_WORDS = {
  easy: [
    "cat","dog","sun","moon","star","tree","house","car","fish","bird",
    "apple","ball","book","cake","chair","clock","cloud","cup","door","egg",
    "eye","fire","flower","grass","hand","hat","heart","key","lamp","leaf",
    "milk","mouse","nose","pen","rain","ring","shoe","smile","snow","sock",
    "spoon","table","train","water","window","baby","bed","bell","boat","bone",
    "bread","brush","candy","corn","drum","duck","flag","fork","frog","gift",
    "ice","juice","kite","lion","map","nest","orange","pig","queen","rope",
    "ship","tent","tooth","van","whale","wing","zoo","pizza","cookie","banana"
  ],
  normal: [
    "guitar","bicycle","elephant","rainbow","volcano","castle","dragon","pirate",
    "robot","jungle","compass","diamond","feather","garden","helmet","island",
    "jacket","kitchen","ladder","magnet","needle","octopus","parrot","puzzle",
    "rocket","sandwich","tornado","umbrella","whistle","zipper","anchor","balloon",
    "candle","dentist","envelope","fountain","giraffe","hammock","iceberg","juggler",
    "kangaroo","lantern","mermaid","necklace","penguin","scarecrow","telescope",
    "unicorn","windmill","yogurt","astronaut","butterfly","campfire","detective",
    "fireworks","goldfish","hurricane","igloo","jellyfish","lighthouse","mushroom",
    "notebook","parachute","quicksand","snowflake","treasure","waterfall","xylophone",
    "backpack","cactus","dolphin","excavator","flamingo","goalkeeper","headphones"
  ],
  hard: [
    "democracy","nostalgia","philosophy","sarcasm","awkward","betrayal","chaos",
    "dilemma","eclipse","freedom","gravity","happiness","illusion","jealousy",
    "knowledge","loneliness","mystery","nightmare","optimism","paradox","quarantine",
    "suspense","tension","uncertainty","velocity","wilderness","anxiety",
    "coincidence","destiny","evolution","frustration","generation","hierarchy",
    "imagination","justice","karma","labyrinth","manipulation","negotiation",
    "obsession","perspective","revolution","sacrifice","temptation","vulnerability",
    "wisdom","transformation","procrastination","claustrophobia","photosynthesis",
    "constellation","architecture","choreography","encryption","fibonacci",
    "biodiversity","equilibrium","hallucination","metamorphosis","propaganda",
    "silhouette","synchronize","translucent","ventriloquist","camouflage"
  ]
};

// =============================================================
// GUESS GAME — State
// =============================================================
const guessRooms = new Map();

function getOrCreateGuessRoom(roomId) {
  if (!guessRooms.has(roomId)) {
    guessRooms.set(roomId, {
      players: {},          // { odUserId: { name, score, connected, socketId } }
      host: null,
      turnOrder: [],
      settings: { timePerRound: 80, difficulty: "normal", maxRounds: 3 },
      gameStarted: false,
      currentRound: 0,      // which full cycle we're on (0-indexed)
      currentTurnIndex: 0,  // index into turnOrder for current drawer
      turnsPlayedThisRound: 0,
      currentWord: null,
      wordOptions: [],
      guessedPlayers: new Set(),
      drawHistory: [],
      strokeGroupBounds: [],
      roundTimer: null,
      pickTimer: null,
      timeRemaining: 0,
      pickTimeRemaining: 0,
      inactivityTimer: null
    });
  }
  return guessRooms.get(roomId);
}

function resetGuessInactivity(roomId) {
  const gr = guessRooms.get(roomId);
  if (!gr) return;
  if (gr.inactivityTimer) clearTimeout(gr.inactivityTimer);
  gr.inactivityTimer = setTimeout(() => {
    cleanupGuessRoom(roomId);
    guessRooms.delete(roomId);
  }, INACTIVITY_TIMEOUT);
}

function cleanupGuessRoom(roomId) {
  const gr = guessRooms.get(roomId);
  if (!gr) return;
  if (gr.roundTimer) clearInterval(gr.roundTimer);
  if (gr.pickTimer) clearInterval(gr.pickTimer);
  gr.roundTimer = null;
  gr.pickTimer = null;
}

function getRandomWords(difficulty, count) {
  count = count || 3;
  const list = GUESS_WORDS[difficulty] || GUESS_WORDS.normal;
  const shuffled = list.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function wordToBlanks(word) {
  return word.split("").map(ch => ch === " " ? "  " : "_").join(" ");
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function getConnectedPlayers(gr) {
  return Object.entries(gr.players).filter(([, p]) => p.connected);
}

function getPlayersObj(gr) {
  const out = {};
  for (const [uid, p] of Object.entries(gr.players)) {
    out[uid] = {
      name: p.name,
      score: p.score,
      connected: p.connected,
      isDrawing: gr.gameStarted && gr.turnOrder[gr.currentTurnIndex] === uid && gr.currentWord !== null
    };
  }
  return out;
}

function broadcastPlayers(roomId) {
  const gr = guessRooms.get(roomId);
  if (!gr) return;
  io.to("guess_" + roomId).emit("guess_players", {
    players: getPlayersObj(gr),
    turnOrder: gr.turnOrder,
    host: gr.host
  });
}

function broadcastPresence(roomId) {
  const gr = guessRooms.get(roomId);
  if (!gr) return;
  const count = getConnectedPlayers(gr).length;
  io.to("guess_" + roomId).emit("guess_presence", { count });
}

// =============================================================
// GUESS GAME — Turn Logic
// =============================================================
function startNextTurn(roomId) {
  const gr = guessRooms.get(roomId);
  if (!gr || !gr.gameStarted) return;

  // Check if round is over (everyone has drawn)
  if (gr.turnsPlayedThisRound >= gr.turnOrder.length) {
    gr.currentRound++;
    gr.turnsPlayedThisRound = 0;
    gr.currentTurnIndex = 0;

    if (gr.currentRound >= gr.settings.maxRounds) {
      endGame(roomId);
      return;
    }
  }

  // Find next connected drawer
  let attempts = 0;
  while (attempts < gr.turnOrder.length) {
    const drawerId = gr.turnOrder[gr.currentTurnIndex];
    const drawer = gr.players[drawerId];
    if (drawer && drawer.connected) break;
    gr.currentTurnIndex = (gr.currentTurnIndex + 1) % gr.turnOrder.length;
    gr.turnsPlayedThisRound++;
    attempts++;
    if (gr.turnsPlayedThisRound >= gr.turnOrder.length) {
      gr.currentRound++;
      gr.turnsPlayedThisRound = 0;
      if (gr.currentRound >= gr.settings.maxRounds) {
        endGame(roomId);
        return;
      }
    }
  }

  if (attempts >= gr.turnOrder.length) {
    // No connected players to draw
    endGame(roomId);
    return;
  }

  const drawerId = gr.turnOrder[gr.currentTurnIndex];
  const drawer = gr.players[drawerId];

  // Reset turn state
  gr.currentWord = null;
  gr.wordOptions = getRandomWords(gr.settings.difficulty, 3);
  gr.guessedPlayers = new Set();
  gr.drawHistory = [];
  gr.strokeGroupBounds = [];  // indexes where each stroke group starts
  gr.timeRemaining = gr.settings.timePerRound;
  gr.pickTimeRemaining = 10;

  // Broadcast turn start
  io.to("guess_" + roomId).emit("guess_turn_start", {
    drawerId,
    drawerName: drawer.name,
    wordOptions: null // Only sent to drawer below
  });

  // Send word options only to drawer's socket
  const drawerSocket = findSocketByUserId(roomId, drawerId);
  if (drawerSocket) {
    drawerSocket.emit("guess_turn_start", {
      drawerId,
      drawerName: drawer.name,
      wordOptions: gr.wordOptions
    });
  }

  broadcastPlayers(roomId);

  // Start pick timer
  if (gr.pickTimer) clearInterval(gr.pickTimer);
  gr.pickTimer = setInterval(() => {
    gr.pickTimeRemaining--;
    io.to("guess_" + roomId).emit("guess_pick_timer", { time: gr.pickTimeRemaining });
    if (gr.pickTimeRemaining <= 0) {
      clearInterval(gr.pickTimer);
      gr.pickTimer = null;
      // Auto-pick first word
      if (!gr.currentWord && gr.wordOptions.length > 0) {
        pickWord(roomId, gr.wordOptions[0]);
      }
    }
  }, 1000);
}

function pickWord(roomId, word) {
  const gr = guessRooms.get(roomId);
  if (!gr || !gr.gameStarted) return;

  // Validate word is from options
  if (!gr.wordOptions.includes(word)) return;

  gr.currentWord = word;
  if (gr.pickTimer) { clearInterval(gr.pickTimer); gr.pickTimer = null; }

  const blanks = wordToBlanks(word);
  const drawerId = gr.turnOrder[gr.currentTurnIndex];

  // Send blanks to everyone, word to drawer
  io.to("guess_" + roomId).emit("guess_word_picked", { blanks, word: null });
  const drawerSocket = findSocketByUserId(roomId, drawerId);
  if (drawerSocket) {
    drawerSocket.emit("guess_word_picked", { blanks, word });
  }

  broadcastPlayers(roomId);

  // Start round timer
  if (gr.roundTimer) clearInterval(gr.roundTimer);
  gr.roundTimer = setInterval(() => {
    gr.timeRemaining--;
    io.to("guess_" + roomId).emit("guess_timer", { time: gr.timeRemaining });
    if (gr.timeRemaining <= 0) {
      endTurn(roomId, "time_up");
    }
  }, 1000);
}

function endTurn(roomId, reason) {
  const gr = guessRooms.get(roomId);
  if (!gr) return;

  if (gr.roundTimer) { clearInterval(gr.roundTimer); gr.roundTimer = null; }
  if (gr.pickTimer) { clearInterval(gr.pickTimer); gr.pickTimer = null; }

  const word = gr.currentWord || "(no word)";

  io.to("guess_" + roomId).emit("guess_round_end", {
    word,
    reason,
    players: getPlayersObj(gr)
  });

  gr.currentWord = null;
  gr.turnsPlayedThisRound++;
  gr.currentTurnIndex = (gr.currentTurnIndex + 1) % gr.turnOrder.length;

  // Next turn after a delay
  setTimeout(() => startNextTurn(roomId), 4500);
}

function endGame(roomId) {
  const gr = guessRooms.get(roomId);
  if (!gr) return;

  cleanupGuessRoom(roomId);
  gr.gameStarted = false;
  gr.currentRound = 0;
  gr.currentTurnIndex = 0;
  gr.turnsPlayedThisRound = 0;
  gr.currentWord = null;
  gr.drawHistory = [];

  io.to("guess_" + roomId).emit("guess_game_end", {
    players: getPlayersObj(gr)
  });

  broadcastPlayers(roomId);
  resetGuessInactivity(roomId);
}

function findSocketByUserId(roomId, odUserId) {
  const sockRoom = io.sockets.adapter.rooms.get("guess_" + roomId);
  if (!sockRoom) return null;
  for (const sid of sockRoom) {
    const s = io.sockets.sockets.get(sid);
    if (s && s.data.guessUserId === odUserId) return s;
  }
  return null;
}

// =============================================================
// GUESS GAME — Socket Handlers
// =============================================================
function setupGuessHandlers(socket) {

  socket.on("guess_join", (data) => {
    if (!data || !data.roomId || typeof data.roomId !== "string") return;
    const roomId = data.roomId.trim().slice(0, 20);
    const odUserId = data.odUserId || socket.id;
    const name = (data.name || "").trim().slice(0, 20);

    // Leave previous guess room
    if (socket.data.guessRoomId) {
      socket.leave("guess_" + socket.data.guessRoomId);
    }

    socket.join("guess_" + roomId);
    socket.data.guessRoomId = roomId;
    socket.data.guessUserId = odUserId;

    const gr = getOrCreateGuessRoom(roomId);
    resetGuessInactivity(roomId);

    // Register or reconnect player
    if (gr.players[odUserId]) {
      // Reconnect
      gr.players[odUserId].connected = true;
      gr.players[odUserId].socketId = socket.id;
      if (name) gr.players[odUserId].name = name;
    } else {
      // New player
      const playerNum = Object.keys(gr.players).length + 1;
      gr.players[odUserId] = {
        name: name || ("Player " + playerNum),
        score: 0,
        connected: true,
        socketId: socket.id
      };
      // Add to turn order
      if (!gr.turnOrder.includes(odUserId)) {
        gr.turnOrder.push(odUserId);
      }
    }

    // Set host if none
    if (!gr.host || !gr.players[gr.host] || !gr.players[gr.host].connected) {
      gr.host = odUserId;
    }

    // Send full state to joining player
    const drawerId = gr.turnOrder[gr.currentTurnIndex];
    const statePayload = {
      players: getPlayersObj(gr),
      turnOrder: gr.turnOrder,
      host: gr.host,
      settings: gr.settings,
      gameStarted: gr.gameStarted,
      guessedPlayers: [...gr.guessedPlayers],
      drawHistory: gr.drawHistory,
      wordDisplay: gr.currentWord ? wordToBlanks(gr.currentWord) : null,
      currentDrawer: drawerId
    };

    // If this player is the current drawer, send word + options
    if (drawerId === odUserId) {
      statePayload.actualWord = gr.currentWord;
      if (!gr.currentWord && gr.wordOptions && gr.wordOptions.length > 0) {
        statePayload.wordOptions = gr.wordOptions;
        statePayload.pickTimeRemaining = gr.pickTimeRemaining;
      }
    }

    socket.emit("guess_state", statePayload);
    broadcastPlayers(roomId);
    broadcastPresence(roomId);
  });

  socket.on("guess_update_name", (data) => {
    if (!data || !data.roomId) return;
    const gr = guessRooms.get(data.roomId);
    if (!gr) return;
    const odUserId = data.odUserId || socket.data.guessUserId;
    if (gr.players[odUserId]) {
      gr.players[odUserId].name = (data.name || "").trim().slice(0, 20) || gr.players[odUserId].name;
    }
    broadcastPlayers(data.roomId);
  });

  socket.on("guess_update_settings", (data) => {
    if (!data || !data.roomId || !data.settings) return;
    const gr = guessRooms.get(data.roomId);
    if (!gr) return;
    const odUserId = socket.data.guessUserId;
    if (gr.host !== odUserId) return; // Only host
    if (gr.gameStarted) return;

    const s = data.settings;
    if (s.timePerRound) gr.settings.timePerRound = Math.max(10, Math.min(300, parseInt(s.timePerRound, 10) || 80));
    if (s.difficulty && ["easy", "normal", "hard"].includes(s.difficulty)) gr.settings.difficulty = s.difficulty;
    if (s.maxRounds) gr.settings.maxRounds = Math.max(1, Math.min(20, parseInt(s.maxRounds, 10) || 3));

    io.to("guess_" + data.roomId).emit("guess_settings", gr.settings);
  });

  socket.on("guess_start", (data) => {
    if (!data || !data.roomId) return;
    const gr = guessRooms.get(data.roomId);
    if (!gr) return;
    const odUserId = socket.data.guessUserId;
    if (gr.host !== odUserId) return;
    if (gr.gameStarted) return;

    const connected = getConnectedPlayers(gr);
    if (connected.length < 2) return;

    // Reset scores
    for (const uid of Object.keys(gr.players)) {
      gr.players[uid].score = 0;
    }

    // Build turn order from connected players
    gr.turnOrder = connected.map(([uid]) => uid);
    gr.gameStarted = true;
    gr.currentRound = 0;
    gr.currentTurnIndex = 0;
    gr.turnsPlayedThisRound = 0;

    broadcastPlayers(data.roomId);
    startNextTurn(data.roomId);
  });

  socket.on("guess_pick_word", (data) => {
    if (!data || !data.roomId || !data.word) return;
    const gr = guessRooms.get(data.roomId);
    if (!gr || !gr.gameStarted) return;
    const odUserId = socket.data.guessUserId;
    const drawerId = gr.turnOrder[gr.currentTurnIndex];
    if (odUserId !== drawerId) return;
    if (gr.currentWord) return; // Already picked

    pickWord(data.roomId, data.word);
  });

  socket.on("guess_draw", (data) => {
    if (!data || !data.roomId || !data.seg) return;
    const gr = guessRooms.get(data.roomId);
    if (!gr || !gr.gameStarted || !gr.currentWord) return;
    const odUserId = socket.data.guessUserId;
    const drawerId = gr.turnOrder[gr.currentTurnIndex];
    if (odUserId !== drawerId) return;

    // Track stroke group start
    if (data.strokeStart) {
      gr.strokeGroupBounds.push(gr.drawHistory.length);
    }

    gr.drawHistory.push(data.seg);
    // Cap draw history
    if (gr.drawHistory.length > 10000) gr.drawHistory.splice(0, gr.drawHistory.length - 10000);

    socket.to("guess_" + data.roomId).emit("guess_draw", data.seg);
  });

  socket.on("guess_canvas_clear", (data) => {
    if (!data || !data.roomId) return;
    const gr = guessRooms.get(data.roomId);
    if (!gr || !gr.gameStarted) return;
    const odUserId = socket.data.guessUserId;
    const drawerId = gr.turnOrder[gr.currentTurnIndex];
    if (odUserId !== drawerId) return;

    gr.drawHistory = [];
    socket.to("guess_" + data.roomId).emit("guess_canvas_clear");
  });

  socket.on("guess_undo", (data) => {
    if (!data || !data.roomId) return;
    const gr = guessRooms.get(data.roomId);
    if (!gr || !gr.gameStarted) return;
    const odUserId = socket.data.guessUserId;
    const drawerId = gr.turnOrder[gr.currentTurnIndex];
    if (odUserId !== drawerId) return;

    if (gr.strokeGroupBounds.length > 0) {
      const lastGroupStart = gr.strokeGroupBounds.pop();
      gr.drawHistory.splice(lastGroupStart);
    } else if (gr.drawHistory.length > 0) {
      gr.drawHistory = [];
    }
    io.to("guess_" + data.roomId).emit("guess_undo", { drawHistory: gr.drawHistory });
  });

  socket.on("guess_chat", (data) => {
    if (!data || !data.roomId || !data.text) return;
    const gr = guessRooms.get(data.roomId);
    if (!gr) return;
    const odUserId = data.odUserId || socket.data.guessUserId;
    const player = gr.players[odUserId];
    if (!player) return;

    // Sanitize
    const text = String(data.text).trim().slice(0, 100);
    if (!text) return;

    // Don't allow drawer to chat during their turn
    const drawerId = gr.turnOrder[gr.currentTurnIndex];
    if (gr.gameStarted && gr.currentWord && odUserId === drawerId) return;

    // Don't allow players who already guessed to chat
    if (gr.guessedPlayers.has(odUserId)) return;

    // Check if game is active and there's a word to guess
    if (gr.gameStarted && gr.currentWord) {
      const guess = text.toLowerCase().trim();
      const word = gr.currentWord.toLowerCase().trim();

      if (guess === word) {
        // Correct guess!
        gr.guessedPlayers.add(odUserId);
        player.score = (player.score || 0) + 1;

        io.to("guess_" + data.roomId).emit("guess_correct", {
          odUserId,
          name: player.name,
          players: getPlayersObj(gr)
        });

        broadcastPlayers(data.roomId);

        // Check if all non-drawer guessers have guessed
        const nonDrawerConnected = getConnectedPlayers(gr).filter(([uid]) => uid !== drawerId);
        const allGuessed = nonDrawerConnected.every(([uid]) => gr.guessedPlayers.has(uid));
        if (allGuessed) {
          endTurn(data.roomId, "all_guessed");
        }
        return;
      }

      // Check if close guess
      if (word.length > 3 && levenshtein(guess, word) <= 2 && levenshtein(guess, word) > 0) {
        socket.emit("guess_close", { name: player.name });
        // Still show the message (but not the word)
      }
    }

    // Broadcast as normal chat
    io.to("guess_" + data.roomId).emit("guess_chat", {
      name: player.name,
      text,
      type: "normal"
    });
  });
}

// =============================================================
// GUESS GAME — Disconnect Handler
// =============================================================
function handleGuessDisconnect(socket, roomId) {
  const guessRoomId = socket.data.guessRoomId;
  if (!guessRoomId) return;

  const gr = guessRooms.get(guessRoomId);
  if (!gr) return;

  const odUserId = socket.data.guessUserId;
  if (gr.players[odUserId]) {
    gr.players[odUserId].connected = false;
  }

  broadcastPlayers(guessRoomId);
  broadcastPresence(guessRoomId);

  // If the disconnected player was the current drawer, skip turn
  if (gr.gameStarted && gr.currentWord) {
    const drawerId = gr.turnOrder[gr.currentTurnIndex];
    if (drawerId === odUserId) {
      endTurn(guessRoomId, "drawer_left");
      return;
    }
  }

  // If drawer was picking a word
  if (gr.gameStarted && !gr.currentWord) {
    const drawerId = gr.turnOrder[gr.currentTurnIndex];
    if (drawerId === odUserId) {
      if (gr.pickTimer) { clearInterval(gr.pickTimer); gr.pickTimer = null; }
      gr.turnsPlayedThisRound++;
      gr.currentTurnIndex = (gr.currentTurnIndex + 1) % gr.turnOrder.length;
      setTimeout(() => startNextTurn(guessRoomId), 1000);
      return;
    }
  }

  // Check if only 1 or 0 connected players remain → end game
  const connected = getConnectedPlayers(gr);
  if (connected.length < 2 && gr.gameStarted) {
    endGame(guessRoomId);
    return;
  }

  // If all remaining guessers have guessed, end turn
  if (gr.gameStarted && gr.currentWord) {
    const drawerId = gr.turnOrder[gr.currentTurnIndex];
    const nonDrawerConnected = connected.filter(([uid]) => uid !== drawerId);
    if (nonDrawerConnected.length > 0) {
      const allGuessed = nonDrawerConnected.every(([uid]) => gr.guessedPlayers.has(uid));
      if (allGuessed) endTurn(guessRoomId, "all_guessed");
    }
  }

  // Reassign host if needed
  if (gr.host === odUserId) {
    const newHost = connected.find(([uid]) => uid !== odUserId);
    gr.host = newHost ? newHost[0] : null;
    broadcastPlayers(guessRoomId);
  }

  resetGuessInactivity(guessRoomId);
}

server.listen(PORT, () => {
  console.log(`Draw Together running on http://localhost:${PORT}`);
});
