const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_ROOM_SIZE = 10;
const MAX_HISTORY = 50000; // max segments stored per room

// Per-room drawing history for late-join sync
const roomHistory = new Map();

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  socket.on("join_room", (roomId) => {
    if (!roomId || typeof roomId !== "string") {
      socket.emit("join_error", "Invalid room code.");
      return;
    }

    const room = io.sockets.adapter.rooms.get(roomId);
    const roomSize = room ? room.size : 0;

    if (roomSize >= MAX_ROOM_SIZE) {
      socket.emit("room_full");
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    // Send existing drawing history to the new joiner
    const history = roomHistory.get(roomId);
    if (history && history.length > 0) {
      socket.emit("draw_history", history);
    }

    io.to(roomId).emit("presence", {
      count: io.sockets.adapter.rooms.get(roomId)?.size || 1,
      max: MAX_ROOM_SIZE
    });
  });

  socket.on("draw_segment", (payload) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    // Store in history
    if (!roomHistory.has(roomId)) roomHistory.set(roomId, []);
    const history = roomHistory.get(roomId);
    history.push(payload);
    // Trim oldest if over limit
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

    socket.to(roomId).emit("draw_segment", payload);
  });

  socket.on("clear_canvas", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    // Clear history for this room
    roomHistory.delete(roomId);
    socket.to(roomId).emit("clear_canvas");
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    setTimeout(() => {
      const room = io.sockets.adapter.rooms.get(roomId);
      if (!room) {
        // Room empty — clean up history
        roomHistory.delete(roomId);
        return;
      }
      io.to(roomId).emit("presence", {
        count: room.size,
        max: MAX_ROOM_SIZE
      });
    }, 0);
  });
});

server.listen(PORT, () => {
  console.log(`Draw Together running on http://localhost:${PORT}`);
});