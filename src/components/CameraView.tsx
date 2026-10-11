import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, Glasses, Eye, Volume2, Sparkles, RefreshCw, Brain } from 'lucide-react';
import { CameraSourceType, AriaConnectionConfig, AriaPose } from '../types/aria';
import { SIMULATION_SCENARIOS, drawAriaGlassesHUD } from '../utils/ariaSimulations';
import { AriaStreamClient, AriaStreamSnapshot } from '../utils/ariaStream';

// Longest side of the picture sent to Gemini, whatever the camera delivers
const MAX_CAPTURE_DIM = 800;

interface CameraViewProps {
  sourceType: CameraSourceType;
  onSourceChange: (source: CameraSourceType) => void;
  onFrameCaptureReady: (captureFn: () => string | null) => void;
  ariaConfig: AriaConnectionConfig;
  onAriaConfigChange: React.Dispatch<React.SetStateAction<AriaConnectionConfig>>;
  /** Live head pose from the glasses' SLAM, or null when there is none to trust. */
  onAriaPose?: (pose: AriaPose | null) => void;
  /** Extra content drawn over the picture (e.g. the SLAM mini-map). */
  children?: React.ReactNode;
  isListening?: boolean;
  isProcessing?: boolean;
  liveTranscript?: string;
  spokenResponse?: string;
  isRecalledFromMemory?: boolean;
  rememberedObjectCount?: number;
}

