# Hintergrundentferner

Eine kleine Webanwendung, die mithilfe von TensorFlow.js und MediaPipe SelfieSegmentation den Hintergrund von Fotos mit Personen entfernt – direkt im Browser, ohne dass deine Daten den Rechner verlassen.

## Verwendung

1. Öffne die Datei [`index.html`](index.html) in einem aktuellen Browser (empfohlen: Chrome, Edge oder Firefox).
2. Klicke auf **Bild auswählen** und wähle ein Foto mit einer Person aus.
3. Nach einigen Sekunden erscheint eine Version ohne Hintergrund. Du kannst das Ergebnis als PNG herunterladen oder mit dem Pinselwerkzeug direkt im Browser nachkorrigieren.

> Hinweis: Beim ersten Start lädt die Anwendung das hochauflösende BodyPix-Modell nach. Je nach Gerät und Netzwerk kann dies einige Sekunden dauern.

> Hinweis: Für bestmögliche Ergebnisse sollte die Person vollständig zu sehen sein und sich klar vom Hintergrund abheben.

## Technik

- [TensorFlow.js](https://www.tensorflow.org/js) & [@tensorflow-models/body-pix](https://github.com/tensorflow/tfjs-models/tree/master/body-pix) mit ResNet50-Backbone für präzise Personensegmentierung
- Moderne Browser-APIs (`FileReader`, `Canvas`) für die clientseitige Bildverarbeitung
- Adaptive Masken-Nachbearbeitung (morphologisches Closing, weiches Alpha, Blur) inklusive manuellem Pinsel zur Feinkorrektur
- Ziel ist eine hochwertige Freistellung ähnlich remove.bg durch mehrstufige Maskenverfeinerung
- Keine zusätzlichen Abhängigkeiten oder Build-Schritte erforderlich
