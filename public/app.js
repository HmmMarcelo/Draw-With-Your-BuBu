const socket = io();

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
const activeLayerLabel = document.getElementById("active-layer-label");
const brushWrap = brushBtn.closest(".tool-wrap");
const eraserWrap = eraserBtn.closest(".tool-wrap");
const eraserCursor = document.getElementById("eraser-cursor");

let drawing = false;
let lastPoint = null;
let activePointerId = null;
let erasing = false;
let filling = false;
let pickingColor = false;
let fullscreenMode = false;
let roomId = getRoomFromUrl();
let selectTool;

let layers = [];
let activeLayerIndex = 0;

// Endless mode state
let currentMode = "normal";
let endlessViewport = { x: 0, y: 0, scale: 1 };
let endlessStrokes = [];
const endlessPointers = new Map();
let endlessPinchState = null;
let endlessPanning = false;
let endlessPanStart = null;
let endlessPanViewportStart = null;

// 3D view toggle state
let show3d = false;
let orbit25d = { rotX: -25, rotY: 35 };
let orbitDragging = false;
let orbitDragStart = null;
let orbitStart = null;

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
    if (segment.endless) {
      endlessStrokes.push({
        from: segment.from,
        to: segment.to,
        color: segment.color,
        size: segment.size,
        brushStyle: segment.brushStyle || "round",
        erase: segment.erase || false
      });
      if (currentMode === "endless") renderEndless();
      return;
    }
    if (segment.fill) {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const px = Math.floor(segment.x * board.clientWidth * dpr);
      const py = Math.floor(segment.y * board.clientHeight * dpr);
      floodFill(px, py, segment.color, li);
    } else {
      drawSegment(segment.from, segment.to, segment.color, segment.size, li, segment.erase, segment.brushStyle);
    }
  });

  socket.on("clear_canvas", clearCanvas);

  // Late-join: replay drawing history from server
  socket.on("draw_history", (history) => {
    for (const segment of history) {
      const li = segment.layer !== undefined && segment.layer < layers.length ? segment.layer : 0;
      if (segment.endless) {
        endlessStrokes.push({
          from: segment.from,
          to: segment.to,
          color: segment.color,
          size: segment.size,
          brushStyle: segment.brushStyle || "round",
          erase: segment.erase || false
        });
      } else if (segment.fill) {
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const px = Math.floor(segment.x * board.clientWidth * dpr);
        const py = Math.floor(segment.y * board.clientHeight * dpr);
        floodFill(px, py, segment.color, li);
      } else {
        drawSegment(segment.from, segment.to, segment.color, segment.size, li, segment.erase, segment.brushStyle);
      }
    }
    // Render endless strokes if in endless mode
    if (currentMode === "endless" && endlessStrokes.length > 0) renderEndless();
  });
}

