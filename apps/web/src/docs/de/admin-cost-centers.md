# Admin: Kostenstellen

## Lookup

Der Lookup ist die Liste aller bekannten Kostenstellen mit Status `offen`, `freigegeben`, `abgelehnt` oder `archiviert`.

- **Kostenstelle anlegen**: Nummer (8 Ziffern), Bezeichnung, Verantwortlicher und optional Max-Budget mit Zeitraum. Neu angelegte Kostenstellen sind sofort freigegeben.
- **Verantwortlicher**: Suchen Sie ihn per E-Mail oder User-ID unter den LiteLLM-Usern. Er wird automatisch Kostenstellen-Admin und bleibt es, solange er Verantwortlicher ist. Bei älteren Kostenstellen ohne verknüpften LiteLLM-User steht **Verantwortlicher fehlt**; wählen Sie dann unter **Bearbeiten** einen aus.
- **Bearbeiten**: Bezeichnung, Verantwortlicher, Max-Budget und **freigegebene Modelle** ändern. Ein neuer Verantwortlicher wird Kostenstellen-Admin; der bisherige bleibt Admin, bis Sie ihn herabstufen.
- **Freigegebene Modelle**: Ohne Auswahl sind alle Modelle freigegeben. Mit Auswahl bietet die Key-Erstellung nur diese Modelle an, und LiteLLM lässt für das Team der Kostenstelle nur sie zu. Kostenpflichtige Modelle bleiben auf der Default-Kostenstelle gesperrt.
- **Mitglieder**: Mitglieder und Kostenstellen-Admins der Kostenstelle verwalten, wie unter **Meine Kostenstellen** beschrieben. Admins dürfen auch den letzten Kostenstellen-Admin entfernen.
- **Archivieren**: Die Kostenstelle kann nicht mehr für neue Keys gewählt werden; bestehende Referenzen in Reports bleiben erhalten. Löschen ist nicht vorgesehen.
- Die Default-Kostenstelle `1111 1111` ist immer freigegeben und kann weder bearbeitet noch archiviert werden.

## Anträge

Hier erscheinen Anträge von Usern für neue Kostenstellen.

- **Freigeben**: Die Kostenstelle wird `freigegeben` und dem User sofort zugeordnet. Der im Antrag genannte Verantwortliche (ein LiteLLM-User) wird Kostenstellen-Admin, der Antragsteller Mitglied.
- **Ablehnen**: Mit Begründung.

In beiden Fällen wird der User per E-Mail informiert.
