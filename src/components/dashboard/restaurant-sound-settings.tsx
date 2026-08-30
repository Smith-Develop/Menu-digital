'use client';

import { SoundSettingsForm } from '@/components/dashboard/sound-settings-form';
import { updateSoundSettings } from '@/app/dashboard/actions';
import type { SoundSettings } from '@/lib/sounds';

/** Envoltorio que ata el formulario de sonidos a la acción del restaurante. */
export function RestaurantSoundSettings({
  initial,
  inherited,
}: {
  initial: SoundSettings;
  inherited: boolean;
}) {
  return (
    <SoundSettingsForm
      initial={initial}
      inherited={inherited}
      allowInherit
      onSave={async (value) => updateSoundSettings(value)}
    />
  );
}
