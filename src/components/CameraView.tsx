import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Camera,
  RefreshCw,
  Glasses,
  AlertCircle,
  Eye,
  Radio,
  ZoomIn,
  Contrast,
  Maximize2,
  Minimize2,
  Scan,
  Mic,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Octagon,
  CornerUpLeft,
  CornerUpRight,
  Compass,
} from 'lucide-react';
import { CameraSourceType, AriaConnectionConfig, NavigationAnalysis, SpatialDirection } from '../types/aria';
import { SIMULATION_SCENARIOS, drawAriaGlassesHUD } from '../utils/ariaSimulations';
import { speechManager } from '../utils/speech';

export type VisionFilterMode = 'standard' | 'high-contrast' | 'bright-boost' | 'mono-edge';

interface CameraViewProps {
  sourceType: CameraSourceType;
  onSourceChange: (source: CameraSourceType) => void;
  analysis: NavigationAnalysis | null;
  onFrameCaptureReady: (captureFn: () => string | null) => void;
  ariaConfig: AriaConnectionConfig;
  onAriaConfigChange: (config: AriaConnectionConfig) => void;
  onOpenAriaSetup: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onTriggerScan?: () => void;
  isScanning?: boolean;
  onTriggerVoice?: () => void;
  isListening?: boolean;
}

