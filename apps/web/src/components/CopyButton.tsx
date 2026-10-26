import { useEffect, useState } from 'react';

/** Copies text we generated (never LLM output) and announces the result to screen readers. */
export function CopyButton({
  text,
  label,
  idleText = 'Copy',
  className = 'btn btn-small',
}: {
  text: string | (() => string);
  label: string;
  idleText?: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => {
      setState('idle');
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  const copy = () => {
    navigator.clipboard.writeText(typeof text === 'function' ? text() : text).then(
      () => {
        setState('copied');
      },
      () => {
        setState('failed');
      },
    );
  };

  return (
    <button type="button" className={className} onClick={copy} aria-label={label}>
      <span aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : idleText}
      </span>
    </button>
  );
}
