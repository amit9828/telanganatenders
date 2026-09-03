'use client';

export default function QuickReplies({ options = [], disabled, onPick }) {
  if (!options.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pl-8">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          onClick={() => onPick(option)}
          className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-medium
                     text-indigo-800 hover:border-indigo-400 hover:bg-indigo-100 disabled:opacity-50"
        >
          {option}
        </button>
      ))}
    </div>
  );
}
