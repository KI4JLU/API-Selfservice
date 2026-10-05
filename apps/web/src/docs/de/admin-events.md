# Admin: Ereignisprotokoll

Jede wesentliche Änderung, jeder Alarm und jeder Fehler wird mit Zeit, Objekt und auslösender Person protokolliert. Das Protokoll wird vom Server geschrieben; Einträge können nicht bearbeitet oder gelöscht werden.

## Stufen

- **Info**: eine Änderung, z. B. User angelegt, Key angelegt, Budget zugewiesen, Kostenstelle freigegeben, Rolle geändert, Modelle synchronisiert.
- **Alarm**: etwas braucht Aufmerksamkeit, z. B. ein User- oder Kostenstellen-Budget hat 80 % erreicht oder ist erschöpft (Keys gesperrt), ein Account wurde deaktiviert, weil er nicht mehr berechtigt ist.
- **Fehler**: etwas ist fehlgeschlagen, z. B. eine Änderung konnte nicht nach LiteLLM gespiegelt werden, ein Cron-Job ist abgebrochen oder eine API-Anfrage endete mit einem internen Fehler.

## Filter

- **Stufe** und **Objekt** (User, API-Key, Kostenstelle, Modell, Request, Job).
- **Ereignis**: Teilstring des technischen Ereignisnamens, z. B. `key.create`, `budget` oder `litellm`.

## Details

Ein Klick auf eine Zeile zeigt die Objekt-ID und die gespeicherten Details (z. B. Beträge und Prozentwerte bei Budget-Alarmen, die Fehlermeldung bei Fehlern). Einträge mit **Ausgelöst von** = *System* stammen von Cron-Jobs oder Budgetprüfungen, nicht von einer Person. Hat ein Admin als anderer User gehandelt (Impersonation), steht dieser User unter **Ausgelöst von** und die ID des Admins in den Details als `impersonatedBy`. Fehler von LiteLLM stehen nur hier mit vollem Text; User sehen nur eine allgemeine Meldung.

## Häufige Ereignisse

| Ereignis | Bedeutung |
|---|---|
| `user.create` | Ein User hat sich zum ersten Mal angemeldet (neu angelegt oder aus LiteLLM übernommen) |
| `key.create` / `key.delete` / `key.extend` / `key.expire` | Lebenszyklus eines Keys |
| `key.models_added` | Neue Modelle eines Providers wurden einem Provider-Key automatisch hinzugefügt |
| `budget.set` | Admin hat ein User-Budget zugewiesen |
| `budget.warn` / `budget.block` | User-Budget bei 80 % / erschöpft, Keys gesperrt |
| `cost_center.warn` / `cost_center.block` | Kostenstellen-Budget bei 80 % / erschöpft, Keys gesperrt |
| `cost_center.join_request` / `cost_center.join_approve` / `cost_center.join_reject` | Beitritt zu einer Kostenstelle angefragt / angenommen / abgelehnt |
| `user.set_role` / `user.deactivate` | Rolle geändert / User deaktiviert |
| `litellm.*` | Spiegeln einer Änderung nach LiteLLM fehlgeschlagen; die Änderung bleibt in LiteLite erhalten und wird beim nächsten Abgleich nachgeholt |
| `job.failed` / `request.internal_error` | Ein Cron-Job oder eine API-Anfrage ist unerwartet fehlgeschlagen |
