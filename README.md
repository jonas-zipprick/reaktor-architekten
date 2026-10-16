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
| `web/src/data/boardLayout.ts` | Kartenradius, Landschaftsstapel, Schiff-Spawns |
| `web/src/types.ts` | Gemeinsame Typen / Richtungen |
| `gameRules.md` | Regeltext (Referenz) |

## Playtest-Ablauf (Kurz)

1. **Rundenstart** — Reihenfolgechip, Bedarf würfeln, Quellen emittieren  
2. **Schiff** — bewegen, Nachbarn erkunden, Quellenpfeil drehen  
3. **Bauen** — leere Felder / Trafo nachladen / Verbraucher  
4. **Simulation** — Chips entlang der Pfeile; Fog: weiterfliegen; Wand/Asteroid → Beutel  
5. **Abschluss** — kritisch ±8 zerstört die Kolonie; leerer Geldstapel beendet das Spiel  

Werkzeuge: **Auswählen**, **Bauen**, **Entfernen**.
