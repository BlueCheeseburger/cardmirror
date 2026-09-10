/**
 * Voice feedback surface: a status pill showing listening state, the
 * mode as a labeled badge (command / dictation / asleep), the armed pen,
 * the last thing heard, and a live input meter; earcons for every state
 * change; a session menu (mic picker, calibrate, stop). Styled in the
 * dropzone pill's visual language (style.css under "Voice pill").
 */
import { settings } from '../settings.js';
import type { VoiceLevel, VoiceMode } from './types';

export class VoicePill {
  private el: HTMLElement;
  private echoEl: HTMLElement;
  private meterFill: HTMLElement;
  private audio: AudioContext | null = null;
  private menu: HTMLElement | null = null;
  private dismissMenu: (() => void) | null = null;
  private penEl: HTMLElement;
  private modeEl: HTMLElement;

  constructor(private hooks: { onStop?: () => void; onCalibrate?: () => void } = {}) {
    this.el = document.createElement('div');
    this.el.className = 'pmd-voice-pill';
    this.el.setAttribute('role', 'button');
    this.el.setAttribute('tabindex', '0');
    this.el.setAttribute('aria-label', 'Voice control session — opens the session menu');
    const dot = document.createElement('span');
    dot.className = 'pmd-voice-dot';
    dot.setAttribute('aria-hidden', 'true');
    this.modeEl = document.createElement('span');
    this.modeEl.className = 'pmd-voice-mode-badge';
    this.modeEl.setAttribute('aria-live', 'polite');
    this.penEl = document.createElement('span');
    this.penEl.className = 'pmd-voice-pen';
    this.echoEl = document.createElement('span');
    this.echoEl.className = 'pmd-voice-echo';
    this.echoEl.setAttribute('aria-live', 'polite');
    const meter = document.createElement('span');
    meter.className = 'pmd-voice-meter';
    meter.setAttribute('aria-hidden', 'true');
    this.meterFill = document.createElement('div');
    meter.appendChild(this.meterFill);
    this.el.append(dot, this.modeEl, this.penEl, this.echoEl, meter);
    this.el.addEventListener('click', () => this.toggleMenu());
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleMenu();
      }
    });
    document.body.appendChild(this.el);
  }

  private toggleMenu(): void {
    if (this.menu) {
      this.closeMenu();
      return;
    }
    const menu = document.createElement('div');
    menu.className = 'pmd-voice-menu';
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-label', 'Voice session: microphone, calibration, stop');

    const title = document.createElement('div');
    title.className = 'pmd-voice-menu-title';
    title.textContent = 'Microphone';
    menu.appendChild(title);

    const current = settings.get('voiceInputDeviceId');
    const group = `pmd-voice-mic-${Math.random().toString(36).slice(2, 8)}`;
    const addDevice = (value: string, label: string): void => {
      const row = document.createElement('label');
      row.className = 'pmd-voice-menu-row';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = group;
      input.checked = value === current;
      input.addEventListener('change', () => {
        if (input.checked) settings.set('voiceInputDeviceId', value);
      });
      const text = document.createElement('span');
      text.textContent = label;
      row.append(input, text);
      menu.appendChild(row);
    };
    const actions = document.createElement('div');
    actions.className = 'pmd-voice-menu-actions';
    if (this.hooks.onCalibrate) {
      const cal = document.createElement('button');
      cal.type = 'button';
      cal.className = 'pmd-voice-menu-stop pmd-voice-menu-calibrate';
      cal.textContent = 'Calibrate to my voice…';
      cal.addEventListener('click', () => {
        this.closeMenu();
        this.hooks.onCalibrate?.();
      });
      actions.appendChild(cal);
    }
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'pmd-voice-menu-stop';
    stop.textContent = 'Stop voice control';
    stop.addEventListener('click', () => {
      this.closeMenu();
      this.hooks.onStop?.();
    });
    actions.appendChild(stop);

    addDevice('', 'System default');
    menu.appendChild(actions);
    if (navigator.mediaDevices?.enumerateDevices) {
      void navigator.mediaDevices.enumerateDevices().then((devices) => {
        if (this.menu !== menu) return;
        let n = 0;
        for (const d of devices) {
          if (d.kind !== 'audioinput' || d.deviceId === 'default') continue;
          n += 1;
          addDevice(d.deviceId, d.label || `Microphone ${n}`);
        }
        menu.appendChild(actions); // keep the actions last
      });
    }

    document.body.appendChild(menu);
    this.menu = menu;
    const onDown = (e: MouseEvent): void => {
      if (!menu.contains(e.target as Node) && !this.el.contains(e.target as Node)) this.closeMenu();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') this.closeMenu();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    this.dismissMenu = () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }

  private closeMenu(): void {
    this.dismissMenu?.();
    this.dismissMenu = null;
    this.menu?.remove();
    this.menu = null;
  }

  setListening(on: boolean): void {
    this.el.classList.toggle('pmd-voice-on', on);
    if (!on) {
      this.setEcho('', true);
      this.closeMenu();
    }
  }

  setMode(mode: VoiceMode): void {
    this.el.classList.remove('pmd-voice-mode-command', 'pmd-voice-mode-dictation', 'pmd-voice-mode-asleep');
    this.el.classList.add(`pmd-voice-mode-${mode}`);
    this.modeEl.textContent = mode === 'dictation' ? 'dictating' : mode;
    const hint = mode === 'asleep' ? 'say "voice wake" to resume' : mode === 'dictation' ? 'release the key to land it' : '';
    this.setEcho(hint, true);
  }

  /** Sticky-pen badge (null = no pen armed). */
  setPen(name: string | null): void {
    this.penEl.textContent = name ? `pen: ${name}` : '';
    this.penEl.hidden = !name;
  }

  setEcho(text: string, ok: boolean): void {
    this.echoEl.textContent = text;
    this.echoEl.classList.toggle('pmd-voice-rejected', !ok);
  }

  setAutoSleepCountdown(remainingMs: number | null): void {
    this.el.classList.toggle('pmd-voice-drowsy', remainingMs !== null);
    this.el.style.setProperty('--voice-drowsy', remainingMs === null ? '1' : String(Math.max(0.35, remainingMs / 10000)));
  }

  setLevel(level: VoiceLevel): void {
    // s16 RMS: quiet room ~100–300, speech at a close mic ~2000–8000.
    const pct = Math.min(100, Math.round((level.rms / 6000) * 100));
    this.meterFill.style.width = `${pct}%`;
    this.el.classList.toggle('pmd-voice-speech', level.speech);
  }

  private beep(freq: number, ms: number, type: OscillatorType = 'sine', delayMs = 0): void {
    this.audio ??= new AudioContext();
    const t0 = this.audio.currentTime + delayMs / 1000;
    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.04, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + ms / 1000);
    osc.connect(gain).connect(this.audio.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000);
  }

  earconAccept(): void {
    this.beep(880, 70);
  }

  earconReject(): void {
    this.beep(220, 130, 'square');
  }

  earconMode(to: VoiceMode): void {
    if (to === 'asleep') {
      this.beep(520, 80);
      this.beep(330, 110, 'sine', 90);
    } else if (to === 'dictation') {
      this.beep(440, 60);
    } else {
      this.beep(330, 80);
      this.beep(660, 90, 'sine', 90);
    }
  }

  destroy(): void {
    this.closeMenu();
    this.el.remove();
    void this.audio?.close();
  }
}
