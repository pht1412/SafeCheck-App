// ==============================================================================
// SafeCheck - CellularFallbackCard.tsx
// Thẻ Cứu Hộ Viễn Thông Dự Phòng (Cellular Voice Fallback Card)
// Tự động kích hoạt khi Cụ bấm SOS mà không có mạng hoặc chưa nhận được SERVER_ACK sau 10s
// Tuân thủ: PRD_Deep_v1.md (v3.0) & implementation_plan.md
// ==============================================================================

import React from 'react';

interface CellularFallbackCardProps {
  primaryCaregiverName?: string;
  primaryCaregiverPhone?: string;
  onResolveAlarm?: () => void;
}

export const CellularFallbackCard: React.FC<CellularFallbackCardProps> = ({
  primaryCaregiverName = 'Con cháu',
  primaryCaregiverPhone = '0901234567',
  onResolveAlarm,
}) => {
  return (
    <div
      data-testid="cellular-fallback-card"
      className="w-full bg-gradient-to-b from-amber-950/95 via-rose-950/95 to-slate-950 border-4 border-amber-500 rounded-3xl p-5 text-center shadow-2xl animate-in zoom-in-95 duration-300 ring-4 ring-amber-500/40"
    >
      {/* Icon & Cảnh báo mạng gián đoạn */}
      <div className="flex items-center justify-center gap-2 mb-2">
        <span className="text-3xl animate-bounce">📡⚠️</span>
        <span className="text-xs font-black uppercase tracking-wider bg-amber-500 text-slate-950 px-2.5 py-1 rounded-full">
          MẤT SÓNG INTERNET
        </span>
      </div>

      <h3 className="text-white text-xl font-black mb-1 leading-tight">
        CHUYỂN SANG GỌI ĐIỆN CỨU HỘ
      </h3>

      <p className="text-amber-200 text-xs mb-4 leading-relaxed">
        Yêu cầu SOS đã được lưu vào máy và sẽ tự động gửi khi có mạng.
        <br />
        <strong className="text-white underline">
          Cụ hãy bấm nút to bên dưới để gọi trực tiếp qua sóng viễn thông:
        </strong>
      </p>

      {/* Nút 1: Gọi cấp cứu 115 cực đại */}
      <a
        href="tel:115"
        data-testid="fallback-call-115-btn"
        className="w-full py-4 mb-3 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-black text-xl rounded-2xl shadow-xl border-2 border-rose-300 flex items-center justify-center gap-2 transition-all block text-center ring-4 ring-rose-500/50 animate-pulse"
      >
        <span>📞 GỌI CẤP CỨU 115 NGAY</span>
      </a>

      {/* Nút 2: Gọi cho con cháu qua sóng di động GSM */}
      <a
        href={`tel:${primaryCaregiverPhone}`}
        data-testid="fallback-call-caregiver-btn"
        className="w-full py-3.5 mb-3 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black text-lg rounded-2xl shadow-lg border-2 border-amber-300 flex items-center justify-center gap-2 transition-all block text-center"
      >
        <span>📞 GỌI CHO {primaryCaregiverName.toUpperCase()}</span>
      </a>

      {onResolveAlarm && (
        <button
          onClick={onResolveAlarm}
          className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 font-bold text-xs rounded-xl border border-slate-600 transition-all"
        >
          🟢 Tôi đã an toàn / Tắt cảnh báo
        </button>
      )}
    </div>
  );
};

export default CellularFallbackCard;
