import { EarlyNavigationAnalysis, NavigationAnalysis, VoiceQueryResponse } from '../types/aria';

export interface FormattedPastFrame {
  image: string;
  secondsAgo: number;
  relativeDirectionHint?: string;
}

export interface FormattedMemoryItem {
  label: string;
  position: string;
  distance: string;
  landmarkContext: string;
  secondsAgo: number;
  relativeDirectionHint?: string;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** The vision service has hit its usage limit and will refuse requests for a while. */
export class QuotaExceededError extends Error {
  constructor(public retryAfterMs: number) {
    super('Vision service usage limit reached');
  }
}

async function throwForResponse(response: Response): Promise<never> {
  const errorData = await response.json().catch(() => ({}));
  if (response.status === 429 || errorData.error === 'quota_exceeded') {
    throw new QuotaExceededError(Number(errorData.retryAfterMs) || 60000);
  }
  throw new Error(errorData.details || errorData.error || `Server returned ${response.status}`);
}

/**
 * Hazard scan of one camera frame. The server answers in two lines: the spoken part as soon as
 * Gemini has written it (passed to onEarly), then the complete result (returned).
 */
export async function analyzeNavigationFrame(
  base64Image: string,
  previousGuidance?: string,
  /** The place the user asked to be guided to, if any. */
  userIntent?: string,
  onEarly?: (early: EarlyNavigationAnalysis) => void
): Promise<NavigationAnalysis> {
  const response = await fetch('/api/aria/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: base64Image,
      previousGuidance,
      userIntent,
    }),
  });

  if (!response.ok) await throwForResponse(response);
  if (!response.body) throw new Error('The vision service sent an empty answer');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let final: NavigationAnalysis | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (message.type === 'early' && message.data?.urgency) {
      onEarly?.(message.data);
    } else if (message.type === 'final') {
      final = { ...message.data, timestamp: message.timestamp || Date.now() };
    } else if (message.type === 'error') {
      throw new Error(message.details || 'Vision analysis failed');
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split('\n');
    buffered = lines.pop() || '';
    lines.forEach(handleLine);
    if (done) break;
  }
  handleLine(buffered);

  if (!final) throw new Error('The vision service answer was cut off');
  return final;
}

export async function memorizeFrameObjects(
  base64Image: string
): Promise<{ label: string; position: string; distance: string; landmarkContext: string }[]> {
  const response = await fetch('/api/aria/memorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Image }),
  });

  if (!response.ok) {
    return [];
  }

  const result = await response.json();
  return result.observedObjects || [];
}

export async function askNavigationQuestion(
  base64Image: string | null,
  question: string,
  audioBase64?: string | null,
  audioMimeType?: string,
  recentFrames?: FormattedPastFrame[],
  spatialMemory?: FormattedMemoryItem[],
  conversation?: ConversationTurn[],
  /** True when the camera should be live but no fresh picture is available right now. */
  cameraUnavailable?: boolean
): Promise<VoiceQueryResponse> {
  const response = await fetch('/api/aria/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: base64Image,
      question,
      audio: audioBase64 || undefined,
      audioMimeType: audioMimeType || undefined,
      recentFrames: recentFrames || undefined,
      spatialMemory: spatialMemory || undefined,
      conversation: conversation || undefined,
      cameraUnavailable: cameraUnavailable || undefined,
    }),
  });

  if (!response.ok) await throwForResponse(response);

  const result = await response.json();
  return result.data;
}

export async function fetchAriaBridgeInfo(): Promise<any> {
  const res = await fetch('/api/aria/bridge-info');
  return res.json();
}
