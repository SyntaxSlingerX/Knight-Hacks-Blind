import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Send,
  MessageSquare,
  Sparkles,
  Volume2,
  HelpCircle,
  Radio,
  AlertTriangle,
} from 'lucide-react';
import { soundEffects } from '../utils/audio';
import { speechManager } from '../utils/speech';
import { askNavigationQuestion } from '../utils/geminiClient';
import { VoiceQueryResponse } from '../types/aria';

export const QUICK_VOICE_QUESTIONS = [
  'What is directly in front of me?',
  'Are there stairs or drop-offs ahead?',
  'Where is the nearest door or exit?',
  'Is the walking path ahead clear?',
  'Read any signs or text in view',
  'Find an empty chair or place to sit',
];

export type VoiceCommand = 'start' | 'stop' | 'scan' | 'repeat' | 'clearGoal';

interface VoiceAssistantProps {
  getFrame: () => string | null;
  onAnswerReceived?: (answer: string) => void;
  onListeningStateChange?: (listening: boolean) => void;
  registerToggleListening?: (toggleFn: () => void) => void;
  registerAskQuestion?: (askFn: (q: string) => void) => void;
  onVoiceCommand?: (command: VoiceCommand) => void;
  /** Called when a question asks to go somewhere ("Where's the exit?"), with a short name for the place. */
  onGoalSet?: (goal: string) => void;
  /** True from the moment the mic opens until the spoken answer finishes. */
  onBusyChange?: (busy: boolean) => void;
}

// If an answer's speech never reports finishing, release the busy state anyway
const BUSY_SAFETY_MS = 30000;