function setupUI() {
  board.addEventListener("pointerdown", (event) => {
    if (currentMode === "endless") { handleEndlessPointerDown(event); return; }
    if (event.button !== 0) return;
    if (activePointerId !== null) return;
    if (event.pointerType === "touch") event.preventDefault();
    activePointerId = event.pointerId;

    let captured = false;
    if (board.setPointerCapture) {
      try {
        board.setPointerCapture(event.pointerId);
        captured = true;
      } catch {
        captured = false;
      }
    }

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
      if (captured) board.releasePointerCapture(event.pointerId);
      activePointerId = null;
      return;
    }

    if (pickingColor) {
      const pt = getRelativePoint(event);
      pickColorAtPoint(pt);
      selectTool("brush");
      if (captured) board.releasePointerCapture(event.pointerId);
      activePointerId = null;
      return;
    }

    drawing = true;
    lastPoint = getRelativePoint(event);
  });

  board.addEventListener("pointermove", (event) => {
    if (currentMode === "endless") { handleEndlessPointerMove(event); return; }
    if (event.pointerId !== activePointerId) return;
    if (event.pointerType === "touch") event.preventDefault();
    if (!drawing || !lastPoint) return;

    const nextPoint = getRelativePoint(event);
    const color = colorInput.value;
    const size = erasing ? Number(eraserSizeInput.value) : Number(brushInput.value);
    const brushStyle = brushStyleInput.value;

    drawSegment(lastPoint, nextPoint, color, size, activeLayerIndex, erasing, brushStyle);
    socket.emit("draw_segment", {
      from: normalizePoint(lastPoint),
      to: normalizePoint(nextPoint),
      color,
      size,
      layer: activeLayerIndex,
      erase: erasing,
      brushStyle
    });

    lastPoint = nextPoint;
  });

  const stopDrawing = () => {
    if (activePointerId !== null && board.hasPointerCapture && board.hasPointerCapture(activePointerId)) {
      board.releasePointerCapture(activePointerId);
    }
    drawing = false;
    lastPoint = null;
    activePointerId = null;
  };

  board.addEventListener("pointerup", (event) => {
    if (currentMode === "endless") { handleEndlessPointerUp(event); return; }
    if (event.pointerType === "touch") event.preventDefault();
    if (event.pointerId !== activePointerId) return;
    stopDrawing();
  });

  board.addEventListener("pointercancel", (event) => {
    if (currentMode === "endless") { handleEndlessPointerUp(event); return; }
    if (event.pointerId !== activePointerId) return;
    stopDrawing();
  });

  board.addEventListener("pointerleave", () => {
    eraserCursor.style.display = "none";
  });

  board.addEventListener("pointermove", (event) => {
    if (erasing && event.pointerType !== "touch") {
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

  selectTool = function(tool) {
    erasing = tool === "eraser";
    filling = tool === "fill";
    pickingColor = tool === "pick-color";
    brushBtn.classList.toggle("active", tool === "brush");
    colorPickBtn.classList.toggle("active", tool === "pick-color");
    eraserBtn.classList.toggle("active", tool === "eraser");
    bucketBtn.classList.toggle("active", tool === "fill");
    brushWrap.classList.toggle("open", tool === "brush");
    eraserWrap.classList.toggle("open", tool === "eraser");
    board.style.cursor = tool === "eraser" ? "none" : tool === "fill" || tool === "pick-color" ? "pointer" : "crosshair";
    if (tool !== "eraser") eraserCursor.style.display = "none";
  };

  brushBtn.addEventListener("click", () => selectTool("brush"));
  colorPickBtn.addEventListener("click", () => selectTool("pick-color"));
  eraserBtn.addEventListener("click", () => selectTool("eraser"));
  bucketBtn.addEventListener("click", () => selectTool("fill"));

  document.addEventListener("click", (e) => {
    if (!brushWrap.contains(e.target)) brushWrap.classList.remove("open");
    if (!eraserWrap.contains(e.target)) eraserWrap.classList.remove("open");
    if (!downloadWrap.contains(e.target)) downloadWrap.classList.remove("open");
    if (!colorWrap.contains(e.target)) colorWrap.classList.remove("open");
    if (!layersWrap.contains(e.target)) layersWrap.classList.remove("open");
    const mw = document.getElementById("modes-wrap");
    if (mw && !mw.contains(e.target)) mw.classList.remove("open");
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

  fullscreenBtn.addEventListener("click", () => {
    setFullscreenMode(!fullscreenMode);
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

  // Modes
  const modesWrap = document.getElementById("modes-wrap");
  const modesBtn = document.getElementById("modes-btn");
  const modeNormalBtn = document.getElementById("mode-normal-btn");
  const modeEndlessBtn = document.getElementById("mode-endless-btn");
  if (modesBtn) modesBtn.addEventListener("click", () => modesWrap.classList.toggle("open"));
  if (modeNormalBtn) modeNormalBtn.addEventListener("click", () => setMode("normal"));
  if (modeEndlessBtn) modeEndlessBtn.addEventListener("click", () => setMode("endless"));

  // 3D toggle button
  const toggle3dBtn = document.getElementById("toggle-3d-btn");
  if (toggle3dBtn) toggle3dBtn.addEventListener("click", () => toggle3dView());

  // Endless mode wheel zoom
  board.addEventListener("wheel", handleEndlessWheel, { passive: false });
  // Prevent middle-mouse auto-scroll
  board.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });

  // Zoom buttons
  const zoomInBtn = document.getElementById("zoom-in-btn");
  const zoomOutBtn = document.getElementById("zoom-out-btn");
  const zoomResetBtn = document.getElementById("zoom-reset-btn");
  if (zoomInBtn) zoomInBtn.addEventListener("click", () => { if (currentMode === "endless") zoomAtCenter(1.5); });
  if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => { if (currentMode === "endless") zoomAtCenter(1 / 1.5); });
  if (zoomResetBtn) zoomResetBtn.addEventListener("click", () => { if (currentMode === "endless") resetEndlessView(); });

  window.addEventListener("resize", configureCanvas);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && fullscreenMode) {
      setFullscreenMode(false);
    }
  });
}

