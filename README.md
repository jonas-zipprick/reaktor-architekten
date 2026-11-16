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
- Sorten: 🌱 Saat / 💧 Wasser · 🍎 Obst / 🫐 Beeren / 🥕 Gemüse / 🌿 Kräuter
- Je Spieler ein privates Beet nach Sitz: Obst → Beeren → Gemüse → Kräuter (Wasser+Saat)
- Je Spieler: Regen, ein Beet, Schuppen und **3 Erntefelder**
- Gemeinsamer Saatstand und Markt
- Spielende: Zugende mit 3 vollen Erntefeldern; Sieg nach SP (Ernte-Vielfalt + 1 SP je angefangene 10T)
- Zeitstrahl mit Export/Import; Monte-Carlo-Dauerlauf mit Bots

## Steuern

1. Stapel anklicken (ggf. mehrfach für größere absteigende Auswahl) — mögliche Ziele samt Kosten/Einkommen werden markiert.
2. Ziel anklicken. Tippen auf leere Fläche, Rechtsklick oder Esc hebt die Auswahl auf.
3. Versus: im Seitenpanel Geld schenken.
4. „Karten ziehen und Produzieren“ (Leertaste) beendet den Zug.
