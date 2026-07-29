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
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const sha256 = async (filePath) =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

/*
 * The frozen Paper corner sources intentionally include their square material
 * backing because they are used to close the full running frame. Compact cards
 * need the identical sun engraving without that square. Recovering coverage
 * against the known flat backing and pigment preserves the approved geometry
 * and antialiasing without regenerating or redrawing the artwork.
 */
const variants = [
  {
    theme: "day",
    source: "paper-sun-square-day-paper-v1.png",
    output: "paper-sun-emblem-day-oxblood-v1.png",
    background: [232, 223, 195],
    pigment: [71, 35, 38],
  },
  {
    theme: "night",
    source: "paper-sun-square-night-black-gold-v1.png",
    output: "paper-sun-emblem-night-antique-gold-v1.png",
    background: [17, 17, 18],
    pigment: [146, 112, 70],
  },
];

const results = [];

for (const variant of variants) {
  const { data, info } = await sharp(artifactPath(variant.source))
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(info.width * info.height * 4);
  const direction = variant.pigment.map(
    (channel, index) => channel - variant.background[index],
  );
  const denominator = direction.reduce(
    (sum, channel) => sum + channel * channel,
    0,
  );
  let visiblePixels = 0;
  let borderVisiblePixels = 0;

  for (let offset = 0; offset < data.length; offset += 4) {
    const sourceAlpha = data[offset + 3] / 255;
    const observed = [
      data[offset] - variant.background[0],
      data[offset + 1] - variant.background[1],
      data[offset + 2] - variant.background[2],
    ];
    const projectedCoverage = clamp01(
      observed.reduce(
        (sum, channel, index) => sum + channel * direction[index],
        0,
      ) / denominator,
    );
    const coverage = projectedCoverage < 0.012 ? 0 : projectedCoverage;
    const alpha = Math.round(255 * sourceAlpha * coverage);

    output[offset] = variant.pigment[0];
    output[offset + 1] = variant.pigment[1];
    output[offset + 2] = variant.pigment[2];
    output[offset + 3] = alpha;
    if (alpha > 0) visiblePixels += 1;

    const pixel = offset / 4;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) {
      if (alpha > 0) borderVisiblePixels += 1;
    }
  }

  if (visiblePixels < info.width * info.height * 0.02) {
    throw new Error(`${variant.theme}: compact Paper emblem is unexpectedly empty`);
  }
  if (borderVisiblePixels > 24) {
    throw new Error(`${variant.theme}: compact Paper emblem retained a backing edge`);
  }

  const outputPath = artifactPath(variant.output);
  await sharp(output, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 9, palette: false })
    .toFile(outputPath);

  results.push({
    theme: variant.theme,
    output: variant.output,
    width: info.width,
    height: info.height,
    visiblePixels,
    sha256: await sha256(outputPath),
  });
}

console.log(JSON.stringify(results, null, 2));
