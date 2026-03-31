# Draw Together

A two-person or more, real-time drawing canvas built with Socket.IO + HTML5 Canvas.

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Start server:

```bash
npm start
```

3. Open in browser:

```text
http://localhost:3000
```

4. Share the URL with your partner.
   - The `room` query parameter is auto-generated.
   - Example: `http://localhost:3000/?room=abc123`

## Why this architecture

- WebSockets (Socket.IO): low-latency stroke sync in both directions.
- Room-limited sessions: each room allows max 2 users for predictable performance.
- Normalized coordinates: remote strokes render correctly on different screen sizes.
- High-DPI canvas scaling: sharp lines on retina/high-density displays.
- Pointer events: smooth pen/mouse/touch drawing on desktop and mobile.

## Current features

- Shared room links for pairing
- Real-time line segment sync
- Brush size and color controls
- Clear canvas sync
- Partner presence status

## Recommended next upgrades

- Light interpolation/smoothing (quadratic curves)
- Reconnect and room state replay
- Optional persistence (save snapshots)
- Deploy on Render/Railway/Fly with HTTPS

## Recent Updates (2026-03-27)

**Major 2026 Refactor & UI Improvements**

- **Fixed 2K canvas with pan/zoom:** The drawing area is now a fixed 2560×1440 (16:9) canvas, with a pan/zoomable viewport for easy navigation and high-DPI support.
- **High-DPI and aspect-ratio aware:** Drawing is always sharp and accurate, regardless of device pixel ratio or window size.
- **Unified coordinate system:** All drawing, fill, and color pick operations use robust world-to-viewport mapping for perfect accuracy.
- **Modern, full-width UI:** The site UI now fills the browser window with a small gap on the sides, and the canvas is always 16:9 and never stretches or distorts.
- **Undo/redo with Command Pattern:** Undo/redo is robust, efficient, and works for all tools.
- **Bug fixes:** Fixed drawing visibility, pan/zoom glitches, and ensured all tools work across the entire canvas area.
- **All features preserved:** Layers, fill, color pick, and all tools work seamlessly with the new system.


- Endless mode incomming. 