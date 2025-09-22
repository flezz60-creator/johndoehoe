# Hintergrundentferner

Eine kleine Webanwendung, die mithilfe von TensorFlow.js den Hintergrund von Fotos mit Personen entfernt – direkt im Browser, ohne dass deine Daten den Rechner verlassen.

## Verwendung

1. Öffne die Datei [`index.html`](index.html) in einem aktuellen Browser (empfohlen: Chrome, Edge oder Firefox).
2. Klicke auf **Bild auswählen** und wähle ein Foto mit einer Person aus.
3. Nach wenigen Sekunden erscheint eine Version ohne Hintergrund, die du als PNG herunterladen kannst.

> Hinweis: Für bestmögliche Ergebnisse sollte die Person vollständig zu sehen sein und sich klar vom Hintergrund abheben.

## Technik

- [TensorFlow.js](https://www.tensorflow.org/js) & [BodyPix](https://github.com/tensorflow/tfjs-models/tree/master/body-pix) für die Personensegmentierung
- Moderne Browser-APIs (`FileReader`, `Canvas`) für die clientseitige Bildverarbeitung
- Keine zusätzlichen Abhängigkeiten oder Build-Schritte erforderlich
