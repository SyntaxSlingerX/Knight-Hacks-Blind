import React, { useState } from 'react';
import { ShieldAlert, ChevronDown, ChevronUp, Volume2 } from 'lucide-react';
import { speechManager } from '../utils/speech';

export const SafetyDisclaimer: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const safetyText =
    'Safety Notice: Aria Vision is an assistive prototype and is not a replacement for a white cane or guide dog. Always verify paths with your primary mobility tool.';

  return (
    <div
      role="note"
      aria-label="Important Safety Notice"
      className="bg-slate-950 border-2 border-amber-400 rounded-2xl p-4 text-sm text-white shadow-lg"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 font-black text-amber-300 text-sm md:text-base uppercase tracking-wide">
          <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 stroke-[2.5]" />
          <span>Assistive Navigation Safety Notice</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => speechManager.speak(safetyText, { interrupt: true })}
            aria-label="Read safety notice aloud"
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-400/60 rounded-xl text-xs font-extrabold flex items-center gap-1.5"
          >
            <Volume2 className="w-4 h-4" />
            <span>Read Safety Notice</span>
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-black rounded-xl text-xs font-black flex items-center gap-1"
          >
            <span>{isExpanded ? 'Hide Details' : 'Details'}</span>
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <p className="mt-1.5 text-slate-100 font-bold leading-snug text-xs md:text-sm">
        Aria Vision is an assistive companion — <strong>NOT a replacement</strong> for a white cane, guide dog, or O&M training.
      </p>

      {isExpanded && (
        <div className="mt-3 pt-3 border-t-2 border-slate-800 space-y-2 text-xs md:text-sm text-white font-semibold">
          <p>
            • <strong className="text-amber-300">Sensor Limitations:</strong> Cameras can miss drop-offs, glass doors, fast traffic, or hazards in dim light.
          </p>
          <p>
            • <strong className="text-amber-300">Cane Priority:</strong> Always sweep ground surfaces with your cane before stepping forward.
          </p>
          <p>
            • <strong className="text-amber-300">Hazard Alarm:</strong> If you hear a double-beep alarm, stop immediately and verify with your cane.
          </p>
        </div>
      )}
    </div>
  );
};
