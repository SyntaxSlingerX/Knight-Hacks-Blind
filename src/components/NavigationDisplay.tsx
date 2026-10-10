import React from 'react';
import {
  AlertTriangle,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Octagon,
  CornerUpLeft,
  CornerUpRight,
  ShieldAlert,
  Volume2,
  CheckCircle2,
  Compass,
  AlertCircle,
} from 'lucide-react';
import { NavigationAnalysis, SpatialDirection, UrgencyLevel, TextSize } from '../types/aria';
import { speechManager } from '../utils/speech';

interface NavigationDisplayProps {
  analysis: NavigationAnalysis | null;
  isAnalyzing: boolean;
  textSize: TextSize;
}

export const NavigationDisplay: React.FC<NavigationDisplayProps> = ({
  analysis,
  isAnalyzing,
  textSize,
}) => {
  const getDirectionIcon = (dir: SpatialDirection) => {
    switch (dir) {
      case 'straight':
        return <ArrowUp className="w-12 h-12 text-emerald-300 stroke-[3]" aria-label="Walk straight" />;
      case 'slight_left':
        return <ArrowUpLeft className="w-12 h-12 text-yellow-300 stroke-[3]" aria-label="Bear slight left" />;
      case 'slight_right':
        return <ArrowUpRight className="w-12 h-12 text-yellow-300 stroke-[3]" aria-label="Bear slight right" />;
      case 'stop':
        return <Octagon className="w-12 h-12 text-red-400 fill-red-500/30 stroke-[3]" aria-label="Stop immediately" />;
      case 'detour_left':
        return <CornerUpLeft className="w-12 h-12 text-yellow-300 stroke-[3]" aria-label="Detour around to the left" />;
      case 'detour_right':
        return <CornerUpRight className="w-12 h-12 text-yellow-300 stroke-[3]" aria-label="Detour around to the right" />;
      default:
        return <Compass className="w-12 h-12 text-yellow-300 stroke-[3]" />;
    }
  };

  const getUrgencyBadge = (urgency: UrgencyLevel) => {
    switch (urgency) {
      case 'immediate_hazard':
        return {
          bg: 'bg-red-600 border-white text-white',
          label: 'IMMEDIATE HAZARD',
          icon: <ShieldAlert className="w-5 h-5 text-white shrink-0 stroke-[2.5]" />,
        };
      case 'caution':
        return {
          bg: 'bg-amber-400 border-white text-black',
          label: 'CAUTION ADVISED',
          icon: <AlertTriangle className="w-5 h-5 text-black shrink-0 stroke-[2.5]" />,
        };
      case 'clear':
        return {
          bg: 'bg-emerald-400 border-white text-black',
          label: 'PATH CLEAR',
          icon: <CheckCircle2 className="w-5 h-5 text-black shrink-0 stroke-[2.5]" />,
        };
      case 'informational':
      default:
        return {
          bg: 'bg-sky-400 border-white text-black',
          label: 'NAVIGATION INFO',
          icon: <Compass className="w-5 h-5 text-black shrink-0 stroke-[2.5]" />,
        };
    }
  };

  // High-visibility font size multiplier
  const textClasses = {
    normal: {
      guidance: 'text-xl md:text-2xl',
      alert: 'text-lg md:text-xl',
    },
    large: {
      guidance: 'text-2xl md:text-3xl',
      alert: 'text-xl md:text-2xl',
    },
    xlarge: {
      guidance: 'text-2xl sm:text-3xl md:text-4xl',
      alert: 'text-2xl md:text-3xl',
    },
  }[textSize];

  if (!analysis) {
    return (
      <div className="bg-slate-950 border-2 border-slate-700 rounded-3xl p-6 md:p-8 text-center shadow-2xl">
        <Volume2 className="w-14 h-14 text-amber-400 mx-auto mb-3 animate-pulse" />
        <h2 className="text-xl md:text-2xl font-black text-white uppercase tracking-wide">
          Navigation Guidance Ready
        </h2>
        <p className="text-base md:text-lg text-slate-200 font-bold max-w-md mx-auto mt-2 leading-relaxed">
          Tap <strong className="text-emerald-300 underline">"START ASSISTANCE"</strong> at the top, or press{' '}
          <kbd className="px-2.5 py-1 bg-amber-400 text-black rounded-lg font-mono font-black text-sm">
            SPACEBAR
          </kbd>{' '}
          to speak a voice question.
        </p>
      </div>
    );
  }

  const badge = getUrgencyBadge(analysis.urgency);

  return (
    <section
      aria-label="Current Navigation Guidance"
      className="flex flex-col gap-5 bg-slate-950 border-2 border-slate-700 rounded-3xl p-5 md:p-6 shadow-2xl relative overflow-hidden"
    >
      {/* Live Audio & Screen Reader Announcement Area */}
      <div
        role="alert"
        aria-live={analysis.urgency === 'immediate_hazard' ? 'assertive' : 'polite'}
        className="sr-only"
      >
        {analysis.urgency === 'immediate_hazard'
          ? `Hazard alert: ${analysis.immediateAlert || analysis.spokenGuidance}`
          : `Navigation update: ${analysis.spokenGuidance}. Direction: ${analysis.spatialDirection}`}
      </div>

      {/* Top Status Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-800 pb-4">
        <div className="flex items-center gap-2.5">
          <span
            className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-xl text-sm md:text-base font-black border-2 ${badge.bg}`}
          >
            {badge.icon}
            <span>{badge.label}</span>
          </span>
          {isAnalyzing && (
            <span className="text-sm text-yellow-300 animate-pulse font-extrabold uppercase">
              Scanning...
            </span>
          )}
        </div>

        <button
          onClick={() =>
            speechManager.speak(
              analysis.immediateAlert
                ? `${analysis.immediateAlert}. ${analysis.spokenGuidance}`
                : analysis.spokenGuidance,
              { isUrgent: true }
            )
          }
          aria-label="Speak current guidance aloud again"
          className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-black font-black text-xs md:text-sm rounded-xl border-2 border-white flex items-center gap-2 transition-colors"
        >
          <Volume2 className="w-4 h-4" />
          <span>READ ALOUD</span>
        </button>
      </div>

      {/* Urgent Alert Banner (if hazard or caution) */}
      {analysis.immediateAlert && (
        <div
          className={`p-5 rounded-2xl border-4 flex items-start gap-4 ${
            analysis.urgency === 'immediate_hazard'
              ? 'bg-red-950 border-red-500 text-white'
              : 'bg-amber-950 border-amber-400 text-white'
          }`}
        >
          <AlertCircle
            className={`w-9 h-9 shrink-0 mt-0.5 stroke-[2.5] ${
              analysis.urgency === 'immediate_hazard' ? 'text-red-400 animate-bounce' : 'text-amber-400'
            }`}
          />
          <div>
            <div className="text-xs md:text-sm font-black uppercase tracking-wider text-yellow-300">
              IMMEDIATE HAZARD WARNING
            </div>
            <div className={`font-black mt-1 leading-tight ${textClasses.alert}`}>
              {analysis.immediateAlert}
            </div>
          </div>
        </div>
      )}

      {/* Primary Spoken Guidance Card */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-black border-2 border-amber-400 p-5 rounded-2xl">
        <div className="p-4 bg-slate-900 border-2 border-slate-700 rounded-2xl shrink-0 flex flex-col items-center justify-center min-w-[92px]">
          {getDirectionIcon(analysis.spatialDirection)}
          <span className="text-xs font-black uppercase text-white mt-1.5 tracking-wider">
            {analysis.spatialDirection.replace('_', ' ')}
          </span>
        </div>

        <div className="flex-1">
          <div className="text-xs md:text-sm font-extrabold text-amber-300 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
            <Volume2 className="w-4 h-4 text-amber-400" />
            <span>Spoken Navigation Guidance:</span>
          </div>
          <p className={`font-black text-white leading-snug ${textClasses.guidance}`}>
            "{analysis.spokenGuidance}"
          </p>
        </div>
      </div>

      {/* Detected Hazards & Objects Grid */}
      {analysis.detectedObjects && analysis.detectedObjects.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-black text-white uppercase tracking-wider">
            Detected Obstacles & Landmarks ({analysis.detectedObjects.length}):
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {analysis.detectedObjects.map((obj, i) => {
              const isHigh = obj.hazardLevel === 'high';
              const isMed = obj.hazardLevel === 'medium';
              return (
                <div
                  key={i}
                  className={`p-4 rounded-2xl border-2 flex flex-col justify-between transition-colors ${
                    isHigh
                      ? 'bg-red-950/70 border-red-500 text-white'
                      : isMed
                      ? 'bg-amber-950/60 border-amber-400 text-white'
                      : 'bg-black border-slate-700 text-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-black text-base md:text-lg text-white">{obj.label}</span>
                    <span
                      className={`text-xs font-mono font-black uppercase px-2.5 py-1 rounded-lg border ${
                        isHigh
                          ? 'bg-red-600 text-white border-white'
                          : isMed
                          ? 'bg-amber-400 text-black border-white'
                          : 'bg-slate-800 text-slate-200 border-slate-600'
                      }`}
                    >
                      {obj.hazardLevel}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs md:text-sm text-yellow-300 font-mono font-bold">
                    <span>Dir: {obj.position}</span>
                    <span>Dist: {obj.distance}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Uncertainty Notice if applicable */}
      {analysis.uncertaintyWarning && (
        <div className="text-sm font-bold text-yellow-300 bg-black border-2 border-amber-400 p-3.5 rounded-2xl flex items-center gap-2.5">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{analysis.uncertaintyWarning}</span>
        </div>
      )}
    </section>
  );
};
