/**
 * Avisos sonoros de la cocina.
 *
 * Los tonos se sintetizan con la Web Audio API en vez de servir archivos: son
 * secuencias de dos o tres notas, pesan cero y suenan igual en cualquier
 * dispositivo sin depender de que un mp3 haya terminado de descargarse cuando
 * entra la comanda.
 */

export type SoundId = 'bell' | 'chime' | 'ding' | 'alert' | 'soft' | 'none';

export type SoundSettings = {
  newOrder: SoundId;
  orderReady: SoundId;
  volume: number;
  enabled: boolean;
};

export const DEFAULT_SOUNDS: SoundSettings = {
  newOrder: 'bell',
  orderReady: 'chime',
  volume: 0.7,
  enabled: true,
};

/** Cada tono es una lista de [frecuencia en Hz, inicio en s, duración en s]. */
const TONES: Record<Exclude<SoundId, 'none'>, [number, number, number][]> = {
  bell: [
    [880, 0, 0.18],
    [1174, 0.16, 0.28],
  ],
  chime: [
    [660, 0, 0.16],
    [880, 0.14, 0.16],
    [1320, 0.28, 0.34],
  ],
  ding: [[1046, 0, 0.4]],
  alert: [
    [740, 0, 0.12],
    [740, 0.18, 0.12],
    [740, 0.36, 0.2],
  ],
  soft: [
    [523, 0, 0.22],
    [659, 0.2, 0.3],
  ],
};

export const SOUND_IDS: SoundId[] = ['bell', 'chime', 'ding', 'alert', 'soft', 'none'];

let context: AudioContext | null = null;

/**
 * Reproduce un aviso.
 *
 * Los navegadores no dejan sonar nada hasta que el usuario interactúa con la
 * página, así que la primera llamada puede quedarse en silencio: la pantalla de
 * cocina lo resuelve pidiendo un toque para activar el sonido.
 */
export function playSound(id: SoundId, volume = 0.7): void {
  if (id === 'none' || typeof window === 'undefined') return;

  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();

    const now = context.currentTime;
    const master = context.createGain();
    master.gain.value = Math.min(Math.max(volume, 0), 1);
    master.connect(context.destination);

    for (const [frequency, offset, duration] of TONES[id]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      gain.connect(master);

      // Ataque corto y caída exponencial: suena a campana, no a pitido.
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.9, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);

      oscillator.start(now + offset);
      oscillator.stop(now + offset + duration + 0.02);
    }
  } catch {
    // Sin audio disponible la cocina sigue funcionando, solo que en silencio.
  }
}

/** Desbloquea el audio tras el primer gesto del usuario. */
export function unlockAudio(): void {
  try {
    context ??= new AudioContext();
    void context.resume();
  } catch {
    /* el navegador no expone audio */
  }
}

/** Mezcla los ajustes guardados con los de partida. */
export function resolveSounds(
  platform: Partial<SoundSettings> | null | undefined,
  restaurant: Partial<SoundSettings> | null | undefined,
): SoundSettings {
  return { ...DEFAULT_SOUNDS, ...(platform ?? {}), ...(restaurant ?? {}) };
}
