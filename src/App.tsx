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
  MicOff,
  Volume2,
  VolumeX,
  Radio,
  Eye,
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
import { VoiceAssistant, QUICK_VOICE_QUESTIONS, VoiceCommand } from './components/VoiceAssistant';
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
  const [isVoiceListening, setIsVoiceListening] = useState<boolean>(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<NavigationAnalysis | null>(null);
  const [analysisHistory, setAnalysisHistory] = useState<NavigationAnalysis[]>([]);
  const [lastSpokenText, setLastSpokenText] = useState<string>('');

  // Camera & Aria Config (Prominent display state)
  const [cameraSource, setCameraSource] = useState<CameraSourceType>('simulation');
  const [isCameraExpanded, setIsCameraExpanded] = useState<boolean>(false);
  const [ariaConfig, setAriaConfig] = useState<AriaConnectionConfig>({
    streamUrl: 'ws://localhost:7000',
    connected: false,
    deviceModel: 'Meta Project Aria (RGB 1408x1408 @ 30FPS)',
    fps: 0,
    latencyMs: 42,
  });
  const [isAriaModalOpen, setIsAriaModalOpen] = useState<boolean>(false);

  // Accessibility Settings (Default to xlarge text for visually impaired users)
  const [themeMode, setThemeMode] = useState<ThemeMode>('standard-dark');
  const [textSize, setTextSize] = useState<TextSize>('xlarge');
  const [voiceSettings, setVoiceSettings] = useState<UserVoiceSettings>({
    rate: 1.15,
    pitch: 1.0,
    volume: 1.0,
    soundEffectsEnabled: true,
  });
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // References for Camera capture and Voice Assistant triggers
  const captureFrameRef = useRef<(() => string | null) | null>(null);
  const toggleVoiceRef = useRef<(() => void) | null>(null);
  const askQuestionRef = useRef<((q: string) => void) | null>(null);
  const scanTimerRef = useRef<any>(null);

  const handleFrameCaptureReady = useCallback((captureFn: () => string | null) => {
    captureFrameRef.current = captureFn;
  }, []);

  const handleRegisterToggleVoice = useCallback((toggleFn: () => void) => {
    toggleVoiceRef.current = toggleFn;
  }, []);

  const handleRegisterAskQuestion = useCallback((askFn: (q: string) => void) => {
    askQuestionRef.current = askFn;
  }, []);

  // Theme container classes with WCAG AAA high contrast
  const getThemeContainerClass = () => {
    switch (themeMode) {
      case 'ultra-contrast-yellow':
        return 'bg-black text-yellow-300 [&_*]:border-yellow-400';
      case 'high-contrast-cyan':
        return 'bg-black text-cyan-300 [&_*]:border-cyan-400';
      case 'standard-dark':
      default:
        return 'bg-black text-white';
    }
  };

  // Latest values for the scan loop, kept in refs so the loop isn't restarted on every change
  const lastSpokenTextRef = useRef<string>('');
  const lastSpokenAtRef = useRef<number>(0);
  const lastUrgencyRef = useRef<string>('');
  const lastDirectionRef = useRef<string>('');
  const scanInFlightRef = useRef<boolean>(false);
  const voiceBusyRef = useRef<boolean>(false);
  // Where the user asked to go ("the exit door"); empty when they haven't asked
  const [currentGoal, setCurrentGoal] = useState<string>('');
  const currentGoalRef = useRef<string>('');
  const isMutedRef = useRef<boolean>(isMuted);
  const soundEffectsEnabledRef = useRef<boolean>(voiceSettings.soundEffectsEnabled);
  isMutedRef.current = isMuted;
  soundEffectsEnabledRef.current = voiceSettings.soundEffectsEnabled;

  const changeGoal = useCallback((goal: string) => {
    currentGoalRef.current = goal;
    setCurrentGoal(goal);
    // Make the next scan announce directions toward the new goal
    lastUrgencyRef.current = '';
    lastDirectionRef.current = '';
  }, []);

  const clearGoal = useCallback(() => {
    if (!currentGoalRef.current) return;
    changeGoal('');
    speechManager.speak('Stopped guiding. Describing surroundings only.', { interrupt: true });
  }, [changeGoal]);

  const rememberSpoken = useCallback((text: string) => {
    lastSpokenTextRef.current = text;
    setLastSpokenText(text);
  }, []);

  // Perform single vision frame scan
  const performScan = useCallback(async (isManual: boolean = false) => {
    if (!captureFrameRef.current || scanInFlightRef.current) return;
    const frame = captureFrameRef.current();
    if (!frame) return;

    scanInFlightRef.current = true;
    setIsScanning(true);
    if (isManual && !isMutedRef.current) {
      speechManager.speak('Scanning scene.', { interrupt: true });
    }

    try {
      const result = await analyzeNavigationFrame(
        frame,
        lastSpokenTextRef.current,
        currentGoalRef.current || undefined
      );
      setCurrentAnalysis(result);
      setAnalysisHistory((prev) => [result, ...prev.slice(0, 19)]);

      const isHazard = result.urgency === 'immediate_hazard';
      const urgencyChanged = result.urgency !== lastUrgencyRef.current;
      const directionChanged = result.spatialDirection !== lastDirectionRef.current;
      lastUrgencyRef.current = result.urgency;
      lastDirectionRef.current = result.spatialDirection;

      if (result.goalReached && currentGoalRef.current) {
        const reached = currentGoalRef.current;
        changeGoal('');
        if (!isMutedRef.current) {
          speechManager.speak(`You have reached ${reached}.`, { interrupt: true });
        }
        return;
      }

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
        rememberSpoken(textToSpeak);
        lastSpokenAtRef.current = Date.now();
        if (!muted) {
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
  }, [rememberSpoken, changeGoal]);

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

  // Handle hands-free voice commands from VoiceAssistant
  const handleVoiceCommand = useCallback(
    (command: VoiceCommand) => {
      if (command === 'start' && !isAssistanceActiveRef.current) {
        toggleAssistance();
      } else if (command === 'stop' && isAssistanceActiveRef.current) {
        toggleAssistance();
      } else if (command === 'scan') {
        performScan(true);
      } else if (command === 'repeat' && lastSpokenTextRef.current) {
        speechManager.speak(lastSpokenTextRef.current, { interrupt: true });
      } else if (command === 'clearGoal') {
        clearGoal();
      }
    },
    [toggleAssistance, performScan, clearGoal]
  );

  // Global Keyboard Accessibility Shortcuts (Spacebar for Voice, 1-6 for Quick Questions, S, Enter, H, M, Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Don't trigger global hotkeys if user is typing in a text input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Let Space/Enter press a focused button or link instead of firing a shortcut
      if ((e.code === 'Space' || e.code === 'Enter') && ['BUTTON', 'A'].includes(target.tagName)) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        toggleVoiceRef.current?.();
      } else if (e.code === 'KeyS') {
        e.preventDefault();
        toggleAssistance();
      } else if (e.code === 'Enter') {
        e.preventDefault();
        performScan(true);
      } else if (e.code === 'KeyH') {
        e.preventDefault();
        setThemeMode((prev) => {
          const next =
            prev === 'standard-dark'
              ? 'ultra-contrast-yellow'
              : prev === 'ultra-contrast-yellow'
              ? 'high-contrast-cyan'
              : 'standard-dark';
          speechManager.speak(`Contrast mode: ${next.replace(/-/g, ' ')}`);
          return next;
        });
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        setIsMuted((prev) => {
          const next = !prev;
          if (next) speechManager.stop();
          return next;
        });
      } else if (e.code === 'Escape') {
        e.preventDefault();
        speechManager.stop();
      } else if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].includes(e.code)) {
        e.preventDefault();
        const index = parseInt(e.code.replace('Digit', ''), 10) - 1;
        if (QUICK_VOICE_QUESTIONS[index]) {
          askQuestionRef.current?.(QUICK_VOICE_QUESTIONS[index]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleAssistance, performScan]);

  return (
    <div className={`min-h-screen transition-colors duration-200 pb-24 ${getThemeContainerClass()}`}>
      {/* Screen-Reader & Keyboard Skip Navigation Links */}
      <div className="sr-only focus-within:not-sr-only focus-within:fixed focus-within:top-2 focus-within:left-2 focus-within:z-50 flex gap-2 bg-black p-2 border-2 border-yellow-300 rounded-xl">
        <a
          href="#voice-qa"
          className="px-4 py-2 bg-amber-400 text-black font-black rounded-lg"
        >
          Skip to Audio Voice Input
        </a>
        <a
          href="#feed"
          className="px-4 py-2 bg-amber-400 text-black font-black rounded-lg"
        >
          Skip to Camera Display
        </a>
      </div>

      {/* High-Visibility Sticky Header */}
      <header className="sticky top-0 z-40 bg-black/95 backdrop-blur-md border-b-2 border-slate-800">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-4">
          {/* Brand Title */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="p-2.5 bg-amber-400 text-black rounded-2xl border-2 border-white">
              <Glasses className="w-7 h-7 stroke-[2.5]" />
            </div>
            <div>
              <span className="text-xl md:text-2xl font-black tracking-tight text-white uppercase block leading-none">
                Aria Vision
              </span>
              <span className="text-xs font-extrabold text-amber-300 tracking-wider uppercase">
                Blind & Low-Vision Assistant
              </span>
            </div>
          </div>

          {/* High-Contrast Section Jump Links */}
          <nav
            aria-label="Quick Page Sections"
            className="hidden lg:flex items-center gap-3 text-sm font-black uppercase tracking-wider"
          >
            <a
              href="#feed"
              className="px-3.5 py-2 rounded-xl bg-slate-900 text-white hover:bg-amber-400 hover:text-black border border-slate-700 transition-colors"
            >
              1. Camera Display
            </a>
            <a
              href="#voice-qa"
              className="px-3.5 py-2 rounded-xl bg-slate-900 text-amber-300 hover:bg-amber-400 hover:text-black border border-amber-400/60 transition-colors"
            >
              2. Audio Voice Input
            </a>
            <a
              href="#guidance"
              className="px-3.5 py-2 rounded-xl bg-slate-900 text-white hover:bg-amber-400 hover:text-black border border-slate-700 transition-colors"
            >
              3. Spoken Guidance
            </a>
            <a
              href="#controls"
              className="px-3.5 py-2 rounded-xl bg-slate-900 text-white hover:bg-amber-400 hover:text-black border border-slate-700 transition-colors"
            >
              4. Visual Settings
            </a>
          </nav>

          {/* Quick Contrast Toggle & Aria Glasses Connection */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() =>
                setThemeMode((prev) =>
                  prev === 'standard-dark'
                    ? 'ultra-contrast-yellow'
                    : prev === 'ultra-contrast-yellow'
                    ? 'high-contrast-cyan'
                    : 'standard-dark'
                )
              }
              aria-label="Cycle high contrast color theme (Shortcut H)"
              className="px-3.5 py-2.5 text-xs md:text-sm font-black text-yellow-300 bg-slate-900 hover:bg-slate-800 border-2 border-yellow-400 rounded-xl transition-all flex items-center gap-1.5 min-h-[46px]"
            >
              <Eye className="w-4 h-4" />
              <span className="hidden sm:inline">Contrast [H]</span>
            </button>

            <button
              onClick={() => setIsAriaModalOpen(true)}
              className="px-4 py-2.5 text-xs md:text-sm font-black text-black bg-amber-400 hover:bg-amber-300 border-2 border-white rounded-xl transition-all shadow-md active:scale-95 whitespace-nowrap flex items-center gap-2 min-h-[46px]"
            >
              <Radio className="w-4 h-4 stroke-[2.5]" />
              <span>Connect Glasses</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main App Container */}
      <main className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Current destination (set by asking e.g. "Where's the exit?") */}
        <div role="status" aria-live="polite">
          {currentGoal && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 md:p-5 rounded-2xl border-4 border-sky-300 bg-sky-950 text-white">
              <span className="text-lg md:text-2xl font-black">
                Guiding you to: <span className="text-sky-300">{currentGoal}</span>
                {!isAssistanceActive && (
                  <span className="block text-sm md:text-base font-bold text-slate-200">
                    Start assistance (S) to hear directions.
                  </span>
                )}
              </span>
              <button
                onClick={clearGoal}
                aria-label={`Stop guiding to ${currentGoal}`}
                className="min-h-[48px] px-4 py-2 rounded-xl bg-white text-black font-black border-2 border-sky-300 hover:bg-sky-100"
              >
                STOP GUIDING
              </button>
            </div>
          )}
        </div>

        {/* PRIMARY TACTILE ACTION BAR (Massive, high-contrast buttons for blind & low-vision users) */}
        <section
          aria-label="Primary Navigation and Audio Controls"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          {/* Action 1: START / STOP CONTINUOUS ASSISTANCE */}
          <button
            onClick={toggleAssistance}
            aria-label={
              isAssistanceActive
                ? 'Stop Continuous Navigation Assistance. Shortcut S'
                : 'Start Continuous Navigation Assistance. Shortcut S'
            }
            aria-pressed={isAssistanceActive}
            className={`min-h-[84px] px-5 py-4 rounded-2xl font-black flex items-center justify-between gap-3 text-lg md:text-xl transition-all shadow-2xl border-4 active:scale-[0.98] cursor-pointer ${
              isAssistanceActive
                ? 'bg-red-600 hover:bg-red-700 text-white border-white ring-4 ring-red-500/40'
                : 'bg-emerald-400 hover:bg-emerald-300 text-black border-white'
            }`}
          >
            <div className="flex items-center gap-3">
              {isAssistanceActive ? (
                <Square className="w-8 h-8 fill-current shrink-0" />
              ) : (
                <Play className="w-8 h-8 fill-current shrink-0" />
              )}
              <span className="text-left leading-tight">
                {isAssistanceActive ? 'STOP ASSISTANCE' : 'START ASSISTANCE'}
              </span>
            </div>
            <kbd className="px-2.5 py-1 text-xs font-mono font-black bg-black/80 text-white rounded-lg border border-white/40 shrink-0">
              S
            </kbd>
          </button>

          {/* Action 2: DIRECT VOICE INPUT TRIGGER (Prominent Audio Accessibility) */}
          <button
            onClick={() => toggleVoiceRef.current?.()}
            aria-label={
              isVoiceListening
                ? 'Microphone listening. Tap or press Spacebar to send question'
                : 'Ask a question with your voice. Shortcut Spacebar'
            }
            aria-pressed={isVoiceListening}
            className={`min-h-[84px] px-5 py-4 rounded-2xl font-black flex items-center justify-between gap-3 text-lg md:text-xl transition-all shadow-2xl border-4 active:scale-[0.98] cursor-pointer ${
              isVoiceListening
                ? 'bg-red-600 hover:bg-red-700 text-white border-white ring-4 ring-red-500/50 animate-pulse'
                : 'bg-amber-400 hover:bg-amber-300 text-black border-white'
            }`}
          >
            <div className="flex items-center gap-3">
              {isVoiceListening ? (
                <MicOff className="w-8 h-8 shrink-0 animate-bounce stroke-[2.5]" />
              ) : (
                <Mic className="w-8 h-8 shrink-0 stroke-[2.5]" />
              )}
              <span className="text-left leading-tight">
                {isVoiceListening ? 'LISTENING... (TAP)' : 'SPEAK QUESTION'}
              </span>
            </div>
            <kbd className="px-2.5 py-1 text-xs font-mono font-black bg-black text-yellow-300 rounded-lg border border-yellow-300 shrink-0">
              SPACE
            </kbd>
          </button>

          {/* Action 3: SCAN SCENE IMMEDIATELY */}
          <button
            onClick={() => performScan(true)}
            disabled={isScanning}
            aria-label="Scan current camera scene immediately. Shortcut Enter"
            className="min-h-[84px] px-5 py-4 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white rounded-2xl font-black flex items-center justify-between gap-3 text-lg md:text-xl transition-all border-4 border-amber-400 disabled:opacity-50 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <Scan className={`w-8 h-8 text-amber-400 shrink-0 stroke-[2.5] ${isScanning ? 'animate-spin' : ''}`} />
              <span className="text-left leading-tight">
                {isScanning ? 'ANALYZING...' : 'SCAN SCENE NOW'}
              </span>
            </div>
            <kbd className="px-2.5 py-1 text-xs font-mono font-black bg-black text-amber-300 rounded-lg border border-amber-400 shrink-0">
              ENTER
            </kbd>
          </button>

          {/* Action 4: AUDIO MUTE / REPEAT */}
          <div className="flex items-stretch gap-2.5">
            <button
              onClick={() => {
                const next = !isMuted;
                setIsMuted(next);
                if (next) speechManager.stop();
              }}
              aria-label={isMuted ? 'Unmute spoken guidance. Shortcut M' : 'Mute spoken guidance. Shortcut M'}
              aria-pressed={isMuted}
              className={`flex-1 min-h-[84px] px-4 py-4 rounded-2xl font-black flex items-center justify-between gap-2 text-base md:text-lg transition-all border-4 cursor-pointer ${
                isMuted
                  ? 'bg-red-950 border-red-500 text-red-200'
                  : 'bg-slate-900 border-slate-600 text-white hover:border-amber-400'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {isMuted ? (
                  <VolumeX className="w-7 h-7 text-red-400 shrink-0" />
                ) : (
                  <Volume2 className="w-7 h-7 text-emerald-400 shrink-0" />
                )}
                <span className="leading-tight text-left">
                  {isMuted ? 'AUDIO MUTED' : 'AUDIO ON'}
                </span>
              </div>
              <kbd className="px-2 py-0.5 text-xs font-mono font-black bg-black text-slate-200 rounded border border-slate-600">
                M
              </kbd>
            </button>

            {lastSpokenText && (
              <button
                onClick={() => speechManager.speak(lastSpokenText, { interrupt: true })}
                aria-label="Replay last spoken instruction"
                className="min-h-[84px] px-4 py-4 bg-amber-400 hover:bg-amber-300 border-4 border-white rounded-2xl text-black font-black text-xs md:text-sm flex flex-col items-center justify-center gap-1 transition-all shrink-0 cursor-pointer"
              >
                <Volume2 className="w-6 h-6 stroke-[2.5]" />
                <span>REPEAT</span>
              </button>
            )}
          </div>
        </section>

        {/* Main Workspace Grid: Prominent Camera Display + Accessible Audio Input & Guidance */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Prominent Camera Display Column (8 cols default, 12 cols when expanded) */}
          <div
            id="feed"
            className={`${isCameraExpanded ? 'lg:col-span-12' : 'lg:col-span-8'} space-y-6`}
          >
            <CameraView
              sourceType={cameraSource}
              onSourceChange={setCameraSource}
              analysis={currentAnalysis}
              onFrameCaptureReady={handleFrameCaptureReady}
              ariaConfig={ariaConfig}
              onAriaConfigChange={setAriaConfig}
              onOpenAriaSetup={() => setIsAriaModalOpen(true)}
              isExpanded={isCameraExpanded}
              onToggleExpand={() => setIsCameraExpanded((prev) => !prev)}
              onTriggerScan={() => performScan(true)}
              isScanning={isScanning}
              onTriggerVoice={() => toggleVoiceRef.current?.()}
              isListening={isVoiceListening}
            />

            {/* Accessible Audio Input & Voice Assistant Panel */}
            <div id="voice-qa">
              <VoiceAssistant
                getFrame={() => (captureFrameRef.current ? captureFrameRef.current() : null)}
                onAnswerReceived={rememberSpoken}
                onBusyChange={handleVoiceBusyChange}
                onGoalSet={changeGoal}
                onListeningStateChange={setIsVoiceListening}
                registerToggleListening={handleRegisterToggleVoice}
                registerAskQuestion={handleRegisterAskQuestion}
                onVoiceCommand={handleVoiceCommand}
              />
            </div>
          </div>

          {/* Right Column: Spoken Navigation Guidance & History Log */}
          <div
            id="guidance"
            className={`${isCameraExpanded ? 'lg:col-span-12' : 'lg:col-span-4'} space-y-6`}
          >
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

        {/* Low-Vision & Audio Settings Bar */}
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

        {/* Compact High-Contrast Safety Notice */}
        <SafetyDisclaimer />
      </main>

      {/* Persistent Floating Quick-Voice Button (Always reachable from anywhere on screen) */}
      <div className="fixed bottom-5 right-5 z-40">
        <button
          onClick={() => toggleVoiceRef.current?.()}
          aria-label={
            isVoiceListening
              ? 'Stop voice listening and send question'
              : 'Quick Voice Input: Tap or press Spacebar to ask a question'
          }
          className={`min-h-[68px] px-6 py-4 rounded-full font-black text-base md:text-lg flex items-center gap-3 shadow-2xl border-4 transition-all active:scale-95 cursor-pointer ${
            isVoiceListening
              ? 'bg-red-600 text-white border-white ring-8 ring-red-500/40 animate-pulse'
              : 'bg-amber-400 hover:bg-amber-300 text-black border-white shadow-amber-400/30'
          }`}
        >
          {isVoiceListening ? (
            <>
              <MicOff className="w-7 h-7 animate-bounce stroke-[2.5]" />
              <span>LISTENING... (TAP TO SEND)</span>
            </>
          ) : (
            <>
              <Mic className="w-7 h-7 stroke-[2.5]" />
              <span>ASK VOICE [SPACE]</span>
            </>
          )}
        </button>
      </div>

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
