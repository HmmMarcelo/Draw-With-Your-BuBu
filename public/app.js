// ============================================================
// DRAW TOGETHER — Client Application
// Supports Normal mode (index.html) and Endless mode (page2.html)
// ============================================================

// --- Mode & Constants ---
const currentMode = window.location.pathname.includes("page2") ? "endless" : "normal";
const CANVAS_W = 2560;
const CANVAS_H = 1440;

// --- Persistent User ID (survives page reloads & mode switches) ---
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

// --- DOM References ---
const board = document.getElementById("board");
const boardCtx = board.getContext("2d");
const colorInput = document.getElementById("color");
const brushInput = document.getElementById("brush");
const brushStyleInput = document.getElementById("brush-style");
const brushValue = document.getElementById("brush-value");
const clearButton = document.getElementById("clear");
const copyButton = document.getElementById("copy-link");
const presenceText = document.getElementById("presence");
const roomText = document.getElementById("room-code");
const roomInput = document.getElementById("room-input");
const joinBtn = document.getElementById("join-btn");
const newRoomBtn = document.getElementById("new-room-btn");
const brushBtn = document.getElementById("brush-btn");
const colorPickBtn = document.getElementById("color-pick-btn");
const eraserBtn = document.getElementById("eraser-btn");
const eraserSizeInput = document.getElementById("eraser-size");
const eraserSizeValue = document.getElementById("eraser-size-value");
const darkToggle = document.getElementById("dark-toggle");
const downloadBtn = document.getElementById("download-btn");
const fullscreenBtn = document.getElementById("fullscreen-btn");
const downloadWrap = document.getElementById("download-wrap");
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
const activeLayerLabel = document.getElementById("active-layer-label");
const brushWrap = brushBtn ? brushBtn.closest(".tool-wrap") : null;
const eraserWrap = eraserBtn ? eraserBtn.closest(".tool-wrap") : null;
const eraserCursor = document.getElementById("eraser-cursor");
const modesWrap = document.getElementById("modes-wrap");
const modesBtn = document.getElementById("modes-btn");
const modeLabel = document.getElementById("mode-label");
const toggle3dBtn = document.getElementById("toggle-3d-btn");
const undoBtn = document.getElementById("undo-btn");
const redoBtn = document.getElementById("redo-btn");
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomResetBtn = document.getElementById("zoom-reset-btn");
const zoomLevelEl = document.getElementById("zoom-level");
const zoomIndicator = document.getElementById("zoom-indicator");

// --- State ---
let normalViewport = { x: 0, y: 0, scale: 1 };
let endlessViewport = { x: 0, y: 0, scale: 1 };
let layers = [];
let activeLayerIndex = 0;
let endlessStrokes = [];
let drawing = false;
let lastPoint = null;
let activePointerId = null;
let erasing = false;
let filling = false;
let pickingColor = false;
let fullscreenMode = false;

// Multi-touch
const pointers = new Map();
let interactionState = "idle"; // idle | drawing | pinching | panning
let pinchData = null;
let panData = null;

// Undo/Redo — normal mode
let undoStack = [];
let redoStack = [];
let currentCommandGroup = null;

// Undo/Redo — endless mode
let endlessUndoStack = [];
let endlessRedoStack = [];
let currentEndlessGroup = null;

// 3D view
let show3d = false;
let orbit25d = { rotX: -25, rotY: 35 };
let orbitDragging = false;
let orbitDragStart = null;
let orbitStart = null;

// Room
let roomId = "";

// Endless render throttle
let endlessRafId = null;

// ============================================================
// COMMAND CLASSES (Undo/Redo for Normal mode)
// ============================================================

class DrawCommand {
  constructor(layer, from, to, color, size, erase, brushStyle) {
    this.layer = layer;
    this.from = { ...from };
    this.to = { ...to };
    this.color = color;
    this.size = size;
    this.erase = erase;
    this.brushStyle = brushStyle;
    this.prevImage = null;
    this._box = null;
  }
  execute() {
    const l = layers[this.layer];
    if (!l) return;
    const pad = this.size + 2;
    const x = Math.max(0, Math.floor(Math.min(this.from.x, this.to.x) - pad));
    const y = Math.max(0, Math.floor(Math.min(this.from.y, this.to.y) - pad));
    const x2 = Math.min(l.canvas.width, Math.ceil(Math.max(this.from.x, this.to.x) + pad));
    const y2 = Math.min(l.canvas.height, Math.ceil(Math.max(this.from.y, this.to.y) + pad));
    const w = Math.max(1, x2 - x);
    const h = Math.max(1, y2 - y);
    this._box = { x, y, w, h };
    try { this.prevImage = l.ctx.getImageData(x, y, w, h); } catch { this.prevImage = null; }
    drawSegment(this.from, this.to, this.color, this.size, this.layer, this.erase, this.brushStyle);
  }
  undo() {
    const l = layers[this.layer];
    if (l && this.prevImage && this._box) {
      l.ctx.putImageData(this.prevImage, this._box.x, this._box.y);
    }
    compositeLayers();
  }
}

class FillCommand {
  constructor(layer, x, y, color) {
    this.layer = layer;
    this.x = x;
    this.y = y;
    this.color = color;
    this.prevImage = null;
  }
  execute() {
    const l = layers[this.layer];
    if (!l) return;
    this.prevImage = l.ctx.getImageData(0, 0, l.canvas.width, l.canvas.height);
    floodFill(this.x, this.y, this.color, this.layer);
  }
  undo() {
    const l = layers[this.layer];
    if (l && this.prevImage) l.ctx.putImageData(this.prevImage, 0, 0);
    compositeLayers();
  }
}

// ============================================================
// INITIALIZATION
// ============================================================
configureCanvas();
if (currentMode === "normal") addLayer();
applyDarkMode();
applyModeUI();
setupRoom();
setupSocket();
setupUI();
setupPointerHandlers();

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
  clearCanvasLocal();
  socket.emit("join_room", { roomId, userId, mode: currentMode });
  hasJoined = true;
}

// ============================================================
// SOCKET EVENT HANDLERS
// ============================================================

