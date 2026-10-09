import React, { useState } from 'react';
import { ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react';

export const SafetyDisclaimer: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  return (
    <div
      role="note"
      aria-label="Important Safety Notice"
      className="bg-slate-900/90 border border-amber-500/40 rounded-2xl p-3.5 md:p-4 text-xs text-amber-200/90 shadow-lg"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-bold text-amber-300">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Safety Notice: Assistive Navigation Prototype</span>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-[11px] text-amber-300/80 hover:text-amber-200 flex items-center gap-1 font-semibold underline"
        >
          <span>{isExpanded ? 'Less' : 'Learn More'}</span>
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      <p className="mt-1 text-slate-300 leading-relaxed text-[11px]">
        Aria Vision is an experimental assistive prototype. It is <strong>NOT a replacement</strong> for a white cane,
        guide dog, or Orientation & Mobility (O&M) training. Never assume a walking path is 100% hazard-free.
      </p>

      {isExpanded && (
        <div className="mt-2.5 pt-2.5 border-t border-amber-500/20 space-y-1.5 text-[11px] text-slate-300">
          <p>
            • <strong>Sensor Limitations:</strong> Camera feeds can miss low drop-offs, transparent glass doors, rapid moving
            traffic, or items under poor lighting conditions.
          </p>
          <p>
            • <strong>Physical Cane Priority:</strong> Always sweep ground surfaces with your primary mobility tool before
            stepping forward.
          </p>
          <p>
            • <strong>Earcon Priority:</strong> If you hear an urgent double-beep alarm, stop immediately and verify with
            your cane.
          </p>
        </div>
      )}
    </div>
  );
};
