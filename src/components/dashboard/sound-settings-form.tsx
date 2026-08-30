'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Play, Volume2 } from 'lucide-react';
import { Select, Switch } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { playSound, unlockAudio, SOUND_IDS, type SoundId, type SoundSettings } from '@/lib/sounds';
import { useT } from '@/i18n/provider';

/**
 * Ajuste de los avisos sonoros.
 *
 * El mismo formulario sirve a la plataforma y a cada restaurante: `inherited`
 * indica que este local todavía usa los tonos de la plataforma, y al desactivar
 * esa casilla pasa a tener los suyos.
 */
const SOUND_LABEL = (t: ReturnType<typeof useT>) => ({
  newOrder: t.kitchen.newOrderSound,
  orderReady: t.kitchen.orderReadySound,
  waiterCall: t.kitchen.waiterCallSound,
});

export function SoundSettingsForm({
  initial,
  inherited,
  allowInherit,
  onSave,
}: {
  initial: SoundSettings;
  inherited: boolean;
  allowInherit: boolean;
  onSave: (value: SoundSettings | null) => Promise<{ ok: boolean }>;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [useOwn, setUseOwn] = useState(!inherited);
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);

  const LABELS: Record<SoundId, string> = {
    bell: t.kitchen.soundBell,
    chime: t.kitchen.soundChime,
    ding: t.kitchen.soundDing,
    alert: t.kitchen.soundAlert,
    soft: t.kitchen.soundSoft,
    none: t.kitchen.soundNone,
  };

  function preview(id: SoundId) {
    unlockAudio();
    playSound(id, values.volume);
  }

  async function save() {
    setSaving(true);
    const result = await onSave(allowInherit && !useOwn ? null : values);
    setSaving(false);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    router.refresh();
  }

  const disabled = allowInherit && !useOwn;

  return (
    <section className="space-y-5 rounded-2xl bg-white p-6 shadow-chip">
      <div>
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-700">
          <Volume2 className="h-4 w-4 text-brand" />
          {t.kitchen.sounds}
        </h2>
        <p className="mt-1 text-sm text-ink-300">{t.kitchen.soundsHint}</p>
      </div>

      {allowInherit && (
        <div className="rounded-xl bg-surface-field p-4">
          <Switch
            checked={!useOwn}
            onChange={(v) => setUseOwn(!v)}
            label={t.kitchen.usePlatformSounds}
          />
        </div>
      )}

      <div className={disabled ? 'pointer-events-none opacity-50' : undefined}>
        <div className="space-y-4">
          <Switch
            checked={values.enabled}
            onChange={(v) => setValues({ ...values, enabled: v })}
            label={t.common.active}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            {(['newOrder', 'orderReady', 'waiterCall'] as const).map((key) => (
              <div key={key}>
                <span className="label">{SOUND_LABEL(t)[key]}</span>
                <div className="flex gap-2">
                  <Select
                    value={values[key]}
                    onChange={(e) => setValues({ ...values, [key]: e.target.value as SoundId })}
                    className="flex-1"
                    aria-label={SOUND_LABEL(t)[key]}
                  >
                    {SOUND_IDS.map((id) => (
                      <option key={id} value={id}>
                        {LABELS[id]}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    onClick={() => preview(values[key])}
                    aria-label={t.kitchen.testSound}
                    title={t.kitchen.testSound}
                    className="btn-ghost shrink-0 px-4"
                  >
                    <Play className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div>
            <span className="label">
              {t.kitchen.volume} · {Math.round(values.volume * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={values.volume}
              onChange={(e) => setValues({ ...values, volume: Number(e.target.value) })}
              onMouseUp={() => preview(values.newOrder)}
              className="w-full accent-brand"
              aria-label={t.kitchen.volume}
            />
          </div>
        </div>
      </div>

      <Button type="button" onClick={save} loading={saving}>
        {t.common.save}
      </Button>
    </section>
  );
}
