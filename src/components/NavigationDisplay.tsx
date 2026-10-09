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
  AlertCircle
} from 'lucide-react';
import { NavigationAnalysis, SpatialDirection, UrgencyLevel, TextSize } from '../types/aria';

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
        return <ArrowUp className="w-8 h-8 text-emerald-400" aria-label="Walk straight" />;
      case 'slight_left':
        return <ArrowUpLeft className="w-8 h-8 text-amber-400" aria-label="Bear slight left" />;
      case 'slight_right':
        return <ArrowUpRight className="w-8 h-8 text-amber-400" aria-label="Bear slight right" />;
      case 'stop':
        return <Octagon className="w-8 h-8 text-red-500 fill-red-500/20" aria-label="Stop immediately" />;
      case 'detour_left':
        return <CornerUpLeft className="w-8 h-8 text-amber-400" aria-label="Detour around to the left" />;
      case 'detour_right':
        return <CornerUpRight className="w-8 h-8 text-amber-400" aria-label="Detour around to the right" />;
      default:
        return <Compass className="w-8 h-8 text-slate-400" />;
    }
  };

  const getUrgencyBadge = (urgency: UrgencyLevel) => {
    switch (urgency) {
      case 'immediate_hazard':
        return {
          bg: 'bg-red-500/20 border-red-500 text-red-300',
          label: 'Immediate Hazard',
          icon: <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />,
        };
      case 'caution':
        return {
          bg: 'bg-amber-500/20 border-amber-500 text-amber-300',
          label: 'Caution Advised',
          icon: <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />,
        };
      case 'clear':
        return {
          bg: 'bg-emerald-500/20 border-emerald-500 text-emerald-300',
          label: 'Path Clear',
          icon: <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />,
        };
      case 'informational':
      default:
        return {
          bg: 'bg-sky-500/20 border-sky-500 text-sky-300',
          label: 'Navigation Milestone',
          icon: <Compass className="w-4 h-4 text-sky-400 shrink-0" />,
        };
    }
  };

  // Font size multiplier
  const textClasses = {
    normal: {
      guidance: 'text-lg md:text-xl',
      alert: 'text-base md:text-lg',
    },
    large: {
      guidance: 'text-xl md:text-2xl',
      alert: 'text-lg md:text-xl',
    },
    xlarge: {
      guidance: 'text-2xl md:text-3xl',
      alert: 'text-xl md:text-2xl',
    },
  }[textSize];

  if (!analysis) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center shadow-xl">
        <Volume2 className="w-12 h-12 text-slate-600 mx-auto mb-3 animate-pulse" />
        <h3 className="text-lg font-bold text-slate-200">Navigation Assistant Ready</h3>
        <p className="text-sm text-slate-400 max-w-md mx-auto mt-1">
          Press <strong className="text-amber-400">"Start Assistance"</strong> below or press the{' '}
          <kbd className="px-2 py-0.5 bg-slate-800 rounded font-mono text-xs">Spacebar</kbd> to ask a voice
          question.
        </p>
      </div>
    );
  }

  const badge = getUrgencyBadge(analysis.urgency);

  return (
    <section
      aria-label="Current Navigation Guidance"
      className="flex flex-col gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-2xl relative overflow-hidden"
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
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${badge.bg}`}>
            {badge.icon}
            <span>{badge.label}</span>
          </span>
          {isAnalyzing && (
            <span className="text-xs text-amber-400 animate-pulse font-medium">Scanning live frame...</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
          <span>Direction:</span>
          <span className="font-bold text-slate-200 uppercase">{analysis.spatialDirection.replace('_', ' ')}</span>
        </div>
      </div>

      {/* Urgent Alert Banner (if hazard or caution) */}
      {analysis.immediateAlert && (
        <div
          className={`p-4 rounded-xl border flex items-start gap-3 ${
            analysis.urgency === 'immediate_hazard'
              ? 'bg-red-950/80 border-red-500 text-red-100'
              : 'bg-amber-950/80 border-amber-500 text-amber-100'
          }`}
        >
          <AlertCircle
            className={`w-6 h-6 shrink-0 mt-0.5 ${
              analysis.urgency === 'immediate_hazard' ? 'text-red-400 animate-bounce' : 'text-amber-400'
            }`}
          />
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-300">
              Immediate Hazard Notice
            </div>
            <div className={`font-bold mt-0.5 ${textClasses.alert}`}>{analysis.immediateAlert}</div>
          </div>
        </div>
      )}

      {/* Primary Spoken Guidance Card */}
      <div className="flex items-center gap-4 bg-slate-950/70 border border-slate-800 p-5 rounded-2xl">
        <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl shrink-0 flex items-center justify-center">
          {getDirectionIcon(analysis.spatialDirection)}
        </div>

        <div className="flex-1">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-1">
            <Volume2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Spoken Navigation Guidance:</span>
          </div>
          <p className={`font-semibold text-white leading-relaxed ${textClasses.guidance}`}>
            "{analysis.spokenGuidance}"
          </p>
        </div>
      </div>

      {/* Detected Hazards & Objects Grid */}
      {analysis.detectedObjects && analysis.detectedObjects.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Detected Objects & Relative Position ({analysis.detectedObjects.length}):
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {analysis.detectedObjects.map((obj, i) => {
              const isHigh = obj.hazardLevel === 'high';
              const isMed = obj.hazardLevel === 'medium';
              return (
                <div
                  key={i}
                  className={`p-3 rounded-xl border flex flex-col justify-between text-xs transition-colors ${
                    isHigh
                      ? 'bg-red-950/40 border-red-700/80 text-red-200'
                      : isMed
                      ? 'bg-amber-950/30 border-amber-700/60 text-amber-200'
                      : 'bg-slate-950/50 border-slate-800 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm text-white">{obj.label}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                        isHigh
                          ? 'bg-red-900 text-red-200'
                          : isMed
                          ? 'bg-amber-900 text-amber-200'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {obj.hazardLevel} hazard
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 font-mono">
                    <span>Pos: {obj.position}</span>
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
        <div className="text-xs text-amber-400/90 bg-amber-950/30 border border-amber-900/50 p-2.5 rounded-xl flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{analysis.uncertaintyWarning}</span>
        </div>
      )}
    </section>
  );
};
