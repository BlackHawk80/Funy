# 📺 VietStream — Plugin Nuvio (hệ plugin riêng của NuvioMobile)

Đây là **plugin scraper JavaScript** chạy trực tiếp trong app Nuvio (QuickJS runtime), khác với
addon Stremio ở thư mục gốc repo. Plugin tự query các nguồn phim Việt ngay trong app,
không cần server riêng:

| Nguồn | API | Ghi chú |
|---|---|---|
| KKphim | `phimapi.com` | m3u8 trực tiếp, Vietsub / Lồng tiếng / Thuyết minh |
| Tophim (Motchill) | `tophim.top` | Nhà Motchill/PhimMoi còn sống; slug theo TMDB ID nên tra cực nhanh |
| NguonC | `phim.nguonc.com/api` | m3u8 trực tiếp hoặc tự giải mã link StreamC |
| Phim4K | `vsmov.com/api` | tự giải mã embed → `master.m3u8` |
| OPhim | `ophim.live` (đổi được) | domain chết sẽ tự bỏ qua |
| VnStream | cobephim.biz | scrape trang xem phim |

> ℹ️ Motchill/PhimVui cũ đã chết domain (đã kiểm tra) — Tophim là nhánh còn sống của cùng hệ nhà.
> Khi Motchill ra domain mới cùng CMS: sửa biến `site` trong hàm `tophimStreams()`.

## 🔗 URL cài plugin

**Cách 1 — qua Render của bạn (khuyên dùng, không phụ thuộc GitHub):**

```
https://<ten-service>.onrender.com/nuvio-plugin/manifest.json
```

(Addon server tự host plugin ở đường dẫn này — thay bằng URL Render thật của bạn.)

**Cách 2 — GitHub raw (dự phòng):**

```
https://raw.githubusercontent.com/henryhnguy/vietstream-nuvio-addon/main/nuvio-plugin/manifest.json
```

> ⚠️ raw.githubusercontent.com hay bị chặn/chậm ở một số nhà mạng Việt Nam — nếu cách 2 không thêm được repo, dùng cách 1.

## 📲 Cài vào Nuvio

> ❗ **Điều kiện bắt buộc:** app phải là bản **full** tải từ
> [GitHub Releases của NuvioMobile](https://github.com/NuvioMedia/NuvioMobile/releases)
> (hoặc NuvioTV). **Bản cài từ Google Play đã bị tắt hẳn tính năng plugin** (flavor `playstore`)
> — plugin sẽ không bao giờ chạy dù cài đúng cách.

1. Mở **Nuvio → Settings → Plugins** → **+ / Add repository** → dán URL manifest ở trên.
2. Repo hiện ra với scraper **VietStream** → bật lên.
3. Mở bất kỳ phim/series nào (Nuvio tra TMDB) → mục **Sources/Streams** sẽ hiện các luồng
   `VietStream · KKphim`, `VietStream · Phim4K`… kèm nhãn audio (Vietsub • Lồng Tiếng • Thuyết Minh).

## 🩺 Plugin không chạy? Kiểm tra theo thứ tự

1. **App có phải bản full không?** Settings → Plugins: nếu **không có mục Plugins** hoặc thêm repo xong
   không thấy gì thay đổi → bạn đang dùng bản Play Store → cài lại APK bản full từ GitHub Releases.
2. **Thêm repo bằng Plugin Tester** (Settings → Plugin Tester → dán URL manifest) — nơi này hiện
   log và lỗi cụ thể. Log mẫu khi chạy đúng:
   ```
   VietStream: movie 872586 S-E- | titles: Oppenheimer | year: 2023
   VietStream [kkphim]: 1 stream
   VietStream: tong cong 3 stream
   ```
   Nếu thấy `titles:` rỗng hoặc `TMDB ... THIEU` → key TMDB của bản app thiếu (dùng bản release chính thức).
3. **Logcat** (khi nối adb): `adb logcat -s "Plugin:*"`.
4. **Repo đã thêm nhưng mở phim không có stream nào** — vào Settings → Plugins → mở repo →
   Refresh, rồi thử phim khác (một số phim không có trên nguồn Việt là bình thường).

## ⚙️ Tắt / bật từng nguồn

Plugin đọc biến settings `disable` (mảng id nguồn: `kkphim`, `tophim`, `nguonc`, `phim4k`, `ophim`, `vnstream`).
Ví dụ tắt OPhim và VnStream:

```json
{ "disable": ["ophim", "vnstream"] }
```

## 🧠 Cách hoạt động

```
Nuvio chọn phim/ tập → PluginRuntime (QuickJS)
  → getStreams(tmdbId, "movie"|"tv", season, episode)
  → TMDB API (dùng TMDB_API_KEY do app inject) → tên VI + tên gốc + năm
  → 5 nguồn chạy SONG SONG (Promise.allSettled, tổng < 60s)
  → mỗi nguồn: search → chấm điểm khớp (tên gốc 100 / tên Việt 90 / một phần 10,
    năm ±1, "Phần N" đúng mùa) → detail → chọn tập theo số tập + server
  → trả về mảng stream { name, title, url, quality, type:"hls", headers }
```

Ràng buộc QuickJS đã xử lý: không `Buffer` (dùng `atob`), không `setTimeout`,
body fetch bị cắt 256KB trên NuvioTV, mỗi request ≤ 30s (TV) / 60s (Mobile).

## 🧪 Test trên máy (Node.js ≥ 18)

```bash
node nuvio-plugin/test/test.js
```

Test harness giả lập TMDB API (vì `TMDB_API_KEY` thật chỉ có trong app) và gọi ra internet thật —
xem kết quả stream cho phim mẫu (Oppenheimer, Game of Thrones).

## 🔧 Sửa nguồn / đổi domain

Toàn bộ domain nguồn nằm ở đầu từng hàm `xxxStreams()` trong
[`providers/vietstream.js`](providers/vietstream.js) — nguồn đổi host chỉ cần sửa 1 dòng.
