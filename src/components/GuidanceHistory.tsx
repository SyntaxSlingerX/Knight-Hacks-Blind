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
    <div className="bg-slate-950 border-2 border-slate-700 rounded-3xl p-5 md:p-6 shadow-2xl flex flex-col gap-4">
      <div className="flex items-center justify-between border-b-2 border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <History className="w-6 h-6 text-amber-400" />
          <h2 className="text-lg md:text-xl font-black text-white uppercase tracking-wide">
            Spoken Guidance Log
          </h2>
        </div>
        {history.length > 0 && (
          <button
            onClick={onClear}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs font-extrabold text-slate-200 hover:text-red-300 hover:border-red-400 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span>CLEAR LOG</span>
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="text-center py-8 text-slate-300 font-bold text-sm md:text-base">
          No spoken announcements yet. Start assistance or scan the scene to hear live updates.
        </div>
      ) : (
        <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
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
                className={`p-4 rounded-2xl border-2 text-sm md:text-base flex items-start justify-between gap-3 transition-colors ${
                  isHazard
                    ? 'bg-red-950/70 border-red-500 text-white'
                    : isCaution
                    ? 'bg-amber-950/60 border-amber-400 text-white'
                    : 'bg-black border-slate-700 text-white'
                }`}
              >
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    {isHazard ? (
                      <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
                    ) : (
                      <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                    )}
                    <span className="font-mono text-xs font-bold text-yellow-300">{timeStr}</span>
                    <span className="font-black uppercase text-xs tracking-wider bg-slate-900 px-2 py-0.5 rounded border border-slate-700 text-white">
                      {item.spatialDirection.replace('_', ' ')}
                    </span>
                  </div>

                  <p className="font-extrabold leading-snug text-base md:text-lg">
                    {item.immediateAlert ? (
                      <span className="font-black block text-red-300 uppercase mb-0.5">
                        {item.immediateAlert}
                      </span>
                    ) : null}
                    "{item.spokenGuidance}"
                  </p>
                </div>

                <button
                  onClick={() =>
                    speechManager.speak(item.immediateAlert || item.spokenGuidance, { isUrgent: true })
                  }
                  aria-label="Replay audio announcement"
                  className="p-3 bg-amber-400 hover:bg-amber-300 text-black font-black rounded-xl border-2 border-white transition-colors shrink-0 min-h-[48px] min-w-[48px] flex items-center justify-center"
                >
                  <Volume2 className="w-5 h-5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