function setFullscreenMode(enabled) {
  fullscreenMode = enabled;
  document.body.classList.toggle("canvas-fullscreen", enabled);
  fullscreenBtn.classList.toggle("active", enabled);
  fullscreenBtn.title = enabled ? "Exit fullscreen canvas" : "Toggle fullscreen canvas";
  fullscreenBtn.innerHTML = enabled
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

  if (enabled) {
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  requestAnimationFrame(() => {
    configureCanvas();
  });
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

  if (currentMode === "endless") {
    renderEndless();
  } else {
    compositeLayers();
  }
}

function clearCanvas() {
  endlessStrokes.length = 0;
  layers.forEach(l => {
    l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
  });
  if (currentMode === "endless") {
    renderEndless();
  } else {
    compositeLayers();
  }
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

function drawSegment(from, to, color, size, layerIdx, isErase, brushStyle = "round") {
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

  function stableNoise(x, y, seed) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
    return n - Math.floor(n);
  }

  function paintPixel(px, py, alpha = 1) {
    if (px < 0 || px >= w || py < 0 || py >= h) return;
    const i = (py * w + px) * 4;
    if (isErase) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
      return;
    }

    const srcA = data[i + 3] / 255;
    const outA = alpha + srcA * (1 - alpha);
    if (outA <= 0) return;

    data[i] = Math.round((r * alpha + data[i] * srcA * (1 - alpha)) / outA);
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
        if (dx * dx + dy * dy <= rSq) {
          paintPixel(px, py, 1);
        }
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
        const edge = Math.abs(dx) / halfW;
        const alpha = edge > 0.92 ? 0.65 : 0.95;
        paintPixel(px, py, alpha);
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
        const edge = Math.sqrt(distSq) / radius;
        const alpha = edge > 0.85 ? 0.28 : 0.38;
        paintPixel(px, py, alpha);
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
        const grain = stableNoise(px, py, 1);
        if (grain < 0.33) continue;
        const alpha = 0.55 + stableNoise(px, py, 2) * 0.4;
        paintPixel(px, py, alpha);
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
          const fy = py + f;
          const alpha = 0.6 - Math.abs(f) / (fringe + 1) * 0.35;
          paintPixel(px, fy, Math.max(0.2, alpha));
        }
      }
    }
  }

  function stamp(cx, cy) {
    if (isErase) {
      stampRound(cx, cy);
      return;
    }

    switch (brushStyle) {
      case "flat":
        stampFlat(cx, cy);
        break;
      case "marker":
        stampMarker(cx, cy);
        break;
      case "dry":
        stampDry(cx, cy);
        break;
      case "fan":
        stampFan(cx, cy);
        break;
      case "round":
      default:
        stampRound(cx, cy);
        break;
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

function pickColorAtPoint(point) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const x = Math.max(0, Math.min(board.width - 1, Math.floor(point.x * dpr)));
  const y = Math.max(0, Math.min(board.height - 1, Math.floor(point.y * dpr)));
  const pixel = boardCtx.getImageData(x, y, 1, 1).data;
  const alpha = pixel[3] / 255;

  const r = Math.round(pixel[0] * alpha + 255 * (1 - alpha));
  const g = Math.round(pixel[1] * alpha + 255 * (1 - alpha));
  const b = Math.round(pixel[2] * alpha + 255 * (1 - alpha));

  colorInput.value = rgbToHex(r, g, b);
}

function rgbToHex(r, g, b) {
  const toHex = (value) => value.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
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

function compositeLayers() {
  boardCtx.save();
  boardCtx.setTransform(1, 0, 0, 1, 0, 0);
  boardCtx.clearRect(0, 0, board.width, board.height);
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].visible) boardCtx.drawImage(layers[i].canvas, 0, 0);
  }
  boardCtx.restore();
  refresh25dCanvases();
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
      updateLayerLabel();
      renderLayersList();
    });

    // Drag events
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
    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over");
    });
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      item.classList.remove("drag-over");
      const dropIndex = parseInt(item.dataset.index, 10);
      if (dragSrcIndex === null || dragSrcIndex === dropIndex) return;
      const moved = layers.splice(dragSrcIndex, 1)[0];
      layers.splice(dropIndex, 0, moved);
      if (activeLayerIndex === dragSrcIndex) {
        activeLayerIndex = dropIndex;
      } else {
        if (activeLayerIndex > dragSrcIndex && activeLayerIndex <= dropIndex) activeLayerIndex--;
        else if (activeLayerIndex < dragSrcIndex && activeLayerIndex >= dropIndex) activeLayerIndex++;
      }
      compositeLayers();
      updateLayerLabel();
      renderLayersList();
    });

    layersList.appendChild(item);
  }
}

