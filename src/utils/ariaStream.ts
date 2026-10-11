/**
 * Connection to aria_bridge.py: the live picture from the Aria glasses.
 *
 * The bridge sends binary messages (one JPEG camera frame each) and JSON text messages
 * ({ type: 'status' } once a second, { type: 'pose' } when SLAM is on).
 *
 * This client keeps that link healthy without help from the user:
 *  - it reconnects by itself, with a short backoff, whenever the socket drops or goes silent;
 *  - it only ever decodes the newest frame, so a busy page falls behind in frame rate, never in time;
 *  - it knows how old the picture on screen is, so a frozen frame is never mistaken for a live one.
 */

import { AriaBridgeStatus, AriaPose } from '../types/aria';

/** The picture counts as live while a frame newer than this is on screen. */
export const FRAME_STALE_AFTER_MS = 2000;
/** An open socket that has sent nothing for this long is treated as dead. */
const SILENT_SOCKET_MS = 5000;
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;
const HEALTH_CHECK_MS = 250;

export interface AriaStreamSnapshot {
  /** State of the WebSocket itself. */
  socket: 'connecting' | 'open' | 'closed';
  /** True while a fresh camera frame is on screen. */
  live: boolean;
  /** Frames drawn during the last second. */
  fps: number;
  /** Latest status report from the bridge, if any arrived on this connection. */
  status: AriaBridgeStatus | null;
}

export interface AriaStreamCallbacks {
  /** Called when the connection, liveness, frame rate, or bridge status changes (about once a second). */
  onChange?: (snapshot: AriaStreamSnapshot) => void;
  /** Called for every SLAM pose (about ten a second), and with null when the picture goes stale. */
  onPose?: (pose: AriaPose | null) => void;
}

type PendingFrame = Blob | string;

export class AriaStreamClient {
  private ws: WebSocket | null = null;
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;

  private pending: PendingFrame | null = null;
  private decoding = false;

  private lastFrameAt = 0;
  private lastMessageAt = 0;
  private framesThisSecond = 0;
  private fpsWindowStart = 0;

  private snapshot: AriaStreamSnapshot = { socket: 'closed', live: false, fps: 0, status: null };

  constructor(
    private readonly url: string,
    private readonly getCanvas: () => HTMLCanvasElement | null,
    private readonly callbacks: AriaStreamCallbacks = {}
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.fpsWindowStart = performance.now();
    this.healthTimer = setInterval(() => this.checkHealth(), HEALTH_CHECK_MS);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.reconnectTimer = null;
    this.healthTimer = null;
    this.pending = null;
    this.closeSocket();
  }

  /** True when the frame on the canvas is recent enough to be trusted as the current view. */
  isFrameFresh(maxAgeMs: number = FRAME_STALE_AFTER_MS): boolean {
    return this.lastFrameAt > 0 && performance.now() - this.lastFrameAt <= maxAgeMs;
  }

  getSnapshot(): AriaStreamSnapshot {
    return this.snapshot;
  }

  private update(patch: Partial<AriaStreamSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    const changed =
      next.socket !== this.snapshot.socket ||
      next.live !== this.snapshot.live ||
      next.fps !== this.snapshot.fps ||
      next.status !== this.snapshot.status;
    this.snapshot = next;
    if (changed && !this.stopped) this.callbacks.onChange?.(next);
  }

