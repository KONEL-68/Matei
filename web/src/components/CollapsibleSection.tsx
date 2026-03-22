import { useState } from 'react';

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string | number;
}

export function CollapsibleSection({ title, children, defaultOpen = false, badge }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800/50"
      >
        <span className="text-gray-400">{open ? '\u25BC' : '\u25B6'}</span>
        <span>{title}</span>
        {badge != null && (
          <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gray-100 px-1.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {badge}
          </span>
        )}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
