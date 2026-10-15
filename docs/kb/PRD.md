# PRD – LiteLite: Self-Service-Portal für LiteLLM

| Feld | Wert |
|---|---|
| Version | 0.12 (Beitrittsanfragen, Mitglieder per Liste, Dashboard-Übersicht) |
| Datum | 2026-10-05 |
| Status | In Abstimmung |
| Quellen | Anforderungsliste (Sven Herchenhein, 2026-09-19), `docs/API-Service Entwicklung Selfservice Portal-v8-20260813_115005.pdf` (Stand 2026-08-13) |

Die Widersprüche zwischen beiden Quellen wurden am 2026-09-19 entschieden (Kapitel 12, E-1 bis E-5) und sind in diese Fassung eingearbeitet. Am 2026-09-20 wurde entschieden, LiteLLM als führende User-Liste zu nutzen und Kostenstellen an LiteLLM-Teams zu hängen (E-7, E-8). Am 2026-10-01 kamen Mitglieder pro Kostenstelle hinzu (E-9), und die Kostenstelle wurde aus dem Profil entfernt (E-10); der Verantwortliche einer Kostenstelle ist seitdem ein LiteLLM-User und ihr Kostenstellen-Admin (E-11). Am 2026-10-05 kamen Beitrittsanfragen hinzu (E-13).

---

## 1. Ziel und Zweck

LiteLite ist eine schlanke Web-Oberfläche für ein bereits vorhandenes LiteLLM-Proxy. Es ersetzt für Endanwender und Administratoren das LiteLLM-Admin-UI durch eine einfachere, rollenbasierte Oberfläche und ergänzt Funktionen, die LiteLLM nicht bietet: Kostenstellen mit Freigabe-Workflow, Budgetzuweisung pro User und Kostenstelle, API-Key-Self-Service mit Ablaufdatum, Verbrauchsreports mit Excel-Export für die Finanzabteilung sowie E-Mail-Benachrichtigungen.

**Nicht Teil des Projekts:** Installation und Betrieb von LiteLLM, Keycloak und PostgreSQL. Diese Systeme existieren bereits und werden angebunden. Backups laufen über die bestehende VMware-Infrastruktur.

## 2. Systemkontext

```
Browser ──> LiteLite (Docker)
              ├── Frontend: TanStack (Router/Query/Table) + shadcn/ui + Tailwind
              ├── Backend:  Hono.js + Drizzle ORM + Better Auth
              │     ├── OIDC ──> Keycloak (SSO, Account-Gültigkeit)
              │     ├── REST ──> LiteLLM Proxy (User, Teams, Keys, Spend, Logs, Modelle)
              │     ├── SQL  ──> PostgreSQL (Host von LiteLLM, eigenes Schema `litelite`)
              │     └── SMTP ──> Nodemailer (Benachrichtigungen)
```

**Abgrenzung:**
- LiteLLM ist die Quelle für Requests, Spend-Daten und API-Keys. LiteLite legt Keys über die LiteLLM-API an und spiegelt Spend- und Log-Daten, erzeugt sie aber nicht selbst.
- LiteLLM ist die **führende User-Liste** (E-7). Jeder LiteLite-User ist ein LiteLLM-User mit derselben ID (`user.id` = LiteLLM `user_id`). LiteLite legt keine User eigenständig an: Beim ersten Login wird ein in LiteLLM bereits vorhandener User mit gleicher E-Mail übernommen, sonst einer in LiteLLM angelegt. Kostenstellen werden als LiteLLM-Teams geführt (E-8).
- Keycloak ist die einzige Identitätsquelle. LiteLite führt keine eigenen Passwörter. Ergänzende User-Eigenschaften, die LiteLLM nicht kennt (Rolle, Kostenstelle, Verantwortlicher, Sprache, Softdelete, Account-Gültigkeit), liegen in der Tabelle `user` im LiteLite-Schema, nicht im LiteLLM-Metadata-Feld. Das Keycloak-Subject liegt in der Better-Auth-Tabelle `account` und wird als `sso_user_id` nach LiteLLM gespiegelt.
- Die LiteLite-Datenbank liegt auf demselben PostgreSQL-Host wie LiteLLM in einem **eigenen Schema**. Das LiteLLM-Schema wird nur lesend verwendet.

## 3. Rollen

| Rolle | Beschreibung | Vergabe |
|---|---|---|
| **User** | Sieht eigenes Profil, eigene Keys, eigenes Budget, eigene Requests. Legt Keys an. Fragt den Beitritt zu freigegebenen Kostenstellen an (F-KST-16). | Automatisch beim ersten SSO-Login |
| **Kostenstellen-Admin** | User-Rechte plus, je zugeordneter Kostenstelle: Mitglieder verwalten (F-KST-10, auch per E-Mail-Liste, F-KST-11), Beitrittsanfragen annehmen oder ablehnen (F-KST-16), weitere Kostenstellen-Admins ernennen und entfernen nur als Verantwortlicher (F-KST-13), Max-Budget der Kostenstelle setzen, Verbrauchsreport nach Usern und Keys der Kostenstelle einsehen, Excel-Export für die eigene Kostenstelle. Sieht keine Logs anderer User. | Pro Kostenstelle durch Admin (Screen „User / Rollen“ oder Mitgliederliste), durch einen Kostenstellen-Admin derselben Kostenstelle oder automatisch für den Verantwortlichen der Kostenstelle (F-KST-14) |
| **Admin** | Alle Rechte: Userverwaltung, Rollenvergabe, Budgetzuweisung, Provider-Verwaltung, Kostenstellen-Lookup pflegen und freigeben, Reports, Export, Umbuchungen. | Automatisch für Mitglieder der Keycloak-Gruppe `LiteLLMAdmin`; zusätzlich durch Admin im Screen „User / Rollen“ |

Rollen werden in LiteLite gespeichert und im Portal verwaltet (Entscheidung E-3). Sie liegen bewusst nicht im LiteLLM-Metadata-Feld, damit ein Zugang zum LiteLLM-Admin-UI keine LiteLite-Rechte verleiht. Kostenstellen-Admins werden zusätzlich als Team-Admins des zugehörigen LiteLLM-Teams gespiegelt (E-8). Keycloak liefert Identität, Account-Gültigkeit und die Gruppe `LiteLLMAdmin` als Quelle für die Admin-Grundausstattung (O-6). Die Rolle Kostenstellen-Admin ist auf eine oder mehrere Kostenstellen beschränkt; ein User kann gleichzeitig Kostenstellen-Admin mehrerer Kostenstellen sein, und eine Kostenstelle kann mehrere Kostenstellen-Admins haben. Der Verantwortliche einer Kostenstelle ist ein LiteLLM-User und immer ihr Kostenstellen-Admin (F-KST-14).

## 4. Funktionale Anforderungen

### 4.1 Authentifizierung (SSO)

- **F-AUTH-1** Login ausschließlich via Keycloak (OIDC) über Better Auth.
- **F-AUTH-2** Beim ersten Login prüft LiteLite, ob in LiteLLM bereits ein User mit dieser E-Mail existiert (`/user/list`). Wenn ja, übernimmt LiteLite dessen `user_id` als eigene User-ID; wenn nein, legt LiteLite den User in LiteLLM an (`/user/new`, `user_id` = LiteLite-ID). Das Keycloak-Subject wird als `sso_user_id` nach LiteLLM gespiegelt. In beiden Fällen erhält der User die Default-Kostenstelle und wird Mitglied ihres Teams.
- **F-AUTH-3** Logout beendet die LiteLite-Session und die Keycloak-Session (RP-initiated logout).
- **F-AUTH-4** Neue User erhalten die Rolle `user`. Mitglieder der Keycloak-Gruppe `LiteLLMAdmin` (Gruppenname per Env konfigurierbar) erhalten bei jedem Login automatisch die Rolle `admin`; diese Rolle kann im Portal nicht entzogen werden, solange die Gruppenmitgliedschaft besteht. Weitere Admins und alle Kostenstellen-Admins werden im Admin-Screen „User / Rollen“ vergeben. Der Gruppen-Claim muss im ID-Token enthalten sein (Keycloak Group Mapper).
- **F-AUTH-5** Session-Ablauf und Refresh gemäß Keycloak-Token-Lifetimes.
- **F-AUTH-6** Ein Account gilt als gültig, wenn das Keycloak-Attribut `eduPersonAffiliation` den Wert `member` oder `staff` enthält. Attributname und erlaubte Werte sind per Env konfigurierbar. Ungültige Accounts können sich nicht einloggen (siehe 4.10).

### 4.2 User-Profil