export const CameraView: React.FC<CameraViewProps> = ({
  sourceType,
  onSourceChange,
  onFrameCaptureReady,
  ariaConfig,
  onAriaConfigChange,
  onAriaPose,
  children,
  isListening = false,
  isProcessing = false,
  liveTranscript = '',
  spokenResponse = '',
  isRecalledFromMemory = false,
  rememberedObjectCount = 0,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ariaStreamRef = useRef<AriaStreamClient | null>(null);
  const onAriaPoseRef = useRef(onAriaPose);
  onAriaPoseRef.current = onAriaPose;

  const [ariaStream, setAriaStream] = useState<AriaStreamSnapshot | null>(null);

  // Mirrors the picture on screen only. What is sent for analysis stays the right way round,
  // so "left" and "right" in the spoken guidance are never swapped.
  const [isMirrored, setIsMirrored] = useState<boolean>(false);
  const [selectedScenarioIndex, setSelectedScenarioIndex] = useState<number>(0);

  // Capture current video frame for Gemini Vision
  const captureCurrentFrame = useCallback((): string | null => {
    if (sourceType === 'simulation') {
      if (!simCanvasRef.current) return null;
      return simCanvasRef.current.toDataURL('image/jpeg', 0.85);
    }

    if (sourceType === 'aria_stream') {
      const live = canvasRef.current;
      // Never hand a frozen picture to the hazard scan: no fresh frame means no view at all
      if (!live || live.width === 0 || !ariaStreamRef.current?.isFrameFresh()) return null;

      const longest = Math.max(live.width, live.height);
      if (longest <= MAX_CAPTURE_DIM) return live.toDataURL('image/jpeg', 0.85);

      const scale = MAX_CAPTURE_DIM / longest;
      const scratch = scratchCanvasRef.current ?? (scratchCanvasRef.current = document.createElement('canvas'));
      scratch.width = Math.round(live.width * scale);
      scratch.height = Math.round(live.height * scale);
      const scratchCtx = scratch.getContext('2d');
      if (!scratchCtx) return null;
      scratchCtx.drawImage(live, 0, 0, scratch.width, scratch.height);
      return scratch.toDataURL('image/jpeg', 0.85);
    }

    // Default: Webcam / iPhone Camera
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video.videoWidth === 0 || video.videoHeight === 0) return null;

      const maxDim = MAX_CAPTURE_DIM;
      let w = video.videoWidth;
      let h = video.videoHeight;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, w, h);
        return canvas.toDataURL('image/jpeg', 0.82);
      }
    }

    return null;
  }, [sourceType]);

  useEffect(() => {
    onFrameCaptureReady(captureCurrentFrame);
  }, [captureCurrentFrame, onFrameCaptureReady]);

  // Initialize Webcam / iPhone Camera
  useEffect(() => {
    if (sourceType !== 'webcam') {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
        videoRef.current.srcObject = null;
      }
      return;
    }

    let currentStream: MediaStream | null = null;

    async function initCamera() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera API requires HTTPS on mobile browsers');
        }

        currentStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' }, // the rear camera on a phone
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = currentStream;
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.setAttribute('webkit-playsinline', 'true');
          await videoRef.current.play();
        }
      } catch (err) {
        console.warn('Camera unavailable, switching to simulated video feed:', err);
        onSourceChange('simulation');
      }
    }

    initCamera();

    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [sourceType, onSourceChange]);

  // Keep a self-healing connection to the glasses bridge while the Aria source is selected
  useEffect(() => {
    if (sourceType !== 'aria_stream') return;

    const url = ariaConfig.streamUrl.trim();
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) return;

    const client = new AriaStreamClient(url, () => canvasRef.current, {
      onChange: (snapshot) => {
        setAriaStream(snapshot);
        onAriaConfigChange((prev) => {
          const latencyMs = snapshot.status ? Math.round(snapshot.status.frameAgeMs) : prev.latencyMs;
          const batteryLevel = snapshot.status?.battery ?? prev.batteryLevel;
          if (
            prev.connected === snapshot.live &&
            prev.fps === snapshot.fps &&
            prev.latencyMs === latencyMs &&
            prev.batteryLevel === batteryLevel
          ) {
            return prev;
          }
          return { ...prev, connected: snapshot.live, fps: snapshot.fps, latencyMs, batteryLevel };
        });
      },
      onPose: (pose) => onAriaPoseRef.current?.(pose),
    });
    ariaStreamRef.current = client;
    client.start();

    return () => {
      client.stop();
      ariaStreamRef.current = null;
      setAriaStream(null);
      onAriaPoseRef.current?.(null);
      onAriaConfigChange((prev) => (prev.connected || prev.fps ? { ...prev, connected: false, fps: 0 } : prev));
    };
  }, [sourceType, ariaConfig.streamUrl, onAriaConfigChange]);

  // Render Simulated Video Feed
  useEffect(() => {
    if (sourceType !== 'simulation') return;
    const canvas = simCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scenario = SIMULATION_SCENARIOS[selectedScenarioIndex] || SIMULATION_SCENARIOS[0];
    scenario.draw(ctx, canvas.width, canvas.height, 0);
    drawAriaGlassesHUD(ctx, canvas.width, canvas.height, scenario.name);
  }, [sourceType, selectedScenarioIndex]);

  const ariaLive = Boolean(ariaStream?.live);
  const bridgeStatus = ariaStream?.status ?? null;
  let ariaNotice = { title: 'Waiting for the glasses camera...', hint: '' };
  if (!ariaStream || ariaStream.socket !== 'open') {
    ariaNotice = {
      title: 'Glasses bridge not reachable. Reconnecting...',
      hint: `Looking for it at ${ariaConfig.streamUrl}`,
    };
  } else if (bridgeStatus && bridgeStatus.state !== 'streaming') {
    ariaNotice = {
      title: 'Glasses stream lost. Reconnecting...',
      hint: bridgeStatus.detail || 'Waiting for the glasses to start streaming.',
    };
  }

  return (
    <div
      className={`relative flex-1 w-full bg-black rounded-3xl overflow-hidden flex items-center justify-center border-4 transition-colors ${
        isListening
          ? 'border-red-500'
          : isProcessing
          ? 'border-amber-400'
          : 'border-slate-700'
      }`}
    >
      {/* 1. Live Webcam / iPhone Camera Feed */}
      {sourceType === 'webcam' && (
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full h-full object-cover ${isMirrored ? '-scale-x-100' : ''}`}
          aria-label="Live video display"
        />
      )}

      {/* 2. Aria Stream Feed */}
      {sourceType === 'aria_stream' && (
        <canvas
          ref={canvasRef}
          // The glasses picture is square. Show it widescreen by trimming the top and bottom on screen;
          // Gemini still receives the full square picture.
          className={`h-full max-w-full aspect-video object-cover ${isMirrored ? '-scale-x-100' : ''}`}
          aria-label="Aria smart glasses video display"
        />
      )}

      {/* 3. Simulated Feed (Fallback if no webcam is attached) */}
      {sourceType === 'simulation' && (
        <canvas
          ref={simCanvasRef}
          width={1408}
          height={1408}
          onClick={() =>
            setSelectedScenarioIndex((prev) => (prev + 1) % SIMULATION_SCENARIOS.length)
          }
          title="Tap video to cycle demo scene"
          className={`w-full h-full object-cover cursor-pointer ${isMirrored ? '-scale-x-100' : ''}`}
          aria-label="Simulated camera video display"
        />
      )}

      {/* Hidden canvas for webcam frame capture */}
      {sourceType !== 'aria_stream' && <canvas ref={canvasRef} className="hidden" />}

      {/* The last glasses frame stays on the canvas when the stream drops, so cover it:
          a frozen picture must never look like a live one */}
      {sourceType === 'aria_stream' && !ariaLive && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center"
        >
          <Glasses className="w-12 h-12 sm:w-16 sm:h-16 text-amber-400 animate-pulse" />
          <p className="text-xl sm:text-3xl font-black text-white">{ariaNotice.title}</p>
          {ariaNotice.hint && (
            <p className="text-sm sm:text-lg font-bold text-amber-300 break-all">{ariaNotice.hint}</p>
          )}
        </div>
      )}

      {children}

      {/* Top-Left Status Indicators */}
      <div className="absolute top-3 left-3 z-10 flex flex-col items-start gap-1.5">
        <div
          aria-live="polite"
          className="flex items-center gap-2 bg-black/85 backdrop-blur-md px-3.5 py-2 rounded-2xl border border-amber-400/60 text-xs font-black text-amber-300"
        >
          <Brain className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Memory: {rememberedObjectCount} objects</span>
        </div>

        {/* Glasses link health. Updates every second, so it stays out of the screen reader's way;
            the overlay above and the spoken alerts carry the same news. */}
        {sourceType === 'aria_stream' && (
          <div
            aria-hidden="true"
            className={`flex items-center gap-2 bg-black/85 backdrop-blur-md px-3.5 py-2 rounded-2xl border text-xs font-black ${
              ariaLive ? 'border-emerald-400/60 text-emerald-300' : 'border-red-500/70 text-red-300'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${ariaLive ? 'bg-emerald-400' : 'bg-red-500 animate-pulse'}`}
            />
            <span>
              {ariaLive ? `Glasses live: ${ariaStream?.fps ?? 0} fps` : 'Glasses offline'}
              {ariaLive && bridgeStatus?.battery != null ? `, battery ${bridgeStatus.battery}%` : ''}
              {ariaLive && bridgeStatus && bridgeStatus.slam !== 'off' ? `, SLAM ${bridgeStatus.slam}` : ''}
              {ariaLive && bridgeStatus?.thermal ? ', running hot' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Minimal Top-Right Pill to switch video source or mirror the picture */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-black/80 backdrop-blur-md p-1.5 rounded-2xl border border-slate-700">
        <button
          onClick={() => onSourceChange('webcam')}
          aria-label="Use Live Camera"
          className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors ${
            sourceType === 'webcam' ? 'bg-amber-400 text-black' : 'text-slate-300 hover:text-white'
          }`}
        >
          <Camera className="w-4 h-4" />
          <span>Camera</span>
        </button>

        <button
          onClick={() => setIsMirrored((prev) => !prev)}
          aria-label="Mirror the picture"
          aria-pressed={isMirrored}
          className="px-2.5 py-1.5 rounded-xl text-xs font-black bg-slate-800 text-yellow-300 hover:bg-slate-700 flex items-center gap-1"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{isMirrored ? 'Mirrored' : 'Flip'}</span>
        </button>

        <button
          onClick={() => onSourceChange('simulation')}
          aria-label="Use Demo Video"
          className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors ${
            sourceType === 'simulation' ? 'bg-amber-400 text-black' : 'text-slate-300 hover:text-white'
          }`}
        >
          <Eye className="w-4 h-4" />
          <span>Demo</span>
        </button>
        <button
          onClick={() => onSourceChange('aria_stream')}
          aria-label="Use Aria Glasses"
          className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors ${
            sourceType === 'aria_stream' ? 'bg-amber-400 text-black' : 'text-slate-300 hover:text-white'
          }`}
        >
          <Glasses className="w-4 h-4" />
          <span>Aria</span>
        </button>
      </div>

      {/* High-Contrast Live Transcript / Spoken Response Overlay on Video */}
      {(isListening || isProcessing || liveTranscript || spokenResponse) && (
        <div
          role="status"
          aria-live="polite"
          className="absolute bottom-3 left-3 right-3 z-10 bg-black/95 border-2 border-amber-400 rounded-2xl p-4 shadow-2xl"
        >
          {isListening && (
            <p className="text-lg sm:text-2xl font-black text-yellow-300">
              {liveTranscript ? `"${liveTranscript}"` : 'Listening... Speak your question now'}
            </p>
          )}

          {!isListening && isProcessing && (
            <div className="flex items-center gap-3 text-lg sm:text-2xl font-black text-amber-300">
              <Sparkles className="w-6 h-6 sm:w-7 sm:h-7 animate-spin shrink-0" />
              <span>Analyzing video & spatial memory...</span>
            </div>
          )}

          {!isListening && !isProcessing && spokenResponse && (
            <div className="flex flex-col gap-1.5">
              {isRecalledFromMemory && (
                <span className="inline-flex items-center gap-1.5 self-start px-2.5 py-0.5 rounded-lg bg-amber-400 text-black text-xs font-black uppercase tracking-wider">
                  <Brain className="w-3.5 h-3.5" />
                  Recalled from Spatial Memory
                </span>
              )}
              <div className="flex items-start gap-3">
                <Volume2 className="w-6 h-6 sm:w-7 sm:h-7 text-amber-400 shrink-0 mt-1" />
                <p className="text-lg sm:text-3xl font-black text-white leading-snug">
                  "{spokenResponse}"
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
