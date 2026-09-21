import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export function CopyButton({ value, testId, label }: { value: string; testId?: string; label?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button type="button" variant="outline" size={label ? 'default' : 'icon-sm'} onClick={copy} data-testid={testId} aria-label={t('common.copy')}>
      {copied ? <Check className="text-green-600 dark:text-green-500" /> : <Copy />}
      {label ? (copied ? t('common.copied') : t('common.copy')) : null}
    </Button>
  );
}
