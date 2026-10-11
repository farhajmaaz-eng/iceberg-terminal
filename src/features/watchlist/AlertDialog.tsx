import * as React from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/primitives';
import { Input, Label, Select } from '@/components/ui/input';
import { useAlertStore, type AlertKind } from '@/store/alerts';
import { useProviderStore } from '@/store/providers';
import { useToast } from '@/features/command/toast';
import { isSolanaAddress } from '@/lib/solana';

/**
 * Alert rule editor.
 *
 * Alerts are evaluated in-tab only. The dialog says so explicitly so the user
 * never assumes background monitoring they are not getting.
 */

const KIND_LABEL: Record<AlertKind, string> = {
  'price-above': 'Price above',
  'price-below': 'Price below',
  'change-up': '24h change above (%)',
  'change-down': '24h change below (%)',
  'volume-spike': 'Volume above multiple of baseline',
};

export function AlertDialog({
  open,
  onOpenChange,
  target,
  symbol,
  defaultPrice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: string;
  symbol?: string | null;
  defaultPrice?: number | null;
}) {
  const addRule = useAlertStore((s) => s.addRule);
  const pollIntervalSec = useProviderStore((s) => s.alerts.pollIntervalSec);
  const browserNotifications = useProviderStore((s) => s.alerts.browserNotifications);
  const toast = useToast();

  const [kind, setKind] = React.useState<AlertKind>('change-up');
  const [threshold, setThreshold] = React.useState('');
  const [label, setLabel] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setKind('change-up');
      setThreshold(defaultPrice != null ? String((defaultPrice * 1.1).toFixed(6)) : '10');
      setLabel(symbol ? `${symbol} alert` : '');
    }
  }, [open, defaultPrice, symbol]);

  const submit = () => {
    const value = Number(threshold);
    if (!isSolanaAddress(target)) {
      toast.push({ message: 'Invalid target address.', tone: 'error' });
      return;
    }
    if (!Number.isFinite(value)) {
      toast.push({ message: 'Threshold must be a number.', tone: 'error' });
      return;
    }
    const id = addRule({ kind, target, label: label.trim() || null, threshold: value, enabled: true });
    if (!id) {
      toast.push({ message: 'Could not create the alert — invalid target address.', tone: 'error' });
      return;
    }
    toast.push({ message: 'Alert rule created.', tone: 'success' });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,32rem)]">
        <DialogHeader
          title="Create alert"
          description="Rules are evaluated in this browser tab while Iceberg Terminal is open."
        />
        <div className="space-y-3 p-4">
          <Label>
            Condition
            <Select value={kind} onChange={(e) => setKind(e.target.value as AlertKind)}>
              {(Object.keys(KIND_LABEL) as AlertKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Label>

          <Label hint={kind.startsWith('price') ? 'USD' : kind.startsWith('volume') ? 'multiple' : 'percent'}>
            Threshold
            <Input
              type="number"
              step="any"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              autoFocus
            />
          </Label>

          <Label hint="Optional local label">
            Name
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. SOL breakout watch" />
          </Label>

          <div className="rounded-sm border border-amber/30 bg-amber/5 p-2 text-[10px] leading-relaxed text-amber/90">
            <strong className="font-semibold">How this works.</strong> Iceberg re-polls your configured providers every{' '}
            {pollIntervalSec}s while this tab is open and compares the latest value against the threshold. When the tab is
            closed or suspended, evaluation stops — there is no background worker and no server-side monitoring.
            {browserNotifications
              ? ' Browser notifications are enabled.'
              : ' Enable browser notifications in Settings if you want an OS-level popup.'}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-edge px-4 py-3">
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={submit}>
            <Bell size={12} /> Create alert
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}