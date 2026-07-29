import type {
  BottomCaricatureIdContract,
  PaperMuseIdContract,
  PostDesignAssignmentContract,
  ThoughtMuseIdContract
} from "@/packages/contracts/src";

const ASSET_ROOT = "/symposium-artifacts/v1";
const asset = (fileName: string) => `${ASSET_ROOT}/${fileName}`;

type ThemedAssets = Readonly<{
  day: string;
  night: string;
  sha256: Readonly<{ day: string; night: string }>;
}>;

export const PAPER_MUSE_REGISTRY = {
  calliope: {
    id: "calliope",
    label: "Calliope",
    assets: {
      day: asset("calliope-amphora-full-pour-no-name-day-oxblood-v1.png"),
      night: asset("calliope-amphora-full-pour-no-name-night-gold-v1.png"),
      sha256: {
        day: "904b4d8bd300de8871c47a4349e623b60b157deb63846120f4d4b8114af8f47d",
        night: "70e062c749e576777aa7fff3e525b877a168f7a7c4aa92fd0aea4e918afeaf61"
      }
    },
    canvas: { width: 1114, height: 1342 },
    visibleInsets: { left: 8, right: 6 },
    runoffAnchor: { x: 570, y: 1292 },
    displayHeights: { desktop: 150, compact: 140, tablet: 122, mobile: 100 },
    translateY: 14,
    scaleX: 1
  },
  urania: {
    id: "urania",
    label: "Urania",
    assets: {
      day: asset("urania-globe-chalice-pour-bowl-day-oxblood-v1.png"),
      night: asset("urania-globe-chalice-pour-bowl-night-gold-v1.png"),
      sha256: {
        day: "4b7ce87fde02c053fae8ce8a35d16c1bb13ec06b629e369f3427cd31e334fbe0",
        night: "97d2d1c62caad223457ffbed6b69fa0e47eec63e6db59f244852c80822748054"
      }
    },
    canvas: { width: 901, height: 1746 },
    visibleInsets: { left: 84, right: 81 },
    runoffAnchor: { x: 205, y: 1561 },
    displayHeights: {
      desktop: 184.47912,
      compact: 172.2546,
      tablet: 150.0282,
      mobile: 122.2452
    },
    translateY: 16,
    scaleX: 1.05
  }
} as const satisfies Record<PaperMuseIdContract, {
  id: PaperMuseIdContract;
  label: string;
  assets: ThemedAssets;
  canvas: { width: number; height: number };
  visibleInsets: { left: number; right: number };
  runoffAnchor: { x: number; y: number };
  displayHeights: { desktop: number; compact: number; tablet: number; mobile: number };
  translateY: number;
  scaleX: number;
}>;

export const THOUGHT_MUSE_REGISTRY = {
  erato: {
    id: "erato",
    label: "Erato",
    status: "approved-frozen",
    frozenAt: "2026-07-28",
    approvalScope: "all-registered-breakpoints",
    assets: {
      day: asset("thought-muse-erato-day-olive-v1.png"),
      night: asset("thought-muse-erato-night-smoked-mineral-v4.png"),
      sha256: {
        day: "6ff43fbe460039bdf36c1c3b83c21699d3b230a4e95af3fafc6619a9f77e3fa4",
        night: "d18e177152a75f6c42529b822e30ad0a99b7d907eea27b13713ece409a978673"
      }
    },
    canvas: { width: 400, height: 704 },
    visibleBounds: { minX: 12, minY: 12, maxX: 379, maxY: 700, width: 368, height: 689 },
    displayHeights: { desktop: 160, compact: 150, tablet: 140, mobile: 125 },
    margins: {
      desktop: { top: 10, bottom: -17 },
      compact: { top: 10, bottom: -17 },
      tablet: { top: 8, bottom: -9 },
      mobile: { top: 6, bottom: -10 }
    }
  },
  thalia: {
    id: "thalia",
    label: "Thalia",
    status: "approved-frozen",
    frozenAt: "2026-07-28",
    approvalScope: "desktop-day-night",
    assets: {
      day: asset("thought-muse-thalia-day-olive-v1.png"),
      night: asset("thought-muse-thalia-night-smoked-mineral-v1.png"),
      sha256: {
        day: "1a9385e4ba0374a615b733b0b14433fd03ca7b5980efb38790fc054cd88262cc",
        night: "2732d4b7b26dc9edf6dc3f2c511ea7e371851c7a526c6e9ae473924cbbef2bc2"
      }
    },
    canvas: { width: 1105, height: 1423 },
    visibleBounds: { minX: 18, minY: 7, maxX: 1077, maxY: 1396, width: 1060, height: 1390 },
    displayHeights: { desktop: 150, compact: 142, tablet: 132, mobile: 118 },
    margins: {
      desktop: { top: 10, bottom: -14 },
      compact: { top: 10, bottom: -14 },
      tablet: { top: 8, bottom: -8 },
      mobile: { top: 6, bottom: -9 }
    }
  }
} as const satisfies Record<ThoughtMuseIdContract, {
  id: ThoughtMuseIdContract;
  label: string;
  status: "approved-frozen";
  frozenAt: string;
  approvalScope: "all-registered-breakpoints" | "desktop-day-night";
  assets: ThemedAssets;
  canvas: { width: number; height: number };
  visibleBounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
  displayHeights: { desktop: number; compact: number; tablet: number; mobile: number };
  margins: {
    desktop: { top: number; bottom: number };
    compact: { top: number; bottom: number };
    tablet: { top: number; bottom: number };
    mobile: { top: number; bottom: number };
  };
}>;

