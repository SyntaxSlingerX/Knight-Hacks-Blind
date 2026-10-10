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
  const rates = [1.0, 1.2, 1.5, 1.8, 2.0];

  return (
    <div className="bg-slate-950 border-2 border-slate-700 rounded-3xl p-5 md:p-7 shadow-2xl flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-800 pb-4">
        <div className="flex items-center gap-2.5">
          <Sliders className="w-6 h-6 text-amber-400" />
          <h2 className="text-lg md:text-2xl font-black text-white uppercase tracking-wide">
            Low-Vision & Audio Settings
          </h2>
        </div>
        <span className="text-xs md:text-sm text-black bg-amber-400 font-black px-3 py-1 rounded-lg uppercase">
          WCAG AAA High-Contrast
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* 1. Speech Rate */}
        <div className="space-y-2.5">
          <label className="text-sm font-black text-white uppercase tracking-wide flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-amber-400" />
            <span>Voice Speed ({voiceSettings.rate}x):</span>
          </label>
          <div className="flex items-center gap-1.5 bg-black p-1.5 rounded-2xl border-2 border-slate-700">
            {rates.map((r) => (
              <button
                key={r}
                onClick={() => {
                  onVoiceSettingsChange({ rate: r });
                  speechManager.updateSettings({ rate: r });
                  speechManager.speak(`Speech speed ${r}x`);
                }}
                aria-pressed={voiceSettings.rate === r}
                className={`flex-1 min-h-[48px] py-2 text-sm font-black rounded-xl transition-colors ${
                  voiceSettings.rate === r
                    ? 'bg-amber-400 text-black border-2 border-white'
                    : 'text-white hover:bg-slate-900'
                }`}
              >
                {r}x
              </button>
            ))}
          </div>
        </div>

        {/* 2. High Contrast Theme */}
        <div className="space-y-2.5">
          <label className="text-sm font-black text-white uppercase tracking-wide flex items-center gap-2">
            <Eye className="w-5 h-5 text-amber-400" />
            <span>Color Contrast Mode:</span>
          </label>
          <div className="flex items-center gap-1.5 bg-black p-1.5 rounded-2xl border-2 border-slate-700">
            <button
              onClick={() => {
                onThemeModeChange('standard-dark');
                speechManager.speak('High contrast dark mode');
              }}
              aria-pressed={themeMode === 'standard-dark'}
              className={`flex-1 min-h-[48px] py-2 text-sm font-black rounded-xl transition-colors ${
                themeMode === 'standard-dark'
                  ? 'bg-amber-400 text-black border-2 border-white'
                  : 'text-white hover:bg-slate-900'
              }`}
            >
              Dark
            </button>
            <button
              onClick={() => {
                onThemeModeChange('ultra-contrast-yellow');
                speechManager.speak('Ultra contrast yellow on black mode');
              }}
              aria-pressed={themeMode === 'ultra-contrast-yellow'}
              className={`flex-1 min-h-[48px] py-2 text-sm font-black rounded-xl transition-colors ${
                themeMode === 'ultra-contrast-yellow'
                  ? 'bg-yellow-300 text-black border-2 border-white'
                  : 'text-yellow-300 hover:bg-slate-900'
              }`}
            >
              Yellow
            </button>
            <button
              onClick={() => {
                onThemeModeChange('high-contrast-cyan');
                speechManager.speak('High contrast cyan on black mode');
              }}
              aria-pressed={themeMode === 'high-contrast-cyan'}
              className={`flex-1 min-h-[48px] py-2 text-sm font-black rounded-xl transition-colors ${
                themeMode === 'high-contrast-cyan'
                  ? 'bg-cyan-300 text-black border-2 border-white'
                  : 'text-cyan-300 hover:bg-slate-900'
              }`}
            >
              Cyan
            </button>
          </div>
        </div>

        {/* 3. Text Size */}
        <div className="space-y-2.5">
          <label className="text-sm font-black text-white uppercase tracking-wide flex items-center gap-2">
            <Type className="w-5 h-5 text-amber-400" />
            <span>Display Text Size:</span>
          </label>
          <div className="flex items-center gap-1.5 bg-black p-1.5 rounded-2xl border-2 border-slate-700">
            {(
              [
                { id: 'normal', label: 'Std' },
                { id: 'large', label: 'Large' },
                { id: 'xlarge', label: 'Extra Large' },
              ] as { id: TextSize; label: string }[]
            ).map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  onTextSizeChange(item.id);
                  speechManager.speak(`Text size ${item.label}`);
                }}
                aria-pressed={textSize === item.id}
                className={`flex-1 min-h-[48px] py-2 text-sm font-black rounded-xl transition-colors ${
                  textSize === item.id
                    ? 'bg-amber-400 text-black border-2 border-white'
                    : 'text-white hover:bg-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* 4. Audio Earcons Toggle */}
        <div className="space-y-2.5">
          <label className="text-sm font-black text-white uppercase tracking-wide flex items-center gap-2">
            <Bell className="w-5 h-5 text-amber-400" />
            <span>Hazard Audio Cues:</span>
          </label>
          <div className="flex items-center bg-black p-1.5 rounded-2xl border-2 border-slate-700">
            <button
              onClick={() => {
                const next = !voiceSettings.soundEffectsEnabled;
                onVoiceSettingsChange({ soundEffectsEnabled: next });
                speechManager.updateSettings({ soundEffectsEnabled: next });
                speechManager.speak(next ? 'Hazard sound effects enabled' : 'Hazard sound effects muted');
              }}
              aria-pressed={voiceSettings.soundEffectsEnabled}
              className={`w-full min-h-[48px] py-2 text-sm font-black rounded-xl transition-colors border-2 ${
                voiceSettings.soundEffectsEnabled
                  ? 'bg-emerald-400 text-black border-white'
                  : 'bg-slate-900 text-slate-300 border-slate-700'
              }`}
            >
              {voiceSettings.soundEffectsEnabled ? 'EARCONS ON (ACTIVE)' : 'EARCONS OFF'}
            </button>
          </div>
        </div>
      </div>

      {/* Prominent Keyboard Shortcuts Strip */}
      <div className="bg-black p-4 md:p-5 rounded-2xl border-2 border-slate-700 flex flex-wrap items-center justify-between gap-4 text-sm text-white">
        <div className="flex items-center gap-2 text-amber-300 font-black uppercase tracking-wide">
          <Keyboard className="w-5 h-5" />
          <span>Blind & Low-Vision Keyboard Shortcuts:</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 md:gap-5 text-xs md:text-sm font-mono font-bold">
          <span>
            <kbd className="px-2.5 py-1 bg-amber-400 text-black font-black rounded-lg border border-white">
              Spacebar
            </kbd>{' '}
            Speak Question
          </span>
          <span>
            <kbd className="px-2.5 py-1 bg-amber-400 text-black font-black rounded-lg border border-white">
              1–6
            </kbd>{' '}
            Quick Voice Queries
          </span>
          <span>
            <kbd className="px-2.5 py-1 bg-slate-800 text-yellow-300 font-black rounded-lg border border-slate-600">
              S
            </kbd>{' '}
            Start/Stop
          </span>
          <span>
            <kbd className="px-2.5 py-1 bg-slate-800 text-yellow-300 font-black rounded-lg border border-slate-600">
              Enter
            </kbd>{' '}
            Scan Scene
          </span>
          <span>
            <kbd className="px-2.5 py-1 bg-slate-800 text-yellow-300 font-black rounded-lg border border-slate-600">
              H
            </kbd>{' '}
            High Contrast
          </span>
          <span>
            <kbd className="px-2.5 py-1 bg-slate-800 text-yellow-300 font-black rounded-lg border border-slate-600">
              Esc
            </kbd>{' '}
            Silence Audio
          </span>
        </div>
      </div>
    </div>
  );
};
