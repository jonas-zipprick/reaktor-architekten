# Versorgungs-Architekten · Playtest-Simulation

Browser-Simulation zu den Spielregeln in [`gameRules.md`](./gameRules.md) (v8).

## Starten

```bash
cd web
npm install
npm run dev
```

Dann im Browser die angezeigte Adresse öffnen (meist `http://localhost:5173`).

## Enthalten

- Szenarien A–D (A = 1 Spieler, B–D = 2–4 Spieler)
- Vier Farben mit eigenem Zieh- und Ablagestapel: ♥ Herz / ♠ Pik (Rohstoffe), ♦ Karo / ♣ Kreuz (Produkte)
- Quellen (♥/♠/⚡), Fabriken, Lager und Märkte (ein Bedarfsmesser je Markt)
- Nur Lager (Infrastruktur) haben Eigentümer/Gebühren und sind auktionierbar; Quellen, Fabriken und Märkte sind gebührenfrei
- Bedarf je Markt −1 bei Zugende; ein globaler Exp-Zähler (+1/Zugende, 10 → Ausbau); jeder Marktkollaps setzt ihn zurück
- Zeitstrahl mit Export/Import (Record-Format v18; ältere Records sind nicht kompatibel)
- Monte-Carlo-Dauerlauf mit Bots

## Steuern

1. Stapel anklicken (ggf. mehrfach für größere absteigende Auswahl) — mögliche Ziele samt Gebühr und Einkommen werden markiert.
2. Ziel anklicken. Rechtsklick oder Esc hebt die Auswahl auf.
3. Versus: im Seitenpanel Auktion starten, Geld schenken, Gebühren eigener Felder anpassen.
4. „Karten ziehen und Produzieren“ (Leertaste) beendet den Zug und würfelt den Bedarf aller Planeten.