- **F-PROF-1** Der User sieht und bearbeitet: Anzeigename (read-only aus Keycloak), E-Mail (read-only), Sprache (de/en). Kostenstelle, Kostenstellenverantwortlicher und Antragsstatus sind nicht Teil des Profils (E-10).
- **F-PROF-2** Kostenstelle ist eine 8-stellige Ziffernfolge. Anzeige-Format `1111 1111`, Speicherformat `11111111`.
- **F-PROF-3** Default-Kostenstelle für jeden neuen User ist `1111 1111`.
- **F-PROF-4** Wird über die API (`PATCH /me`) eine Kostenstelle gesetzt, die nicht im Kostenstellen-Lookup existiert, wird ein Freigabeantrag erzeugt (siehe 4.3). Bis zur Freigabe bleibt die bisherige Kostenstelle aktiv. Das Portal bietet dafür seit E-10 keine Oberfläche mehr (O-10).
- **F-PROF-5** Wird über die API eine freigegebene Kostenstelle gesetzt, deren Mitglied er ist (oder die Default-Kostenstelle), wird sie sofort übernommen. Mitglied einer bestehenden Kostenstelle wird er, wenn ihn deren Kostenstellen-Admins hinzufügen (F-KST-10) oder seine Beitrittsanfrage annehmen (F-KST-16); sonst `COST_CENTER_NOT_MEMBER`.
- **F-PROF-6** Entfällt (E-10): Das Profil zeigt keinen Antragsstatus mehr. Über Freigabe oder Ablehnung wird der User per E-Mail informiert (F-KST-3).
- **F-PROF-7** Das PDF spricht von „Kostenstelle / Projektnummer“. Bis zur Klärung (Kapitel 12, O-3) wird nur ein Feld „Kostenstelle“ geführt.

### 4.3 Kostenstellen

**Datenmodell einer Kostenstelle**

| Feld | Typ | Pflicht |
|---|---|---|
| Nummer | 8 Ziffern, eindeutig | ja |
| Bezeichnung | Text | ja |
| Verantwortlicher | LiteLLM-User (`owner_user_id`); Name und E-Mail als Kopie für Anzeige und Mails (F-KST-14) | ja |
| Max-Budget | Betrag in EUR, Zeitraum `monthly` / `yearly` / `project` (fester Start und Ende, kein Reset) | nein (leer = unbegrenzt) |
| Status | `pending` / `approved` / `rejected` / `archived` | ja |
| LiteLLM-Team | `team_id` = Kostenstellen-ID, `team_alias` = Nummer und Bezeichnung (`litellm_team_id` gesetzt, sobald angelegt) | ab Freigabe |
| Angelegt von, Freigegeben von, Zeitstempel | | ja |

- **F-KST-1** Admins pflegen den Kostenstellen-Lookup: anlegen, bearbeiten, archivieren. Löschen ist nicht vorgesehen (Referenzen aus Logs/Reports müssen erhalten bleiben).
- **F-KST-2** User können eine neue Kostenstelle beantragen (Nummer, Bezeichnung, E-Mail des Verantwortlichen, die einem LiteLLM-User gehören muss, F-KST-14). Der Antrag landet mit Status `pending` im Lookup. Seit E-10 nur noch über die API, im Portal gibt es dafür keinen Einstieg (O-10). Unbekannte und deaktivierte Verantwortliche ergeben dieselbe Antwort; nach 5 solchen Fehlversuchen pro Stunde antwortet die API mit `RATE_LIMITED`, damit sich die User-Liste nicht abfragen lässt.
- **F-KST-3** Admins geben Anträge frei oder lehnen sie mit Begründung ab. Der User wird per E-Mail informiert. Bei Freigabe wird der Verantwortliche Kostenstellen-Admin und der Antragsteller Mitglied der Kostenstelle.
- **F-KST-4** Eine Kostenstelle hat ein optionales Max-Budget pro Monat, pro Jahr oder als Projektbudget mit festem Zeitraum (O-5). Es wird vom Admin oder vom Kostenstellen-Admin dieser Kostenstelle gesetzt. Die Summe der Verbräuche aller zugeordneten User und Keys darf dieses Budget nicht überschreiten.
- **F-KST-5** Bei Erreichen von 80 % und 100 % des Max-Budgets werden der Kostenstellenverantwortliche und die Kostenstellen-Admins der Kostenstelle per E-Mail benachrichtigt. Schwellwerte konfigurierbar.
- **F-KST-6** Bei 100 % werden alle Keys der Kostenstelle in LiteLLM gesperrt (O-4). Die Sperre wird automatisch aufgehoben, wenn ein neuer Budgetzeitraum beginnt oder ein Admin bzw. Kostenstellen-Admin das Max-Budget erhöht.
- **F-KST-7** Die Default-Kostenstelle `1111 1111` ist immer vorhanden, freigegeben und nicht archivierbar. Auf sie laufen alle Requests über kostenfreie Provider (siehe 4.5).
- **F-KST-8** Den Screen „Meine Kostenstellen“ sehen nur User, die Kostenstellen-Admin mindestens einer Kostenstelle sind. Er zeigt nur diese Kostenstellen mit Budget, Verbrauch, Mitgliedern, Usern und Keys. Das gilt auch für Admins: Ohne eigene Zuordnung sehen sie den Screen nicht und nutzen „Admin: Kostenstellen“ (E-10). Auch die API (`GET /cost-centers`, `GET /cost-centers/{id}`) liefert Budget, Verbrauch, Zeitraum, Verantwortlichen und freigegebene Modelle nur Admins und den Kostenstellen-Admins der jeweiligen Kostenstelle; alle anderen erhalten nur Nummer, Bezeichnung, Status und Default-Kennzeichen.
- **F-KST-9** Jede freigegebene Kostenstelle (inkl. Default) ist ein LiteLLM-Team (E-8): `team_id` = Kostenstellen-ID, `team_alias` = Nummer und Bezeichnung, `metadata.cost_center` = Nummer. Mitglieder der Kostenstelle (F-KST-10) sind Team-Mitglieder, Kostenstellen-Admins sind Team-Admins; im Team der Default-Kostenstelle ist jeder aktive User. Keys werden mit `team_id` angelegt. Max-Budget und Zeitraum werden als `max_budget` / `budget_duration` des Teams gespiegelt, damit LiteLLM sie zusätzlich selbst durchsetzt; Sperren (F-KST-6, Archivierung) laufen über `/team/block`. Antrag, Freigabe, Ablehnung und Archivierung bleiben in LiteLite, weil LiteLLM keinen Freigabestatus kennt. Ist LiteLLM nicht erreichbar, wird die Team-Synchronisation protokolliert und beim nächsten Zugriff nachgeholt.
- **F-KST-10** **Mitglieder:** Jede freigegebene Kostenstelle außer der Default-Kostenstelle hat eine Mitgliederliste mit der Rolle `user` (Mitglied) oder `admin` (Kostenstellen-Admin). Ein User kann Mitglied mehrerer Kostenstellen sein, eine Kostenstelle kann mehrere Kostenstellen-Admins haben. Admins verwalten die Mitglieder aller Kostenstellen, Kostenstellen-Admins die ihrer eigenen: hinzufügen, Rolle ändern, entfernen. Jede Änderung wird nach LiteLLM gespiegelt (F-KST-9), im Audit-Log protokolliert und dem Betroffenen per Mail mitgeteilt. Für die Default-Kostenstelle gibt es keine Mitgliederliste, weil jeder User ihr angehört. Neue Mitglieder kommen per Hinzufügen (F-KST-11) oder per Beitrittsanfrage (F-KST-16).
- **F-KST-11** **Hinzufügen nur bekannter LiteLLM-User (Stufe 1):** Hinzugefügt werden können nur Personen, die LiteLLM bereits kennt (Suche per E-Mail-Teilstring oder User-ID, mindestens 3 Zeichen, höchstens 20 Treffer), auch wenn sie sich noch nie im Portal angemeldet haben. Die Mitgliedschaft hängt an der LiteLLM-`user_id` und gilt im Portal ab dem ersten Login (F-AUTH-2). Deaktivierte User können nicht hinzugefügt werden. **Mehrere auf einmal:** Kostenstellen-Admins und Admins fügen bis zu 200 E-Mail-Adressen ein (`MEMBER_BULK_MAX`; getrennt durch Komma, Semikolon oder Zeilenumbruch, auch `Name <mail>`). Ein Prüfschritt ordnet sie exakt (ohne Groß-/Kleinschreibung) LiteLLM-Usern zu und zeigt gefunden, ohne LiteLLM-User und ungültig; danach werden die gefundenen einzeln wie beim Hinzufügen übernommen, Fehler (z. B. `COST_CENTER_MEMBER_EXISTS`, `USER_DEACTIVATED`) werden pro User gemeldet, ohne den Rest abzubrechen. Einladungen per E-Mail an Personen, die LiteLLM noch nicht kennt, sind eine spätere Stufe.
- **F-KST-12** Keys können nur auf der Default-Kostenstelle und auf Kostenstellen angelegt werden, deren Mitglied der User ist. Wird ein Mitglied entfernt, werden seine Keys auf dieser Kostenstelle gelöscht (LiteLLM löscht die Team-Keys eines Mitglieds bei `/team/member_delete` ohnehin); nach erneutem Hinzufügen legt es neue Keys an; zeigt sein Profil auf diese Kostenstelle, fällt es auf die Default-Kostenstelle zurück. Die erste eigene Kostenstelle eines Users ersetzt die Default-Kostenstelle im Profil.
- **F-KST-13** Kostenstellen-Admins ernennen, herabstufen oder entfernen kann nur der Verantwortliche der Kostenstelle (F-KST-14) oder ein Admin (`COST_CENTER_OWNER_ONLY`). Weitere Kostenstellen-Admins fügen nur Mitglieder mit Rolle `user` hinzu und entfernen sie. Da der Verantwortliche immer Admin bleibt, verliert eine Kostenstelle nie ihren letzten Admin. Ohne verknüpften Verantwortlichen verwalten nur Admins die Kostenstellen-Admins (E-12).
- **F-KST-14** **Verantwortlicher:** Der Verantwortliche einer Kostenstelle ist ein LiteLLM-User (`owner_user_id`) und immer ihr Kostenstellen-Admin. Admins wählen ihn beim Anlegen und Bearbeiten aus den LiteLLM-Usern; in Anträgen wird er per E-Mail genannt, die genau einem LiteLLM-User gehören muss (sonst `OWNER_NOT_LITELLM_USER`), ohne Angabe ist es der Antragsteller. Er wird bei Anlage bzw. Freigabe Kostenstellen-Admin und kann weder entfernt noch herabgestuft werden, solange er Verantwortlicher ist (`COST_CENTER_OWNER_MUST_BE_ADMIN`, auch für Admins). Nach einem Wechsel bleibt der bisherige Verantwortliche Admin, bis er herabgestuft wird. Name und E-Mail kommen aus dem Portal-Konto, sonst aus LiteLLM. Bestehende Kostenstellen werden per E-Mail mit vorhandenen Usern verknüpft; nicht verknüpfte erscheinen im Admin-Screen als „Verantwortlicher fehlt“, bis ein Admin einen wählt. Per Migration angelegte Mitgliedschaften werden beim nächsten API-Start einmalig nach LiteLLM gespiegelt.
- **F-KST-15** **Freigegebene Modelle:** Admins legen pro Kostenstelle fest, welche Modelle sie nutzen darf. Ohne Auswahl sind alle Modelle freigegeben; die Klassenregel (F-PRV-1, kostenpflichtig nicht auf `1111 1111`) gilt zusätzlich. Die Auswahl wird als `models` des LiteLLM-Teams gespiegelt, sodass LiteLLM sie auch für bestehende Keys durchsetzt. Key-Erstellung (F-PRV-3) und Provider-Keys (F-KEY-10) bieten nur freigegebene Modelle an; wird die Freigabe erweitert, erhalten Provider-Keys die neuen Modelle (E-12). Der Auswahldialog gruppiert die Modelle nach Provider (einklappbar); ein Provider-Haken wählt alle aktuellen Modelle des Providers, dazu Filterfeld sowie „Alle auswählen“ / „Auswahl aufheben“.
- **F-KST-16** **Beitrittsanfragen:** Im Screen „Kostenstellen“ sieht jeder User die freigegebenen Kostenstellen nur mit Bezeichnung (ohne Nummer), suchbar, die eigenen oben, mit Status Mitglied / Angefragt / Abgelehnt (mit Begründung). Er fragt den Beitritt mit optionaler Nachricht an; Verantwortlicher und Kostenstellen-Admins erhalten eine Mail (`cost_center_join_request_created`). Kostenstellen-Admins der Kostenstelle und Admins nehmen an (der User wird Mitglied mit Rolle `user`, wie F-KST-10) oder lehnen mit Pflichtbegründung ab (Mail `cost_center_join_request_rejected`). Pro User und Kostenstelle ist höchstens eine Anfrage offen (`COST_CENTER_JOIN_REQUEST_PENDING`). Nicht möglich für die Default-Kostenstelle, nicht freigegebene Kostenstellen (`COST_CENTER_NOT_APPROVED`) und bei bestehender Mitgliedschaft (`COST_CENTER_MEMBER_EXISTS`). Offene Anfragen stehen in der Mitgliederliste oben; der Button „Mitglieder“ in „Meine Kostenstellen“ und „Admin: Kostenstellen“ zeigt ihre Anzahl. Anfrage, Annahme und Ablehnung werden im Audit-Log protokolliert (E-13).

