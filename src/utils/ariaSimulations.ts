/**
 * Meta Project Aria Smart Glasses Real-World Navigation Simulation Rig
 * Generates realistic POV perspectives from Project Aria research glasses.
 */

export interface SimulationScenario {
  id: string;
  name: string;
  category: 'hazard' | 'outdoor' | 'indoor' | 'navigation';
  description: string;
  hazardType: string;
  recommendedDirection: string;
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number, frame: number) => void;
}

export const SIMULATION_SCENARIOS: SimulationScenario[] = [
  {
    id: 'descending_stairs',
    name: 'Hallway with Descending Stairs',
    category: 'hazard',
    description: 'Indoor corridor with a drop-off staircase 3 steps ahead and side handrails.',
    hazardType: 'Immediate Drop-off / Falling Hazard',
    recommendedDirection: 'Stop immediately',
    draw: (ctx, width, height, frame) => {
      // Background walls & ceiling
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, '#1e293b');
      grad.addColorStop(0.5, '#334155');
      grad.addColorStop(1, '#0f172a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Floor perspective
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.moveTo(width * 0.15, height);
      ctx.lineTo(width * 0.42, height * 0.45);
      ctx.lineTo(width * 0.58, height * 0.45);
      ctx.lineTo(width * 0.85, height);
      ctx.closePath();
      ctx.fill();

      // Side walls
      ctx.fillStyle = '#64748b';
      // Left wall
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(width * 0.42, height * 0.45);
      ctx.lineTo(width * 0.15, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fill();

      // Right wall
      ctx.fillStyle = '#526075';
      ctx.beginPath();
      ctx.moveTo(width, 0);
      ctx.lineTo(width * 0.58, height * 0.45);
      ctx.lineTo(width * 0.85, height);
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();

      // Doors along walls
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(width * 0.18, height * 0.38, width * 0.08, height * 0.28);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(width * 0.19, height * 0.39, width * 0.06, height * 0.26);

      // Descending Stairs (The Hazard!)
      // Stair treads dropping downwards
      const stairY = height * 0.58 + Math.sin(frame * 0.05) * 2;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(width * 0.25, stairY, width * 0.5, height * 0.04);

      ctx.fillStyle = '#1e293b';
      ctx.fillRect(width * 0.22, stairY + height * 0.04, width * 0.56, height * 0.05);

      ctx.fillStyle = '#020617';
      ctx.fillRect(width * 0.18, stairY + height * 0.09, width * 0.64, height * 0.06);

      // Yellow hazard caution edge on top step
      ctx.fillStyle = '#eab308';
      ctx.fillRect(width * 0.25, stairY, width * 0.5, 6);

      // Handrail on right
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(width * 0.72, stairY - 30);
      ctx.lineTo(width * 0.85, height * 0.85);
      ctx.stroke();

      // Overhead fluorescent lights
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(width * 0.46, height * 0.08, width * 0.08, height * 0.02);
      ctx.fillRect(width * 0.44, height * 0.22, width * 0.12, height * 0.02);
    },
  },
  {
    id: 'crosswalk_pedestrian',
    name: 'City Pedestrian Crosswalk & Car',
    category: 'outdoor',
    description: 'Outdoor street crossing with white zebra lines, approaching sedan, and pedestrian signal.',
    hazardType: 'Approaching Traffic / Street Crossing',
    recommendedDirection: 'Hold position until vehicle stops',
    draw: (ctx, width, height, frame) => {
      // Sky
      const skyGrad = ctx.createLinearGradient(0, 0, 0, height * 0.4);
      skyGrad.addColorStop(0, '#38bdf8');
      skyGrad.addColorStop(1, '#bae6fd');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, height * 0.4);

      // City buildings backdrop
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(width * 0.05, height * 0.15, width * 0.2, height * 0.25);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(width * 0.3, height * 0.1, width * 0.25, height * 0.3);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(width * 0.65, height * 0.18, width * 0.3, height * 0.22);

      // Road Asphalt
      ctx.fillStyle = '#334155';
      ctx.fillRect(0, height * 0.4, width, height * 0.6);

      // Sidewalk Curb in foreground
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(0, height * 0.82, width, height * 0.18);
      ctx.fillStyle = '#64748b'; // Curb drop
      ctx.fillRect(0, height * 0.82, width, 12);

      // Tactile Ground Surface Indicators (Paving bumps on curb)
      ctx.fillStyle = '#eab308';
      for (let x = width * 0.1; x < width * 0.9; x += 24) {
        for (let y = height * 0.84; y < height * 0.96; y += 18) {
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // White Zebra Crosswalk Stripes
      ctx.fillStyle = '#ffffff';
      const stripes = [0.42, 0.48, 0.55, 0.63, 0.72];
      stripes.forEach((yRatio) => {
        ctx.fillRect(width * 0.2, height * yRatio, width * 0.6, height * 0.035);
      });

      // Car on the left lane (animating slightly)
      const carOffset = (frame % 100) * 0.4;
      const carX = width * 0.22 + carOffset;
      const carY = height * 0.48;

      // Car body
      ctx.fillStyle = '#dc2626'; // Red vehicle
      ctx.beginPath();
      ctx.roundRect(carX, carY, width * 0.22, height * 0.08, 10);
      ctx.fill();

      // Car roof/windows
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(carX + width * 0.04, carY - height * 0.04, width * 0.14, height * 0.045);

      // Headlights
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(carX + width * 0.2, carY + height * 0.02, 10, 10);

      // Pedestrian Signal Pole on right
      ctx.fillStyle = '#475569';
      ctx.fillRect(width * 0.82, height * 0.25, 12, height * 0.58);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(width * 0.79, height * 0.25, 32, 50);

      // Walking white figure (Walk sign illuminated)
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(width * 0.81, height * 0.28, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(width * 0.8, height * 0.29, 6, 12);
    },
  },
  {
    id: 'office_tripping_hazards',
    name: 'Office Room with Tripping Hazards',
    category: 'hazard',
    description: 'Indoor room with office swivel chair, floor power cables, and open doorway on right.',
    hazardType: 'Low Floor Obstacle & Tangled Cord',
    recommendedDirection: 'Step right towards clear doorway',
    draw: (ctx, width, height, frame) => {
      // Walls & Floor
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(0, 0, width, height * 0.5);

      ctx.fillStyle = '#64748b'; // Carpet floor
      ctx.fillRect(0, height * 0.5, width, height * 0.5);

      // Open Doorway on right side
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(width * 0.72, height * 0.18, width * 0.22, height * 0.65);
      ctx.fillStyle = '#0284c7'; // Clear blue corridor beyond
      ctx.fillRect(width * 0.74, height * 0.2, width * 0.18, height * 0.63);

      // Swivel Chair directly in path (obstacle)
      const chairX = width * 0.35;
      const chairY = height * 0.42;

      // Chair back
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.roundRect(chairX, chairY, width * 0.22, height * 0.2, 12);
      ctx.fill();

      // Chair seat
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.roundRect(chairX - 10, chairY + height * 0.16, width * 0.26, height * 0.08, 8);
      ctx.fill();

      // Chair pole & 5-star wheeled base
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(chairX + width * 0.11, chairY + height * 0.24, 12, height * 0.1);

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(chairX - 15, chairY + height * 0.35);
      ctx.lineTo(chairX + width * 0.26, chairY + height * 0.35);
      ctx.stroke();

      // Black power cable across floor (tripping hazard!)
      ctx.strokeStyle = '#020617';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(width * 0.1, height * 0.75);
      ctx.bezierCurveTo(
        width * 0.3,
        height * 0.88 + Math.sin(frame * 0.03) * 3,
        width * 0.5,
        height * 0.7,
        width * 0.75,
        height * 0.82
      );
      ctx.stroke();

      // Backpack on floor next to chair
      ctx.fillStyle = '#b91c1c';
      ctx.beginPath();
      ctx.roundRect(width * 0.2, height * 0.68, width * 0.12, height * 0.14, 10);
      ctx.fill();
    },
  },
  {
    id: 'corridor_doorway',
    name: 'Hallway Navigation & Exit Door',
    category: 'navigation',
    description: 'Long corridor with green illuminated EXIT sign ahead and closed doors along walls.',
    hazardType: 'None - Clear Walking Path',
    recommendedDirection: 'Walk straight ahead towards exit',
    draw: (ctx, width, height, frame) => {
      // Perspective corridor
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, width, height);

      // Floor tiles
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(width * 0.44, height * 0.45);
      ctx.lineTo(width * 0.56, height * 0.45);
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();

      // Tile grid lines
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      for (let i = 0.1; i < 1; i += 0.15) {
        ctx.beginPath();
        ctx.moveTo(width * (0.44 + (i - 0.44) * 0.1), height * 0.45);
        ctx.lineTo(width * i, height);
        ctx.stroke();
      }

      // Exit Door at end of hall
      ctx.fillStyle = '#64748b';
      ctx.fillRect(width * 0.44, height * 0.25, width * 0.12, height * 0.2);

      // Green glowing EXIT sign
      ctx.fillStyle = '#15803d';
      ctx.fillRect(width * 0.45, height * 0.2, width * 0.1, height * 0.04);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('EXIT', width * 0.47, height * 0.228);

      // Side doors
      ctx.fillStyle = '#475569';
      ctx.fillRect(width * 0.08, height * 0.35, width * 0.1, height * 0.4);
      ctx.fillRect(width * 0.82, height * 0.35, width * 0.1, height * 0.4);

      // Silver door handles
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(width * 0.16, height * 0.55, 12, 6);
      ctx.fillRect(width * 0.83, height * 0.55, 12, 6);
    },
  },
];

/**
 * Draws HUD overlay overlaying simulated Meta Project Aria smart glasses telemetry
 */
export function drawAriaGlassesHUD(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scenarioName: string
): void {
  // Vignette & Aria sensor crosshair
  const radius = Math.min(width, height) * 0.48;
  const centerX = width / 2;
  const centerY = height / 2;

  // Meta Project Aria subtle field of view frame
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, width - 40, height - 40);

  // Aria Central gaze fixation ring (Project Aria Eye-Tracking simulation)
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 24, 0, Math.PI * 2);
  ctx.stroke();

  // Subtle telemetry banner top
  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  ctx.fillRect(24, 24, width - 48, 36);

  ctx.fillStyle = '#38bdf8';
  ctx.font = '600 13px monospace';
  ctx.fillText('META PROJECT ARIA · RGB SENSOR 1408x1408 · 30 FPS', 36, 47);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px monospace';
  ctx.fillText(`POV: ${scenarioName}`, width - 280, 47);
}
