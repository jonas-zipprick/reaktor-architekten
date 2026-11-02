# Versorgungs-Architekten · Playtest-Simulation

Browser-Simulation zu den Spielregeln in [`gameRules.md`](./gameRules.md) (v6.6).

## Starten

```bash
cd web
npm install
npm run dev
```

Dann im Browser die angezeigte Adresse öffnen (meist `http://localhost:5173`).

## Enthalten

- Szenarien A–D (Polarität, Kanalwelt, Triade, King of the Hill)
- Modi Solo / Koop / Versus
- Absteigende Stapeltransporte, Speicher, Planeten, Verteidigungen
- Siegpunktmarker erzeugen und zur Basis bringen
- Transportkosten inkl. Asteroiden und Gebühren

## Steuern

1. Offene Karte oder Stapel auf dem Feld anklicken (erneut klicken wechselt die Höhe).
2. Ziel anklicken — die Route und Kosten werden hervorgehoben.
3. Energie auf einem Planeten: „Siegpunktmarker erzeugen“ im Seitenpanel.
4. Neutrale/eigene Siegpunkt-Badges anklicken und zur eigenen Basis bringen.
5. Gebühren eigener Verteidigungen im Panel anpassen (kostenlos).
