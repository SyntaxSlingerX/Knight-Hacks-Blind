import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FALLBACK_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
];

function getAiClient(): GoogleGenAI {
  dotenv.config({ override: true });
  const rawKey = (process.env.GEMINI_API_KEY || '').trim();
  const sanitizedKey = rawKey.replace(/^AIzaS(?=AQ\.)/, '');
  return new GoogleGenAI({
    apiKey: sanitizedKey,
    httpOptions: {
      // A stuck request must not hold up the next hazard check
      timeout: 25000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Models whose usage limit has run out, and when each can be tried again
const modelBlockedUntil = new Map<string, number>();

class QuotaExceededError extends Error {
  constructor(public retryAfterMs: number) {
    super('Gemini usage limit reached on every model');
  }
}

/** How long Gemini says to wait after a usage-limit error, or null when the error is something else. */
function quotaRetryMs(err: any): number | null {
  if (err?.status !== 429) return null;
  const match = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(String(err?.message || ''));
  return match ? Math.ceil(parseFloat(match[1]) * 1000) : 60000;
}

async function generateWithFallback(params: { contents: any; config: any }) {
  const ai = getAiClient();
  let lastError: any = null;

  for (const model of FALLBACK_MODELS) {
    // Do not spend time on a model that has already said it is out of quota
    if ((modelBlockedUntil.get(model) || 0) > Date.now()) continue;
    try {
      return await ai.models.generateContent({
        model,
        contents: params.contents,
        config: params.config,
      });
    } catch (err: any) {
      const retryMs = quotaRetryMs(err);
      if (retryMs !== null) {
        modelBlockedUntil.set(model, Date.now() + retryMs);
        console.warn(`Model ${model} is out of quota for ${Math.round(retryMs / 1000)} s, trying next fallback...`);
      } else {
        lastError = err;
        console.warn(`Model ${model} failed (${err?.status || err?.message}), trying next fallback...`);
      }
    }
  }

  if (lastError) throw lastError;
  const soonest = Math.min(...FALLBACK_MODELS.map((model) => modelBlockedUntil.get(model) || 0));
  throw new QuotaExceededError(Math.max(1000, soonest - Date.now()));
}

/**
 * Like generateWithFallback, but hands the answer back piece by piece as Gemini writes it,
 * so the spoken part can be used before the rest has arrived.
 */
async function* streamWithFallback(params: { contents: any; config: any }): AsyncGenerator<string> {
  const ai = getAiClient();
  let lastError: any = null;

  for (const model of FALLBACK_MODELS) {
    if ((modelBlockedUntil.get(model) || 0) > Date.now()) continue;
    let chunks: AsyncIterator<any>;
    let first: IteratorResult<any>;
    try {
      const stream = await ai.models.generateContentStream({
        model,
        contents: params.contents,
        config: params.config,
      });
      chunks = stream[Symbol.asyncIterator]();
      // A model that is out of quota or overloaded fails here, before anything has been sent on
      first = await chunks.next();
    } catch (err: any) {
      const retryMs = quotaRetryMs(err);
      if (retryMs !== null) {
        modelBlockedUntil.set(model, Date.now() + retryMs);
        console.warn(`Model ${model} is out of quota for ${Math.round(retryMs / 1000)} s, trying next fallback...`);
      } else {
        lastError = err;
        console.warn(`Model ${model} failed (${err?.status || err?.message}), trying next fallback...`);
      }
      continue;
    }
    for (let next = first; !next.done; next = await chunks.next()) {
      if (next.value?.text) yield next.value.text;
    }
    return;
  }

  if (lastError) throw lastError;
  const soonest = Math.min(...FALLBACK_MODELS.map((model) => modelBlockedUntil.get(model) || 0));
  throw new QuotaExceededError(Math.max(1000, soonest - Date.now()));
}

/** The value of a finished string field in JSON that is still being written, or null if it is not finished yet. */
function finishedStringField(partialJson: string, field: string): string | null {
  const match = new RegExp(`"${field}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(partialJson);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function sendError(res: express.Response, error: any, label: string) {
  if (error instanceof QuotaExceededError) {
    return res.status(429).json({ error: 'quota_exceeded', details: error.message, retryAfterMs: error.retryAfterMs });
  }
  res.status(500).json({ error: label, details: error?.message || String(error) });
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // JSON body parser with limit for base64 camera frames + memory snapshots
  app.use(express.json({ limit: '35mb' }));

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    dotenv.config({ override: true });
    res.json({
      status: 'ok',
      service: 'Aria Vision Server',
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      timestamp: new Date().toISOString(),
    });
  });

  // Project Aria Glasses Bridge Information
  app.get('/api/aria/bridge-info', (req, res) => {
    res.json({
      device: 'Meta Project Aria Smart Glasses',
      sensors: [
        '8MP RGB Sensor (1408x1408 @ 30fps, 110° FOV)',
        'Dual Mono SLAM Cameras (VRS capture)',
        'Eye Tracking Cameras (60-90Hz)',
        '7-Channel Spatial Audio Microphone Array',
        'Dual IMU (high-frequency accelerometers & gyroscopes)',
        'Barometer & Magnetometer',
      ],
      streamingProtocols: ['WebSocket (ws://<ip>:7000)', 'MJPEG Stream (http://<ip>:8080/stream)', 'WebRTC / RTSP'],
      bridgeScript: {
        language: 'python',
        package: 'projectaria_tools',
        description: 'Runs on laptop/phone connected to Aria Wi-Fi, streaming RGB frames to Aria Vision web client',
      },
    });
  });

  /**
   * Background Spatial Memory Indexing
   * Endpoint: POST /api/aria/memorize
   * Extracts notable objects & landmarks from a camera frame as the user pans around
   */
  app.post('/api/aria/memorize', async (req, res) => {
    try {
      const { image } = req.body;
      if (!image) {
        return res.status(400).json({ error: 'Image is required' });
      }

      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

      const response = await generateWithFallback({
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Data,
              },
            },
            {
              text: `Identify up to 8 notable physical objects, items, furniture, doors, or landmarks visible in this camera frame so we can remember where they are when the blind user turns the camera away.
For each object, provide:
- label: specific name (e.g. "blue water bottle", "backpack", "laptop", "wooden chair", "keys", "closed door")
- position: position in frame (e.g. "on the left", "directly ahead", "on the right", "on the floor")
- distance: estimated distance (e.g. "3 feet", "6 feet")
- landmarkContext: nearby anchor object or surface (e.g. "on the white desk next to the monitor", "on the floor beside the door")`,
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              observedObjects: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    position: { type: Type.STRING },
                    distance: { type: Type.STRING },
                    landmarkContext: { type: Type.STRING },
                  },
                  required: ['label', 'position', 'distance', 'landmarkContext'],
                },
              },
            },
            required: ['observedObjects'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{"observedObjects":[]}');
      res.json({
        success: true,
        observedObjects: parsed.observedObjects || [],
        timestamp: Date.now(),
      });
    } catch (error: any) {
      console.error('Error in /api/aria/memorize:', error);
      sendError(res, error, 'Memory indexing failed');
    }
  });

  /**
   * Real-time Scene Understanding for Navigation
   * Endpoint: POST /api/aria/analyze
   */
  app.post('/api/aria/analyze', async (req, res) => {
    try {
      const { image, previousGuidance, userIntent } = req.body;

      if (!image) {
        return res.status(400).json({ error: 'Image data is required' });
      }

      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

      const imagePart = {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64Data,
        },
      };

      const systemInstruction = `You are ARIA VISION, a real-time assistive navigation vision system for a blind or visually impaired person wearing Meta Project Aria smart glasses.
Your output will be converted directly to speech and earcon audio alerts.

THE USER CANNOT SEE ANYTHING AT ALL. You are their eyes. Anything they could walk into, trip over, fall off, or be hit by must be reported, and so must every person near them. Missing something is far worse than mentioning it.

CRITICAL SAFETY & ASSISTIVE RULES:
1. PRIORITY ONE IS HAZARD DETECTION: Immediately identify drop-offs and any change in floor height (descending or ascending stairs, single steps, platform edges, curbs, ramps, holes), tripping hazards (low cords, bags, boxes, raised pavement, chair legs), approaching vehicles, opening doors, glass doors or walls, low-hanging obstacles at head level, people standing or walking in or toward the path, and any obstacle directly in the walking path.
2. CONCISE & TERSE: Visually impaired people need short, clear spatial directions. Lead with the most dangerous or the nearest thing. Keep spoken guidance under 30 words. Never ramble. Never use flowery language.
3. RELATIVE SPATIAL DIRECTION: Use clock positions ("at 11 o'clock", "at 2 o'clock") or simple directions ("on your left", "directly ahead", "on your right", "on the floor").
4. URGENCY LEVELS:
   - "immediate_hazard": Urgent danger (stairs ahead, moving vehicle, obstacle in next step). Spoken guidance must start with "Stop!" or "Caution!".
   - "caution": Nearby obstacle or uneven ground requiring slow walking or slight detour.
   - "clear": Path ahead is open and clear for walking.
   - "informational": Navigational milestone (doorway located, elevator button panel spotted, crosswalk walk sign visible).
5. REPETITION AVOIDANCE: The last thing you told the user was '${previousGuidance || 'nothing yet'}'. Hazards must always be reported. For "clear" and "informational" updates, only mention what is new since then; if nothing worth saying has changed, set spokenGuidance to an empty string.
6. EXPLICIT UNCERTAINTY: If lighting is dim, glare is high, or camera view is obscured, explicitly note uncertainty.
7. BLOCKED PATHS: Call out anything that blocks or narrows the walking path (furniture, bags, boxes, people standing in the way, closed doors, wet floor signs) and say which side is clear to pass on.
8. ASK TO SEE MORE: If you cannot see enough to judge the path or the room (camera pointing at the floor, ceiling, a wall, or one corner; view blocked, too dark, or too blurry; only a small slice of the space visible), set viewRequest to one short spoken request telling the user how to move so you can see, e.g. "I can only see the floor. Please lift your head so I can see ahead." or "Please turn slowly to your left so I can see the rest of the room." Leave viewRequest as an empty string when the view is good enough. A limited view on its own is not a hazard: use urgency "informational" for it, never "immediate_hazard" or "caution".
9. WHEN THERE IS NO HAZARD: Use spokenGuidance to tell the user what is ahead and around them as they move: the kind of space, every person nearby and the main objects with their position and rough distance, and where the way they are walking leads (what it reaches, and any turn, door, or junction coming up), e.g. "Hallway continues ahead to a door, about ten feet. Corridor turns left just before it. Two people talking on your left."
10. ${
        userIntent
          ? `DESTINATION: The user has asked to be guided to: "${userIntent}". After any hazard warning, spokenGuidance must give the next step toward it from what you can see: which way to turn or walk and roughly how far, e.g. "Exit door at 1 o'clock, about twelve feet. Walk straight." Guide them around anything in the way. Keep giving the next step whenever the direction or distance has changed, even if it sounds like the last one. SIGNS: look for signs that point to the destination, above all EXIT signs. When you see one, say where the sign is and which way its arrow points (left, right, or straight on; no arrow means the exit is at the sign itself), then send the user that way, e.g. "Exit sign above you at 11 o'clock, arrow pointing left. Turn left and walk." If you can see neither the destination nor a sign for it, say so in a few words and ask the user to turn slowly in a full circle so you can look for it; if you already asked, just say "Keep turning slowly." Never invent a route. Set goalStatus to "arrived" only when the destination is directly in front of the user within about three feet (one step, or arm's reach); then spokenGuidance must start with "You have arrived" and say exactly where it is, e.g. "You have arrived at the exit door. The handle is on your right." Otherwise set goalStatus to "in_view" when you can see the destination, or "not_visible" when you cannot.`
          : 'NO INVENTED DESTINATIONS: Only describe what is around them and whether the path directly ahead is safe. Set goalStatus to "none".'
      }`;

      const promptText = `Analyze this camera view from the smart glasses. Identify all navigation hazards, walking path status, doorways, stairs, obstacles, notable objects, and people. Provide immediate navigation guidance.`;

      // The answer is sent in two lines: first the part that is spoken, the moment Gemini has written it,
      // then the complete result. The fields below are ordered so the spoken part comes first.
      const stream = streamWithFallback({
        contents: {
          parts: [imagePart, { text: promptText }],
        },
        config: {
          systemInstruction,
          // Hazard warnings have to be fast: answer from what is in the picture without long reasoning
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              urgency: {
                type: Type.STRING,
                format: 'enum',
                enum: ['immediate_hazard', 'caution', 'clear', 'informational'],
              },
              goalStatus: {
                type: Type.STRING,
                format: 'enum',
                enum: ['none', 'not_visible', 'in_view', 'arrived'],
              },
              viewRequest: {
                type: Type.STRING,
              },
              spokenGuidance: {
                type: Type.STRING,
              },
              spatialDirection: {
                type: Type.STRING,
              },
              detectedObjects: {
                type: Type.ARRAY,
                maxItems: 5,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    position: { type: Type.STRING },
                    distance: { type: Type.STRING },
                  },
                  required: ['label', 'position', 'distance'],
                },
              },
              sceneSummary: {
                type: Type.STRING,
              },
            },
            propertyOrdering: [
              'urgency',
              'goalStatus',
              'viewRequest',
              'spokenGuidance',
              'spatialDirection',
              'detectedObjects',
              'sceneSummary',
            ],
            required: [
              'urgency',
              'goalStatus',
              'viewRequest',
              'spokenGuidance',
              'spatialDirection',
              'detectedObjects',
              'sceneSummary',
            ],
          },
        },
      });

      let text = '';
      let earlySent = false;
      for await (const piece of stream) {
        text += piece;
        if (earlySent) continue;
        const spokenGuidance = finishedStringField(text, 'spokenGuidance');
        if (spokenGuidance === null) continue;
        earlySent = true;
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.write(
          JSON.stringify({
            type: 'early',
            data: {
              urgency: finishedStringField(text, 'urgency'),
              goalStatus: finishedStringField(text, 'goalStatus'),
              viewRequest: finishedStringField(text, 'viewRequest') || '',
              spokenGuidance,
            },
          }) + '\n'
        );
      }

      if (!earlySent) res.setHeader('Content-Type', 'application/x-ndjson');
      res.write(JSON.stringify({ type: 'final', data: JSON.parse(text || '{}'), timestamp: Date.now() }) + '\n');
      res.end();
    } catch (error: any) {
      console.error('Error in /api/aria/analyze:', error);
      if (res.headersSent) {
        // The spoken part already went out; tell the page the rest is not coming
        res.write(JSON.stringify({ type: 'error', details: error?.message || String(error) }) + '\n');
        res.end();
        return;
      }
      sendError(res, error, 'Vision analysis failed');
    }
  });

  /**
   * Natural Voice Q&A with Spatial Object Memory (remembers objects outside current camera view)
   * Endpoint: POST /api/aria/query
   */
  app.post('/api/aria/query', async (req, res) => {
    try {
      const { image, question, audio, audioMimeType, recentFrames, spatialMemory, conversation, cameraUnavailable } =
        req.body;

      if (!question && !audio) {
        return res.status(400).json({ error: 'Question or audio is required' });
      }

      const promptParts: any[] = [];

      // 1. Attach Current Live Camera View
      if (image) {
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        promptParts.push({
          text: '[IMAGE 1: CURRENT LIVE CAMERA VIEW (What the camera is pointing at right now)]',
        });
        promptParts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Data,
          },
        });
      }

      // 1b. The camera should be live but is not (e.g. the glasses stream dropped): say so explicitly,
      // otherwise the past views below could be mistaken for what is in front of the user now
      const noLiveView = !image && Boolean(cameraUnavailable);
      if (noLiveView) {
        promptParts.push({
          text: '[NO LIVE CAMERA VIEW: the camera feed is down right now. You cannot see what is in front of the user.]',
        });
      }

      // 2. Attach Recent Past Camera Views (from when the camera was pointing elsewhere)
      if (Array.isArray(recentFrames) && recentFrames.length > 0) {
        recentFrames.slice(0, 3).forEach((pastFrame: any, idx: number) => {
          if (!pastFrame?.image) return;
          const cleanPast = pastFrame.image.replace(/^data:image\/\w+;base64,/, '');
          const secAgo = pastFrame.secondsAgo ?? '?';
          const dirHint = pastFrame.relativeDirectionHint
            ? `, direction from current view: ${pastFrame.relativeDirectionHint}`
            : '';
          promptParts.push({
            text: `[PAST MEMORY IMAGE ${idx + 1}: Captured ${secAgo} seconds ago when camera pointed elsewhere${dirHint}]`,
          });
          promptParts.push({
            inlineData: {
              mimeType: 'image/jpeg',
              data: cleanPast,
            },
          });
        });
      }

      // 3. Attach Spoken Voice Audio if recorded via MediaRecorder
      if (audio) {
        const cleanAudio = audio.replace(/^data:audio\/[^;]+;base64,/, '');
        promptParts.push({
          inlineData: {
            mimeType: audioMimeType || 'audio/mp4',
            data: cleanAudio,
          },
        });
      }

      // 4. Format Spatial Object Memory Catalog
      const memoryText =
        Array.isArray(spatialMemory) && spatialMemory.length > 0
          ? `\nSPATIAL MEMORY OF OBJECTS SEEN EARLIER (Outside current camera view):\n` +
            spatialMemory
              .map(
                (m: any) =>
                  `- "${m.label}": seen ${m.secondsAgo}s ago (${m.position}, ~${m.distance}) near [${m.landmarkContext}]${
                    m.relativeDirectionHint ? ` -> Relative to current heading: ${m.relativeDirectionHint}` : ''
                  }`
              )
              .join('\n')
          : '\nSPATIAL MEMORY: No prior objects recorded yet.';

      // 5. Format the recent conversation so follow-up questions ("what color is it?") make sense
      const conversationText =
        Array.isArray(conversation) && conversation.length > 0
          ? `\nCONVERSATION SO FAR (oldest first):\n` +
            conversation
              .slice(-8)
              .filter((turn: any) => typeof turn?.text === 'string')
              .map(
                (turn: any) =>
                  `${turn.role === 'assistant' ? 'You' : 'User'}: ${turn.text.slice(0, 500)}`
              )
              .join('\n')
          : '';

      promptParts.push({
        text: `${
          audio
            ? `Listen to the visually impaired user's spoken question in the attached audio (or if silent/unclear, assume they asked: "${
                question || 'What is in front of me and is the path safe?'
              }").`
            : `The visually impaired user is asking: "${question}".`
        }
${memoryText}
${conversationText}

${
  noLiveView
    ? `THE LIVE CAMERA FEED IS DOWN. Begin spokenAnswer by telling the user you cannot see right now. Do not describe what is in front of them and do not say whether the path is safe. You may still answer from the PAST MEMORY IMAGES and SPATIAL MEMORY below, saying clearly that it is from memory. Set isFromMemory = true if you do, and leave observedObjects empty.\n`
    : ''
}
WHAT IS HERE NOW: Anything you say about what is in front of or around the user right now, and whether the path is safe, must come only from [IMAGE 1: CURRENT LIVE CAMERA VIEW]. The past images and spatial memory may show a different place. Never describe something from them as being in the current view, and never warn about a hazard that is only in them.

INSTRUCTIONS FOR ANSWERING WITH SPATIAL MEMORY:
1. First, check [IMAGE 1: CURRENT LIVE CAMERA VIEW]. If the object/answer is visible right now, describe its current location and distance clearly, and set isFromMemory = false.
2. If the requested object is NOT in the current live camera view, check the [PAST MEMORY IMAGES] and the [SPATIAL MEMORY OF OBJECTS SEEN EARLIER]!
   - If found in memory or a past frame, tell the user clearly:
     a) That it is currently out of frame,
     b) Where it was remembered (which landmark/surface it was on or near, how long ago, and which direction to turn or pan the camera back based on the past view / compass hint),
     c) Set isFromMemory = true and isObjectFound = true!
3. Also list up to 6 notable objects visible in [IMAGE 1: CURRENT LIVE CAMERA VIEW] inside observedObjects so we can add them to spatial memory.

HOW TO ANSWER:
- This is an ongoing spoken conversation. Use the conversation so far to understand follow-ups like "what about on the left?" or "what color is it?", and do not repeat what you already said unless asked.
- Simple questions and small talk: answer in one or two short sentences (under 35 words).
- When asked to describe an object: give what it is, its color, size, shape, any readable text or labels, and where it is, in up to 60 words.
- When asked to describe a pathway, room, or route: describe it in walking order from nearest to farthest, covering the floor surface, how wide and clear the way is, turns, doors, stairs, obstacles, and useful landmarks, in up to 70 words.
- If you cannot see enough to answer well (the room, path, or object is only partly in view, the camera points at the floor, ceiling, or a wall, or the view is dark, blurry, or blocked), say what you can see, then ask the user to move so you can see the rest, e.g. "Turn slowly to your right so I can see that side of the room." Never guess about parts you cannot see.
- Only fill followUpDirection when the user should physically do something next. Leave it empty for descriptions and small talk.
- ALWAYS END WITH WHAT IS AHEAD: the user is fully blind and may start walking as soon as you stop talking. Whatever they asked, answer the question first, then finish spokenAnswer with one short sentence saying what is directly in front of them in the walking path and whether it is clear, e.g. "Ahead of you: a chair two steps away at 12 o'clock, pass on the left." or "Ahead of you the floor is clear for about ten feet." Skip this only when the live camera feed is down, or when your answer already described the path ahead.

GUIDING THE USER SOMEWHERE:
- If the user asks you to take, guide, or help them get to a place or object (an exit, a door, the stairs, an elevator, a restroom, a chair, a person), set navigationGoal to a short name for it, e.g. "the exit door", and use spokenAnswer to give the first step toward it. If you cannot see it yet, say so and tell them which way to turn so you can look for it. From then on you will keep guiding them until they arrive.
- EXITS AND SIGNS: when the user asks where the exit is, or to be taken to it, look for EXIT signs as well as doors. If you can see a sign, say where the sign is and which way its arrow points (left, right, or straight on; no arrow means the exit is at the sign itself), and tell them to go that way. Asking where the exit is counts as asking to be guided there: set navigationGoal to "the exit".
- If you can see neither the place they want nor a sign for it, say so, and ask them to turn slowly in a full circle so you can look for it. Never guess where it is.
- Leave navigationGoal as an empty string when they are only asking what something is or what you see.
- If the user says to stop guiding them, that they have arrived, or never mind, set cancelNavigation to true.`,
      });

      const systemInstruction = `You are ARIA VISION, a friendly AI visual assistant with Spatial Object Memory, talking out loud with a user who is fully blind. They cannot see anything at all: you are their eyes, and what you say is all they know about what is around them.
Speak like a calm, helpful companion walking beside them: natural sentences, no lists, no jargon, no filler.
You remember objects the camera saw earlier even after the camera turns away. Always give clear, concise, spatial directions suitable for text-to-speech.
SAFETY FIRST: If the current live view shows a hazard in the walking path (stairs, drop-offs, curbs, vehicles, obstacles, tripping hazards), start spokenAnswer with "Stop!" or "Caution!" and name the hazard before anything else. If you already warned about that same hazard earlier in this conversation and the view has not changed, do not open with the warning again; answer first and mention it briefly at the end.
Give directions with clock positions or left / right / ahead, and distances in steps or feet.
If the view is too dark, blurry, or blocked to judge, say you are not sure instead of guessing.`;

      const response = await generateWithFallback({
        contents: {
          parts: promptParts,
        },
        config: {
          systemInstruction,
          // Spoken answers have to come back quickly
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              spokenAnswer: {
                type: Type.STRING,
                description: "Spoken reply to the user. Short for simple questions, up to about 70 words for requested descriptions.",
              },
              followUpDirection: {
                type: Type.STRING,
                description: "Optional next physical action, e.g. 'Turn left back toward the white desk'. Empty string when none is needed.",
              },
              isObjectFound: {
                type: Type.BOOLEAN,
                description: "True if the object was found either in the current view OR in spatial memory / past frames",
              },
              isFromMemory: {
                type: Type.BOOLEAN,
                description: "True if the answer or object location was recalled from Spatial Memory / past frames outside the current camera view",
              },
              safetyNote: {
                type: Type.STRING,
              },
              navigationGoal: {
                type: Type.STRING,
                description: "Short name of the place or object the user asked to be guided to, e.g. 'the exit door'. Empty string when they did not ask to be guided somewhere.",
              },
              cancelNavigation: {
                type: Type.BOOLEAN,
                description: 'True when the user asked to stop being guided to the destination.',
              },
              observedObjects: {
                type: Type.ARRAY,
                description: "Notable objects currently visible in IMAGE 1 (the current live camera frame) to store in spatial memory",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    position: { type: Type.STRING },
                    distance: { type: Type.STRING },
                    landmarkContext: { type: Type.STRING },
                  },
                  required: ['label', 'position', 'distance', 'landmarkContext'],
                },
              },
            },
            required: ['spokenAnswer', 'isObjectFound', 'isFromMemory', 'navigationGoal', 'cancelNavigation', 'observedObjects'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      res.json({
        success: true,
        data: parsed,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      console.error('Error in /api/aria/query:', error);
      sendError(res, error, 'Voice query failed');
    }
  });

  // Mount Vite middleware in development or serve static in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Aria Vision server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