function setupSocket() {
  // Re-join on reconnection
  socket.on("connect", () => {
    if (hasJoined && roomId) {
      clearCanvasLocal();
      socket.emit("join_room", { roomId, userId, mode: currentMode });
    }
  });

  socket.on("presence", ({ count }) => {
    if (!presenceText) return;
    presenceText.textContent = count === 1
      ? "Just you \u2014 share the code!"
      : count + " people drawing";
  });

  socket.on("room_full", () => {
    if (presenceText) presenceText.textContent = "Room full";
    alert("This room is full.");
  });

  socket.on("join_error", (msg) => alert(msg || "Could not join room."));

  socket.on("draw_segment", (seg) => {
    // Ignore strokes for a different mode
    if (seg.mode && seg.mode !== currentMode) return;

    if (currentMode === "endless") {
      if (seg.endless || seg.mode === "endless") {
        endlessStrokes.push(seg);
        renderEndlessIncremental(seg);
      }
    } else {
      const li = seg.layer !== undefined && seg.layer < layers.length ? seg.layer : 0;
      if (seg.fill) {
        const px = Math.floor(seg.x * CANVAS_W);
        const py = Math.floor(seg.y * CANVAS_H);
        floodFill(px, py, seg.color, li);
      } else if (seg.from && seg.to) {
        drawSegment(
          denormalizePoint(seg.from),
          denormalizePoint(seg.to),
          seg.color, seg.size, li, seg.erase, seg.brushStyle
        );
      }
    }
  });

  socket.on("draw_history", (history) => replayHistory(history));

  // After any user clears, server sends remaining history for re-render
  socket.on("history_refresh", (data) => {
    if (data.mode !== currentMode) return;
    clearCanvasLocal();
    replayHistory(data.history);
  });
}

// ============================================================
// CANVAS CONFIGURATION
// ============================================================

function configureCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = board.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    requestAnimationFrame(configureCanvas);
    return;
  }
  board.width = Math.round(rect.width * dpr);
  board.height = Math.round(rect.height * dpr);
  boardCtx.imageSmoothingEnabled = true;
  boardCtx.imageSmoothingQuality = "high";
  render();
}

// ============================================================
// LAYER MANAGEMENT (Normal Mode)
// ============================================================

function createLayerCanvas() {
  const c = document.createElement("canvas");
  c.width = CANVAS_W;
  c.height = CANVAS_H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas: c, ctx, name: "Layer " + layers.length, visible: true, onion: false };
}

function addLayer() {
  layers.push(createLayerCanvas());
  activeLayerIndex = layers.length - 1;
  updateLayerLabel();
  renderLayersList();
  if (show3d) render25dScene();
}

function removeLayer(index) {
  if (layers.length <= 1) return;
  layers.splice(index, 1);
  if (activeLayerIndex >= layers.length) activeLayerIndex = layers.length - 1;
  compositeLayers();
  updateLayerLabel();
  renderLayersList();
  if (show3d) render25dScene();
}

function updateLayerLabel() {
  if (!activeLayerLabel) return;
  const l = layers[activeLayerIndex];
  activeLayerLabel.textContent = l ? l.name : "";
}

function renderLayersList() {
  if (!layersList) return;
  updateLayerLabel();
  layersList.innerHTML = "";
  let dragSrcIndex = null;

  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    const item = document.createElement("div");
    item.className = "layer-item" + (i === activeLayerIndex ? " active" : "");
    item.draggable = true;
    item.dataset.index = i;

    // Onion skin button
    const onion = document.createElement("button");
    onion.className = "layer-onion" + (l.onion ? " on" : "");
    onion.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="14" rx="6" ry="8"/><ellipse cx="12" cy="14" rx="3.5" ry="5"/><path d="M12 6V2"/></svg>';
    onion.title = l.onion ? "Disable onion skin" : "Enable onion skin";
    onion.addEventListener("click", (e) => {
      e.stopPropagation();
      l.onion = !l.onion;
      compositeLayers();
      renderLayersList();
    });

    // Visibility button
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

    item.appendChild(onion);
    item.appendChild(vis);
    item.appendChild(name);

    item.addEventListener("click", () => {
      activeLayerIndex = i;
      updateLayerLabel();
      renderLayersList();
    });

    // Drag-and-drop reordering
    item.addEventListener("dragstart", (e) => {
      dragSrcIndex = i;
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      layersList.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      layersList.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
      item.classList.add("drag-over");
    });
    item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      item.classList.remove("drag-over");
      const dropIndex = parseInt(item.dataset.index, 10);
      if (dragSrcIndex === null || dragSrcIndex === dropIndex) return;
      const moved = layers.splice(dragSrcIndex, 1)[0];
      layers.splice(dropIndex, 0, moved);
      if (activeLayerIndex === dragSrcIndex) activeLayerIndex = dropIndex;
      else if (activeLayerIndex > dragSrcIndex && activeLayerIndex <= dropIndex) activeLayerIndex--;
      else if (activeLayerIndex < dragSrcIndex && activeLayerIndex >= dropIndex) activeLayerIndex++;
      compositeLayers();
      updateLayerLabel();
      renderLayersList();
    });

    layersList.appendChild(item);
  }
}

// ============================================================
// DRAWING CORE
// ============================================================

function drawSegment(from, to, color, size, layerIdx, isErase, brushStyle, skipRender) {
  const li = layerIdx !== undefined ? layerIdx : activeLayerIndex;
  const layer = layers[li];
  if (!layer) return;
  const lCtx = layer.ctx;
  const w = layer.canvas.width;
  const h = layer.canvas.height;
  const x0 = Math.round(from.x);
  const y0 = Math.round(from.y);
  const x1 = Math.round(to.x);
  const y1 = Math.round(to.y);
  const radius = Math.max(1, Math.round(size / 2));

  let r = 0, g = 0, b = 0;
  if (!isErase) {
    r = parseInt(color.slice(1, 3), 16);
    g = parseInt(color.slice(3, 5), 16);
    b = parseInt(color.slice(5, 7), 16);
  }

  const imageData = lCtx.getImageData(0, 0, w, h);
  const data = imageData.data;

  function stableNoise(x, y, seed) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
    return n - Math.floor(n);
  }

  function paintPixel(px, py, alpha) {
    if (px < 0 || px >= w || py < 0 || py >= h) return;
    const i = (py * w + px) * 4;
    if (isErase) {
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
      return;
    }
    const srcA = data[i + 3] / 255;
    const outA = alpha + srcA * (1 - alpha);
    if (outA <= 0) return;
    data[i]     = Math.round((r * alpha + data[i]     * srcA * (1 - alpha)) / outA);
    data[i + 1] = Math.round((g * alpha + data[i + 1] * srcA * (1 - alpha)) / outA);
    data[i + 2] = Math.round((b * alpha + data[i + 2] * srcA * (1 - alpha)) / outA);
    data[i + 3] = Math.round(outA * 255);
  }

  function stampRound(cx, cy) {
    const rSq = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      const py = cy + dy;
      if (py < 0 || py >= h) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const px = cx + dx;
        if (px < 0 || px >= w) continue;
        if (dx * dx + dy * dy <= rSq) paintPixel(px, py, 1);
      }
    }
  }

  function stampFlat(cx, cy) {
    const halfW = Math.max(1, Math.round(radius * 1.45));
    const halfH = Math.max(1, Math.round(radius * 0.65));
    for (let dy = -halfH; dy <= halfH; dy++) {
      const py = cy + dy;
      if (py < 0 || py >= h) continue;
      for (let dx = -halfW; dx <= halfW; dx++) {
        const px = cx + dx;
        if (px < 0 || px >= w) continue;
        paintPixel(px, py, Math.abs(dx) / halfW > 0.92 ? 0.65 : 0.95);
      }
    }
  }

  function stampMarker(cx, cy) {
    const rSq = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      const py = cy + dy;
      if (py < 0 || py >= h) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const px = cx + dx;
        if (px < 0 || px >= w) continue;
        const distSq = dx * dx + dy * dy;
        if (distSq > rSq) continue;
        paintPixel(px, py, Math.sqrt(distSq) / radius > 0.85 ? 0.28 : 0.38);
      }
    }
  }

  function stampDry(cx, cy) {
    const rSq = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      const py = cy + dy;
      if (py < 0 || py >= h) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const px = cx + dx;
        if (px < 0 || px >= w) continue;
        if (dx * dx + dy * dy > rSq) continue;
        if (stableNoise(px, py, 1) < 0.33) continue;
        paintPixel(px, py, 0.55 + stableNoise(px, py, 2) * 0.4);
      }
    }
  }

  function stampFan(cx, cy) {
    const spokes = 5;
    const spread = Math.max(2, Math.round(radius * 0.95));
    const fringe = Math.max(1, Math.round(radius * 0.45));
    for (let s = 0; s < spokes; s++) {
      const offset = s - Math.floor(spokes / 2);
      for (let t = -spread; t <= spread; t++) {
        const px = cx + t;
        const py = cy + Math.round(offset * 1.7 + t * 0.12 * offset);
        for (let f = -fringe; f <= fringe; f++) {
          paintPixel(px, py + f, Math.max(0.2, 0.6 - Math.abs(f) / (fringe + 1) * 0.35));
        }
      }
    }
  }

  function stamp(cx, cy) {
    if (isErase) { stampRound(cx, cy); return; }
    switch (brushStyle) {
      case "flat": stampFlat(cx, cy); break;
      case "marker": stampMarker(cx, cy); break;
      case "dry": stampDry(cx, cy); break;
      case "fan": stampFan(cx, cy); break;
      default: stampRound(cx, cy); break;
    }
  }

  // Bresenham line
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
  if (!skipRender) compositeLayers();
}

