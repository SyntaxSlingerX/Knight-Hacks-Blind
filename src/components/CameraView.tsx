import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, RefreshCw, Glasses, Video, AlertCircle, Eye, Radio } from 'lucide-react';
import { CameraSourceType, AriaConnectionConfig, NavigationAnalysis } from '../types/aria';
import { SIMULATION_SCENARIOS, drawAriaGlassesHUD } from '../utils/ariaSimulations';

interface CameraViewProps {
  sourceType: CameraSourceType;
  onSourceChange: (source: CameraSourceType) => void;
  analysis: NavigationAnalysis | null;
  onFrameCaptureReady: (captureFn: () => string | null) => void;
  ariaConfig: AriaConnectionConfig;
  onAriaConfigChange: (config: AriaConnectionConfig) => void;
  onOpenAriaSetup: () => void;
}

export const CameraView: React.FC<CameraViewProps> = ({
  sourceType,
  onSourceChange,
  analysis,
  onFrameCaptureReady,
  ariaConfig,
  onAriaConfigChange,
  onOpenAriaSetup,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ariaWsRef = useRef<WebSocket | null>(null);

  const [activeFacingMode, setActiveFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [selectedScenarioIndex, setSelectedScenarioIndex] = useState<number>(0);
  const [isAriaConnecting, setIsAriaConnecting] = useState<boolean>(false);
  const [ariaLastFrameTime, setAriaLastFrameTime] = useState<number>(0);

  // Capture frame function passed to parent
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

    // Default: Webcam / Mobile Camera
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video.videoWidth === 0 || video.videoHeight === 0) return null;

      // Downscale to max 800px width/height for fast Gemini Vision transfer
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

  // Start webcam
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
    setCameraError(null);

    async function initCamera() {
      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: activeFacingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        currentStream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err: any) {
        console.warn('Unable to access primary camera, trying fallback:', err);
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
          currentStream = fallbackStream;
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream;
            await videoRef.current.play().catch(() => {});
          }
        } catch (fallbackErr: any) {
          setCameraError(
            'Camera permission denied or camera not found. You can switch to Aria Simulation mode for testing.'
          );
        }
      }
    }

    initCamera();

    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [sourceType, activeFacingMode]);

  // Connect to Meta Project Aria WebSocket Stream if configured
  useEffect(() => {
    if (sourceType !== 'aria_stream') {
      if (ariaWsRef.current) {
        ariaWsRef.current.close();
        ariaWsRef.current = null;
      }
      return;
    }

    if (!ariaConfig.streamUrl) return;

    setIsAriaConnecting(true);
    let ws: WebSocket;
    try {
      ws = new WebSocket(ariaConfig.streamUrl);
      ariaWsRef.current = ws;

      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        setIsAriaConnecting(false);
        onAriaConfigChange({
          ...ariaConfig,
          connected: true,
          fps: 30,
        });
      };

      ws.onmessage = (event) => {
        setAriaLastFrameTime(Date.now());
        // If image data received
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (typeof event.data === 'string' && event.data.startsWith('data:image')) {
          const img = new Image();
          img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
          };
          img.src = event.data;
        } else if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
          const blob = new Blob([event.data], { type: 'image/jpeg' });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
          };
          img.src = url;
        }
      };

      ws.onerror = (e) => {
        console.warn('Aria WebSocket stream error:', e);
        setIsAriaConnecting(false);
        onAriaConfigChange({ ...ariaConfig, connected: false });
      };

      ws.onclose = () => {
        setIsAriaConnecting(false);
        onAriaConfigChange({ ...ariaConfig, connected: false });
      };
    } catch (err) {
      setIsAriaConnecting(false);
      onAriaConfigChange({ ...ariaConfig, connected: false });
    }

    return () => {
      if (ws) ws.close();
    };
  }, [sourceType, ariaConfig.streamUrl]);

  // Simulation Render Loop
  useEffect(() => {
    if (sourceType !== 'simulation') return;

    let animId: number;
    let frame = 0;

    const render = () => {
      const canvas = simCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const scenario = SIMULATION_SCENARIOS[selectedScenarioIndex];
          if (scenario) {
            scenario.draw(ctx, canvas.width, canvas.height, frame);
            drawAriaGlassesHUD(ctx, canvas.width, canvas.height, scenario.name);
          }
        }
      }
      frame++;
      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [sourceType, selectedScenarioIndex]);

  return (
    <div className="flex flex-col bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
      {/* Top Source Switcher & Connection Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-950/80 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Feed Source:</span>
          {/* Segmented Source Controls */}
          <div className="inline-flex items-center p-1 bg-slate-900 border border-slate-800 rounded-xl" role="tablist">
            <button
              role="tab"
              aria-selected={sourceType === 'aria_stream'}
              onClick={() => onSourceChange('aria_stream')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-[36px] ${
                sourceType === 'aria_stream'
                  ? 'bg-amber-400 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Glasses className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Project Aria Glasses</span>
            </button>

            <button
              role="tab"
              aria-selected={sourceType === 'webcam'}
              onClick={() => onSourceChange('webcam')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-[36px] ${
                sourceType === 'webcam'
                  ? 'bg-amber-400 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Camera className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Webcam / Mobile</span>
            </button>

            <button
              role="tab"
              aria-selected={sourceType === 'simulation'}
              onClick={() => onSourceChange('simulation')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-[36px] ${
                sourceType === 'simulation'
                  ? 'bg-amber-400 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Field Scenarios</span>
            </button>
          </div>
        </div>

        {/* Action button: Aria Setup Guide or Camera Toggle */}
        <div className="flex items-center gap-2">
          {sourceType === 'aria_stream' && (
            <button
              onClick={onOpenAriaSetup}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors border border-slate-700 min-h-[36px]"
            >
              <Radio className="w-3.5 h-3.5 text-amber-400" />
              <span>Glasses Bridge Setup</span>
            </button>
          )}

          {sourceType === 'webcam' && (
            <button
              onClick={() => setActiveFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
              aria-label="Switch between front and back camera"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors border border-slate-700 min-h-[36px]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Flip ({activeFacingMode === 'environment' ? 'Rear' : 'Front'})</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Viewport Container */}
      <div className="relative w-full aspect-video md:aspect-[16/10] bg-black flex items-center justify-center overflow-hidden">
        {/* Source 1: Webcam Stream */}
        {sourceType === 'webcam' && (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="w-full h-full object-cover"
              aria-label="Live camera feed"
            />
            {cameraError && (
              <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center">
                <AlertCircle className="w-10 h-10 text-amber-400 mb-3" />
                <p className="text-sm text-slate-200 font-medium max-w-md">{cameraError}</p>
                <button
                  onClick={() => onSourceChange('simulation')}
                  className="mt-4 px-4 py-2 bg-amber-400 text-slate-950 font-bold rounded-xl text-sm"
                >
                  Switch to Field Scenarios Demo
                </button>
              </div>
            )}
          </>
        )}

        {/* Source 2: Meta Project Aria Stream */}
        {sourceType === 'aria_stream' && (
          <div className="relative w-full h-full flex flex-col items-center justify-center bg-slate-950">
            <canvas ref={canvasRef} className="max-w-full max-h-full object-contain" />

            {!ariaConfig.connected && (
              <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center">
                <Glasses className="w-12 h-12 text-amber-400 mb-3" />
                <h4 className="text-base font-bold text-white mb-1">Connecting to Meta Project Aria</h4>
                <p className="text-xs text-slate-300 max-w-md mb-4">
                  Waiting for stream at <span className="font-mono text-amber-300">{ariaConfig.streamUrl}</span>.
                  Ensure Aria glasses are on Wi-Fi and the Python bridge is streaming.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={onOpenAriaSetup}
                    className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-colors"
                  >
                    View Setup Instructions
                  </button>
                  <button
                    onClick={() => onSourceChange('simulation')}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs rounded-xl transition-colors border border-slate-700"
                  >
                    Use Simulation Demo
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Source 3: Aria Simulation Rig */}
        {sourceType === 'simulation' && (
          <div className="relative w-full h-full">
            <canvas
              ref={simCanvasRef}
              width={1408}
              height={1408}
              className="w-full h-full object-cover"
              aria-label="Simulated Aria glasses camera view"
            />
          </div>
        )}

        {/* Hidden offscreen canvas for webcam capture */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Visual Spatial Guidance Overlay (for sighted testers / mobility observers) */}
        {analysis && (
          <div className="absolute bottom-4 left-4 right-4 pointer-events-none flex flex-col gap-2">
            {/* Urgent hazard banner if active */}
            {analysis.urgency === 'immediate_hazard' && (
              <div className="bg-red-600/95 text-white font-bold px-4 py-2.5 rounded-xl border-2 border-red-300 flex items-center justify-between shadow-xl animate-pulse">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span className="text-sm tracking-wide">
                    {analysis.immediateAlert || 'HAZARD DETECTED: STOP OR HOLD POSITION'}
                  </span>
                </div>
                <span className="text-xs uppercase font-mono bg-red-950/80 px-2 py-0.5 rounded">STOP</span>
              </div>
            )}

            {/* Path arrow & detected objects pill bar */}
            <div className="flex items-center justify-between bg-slate-950/85 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-700 text-xs">
              <div className="flex items-center gap-2 text-slate-200">
                <span className="font-semibold text-amber-400 uppercase text-[11px]">Recommended Path:</span>
                <span className="font-bold capitalize">{analysis.spatialDirection.replace('_', ' ')}</span>
              </div>

              <div className="text-[11px] text-slate-400 font-mono">
                Objects: {analysis.detectedObjects?.length || 0}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Simulation Scenario Selector Strip */}
      {sourceType === 'simulation' && (
        <div className="px-4 py-3 bg-slate-950 border-t border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">
              Test Real-World Scenarios (Aria Glasses POV):
            </span>
            <span className="text-xs text-amber-400 font-semibold">
              Scenario {selectedScenarioIndex + 1} of {SIMULATION_SCENARIOS.length}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {SIMULATION_SCENARIOS.map((scen, idx) => (
              <button
                key={scen.id}
                onClick={() => setSelectedScenarioIndex(idx)}
                className={`p-2.5 text-left rounded-xl transition-all border text-xs ${
                  selectedScenarioIndex === idx
                    ? 'bg-slate-800 border-amber-400 text-white font-bold ring-1 ring-amber-400'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-850'
                }`}
              >
                <div className="truncate font-semibold text-slate-100">{scen.name}</div>
                <div className="text-[10px] text-amber-300/80 truncate mt-0.5">{scen.hazardType}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
