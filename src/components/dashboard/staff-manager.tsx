'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Info, Trash2, UserRound } from 'lucide-react';
import { Select } from '@/components/ui/input';
import { Badge, EmptyState } from '@/components/ui/misc';
import { ConfirmDialog } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { updateStaffRole, setStaffActive, removeStaff } from '@/app/dashboard/actions';
import { useT } from '@/i18n/provider';
import { STAFF_ROLES, staffRoleLabel } from '@/lib/staff-roles';
import { initials } from '@/lib/utils';
import type { Enums } from '@/types/database';

type Member = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  role: Enums<'staff_role'>;
  isActive: boolean;
};

export function StaffManager({
  currentUserId,
  ownerId,
  members,
}: {
  currentUserId: string;
  ownerId: string | null;
  members: Member[];
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function changeRole(member: Member, role: Enums<'staff_role'>) {
    const result = await updateStaffRole(member.id, role);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    router.refresh();
  }

  async function toggleActive(member: Member) {
    const result = await setStaffActive(member.id, !member.isActive);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    router.refresh();
  }

  async function remove() {
    if (!confirmId) return;
    setSaving(true);
    const result = await removeStaff(confirmId);
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
      <div className="flex items-start gap-3 rounded-2xl bg-blue-50 p-4 text-sm text-blue-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Para añadir a alguien al equipo, pídele que cree su cuenta en{' '}
          <span className="font-bold">/register</span> y luego dinos su correo: aparecerá aquí en
          cuanto le asignes un rol desde la ficha del restaurante en Superadministración.
        </p>
      </div>

      {members.length === 0 ? (
        <EmptyState
          icon={<UserRound className="h-7 w-7" />}
          title={t.common.empty}
          className="rounded-2xl bg-white shadow-chip"
        />
      ) : (
        <ul className="space-y-3">
          {members.map((member) => {
            const isOwner = member.userId === ownerId;
            const isSelf = member.userId === currentUserId;

            return (
              <li
                key={member.id}
                className="flex flex-wrap items-center gap-4 rounded-2xl bg-white p-4 shadow-chip"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
                  {initials(member.name)}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink-700">
                    {member.name}
                    {isSelf && <span className="ml-2 text-xs font-normal text-ink-300">(tú)</span>}
                  </p>
                  <p className="truncate text-xs text-ink-300">{member.email}</p>
                </div>

                {!member.isActive && <Badge tone="neutral">{t.common.inactive}</Badge>}

                <Select
                  value={member.role}
                  onChange={(e) => changeRole(member, e.target.value as Enums<'staff_role'>)}
                  disabled={isOwner}
                  className="w-44 py-2.5 text-sm"
                  aria-label={t.common.status}
                >
                  {STAFF_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {staffRoleLabel(role, t)}
                    </option>
                  ))}
                </Select>

                {!isOwner && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => toggleActive(member)}
                      className="rounded-lg px-3 py-2 text-xs font-bold text-ink-400 transition-colors hover:bg-surface-field hover:text-ink"
                    >
                      {member.isActive ? t.admin.suspend : t.admin.activate}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(member.id)}
                      aria-label={t.common.delete}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-red-50 hover:text-state-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

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