// ===== Endless Mode =====

function screenToWorld(cssX, cssY) {
  return {
    x: cssX / endlessViewport.scale + endlessViewport.x,
    y: cssY / endlessViewport.scale + endlessViewport.y
  };
}

function setMode(mode) {
  drawing = false;
  lastPoint = null;
  activePointerId = null;
  endlessPointers.clear();
  endlessPinchState = null;
  endlessPanning = false;

  currentMode = mode;
  document.body.classList.toggle("mode-endless", mode === "endless");

  const modeLabel = document.getElementById("mode-label");
  const modesWrap = document.getElementById("modes-wrap");
  const modeNormalBtn = document.getElementById("mode-normal-btn");
  const modeEndlessBtn = document.getElementById("mode-endless-btn");

  if (modeNormalBtn) modeNormalBtn.classList.toggle("active", mode === "normal");
  if (modeEndlessBtn) modeEndlessBtn.classList.toggle("active", mode === "endless");
  const labels = { normal: "Normal", endless: "Endless" };
  if (modeLabel) modeLabel.textContent = labels[mode] || mode;
  if (modesWrap) modesWrap.classList.remove("open");

  if (mode === "endless") {
    endlessViewport = { x: 0, y: 0, scale: 1 };
    updateZoomIndicator();
  }

  // Refresh 3D if active
  if (show3d) render25dScene();

  configureCanvas();
}

function handleEndlessPointerDown(event) {
  if (event.pointerType === "touch") event.preventDefault();

  const rect = board.getBoundingClientRect();
  const cx = event.clientX - rect.left;
  const cy = event.clientY - rect.top;

  endlessPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  try { board.setPointerCapture(event.pointerId); } catch (e) {}

  // Two fingers → pinch/pan
  if (endlessPointers.size >= 2) {
    drawing = false;
    lastPoint = null;
    activePointerId = null;
    startEndlessPinch();
    return;
  }

  // Middle mouse or Alt+click → pan
  if (event.button === 1 || (event.button === 0 && event.altKey)) {
    endlessPanning = true;
    endlessPanStart = { x: event.clientX, y: event.clientY };
    endlessPanViewportStart = { x: endlessViewport.x, y: endlessViewport.y };
    return;
  }

  // Right-click → ignore for drawing (used by 3D orbit / context menu)
  if (event.button !== 0) return;

  if (pickingColor) {
    pickColorAtPoint({ x: cx, y: cy });
    selectTool("brush");
    try { board.releasePointerCapture(event.pointerId); } catch (e) {}
    endlessPointers.delete(event.pointerId);
    return;
  }

  if (filling) {
    try { board.releasePointerCapture(event.pointerId); } catch (e) {}
    endlessPointers.delete(event.pointerId);
    return;
  }

  activePointerId = event.pointerId;
  drawing = true;
  lastPoint = screenToWorld(cx, cy);
}

