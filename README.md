# Ernte & Wochenmarkt · Playtest-Simulation

Browser-Simulation zu den Spielregeln in [`gameRules.md`](./gameRules.md).

## Starten

```bash
cd web
npm install
npm run dev
```

Dann im Browser die angezeigte Adresse öffnen (meist `http://localhost:5173`).

## Enthalten

- Szenarien A–D (A = 1 Spieler, B–D = 2–4 Spieler)
- Sechs Sorten: 🌱 Saat / 🌾 Getreide / 💧 Wasser · 🥖 Mehl / 🍎 Obst / 🍯 Konfitüre
- Kette **Saat → Obst → Konfitüre** (Beet: Wasser+Saat; Konfitürenküche: Obst+Wasser)
- Parallel: Getreide → Mehl
- Felder (u. a. Regen), Küchen, persönliche Schuppen und Marktstände
- Jeder Spieler hat eigene Schuppen (ohne Gebühren, nicht auktionierbar)
- Zeitstrahl mit Export/Import; Monte-Carlo-Dauerlauf mit Bots

## Steuern

1. Stapel anklicken (ggf. mehrfach für größere absteigende Auswahl) — mögliche Ziele samt Gebühr und Einkommen werden markiert.
2. Ziel anklicken. Rechtsklick oder Esc hebt die Auswahl auf.
3. Versus: im Seitenpanel Auktion starten, Geld schenken, Gebühren eigener Schuppen anpassen.
4. „Karten ziehen und Produzieren“ (Leertaste) beendet den Zug.
