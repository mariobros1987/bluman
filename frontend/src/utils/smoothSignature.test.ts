import { describe, it, expect, vi } from 'vitest';
import { SmoothStrokeTracker, getCanvasCoordinates } from './smoothSignature';

describe('SmoothStrokeTracker — Tratto fluido naturale per firme', () => {
  function createMockCtx(): CanvasRenderingContext2D {
    return {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      lineCap: 'butt',
      lineJoin: 'miter',
      lineWidth: 1,
      strokeStyle: '#000',
      fillStyle: '#000',
    } as unknown as CanvasRenderingContext2D;
  }

  it('un tocco singolo (tap) disegna un puntino circolare pieno per accenti e lettere come la i', () => {
    const tracker = new SmoothStrokeTracker({ strokeColor: '#1e1b4b', baseLineWidth: 2.4 });
    const ctx = createMockCtx();

    tracker.start(50, 60, 1000);
    tracker.end(ctx);

    expect(ctx.arc).toHaveBeenCalledWith(50, 60, expect.any(Number), 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('il primo movimento traccia una linea dal punto iniziale al punto medio', () => {
    const tracker = new SmoothStrokeTracker();
    const ctx = createMockCtx();

    tracker.start(10, 20, 1000);
    const moved = tracker.move(30, 40, ctx, 1050);

    expect(moved).toBe(true);
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 20);
    expect(ctx.lineTo).toHaveBeenCalledWith(20, 30); // midpoint (10+30)/2, (20+40)/2
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it('dal terzo punto in poi usa quadraticCurveTo per generare curve morbide senza spigoli', () => {
    const tracker = new SmoothStrokeTracker();
    const ctx = createMockCtx();

    tracker.start(0, 0, 1000);
    tracker.move(20, 20, ctx, 1050);
    tracker.move(40, 60, ctx, 1100);

    expect(ctx.quadraticCurveTo).toHaveBeenCalled();
    const [cpX, cpY, toX, toY] = (ctx.quadraticCurveTo as any).mock.calls[0];
    expect(cpX).toBe(20);
    expect(cpY).toBe(20);
    // toX, toY should be midpoint between (20,20) and (40,60) = (30, 40)
    expect(toX).toBe(30);
    expect(toY).toBe(40);
  });

  it('ignora micro-movimenti con distanza < 2px per evitare rumore e jitter', () => {
    const tracker = new SmoothStrokeTracker();
    const ctx = createMockCtx();

    tracker.start(10, 10, 1000);
    const moved = tracker.move(10.5, 10.5, ctx, 1010);

    expect(moved).toBe(false);
    expect(ctx.lineTo).not.toHaveBeenCalled();
  });

  it('getCanvasCoordinates normalizza le coordinate anche se il canvas è scalato via CSS', () => {
    const canvas = {
      width: 600,
      height: 200,
      getBoundingClientRect: () => ({
        left: 50,
        top: 100,
        width: 300, // Stretto alla metà rispetto a canvas.width
        height: 100, // Stretto alla metà rispetto a canvas.height
      }),
    } as unknown as HTMLCanvasElement;

    const mouseEvent = {
      clientX: 150, // 100px dentro il rect da sinistra
      clientY: 150, // 50px dentro il rect dall'alto
    } as unknown as MouseEvent;

    const coords = getCanvasCoordinates(mouseEvent, canvas);

    // Con scaleX = 2 (600/300) e scaleY = 2 (200/100):
    // x = (150 - 50) * 2 = 200
    // y = (150 - 100) * 2 = 100
    expect(coords.x).toBe(200);
    expect(coords.y).toBe(100);
  });

  it('getCanvasCoordinates estrae la pressione da touch.force o pointer.pressure', () => {
    const canvas = {
      width: 400,
      height: 100,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 100 }),
    } as unknown as HTMLCanvasElement;

    const touchEvent = {
      touches: [{ clientX: 10, clientY: 20, force: 0.85 }],
    } as any;

    const coords = getCanvasCoordinates(touchEvent, canvas);
    expect(coords.x).toBe(10);
    expect(coords.y).toBe(20);
    expect(coords.pressure).toBe(0.85);
  });

  it('supporta variazione di tratto con pressione dello stilo', () => {
    const tracker = new SmoothStrokeTracker({ minLineWidth: 1.5, maxLineWidth: 4.0 });
    const ctx = createMockCtx();

    tracker.start(0, 0, 1000);
    tracker.move(20, 20, ctx, 1050, 0.9); // Forte pressione stilo
    expect(ctx.lineWidth).toBeGreaterThan(2.5);
  });
});
