/**
 * Aria Vision: Minimalist AI Vision & Voice Assistant with Spatial Object Memory
 * Pure Video Display + Single Prominent Voice Input Button (iPhone & Desktop Compatible)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, Sparkles } from 'lucide-react';
import {
  CameraSourceType,
  AriaConnectionConfig,
  RememberedObject,
  MemoryFrameSnapshot,
  EarlyNavigationAnalysis,
} from './types/aria';
import { CameraView } from './components/CameraView';
import { soundEffects } from './utils/audio';
import { speechManager } from './utils/speech';
import {
  analyzeNavigationFrame,
  askNavigationQuestion,
  memorizeFrameObjects,
  QuotaExceededError,
  FormattedPastFrame,
  FormattedMemoryItem,
  ConversationTurn,
} from './utils/geminiClient';

const STORAGE_KEY = 'aria_spatial_object_memory_v1';
const MAX_REMEMBERED_OBJECTS = 40;
// Remembered objects older than this are from another place or visit, so they are dropped on load
const MEMORY_MAX_AGE_MS = 30 * 60 * 1000;
const MAX_PAST_FRAMES = 5;
const MAX_CONVERSATION_TURNS = 8;

// Automatic hazard watch (runs while the conversation is on)
const SCAN_INTERVAL_MS = 1500; // shortest gap between two looks
const SCAN_TICK_MS = 250; // how often to check whether it is time for the next look
const SCAN_VIEW_CHANGE_THRESHOLD = 8; // average grayscale change that counts as a new view
const SCAN_UNCHANGED_VIEW_MS = 20000; // re-check an unchanged view this often
const HAZARD_REPEAT_MS = 6000;
const CAUTION_REPEAT_MS = 15000;
const VIEW_REQUEST_REPEAT_MS = 30000;
// Spoken updates about what is ahead: only after this much quiet, so the user has room to talk
const NARRATION_QUIET_MS = 3000;
// While guiding the user to a destination, the next step may follow much sooner
const GOAL_GUIDANCE_QUIET_MS = 1500;

// Asked automatically when the conversation starts, so the user hears where they are first
const AREA_SCAN_QUESTION =
  'I just put the glasses on. Scan the area for me: what kind of place is this, what objects and people are around me and where are they, and is the path ahead clear?';

// How often to check whether the camera has a picture yet, before starting by itself
const CAMERA_READY_CHECK_MS = 500;

// Glasses picture lost: say so after this long, then keep reminding while it stays lost
const FEED_LOST_ANNOUNCE_MS = 3000;
const FEED_LOST_REPEAT_MS = 20000;

// Vision service out of quota: wait at most this long before checking again
const QUOTA_RETRY_MAX_MS = 60000;
const QUOTA_MESSAGE =
  "Caution! The vision service has reached its usage limit. I can't see right now.";

function fingerprintDifference(a: Uint8Array, b: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    total += Math.abs(a[i] - b[i]);
  }
  return total / a.length;
}

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
    streamUrl: import.meta.env.VITE_ARIA_STREAM_URL || 'ws://localhost:7000',
    connected: false,
    deviceModel: 'Meta Project Aria',
    fps: 0,
    latencyMs: 42,
  });

  const [isListening, setIsListening] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isConversationActive, setIsConversationActive] = useState<boolean>(false);
  const [isTapToSend, setIsTapToSend] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>('');
  const [spokenResponse, setSpokenResponse] = useState<string>('');
  const [isRecalledFromMemory, setIsRecalledFromMemory] = useState<boolean>(false);
  const [spatialMemory, setSpatialMemory] = useState<RememberedObject[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((m) => Date.now() - (m?.timestamp ?? 0) < MEMORY_MAX_AGE_MS);
        }
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
  const recognitionErrorRef = useRef<string | null>(null);
  const useRecorderOnlyRef = useRef<boolean>(false);
  const micUnavailableRef = useRef<boolean>(false);

  // Hands-free conversation state
  const conversationActiveRef = useRef<boolean>(false);
  const conversationRef = useRef<ConversationTurn[]>([]);
  const turnIdRef = useRef<number>(0); // bumped whenever in-flight answers must be dropped
  const afterAnswerRef = useRef<(() => void) | null>(null);

  // Automatic hazard watch state
  const isScanningRef = useRef<boolean>(false);
  const lastScanAtRef = useRef<number>(0);
  const navigationGoalRef = useRef<string>(''); // where the user asked to be guided, e.g. "the exit door"
  const lastScanFingerprintRef = useRef<Uint8Array | null>(null);
  const lastWarningRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const lastViewRequestAtRef = useRef<number>(0);
  const lastScanSpeechRef = useRef<string>(''); // sent back to Gemini so it does not repeat itself
  const lastSpeechEndedAtRef = useRef<number>(0);
  const scanPausedUntilRef = useRef<number>(0);
  const quotaAnnouncedRef = useRef<boolean>(false);
  const autoStartHandledRef = useRef<boolean>(false); // this camera already started the guidance
  const autoStartSourceRef = useRef<CameraSourceType | null>(null);

  // Spatial Memory & Orientation Refs
  const spatialMemoryRef = useRef<RememberedObject[]>(spatialMemory);
  const recentFramesRef = useRef<MemoryFrameSnapshot[]>([]);
  const lastFingerprintRef = useRef<Uint8Array | null>(null);
  const lastBackgroundMemorizeRef = useRef<number>(0);
  const isMemorizingRef = useRef<boolean>(false);
  const headingRef = useRef<number | null>(null);
  const orientationPermissionRequestedRef = useRef<boolean>(false);

  // Camera source and glasses link, readable from callbacks without re-creating them
  const cameraSourceRef = useRef<CameraSourceType>(cameraSource);
  cameraSourceRef.current = cameraSource;
  const feedLostAnnouncedRef = useRef<boolean>(false);
  const viewEpochRef = useRef<number>(0); // bumped when the camera source changes
  const previousSourceRef = useRef<CameraSourceType>(cameraSource);

  // A different camera looks at a different place: what the old one saw must never be
  // described as what is in front of the user now
  useEffect(() => {
    if (previousSourceRef.current === cameraSource) return;
    previousSourceRef.current = cameraSource;
    viewEpochRef.current += 1;
    recentFramesRef.current = [];
    lastFingerprintRef.current = null;
    lastScanFingerprintRef.current = null;
    lastScanSpeechRef.current = '';
    navigationGoalRef.current = '';
    setSpatialMemory([]);
  }, [cameraSource]);

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
        // While the automatic watch is on, its results fill the memory instead, to save requests
        if (
          !conversationActiveRef.current &&
          !isProcessingRef.current &&
          !isMemorizingRef.current &&
          now - lastBackgroundMemorizeRef.current > 9000
        ) {
          isMemorizingRef.current = true;
          lastBackgroundMemorizeRef.current = now;
          const viewEpoch = viewEpochRef.current;
          memorizeFrameObjects(frame)
            .then((objects) => {
              if (viewEpoch !== viewEpochRef.current) return;
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

  // Speak an answer one sentence at a time, then reopen the microphone if the conversation is still on.
  // Short utterances avoid browser cut-offs on long speech and keep the mic closed until speech ends.
  const speakAnswer = useCallback((text: string, turnId: number) => {
    const sentences = (text.match(/[^.!?]+[.!?]*/g) || []).map((part) => part.trim()).filter(Boolean);
    const startsWithWarning = /^(stop|caution)\b/i.test(text.trim());

    const speakFrom = (index: number) => {
      if (turnId !== turnIdRef.current) return;
      if (index >= sentences.length) {
        afterAnswerRef.current?.();
        return;
      }
      speechManager.speak(sentences[index], {
        isUrgent: index === 0 && startsWithWarning,
        interrupt: index === 0,
        onEnd: () => speakFrom(index + 1),
      });
    };

    setSpokenResponse(text);
    speakFrom(0);
  }, []);

  // Send the spoken question (or recorded audio) + video frame + memory + recent conversation to Gemini
  const processVoiceQuery = useCallback(
    async (
      questionText: string,
      audioBase64?: string | null,
      audioMimeType?: string,
      // Answer from the live picture alone, leaving out earlier views and remembered objects
      currentViewOnly: boolean = false
    ) => {
      if (isProcessingRef.current) return;
      const turnId = turnIdRef.current;
      const viewEpoch = viewEpochRef.current;

      const trimmed = questionText.trim();
      if (
        trimmed.toLowerCase() === 'clear memory' ||
        trimmed.toLowerCase() === 'reset memory' ||
        trimmed.toLowerCase() === 'forget everything'
      ) {
        setSpatialMemory([]);
        recentFramesRef.current = [];
        conversationRef.current = [];
        setIsRecalledFromMemory(false);
        speakAnswer('Spatial object memory has been cleared.', turnId);
        return;
      }

      const query =
        trimmed.length > 1
          ? trimmed
          : 'What is directly in front of me and is the path safe to walk?';

      isProcessingRef.current = true;
      setIsProcessing(true);
      try {
        const now = Date.now();
        const currentHeading = headingRef.current;
        const frame = captureFrameRef.current ? captureFrameRef.current() : null;
        // No live picture: tell Gemini, so it never describes an old view (or nothing at all) as the current one
        const cameraUnavailable = frame === null;

        // Format past distinct frames (excluding ones captured < 1.5s ago)
        const formattedPastFrames: FormattedPastFrame[] = (currentViewOnly ? [] : recentFramesRef.current)
          .filter((f) => now - f.timestamp >= 1500)
          .slice(0, 3)
          .map((f) => ({
            image: f.image,
            secondsAgo: Math.max(1, Math.round((now - f.timestamp) / 1000)),
            relativeDirectionHint: computeRelativeDirectionHint(f.headingDeg, currentHeading),
          }));

        // Format spatial object memory items
        const formattedMemory: FormattedMemoryItem[] = (currentViewOnly ? [] : spatialMemoryRef.current).map((m) => ({
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
          formattedMemory,
          conversationRef.current,
          cameraUnavailable
        );

        // Remember where the user wants to go, so the automatic watch guides them there
        const requestedGoal = (res.navigationGoal || '').trim();
        if (res.cancelNavigation) {
          navigationGoalRef.current = '';
        } else if (requestedGoal) {
          navigationGoalRef.current = requestedGoal;
          lastScanFingerprintRef.current = null; // start guiding from the very next look
        }

        // A hazard warning or a new question took over while we were waiting: drop the answer
        if (turnId !== turnIdRef.current) return;

        // Save any objects seen in the current frame into Spatial Memory
        const sameCamera = viewEpoch === viewEpochRef.current;
        if (sameCamera && res.observedObjects && res.observedObjects.length > 0) {
          mergeObservedObjects(res.observedObjects, currentHeading);
        }

        // Also store current frame into recent frames buffer
        if (frame && sameCamera) {
          recentFramesRef.current = [
            { image: frame, timestamp: now, headingDeg: currentHeading },
            ...recentFramesRef.current,
          ].slice(0, MAX_PAST_FRAMES);
        }

        const followUp = (res.followUpDirection || '').trim();
        const fullAnswer =
          followUp && !res.spokenAnswer.includes(followUp)
            ? `${res.spokenAnswer} ${followUp}`
            : res.spokenAnswer;
        quotaAnnouncedRef.current = false;

        conversationRef.current = [
          ...conversationRef.current,
          { role: 'user' as const, text: audioBase64 ? '(spoken question)' : query },
          { role: 'assistant' as const, text: fullAnswer },
        ].slice(-MAX_CONVERSATION_TURNS);

        // The automatic watch should carry on from this answer, not say the same things again
        lastScanSpeechRef.current = fullAnswer;

        setIsRecalledFromMemory(Boolean(res.isFromMemory));
        speakAnswer(fullAnswer, turnId);
      } catch (err) {
        console.error('Voice query error:', err);
        if (turnId !== turnIdRef.current) return;
        const isOffline = err instanceof Error && /fetch failed|failed to fetch/i.test(err.message);
        if (err instanceof QuotaExceededError) quotaAnnouncedRef.current = true;
        const fallbackMsg =
          err instanceof QuotaExceededError
            ? QUOTA_MESSAGE
            : isOffline
            ? 'I cannot reach the vision service. Check the internet connection and try again.'
            : 'Could not analyze the video feed right now. Please try again.';
        setIsRecalledFromMemory(false);
        speakAnswer(fallbackMsg, turnId);
      } finally {
        isProcessingRef.current = false;
        setIsProcessing(false);
        // A dropped answer must not wipe the question the user is asking now
        if (turnId === turnIdRef.current) {
          setTranscript('');
          transcriptRef.current = '';
        }
      }
    },
    [mergeObservedObjects, speakAnswer]
  );

  // A question asked while an earlier answer is still on its way waits for it instead of being dropped
  const askWhenFree = useCallback(
    (questionText: string, audioBase64?: string | null, audioMimeType?: string) => {
      const turnId = turnIdRef.current;
      const attempt = () => {
        if (turnId !== turnIdRef.current) return;
        if (isProcessingRef.current) {
          setTimeout(attempt, 200);
          return;
        }
        processVoiceQuery(questionText, audioBase64, audioMimeType);
      };
      attempt();
    },
    [processVoiceQuery]
  );

  // Fallback audio recorder for browsers where SpeechRecognition is missing or unreachable (e.g. Chrome on iOS).
  // It cannot tell when the user stops talking, so each question is sent with a tap.
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
          askWhenFree('', base64Audio, recorder.mimeType || 'audio/mp4');
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      isListeningRef.current = true;
      setIsListening(true);
      setIsTapToSend(true);
      soundEffects.playMicListening();
    } catch (err) {
      console.warn('Microphone unavailable, analyzing video directly:', err);
      processVoiceQuery('What is directly in front of me and is the path safe?');
    }
  }, [askWhenFree, processVoiceQuery]);

  // Open the microphone for the next thing the user says
  const startListening = useCallback(() => {
    if (!conversationActiveRef.current || isListeningRef.current || micUnavailableRef.current) return;
    // Never open the mic while the assistant is talking, or it would hear itself
    if (speechManager.isSpeaking()) return;
    transcriptRef.current = '';
    setTranscript('');

    if (recognitionRef.current && !useRecorderOnlyRef.current) {
      try {
        recognitionRef.current.start();
        return;
      } catch (err) {
        console.warn('SpeechRecognition failed, falling back to MediaRecorder:', err);
      }
    }
    startAudioRecordingFallback();
  }, [startAudioRecordingFallback]);

  // After a spoken answer the microphone stays closed: the user taps the button to ask something
  useEffect(() => {
    afterAnswerRef.current = () => {
      lastSpeechEndedAtRef.current = Date.now();
    };
  }, []);

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

    // onend always fires after onerror, so the error is handled there
    recognition.onerror = (event: any) => {
      recognitionErrorRef.current = event?.error || 'unknown';
    };

    recognition.onend = () => {
      isListeningRef.current = false;
      setIsListening(false);

      const error = recognitionErrorRef.current;
      recognitionErrorRef.current = null;

      if (!conversationActiveRef.current || error === 'aborted') return;

      // Browser speech-to-text is unreachable: record the question and let Gemini listen to it
      if (error === 'network' || error === 'service-not-allowed') {
        useRecorderOnlyRef.current = true;
        startAudioRecordingFallback();
        return;
      }
      if (error && error !== 'no-speech') {
        // Questions are off without a microphone, but the user still needs to hear what is ahead
        micUnavailableRef.current = true;
        soundEffects.playMicEnded();
        speakAnswer(
          error === 'not-allowed'
            ? 'Microphone access is blocked, so I cannot hear your questions. I will keep telling you what is ahead. Allow the microphone for this page to ask questions.'
            : 'I cannot use the microphone, so I cannot hear your questions. I will keep telling you what is ahead.',
          turnIdRef.current
        );
        return;
      }

      const captured = transcriptRef.current.trim();
      if (!captured) {
        // Nothing was said: close the microphone and go back to watching the path
        soundEffects.playMicEnded();
        return;
      }
      askWhenFree(captured);
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognitionRef.current?.abort();
      } catch (_) {}
    };
  }, [askWhenFree, startAudioRecordingFallback, speakAnswer]);

  // Speak what the automatic watch found: a warning, a request for a better view,
  // or (when the view has changed and things are quiet) what is ahead and around the user
  const announceScanResult = useCallback(
    // busy: something else is being said or answered. Only a hazard, an arrival, or a caution may cut in.
    (analysis: EarlyNavigationAnalysis, viewChanged: boolean, busy: boolean) => {
      const now = Date.now();
      const sinceLastWarning = now - lastWarningRef.current.at;
      // While the user is asking a question, only hazards may cut in
      const userIsMidSentence = isListeningRef.current || transcriptRef.current.trim().length > 0;
      const guidance = (analysis.spokenGuidance || '').trim();
      const viewRequest = (analysis.viewRequest || '').trim();
      const goal = navigationGoalRef.current;

      let message = '';
      if (analysis.urgency === 'immediate_hazard' && guidance && sinceLastWarning >= HAZARD_REPEAT_MS) {
        message = guidance;
        soundEffects.playHazardAlarm();
      } else if (goal && analysis.goalStatus === 'arrived') {
        // The user must never walk past the place they asked for
        message = guidance || `You have arrived at ${goal}.`;
        navigationGoalRef.current = '';
        soundEffects.playClearChime();
      } else if (
        analysis.urgency === 'caution' &&
        guidance &&
        sinceLastWarning >= CAUTION_REPEAT_MS &&
        !userIsMidSentence &&
        !isProcessingRef.current
      ) {
        // Cuts in on speech, but not on a question that is still being answered
        message = guidance;
        soundEffects.playCautionPing();
      } else if (busy) {
        // Everything below waits its turn
      } else if (
        viewRequest &&
        now - lastViewRequestAtRef.current >= VIEW_REQUEST_REPEAT_MS &&
        !userIsMidSentence
      ) {
        message = viewRequest;
        lastViewRequestAtRef.current = now;
      } else if (
        goal &&
        guidance &&
        !userIsMidSentence &&
        now - lastSpeechEndedAtRef.current >= GOAL_GUIDANCE_QUIET_MS
      ) {
        // On the way to a destination: keep the next step coming
        message = guidance;
      } else if (
        (analysis.urgency === 'clear' || analysis.urgency === 'informational') &&
        guidance &&
        viewChanged &&
        !userIsMidSentence &&
        now - lastSpeechEndedAtRef.current >= NARRATION_QUIET_MS
      ) {
        message = guidance;
      }
      if (!message) return;
      lastScanSpeechRef.current = message;

      if (analysis.urgency === 'immediate_hazard' || analysis.urgency === 'caution') {
        lastWarningRef.current = { text: message, at: now };
      }

      // Close the mic while the warning is spoken; speakAnswer reopens it afterwards
      turnIdRef.current += 1;
      try {
        recognitionRef.current?.abort();
      } catch (_) {}

      conversationRef.current = [
        ...conversationRef.current,
        { role: 'assistant' as const, text: message },
      ].slice(-MAX_CONVERSATION_TURNS);
      setIsRecalledFromMemory(false);
      speakAnswer(message, turnIdRef.current);
    },
    [speakAnswer]
  );

  // Say something the user did not ask for (e.g. the camera dropped out), closing the mic while it is spoken
  const announceSystemMessage = useCallback(
    (message: string) => {
      turnIdRef.current += 1;
      try {
        recognitionRef.current?.abort();
      } catch (_) {}

      conversationRef.current = [
        ...conversationRef.current,
        { role: 'assistant' as const, text: message },
      ].slice(-MAX_CONVERSATION_TURNS);
      setIsRecalledFromMemory(false);
      speakAnswer(message, turnIdRef.current);
    },
    [speakAnswer]
  );

  // Glasses picture lost or back. Without a picture there are no hazard warnings, and silence
  // would sound exactly like "nothing to report", so the user has to be told.
  useEffect(() => {
    if (cameraSource !== 'aria_stream' || !isConversationActive) {
      feedLostAnnouncedRef.current = false;
      return;
    }

    const isBusy = () =>
      isProcessingRef.current ||
      speechManager.isSpeaking() ||
      transcriptRef.current.trim().length > 0 ||
      mediaRecorderRef.current?.state === 'recording';

    if (ariaConfig.connected) {
      if (feedLostAnnouncedRef.current) {
        feedLostAnnouncedRef.current = false;
        lastScanFingerprintRef.current = null; // check the new view straight away
        if (!isBusy()) announceSystemMessage('Camera is back.');
      }
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    const remind = () => {
      if (!isBusy()) announceSystemMessage('Still no camera feed.');
      timer = setTimeout(remind, FEED_LOST_REPEAT_MS);
    };
    const warn = () => {
      // In tap-to-send mode the recording must not be talked over: wait for it to end
      if (mediaRecorderRef.current?.state === 'recording') {
        timer = setTimeout(warn, 1000);
        return;
      }
      feedLostAnnouncedRef.current = true;
      soundEffects.playCautionPing();
      announceSystemMessage("Caution! Camera feed lost. I can't see right now.");
      timer = setTimeout(remind, FEED_LOST_REPEAT_MS);
    };
    timer = setTimeout(warn, FEED_LOST_ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [cameraSource, isConversationActive, ariaConfig.connected, announceSystemMessage]);

  // Automatic watch: while the conversation is on, check the view every few seconds. Warn about
  // hazards or blocked paths, and as the user moves, say what is ahead, all without being asked.
  useEffect(() => {
    if (!isConversationActive) return;
    let cancelled = false;

    const scan = async () => {
      // Keep looking while the assistant is talking or answering: a hazard must be able to cut in
      if (isScanningRef.current) return;
      // In tap-to-send mode the recording must not be talked over
      if (mediaRecorderRef.current?.state === 'recording') return;

      const now = Date.now();
      if (now < scanPausedUntilRef.current) return;
      if (now - lastScanAtRef.current < SCAN_INTERVAL_MS) return;

      const frame = captureFrameRef.current ? captureFrameRef.current() : null;
      if (!frame) return;
      const fingerprint = await computeImageFingerprint(frame);
      const viewChanged =
        !fingerprint ||
        !lastScanFingerprintRef.current ||
        fingerprintDifference(fingerprint, lastScanFingerprintRef.current) > SCAN_VIEW_CHANGE_THRESHOLD;
      if (!viewChanged && now - lastScanAtRef.current < SCAN_UNCHANGED_VIEW_MS) return;

      isScanningRef.current = true;
      const scanStartedAt = now;
      lastScanAtRef.current = now;
      lastScanFingerprintRef.current = fingerprint;
      const turnId = turnIdRef.current;
      const viewEpoch = viewEpochRef.current;
      try {
        // The spoken part arrives first and is announced straight away; the object list follows
        let announced = false;
        const announce = (result: EarlyNavigationAnalysis) => {
          if (announced || cancelled) return;
          announced = true;
          quotaAnnouncedRef.current = false;
          // The assistant is talking, answering, or the conversation moved on while we were waiting
          const busy =
            turnId !== turnIdRef.current || isProcessingRef.current || speechManager.isSpeaking();
          announceScanResult(result, viewChanged, busy);
          // What matters has been said: the next look may start while the rest of this one arrives
          isScanningRef.current = false;
        };
        const analysis = await analyzeNavigationFrame(
          frame,
          lastScanSpeechRef.current || undefined,
          navigationGoalRef.current || undefined,
          announce
        );
        if (!cancelled && viewEpoch === viewEpochRef.current && Array.isArray(analysis.detectedObjects)) {
          mergeObservedObjects(
            analysis.detectedObjects.map((object) => ({
              label: object.label,
              position: object.position,
              distance: object.distance,
              landmarkContext: analysis.sceneSummary || 'in the room',
            })),
            headingRef.current
          );
        }
        announce(analysis);
      } catch (err) {
        console.warn('Hazard scan failed:', err);
        if (err instanceof QuotaExceededError) {
          scanPausedUntilRef.current = Date.now() + Math.min(err.retryAfterMs, QUOTA_RETRY_MAX_MS);
          lastScanFingerprintRef.current = null; // look again as soon as the service is back
          // Without the service there are no hazard warnings, so the user has to be told once
          const busy =
            isProcessingRef.current || speechManager.isSpeaking() || transcriptRef.current.trim().length > 0;
          if (!cancelled && !quotaAnnouncedRef.current && !busy) {
            quotaAnnouncedRef.current = true;
            soundEffects.playCautionPing();
            announceSystemMessage(QUOTA_MESSAGE);
          }
        }
      } finally {
        // Unless a newer look has already started, the watch is free again
        if (scanStartedAt === lastScanAtRef.current) isScanningRef.current = false;
      }
    };

    const interval = setInterval(scan, SCAN_TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isConversationActive, computeImageFingerprint, announceScanResult, announceSystemMessage, mergeObservedObjects]);

  // Start the guidance: scan the area first (unless a question is coming), then keep watching the path.
  // The microphone stays closed until the user taps the button.
  const startConversation = useCallback(
    (withAreaScan: boolean = true) => {
      if (conversationActiveRef.current) return;
      speechManager.stop();
      conversationRef.current = [];
      lastScanFingerprintRef.current = null;
      navigationGoalRef.current = '';
      lastWarningRef.current = { text: '', at: 0 };
      lastViewRequestAtRef.current = 0;
      lastScanSpeechRef.current = '';
      scanPausedUntilRef.current = 0;
      quotaAnnouncedRef.current = false;
      conversationActiveRef.current = true;
      setIsConversationActive(true);
      setSpokenResponse('');
      if (withAreaScan && !isProcessingRef.current) {
        processVoiceQuery(AREA_SCAN_QUESTION, null, undefined, true);
      }
    },
    [processVoiceQuery]
  );

  // Camera on and showing a picture: start by itself, so the user never has to find a button first.
  // Once per camera.
  useEffect(() => {
    if (autoStartSourceRef.current !== cameraSource) {
      autoStartSourceRef.current = cameraSource;
      autoStartHandledRef.current = false;
    }
    if (autoStartHandledRef.current) return;

    const timer = setInterval(() => {
      if (autoStartHandledRef.current || conversationActiveRef.current) {
        autoStartHandledRef.current = true;
        clearInterval(timer);
        return;
      }
      // Browsers keep a page silent until the user has touched it once. Starting before that
      // would give guidance nobody can hear, so wait for the first tap or key press.
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
      if (!captureFrameRef.current?.()) return;
      autoStartHandledRef.current = true;
      clearInterval(timer);
      startConversation();
    }, CAMERA_READY_CHECK_MS);
    return () => clearInterval(timer);
  }, [cameraSource, startConversation]);

  // The button is only for questions: one tap opens the microphone for a single question.
  // Guidance runs by itself the whole time and is not stopped from here.
  // (Also unlocks iOS Safari TTS + iOS compass orientation on tap.)
  const handleAskButton = useCallback(() => {
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

    // Tap-to-send recording in progress: this tap sends the question
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      return;
    }
    // Already listening: this tap cancels the question
    if (isListeningRef.current) {
      try {
        recognitionRef.current?.abort();
      } catch (_) {}
      soundEffects.playMicEnded();
      return;
    }

    // First tap on a fresh page: start the guidance too, but let the question go first
    if (!conversationActiveRef.current) startConversation(false);

    // Cut off whatever is being said, then listen. A blocked microphone gets another try on each tap.
    turnIdRef.current += 1;
    speechManager.stop();
    micUnavailableRef.current = false;
    startListening();
  }, [startConversation, startListening]);

  // Spacebar asks a question; Escape cuts off the current answer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleAskButton();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        turnIdRef.current += 1;
        speechManager.stop();
        afterAnswerRef.current?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAskButton]);

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

      {/* 2. Single Prominent Button: guidance runs by itself; a tap opens the microphone for one question */}
      <button
        onClick={handleAskButton}
        aria-label={
          isTapToSend && isListening
            ? 'Recording your question. Tap to send.'
            : isListening
            ? 'Listening for your question. Tap to cancel.'
            : 'Ask a question'
        }
        aria-pressed={isListening}
        className={`w-full min-h-[104px] sm:min-h-[128px] rounded-3xl font-black flex items-center justify-center gap-3 sm:gap-4 px-5 transition-all border-4 shadow-2xl active:scale-[0.99] cursor-pointer shrink-0 touch-manipulation ${
          isListening
            ? 'bg-red-600 hover:bg-red-700 text-white border-white ring-4 ring-red-500/50'
            : isProcessing
            ? 'bg-slate-900 text-amber-300 border-amber-400'
            : 'bg-amber-400 hover:bg-amber-300 text-black border-white'
        }`}
      >
        {isListening ? (
          <>
            <Mic className="w-9 h-9 sm:w-12 sm:h-12 stroke-[2.5] animate-pulse shrink-0" />
            <span className="text-xl sm:text-4xl tracking-tight uppercase">
              {isTapToSend ? 'LISTENING... TAP TO SEND' : 'LISTENING... TAP TO CANCEL'}
            </span>
          </>
        ) : isProcessing ? (
          <>
            <Sparkles className="w-9 h-9 sm:w-12 sm:h-12 stroke-[2.5] animate-spin shrink-0" />
            <span className="text-xl sm:text-4xl tracking-tight uppercase">THINKING...</span>
          </>
        ) : (
          <>
            <Mic className="w-9 h-9 sm:w-12 sm:h-12 stroke-[2.5] shrink-0" />
            <span className="text-xl sm:text-4xl tracking-tight uppercase">TAP TO ASK</span>
          </>
        )}
      </button>
    </main>
  );
}
