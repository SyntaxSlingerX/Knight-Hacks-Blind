import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // JSON body parser with limit for base64 camera frames
  app.use(express.json({ limit: '25mb' }));

  // Initialize Gemini client with mandatory User-Agent
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
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
   * Real-time Scene Understanding for Navigation
   * Endpoint: POST /api/aria/analyze
   */
  app.post('/api/aria/analyze', async (req, res) => {
    try {
      const { image, previousGuidance, userIntent } = req.body;

      if (!image) {
        return res.status(400).json({ error: 'Image data is required' });
      }

      // Extract base64 payload
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
6. EXPLICIT UNCERTAINTY: If lighting is dim, glare is high, or camera view is obscured, explicitly note uncertainty. This prototype does not replace a white cane or guide dog.
7. NO INVENTED DESTINATIONS: ${userIntent ? `The user's goal is: "${userIntent}". Guide them toward it.` : 'The user has NOT told you where they are going. Do not choose a destination for them, and never tell them to go to a door, exit, hallway, or outside. Only describe what is around them and whether the path directly ahead is safe.'}`;

      const promptText = `Analyze this camera view from the smart glasses. Identify all navigation hazards, walking path status, doorways, stairs, obstacles, and people. Provide immediate navigation guidance.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: {
          parts: [imagePart, { text: promptText }],
        },
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW, // Low thinking for fast navigation latency
          },
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              urgency: {
                type: Type.STRING,
                description: "Urgency category: 'immediate_hazard', 'caution', 'clear', or 'informational'",
              },
              immediateAlert: {
                type: Type.STRING,
                description: "Very short alert for instant earcon/vocal warning if hazard or caution (e.g. 'Stop! Descending stairs 3 steps ahead' or 'Caution, chair on right')",
              },
              spokenGuidance: {
                type: Type.STRING,
                description: "Concise spoken instruction for the user (max 15-20 words). E.g. 'Path ahead is clear. A closed door is on your left at 10 feet.'",
              },
              spatialDirection: {
                type: Type.STRING,
                description: "Recommended safe path: 'straight', 'slight_left', 'slight_right', 'stop', 'detour_left', 'detour_right'",
              },
              confidenceScore: {
                type: Type.NUMBER,
                description: "Confidence from 0.0 to 1.0 in this assessment",
              },
              detectedObjects: {
                type: Type.ARRAY,
                description: "List of key detected navigation objects and hazards",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    position: { type: Type.STRING, description: "e.g. 'left', 'center', 'right', 'ground', 'overhead'" },
                    distance: { type: Type.STRING, description: "e.g. 'immediate (< 3ft)', 'near (3-6ft)', 'far (> 10ft)'" },
                    hazardLevel: { type: Type.STRING, description: "'high', 'medium', 'low', 'none'" },
                  },
                  required: ['label', 'position', 'distance', 'hazardLevel'],
                },
              },
              soundCue: {
                type: Type.STRING,
                description: "Sound earcon to trigger: 'hazard_alarm', 'caution_ping', 'clear_chime', 'none'",
              },
              uncertaintyWarning: {
                type: Type.STRING,
                description: "Any uncertainty or disclaimer due to lighting/angle",
              },
              sceneSummary: {
                type: Type.STRING,
                description: "One sentence overview of the environment",
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
   * Natural Voice Q&A over current glasses camera view
   * Endpoint: POST /api/aria/query
   */
  app.post('/api/aria/query', async (req, res) => {
    try {
      const { image, question } = req.body;

      if (!question) {
        return res.status(400).json({ error: 'Question is required' });
      }

      const promptParts: any[] = [];

      if (image) {
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        promptParts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Data,
          },
        });
      }

      promptParts.push({
        text: `The visually impaired user is asking: "${question}".
Answer directly, concisely, and spatially based on the camera view.
Be specific with locations (e.g. "on your right around 5 feet away", "directly in front of you").
If the object is not visible, say so clearly and suggest where to turn.
Do not guess. Prioritize safety. Keep answer under 30 words so it can be spoken quickly.`,
      });

      const systemInstruction = `You are ARIA VISION, answering questions for a blind user wearing smart glasses.
Always speak clearly, spatially, and concisely. Keep answers suitable for text-to-speech voice output.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: {
          parts: promptParts,
        },
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              spokenAnswer: {
                type: Type.STRING,
                description: "Direct, spoken answer to the user's question (max 30 words)",
              },
              followUpDirection: {
                type: Type.STRING,
                description: "Actionable orientation instruction, e.g. 'Turn 45 degrees to the left' or 'Step forward carefully'",
              },
              isObjectFound: {
                type: Type.BOOLEAN,
                description: "Whether the requested object or landmark was found in the image",
              },
              safetyNote: {
                type: Type.STRING,
                description: "Important safety warning regarding the query (e.g. 'Check floor with cane')",
              },
            },
            required: ['spokenAnswer', 'isObjectFound'],
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
