# Vietnam Sources • Official v0.2.0

Stremio addon dùng để **dò nguồn phim/series Việt Nam trên nhiều nền tảng chính thức/public**, thay vì hard-code từng phim như bản VTV Movies v0.1.0.

## Cách hoạt động

1. Stremio gọi `/stream/movie/<imdb>.json` hoặc `/stream/series/<imdb>:<season>:<episode>.json`.
2. Addon dùng Cinemeta để lấy tên phim/tập tương ứng với IMDb ID.
3. Addon dò các trang public đã được index trên:
   - VTV Go (`vtvgo.vn`)
   - THVLi (`thvli.vn`)
   - HTV (`htv.com.vn`)
   - TV360 (`tv360.vn`)
   - VieON (`vieon.vn`)
   - FPT Play (`fptplay.vn`)
4. Kết quả được trả về Stremio dưới dạng `externalUrl` để mở đúng trang/app chính thức.
5. Nếu chưa dò thấy trang cụ thể, addon trả các nút tìm kiếm giới hạn theo từng domain và một nút YouTube cho các kênh chính thức.

## Điều addon KHÔNG làm

- Không giải mã/trích DRM.
- Không vượt đăng nhập, thuê bao hoặc geo-block.
- Không proxy/copy video có bản quyền.
- Không tích hợp các trang phát hành không rõ quyền phân phối.

Vì vậy “toàn bộ nguồn” ở đây nghĩa là **tổng hợp rộng các nguồn chính thức/public có thể được phát hiện**, không thể bảo đảm mọi phim Việt đều có nguồn hoặc mọi dịch vụ đều cho xem miễn phí.

## Chạy local

Yêu cầu Node.js 18+.

```bash
npm start
```

Mở:

```text
http://127.0.0.1:7000/manifest.json
```

## Deploy Render

1. Tạo GitHub repo mới và upload toàn bộ thư mục này.
2. Render → New → Blueprint hoặc Web Service.
3. Chọn repo.
4. Render nhận `render.yaml`/`Dockerfile` và deploy.
5. Sau khi deploy, cài URL:

```text
https://TEN-SERVICE.onrender.com/manifest.json
```

## Biến môi trường

- `CACHE_TTL_SECONDS` mặc định `21600` (6 giờ).
- `MAX_RESULTS_PER_PROVIDER` mặc định `2`.
- `SEARCH_TIMEOUT_MS` mặc định `7000`.

## Ghi chú kỹ thuật

Addon chỉ khai báo resource `stream`, nên không chèn thêm catalog vào Home. Metadata/catalog hiện có của AIOMetadata/TMDB vẫn giữ nguyên; addon này chỉ bổ sung nguồn khi bạn mở một phim/tập.
