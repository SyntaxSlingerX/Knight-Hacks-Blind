/**
 * Aria Vision: AI-Powered Navigation Assistant for Blind & Visually Impaired
 * Using Meta Project Aria Smart Glasses & Gemini 3.8 Flash Vision
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Glasses,
  Play,
  Square,
  Scan,
  Mic,
  Settings,
  Volume2,
  VolumeX,
  Radio,
  Wifi,
  WifiOff,
  Sliders,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import {
  CameraSourceType,
  AriaConnectionConfig,
  NavigationAnalysis,
  UserVoiceSettings,
  ThemeMode,
  TextSize,
} from './types/aria';
import { CameraView } from './components/CameraView';
import { NavigationDisplay } from './components/NavigationDisplay';
import { VoiceAssistant } from './components/VoiceAssistant';
import { AccessibilityControls } from './components/AccessibilityControls';
import { GuidanceHistory } from './components/GuidanceHistory';
import { AriaSetupModal } from './components/AriaSetupModal';
import { SafetyDisclaimer } from './components/SafetyDisclaimer';
import { soundEffects } from './utils/audio';
import { speechManager } from './utils/speech';
import { analyzeNavigationFrame } from './utils/geminiClient';

// Pause between the end of one scan and the start of the next
const SCAN_INTERVAL_MS = 3000;
// Re-announce unchanged-but-reworded guidance at most this often
const REPEAT_GUIDANCE_MS = 12000;

export default function App() {
  // Navigation & Assistance State
  const [isAssistanceActive, setIsAssistanceActive] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<NavigationAnalysis | null>(null);
  const [analysisHistory, setAnalysisHistory] = useState<NavigationAnalysis[]>([]);

  // Camera & Aria Config
  const [cameraSource, setCameraSource] = useState<CameraSourceType>('simulation');
  const [ariaConfig, setAriaConfig] = useState<AriaConnectionConfig>({
    streamUrl: 'ws://localhost:7000',
    connected: false,
    deviceModel: 'Meta Project Aria (RGB 1408x1408 @ 30FPS)',
    fps: 0,
    latencyMs: 42,
  });
  const [isAriaModalOpen, setIsAriaModalOpen] = useState<boolean>(false);

  // Accessibility Settings
  const [themeMode, setThemeMode] = useState<ThemeMode>('standard-dark');
  const [textSize, setTextSize] = useState<TextSize>('large');
  const [voiceSettings, setVoiceSettings] = useState<UserVoiceSettings>({
    rate: 1.15,
    pitch: 1.0,
    volume: 1.0,
    soundEffectsEnabled: true,
  });
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Frame capture function reference from CameraView
  const captureFrameRef = useRef<(() => string | null) | null>(null);
  const scanTimerRef = useRef<any>(null);

  const handleFrameCaptureReady = useCallback((captureFn: () => string | null) => {
    captureFrameRef.current = captureFn;
  }, []);

  // Theme container classes
  const getThemeContainerClass = () => {
    switch (themeMode) {
      case 'ultra-contrast-yellow':
        return 'bg-black text-yellow-300 [&_*]:border-yellow-400 [&_button]:border-yellow-400';
      case 'high-contrast-cyan':
        return 'bg-black text-cyan-300 [&_*]:border-cyan-400 [&_button]:border-cyan-400';
      case 'standard-dark':
      default:
        return 'bg-slate-950 text-slate-100';
    }
  };

  // Latest values for the scan loop, kept in refs so the loop isn't restarted on every change
  const lastSpokenTextRef = useRef<string>('');
  const lastSpokenAtRef = useRef<number>(0);
  const lastUrgencyRef = useRef<string>('');
  const lastDirectionRef = useRef<string>('');
  const scanInFlightRef = useRef<boolean>(false);
  const voiceBusyRef = useRef<boolean>(false);
  const isMutedRef = useRef<boolean>(isMuted);
  const soundEffectsEnabledRef = useRef<boolean>(voiceSettings.soundEffectsEnabled);
  isMutedRef.current = isMuted;
  soundEffectsEnabledRef.current = voiceSettings.soundEffectsEnabled;

  // Perform single vision frame scan
  const performScan = useCallback(async (isManual: boolean = false) => {
    if (!captureFrameRef.current || scanInFlightRef.current) return;
    const frame = captureFrameRef.current();
    if (!frame) return;

    scanInFlightRef.current = true;
    setIsScanning(true);
    try {
      const result = await analyzeNavigationFrame(frame, lastSpokenTextRef.current);
      setCurrentAnalysis(result);
      setAnalysisHistory((prev) => [result, ...prev.slice(0, 19)]);

      const isHazard = result.urgency === 'immediate_hazard';
      const urgencyChanged = result.urgency !== lastUrgencyRef.current;
      const directionChanged = result.spatialDirection !== lastDirectionRef.current;
      lastUrgencyRef.current = result.urgency;
      lastDirectionRef.current = result.spatialDirection;

      // While the user is asking a question, only hazards may interrupt them
      if (voiceBusyRef.current && !isHazard && !isManual) return;

      const muted = isMutedRef.current;

      // Earcons only when something changes (or on hazards), not on every scan
      if (!muted && soundEffectsEnabledRef.current && (isHazard || urgencyChanged || isManual)) {
        if (isHazard) {
          soundEffects.playHazardAlarm();
        } else if (result.urgency === 'caution') {
          soundEffects.playCautionPing();
        } else if (result.urgency === 'clear') {
          soundEffects.playClearChime();
        }
      }

      const textToSpeak = result.immediateAlert
        ? `${result.immediateAlert}. ${result.spokenGuidance}`
        : result.spokenGuidance;

      // Don't narrate every scan: speak on hazards, manual scans, real changes,
      // or as an occasional refresh when the wording has changed
      const isStale = Date.now() - lastSpokenAtRef.current > REPEAT_GUIDANCE_MS;
      const shouldSpeak =
        isManual ||
        isHazard ||
        urgencyChanged ||
        directionChanged ||
        (isStale && textToSpeak !== lastSpokenTextRef.current);

      if (shouldSpeak) {
        lastSpokenTextRef.current = textToSpeak;
        lastSpokenAtRef.current = Date.now();
        if (!muted && !(voiceBusyRef.current && isHazard && !isManual)) {
          speechManager.speak(textToSpeak, { isUrgent: isHazard, interrupt: isManual });
        }
      }
    } catch (err: any) {
      console.error('Scan error:', err);
      if (isManual && !isMutedRef.current) {
        speechManager.speak('Scan failed. Check your connection and try again.', { interrupt: true });
      }
    } finally {
      scanInFlightRef.current = false;
      setIsScanning(false);
    }
  }, []);

  // Assistance Loop: scan, wait, scan again (never overlapping requests)
  useEffect(() => {
    if (!isAssistanceActive) return;

    let cancelled = false;
    const loop = async () => {
      await performScan();
      if (!cancelled) {
        scanTimerRef.current = setTimeout(loop, SCAN_INTERVAL_MS);
      }
    };
    loop();

    return () => {
      cancelled = true;
      if (scanTimerRef.current) {
        clearTimeout(scanTimerRef.current);
        scanTimerRef.current = null;
      }
    };
  }, [isAssistanceActive, performScan]);

  const handleVoiceBusyChange = useCallback((busy: boolean) => {
    voiceBusyRef.current = busy;
  }, []);

  // Toggle Assistance
  const isAssistanceActiveRef = useRef<boolean>(isAssistanceActive);
  isAssistanceActiveRef.current = isAssistanceActive;

  const toggleAssistance = useCallback(() => {
    const nextState = !isAssistanceActiveRef.current;
    isAssistanceActiveRef.current = nextState;
    setIsAssistanceActive(nextState);
    lastUrgencyRef.current = '';
    lastDirectionRef.current = '';

    if (nextState) {
      soundEffects.playSystemStatusToggle(true);
      speechManager.speak('Navigation assistance active. Scanning surroundings.', { interrupt: true });
    } else {
      soundEffects.playSystemStatusToggle(false);
      speechManager.speak('Navigation assistance paused.', { interrupt: true });
    }
  }, []);

  // Keyboard Accessibility Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Don't hijack typing, or Enter/Space on a focused button or link
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName)
      ) {
        if (e.code !== 'Escape') return;
      }

      if (e.code === 'KeyS') {
        e.preventDefault();
        toggleAssistance();
      } else if (e.code === 'Enter') {
        e.preventDefault();
        performScan(true);
      } else if (e.code === 'KeyH') {
        e.preventDefault();
        setThemeMode((prev) =>
          prev === 'standard-dark' ? 'ultra-contrast-yellow' : 'standard-dark'
        );
      } else if (e.code === 'Escape') {
        speechManager.stop();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleAssistance, performScan]);

  return (
    <div className={`min-h-screen transition-colors duration-200 ${getThemeContainerClass()}`}>
      {/* 
        Top Bar Contract:
        [Brand title, one line] — [4–5 nav links, 1–2 word labels, single-line] — [1 primary action]
      */}
      <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single element brand wordmark */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="p-2 bg-amber-400 text-slate-950 rounded-xl">
              <Glasses className="w-5 h-5" />
            </div>
            <span className="text-lg font-extrabold tracking-tight text-white whitespace-nowrap">
              Aria Vision
            </span>
          </div>

          {/* Zone 2: 4-5 single-line clean nav links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <a href="#feed" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Camera Feed
            </a>
            <a href="#guidance" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Voice Guidance
            </a>
            <a href="#voice-qa" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Voice Inquiries
            </a>
            <a href="#controls" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Accessibility
            </a>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setIsAriaModalOpen(true)}
              className="px-4 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl transition-all shadow-md active:scale-95 whitespace-nowrap flex items-center gap-1.5"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Connect Aria</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main App Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Safety Disclaimer Banner */}
        <SafetyDisclaimer />

        {/* PRIMARY TACTILE ACTION CONTROLS (Ergonomic, accessible, huge touch targets) */}
        <section
          aria-label="Primary Navigation Actions"
          className="grid grid-cols-1 sm:grid-cols-3 gap-3.5"
        >
          {/* Action 1: START / STOP ASSISTANCE */}
          <button
            onClick={toggleAssistance}
            aria-label={isAssistanceActive ? 'Stop Navigation Assistance' : 'Start Navigation Assistance'}
            className={`min-h-[68px] px-6 py-4 rounded-2xl font-extrabold flex items-center justify-center gap-3 text-base md:text-lg transition-all shadow-xl active:scale-[0.98] ${
              isAssistanceActive
                ? 'bg-red-600 hover:bg-red-700 text-white ring-4 ring-red-500/30 animate-pulse'
                : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20'
            }`}
          >
            {isAssistanceActive ? (
              <>
                <Square className="w-6 h-6 fill-current" />
                <span>STOP ASSISTANCE</span>
              </>
            ) : (
              <>
                <Play className="w-6 h-6 fill-current" />
                <span>START ASSISTANCE</span>
              </>
            )}
          </button>

          {/* Action 2: SCAN SCENE NOW (Immediate On-Demand Query) */}
          <button
            onClick={() => performScan(true)}
            disabled={isScanning}
            aria-label="Scan current scene immediately"
            className="min-h-[68px] px-6 py-4 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] text-white rounded-2xl font-bold flex items-center justify-center gap-3 text-base md:text-lg transition-all border border-slate-700 disabled:opacity-50"
          >
            <Scan className={`w-6 h-6 text-amber-400 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'ANALYZING...' : 'SCAN SCENE NOW'}</span>
          </button>

          {/* Action 3: AUDIO MUTE / REPLAY */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const next = !isMuted;
                setIsMuted(next);
                if (next) speechManager.stop();
              }}
              aria-label={isMuted ? 'Unmute spoken guidance' : 'Mute spoken guidance'}
              className={`flex-1 min-h-[68px] px-4 py-4 rounded-2xl font-bold flex items-center justify-center gap-2.5 text-sm transition-all border ${
                isMuted
                  ? 'bg-red-950/60 border-red-500 text-red-300'
                  : 'bg-slate-900 border-slate-800 text-slate-200 hover:bg-slate-800'
              }`}
            >
              {isMuted ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5 text-amber-400" />}
              <span>{isMuted ? 'UNMUTE AUDIO' : 'AUDIO ACTIVE'}</span>
            </button>

            {currentAnalysis && (
              <button
                onClick={() =>
                  speechManager.speak(
                    currentAnalysis.immediateAlert || currentAnalysis.spokenGuidance,
                    { interrupt: true }
                  )
                }
                aria-label="Replay current navigation instruction"
                className="min-h-[68px] px-4 py-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-2xl text-amber-400 font-bold text-xs flex flex-col items-center justify-center gap-1 transition-all"
              >
                <Volume2 className="w-4 h-4" />
                <span>REPEAT</span>
              </button>
            )}
          </div>
        </section>

        {/* 2-Column Responsive Layout: Camera Feed & Real-Time Navigation Guidance */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Live Smart Glasses Feed (7 cols) */}
          <div id="feed" className="lg:col-span-7 space-y-4">
            <CameraView
              sourceType={cameraSource}
              onSourceChange={setCameraSource}
              analysis={currentAnalysis}
              onFrameCaptureReady={handleFrameCaptureReady}
              ariaConfig={ariaConfig}
              onAriaConfigChange={setAriaConfig}
              onOpenAriaSetup={() => setIsAriaModalOpen(true)}
            />

            {/* Voice Assistant Q&A Panel */}
            <div id="voice-qa">
              <VoiceAssistant
                getFrame={() => (captureFrameRef.current ? captureFrameRef.current() : null)}
                onAnswerReceived={(ans) => (lastSpokenTextRef.current = ans)}
                onBusyChange={handleVoiceBusyChange}
              />
            </div>
          </div>

          {/* Right Column: Spoken Navigation Display & Log (5 cols) */}
          <div id="guidance" className="lg:col-span-5 space-y-6">
            <NavigationDisplay
              analysis={currentAnalysis}
              isAnalyzing={isScanning}
              textSize={textSize}
            />

            <GuidanceHistory
              history={analysisHistory}
              onClear={() => setAnalysisHistory([])}
            />
          </div>
        </div>

        {/* Accessibility & Voice Settings Bar */}
        <section id="controls">
          <AccessibilityControls
            voiceSettings={voiceSettings}
            onVoiceSettingsChange={(newSettings) =>
              setVoiceSettings((prev) => ({ ...prev, ...newSettings }))
            }
            themeMode={themeMode}
            onThemeModeChange={setThemeMode}
            textSize={textSize}
            onTextSizeChange={setTextSize}
          />
        </section>
      </main>

      {/* Meta Project Aria Setup & Streaming Modal */}
      <AriaSetupModal
        isOpen={isAriaModalOpen}
        onClose={() => setIsAriaModalOpen(false)}
        config={ariaConfig}
        onConfigChange={setAriaConfig}
      />
    </div>
  );
}
