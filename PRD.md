# Product Requirements Document (PRD): SafeCheck - Ứng dụng an tâm cho người cao tuổi

## 1. Tổng quan & Vấn đề (Problem Statement)
- **Vấn đề:** Con cháu đi làm xa luôn lo lắng về an toàn của người lớn tuổi sống một mình (nguy cơ đột quỵ, tai nạn té ngã không ai hay biết). Mặt khác, người lớn tuổi gặp rào cản lớn khi thao tác với smartphone thông thường do mắt kém, tay run.
- **Mục tiêu:** Cung cấp giải pháp bảo đảm an toàn mỗi ngày với thao tác tối giản nhất (1 chạm) cho người già, đồng thời cung cấp hệ thống cảnh báo tức thì và công cụ kiểm tra đột xuất cho người thân.

## 2. Đối tượng người dùng (User Personas)
- **Elderly (Người cao tuổi):** Thị lực kém, tay run, chỉ có thể mở màn hình và chạm nút to nhất ở trung tâm.
- **Caregiver (Con/cháu):** Đi làm xa, bận rộn, cần nắm bắt trạng thái an toàn của người thân mỗi ngày, nhận cảnh báo khẩn cấp kịp thời và có thể chủ động kiểm tra tình hình khi lo lắng.

## 3. Hệ thống trạng thái (State Machine)
### 3.1. Danh sách trạng thái chuẩn
- **`Waiting` (Chờ điểm danh):** Trong khung giờ điểm danh hàng ngày (mặc định 07:00 - 09:00).
- **`Safe` (Đã an toàn):** Đã điểm danh thành công trong ngày; ghi nhận mốc thời gian và khóa nút điểm danh để tránh bấm trùng lặp.
- **`Late` (Trễ giờ):** Quá khung giờ quy định mà chưa thấy điểm danh -> Gửi cảnh báo mức 1 (Cảnh báo vàng) tới người thân.
- **`Emergency` (Khẩn cấp):** Quá hạn 30 phút sau khi trễ giờ không phản hồi HOẶC người già nhấn giữ nút SOS 3 giây -> Kích hoạt báo động mức 2 (Cảnh báo đỏ), hú chuông và kích hoạt cuộc gọi khẩn cấp.
- **`Ping_Requested` (Đang kiểm tra đột xuất):** Người thân chủ động bấm "Gửi chuông kiểm tra" trên Dashboard (nút có cooldown 15 phút).
- **`Overdue_Ping` (Kiểm tra trễ giờ):** Người cao tuổi không phản hồi chuông kiểm tra sau 15 phút -> Báo động vàng kèm gợi ý liên hệ hàng xóm hoặc người hỗ trợ gần nhất.

### 3.2. Chu kỳ và Reset
- **Thời điểm reset:** Đúng `00:00` hàng ngày (hoặc mốc bắt đầu khung giờ mới `07:00`), hệ thống tự động reset trạng thái về `Waiting`.

### 3.3. Ma trận chuyển đổi trạng thái (State Transition Matrix)
| Trạng thái hiện tại | Sự kiện kích hoạt (Trigger) | Trạng thái tiếp theo | Hành động của hệ thống |
| :--- | :--- | :--- | :--- |
| **Reset ngày mới (00:00)** | Bắt đầu khung giờ điểm danh (07:00) | `Waiting` | Kích hoạt nút điểm danh lớn trên máy người già |
| **Waiting** | Cụ bấm nút "Con yên tâm / Tôi ổn" | `Safe` | Đổi giao diện xanh lá, rung/chuông xác nhận, gửi push notification cho con cháu |
| **Waiting** | Hết khung giờ (09:00) mà chưa bấm | `Late` | Gửi cảnh báo mức 1 (vàng) tới ứng dụng của con cháu |
| **Late** | Quá hạn 30 phút (09:30) vẫn chưa phản hồi | `Emergency` | Bật cảnh báo mức 2 (đỏ), kích hoạt giao diện gọi khẩn cấp |
| **Bất kỳ lúc nào** | Cụ nhấn giữ nút SOS trong 3 giây | `Emergency` | Bỏ qua mọi khung giờ, lập tức hú còi và báo động đỏ tới con cháu |
| **Waiting / Late / Safe** | Con cháu bấm "Gửi chuông kiểm tra" | `Ping_Requested` | Phát chuông lớn trên máy cụ, kích hoạt nút phản hồi (cooldown 15p) |
| **Ping_Requested** | Cụ bấm nút phản hồi trong vòng 15 phút | `Safe` | Tắt chuông, gửi thông báo an tâm cho con cháu |
| **Ping_Requested** | Quá 15 phút cụ không phản hồi | `Overdue_Ping` | Cảnh báo vàng tới con cháu kèm gợi ý liên hệ người hỗ trợ gần nhất |
| **Emergency / Overdue_Ping** | Con cháu xác nhận đã xử lý trên Dashboard | `Safe` | Tắt còi báo động, đưa hệ thống về trạng thái an toàn |

## 4. Luồng người dùng (User Flows)

### Flow 1: Người lớn tuổi điểm danh hàng ngày
1. Người cao tuổi mở app/web -> Nút "Con yên tâm / Tôi ổn" chiếm trọn trung tâm màn hình.
2. Cụ chạm vào nút -> Máy rung mạnh + phát âm thanh giọng nói: *"Điểm danh thành công, con cháu đã nhận được tin"*.
3. Giao diện chuyển sang màu xanh lá (`Safe`), hiển thị giờ điểm danh và tạm khóa nút.
4. Ứng dụng người thân nhận push notification: *"Bà/Ông đã điểm danh an toàn lúc [HH:mm]"*.

