'use strict';

const express = require('express');
const cors = require('cors');
const routes = require('./src/routes');
const { CONFIG } = require('./src/config');

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: true }));
app.use(routes);

// bắt lỗi rẻ nhánh
app.use((err, req, res, next) => {
  console.error('[server]', err.message);
  if (!res.headersSent) res.status(500).json({ err: 'internal error' });
});

app.listen(CONFIG.port, () => {
  console.log(`\n🎬 VietStream addon đang chạy.`);
  console.log(`   Manifest (dán vào Nuvio/Stremio): http://localhost:${CONFIG.port}/manifest.json`);
  console.log(`   Trang chủ: http://localhost:${CONFIG.port}/\n`);
});
