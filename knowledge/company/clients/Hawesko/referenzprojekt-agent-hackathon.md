# Referenzprojekt: Agent Hackathon für agentische KI im Unternehmenskontext

## Kurzprofil

Im Rahmen eines Führungskräfte-Hackathons wurde ein praxisnahes Schulungs- und Prototyping-Format für agentische KI durchgeführt. Rund 75 Führungskräfte arbeiteten in mehreren Gruppen an konkreten Anwendungsfällen aus ihrem Unternehmensalltag.

Ziel war es, Multi-Agenten-Systeme nicht theoretisch zu erklären, sondern direkt an realistischen Fachprozessen zu erleben: Use Case verstehen, Agentenrollen definieren, Prompts testen, Ergebnisse bewerten und die Wirkung von Prompt-Änderungen im Ablauf nachvollziehen.

Unsere Gruppe arbeitete an einem Anwendungsfall aus Finance, Controlling und Business Analytics.

## Ausgangslage

Umsatz- und Aktionsplanung basiert auf vielen Annahmen: Zielumsatz, Vorjahreswerte, geplante Aktionen, Auflagen, neue Standorte, Feiertage, Verkaufstage, saisonale Effekte und historische Vergleichswerte.

In der Praxis ist schwer zu beurteilen, ob diese Annahmen gemeinsam plausibel sind. Viele Einflussfaktoren wirken gleichzeitig. Ein Teil des Wissens liegt in Daten, ein anderer Teil im Erfahrungswissen der Fachabteilungen.

## Lösungsansatz

Entwickelt wurde ein Prototyp für eine Agenten-Kette, die historische Daten analysiert und daraus ein wiederverwendbares Regelwerk erstellt.

Dieses Regelwerk dient anschließend als Grundlage für einen Plausibilitätsagenten. Der Agent prüft neue Planannahmen gegen historische Muster und zeigt, welche Annahmen gut begründet, unsicher oder nicht beurteilbar sind.

## Agenten-Kette

Die Lösung bestand aus mehreren spezialisierten Agents, die nacheinander arbeiten:

1. **Datenkonsistenz-Prüfer**
   Prüft Datenquellen, Datenqualität, Vorzeichenlogik, Profitcenter, Standortdaten, Auffälligkeiten und offene Datenfragen.

2. **Aktionsanalyse-Agent**
   Analysiert historische Aktionen, Aktionstypen, Auflagen, Lifteffekte, Incentives und mögliche Vorzieheffekte.

3. **Kalenderanalyse-Agent**
   Analysiert Feiertage, Verkaufstage, Wochentage, Saisonmuster, Brückentage und Weihnachtskonstellationen.

4. **Kombinations-Agent**
   Führt Aktions- und Kalenderregeln zusammen und erstellt ein konsolidiertes Regelwerk.

5. **Plausibilitätsprüfer**
   Prüft neue Planannahmen gegen das freigegebene Regelwerk. Er erstellt keine neuen Regeln, sondern bewertet nur auf Basis der vorhandenen Wissensgrundlage.

## Ergebnis des Prototyps

Der Prototyp erzeugte ein strukturiertes Regelwerk mit:

* methodischen Grundlagen
* Daten-Handlingregeln
* Aktionsregeln
* Kalenderregeln
* kombinierten Plausibilitätsregeln
* Schnellreferenz
* Konsolidierungsprüfung
* offenen Punkten
* Freigabehinweis

Das Regelwerk wurde ausdrücklich als Entwurf behandelt. Für einen produktiven Einsatz müsste es fachlich geprüft und freigegeben werden.

## Nutzen für den Kunden

Der Kunde konnte praktisch erleben, wie agentische KI auf echte Unternehmensprozesse angewendet werden kann.

Der Nutzen lag insbesondere in:

* schnellem Erleben eines realistischen Multi-Agenten-Prozesses
* Übersetzung eines komplexen Fachprozesses in eine KI-Architektur
* strukturierter Analyse historischer Daten
* Ableitung wiederverwendbarer Regeln aus Vergangenheitsdaten
* transparenter Prüfung neuer Planannahmen
* Sichtbarmachung von Unsicherheiten und fehlenden Informationen
* besserem Verständnis dafür, wie Prompt-Änderungen den gesamten Agenten-Ablauf beeinflussen
* Aktivierung des Fachwissens der Teilnehmenden

