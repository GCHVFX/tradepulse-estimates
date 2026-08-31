'use client';

import { useState } from 'react';
import { SUPPORT_EMAIL } from '@/lib/email-addresses';

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
        className="inline-flex min-h-11 w-fit items-center justify-center rounded-lg border border-[#C9B384] bg-white px-4 text-sm font-semibold text-[#26211B] transition-colors hover:bg-[#EADCC0]"
      >
        Copy email address
      </button>
      <p role="status" aria-live="polite" className="text-xs leading-relaxed text-[#5C4A2E] min-h-[1rem]">
        {state === 'copied' && 'Email copied.'}
        {state === 'error' && "Couldn't copy automatically. Select the address above and copy it manually."}
      </p>
    </div>
  );
}
