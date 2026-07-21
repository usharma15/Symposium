import type { InquiryAttachmentContract } from "@/packages/contracts/src";

export type HistoricalAsset = InquiryAttachmentContract & {
  staticPublicPath: string;
  credit?: string;
  sourceUrl?: string;
};

const asset = (value: Omit<HistoricalAsset, "status" | "createdAt">): HistoricalAsset => ({
  ...value,
  status: "previewed",
  createdAt: "2026-07-20T08:00:00.000Z",
  metadata: {
    ...(value.metadata ?? {}),
    staticPublicPath: value.staticPublicPath,
    historicalWorld: true,
    ...(value.credit ? { credit: value.credit } : {}),
    ...(value.sourceUrl ? { sourceUrl: value.sourceUrl } : {})
  }
});

const paper = (
  sequence: number,
  fileName: string,
  byteSize: number,
  title: string,
  authors: string,
  year: string,
  sourceUrl?: string,
  editionNote?: string,
  searchableEdition = true
) => asset({
  id: `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
  fileName,
  contentType: "application/pdf",
  byteSize,
  kind: "pdf",
  staticPublicPath: `/historical-world/papers/${fileName}`,
  sourceUrl,
  metadata: {
    title,
    authors,
    year,
    searchableEdition,
    ...(editionNote ? { editionNote, browserCompatibleEdition: true } : {})
  }
});

export const historicalPapers = {
  bell: paper(1, "bell-on-the-einstein-podolsky-rosen-paradox.pdf", 435350, "On the Einstein Podolsky Rosen Paradox", "John S. Bell", "1964", "https://doi.org/10.1103/PhysicsPhysiqueFizika.1.195"),
  aristotleDreams: paper(2, "aristotle-on-dreams.pdf", 189522, "On Dreams", "Aristotle", "4th century BCE", "https://classics.mit.edu/Aristotle/dreams.html"),
  einstein: paper(3, "einstein-electrodynamics-moving-bodies.pdf", 248064, "On the Electrodynamics of Moving Bodies", "Albert Einstein", "1905", "https://einsteinpapers.press.princeton.edu/vol2-trans/154"),
  feynman: paper(4, "feynman-space-time-approach-qm.pdf", 11538227, "Space-Time Approach to Non-Relativistic Quantum Mechanics", "Richard P. Feynman", "1948", "https://doi.org/10.1103/RevModPhys.20.367", "Browser-compatible RGB reproduction of the supplied 21-page journal scan.", false),
  godel: paper(5, "godel-incompleteness.pdf", 9184479, "On Formally Undecidable Propositions", "Kurt Gödel", "1931", "https://doi.org/10.1007/BF01700692", "Browser-compatible RGB reproduction of the supplied 26-page journal scan.", false),
  heisenberg: paper(6, "heisenberg-quantum-theoretical-kinematics.pdf", 4117975, "Quantum-Theoretical Re-Interpretation of Kinematic and Mechanical Relations", "Werner Heisenberg", "1925", "https://doi.org/10.1007/BF01328377", "Browser-compatible RGB reproduction of the supplied 15-page journal scan.", false),
  platoIon: paper(7, "plato-ion.pdf", 25085, "Ion", "Plato", "c. 4th century BCE", "https://www.gutenberg.org/ebooks/1635", "Clean reading edition typeset from the supplied Benjamin Jowett text; captured browser markup and print footers removed."),
  aristotleLongevity: paper(8, "aristotle-length-shortness-life.pdf", 158589, "On Length and Shortness of Life", "Aristotle", "4th century BCE", "https://classics.mit.edu/Aristotle/life_short.html"),
  meitnerFrisch: paper(9, "meitner-frisch-disintegration-uranium.pdf", 1416659, "Disintegration of Uranium by Neutrons: a New Type of Nuclear Reaction", "Lise Meitner and O. R. Frisch", "1939", "https://doi.org/10.1038/143239a0", "Browser-compatible RGB reproduction of the supplied two-page Nature scan.", false),
  aristotleMemory: paper(10, "aristotle-memory-reminiscence.pdf", 192381, "On Memory and Reminiscence", "Aristotle", "4th century BCE", "https://classics.mit.edu/Aristotle/memory.html"),
  nash: paper(11, "nash-equilibrium-points-n-person-games.pdf", 776710, "Equilibrium Points in N-Person Games", "John F. Nash Jr.", "1950", "https://doi.org/10.1073/pnas.36.1.48", "Browser-compatible RGB reproduction of the supplied two-page journal scan.", false),
  platoApology: paper(12, "plato-apology.pdf", 69704, "Apology", "Plato", "c. 399 BCE", "https://www.gutenberg.org/ebooks/1656"),
  aristotleDivination: paper(13, "aristotle-divination-sleep.pdf", 156732, "On Divination in Sleep", "Aristotle", "4th century BCE", "https://classics.mit.edu/Aristotle/divination.html"),
  platoSymposium: paper(14, "plato-symposium.pdf", 661764, "Symposium", "Plato", "c. 385–370 BCE", "https://www.gutenberg.org/ebooks/1600"),
  watsonCrick: paper(15, "watson-crick-molecular-structure-nucleic-acids.pdf", 1452289, "Molecular Structure of Nucleic Acids", "J. D. Watson and F. H. C. Crick", "1953", "https://doi.org/10.1038/171737a0", "Browser-compatible RGB reproduction of the supplied two-page Nature scan.", false)
} as const;

const image = (sequence: number, fileName: string, byteSize: number, caption: string) => asset({
  id: `20000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
  fileName,
  contentType: fileName.endsWith(".png") ? "image/png" : "image/jpeg",
  byteSize,
  kind: "image",
  staticPublicPath: `/historical-world/images/${fileName}`,
  metadata: { caption, alt: caption, decorativeResearchPresentationImage: true }
});

