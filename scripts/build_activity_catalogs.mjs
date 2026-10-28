/**
 * Build the three activity packs:
 *   catalogs/restaurant_boissons.db
 *   catalogs/boulangerie.db
 *   catalogs/maraicher_primeur.db
 *
 * Usage: node scripts/build_activity_catalogs.mjs
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { ACTIVITY_CATALOGS, expandCatalog } from './activity_catalogs.mjs';
import { exportWeebiBytes } from '../js/catalog/export_weebi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dataDir = join(root, 'data');
const outDir = join(root, 'catalogs');
const PHOTO_MAX_EDGE = 800;
const PHOTO_JPEG_QUALITY = 70;

/**
 * @param {string} rel under data/
 * @returns {Promise<Uint8Array>}
 */
async function resizeToJpeg(rel) {
  const abs = join(dataDir, rel);
  await access(abs);
  const buf = await sharp(abs)
    .rotate()
    .resize({
      width: PHOTO_MAX_EDGE,
      height: PHOTO_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: PHOTO_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  return new Uint8Array(buf);
}

async function buildOne(def) {
  const { calibres, categories, photoPlan, kept } = expandCatalog(def);
  /** @type {Map<string, Uint8Array>} */
  const cache = new Map();
  /** @type {Array<{ calibreTitle: string, id: number, extension: string, data: Uint8Array }>} */
  const photos = [];

  for (const plan of photoPlan) {
    let data = cache.get(plan.file);
    if (!data) {
      data = await resizeToJpeg(plan.file);
      cache.set(plan.file, data);
    }
    photos.push({
      calibreTitle: plan.calibreTitle,
      id: plan.id,
      extension: 'jpeg',
      data,
    });
  }

  const require = createRequire(import.meta.url);
  const sqlJsPath = dirname(require.resolve('sql.js'));
  const bytes = await exportWeebiBytes(
    { calibres, categories, photos },
    { locateFile: (file) => join(sqlJsPath, file) },
  );

  await mkdir(outDir, { recursive: true });
  const dbPath = join(outDir, def.dbFile);
  await writeFile(dbPath, bytes);

  const articles = calibres.reduce((n, c) => n + c.articles.length, 0);
  const review = {
    generatedAt: new Date().toISOString(),
    counts: {
      calibres: calibres.length,
      articles,
      categories: categories.length,
      photos: photos.length,
      skipped: def.skipped.length,
    },
    categories: categories.map((c) => ({
      title: c.title,
      count: c.calibreTitles.length,
    })),
    kept,
    skipped: def.skipped,
  };
  const reviewPath = join(
    outDir,
    def.dbFile.replace(/\.db$/, '.review.json'),
  );
  await writeFile(reviewPath, JSON.stringify(review, null, 2), 'utf8');
  console.log(
    `${def.id}: ${calibres.length} calibres, ${articles} articles, ${categories.length} categories → ${dbPath}`,
  );
}

async function main() {
  for (const def of ACTIVITY_CATALOGS) {
    await buildOne(def);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