### 4.4 API-Keys (Self-Service)

- **F-KEY-1** Der User sieht seine Keys in einer Liste: Name, maskierter Key, Kostenstelle (nur Bezeichnung, ohne Nummer, E-12), Provider/Modelle, Erstellungsdatum, Ablaufdatum, Status, Verbrauch. Referenz: SAIA-Screenshot im PDF.
- **F-KEY-2** Der User legt Keys selbst an (`/key/generate` in LiteLLM) mit: Name (Pflicht), Auswahl eines oder mehrerer Provider/Modelle aus der für ihn verfügbaren Menge (siehe 4.5), Kostenstelle (Pflicht, Default `1111 1111`), optionalem Key-Budget. Wählbar sind die Default-Kostenstelle und die Kostenstellen, deren Mitglied der User ist (F-KST-12). Der Key wird in LiteLLM dem User (gleiche ID) und dem Team der Kostenstelle zugeordnet (F-KST-9). Der Reiter „Modelle“ gruppiert die Modelle nach Provider.
- **F-KEY-3** Der Key wird nach Erstellung genau einmal im Klartext angezeigt und ist kopierbar.
- **F-KEY-4** Jeder Key hat ein Ablaufdatum („Gültig bis“), beim Anlegen frei wählbar zwischen morgen und Erstellung + 6 Monaten (Default: Erstellung + 6 Monate; Dauer `KEY_LIFETIME_DAYS`). Es ist nachträglich änderbar: verkürzen jederzeit, verlängern höchstens bis Erstellung + 6 Monate. Die Grenze prüft das Backend bei Anlegen und Ändern; LiteLLM begrenzt zusätzlich per `upperbound_key_generate_params.duration` (#11).
- **F-KEY-5** 7 Tage und 1 Tag vor Ablauf erhält der User eine E-Mail mit Link „Key erneuern“. Das Ablaufdatum wird als `expires` am LiteLLM-Key gesetzt; LiteLLM lehnt abgelaufene Keys selbst ab. Bei Ablauf markiert ein Job den Key als „Abgelaufen“ und benachrichtigt den User, sperrt ihn aber nicht (`block` bleibt für manuelle Sperren und Budgets) (#11).
- **F-KEY-5a** Statt Verlängern: **Erneuern** erzeugt einen neuen Key (neues Secret) mit denselben Einstellungen (Name, Kostenstelle, Modelle/Provider, Budget) und neuem Ablaufdatum (max. + 6 Monate). Der alte Key bleibt bis zu seinem Ablauf gültig, optional wird er sofort gelöscht. Keine automatische Rotation. Manuell gesperrte Keys lassen sich nicht erneuern. Jede Erneuerung wird im Audit-Log protokolliert (#11).
- **F-KEY-6** Der User kann Keys löschen (`/key/delete`). Der bisherige Verbrauch des Keys bleibt in Reports und Snapshots erhalten.
- **F-KEY-7** Ein Key kann nur einer freigegebenen Kostenstelle zugeordnet werden, deren Mitglied der User ist (Default-Kostenstelle immer). Kostenpflichtige Provider sind nur mit einer Kostenstelle ungleich `1111 1111` wählbar.
- **F-KEY-8** Admins sehen alle Keys aller User und können sie sperren oder löschen.
- **F-KEY-9** Jeder User kann auf der Seite „Key testen“ einen Key eingeben, eines der für den Key freigegebenen Modelle wählen (`/v1/models` mit dem Key) und einen kurzen Prompt senden (`/v1/chat/completions` mit dem Key, Antwort begrenzt). Angezeigt werden Antwort, Modell, Dauer und Tokens. Der Key wird nicht gespeichert oder geloggt, auch nicht in Fehlermeldungen; er muss aus druckbaren ASCII-Zeichen ohne Leerzeichen bestehen. Der Request wird über den Key abgerechnet.
- **F-KEY-10** Bei der Key-Erstellung kann der User statt einzelner Modelle ganze Provider wählen (Reiter „Provider“). Der Key erhält alle aktuellen Modelle des Providers, die für seine Kostenstelle erlaubt sind (F-PRV-3). Neue Modelle des Providers werden nach dem Provider-Abgleich automatisch ergänzt; Modelle werden dabei nur hinzugefügt, nie entfernt.
- **F-KEY-11** **Zeitfenster des Key-Budgets:** Ein Key-Budget gilt entweder **monatlich** (Default; LiteLLM `budget_duration` `30d`, Reset zum Monatsersten) oder **ohne Zeitfenster** einmal für die Laufzeit des Keys. Bei monatlichem Budget zeigt die Key-Liste den Verbrauch des laufenden Kalendermonats. Ohne Betrag gibt es kein Zeitfenster (E-12).

### 4.5 Provider-Verwaltung

- **F-PRV-1** Admins sehen die in LiteLLM konfigurierten Modelle/Provider (`/model/info`) und ordnen jedem eine Verfügbarkeitsklasse zu: `free` (immer verfügbar, läuft auf `1111 1111`) oder `paid` (nur mit freigegebener Kostenstelle). Die Liste ist nach Provider und Modell sortiert und nach Provider gruppiert; ein Klick auf den Modellnamen öffnet die Bearbeitung.
- **F-PRV-2** Neue Modelle in LiteLLM erscheinen automatisch mit Klasse `paid`, bis ein Admin sie umstuft.
- **F-PRV-3** Bei Key-Erstellung sieht der User nur die Modelle, die zu seiner Kostenstelle passen.
- **F-PRV-4** Admins können pro Modell eine Anzeigebezeichnung und Beschreibung (de/en) hinterlegen.

### 4.6 Budget

- **F-BUD-1** Admins weisen einem User ein Budget zu: Betrag in EUR und Zeitraum `monthly`, `yearly` oder `project` mit festem Start und Ende (O-5). Das Budget wird nach LiteLLM synchronisiert (`/user/update` mit `max_budget` und `budget_duration`; Projektbudgets ohne `budget_duration`, Ablauf wird von LiteLite überwacht).
- **F-BUD-1a** Bei 100 % des User-Budgets werden alle Keys des Users in LiteLLM gesperrt (O-4). Aufhebung wie in F-KST-6.
- **F-BUD-2** Das Dashboard zeigt dem User unter der Übersicht (F-BUD-8) im Abschnitt „Budget und Verbrauch“ für einen wählbaren Monat, orientiert am LiteLLM-Spend-Dashboard (Referenz im PDF):
  - zugewiesenes Budget, Verbrauch, Restbudget, Auslastung in %
  - Kennzahlen: Requests gesamt, erfolgreich, fehlgeschlagen, Ø Kosten pro Request, Tokens gesamt
  - Tagesverlauf des Verbrauchs
  - Top-Keys, Top-Modelle, Verbrauch nach Provider
  - Verlauf der letzten 12 Monate
- **F-BUD-3** Der Budget-Screen zeigt dem Admin zusätzlich: alle User mit Budget/Verbrauch, filterbar nach Kostenstelle, sortierbar, mit Warnmarkierung bei > 80 %.
- **F-BUD-4** Verbrauchsdaten werden aus LiteLLM gelesen (Spend-Logs bzw. `/spend/*`-Endpoints). LiteLite speichert einen täglichen Aggregat-Snapshot im eigenen Schema für Reports und Historie.
- **F-BUD-5** Der User erhält bei 80 % und 100 % seines Budgets eine E-Mail.
- **F-BUD-6** Der User kann sein Budget auf seine Keys aufteilen (Key-Budget in LiteLLM). Die Summe der Key-Budgets darf das User-Budget nicht überschreiten. Beim Löschen eines Keys wird dessen Budgetanteil wieder frei; der bereits angefallene Verbrauch bleibt dem User zugerechnet.
- **F-BUD-7** User können ihr eigenes Budget nicht ändern (Entscheidung E-2).
- **F-BUD-8** **Dashboard-Übersicht:** Oberhalb des Budgets zeigt das Dashboard zwei Karten. „API-Keys“: Anzahl aktiver Keys; ohne Key ein Hinweis mit direktem Anlegen (F-KEY-2), sonst Hinweise auf gesperrte und abgelaufene Keys sowie Keys, die innerhalb von 14 Tagen ablaufen (`KEY_EXPIRY_WARN_DAYS`, wie F-KEY-5). „Kostenstellen“: die Kostenstellen, auf denen der User Keys anlegen kann, und seine offenen Beitrittsanfragen, mit Einstieg zum Beitritt (F-KST-16).

### 4.7 Request-Logger

- **F-LOG-1** Der User sieht seine eigenen Requests 1:1 aus den LiteLLM-Logs mit den Spalten des LiteLLM-Request-Log-Screens (Referenz im PDF): Zeit, Typ, Status, Session-ID, Request-ID, Kosten, Dauer, TTFT, Key-Alias, Modell, Tokens (Input + Output), Tags. Neue Requests erscheinen mit einigen Minuten Verzögerung: LiteLLM schreibt seine Spend-Logs asynchron, LiteLite holt sie per Cron ab (`LOG_INGEST_CRON`, Default alle 5 Minuten; Admins können den Abruf über `POST /admin/jobs/ingest` anstoßen).
- **F-LOG-2** Filter: Zeitraum, Modell, Key, Status; Suche nach Request-ID. Paginierung serverseitig.
- **F-LOG-3** Request- und Response-Inhalte werden **nicht** angezeigt oder gespeichert, nur Metadaten.
- **F-LOG-4** Detailansicht eines Requests als Sheet (shadcn).
- **F-LOG-5** Jeder User, auch Admin und Kostenstellen-Admin, sieht ausschließlich seine eigenen Requests (Entscheidung E-4). Eine Sicht auf Requests anderer User ist nicht Teil des Scopes. Aggregierte Verbräuche anderer User sind nur über Reports (4.8) sichtbar.

### 4.8 Reports, Export und Umbuchungen

> Excel-Export (F-REP-2) und Umbuchungen (F-REP-4, F-REP-5) sind **Release 2**. Im MVP wird nur der Report F-REP-1 im UI umgesetzt. Das SAP-Format (O-1) wird bis dahin geklärt.

- **F-REP-1** Report „Budgetverbrauch“: pro Kostenstelle Budget, Verbrauch, Rest, Auslastung in %, für einen wählbaren Monat oder Zeitraum. Drill-down auf User und Keys innerhalb der Kostenstelle.
- **F-REP-2** Excel-Export (`.xlsx`) aller Kostenstellen für den gewählten Zeitraum. Vorläufige Spalten: Kostenstelle, Bezeichnung, Verantwortlicher, User, E-Mail, Key-Name, Verbrauch EUR, Budget EUR, Zeitraum.
- **F-REP-3** Admins sehen Report und Export für alle Kostenstellen. Kostenstellen-Admins sehen Report und Export nur für ihre zugeordneten Kostenstellen, mit Aufschlüsselung nach Usern und Keys.
- **F-REP-4** **Umbuchung:** Der Admin stößt für einen definierbaren Zeitraum eine Umbuchung an. Ergebnis ist eine XLS-Datei, die die Finanzabteilung automatisiert in SAP importiert. Jede Umbuchung wird mit Zeitraum, Zeitstempel, auslösendem Admin und Dateiablage protokolliert; ein Zeitraum kann nur einmal umgebucht werden, es sei denn, der Admin bestätigt eine Wiederholung.
- **F-REP-5** Das SAP-Spaltenformat wird noch geklärt (Kapitel 12, O-1). Der Export ist als konfigurierbare Spaltenliste zu bauen, damit das Format ohne Codeänderung angepasst werden kann.

### 4.9 Benachrichtigungen

- **F-NOT-1** Versand über Nodemailer (SMTP), Konfiguration per Env.
- **F-NOT-2** Vorlagen zweisprachig (de/en), Sprache gemäß User-Profil.
- **F-NOT-3** Ereignisse:

| Ereignis | Empfänger |
|---|---|
| Kostenstellenantrag eingegangen | Admins |
| Antrag freigegeben / abgelehnt | User |
| Beitrittsanfrage eingegangen (`cost_center_join_request_created`) | Verantwortlicher, Kostenstellen-Admins der Kostenstelle |
| Beitrittsanfrage angenommen (Mail „Zur Kostenstelle hinzugefügt“, F-KST-10) / abgelehnt (`cost_center_join_request_rejected`) | User |
| User-Budget 80 % / 100 % | User |
| Kostenstellen-Budget 80 % / 100 % | Kostenstellenverantwortlicher, Kostenstellen-Admins der Kostenstelle |
| Rolle vergeben / entzogen | betroffener User |
| Key läuft in 14 Tagen / 1 Tag ab | User |
| Key abgelaufen und gesperrt | User |
| Budget erschöpft, Keys gesperrt | User bzw. Kostenstellenverantwortlicher und Kostenstellen-Admins |
| Account ungültig, Login und Keys gesperrt | User, Admins |
| Löschfrist nach Softdelete erreicht | Admins |
| Umbuchung erzeugt | Admins |

- **F-NOT-4** Jede versendete Mail wird mit Empfänger, Typ, Zeitstempel und Status in der DB protokolliert.

### 4.10 Userverwaltung, Softdelete und Austrittsprozess

- **F-USR-1** Admins sehen eine Userliste: Name, E-Mail, Rolle, Kostenstelle, Budget, Verbrauch, Anzahl Keys, Status, letzter Login.
- **F-USR-1a** **Rollenpflege:** Admins setzen im Screen „User / Rollen“ die Rolle eines Users (`user` / `admin`) und ordnen Kostenstellen-Admins ihre Kostenstellen zu. Jede Änderung wird im Audit-Log protokolliert und dem User per Mail mitgeteilt.
- **F-USR-2** Admins können einen User deaktivieren (Softdelete). Wirkung: Login gesperrt, alle LiteLLM-Keys des Users gesperrt, `deleted_at` gesetzt, Daten bleiben für Reports erhalten.
- **F-USR-3** Deaktivierte User sind in Listen standardmäßig ausgeblendet und per Filter einblendbar. Reaktivierung durch Admin möglich; Keys bleiben dabei gesperrt und müssen neu angelegt werden.
- **F-USR-4** **Austrittsprozess:** Ein Cron-Job prüft regelmäßig (Default täglich) für alle aktiven User gegen Keycloak, ob der Account noch gültig ist (F-AUTH-6). Ungültige Accounts werden automatisch soft-deleted; User und Admins werden benachrichtigt. Die Prüfung läuft über die Keycloak-Admin-API (Service-Account-Client mit `view-users`, siehe docs/kb/keycloak.md); ist kein Admin-Client konfiguriert, gelten die beim letzten Login erfassten Claims. Bei Keycloak-Fehlern wird niemand deaktiviert, nur protokolliert (O-7).
- **F-USR-5** Nach einer konfigurierbaren Frist (Default 12 Monate) nach Softdelete werden Admins per Mail auf die endgültige Löschung hingewiesen. Die endgültige Löschung ist eine manuelle Admin-Aktion mit Bestätigung und entfernt User, Keys und Profildaten; aggregierte Spend-Snapshots bleiben anonymisiert erhalten.
- **F-USR-6** Ein User kann sich nicht selbst löschen.
- **F-USR-7** **Impersonation (Debugging):** Ist `IMPERSONATION_ENABLED=true`, kann ein Admin im Screen „User / Rollen“ in seiner laufenden Session als ein anderer aktiver User handeln (`POST /admin/users/{id}/impersonate`) und dies jederzeit beenden (`DELETE /me/impersonation`). Während der Impersonation gelten Rolle und Rechte des Ziel-Users; eigene Admin-Rechte ruhen. Nicht möglich für sich selbst und deaktivierte User. Start und Ende werden im Audit-Log protokolliert, ebenso jede Aktion während der Impersonation mit dem Admin als `impersonatedBy`; die Oberfläche zeigt dauerhaft einen Hinweisbalken. Default: aus.
- **F-USR-8** **LiteLLM-User-Suche:** Admins durchsuchen im Screen „LiteLLM-User“ die Konten des LiteLLM-Proxys (E-Mail-Teilstring oder User-ID, `GET /admin/litellm-users`), inklusive Personen ohne LiteLite-Login. Jede Zeile zeigt das passende LiteLite-Konto mit Status oder „noch nie angemeldet“. Nur lesend; braucht einen LiteLLM-Key mit Proxy-Admin-Rechten.

### 4.11 Dokumentation im UI

- **F-DOC-1** Die Benutzerdokumentation wird direkt in der Anwendung als shadcn Sheet angezeigt, aufrufbar von jedem Screen über einen Hilfe-Button in der Kopfzeile.
- **F-DOC-2** Die Doku ist kontextsensitiv: der aktuell geöffnete Screen bestimmt den vorausgewählten Abschnitt.
- **F-DOC-3** Inhalte liegen als Markdown im Repository (de/en) und werden beim Build gebündelt.

### 4.12 Internationalisierung und Darstellung

- **F-I18N-1** Sprachen Deutsch und Englisch. Default aus Browser-Sprache, umschaltbar in der Kopfzeile und im Profil.
- **F-I18N-2** Alle UI-Texte, Fehlermeldungen, E-Mails und Doku sind übersetzt. Zahlen-, Währungs- und Datumsformat sprachabhängig.
- **F-UI-1** Hell- und Dunkelmodus, umschaltbar in der Kopfzeile, Default aus Systemeinstellung (Referenz: SAIA-Screenshot im PDF).

## 5. Nicht-funktionale Anforderungen

| Bereich | Anforderung |
|---|---|
| Deployment | Docker-Image (Multi-Stage-Build), `docker-compose.yml` für lokale Entwicklung. Konfiguration ausschließlich über Env-Variablen. |
| Umgebungen | `dev`, `staging`, `prod` mit getrennten Keycloak-Clients, LiteLLM-Instanzen und DB-Schemas bzw. DB-Hosts. |
| Sicherheit | Alle Endpoints authentifiziert; Rollenprüfung serverseitig; CSRF-Schutz via Better Auth; LiteLLM-Master-Key nur im Backend; keine Secrets im Frontend-Bundle; Klartext-Keys werden nie in LiteLite gespeichert. |
| Datenschutz | Keine Speicherung von Prompt-/Response-Inhalten. Softdelete mit Löschfrist. |
| Performance | Listen mit serverseitiger Paginierung; Log-Ansicht < 1 s bei 100 k Einträgen; Spend-Snapshots täglich per Cron. |
| Verfügbarkeit | Stateless Backend; Neustart ohne Datenverlust; Health-Endpoint `/health`. |
| Logging | Strukturierte JSON-Logs (Backend), Request-ID pro Anfrage, Audit-Log für alle Admin-Aktionen. |
| Backup | DB-Backup erfolgt über die bestehende VMware-Infrastruktur, nicht Teil des Projekts. |
| Browser | Aktuelle Versionen von Chrome, Firefox, Edge, Safari. Responsive ab 375 px. |

## 6. Technischer Stack

| Schicht | Technologie |
|---|---|
| Frontend | React, TanStack Router, TanStack Query, TanStack Table, shadcn/ui, Tailwind CSS, i18next |
| Backend | Hono.js (Node/Bun), Drizzle ORM, Better Auth (OIDC/Keycloak), Zod-Validierung |
| Datenbank | PostgreSQL, Schema `litelite` auf dem LiteLLM-DB-Host, Migrationen via Drizzle Kit |
| E-Mail | Nodemailer (SMTP) |
| Export | `exceljs` für `.xlsx` |
| Jobs | Cron im Backend (Spend-Snapshot, Budget-Checks, Key-Ablauf, Austrittsprüfung, Löschhinweis) |
| Tests | Vitest (Unit/Integration/API), Playwright (E2E) |
| Build/Deploy | Docker, GitHub Actions oder vergleichbare CI |

Projektstruktur (Monorepo, Vorschlag): `apps/web`, `apps/api`, `packages/db`, `packages/shared` (Typen, Zod-Schemas, i18n-Keys).

## 7. API-Design (API first)

Das Backend wird vor dem Frontend gebaut. Die OpenAPI-Spezifikation ist der Vertrag zwischen Backend, Frontend und Tests; kein Screen wird begonnen, bevor die zugehörigen Endpunkte spezifiziert und getestet sind.

### 7.1 Grundsätze

| Grundsatz | Umsetzung |
|---|---|
| Vertrag zuerst | Jede Route wird mit `@hono/zod-openapi` definiert: Request- und Response-Schemas in Zod, daraus OpenAPI 3.1. Handler validieren ein- und ausgehend gegen diese Schemas. |
| Geteilte Schemas | Zod-Schemas liegen in `packages/shared`. Das Frontend nutzt den Hono-RPC-Client (`hc`) und ist ohne Codegen typsicher. |
| Versionierung | Alle Routen unter `/api/v1`. Nach dem MVP wird v1 eingefroren; Breaking Changes nur in `/api/v2`. |
| Dokumentation | Spec unter `/api/openapi.json`, interaktive Doku unter `/api/docs` (Scalar). In prod nur für Admins erreichbar. |
| Antworten | JSON, Fehler im Format `{ code, message, details? }` mit stabilen `code`-Werten (z. B. `COST_CENTER_NOT_APPROVED`). Listen mit `{ items, total, page, pageSize }`. |
| Keine Durchreichung | Endpunkte geben ausschließlich Felder zurück, die im Response-Schema stehen. LiteLLM-Antworten werden gemappt, nie weitergereicht. |

### 7.2 Sicherheitskette

Jede Route unter `/api/v1` durchläuft in dieser Reihenfolge:

1. **Session** (Better Auth): HttpOnly-Cookie prüfen, User laden, Softdelete und Account-Gültigkeit (F-AUTH-6) prüfen.
2. **CSRF**: Bei `POST`/`PUT`/`PATCH`/`DELETE` muss der `Origin`-Header der eigenen Domain entsprechen.
3. **Rollen-Guard**: Route deklariert die erlaubten Rollen (`user`, `cost_center_admin`, `admin`).
4. **Scope-Guard**: Für Kostenstellen-Admins wird geprüft, ob die adressierte Kostenstelle ihnen zugeordnet ist. Für User wird geprüft, ob die Ressource (Key, Log, Budget) ihnen gehört.
5. **Handler**.

Es gibt keine Route ohne diese Kette. Öffentlich sind nur `/health` und die Better-Auth-Callbacks.

### 7.3 LiteLLM-Adapter

LiteLLM wird hinter einem Interface gekapselt, das nur im Backend existiert:

```
LiteLLMAdapter
  // User (LiteLLM ist die User-Liste, E-7)
  getUser(userId) -> User | null
  listUsers({ page, pageSize, email? }) -> { items, total }
  createUser({ userId, email, alias?, ssoUserId? })
  updateUser(userId, { email?, alias?, ssoUserId? })
  updateUserBudget(userId, { maxBudget, budgetDuration })
  blockUser(userId, blocked)
  // Teams = Kostenstellen (E-8)
  getTeam(teamId) -> Team | null
  createTeam({ teamId, alias, maxBudget, budgetDuration, metadata? })
  updateTeam(teamId, { alias?, maxBudget?, budgetDuration? })
  setTeamBlocked(teamId, blocked)
  setTeamMember(teamId, userId, role) / removeTeamMember(teamId, userId)
  // Keys, Modelle, Spend
  createKey({ userId, teamId, alias, models, maxBudget, expiresAt }) -> { keyId, secret }
  updateKey(keyId, { models?, maxBudget?, expiresAt?, blocked?, alias? })
  deleteKey(keyId)
  listModels() -> Model[]
  getSpendLogs(since, until) -> SpendLog[]
```

Es gibt eine echte Implementierung (REST gegen `LITELLM_BASE_URL` mit `LITELLM_API_KEY`) und einen Mock für Tests. Der Master-Key ist nur im Adapter sichtbar. Der Klartext eines neuen Keys wird einmal an den Aufrufer zurückgegeben und nie gespeichert. Die Kompatibilität des Adapters wird gegen die auf `litellm.safeaiplus.de` laufende Version verifiziert, sobald der Admin-Key vorliegt.

### 7.4 Ressourcen und Endpunkte (MVP)

| Ressource | Endpunkte | Rollen |
|---|---|---|
| `me` | `GET /me`, `PATCH /me` (Sprache, Kostenstelle, Verantwortlicher) | alle |
| `cost-centers` | `GET /cost-centers` (Lookup, nur `approved`), `POST /cost-centers` (Antrag), `GET /cost-centers/:id` | alle |
| | `PATCH /cost-centers/:id` (Bezeichnung, Verantwortlicher, Max-Budget), `POST /cost-centers/:id/archive` | admin, cost_center_admin (nur Max-Budget, nur eigene) |
| `cost-center-members` | `GET /cost-centers/:id/members`, `GET /cost-centers/:id/member-candidates?q=` (LiteLLM-User), `POST /cost-centers/:id/members`, `PATCH /cost-centers/:id/members/:userId` (Rolle), `DELETE /cost-centers/:id/members/:userId`, `POST /cost-centers/:id/member-candidates/resolve` (E-Mail-Liste prüfen), `POST /cost-centers/:id/members/bulk` (F-KST-11) | admin, cost_center_admin (nur eigene) |
| `join-requests` | `GET /me/join-requests`, `POST /me/join-requests` (F-KST-16) | alle |
| | `GET /cost-center-join-requests` (offene Anfragen aller verwalteten Kostenstellen, für Admins aller), `GET /cost-centers/:id/join-requests`, `POST /cost-centers/:id/join-requests/:requestId/approve`, `POST /cost-centers/:id/join-requests/:requestId/reject` | admin, cost_center_admin (nur eigene) |
| `cost-center-requests` | `GET /cost-center-requests`, `POST /cost-center-requests/:id/approve`, `POST /cost-center-requests/:id/reject` | admin |
| `api-keys` | `GET /api-keys`, `POST /api-keys`, `DELETE /api-keys/:id`, `POST /api-keys/:id/extend`, `PATCH /api-keys/:id` (Budget) | user (eigene) |
| | `GET /admin/api-keys`, `POST /admin/api-keys/:id/block` | admin |
| `providers` | `GET /providers` (gefiltert nach Kostenstelle des Users) | alle |
| | `GET /admin/providers`, `PATCH /admin/providers/:id` (tier, Bezeichnungen), `POST /admin/providers/sync` | admin |
| `budgets` | `GET /me/budget`, `GET /me/spend?month=` | user |
| | `GET /admin/budgets`, `PUT /admin/users/:id/budget` | admin |
| `logs` | `GET /me/logs?from&to&model&key&status&requestId&page` | alle (nur eigene) |
| `reports` | `GET /reports/cost-centers?from&to`, `GET /reports/cost-centers/:id` | admin, cost_center_admin (nur eigene) |
| `users` | `GET /admin/users`, `GET /admin/users/:id`, `PATCH /admin/users/:id/role`, `PUT /admin/users/:id/cost-center-admin` (Liste Kostenstellen), `POST /admin/users/:id/deactivate`, `POST /admin/users/:id/reactivate` | admin |
| `notifications` | `GET /admin/notifications` | admin |
| `events` | `GET /admin/events` (Ereignisprotokoll: Änderungen, Alarme mit `severity=warning`, Fehler mit `severity=error`; Filter nach Stufe, Objekt, Ereignis, Akteur, Zeitraum) | admin |
| `health` | `GET /health` | öffentlich |

Release 2 ergänzt `GET /reports/cost-centers/export.xlsx`, `POST /admin/rebookings`, `GET /admin/rebookings`, `GET /admin/rebookings/:id/file` sowie `DELETE /admin/users/:id` (endgültige Löschung).

### 7.5 Vorgehen

1. Ressourcen und Schemas in `packages/shared` anlegen, Routen mit Stub-Handlern registrieren, Spec unter `/api/docs` prüfen.
2. Sicherheitskette bauen und mit Vitest gegen jede Route testen, inklusive Negativfälle (falsche Rolle, fremde Ressource, fehlender Origin).
3. LiteLLM-Adapter mit Mock, dann echte Handler und Drizzle-Zugriffe.
4. Playwright-API-Tests je Feature grün.
5. Erst danach der zugehörige Screen.

## 8. Datenmodell (Entwurf, Schema `litelite`)

| Tabelle | Wesentliche Felder |
|---|---|
| `user` | id (= LiteLLM `user_id`), email, name, role (`user` / `admin`), role_from_idp, locale, affiliation, affiliation_valid, cost_center_id, cost_center_owner_name, cost_center_owner_email, deleted_at, deleted_reason (`admin` / `affiliation`), last_login_at |
| `cost_centers` | id (= LiteLLM `team_id`), number (8), name, owner_name, owner_email, owner_user_id (= LiteLLM `user_id`, F-KST-14), max_budget, budget_period, period_start, period_end, models (F-KST-15), status, is_default, litellm_team_id, blocked_at, requested_by, approved_by, created_at, updated_at |
| `cost_center_requests` | id, user_id, cost_center_id, status, reason, decided_by, decided_at |
| `cost_center_join_requests` | id, cost_center_id, user_id, message, status (`pending` / `approved` / `rejected`), reason, decided_by, decided_at, created_at; höchstens eine offene Anfrage pro User und Kostenstelle (F-KST-16) |
| `cost_center_members` | cost_center_id, user_id (= LiteLLM `user_id`, ohne Fremdschlüssel, weil auch noch nie angemeldete LiteLLM-User Mitglied sein können), email, role (`user` / `admin`), added_by, added_at |
| `api_keys` | id, user_id, litellm_key_id, name, cost_center_id, models, providers, budget, budget_period (`monthly` / null, F-KEY-11), created_at, expires_at, last_extended_at, status (`active` / `expired` / `blocked` / `deleted`), deleted_at |
| `providers` | id, litellm_model_id, model_name, tier (`free` / `paid`), display_name_de, display_name_en, description_de, description_en |
| `budgets` | id, user_id, amount, period (`monthly` / `yearly` / `project`), period_start, period_end, assigned_by, created_at |
| `spend_snapshots` | id, user_id, api_key_id, cost_center_id, date, model, spend, tokens_in, tokens_out, request_count, failed_count |
| `rebookings` | id, period_start, period_end, created_by, created_at, file_path, row_count, total_amount |
| `notifications` | id, user_id, type, recipient, locale, sent_at, status, error |
| `audit_log` | id, actor_id, severity (`info` / `warning` / `error`), action, entity, entity_id, payload, created_at |
| Better-Auth-Tabellen | session, account, verification |

Verknüpfung zu LiteLLM ohne Mapping-Tabellen: `user.id` = LiteLLM `user_id`, `cost_centers.id` = LiteLLM `team_id` (`litellm_team_id` markiert, dass das Team angelegt wurde), `api_keys.litellm_key_id`. Das Keycloak-Subject steht in `account.account_id` (Better Auth). Spend-Daten werden aus LiteLLM gelesen, nie geschrieben.

## 9. Screens

| Screen | Rolle | Inhalt |
|---|---|---|
| Login | alle | Redirect zu Keycloak |
| Dashboard | User | Übersicht API-Keys und Kostenstellen (F-BUD-8), darunter Budget, Kennzahlen, Tagesverlauf, Top-Keys, Top-Modelle, Provider |
| API-Keys | User | Key-Liste, anlegen, löschen, Budget aufteilen |
| Nutzung | User | Eigene Requests, Filter, Detail-Sheet (Menüname „Nutzung“, früher „Requests“) |
| Kostenstellen | User | Freigegebene Kostenstellen nur mit Bezeichnung, eigene oben, Beitritt anfragen (F-KST-16) |
| Profil | User | Profildaten, Sprache |
| Meine Kostenstellen | Kostenstellen-Admin (auch Admins nur mit eigener Zuordnung) | Nur die Kostenstellen, deren Kostenstellen-Admin der User ist, Mitglieder und Kostenstellen-Admins verwalten (auch per E-Mail-Liste), Beitrittsanfragen entscheiden, Max-Budget setzen, Report nach Usern/Keys, Excel-Export (Release 2) |
| Admin: User / Rollen | Admin | Userliste, Rolle setzen, Kostenstellen-Admins zuordnen, Budget zuweisen, deaktivieren/reaktivieren, Keys sperren |
| Admin: Kostenstellen | Admin | Lookup pflegen, Anträge freigeben/ablehnen, Max-Budget, freigegebene Modelle, Mitglieder, Beitrittsanfragen |
| Admin: Modelle | Admin | Modelle aus LiteLLM nach Provider gruppiert, Klasse free/paid, Bezeichnungen; Klick auf den Modellnamen öffnet die Bearbeitung (Menüname seit E-12 „Modelle“ statt „Provider“) |
| Admin: Reports | Admin | Budgetverbrauch pro Kostenstelle, Excel-Export (Release 2) |
| Admin: Umbuchungen | Admin | Release 2: Zeitraum wählen, Umbuchung anstoßen, Historie, Datei-Download |
| Hilfe | alle | Doku-Sheet, kontextsensitiv |

Kopfzeile auf allen Screens: Sprache DE/EN, Hell/Dunkel, Hilfe, Benutzermenü.

## 10. Umgebungen

| Umgebung | Zweck | Besonderheiten |
|---|---|---|
| dev | Lokale Entwicklung | `docker-compose` mit Postgres und Mailhog; Keycloak: bestehende Instanz `keycloak.safeaiplus.de`, Realm `litelite-dev`; LiteLLM: bestehende Instanz `litellm.safeaiplus.de` |
| staging | Abnahme | Keycloak `keycloak.safeaiplus.de`, Realm `litelite-staging`; LiteLLM `litellm.safeaiplus.de`; DB-Schema `litelite_staging` auf dessen Postgres-Host; Test-SMTP |
| prod | Betrieb | Kunden-Keycloak, Kunden-LiteLLM, Schema `litelite` auf dessen Postgres-Host, echter SMTP |

Alle drei nutzen dasselbe Docker-Image, unterschieden nur durch Env-Variablen (`LITELLM_BASE_URL`, `LITELLM_API_KEY`, `DATABASE_URL`, `DB_SCHEMA`, `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_ADMIN_GROUP`, `SMTP_*`). Dev und staging teilen sich die LiteLLM-Instanz und deren Postgres-Host, getrennt nur durch das DB-Schema. Keycloak wird ausschließlich über OIDC-Discovery (`/.well-known/openid-configuration`) angebunden, damit dev/staging gegen `keycloak.safeaiplus.de` und prod gegen den Kunden-Keycloak ohne Codeänderung laufen.

## 11. Test-Strategie

- **Unit (Vitest):** Budget-Berechnung, Kostenstellen-Validierung (8 Ziffern, Formatierung), Rollenprüfung inkl. Kostenstellen-Scope, Admin-Gruppen-Sync aus Keycloak, Key-Verlängerung, Projektbudget-Ablauf, Key-Ablauf-Logik, Provider-Filter nach Kostenstelle, Export-Generierung, i18n-Vollständigkeit (alle Keys in de und en), LiteLLM-Adapter (User-, Team- und Key-Endpunkte gegen Fake-Fetch), Übernahme bestehender LiteLLM-User und Team-Synchronisation (Mitgliedschaft, Rollen, Budget, Sperre) gegen den Mock.
- **API/Integration (Vitest):** Alle Endpoints gegen Test-DB und LiteLLM-Mock-Adapter; Sicherheitskette je Route mit Negativfällen; Responses gegen die OpenAPI-Spec validiert; Keycloak-Attributprüfung gegen Mock.
- **E2E (Playwright):** Login via Keycloak-Testrealm; User legt Key an und sieht ihn einmalig; Profil ohne Kostenstelle, Kostenstellenantrag per API, Admin gibt frei; Admin ernennt Kostenstellen-Admin, dieser setzt Max-Budget und sieht nur seine Kostenstelle; Kostenstellen-Admin fügt einen bekannten LiteLLM-User als Mitglied hinzu, ernennt ihn zum zweiten Admin und entfernt ihn wieder; Kostenstellen-Admin fügt mehrere Mitglieder per E-Mail-Liste hinzu und nimmt Beitrittsanfragen an bzw. lehnt sie ab; Dashboard zeigt Key-Hinweise und Kostenstellen; Admin weist Budget zu, User sieht es; User und Admin sehen nur eigene Logs; kostenpflichtiges Modell ohne Kostenstelle nicht wählbar; Excel-Export und Umbuchung herunterladen und Inhalt prüfen; Softdelete und Reaktivierung; Sprachwechsel; Dark Mode; Doku-Sheet öffnen.
- **CI:** Lint, Typecheck, Unit und Integration bei jedem Push; E2E gegen Staging vor Prod-Deploy.

## 12. Offene Punkte

### Entscheidungen (E-1 bis E-6 am 2026-09-19, E-7 und E-8 am 2026-09-20, E-9 bis E-12 am 2026-10-01, E-13 am 2026-10-05)

| Nr. | Thema | PDF | Anforderungsliste | Entscheidung | Umgesetzt in |
|---|---|---|---|---|---|
| E-1 | Rolle Kostenstellen-Admin | Eigene Rolle | Nur `user` und `admin` | **Dritte Rolle Kostenstellen-Admin**, pro Kostenstelle zugeordnet | Kap. 3, F-KST-4/5/8, F-REP-3, F-USR-1a |
| E-2 | Budget setzen | User stellt eigenes Budget ein | Admin weist zu | **Admin weist zu**; User verteilt nur auf seine Keys | F-BUD-1, F-BUD-6, F-BUD-7 |
| E-3 | Rollenpflege | Admin-Screen „User / Rollen“ | Rollen aus Keycloak | **Admin-Screen im Portal**; Keycloak liefert Identität und Gruppe `LiteLLMAdmin` (O-6) | Kap. 3, F-AUTH-4, F-USR-1a, Kap. 9 |
| E-4 | Logs-Sichtbarkeit | „nur eigene Logs!“ | keine Aussage | **Nur eigene Logs**, auch für Admins | F-LOG-5 |
| E-5 | Default-Kostenstelle | `11111111` | `0000 0000` | **`1111 1111`** | F-PROF-2/3, F-KST-7, F-KEY-2/7, F-PRV-1 |
| E-6 | Excel-Export und Umbuchung | Kernfeature | Kernfeature | **Release 2**, MVP nur Report im UI | Kap. 4.8, Kap. 9, Kap. 15 |
| E-7 | User-Liste | – | Keine eigene User-Liste; Eigenschaften in LiteLLM-Metadata oder eigener Tabelle | **LiteLLM ist die führende User-Liste**: gleiche User-ID in beiden Systemen, bestehende LiteLLM-User werden per E-Mail übernommen. Eigenschaften, die LiteLLM nicht kennt, liegen in der LiteLite-Tabelle `user`, nicht im Metadata-Feld (dort nicht filterbar, nicht atomar änderbar, und die Rolle wäre über das LiteLLM-UI manipulierbar). Eine minimale User-Tabelle bleibt für Better-Auth-Sessions und relationale Reports nötig. | Kap. 2, Kap. 3, F-AUTH-2, Kap. 7.3, Kap. 8 |
| E-8 | Kostenstellen in LiteLLM | – | – | **Kostenstellen = LiteLLM-Teams**: Team-Budget, Team-Sperre, Mitglieder (User der Kostenstelle) und Team-Admins (Kostenstellen-Admins) werden gespiegelt; Antrag, Freigabe und Archivierung bleiben in LiteLite. | F-KST-9, F-KEY-2, Kap. 7.3, Kap. 8 |
| E-9 | Mitglieder einer Kostenstelle (2026-10-01) | – | Kostenstelle = Team mit Admins und Usern, Einladen durch den Admin, zunächst nur bekannte LiteLLM-User | **Mitgliederliste pro Kostenstelle**, ein User kann mehreren Kostenstellen angehören, mehrere Kostenstellen-Admins pro Kostenstelle; Verwaltung durch Admin und Kostenstellen-Admin; Stufe 1 nur bekannte LiteLLM-User. Beitritt nur über Kostenstellen-Admins (seit E-13 auch per Beitrittsanfrage), der Antrag einer neuen Kostenstelle bleibt; der Antragsteller wird Mitglied, der Verantwortliche Kostenstellen-Admin (E-11). | Kap. 3, F-PROF-5, F-KST-3, F-KST-10 bis F-KST-13, F-KEY-2/7, Kap. 7.4, Kap. 8 |
| E-10 | Kostenstelle im Profil, „Meine Kostenstellen“ (2026-10-01) | – | – | **Kostenstelle aus dem Profil entfernt**: kein Kostenstellenfeld, kein Verantwortlicher, kein Antragsstatus im Profil; die API (`PATCH /me`, `POST /cost-centers`) bleibt. **„Meine Kostenstellen“** zeigt nur die Kostenstellen, deren Kostenstellen-Admin der User ist, und ist ohne solche Zuordnung ausgeblendet, auch für Admins. Der Key-Dialog bleibt unverändert. | Kap. 3, F-PROF-1/4/5/6, F-KST-2, F-KST-8, Kap. 9 |
| E-11 | Verantwortlicher einer Kostenstelle (2026-10-01) | – | Der Owner einer Kostenstelle muss ein LiteLLM-User sein, der auch Admin ist | **Verantwortlicher = LiteLLM-User und Kostenstellen-Admin dieser Kostenstelle**: Admins wählen ihn aus LiteLLM, Anträge nennen eine LiteLLM-E-Mail; er bleibt Admin, bis ein anderer Verantwortlicher gesetzt ist. Bestand wird per E-Mail verknüpft, der Rest als „Verantwortlicher fehlt“ markiert. | Kap. 3, Kap. 4.3, F-KST-2/3, F-KST-14, Kap. 8 |
| E-12 | Termin mit JLU (2026-10-01) | – | – | **Nur der Verantwortliche ernennt und entfernt Kostenstellen-Admins**, andere Kostenstellen-Admins verwalten nur Mitglieder. **Modelle pro Kostenstelle freigeben** (Admins, gespiegelt als Team-Modelle). **Key-Budget monatlich oder ohne Zeitfenster.** Die Key-Liste zeigt die Kostenstelle nur mit Bezeichnung. Der Admin-Screen „Provider“ heißt „Modelle“. | Kap. 3, F-KST-13, F-KST-15, F-KEY-1, F-KEY-11, Kap. 8, Kap. 9 |
| E-13 | Beitrittsanfragen (2026-10-05) | – | – | **User fragen den Beitritt zu freigegebenen Kostenstellen selbst an**; Kostenstellen-Admins und Admins nehmen an oder lehnen mit Begründung ab. Das Verzeichnis zeigt nur Bezeichnungen, keine Nummern. Ergänzt E-9. | Kap. 3, F-PROF-5, F-KST-10, F-KST-16, F-BUD-8, Kap. 7.4, Kap. 8, Kap. 9 |

### Geklärte Fragen (2026-09-19)

| Nr. | Frage | Antwort | Umgesetzt in |
|---|---|---|---|
| O-4 | Verhalten bei Budgetüberschreitung | **Sperren** der Keys bei 100 % | F-KST-6, F-BUD-1a |
| O-5 | Budget-Zeitraum | **Beides**: monatlich/jährlich und Projektbudget mit festem Zeitraum | F-KST-4, F-BUD-1, Kap. 8 |
| O-6 | Admin-Vergabe | Keycloak-Gruppe **`LiteLLMAdmin`** | Kap. 3, F-AUTH-4 |
| O-8 | Abgelaufene Keys | **Erneuerbar** (neuer Key, #11) | F-KEY-5, F-KEY-5a |
| O-9 | „nocdemail“ | **Nodemailer** bestätigt | Kap. 6 |

### Offene Fragen

Werden zu einem späteren Zeitpunkt geklärt und blockieren den MVP-Start nicht.

| Nr. | Frage | Verantwortlich |
|---|---|---|
| O-1 | SAP-Spaltenformat für die Umbuchungsdatei | Rebecca Köhl mit Dez D |
| O-2 | Wie wird geprüft, ob eine Kostenstelle verwendet werden darf? Gibt es eine externe Quelle (SAP-Export, CSV-Import) für den Lookup, oder rein manuelle Pflege? | Auftraggeber |
| O-3 | Ist „Projektnummer“ ein zweites Feld neben der Kostenstelle oder ein Synonym? | Auftraggeber |
| O-7 | Prüffrequenz des Austrittsprozesses (angenommen: täglich) und Umgang mit Keycloak-Ausfall (angenommen: keine Sperrung bei Fehler, nur Alarm). | IT / Keycloak-Betrieb |
| O-10 | Wo beantragen User künftig eine neue Kostenstelle, nachdem das Profilfeld entfallen ist (E-10)? Bis dahin legen Admins Kostenstellen direkt an. | Auftraggeber |


## 13. Referenz-Screens aus dem Vorgängerdokument

Das PDF enthält auf Seite 2 drei Screenshots, die als Gestaltungsreferenz dienen:

| Screenshot | Verwendung in LiteLite |
|---|---|
| LiteLLM Request Logs (Tabelle mit Zeit, Typ, Status, Session-ID, Request-ID, Kosten, Dauer, TTFT, Key, Modell, Tokens, Tags; Live-Tail; Filter) | Vorlage für den Request-Logger (4.7). Live-Tail ist nicht gefordert. |
| LiteLLM Spend-Dashboard (Total Spend, Max Budget, Requests gesamt/erfolgreich/fehlgeschlagen, Ø Kosten, Tokens, Daily Spend, Top Keys, Top Models, Spend by Provider) | Vorlage für den Budget-Screen (4.6). |
| SAIA – Scalable AI Accelerator der GWDG (Key-Liste mit Erstellungs- und Ablaufdatum, Löschen/Kopieren, Hilfe-Button, DE/EN, Dark Mode) | Vorlage für den API-Key-Screen (4.4) und die Kopfzeile (4.11, 4.12). |

## 14. Glossar

| Begriff | Bedeutung |
|---|---|
| LiteLLM | OpenAI-kompatibler LLM-Proxy mit Key-, User- und Spend-Verwaltung |
| Kostenstelle | 8-stellige Nummer der Organisationseinheit, der Kosten zugeordnet werden |
| Kostenstellenverantwortlicher | LiteLLM-User, der für eine Kostenstelle verantwortlich und immer ihr Kostenstellen-Admin ist; Empfänger der Budget-Mails |
| Kostenstellen-Admin | Rolle im Portal pro Kostenstelle; verwaltet Mitglieder, setzt Max-Budget und sieht Reports der Kostenstelle |
| Mitglied | User, der auf eine Kostenstelle Keys anlegen darf; entspricht einem Mitglied des LiteLLM-Teams |
| Beitrittsanfrage | Anfrage eines Users, Mitglied einer Kostenstelle zu werden; entschieden von deren Kostenstellen-Admins (F-KST-16) |
| LiteLLMAdmin | Keycloak-Gruppe, deren Mitglieder in LiteLite automatisch Admin sind |
| Provider-Klasse | `free` (kostenfrei, Default-Kostenstelle) oder `paid` (nur mit freigegebener Kostenstelle) |
| Team | LiteLLM-Objekt, das eine Kostenstelle abbildet (E-8): Budget, Sperre, Mitglieder und Keys der Kostenstelle |
| Umbuchung | Erzeugung der SAP-Importdatei für einen abgeschlossenen Zeitraum |
| Softdelete | Deaktivierung mit Zeitstempel statt physischer Löschung |
| Austrittsprozess | Automatische Deaktivierung von Accounts, die in Keycloak nicht mehr gültig sind |
| Sheet | Seitlich eingeblendetes Panel (shadcn/ui-Komponente) |
| Snapshot | Täglich aggregierter Verbrauch aus LiteLLM in der LiteLite-DB |
| TTFT | Time to first token, Zeit bis zum ersten Antwort-Token |

## 15. Nächste Schritte

Stand 2026-09-19: MVP-Codebasis angelegt (Monorepo, API mit allen MVP-Endpunkten und Sicherheitskette, Datenbank-Schema und Migrationen, LiteLLM-Adapter mit Mock, Cron-Jobs, Mails, Web-App, Tests, Docker, CI). Siehe README.md.

1. Entscheidungen E-1 bis E-6: erledigt am 2026-09-19.
2. Offene Fragen O-1, O-2, O-3, O-7: bewusst zurückgestellt, blockieren den MVP nicht.
3. Keycloak `keycloak.safeaiplus.de` einrichten nach docs/kb/keycloak.md (Realm `litelite-dev`, Client `litelite`, Gruppe `LiteLLMAdmin`, Attribut `eduPersonAffiliation`, Testuser) und Client-Secret in `.env` eintragen.
4. LiteLLM `litellm.safeaiplus.de`: Admin-Key in `.env` (`LITELLM_MODE=http`), Adapter gegen die laufende Version verifizieren (`/key/generate`, `/key/update`, `/key/delete`, `/user/new`, `/user/update`, `/model/info`, `/spend/logs/v2`); Postgres-Zugang auf dem LiteLLM-DB-Host mit `CREATE SCHEMA`-Recht.
5. Staging-Deployment mit dem Docker-Image (Env nach Kapitel 10), Abnahme der MVP-Flows mit echten Keycloak-Usern.
6. Release 2: Excel-Export, Umbuchung mit SAP-Format (O-1), Keycloak-Admin-API für den Austrittsprozess (aktuell werden nur die beim letzten Login erfassten Claims geprüft), endgültige Löschung.
