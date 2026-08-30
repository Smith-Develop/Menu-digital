'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink, MessageCircle, Share2 } from 'lucide-react';
import { useT } from '@/i18n/provider';

/** Enlace público del restaurante, listo para pegar en redes o WhatsApp. */
export function ShareLinks({
  siteUrl,
  slug,
  name,
}: {
  siteUrl: string;
  slug: string;
  name: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const url = `${siteUrl.replace(/\/$/, '')}/r/${slug}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* el navegador puede bloquear el portapapeles sin gesto del usuario */
    }
  }

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${name} — ${t.storefront.viewMenu}: ${url}`)}`;

  return (
    <section className="rounded-2xl bg-white p-5 shadow-chip">
      <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-700">
        <Share2 className="h-4 w-4 text-brand" />
        {t.dashboard.deliveryLink}
      </h2>
      <p className="mt-1 text-sm text-ink-300">{t.dashboard.deliveryLinkHint}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-xl bg-surface-field px-4 py-3 text-sm text-ink-600">
          {url}
        </code>
        <button type="button" onClick={copy} className="btn-ghost text-xs">
          {copied ? <Check className="h-3.5 w-3.5 text-state-success" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t.common.copied : t.common.copy}
        </button>
        <a href={url} target="_blank" rel="noreferrer" className="btn-ghost text-xs">
          <ExternalLink className="h-3.5 w-3.5" />
          {t.storefront.viewMenu}
        </a>
        <a href={whatsapp} target="_blank" rel="noreferrer" className="btn-primary text-xs">
          <MessageCircle className="h-3.5 w-3.5" />
          WhatsApp
        </a>
      </div>
    </section>
  );
}
