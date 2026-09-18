/**
 * Utility per il disegno fluido e naturale della firma su HTML5 Canvas (§SES/FEA).
 *
 * ## Problema risolto
 *
 * Il canvas standard che traccia segmenti retti (`ctx.lineTo`) genera tratti
 * spigolosi, geometrici e poligonali ("triangolari"), specialmente con touch screen
 * e penne dove gli eventi vengono campionati a frequenze discrete (60-120Hz).
 * Inoltre, se il canvas è scalato via CSS (es. width: 100%), le coordinate del mouse
 * o del tocco risultavano sfalsate senza il fattore di correzione del bounding rect.
 *
 * ## Soluzione tecnica
 *
 * 1. **Interpolazione con Curve di Bézier Quadratiche a punto medio**:
 *    Invece di segmenti retti, ogni nuovo punto viene collegato tramite una curva
 *    quadratica usando il punto medio tra il punto precedente e quello attuale.
 *    Questo garantisce continuità di tangenza (C1) e tratti arrotondati e naturali.
 * 2. **Spessore dinamico a inchiostro fluido (Velocity-based ink flow)**:
 *    Simula una penna stilografica / biro reale: i tratti lenti o le curve
 *    ricevono un tratto leggermente più pieno, mentre le passate veloci si affusolano.
 * 3. **Gestione del tocco singolo (Dot detection)**:
 *    Se l'utente tocca un singolo punto per fare un puntino (es. sulla "i" o un accento),
 *    viene disegnato un cerchio pieno invece di non tracciare nulla.
 * 4. **Normalizzazione coordinate reattive**:
 *    Tiene conto della scala reale tra dimensioni intrinseche del canvas e box CSS.
 */

export interface Point {
  x: number;
  y: number;
  time: number;
}

export interface SmoothSignatureOptions {
  strokeColor?: string;
  baseLineWidth?: number;
  minLineWidth?: number;
  maxLineWidth?: number;
}

export function getCanvasCoordinates(
  e:
    | React.MouseEvent<HTMLCanvasElement>
    | React.TouchEvent<HTMLCanvasElement>
    | React.PointerEvent<HTMLCanvasElement>
    | MouseEvent
    | TouchEvent
    | PointerEvent,
  canvas: HTMLCanvasElement
): { x: number; y: number; pressure?: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;

  let clientX = 0;
  let clientY = 0;
  let pressure: number | undefined = undefined;

  if ('touches' in e && e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
    const touch = e.touches[0] as unknown as { force?: number };
    if (typeof touch.force === 'number' && touch.force > 0) {
      pressure = touch.force;
    }
  } else if ('changedTouches' in e && e.changedTouches && e.changedTouches.length > 0) {
    clientX = e.changedTouches[0].clientX;
    clientY = e.changedTouches[0].clientY;
    const touch = e.changedTouches[0] as unknown as { force?: number };
    if (typeof touch.force === 'number' && touch.force > 0) {
      pressure = touch.force;
    }
  } else if ('clientX' in e) {
    clientX = (e as MouseEvent | React.MouseEvent<HTMLCanvasElement>).clientX;
    clientY = (e as MouseEvent | React.MouseEvent<HTMLCanvasElement>).clientY;
    if ('pressure' in e && typeof (e as PointerEvent).pressure === 'number' && (e as PointerEvent).pressure > 0) {
      pressure = (e as PointerEvent).pressure;
    }
  }

  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;

  return { x, y, pressure };
}

export class SmoothStrokeTracker {
  private points: Point[] = [];
  private currentWidth: number;
  private strokeColor: string;
  private baseLineWidth: number;
  private minLineWidth: number;
  private maxLineWidth: number;

  constructor(options?: SmoothSignatureOptions) {
    this.strokeColor = options?.strokeColor || '#1e1b4b';
    this.baseLineWidth = options?.baseLineWidth || 2.4;
    this.minLineWidth = options?.minLineWidth || 1.6;
    this.maxLineWidth = options?.maxLineWidth || 3.4;
    this.currentWidth = this.baseLineWidth;
  }