function handleEndlessPointerMove(event) {
  if (event.pointerType === "touch") event.preventDefault();

  if (endlessPointers.has(event.pointerId)) {
    endlessPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  // Panning
  if (endlessPanning && endlessPanStart) {
    const dx = event.clientX - endlessPanStart.x;
    const dy = event.clientY - endlessPanStart.y;
    endlessViewport.x = endlessPanViewportStart.x - dx / endlessViewport.scale;
    endlessViewport.y = endlessPanViewportStart.y - dy / endlessViewport.scale;
    scheduleEndlessRender();
    return;
  }

  // Pinch/pan with two fingers
  if (endlessPointers.size >= 2 && endlessPinchState) {
    updateEndlessPinch();
    return;
  }

  // Drawing
  if (event.pointerId !== activePointerId) return;
  if (!drawing || !lastPoint) return;

  const rect = board.getBoundingClientRect();
  const cx = event.clientX - rect.left;
  const cy = event.clientY - rect.top;
  const worldPt = screenToWorld(cx, cy);

  const color = colorInput.value;
  const screenSize = erasing ? Number(eraserSizeInput.value) : Number(brushInput.value);
  const worldSize = Math.min(screenSize / endlessViewport.scale, screenSize * 50);
  const brushStyle = brushStyleInput.value;

  const stroke = {
    from: { x: lastPoint.x, y: lastPoint.y },
    to: { x: worldPt.x, y: worldPt.y },
    color,
    size: worldSize,
    brushStyle,
    erase: erasing
  };

  endlessStrokes.push(stroke);
  renderEndlessIncremental(stroke);

  socket.emit("draw_segment", {
    from: stroke.from,
    to: stroke.to,
    color,
    size: worldSize,
    brushStyle,
    erase: erasing,
    endless: true,
    layer: activeLayerIndex
  });

  lastPoint = worldPt;

  if (erasing && event.pointerType !== "touch") {
    const size = Number(eraserSizeInput.value);
    eraserCursor.style.display = "block";
    eraserCursor.style.width = size + "px";
    eraserCursor.style.height = size + "px";
    const stageRect = board.closest(".canvas-stage").getBoundingClientRect();
    eraserCursor.style.left = (event.clientX - stageRect.left) + "px";
    eraserCursor.style.top = (event.clientY - stageRect.top) + "px";
  }
}

function handleEndlessPointerUp(event) {
  if (event.pointerType === "touch") event.preventDefault();

  endlessPointers.delete(event.pointerId);
  try { board.releasePointerCapture(event.pointerId); } catch (e) {}

  if (endlessPointers.size < 2) {
    endlessPinchState = null;
  }

  if (endlessPanning) {
    endlessPanning = false;
    endlessPanStart = null;
    endlessPanViewportStart = null;
  }

  if (event.pointerId === activePointerId) {
    drawing = false;
    lastPoint = null;
    activePointerId = null;
    if (currentMode === "endless") renderEndless();
  }
}

function startEndlessPinch() {
  const pts = [...endlessPointers.values()];
  if (pts.length < 2) return;

  const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  const cx = (pts[0].x + pts[1].x) / 2;
  const cy = (pts[0].y + pts[1].y) / 2;
  const rect = board.getBoundingClientRect();

  endlessPinchState = {
    startDist: dist,
    startScale: endlessViewport.scale,
    startCenterCSS: { x: cx - rect.left, y: cy - rect.top },
    startViewport: { x: endlessViewport.x, y: endlessViewport.y }
  };
}

function updateEndlessPinch() {
  const pts = [...endlessPointers.values()];
  if (pts.length < 2 || !endlessPinchState) return;

  const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  const cx = (pts[0].x + pts[1].x) / 2;
  const cy = (pts[0].y + pts[1].y) / 2;
  const rect = board.getBoundingClientRect();
  const cssCX = cx - rect.left;
  const cssCY = cy - rect.top;

  const scaleRatio = dist / endlessPinchState.startDist;
  const newScale = Math.max(0.01, Math.min(500, endlessPinchState.startScale * scaleRatio));

  const worldCX = endlessPinchState.startCenterCSS.x / endlessPinchState.startScale + endlessPinchState.startViewport.x;
  const worldCY = endlessPinchState.startCenterCSS.y / endlessPinchState.startScale + endlessPinchState.startViewport.y;

  endlessViewport.scale = newScale;
  endlessViewport.x = worldCX - cssCX / newScale;
  endlessViewport.y = worldCY - cssCY / newScale;

  updateZoomIndicator();
  scheduleEndlessRender();
}

function handleEndlessWheel(event) {
  if (currentMode !== "endless") return;
  event.preventDefault();

  const rect = board.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  const worldX = mouseX / endlessViewport.scale + endlessViewport.x;
  const worldY = mouseY / endlessViewport.scale + endlessViewport.y;

  const zoomFactor = event.deltaY > 0 ? 0.9 : 1 / 0.9;
  const newScale = Math.max(0.01, Math.min(500, endlessViewport.scale * zoomFactor));

  endlessViewport.x = worldX - mouseX / newScale;
  endlessViewport.y = worldY - mouseY / newScale;
  endlessViewport.scale = newScale;

  updateZoomIndicator();
  scheduleEndlessRender();
}

let endlessRafId = null;

function scheduleEndlessRender() {
  if (endlessRafId) return;
  endlessRafId = requestAnimationFrame(() => {
    endlessRafId = null;
    renderEndless();
  });
}

function renderEndless() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = board.width;
  const h = board.height;

  boardCtx.save();
  boardCtx.setTransform(1, 0, 0, 1, 0, 0);
  boardCtx.clearRect(0, 0, w, h);

  const s = endlessViewport.scale * dpr;
  const tx = -endlessViewport.x * s;
  const ty = -endlessViewport.y * s;

  // Viewport bounds in world space for culling
  const worldLeft = endlessViewport.x;
  const worldTop = endlessViewport.y;
  const worldRight = endlessViewport.x + w / s;
  const worldBottom = endlessViewport.y + h / s;

  drawEndlessGrid(s, w, h);

  boardCtx.setTransform(s, 0, 0, s, tx, ty);

  for (const stroke of endlessStrokes) {
    // Viewport culling — skip strokes entirely outside view
    const margin = stroke.size * 2;
    const sMinX = Math.min(stroke.from.x, stroke.to.x) - margin;
    const sMaxX = Math.max(stroke.from.x, stroke.to.x) + margin;
    const sMinY = Math.min(stroke.from.y, stroke.to.y) - margin;
    const sMaxY = Math.max(stroke.from.y, stroke.to.y) + margin;
    if (sMaxX < worldLeft || sMinX > worldRight || sMaxY < worldTop || sMinY > worldBottom) continue;
    renderEndlessStroke(boardCtx, stroke);
  }

  boardCtx.restore();
}

