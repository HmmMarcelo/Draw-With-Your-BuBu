// 2K canvas constants and viewport object
const CANVAS_W = 2560;
const CANVAS_H = 1440;
let normalViewport = { x: 0, y: 0, scale: 1 };
let _panActive = false;
let _panStart = null;
let _panViewStart = null;
const socket = io();

const board = document.getElementById("board");
const boardCtx = board.getContext("2d");
const colorInput = document.getElementById("color");
// Set default brush color to white
if (colorInput) colorInput.value = '#ffffff';
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
// Undo/Redo stacks per user (for normal mode only)
// Command Pattern Undo/Redo
class Command {
  execute() {}
  undo() {}
}

class DrawCommand extends Command {
  constructor(layer, from, to, color, size, erase, brushStyle) {
    super();
    this.layer = layer;
    this.from = { ...from };
    this.to = { ...to };
    this.color = color;
    this.size = size;
    this.erase = erase;
    this.brushStyle = brushStyle;
    this.prevImage = null;
  }
  execute() {
    const l = layers[this.layer];
    // Calculate bounding box for the stroke, always at least 1x1
    const minX = Math.floor(Math.min(this.from.x, this.to.x) - this.size - 2);
    const minY = Math.floor(Math.min(this.from.y, this.to.y) - this.size - 2);
    const maxX = Math.ceil(Math.max(this.from.x, this.to.x) + this.size + 2);
    const maxY = Math.ceil(Math.max(this.from.y, this.to.y) + this.size + 2);
    const x = Math.max(0, minX);
    const y = Math.max(0, minY);
    const w = Math.max(1, Math.min(l.canvas.width, maxX) - x);
    const h = Math.max(1, Math.min(l.canvas.height, maxY) - y);
    this._undoBox = { x, y, w, h };
    try {
      this.prevImage = l.ctx.getImageData(x, y, w, h, { willReadFrequently: true });
    } catch (e) {
      this.prevImage = null; // If region is invalid, skip undo for this segment
    }
    drawSegment(this.from, this.to, this.color, this.size, this.layer, this.erase, this.brushStyle);
  }
  undo() {
    const l = layers[this.layer];
    if (this.prevImage && this._undoBox) {
      l.ctx.putImageData(this.prevImage, this._undoBox.x, this._undoBox.y);
    }
    compositeLayers();
  }
}

class FillCommand extends Command {
  constructor(layer, x, y, color) {
    super();
    this.layer = layer;
    this.x = x;
    this.y = y;
    this.color = color;
    this.prevImage = null;
  }
  execute() {
    const l = layers[this.layer];
    // For fill, fallback to full canvas (could optimize with flood bounds, but keep safe)
    this.prevImage = l.ctx.getImageData(0, 0, l.canvas.width, l.canvas.height, { willReadFrequently: true });
    floodFill(this.x, this.y, this.color, this.layer);
  }
  undo() {
    const l = layers[this.layer];
    if (this.prevImage) l.ctx.putImageData(this.prevImage, 0, 0);
    compositeLayers();
  }
}

let undoStack = [];
let redoStack = [];
let currentCommandGroup = null;
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

let endlessStrokes = [];

