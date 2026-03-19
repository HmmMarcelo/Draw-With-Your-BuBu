const socket = io();

const board = document.getElementById("board");
const boardCtx = board.getContext("2d");
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
const bucketBtn = document.getElementById("bucket-btn");
const colorWrap = document.getElementById("color-wrap");
const colorOk = document.getElementById("color-ok");
const layersBtn = document.getElementById("layers-btn");
const layersWrap = document.getElementById("layers-wrap");
const addLayerBtn = document.getElementById("add-layer-btn");
const removeLayerBtn = document.getElementById("remove-layer-btn");
const layersList = document.getElementById("layers-list");
const brushWrap = brushBtn.closest(".tool-wrap");
const eraserWrap = eraserBtn.closest(".tool-wrap");
const eraserCursor = document.getElementById("eraser-cursor");

let drawing = false;
let lastPoint = null;
let erasing = false;
let filling = false;
let roomId = getRoomFromUrl();

let layers = [];
let activeLayerIndex = 0;

configureCanvas();
addLayer();
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
    const li = segment.layer !== undefined && segment.layer < layers.length ? segment.layer : 0;
    if (segment.fill) {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const px = Math.floor(segment.x * board.clientWidth * dpr);
      const py = Math.floor(segment.y * board.clientHeight * dpr);
      floodFill(px, py, segment.color, li);
    } else {
      drawSegment(segment.from, segment.to, segment.color, segment.size, li, segment.erase);
    }
  });

  socket.on("clear_canvas", clearCanvas);
}

