'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Search, X } from 'lucide-react';

/** Campo de búsqueda que empuja el término a la URL (?q=). */
export function SearchField({
  defaultValue = '',
  placeholder,
  action = '/search',
}: {
  defaultValue?: string;
  placeholder: string;
  action?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);

  function submit(event: FormEvent) {
    event.preventDefault();
    const term = value.trim();
    router.push(term ? `${action}?q=${encodeURIComponent(term)}` : action);
  }

  return (
    <form onSubmit={submit} className="relative">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-xl bg-surface-field py-4 pl-12 pr-11 text-[15px] text-ink placeholder:text-ink-400 focus:bg-white focus:ring-1 focus:ring-brand/30"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue('');
            router.push(action);
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-surface-line p-1.5 text-ink-400"
          aria-label="Limpiar"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </form>
  );
}
