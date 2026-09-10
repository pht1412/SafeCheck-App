import React from 'react';
import type { EmergencyContact, UserProfile } from '../types';

interface EmergencyContactsModalProps {
  isOpen: boolean;
  onClose: () => void;
  linkedElderly: UserProfile | null;
  contacts: EmergencyContact[];
  isLoading?: boolean;
}

const CATEGORY_LABELS: Record<string, { label: string; icon: string; badgeClass: string }> = {
  neighbor: { label: 'Hàng xóm', icon: '🏡', badgeClass: 'bg-emerald-950 text-emerald-300 border-emerald-500/50' },
  relative: { label: 'Người thân', icon: '👨‍👩‍👧', badgeClass: 'bg-blue-950 text-blue-300 border-blue-500/50' },
  authority: { label: 'Công an / Phường', icon: '👮', badgeClass: 'bg-purple-950 text-purple-300 border-purple-500/50' },
  medical: { label: 'Y tế / Bác sĩ', icon: '👨‍⚕️', badgeClass: 'bg-rose-950 text-rose-300 border-rose-500/50' },
  other: { label: 'Hỗ trợ khác', icon: '🤝', badgeClass: 'bg-slate-800 text-slate-300 border-slate-600' },
};

export const EmergencyContactsModal: React.FC<EmergencyContactsModalProps> = ({
  isOpen,
  onClose,
  linkedElderly,
  contacts,
  isLoading = false,
}) => {
  if (!isOpen) return null;

  return (
    <div
      data-testid="emergency-contacts-modal"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in"
    >
      <div className="bg-slate-900 border-t sm:border border-rose-500/60 rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200">
        {/* Header Modal */}
        <div className="p-4 bg-rose-950/80 border-b border-rose-600/40 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-2xl animate-bounce">🚨</span>
            <div>
              <h2 className="text-base font-black text-white uppercase tracking-wide">
                Danh Bạ Cứu Hộ Khẩn Cấp
              </h2>
              <p className="text-xs text-rose-300">
                Ứng cứu cho: <span className="font-bold text-white">{linkedElderly?.full_name || 'Người cao tuổi'}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center font-bold text-sm transition-all"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Thân danh sách liên hệ (READ + CALL ONLY) */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1">
          {/* 1. MỤC CỐ ĐỊNH HỆ THỐNG: CẤP CỨU Y TẾ 115 (System Action - Không chiếm slot) */}
          <div className="bg-rose-950/60 border-2 border-rose-500 rounded-2xl p-3 shadow-lg flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-600 flex items-center justify-center text-xl shadow-md">
                🚑
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-black text-white">Tổng Đài Cấp Cứu 115</h3>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-900 border border-rose-400 text-rose-200 font-bold">
                    Khẩn cấp
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">Điều phối xe cứu thương y tế 24/7</p>
              </div>
            </div>
            <a
              href="tel:115"
              data-testid="call-115-action"
              className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-black text-xs rounded-xl shadow-lg border border-rose-300 flex items-center gap-1.5 transition-all whitespace-nowrap"
            >
              <span>📞 GỌI 115</span>
            </a>
          </div>

          {/* 2. MỤC CỐ ĐỊNH: GỌI TRỰC TIẾP CHO CỤ (Nếu có số điện thoại) */}
          {linkedElderly?.phone && (
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-3 shadow-md flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-xl shadow-md">
                  👨‍🦳
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">
                    Gọi trực tiếp cho {linkedElderly.full_name || 'người thân'}
                  </h3>
                  <p className="text-[11px] text-slate-300">
                    SĐT: <span className="font-mono text-white">{linkedElderly.phone}</span>
                  </p>
                </div>
              </div>
              <a
                href={`tel:${linkedElderly.phone}`}
                data-testid="call-elderly-action"
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-black text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-all whitespace-nowrap"
              >
                <span>📞 GỌI {linkedElderly.full_name ? linkedElderly.full_name.toUpperCase() : 'NGƯỜI THÂN'}</span>
              </a>
            </div>
          )}

          {/* Dòng phân cách */}
          <div className="pt-2 pb-1 flex items-center justify-between text-xs text-slate-400">
            <span className="font-bold uppercase tracking-wider text-[11px] text-slate-300">
              Lực lượng hỗ trợ tại chỗ ({contacts.length}/5)
            </span>
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="text-center py-6 text-slate-400 text-xs">
              Đang tải danh bạ cứu hộ...
            </div>
          )}

          {/* Danh sách 5 liên hệ do Con cháu cấu hình */}
          {!isLoading && contacts.length === 0 && (
            <div className="text-center py-6 bg-slate-800/40 border border-dashed border-slate-700 rounded-2xl p-4">
              <p className="text-slate-400 text-xs mb-1">Chưa có liên hệ cứu hộ nào được lưu.</p>
              <p className="text-slate-500 text-[11px]">
                Hãy vào mục <strong>Cài đặt</strong> để thêm hàng xóm hoặc công an phường.
              </p>
            </div>
          )}

          {!isLoading &&
            contacts.map((contact, index) => {
              const meta = CATEGORY_LABELS[contact.contact_type] || CATEGORY_LABELS.other;
              return (
                <div
                  key={contact.id}
                  data-testid={`emergency-contact-item-${index}`}
                  className="bg-slate-800/90 border border-slate-700 hover:border-slate-600 rounded-2xl p-3 flex items-center justify-between gap-3 shadow-md transition-all"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-slate-700 border border-slate-600 flex items-center justify-center text-lg shrink-0 mt-0.5">
                      {meta.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-black text-white truncate max-w-[140px]">
                          {contact.name}
                        </span>
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${meta.badgeClass}`}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-emerald-400 mt-0.5 font-bold">
                        {contact.phone}
                      </p>
                      {contact.note && (
                        <p className="text-[10px] text-slate-400 truncate max-w-[190px] mt-0.5">
                          📝 {contact.note}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Nút Gọi 1 chạm */}
                  <a
                    href={`tel:${contact.phone}`}
                    data-testid={`call-contact-btn-${index}`}
                    className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black text-xs rounded-xl shadow-md border border-emerald-400 flex items-center gap-1 transition-all shrink-0"
                  >
                    <span>📞 GỌI</span>
                  </a>
                </div>
              );
            })}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-950 border-t border-slate-800">
          <button
            onClick={onClose}
            className="w-full py-3 bg-slate-800 hover:bg-slate-700 active:scale-98 text-slate-300 hover:text-white font-bold text-xs rounded-xl transition-all"
          >
            Đóng bảng danh bạ
          </button>
        </div>
      </div>
    </div>
  );
};