function setupUI() {
  board.addEventListener("pointerdown", (event) => {
    if (filling) {
      const pt = getRelativePoint(event);
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const px = Math.floor(pt.x * dpr);
      const py = Math.floor(pt.y * dpr);
      const color = colorInput.value;
      floodFill(px, py, color, activeLayerIndex);
      socket.emit("draw_segment", {
        fill: true,
        x: pt.x / board.clientWidth,
        y: pt.y / board.clientHeight,
        color,
        layer: activeLayerIndex
      });
      return;
    }
    drawing = true;
    board.setPointerCapture(event.pointerId);
    lastPoint = getRelativePoint(event);
  });

  board.addEventListener("pointermove", (event) => {
    if (!drawing || !lastPoint) return;

    const nextPoint = getRelativePoint(event);
    const color = colorInput.value;
    const size = erasing ? Number(eraserSizeInput.value) : Number(brushInput.value);

    drawSegment(lastPoint, nextPoint, color, size, activeLayerIndex, erasing);
    socket.emit("draw_segment", {
      from: normalizePoint(lastPoint),
      to: normalizePoint(nextPoint),
      color,
      size,
      layer: activeLayerIndex,
      erase: erasing
    });

    lastPoint = nextPoint;
  });

  const stopDrawing = () => {
    drawing = false;
    lastPoint = null;
  };

  board.addEventListener("pointerup", stopDrawing);
  board.addEventListener("pointercancel", stopDrawing);
  board.addEventListener("pointerleave", () => {
    stopDrawing();
    eraserCursor.style.display = "none";
  });

  board.addEventListener("pointermove", (event) => {
    if (erasing) {
      const rect = board.getBoundingClientRect();
      const size = Number(eraserSizeInput.value);
      eraserCursor.style.display = "block";
      eraserCursor.style.width = size + "px";
      eraserCursor.style.height = size + "px";
      const stageRect = board.closest(".canvas-stage").getBoundingClientRect();
      eraserCursor.style.left = (event.clientX - stageRect.left) + "px";
      eraserCursor.style.top = (event.clientY - stageRect.top) + "px";
    }
  });

  board.addEventListener("pointerenter", () => {
    if (erasing) eraserCursor.style.display = "block";
  });

  brushInput.addEventListener("input", () => {
    brushValue.textContent = `${brushInput.value}px`;
  });

  eraserSizeInput.addEventListener("input", () => {
    eraserSizeValue.textContent = `${eraserSizeInput.value}px`;
  });

  function selectTool(tool) {
    erasing = tool === "eraser";
    filling = tool === "fill";
    brushBtn.classList.toggle("active", tool === "brush");
    eraserBtn.classList.toggle("active", tool === "eraser");
    bucketBtn.classList.toggle("active", tool === "fill");
    brushWrap.classList.toggle("open", tool === "brush");
    eraserWrap.classList.toggle("open", tool === "eraser");
    board.style.cursor = tool === "eraser" ? "none" : tool === "fill" ? "pointer" : "crosshair";
    if (tool !== "eraser") eraserCursor.style.display = "none";
  }

  brushBtn.addEventListener("click", () => selectTool("brush"));
  eraserBtn.addEventListener("click", () => selectTool("eraser"));
  bucketBtn.addEventListener("click", () => selectTool("fill"));

  document.addEventListener("click", (e) => {
    if (!brushWrap.contains(e.target)) brushWrap.classList.remove("open");
    if (!eraserWrap.contains(e.target)) eraserWrap.classList.remove("open");
    if (!downloadWrap.contains(e.target)) downloadWrap.classList.remove("open");
    if (!colorWrap.contains(e.target)) colorWrap.classList.remove("open");
    if (!layersWrap.contains(e.target)) layersWrap.classList.remove("open");
  });

  colorInput.addEventListener("input", () => {
    colorWrap.classList.add("open");
  });

  colorOk.addEventListener("click", () => {
    colorWrap.classList.remove("open");
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
      copyButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => {
        copyButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
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

  layersBtn.addEventListener("click", () => {
    layersWrap.classList.toggle("open");
    renderLayersList();
  });

  addLayerBtn.addEventListener("click", () => addLayer());
  removeLayerBtn.addEventListener("click", () => removeLayer(activeLayerIndex));

  window.addEventListener("resize", configureCanvas);
}

function configureCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssWidth = board.clientWidth;
  const cssHeight = board.clientHeight;

  if (!cssWidth || !cssHeight) return;

  const w = Math.floor(cssWidth * dpr);
  const h = Math.floor(cssHeight * dpr);

  // Save layer contents
  const temps = layers.map(l => {
    const t = document.createElement("canvas");
    t.width = l.canvas.width;
    t.height = l.canvas.height;
    t.getContext("2d").drawImage(l.canvas, 0, 0);
    return t;
  });

  board.width = w;
  board.height = h;
  boardCtx.imageSmoothingEnabled = false;

  layers.forEach((l, i) => {
    const oldW = l.canvas.width;
    const oldH = l.canvas.height;
    l.canvas.width = w;
    l.canvas.height = h;
    l.ctx.imageSmoothingEnabled = false;
    if (oldW && oldH) {
      l.ctx.drawImage(temps[i], 0, 0, w, h);
    }
  });

  compositeLayers();
}

function clearCanvas() {
  layers.forEach(l => {
    l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
  });
  compositeLayers();
}

function downloadImage(format) {
  const link = document.createElement("a");
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = board.width;
  tempCanvas.height = board.height;
  const tempCtx = tempCanvas.getContext("2d");

  if (format === "jpg") {
    tempCtx.fillStyle = "#ffffff";
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
  }

  layers.forEach(l => {
    if (l.visible) tempCtx.drawImage(l.canvas, 0, 0);
  });

  if (format === "jpg") {
    link.download = "drawing.jpg";
    link.href = tempCanvas.toDataURL("image/jpeg", 0.95);
  } else {
    link.download = "drawing.png";
    link.href = tempCanvas.toDataURL("image/png");
  }
  link.click();
}

function drawSegment(from, to, color, size, layerIdx, isErase) {
  const li = layerIdx !== undefined ? layerIdx : activeLayerIndex;
  const layer = layers[li];
  if (!layer) return;
  const lCtx = layer.ctx;
  const start = denormalizePoint(from);
  const end = denormalizePoint(to);
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  const x0 = Math.round(start.x * dpr);
  const y0 = Math.round(start.y * dpr);
  const x1 = Math.round(end.x * dpr);
  const y1 = Math.round(end.y * dpr);
  const radius = Math.max(1, Math.round((size * dpr) / 2));

  let r = 0, g = 0, b = 0;
  if (!isErase) {
    r = parseInt(color.slice(1, 3), 16);
    g = parseInt(color.slice(3, 5), 16);
    b = parseInt(color.slice(5, 7), 16);
  }

  const w = board.width;
  const h = board.height;

  const imageData = lCtx.getImageData(0, 0, w, h);
  const data = imageData.data;

  function stamp(cx, cy) {
    const rSq = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      const py = cy + dy;
      if (py < 0 || py >= h) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const px = cx + dx;
        if (px < 0 || px >= w) continue;
        if (dx * dx + dy * dy <= rSq) {
          const i = (py * w + px) * 4;
          if (isErase) {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 0;
          } else {
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = 255;
          }
        }
      }
    }
  }

  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let cx = x0, cy = y0;

  while (true) {
    stamp(cx, cy);
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; cx += sx; }
    if (e2 <= dx) { err += dx; cy += sy; }
  }

  lCtx.putImageData(imageData, 0, 0);
  compositeLayers();
}

