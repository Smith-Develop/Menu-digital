'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Bell, Globe2, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { Sheet, ConfirmDialog } from '@/components/ui/sheet';
import { Input, Switch, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { saveNotification, deleteNotification } from '@/app/admin/actions';
import { ImagePicker } from '@/components/ui/image-picker';
import { useI18n } from '@/i18n/provider';
import { formatDateTime, cn } from '@/lib/utils';
import type { Enums } from '@/types/database';

type CityOption = { city: string; city_slug: string; restaurants: number };

export type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  audience: Enums<'notification_audience'>;
  cities: string[];
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
};

type Draft = Omit<NotificationRow, 'id'> & { id?: string };

function emptyDraft(): Draft {
  return {
    title: '',
    body: '',
    imageUrl: null,
    linkUrl: '',
    linkLabel: '',
    audience: 'all',
    cities: [],
    startsAt: new Date().toISOString(),
    endsAt: null,
    isActive: true,
  };
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function NotificationsManager({
  cities,
  notifications,
}: {
  cities: CityOption[];
  notifications: NotificationRow[];
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!draft?.title.trim()) {
      toast(t.common.required, 'error');
      return;
    }
    if (draft.audience === 'cities' && draft.cities.length === 0) {
      toast(t.admin.citiesRequired, 'error');
      return;
    }

    setSaving(true);
    const result = await saveNotification({
      id: draft.id,
      title: draft.title,
      body: draft.body || null,
      image_url: draft.imageUrl || null,
      link_url: draft.linkUrl || null,
      link_label: draft.linkLabel || null,
      audience: draft.audience,
      cities: draft.audience === 'cities' ? draft.cities : [],
      starts_at: draft.startsAt,
      ends_at: draft.endsAt,
      is_active: draft.isActive,
    });
    setSaving(false);

    if (!result.ok) {
      toast(result.error === 'CITIES_REQUIRED' ? t.admin.citiesRequired : t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    setDraft(null);
    router.refresh();
  }

  async function remove() {
    if (!confirmId) return;
    setSaving(true);
    const result = await deleteNotification(confirmId);
    setSaving(false);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    setConfirmId(null);
    router.refresh();
  }

  function statusOf(row: NotificationRow): { label: string; tone: 'success' | 'info' | 'neutral' } {
    const now = Date.now();
    if (!row.isActive) return { label: t.common.inactive, tone: 'neutral' };
    if (new Date(row.startsAt).getTime() > now) return { label: t.admin.scheduled, tone: 'info' };
    if (row.endsAt && new Date(row.endsAt).getTime() < now) {
      return { label: t.admin.finished, tone: 'neutral' };
    }
    return { label: t.admin.liveNow, tone: 'success' };
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setDraft(emptyDraft())}>
          <Plus className="h-4 w-4" />
          {t.admin.newNotification}
        </Button>
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-7 w-7" />}
          title={t.common.empty}
          description={t.admin.notificationsHint}
          className="rounded-2xl bg-white shadow-chip"
        />
      ) : (
        <ul className="space-y-3">
          {notifications.map((row) => {
            const status = statusOf(row);
            return (
              <li key={row.id} className="flex flex-wrap items-start gap-4 rounded-2xl bg-white p-4 shadow-chip">
                <span className="relative h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                  {row.imageUrl ? (
                    <Image src={row.imageUrl} alt="" fill sizes="96px" className="object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-ink-200">
                      <Bell className="h-5 w-5" />
                    </span>
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-base font-bold text-ink-700">{row.title}</p>
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <Badge tone={row.audience === 'all' ? 'brand' : 'neutral'}>
                      {row.audience === 'all' ? (
                        <>
                          <Globe2 className="h-3 w-3" />
                          {t.admin.audienceAll}
                        </>
                      ) : (
                        <>
                          <MapPin className="h-3 w-3" />
                          {row.cities.length}
                        </>
                      )}
                    </Badge>
                  </div>

                  {row.body && <p className="mt-1 line-clamp-2 text-sm text-ink-300">{row.body}</p>}

                  <p className="mt-1.5 text-xs text-ink-300">
                    {formatDateTime(row.startsAt, locale)}
                    {row.endsAt && ` → ${formatDateTime(row.endsAt, locale)}`}
                  </p>

                  {row.audience === 'cities' && row.cities.length > 0 && (
                    <p className="mt-1 text-xs text-ink-400">
                      {row.cities
                        .map((slug) => cities.find((c) => c.city_slug === slug)?.city ?? slug)
                        .join(' · ')}
                    </p>
                  )}
                </div>

                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setDraft({ ...row })}
                    aria-label={t.common.edit}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-surface-field hover:text-ink"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(row.id)}
                    aria-label={t.common.delete}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-red-50 hover:text-state-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t.common.edit : t.admin.newNotification}
        size="lg"
        footer={
          <Button size="block" loading={saving} onClick={submit}>
            {t.common.save}
          </Button>
        }
      >
        {draft && (
          <div className="space-y-5">
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              label={t.admin.notificationTitle}
              placeholder="Envío gratis este fin de semana"
              maxLength={80}
              required
            />
            <Textarea
              value={draft.body ?? ''}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              label={t.admin.notificationBody}
              rows={3}
              maxLength={400}
            />
            <ImagePicker
              bucket="restaurants"
              folder="notifications"
              value={draft.imageUrl}
              onChange={(url) => setDraft({ ...draft, imageUrl: url })}
              label={t.common.image}
              hint="Apaisada. Se ve encima del mensaje."
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                value={draft.linkUrl ?? ''}
                onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })}
                label={t.admin.notificationLink}
                placeholder="/search?q=pizza"
              />
              <Input
                value={draft.linkLabel ?? ''}
                onChange={(e) => setDraft({ ...draft, linkLabel: e.target.value })}
                label={t.admin.notificationLinkLabel}
                placeholder="Ver ofertas"
                maxLength={40}
              />
            </div>

            <div>
              <span className="label">{t.admin.audience}</span>
              <div className="grid grid-cols-2 gap-3">
                {(['all', 'cities'] as const).map((option) => {
                  const active = draft.audience === option;
                  const Icon = option === 'all' ? Globe2 : MapPin;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setDraft({ ...draft, audience: option })}
                      aria-pressed={active}
                      className={cn(
                        'flex items-center gap-2.5 rounded-xl border-2 px-4 py-3 text-sm font-bold transition-colors',
                        active
                          ? 'border-brand bg-brand-50 text-brand-700'
                          : 'border-transparent bg-surface-field text-ink-500 hover:bg-surface-muted',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {option === 'all' ? t.admin.audienceAll : t.admin.audienceCities}
                    </button>
                  );
                })}
              </div>
            </div>

            {draft.audience === 'cities' && (
              <div>
                <span className="label">{t.admin.selectCities}</span>
                {cities.length === 0 ? (
                  <p className="text-sm text-ink-300">{t.location.noCities}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {cities.map((city) => {
                      const active = draft.cities.includes(city.city_slug);
                      return (
                        <button
                          key={city.city_slug}
                          type="button"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              cities: active
                                ? draft.cities.filter((c) => c !== city.city_slug)
                                : [...draft.cities, city.city_slug],
                            })
                          }
                          aria-pressed={active}
                          className={cn(
                            'rounded-full px-4 py-2 text-xs font-bold transition-colors',
                            active
                              ? 'bg-brand text-brand-contrast'
                              : 'bg-surface-field text-ink-500 hover:bg-surface-muted',
                          )}
                        >
                          {city.city}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="label">{t.admin.scheduleFrom}</span>
                <input
                  type="datetime-local"
                  value={toLocalInput(draft.startsAt)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      startsAt: fromLocalInput(e.target.value) ?? new Date().toISOString(),
                    })
                  }
                  className="field"
                />
              </div>
              <div>
                <span className="label">
                  {t.admin.scheduleTo} ({t.common.optional})
                </span>
                <input
                  type="datetime-local"
                  value={toLocalInput(draft.endsAt)}
                  onChange={(e) => setDraft({ ...draft, endsAt: fromLocalInput(e.target.value) })}
                  className="field"
                />
              </div>
            </div>

            <Switch
              checked={draft.isActive}
              onChange={(v) => setDraft({ ...draft, isActive: v })}
              label={t.common.active}
            />
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={remove}
        title={t.common.delete}
        message={t.common.confirm}
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        loading={saving}
      />
    </>
  );
}
