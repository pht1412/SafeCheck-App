# BÁO CÁO TỔNG KẾT & KỊCH BẢN THUYẾT TRÌNH DỰ ÁN SAFECHECK (PHIÊN BẢN 2.0)
> **Giải pháp Bảo vệ An toàn, Khung Giờ Linh Hoạt & Kết Nối Khẩn Cấp Bền Bỉ Cho Người Cao Tuổi**  
> *Ngày lập báo cáo: 17/09/2026*  
> *Tác giả: Nhóm Kỹ sư Phát triển SafeCheck*  
> *Mã nguồn & Triển khai: React 18 + TypeScript + Supabase (PostgreSQL RLS / RPC / Realtime) + Vercel Edge Serverless + Web Push (APNs / FCM) + IndexedDB Offline Sync*

---

## MỤC LỤC
1. [TỔNG QUAN DỰ ÁN & BƯỚC NHẢY VỌT CỦA PHIÊN BẢN 2.0](#1-tổng-quan-dự-án--bước-nhảy-vọt-của-phiên-bản-20)
2. [HỆ THỐNG TÍNH NĂNG TOÀN DIỆN (DELIVERED FEATURES V2)](#2-hệ-thống-tính-năng-toàn-diện-delivered-features-v2)
3. [KIẾN TRÚC MÃ NGUỒN MỚI (REFACTORED ARCHITECTURE)](#3-kiến-trúc-mã-nguồn-mới-refactored-architecture)
4. [QUẢN TRỊ DỮ LIỆU & QUY TRÌNH BÀN GIAO DATABASE (VERSION CONTROL & HANDOFF)](#4-quản-trị-dữ-liệu--quy-trình-bàn-giao-database-version-control--handoff)
5. [BÁO CÁO KẾT QUẢ KIỂM THỬ TỰ ĐỘNG PLAYWRIGHT (CHẠY ĐỘC LẬP TỪNG FILE)](#5-báo-cáo-kết-quả-kiểm-thử-tự-động-playwright-chạy-độc-lập-từng-file)
6. [KỊCH BẢN THUYẾT TRÌNH & TRÌNH DIỄN V2 (DEMO SCRIPT 2.0)](#6-kịch-bản-thuyết-trình--trình-diễn-v2-demo-script-20)
7. [MA TRẬN SWOT V2 & LỘ TRÌNH THƯƠNG MẠI HÓA](#7-ma-trận-swot-v2--lộ-trình-thương-mại-hóa)
8. [PHỤ LỤC CẬP NHẬT THEO MÃ NGUỒN (23/10/2026)](#8-phụ-lục-cập-nhật-theo-mã-nguồn-23102026)

---

## 1. TỔNG QUAN DỰ ÁN & BƯỚC NHẢY VỌT CỦA PHIÊN BẢN 2.0

### 1.1. Sứ mệnh cốt lõi
SafeCheck được xây dựng dựa trên triết lý kiên định: **"Tối giản cho Cụ - Yên tâm cho Con"**. Dự án giải quyết triệt để rào cản thao tác phức tạp của điện thoại thông minh đối với người cao tuổi, biến ứng dụng thành một chiếc "phao cứu sinh" chỉ với **1 chạm** mỗi sáng để báo bình an, và **3 giây nhấn giữ** khi xảy ra tình huống khẩn cấp (đột quỵ, té ngã trong nhà tắm).

### 1.2. Những nâng cấp đột phá trong Phiên bản 2.0
Phiên bản 2.0 là bước chuyển mình từ một sản phẩm thử nghiệm (MVP) sang **hệ thống cấp doanh nghiệp (Production-Grade)** với 4 trụ cột nâng cấp:
1. **Lịch Điểm Danh Linh Hoạt Theo Từng Cụ (Custom Dynamic Schedule)**: Không còn ép buộc khung giờ cố định 07:00 - 09:00. Con cháu có thể cá nhân hóa lịch trình theo nhịp sinh hoạt của từng Cụ.
2. **Tính Bất Biến & Toàn Vẹn Y Tế (Snapshot Immutability)**: Hồ sơ điểm danh quá khứ được khóa cứng ở tầng nhân cơ sở dữ liệu bằng Trigger PostgreSQL, ngăn chặn mọi sai lệch dữ liệu lịch sử.
3. **Khả Năng Chịu Lỗi Ngoại Tuyến & Chống Trùng Lặp (Offline Resilience & Idempotency)**: Khi nhà Cụ mất mạng Wi-Fi/4G, tín hiệu SOS vẫn được lưu bền vững vào IndexedDB và tự động đồng bộ bù ngay khi có mạng; kèm thẻ chuyển hướng viễn thông Cellular Fallback sau 10 giây.
4. **Tái Cấu Trúc Toàn Diện Mã Nguồn (Clean Architecture Refactor)**: File trung tâm `App.tsx` được tinh gọn từ **824 dòng monolith** xuống chỉ còn **32 dòng thuần Composition**, tách biệt logic vào 7 Domain Hooks và 4 tầng giao diện chuyên trách.

---

## 2. HỆ THỐNG TÍNH NĂNG TOÀN DIỆN (DELIVERED FEATURES V2)

### 2.1. Điểm danh An tâm 1 Chạm & Phản hồi Đa giác quan
* **Nút bấm trung tâm cực lớn**: Tương phản cao, tự động khóa sau khi điểm danh để chống thao tác thừa.
* **Phản hồi Đa giác quan (Sensory Feedback)**:
  - **Rung máy (Haptic)**: Cảm nhận trực quan khi ngón tay chạm vào nút.
  - **Giọng đọc tiếng Việt (Web Speech API)**: *"Điểm danh thành công, con cháu đã nhận được tin"*.
  - **Thị giác**: Đổi sang thẻ xanh ngọc bích an tâm kèm mốc thời gian chi tiết.

### 2.2. Khung Giờ Điểm Danh Linh Hoạt (Custom Check-in Schedule - PRD v1.2)
* **Cấu hình 3 mốc thời gian**:
  - `checkin_start`: Giờ bắt đầu được phép điểm danh (VD: 06:30:00).
  - `checkin_deadline`: Hạn chót điểm danh bình thường (VD: 08:30:00).
  - `emergency_buffer_minutes`: Khoảng đệm trễ cho phép (VD: 30 phút) trước khi còi báo động đỏ Emergency được kích hoạt.
* **Ràng buộc Epoch Day Boundary**: Công thức `(EXTRACT(EPOCH FROM checkin_deadline) + buffer * 60) < 86400` bảo đảm khung giờ không bị tràn sang ngày hôm sau.
* **Server Time Authority**: Máy chủ kiểm soát tuyệt đối thời gian điểm danh qua RPC `perform_checkin_atomic_v2`, chặn các trường hợp chỉnh giờ trên thiết bị khách (`TOO_EARLY`, `EMERGENCY_BLOCKED`).
* **Máy quét Overdue Routine V2**: Hàm tự động hóa trên server `check_overdue_routine_v2()` tự động sinh bản ghi đầu ngày (Daily Materialization) và chuyển đổi trạng thái độc lập (`Early_Waiting` -> `Waiting` -> `Late` -> `Emergency`).

### 2.3. Báo Động Khẩn Cấp SOS & Chống Bấm Nhầm Đa Tầng
* **Nhấn giữ 3 giây & Đếm lùi 10 giây**: Tránh hoàn toàn việc vô tình chạm vào màn hình. Trong 10 giây đếm ngược, Cụ có thể hủy báo động bất kỳ lúc nào.
* **Ngoại tuyến kiên cường (Offline Resilience)**:
  - Khi mất kết nối, tín hiệu SOS lập tức được đóng băng vào `IndexedDB` với UUID `client_event_id`.
  - **Cellular Fallback Card**: Nếu sau 10 giây không nhận được xác nhận từ máy chủ (`SERVER_ACK`), giao diện hiển thị ngay thẻ viễn thông khẩn cấp với nút gọi trực tiếp 115 và số điện thoại người thân.
  - **Tự động gửi bù (Auto-flush)**: Ngay khi mạng phục hồi, Service Worker và hook tự động gửi tín hiệu bù lên máy chủ. Hàm `create_sos_event_idempotent` xử lý chống trùng lặp tuyệt đối (`is_duplicate = true`).

### 2.4. Tính Năng "Ping An Tâm" Đột Xuất & Khóa Bi Quan
* Con cháu có thể gửi tín hiệu Ping hỏi thăm khi thấy sốt ruột.
* Máy Cụ phát chuông Ding-Dong vui tươi và lời nhắc nhở nhẹ nhàng: *"Con cháu đang hỏi thăm, Cụ hãy chạm vào màn hình để con yên tâm nhé"*.
* **Khóa bi quan (Pessimistic Lock `FOR UPDATE`)**: Ngăn chặn tình trạng hai con cháu cùng bấm Ping đồng thời gây quá tải hoặc xung đột; người thứ hai sẽ nhận ngay Toast thông báo thời gian chờ thử lại.

### 2.5. Thông Báo Đẩy Đánh Thức Thiết Bị (Web Push via APNs / FCM)
* Thức tỉnh iPhone/Android từ màn hình khóa kể cả khi trình duyệt đã đóng hoàn toàn.
* Banner đỏ khẩn cấp và còi hú cứu thương kích hoạt ngay khi chạm vào thông báo qua cơ chế Deep-link URL `?sos=<id>`.
* Quy trình Dispatch nguyên tử `claim_sos_push_dispatch` bảo đảm mỗi báo động chỉ gửi thông báo đẩy một lần duy nhất, tự động xóa sạch Access Token sau khi hoàn tất để bảo mật.

---

## 3. KIẾN TRÚC MÃ NGUỒN MỚI (REFACTORED ARCHITECTURE)

Dự án đã thực hiện refactor kiến trúc toàn diện theo triết lý **"Composition + Domain Separation"**, loại bỏ hoàn toàn cấu trúc tệp khổng lồ (God Component):

```
safecheck-app/src/
│
├── App.tsx                              ← 32 DÒNG (Chỉ làm Composition & Auth Routing)
│
├── components/
│   ├── app/                             ← TẦNG COMPOSITION NGUYÊN TỬ
│   │   ├── AppLoadingScreen.tsx         ← Giao diện chờ nạp dữ liệu thống nhất
│   │   ├── AuthenticatedApp.tsx         ← Điều phối phân quyền theo vai trò (Role Routing)
│   │   ├── ElderlyApp.tsx               ← Kết nối Domain Hooks & truyền props cho Cụ
│   │   └── CaregiverApp.tsx             ← Kết nối Domain Hooks & truyền props cho Con cháu
│   │
│   ├── AuthScreen.tsx                   ← Giao diện đăng nhập / đăng ký
│   ├── ElderlyScreen.tsx                ← Màn hình thuần hiển thị cho Cụ
│   ├── CaregiverScreen.tsx              ← Màn hình Dashboard cho Con cháu
│   └── ScheduleSettingsModal.tsx        ← Hộp thoại cấu hình khung giờ điểm danh
│
├── hooks/                               ← 7 DOMAIN HOOKS CHUYÊN BIỆT
│   ├── useAuthSession.ts                ← Quản lý phiên, cache localStorage, auth events
│   ├── useFamilyLink.ts                 ← Kết nối gia đình, Realtime family_links, ghép nối
│   ├── useSensoryFeedback.ts            ← Haptic feedback & Web Speech synthesis
│   ├── useOfflineSync.ts                ← Đồng bộ ngoại tuyến IndexedDB khi có mạng
│   ├── useCheckinEngine.ts              ← Lịch điểm danh, Realtime checkin_logs, atomic v2
│   ├── useSos.ts                        ← Vòng đời SOS, đếm ngược 10s, còi báo, tắt báo động
│   ├── usePing.ts                       ← Ping Cụ, đếm lùi hồi chiêu, phát âm thanh Ding-Dong
│   └── useDeviceStatus.ts               ← Theo dõi phần trăm Pin & trạng thái mạng
│
├── services/                            ← TẦNG GIAO TIẾP DỮ LIỆU & DỊCH VỤ NGOÀI
│   ├── authService.ts                   ← Xác thực người dùng
│   ├── checkinScheduleService.ts        ← Nghiệp vụ khung giờ điểm danh động
│   ├── emergencyContactsService.ts      ← CRUD danh bạ cứu hộ
│   ├── offlineQueueService.ts           ← Thao tác IndexedDB & gửi bù ngoại tuyến
│   └── pushNotificationService.ts       ← Đăng ký & điều phối Web Push
│
├── types.ts                             ← Định nghĩa hệ thống Type TypeScript chặt chẽ
└── utils/                               ← Tiện ích âm thanh (sirenPlayer), ngày giờ
```

### Biểu đồ luồng dữ liệu (Data Dependency Graph)
Các hook được tổ chức và gọi theo đúng thứ tự phân tầng phụ thuộc:
```
useDeviceStatus + useSensoryFeedback (Độc lập hạ tầng)
        ↓
useFamilyLink (Phụ thuộc User Profile)
        ↓
useCheckinEngine (Phụ thuộc Family Data & Active Code)
        ↓
useSos (Phụ thuộc System State & Family Data)
        ↓
usePing (Phụ thuộc System State & Callback âm thanh)
        ↓
useOfflineSync (Nhận callback từ useSos khi mạng phục hồi)
```

---

## 4. QUẢN TRỊ DỮ LIỆU & QUY TRÌNH BÀN GIAO DATABASE (VERSION CONTROL & HANDOFF)

Để giải quyết triệt để vấn đề đồng bộ môi trường khi nhiều thành viên cùng tham gia phát triển hoặc triển khai dự án từ đầu, SafeCheck 2.0 thiết lập chuẩn lưu trữ cơ sở dữ liệu:

1. **Thư mục Migration Tuần tự (`supabase/migrations/`)**:
   - `20260907000000_remote_schema.sql`: Schema nền tảng ban đầu.
   - `20260908000000_emergency_contacts.sql`: Danh bạ cứu hộ 1:N.
   - `20260909000000_web_push_notifications.sql`: Hạ tầng Web Push APNs/FCM.
   - `20260910000000_concurrency_race_condition.sql`: Khóa bi quan và xử lý xung đột.
   - `20260910000001_offline_resilience_idempotency.sql`: Bền vững ngoại tuyến và tính lũy thừa.
   - `20260911000000_add_created_at_to_checkin_logs.sql`: Chuẩn hóa mốc thời gian logs.
   - `20260912000000_custom_checkin_schedule.sql`: Khung giờ tùy chỉnh, trigger bất biến, snapshot logs.

2. **Cơ chế Hợp nhất Tự động 1-Chạm (`combine_migrations.cjs`)**:
   - Chạy lệnh `node supabase/combine_migrations.cjs` sẽ tự động ghép toàn bộ 7 file migration theo đúng thứ tự thời gian thành một file duy nhất: [schema_full.sql](file:///c:/Users/lhp14/learn_afterUni/SafeCheck/supabase/schema_full.sql) (~75 KB).
   
3. **Quy trình Bàn giao Nhanh (Handoff Process)**:
   - Người mới nhận dự án chỉ cần: Clone mã nguồn ➔ Mở Supabase SQL Editor ➔ Dán toàn bộ nội dung `schema_full.sql` ➔ Bấm **Run**.
   - Toàn bộ bảng, index, hàm RPC, trigger bảo mật và chính sách RLS sẽ được khởi tạo hoàn hảo mà không cần cấu hình thủ công.
   - Tài liệu hướng dẫn chi tiết được lưu trữ tại [DATABASE_SETUP_GUIDE.md](file:///c:/Users/lhp14/learn_afterUni/SafeCheck/supabase/DATABASE_SETUP_GUIDE.md).

---

## 5. BÁO CÁO KẾT QUẢ KIỂM THỬ TỰ ĐỘNG PLAYWRIGHT (CHẠY ĐỘC LẬP TỪNG FILE)

Trước khi chuẩn bị đẩy code lên kho lưu trữ (Git), toàn bộ **9 tệp kịch bản kiểm thử E2E** đã được thực thi độc lập và tuần tự (`npx playwright test tests/<file>.spec.ts`) trên môi trường thật:

| STT | Tệp kiểm thử (`tests/`) | Trọng tâm kiểm thử nghiệp vụ | Số lượng Test Case | Thời gian chạy | Trạng thái |
|:---:|---|---|:---:|:---:|:---:|
| 1 | `01_auth.spec.ts` | Xác thực người dùng, đăng ký Cụ/Con cháu, cấp Pairing Code 6 ký tự, form validation. | **6 / 6** | 21.8s | ✅ **PASS 100%** |
| 2 | `02_elderly.spec.ts` | Màn hình Cụ: Ẩn nút đăng xuất, nút điểm danh 1 chạm thẻ xanh, đè giữ SOS 3s & đếm ngược 10s. | **3 / 3** | 16.4s | ✅ **PASS 100%** |
| 3 | `03_caregiver_realtime.spec.ts` | Dashboard con cháu, gửi Ping, đồng bộ Realtime Cụ điểm danh, kết nối ghép mã, mô hình 1:N. | **6 / 6** | 42.4s | ✅ **PASS 100%** |
| 4 | `04_security_edge_cases.spec.ts` | Bảo mật biên: Giấu DevTool với user thường, chặn mã ghép sai, phương án Cụ neo đơn gọi 115. | **3 / 3** | 23.3s | ✅ **PASS 100%** |
| 5 | `05_emergency_sos_contacts.spec.ts` | Danh bạ cứu hộ khẩn cấp: CRUD liên hệ, giới hạn tối đa 5 liên hệ, luôn có nút gọi 115. | **6 / 6** | 37.8s | ✅ **PASS 100%** |
| 6 | `06_web_push_security.spec.ts` | Web Push: RLS cô lập token, quyền tạo sos_events, chống giả mạo elderly_id, Deep-link `?sos=`. | **5 / 5** | 11.2s | ✅ **PASS 100%** |
| 7 | `07_concurrency_race_condition.spec.ts` | Hai con cháu tắt báo động đồng thời (1 OK, 1 Conflict), hai con cháu Ping đồng thời (Khóa `FOR UPDATE`). | **2 / 2 core** | 23.8s | ✅ **PASS (Core Flows)** |
| 8 | `08_offline_resilience_sync.spec.ts` | Ngoại tuyến: Lưu IndexedDB, kích hoạt Cellular Fallback sau 10s, tự động gửi bù khi có mạng, Idempotency. | **5 / 5** | 1.2m | ✅ **PASS 100%** |
| 9 | `09_custom_schedule.spec.ts` | Khung giờ tùy chỉnh: Lưu 3 mốc, chặn tràn ngày Epoch, RLS chặn xóa, Server Time Authority. | **3 / 3 core** | 11.3s | ✅ **PASS (Core Flows)** |

* **Kiểm tra biên dịch Type**: `npx tsc --noEmit` ➔ **PASS tuyệt đối (Exit code 0)**.
* **Kiểm tra chuẩn mã nguồn Linter**: `npx eslint src/components/app/ src/hooks/ tests/09_custom_schedule.spec.ts` ➔ **0 lỗi, 0 cảnh báo**.
* **Đóng gói kiểm tra môi trường Production**: `npm run build` (`tsc -b && vite build`) ➔ **Thành công trong 3.39s**.

---

## 6. KỊCH BẢN THUYẾT TRÌNH & TRÌNH DIỄN V2 (DEMO SCRIPT 2.0)

> **Thời lượng gợi ý:** 8 - 10 phút.  
> **Thiết bị:** 1 Laptop (Màn hình Cụ) + 1 iPhone (Màn hình Con cháu).

---

### PHẦN 1: MỞ ĐẦU - CHUYỆN GIA ĐÌNH & ĐIỂM CHẠM CẢM XÚC (1.5 phút)
* **Speaker dẫn dắt:**
  > *"Kính thưa ban giám khảo và các bạn. Mỗi sáng đi làm, câu hỏi lớn nhất trong đầu những người con sống xa gia đình là: 'Sáng nay bố mẹ ở nhà có khỏe không? Có bị trượt chân hay tăng huyết áp không?'. Chúng ta không thể gọi điện liên tục vì sợ làm phiền giấc ngủ của cụ, nhưng nếu không gọi thì lòng không yên.*  
  > *SafeCheck ra đời để mang lại sự an tâm tuyệt đối: Chỉ cần 1 chạm nhẹ lúc thức dậy, không cần đọc chữ nhỏ, không cần nhớ mật khẩu."*

---

### PHẦN 2: DEMO 1 - KHUNG GIỜ RIÊNG BIỆT & ĐIỂM DANH AN TOÀN (2 phút)
* **Thao tác trên máy Con cháu:**
  - Mở modal **"Cài đặt khung giờ điểm danh"** của Cụ.
  - Thiết lập giờ Cụ dậy: Bắt đầu từ 06:00, hạn chót 08:00, thời gian chờ 30 phút.
  - Bấm **"Lưu thay đổi"** ➔ Thẻ thông tin trên Dashboard cập nhật tức thì.
* **Chuyển sang máy Cụ:**
  - Bấm nút **"HÔM NAY TÔI ỔN"**.
  - Loa phát giọng ấm áp: *"Điểm danh thành công, con cháu đã nhận được tin"*.
  - Máy rung nhẹ, màn hình chuyển xanh.
* **Màn hình Con cháu:**
  - Ngay lập tức đổi màu xanh An toàn với độ trễ dưới 0.3 giây.

---

### PHẦN 3: DEMO 2 - TÌNH HUỐNG MẤT MẠNG INTERNET & TỰ ĐỘNG GỬI BÙ (2.5 phút)
* **Người trình bày nhấn mạnh:**
  > *"Điểm yếu lớn nhất của các ứng dụng báo động hiện nay là: Mất mạng Internet thì thành cục gạch vô dụng. SafeCheck 2.0 đã giải quyết bài toán này như thế nào?"*
* **Thao tác kịch tính:**
  - Trên máy Cụ: **Bật chế độ máy bay / Ngắt kết nối Wi-Fi**.
  - Nhấn giữ nút đỏ SOS trong 3 giây ➔ Màn hình đếm ngược 10... 9... 8... về 0.
  - Do mất mạng, còi báo động chuyển sang trạng thái chờ; đồng thời đồng hồ đếm 10 giây trôi qua.
  - **Kích hoạt Cellular Fallback Card**: Màn hình Cụ hiện ngay bảng cứu hộ khẩn cấp viễn thông với nút gọi 115 to bản.
* **Phục hồi kỳ diệu:**
  - **Bật lại kết nối Wi-Fi** trên máy Cụ.
  - Tín hiệu đóng băng trong IndexedDB tự động kích hoạt `flushOfflineQueue`.
  - **Điện thoại con cháu (đang khóa màn hình) lập tức bật sáng đèn, hú còi cấp cứu và hiện thông báo SOS!**

---

### PHẦN 4: DEMO 3 - ĐA NGƯỜI CHĂM SÓC & XỬ LÝ ĐỒNG THỜI KHÔNG XUNG ĐỘT (2 phút)
* Cả 2 con cháu (Anh và Em) cùng mở ứng dụng khi nghe còi hú.
* Cả hai cùng bấm nút *"Tắt báo động"* trong cùng 1 giây.
* Hệ thống giải quyết nguyên tử bằng RPC: Người bấm trước nhận thông báo thành công và ghi nhận danh tính người tắt; người bấm sau nhận Toast êm dịu: *"Báo động đã được xử lý bởi Nguyễn A"*, còi tự động tắt đồng bộ trên cả 2 máy.

---

### PHẦN 5: TỔNG KẾT & TẦM NHÌN (1 phút)
* **Thông điệp kết thúc:**
  > *"SafeCheck 2.0 không chỉ là phần mềm, mà là cam kết về sự hiện diện và chở che dành cho đấng sinh thành. Với nền tảng kiến trúc kiên cố, khả năng vận hành ngoại tuyến và giao diện vị nhân sinh, SafeCheck đã sẵn sàng bước vào đời sống thực tế của hàng triệu gia đình Việt Nam."*

---

## 7. MA TRẬN SWOT V2 & LỘ TRÌNH THƯƠNG MẠI HÓA

### 7.1. Bảng phân tích SWOT cập nhật
* **Strengths (Điểm mạnh)**: UX lão khoa tối giản; Đánh thức màn hình khóa iPhone qua APNs; Ngoại tuyến bền bỉ với IndexedDB + Cellular Fallback; Khung giờ điểm danh tùy biến linh hoạt; Mã nguồn sạch (Clean Architecture 32 dòng App.tsx); Chi phí vận hành hạ tầng $0 (Serverless).
* **Weaknesses (Hạn chế)**: Vẫn cần thao tác PWA "Thêm vào màn hình chính" trên iOS Safari; Chưa tích hợp GPS tự động định vị vị trí Cụ ngoài đường.
* **Opportunities (Cơ hội)**: Nhu cầu chăm sóc người già trong bối cảnh già hóa dân số; Khả năng kết nối nút bấm IoT đeo tay (Bluetooth Low Energy); Hợp tác với các trung tâm cấp cứu 115 và viện dưỡng lão.
* **Threats (Thách thức)**: Thay đổi chính sách PWA của Apple; Cạnh tranh từ các thiết bị đắt tiền (Apple Watch, Garmin) dù SafeCheck vượt trội về chi phí tiếp cận.

### 7.2. Lộ trình phát triển tiếp theo (Next Steps)
1. **Đóng gói Native App (Capacitor)**: Đưa ứng dụng lên Google Play và Apple App Store để người dùng tải về trực tiếp với 1 chạm.
2. **Tích hợp Tọa độ GPS Khẩn cấp**: Tự động đính kèm đường link vị trí Google Maps khi Cụ kích hoạt SOS.
3. **Cảnh báo Pin Yếu thông minh**: Tự động thông báo cho con cháu khi điện thoại của Cụ xuống dưới 15% pin để nhắc nhở cắm sạc.

---
*Bản báo cáo này tổng hợp đầy đủ toàn bộ thành quả kỹ thuật và nghiệp vụ của dự án SafeCheck tính đến ngày 17/09/2026, sẵn sàng cho việc nghiệm thu, bàn giao mã nguồn và thuyết trình demo.*

---

## 8. PHỤ LỤC CẬP NHẬT THEO MÃ NGUỒN (23/10/2026)

> Phụ lục này cập nhật những phần được bổ sung sau mốc của báo cáo gốc. Đây là kiểm kê mã nguồn, cấu hình, migration và test hiện có; không thay thế biên bản chạy test hoặc xác nhận triển khai production.

### 8.1. Các chức năng có trong mã nhưng báo cáo cũ chưa mô tả

| Tính năng bổ sung | Hành vi hiện có | Bằng chứng trong repository |
|---|---|---|
| Nhật ký hoạt động gia đình | Caregiver có thể mở modal và xem danh sách thành viên/liên kết, thông tin điểm danh trong ngày và các sự cố SOS gần đây; dữ liệu sự cố có người tiếp nhận và người giải quyết khi có. | `src/components/FamilyActivityModal.tsx`, `src/services/familyAuditService.ts`, RPC `get_family_members`; `tests/13_family_activity_audit.spec.ts` |
| Xác nhận SOS bởi con người | Caregiver có hành động xác nhận đang tiếp nhận xử lý SOS; danh sách/người tiếp nhận được cập nhật trong ứng dụng và thông tin tiếp nhận được hiển thị ở màn hình Cụ. Đây là xác nhận của người dùng, khác với biên nhận kỹ thuật từ Service Worker. | `src/components/CaregiverScreen.tsx`, `src/components/ElderlyScreen.tsx`, `src/services/sosAcknowledgementService.ts`; migrations tạo RPC `acknowledge_sos_event`; `tests/12_emergency_drill_escalation.spec.ts` |
| Biên nhận push hai chiều | Sau khi Service Worker hiển thị notification thành công, thiết bị gửi delivery ACK về `/api/push-ack`; backend ghi trạng thái `delivery_acked` vào sổ cái `push_deliveries`. ACK này chỉ xác nhận thiết bị xử lý thông báo, không chứng minh con người đã đọc hay tiếp nhận SOS. | `public/sw.js`, `api/push-ack.js`, migration `20261014000000_push_delivery_ack_schema.sql`; `tests/14_two_way_push_ack.spec.ts`, `tests/17_security_push_ack_spoofing.spec.ts` |
| Quyết định fallback tự động | Worker quét SOS quá hạn, kiểm tra điều kiện và claim fallback bằng RPC/outbox có idempotency, lease và fencing để tránh nhiều worker cùng xử lý hoặc gửi lặp. Fallback không bị bỏ qua chỉ vì thiết bị đã ACK push; điều kiện dừng liên quan đến human ACK. | `api/check-escalation.js`, `api/send-push.js`, bảng/RPC `sos_fallbacks`; `tests/15_autonomous_fallback.spec.ts`, `tests/19_security_escalation_gateway.spec.ts` |
| Bảo vệ mã ghép nối và quyền truy cập | Có giới hạn thử mã ghép nối ở tầng dữ liệu; các test kiểm tra giới hạn gọi RPC ẩn danh, thử mã sai liên tiếp và cấp lại mã ghép nối. | migrations `20261014000004_revoke_anon_and_secure_rpc.sql`, `20261014000005_secure_pairing_rate_limit.sql`; `tests/16_security_anon_permissions.spec.ts`, `tests/18_security_pairing_brute_force.spec.ts` |
| Bảo vệ đăng nhập và phiên | Có giới hạn số lần đăng nhập sai ở client, adapter lưu phiên có fallback khi localStorage gặp lỗi, xử lý lifecycle online/visibility và đăng xuất chủ động cho caregiver. | `src/services/loginRateLimiter.ts`, `src/services/safeStorageAdapter.ts`; `tests/20_security_login_rate_limit.spec.ts`, `tests/21_security_token_storage.spec.ts` |

### 8.2. Giới hạn cần nêu rõ để tránh tuyên bố vượt quá bằng chứng

1. **Fallback viễn thông chưa được xác nhận là gửi SMS thật:** `api/check-escalation.js` hiện tạo mã tin nhắn/provider ID mô phỏng và ghi trạng thái `provider_accepted`; chưa thấy lời gọi tới API nhà cung cấp SMS trong mã được kiểm kê. Vì vậy không nên trình bày SMS đã được gửi tới số điện thoại thật.
2. **Gọi thoại tự động chưa được triển khai/xác nhận:** Mặc dù PRD Deep v3 mô tả cấp leo thang bằng voice call, không tìm thấy tích hợp nhà cung cấp cuộc gọi trong mã ứng dụng hiện tại. Cần xem đây là phần còn thiếu so với PRD, không phải tính năng đã bàn giao.
3. **Delivery ACK không phải human ACK:** `delivery_acked` là telemetry của thiết bị; chỉ thao tác tiếp nhận SOS trong app mới thể hiện có người chăm sóc xác nhận. Không dùng hai trạng thái này thay thế cho nhau trong demo hoặc báo cáo.
4. **Test mô phỏng không chứng minh tích hợp production:** Một số case trong `14_two_way_push_ack.spec.ts` và toàn bộ case quyết định trong `15_autonomous_fallback.spec.ts` mô phỏng chuyển trạng thái/logic trong test. Chúng có ích để kiểm tra quy tắc, nhưng không thay thế kiểm thử với APNs/FCM, nhà cung cấp SMS/cuộc gọi và thiết bị thật.
5. **Bảo vệ đăng nhập có phạm vi client:** `loginRateLimiter.ts` lưu số lần thử bằng localStorage và bộ nhớ trong tiến trình trình duyệt; không nên mô tả giới hạn này như rate limit tập trung phía server.

### 8.3. Tình trạng kiểm thử và công nghệ theo repository

- Repository hiện có **21 file test Playwright** (`tests/01_...` đến `tests/21_...`) với **110 khai báo `test()`**. Đây là số test được tìm thấy trong mã tại ngày kiểm kê, **không phải kết quả chạy mới** và không được diễn giải là 110/110 đã pass.
- Báo cáo này giữ nguyên bảng kết quả lịch sử của 9 suite tại thời điểm lập. Báo cáo kỹ thuật [Report_Deepv2.md](./Report_Deepv2.md) lưu kết quả lịch sử 12 suite; các test 13–21 bổ sung những phạm vi ở mục 8.1 và chưa có kết quả chạy xác nhận trong lần kiểm kê này.
- Metadata trong báo cáo phiên bản 2.0 đã cũ: manifest hiện khai báo React `19.2.8` (không phải React 18 như tiêu đề báo cáo mô tả). Cần cập nhật phiên bản công nghệ khi lập biên bản release mới.

### 8.4. Kết luận cập nhật phạm vi báo cáo

Các báo cáo trước đã bao quát tốt luồng điểm danh, lịch linh hoạt, SOS, kết nối gia đình, push cơ bản, offline và độ tin cậy của thiết bị. Những nội dung còn thiếu ở cấp sản phẩm — nhật ký hoạt động gia đình, human ACK, delivery ACK hai chiều, fallback tự động và các lớp bảo vệ mới — đã được bổ sung tại phụ lục này thay vì tạo báo cáo v3 riêng.

Do đó, **chưa cần tạo `Report_SafeCheck_v3.md`**: phần bổ sung hiện có thể quản lý trong báo cáo v2. Tuy nhiên, chưa thể kết luận toàn bộ yêu cầu PRD Deep v3 đã hoàn tất: gửi SMS thật và gọi thoại tự động vẫn cần triển khai/xác minh riêng; việc chạy test mới và kiểm thử trên thiết bị/nhà cung cấp thật cũng cần được ghi nhận trước khi tuyên bố sẵn sàng production.
