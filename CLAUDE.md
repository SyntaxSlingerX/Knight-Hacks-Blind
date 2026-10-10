# Aria Vision

## The purpose
Aria Vision is a navigation assistant for blind and visually impaired people. It watches the path ahead through a camera, warns about hazards before the user reaches them, and gives short spoken directions so they can move with more confidence.

## How it works
- **Camera:** Aria Vision sees through Meta Project Aria smart glasses, a laptop webcam, or built-in demo scenes.
- **Hazard detection:** Gemini checks the view every few seconds for stairs, curbs, cars, tripping hazards, and obstacles in the walking path, and sorts each one as an immediate hazard, a caution, or a clear path.
- **Spoken guidance:** Directions are short and use clock positions or left/right/ahead, like "Stop! Descending stairs ahead" or "Chair at 2 o'clock."
- **Sound alerts:** Hazards, cautions, and a clear path each have their own tone, so the user knows what's happening before the sentence finishes.
- **Voice questions:** The user can ask things like "Where's the exit door?" and hear an answer based on what the camera sees.
- **Accessibility:** High-contrast themes, larger text, adjustable voice speed and volume, and keyboard shortcuts so it works without a mouse.

## Safety first
- Hazards are always spoken before anything else.
- When the view is too dark, blurry, or blocked, Aria Vision says it isn't sure instead of guessing.
- It doesn't repeat itself when nothing has changed, so important warnings stand out.
- It's built to work alongside a white cane or guide dog, not replace them.

## Where we are now
The app runs locally with live webcam input and four demo scenes: a hallway with stairs, a crosswalk with a car, an office with tripping hazards, and an exit door. Hazard detection, spoken guidance, sound alerts, and voice questions all work. KP is connecting the Aria glasses stream to the website, and David is redesigning the interface.

## Demo story
A user starts Aria Vision → walks down a hallway → hears "Stop! Descending stairs ahead" with an alarm → finds the railing and continues → asks "Where's the exit?" → gets told it's on their right → walks out the door.

## Code map
- `server.ts`: Express server. `/api/aria/analyze` (hazard scan of one camera frame) and `/api/aria/query` (voice question) call Gemini.
- `src/App.tsx`: main page and the auto-scan loop.
- `src/components/VoiceAssistant.tsx`: mic input and voice questions.
- `src/components/CameraView.tsx`: webcam, Aria stream, and demo scenes.
- `src/utils/speech.ts`: text-to-speech with hazard priority. `src/utils/audio.ts`: alert tones.
- Run locally with `bun run dev`. Type-check with `bun run lint`.
