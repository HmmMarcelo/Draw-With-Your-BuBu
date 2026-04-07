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

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

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

server.listen(PORT, () => {
  console.log(`Draw Together running on http://localhost:${PORT}`);
});
