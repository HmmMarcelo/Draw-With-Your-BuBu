const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_ROOM_SIZE = 10;

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

    io.to(roomId).emit("presence", {
      count: io.sockets.adapter.rooms.get(roomId)?.size || 1,
      max: MAX_ROOM_SIZE
    });
  });

  socket.on("draw_segment", (payload) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit("draw_segment", payload);
  });

  socket.on("clear_canvas", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit("clear_canvas");
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    setTimeout(() => {
      const room = io.sockets.adapter.rooms.get(roomId);
      if (!room) return;
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