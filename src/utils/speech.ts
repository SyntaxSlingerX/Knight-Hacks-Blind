/**
 * Web Speech Synthesis Manager with Hazard Preemption & Priority Queue
 */

import { UserVoiceSettings } from '../types/aria';
import { soundEffects } from './audio';

export interface SpeakOptions {
  isUrgent?: boolean;
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
}

class SpeechManager {
  private synth: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  public settings: UserVoiceSettings = {
    rate: 1.15,
    pitch: 1.0,
    volume: 1.0,
    soundEffectsEnabled: true,
  };
  private isSpeaking: boolean = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private speechQueue: { text: string; options: SpeakOptions }[] = [];

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
      this.loadVoices();
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => this.loadVoices();
      }
    }
  }

  private loadVoices(): void {
    if (!this.synth) return;
    this.voices = this.synth.getVoices();
  }

  public getVoices(): SpeechSynthesisVoice[] {
    if (!this.voices.length && this.synth) {
      this.voices = this.synth.getVoices();
    }
    return this.voices;
  }

  public stop(): void {
    if (!this.synth) return;
    this.speechQueue = [];
    this.synth.cancel();
    this.isSpeaking = false;
  }

  /**
   * Speak text with priority support.
   * If isUrgent is true: cancels anything speaking immediately and cuts in!
   */
  public speak(text: string, options: SpeakOptions = {}): void {
    if (!this.synth || !text.trim()) return;

    if (options.isUrgent) {
      // Urgent alerts preempt everything!
      this.speechQueue = [];
      this.synth.cancel();

      // Play hazard earcon immediately
      if (this.settings.soundEffectsEnabled) {
        soundEffects.playHazardAlarm();
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = Math.max(1.1, (options.rate || this.settings.rate) * 1.1); // Slightly faster for urgent
      utterance.pitch = (options.pitch || this.settings.pitch) * 1.1; // Slightly sharper pitch
      utterance.volume = this.settings.volume;

      const voice = this.selectPreferredVoice();
      if (voice) utterance.voice = voice;

      utterance.onend = () => {
        this.isSpeaking = false;
        options.onEnd?.();
        this.processQueue();
      };

      utterance.onerror = (e) => {
        console.warn('Speech synthesis error:', e);
        this.isSpeaking = false;
        this.processQueue();
      };

      this.currentUtterance = utterance;
      this.isSpeaking = true;
      this.synth.speak(utterance);
      return;
    }

    // Non-urgent: if already speaking, queue or replace if duplicate
    if (this.isSpeaking) {
      // Don't accumulate more than 2 items in queue to avoid lag
      if (this.speechQueue.length > 1) {
        this.speechQueue.shift();
      }
      this.speechQueue.push({ text, options });
      return;
    }

    this.executeSpeak(text, options);
  }

  private executeSpeak(text: string, options: SpeakOptions): void {
    if (!this.synth) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate || this.settings.rate;
    utterance.pitch = options.pitch || this.settings.pitch;
    utterance.volume = this.settings.volume;

    const voice = this.selectPreferredVoice();
    if (voice) utterance.voice = voice;

    utterance.onend = () => {
      this.isSpeaking = false;
      options.onEnd?.();
      this.processQueue();
    };

    utterance.onerror = () => {
      this.isSpeaking = false;
      this.processQueue();
    };

    this.currentUtterance = utterance;
    this.isSpeaking = true;
    this.synth.speak(utterance);
  }

  private processQueue(): void {
    if (this.speechQueue.length > 0) {
      const next = this.speechQueue.shift();
      if (next) {
        this.executeSpeak(next.text, next.options);
      }
    }
  }

  private selectPreferredVoice(): SpeechSynthesisVoice | undefined {
    if (!this.voices.length) this.loadVoices();
    if (this.settings.voiceURI) {
      const found = this.voices.find((v) => v.voiceURI === this.settings.voiceURI);
      if (found) return found;
    }

    // Prefer high quality English voices (Google, Samantha, Daniel, Natural)
    const preferredNames = ['Google UK English Female', 'Google US English', 'Samantha', 'Daniel', 'Karen', 'Victoria'];
    for (const name of preferredNames) {
      const v = this.voices.find((voice) => voice.name.includes(name));
      if (v) return v;
    }

    return this.voices.find((v) => v.lang.startsWith('en')) || this.voices[0];
  }

  public updateSettings(newSettings: Partial<UserVoiceSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    soundEffects.enabled = this.settings.soundEffectsEnabled;
  }
}

export const speechManager = new SpeechManager();
