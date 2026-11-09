# 🎬 VietStream — Addon phim Việt cho Nuvio / Stremio

Addon tổng hợp luồng xem phim từ các nguồn Việt Nam, hỗ trợ đầy đủ **Vietsub (phụ đề), Lồng tiếng, Thuyết minh**.
Việt theo giao thức addon chuẩn của Stremio nên cài trực tiếp vào **Nuvio** (Android/iOS) và **Stremio v4/Web**.

Đã test thật với phim điện ảnh & phim bộ (IMDb ID → stream m3u8 phát trực tiếp).

> 📺 **Muốn dùng không cần server?** Repo còn kèm **plugin Nuvio** (JS chạy trong app, hệ plugin NuvioMobile) tại
> [`nuvio-plugin/`](nuvio-plugin/README.md) — cài bằng URL:
> `https://raw.githubusercontent.com/henryhnguy/vietstream-nuvio-addon/main/nuvio-plugin/manifest.json`

## 📡 Các nguồn được hỗ trợ

| Nguồn | API | Trạng thái | Ghi chú |
|---|---|---|---|
| **KKphim** | `phimapi.com` | ✅ Hoạt động tốt | m3u8 trực tiếp, có sẵn IMDb ID, catalog + thể loại đầy đủ |
| **K20** | `sc.k-20.xyz` | ✅ Hoạt động tốt | Backend Stremio công khai, gộp NguonC / HH3D / STP / VSMOV / Yan; giữ direct/proxy HLS, headers và subtitles của từng stream |
| **Xem20 (Xem14 cũ)** | `xem20.net` | 🔐 Tùy chọn | Nguồn Fshare/downfshare yêu cầu tài khoản; chỉ bật khi Render có `XEM20_LOGIN` + `XEM20_PASSWORD` |
| **NguonC** | `phim.nguonc.com/api` | ✅ Hoạt động tốt | Có m3u8 trực tiếp hoặc link StreamC (addon tự giải mã) |
| **Phim4K** | `vsmov.com/api` | ✅ Hoạt động | Nhóm VSMOV 4K, tự giải mã embed → `master.m3u8`, nhiều server Thuyết minh |
| **Tophim (Motchill)** | `tophim.top` | ✅ Hoạt động | Hậu duệ còn sống của nhà **Motchill / PhimMoi** (site tự nhận brand này), gộp thêm stream kkphim/ophim/nguonc; search API + slug theo TMDB ID |
| **VnStream** | cobephim.biz (API riêng) | ⚠️ Tuỳ mạng | Lấy m3u8 từ trang xem phim; một số nhà mạng chặn, khi đó nguồn này tự bỏ qua |
| **OPhim** | `ophim.live` (cấu hình được) | ⚠️ Tuỳ domain | OPhim gốc đã ngừng hoạt động; đổi domain bằng `OPHIM_API_URL` khi cần |

> ℹ️ **Motchill & PhimVui**: các domain cũ (motchill.net, motchilltv.app, motchill.co, phimvui...) đã chết,
> bị chiếm hoặc rao bán (đã kiểm tra thực tế). Tophim chính là nhánh còn hoạt động của cùng hệ nhà —
> khi Motchill ra domain mới chạy cùng CMS, chỉ cần set `TOPHIM_API_URL` là dùng lại được ngay.

> ⚠️ **Xem20 domain:** chỉ dùng `xem20.net`. Các domain `xem20.com`, `xem20.org`, `xem20.best`
> là site cờ bạc không liên quan. Addon không tự đăng ký tài khoản, không commit/log credential, cookie hoặc ticket phát.

Nguồn nào chết/không truy cập được **tự động bỏ qua**, không làm treo addon hay các nguồn khác.

## ✨ Tính năng

