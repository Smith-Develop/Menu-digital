'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Bike, KeyRound, Pencil, Search, Star } from 'lucide-react';
import { Input, Select, Switch } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { updateCourier, sendPasswordReset } from '@/app/admin/actions';
import { useT } from '@/i18n/provider';
import { VEHICLES } from '@/lib/courier-vehicles';
import { cn, initials } from '@/lib/utils';

type Courier = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  avatar: string | null;
  phone: string | null;
  vehicle: string | null;
  status: string;
  isActive: boolean;
  deliveries: number;
  rating: number | null;
  city: string | null;
  restaurants: string[];
};

export function CouriersAdmin({ couriers }: { couriers: Courier[] }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Courier | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', vehicle: '', active: true });
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const term = query.trim().toLowerCase();
  const visible = term
    ? couriers.filter((c) =>
        [c.name, c.email, c.phone, c.city].some((v) => v?.toLowerCase().includes(term)),
      )
    : couriers;

  function open(courier: Courier) {
    setEditing(courier);
    setForm({
      name: courier.name,
      email: courier.email ?? '',
      phone: courier.phone ?? '',
      vehicle: courier.vehicle ?? '',
      active: courier.isActive,
    });
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    const result = await updateCourier(editing.userId, {
      fullName: form.name,
      email: form.email,
      phone: form.phone,
      vehicle: form.vehicle || null,
      isActive: form.active,
    });
    setSaving(false);
    if (result.ok) {
      toast(t.courier.courierSaved, 'success');
      setEditing(null);
      router.refresh();
    } else {
      toast(result.error ?? t.common.error, 'error');
    }
  }

  async function sendReset() {
    if (!form.email.trim()) return;
    setResetting(true);
    const result = await sendPasswordReset(form.email.trim());
    setResetting(false);
    toast(result.ok ? t.team.resetSent : result.error ?? t.common.error, result.ok ? 'success' : 'error');
  }

  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.common.search}
          className="field w-full pl-10"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={<Bike className="h-6 w-6" />} title={t.courier.noCouriers} />
      ) : (
        <ul className="space-y-3">
          {visible.map((courier) => (
            <li
              key={courier.id}
              className="flex flex-wrap items-center gap-4 rounded-2xl bg-white p-4 shadow-chip"
            >
              {courier.avatar ? (
                <Image
                  src={courier.avatar}
                  alt=""
                  width={44}
                  height={44}
                  className="h-11 w-11 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
                  {initials(courier.name)}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink-700">{courier.name}</p>
                <p className="truncate text-xs text-ink-300">
                  {courier.email}
                  {courier.phone ? ` · ${courier.phone}` : ''}
                </p>
                {courier.restaurants.length > 0 && (
                  <p className="mt-0.5 truncate text-[11px] text-ink-300">
                    {courier.restaurants.join(' · ')}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-ink-400">
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3.5 w-3.5" />
                  {courier.rating?.toFixed(1) ?? '—'}
                </span>
                <span>{courier.deliveries}</span>
              </div>

              <Badge tone={courier.isActive ? 'success' : 'neutral'}>
                {courier.isActive ? t.common.active : t.common.inactive}
              </Badge>

              <button
                type="button"
                onClick={() => open(courier)}
                aria-label={t.common.edit}
                title={t.common.edit}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-surface-field hover:text-ink"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t.courier.editCourier}
        footer={
          <Button size="block" loading={saving} onClick={save} disabled={!form.name.trim()}>
            {t.common.save}
          </Button>
        }
      >
        <div className="space-y-4">
          <Input
            label={t.common.name}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label={t.auth.email}
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            hint={t.team.emailChangeHint}
          />
          <Input
            label={t.auth.phone}
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <Select
            label={t.courier.vehicle}
            value={form.vehicle}
            onChange={(e) => setForm((f) => ({ ...f, vehicle: e.target.value }))}
          >
            <option value="">—</option>
            {VEHICLES.map((vehicle) => (
              <option key={vehicle} value={vehicle}>
                {t.courier[vehicle]}
              </option>
            ))}
          </Select>
          <Switch
            checked={form.active}
            onChange={(active) => setForm((f) => ({ ...f, active }))}
            label={t.common.active}
          />
          <button
            type="button"
            onClick={sendReset}
            disabled={resetting || !form.email.trim()}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-xl border border-line py-3 text-sm font-bold text-ink-700 transition-colors',
              'hover:bg-surface-field disabled:opacity-40',
            )}
          >
            <KeyRound className="h-4 w-4" />
            {t.team.sendReset}
          </button>
        </div>
      </Sheet>
    </>
  );
}