function floodFill(startX, startY, hexColor, layerIdx, skipRender) {
  const li = layerIdx !== undefined ? layerIdx : activeLayerIndex;
  const layer = layers[li];
  if (!layer) return;
  const lCtx = layer.ctx;
  const w = layer.canvas.width;
  const h = layer.canvas.height;
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
    const [px, py] = stack.pop();
    let x = px;
    while (x > 0 && matches(((py * w) + x - 1) * 4)) x--;
    let spanUp = false, spanDown = false;
    while (x < w) {
      const i = (py * w + x) * 4;
      if (!matches(i)) break;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      if (py > 0) {
        if (matches(((py - 1) * w + x) * 4)) { if (!spanUp) { stack.push([x, py - 1]); spanUp = true; } } else spanUp = false;
      }
      if (py < h - 1) {
        if (matches(((py + 1) * w + x) * 4)) { if (!spanDown) { stack.push([x, py + 1]); spanDown = true; } } else spanDown = false;
      }
      x++;
    }
  }
  lCtx.putImageData(imageData, 0, 0);
  if (!skipRender) compositeLayers();
}

// ============================================================
// COMPOSITING & RENDERING
// ============================================================

function render() {
  if (currentMode === "endless") renderEndless();
  else compositeLayers();
}

function compositeLayers() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  boardCtx.save();
  boardCtx.setTransform(1, 0, 0, 1, 0, 0);
  boardCtx.clearRect(0, 0, board.width, board.height);

  const s = normalViewport.scale * dpr;
  const tx = -normalViewport.x * s;
  const ty = -normalViewport.y * s;
  boardCtx.setTransform(s, 0, 0, s, tx, ty);

  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (i === activeLayerIndex) {
      // Active layer: always full opacity
      boardCtx.globalAlpha = 1;
      boardCtx.drawImage(l.canvas, 0, 0);
    } else if (l.visible) {
      boardCtx.globalAlpha = 1;
      boardCtx.drawImage(l.canvas, 0, 0);
    } else if (l.onion) {
      // Onion skin: semi-transparent reference
      boardCtx.globalAlpha = 0.35;
      boardCtx.drawImage(l.canvas, 0, 0);
    }
    // else: hidden and no onion → skip
  }

  boardCtx.globalAlpha = 1;

  // Dotted border around the 2K canvas area
  boardCtx.save();
  boardCtx.setLineDash([8, 8]);
  boardCtx.lineWidth = 2 / s;
  boardCtx.strokeStyle = "rgba(120,120,180,0.6)";
  boardCtx.strokeRect(0, 0, CANVAS_W, CANVAS_H);
  boardCtx.restore();

  boardCtx.restore();
  updateZoomIndicator();
  refresh25dCanvases();
}

// ============================================================
// COORDINATE CONVERSION
// ============================================================

function getWorldPoint(event) {
  const rect = board.getBoundingClientRect();
  const cssX = event.clientX - rect.left;
  const cssY = event.clientY - rect.top;
  if (currentMode === "endless") {
    return { x: cssX / endlessViewport.scale + endlessViewport.x, y: cssY / endlessViewport.scale + endlessViewport.y };
  }
  return { x: cssX / normalViewport.scale + normalViewport.x, y: cssY / normalViewport.scale + normalViewport.y };
}

function normalizePoint(p) { return { x: p.x / CANVAS_W, y: p.y / CANVAS_H }; }
function denormalizePoint(p) { return { x: p.x * CANVAS_W, y: p.y * CANVAS_H }; }

// ============================================================
// POINTER & TOUCH HANDLING
// ============================================================

function setupPointerHandlers() {
  board.addEventListener("pointerdown", onPointerDown);
  board.addEventListener("pointermove", onPointerMove);
  board.addEventListener("pointerup", onPointerUp);
  board.addEventListener("pointercancel", onPointerUp);

  // Don't end drawing on pointerleave for touch (prevents short broken lines)
  board.addEventListener("pointerleave", (e) => {
    if (eraserCursor) eraserCursor.style.display = "none";
    if (e.pointerType !== "touch" && interactionState === "drawing" && e.pointerId === activePointerId) {
      finishDrawing();
      interactionState = "idle";
    }
  });

  board.addEventListener("pointerenter", () => {
    if (erasing && eraserCursor) eraserCursor.style.display = "block";
  });

  board.addEventListener("contextmenu", (e) => e.preventDefault());
  board.addEventListener("wheel", handleWheel, { passive: false });
  board.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
}

