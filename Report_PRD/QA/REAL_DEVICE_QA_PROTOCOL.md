# Quy trình Kiểm thử Thực nghiệm trên Thiết bị Thật (Real-Device QA Protocol)

> **Tài liệu tham chiếu:** [PRD_Deep_v2.md](file:///c:/Users/lhp14/learn_afterUni/SafeCheck/Report_PRD/PRD_Deep_v2.md) (v2.1) - Giai đoạn 2  
> **Mục tiêu:** Đo lường định lượng các chỉ số độ trễ và tỷ lệ trùng lặp thông báo trên thiết bị di động vật lý (iPhone iOS 16.4+ Standalone PWA và Android Chromium PWA).

---

## 1. Yêu cầu Môi trường & Thiết bị Tiên quyết

1. **Thiết bị Apple iOS (iPhone):**
   - Phiên bản: iOS 16.4 trở lên.
   - **Bắt buộc:** Mở SafeCheck trên Safari $\rightarrow$ Bấm nút **Chia sẻ (Share)** $\rightarrow$ Chọn **"Thêm vào Màn hình chính" (Add to Home Screen)**.
   - Mở ứng dụng từ icon trên Màn hình chính (chạy ở chế độ Standalone PWA).
   - Đăng nhập tài khoản con cháu và bấm **"Bật cảnh báo nền"** để cấp quyền Thông báo (Allow Notifications).
2. **Thiết bị Android:**
   - Trình duyệt: Google Chrome / Chromium phiên bản mới nhất.
   - Cài đặt PWA lên màn hình chính và cấp quyền Thông báo.
3. **Môi trường Backend:**
   - Database Supabase đã chạy migration `20260922000000_resilient_push_deliveries.sql`.
   - Endpoint `/api/send-push` đã refactor với RFC 8030 (`TTL: 300`, `urgency: high`, `topic: sos_${hash24}`).

---

## 2. Ma trận 5 Kịch bản Kiểm thử Thực nghiệm

### Kịch bản 1: Nhận Thông báo khi Màn hình Khóa (Lock Screen)
- **Chuẩn bị:** Khóa màn hình điện thoại người thân trong 5 phút (không sạc pin).
- **Thực hiện:** Kích hoạt SOS từ máy Cụ bà.
- **Tiêu chí Quan sát:**
  - [ ] Màn hình khóa sáng đèn, biểu ngữ thông báo màu đỏ xuất hiện.
  - [ ] Tiêu đề hiển thị đúng: `🚨 SafeCheck - BÁO ĐỘNG SOS: [Tên Cụ]`.
  - [ ] Có âm thanh và rung báo động theo cài đặt của hệ điều hành.

### Kịch bản 2: Khởi động Nguội (Cold Start sau > 4 Giờ Ngủ Sâu)
- **Chuẩn bị:** Đặt điện thoại người thân qua đêm (> 4 giờ không chạm vào máy, Service Worker đã bị OS tắt hoàn toàn khỏi RAM).
- **Thực hiện:** Kích hoạt SOS lúc 06:00 sáng.
- **Tiêu chí Quan sát:**
  - [ ] Thiết bị nhận được thông báo cứu hộ mà không bị OS nuốt gói tin.
  - [ ] Bấm giờ từ lúc Cụ kích hoạt đến khi chuông reo: Ghi nhận thời gian vào biên bản đo lường.

### Kịch bản 3: Chế độ Tiết kiệm Pin (Low Power Mode / Android Doze)
- **Chuẩn bị:** 
  - Trên iPhone: Bật **Cài đặt $\rightarrow$ Pin $\rightarrow$ Chế độ nguồn điện thấp (Low Power Mode)**.
  - Trên Android: Bật **Chế độ tiết kiệm pin (Battery Saver)**.
- **Thực hiện:** Kích hoạt SOS.
- **Tiêu chí Quan sát:**
  - [ ] Gói tin mang `urgency: high` của RFC 8030 phá vỡ trạng thái ngủ sâu và kích hoạt thông báo cứu hộ.

### Kịch bản 4: Xử lý Gửi bù & Chống Bão Chuông khi Retry (`is_retry = true`)
- **Chuẩn bị:** Người thân đã nhận được 1 thông báo SOS trên màn hình khóa.
- **Thực hiện:** Backend kích hoạt retry lần 2 cho cùng 1 sự kiện SOS (`attempt_count: 2`, `is_retry: true`).
- **Tiêu chí Quan sát:**
  - [ ] **Chống trùng UI:** Cùng tag `safecheck-sos-[uuid]` cập nhật đè lên banner cũ, **không sinh ra banner thứ 2 tách rời** trên màn hình khóa.
  - [ ] **Chống giật mình:** Cấu hình `renotify: false` yêu cầu OS duy trì thông báo mà không reo chuông/rung lặp lại lần 2.

### Kịch bản 5: Chạm Notification Điều hướng 1-Chạm (Deep-Link Navigation)
- **Thực hiện:** Người thân chạm vào biểu ngữ trên màn hình khóa.
- **Tiêu chí Quan sát:**
  - [ ] Ứng dụng mở ra ngay lập tức và điều hướng đúng về đường dẫn `/?sos=[uuid]`.
  - [ ] Giao diện Caregiver hiển thị ngay ca cấp cứu của Cụ bà kèm nút **"Tiếp nhận / Tắt báo động"** mà không bị văng ra trang trắng hay trang chủ.

---

## 3. Biểu mẫu Đo lường Chỉ số Thực nghiệm (Latency & Duplicate Metrics)

| Chỉ số Cần đo | Định nghĩa Kỹ thuật | Mục tiêu (Target) | Kết quả iPhone (iOS 16.4+) | Kết quả Android |
| :--- | :--- | :--- | :--- | :--- |
| **Gateway Latency (P50)** | `accepted_at - created_at` trong `push_deliveries` | $\le 2.0$ giây | *Đang đo* | *Đang đo* |
| **Gateway Latency (P95)** | `accepted_at - created_at` trong `push_deliveries` | $\le 8.0$ giây | *Đang đo* | *Đang đo* |
| **Observed Latency (P50)** | Bấm giờ thực tế: Cụ nhấn SOS $\rightarrow$ Máy Con reo chuông | $\le 4.0$ giây | *Đang đo* | *Đang đo* |
| **Observed Latency (P95)** | Bấm giờ thực tế (khi máy ngủ sâu/chạy pin) | $\le 15.0$ giây | *Đang đo* | *Đang đo* |
| **Duplicate Rate** | Số ca phát sinh 2 banner tách rời / Tổng số ca test | **0%** | *Đang đo* | *Đang đo* |
| **Deep-link Accuracy** | Tỷ lệ chạm notification mở đúng màn hình SOS | **100%** | *Đang đo* | *Đang đo* |

---

## 4. Hướng dẫn Truy vấn SQL Lấy Chỉ số Gateway Latency từ Supabase

```sql
-- Truy vấn độ trễ Gateway phân vị P50 và P95 theo từng đợt phân phát
SELECT 
    COUNT(*) AS total_deliveries,
    COUNT(*) FILTER (WHERE status = 'accepted') AS accepted_count,
    COUNT(*) FILTER (WHERE status = 'expired') AS expired_count,
    ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (accepted_at - created_at)))::numeric, 2) AS p50_gateway_latency_seconds,
    ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (accepted_at - created_at)))::numeric, 2) AS p95_gateway_latency_seconds
FROM public.push_deliveries
WHERE status = 'accepted';
```