Der Hackathon zeigte, dass der eigentliche Hebel nicht nur im KI-Modell liegt, sondern in der Verbindung aus Fachwissen, sauberer Prozesslogik und klar definierten Agentenrollen.

## Was wir damit zeigen können

Dieses Referenzprojekt zeigt unsere Fähigkeit, komplexe Unternehmensprozesse in agentische KI-Systeme zu übersetzen.

Konkret haben wir gezeigt:

* Use Cases mit Fachbereichen konkretisieren
* Fachprozesse in Agentenrollen zerlegen
* mehrstufige Agenten-Ketten konzipieren
* Prompts mit klarer Rollen-, Input- und Output-Logik entwickeln
* historische Daten in ein prüfbares Regelwerk überführen
* Plausibilitätsprüfungen mit klaren Grenzen entwerfen
* typische Risiken reduzieren: Halluzination, Scheinsicherheit, falsche Kausalität, fehlende Daten, zu harte Urteile
* Führungskräfte und Fachanwender:innen praktisch an agentische KI heranführen

## Methodische Learnings

Die Arbeit am Prototyp zeigte mehrere zentrale Punkte:

1. **Agentische Systeme brauchen klare Übergaben**
   Jeder Agent muss wissen, wann er starten soll, welchen Input er nutzt und welches Ergebnis er liefern soll.

2. **Rollen müssen scharf getrennt sein**
   Ein Datenprüfer erstellt kein vollständiges Regelwerk. Ein Analyse-Agent erstellt nur sein Segment. Ein Plausibilitätsprüfer darf keine neuen Regeln erfinden.

3. **Regelwerke brauchen Unsicherheitslogik**
   Kleine Fallzahlen, Korrelationen, Schätzungen und unbelegte Hypothesen müssen sichtbar markiert werden.

4. **Fachwissen verändert das System**
   Die Rückmeldungen der Fachanwender:innen haben gezeigt, welche Regeln plausibel sind, welche Formulierungen zu hart wirken und wo Datenkontext fehlt.

5. **Human-in-the-loop bleibt zentral**
   Das System bereitet Entscheidungen vor. Die fachliche Freigabe bleibt beim Menschen.

## Übertragbarkeit

Der Ansatz ist auf viele Unternehmensbereiche übertragbar, insbesondere dort, wo historische Daten, Erfahrungswissen und neue Annahmen gemeinsam bewertet werden müssen.

Mögliche Einsatzfelder:

* Umsatzplanung
* Forecasting
* Controlling-Reviews
* Budgetplanung
* Kampagnenplanung
* Vertriebssteuerung
* Filial- oder Standortplanung
* Sortimentsplanung
* Management-Reporting
* Audit- und Compliance-Vorbereitung

Besonders geeignet sind Prozesse, bei denen Entscheidungen heute stark von Erfahrung einzelner Fachpersonen abhängen und viele Einflussfaktoren gleichzeitig berücksichtigt werden müssen.

## Einordnung

Das Projekt war ein Hackathon- und Schulungsformat, kein produktiv implementiertes Kundensystem.

Der Wert liegt in der prototypischen Umsetzung: Innerhalb kurzer Zeit wurde ein realer Fachprozess in eine funktionierende Agenten-Architektur übersetzt. Die Teilnehmenden konnten testen, verändern und nachvollziehen, wie sich agentische KI im eigenen Arbeitskontext einsetzen lässt.

## Interne Referenzformulierung

In einem Führungskräfte-Hackathon haben wir gezeigt, wie sich ein komplexer Finance- und Controlling-Prozess in eine Agenten-Kette übersetzen lässt. Die Agents prüften Daten, leiteten Regeln aus historischen Mustern ab, konsolidierten diese zu einem Regelwerk und nutzten dieses anschließend zur Plausibilitätsprüfung neuer Planannahmen.

Der Case zeigt, wie agentische KI Fachwissen strukturiert, historische Daten nutzbar macht und komplexe Entscheidungen nachvollziehbarer vorbereitet. Entscheidend war nicht nur das Modell, sondern die Prozessarchitektur: klare Agentenrollen, saubere Übergaben, definierte Grenzen und fachliche Prüfung durch Menschen.