- **Streams theo IMDb ID** — Nuvio mở bất kỳ phim nào (tt…), addon tra tên phim qua Cinemeta rồi tìm trên các nguồn Việt.
- **Chấm điểm khớp thông minh** — ưu tiên IMDb ID trùng > tên gốc khớp tuyệt đối > khớp một phần, kèm kiểm tra năm sản xuất và số mùa ("Phần N") để tránh nhầm phim bộ nhiều mùa.
- **Ghi nhãn audio** — mỗi stream ghi rõ `Vietsub / Lồng Tiếng / Thuyết Minh / Song Ngữ` + chất lượng (HD/FHD/4K) để phân biệt ngay trong danh sách stream.
- **Catalog cho Discover** — Phim lẻ, Phim bộ, Chiếu rạp, Hoạt hình, 4K…; K20 bổ sung catalog đa nguồn và tìm kiếm riêng.
- **Xem20 đăng nhập tùy chọn** — giữ cookie/CSRF ở server, trả direct `downfshare` play URL; không proxy video qua Render để bảo vệ quota.
- **Tìm kiếm** — gõ tên phim (tiếng Việt không dấu hoặc tiếng Anh) là tìm được trên tất cả nguồn.
- **Meta + danh sách tập** — mở phim từ catalog có đầy đủ poster, mô tả, danh sách tập để xem tiếp.
- **HLS proxy chống 403** — bọc m3u8/segment, tự gắn Referer/Origin cho nguồn cần (mặc định: NguonC/StreamC).
- **Cache nhiều lớp** — catalog/search/meta/detail đều có TTL, giảm số request về nguồn.

## 🚀 Chạy local

Cần Node.js ≥ 18.

```bash
npm install
npm test
npm start
# → Manifest: http://localhost:7001/manifest.json
```

Trang chủ addon (xem trạng thái nguồn): http://localhost:7001/

## 📲 Cài vào Nuvio

1. Mở **Nuvio → Settings → Addons → Add Addon** (hoặc nút ➕ ở mục Addons).
2. Dán URL manifest:
   - Máy tính và điện thoại **cùng mạng Wi-Fi**: `http://<IP-máy-tính>:7001/manifest.json`
     (Xem IP bằng `ipconfig` trên Windows / `ifconfig` trên macOS-Linux. Ví dụ: `http://192.168.1.10:7001/manifest.json`)
   - Đã deploy lên cloud: dùng URL public, VD `https://ten-app.onrender.com/manifest.json`
3. Xác nhận — addon hiện trong Discover với các catalog phim Việt.

Stremio v4/Web cài y hệt: dán manifest URL vào ô *Add addon*.

## ☁️ Deploy (một cú bấm)

**Render — khuyên dùng, gói free** (region Singapore gần Việt Nam nhất):

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/henryhnguy/vietstream-nuvio-addon)

Bấm nút → đăng nhập Render bằng GitHub → chọn tên service → **Apply**. Xong lấy URL dạng `https://vietstream-addon.onrender.com`, manifest là `https://vietstream-addon.onrender.com/manifest.json`.

> Gói free của Render sẽ ngủ sau ~15 phút không ai truy cập; lần mở đầu tiên mất 30–60 giây để thức dậy (Nuvio chỉ cần đợi thêm chút khi mở lần đầu).

**Railway** (có giới hạn free hàng tháng):

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.app/new/template?template=https://github.com/henryhnguy/vietstream-nuvio-addon)

