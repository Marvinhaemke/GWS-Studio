# GWS Studio · Frame.io V4

Die Integration verwendet die Frame.io V4 API. Der Reviewbereich enthält einen eigenen Videoplayer, Versionsauswahl, Kommentare mit Zeitmarken, Kommentarabschluss, manuelle Aktualisierung und signierte Webhook-Ereignisse. Es wird keine Frame.io-Seite per iframe eingebettet.

## Lokal starten

Node.js 24 oder neuer ist erforderlich. Es gibt keine npm-Abhängigkeiten und keinen Installationsschritt.

1. `.env.example` nach `.env` kopieren.
2. `SESSION_SECRET` mit mindestens 32 zufälligen Zeichen füllen, z. B. mit einem lokal erzeugten 32-Byte-Hexwert.
3. `npm start` ausführen und die ausgegebene Adresse öffnen.

Der lokale Server bindet ausschließlich an `127.0.0.1`. Er simuliert die Studio-Identität nur für lokale Entwicklung. Diese Identität ist **nicht** für einen öffentlich erreichbaren Server gedacht. Die normale Studio-Aufgabenverwaltung bleibt wie im bisherigen Prototyp im Browser gespeichert. Die SQLite-Datei für verschlüsselte Frame.io-Sitzungen liegt getrennt unter `.gws-runtime/` und wird nicht ins Projektarchiv oder Git übernommen.

Ohne Adobe-Zugangsdaten zeigt der Frame.io-Dialog die fehlende Einrichtung. Die herunterladbare HTML-Datei dient zur Ansicht der Oberfläche; eine API-Verbindung benötigt den Server.

## Adobe-Anmeldung aktivieren

Voraussetzung ist ein Frame.io-V4-Konto mit unterstützter Adobe-Anmeldung und Zugriff auf die Frame.io API in der Adobe Developer Console.

1. In der Adobe Developer Console ein Projekt mit Frame.io API und **OAuth Web App** anlegen.
2. Die endgültige HTTPS-Origin von GWS Studio als `APP_ORIGIN` konfigurieren.
3. Exakt `https://DEINE-STUDIO-DOMAIN/api/frameio/callback` als Redirect URI in Adobe registrieren und denselben Wert als `FRAMEIO_REDIRECT_URI` hinterlegen. Für den Web-App-Flow wird HTTPS erwartet; ein normaler HTTP-Entwicklungsserver ist keine fertig eingerichtete OAuth-Umgebung.
4. `FRAMEIO_CLIENT_ID` und `FRAMEIO_CLIENT_SECRET` ausschließlich im Server- bzw. Hosting-Secretspeicher hinterlegen. Keine Tokens in Browsercode, Aufgaben oder Chat eintragen.
5. Die benötigten Scopes sind `openid email profile offline_access additional_info.roles`. Die Anwendung nutzt PKCE zusätzlich zum Client Secret.
6. Im Studio auf **Frame.io → Mit Adobe verbinden** klicken und den eigenen Frame.io-Zugriff autorisieren.

Die Verbindung gehört zur angemeldeten Studio-Identität. Andere Nutzer erhalten dadurch keinen Zugriff auf dieses Konto. Ein Adobe-Service-Account wird nicht automatisch angelegt. Legacy-Konten und Legacy-Tokens sind nicht Teil dieser Implementierung.

## Eine Aufgabe verknüpfen

Eine Editing-Aufgabe öffnen, **Datei aus Frame.io wählen**, Konto und Projekt auswählen, durch Ordner navigieren und ein Video oder einen Versionsstapel verknüpfen. Alternativ Konto- und Datei-ID verwenden. Die Aufgabe speichert nur die Ressourcen-IDs, keine Zugriffstokens.

Im Review kann eine konkrete Version gewählt werden. Kommentare werden an diese Version geschrieben. Bei unbekannter Bildrate muss die Bildrate für präzise Frame-Zeitmarken bestätigt werden; sonst wird die Position nur sekundengenau angezeigt. Bruchraten werden als Non-Drop-Frame behandelt, bestehende unterstützte Drop-Frame-Zeitcodes werden vom Backend gelesen.

