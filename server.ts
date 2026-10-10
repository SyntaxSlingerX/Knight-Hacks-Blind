import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

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
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function generateWithFallback(params: { contents: any; config: any }) {
  const ai = getAiClient();
  let lastError: any = null;

  for (const model of FALLBACK_MODELS) {
    try {
      return await ai.models.generateContent({
        model,
        contents: params.contents,
        config: params.config,
      });
    } catch (err: any) {
      lastError = err;
      console.warn(`Model ${model} failed (${err?.status || err?.message}), trying next fallback...`);
    }
  }

  throw lastError;
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
      res.status(500).json({ error: 'Memory indexing failed' });
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

CRITICAL SAFETY & ASSISTIVE RULES:
1. PRIORITY ONE IS HAZARD DETECTION: Immediately identify drop-offs (descending stairs, platform edges, deep curbs), tripping hazards (low cords, boxes, unexpected steps, raised pavement), approaching vehicles, opening doors, low-hanging obstacles at head level, and obstacles directly in the walking path.
2. CONCISE & TERSE: Visually impaired people need short, clear spatial directions. Keep spoken guidance under 20 words. Never ramble. Never use flowery language.
3. RELATIVE SPATIAL DIRECTION: Use clock positions ("at 11 o'clock", "at 2 o'clock") or simple directions ("on your left", "directly ahead", "on your right", "on the floor").
4. URGENCY LEVELS:
   - "immediate_hazard": Urgent danger (stairs ahead, moving vehicle, obstacle in next step). Spoken guidance must start with "Stop!" or "Caution!".
   - "caution": Nearby obstacle or uneven ground requiring slow walking or slight detour.
   - "clear": Path ahead is open and clear for walking.
   - "informational": Navigational milestone (doorway located, elevator button panel spotted, crosswalk walk sign visible).
5. REPETITION AVOIDANCE: If previous guidance was '${previousGuidance || 'none'}' and the scene has not significantly changed, keep update minimal or state that the path remains clear.
6. EXPLICIT UNCERTAINTY: If lighting is dim, glare is high, or camera view is obscured, explicitly note uncertainty.
7. NO INVENTED DESTINATIONS: ${userIntent ? `The user's goal is: "${userIntent}". Guide them toward it.` : 'Only describe what is around them and whether the path directly ahead is safe.'}`;

      const promptText = `Analyze this camera view from the smart glasses. Identify all navigation hazards, walking path status, doorways, stairs, obstacles, and people. Provide immediate navigation guidance.`;

      const response = await generateWithFallback({
        contents: {
          parts: [imagePart, { text: promptText }],
        },
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              urgency: {
                type: Type.STRING,
              },
              immediateAlert: {
                type: Type.STRING,
              },
              spokenGuidance: {
                type: Type.STRING,
              },
              spatialDirection: {
                type: Type.STRING,
              },
              confidenceScore: {
                type: Type.NUMBER,
              },
              detectedObjects: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    position: { type: Type.STRING },
                    distance: { type: Type.STRING },
                    hazardLevel: { type: Type.STRING },
                  },
                  required: ['label', 'position', 'distance', 'hazardLevel'],
                },
              },
              soundCue: {
                type: Type.STRING,
              },
              uncertaintyWarning: {
                type: Type.STRING,
              },
              sceneSummary: {
                type: Type.STRING,
              },
            },
            required: [
              'urgency',
              'spokenGuidance',
              'spatialDirection',
              'confidenceScore',
              'detectedObjects',
              'soundCue',
              'sceneSummary',
            ],
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
      console.error('Error in /api/aria/analyze:', error);
      res.status(500).json({
        error: 'Vision analysis failed',
        details: error?.message || String(error),
      });
    }
  });

  /**
   * Natural Voice Q&A with Spatial Object Memory (remembers objects outside current camera view)
   * Endpoint: POST /api/aria/query
   */
  app.post('/api/aria/query', async (req, res) => {
    try {
      const { image, question, audio, audioMimeType, recentFrames, spatialMemory } = req.body;

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

      promptParts.push({
        text: `${
          audio
            ? `Listen to the visually impaired user's spoken question in the attached audio (or if silent/unclear, assume they asked: "${
                question || 'What is in front of me and is the path safe?'
              }").`
            : `The visually impaired user is asking: "${question}".`
        }
${memoryText}

INSTRUCTIONS FOR ANSWERING WITH SPATIAL MEMORY:
1. First, check [IMAGE 1: CURRENT LIVE CAMERA VIEW]. If the object/answer is visible right now, describe its current location and distance clearly, and set isFromMemory = false.
2. If the requested object is NOT in the current live camera view, check the [PAST MEMORY IMAGES] and the [SPATIAL MEMORY OF OBJECTS SEEN EARLIER]!
   - If found in memory or a past frame, tell the user clearly:
     a) That it is currently out of frame,
     b) Where it was remembered (which landmark/surface it was on or near, how long ago, and which direction to turn or pan the camera back based on the past view / compass hint),
     c) Set isFromMemory = true and isObjectFound = true!
3. Also list up to 6 notable objects visible in [IMAGE 1: CURRENT LIVE CAMERA VIEW] inside observedObjects so we can add them to spatial memory.
Keep spokenAnswer natural, spatial, and under 35 words.`,
      });

      const systemInstruction = `You are ARIA VISION, an AI visual assistant with Spatial Object Memory for a blind or visually impaired user.
You remember objects the camera saw earlier even after the camera turns away. Always give clear, concise, spatial directions suitable for text-to-speech.`;

      const response = await generateWithFallback({
        contents: {
          parts: promptParts,
        },
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              spokenAnswer: {
                type: Type.STRING,
                description: "Direct spoken answer to the user's question (max 35 words)",
              },
              followUpDirection: {
                type: Type.STRING,
                description: "Actionable instruction, e.g. 'Turn left back toward the white desk' or 'Step forward carefully'",
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
            required: ['spokenAnswer', 'isObjectFound', 'isFromMemory', 'observedObjects'],
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
      res.status(500).json({
        error: 'Voice query failed',
        details: error?.message || String(error),
      });
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
