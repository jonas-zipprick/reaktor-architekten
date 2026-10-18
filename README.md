# Versorgungs-Architekten

Browser-Playtest-Prototyp für das Brettspiel (siehe `gameRules.md`).

Die Engine **enforced keine Regeln** — du spielst gegen dich selbst und hältst dich manuell an die Regeln. Ziel: schnelles Playtesting und leichte Regel-Anpassungen.

## Start

```bash
cd web
npm install
npm run dev
```

Dann im Browser die angezeigte URL öffnen (meist `http://localhost:5173`).

## Was du anpassen kannst

| Datei | Inhalt |
| --- | --- |
| `web/src/data/fields.ts` | Feldtypen, Kosten, Texte |
| `web/src/data/boardLayout.ts` | Kartenradius, Zonen, Landschaftsstapel, Schiff-Spawns |
| `web/src/types.ts` | Gemeinsame Typen / Richtungen |
| `gameRules.md` | Regeltext (Referenz) |

## Playtest-Ablauf (Kurz)

1. **Rundenstart** — kritische Kolonien (±8), dann Reihenfolgechip, Bedarf, erschlossene Quellen. Leerer Geldstapel beendet das Spiel  
2. **Aktionen** — Weiß, dann Schwarz. 4 Punkte: ein Schritt oder ein Bau (Feld, Verbraucher, Quelle). Übrige Punkte verfallen  
3. **Simulation** — Chips entlang der Pfeile; unentdeckte Felder bleiben verdeckt; Wand/Asteroid → Beutel  

Werkzeuge: **Auswählen**, **Bauen**, **Entfernen**.
