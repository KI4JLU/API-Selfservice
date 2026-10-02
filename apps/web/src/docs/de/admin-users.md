# Admin: User / Rollen

Die Userliste zeigt alle Konten mit Rolle, Kostenstelle, Budget, Verbrauch, Anzahl Keys, Status und letztem Login.

## Filter

- **Suche** nach Name oder E-Mail.
- **Kostenstelle** einschränken.
- **Deaktivierte anzeigen**: Deaktivierte User sind standardmäßig ausgeblendet.

## Aktionen pro User

- **Rolle setzen** (`user` / `admin`). Kommt die Admin-Rolle aus der Keycloak-Gruppe `LiteLLMAdmin`, ist sie hier nicht änderbar. Der letzte Admin kann nicht herabgestuft werden.
- **Kostenstellen-Admin für**: Wählen Sie die Kostenstellen, für die der User Max-Budget setzen und Reports sehen darf. Eine leere Auswahl entzieht die Rolle.
- **Budget zuweisen**: Betrag in EUR und Zeitraum (monatlich, jährlich oder Projekt mit Start und Ende). Das Budget wird nach LiteLLM synchronisiert. Bei 100 % werden die Keys des Users gesperrt.
- **Deaktivieren**: Login und alle Keys werden gesperrt, die Daten bleiben für Reports erhalten. **Reaktivieren** hebt die Login-Sperre auf; Keys bleiben gesperrt und müssen neu angelegt werden.
- **Als User anmelden** (nur wenn auf dieser Instanz aktiviert, zum Debugging): Sie handeln in Ihrer laufenden Sitzung als der gewählte User. Sie sehen und tun genau das, was dieser User kann; Ihre Admin-Rechte ruhen, bis Sie im Hinweisbalken auf **Beenden** klicken. Start, Ende und jede Aktion dazwischen werden im Ereignisprotokoll protokolliert (mit Ihnen als `impersonatedBy`). Nicht möglich für sich selbst und deaktivierte User.

Jede Änderung wird im Audit-Log protokolliert und dem User per E-Mail mitgeteilt.
