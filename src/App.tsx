/**
 * Aria Vision: Minimalist AI Vision & Voice Assistant with Spatial Object Memory
 * Pure Video Display + Single Prominent Voice Input Button (iPhone & Desktop Compatible)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Sparkles } from 'lucide-react';
import {
  CameraSourceType,
  AriaConnectionConfig,
  RememberedObject,
  MemoryFrameSnapshot,
} from './types/aria';
import { CameraView } from './components/CameraView';
import { soundEffects } from './utils/audio';
import { speechManager } from './utils/speech';
import {
  askNavigationQuestion,
  memorizeFrameObjects,
  FormattedPastFrame,
  FormattedMemoryItem,
} from './utils/geminiClient';

const STORAGE_KEY = 'aria_spatial_object_memory_v1';
const MAX_REMEMBERED_OBJECTS = 40;
const MAX_PAST_FRAMES = 5;

function computeRelativeDirectionHint(
  pastHeading: number | null | undefined,
  currentHeading: number | null | undefined
): string | undefined {
  if (pastHeading == null || currentHeading == null) return undefined;
  // Signed angle from currentHeading to pastHeading in [-180, 180]
  let delta = ((pastHeading - currentHeading + 540) % 360) - 180;
  const absDelta = Math.round(Math.abs(delta));

  if (absDelta < 20) return 'roughly in the direction you are currently facing';
  if (absDelta > 150) return `behind you (about ${absDelta}° turn around)`;
  if (delta < 0) {
    return `to your left (turn about ${absDelta}° left)`;
  }
  return `to your right (turn about ${absDelta}° right)`;
}

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
  const [isRecalledFromMemory, setIsRecalledFromMemory] = useState<boolean>(false);
  const [spatialMemory, setSpatialMemory] = useState<RememberedObject[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return [];
  });

  const captureFrameRef = useRef<(() => string | null) | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef<string>('');
  const isListeningRef = useRef<boolean>(false);
  const isProcessingRef = useRef<boolean>(false);

  // Spatial Memory & Orientation Refs
  const spatialMemoryRef = useRef<RememberedObject[]>(spatialMemory);
  const recentFramesRef = useRef<MemoryFrameSnapshot[]>([]);
  const lastFingerprintRef = useRef<Uint8Array | null>(null);
  const lastBackgroundMemorizeRef = useRef<number>(0);
  const isMemorizingRef = useRef<boolean>(false);
  const headingRef = useRef<number | null>(null);
  const orientationPermissionRequestedRef = useRef<boolean>(false);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    spatialMemoryRef.current = spatialMemory;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(spatialMemory));
    } catch (_) {}
  }, [spatialMemory]);

  const handleFrameCaptureReady = useCallback((captureFn: () => string | null) => {
    captureFrameRef.current = captureFn;
  }, []);

  // Merge newly observed objects into Spatial Memory
  const mergeObservedObjects = useCallback(
    (
      newItems: { label: string; position: string; distance: string; landmarkContext: string }[],
      observedHeading: number | null
    ) => {
      if (!Array.isArray(newItems) || newItems.length === 0) return;
      const now = Date.now();

      setSpatialMemory((prev) => {
        const map = new Map<string, RememberedObject>();
        for (const existing of prev) {
          map.set(existing.label.trim().toLowerCase(), existing);
        }

        for (const item of newItems) {
          if (!item?.label) continue;
          const key = item.label.trim().toLowerCase();
          map.set(key, {
            label: item.label.trim(),
            position: item.position || 'in view',
            distance: item.distance || 'nearby',
            landmarkContext: item.landmarkContext || 'in the room',
            headingDeg: observedHeading,
            timestamp: now,
          });
        }

        return Array.from(map.values())
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, MAX_REMEMBERED_OBJECTS);
      });
    },
    []
  );

  // Track device compass heading (DeviceOrientationEvent) for relative direction recall
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOrientation = (e: any) => {
      if (typeof e.webkitCompassHeading === 'number') {
        headingRef.current = e.webkitCompassHeading;
      } else if (typeof e.alpha === 'number') {
        headingRef.current = (360 - e.alpha) % 360;
      }
    };

    window.addEventListener('deviceorientation', handleOrientation, true);
    return () => window.removeEventListener('deviceorientation', handleOrientation, true);
  }, []);

  // Compute a 16x16 grayscale fingerprint of a base64 image to detect when camera pans to a new view
  const computeImageFingerprint = useCallback((dataUrl: string): Promise<Uint8Array | null> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, 16, 16);
        const pixels = ctx.getImageData(0, 0, 16, 16).data;
        const gray = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
          const idx = i * 4;
          gray[i] = Math.round(
            0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2]
          );
        }
        resolve(gray);
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }, []);

  // Continuous Background Scene-Change Watcher & Object Memory Indexer
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!captureFrameRef.current) return;
      const frame = captureFrameRef.current();
      if (!frame) return;

      const fingerprint = await computeImageFingerprint(frame);
      if (!fingerprint) return;

      let diffScore = 999;
      if (lastFingerprintRef.current) {
        let totalDiff = 0;
        for (let i = 0; i < 256; i++) {
          totalDiff += Math.abs(fingerprint[i] - lastFingerprintRef.current[i]);
        }
        diffScore = totalDiff / 256;
      }

      // If camera moved to a noticeably different view (or first snapshot)
      if (diffScore > 16) {
        lastFingerprintRef.current = fingerprint;
        const now = Date.now();
        const snapshotHeading = headingRef.current;

        recentFramesRef.current = [
          { image: frame, timestamp: now, headingDeg: snapshotHeading },
          ...recentFramesRef.current,
        ].slice(0, MAX_PAST_FRAMES);

        // Background object extraction every ~9s when viewing a new area
        if (
          !isProcessingRef.current &&
          !isMemorizingRef.current &&
          now - lastBackgroundMemorizeRef.current > 9000
        ) {
          isMemorizingRef.current = true;
          lastBackgroundMemorizeRef.current = now;
          memorizeFrameObjects(frame)
            .then((objects) => {
              mergeObservedObjects(objects, snapshotHeading);
            })
            .catch(() => {})
            .finally(() => {
              isMemorizingRef.current = false;
            });
        }
      }
    }, 2200);

    return () => clearInterval(interval);
  }, [computeImageFingerprint, mergeObservedObjects]);

  // Send captured voice question (or recorded audio) + video frame + Spatial Memory to Gemini Vision
  const processVoiceQuery = useCallback(
    async (questionText: string, audioBase64?: string | null, audioMimeType?: string) => {
      if (isProcessingRef.current) return;

      const trimmed = questionText.trim();
      if (
        trimmed.toLowerCase() === 'clear memory' ||
        trimmed.toLowerCase() === 'reset memory' ||
        trimmed.toLowerCase() === 'forget everything'
      ) {
        setSpatialMemory([]);
        recentFramesRef.current = [];
        const msg = 'Spatial object memory has been cleared.';
        setSpokenResponse(msg);
        setIsRecalledFromMemory(false);
        speechManager.speak(msg, { isUrgent: true });
        return;
      }

      const query =
        trimmed.length > 1
          ? trimmed
          : 'What is directly in front of me and is the path safe to walk?';

      setIsProcessing(true);
      try {
        const now = Date.now();
        const currentHeading = headingRef.current;
        const frame = captureFrameRef.current ? captureFrameRef.current() : null;

        // Format past distinct frames (excluding ones captured < 1.5s ago)
        const formattedPastFrames: FormattedPastFrame[] = recentFramesRef.current
          .filter((f) => now - f.timestamp >= 1500)
          .slice(0, 3)
          .map((f) => ({
            image: f.image,
            secondsAgo: Math.max(1, Math.round((now - f.timestamp) / 1000)),
            relativeDirectionHint: computeRelativeDirectionHint(f.headingDeg, currentHeading),
          }));

        // Format spatial object memory items
        const formattedMemory: FormattedMemoryItem[] = spatialMemoryRef.current.map((m) => ({
          label: m.label,
          position: m.position,
          distance: m.distance,
          landmarkContext: m.landmarkContext,
          secondsAgo: Math.max(1, Math.round((now - m.timestamp) / 1000)),
          relativeDirectionHint: computeRelativeDirectionHint(m.headingDeg, currentHeading),
        }));

        const res = await askNavigationQuestion(
          frame,
          query,
          audioBase64,
          audioMimeType,
          formattedPastFrames,
          formattedMemory
        );

        // Save any objects seen in the current frame into Spatial Memory
        if (res.observedObjects && res.observedObjects.length > 0) {
          mergeObservedObjects(res.observedObjects, currentHeading);
        }

        // Also store current frame into recent frames buffer
        if (frame) {
          recentFramesRef.current = [
            { image: frame, timestamp: now, headingDeg: currentHeading },
            ...recentFramesRef.current,
          ].slice(0, MAX_PAST_FRAMES);
        }

        const fullAnswer = res.followUpDirection
          ? `${res.spokenAnswer} ${res.followUpDirection}`
          : res.spokenAnswer;

        setIsRecalledFromMemory(Boolean(res.isFromMemory));
        setSpokenResponse(fullAnswer);
        speechManager.speak(fullAnswer, { isUrgent: true });
      } catch (err) {
        console.error('Voice query error:', err);
        const fallbackMsg = 'Could not analyze the video feed right now. Please try again.';
        setIsRecalledFromMemory(false);
        setSpokenResponse(fallbackMsg);
        speechManager.speak(fallbackMsg, { isUrgent: true });
      } finally {
        setIsProcessing(false);
        setTranscript('');
        transcriptRef.current = '';
      }
    },
    [mergeObservedObjects]
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

  // Toggle Voice Input (Unlocks iOS Safari TTS + iOS Compass Orientation on tap)
  const toggleVoiceInput = useCallback(() => {
    speechManager.unlockForIOS();

    // Request iOS 13+ DeviceOrientation permission on first user tap so compass tracking works
    if (
      !orientationPermissionRequestedRef.current &&
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof (DeviceOrientationEvent as any).requestPermission === 'function'
    ) {
      orientationPermissionRequestedRef.current = true;
      (DeviceOrientationEvent as any).requestPermission().catch(() => {});
    }

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
        isRecalledFromMemory={isRecalledFromMemory}
        rememberedObjectCount={spatialMemory.length}
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
              ANALYZING VIDEO & MEMORY...
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