  private connect(): void {
    if (this.stopped) return;
    this.closeSocket();
    this.update({ socket: 'connecting' });

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (_) {
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.lastMessageAt = performance.now();
      this.update({ socket: 'open' });
    };

    ws.onmessage = (event: MessageEvent) => {
      if (this.ws !== ws) return;
      this.lastMessageAt = performance.now();
      // Anything arriving means the bridge is reachable again
      this.reconnectDelay = RECONNECT_MIN_MS;

      if (typeof event.data === 'string') {
        if (event.data.charCodeAt(0) === 123 /* { */) {
          this.handleJson(event.data);
        } else {
          // Older bridges (--format base64) send each frame as a data URL or bare base64
          this.pending = event.data.startsWith('data:image')
            ? event.data
            : `data:image/jpeg;base64,${event.data}`;
          this.pump();
        }
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        this.pending = new Blob([event.data], { type: 'image/jpeg' });
        this.pump();
      }
    };

    const onGone = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.update({ socket: 'closed', status: null });
      this.scheduleReconnect();
    };
    ws.onclose = onGone;
    ws.onerror = () => {
      // An error is always followed by close in browsers, but do not rely on it
      try {
        ws.close();
      } catch (_) {}
      onGone();
    };
  }

  private closeSocket(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch (_) {}
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(RECONNECT_MAX_MS, Math.round(this.reconnectDelay * 1.7));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleJson(text: string): void {
    let message: any;
    try {
      message = JSON.parse(text);
    } catch (_) {
      return;
    }
    if (message?.type === 'status') {
      this.update({ status: message as AriaBridgeStatus });
    } else if (message?.type === 'pose') {
      this.callbacks.onPose?.(message as AriaPose);
    }
  }

  /** Decode the newest waiting frame. Frames that arrive while one is decoding replace each other. */
  private pump(): void {
    if (this.decoding || this.pending === null || this.stopped) return;
    const frame = this.pending;
    this.pending = null;
    this.decoding = true;

    this.decode(frame)
      .then((image) => {
        if (!this.stopped) this.draw(image);
        if ('close' in image) image.close();
      })
      .catch(() => {
        // A damaged frame is skipped; the next one is only a moment away
      })
      .finally(() => {
        this.decoding = false;
        this.pump();
      });
  }

  private async decode(frame: PendingFrame): Promise<ImageBitmap | HTMLImageElement> {
    if (typeof createImageBitmap === 'function') {
      const blob = typeof frame === 'string' ? await (await fetch(frame)).blob() : frame;
      return createImageBitmap(blob);
    }
    // Fallback for browsers without createImageBitmap
    return new Promise((resolve, reject) => {
      const img = new Image();
      const src = typeof frame === 'string' ? frame : URL.createObjectURL(frame);
      const release = () => {
        if (typeof frame !== 'string') URL.revokeObjectURL(src);
      };
      img.onload = () => {
        release();
        resolve(img);
      };
      img.onerror = () => {
        release();
        reject(new Error('frame decode failed'));
      };
      img.src = src;
    });
  }

  /**
   * Draws straight away instead of waiting for an animation frame: the canvas is also what the
   * hazard scan reads, and animation frames stop in a background tab.
   */
  private draw(image: ImageBitmap | HTMLImageElement): void {
    const canvas = this.getCanvas();
    if (!canvas || image.width === 0 || image.height === 0) return;
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, 0, 0);

    this.lastFrameAt = performance.now();
    this.framesThisSecond += 1;
    if (!this.snapshot.live) this.update({ live: true });
  }

  private checkHealth(): void {
    const now = performance.now();

    if (this.snapshot.live && !this.isFrameFresh()) {
      this.update({ live: false, fps: 0 });
      // A pose is only as trustworthy as the stream it rides on
      this.callbacks.onPose?.(null);
    }

    if (now - this.fpsWindowStart >= 1000) {
      const fps = Math.round((this.framesThisSecond * 1000) / (now - this.fpsWindowStart));
      this.framesThisSecond = 0;
      this.fpsWindowStart = now;
      if (this.snapshot.live) this.update({ fps });
    }

    // The bridge sends a status message every second, so a silent open socket is a dead one
    if (this.ws && this.ws.readyState === WebSocket.OPEN && now - this.lastMessageAt > SILENT_SOCKET_MS) {
      this.closeSocket();
      this.update({ socket: 'closed', status: null });
      this.scheduleReconnect();
    }
  }
}
