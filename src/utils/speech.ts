/**
 * Web Speech Synthesis Manager with Hazard Preemption & Priority Queue
 */

import { UserVoiceSettings } from '../types/aria';
import { soundEffects } from './audio';

export interface SpeakOptions {
  /** Hazard warning: cuts in immediately, slightly faster and sharper voice. */
  isUrgent?: boolean;
  /** Cut in immediately with the normal voice (e.g. answering the user's question). */
  interrupt?: boolean;
  rate?: number;
  pitch?: number;
  /** Called when this utterance finishes, errors, or is cancelled. */
  onEnd?: () => void;
}

// Chrome sometimes never fires onend; never let a stuck utterance block speech forever.
const MAX_UTTERANCE_MS = 15000;

class SpeechManager {
  private synth: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  public settings: UserVoiceSettings = {
    rate: 1.15,
    pitch: 1.0,
    volume: 1.0,
    soundEffectsEnabled: true,
  };
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentOnEnd: (() => void) | undefined;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
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

  public isSpeaking(): boolean {
    return this.currentUtterance !== null;
  }

  public stop(): void {
    if (!this.synth) return;
    this.speechQueue = [];
    this.finishCurrent();
    this.synth.cancel();
  }

  /**
   * Speak text with priority support.
   * isUrgent / interrupt: cancel anything speaking and cut in immediately.
   * Otherwise: queue behind the current utterance (keeping only the newest couple of items).
   */
  public speak(text: string, options: SpeakOptions = {}): void {
    if (!this.synth || !text.trim()) return;

    if (options.isUrgent || options.interrupt) {
      this.speechQueue = [];
      this.finishCurrent();
      this.synth.cancel();
      this.executeSpeak(text, options);
      return;
    }

    if (this.currentUtterance) {
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
    const rate = options.rate || this.settings.rate;
    const pitch = options.pitch || this.settings.pitch;
    utterance.rate = options.isUrgent ? Math.max(1.1, rate * 1.1) : rate; // Slightly faster for urgent
    utterance.pitch = options.isUrgent ? pitch * 1.1 : pitch; // Slightly sharper pitch
    utterance.volume = this.settings.volume;

    const voice = this.selectPreferredVoice();
    if (voice) utterance.voice = voice;

    const done = () => {
      // Ignore late events from an utterance that was already cancelled or replaced
      if (this.currentUtterance !== utterance) return;
      this.finishCurrent();
      this.processQueue();
    };
    utterance.onend = done;
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.warn('Speech synthesis error:', e.error);
      }
      done();
    };

    this.currentUtterance = utterance;
    this.currentOnEnd = options.onEnd;
    this.watchdog = setTimeout(done, MAX_UTTERANCE_MS);
    this.synth.speak(utterance);
  }

  private finishCurrent(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    const onEnd = this.currentOnEnd;
    this.currentUtterance = null;
    this.currentOnEnd = undefined;
    onEnd?.();
  }

  private processQueue(): void {
    const next = this.speechQueue.shift();
    if (next) {
      this.executeSpeak(next.text, next.options);
    }
  }

  private selectPreferredVoice(): SpeechSynthesisVoice | undefined {
    if (!this.voices.length) this.loadVoices();
    if (this.settings.voiceURI) {
      const found = this.voices.find((v) => v.voiceURI === this.settings.voiceURI);
      if (found) return found;
    }

    // Prefer voices installed on the device: Chrome's "Google ..." voices stream over the
    // network and can take a second or more to start talking
    const english = this.voices.filter((v) => v.lang.startsWith('en'));
    const local = english.filter((v) => v.localService);
    const preferredNames = ['Samantha', 'Daniel', 'Karen', 'Victoria', 'Google US English', 'Google UK English Female'];
    for (const pool of [local, english]) {
      for (const name of preferredNames) {
        const v = pool.find((voice) => voice.name.includes(name));
        if (v) return v;
      }
    }

    return local[0] || english[0] || this.voices[0];
  }

  public updateSettings(newSettings: Partial<UserVoiceSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    soundEffects.enabled = this.settings.soundEffectsEnabled;
  }
}

export const speechManager = new SpeechManager();
