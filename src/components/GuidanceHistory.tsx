import React from 'react';
import { History, Volume2, ShieldAlert, CheckCircle, Trash2 } from 'lucide-react';
import { NavigationAnalysis } from '../types/aria';
import { speechManager } from '../utils/speech';

interface GuidanceHistoryProps {
  history: NavigationAnalysis[];
  onClear: () => void;
}

export const GuidanceHistory: React.FC<GuidanceHistoryProps> = ({ history, onClear }) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-amber-400" />
          <h3 className="text-base font-bold text-white">Navigation Log & Spoken History</h3>
        </div>
        {history.length > 0 && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="text-center py-6 text-slate-500 text-xs">
          No spoken announcements yet. Start assistance to see live updates.
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[260px] overflow-y-auto pr-1">
          {history.map((item, idx) => {
            const isHazard = item.urgency === 'immediate_hazard';
            const isCaution = item.urgency === 'caution';
            const timeStr = new Date(item.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });

            return (
              <div
                key={idx}
                className={`p-3 rounded-xl border text-xs flex items-start justify-between gap-3 transition-colors ${
                  isHazard
                    ? 'bg-red-950/40 border-red-700/60 text-red-200'
                    : isCaution
                    ? 'bg-amber-950/30 border-amber-700/50 text-amber-200'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300'
                }`}
              >
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    {isHazard ? (
                      <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                    ) : (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    <span className="font-mono text-[10px] text-slate-400">{timeStr}</span>
                    <span className="font-bold uppercase text-[10px] tracking-wider text-slate-300">
                      {item.spatialDirection.replace('_', ' ')}
                    </span>
                  </div>

                  <p className="font-medium leading-relaxed">
                    {item.immediateAlert ? (
                      <span className="font-bold block text-red-300">{item.immediateAlert}</span>
                    ) : null}
                    "{item.spokenGuidance}"
                  </p>
                </div>

                <button
                  onClick={() => speechManager.speak(item.immediateAlert || item.spokenGuidance)}
                  aria-label="Replay audio announcement"
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-lg transition-colors shrink-0"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
