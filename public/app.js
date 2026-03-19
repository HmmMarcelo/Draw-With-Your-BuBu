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
const brushBtn = document.getElementById("brush-btn");
const eraserBtn = document.getElementById("eraser-btn");
const eraserSizeInput = document.getElementById("eraser-size");
const eraserSizeValue = document.getElementById("eraser-size-value");
const darkToggle = document.getElementById("dark-toggle");
const downloadBtn = document.getElementById("download-btn");
const downloadWrap = downloadBtn.closest(".tool-wrap");
const dlPng = document.getElementById("dl-png");
const dlJpg = document.getElementById("dl-jpg");
const brushWrap = brushBtn.closest(".tool-wrap");
const eraserWrap = eraserBtn.closest(".tool-wrap");

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

  eraserSizeInput.addEventListener("input", () => {
    eraserSizeValue.textContent = `${eraserSizeInput.value}px`;
  });

  function selectTool(tool) {
    erasing = tool === "eraser";
    brushBtn.classList.toggle("active", !erasing);
    eraserBtn.classList.toggle("active", erasing);
    brushWrap.classList.toggle("open", !erasing);
    eraserWrap.classList.toggle("open", erasing);
    board.style.cursor = erasing ? "cell" : "crosshair";
  }

  brushBtn.addEventListener("click", () => selectTool("brush"));
  eraserBtn.addEventListener("click", () => selectTool("eraser"));

  document.addEventListener("click", (e) => {
    if (!brushWrap.contains(e.target)) brushWrap.classList.remove("open");
    if (!eraserWrap.contains(e.target)) eraserWrap.classList.remove("open");
    if (!downloadWrap.contains(e.target)) downloadWrap.classList.remove("open");
  });

  downloadBtn.addEventListener("click", () => {
    downloadWrap.classList.toggle("open");
  });

  dlPng.addEventListener("click", () => {
    downloadImage("png");
    downloadWrap.classList.remove("open");
  });

  dlJpg.addEventListener("click", () => {
    downloadImage("jpg");
    downloadWrap.classList.remove("open");
  });

  darkToggle.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    const isDark = document.body.classList.contains("dark");
    darkToggle.textContent = isDark ? "☀️" : "🌙";
    localStorage.setItem("darkMode", isDark ? "1" : "0");
  });

  if (localStorage.getItem("darkMode") === "1") {
    document.body.classList.add("dark");
    darkToggle.textContent = "☀️";
  }

  clearButton.addEventListener("click", () => {
    if (!confirm("Are you sure you want to clear the canvas?")) return;
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

function downloadImage(format) {
  const link = document.createElement("a");
  if (format === "jpg") {
    link.download = "drawing.jpg";
    link.href = board.toDataURL("image/jpeg", 0.95);
  } else {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = board.width;
    tempCanvas.height = board.height;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.drawImage(board, 0, 0);
    // Remove white background by making white pixels transparent
    const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) {
        data[i + 3] = 0;
      }
    }
    tempCtx.putImageData(imageData, 0, 0);
    link.download = "drawing.png";
    link.href = tempCanvas.toDataURL("image/png");
  }
  link.click();
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