# GWS Studio

Marketing-Workspace für Global Wealth Strategists. Editing-Kanban, Aufgaben, Teamchat-Demo, Paid Copy Library, Organic und Sales mit Setting/Closing.

## Frame.io-Review

Der neue Reviewbereich verbindet echte Frame.io-V4-Dateien über eine serverseitige API: Video, Versionen, zeitbezogene Kommentare, Kommentarabschluss und Aktualisierung. Ohne konfigurierte Adobe-Verbindung werden keine Live-Daten vorgetäuscht.

**Start:** Node.js24 oder neuer installieren, `.env.example` als `.env` kopieren und `npm start` ausführen. Keine npm-Abhängigkeiten erforderlich.

**Einrichtung und Grenzen:** [FRAMEIO-SETUP.md](FRAMEIO-SETUP.md). Für Live-Zugriff fehlen die eigenen Adobe-OAuth-Einstellungen. Eine HTTPS-Serverbereitstellung benötigt zusätzlich eine vertrauenswürdige Studio-Anmeldung und eine Sitzungsdatenbank; im Sites-Worker wird dafür D1 unter `DB` verwendet.

**Prüfen:** `npm test` · `npm run build`.

- `public/`: bestehende Oberfläche plus nativer Frame.io-Client.
- `server/`: OAuth, API-Adapter, verschlüsselte Sitzungsspeicherung, lokale Laufzeit und optionaler Webhook-Relay.
- `worker/`: produktive Worker-Laufzeit mit Sites-Identität.
- `tests/`: kontrollierte API- und Laufzeittests.
- `dist/`: generierter Worker; nicht als statischen Ordner ausliefern.

Aufgaben und Demo-Chat bleiben wie bisher im jeweiligen Browser. Frame.io-Tokens werden ausschließlich serverseitig gespeichert. Die HTML-Einzeldatei zeigt den Prototyp, kann allein aber keine Server-API bereitstellen.
