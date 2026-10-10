/**
 * Pre-written answers for the four built-in demo scenes.
 * Used when OFFLINE_DEMO=true in .env, or automatically when every Gemini model has hit its
 * usage limit, so the demo still works with no AI requests left. Responses are flagged
 * `offlineDemo: true` and the page labels them, so nobody mistakes them for live AI output.
 */

type Analysis = Record<string, unknown>;

const SCENE_ANALYSIS: Record<string, Analysis> = {
  descending_stairs: {
    urgency: 'immediate_hazard',
    immediateAlert: 'Stop! Descending stairs ahead',
    spokenGuidance: 'Stairs going down about 3 steps ahead. Handrail on your right.',
    spatialDirection: 'stop',
    confidenceScore: 0.9,
    detectedObjects: [
      { label: 'descending stairs', position: 'center', distance: 'near (3-6ft)', hazardLevel: 'high' },
      { label: 'handrail', position: 'right', distance: 'near (3-6ft)', hazardLevel: 'none' },
    ],
    soundCue: 'hazard_alarm',
    sceneSummary: 'Indoor hallway ending in a staircase going down.',
  },
  crosswalk_pedestrian: {
    urgency: 'immediate_hazard',
    immediateAlert: 'Stop! Car approaching from the left',
    spokenGuidance: 'Wait at the curb. A car is crossing in front of you.',
    spatialDirection: 'stop',
    confidenceScore: 0.85,
    detectedObjects: [
      { label: 'moving car', position: 'left', distance: 'near (3-6ft)', hazardLevel: 'high' },
      { label: 'curb edge', position: 'ground', distance: 'immediate (< 3ft)', hazardLevel: 'medium' },
    ],
    soundCue: 'hazard_alarm',
    sceneSummary: 'City crosswalk with a car passing.',
  },
  office_tripping_hazards: {
    urgency: 'caution',
    immediateAlert: 'Caution, cable on the floor ahead',
    spokenGuidance: 'Box on the floor at 11 o clock. Bear slightly right to pass.',
    spatialDirection: 'slight_right',
    confidenceScore: 0.85,
    detectedObjects: [
      { label: 'floor cable', position: 'ground', distance: 'near (3-6ft)', hazardLevel: 'medium' },
      { label: 'box', position: 'left', distance: 'near (3-6ft)', hazardLevel: 'medium' },
    ],
    soundCue: 'caution_ping',
    sceneSummary: 'Office with items on the floor.',
  },
  corridor_doorway: {
    urgency: 'informational',
    spokenGuidance: 'Path ahead is clear. Exit door on your right, about 10 feet.',
    spatialDirection: 'straight',
    confidenceScore: 0.9,
    detectedObjects: [{ label: 'exit door', position: 'right', distance: 'far (> 10ft)', hazardLevel: 'none' }],
    soundCue: 'clear_chime',
    sceneSummary: 'Hallway with an exit door on the right.',
  },
};

const SCENE_EXIT_GUIDANCE: Record<string, string> = {
  corridor_doorway: 'Exit door on your right, about 10 feet. Walk straight, then turn right.',
  descending_stairs: 'No exit door in view. Stairs ahead. Turn around to look for the exit.',
};

export function getOfflineAnalysis(scenarioId: string, userIntent?: string): Analysis | null {
  const base = SCENE_ANALYSIS[scenarioId];
  if (!base) return null;
  const wantsExit = userIntent && /exit|door|out/i.test(userIntent);
  if (wantsExit && SCENE_EXIT_GUIDANCE[scenarioId] && base.urgency !== 'immediate_hazard') {
    return { ...base, spokenGuidance: SCENE_EXIT_GUIDANCE[scenarioId], spatialDirection: 'slight_right', offlineDemo: true };
  }
  return { ...base, offlineDemo: true };
}

export function getOfflineAnswer(scenarioId: string, question: string): Analysis | null {
  const scene = SCENE_ANALYSIS[scenarioId];
  if (!scene) return null;
  const q = question.toLowerCase();

  if (/exit|door|way out/.test(q)) {
    const atExit = scenarioId === 'corridor_doorway';
    return {
      spokenAnswer: atExit
        ? 'The exit door is on your right, about 10 feet ahead.'
        : 'I do not see an exit door from here.',
      followUpDirection: atExit ? 'Walk straight, then turn right.' : 'Turn slowly to look around.',
      isObjectFound: atExit,
      navigationGoal: 'the exit door',
      offlineDemo: true,
    };
  }
  if (/stair|drop|step/.test(q)) {
    const hasStairs = scenarioId === 'descending_stairs';
    return {
      spokenAnswer: hasStairs
        ? 'Yes. Stairs going down about 3 steps ahead, with a handrail on your right.'
        : 'No stairs or drop-offs in view.',
      isObjectFound: hasStairs,
      safetyNote: hasStairs ? 'Hold the handrail and check each step with your cane.' : undefined,
      navigationGoal: '',
      offlineDemo: true,
    };
  }
  return {
    spokenAnswer: `${scene.sceneSummary} ${scene.spokenGuidance}`,
    isObjectFound: true,
    navigationGoal: '',
    offlineDemo: true,
  };
}