type BottomCaricature = Readonly<{
  id: BottomCaricatureIdContract;
  label: string;
  assets: ThemedAssets;
  thoughtSurfaceAssets?: ThemedAssets;
  canvas: Readonly<{ width: number; height: number }>;
  visibleBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  placement: Readonly<{
    desktop: Readonly<{ height: number; translateY: number; maxWidthPercent: number }>;
    mobile: Readonly<{ height: number; translateY: number; maxWidthPercent: number }>;
    opticalOffsetX: number;
  }>;
  eligiblePostTypes: readonly ["paper", "thought"];
  approved: true;
  frozenAt: string;
}>;

export const BOTTOM_CARICATURE_REGISTRY = {
  "resting-warrior": {
    id: "resting-warrior",
    label: "Resting Warrior",
    assets: {
      day: asset("resting-warrior-paper-filled-day-oxblood-v2.png"),
      night: asset("resting-warrior-paper-filled-night-gold-v2.png"),
      sha256: {
        day: "167c70e09e414d04732e5eb9191d71b39a78ca70b2a9cc1c3df759d7894656d6",
        night: "d17f7fa61ab27fec3a0f5d3828829560cca4b1606c873ee8e1000dcd51affd3c"
      }
    },
    canvas: { width: 500, height: 635 },
    visibleBounds: { x: 7, y: 5, width: 484, height: 627 },
    placement: {
      desktop: { height: 160, translateY: -42, maxWidthPercent: 62 },
      mobile: { height: 125, translateY: -36, maxWidthPercent: 84 },
      opticalOffsetX: 0
    },
    eligiblePostTypes: ["paper", "thought"],
    approved: true,
    frozenAt: "2026-07-26"
  },
  "flute-girl": {
    id: "flute-girl",
    label: "Flute Girl",
    assets: {
      day: asset("flute-woman-paper-filled-day-oxblood-v1.png"),
      night: asset("flute-woman-paper-filled-night-gold-v1.png"),
      sha256: {
        day: "fa0d3502ea09acfcc06868cf230317deb6895ef9e12881a227c3f8e970df3cbc",
        night: "6f92e3a0e73907715903bc985afaca5b186f1dffb95cae2ad2bf95882f398499"
      }
    },
    canvas: { width: 923, height: 1704 },
    visibleBounds: { x: 34, y: 66, width: 828, height: 1495 },
    placement: {
      desktop: { height: 180, translateY: -26, maxWidthPercent: 62 },
      mobile: { height: 140, translateY: -22.33, maxWidthPercent: 84 },
      opticalOffsetX: 0
    },
    eligiblePostTypes: ["paper", "thought"],
    approved: true,
    frozenAt: "2026-07-26"
  },
  "discus-thrower": {
    id: "discus-thrower",
    label: "Discus Thrower",
    assets: {
      day: asset("discus-thrower-paper-filled-day-oxblood-v2.png"),
      night: asset("discus-thrower-paper-filled-night-gold-v2.png"),
      sha256: {
        day: "440484eb5e3735c0067eab24bcca7cca940e92906af823b4b539d6c7058e5f87",
        night: "c3cd0d5dd0630a49b6951a5f3da35b73eca397be0e4ecf2dfd155463b06bc864"
      }
    },
    canvas: { width: 564, height: 991 },
    visibleBounds: { x: 10, y: 49, width: 538, height: 925 },
    placement: {
      desktop: { height: 170, translateY: -34, maxWidthPercent: 62 },
      mobile: { height: 132, translateY: -30.33, maxWidthPercent: 84 },
      opticalOffsetX: 0
    },
    eligiblePostTypes: ["paper", "thought"],
    approved: true,
    frozenAt: "2026-07-26"
  },
  "harp-girl": {
    id: "harp-girl",
    label: "Harp Girl",
    assets: {
      day: asset("harp-girl-paper-filled-day-oxblood-v1.png"),
      night: asset("harp-girl-paper-filled-night-gold-v1.png"),
      sha256: {
        day: "782af5816ad8b41c971d5aa10483d5e4ef28d868aa7974bcdda81122fe41e431",
        night: "20c5508f2514f33f01116d08797a40ab3a5fcf9ceb44a8ca61ab71cb05016a8c"
      }
    },
    canvas: { width: 738, height: 923 },
    visibleBounds: { x: 10, y: 12, width: 716, height: 899 },
    placement: {
      desktop: { height: 170, translateY: -34, maxWidthPercent: 62 },
      mobile: { height: 132, translateY: -30.33, maxWidthPercent: 84 },
      opticalOffsetX: 0
    },
    eligiblePostTypes: ["paper", "thought"],
    approved: true,
    frozenAt: "2026-07-26"
  },
  wanderer: {
    id: "wanderer",
    label: "Wanderer",
    assets: {
      day: asset("wanderer-paper-filled-day-oxblood-v1.png"),
      night: asset("wanderer-paper-filled-night-gold-v1.png"),
      sha256: {
        day: "137c11f315ecdbb1e1c43cf3472bde6c3bbb53d0e29da5299bc16429db8f4109",
        night: "aa93af942e6786ec217185525f3a3956bd1e1791f4b41715dadd30aea096dbfd"
      }
    },
    canvas: { width: 258, height: 480 },
    visibleBounds: { x: 15, y: 31, width: 227, height: 440 },
    placement: {
      desktop: { height: 180, translateY: -34, maxWidthPercent: 62 },
      mobile: { height: 140, translateY: -28.55, maxWidthPercent: 84 },
      opticalOffsetX: 0
    },
    eligiblePostTypes: ["paper", "thought"],
    approved: true,
    frozenAt: "2026-07-26"
  },
  lovers: {
    id: "lovers",
    label: "Lovers",
    assets: {
      day: asset("lovers-paper-filled-day-oxblood-v1.png"),
      night: asset("lovers-paper-filled-night-gold-v1.png"),
      sha256: {
        day: "c328543154c18742c10a94f9c5c28dae7fb3515fd302371477c0f10b6375e922",
        night: "60f6d32afe2d9130149764667a06988aaae5adf317ca235d1722c1119e6917bf"
      }
    },
    canvas: { width: 685, height: 1381 },
    visibleBounds: { x: 12, y: 12, width: 661, height: 1357 },
    placement: {
      desktop: { height: 180, translateY: -36, maxWidthPercent: 62 },
      mobile: { height: 140.21052631578945, translateY: -31.5, maxWidthPercent: 84 },
      opticalOffsetX: 0
    },
    eligiblePostTypes: ["paper", "thought"],
    approved: true,
    frozenAt: "2026-07-27"
  },
  chariot: {
    id: "chariot",
    label: "Chariot",
    assets: {
      day: asset("chariot-paper-filled-day-oxblood-v1.png"),
      night: asset("chariot-paper-filled-night-gold-v1.png"),
      sha256: {
        day: "e32473467e72996b8bb234b76f62c0e1ee4c871204a32d072622a395a622d9dc",
        night: "ca243203353997122e552dab897d917b58054761a0485f3d93f88edcda3483cb"
      }
    },
    thoughtSurfaceAssets: {
      day: asset("chariot-thought-surface-line-day-olive-v1.png"),
      night: asset("chariot-thought-surface-line-night-smoked-mineral-v4.png"),
      sha256: {
        day: "9489ac6d3bb4881b94598597034d30a105c7e777bfb4250278c4fbb82dd7d983",
        night: "398aa0fa2b24e962b4c601042a9fa4bdd01a7394cc6872317afd0b9ff63fd483"
      }
    },
    canvas: { width: 1469, height: 758 },
    visibleBounds: { x: 12, y: 12, width: 1451, height: 734 },
    placement: {
      desktop: { height: 135, translateY: -36, maxWidthPercent: 62 },
      mobile: { height: 100.8, translateY: -31.5, maxWidthPercent: 84 },
      opticalOffsetX: 0
    },
    eligiblePostTypes: ["paper", "thought"],
    approved: true,
    frozenAt: "2026-07-27"
  }
} as const satisfies Record<BottomCaricatureIdContract, BottomCaricature>;

