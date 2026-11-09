'use strict';

const { CONFIG } = require('./config');
const { getJson, cached } = require('./utils');

// Tra metadata từ Cinemeta (Stremio) để đổi IMDb ID -> tên phim + năm.
// Nuvio truyền vào mã IMDb (tt...), còn các nguồn Việt chỉ hiểu tên tiếng Việt/tiếng Anh.

async function getMeta(type, imdbId) {
  if (!imdbId || !/^tt\d+$/.test(imdbId)) return null;
  return cached(`cinemeta:${type}:${imdbId}`, 24 * 3600 * 1000, async () => {
    const data = await getJson(`${CONFIG.cinemetaUrl}/meta/${type}/${imdbId}.json`, { timeout: CONFIG.timeout });
    const meta = data && data.meta;
    if (!meta || !meta.name) return null;
    const yearM = String(meta.releaseInfo || meta.year || '').match(/\d{4}/);
    return {
      imdbId: meta.imdb_id || imdbId,
      name: meta.name,
      year: yearM ? parseInt(yearM[0], 10) : null,
      type,
      runtime: meta.runtime,
      description: meta.description
    };
  });
}

module.exports = { getMeta };
