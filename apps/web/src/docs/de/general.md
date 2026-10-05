# Willkommen bei LiteLite

LiteLite ist das Self-Service-Portal für den LiteLLM-Proxy. Hier verwalten Sie Ihre API-Keys, sehen Budget und Nutzung und treten Kostenstellen bei.

## Anmeldung

- Die Anmeldung erfolgt über Ihren Hochschul-Account (Keycloak, Single Sign-on). Beim ersten Login wird Ihr Konto automatisch angelegt.
- Neue Konten erhalten die Rolle **User** und die Default-Kostenstelle `1111 1111`.
- Mitglieder der Gruppe `LiteLLMAdmin` sind automatisch **Admin**.

## Rollen

| Rolle | Rechte |
|---|---|
| User | Eigene Keys, eigenes Budget, eigene Nutzung, eigenes Profil, Beitritt zu Kostenstellen anfragen |
| Kostenstellen-Admin | Zusätzlich: Mitglieder, Beitrittsanfragen, Max-Budget und Report der zugeordneten Kostenstellen. Weitere Kostenstellen-Admins ernennt nur der Verantwortliche |
| Admin | Alle Rechte: User, Rollen, Budgets, Kostenstellen (inkl. freigegebener Modelle und Beitrittsanfragen), Modelle, Reports |

## Kopfzeile

- **DE / EN** schaltet die Sprache um. Die Auswahl wird in Ihrem Profil gespeichert.
- **Sonne / Mond** schaltet zwischen hellem und dunklem Modus. Standard ist die Systemeinstellung.
- **?** öffnet diese Hilfe. Der Abschnitt passt sich dem aktuellen Screen an.
- Über das **Benutzermenü** erreichen Sie Ihr Profil und melden sich ab.
