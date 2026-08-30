'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import { Box, ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

type Bucket = 'products' | 'restaurants' | 'models';

const ACCEPT: Record<Bucket, string> = {
  products: 'image/jpeg,image/png,image/webp,image/avif',
  restaurants: 'image/jpeg,image/png,image/webp,image/avif,image/svg+xml',
  models: '.glb,.gltf,.usdz,model/gltf-binary',
};

const MAX_BYTES: Record<Bucket, number> = {
  products: 5 * 1024 * 1024,
  restaurants: 5 * 1024 * 1024,
  models: 50 * 1024 * 1024,
};

/**
 * Sube un archivo directamente a Supabase Storage desde el navegador.
 * La ruta empieza siempre por el id del restaurante, que es lo que la política
 * de storage comprueba para autorizar la escritura.
 */
export function FileUpload({
  bucket,
  restaurantId,
  value,
  onChange,
  label,
  hint,
  preview = 'image',
}: {
  bucket: Bucket;
  restaurantId: string;
  value: string | null;
  onChange: (url: string | null) => void;
  label: string;
  hint?: string;
  preview?: 'image' | 'file';
}) {
  const t = useT();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    if (file.size > MAX_BYTES[bucket]) {
      toast(`${t.common.error}: ${Math.round(MAX_BYTES[bucket] / 1024 / 1024)} MB máx.`, 'error');
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
      const path = `${restaurantId}/${crypto.randomUUID()}.${extension}`;

      const { error } = await supabase.storage.from(bucket).upload(path, file, {
        cacheControl: '31536000',
        upsert: false,
        contentType: file.type || undefined,
      });

      if (error) {
        toast(`${t.common.error}: ${error.message}`, 'error');
        return;
      }

      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      onChange(data.publicUrl);
      toast(t.common.save, 'success');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <span className="label">{label}</span>

      <div className="flex items-center gap-3">
        <div
          className={cn(
            'relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-field text-ink-300',
            value && preview === 'image' && 'bg-surface-muted',
          )}
        >
          {value && preview === 'image' ? (
            <Image src={value} alt="" fill sizes="80px" className="object-cover" />
          ) : value ? (
            <Box className="h-7 w-7 text-brand" />
          ) : preview === 'image' ? (
            <ImageIcon className="h-6 w-6" />
          ) : (
            <Box className="h-6 w-6" />
          )}

          {uploading && (
            <span className="absolute inset-0 flex items-center justify-center bg-white/80">
              <Loader2 className="h-5 w-5 animate-spin text-brand" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="btn-ghost text-xs"
            >
              <Upload className="h-3.5 w-3.5" />
              {value ? t.common.edit : t.dashboard.uploadImage}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="btn text-xs text-state-danger hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t.common.delete}
              </button>
            )}
          </div>
          {hint && <p className="mt-2 text-xs leading-relaxed text-ink-300">{hint}</p>}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT[bucket]}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}
