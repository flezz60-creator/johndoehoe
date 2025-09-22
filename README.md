# Hintergrundentferner

Eine kleine Webanwendung, die mithilfe von TensorFlow.js und MediaPipe SelfieSegmentation den Hintergrund von Fotos mit Personen entfernt – direkt im Browser, ohne dass deine Daten den Rechner verlassen.

## Verwendung

1. Öffne die Datei [`index.html`](index.html) in einem aktuellen Browser (empfohlen: Chrome, Edge oder Firefox).
2. Klicke auf **Bild auswählen** und wähle ein Foto mit einer Person aus.
3. Nach wenigen Sekunden erscheint eine Version ohne Hintergrund, die du als PNG herunterladen kannst.

> Hinweis: Beim ersten Start lädt die Anwendung das MediaPipe-Selfie-Segmentation-Modell (über `@tensorflow-models/body-segmentation`) nach. Je nach Gerät und Netzwerk kann dies einige Sekunden dauern.

> Hinweis: Für bestmögliche Ergebnisse sollte die Person vollständig zu sehen sein und sich klar vom Hintergrund abheben.

## Technik

- [TensorFlow.js](https://www.tensorflow.org/js) & [@tensorflow-models/body-segmentation](https://github.com/tensorflow/tfjs-models/tree/master/body-segmentation) mit MediaPipe SelfieSegmentation für die Personensegmentierung in hoher Qualität
- Moderne Browser-APIs (`FileReader`, `Canvas`) für die clientseitige Bildverarbeitung
- Adaptive Masken-Nachbearbeitung (morphologisches Closing, weiches Alpha, Blur), damit feine Details wie Haare und transparente Bereiche erhalten bleiben
- Ziel ist eine hochwertige Freistellung ähnlich remove.bg durch mehrstufige Maskenverfeinerung
- Keine zusätzlichen Abhängigkeiten oder Build-Schritte erforderlich
