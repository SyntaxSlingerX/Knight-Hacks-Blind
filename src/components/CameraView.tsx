import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, Glasses, Eye, Volume2, Sparkles, RefreshCw } from 'lucide-react';
import { CameraSourceType, AriaConnectionConfig } from '../types/aria';
import { SIMULATION_SCENARIOS, drawAriaGlassesHUD } from '../utils/ariaSimulations';

interface CameraViewProps {
  sourceType: CameraSourceType;
  onSourceChange: (source: CameraSourceType) => void;
  onFrameCaptureReady: (captureFn: () => string | null) => void;
  ariaConfig: AriaConnectionConfig;
  onAriaConfigChange: (config: AriaConnectionConfig) => void;
  isListening?: boolean;
  isProcessing?: boolean;
  liveTranscript?: string;
  spokenResponse?: string;
}

export const CameraView: React.FC<CameraViewProps> = ({
  sourceType,
  onSourceChange,
  onFrameCaptureReady,
  ariaConfig,
  onAriaConfigChange,
  isListening = false,
  isProcessing = false,
  liveTranscript = '',
  spokenResponse = '',
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ariaWsRef = useRef<WebSocket | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [selectedScenarioIndex, setSelectedScenarioIndex] = useState<number>(0);
  const [ariaLastFrameTime, setAriaLastFrameTime] = useState<number>(0);

  // Capture current video frame for Gemini Vision
  const captureCurrentFrame = useCallback((): string | null => {
    if (sourceType === 'simulation') {
      if (!simCanvasRef.current) return null;
      return simCanvasRef.current.toDataURL('image/jpeg', 0.85);
    }

    if (sourceType === 'aria_stream') {
      if (canvasRef.current) {
        return canvasRef.current.toDataURL('image/jpeg', 0.85);
      }
      return null;
    }

    // Default: Webcam / iPhone Camera
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video.videoWidth === 0 || video.videoHeight === 0) return null;

      const maxDim = 800;
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
            facingMode: { ideal: facingMode },
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
  }, [sourceType, facingMode, onSourceChange]);

  // Connect to Meta Project Aria WebSocket Stream if selected
  useEffect(() => {
    if (sourceType !== 'aria_stream') {
      if (ariaWsRef.current) {
        ariaWsRef.current.close();
        ariaWsRef.current = null;
      }
      return;
    }

    const url = ariaConfig.streamUrl.trim();
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      return;
    }

    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(url);
      ariaWsRef.current = ws;

      ws.onopen = () => {
        onAriaConfigChange({ ...ariaConfig, connected: true });
      };

      ws.onmessage = (event) => {
        const now = performance.now();
        const dt = ariaLastFrameTime ? now - ariaLastFrameTime : 33;
        setAriaLastFrameTime(now);
        const currentFps = Math.min(60, Math.round(1000 / Math.max(dt, 16)));

        const img = new Image();
        img.onload = () => {
          if (canvasRef.current) {
            const c = canvasRef.current;
            c.width = img.width || 1408;
            c.height = img.height || 1408;
            const ctx = c.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0);
              drawAriaGlassesHUD(ctx, c.width, c.height, `${currentFps} FPS Live`);
            }
          }
        };

        if (typeof event.data === 'string') {
          img.src = event.data.startsWith('data:image')
            ? event.data
            : `data:image/jpeg;base64,${event.data}`;
        } else if (event.data instanceof Blob) {
          img.src = URL.createObjectURL(event.data);
        }
      };

      ws.onerror = () => {
        onAriaConfigChange({ ...ariaConfig, connected: false });
      };

      ws.onclose = () => {
        onAriaConfigChange({ ...ariaConfig, connected: false });
      };
    } catch (_) {}

    return () => {
      if (ws) ws.close();
    };
  }, [sourceType, ariaConfig.streamUrl]);

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
          className="w-full h-full object-cover"
          aria-label="Live video display"
        />
      )}

      {/* 2. Aria Stream Feed */}
      {sourceType === 'aria_stream' && (
        <canvas
          ref={canvasRef}
          className="w-full h-full object-contain"
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
          className="w-full h-full object-cover cursor-pointer"
          aria-label="Simulated camera video display"
        />
      )}

      {/* Hidden canvas for webcam frame capture */}
      {sourceType !== 'aria_stream' && <canvas ref={canvasRef} className="hidden" />}

      {/* Minimal Corner Pill to switch video source or flip iPhone camera */}
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

        {sourceType === 'webcam' && (
          <button
            onClick={() => setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
            aria-label="Flip between rear and front camera"
            className="px-2.5 py-1.5 rounded-xl text-xs font-black bg-slate-800 text-yellow-300 hover:bg-slate-700 flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{facingMode === 'environment' ? 'Rear' : 'Front'}</span>
          </button>
        )}

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
              <span>Analyzing video...</span>
            </div>
          )}

          {!isListening && !isProcessing && spokenResponse && (
            <div className="flex items-start gap-3">
              <Volume2 className="w-6 h-6 sm:w-7 sm:h-7 text-amber-400 shrink-0 mt-1" />
              <p className="text-lg sm:text-3xl font-black text-white leading-snug">
                "{spokenResponse}"
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
