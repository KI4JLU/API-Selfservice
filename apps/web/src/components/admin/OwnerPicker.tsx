import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { useLitellmUsers } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

export type Owner = { userId: string; name: string; email: string | null };

/** F-KST-14 (admins only): the owner of a cost center is picked from the LiteLLM users and becomes its cost center admin. */
export function OwnerPicker({ value, onChange, idPrefix }: { value: Owner | null; onChange: (o: Owner) => void; idPrefix: string }) {
  const { t } = useTranslation();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const users = useLitellmUsers({ q, pageSize: 10 }, q.length >= 3);

  // A nested <form> is not allowed inside the dialog form, so Enter and the button trigger the search directly.
  const search = () => setQ(qInput.trim());

  return (
    <Field label={t('costCenters.owner')} htmlFor={`${idPrefix}-owner-q`} required hint={t('costCenters.ownerHint')}>
      <div className="grid gap-2" data-testid="owner-picker">
        <div className="text-sm" data-testid="owner-selected">
          {value ? (
            <>
              <span className="font-medium">{value.name}</span>
              {value.email && value.email !== value.name ? <span className="text-muted-foreground"> · {value.email}</span> : null}
            </>
          ) : (
            <span className="text-muted-foreground">{t('costCenters.ownerNone')}</span>
          )}
        </div>
        <div className="flex gap-1">
          <Input
            id={`${idPrefix}-owner-q`}
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                search();
              }
            }}
            placeholder={t('members.searchPlaceholder')}
            data-testid="input-owner-search"
          />
          <Button type="button" variant="outline" size="icon" onClick={search} disabled={qInput.trim().length < 3} aria-label={t('common.search')} data-testid="btn-owner-search">
            <Search />
          </Button>
        </div>
        {q.length < 3 ? null : users.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : (users.data?.items ?? []).length === 0 ? (
          <div className="text-muted-foreground text-sm">{t('members.noCandidates')}</div>
        ) : (
          <ul className="max-h-48 divide-y overflow-y-auto rounded-md border" data-testid="list-owner-candidates">
            {(users.data?.items ?? []).map((u) => {
              const name = u.apiSelfservice?.name ?? u.alias ?? u.email ?? u.userId;
              const selected = value?.userId === u.userId;
              return (
                <li key={u.userId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{name}</div>
                    <div className="text-muted-foreground truncate text-xs">{[u.email, u.apiSelfservice ? null : t('members.neverSignedIn')].filter(Boolean).join(' · ')}</div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={selected ? 'secondary' : 'outline'}
                    disabled={selected || !u.email || u.apiSelfservice?.status === 'deactivated'}
                    onClick={() => onChange({ userId: u.userId, name, email: u.email })}
                    data-testid="btn-pick-owner"
                  >
                    {t('costCenters.ownerPick')}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Field>
  );
}
