'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Copy, Link2, MailPlus, Trash2, UserRound } from 'lucide-react';
import { Input, Select, Switch } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { Badge, EmptyState } from '@/components/ui/misc';
import { ConfirmDialog } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import {
  updateStaffRole,
  setStaffActive,
  removeStaff,
  inviteStaff,
  revokeInvitation,
} from '@/app/dashboard/actions';
import { useT } from '@/i18n/provider';
import { STAFF_ROLES, staffRoleLabel } from '@/lib/staff-roles';
import { initials, formatDate } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import type { Enums } from '@/types/database';

type Member = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  role: Enums<'staff_role'>;
  isActive: boolean;
};

type Invitation = {
  id: string;
  email: string;
  role: Enums<'staff_role'>;
  asCourier: boolean;
  token: string;
  expiresAt: string;
};

export function StaffManager({
  currentUserId,
  ownerId,
  members,
  invitations,
  siteUrl,
}: {
  currentUserId: string;
  ownerId: string | null;
  members: Member[];
  invitations: Invitation[];
  siteUrl: string;
}) {
  const { locale } = useI18n();
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Enums<'staff_role'>>('waiter');
  const [inviteCourier, setInviteCourier] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const inviteUrl = (token: string) => `${siteUrl.replace(/\/$/, '')}/join/${token}`;

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* el navegador puede bloquear el portapapeles sin gesto del usuario */
    }
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return;
    setSaving(true);
    const result = await inviteStaff({
      email: inviteEmail,
      role: inviteRole as 'admin' | 'manager' | 'waiter' | 'kitchen' | 'cashier',
      asCourier: inviteCourier,
    });
    setSaving(false);

    if (!result.ok) {
      toast(result.error === 'PLAN_LIMIT_STAFF' ? t.dashboard.limitReached : t.common.error, 'error');
      return;
    }

    // Si el correo no salió, la invitación existe igual: se avisa para que la
    // pasen a mano con el enlace de la lista.
    toast(
      result.data.emailSent ? t.team.invitationEmailed : t.team.invitationNoEmail,
      result.data.emailSent ? 'success' : 'info',
    );
    setInviting(false);
    setInviteEmail('');
    router.refresh();
  }

  async function revoke(id: string) {
    const result = await revokeInvitation(id);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    router.refresh();
  }

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-ink-300">{t.team.inviteLinkHint}</p>
        <Button onClick={() => setInviting(true)}>
          <MailPlus className="h-4 w-4" />
          {t.dashboard.inviteStaff}
        </Button>
      </div>

      {invitations.length > 0 && (
        <section className="rounded-2xl border border-dashed border-surface-line bg-white p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-700">
            <Link2 className="h-4 w-4 text-brand" />
            {t.team.invitations} ({invitations.length})
          </h2>
          <ul className="space-y-2">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-field px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-700">{invitation.email}</p>
                  <p className="text-xs text-ink-300">
                    {staffRoleLabel(invitation.role, t)}
                    {invitation.asCourier && ` · ${t.team.alsoCourier}`}
                    {' · '}
                    {t.admin.expiresOn} {formatDate(invitation.expiresAt, locale)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyLink(invitation.token)}
                  className="btn-ghost text-xs"
                >
                  {copied === invitation.token ? (
                    <Check className="h-3.5 w-3.5 text-state-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied === invitation.token ? t.common.copied : t.team.inviteLink}
                </button>
                <button
                  type="button"
                  onClick={() => revoke(invitation.id)}
                  className="btn text-xs text-state-danger hover:bg-red-50"
                >
                  {t.team.revoke}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

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

      <Sheet
        open={inviting}
        onClose={() => setInviting(false)}
        title={t.dashboard.inviteStaff}
        footer={
          <Button size="block" loading={saving} onClick={sendInvite} disabled={!inviteEmail.trim()}>
            {t.common.create}
          </Button>
        }
      >
        <div className="space-y-4">
          <Input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            label={t.auth.email}
            placeholder="camarero@correo.com"
            hint={t.team.inviteLinkHint}
          />
          <Select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Enums<'staff_role'>)}
            label="Rol"
          >
            {STAFF_ROLES.filter((role) => role !== 'owner').map((role) => (
              <option key={role} value={role}>
                {staffRoleLabel(role, t)}
              </option>
            ))}
          </Select>
          <Switch
            checked={inviteCourier}
            onChange={setInviteCourier}
            label={t.team.alsoCourier}
          />
        </div>
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
