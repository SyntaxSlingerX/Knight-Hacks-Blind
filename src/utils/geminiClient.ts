import { NavigationAnalysis, VoiceQueryResponse } from '../types/aria';

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

export async function analyzeNavigationFrame(
  base64Image: string,
  previousGuidance?: string
): Promise<NavigationAnalysis> {
  const response = await fetch('/api/aria/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: base64Image,
      previousGuidance,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.details || errorData.error || `Server returned ${response.status}`);
  }

  const result = await response.json();
  return {
    ...result.data,
    timestamp: result.timestamp || Date.now(),
  };
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
  spatialMemory?: FormattedMemoryItem[]
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
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.details || errorData.error || `Server returned ${response.status}`);
  }

  const result = await response.json();
  return result.data;
}

export async function fetchAriaBridgeInfo(): Promise<any> {
  const res = await fetch('/api/aria/bridge-info');
  return res.json();
}