function onPointerDown(e) {
  if (e.pointerType === "touch") e.preventDefault();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { board.setPointerCapture(e.pointerId); } catch {}

  // 3D orbit: right-click or alt+left in 3D mode
  if (show3d && currentMode === "normal" && (e.button === 2 || (e.button === 0 && e.altKey))) {
    interactionState = "panning";
    orbitDragging = true;
    orbitDragStart = { x: e.clientX, y: e.clientY };
    orbitStart = { rotX: orbit25d.rotX, rotY: orbit25d.rotY };
    board.style.cursor = "grabbing";
    return;
  }

  // Two+ fingers → pinch zoom/pan
  if (pointers.size >= 2) {
    if (interactionState === "drawing") cancelDrawing();
    interactionState = "pinching";
    startPinch();
    return;
  }

  // Right-click, middle-click, or Alt+click → pan
  if (e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey)) {
    interactionState = "panning";
    const vp = currentMode === "endless" ? endlessViewport : normalViewport;
    panData = { startX: e.clientX, startY: e.clientY, vpStartX: vp.x, vpStartY: vp.y };
    board.style.cursor = "grabbing";
    return;
  }

  if (e.button !== 0) return;

  // Fill tool
  if (filling) { doFill(e); return; }
  // Color picker
  if (pickingColor) { doPickColor(e); return; }

  // Start drawing
  interactionState = "drawing";
  activePointerId = e.pointerId;
  drawing = true;
  lastPoint = getWorldPoint(e);
  if (currentMode === "normal") currentCommandGroup = [];
  else currentEndlessGroup = [];
}

function onPointerMove(e) {
  if (e.pointerType === "touch") e.preventDefault();
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // 3D orbit drag
  if (orbitDragging && orbitDragStart) {
    const dx = e.clientX - orbitDragStart.x;
    const dy = e.clientY - orbitDragStart.y;
    orbit25d.rotY = orbitStart.rotY + dx * 0.4;
    orbit25d.rotX = Math.max(-80, Math.min(80, orbitStart.rotX + dy * 0.4));
    update25dTransform();
    return;
  }

  switch (interactionState) {
    case "pinching": updatePinch(); break;
    case "panning": updatePan(e); break;
    case "drawing":
      if (e.pointerId !== activePointerId) return;
      updateDrawing(e);
      break;
  }

  // Eraser cursor
  if (erasing && e.pointerType !== "touch" && eraserCursor) {
    const size = Number(eraserSizeInput.value);
    eraserCursor.style.display = "block";
    eraserCursor.style.width = size + "px";
    eraserCursor.style.height = size + "px";
    const stageRect = board.closest(".canvas-stage").getBoundingClientRect();
    eraserCursor.style.left = (e.clientX - stageRect.left) + "px";
    eraserCursor.style.top = (e.clientY - stageRect.top) + "px";
  }
}

function onPointerUp(e) {
  if (e.pointerType === "touch") e.preventDefault();
  pointers.delete(e.pointerId);
  try { board.releasePointerCapture(e.pointerId); } catch {}

  // 3D orbit end
  if (orbitDragging) {
    orbitDragging = false;
    orbitDragStart = null;
    board.style.cursor = "crosshair";
    if (pointers.size === 0) interactionState = "idle";
    return;
  }

  if (interactionState === "pinching") {
    if (pointers.size < 2) { pinchData = null; interactionState = "idle"; }
    return;
  }

  if (interactionState === "panning") {
    if (pointers.size === 0) {
      panData = null;
      interactionState = "idle";
      board.style.cursor = erasing ? "none" : "crosshair";
    }
    return;
  }

  if (interactionState === "drawing" && e.pointerId === activePointerId) {
    finishDrawing();
    interactionState = "idle";
    return;
  }

  if (pointers.size === 0) interactionState = "idle";
}

// --- Pinch-to-zoom (both modes) ---

function startPinch() {
  const pts = [...pointers.values()];
  if (pts.length < 2) return;
  const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  const cx = (pts[0].x + pts[1].x) / 2;
  const cy = (pts[0].y + pts[1].y) / 2;
  const rect = board.getBoundingClientRect();
  const vp = currentMode === "endless" ? endlessViewport : normalViewport;
  pinchData = {
    startDist: dist,
    startScale: vp.scale,
    startCenterCSS: { x: cx - rect.left, y: cy - rect.top },
    startViewport: { x: vp.x, y: vp.y }
  };
}

function updatePinch() {
  const pts = [...pointers.values()];
  if (pts.length < 2 || !pinchData) return;
  const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  const cx = (pts[0].x + pts[1].x) / 2;
  const cy = (pts[0].y + pts[1].y) / 2;
  const rect = board.getBoundingClientRect();
  const cssCX = cx - rect.left;
  const cssCY = cy - rect.top;
  const vp = currentMode === "endless" ? endlessViewport : normalViewport;
  const maxScale = currentMode === "endless" ? 500 : 10;
  const minScale = currentMode === "endless" ? 0.01 : 0.1;
  const scaleRatio = dist / pinchData.startDist;
  const newScale = Math.max(minScale, Math.min(maxScale, pinchData.startScale * scaleRatio));

  const worldCX = pinchData.startCenterCSS.x / pinchData.startScale + pinchData.startViewport.x;
  const worldCY = pinchData.startCenterCSS.y / pinchData.startScale + pinchData.startViewport.y;
  vp.scale = newScale;
  vp.x = worldCX - cssCX / newScale;
  vp.y = worldCY - cssCY / newScale;
  render();
}

// --- Pan ---

function updatePan(e) {
  if (!panData) return;
  const vp = currentMode === "endless" ? endlessViewport : normalViewport;
  vp.x = panData.vpStartX - (e.clientX - panData.startX) / vp.scale;
  vp.y = panData.vpStartY - (e.clientY - panData.startY) / vp.scale;
  render();
}

// --- Drawing ---

function updateDrawing(e) {
  if (!drawing || !lastPoint) return;
  const nextPoint = getWorldPoint(e);
  const color = colorInput.value;

  if (currentMode === "endless") {
    const screenSize = erasing ? Number(eraserSizeInput.value) : Number(brushInput.value);
    const worldSize = screenSize / endlessViewport.scale;
    const brushStyle = brushStyleInput.value;
    const stroke = {
      from: { x: lastPoint.x, y: lastPoint.y },
      to: { x: nextPoint.x, y: nextPoint.y },
      color, size: worldSize, brushStyle,
      erase: erasing, endless: true
    };
    endlessStrokes.push(stroke);
    renderEndlessIncremental(stroke);
    socket.emit("draw_segment", stroke);
    if (currentEndlessGroup) currentEndlessGroup.push(stroke);
  } else {
    const size = erasing ? Number(eraserSizeInput.value) : Number(brushInput.value);
    const brushStyle = brushStyleInput.value;
    const cmd = new DrawCommand(activeLayerIndex, lastPoint, nextPoint, color, size, erasing, brushStyle);
    cmd.execute();
    if (currentCommandGroup) currentCommandGroup.push(cmd);
    socket.emit("draw_segment", {
      from: normalizePoint(lastPoint),
      to: normalizePoint(nextPoint),
      color, size,
      layer: activeLayerIndex,
      erase: erasing,
      brushStyle
    });
  }
  lastPoint = nextPoint;
}