export const AUTHORED_ARTIFACT_FOUNDATION = {
  paper: {
    surface: {
      day: asset("paper-surface-study.png"),
      night: asset("paper-surface-night-study.png"),
      sha256: {
        day: "aa36aa238d8f861cdcffe2ea7cf36fa40fbc791c157568d20f2a0f8d866a11b4",
        night: "bfe339f539fdc9f70e2403b3b42af26f13bd40598c3a4f509c5de8dea6ce2028"
      }
    },
    grain: {
      day: asset("paper-grain-study.png"),
      night: asset("paper-grain-night-study.png"),
      sha256: {
        day: "6e61f257c2deedcda928ba023f608425ebe2a8e1fba6639d742a2e41c7ade883",
        night: "9d7ea0dc064f3b0a2264510434e115e885f8cebb30561be56d3d36a249de0142"
      }
    },
    perimeter: {
      day: asset("greek-key-running-frame-day-oxblood-v1.png"),
      night: asset("greek-key-running-frame-night-antique-gold-v1.png"),
      cornerDay: asset("paper-sun-square-day-paper-v1.png"),
      cornerNight: asset("paper-sun-square-night-black-gold-v1.png"),
      sha256: {
        day: "c6abbfa1c0c75b4d8cd1eac8390a2c776f49b531bc872e2597fd9c63a6520a5c",
        night: "95a7aa4d6fa6ca852e4e41481eddf04f762031211bc6c7f53c1589523f2087bd",
        cornerDay: "9c30d30d6c754e2cf489f04ee1c5ef8102d7ad527ea2d644c21aa58fed624d45",
        cornerNight: "f60aadcbd9799da35af0501ff1587c3988068be8a2f8bd18f240e12dd0fb7b75"
      },
      sourceCornerSize: 273,
      sourcePerimeterWidth: 30
    }
  },
  thought: {
    id: "thought-base-v1",
    status: "frozen",
    approvedOn: "2026-07-28",
    surface: {
      dayColor: "#dce8ea",
      dayTexture: asset("paper-surface-study.png"),
      nightColor: "#050d0d",
      nightTexture: asset("thought-surface-night-deep-ink-v4.png"),
      nightTextureSha256: "436f787e8318570e1cab084b1fc84a92e77f7a298e0a4da80ffdf3284de4ae62"
    },
    perimeter: {
      outerDay: asset("thought-outer-perimeter-day-olive-charcoal-v1.png"),
      outerNight: asset("thought-outer-perimeter-night-smoked-mineral-v4.png"),
      waveDay: asset("thought-wave-perimeter-day-olive-charcoal-vector-v3.svg"),
      waveNight: asset("thought-wave-perimeter-night-smoked-mineral-vector-v4.svg"),
      cornerDay: asset("thought-corner-pegasus-olive-detail-v1.png"),
      cornerNight: asset("thought-corner-pegasus-night-smoked-mineral-detail-v4.png"),
      sha256: {
        outerDay: "8926b45233884f64d3b582db85a2c4abb36d724e408379f45da638f7a7f3eca0",
        outerNight: "f9a704a5eb80097f20bc233fc4b788e50db684a5986cabb3c40c3e5cf9d3402b",
        waveDay: "01d751ab370c66f46c6a2b16846c49a6576811de7b9bc9d1d66b0ccdb79e8059",
        waveNight: "05849c41dbc3ba5d70d9a28078e30b8b5a96949a9a8489e350dea4cb6d4553f5",
        cornerDay: "5f1e0b02bd80eec63a91dec50570043826608ba044f9ffc66da902da49c6d6ba",
        cornerNight: "561954d09984eac1b10729437b9a14a1f205f5e23f90e084552b79481889daf5"
      },
      sourceCornerSize: 273,
      sourcePerimeterWidth: 30,
      backgroundArm: 2
    }
  }
} as const;

