'use client';

import { SoundSettingsForm } from '@/components/dashboard/sound-settings-form';
import { updatePlatformSounds } from '@/app/admin/actions';
import type { SoundSettings } from '@/lib/sounds';

/** Sonidos por defecto de la plataforma; cada restaurante puede cambiarlos. */
export function PlatformSoundSettings({ initial }: { initial: SoundSettings }) {
  return (
    <SoundSettingsForm
      initial={initial}
      inherited={false}
      allowInherit={false}
      onSave={async (value) => (value ? updatePlatformSounds(value) : { ok: true })}
    />
  );
}
