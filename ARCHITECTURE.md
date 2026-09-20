# Instagram Downloader — kiến trúc và bất biến

Tài liệu này là nguồn tham chiếu trước mọi lần sửa `minimal/content.js`. Mục tiêu là giữ
đúng media đang xem trên Instagram và luôn ghi ra tên `username_filename-goc.ext`.

## Cấu trúc runtime

```text
Tampermonkey loader
  tampermonkey/instagram-downloader.local.user.js
       | @require file:///.../minimal/content.js
       v
minimal/content.js
  scan UI -> resolve đúng media -> makeFilename -> Blob download
```

`minimal/content.js` là toàn bộ logic. Loader chỉ cấp metadata, quyền
`GM_xmlhttpRequest` và nạp file local. Sau khi sửa loader hoặc khi cần ép Tampermonkey
đọc lại `@require`, phải **Save** script trong Tampermonkey và reload tab Instagram.

## Luồng tìm post, reel và ảnh/video

1. `scanPosts`, `scanReels`, `scanStory` thêm nút download theo UI đang có. Chúng chỉ
   gắn nút; không chọn URL download.
2. Khi bấm nút hoặc `S`, `startDownload` tìm `article` tại thời điểm bấm. Không lưu
   object DOM tùy biến trên button: Tampermonkey có isolated-world boundary.
3. `resolvePostOrReel` lấy shortcode từ URL hoặc link trong article, rồi:
   - `findMediaId` đọc `media_id` từ HTML post, có fallback giải mã shortcode base64url.
   - `mediaInfo` gọi `https://i.instagram.com/api/v1/media/<id>/info/` với
     `X-IG-App-ID` tìm từ HTML. Trong userscript, request này phải đi qua
     `GM_xmlhttpRequest` để tránh CORS.
   - `toDownload` chọn candidate lớn nhất: `video_versions` nếu có, nếu không là
     `image_versions2.candidates`.

API là nguồn dữ liệu chuẩn cho owner, loại file, các URL độ phân giải cao và các phần tử
carousel. DOM chỉ dùng để xác định slide nào hiện đang active.

## Carousel trên feed — phần nhạy cảm nhất

Instagram giữ các slide lân cận trong DOM và video feed thường có `currentSrc` là
`blob:`. Vì vậy **không được** lấy ảnh/video đầu tiên trong article để quyết định media.

`carouselIndex(article, parent)` có thứ tự ưu tiên phải giữ nguyên:

1. `?img_index=` khi ở URL post chi tiết.
2. `button[aria-current="step"][aria-label]`: lấy số trong `Go to slide N`. Đây là
   nguồn chính xác nhất hiện tại cho feed.
3. Hình học của các `li[style]`: slide gần tâm ngang article nhất.
4. So URL poster/ảnh render với candidates API. Với video, dùng `video.poster`, không
   dùng `video.currentSrc` nếu nó là `blob:`.
5. Các selector dots cũ của extension gốc và fallback hình học cuối cùng.

Chỉ sau khi có index mới được lấy `parent.carousel_media[index]`. Luồng này dùng chung
cho click và hotkey `S`; đừng tạo một resolver riêng cho hotkey.

## Stories

`resolveStory` ưu tiên media API khi URL chứa numeric story ID. Nếu API không khả dụng,
nó dùng `section video` hoặc ảnh đang render làm fallback. Tên source lấy từ URL thật
của phần tử đang xem.

## Đổi tên và download — bất biến bắt buộc

`makeFilename(media)` tạo đúng một định dạng:

```text
<owner.username>_<basename URL gốc>
```

- Chỉ username là prefix; không thêm ngày tháng, index, ID rút gọn hay premium option.
- Ký tự không hợp lệ cho Windows được thay bằng `_`.
- Nếu URL thiếu extension, thêm `.jpg` cho ảnh và `.mp4` cho video.
- `toDownload` dùng basename URL candidate video cho video/reel; với ảnh ưu tiên URL
  ảnh đang render rồi mới đến URL candidate API. Đây giữ filename Instagram gốc thay vì
  một ID ngẫu nhiên.

**Không thay `save()` bằng `GM_download({ url: CDN_URL, name })`.** Browser/download
manager có thể bỏ qua `name` và trả UUID hoặc filename Content-Disposition. Cơ chế đúng:

```text
GM_xmlhttpRequest(URL CDN, responseType: 'blob')
  -> URL.createObjectURL(blob)
  -> <a download="username_original.ext" href="blob:...">.click()
```

`GM_xmlhttpRequest` chỉ cung cấp quyền lấy bytes xuyên CORS. `a.download` trên Blob URL
là nơi duy nhất quyết định tên file. Fallback `fetch -> Blob` chỉ dùng khi không có
Tampermonkey API.

## Video/reel trên feed

Đừng dùng URL video trực tiếp từ DOM để tải hoặc đặt tên. Feed có thể trả `blob:` cho
`video.currentSrc`; URL đó không đại diện cho file download. Resolver phải lấy
`video_versions` từ media API, trong khi active slide được xác định theo phần Carousel
ở trên. Sau khi đã có URL API, video đi qua đúng cùng Blob-download pipeline với ảnh;
khác duy nhất là sourceName và extension `.mp4`.

## UI, hotkey và context menu

- Màu nút feed: xanh chỉ cho post gần tâm viewport, trắng cho các nút khác. `S` luôn
  download post gần tâm viewport — không dựa trên hover/focus.
- `S` được chặn ở capture phase cho `keydown`, `keypress`, `keyup` để Instagram không
  nhận hotkey Save của chính nó. `A`/`D` chỉ chuyển carousel; không được đụng resolver.
- `unlockImageMenus` mở pointer event cho ảnh media đủ lớn. Listener `contextmenu` chỉ
  dừng handler Instagram, nhờ vậy browser hiện **Save image as** / **Open image in new
  tab** nguyên bản.

## Quy trình sửa an toàn

1. Xác định layer cần sửa: UI, resolver carousel, naming, hay transport. Không sửa
   layer khác để “tiện dọn code”.
2. Nếu sửa resolver carousel, test cả click lẫn `S` với carousel ảnh + video trên feed.
3. Nếu sửa naming/transport, test ít nhất một ảnh và một video/reel; xác minh tên file
   thực tế trong Downloads, không chỉ title nút.
4. Nếu sửa `@require` loader, Save script trong Tampermonkey rồi reload Instagram trước
   khi kết luận.
5. Không xoá fallback selector hoặc phần story/reel/profile chỉ vì chúng trông không
   được dùng trong test hiện tại.

Các điểm 1–4 của carousel và Blob pipeline là regression guards: thay đổi chúng cần có
lý do cụ thể và kiểm chứng thực tế trước khi commit.
