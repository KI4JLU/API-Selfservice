import { useState, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Send } from 'lucide-react';
import { useKeyTest, useKeyTestModels } from '@/lib/queries';
import { errorMessage } from '@/lib/errors';
import { fmtNumber, fmtSeconds } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Banner, DescriptionList, PageHeader } from '@/components/ui/page';

export const Route = createFileRoute('/_app/key-test')({
  component: KeyTestPage,
});

/** F-KEY-9: send one prompt with a key to see that it works. The key is not stored. */
function KeyTestPage() {
  const { t } = useTranslation();
  const [secret, setSecret] = useState('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState(() => t('keyTest.defaultPrompt'));
  const models = useKeyTestModels();
  const test = useKeyTest();

  const onSecretChange = (v: string) => {
    setSecret(v);
    // models and result belong to the previous key
    models.reset();
    test.reset();
    setModel('');
  };

  const loadModels = async (e: FormEvent) => {
    e.preventDefault();
    test.reset();
    const res = await models.mutateAsync(secret.trim()).catch(() => null);
    setModel(res?.models[0] ?? '');
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    await test.mutateAsync({ key: secret.trim(), model, prompt: prompt.trim() }).catch(() => null);
  };

  const available = models.data?.models;
  const result = test.data;

  return (
    <div data-testid="page-key-test" className="mx-auto max-w-2xl">
      <PageHeader title={t('keyTest.title')} subtitle={t('keyTest.subtitle')} />
      <Card>
        <CardHeader>
          <CardTitle>{t('keyTest.cardTitle')}</CardTitle>
          <CardDescription>{t('keyTest.cardDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <form onSubmit={loadModels}>
            <Field label={t('keyTest.key')} htmlFor="kt-key" required hint={t('keyTest.keyHint')}>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="kt-key"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={200}
                  value={secret}
                  onChange={(e) => onSecretChange(e.target.value)}
                  placeholder="sk-…"
                  className="font-mono"
                  data-testid="input-key-test-key"
                  autoFocus
                />
                <Button type="submit" variant="outline" loading={models.isPending} disabled={!secret.trim()} data-testid="btn-load-models">
                  {t('keyTest.loadModels')}
                </Button>
              </div>
            </Field>
          </form>
          {models.isError ? (
            <Banner variant="danger" testId="key-test-error">
              {errorMessage(models.error)}
            </Banner>
          ) : null}
          {available?.length === 0 ? (
            <Banner variant="warning" testId="key-test-no-models">
              {t('keyTest.noModels')}
            </Banner>
          ) : null}
          {available?.length ? (
            <form onSubmit={send} className="grid gap-4">
              <Field label={t('keyTest.model')} htmlFor="kt-model" required>
                <SimpleSelect id="kt-model" value={model} onValueChange={setModel} options={available.map((m) => ({ value: m, label: m }))} testId="input-key-test-model" />
              </Field>
              <Field label={t('keyTest.prompt')} htmlFor="kt-prompt" required hint={t('keyTest.promptHint')}>
                <Textarea id="kt-prompt" required maxLength={2000} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} data-testid="input-key-test-prompt" />
              </Field>
              <div>
                <Button type="submit" loading={test.isPending} disabled={!model || !prompt.trim()} data-testid="btn-send-key-test">
                  <Send />
                  {t('keyTest.send')}
                </Button>
              </div>
            </form>
          ) : null}
        </CardContent>
      </Card>
      {test.isError ? (
        <Banner variant="danger" title={t('keyTest.failed')} className="mt-4" testId="key-test-error">
          {errorMessage(test.error)}
        </Banner>
      ) : null}
      {result ? (
        <Banner variant="success" title={t('keyTest.success')} className="mt-4" testId="key-test-success">
          <DescriptionList
            className="mt-2"
            items={[
              { label: t('keyTest.answeredBy'), value: <span className="font-mono">{result.model}</span> },
              { label: t('keyTest.duration'), value: `${fmtSeconds(result.durationMs)} s` },
              {
                label: t('keyTest.tokens'),
                value: result.promptTokens === null ? '–' : `${fmtNumber(result.promptTokens)} + ${fmtNumber(result.completionTokens)}`,
              },
            ]}
          />
          <div className="bg-muted text-foreground mt-3 rounded-md p-3 text-sm whitespace-pre-wrap" data-testid="key-test-answer">
            {result.answer || t('keyTest.emptyAnswer')}
          </div>
        </Banner>
      ) : null}
    </div>
  );
}