Media-URLs sind temporär und werden bei Aktualisierung neu angefordert. Verarbeitung, Berechtigungen oder DRM können eine Wiedergabe im eigenen Player verhindern; dann bleibt **In Frame.io öffnen** verfügbar. Es werden keine DRM- oder Berechtigungsschutzmaßnahmen umgangen.

Nach einer unklaren Schreibantwort werden Kommentare nicht automatisch erneut gesendet. Zuerst aktualisieren und prüfen, ob der Kommentar angekommen ist. Das Backend verhindert doppelte Übertragung derselben Anfrage-ID.

## Hosting

Der vorhandene Sites-Projektbezug ist unverändert. `npm run build` erstellt einen Worker-ESM-Artefakt unter `dist/server/index.js`, einschließlich eingebetteter statischer Dateien. Der Worker nutzt die von Sites gelieferten `oai-authenticated-user-id`-Header; Studio-Anmeldung und Adobe-Kontoautorisierung sind getrennte Schritte. Die lokale Entwicklungsidentität ist im Worker deaktiviert.

Für eine Serverbereitstellung benötigt der Worker eine D1-Bindung `DB`. Das Schema steht in `server/schema.sql`. Es muss als Migration vor Aktivierung der Serverversion angewendet werden; der Worker erzeugt keine Tabellen während einer Anfrage. Die Herkunft und Integrität der Identitätsheader muss durch das Hosting sichergestellt sein; einen eigenen öffentlich zugänglichen Node-Server ohne vertrauenswürdigen Auth-Proxy sollte man dafür nicht verwenden.

Das Hosting-Manifest ist auf die Serverversion ohne `static` umgestellt; der Projektbezug bleibt erhalten. Die benötigte DB-Bindung muss vor einer Veröffentlichung über die unterstützte Hostkonfiguration ergänzt und validiert werden. Es werden keine Datenbank-IDs oder unbestätigten Bindungseinstellungen erfunden. Das lokale Paket ist vollständig startbar, eine produktive Live-Verbindung wurde ohne Adobe-Konfiguration und Hosting-Freigaben nicht bestätigt.

## Webhooks (optional)

`POST /api/frameio/webhook` prüft die unveränderte Frame.io-Signatur, Zeitfenster und doppelte Zustellungen. `FRAMEIO_WEBHOOK_SECRET` ist der bei der Webhook-Erstellung angezeigte Signierschlüssel. Geeignete Ereignisse sind `file.ready`, `file.versioned`, `comment.created`, `comment.updated` und `comment.completed`.

Eine private Sites-Seite ist bereits vor dem Worker durch Anmeldung geschützt. Frame.io kann einen solchen Endpunkt nicht ohne passende Service-Autorisierung erreichen. Dafür enthält `server/webhook-relay.mjs` einen **separat zu betreibenden** öffentlichen Empfänger. Er prüft die Signatur und leitet nur gültige Zustellungen an das private Studio weiter. Seine Secrets sind `FRAMEIO_WEBHOOK_SECRET`, `GWS_STUDIO_ORIGIN` und `GWS_PRIVATE_SERVICE_TOKEN`. Der Service-Token gehört ausschließlich zum privaten Studio und darf nicht an Frame.io oder den Browser weitergegeben werden.

Der Relay wird nicht automatisch veröffentlicht. Bis ein öffentlich erreichbarer, autorisierter Empfang eingerichtet ist, stehen manuelle Aktualisierung und API-Zugriff zur Verfügung; automatische Webhook-Zustellung wird nicht als aktiv angezeigt. Kommentare und Medien werden nur mit den tatsächlichen Frame.io-Rechten des jeweiligen Besuchers gelesen.

## Prüfen

- `npm test` führt Backend-, Laufzeit- und Integrationsprüfungen mit kontrollierten API-Antworten aus.
- `npm run build` erzeugt das Worker-Artefakt.
- Ein Live-Test benötigt die echten Adobe-Web-App-Einstellungen, einen HTTPS-Callback, eine Studio-Anmeldung und Zugriff auf ein Frame.io-Projekt.

Offizielle Dokumentation:
- https://developer.frame.io/platform/docs/guides/authentication/overview
- https://developer.frame.io/platform/v4/docs/guides/media-links
- https://developer.frame.io/platform/api-reference/comments/create
- https://developer.frame.io/platform/v4/docs/guides/webhooks
