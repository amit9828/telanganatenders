'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { workflowFetch } from '@/components/workflow/api';

export default function OpsAlerts() {
  const [alerts, setAlerts] = useState([]);

  const load = async () => {
    try {
      const data = await workflowFetch('/api/ops-alerts');
      setAlerts(data.alerts || []);
    } catch (e) {
      toast.error(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  const ok = async (id) => {
    try {
      await workflowFetch('/api/ops-alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const open = alerts.filter((a) => a.status !== 'OK');
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Alerts</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {open.length === 0 && <p className="text-sm text-slate-400">No open alerts.</p>}
        {open.map((a) => (
          <div key={a._id} className="border rounded-lg p-2 flex items-start justify-between gap-2">
            <div>
              <Badge variant="outline" className="text-[9px] mb-1">{a.type}</Badge>
              <p className="text-sm text-slate-800">{a.message}</p>
            </div>
            <Button size="sm" className="h-7 text-[10px]" onClick={() => ok(a._id)}>Reply OK</Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