let currentMode = "normal";

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
      if (currentMode === "endless") {
        endlessStrokes.push({
          from: segment.from,
          to: segment.to,
          color: segment.color,
          size: segment.size,
          brushStyle: segment.brushStyle || "round",
          erase: segment.erase || false
        });
        renderEndless();
      }
      return;
    }
    if (segment.fill) {
      const px = Math.floor(segment.x * CANVAS_W);
      const py = Math.floor(segment.y * CANVAS_H);
      floodFill(px, py, segment.color, li);
    } else {
      drawSegment(segment.from, segment.to, segment.color, segment.size, li, segment.erase, segment.brushStyle);
    }
  });

  socket.on("clear_canvas", (data) => {
    if (!data || !data.mode || data.mode === currentMode) {
      clearCanvas();
    }
  });

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
        const px = Math.floor(segment.x * CANVAS_W);
        const py = Math.floor(segment.y * CANVAS_H);
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
          // Scroll-to-zoom in normal mode
          board.addEventListener("wheel", (e) => {
            if (currentMode !== "normal" || show3d) return;
            e.preventDefault();
            const rect = board.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            // World point under mouse before zoom
            const worldX = mouseX / normalViewport.scale + normalViewport.x;
            const worldY = mouseY / normalViewport.scale + normalViewport.y;
            const factor = e.deltaY > 0 ? 0.9 : 1 / 0.9;
            normalViewport.scale = Math.max(0.1, Math.min(10, normalViewport.scale * factor));
            // Repin world point under mouse
            normalViewport.x = worldX - mouseX / normalViewport.scale;
            normalViewport.y = worldY - mouseY / normalViewport.scale;
            compositeLayers();
          }, { passive: false });
        // Keyboard arrow key pan
        window.addEventListener("keydown", (e) => {
          if (currentMode !== "normal") return;
          const step = 40 / normalViewport.scale;
          if (e.key === "ArrowLeft")  { normalViewport.x -= step; compositeLayers(); e.preventDefault(); }
          if (e.key === "ArrowRight") { normalViewport.x += step; compositeLayers(); e.preventDefault(); }
          if (e.key === "ArrowUp")    { normalViewport.y -= step; compositeLayers(); e.preventDefault(); }
          if (e.key === "ArrowDown")  { normalViewport.y += step; compositeLayers(); e.preventDefault(); }
        });
      // Pan with right-click drag (normal mode)
      board.addEventListener("pointerdown", (e) => {
        if (currentMode !== "normal" || show3d) return;
        if (e.button === 2) {
          _panActive = true;
          _panStart = { x: e.clientX, y: e.clientY };
          _panViewStart = { x: normalViewport.x, y: normalViewport.y };
          board.setPointerCapture(e.pointerId);
          board.style.cursor = "grabbing";
          e.preventDefault();
        }
      });
      window.addEventListener("pointermove", (e) => {
        if (!_panActive) return;
        normalViewport.x = _panViewStart.x - (e.clientX - _panStart.x) / normalViewport.scale;
        normalViewport.y = _panViewStart.y - (e.clientY - _panStart.y) / normalViewport.scale;
        compositeLayers();
      });
      window.addEventListener("pointerup", () => {
        if (_panActive) {
          _panActive = false;
          board.style.cursor = "crosshair";
        }
      });
      board.addEventListener("contextmenu", (e) => e.preventDefault());
    // Undo/Redo button handlers
    const undoBtn = document.getElementById("undo-btn");
    const redoBtn = document.getElementById("redo-btn");
    if (undoBtn) undoBtn.addEventListener("click", handleUndo);
    if (redoBtn) redoBtn.addEventListener("click", handleRedo);
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
      const px = Math.floor(pt.x);
      const py = Math.floor(pt.y);
      const color = colorInput.value;
      const cmd = new FillCommand(activeLayerIndex, px, py, color);
      cmd.execute();
      pushCommand(cmd);
      socket.emit("draw_segment", {
        fill: true,
        x: pt.x / CANVAS_W,
        y: pt.y / CANVAS_H,
        color,
        layer: activeLayerIndex,
        endless: currentMode === "endless"
      });
      if (captured) board.releasePointerCapture(event.pointerId);
      activePointerId = null;
      if (currentMode === "endless") endlessStrokes.push({ type: "fill", x: pt.x / CANVAS_W, y: pt.y / CANVAS_H, color, layer: activeLayerIndex });
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
    // Start a new command group for undo
    currentCommandGroup = [];
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

    const cmd = new DrawCommand(activeLayerIndex, lastPoint, nextPoint, color, size, erasing, brushStyle);
    cmd.execute();
    if (currentCommandGroup) currentCommandGroup.push(cmd);
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
    // On pointer up, push the command group to undo stack
    if (currentCommandGroup && currentCommandGroup.length > 0) {
      pushCommand(currentCommandGroup);
    }
    currentCommandGroup = null;
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

  // Always start in dark mode unless user explicitly chose light mode
  if (localStorage.getItem("darkMode") === null || localStorage.getItem("darkMode") === "1") {
    document.body.classList.add("dark");
    darkToggle.textContent = "☀️";
  } else {
    document.body.classList.remove("dark");
    darkToggle.textContent = "🌙";
  }

  clearButton.addEventListener("click", () => {
    if (!confirm("Are you sure you want to clear the canvas?")) return;
    clearCanvas();
    socket.emit("clear_canvas", { mode: currentMode });
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
  // Endless mode button remains, but does nothing

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
  window.addEventListener("orientationchange", configureCanvas);
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
  // DPR-aware internal resolution
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

  if (currentMode === "endless") {
    renderEndless();
  } else {
    compositeLayers();
  }
}

function clearCanvas() {
  if (currentMode === "endless") {
    endlessStrokes.length = 0;
    renderEndless();
  } else {
    layers.forEach(l => {
      l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
    });
    undoStack = [];
    redoStack = [];
    compositeLayers();
  }

}

// Undo/Redo logic (normal mode only)
function handleUndo() {
  if (undoStack.length === 0) return;
  const last = undoStack.pop();
  if (Array.isArray(last)) {
    for (let i = last.length - 1; i >= 0; i--) last[i].undo();
  } else {
    last.undo();
  }
  redoStack.push(last);
  if (redoStack.length > 10) redoStack.shift();
}

function handleRedo() {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  if (Array.isArray(next)) {
    for (let i = 0; i < next.length; i++) next[i].execute();
  } else {
    next.execute();
  }
  undoStack.push(next);
  if (undoStack.length > 10) undoStack.shift();
}

function pushCommand(cmd) {
  undoStack.push(cmd);
  if (undoStack.length > 10) undoStack.shift();
  redoStack = [];
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
  // For normal mode, from/to are already in world/canvas coordinates
  const start = from;
  const end = to;

  const x0 = Math.round(start.x);
  const y0 = Math.round(start.y);
  const x1 = Math.round(end.x);
  const y1 = Math.round(end.y);
  const radius = Math.max(1, Math.round(size / 2));

  let r = 0, g = 0, b = 0;
  if (!isErase) {
    r = parseInt(color.slice(1, 3), 16);
    g = parseInt(color.slice(3, 5), 16);
    b = parseInt(color.slice(5, 7), 16);
  }

  const w = layer.canvas.width;
  const h = layer.canvas.height;

  const imageData = lCtx.getImageData(0, 0, w, h, { willReadFrequently: true });
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
  let w = layer.canvas.width; // CANVAS_W
  let h = layer.canvas.height; // CANVAS_H
  // In endless mode, restrict fill to visible world viewport
  let worldViewport = null;
  if (currentMode === "endless") {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const s = endlessViewport.scale * dpr;
    // Canvas pixel (0,0) maps to world (endlessViewport.x, endlessViewport.y)
    // Canvas pixel (w-1,h-1) maps to world (endlessViewport.x + (w-1)/s, endlessViewport.y + (h-1)/s)
    worldViewport = {
      left: endlessViewport.x,
      top: endlessViewport.y,
      right: endlessViewport.x + w / s,
      bottom: endlessViewport.y + h / s
    };
  }
  if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;

  const imageData = lCtx.getImageData(0, 0, w, h, { willReadFrequently: true });
  const data = imageData.data;

  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  const idx = (startY * w + startX) * 4;
  const sr = data[idx], sg = data[idx + 1], sb = data[idx + 2], sa = data[idx + 3];

  if (sr === r && sg === g && sb === b && sa === 255) return;

  function matches(i, x, y) {
    // If in endless mode, restrict to visible world viewport
    if (worldViewport) {
      // Convert pixel (x, y) to world coordinates
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const s = endlessViewport.scale * dpr;
      const wx = endlessViewport.x + x / s;
      const wy = endlessViewport.y + y / s;
      if (wx < worldViewport.left || wx > worldViewport.right || wy < worldViewport.top || wy > worldViewport.bottom) return false;
    }
    return data[i] === sr && data[i + 1] === sg && data[i + 2] === sb && data[i + 3] === sa;
  }

  const stack = [[startX, startY]];

  while (stack.length) {
    const [sx, sy] = stack.pop();
    let x = sx;

    // Move left within world viewport
    while (x > 0 && matches(((sy * w) + x - 1) * 4, x - 1, sy)) x--;

    let spanUp = false;
    let spanDown = false;

    while (x < w) {
      const i = (sy * w + x) * 4;
      if (!matches(i, x, sy)) break;

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;

      if (sy > 0) {
        if (matches(((sy - 1) * w + x) * 4, x, sy - 1)) {
          if (!spanUp) { stack.push([x, sy - 1]); spanUp = true; }
        } else { spanUp = false; }
      }

      if (sy < h - 1) {
        if (matches(((sy + 1) * w + x) * 4, x, sy + 1)) {
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
    x: point.x / CANVAS_W,
    y: point.y / CANVAS_H
  };
}

function denormalizePoint(point) {
  return {
    x: point.x * CANVAS_W,
    y: point.y * CANVAS_H
  };
}

function getRelativePoint(event) {
  const rect = board.getBoundingClientRect();
  const cssX = event.clientX - rect.left;
  const cssY = event.clientY - rect.top;
  // CSS px → world (layer canvas) coords
  return {
    x: cssX / normalViewport.scale + normalViewport.x,
    y: cssY / normalViewport.scale + normalViewport.y
  };

// Pan with right-click drag in normal mode
board.addEventListener("pointerdown", (e) => {
  if (show3d || currentMode === "endless") return;
  if (e.button === 2) { // right-click
    isPanning = true;
    panStart = { x: e.clientX, y: e.clientY };
    panOrigin = { x: panX, y: panY };
    board.setPointerCapture(e.pointerId);
    board.style.cursor = "grabbing";
    e.preventDefault();
  }
});

board.addEventListener("pointermove", (e) => {
  if (show3d || currentMode === "endless") return;
  if (isPanning && panStart) {
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;
    panX = panOrigin.x + dx;
    panY = panOrigin.y + dy;
    board.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    e.preventDefault();
  }
});

board.addEventListener("pointerup", (e) => {
  if (show3d || currentMode === "endless") return;
  if (isPanning) {
    isPanning = false;
    panStart = null;
    panOrigin = null;
    board.style.cursor = "crosshair";
    e.preventDefault();
  }
});

board.addEventListener("contextmenu", (e) => {
  if (show3d || currentMode === "endless") return;
  e.preventDefault(); // prevent default context menu on right-click
});
}

function pickColorAtPoint(point) {
  // point is already in layer canvas space from getRelativePoint
  const x = Math.max(0, Math.min(CANVAS_W - 1, Math.floor(point.x)));
  const y = Math.max(0, Math.min(CANVAS_H - 1, Math.floor(point.y)));
  const activeLayer = layers[activeLayerIndex];
  const src = activeLayer ? activeLayer.ctx : boardCtx;
  const pixel = src.getImageData(x, y, 1, 1).data;
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
  c.width = CANVAS_W;
  c.height = CANVAS_H;
  const lCtx = c.getContext("2d");
  lCtx.imageSmoothingEnabled = true;
  lCtx.imageSmoothingQuality = "high";
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
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  boardCtx.save();
  boardCtx.setTransform(1, 0, 0, 1, 0, 0);
  boardCtx.clearRect(0, 0, board.width, board.height);

  // Transform: scale then translate for pan
  const s = normalViewport.scale * dpr;
  const tx = -normalViewport.x * s;
  const ty = -normalViewport.y * s;
  boardCtx.setTransform(s, 0, 0, s, tx, ty);

  // Draw layers
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].visible) boardCtx.drawImage(layers[i].canvas, 0, 0);
  }

  // Dotted border around the 2K canvas area
  boardCtx.save();
  boardCtx.setLineDash([8, 8]);
  boardCtx.lineWidth = 2 / s;
  boardCtx.strokeStyle = "rgba(120,120,180,0.6)";
  boardCtx.strokeRect(0, 0, CANVAS_W, CANVAS_H);
  boardCtx.restore();

  boardCtx.restore();
  refresh25dCanvases();
  // Pan button logic
  const panBtn = document.getElementById("pan-btn");
  let panToolActive = false;
  if (panBtn) {
    panBtn.addEventListener("click", () => {
      panToolActive = !panToolActive;
      panBtn.style.background = panToolActive ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.85)";
      board.style.cursor = panToolActive ? "grab" : (erasing ? "none" : "crosshair");
    });
  }

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

    // Drag events (if you want to support reordering)
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


// setMode and endless mode logic removed

function handleEndlessPointerDown(event) {
    // Always start a new stroke group for undo/redo in endless mode
    currentStroke = { type: "strokeGroup", actions: [] };
    if (filling) {
      const rect = board.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      const color = colorInput.value;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const px = Math.floor(cx * dpr);
      const py = Math.floor(cy * dpr);
      floodFill(px, py, color, activeLayerIndex);
      socket.emit("draw_segment", {
        fill: true,
        x: cx / board.clientWidth,
        y: cy / board.clientHeight,
        color,
        layer: activeLayerIndex,
        endless: true
      });
      currentStroke.actions.push({ type: "fill", x: cx / board.clientWidth, y: cy / board.clientHeight, color, layer: activeLayerIndex, endless: true });
      // On fill, immediately push to undoStack
      if (currentStroke.actions.length > 0) {
        undoStack.push(currentStroke);
        if (undoStack.length > 15) undoStack.shift();
        redoStack = [];
      }
      currentStroke = null;
      try { board.releasePointerCapture(event.pointerId); } catch (e) {}
      endlessPointers.delete(event.pointerId);
      renderEndless();
      return;
    }
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
    erase: erasing,
    endless: true,
    layer: activeLayerIndex
  };

  endlessStrokes.push(stroke);
  renderEndlessIncremental(stroke);

  socket.emit("draw_segment", stroke);

  // Add to current stroke group for undo/redo
  if (currentStroke) {
    currentStroke.actions.push({
      type: "stroke",
      from: { x: lastPoint.x, y: lastPoint.y },
      to: { x: worldPt.x, y: worldPt.y },
      color,
      size: worldSize,
      brushStyle,
      erase: erasing,
      endless: true,
      layer: activeLayerIndex
    });
  }
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
    // On pointer up, push the stroke group to undo stack (if not empty)
    if (currentStroke && currentStroke.actions.length > 0) {
      undoStack.push(currentStroke);
      if (undoStack.length > 15) undoStack.shift();
      redoStack = [];
    }
    currentStroke = null;
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
    if (stroke.type === "fill") {
      // Fill in endless mode
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const px = Math.floor(stroke.x * board.clientWidth * dpr);
      const py = Math.floor(stroke.y * board.clientHeight * dpr);
      floodFill(px, py, stroke.color, stroke.layer);
      continue;
    }
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
    // In 3D mode, skip rendering invisible layers entirely
    if (!l.visible) continue;
    const plane = document.createElement("div");
    plane.className = "layer-plane-25d";
    if (i === activeLayerIndex) plane.classList.add("active-layer-plane");

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

  // Instead of updating planes in place, just re-render the scene to match visible layers
  render25dScene();
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