export const CameraView: React.FC<CameraViewProps> = ({
  sourceType,
  onSourceChange,
  analysis,
  onFrameCaptureReady,
  ariaConfig,
  onAriaConfigChange,
  onOpenAriaSetup,
  isExpanded = false,
  onToggleExpand,
  onTriggerScan,
  isScanning = false,
  onTriggerVoice,
  isListening = false,
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

  // Low-Vision Accessibility Controls for Camera Viewfinder
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [visionFilter, setVisionFilter] = useState<VisionFilterMode>('standard');

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
        currentStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: activeFacingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = currentStream;
          await videoRef.current.play();
        }
      } catch (err: any) {
        console.warn('Camera access failed:', err);
        setCameraError(
          'Could not access webcam or phone camera. Please grant camera permissions or use Field Scenarios mode.'
        );
      }
    }

    initCamera();

    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [sourceType, activeFacingMode]);

  // Connect to Meta Project Aria WebSocket / MJPEG Stream
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

    setIsAriaConnecting(true);
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(url);
      ariaWsRef.current = ws;

      ws.onopen = () => {
        setIsAriaConnecting(false);
        onAriaConfigChange({
          ...ariaConfig,
          connected: true,
        });
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
        setIsAriaConnecting(false);
        onAriaConfigChange({
          ...ariaConfig,
          connected: false,
        });
      };

      ws.onclose = () => {
        setIsAriaConnecting(false);
        onAriaConfigChange({
          ...ariaConfig,
          connected: false,
        });
      };
    } catch (e) {
      setIsAriaConnecting(false);
    }

    return () => {
      if (ws) ws.close();
    };
  }, [sourceType, ariaConfig.streamUrl]);

  // Render Simulated Aria Smart Glasses Environment
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

  // Optical filter CSS classes for low-vision accessibility
  const getFilterStyle = (): React.CSSProperties => {
    let filterStr = '';
    switch (visionFilter) {
      case 'high-contrast':
        filterStr = 'contrast(1.75) saturate(1.4) brightness(1.1)';
        break;
      case 'bright-boost':
        filterStr = 'brightness(1.45) contrast(1.35)';
        break;
      case 'mono-edge':
        filterStr = 'grayscale(1) contrast(2.3) brightness(1.15)';
        break;
      case 'standard':
      default:
        filterStr = 'none';
        break;
    }
    return {
      filter: filterStr,
      transform: `scale(${zoomLevel})`,
      transformOrigin: 'center center',
      transition: 'transform 0.2s ease-out, filter 0.2s ease-out',
    };
  };

  // Dynamic perimeter frame border based on navigation urgency
  const getViewportBorderClass = () => {
    if (!analysis) return 'border-4 border-amber-400';
    switch (analysis.urgency) {
      case 'immediate_hazard':
        return 'border-4 border-red-500 ring-4 ring-red-500/50';
      case 'caution':
        return 'border-4 border-amber-400 ring-2 ring-amber-400/30';
      case 'clear':
        return 'border-4 border-emerald-400';
      default:
        return 'border-4 border-sky-400';
    }
  };

  const getDirectionHUDIcon = (dir: SpatialDirection) => {
    switch (dir) {
      case 'straight':
        return <ArrowUp className="w-8 h-8 md:w-10 md:h-10 text-emerald-300 stroke-[3]" aria-hidden="true" />;
      case 'slight_left':
        return <ArrowUpLeft className="w-8 h-8 md:w-10 md:h-10 text-yellow-300 stroke-[3]" aria-hidden="true" />;
      case 'slight_right':
        return <ArrowUpRight className="w-8 h-8 md:w-10 md:h-10 text-yellow-300 stroke-[3]" aria-hidden="true" />;
      case 'stop':
        return <Octagon className="w-8 h-8 md:w-10 md:h-10 text-red-400 fill-red-500/30 stroke-[3]" aria-hidden="true" />;
      case 'detour_left':
        return <CornerUpLeft className="w-8 h-8 md:w-10 md:h-10 text-yellow-300 stroke-[3]" aria-hidden="true" />;
      case 'detour_right':
        return <CornerUpRight className="w-8 h-8 md:w-10 md:h-10 text-yellow-300 stroke-[3]" aria-hidden="true" />;
      default:
        return <Compass className="w-8 h-8 md:w-10 md:h-10 text-yellow-300 stroke-[3]" aria-hidden="true" />;
    }
  };

  const cycleZoom = () => {
    const nextZoom = zoomLevel === 1 ? 1.5 : zoomLevel === 1.5 ? 2 : 1;
    setZoomLevel(nextZoom);
    speechManager.speak(`Camera zoom ${nextZoom}x`);
  };

  const cycleFilter = () => {
    const modes: { id: VisionFilterMode; label: string }[] = [
      { id: 'standard', label: 'Standard View' },
      { id: 'high-contrast', label: 'High Contrast View' },
      { id: 'bright-boost', label: 'Bright Boost View' },
      { id: 'mono-edge', label: 'Monochrome High Contrast' },
    ];
    const currentIndex = modes.findIndex((m) => m.id === visionFilter);
    const next = modes[(currentIndex + 1) % modes.length];
    setVisionFilter(next.id);
    speechManager.speak(next.label);
  };

  return (
    <section
      aria-label="Live Camera Viewfinder and Low-Vision Controls"
      className="flex flex-col bg-slate-950 border-2 border-slate-700 rounded-3xl overflow-hidden shadow-2xl"
    >
      {/* Top Header & Prominent Source Switcher */}
      <div className="flex flex-col gap-3 p-4 md:p-5 bg-black border-b-2 border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-4 w-4 relative" aria-hidden="true">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-400"></span>
            </span>
            <h2 className="text-lg md:text-xl font-black text-white uppercase tracking-wide">
              Live Camera Display
            </h2>
          </div>

          {/* Low-Vision Optical Enhancement Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Zoom Button */}
            <button
              onClick={cycleZoom}
              aria-label={`Magnify camera feed. Current zoom ${zoomLevel}x`}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-extrabold border-2 transition-all min-h-[46px] ${
                zoomLevel > 1
                  ? 'bg-yellow-300 text-black border-yellow-200'
                  : 'bg-slate-900 text-white border-slate-600 hover:border-yellow-300'
              }`}
            >
              <ZoomIn className="w-5 h-5 shrink-0" />
              <span>ZOOM: {zoomLevel}x</span>
            </button>

            {/* High-Contrast Filter Button */}
            <button
              onClick={cycleFilter}
              aria-label={`Change camera visual contrast filter. Current filter ${visionFilter}`}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-extrabold border-2 transition-all min-h-[46px] ${
                visionFilter !== 'standard'
                  ? 'bg-yellow-300 text-black border-yellow-200'
                  : 'bg-slate-900 text-white border-slate-600 hover:border-yellow-300'
              }`}
            >
              <Contrast className="w-5 h-5 shrink-0" />
              <span className="capitalize">
                {visionFilter === 'standard' ? 'Contrast Boost' : visionFilter.replace('-', ' ')}
              </span>
            </button>

            {/* Flip Camera (Webcam mode) */}
            {sourceType === 'webcam' && (
              <button
                onClick={() =>
                  setActiveFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
                }
                aria-label="Switch between front and rear camera"
                className="flex items-center gap-2 px-3.5 py-2 text-sm font-extrabold bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition-colors border-2 border-slate-600 hover:border-yellow-300 min-h-[46px]"
              >
                <RefreshCw className="w-5 h-5 text-yellow-300" />
                <span>Flip ({activeFacingMode === 'environment' ? 'Rear' : 'Front'})</span>
              </button>
            )}

            {/* Expand / Full-Width Toggle */}
            {onToggleExpand && (
              <button
                onClick={onToggleExpand}
                aria-label={isExpanded ? 'Restore standard camera size' : 'Expand camera to full screen width'}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-extrabold border-2 transition-all min-h-[46px] ${
                  isExpanded
                    ? 'bg-amber-400 text-black border-amber-300'
                    : 'bg-slate-900 text-white border-slate-600 hover:border-yellow-300'
                }`}
              >
                {isExpanded ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                <span>{isExpanded ? 'Standard Size' : 'Expand Camera'}</span>
              </button>
            )}
          </div>
        </div>

        {/* High-Visibility Segmented Source Controls */}
        <div
          className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1"
          role="tablist"
          aria-label="Camera Feed Source Selection"
        >
          <button
            role="tab"
            aria-selected={sourceType === 'webcam'}
            onClick={() => {
              onSourceChange('webcam');
              speechManager.speak('Webcam and mobile camera active');
            }}
            className={`flex items-center justify-center gap-2.5 px-4 py-3 text-sm md:text-base font-extrabold rounded-2xl transition-all min-h-[54px] border-2 ${
              sourceType === 'webcam'
                ? 'bg-amber-400 text-black border-white shadow-lg'
                : 'bg-slate-900 text-white border-slate-700 hover:border-amber-400'
            }`}
          >
            <Camera className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>1. Live Webcam / Phone</span>
          </button>

          <button
            role="tab"
            aria-selected={sourceType === 'simulation'}
            onClick={() => {
              onSourceChange('simulation');
              speechManager.speak('Field scenarios simulation active');
            }}
            className={`flex items-center justify-center gap-2.5 px-4 py-3 text-sm md:text-base font-extrabold rounded-2xl transition-all min-h-[54px] border-2 ${
              sourceType === 'simulation'
                ? 'bg-amber-400 text-black border-white shadow-lg'
                : 'bg-slate-900 text-white border-slate-700 hover:border-amber-400'
            }`}
          >
            <Eye className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>2. Field Scenarios</span>
          </button>

          <button
            role="tab"
            aria-selected={sourceType === 'aria_stream'}
            onClick={() => {
              onSourceChange('aria_stream');
              speechManager.speak('Meta Project Aria smart glasses stream selected');
            }}
            className={`flex items-center justify-center gap-2.5 px-4 py-3 text-sm md:text-base font-extrabold rounded-2xl transition-all min-h-[54px] border-2 ${
              sourceType === 'aria_stream'
                ? 'bg-amber-400 text-black border-white shadow-lg'
                : 'bg-slate-900 text-white border-slate-700 hover:border-amber-400'
            }`}
          >
            <Glasses className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>3. Aria Smart Glasses</span>
          </button>
        </div>
      </div>

      {/* Prominent Main Viewport Container */}
      <div
        className={`relative w-full bg-black flex items-center justify-center overflow-hidden transition-all ${
          isExpanded
            ? 'min-h-[480px] sm:min-h-[580px] md:min-h-[680px]'
            : 'min-h-[380px] sm:min-h-[460px] md:min-h-[540px]'
        } ${getViewportBorderClass()}`}
      >
        {/* Source 1: Webcam Stream */}
        {sourceType === 'webcam' && (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              style={getFilterStyle()}
              className="w-full h-full object-cover min-h-[380px] sm:min-h-[460px] md:min-h-[540px]"
              aria-label="Live camera feed"
            />
            {cameraError && (
              <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center p-6 text-center z-20">
                <AlertCircle className="w-16 h-16 text-amber-400 mb-4" />
                <p className="text-lg md:text-xl text-white font-extrabold max-w-lg leading-relaxed">
                  {cameraError}
                </p>
                <button
                  onClick={() => onSourceChange('simulation')}
                  className="mt-6 px-6 py-4 bg-amber-400 hover:bg-amber-300 text-black font-black rounded-2xl text-base md:text-lg border-2 border-white shadow-xl"
                >
                  Switch to Field Scenarios Demo
                </button>
              </div>
            )}
          </>
        )}

        {/* Source 2: Meta Project Aria Stream */}
        {sourceType === 'aria_stream' && (
          <div className="relative w-full h-full min-h-[380px] sm:min-h-[460px] md:min-h-[540px] flex flex-col items-center justify-center bg-black">
            <canvas
              ref={canvasRef}
              style={getFilterStyle()}
              className="max-w-full max-h-full object-contain"
            />

            {!ariaConfig.connected && (
              <div className="absolute inset-0 bg-black/90 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center z-20">
                <Glasses className="w-16 h-16 text-amber-400 mb-4" />
                <h3 className="text-xl md:text-2xl font-black text-white mb-2">
                  Connecting to Meta Project Aria Glasses
                </h3>
                <p className="text-base text-slate-200 max-w-lg mb-6 font-medium">
                  Waiting for stream at{' '}
                  <span className="font-mono font-bold text-yellow-300 underline">
                    {ariaConfig.streamUrl}
                  </span>
                  . Ensure your Aria glasses are on Wi-Fi and the Python bridge is running.
                </p>
                <div className="flex flex-wrap justify-center gap-4">
                  <button
                    onClick={onOpenAriaSetup}
                    className="px-6 py-4 bg-amber-400 hover:bg-amber-300 text-black font-black text-base rounded-2xl border-2 border-white shadow-lg transition-colors"
                  >
                    Open Glasses Bridge Setup
                  </button>
                  <button
                    onClick={() => onSourceChange('simulation')}
                    className="px-6 py-4 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-base rounded-2xl transition-colors border-2 border-slate-600"
                  >
                    Use Field Scenarios Demo
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Source 3: Aria Simulation Rig */}
        {sourceType === 'simulation' && (
          <div className="relative w-full h-full min-h-[380px] sm:min-h-[460px] md:min-h-[540px] flex items-center justify-center">
            <canvas
              ref={simCanvasRef}
              width={1408}
              height={1408}
              style={getFilterStyle()}
              className="w-full h-full max-h-[680px] object-cover"
              aria-label="Simulated Aria glasses camera view"
            />
          </div>
        )}

        {/* Hidden offscreen canvas for webcam capture */}
        {sourceType !== 'aria_stream' && <canvas ref={canvasRef} className="hidden" />}

        {/* Top-Left Optical Status Pill (Visible when Zoom or Filter is active) */}
        {(zoomLevel > 1 || visionFilter !== 'standard') && (
          <div className="absolute top-4 left-4 z-10 bg-black/90 text-yellow-300 border-2 border-yellow-400 px-4 py-2 rounded-xl text-sm font-black uppercase tracking-wider shadow-lg">
            {zoomLevel > 1 && `Zoom ${zoomLevel}x`}
            {zoomLevel > 1 && visionFilter !== 'standard' && ' • '}
            {visionFilter !== 'standard' && visionFilter.replace('-', ' ')}
          </div>
        )}

        {/* Top-Right Direct Camera Action Overlay Buttons (Quick Scan & Quick Voice) */}
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2.5">
          {onTriggerScan && (
            <button
              onClick={onTriggerScan}
              disabled={isScanning}
              aria-label="Scan camera view right now"
              className="px-4 py-2.5 bg-black/90 hover:bg-slate-900 text-white border-2 border-amber-400 rounded-xl font-black text-sm flex items-center gap-2 shadow-xl active:scale-95 disabled:opacity-60 min-h-[48px]"
            >
              <Scan className={`w-5 h-5 text-amber-400 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'SCANNING...' : 'SCAN VIEW'}</span>
            </button>
          )}
          {onTriggerVoice && (
            <button
              onClick={onTriggerVoice}
              aria-label={isListening ? 'Stop voice listening' : 'Speak a question about camera view'}
              className={`px-4 py-2.5 rounded-xl font-black text-sm flex items-center gap-2 shadow-xl active:scale-95 border-2 min-h-[48px] ${
                isListening
                  ? 'bg-red-600 text-white border-white animate-pulse'
                  : 'bg-amber-400 hover:bg-amber-300 text-black border-white'
              }`}
            >
              <Mic className="w-5 h-5" />
              <span>{isListening ? 'LISTENING...' : 'ASK VOICE'}</span>
            </button>
          )}
        </div>

        {/* High-Visibility Spatial Guidance & Closed-Caption Overlay on Camera */}
        {analysis && (
          <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black via-black/95 to-transparent flex flex-col gap-3 z-10">
            {/* Urgent hazard alert banner */}
            {analysis.urgency === 'immediate_hazard' && (
              <div
                role="alert"
                className="bg-red-600 text-white font-black px-5 py-3.5 rounded-2xl border-4 border-white flex items-center justify-between shadow-2xl animate-pulse"
              >
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-8 h-8 shrink-0 stroke-[2.5]" />
                  <span className="text-lg md:text-2xl tracking-wide uppercase">
                    {analysis.immediateAlert || 'HAZARD AHEAD: STOP IMMEDIATELY'}
                  </span>
                </div>
                <span className="text-base md:text-lg uppercase font-mono bg-black text-yellow-300 px-3 py-1 rounded-lg border-2 border-yellow-300">
                  STOP
                </span>
              </div>
            )}

            {/* High-Contrast Closed Caption & Direction Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-black/95 px-5 py-4 rounded-2xl border-2 border-amber-400 shadow-2xl">
              <div className="flex items-center gap-3.5">
                <div className="p-2.5 bg-slate-900 border-2 border-slate-700 rounded-xl shrink-0">
                  {getDirectionHUDIcon(analysis.spatialDirection)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-amber-300 uppercase text-xs md:text-sm tracking-wider">
                      PATH DIRECTION:
                    </span>
                    <span className="font-black text-white uppercase text-base md:text-xl bg-slate-900 px-2.5 py-0.5 rounded-lg border border-slate-700">
                      {analysis.spatialDirection.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-base md:text-xl font-extrabold text-yellow-300 mt-1 leading-snug">
                    "{analysis.spokenGuidance}"
                  </p>
                </div>
              </div>

              <div className="text-sm font-mono font-bold text-white bg-slate-900 px-3.5 py-2 rounded-xl border border-slate-700 shrink-0 self-start sm:self-center">
                Objects: {analysis.detectedObjects?.length || 0}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Prominent Simulation Scenario Selector Strip */}
      {sourceType === 'simulation' && (
        <div className="p-4 md:p-5 bg-black border-t-2 border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <span className="text-sm md:text-base font-black text-white uppercase tracking-wide">
              Select Simulated Scene (Aria Glasses POV):
            </span>
            <span className="text-sm font-extrabold text-black bg-amber-400 px-3 py-1 rounded-lg">
              Scene {selectedScenarioIndex + 1} of {SIMULATION_SCENARIOS.length}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {SIMULATION_SCENARIOS.map((scen, idx) => {
              const isSelected = selectedScenarioIndex === idx;
              return (
                <button
                  key={scen.id}
                  onClick={() => {
                    setSelectedScenarioIndex(idx);
                    speechManager.speak(`Scenario ${idx + 1}: ${scen.name}`);
                  }}
                  aria-pressed={isSelected}
                  className={`p-3.5 text-left rounded-2xl transition-all border-2 min-h-[72px] flex flex-col justify-between ${
                    isSelected
                      ? 'bg-amber-400 border-white text-black font-black shadow-lg scale-[1.01]'
                      : 'bg-slate-900 border-slate-700 text-white hover:border-amber-400'
                  }`}
                >
                  <div className="text-sm md:text-base font-extrabold leading-tight">
                    {idx + 1}. {scen.name}
                  </div>
                  <div
                    className={`text-xs font-bold mt-1.5 uppercase tracking-wide ${
                      isSelected ? 'text-slate-950' : 'text-amber-300'
                    }`}
                  >
                    {scen.hazardType}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};