function finishDrawing() {
  drawing = false;
  lastPoint = null;
  activePointerId = null;
  if (currentMode === "normal") {
    if (currentCommandGroup && currentCommandGroup.length > 0) pushCommand(currentCommandGroup);
    currentCommandGroup = null;
  } else {
    if (currentEndlessGroup && currentEndlessGroup.length > 0) {
      endlessUndoStack.push(currentEndlessGroup);
      if (endlessUndoStack.length > 30) endlessUndoStack.shift();
      endlessRedoStack = [];
    }
    currentEndlessGroup = null;
    renderEndless();
  }
}

function cancelDrawing() {
  drawing = false;
  lastPoint = null;
  activePointerId = null;
  if (currentMode === "normal") {
    if (currentCommandGroup && currentCommandGroup.length > 0) pushCommand(currentCommandGroup);
    currentCommandGroup = null;
  } else {
    if (currentEndlessGroup && currentEndlessGroup.length > 0) {
      endlessUndoStack.push(currentEndlessGroup);
      endlessRedoStack = [];
    }
    currentEndlessGroup = null;
  }
}

function doFill(e) {
  const pt = getWorldPoint(e);
  const color = colorInput.value;
  if (currentMode === "endless") return; // no fill in endless mode
  const px = Math.floor(pt.x);
  const py = Math.floor(pt.y);
  const cmd = new FillCommand(activeLayerIndex, px, py, color);
  cmd.execute();
  pushCommand(cmd);
  socket.emit("draw_segment", {
    fill: true,
    x: pt.x / CANVAS_W, y: pt.y / CANVAS_H,
    color, layer: activeLayerIndex
  });
  try { board.releasePointerCapture(e.pointerId); } catch {}
  pointers.delete(e.pointerId);
  interactionState = "idle";
}

function doPickColor(e) {
  const pt = getWorldPoint(e);
  pickColorAtPoint(pt);
  selectTool("brush");
  try { board.releasePointerCapture(e.pointerId); } catch {}
  pointers.delete(e.pointerId);
  interactionState = "idle";
}

// ============================================================
// ZOOM
// ============================================================

function handleWheel(e) {
  // 3D orbit scroll
  if (show3d && currentMode === "normal") {
    e.preventDefault();
    orbit25d.rotY += (e.deltaX * 0.15) || 0;
    orbit25d.rotX = Math.max(-80, Math.min(80, orbit25d.rotX + e.deltaY * 0.15));
    update25dTransform();
    return;
  }

  e.preventDefault();
  const rect = board.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const vp = currentMode === "endless" ? endlessViewport : normalViewport;
  const maxScale = currentMode === "endless" ? 500 : 10;
  const minScale = currentMode === "endless" ? 0.01 : 0.1;
  const worldX = mouseX / vp.scale + vp.x;
  const worldY = mouseY / vp.scale + vp.y;
  const factor = e.deltaY > 0 ? 0.9 : 1 / 0.9;
  vp.scale = Math.max(minScale, Math.min(maxScale, vp.scale * factor));
  vp.x = worldX - mouseX / vp.scale;
  vp.y = worldY - mouseY / vp.scale;
  render();
}

function zoomAtCenter(factor) {
  const rect = board.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const vp = currentMode === "endless" ? endlessViewport : normalViewport;
  const maxScale = currentMode === "endless" ? 500 : 10;
  const minScale = currentMode === "endless" ? 0.01 : 0.1;
  const worldX = cx / vp.scale + vp.x;
  const worldY = cy / vp.scale + vp.y;
  vp.scale = Math.max(minScale, Math.min(maxScale, vp.scale * factor));
  vp.x = worldX - cx / vp.scale;
  vp.y = worldY - cy / vp.scale;
  render();
}

function resetView() {
  if (currentMode === "endless") endlessViewport = { x: 0, y: 0, scale: 1 };
  else normalViewport = { x: 0, y: 0, scale: 1 };
  render();
}

function updateZoomIndicator() {
  if (!zoomIndicator || !zoomLevelEl) return;
  const vp = currentMode === "endless" ? endlessViewport : normalViewport;
  const pct = vp.scale * 100;
  zoomIndicator.style.display = "flex";
  if (pct >= 10000) zoomLevelEl.textContent = Math.round(pct / 1000) + "K%";
  else if (pct >= 100) zoomLevelEl.textContent = Math.round(pct) + "%";
  else if (pct >= 1) zoomLevelEl.textContent = pct.toFixed(1) + "%";
  else zoomLevelEl.textContent = pct.toFixed(2) + "%";
}

// ============================================================
// UI SETUP
// ============================================================