  public setStrokeColor(color: string) {
    this.strokeColor = color;
  }

  public start(x: number, y: number, time: number = Date.now()) {
    this.points = [{ x, y, time }];
    this.currentWidth = this.baseLineWidth;
  }

  public move(
    x: number,
    y: number,
    ctx: CanvasRenderingContext2D,
    time: number = Date.now(),
    pressure?: number
  ): boolean {
    if (this.points.length === 0) {
      this.start(x, y, time);
      return false;
    }

    const last = this.points[this.points.length - 1];
    const dist = Math.hypot(x - last.x, y - last.y);

    // Evita micro-variazioni a distanza quasi zero che generano rumore
    if (dist < 2) return false;

    const curr: Point = { x, y, time };
    const dt = Math.max(1, curr.time - last.time);
    const velocity = dist / dt;

    // Modula dolcemente lo spessore del tratto in base alla pressione (Apple Pencil / stilo) o alla velocità
    let targetWidth: number;
    if (typeof pressure === 'number' && pressure > 0 && pressure <= 1) {
      targetWidth = this.minLineWidth + (this.maxLineWidth - this.minLineWidth) * pressure;
    } else {
      targetWidth = Math.max(
        this.minLineWidth,
        Math.min(this.maxLineWidth, this.baseLineWidth + (1.0 - Math.min(2.5, velocity)) * 0.4)
      );
    }
    this.currentWidth = this.currentWidth * 0.65 + targetWidth * 0.35;

    ctx.save();
    ctx.strokeStyle = this.strokeColor;
    ctx.fillStyle = this.strokeColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = this.currentWidth;

    this.points.push(curr);

    if (this.points.length === 2) {
      // Primo segmento: linea retta da punto iniziale a punto medio tra P0 e P1
      const mid = {
        x: (this.points[0].x + this.points[1].x) / 2,
        y: (this.points[0].y + this.points[1].y) / 2,
      };
      ctx.beginPath();
      ctx.moveTo(this.points[0].x, this.points[0].y);
      ctx.lineTo(mid.x, mid.y);
      ctx.stroke();
    } else if (this.points.length >= 3) {
      // Dal terzo punto in poi: curva quadratica morbida dal punto medio precedente al punto medio corrente
      const pPrev = this.points[this.points.length - 2];
      const pPrevPrev = this.points[this.points.length - 3];
      const prevMid = {
        x: (pPrevPrev.x + pPrev.x) / 2,
        y: (pPrevPrev.y + pPrev.y) / 2,
      };
      const currMid = {
        x: (pPrev.x + curr.x) / 2,
        y: (pPrev.y + curr.y) / 2,
      };

      ctx.beginPath();
      ctx.moveTo(prevMid.x, prevMid.y);
      ctx.quadraticCurveTo(pPrev.x, pPrev.y, currMid.x, currMid.y);
      ctx.stroke();
    }

    ctx.restore();
    return true;
  }

  public end(ctx: CanvasRenderingContext2D): void {
    if (this.points.length === 1) {
      // Tocco singolo (puntino o accento)
      ctx.save();
      ctx.fillStyle = this.strokeColor;
      ctx.beginPath();
      ctx.arc(this.points[0].x, this.points[0].y, this.baseLineWidth * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (this.points.length >= 2) {
      // Chiudi il tratto fino all'ultimo punto
      const last = this.points[this.points.length - 1];
      const prev = this.points[this.points.length - 2];
      const mid = {
        x: (prev.x + last.x) / 2,
        y: (prev.y + last.y) / 2,
      };

      ctx.save();
      ctx.strokeStyle = this.strokeColor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = this.currentWidth;
      ctx.beginPath();
      ctx.moveTo(mid.x, mid.y);
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
      ctx.restore();
    }

    this.points = [];
  }

  public reset(): void {
    this.points = [];
  }
}
