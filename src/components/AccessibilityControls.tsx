import React from 'react';
import { Sliders, Volume2, Type, Eye, Keyboard, Bell } from 'lucide-react';
import { UserVoiceSettings, ThemeMode, TextSize } from '../types/aria';
import { speechManager } from '../utils/speech';

interface AccessibilityControlsProps {
  voiceSettings: UserVoiceSettings;
  onVoiceSettingsChange: (settings: Partial<UserVoiceSettings>) => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  textSize: TextSize;
  onTextSizeChange: (size: TextSize) => void;
}

export const AccessibilityControls: React.FC<AccessibilityControlsProps> = ({
  voiceSettings,
  onVoiceSettingsChange,
  themeMode,
  onThemeModeChange,
  textSize,
  onTextSizeChange,
}) => {
  const rates = [1.0, 1.2, 1.4, 1.6, 2.0];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl flex flex-col gap-5">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Sliders className="w-5 h-5 text-amber-400" />
          <h3 className="text-base font-bold text-white">Accessibility & Speech Controls</h3>
        </div>
        <span className="text-xs text-slate-400 font-mono">WCAG AAA Compliance</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Speech Rate */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Speech Rate ({voiceSettings.rate}x):</span>
          </label>
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            {rates.map((r) => (
              <button
                key={r}
                onClick={() => {
                  onVoiceSettingsChange({ rate: r });
                  speechManager.updateSettings({ rate: r });
                  speechManager.speak(`Speech speed ${r}x`);
                }}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                  voiceSettings.rate === r
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {r}x
              </button>
            ))}
          </div>
        </div>

        {/* 2. High Contrast Theme */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5 text-amber-400" />
            <span>Visual Contrast:</span>
          </label>
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => onThemeModeChange('standard-dark')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                themeMode === 'standard-dark'
                  ? 'bg-amber-400 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Dark
            </button>
            <button
              onClick={() => onThemeModeChange('ultra-contrast-yellow')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                themeMode === 'ultra-contrast-yellow'
                  ? 'bg-yellow-300 text-black font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Yellow
            </button>
            <button
              onClick={() => onThemeModeChange('high-contrast-cyan')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                themeMode === 'high-contrast-cyan'
                  ? 'bg-cyan-400 text-black font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Cyan
            </button>
          </div>
        </div>

        {/* 3. Text Size */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
            <Type className="w-3.5 h-3.5 text-amber-400" />
            <span>Guidance Text Size:</span>
          </label>
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            {(['normal', 'large', 'xlarge'] as TextSize[]).map((size) => (
              <button
                key={size}
                onClick={() => onTextSizeChange(size)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors capitalize ${
                  textSize === size
                    ? 'bg-amber-400 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        {/* 4. Audio Earcons Toggle */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5 text-amber-400" />
            <span>Hazard Audio Earcons:</span>
          </label>
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => {
                const next = !voiceSettings.soundEffectsEnabled;
                onVoiceSettingsChange({ soundEffectsEnabled: next });
                speechManager.updateSettings({ soundEffectsEnabled: next });
              }}
              className={`w-full py-1.5 text-xs font-bold rounded-lg transition-colors ${
                voiceSettings.soundEffectsEnabled
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {voiceSettings.soundEffectsEnabled ? 'Sound Cues Enabled' : 'Muted'}
            </button>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts Strip */}
      <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
        <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
          <Keyboard className="w-4 h-4 text-amber-400" />
          <span>Accessibility Hotkeys:</span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono">
          <span><kbd className="px-1.5 py-0.5 bg-slate-800 text-amber-300 rounded">Space</kbd> Ask Question</span>
          <span><kbd className="px-1.5 py-0.5 bg-slate-800 text-amber-300 rounded">S</kbd> Start/Stop</span>
          <span><kbd className="px-1.5 py-0.5 bg-slate-800 text-amber-300 rounded">Enter</kbd> Scan Now</span>
          <span><kbd className="px-1.5 py-0.5 bg-slate-800 text-amber-300 rounded">H</kbd> High Contrast</span>
        </div>
      </div>
    </div>
  );
};