function setupUI() {
  // Tool selection
  if (brushBtn) brushBtn.addEventListener("click", () => selectTool("brush"));
  if (colorPickBtn) colorPickBtn.addEventListener("click", () => selectTool("pick-color"));
  if (eraserBtn) eraserBtn.addEventListener("click", () => selectTool("eraser"));
  if (bucketBtn) bucketBtn.addEventListener("click", () => selectTool("fill"));

  // Brush size display
  if (brushInput) brushInput.addEventListener("input", () => { brushValue.textContent = brushInput.value + "px"; });
  if (eraserSizeInput) eraserSizeInput.addEventListener("input", () => { eraserSizeValue.textContent = eraserSizeInput.value + "px"; });

  // Color popup
  if (colorInput) colorInput.addEventListener("input", () => { if (colorWrap) colorWrap.classList.add("open"); });
  if (colorOk) colorOk.addEventListener("click", () => { if (colorWrap) colorWrap.classList.remove("open"); });

  // Download
  if (downloadBtn) downloadBtn.addEventListener("click", () => { if (downloadWrap) downloadWrap.classList.toggle("open"); });
  if (dlPng) dlPng.addEventListener("click", () => { downloadImage("png"); if (downloadWrap) downloadWrap.classList.remove("open"); });
  if (dlJpg) dlJpg.addEventListener("click", () => { downloadImage("jpg"); if (downloadWrap) downloadWrap.classList.remove("open"); });

  // Fullscreen
  if (fullscreenBtn) fullscreenBtn.addEventListener("click", () => setFullscreenMode(!fullscreenMode));

  // Dark mode
  if (darkToggle) darkToggle.addEventListener("click", () => {
    const dark = !document.body.classList.contains("dark");
    localStorage.setItem("draw-dark-mode", dark ? "true" : "false");
    applyDarkMode();
  });

  // Clear canvas (per-user: only clears YOUR strokes)
  if (clearButton) clearButton.addEventListener("click", () => {
    if (!confirm("Clear all YOUR drawings on this page?")) return;
    socket.emit("clear_canvas", { mode: currentMode });
  });

  // Copy invite link
  if (copyButton) copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copyButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => {
        copyButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
      }, 1200);
    } catch { alert("Clipboard access blocked."); }
  });

  // Room join/create
  if (joinBtn) joinBtn.addEventListener("click", () => { const code = roomInput.value.trim(); if (code) applyRoom(code); });
  if (roomInput) roomInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinBtn.click(); });
  if (newRoomBtn) newRoomBtn.addEventListener("click", () => applyRoom(generateRoomCode()));

  // Layers
  if (layersBtn) layersBtn.addEventListener("click", () => { layersWrap.classList.toggle("open"); renderLayersList(); });
  if (addLayerBtn) addLayerBtn.addEventListener("click", () => addLayer());
  if (removeLayerBtn) removeLayerBtn.addEventListener("click", () => removeLayer(activeLayerIndex));

  // Mode switching
  if (modesBtn) modesBtn.addEventListener("click", () => modesWrap.classList.toggle("open"));
  const modeNormalBtn = document.getElementById("mode-normal-btn");
  const modeEndlessBtn = document.getElementById("mode-endless-btn");
  if (modeNormalBtn) modeNormalBtn.addEventListener("click", () => switchMode("normal"));
  if (modeEndlessBtn) modeEndlessBtn.addEventListener("click", () => switchMode("endless"));
  const modeGuessBtn = document.getElementById("mode-guess-btn");
  if (modeGuessBtn) modeGuessBtn.addEventListener("click", () => switchMode("guess"));

  // 3D toggle
  if (toggle3dBtn) toggle3dBtn.addEventListener("click", () => toggle3dView());

  // Undo/Redo
  if (undoBtn) undoBtn.addEventListener("click", handleUndo);
  if (redoBtn) redoBtn.addEventListener("click", handleRedo);

  // Zoom buttons (work for both modes now)
  if (zoomInBtn) zoomInBtn.addEventListener("click", () => zoomAtCenter(1.5));
  if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => zoomAtCenter(1 / 1.5));
  if (zoomResetBtn) zoomResetBtn.addEventListener("click", resetView);

  // Keyboard
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && fullscreenMode) setFullscreenMode(false);
    const vp = currentMode === "endless" ? endlessViewport : normalViewport;
    const step = 40 / vp.scale;
    if (e.key === "ArrowLeft")  { vp.x -= step; render(); e.preventDefault(); }
    if (e.key === "ArrowRight") { vp.x += step; render(); e.preventDefault(); }
    if (e.key === "ArrowUp")    { vp.y -= step; render(); e.preventDefault(); }
    if (e.key === "ArrowDown")  { vp.y += step; render(); e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "z") { handleUndo(); e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "y") { handleRedo(); e.preventDefault(); }
  });

  // Close popups on outside click
  document.addEventListener("click", (e) => {
    if (brushWrap && !brushWrap.contains(e.target)) brushWrap.classList.remove("open");
    if (eraserWrap && !eraserWrap.contains(e.target)) eraserWrap.classList.remove("open");
    if (downloadWrap && !downloadWrap.contains(e.target)) downloadWrap.classList.remove("open");
    if (colorWrap && !colorWrap.contains(e.target)) colorWrap.classList.remove("open");
    if (layersWrap && !layersWrap.contains(e.target)) layersWrap.classList.remove("open");
    if (modesWrap && !modesWrap.contains(e.target)) modesWrap.classList.remove("open");
  });

  // Resize
  window.addEventListener("resize", configureCanvas);
  window.addEventListener("orientationchange", configureCanvas);

  // Sync dark mode across tabs
  window.addEventListener("storage", (e) => {
    if (e.key === "draw-dark-mode") applyDarkMode();
  });
}

function selectTool(tool) {
  erasing = tool === "eraser";
  filling = tool === "fill";
  pickingColor = tool === "pick-color";
  if (brushBtn) brushBtn.classList.toggle("active", tool === "brush");
  if (colorPickBtn) colorPickBtn.classList.toggle("active", tool === "pick-color");
  if (eraserBtn) eraserBtn.classList.toggle("active", tool === "eraser");
  if (bucketBtn) bucketBtn.classList.toggle("active", tool === "fill");
  if (brushWrap) brushWrap.classList.toggle("open", tool === "brush");
  if (eraserWrap) eraserWrap.classList.toggle("open", tool === "eraser");
  board.style.cursor = tool === "eraser" ? "none" : (tool === "fill" || tool === "pick-color") ? "pointer" : "crosshair";
  if (tool !== "eraser" && eraserCursor) eraserCursor.style.display = "none";
}

function switchMode(mode) {
  const page = mode === "endless" ? "/page2.html" : mode === "guess" ? "/guess.html" : "/index.html";
  const url = new URL(window.location.origin + page);
  url.searchParams.set("room", roomId);
  window.location.href = url.toString();
}

// ============================================================
// UNDO / REDO
// ============================================================

function handleUndo() {
  if (currentMode === "endless") {
    if (endlessUndoStack.length === 0) return;
    const group = endlessUndoStack.pop();
    for (const stroke of group) {
      const idx = endlessStrokes.indexOf(stroke);
      if (idx !== -1) endlessStrokes.splice(idx, 1);
    }
    endlessRedoStack.push(group);
    if (endlessRedoStack.length > 30) endlessRedoStack.shift();
    renderEndless();
  } else {
    if (undoStack.length === 0) return;
    const last = undoStack.pop();
    if (Array.isArray(last)) { for (let i = last.length - 1; i >= 0; i--) last[i].undo(); }
    else last.undo();
    redoStack.push(last);
    if (redoStack.length > 30) redoStack.shift();
  }
}

function handleRedo() {
  if (currentMode === "endless") {
    if (endlessRedoStack.length === 0) return;
    const group = endlessRedoStack.pop();
    for (const stroke of group) endlessStrokes.push(stroke);
    endlessUndoStack.push(group);
    if (endlessUndoStack.length > 30) endlessUndoStack.shift();
    renderEndless();
  } else {
    if (redoStack.length === 0) return;
    const next = redoStack.pop();
    if (Array.isArray(next)) { for (let i = 0; i < next.length; i++) next[i].execute(); }
    else next.execute();
    undoStack.push(next);
    if (undoStack.length > 30) undoStack.shift();
  }
}

function pushCommand(cmd) {
  undoStack.push(cmd);
  if (undoStack.length > 30) undoStack.shift();
  redoStack = [];
}

// ============================================================
// CLEAR CANVAS (local helper)
// ============================================================

