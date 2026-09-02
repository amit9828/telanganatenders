'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

// Module accent map from the Enterprise UI/UX Blueprint (section C) — keep every
// dashboard nav item mapped to the same fixed color per feature area instead of
// ad-hoc choices.
const ACTIVE_COLOR_CLASS = {
  navy: 'bg-[#0A2647] text-white',
  emerald: 'bg-emerald-600 text-white',
  blue: 'bg-blue-700 text-white',
  purple: 'bg-purple-700 text-white',
  indigo: 'bg-indigo-700 text-white',
  teal: 'bg-teal-700 text-white',
  violet: 'bg-violet-700 text-white',
};

function NavGroups({ groups, activeTab, onChange, onNavigate }) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.id}>
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{group.label}</p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => { onChange(item.value); onNavigate?.(); }}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold transition-all duration-200 text-left',
                    isActive ? ACTIVE_COLOR_CLASS[item.color] || ACTIVE_COLOR_CLASS.navy : 'text-slate-600 hover:bg-slate-100'
                  )}
                >
                  {Icon && <Icon className="w-4 h-4 shrink-0" />}
                  <span className="flex-1 truncate">{item.label}</span>
                  {!!item.badge && (
                    <Badge className={cn('h-5 min-w-5 justify-center px-1.5 text-[10px] shrink-0', isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700')}>
                      {item.badge}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Grouped two-tier dashboard navigation (Enterprise UI/UX Blueprint, section A).
 * Renders a persistent left rail on desktop (lg+) and a Sheet-based drawer,
 * opened from a compact sticky bar, on tablet/mobile. Does not own the active
 * tab state — it just calls onChange(value), so it drives the existing
 * <Tabs value={activeTab} onValueChange={setActiveTab}> in the parent page
 * without any TabsContent needing to change.
 */
export default function DashboardNav({ groups, activeTab, onChange, title = 'Menu' }) {
  const [open, setOpen] = useState(false);
  const activeItem = groups.flatMap((g) => g.items).find((i) => i.value === activeTab);

  return (
    <>
      <aside className="hidden lg:block w-60 shrink-0 sticky top-[76px] self-start max-h-[calc(100vh-96px)] overflow-y-auto glass-panel rounded-xl tender-shadow border border-slate-200/80 p-3">
        <NavGroups groups={groups} activeTab={activeTab} onChange={onChange} />
      </aside>

      <div className="lg:hidden sticky top-0 z-30 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 mb-1 glass-panel border-b border-slate-200/80 w-[calc(100%+1.5rem)] sm:w-[calc(100%+2rem)]">
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          className="w-full justify-start gap-2 bg-white border-slate-200 font-semibold text-slate-700"
        >
          <Menu className="w-4 h-4 shrink-0" /> {activeItem?.label || title}
        </Button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="w-[85vw] max-w-xs p-4 overflow-y-auto">
            <SheetHeader className="mb-3">
              <SheetTitle className="text-[#0A2647]">{title}</SheetTitle>
            </SheetHeader>
            <NavGroups groups={groups} activeTab={activeTab} onChange={onChange} onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
