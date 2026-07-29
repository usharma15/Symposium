import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const artifactRoot = path.join(
  process.cwd(),
  "public",
  "symposium-artifacts",
  "v1",
);
const artifactPath = (fileName) => path.join(artifactRoot, fileName);

const PAPER_DAY = "paper-surface-study.png";
const PAPER_NIGHT = "paper-surface-night-study.png";
const PAPER_PIGMENTS = {
  day: [71, 35, 38],
  night: [146, 112, 70],
};
const THOUGHT_PIGMENTS = {
  day: [79, 91, 70],
  night: [88, 97, 95],
};
const CHARACTER_WEIGHTS = [1, 0.84, 0.65];

/*
 * The Paper variants are frozen material composites:
 *
 *   rendered = paper * (1 - lineCoverage) + pigment * lineCoverage
 *
 * Recover the shared line coverage from both Day and Night composites with a
 * two-variable least-squares fit. The second variable preserves the tiny
 * source-character modulation used by Flute Girl without changing any
 * silhouette, antialiasing, placement, or authored engraving detail.
 *
 * Thought variants retain only those engraving pixels. Their transparent
 * interiors let the actual Thought surface colour and repeating texture pass
 * through continuously instead of baking a second, misaligned texture into
 * the figure.
 */
const variants = [
  {
    id: "resting-warrior",
    day: "resting-warrior-paper-filled-day-oxblood-v2.png",
    night: "resting-warrior-paper-filled-night-gold-v2.png",
    offset: [137, 81],
    outputDay: "resting-warrior-thought-surface-line-day-olive-v1.png",
    outputNight:
      "resting-warrior-thought-surface-line-night-smoked-mineral-v1.png",
  },
  {
    id: "flute-girl",
    day: "flute-woman-paper-filled-day-oxblood-v1.png",
    night: "flute-woman-paper-filled-night-gold-v1.png",
    offset: [137, 81],
    outputDay: "flute-woman-thought-surface-line-day-olive-v1.png",
    outputNight:
      "flute-woman-thought-surface-line-night-smoked-mineral-v1.png",
  },
  {
    id: "discus-thrower",
    day: "discus-thrower-paper-filled-day-oxblood-v2.png",
    night: "discus-thrower-paper-filled-night-gold-v2.png",
    offset: [137, 81],
    outputDay: "discus-thrower-thought-surface-line-day-olive-v1.png",
    outputNight:
      "discus-thrower-thought-surface-line-night-smoked-mineral-v1.png",
  },
  {
    id: "harp-girl",
    day: "harp-girl-paper-filled-day-oxblood-v1.png",
    night: "harp-girl-paper-filled-night-gold-v1.png",
    offset: [173, 97],
    outputDay: "harp-girl-thought-surface-line-day-olive-v1.png",
    outputNight:
      "harp-girl-thought-surface-line-night-smoked-mineral-v1.png",
  },
  {
    id: "wanderer",
    day: "wanderer-paper-filled-day-oxblood-v1.png",
    night: "wanderer-paper-filled-night-gold-v1.png",
    offset: [173, 109],
    outputDay: "wanderer-thought-surface-line-day-olive-v1.png",
    outputNight:
      "wanderer-thought-surface-line-night-smoked-mineral-v1.png",
  },
  {
    id: "lovers",
    day: "lovers-paper-filled-day-oxblood-v1.png",
    night: "lovers-paper-filled-night-gold-v1.png",
    offset: [211, 137],
    outputDay: "lovers-thought-surface-line-day-olive-v1.png",
    outputNight:
      "lovers-thought-surface-line-night-smoked-mineral-v1.png",
  },
];

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const sha256 = async (filePath) =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const [
  { data: paperDay, info: paperDayInfo },
  { data: paperNight, info: paperNightInfo },
] = await Promise.all([
  sharp(artifactPath(PAPER_DAY))
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true }),
  sharp(artifactPath(PAPER_NIGHT))
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true }),
]);

const results = [];