function floodFill(startX, startY, hexColor, layerIdx) {
  const li = layerIdx !== undefined ? layerIdx : activeLayerIndex;
  const layer = layers[li];
  if (!layer) return;
  const lCtx = layer.ctx;
  const w = board.width;
  const h = board.height;
  if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;

  const imageData = lCtx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  const idx = (startY * w + startX) * 4;
  const sr = data[idx], sg = data[idx + 1], sb = data[idx + 2], sa = data[idx + 3];

  if (sr === r && sg === g && sb === b && sa === 255) return;

  function matches(i) {
    return data[i] === sr && data[i + 1] === sg && data[i + 2] === sb && data[i + 3] === sa;
  }

  const stack = [[startX, startY]];

  while (stack.length) {
    const [sx, sy] = stack.pop();
    let x = sx;

    while (x > 0 && matches(((sy * w) + x - 1) * 4)) x--;

    let spanUp = false;
    let spanDown = false;

    while (x < w) {
      const i = (sy * w + x) * 4;
      if (!matches(i)) break;

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;

      if (sy > 0) {
        if (matches(((sy - 1) * w + x) * 4)) {
          if (!spanUp) { stack.push([x, sy - 1]); spanUp = true; }
        } else { spanUp = false; }
      }

      if (sy < h - 1) {
        if (matches(((sy + 1) * w + x) * 4)) {
          if (!spanDown) { stack.push([x, sy + 1]); spanDown = true; }
        } else { spanDown = false; }
      }

      x++;
    }
  }

  lCtx.putImageData(imageData, 0, 0);
  compositeLayers();
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

function createLayerCanvas() {
  const c = document.createElement("canvas");
  c.width = board.width;
  c.height = board.height;
  const lCtx = c.getContext("2d");
  lCtx.imageSmoothingEnabled = false;
  return { canvas: c, ctx: lCtx, name: "Layer " + layers.length, visible: true };
}

function addLayer() {
  layers.push(createLayerCanvas());
  activeLayerIndex = layers.length - 1;
  renderLayersList();
}

function removeLayer(index) {
  if (layers.length <= 1) return;
  layers.splice(index, 1);
  if (activeLayerIndex >= layers.length) activeLayerIndex = layers.length - 1;
  compositeLayers();
  renderLayersList();
}

function compositeLayers() {
  boardCtx.save();
  boardCtx.setTransform(1, 0, 0, 1, 0, 0);
  boardCtx.clearRect(0, 0, board.width, board.height);
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].visible) boardCtx.drawImage(layers[i].canvas, 0, 0);
  }
  boardCtx.restore();
}

function renderLayersList() {
  if (!layersList) return;
  layersList.innerHTML = "";
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    const item = document.createElement("div");
    item.className = "layer-item" + (i === activeLayerIndex ? " active" : "");

    const vis = document.createElement("button");
    vis.className = "layer-vis";
    vis.textContent = l.visible ? "\uD83D\uDC41" : "\u2014";
    vis.title = l.visible ? "Hide layer" : "Show layer";
    vis.addEventListener("click", (e) => {
      e.stopPropagation();
      l.visible = !l.visible;
      compositeLayers();
      renderLayersList();
    });

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = l.name;

    item.appendChild(vis);
    item.appendChild(name);
    item.addEventListener("click", () => {
      activeLayerIndex = i;
      renderLayersList();
    });

    layersList.appendChild(item);
  }
}