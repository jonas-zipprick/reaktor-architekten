# Ernte & Wochenmarkt · Playtest-Simulation

Browser-Simulation zu den Spielregeln in [`gameRules.md`](./gameRules.md).

## Starten

```bash
cd web
npm install
npm run dev
```

Dann im Browser die angezeigte Adresse öffnen (meist `http://localhost:5173`).

## Installieren (Android / Desktop)

Die App ist eine Progressive Web App. Nach dem Deploy über **HTTPS** (oder lokal nach `npm run build && npm run preview`) kann Brave/Chrome sie installieren: Menü → **App installieren** / **Zum Startbildschirm hinzufügen**.

## Enthalten

- Szenarien A–D (A = 1 Spieler, B–D = 2–4 Spieler)
- Sechs Sorten: 🌱 Saat / 🌾 Getreide / 💧 Wasser · 🥖 Mehl / 🍎 Obst / 🍯 Konfitüre
- Kette **Saat → Obst → Konfitüre** (Beet: Wasser+Saat; Konfitürenküche: Obst+Wasser)
- Parallel: Getreide → Mehl
- Felder (u. a. Regen), Küchen, ein persönlicher Schuppen und drei Erntefelder je Spieler
- Sieg: Mehl, Obst und Konfitüre jeweils auf einem eigenen Erntefeld
- Jeder Spieler hat genau einen Schuppen (ohne Gebühren, nicht auktionierbar)
- Zeitstrahl mit Export/Import; Monte-Carlo-Dauerlauf mit Bots

## Steuern

1. Stapel anklicken (ggf. mehrfach für größere absteigende Auswahl) — mögliche Ziele samt Gebühr und Einkommen werden markiert.
2. Ziel anklicken. Tippen auf leere Fläche, Rechtsklick oder Esc hebt die Auswahl auf.
3. Versus: im Seitenpanel Auktion starten, Geld schenken, Gebühren eigener Felder anpassen.
4. „Karten ziehen und Produzieren“ (Leertaste) beendet den Zug.
