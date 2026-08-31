'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { ImageIcon, Library, Link2, Loader2, Trash2, Upload } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

type StoredImage = { name: string; url: string; updatedAt: string | null };

/**
 * Selector de imagen con tres vías: subir una nueva, reutilizar una ya subida
 * o pegar una URL externa.
 *
 * La biblioteca se lee del propio bucket, así que no hace falta una tabla que
 * mantener en paralelo con lo que hay realmente almacenado.
 */
export function ImagePicker({
  bucket,
  folder,
  value,
  onChange,
  label,
  hint,
  recommended,
  fit = 'cover',
}: {
  bucket: 'restaurants' | 'products' | 'models';
  folder: string;
  value: string | null;
  onChange: (url: string | null) => void;
  label: string;
  hint?: string;
  /**
   * Medida recomendada, en píxeles. Se enseña junto al campo y la vista previa
   * adopta esa proporción, que es la única forma de ver antes de guardar si la
   * imagen va a quedar recortada.
   */
  recommended?: { width: number; height: number };
  /** Los logotipos se ven enteros; las fotos llenan el hueco. */
  fit?: 'cover' | 'contain';
}) {
  const t = useT();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [library, setLibrary] = useState<StoredImage[] | null>(null);
  const [urlDraft, setUrlDraft] = useState('');

  useEffect(() => {
    if (!browsing) return;

    let active = true;
    const supabase = createClient();

    supabase.storage
      .from(bucket)
      .list(folder, { limit: 100, sortBy: { column: 'updated_at', order: 'desc' } })
      .then(({ data }) => {
        if (!active) return;
        const files = (data ?? []).filter((file) => file.id && !file.name.startsWith('.'));
        setLibrary(
          files.map((file) => ({
            name: file.name,
            url: supabase.storage.from(bucket).getPublicUrl(`${folder}/${file.name}`).data.publicUrl,
            updatedAt: file.updated_at ?? null,
          })),
        );
      });

    return () => {
      active = false;
    };
  }, [browsing, bucket, folder]);

  async function upload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast(`${t.common.error}: 5 MB máx.`, 'error');
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      const path = `${folder}/${crypto.randomUUID()}.${extension}`;

      const { error } = await supabase.storage.from(bucket).upload(path, file, {
        cacheControl: '31536000',
        upsert: false,
        contentType: file.type || undefined,
      });

      if (error) {
        toast(`${t.common.error}: ${error.message}`, 'error');
        return;
      }

      onChange(supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl);
      setLibrary(null);
      toast(t.common.save, 'success');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <span className="label">{label}</span>

      <div className="flex items-start gap-3">
        <div
          className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-field text-ink-300"
          style={
            recommended
              ? { width: 96, height: Math.round((96 * recommended.height) / recommended.width) }
              : { width: 80, height: 80 }
          }
        >
          {value ? (
            <Image
              src={value}
              alt=""
              fill
              sizes="96px"
              className={fit === 'contain' ? 'object-contain p-2' : 'object-cover'}
            />
          ) : (
            <ImageIcon className="h-6 w-6" />
          )}
          {uploading && (
            <span className="absolute inset-0 flex items-center justify-center bg-white/80">
              <Loader2 className="h-5 w-5 animate-spin text-brand" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="btn-ghost text-xs"
            >
              <Upload className="h-3.5 w-3.5" />
              {t.image.upload}
            </button>
            <button
              type="button"
              onClick={() => setBrowsing(true)}
              className="btn-ghost text-xs"
            >
              <Library className="h-3.5 w-3.5" />
              {t.image.library}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="btn text-xs text-state-danger hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {recommended && (
            <p className="mt-2 text-xs font-semibold text-ink-400">
              {t.image.recommendedSize}: {recommended.width} × {recommended.height} px
            </p>
          )}
          {hint && <p className="mt-1.5 text-xs leading-relaxed text-ink-300">{hint}</p>}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      <Sheet open={browsing} onClose={() => setBrowsing(false)} title={t.image.library} size="lg">
        <div className="mb-5">
          <span className="label flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5" />
            {t.image.fromUrl}
          </span>
          <div className="flex gap-2">
            <Input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="https://…"
              className="flex-1"
              aria-label={t.image.fromUrl}
            />
            <Button
              type="button"
              onClick={() => {
                if (!urlDraft.trim()) return;
                onChange(urlDraft.trim());
                setUrlDraft('');
                setBrowsing(false);
              }}
              disabled={!urlDraft.trim()}
            >
              {t.common.apply}
            </Button>
          </div>
        </div>

        {library === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
          </div>
        ) : library.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-300">{t.image.emptyLibrary}</p>
        ) : (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {library.map((item) => (
              <li key={item.name}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(item.url);
                    setBrowsing(false);
                  }}
                  className={cn(
                    'relative block aspect-square w-full overflow-hidden rounded-xl border-2 bg-surface-muted transition-colors',
                    value === item.url ? 'border-brand' : 'border-transparent hover:border-brand/40',
                  )}
                >
                  <Image src={item.url} alt="" fill sizes="120px" className="object-cover" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </div>
  );
}
