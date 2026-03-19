# Draw Together

A two-person, real-time drawing canvas built with Socket.IO + HTML5 Canvas.

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

- Stroke history + undo/redo sync
- Light interpolation/smoothing (quadratic curves)
- Reconnect and room state replay
- Optional persistence (save snapshots)
- Deploy on Render/Railway/Fly with HTTPS
