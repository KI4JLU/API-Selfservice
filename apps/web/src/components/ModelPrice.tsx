import { useTranslation } from 'react-i18next';
import type { Provider } from '@/lib/queries';
import { fmtPerMillionTokens } from '@/lib/format';

/** Input/output price in EUR per 1M tokens, or a muted note when LiteLLM reports no price. */
export function ModelPrice({ provider, className }: { provider: Pick<Provider, 'inputCostPerToken' | 'outputCostPerToken'>; className?: string }) {
  const { t } = useTranslation();
  if (provider.inputCostPerToken === null && provider.outputCostPerToken === null) {
    return (
      <span className={`text-muted-foreground text-xs ${className ?? ''}`} data-testid="model-price">
        {t('providers.priceUnknown')}
      </span>
    );
  }
  return (
    <span className={`text-xs tabular-nums ${className ?? ''}`} title={t('providers.priceHint')} data-testid="model-price">
      <span className="text-muted-foreground">{t('providers.priceIn')} </span>
      {fmtPerMillionTokens(provider.inputCostPerToken)}
      <span className="text-muted-foreground"> · {t('providers.priceOut')} </span>
      {fmtPerMillionTokens(provider.outputCostPerToken)}
      <span className="text-muted-foreground"> / 1M</span>
    </span>
  );
}
