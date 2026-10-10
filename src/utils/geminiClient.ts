import { NavigationAnalysis, VoiceQueryResponse } from '../types/aria';

export async function analyzeNavigationFrame(
  base64Image: string,
  previousGuidance?: string,
  userIntent?: string
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

export async function askNavigationQuestion(
  base64Image: string | null,
  question: string
): Promise<VoiceQueryResponse> {
  const response = await fetch('/api/aria/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: base64Image,
      question,
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
