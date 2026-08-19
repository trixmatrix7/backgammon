// Zungen-Geometrie, wörtlich aus `ui-assets/neomarks.js` der Übergabe.
//
// Achse, Neigung UND Breite sind je Zunge einzeln gemessen — sechs Zungen sind breiter als der
// Durchschnitt und wären mit einer Einheitsbreite nicht abgedeckt. Deshalb steht hier eine Tabelle
// und keine Formel: eine gemeinsame Silhouette säße auf mindestens einer Zunge sichtbar daneben.
//
//   x, y, w, h  Bounding-Box als Anteil des Brettbildes (0..1)
//   poly        Silhouette in Prozent dieser Box
//   oben        hängt die Zunge an der Oberkante?

export interface Zunge {
  x: number;
  y: number;
  w: number;
  h: number;
  oben: boolean;
  poly: string;
}

/** Pixelmaß des Brettbildes — der viewBox, in dem die Pfade unten leben. */
export const MARK_W = 2528;
export const MARK_H = 1696;

const TOP = "0.00 0.00 , 100.00 0.00 , ";
const BOT = "0.00 100.00 , 100.00 100.00 , ";

export const NEOMARKS: Record<string, Zunge> = {
  "13": { x: 0.00989, y: 0.0, w: 0.07595, h: 0.39126, oben: true, poly: TOP + "59.57 100.00" },
  "14": { x: 0.08697, y: 0.0, w: 0.07909, h: 0.39126, oben: true, poly: TOP + "52.94 100.00" },
  "15": { x: 0.16495, y: 0.0, w: 0.07648, h: 0.39126, oben: true, poly: TOP + "51.64 100.00" },
  "16": { x: 0.23949, y: 0.0, w: 0.07492, h: 0.39126, oben: true, poly: TOP + "54.61 100.00" },
  "17": { x: 0.31463, y: 0.0, w: 0.07896, h: 0.39126, oben: true, poly: TOP + "51.20 100.00" },
  "18": { x: 0.39045, y: 0.0, w: 0.07882, h: 0.39126, oben: true, poly: TOP + "52.10 100.00" },
  "19": { x: 0.53183, y: 0.0, w: 0.07445, h: 0.39126, oben: true, poly: TOP + "43.33 100.00" },
  "20": { x: 0.60523, y: 0.0, w: 0.07818, h: 0.39126, oben: true, poly: TOP + "43.66 100.00" },
  "21": { x: 0.67903, y: 0.0, w: 0.07911, h: 0.39126, oben: true, poly: TOP + "52.73 100.00" },
  "22": { x: 0.75684, y: 0.0, w: 0.07588, h: 0.39126, oben: true, poly: TOP + "47.46 100.00" },
  "23": { x: 0.83313, y: 0.0, w: 0.07585, h: 0.39126, oben: true, poly: TOP + "49.48 100.00" },
  "24": { x: 0.9087, y: 0.0, w: 0.08819, h: 0.39126, oben: true, poly: TOP + "39.39 100.00" },
  "12": { x: 0.00989, y: 0.60815, w: 0.07832, h: 0.39126, oben: false, poly: BOT + "56.30 0.00" },
  "11": { x: 0.08809, y: 0.60815, w: 0.07448, h: 0.39126, oben: false, poly: BOT + "52.33 0.00" },
  "10": { x: 0.16037, y: 0.60815, w: 0.08039, h: 0.39126, oben: false, poly: BOT + "46.07 0.00" },
  "9": { x: 0.23586, y: 0.60815, w: 0.07702, h: 0.39126, oben: false, poly: BOT + "48.57 0.00" },
  "8": { x: 0.31154, y: 0.60815, w: 0.07778, h: 0.39126, oben: false, poly: BOT + "46.71 0.00" },
  "7": { x: 0.3858, y: 0.60815, w: 0.07729, h: 0.39126, oben: false, poly: BOT + "48.84 0.00" },
  "6": { x: 0.52663, y: 0.60815, w: 0.07929, h: 0.39126, oben: false, poly: BOT + "51.41 0.00" },
  "5": { x: 0.60336, y: 0.60815, w: 0.07558, h: 0.39126, oben: false, poly: BOT + "45.87 0.00" },
  "4": { x: 0.67845, y: 0.60815, w: 0.07475, h: 0.39126, oben: false, poly: BOT + "50.74 0.00" },
  "3": { x: 0.75228, y: 0.60815, w: 0.07633, h: 0.39126, oben: false, poly: BOT + "50.20 0.00" },
  "2": { x: 0.8272, y: 0.60815, w: 0.07471, h: 0.39126, oben: false, poly: BOT + "55.31 0.00" },
  "1": { x: 0.9022, y: 0.60815, w: 0.08819, h: 0.39126, oben: false, poly: BOT + "45.22 0.00" },
};

/** Die Silhouette einer Zunge als SVG-Pfad im 2528×1696-Raum des Brettbildes. */
export function markPath(no: number): string | null {
  const d = NEOMARKS[String(no)];
  if (!d) return null;
  const pts = d.poly.split(",").map((q) => {
    const [a, b] = q.trim().split(/\s+/).map(Number);
    return [(d.x + (a / 100) * d.w) * MARK_W, (d.y + (b / 100) * d.h) * MARK_H];
  });
  return "M" + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L") + " Z";
}

/**
 * Wo die Schraffur ansetzt: verankert an der SPITZE der Zunge, untere Reihe gespiegelt. Der Versatz
 * von 14 setzt den Anfang des ersten Balkens genau auf die Spitze, damit die Zunge nicht über ihre
 * eigene Markierung hinausschaut.
 */
export function markHatch(no: number): { x: number; y: number; angle: number } | null {
  const d = NEOMARKS[String(no)];
  if (!d) return null;
  return {
    x: (d.x + 0.5 * d.w) * MARK_W,
    y: (d.oben ? d.y + d.h : d.y) * MARK_H,
    angle: d.oben ? 45 : -45,
  };
}
