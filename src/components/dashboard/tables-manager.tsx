'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Download, Pencil, Plus, Printer, QrCode, Trash2, Users } from 'lucide-react';
import { Sheet, ConfirmDialog } from '@/components/ui/sheet';
import { Input, Switch } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { createTable, updateTable, deleteTable } from '@/app/dashboard/actions';
import { useT } from '@/i18n/provider';

export type ManagedTable = {
  id: string;
  code: string;
  name: string;
  zone: string | null;
  seats: number;
  isActive: boolean;
};

export function TablesManager({
  siteUrl,
  restaurantName,
  tables,
}: {
  siteUrl: string;
  restaurantName: string;
  tables: ManagedTable[];
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [draft, setDraft] = useState<Partial<ManagedTable> | null>(null);
  const [qrFor, setQrFor] = useState<ManagedTable | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const base = siteUrl.replace(/\/$/, '');
  const tableUrl = (code: string) => `${base}/m/${code}`;
  const qrUrl = (code: string, size = 512) =>
    `/api/qr?data=${encodeURIComponent(tableUrl(code))}&size=${size}`;

  async function submit() {
    if (!draft?.name?.trim()) {
      toast(t.common.required, 'error');
      return;
    }
    setSaving(true);

    const result = draft.id
      ? await updateTable(draft.id, {
          name: draft.name,
          zone: draft.zone ?? null,
          seats: draft.seats ?? 4,
          is_active: draft.isActive ?? true,
        })
      : await createTable({ name: draft.name, zone: draft.zone ?? null, seats: draft.seats ?? 4 });

    setSaving(false);

    if (!result.ok) {
      toast(result.error === 'PLAN_LIMIT_TABLES' ? t.dashboard.limitReached : t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    setDraft(null);
    router.refresh();
  }

  async function remove() {
    if (!confirmId) return;
    setSaving(true);
    const result = await deleteTable(confirmId);
    setSaving(false);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    setConfirmId(null);
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-ink-700">{t.dashboard.tables}</h2>
        <div className="flex gap-2">
          {tables.length > 0 && (
            <button type="button" onClick={() => window.print()} className="btn-ghost text-xs no-print">
              <Printer className="h-3.5 w-3.5" />
              {t.dashboard.printQrs}
            </button>
          )}
          <Button onClick={() => setDraft({ name: '', seats: 4, isActive: true })}>
            <Plus className="h-4 w-4" />
            {t.dashboard.newTable}
          </Button>
        </div>
      </div>

      {tables.length === 0 ? (
        <EmptyState
          icon={<QrCode className="h-7 w-7" />}
          title={t.common.empty}
          description={t.dashboard.qrHint}
          className="rounded-2xl bg-white shadow-chip"
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tables.map((table) => (
            <li
              key={table.id}
              className="print-break flex flex-col items-center rounded-2xl bg-white p-5 text-center shadow-chip"
            >
              <p className="text-[11px] font-bold uppercase tracking-wide text-ink-300">
                {restaurantName}
              </p>
              <p className="mt-0.5 font-display text-lg font-bold text-ink">{table.name}</p>

              {/* eslint-disable-next-line @next/next/no-img-element -- la ruta /api/qr genera el PNG al vuelo */}
              <img
                src={qrUrl(table.code, 320)}
                alt={`QR ${table.name}`}
                width={160}
                height={160}
                className="my-4 h-40 w-40 rounded-xl"
              />

              <p className="text-[11px] text-ink-300">{t.dashboard.qrHint}</p>

              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {table.zone && <Badge tone="neutral">{table.zone}</Badge>}
                <Badge tone="neutral">
                  <Users className="h-3 w-3" />
                  {table.seats}
                </Badge>
                {!table.isActive && <Badge tone="danger">{t.common.inactive}</Badge>}
              </div>

              <div className="mt-4 flex gap-1 no-print">
                <a
                  href={qrUrl(table.code, 1024)}
                  download={`qr-${table.code}.png`}
                  title={t.dashboard.downloadQr}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-surface-field hover:text-ink"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => setQrFor(table)}
                  title={t.dashboard.tableQr}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-surface-field hover:text-ink"
                >
                  <QrCode className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDraft(table)}
                  title={t.common.edit}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-surface-field hover:text-ink"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmId(table.id)}
                  title={t.common.delete}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-red-50 hover:text-state-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t.common.edit : t.dashboard.newTable}
        footer={
          <Button size="block" loading={saving} onClick={submit}>
            {t.common.save}
          </Button>
        }
      >
        {draft && (
          <div className="space-y-4">
            <Input
              value={draft.name ?? ''}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              label={t.common.name}
              placeholder="Mesa 7"
              required
            />
            <Input
              value={draft.zone ?? ''}
              onChange={(e) => setDraft({ ...draft, zone: e.target.value })}
              label={`Zona (${t.common.optional})`}
              placeholder="Terraza"
            />
            <Input
              type="number"
              value={draft.seats ?? 4}
              onChange={(e) => setDraft({ ...draft, seats: Number(e.target.value) })}
              label="Comensales"
              min={1}
              max={30}
            />
            {draft.id && (
              <Switch
                checked={draft.isActive ?? true}
                onChange={(v) => setDraft({ ...draft, isActive: v })}
                label={t.common.active}
              />
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={qrFor !== null} onClose={() => setQrFor(null)} title={qrFor?.name ?? ''}>
        {qrFor && (
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- PNG generado por /api/qr */}
            <img
              src={qrUrl(qrFor.code, 640)}
              alt={`QR ${qrFor.name}`}
              width={280}
              height={280}
              className="mx-auto rounded-2xl"
            />
            <code className="mt-4 block break-all rounded-xl bg-surface-field px-4 py-3 text-xs text-ink-500">
              {tableUrl(qrFor.code)}
            </code>
            <a
              href={qrUrl(qrFor.code, 1024)}
              download={`qr-${qrFor.code}.png`}
              className="btn-primary mt-4 w-full"
            >
              <Download className="h-4 w-4" />
              {t.dashboard.downloadQr}
            </a>
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