### Flow 2: Xử lý cảnh báo quá giờ (Late $\rightarrow$ Emergency)
1. **08:30 (Trước hạn 30 phút):** Thiết bị người cao tuổi phát âm thanh chuông nhẹ nhắc nhở điểm danh.
2. **09:00 (Hết khung giờ):** Hệ thống chuyển sang `Late` -> Gửi thông báo vàng đến máy người thân: *"Cụ chưa điểm danh sáng nay, hãy kiểm tra lại"*.
3. **09:30 (Quá hạn 30 phút):** Tự động chuyển sang `Emergency` -> Đẩy thông báo đỏ khẩn cấp, phát âm thanh chuông dồn dập trên máy người thân, hiển thị nút gọi điện thoại trực tiếp.

### Flow 3: Kích hoạt SOS chủ động & Chống bấm nhầm
1. Khi gặp sự cố đột ngột (té ngã, tức ngực), người cao tuổi nhấn và giữ nút "CẦN GIÚP ĐỠ (SOS)" trong **3 giây**.
2. **Cơ chế chống bấm nhầm:** Hệ thống đếm ngược **5 giây** kèm âm thanh cảnh báo ngắn. Trong 5 giây này, cụ có thể bấm "Hủy" nếu chạm nhầm.
3. Sau 5 giây: Lập tức kích hoạt trạng thái `Emergency`, hú còi báo động tại chỗ và gửi thông báo khẩn cấp đến toàn bộ danh bạ người thân được cài đặt.

### Flow 4: "Ping an tâm" từ người thân (Check-on-Demand)
1. Khi lo lắng hoặc gọi điện không bắt máy, người thân bấm nút **"Gửi chuông kiểm tra"** trên Dashboard.
2. Nút "Gửi chuông" bước vào thời gian hồi chiêu (cooldown) **15 phút**. Trạng thái chuyển sang `Ping_Requested`.
3. Thiết bị người cao tuổi phát chuông lớn liên tục, màn hình hiển thị nút lớn duy nhất: *"Bấm để con yên tâm"*.
4. **Kịch bản kết thúc:**
   - **Kịch bản A (Cụ phản hồi trong 15 phút):** Cụ bấm nút -> Chuông tắt, trạng thái chuyển về `Safe`, gửi thông báo tức thì: *"Cụ vừa phản hồi chuông kiểm tra"*.
   - **Kịch bản B (Quá hạn 15 phút không bấm):** Trạng thái chuyển sang `Overdue_Ping` -> Bắn cảnh báo mức độ cao kèm danh bạ hỗ trợ: *"Không thấy phản hồi sau 15 phút. Gợi ý: Gọi điện trực tiếp hoặc liên hệ hàng xóm gần nhà"*.

### Flow 5: Tắt báo động khẩn cấp (Resolve Alarm)
1. Khi nhận cảnh báo `Emergency` hoặc `Overdue_Ping`, người thân liên hệ kiểm tra tình hình cụ.
2. Khi xác nhận cụ đã an toàn, người thân bấm nút **"Xác nhận an toàn / Tắt báo động"** trên Dashboard.
3. Hệ thống tắt âm thanh báo động và chuyển trạng thái về `Safe`.

## 5. Yêu cầu tính năng & UI/UX (Requirements)

### 5.1. Màn hình người lớn tuổi (Elderly Interface)
- **Cực kỳ tối giản:** Không thanh điều hướng (navigation bar), không menu, không cuộn trang (no scroll).
- **Accessibility:** 
  - Phông chữ lớn (tối thiểu 24px - 32px), độ tương phản màu cao (High Contrast).
  - Nút điểm danh trung tâm kích thước lớn (chiều cao tối thiểu 80px - 100px).
  - Phản hồi đa giác quan: Rung máy (Haptic feedback) và âm thanh xác nhận bằng giọng nói rõ ràng khi bấm.
- **Nút SOS:** Thiết kế tách biệt ở vị trí an toàn, màu đỏ nổi bật, áp dụng cơ chế nhấn giữ 3 giây.

### 5.2. Màn hình người thân (Caregiver Dashboard)
- **Theo dõi trạng thái thời gian thực:** Hiển thị trực quan trạng thái hiện tại (`Waiting`, `Safe`, `Late`, `Emergency`, `Ping_Requested`, `Overdue_Ping`).
- **Giám sát thiết bị:** Hiển thị **% dung lượng pin** và **thời gian kết nối mạng gần nhất (Last Seen)** của điện thoại người già (phát hiện sớm trường hợp máy sập nguồn hoặc mất Wi-Fi).
- **Tính năng chủ động:** Nút "Gửi chuông kiểm tra" (cooldown 15 phút) và nút gọi nhanh khẩn cấp.
- **Cấu hình & Quản trị:**
  - Tùy chỉnh khung giờ điểm danh (giờ bắt đầu - giờ kết thúc).
  - Lịch sử điểm danh theo tuần/tháng (đánh dấu ngày an toàn, ngày trễ giờ).
  - Cài đặt danh bạ người thân và số hỗ trợ khẩn cấp lân cận (hàng xóm, trạm y tế phường).

### 5.3. Yêu cầu phi chức năng & Ngoại lệ kỹ thuật (Technical & Resilience)
- **Xử lý mất mạng (Offline Resilience):** Nếu cụ bấm nút lúc mất Wi-Fi/4G, thiết bị lưu lại thời gian bấm vào bộ nhớ tạm (Local Storage) và tự động đồng bộ lên máy chủ ngay khi có kết nối trở lại.
- **Cảnh báo mất kết nối:** Nếu thiết bị của cụ mất tín hiệu liên tục quá 2 giờ, Dashboard người thân sẽ hiển thị thông báo: *"Thiết bị của cụ đang mất kết nối mạng hoặc tắt nguồn"*.
