import { NavigationAnalysis, VoiceQueryResponse } from '../types/aria';

/** Error from the Aria server, keeping the HTTP status (429 = Gemini usage limit reached). */
export class AriaApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function throwApiError(response: Response): Promise<never> {
  const errorData = await response.json().catch(() => ({}));
  throw new AriaApiError(
    errorData.details || errorData.error || `Server returned ${response.status}`,
    response.status
  );
}

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
    await throwApiError(response);
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
    await throwApiError(response);
  }

  const result = await response.json();
  return result.data;
}

export async function fetchAriaBridgeInfo(): Promise<any> {
  const res = await fetch('/api/aria/bridge-info');
  return res.json();
}