function renderEndlessIncremental(stroke) {
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

  const firstX = Math.floor(worldLeft / gridSize) * gridSize;
  const firstY = Math.floor(worldTop / gridSize) * gridSize;

  boardCtx.save();
  boardCtx.setTransform(1, 0, 0, 1, 0, 0);
  boardCtx.strokeStyle = isDark ? "rgba(255,255,255,0.06)" : "rgba(16,42,67,0.06)";
  boardCtx.lineWidth = 1;

  for (let gx = firstX; gx <= worldRight; gx += gridSize) {
    const px = (gx - endlessViewport.x) * s;
    boardCtx.beginPath();
    boardCtx.moveTo(px, 0);
    boardCtx.lineTo(px, h);
    boardCtx.stroke();
  }
  for (let gy = firstY; gy <= worldBottom; gy += gridSize) {
    const py = (gy - endlessViewport.y) * s;
    boardCtx.beginPath();
    boardCtx.moveTo(0, py);
    boardCtx.lineTo(w, py);
    boardCtx.stroke();
  }

  // Origin axes
  const ox = (0 - endlessViewport.x) * s;
  const oy = (0 - endlessViewport.y) * s;
  boardCtx.strokeStyle = isDark ? "rgba(255,255,255,0.18)" : "rgba(16,42,67,0.18)";
  boardCtx.lineWidth = 1.5;
  if (ox >= -1 && ox <= w + 1) {
    boardCtx.beginPath(); boardCtx.moveTo(ox, 0); boardCtx.lineTo(ox, h); boardCtx.stroke();
  }
  if (oy >= -1 && oy <= h + 1) {
    boardCtx.beginPath(); boardCtx.moveTo(0, oy); boardCtx.lineTo(w, oy); boardCtx.stroke();
  }

  boardCtx.restore();
}