for (const variant of variants) {
  const [
    { data: filledDay, info: dayInfo },
    { data: filledNight, info: nightInfo },
  ] = await Promise.all([
    sharp(artifactPath(variant.day))
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(artifactPath(variant.night))
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);

  if (
    dayInfo.width !== nightInfo.width ||
    dayInfo.height !== nightInfo.height
  ) {
    throw new Error(`${variant.id}: Paper Day/Night canvas mismatch`);
  }

  const pixelCount = dayInfo.width * dayInfo.height;
  const outputDay = Buffer.alloc(pixelCount * 4);
  const outputNight = Buffer.alloc(pixelCount * 4);
  let paperAlphaMass = 0;
  let thoughtAlphaMass = 0;
  let visibleThoughtPixels = 0;

  for (let y = 0; y < dayInfo.height; y += 1) {
    for (let x = 0; x < dayInfo.width; x += 1) {
      const pixel = y * dayInfo.width + x;
      const outputOffset = pixel * 4;
      const paperDayOffset =
        (((y + variant.offset[1]) % paperDayInfo.height) *
          paperDayInfo.width +
          ((x + variant.offset[0]) % paperDayInfo.width)) *
        3;
      const paperNightOffset =
        (((y + variant.offset[1]) % paperNightInfo.height) *
          paperNightInfo.width +
          ((x + variant.offset[0]) % paperNightInfo.width)) *
        3;

      const dayAlpha = filledDay[outputOffset + 3];
      const nightAlpha = filledNight[outputOffset + 3];
      if (dayAlpha !== nightAlpha) {
        throw new Error(
          `${variant.id}: Paper Day/Night alpha mismatch at ${x},${y}`,
        );
      }
      if (dayAlpha === 0) continue;

      /*
       * Solve y = a * coverage + b * character for all six theme/channel
       * observations. Coverage is the only quantity used by the transparent
       * Thought artwork.
       */
      let aa = 0;
      let ab = 0;
      let bb = 0;
      let ay = 0;
      let by = 0;
      for (let themeIndex = 0; themeIndex < 2; themeIndex += 1) {
        const filled = themeIndex === 0 ? filledDay : filledNight;
        const paper = themeIndex === 0 ? paperDay : paperNight;
        const paperOffset =
          themeIndex === 0 ? paperDayOffset : paperNightOffset;
        const pigment =
          themeIndex === 0 ? PAPER_PIGMENTS.day : PAPER_PIGMENTS.night;

        for (let channel = 0; channel < 3; channel += 1) {
          const a = pigment[channel] - paper[paperOffset + channel];
          const b = CHARACTER_WEIGHTS[channel];
          const observed =
            filled[outputOffset + channel] - paper[paperOffset + channel];
          aa += a * a;
          ab += a * b;
          bb += b * b;
          ay += a * observed;
          by += b * observed;
        }
      }

      const determinant = aa * bb - ab * ab;
      if (Math.abs(determinant) < 1e-9) {
        throw new Error(`${variant.id}: singular coverage fit at ${x},${y}`);
      }
      const coverage = clamp01((ay * bb - by * ab) / determinant);
      const thoughtAlpha = Math.round(dayAlpha * coverage);

      paperAlphaMass += dayAlpha;
      thoughtAlphaMass += thoughtAlpha;
      if (thoughtAlpha > 0) visibleThoughtPixels += 1;

      for (let channel = 0; channel < 3; channel += 1) {
        outputDay[outputOffset + channel] = THOUGHT_PIGMENTS.day[channel];
        outputNight[outputOffset + channel] =
          THOUGHT_PIGMENTS.night[channel];
      }
      outputDay[outputOffset + 3] = thoughtAlpha;
      outputNight[outputOffset + 3] = thoughtAlpha;
    }
  }

  if (
    visibleThoughtPixels === 0 ||
    thoughtAlphaMass >= paperAlphaMass * 0.75
  ) {
    throw new Error(
      `${variant.id}: recovered artwork does not satisfy surface-through fill`,
    );
  }

  const outputDayPath = artifactPath(variant.outputDay);
  const outputNightPath = artifactPath(variant.outputNight);
  await Promise.all([
    sharp(outputDay, {
      raw: {
        width: dayInfo.width,
        height: dayInfo.height,
        channels: 4,
      },
    })
      .png({ compressionLevel: 9, palette: false })
      .toFile(outputDayPath),
    sharp(outputNight, {
      raw: {
        width: dayInfo.width,
        height: dayInfo.height,
        channels: 4,
      },
    })
      .png({ compressionLevel: 9, palette: false })
      .toFile(outputNightPath),
  ]);

  results.push({
    id: variant.id,
    canvas: [dayInfo.width, dayInfo.height],
    alphaMassRatio: Number(
      (thoughtAlphaMass / paperAlphaMass).toFixed(6),
    ),
    visibleThoughtPixels,
    day: {
      fileName: variant.outputDay,
      sha256: await sha256(outputDayPath),
    },
    night: {
      fileName: variant.outputNight,
      sha256: await sha256(outputNightPath),
    },
  });
}

console.log(JSON.stringify(results, null, 2));