**Fly.io / VPS (Docker):** repo có sẵn `fly.toml` — cài [flyctl](https://fly.io/docs/flyctl/), chạy `flyctl launch` rồi `flyctl deploy`. Hoặc VPS bất kỳ:

```bash
docker build -t vietstream-addon .
docker run -d -p 7001:7001 --name vietstream vietstream-addon
```

## ⚙️ Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `7001` | Cổng HTTP |
| `PROVIDERS` | (tất cả) | Chỉ bật các nguồn liệt kê, VD `kkphim,k20,nguonc,phim4k` (Xem20 vẫn cần credential) |
| `PROXY_PROVIDERS` | `nguonc` | Nguồn đi qua HLS proxy: danh sách, `*` (tất cả), `none` |
| `KKPHIM_API_URL` | `https://phimapi.com` | API KKphim |
| `NGUONC_API_URL` | `https://phim.nguonc.com/api` | API NguonC (tự fallback `nguonc.com/api`) |
| `PHIM4K_API_URL` | `https://vsmov.com/api` | API Phim4K/VSMOV |
| `TOPHIM_API_URL` | `https://tophim.top` | API Tophim (nhà Motchill/PhimMoi) |
| `K20_API_URL` | `https://sc.k-20.xyz` | Backend Stremio công khai K20 |
| `XEM20_SITE_URL` | `https://xem20.net` | Domain phim Xem20/Xem14; không dùng các domain look-alike |
| `XEM20_LOGIN` / `XEM20_PASSWORD` | — | Secret tài khoản Xem20; thiếu một trong hai thì nguồn tự ẩn |
| `OPHIM_API_URL` | `https://www.ophim.live` | API OPhim (đổi khi có domain clone mới) |
| `VNSTREAM_API_URL` | (API cobephim) | API VnStream |
| `VNSTREAM_SITE_URL` | `https://cobephim.biz` | Trang web VnStream |
| `CINEMETA_URL` | `https://v3-cinemeta.strem.io` | Cinemeta (tra IMDb → tên phim) |
| `TIMEOUT` / `TIMEOUT_STREAM` | `8000` / `9000` | Timeout request (ms) |
| `DEBUG` | — | Đặt `1` để log chi tiết catalog |

### Bật Xem20 trên Render

1. Mở service Render → **Environment** → **Add Environment Variable**.
2. Thêm `XEM20_LOGIN` và `XEM20_PASSWORD` dưới dạng secret; không ghi giá trị vào repo.
3. Nếu đã đặt `PROVIDERS`, thêm `xem20` vào danh sách.
4. Redeploy/Restart service, rồi refresh addon trong Nuvio/Stremio.

Xem20 phát trực tiếp từ `dl.downfshare.top`; addon không relay video qua Render free. Nếu login hết hạn, server tự đăng nhập lại một lần.

## 🔌 API của addon (cho dev)

| Endpoint | Mô tả |
|---|---|
| `GET /manifest.json` | Manifest Stremio/Nuvio |
| `GET /stream/movie/{tt…}.json` | Streams cho phim lẻ |
| `GET /stream/series/{tt…}:{season}:{episode}.json` | Streams cho tập phim bộ |
| `GET /stream/movie/kk_{slug}.json` | Stream trực tiếp theo ID nguồn (`kk_`, `k20_`, `x20_`, `op_`, `nc_`, `vn_`, `p4k_`, `tp_`) |
| `GET /catalog/{type}/{catalog}.json` | Catalog (VD `catalog/movie/kkphim-phim-le.json`) |
| `GET /catalog/{type}/{catalog}/genre=X&skip=20.json` | Lọc thể loại / phân trang |
| `GET /catalog/{type}/{catalog}/search=…json` | Tìm kiếm |
| `GET /meta/{type}/{prefix}_{slug}.json` | Chi tiết phim + danh sách tập |
| `GET /hls/manifest.m3u8?url=…&ref=…` | HLS proxy (m3u8) |
| `GET /hls/seg?url=…&ref=…` | HLS proxy (segment/key) |

## 🧩 Thêm nguồn mới

Mỗi nguồn là một file trong `src/providers/` kế thừa `BaseProvider`, cài 4 hàm:
`search(q)`, `listCatalog(kind, extra)`, `detail(slug)`, `streamsFromSlug(slug, type, season, episode)`.
Sau đó khai báo trong `src/config.js` (`PROVIDERS`) và `src/manifest.js` (`CATALOG_DEFS`). Xem `kkphim.js` làm mẫu.

## 🩺 Xử lý sự cố

- **Không hiện stream cho phim nào** — kiểm tra máy có truy cập được `phimapi.com`, `phim.nguonc.com` không (DNS/vpn); xem log server.
- **Stream nguồn X hết hoạt động** — các nguồn Việt đổi domain rất thường xuyên; chỉ cần set biến môi trường API URL tương ứng, không phải sửa code.
- **Stream bị 403 khi phát** — bật proxy cho nguồn đó: `PROXY_PROVIDERS=nguonc,tennguon`.
- **Phim bộ nhiều mùa ra sai tập** — addon thử 3 ứng viên khớp tốt nhất theo mùa; một số nguồn đánh số tập liên tục nên có thể lệch, thử stream của nguồn khác.

## ⚠️ Lưu ý

Addon chỉ **tổng hợp và trỏ tới** các API công khai của bên thứ ba, không lưu trữ nội dung nào.
Dành cho mục đích cá nhân và học tập; người dùng tự chịu trách nhiệm khi sử dụng theo quy định địa phương.
