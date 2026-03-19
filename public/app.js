const socket = io();

const board = document.getElementById("board");
const ctx = board.getContext("2d", { alpha: false });
const colorInput = document.getElementById("color");
const brushInput = document.getElementById("brush");
const brushValue = document.getElementById("brush-value");
const clearButton = document.getElementById("clear");
const copyButton = document.getElementById("copy-link");
const presenceText = document.getElementById("presence");
const roomText = document.getElementById("room-code");
const roomInput = document.getElementById("room-input");
const joinBtn = document.getElementById("join-btn");
const newRoomBtn = document.getElementById("new-room-btn");
const eraserBtn = document.getElementById("eraser");
const eraserSizeInput = document.getElementById("eraser-size");
const eraserSizeValue = document.getElementById("eraser-size-value");

let drawing = false;
let lastPoint = null;
let erasing = false;
let roomId = getRoomFromUrl();

ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, board.width, board.height);

configureCanvas();
setupRoom();
setupSocket();
setupUI();

function setupRoom() {
  if (!roomId) {
    roomId = generateRoomCode();
  }
  applyRoom(roomId);
}

function applyRoom(code) {
  roomId = code;
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  window.history.replaceState({}, "", url);
  roomText.textContent = `Room: ${roomId}`;
  roomInput.value = roomId;
  clearCanvas();
  socket.emit("join_room", roomId);
}

function setupSocket() {
  socket.on("presence", ({ count, max }) => {
    if (count === 1) {
      presenceText.textContent = "Just you — share the code!";
    } else {
      presenceText.textContent = `${count} people drawing`;
    }
  });

  socket.on("room_full", () => {
    presenceText.textContent = "Room full";
    alert("This room is full. Create a new room or try a different code.");
  });

  socket.on("join_error", (message) => {
    alert(message || "Could not join room.");
  });

  socket.on("draw_segment", (segment) => {
    drawSegment(segment.from, segment.to, segment.color, segment.size);
  });

  socket.on("clear_canvas", clearCanvas);
}

function setupUI() {
  board.addEventListener("pointerdown", (event) => {
    drawing = true;
    board.setPointerCapture(event.pointerId);
    lastPoint = getRelativePoint(event);
  });

  board.addEventListener("pointermove", (event) => {
    if (!drawing || !lastPoint) return;

    const nextPoint = getRelativePoint(event);
    const color = erasing ? "#ffffff" : colorInput.value;
    const size = erasing ? Number(eraserSizeInput.value) : Number(brushInput.value);

    drawSegment(lastPoint, nextPoint, color, size);
    socket.emit("draw_segment", {
      from: normalizePoint(lastPoint),
      to: normalizePoint(nextPoint),
      color,
      size
    });

    lastPoint = nextPoint;
  });

  const stopDrawing = () => {
    drawing = false;
    lastPoint = null;
  };

  board.addEventListener("pointerup", stopDrawing);
  board.addEventListener("pointercancel", stopDrawing);
  board.addEventListener("pointerleave", stopDrawing);

  brushInput.addEventListener("input", () => {
    brushValue.textContent = `${brushInput.value}px`;
  });

  eraserBtn.addEventListener("click", () => {
    erasing = !erasing;
    eraserBtn.classList.toggle("active", erasing);
    board.style.cursor = erasing ? "cell" : "crosshair";
  });

  eraserSizeInput.addEventListener("input", () => {
    eraserSizeValue.textContent = `${eraserSizeInput.value}px`;
  });

  clearButton.addEventListener("click", () => {
    clearCanvas();
    socket.emit("clear_canvas");
  });

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copyButton.textContent = "Invite copied";
      setTimeout(() => {
        copyButton.textContent = "Copy invite link";
      }, 1200);
    } catch {
      alert("Clipboard access blocked. Copy the URL manually.");
    }
  });

  joinBtn.addEventListener("click", () => {
    const code = roomInput.value.trim();
    if (!code) return;
    applyRoom(code);
  });

  roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinBtn.click();
  });

  newRoomBtn.addEventListener("click", () => {
    applyRoom(generateRoomCode());
  });

  window.addEventListener("resize", configureCanvas);
}

function configureCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssWidth = board.clientWidth;
  const cssHeight = board.clientHeight;

  if (!cssWidth || !cssHeight) return;

  const snapshot = board.toDataURL();

  board.width = Math.floor(cssWidth * dpr);
  board.height = Math.floor(cssHeight * dpr);

  // Keep strokes crisp on high-DPI displays while drawing in CSS pixels.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const img = new Image();
  img.onload = () => {
    clearCanvas();
    ctx.drawImage(img, 0, 0, cssWidth, cssHeight);
  };
  img.src = snapshot;
}

function clearCanvas() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, board.width, board.height);
  ctx.restore();
}

function drawSegment(from, to, color, size) {
  const start = denormalizePoint(from);
  const end = denormalizePoint(to);

  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
}

function normalizePoint(point) {
  return {
    x: point.x / board.clientWidth,
    y: point.y / board.clientHeight
  };
}

function denormalizePoint(point) {
  if (point.x <= 1 && point.y <= 1) {
    return {
      x: point.x * board.clientWidth,
      y: point.y * board.clientHeight
    };
  }

  return point;
}

function getRelativePoint(event) {
  const rect = board.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function getRoomFromUrl() {
  const room = new URLSearchParams(window.location.search).get("room");
  return room ? room.trim().slice(0, 20) : "";
}

function generateRoomCode() {
  return Math.random().toString(36).slice(2, 8);
}