export const historicalImages = {
  redColonnade: image(1, "red-colonnade.jpg", 82089, "A red colonnade opening onto a garden court."),
  undergroundColumns: image(2, "underground-columns.jpg", 1932609, "Columns receding through a vaulted underground interior."),
  templePediment: image(3, "temple-pediment.jpg", 380866, "A weathered classical temple pediment."),
  dolphinMosaic: image(4, "dolphin-mosaic.jpg", 149419, "A black-and-white floor mosaic with dolphins."),
  blueFloorMosaic: image(5, "blue-floor-mosaic.jpg", 96045, "A geometric blue floor mosaic."),
  classicalInterior: image(6, "classical-interior.jpg", 239392, "A columned classical interior with a distant central figure."),
  grandHall: image(7, "grand-hall.png", 2238096, "A monumental hall of arches, statuary, and warm stone."),
  horsesInWeather: image(8, "horses-in-weather.jpg", 186490, "Horses moving across an exposed landscape in rough weather."),
  statuesAndBasin: image(9, "statues-and-basin.jpg", 38833, "A basin and statuary in a formal courtyard."),
  chariotFrieze: image(10, "chariot-frieze.jpg", 108952, "A relief of horses and a chariot."),
  orangeTreeCloister: image(11, "orange-tree-cloister.jpg", 47243, "An orange tree in a sunlit cloister."),
  celestialMosaic: image(12, "celestial-mosaic.jpg", 227497, "A circular mosaic with celestial figures."),
  creationDetail: image(13, "creation-detail.jpg", 158524, "A painted detail of two hands nearly touching."),
  blakeFigure: image(14, "blake-figure.jpg", 59323, "A luminous figure bent over a compass-like instrument."),
  flammarion: image(15, "flammarion-engraving.jpg", 327332, "A traveller peers beyond the visible sky in the Flammarion engraving."),
  classicalSea: image(16, "classical-sea.jpg", 101065, "Figures on a classical shore beneath a luminous sky."),
  classicalSeascape: image(17, "classical-seascape.jpg", 258804, "A wide classical seascape with architecture and distant figures."),
  achillesHector: image(18, "achilles-hector.jpg", 67082, "An orange-figure scene of Achilles and Hector in combat."),
  mosaicBorder: image(19, "mosaic-border.jpg", 211150, "An intricate black-and-white mosaic border.")
} as const;

export const allHistoricalAssets: HistoricalAsset[] = [
  ...Object.values(historicalPapers),
  ...Object.values(historicalImages)
];

export const historicalAssetById = new Map(allHistoricalAssets.map((entry) => [entry.id, entry]));