export type AuthoredArtifactAsset = Readonly<{ path: string; sha256: string }>;

const themedAssetEntries = (assets: ThemedAssets): AuthoredArtifactAsset[] => [
  { path: assets.day, sha256: assets.sha256.day },
  { path: assets.night, sha256: assets.sha256.night }
];

export const AUTHORED_ARTIFACT_ASSET_MANIFEST: readonly AuthoredArtifactAsset[] = [
  { path: AUTHORED_ARTIFACT_FOUNDATION.paper.surface.day, sha256: AUTHORED_ARTIFACT_FOUNDATION.paper.surface.sha256.day },
  { path: AUTHORED_ARTIFACT_FOUNDATION.paper.surface.night, sha256: AUTHORED_ARTIFACT_FOUNDATION.paper.surface.sha256.night },
  { path: AUTHORED_ARTIFACT_FOUNDATION.paper.grain.day, sha256: AUTHORED_ARTIFACT_FOUNDATION.paper.grain.sha256.day },
  { path: AUTHORED_ARTIFACT_FOUNDATION.paper.grain.night, sha256: AUTHORED_ARTIFACT_FOUNDATION.paper.grain.sha256.night },
  { path: AUTHORED_ARTIFACT_FOUNDATION.paper.perimeter.day, sha256: AUTHORED_ARTIFACT_FOUNDATION.paper.perimeter.sha256.day },
  { path: AUTHORED_ARTIFACT_FOUNDATION.paper.perimeter.night, sha256: AUTHORED_ARTIFACT_FOUNDATION.paper.perimeter.sha256.night },
  { path: AUTHORED_ARTIFACT_FOUNDATION.paper.perimeter.cornerDay, sha256: AUTHORED_ARTIFACT_FOUNDATION.paper.perimeter.sha256.cornerDay },
  { path: AUTHORED_ARTIFACT_FOUNDATION.paper.perimeter.cornerNight, sha256: AUTHORED_ARTIFACT_FOUNDATION.paper.perimeter.sha256.cornerNight },
  { path: AUTHORED_ARTIFACT_FOUNDATION.thought.surface.nightTexture, sha256: AUTHORED_ARTIFACT_FOUNDATION.thought.surface.nightTextureSha256 },
  { path: AUTHORED_ARTIFACT_FOUNDATION.thought.perimeter.outerDay, sha256: AUTHORED_ARTIFACT_FOUNDATION.thought.perimeter.sha256.outerDay },
  { path: AUTHORED_ARTIFACT_FOUNDATION.thought.perimeter.outerNight, sha256: AUTHORED_ARTIFACT_FOUNDATION.thought.perimeter.sha256.outerNight },
  { path: AUTHORED_ARTIFACT_FOUNDATION.thought.perimeter.waveDay, sha256: AUTHORED_ARTIFACT_FOUNDATION.thought.perimeter.sha256.waveDay },
  { path: AUTHORED_ARTIFACT_FOUNDATION.thought.perimeter.waveNight, sha256: AUTHORED_ARTIFACT_FOUNDATION.thought.perimeter.sha256.waveNight },
  { path: AUTHORED_ARTIFACT_FOUNDATION.thought.perimeter.cornerDay, sha256: AUTHORED_ARTIFACT_FOUNDATION.thought.perimeter.sha256.cornerDay },
  { path: AUTHORED_ARTIFACT_FOUNDATION.thought.perimeter.cornerNight, sha256: AUTHORED_ARTIFACT_FOUNDATION.thought.perimeter.sha256.cornerNight },
  ...Object.values(PAPER_MUSE_REGISTRY).flatMap((muse) => themedAssetEntries(muse.assets)),
  ...Object.values(THOUGHT_MUSE_REGISTRY).flatMap((muse) => themedAssetEntries(muse.assets)),
  ...Object.values(BOTTOM_CARICATURE_REGISTRY).flatMap((bottom) => [
    ...themedAssetEntries(bottom.assets),
    ...("thoughtSurfaceAssets" in bottom ? themedAssetEntries(bottom.thoughtSurfaceAssets) : [])
  ])
];

export const authoredArtifactConfig = (assignment: PostDesignAssignmentContract) => {
  const bottom = BOTTOM_CARICATURE_REGISTRY[assignment.bottomCaricatureId];
  if (assignment.museId === "calliope" || assignment.museId === "urania") {
    return { postType: "paper" as const, muse: PAPER_MUSE_REGISTRY[assignment.museId], bottom };
  }
  return { postType: "thought" as const, muse: THOUGHT_MUSE_REGISTRY[assignment.museId], bottom };
};