function clearCanvasLocal() {
  if (currentMode === "endless") {
    endlessStrokes.length = 0;
    endlessUndoStack = [];
    endlessRedoStack = [];
    renderEndless();
  } else {
    layers.forEach(l => l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height));
    undoStack = [];
    redoStack = [];
    compositeLayers();
  }
}

// ============================================================
// DOWNLOAD (Normal Mode)
// ============================================================

function downloadImage(format) {
  const tmp = document.createElement("canvas");
  tmp.width = CANVAS_W;
  tmp.height = CANVAS_H;
  const tc = tmp.getContext("2d");
  if (format === "jpg") { tc.fillStyle = "#fff"; tc.fillRect(0, 0, CANVAS_W, CANVAS_H); }
  layers.forEach(l => { if (l.visible) tc.drawImage(l.canvas, 0, 0); });
  const link = document.createElement("a");
  link.download = format === "jpg" ? "drawing.jpg" : "drawing.png";
  link.href = format === "jpg" ? tmp.toDataURL("image/jpeg", 0.95) : tmp.toDataURL("image/png");
  link.click();
}

// ============================================================
// FULLSCREEN
// ============================================================

function setFullscreenMode(enabled) {
  fullscreenMode = enabled;
  document.body.classList.toggle("canvas-fullscreen", enabled);
  if (fullscreenBtn) {
    fullscreenBtn.classList.toggle("active", enabled);
    fullscreenBtn.title = enabled ? "Exit fullscreen" : "Toggle fullscreen canvas";
    fullscreenBtn.innerHTML = enabled
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
  }
  if (enabled) window.scrollTo({ top: 0, behavior: "auto" });
  requestAnimationFrame(configureCanvas);
}

// ============================================================
// 3D VIEW (Normal Mode Only)
// ============================================================

function toggle3dView() {
  if (currentMode === "endless") return;
  show3d = !show3d;
  document.body.classList.toggle("show-3d", show3d);
  if (toggle3dBtn) toggle3dBtn.classList.toggle("active", show3d);
  if (show3d) {
    orbit25d = { rotX: -25, rotY: 35 };
    render25dScene();
  }
}

function render25dScene() {
  const scene = document.getElementById("scene-25d");
  if (!scene) return;
  scene.innerHTML = "";
  const count = layers.length;
  const spacing = 80;

  for (let i = 0; i < count; i++) {
    const l = layers[i];
    if (!l.visible && !l.onion) continue;
    const plane = document.createElement("div");
    plane.className = "layer-plane-25d" + (i === activeLayerIndex ? " active-layer-plane" : "");
    plane.style.transform = "translateZ(" + ((i - (count - 1) / 2) * spacing) + "px)";
    const c = document.createElement("canvas");
    c.width = l.canvas.width;
    c.height = l.canvas.height;
    c.getContext("2d").drawImage(l.canvas, 0, 0);
    plane.appendChild(c);
    const label = document.createElement("span");
    label.className = "layer-label-25d";
    label.textContent = l.name + (i === activeLayerIndex ? " \u25CF" : "");
    plane.appendChild(label);
    scene.appendChild(plane);
  }

  const view = document.getElementById("view-25d");
  if (view && !view.querySelector(".view-25d-hint")) {
    const hint = document.createElement("div");
    hint.className = "view-25d-hint";
    hint.textContent = "Right-click drag to orbit \u00B7 Scroll to rotate";
    view.appendChild(hint);
  }
  update25dTransform();
}

function update25dTransform() {
  const scene = document.getElementById("scene-25d");
  if (scene) scene.style.transform = "rotateX(" + orbit25d.rotX + "deg) rotateY(" + orbit25d.rotY + "deg)";
}

function refresh25dCanvases() {
  if (show3d) render25dScene();
}

// ============================================================
// ENDLESS MODE RENDERING
// ============================================================

function scheduleEndlessRender() {
  if (endlessRafId) return;
  endlessRafId = requestAnimationFrame(() => { endlessRafId = null; renderEndless(); });
}

function renderEndless() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = board.width;
  const h = board.height;

  boardCtx.save();
  boardCtx.setTransform(1, 0, 0, 1, 0, 0);
  boardCtx.clearRect(0, 0, w, h);

  const s = endlessViewport.scale * dpr;
  const worldLeft = endlessViewport.x;
  const worldTop = endlessViewport.y;
  const worldRight = worldLeft + w / s;
  const worldBottom = worldTop + h / s;

  drawEndlessGrid(s, w, h);

  const tx = -endlessViewport.x * s;
  const ty = -endlessViewport.y * s;
  boardCtx.setTransform(s, 0, 0, s, tx, ty);

  for (const stroke of endlessStrokes) {
    if (!stroke.from || !stroke.to) continue;
    const margin = stroke.size * 2;
    const sMinX = Math.min(stroke.from.x, stroke.to.x) - margin;
    const sMaxX = Math.max(stroke.from.x, stroke.to.x) + margin;
    const sMinY = Math.min(stroke.from.y, stroke.to.y) - margin;
    const sMaxY = Math.max(stroke.from.y, stroke.to.y) + margin;
    if (sMaxX < worldLeft || sMinX > worldRight || sMaxY < worldTop || sMinY > worldBottom) continue;
    renderEndlessStroke(boardCtx, stroke);
  }

  boardCtx.restore();
  updateZoomIndicator();
}

function renderEndlessIncremental(stroke) {
  if (!stroke.from || !stroke.to) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const s = endlessViewport.scale * dpr;
  const tx = -endlessViewport.x * s;
  const ty = -endlessViewport.y * s;
  boardCtx.save();
  boardCtx.setTransform(s, 0, 0, s, tx, ty);
  renderEndlessStroke(boardCtx, stroke);
  boardCtx.restore();
}

function drawEndlessGrid(s, w, h) {
  let gridSize = 50;
  while (gridSize * s < 25) gridSize *= 5;
  while (gridSize * s > 250) gridSize /= 5;

  const isDark = document.body.classList.contains("dark");
  const worldLeft = endlessViewport.x;
  const worldTop = endlessViewport.y;
  const worldRight = endlessViewport.x + w / s;
  const worldBottom = endlessViewport.y + h / s;

  boardCtx.save();
  boardCtx.setTransform(1, 0, 0, 1, 0, 0);
  boardCtx.strokeStyle = isDark ? "rgba(255,255,255,0.06)" : "rgba(16,42,67,0.06)";
  boardCtx.lineWidth = 1;

  const firstX = Math.floor(worldLeft / gridSize) * gridSize;
  const firstY = Math.floor(worldTop / gridSize) * gridSize;
  for (let gx = firstX; gx <= worldRight; gx += gridSize) {
    const px = (gx - endlessViewport.x) * s;
    boardCtx.beginPath(); boardCtx.moveTo(px, 0); boardCtx.lineTo(px, h); boardCtx.stroke();
  }
  for (let gy = firstY; gy <= worldBottom; gy += gridSize) {
    const py = (gy - endlessViewport.y) * s;
    boardCtx.beginPath(); boardCtx.moveTo(0, py); boardCtx.lineTo(w, py); boardCtx.stroke();
  }

  // Origin axes
  const ox = (0 - endlessViewport.x) * s;
  const oy = (0 - endlessViewport.y) * s;
  boardCtx.strokeStyle = isDark ? "rgba(255,255,255,0.18)" : "rgba(16,42,67,0.18)";
  boardCtx.lineWidth = 1.5;
  if (ox > -1 && ox < w + 1) { boardCtx.beginPath(); boardCtx.moveTo(ox, 0); boardCtx.lineTo(ox, h); boardCtx.stroke(); }
  if (oy > -1 && oy < h + 1) { boardCtx.beginPath(); boardCtx.moveTo(0, oy); boardCtx.lineTo(w, oy); boardCtx.stroke(); }
  boardCtx.restore();
}

