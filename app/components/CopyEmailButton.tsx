'use client';

import { useState } from 'react';

const SUPPORT_EMAIL = 'support@trytradepulse.com';

type CopyState = 'idle' | 'copied' | 'error';

export function CopyEmailButton() {
  const [state, setState] = useState<CopyState>('idle');

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setState('copied');
    } catch {
      setState('error');
    }
    setTimeout(() => setState('idle'), 2500);
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex min-h-11 w-fit items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50"
      >
        Copy email address
      </button>
      <p role="status" aria-live="polite" className="text-xs leading-relaxed text-slate-500 min-h-[1rem]">
        {state === 'copied' && 'Email copied.'}
        {state === 'error' && "Couldn't copy automatically. Select the address above and copy it manually."}
      </p>
    </div>
  );
}
