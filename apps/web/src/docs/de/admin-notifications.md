# Admin: Benachrichtigungen

Jede versendete E-Mail wird mit Empfänger, Typ, Betreff, Zeitstempel und Status protokolliert.

## Filter

- **Typ**: z. B. Kostenstellenantrag, Beitrittsanfrage, Budget 80 % / 100 %, Key läuft ab, Rolle geändert.
- **Status**: `gesendet`, `fehlgeschlagen` (mit Fehlermeldung) oder `übersprungen`.

## Typische Ereignisse

| Ereignis | Empfänger |
|---|---|
| Kostenstellenantrag eingegangen | Admins |
| Antrag freigegeben / abgelehnt | User |
| User-Budget 80 % / 100 % | User |
| Kostenstellen-Budget 80 % / 100 % | Verantwortlicher, Kostenstellen-Admins |
| Beitrittsanfrage eingegangen | Verantwortlicher, Kostenstellen-Admins |
| Beitrittsanfrage abgelehnt | User |
| Zur Kostenstelle hinzugefügt / Aus Kostenstelle entfernt | betroffener User |
| Key läuft in 14 Tagen / 1 Tag ab, Key abgelaufen | User |
| Rolle geändert, Account deaktiviert | betroffener User |