export const VoiceAssistant: React.FC<VoiceAssistantProps> = ({
  getFrame,
  onAnswerReceived,
  onListeningStateChange,
  registerToggleListening,
  registerAskQuestion,
  onVoiceCommand,
  onBusyChange,
  onGoalSet,
}) => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>('');
  const [inputText, setInputText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [lastAskedQuestion, setLastAskedQuestion] = useState<string>('');
  const [lastResponse, setLastResponse] = useState<VoiceQueryResponse | null>(null);
  const [speechSupported, setSpeechSupported] = useState<boolean>(true);
  const [micError, setMicError] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>([20, 35, 50, 30, 60, 40, 25, 45, 55, 30]);

  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>('');
  const isListeningRef = useRef<boolean>(false);
  const isProcessingRef = useRef<boolean>(false);
  const audioAnimRef = useRef<number | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const micBlockedRef = useRef<boolean>(false);
  const busyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the latest props in refs so the speech recognizer (created once) never goes stale
  // and isn't torn down mid-question whenever the parent re-renders
  const getFrameRef = useRef(getFrame);
  const onAnswerReceivedRef = useRef(onAnswerReceived);
  const onVoiceCommandRef = useRef(onVoiceCommand);
  const onListeningStateChangeRef = useRef(onListeningStateChange);
  const onBusyChangeRef = useRef(onBusyChange);
  const onGoalSetRef = useRef(onGoalSet);
  onGoalSetRef.current = onGoalSet;
  getFrameRef.current = getFrame;
  onAnswerReceivedRef.current = onAnswerReceived;
  onVoiceCommandRef.current = onVoiceCommand;
  onListeningStateChangeRef.current = onListeningStateChange;
  onBusyChangeRef.current = onBusyChange;

  const setBusy = useCallback((busy: boolean) => {
    if (busyTimerRef.current) {
      clearTimeout(busyTimerRef.current);
      busyTimerRef.current = null;
    }
    if (busy) {
      busyTimerRef.current = setTimeout(() => onBusyChangeRef.current?.(false), BUSY_SAFETY_MS);
    }
    onBusyChangeRef.current?.(busy);
  }, []);

  const stopAudioMeter = useCallback(() => {
    if (audioAnimRef.current) {
      cancelAnimationFrame(audioAnimRef.current);
      audioAnimRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const startAudioMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateMeter = () => {
        if (!isListeningRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        const bars = Array.from({ length: 10 }, (_, i) => {
          const val = dataArray[i % dataArray.length] || 0;
          return Math.max(18, Math.min(100, Math.round((val / 255) * 100)));
        });
        setAudioLevels(bars);
        audioAnimRef.current = requestAnimationFrame(updateMeter);
      };
      updateMeter();
    } catch (_) {
      // Fallback visual pulse if direct mic stream is busy with SpeechRecognition
    }
  }, []);

  const handleSendQuestion = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || isProcessingRef.current) return;

      // Check for quick hands-free system commands
      const lower = trimmed.toLowerCase().replace(/[.!?]+$/, '');
      const command: VoiceCommand | null =
        lower === 'start assistance' || lower === 'start navigation'
          ? 'start'
          : lower === 'stop assistance' || lower === 'stop navigation'
          ? 'stop'
          : lower === 'scan now' || lower === 'scan scene'
          ? 'scan'
          : lower === 'repeat' || lower === 'say again'
          ? 'repeat'
          : ['stop guiding', 'cancel goal', 'clear goal', 'never mind'].includes(lower)
          ? 'clearGoal'
          : null;
      if (command) {
        setBusy(false);
        onVoiceCommandRef.current?.(command);
        return;
      }

      isProcessingRef.current = true;
      setIsProcessing(true);
      setBusy(true);
      setLastAskedQuestion(trimmed);
      speechManager.speak(`Checking: ${trimmed}`);

      try {
        const frame = getFrameRef.current();
        const res = await askNavigationQuestion(frame, trimmed);
        setLastResponse(res);

        // Speak answer aloud immediately with high clarity
        const textToSpeak = [res.spokenAnswer, res.followUpDirection].filter(Boolean).join(' ');
        speechManager.speak(textToSpeak, { interrupt: true, onEnd: () => setBusy(false) });
        onAnswerReceivedRef.current?.(textToSpeak);
        if (res.navigationGoal?.trim()) {
          onGoalSetRef.current?.(res.navigationGoal.trim());
        }

        setInputText('');
        setTranscript('');
        transcriptRef.current = '';
      } catch (err: any) {
        console.error('Error querying voice:', err);
        const errMsg = 'Sorry, I could not analyze the camera view right now. Please try again.';
        speechManager.speak(errMsg, { interrupt: true, onEnd: () => setBusy(false) });
      } finally {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
    },
    [setBusy]
  );
  const handleSendQuestionRef = useRef(handleSendQuestion);
  handleSendQuestionRef.current = handleSendQuestion;

  // Initialize Web Speech Recognition once without aborting on transcript updates
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      isListeningRef.current = true;
      setIsListening(true);
      setMicError(null);
      onListeningStateChangeRef.current?.(true);
      soundEffects.playMicListening();
      startAudioMeter();
    };

    recognition.onresult = (event: any) => {
      let current = '';
      for (let i = 0; i < event.results.length; i++) {
        current += event.results[i][0].transcript;
      }
      transcriptRef.current = current;
      setTranscript(current);
      setInputText(current);
    };

    recognition.onerror = (event: any) => {
      console.warn('Speech recognition error:', event.error);
      isListeningRef.current = false;
      setIsListening(false);
      onListeningStateChangeRef.current?.(false);
      stopAudioMeter();
      soundEffects.playMicEnded();
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        micBlockedRef.current = true;
        const msg = 'Microphone access blocked. Please allow microphone permission in your browser address bar, or use the large quick question buttons below.';
        setMicError(msg);
        speechManager.speak('Microphone permission is blocked. Please allow microphone access or press keys 1 through 6 to ask a question.');
      }
    };

    recognition.onend = () => {
      isListeningRef.current = false;
      setIsListening(false);
      onListeningStateChangeRef.current?.(false);
      stopAudioMeter();
      soundEffects.playMicEnded();

      const captured = transcriptRef.current.trim();
      transcriptRef.current = '';
      if (captured.length > 1) {
        handleSendQuestionRef.current(captured);
      } else if (micBlockedRef.current) {
        micBlockedRef.current = false;
        setBusy(false);
      } else if (!isProcessingRef.current) {
        speechManager.speak("I didn't catch that. Press space and try again.", {
          interrupt: true,
          onEnd: () => setBusy(false),
        });
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onend = null;
      stopAudioMeter();
      try {
        recognition.abort();
      } catch (_) {}
      if (busyTimerRef.current) clearTimeout(busyTimerRef.current);
    };
  }, [startAudioMeter, stopAudioMeter, setBusy]);

  const toggleListening = useCallback(() => {
    if (!speechSupported) {
      const msg = 'Voice recognition is not supported in this browser. Please press keys 1 through 6 for quick voice inquiries, or type below.';
      setMicError(msg);
      speechManager.speak(msg);
      return;
    }

    if (isListeningRef.current) {
      try {
        recognitionRef.current?.stop();
      } catch (_) {}
    } else {
      // Stop any ongoing TTS speech so it doesn't get picked up by the mic
      speechManager.stop();
      setBusy(true);
      transcriptRef.current = '';
      setTranscript('');
      setMicError(null);
      try {
        recognitionRef.current?.start();
      } catch (err) {
        console.warn('Could not start speech recognition:', err);
        setBusy(false);
      }
    }
  }, [speechSupported, setBusy]);

  // Register callbacks with parent App so Spacebar & Top Bar buttons can trigger voice
  useEffect(() => {
    registerToggleListening?.(toggleListening);
  }, [registerToggleListening, toggleListening]);

  useEffect(() => {
    registerAskQuestion?.(handleSendQuestion);
  }, [registerAskQuestion, handleSendQuestion]);

  return (
    <section
      aria-label="Accessible Audio Input and Voice Assistant"
      className={`rounded-3xl p-5 md:p-7 shadow-2xl flex flex-col gap-5 transition-all border-4 ${
        isListening
          ? 'bg-red-950/50 border-red-500 ring-4 ring-red-500/40'
          : 'bg-slate-950 border-amber-400'
      }`}
    >
      {/* Top Header with Clear Audio Status */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div
            className={`p-2.5 rounded-2xl border-2 ${
              isListening
                ? 'bg-red-600 text-white border-white animate-pulse'
                : 'bg-amber-400 text-black border-white'
            }`}
          >
            <Mic className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <h2 className="text-lg md:text-2xl font-black text-white uppercase tracking-wide">
              Audio Input & Voice Assistant
            </h2>
            <p className="text-xs md:text-sm font-bold text-amber-300">
              Press <kbd className="px-2 py-0.5 bg-black text-white border border-amber-400 rounded font-mono">SPACEBAR</kbd> anywhere to speak, or press keys <kbd className="px-2 py-0.5 bg-black text-white border border-amber-400 rounded font-mono">1–6</kbd>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`px-3.5 py-1.5 rounded-xl text-xs md:text-sm font-black uppercase tracking-wider border-2 flex items-center gap-2 ${
              isListening
                ? 'bg-red-600 text-white border-white animate-pulse'
                : isProcessing
                ? 'bg-amber-400 text-black border-white'
                : 'bg-slate-900 text-emerald-300 border-emerald-500/60'
            }`}
          >
            <Radio className="w-4 h-4" />
            <span>
              {isListening ? 'MIC LISTENING LIVE' : isProcessing ? 'PROCESSING AUDIO...' : 'MIC READY'}
            </span>
          </span>
        </div>
      </div>

      {/* GIANT TACTILE PUSH-TO-TALK / TAP-TO-SPEAK MICROPHONE BUTTON */}
      <button
        onClick={toggleListening}
        disabled={isProcessing}
        aria-label={
          isListening
            ? 'Microphone is listening. Tap or press Spacebar to finish speaking and send question'
            : 'Activate microphone to ask a question with your voice. Shortcut: Spacebar'
        }
        aria-pressed={isListening}
        className={`w-full min-h-[96px] md:min-h-[112px] px-6 py-5 rounded-2xl font-black flex flex-col items-center justify-center gap-3 transition-all shadow-2xl border-4 active:scale-[0.99] cursor-pointer ${
          isListening
            ? 'bg-red-600 hover:bg-red-700 text-white border-white ring-4 ring-red-400/50'
            : 'bg-amber-400 hover:bg-amber-300 text-black border-white shadow-amber-400/20'
        } disabled:opacity-50`}
      >
        <div className="flex items-center justify-center gap-4">
          {isListening ? (
            <MicOff className="w-9 h-9 md:w-11 md:h-11 stroke-[2.5] animate-bounce" />
          ) : (
            <Mic className="w-9 h-9 md:w-11 md:h-11 stroke-[2.5]" />
          )}
          <span className="text-xl sm:text-2xl md:text-3xl tracking-tight uppercase text-center">
            {isListening ? 'LISTENING... TAP TO SEND' : 'TAP TO SPEAK QUESTION'}
          </span>
        </div>

        {/* Live High-Contrast Audio Waveform / Sub-label */}
        {isListening ? (
          <div className="flex items-end justify-center gap-1.5 h-8 pt-1" aria-hidden="true">
            {audioLevels.map((lvl, idx) => (
              <span
                key={idx}
                style={{ height: `${ Math.max(25, lvl) }%` }}
                className="w-2.5 bg-yellow-300 rounded-full transition-all duration-75"
              />
            ))}
          </div>
        ) : (
          <span className="text-xs sm:text-sm md:text-base font-extrabold uppercase tracking-wider bg-black/90 text-yellow-300 px-4 py-1 rounded-xl border border-black">
            Hands-Free Shortcut: Press [SPACEBAR] Anywhere
          </span>
        )}
      </button>

      {/* Real-Time Live Speech Transcript Display (Huge High-Contrast Text while speaking) */}
      {(isListening || transcript) && (
        <div
          role="status"
          aria-live="polite"
          className="p-4 md:p-5 bg-black border-2 border-yellow-300 rounded-2xl flex flex-col gap-1"
        >
          <span className="text-xs font-black uppercase tracking-wider text-yellow-300">
            Live Voice Transcript:
          </span>
          <p className="text-xl md:text-2xl font-extrabold text-white">
            {transcript ? `"${transcript}"` : 'Speak now... Listening for your voice...'}
          </p>
        </div>
      )}

      {/* Microphone Error Notice if Blocked */}
      {micError && (
        <div
          role="alert"
          className="p-4 bg-red-950 border-2 border-red-400 rounded-2xl flex items-center gap-3 text-white font-bold text-sm md:text-base"
        >
          <AlertTriangle className="w-6 h-6 text-yellow-300 shrink-0" />
          <span>{micError}</span>
        </div>
      )}

      {/* Processing Indicator */}
      {isProcessing && (
        <div
          role="status"
          aria-live="assertive"
          className="p-5 bg-black rounded-2xl border-4 border-amber-400 flex items-center gap-4 animate-pulse"
        >
          <Sparkles className="w-8 h-8 text-amber-400 animate-spin shrink-0" />
          <div>
            <div className="text-lg md:text-xl font-black text-white uppercase">
              Analyzing Camera View...
            </div>
            <div className="text-sm md:text-base font-bold text-yellow-300">
              Answering: "{lastAskedQuestion}"
            </div>
          </div>
        </div>
      )}

      {/* Spoken Answer Display (Oversized High-Visibility Card) */}
      {lastResponse && !isProcessing && (
        <div
          role="region"
          aria-label="Spoken Voice Response"
          className="p-5 md:p-6 bg-black border-4 border-emerald-400 rounded-2xl flex flex-col gap-3 shadow-2xl"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-slate-800 pb-3">
            <span className="flex items-center gap-2 text-sm md:text-base text-emerald-300 font-black uppercase tracking-wider">
              <Volume2 className="w-6 h-6" />
              <span>Aria Voice Answer:</span>
            </span>
            <button
              onClick={() =>
                speechManager.speak(
                  `${lastResponse.spokenAnswer} ${lastResponse.followUpDirection || ''}`,
                  { interrupt: true }
                )
              }
              aria-label="Repeat spoken answer aloud"
              className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-black font-black text-xs md:text-sm rounded-xl border-2 border-white flex items-center gap-1.5 transition-colors"
            >
              <Volume2 className="w-4 h-4" />
              <span>REPEAT ALOUD</span>
            </button>
          </div>

          <p className="text-xl md:text-2xl lg:text-3xl font-black text-white leading-snug">
            "{lastResponse.spokenAnswer}"
          </p>

          {lastResponse.followUpDirection && (
            <div className="text-base md:text-lg text-yellow-300 font-extrabold bg-slate-900 p-3.5 rounded-xl border-2 border-yellow-400">
              Direction: {lastResponse.followUpDirection}
            </div>
          )}

          {lastResponse.safetyNote && (
            <div className="text-sm md:text-base text-red-200 font-extrabold bg-red-950/90 p-3 rounded-xl border-2 border-red-400">
              Safety Warning: {lastResponse.safetyNote}
            </div>
          )}
        </div>
      )}

      {/* Large One-Tap Quick Voice Inquiries (Keyboard Shortcuts 1-6) */}
      <div className="space-y-3">
        <div className="text-sm md:text-base font-black text-white uppercase tracking-wider flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-amber-400 shrink-0" />
          <span>One-Tap Audio Questions (Or Press Keys 1–6):</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {QUICK_VOICE_QUESTIONS.map((q, index) => (
            <button
              key={q}
              onClick={() => handleSendQuestion(q)}
              disabled={isProcessing}
              aria-label={`Quick Question ${index + 1}: ${q}`}
              className="text-left bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white border-2 border-slate-700 hover:border-amber-400 p-3.5 md:p-4 rounded-2xl transition-all min-h-[60px] flex items-center gap-3 font-extrabold text-sm md:text-base shadow-md disabled:opacity-50"
            >
              <span className="px-2.5 py-1 bg-amber-400 text-black font-mono font-black rounded-lg text-sm shrink-0 border border-white">
                {index + 1}
              </span>
              <span className="leading-snug">{q}</span>
            </button>
          ))}
        </div>
      </div>

      {/* High-Contrast Text Input Fallback */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendQuestion(inputText);
        }}
        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2 border-t-2 border-slate-800"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Or type a question here and press Enter..."
          aria-label="Type a navigation question"
          disabled={isProcessing}
          className="flex-1 min-h-[58px] bg-black border-2 border-slate-600 focus:border-yellow-300 rounded-2xl px-4 text-base md:text-lg text-white placeholder:text-slate-400 font-bold"
        />
        <button
          type="submit"
          disabled={!inputText.trim() || isProcessing}
          aria-label="Send typed question"
          className="min-h-[58px] px-6 flex items-center justify-center gap-2 bg-amber-400 hover:bg-amber-300 text-black disabled:opacity-40 font-black text-base rounded-2xl transition-colors border-2 border-white shrink-0"
        >
          <Send className="w-5 h-5" />
          <span>ASK</span>
        </button>
      </form>
    </section>
  );
};