function renderEndlessStroke(ctx, stroke) {
  // Compute how wide this stroke is in actual screen pixels
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const effectiveScale = endlessViewport.scale * dpr;
  const pixelWidth = stroke.size * effectiveScale;

  // Skip strokes too thin to see
  if (pixelWidth < 0.25) return;

  ctx.save();

  if (stroke.erase) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    ctx.strokeStyle = "#000";
    ctx.globalAlpha = 1;
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = stroke.color;
    ctx.strokeStyle = stroke.color;
    ctx.globalAlpha = 1;
  }

  // For very wide strokes (> 2000 screen px), render as a filled rectangle
  // instead of a canvas line — prevents Canvas2D from choking on huge lineWidths
  if (pixelWidth > 2000) {
    const hw = stroke.size / 2;
    const dx = stroke.to.x - stroke.from.x;
    const dy = stroke.to.y - stroke.from.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const nx = -dy / len * hw;
      const ny = dx / len * hw;
      ctx.beginPath();
      ctx.moveTo(stroke.from.x + nx, stroke.from.y + ny);
      ctx.lineTo(stroke.to.x + nx, stroke.to.y + ny);
      ctx.lineTo(stroke.to.x - nx, stroke.to.y - ny);
      ctx.lineTo(stroke.from.x - nx, stroke.from.y - ny);
      ctx.closePath();
      ctx.fill();
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
      case "marker":
        ctx.globalAlpha = 0.35;
        break;
      case "flat":
        ctx.lineCap = "butt";
        ctx.lineWidth = stroke.size * 1.4;
        break;
      case "dry":
        ctx.globalAlpha = 0.55;
        ctx.setLineDash([stroke.size * 0.6, stroke.size * 1]);
        break;
      case "fan": {
        const dx = stroke.to.x - stroke.from.x;
        const dy = stroke.to.y - stroke.from.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          const nx = -dy / len;
          const ny = dx / len;
          const spacing = stroke.size / 4;
          ctx.lineWidth = Math.max(0.3, stroke.size * 0.25);
          for (let i = -2; i <= 2; i++) {
            const ox = nx * spacing * i;
            const oy = ny * spacing * i;
            ctx.beginPath();
            ctx.moveTo(stroke.from.x + ox, stroke.from.y + oy);
            ctx.lineTo(stroke.to.x + ox, stroke.to.y + oy);
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

function updateZoomIndicator() {
  const el = document.getElementById("zoom-level");
  if (!el) return;
  const pct = endlessViewport.scale * 100;
  if (pct >= 10000) {
    el.textContent = Math.round(pct / 1000) + "K%";
  } else if (pct >= 100) {
    el.textContent = Math.round(pct) + "%";
  } else if (pct >= 1) {
    el.textContent = pct.toFixed(1) + "%";
  } else {
    el.textContent = pct.toFixed(2) + "%";
  }
}

function zoomAtCenter(factor) {
  const rect = board.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const worldX = cx / endlessViewport.scale + endlessViewport.x;
  const worldY = cy / endlessViewport.scale + endlessViewport.y;
  const newScale = Math.max(0.01, Math.min(500, endlessViewport.scale * factor));
  endlessViewport.x = worldX - cx / newScale;
  endlessViewport.y = worldY - cy / newScale;
  endlessViewport.scale = newScale;
  updateZoomIndicator();
  scheduleEndlessRender();
}

function resetEndlessView() {
  endlessViewport = { x: 0, y: 0, scale: 1 };
  updateZoomIndicator();
  scheduleEndlessRender();
}

// ===== 3D Layer View =====

function toggle3dView() {
  show3d = !show3d;
  document.body.classList.toggle("show-3d", show3d);

  const btn = document.getElementById("toggle-3d-btn");
  if (btn) btn.classList.toggle("active", show3d);

  if (show3d) {
    orbit25d = { rotX: -25, rotY: 35 };
    setup25dOrbit();
    render25dScene();
  } else {
    teardown25dOrbit();
    // Remove hint
    const hint = document.querySelector(".view-25d-hint");
    if (hint) hint.remove();
  }
}

function render25dScene() {
  const scene = document.getElementById("scene-25d");
  if (!scene) return;

  scene.innerHTML = "";

  const count = layers.length;
  const spacing = 80; // px between layers on Z

  for (let i = 0; i < count; i++) {
    const l = layers[i];
    const plane = document.createElement("div");
    plane.className = "layer-plane-25d";
    if (i === activeLayerIndex) plane.classList.add("active-layer-plane");
    if (!l.visible) plane.style.opacity = "0.25";

    // Center the stack: layer 0 at back, topmost at front
    const zOffset = (i - (count - 1) / 2) * spacing;
    plane.style.transform = `translateZ(${zOffset}px)`;

    // Clone the layer canvas content into a visible canvas
    const c = document.createElement("canvas");
    c.width = l.canvas.width;
    c.height = l.canvas.height;
    c.getContext("2d").drawImage(l.canvas, 0, 0);
    plane.appendChild(c);

    // Label
    const label = document.createElement("span");
    label.className = "layer-label-25d";
    label.textContent = l.name + (i === activeLayerIndex ? " ●" : "");
    plane.appendChild(label);

    scene.appendChild(plane);
  }

  // Hint
  const existing = document.querySelector(".view-25d-hint");
  if (!existing) {
    const hint = document.createElement("div");
    hint.className = "view-25d-hint";
    hint.textContent = "Right-click drag or Alt+drag to orbit • Scroll to rotate • Draw normally";
    const view = document.getElementById("view-25d");
    if (view) view.appendChild(hint);
  }

  update25dTransform();
}

function update25dTransform() {
  const scene = document.getElementById("scene-25d");
  if (!scene) return;
  scene.style.transform = `rotateX(${orbit25d.rotX}deg) rotateY(${orbit25d.rotY}deg)`;
}

function refresh25dCanvases() {
  if (!show3d) return;
  const scene = document.getElementById("scene-25d");
  if (!scene) return;

  const planes = scene.querySelectorAll(".layer-plane-25d");
  planes.forEach((plane, i) => {
    if (i >= layers.length) return;
    const c = plane.querySelector("canvas");
    if (!c) return;
    const l = layers[i];
    if (c.width !== l.canvas.width || c.height !== l.canvas.height) {
      c.width = l.canvas.width;
      c.height = l.canvas.height;
    }
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(l.canvas, 0, 0);

    plane.style.opacity = l.visible ? "" : "0.25";
    plane.classList.toggle("active-layer-plane", i === activeLayerIndex);
    const label = plane.querySelector(".layer-label-25d");
    if (label) label.textContent = l.name + (i === activeLayerIndex ? " ●" : "");
  });

  // Re-render if layer count changed
  if (planes.length !== layers.length) render25dScene();
}

// Orbit handlers — right-click drag or Alt+drag on the board canvas
let _orbit25dPointerDown = null;
let _orbit25dPointerMove = null;
let _orbit25dPointerUp = null;
let _orbit25dContextMenu = null;
let _orbit25dWheel = null;

function setup25dOrbit() {
  _orbit25dContextMenu = (e) => {
    if (show3d) e.preventDefault();
  };

  _orbit25dPointerDown = (e) => {
    if (!show3d) return;
    // Right-click or Alt+left-click to orbit
    if (e.button === 2 || (e.button === 0 && e.altKey)) {
      orbitDragging = true;
      orbitDragStart = { x: e.clientX, y: e.clientY };
      orbitStart = { rotX: orbit25d.rotX, rotY: orbit25d.rotY };
      board.style.cursor = "grabbing";
      e.preventDefault();
      e.stopPropagation();
    }
  };

  _orbit25dPointerMove = (e) => {
    if (!orbitDragging || !orbitDragStart) return;
    const dx = e.clientX - orbitDragStart.x;
    const dy = e.clientY - orbitDragStart.y;
    orbit25d.rotY = orbitStart.rotY + dx * 0.4;
    orbit25d.rotX = Math.max(-80, Math.min(80, orbitStart.rotX + dy * 0.4));
    update25dTransform();
  };

  _orbit25dPointerUp = () => {
    if (orbitDragging) {
      orbitDragging = false;
      orbitDragStart = null;
      board.style.cursor = "crosshair";
    }
  };

  _orbit25dWheel = (e) => {
    if (!show3d) return;
    if (currentMode === "endless") return; // Let endless zoom handle it
    e.preventDefault();
    orbit25d.rotY += e.deltaX * 0.15 || 0;
    orbit25d.rotX = Math.max(-80, Math.min(80, orbit25d.rotX + e.deltaY * 0.15));
    update25dTransform();
  };

  board.addEventListener("pointerdown", _orbit25dPointerDown, true);
  board.addEventListener("contextmenu", _orbit25dContextMenu);
  window.addEventListener("pointermove", _orbit25dPointerMove);
  window.addEventListener("pointerup", _orbit25dPointerUp);
  board.addEventListener("wheel", _orbit25dWheel, { passive: false });
}

function teardown25dOrbit() {
  if (_orbit25dPointerDown) board.removeEventListener("pointerdown", _orbit25dPointerDown, true);
  if (_orbit25dContextMenu) board.removeEventListener("contextmenu", _orbit25dContextMenu);
  if (_orbit25dPointerMove) window.removeEventListener("pointermove", _orbit25dPointerMove);
  if (_orbit25dPointerUp) window.removeEventListener("pointerup", _orbit25dPointerUp);
  if (_orbit25dWheel) board.removeEventListener("wheel", _orbit25dWheel);
  _orbit25dPointerDown = null;
  _orbit25dPointerMove = null;
  _orbit25dPointerUp = null;
  _orbit25dContextMenu = null;
  _orbit25dWheel = null;
  orbitDragging = false;
}