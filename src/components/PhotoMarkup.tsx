"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Full-screen photo markup editor: draw freehand marks over a captured vehicle
 * photo, in two/three colours, with undo + clear. The number plate area is
 * pre-circled as a starting mark. "Attach to search" flattens the image +
 * marks into a single JPEG and hands it back.
 */

interface Point {
  x: number;
  y: number;
}
interface Stroke {
  color: string;
  points: Point[];
}

const COLORS = ["#ef4444", "#eab308", "#ffffff"]; // red, yellow, white

/** A red ellipse roughly where a number plate sits (bottom-centre). */
function platePreset(w: number, h: number): Stroke {
  const cx = w / 2;
  const cy = h * 0.72;
  const rx = w * 0.22;
  const ry = h * 0.055;
  const points: Point[] = [];
  for (let a = 0; a <= Math.PI * 2 + 0.15; a += 0.15) {
    points.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return { color: "#ef4444", points };
}

export default function PhotoMarkup({
  image,
  busy,
  onCancel,
  onAttach,
}: {
  image: string;
  busy?: boolean;
  onCancel: () => void;
  onAttach: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const currentRef = useRef<Stroke | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState(COLORS[0]);
  const [ready, setReady] = useState(false);

  // Load the photo, size the canvas, seed the plate circle.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = img.width;
        canvas.height = img.height;
      }
      setStrokes([platePreset(img.width, img.height)]);
      setReady(true);
    };
    img.src = image;
  }, [image]);

  const lineWidth = () => {
    const c = canvasRef.current;
    return c ? Math.max(4, c.width / 90) : 4;
  };

  function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
    if (s.points.length === 0) return;
    ctx.strokeStyle = s.color;
    ctx.beginPath();
    s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }

  // Full redraw whenever committed strokes change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = lineWidth();
    strokes.forEach((s) => drawStroke(ctx, s));
  }, [strokes, ready]);

  function toCanvas(e: React.PointerEvent): Point {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (c.width / r.width),
      y: (e.clientY - r.top) * (c.height / r.height),
    };
  }

  function onDown(e: React.PointerEvent) {
    if (busy) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    currentRef.current = { color, points: [toCanvas(e)] };
  }
  function onMove(e: React.PointerEvent) {
    const cur = currentRef.current;
    if (!cur) return;
    const pt = toCanvas(e);
    const prev = cur.points[cur.points.length - 1];
    cur.points.push(pt);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    // Draw just the new segment for smoothness (full redraw happens on commit).
    ctx.strokeStyle = cur.color;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = lineWidth();
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  }
  function onUp() {
    if (currentRef.current) {
      const done = currentRef.current;
      currentRef.current = null;
      setStrokes((prev) => [...prev, done]);
    }
  }

  function undo() {
    setStrokes((prev) => prev.slice(0, -1));
  }
  function clear() {
    const img = imgRef.current;
    setStrokes(img ? [platePreset(img.width, img.height)] : []);
  }
  function attach() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onAttach(canvas.toDataURL("image/jpeg", 0.8));
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button
          onClick={onCancel}
          aria-label="Cancel"
          className="grid h-9 w-9 place-items-center rounded-full bg-white/10"
        >
          ✕
        </button>
        <p className="text-sm font-semibold">Markup photo</p>
        <span className="h-9 w-9" />
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden px-2">
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="max-h-full max-w-full touch-none rounded-lg"
        />
      </div>

      <p className="px-4 pb-2 text-center text-xs text-white/70">
        The plate is circled to start — draw to add your own marks.
      </p>

      <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
              style={{ backgroundColor: c }}
              className={
                "h-8 w-8 rounded-full border-2 " +
                (color === c ? "border-white ring-2 ring-white/50" : "border-white/30")
              }
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={undo}
            disabled={strokes.length === 0}
            className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            ↶ Undo
          </button>
          <button
            onClick={clear}
            className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white"
          >
            🗑 Clear
          </button>
        </div>
      </div>

      <div className="p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <button
          onClick={attach}
          disabled={busy}
          className="w-full rounded-xl bg-teal px-4 py-3 text-sm font-bold text-white shadow-lg disabled:opacity-60"
        >
          {busy ? "Attaching…" : "✓ Attach to search"}
        </button>
      </div>
    </div>
  );
}
