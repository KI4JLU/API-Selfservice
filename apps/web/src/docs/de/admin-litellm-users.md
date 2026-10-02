# Admin: LiteLLM-User

LiteLLM ist die führende User-Liste. Dieser Screen durchsucht die Konten, die der LiteLLM-Proxy kennt, auch Personen, die sich noch nie bei LiteLite angemeldet haben.

## Suche

- **E-Mail**: Teilstring, Groß-/Kleinschreibung egal.
- **User-ID**: die vollständige LiteLLM-User-ID.
- Leere Suche listet alle User seitenweise.

## Spalten

- **User-ID**, **E-Mail** und **Alias**, wie in LiteLLM gespeichert.
- **Teams**: Anzahl der LiteLLM-Teams (= LiteLite-Kostenstellen), in denen der User Mitglied ist.
- **Verbrauch** und **Max-Budget**, wie LiteLLM sie durchsetzt.
- **In LiteLite**: das passende LiteLite-Konto mit Status oder „noch nie angemeldet“. Ein Konto, das nur in LiteLLM existiert, wird beim ersten LiteLite-Login mit derselben ID übernommen.

Die Liste ist nur lesend. Rollen, Budgets und Deaktivierung werden unter User / Rollen gepflegt. Die Abfrage braucht einen `LITELLM_API_KEY` mit Proxy-Admin-Rechten.
