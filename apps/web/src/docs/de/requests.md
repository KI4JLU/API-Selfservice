# Nutzung

Die Request-Liste zeigt Ihre eigenen Anfragen an den LiteLLM-Proxy, 1:1 aus den LiteLLM-Logs. Andere User, auch Admins, sehen Ihre Requests nicht.

## Spalten

Zeit, Typ, Status, Modell, Key, Kosten, Dauer (s), TTFT (s, Zeit bis zum ersten Token), Tokens (Eingabe + Ausgabe) und Tags.

## Filter

- **Zeitraum** (von/bis), **Modell**, **Key** und **Status** (Erfolg / Fehler).
- **Request-ID**: exakte Suche nach einer Request-ID, z. B. aus einer Fehlermeldung Ihres Clients.
- Die Liste ist seitenweise; unten blättern Sie weiter.

## Details

Ein Klick auf eine Zeile öffnet die Detailansicht mit allen Feldern, inklusive Request-ID, Session-ID und der Fehlermeldung bei fehlgeschlagenen Requests.

Prompt- und Antwortinhalte werden **nicht** gespeichert oder angezeigt, nur Metadaten.

## Verzögerung

Neue Requests erscheinen nach einigen Minuten: LiteLLM schreibt seine Logs kurz nach dem Request, und das Portal holt sie alle 5 Minuten ab. Ein gerade getesteter Key ist also nicht sofort in der Liste.
