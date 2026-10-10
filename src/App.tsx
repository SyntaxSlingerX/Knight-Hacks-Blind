/**
 * Aria Vision: Minimalist AI Vision & Voice Assistant for the Visually Impaired
 * Pure Video Display + Single Prominent Voice Input Button (iPhone & Desktop Compatible)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Sparkles } from 'lucide-react';
import { CameraSourceType, AriaConnectionConfig } from './types/aria';
import { CameraView } from './components/CameraView';
import { soundEffects } from './utils/audio';
import { speechManager } from './utils/speech';
import { askNavigationQuestion } from './utils/geminiClient';

export default function App() {
  const [cameraSource, setCameraSource] = useState<CameraSourceType>('webcam');
  const [ariaConfig, setAriaConfig] = useState<AriaConnectionConfig>({
    streamUrl: 'ws://localhost:7000',
    connected: false,
    deviceModel: 'Meta Project Aria',
    fps: 0,
    latencyMs: 42,
  });

  const [isListening, setIsListening] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>('');
  const [spokenResponse, setSpokenResponse] = useState<string>('');

  const captureFrameRef = useRef<(() => string | null) | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef<string>('');
  const isListeningRef = useRef<boolean>(false);
  const isProcessingRef = useRef<boolean>(false);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  const handleFrameCaptureReady = useCallback((captureFn: () => string | null) => {
    captureFrameRef.current = captureFn;
  }, []);

  // Send captured voice question (or recorded audio) + video frame to Gemini Vision
  const processVoiceQuery = useCallback(
    async (questionText: string, audioBase64?: string | null, audioMimeType?: string) => {
      if (isProcessingRef.current) return;

      const query =
        questionText.trim().length > 1
          ? questionText.trim()
          : 'What is directly in front of me and is the path safe to walk?';

      setIsProcessing(true);
      try {
        const frame = captureFrameRef.current ? captureFrameRef.current() : null;
        const res = await askNavigationQuestion(frame, query, audioBase64, audioMimeType);

        const fullAnswer = res.followUpDirection
          ? `${res.spokenAnswer} ${res.followUpDirection}`
          : res.spokenAnswer;

        setSpokenResponse(fullAnswer);
        speechManager.speak(fullAnswer, { isUrgent: true });
      } catch (err) {
        console.error('Voice query error:', err);
        const fallbackMsg = 'Could not analyze the video feed right now. Please try again.';
        setSpokenResponse(fallbackMsg);
        speechManager.speak(fallbackMsg, { isUrgent: true });
      } finally {
        setIsProcessing(false);
        setTranscript('');
        transcriptRef.current = '';
      }
    },
    []
  );

  // Initialize Web Speech Recognition (Safari / Chrome Desktop)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      isListeningRef.current = true;
      setIsListening(true);
      soundEffects.playMicListening();
    };

    recognition.onresult = (event: any) => {
      let current = '';
      for (let i = 0; i < event.results.length; i++) {
        current += event.results[i][0].transcript;
      }
      transcriptRef.current = current;
      setTranscript(current);
    };

    recognition.onerror = () => {
      isListeningRef.current = false;
      setIsListening(false);
      soundEffects.playMicEnded();
    };

    recognition.onend = () => {
      isListeningRef.current = false;
      setIsListening(false);
      soundEffects.playMicEnded();

      const captured = transcriptRef.current.trim();
      processVoiceQuery(captured);
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognitionRef.current?.abort();
      } catch (_) {}
    };
  }, [processVoiceQuery]);

  // Fallback audio recorder for iPhone browsers where SpeechRecognition is restricted (e.g. Chrome on iOS)
  const startAudioRecordingFallback = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        isListeningRef.current = false;
        setIsListening(false);
        soundEffects.playMicEnded();

        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/mp4',
        });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Audio = typeof reader.result === 'string' ? reader.result : null;
          processVoiceQuery('', base64Audio, recorder.mimeType || 'audio/mp4');
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      isListeningRef.current = true;
      setIsListening(true);
      soundEffects.playMicListening();
    } catch (err) {
      console.warn('Microphone unavailable, analyzing video directly:', err);
      processVoiceQuery('What is directly in front of me and is the path safe?');
    }
  }, [processVoiceQuery]);

  // Toggle Voice Input (Unlocks iOS Safari TTS on tap)
  const toggleVoiceInput = useCallback(() => {
    // Unlock iOS Safari audio output inside direct user tap gesture
    speechManager.unlockForIOS();

    if (isProcessingRef.current) return;

    // Stop active recording/recognition if currently listening
    if (isListeningRef.current) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
        return;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (_) {}
      }
      return;
    }

    speechManager.stop();
    transcriptRef.current = '';
    setTranscript('');

    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
        return;
      } catch (err) {
        console.warn('SpeechRecognition failed, falling back to MediaRecorder:', err);
      }
    }

    // Use MediaRecorder fallback on iPhone browsers without SpeechRecognition
    startAudioRecordingFallback();
  }, [startAudioRecordingFallback]);

  // Spacebar shortcut to activate voice input on desktop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        toggleVoiceInput();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        speechManager.stop();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleVoiceInput]);

  return (
    <main className="h-[100dvh] w-screen bg-black text-white p-3 sm:p-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] flex flex-col gap-3 sm:gap-4 overflow-hidden select-none">
      {/* 1. Prominent Video Display */}
      <CameraView
        sourceType={cameraSource}
        onSourceChange={setCameraSource}
        onFrameCaptureReady={handleFrameCaptureReady}
        ariaConfig={ariaConfig}
        onAriaConfigChange={setAriaConfig}
        isListening={isListening}
        isProcessing={isProcessing}
        liveTranscript={transcript}
        spokenResponse={spokenResponse}
      />

      {/* 2. Single Prominent Button to Activate Voice Input */}
      <button
        onClick={toggleVoiceInput}
        disabled={isProcessing}
        aria-label={
          isListening
            ? 'Listening to your voice. Tap to send.'
            : 'Activate voice input. Tap to speak.'
        }
        aria-pressed={isListening}
        className={`w-full min-h-[104px] sm:min-h-[128px] rounded-3xl font-black flex items-center justify-center gap-3 sm:gap-4 px-5 transition-all border-4 shadow-2xl active:scale-[0.99] cursor-pointer shrink-0 touch-manipulation ${
          isListening
            ? 'bg-red-600 hover:bg-red-700 text-white border-white ring-4 ring-red-500/50 animate-pulse'
            : isProcessing
            ? 'bg-slate-900 text-amber-300 border-amber-400'
            : 'bg-amber-400 hover:bg-amber-300 text-black border-white'
        }`}
      >
        {isListening ? (
          <>
            <MicOff className="w-9 h-9 sm:w-12 sm:h-12 stroke-[2.5] animate-bounce shrink-0" />
            <span className="text-xl sm:text-4xl tracking-tight uppercase">
              LISTENING... TAP TO SEND
            </span>
          </>
        ) : isProcessing ? (
          <>
            <Sparkles className="w-9 h-9 sm:w-12 sm:h-12 stroke-[2.5] animate-spin shrink-0" />
            <span className="text-xl sm:text-4xl tracking-tight uppercase">
              ANALYZING VIDEO...
            </span>
          </>
        ) : (
          <>
            <Mic className="w-9 h-9 sm:w-12 sm:h-12 stroke-[2.5] shrink-0" />
            <span className="text-xl sm:text-4xl tracking-tight uppercase">
              TAP TO SPEAK
            </span>
          </>
        )}
      </button>
    </main>
  );
}
