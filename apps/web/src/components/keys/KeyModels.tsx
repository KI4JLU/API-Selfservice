import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiKey } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const VISIBLE = 3;

/**
 * Models of a key in a table cell (#10): whole providers as one badge, then the first single models.
 * The rest opens in a popover grouped by provider, by hover, click/tap or keyboard (Enter/Space).
 */
export function KeyModels({ apiKey }: { apiKey: ApiKey }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // models of released providers are part of the provider badge (F-KEY-10)
  const groups = apiKey.modelGroups.map((g) => ({ ...g, released: g.provider !== null && apiKey.providers.includes(g.provider) }));
  const single = groups.filter((g) => !g.released).flatMap((g) => g.models);
  const hidden = single.length - VISIBLE;

  const hover = (on: boolean) => {
    clearTimeout(closeTimer.current);
    if (on) setOpen(true);
    // short delay so the pointer can move from the badge into the popover
    else closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  return (
    <div className="flex max-w-xs flex-wrap gap-1">
      {apiKey.providers.map((p) => (
        <Badge key={p} variant="outline" data-testid="key-provider">
          {t('keys.providerAll', { provider: p })}
        </Badge>
      ))}
      {single.slice(0, VISIBLE).map((m) => (
        <Badge key={m} variant="secondary" className="font-mono">
          {m}
        </Badge>
      ))}
      {hidden > 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="focus-visible:ring-ring/50 rounded-md outline-none focus-visible:ring-[3px]"
              onMouseEnter={() => hover(true)}
              onMouseLeave={() => hover(false)}
              aria-label={t('keys.moreModels', { count: hidden })}
              data-testid="btn-key-more-models"
            >
              <Badge variant="outline">+{hidden}</Badge>
            </button>
          </PopoverTrigger>
          <PopoverContent className="max-h-80 w-auto max-w-[min(400px,calc(100vw-2rem))] overflow-y-auto" onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)} data-testid="popover-key-models">
            <div className="grid gap-3 text-sm">
              {groups.map((g) => (
                <div key={g.provider ?? ''} className="grid gap-1" data-testid={`key-models-group-${g.provider ?? 'none'}`}>
                  <div className="text-xs font-medium text-muted-foreground">{g.provider ?? t('providers.noProvider')}</div>
                  {g.released ? (
                    <Badge variant="outline" className="w-fit">
                      {t('keys.providerAllModels')}
                    </Badge>
                  ) : (
                    <ul className="grid gap-0.5">
                      {g.models.map((m) => (
                        <li key={m} className="font-mono text-xs break-all">
                          {m}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
