'use strict';

// Cấu hình trung tâm — mọi giá trị đều có thể ghi đè bằng biến môi trường.

function csv(name, fallback) {
  const v = process.env[name];
  return v && v.trim() ? v.split(',').map(s => s.trim()).filter(Boolean) : fallback;
}

const ENABLED_LIST = csv('PROVIDERS', null); // VD: PROVIDERS=kkphim,nguonc → chỉ bật 2 nguồn này

const PROVIDERS = {
  kkphim: {
    id: 'kkphim',
    name: 'KKphim',
    prefix: 'kk_',
    apiUrl: process.env.KKPHIM_API_URL || 'https://phimapi.com',
    cdnImage: process.env.KKPHIM_CDN_IMAGE || 'https://phimimg.com',
    referer: 'https://phimapi.com/',
    enabled: ENABLED_LIST ? ENABLED_LIST.includes('kkphim') : true,
    proxy: false
  },
  ophim: {
    id: 'ophim',
    name: 'OPhim',
    prefix: 'op_',
    apiUrl: process.env.OPHIM_API_URL || 'https://www.ophim.live',
    cdnImage: process.env.OPHIM_CDN_IMAGE || 'https://img.ophim.live',
    siteUrl: process.env.OPHIM_SITE_URL || 'https://www.ophim.live',
    referer: 'https://www.ophim.live/',
    enabled: false,
    proxy: false
  },
  nguonc: {
    id: 'nguonc',
    name: 'NguonC',
    prefix: 'nc_',
    apiUrl: process.env.NGUONC_API_URL || 'https://phim.nguonc.com/api',
    apiFallbacks: ['https://nguonc.com/api'],
    siteUrl: 'https://phim.nguonc.com',
    referer: 'https://phim.nguonc.com/',
    enabled: false,
    // NguonC mở trình phát ngoài bằng externalUrl.
    proxy: false
  },
  vnstream: {
    id: 'vnstream',
    name: 'VNStream',
    prefix: 'vn_',
    apiUrl: process.env.VNSTREAM_COBE_API_URL || 'https://egluy2hhb21vaw5ndw9pbmhl.darkbytes.xyz/api/v1',
    siteUrl: (process.env.VNSTREAM_SITE_URL || 'https://cobephim.fit').replace('cobephim.biz', 'cobephim.fit'),
    referer: 'https://cobephim.fit/',
    enabled: ENABLED_LIST ? ENABLED_LIST.includes('vnstream') : true,
    proxy: true
  },
  phim4k: {
    id: 'phim4k',
    name: 'Phim4K',
    prefix: 'p4k_',
    apiUrl: process.env.PHIM4K_API_URL || 'https://vsmov.com/api',
    siteUrl: process.env.PHIM4K_SITE_URL || 'https://vsmov.com',
    referer: 'https://vsmov.com/',
    enabled: ENABLED_LIST ? ENABLED_LIST.includes('phim4k') : true,
    proxy: false
  },
  tophim: {
    id: 'tophim',
    name: 'Tophim (Motchill)',
    prefix: 'tp_',
    apiUrl: process.env.TOPHIM_API_URL || 'https://tophim.top',
    referer: 'https://tophim.top/',
    enabled: ENABLED_LIST ? ENABLED_LIST.includes('tophim') : true,
    proxy: false
  },
  k20: {
    id: 'k20',
    name: 'K20',
    prefix: 'k20_',
    apiUrl: process.env.K20_API_URL || 'https://sc.k-20.xyz',
    referer: 'https://sc.k-20.xyz/',
    enabled: ENABLED_LIST ? ENABLED_LIST.includes('k20') : true,
    proxy: false
  },
  xem20: {
    id: 'xem20',
    name: 'Xem20',
    prefix: 'x20_',
    apiUrl: process.env.XEM20_SITE_URL || 'https://xem20.net',
    referer: `${process.env.XEM20_SITE_URL || 'https://xem20.net'}/`,
    login: process.env.XEM20_LOGIN || '',
    password: process.env.XEM20_PASSWORD || '',
    enabled: !!(process.env.XEM20_LOGIN && process.env.XEM20_PASSWORD) &&
      (ENABLED_LIST ? ENABLED_LIST.includes('xem20') : true),
    proxy: false,
    authTimeout: parseInt(process.env.XEM20_AUTH_TIMEOUT, 10) || 12000,
    searchTimeout: parseInt(process.env.XEM20_SEARCH_TIMEOUT, 10) || 8000,
    detailTimeout: parseInt(process.env.XEM20_DETAIL_TIMEOUT, 10) || 10000,
    streamTimeout: parseInt(process.env.XEM20_STREAM_TIMEOUT, 10) || 12000
  }
};

const CONFIG = {
  port: parseInt(process.env.PORT, 10) || 7001,
  timeout: parseInt(process.env.TIMEOUT, 10) || 8000,
  streamTimeout: parseInt(process.env.TIMEOUT_STREAM, 10) || 9000,
  cinemetaUrl: process.env.CINEMETA_URL || 'https://v3-cinemeta.strem.io',
  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  // Danh sách nguồn được bọc qua HLS proxy của addon ("*" = tất cả, "none" = không nguồn nào)
  proxyProviders: csv('PROXY_PROVIDERS', ['nguonc']),
  manifest: {
    id: 'community.vietstream',
    version: process.env.VERSION || '1.3.1',
    name: 'VietStream · Phim Việt',
    description:
      'Xem phim Việt đa nguồn: KKphim, K20, Xem20 (tùy chọn), Phim4K, Tophim, VnStream — Vietsub, Lồng tiếng, Thuyết minh. Tương thích Nuvio & Stremio.'
  }
};

module.exports = { CONFIG, PROVIDERS };

