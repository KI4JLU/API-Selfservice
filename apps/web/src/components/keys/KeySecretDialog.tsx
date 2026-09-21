import { useTranslation } from 'react-i18next';
import type { CreatedApiKey } from '@/lib/queries';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/CopyButton';
import { Banner } from '@/components/ui/page';

export function KeySecretDialog({ created, onClose }: { created: CreatedApiKey | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!created} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-key-secret">
        <DialogHeader>
          <DialogTitle>{t('keys.secretTitle')}</DialogTitle>
          <DialogDescription>{created?.name}</DialogDescription>
        </DialogHeader>
        <Banner variant="warning">{t('keys.secretHint')}</Banner>
        <div className="flex items-center gap-2">
          <code className="bg-muted flex-1 rounded-md border px-3 py-2 font-mono text-sm break-all select-all" data-testid="key-secret">
            {created?.secret}
          </code>
          <CopyButton value={created?.secret ?? ''} testId="btn-copy-secret" />
        </div>
        <DialogFooter>
          <Button onClick={onClose} data-testid="btn-close-secret">
            {t('keys.secretClose')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