function renderEndlessStroke(ctx, stroke) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const effectiveScale = endlessViewport.scale * dpr;
  const pixelWidth = stroke.size * effectiveScale;
  if (pixelWidth < 0.25) return;

  ctx.save();

  if (stroke.erase) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = ctx.strokeStyle = "#000";
    ctx.globalAlpha = 1;
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = ctx.strokeStyle = stroke.color;
    ctx.globalAlpha = 1;
  }

  // Very wide strokes: filled polygon fallback
  if (pixelWidth > 2000) {
    const hw = stroke.size / 2;
    const ddx = stroke.to.x - stroke.from.x;
    const ddy = stroke.to.y - stroke.from.y;
    const len = Math.hypot(ddx, ddy);
    if (len > 0) {
      const nx = -ddy / len * hw, ny = ddx / len * hw;
      ctx.beginPath();
      ctx.moveTo(stroke.from.x + nx, stroke.from.y + ny);
      ctx.lineTo(stroke.to.x + nx, stroke.to.y + ny);
      ctx.lineTo(stroke.to.x - nx, stroke.to.y - ny);
      ctx.lineTo(stroke.from.x - nx, stroke.from.y - ny);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(stroke.from.x, stroke.from.y, hw, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.size;

  if (!stroke.erase) {
    switch (stroke.brushStyle) {
      case "marker": ctx.globalAlpha = 0.35; break;
      case "flat": ctx.lineCap = "butt"; ctx.lineWidth = stroke.size * 1.4; break;
      case "dry":
        ctx.globalAlpha = 0.55;
        ctx.setLineDash([stroke.size * 0.6, stroke.size * 1]);
        break;
      case "fan": {
        const fdx = stroke.to.x - stroke.from.x;
        const fdy = stroke.to.y - stroke.from.y;
        const flen = Math.hypot(fdx, fdy);
        if (flen > 0) {
          const fnx = -fdy / flen, fny = fdx / flen;
          const spacing = stroke.size / 4;
          ctx.lineWidth = Math.max(0.3, stroke.size * 0.25);
          for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.moveTo(stroke.from.x + fnx * spacing * i, stroke.from.y + fny * spacing * i);
            ctx.lineTo(stroke.to.x + fnx * spacing * i, stroke.to.y + fny * spacing * i);
            ctx.stroke();
          }
          ctx.restore();
          return;
        }
        break;
      }
    }
  }

  ctx.beginPath();
  ctx.moveTo(stroke.from.x, stroke.from.y);
  ctx.lineTo(stroke.to.x, stroke.to.y);
  ctx.stroke();
  ctx.restore();
}

// ============================================================
// HISTORY REPLAY
// ============================================================

function replayHistory(history) {
  if (!history || history.length === 0) return;

  if (currentMode === "endless") {
    for (const seg of history) {
      if (seg.endless || seg.mode === "endless") {
        endlessStrokes.push(seg);
      }
    }
    renderEndless();
  } else {
    // Ensure at least one layer exists
    if (layers.length === 0) addLayer();
    for (const seg of history) {
      if (seg.mode && seg.mode !== "normal") continue;
      const li = seg.layer !== undefined && seg.layer < layers.length ? seg.layer : 0;
      // Ensure target layer exists
      while (layers.length <= li) addLayer();
      if (seg.fill) {
        floodFill(Math.floor(seg.x * CANVAS_W), Math.floor(seg.y * CANVAS_H), seg.color, li, true);
      } else if (seg.from && seg.to) {
        drawSegment(denormalizePoint(seg.from), denormalizePoint(seg.to), seg.color, seg.size, li, seg.erase, seg.brushStyle, true);
      }
    }
    compositeLayers();
  }
}

// ============================================================
// COLOR UTILITIES
// ============================================================

function pickColorAtPoint(point) {
  if (currentMode !== "normal") return;
  const x = Math.max(0, Math.min(CANVAS_W - 1, Math.floor(point.x)));
  const y = Math.max(0, Math.min(CANVAS_H - 1, Math.floor(point.y)));
  const layer = layers[activeLayerIndex];
  if (!layer) return;
  const pixel = layer.ctx.getImageData(x, y, 1, 1).data;
  const a = pixel[3] / 255;
  colorInput.value = rgbToHex(
    Math.round(pixel[0] * a + 255 * (1 - a)),
    Math.round(pixel[1] * a + 255 * (1 - a)),
    Math.round(pixel[2] * a + 255 * (1 - a))
  );
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

// ============================================================
// DARK MODE
// ============================================================

function applyDarkMode() {
  const setting = localStorage.getItem("draw-dark-mode");
  const dark = setting !== "false"; // default to dark
  document.body.classList.toggle("dark", dark);
  if (darkToggle) darkToggle.textContent = dark ? "\u2600\uFE0F" : "\uD83C\uDF19";
}

// ============================================================
// MODE-SPECIFIC UI
// ============================================================

function applyModeUI() {
  // Mode label
  if (modeLabel) modeLabel.textContent = currentMode === "endless" ? '"Endless"' : "Normal";

  // Highlight active mode button
  const modeNormalBtn = document.getElementById("mode-normal-btn");
  const modeEndlessBtn = document.getElementById("mode-endless-btn");
  if (modeNormalBtn) modeNormalBtn.classList.toggle("active", currentMode === "normal");
  if (modeEndlessBtn) modeEndlessBtn.classList.toggle("active", currentMode === "endless");

  // In endless mode: hide layers, 3D, download
  if (currentMode === "endless") {
    if (layersWrap) layersWrap.style.display = "none";
    if (toggle3dBtn) toggle3dBtn.style.display = "none";
    if (downloadWrap) downloadWrap.style.display = "none";
    if (activeLayerLabel) activeLayerLabel.style.display = "none";
  }

  // Show zoom indicator for both modes
  if (zoomIndicator) zoomIndicator.style.display = "flex";
  updateZoomIndicator();
}
