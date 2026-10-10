import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Send, MessageSquare, Sparkles, Volume2, HelpCircle } from 'lucide-react';
import { soundEffects } from '../utils/audio';
import { speechManager } from '../utils/speech';
import { askNavigationQuestion } from '../utils/geminiClient';
import { VoiceQueryResponse } from '../types/aria';

interface VoiceAssistantProps {
  getFrame: () => string | null;
  onAnswerReceived?: (answer: string) => void;
  /** True from the moment the mic opens until the spoken answer finishes. */
  onBusyChange?: (busy: boolean) => void;
}

// If an answer's speech never reports finishing, release the busy state anyway
const BUSY_SAFETY_MS = 30000;

export const VoiceAssistant: React.FC<VoiceAssistantProps> = ({
  getFrame,
  onAnswerReceived,
  onBusyChange,
}) => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [inputText, setInputText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [lastResponse, setLastResponse] = useState<VoiceQueryResponse | null>(null);
  const [speechSupported, setSpeechSupported] = useState<boolean>(true);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>('');
  const isProcessingRef = useRef<boolean>(false);
  const busyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep latest props/handlers in refs so the recognition callbacks (created once) never go stale
  const getFrameRef = useRef(getFrame);
  const onAnswerReceivedRef = useRef(onAnswerReceived);
  const onBusyChangeRef = useRef(onBusyChange);
  getFrameRef.current = getFrame;
  onAnswerReceivedRef.current = onAnswerReceived;
  onBusyChangeRef.current = onBusyChange;

  const setBusy = (busy: boolean) => {
    if (busyTimerRef.current) {
      clearTimeout(busyTimerRef.current);
      busyTimerRef.current = null;
    }
    if (busy) {
      busyTimerRef.current = setTimeout(() => onBusyChangeRef.current?.(false), BUSY_SAFETY_MS);
    }
    onBusyChangeRef.current?.(busy);
  };

  const handleSendQuestion = async (question: string) => {
    if (!question.trim() || isProcessingRef.current) return;

    isProcessingRef.current = true;
    setIsProcessing(true);
    setBusy(true);
    try {
      const frame = getFrameRef.current();
      const res = await askNavigationQuestion(frame, question);
      setLastResponse(res);

      // Speak the answer right away, cutting off any navigation chatter
      const textToSpeak = [res.spokenAnswer, res.followUpDirection].filter(Boolean).join(' ');
      speechManager.speak(textToSpeak, { interrupt: true, onEnd: () => setBusy(false) });
      onAnswerReceivedRef.current?.(textToSpeak);

      setInputText('');
    } catch (err: any) {
      console.error('Error querying voice:', err);
      speechManager.speak('Sorry, I could not analyze the scene right now. Please try again.', {
        interrupt: true,
        onEnd: () => setBusy(false),
      });
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  };
  const handleSendQuestionRef = useRef(handleSendQuestion);
  handleSendQuestionRef.current = handleSendQuestion;

  // Initialize Web Speech Recognition once
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
      setIsListening(true);
      soundEffects.playMicListening();
    };

    recognition.onresult = (event: any) => {
      let current = '';
      for (let i = 0; i < event.results.length; i++) {
        current += event.results[i][0].transcript;
      }
      transcriptRef.current = current;
      setInputText(current);
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        speechManager.speak('Microphone access is blocked. Allow the microphone in your browser settings.', {
          interrupt: true,
        });
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.warn('Speech recognition error:', event.error);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      soundEffects.playMicEnded();
      const heard = transcriptRef.current.trim();
      transcriptRef.current = '';
      if (heard.length > 2) {
        handleSendQuestionRef.current(heard);
      } else {
        speechManager.speak("I didn't catch that. Tap the button and try again.", {
          interrupt: true,
          onEnd: () => setBusy(false),
        });
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onend = null;
      try {
        recognition.abort();
      } catch (_) {}
      if (busyTimerRef.current) clearTimeout(busyTimerRef.current);
    };
  }, []);

  const toggleListening = () => {
    if (!speechSupported) {
      speechManager.speak('Voice questions are not supported in this browser. Try Chrome or Safari, or type your question.', {
        interrupt: true,
      });
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      // Silence the assistant so the mic doesn't hear it talking
      speechManager.stop();
      setBusy(true);
      transcriptRef.current = '';
      try {
        recognitionRef.current?.start();
      } catch (err) {
        console.warn('Could not start speech recognition:', err);
        setBusy(false);
      }
    }
  };

  const quickQuestions = [
    'What is in front of me?',
    'Where is the nearest door?',
    'Are there stairs or drop-offs?',
    'Is it safe to cross?',
    'Find a place to sit',
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-amber-400" />
          <h3 className="text-base font-bold text-white">Voice Interaction & Questions</h3>
        </div>
        <span className="text-xs text-slate-400 font-mono">Hands-Free Assistant</span>
      </div>

      {/* Large Tactile Voice Button */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <button
          onClick={toggleListening}
          aria-label={isListening ? 'Stop listening to your voice' : 'Ask question with voice'}
          disabled={isProcessing}
          className={`w-full sm:w-auto flex-1 min-h-[56px] px-6 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all text-base shadow-lg ${
            isListening
              ? 'bg-red-600 hover:bg-red-700 text-white ring-4 ring-red-400/30 animate-pulse'
              : 'bg-amber-400 hover:bg-amber-300 text-slate-950 active:scale-[0.98]'
          }`}
        >
          {isListening ? (
            <>
              <MicOff className="w-6 h-6 animate-spin" />
              <span>Listening... (Tap to Send)</span>
            </>
          ) : (
            <>
              <Mic className="w-6 h-6 text-slate-950" />
              <span>Ask Glasses Question (Voice)</span>
            </>
          )}
        </button>

        {/* Text Input Fallback */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendQuestion(inputText);
          }}
          className="flex items-center gap-2 w-full sm:w-auto sm:flex-1"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Or type a question..."
            aria-label="Type a navigation question"
            disabled={isProcessing}
            className="flex-1 min-h-[52px] bg-slate-950 border border-slate-800 rounded-xl px-4 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400 font-medium"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isProcessing}
            aria-label="Send question"
            className="min-h-[52px] min-w-[52px] flex items-center justify-center bg-slate-800 hover:bg-slate-700 text-amber-400 disabled:opacity-50 disabled:text-slate-600 rounded-xl transition-colors border border-slate-700"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>

      {/* Suggested Quick Inquiries */}
      <div>
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <HelpCircle className="w-3.5 h-3.5" />
          <span>Quick Inquiries (Tap to Ask):</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {quickQuestions.map((q) => (
            <button
              key={q}
              onClick={() => handleSendQuestion(q)}
              disabled={isProcessing}
              className="text-xs bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 hover:border-amber-400/50 px-3 py-2 rounded-xl transition-colors min-h-[38px] flex items-center font-medium"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Spoken Answer Display */}
      {isProcessing && (
        <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 flex items-center gap-3 animate-pulse">
          <Sparkles className="w-5 h-5 text-amber-400 animate-spin" />
          <span className="text-sm font-medium text-slate-300">
            Analyzing glasses view and preparing spoken answer...
          </span>
        </div>
      )}

      {lastResponse && !isProcessing && (
        <div
          role="region"
          aria-label="Voice Answer"
          className="p-4 bg-slate-950 border border-amber-400/30 rounded-2xl flex flex-col gap-2"
        >
          <div className="flex items-center justify-between text-xs text-amber-400 font-bold uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <Volume2 className="w-4 h-4" />
              <span>Aria Spoken Response:</span>
            </span>
            <button
              onClick={() =>
                speechManager.speak(
                  [lastResponse.spokenAnswer, lastResponse.followUpDirection].filter(Boolean).join(' '),
                  { interrupt: true }
                )
              }
              className="text-xs text-slate-300 hover:text-white underline"
            >
              Repeat Audio
            </button>
          </div>

          <p className="text-base font-semibold text-white leading-relaxed">
            "{lastResponse.spokenAnswer}"
          </p>

          {lastResponse.followUpDirection && (
            <p className="text-xs text-amber-300 font-medium bg-amber-950/40 p-2 rounded-lg border border-amber-900/50">
              🧭 Guidance: {lastResponse.followUpDirection}
            </p>
          )}

          {lastResponse.safetyNote && (
            <p className="text-xs text-red-300 font-medium">⚠️ Safety: {lastResponse.safetyNote}</p>
          )}
        </div>
      )}
    </div>
  );
};
