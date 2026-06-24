import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { RotateCcw, Trash2, Loader2 } from 'lucide-react';
import * as perms from '@/lib/permissions';

const ENTITY_LABELS: Record<string, string> = {
  lead: 'Lead',
  student: 'Student',
  contact: 'Contact',
  deal: 'Deal',
  task: 'Task',
  course: 'Course',
  batch: 'Batch',
  payment: 'Payment',
  holiday: 'Holiday',
  lead_assignment: 'Lead assignment',
};

export default function Trash() {
  const { toast } = useToast();
  const { role } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [lastPurged, setLastPurged] = useState<number | null>(null);
  const canRestore = perms.canDelete(role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.trash.list();
      const list = Array.isArray(data?.data) ? data.data : [];
      setRows(list);
      if (typeof data?.purged_expired === 'number') {
        setLastPurged(data.purged_expired);
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not load trash', description: e?.message || 'Error' });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRestore = async (trashId: string) => {
    setRestoring(trashId);
    try {
      await api.trash.restore(trashId);
      toast({ title: 'Restored', description: 'The item was put back into the CRM.' });
      await load();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Restore failed', description: e?.message || 'Error' });
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Trash2 className="h-7 w-7 text-muted-foreground" />
          Trash
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Items you delete from Leads, Students, Contacts, Deals, Tasks, Courses, Batches, Payments, Holidays, and lead assignments appear here.
          Records older than <strong>30 days</strong> are removed automatically when you open this page.
        </p>
        {lastPurged !== null && lastPurged > 0 && (
          <p className="text-xs text-muted-foreground mt-2">Just cleared {lastPurged} expired item(s) (older than 30 days).</p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Deleted items</CardTitle>
          <CardDescription>Newest first. Restore brings the row back with the same id when possible.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Trash is empty.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>Deleted</TableHead>
                  <TableHead className="w-[120px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {ENTITY_LABELS[r.entity_type] || r.entity_type}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate" title={r.summary}>
                      {r.summary}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {r.deleted_at ? new Date(r.deleted_at).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell>
                      {canRestore ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={restoring === r.id}
                          onClick={() => handleRestore(r.id)}
                          className="gap-1"
                        >
                          {restoring === r.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          Restore
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
