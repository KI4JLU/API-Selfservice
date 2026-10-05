# Meine Kostenstellen

Dieser Screen steht nur Kostenstellen-Admins zur Verfügung. Er zeigt nur die Kostenstellen, bei denen Sie Kostenstellen-Admin sind. Das gilt auch für Admins; alle Kostenstellen sehen Admins unter **Administration → Kostenstellen**.

## Übersicht

Pro Kostenstelle sehen Sie Nummer, Bezeichnung, Verantwortlichen, Max-Budget, Verbrauch im aktuellen Zeitraum und die Auslastung. Ist das Budget erschöpft, ist die Kostenstelle als **gesperrt** markiert: alle Keys der Kostenstelle sind dann in LiteLLM gesperrt.

## Mitglieder

Jede Kostenstelle ist in LiteLLM ein Team. Nur Mitglieder können API-Keys auf die Kostenstelle anlegen. Mit **Mitglieder** öffnen Sie die Liste:

- **Hinzufügen**: Suchen Sie nach E-Mail (mind. 3 Zeichen) oder User-ID. Es lassen sich nur Personen hinzufügen, die LiteLLM bereits kennt, auch wenn sie sich noch nie im Portal angemeldet haben. Die Person erhält eine E-Mail; die Mitgliedschaft gilt ab ihrem ersten Login.
- **Mehrere hinzufügen**: Fügen Sie eine Liste von E-Mail-Adressen ein (getrennt durch Komma, Semikolon oder Zeilenumbruch, max. 200). **Adressen prüfen** zeigt, welche Personen gefunden wurden, welche Adressen keinem LiteLLM-User gehören (kopierbar) und welche ungültig sind. Gefundene Personen sind vorausgewählt; mit **N hinzufügen** werden alle auf einmal hinzugefügt. Die Rolle wählen nur der Verantwortliche und Admins, sonst werden alle Mitglied.
- **Rolle**: **Mitglied** oder **Kostenstellen-Admin**. Eine Kostenstelle kann mehrere Admins haben. Kostenstellen-Admins ernennen, herabstufen oder entfernen kann nur der Verantwortliche (und Admins); weitere Kostenstellen-Admins fügen nur Mitglieder hinzu und entfernen sie. Der Verantwortliche ist immer Kostenstellen-Admin (markiert mit **Verantwortlich**) und kann erst entfernt oder herabgestuft werden, nachdem ein Admin einen anderen Verantwortlichen gesetzt hat.
- **Entfernen**: Die Keys der Person auf dieser Kostenstelle werden gesperrt. Wird sie wieder hinzugefügt, werden diese Keys entsperrt.
- **Beitrittsanfragen**: Personen können über **Kostenstellen** den Beitritt anfragen. Der Verantwortliche und die Kostenstellen-Admins erhalten dann eine E-Mail, und am Button **Mitglieder** zeigt eine Zahl die offenen Anfragen. Oben in der Mitgliederliste sehen Sie Name, E-Mail, Zeitpunkt und Nachricht. **Annehmen**: Die Person wird Mitglied und per E-Mail informiert. **Ablehnen**: mit Pflicht-Begründung, die die Person per E-Mail erhält.

Alle Änderungen erscheinen im Ereignisprotokoll.

## Max-Budget setzen

Mit **Bearbeiten** setzen Sie das Max-Budget und den Zeitraum:

- **Monatlich** oder **Jährlich**: Das Budget gilt pro Kalendermonat bzw. Kalenderjahr und startet automatisch neu.
- **Projekt**: Festes Budget mit Start- und Enddatum, ohne Reset.
- Leer lassen bedeutet unbegrenzt.

Bei 80 % und 100 % des Max-Budgets werden der Verantwortliche und die Kostenstellen-Admins per E-Mail informiert. Eine Sperre wird aufgehoben, sobald das Budget erhöht wird oder ein neuer Zeitraum beginnt.

## Report

**Details** öffnet den Verbrauchsreport der Kostenstelle mit Aufschlüsselung nach Usern und deren Keys. Der Excel-Export folgt in Release 2.
