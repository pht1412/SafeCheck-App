import React, { useState, useEffect } from 'react';
import { familyAuditService, type FamilyAuditReport } from '../services/familyAuditService';

interface FamilyActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  elderlyId: string;
  elderlyName: string;
  pairingCode?: string;
}

export const FamilyActivityModal: React.FC<FamilyActivityModalProps> = ({
  isOpen,
  onClose,
  elderlyId,
  elderlyName,
  pairingCode,
}) => {
  const [activeTab, setActiveTab] = useState<'activity' | 'members'>('activity');
  const [report, setReport] = useState<FamilyAuditReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!isOpen || !elderlyId) return;

    let isMounted = true;
    setIsLoading(true);

    familyAuditService
      .getFullFamilyAudit(elderlyId, pairingCode)
      .then((data) => {
        if (isMounted) {
          setReport(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error('Lỗi tải nhật ký gia đình:', err);
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, elderlyId, pairingCode]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="family-activity-modal"
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 text-lg">
              📋
            </div>
            <div>
              <h3 className="text-white font-bold text-sm">Nhật ký Hoạt động Gia đình</h3>
              <p className="text-[11px] text-slate-400">Giám sát an toàn cho {elderlyName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center text-sm transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 p-1.5 gap-1.5">
          <button
            type="button"
            data-testid="tab-activity"
            onClick={() => setActiveTab('activity')}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'activity'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <span>🕒</span>
            <span>Nhật ký & Điểm danh</span>
          </button>
          <button
            type="button"
            data-testid="tab-members"
            onClick={() => setActiveTab('members')}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'members'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <span>👨‍👩‍👧‍👦</span>
            <span>Con cháu ({report?.members.length || 0})</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs">Đang tải nhật ký gia đình...</p>
            </div>
          ) : activeTab === 'activity' ? (
            /* TAB 1: NHẬT KÝ & ĐIỂM DANH */
            <div className="space-y-4">
              {/* Thẻ Điểm danh hôm nay */}
              <div
                data-testid="today-checkin-card"
                className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    ☀️ Điểm danh hôm nay:
                  </span>
                  {report?.todayCheckin?.is_checked_in ? (
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        report.todayCheckin.is_late
                          ? 'bg-amber-950 text-amber-300 border border-amber-600/50'
                          : 'bg-emerald-950 text-emerald-300 border border-emerald-600/50'
                      }`}
                    >
                      {report.todayCheckin.is_late ? '⚠️ Điểm danh trễ' : '✅ Đúng giờ'}
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                      Chưa điểm danh
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Giờ điểm danh của Cụ:</span>
                    <strong className="text-white font-mono text-sm">
                      {report?.todayCheckin?.checkin_time_formatted || 'Chưa ghi nhận'}
                    </strong>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Khung giờ quy định:</span>
                    <span className="text-slate-300 font-mono">
                      {report?.todayCheckin?.schedule_start} - {report?.todayCheckin?.schedule_deadline}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800/80 text-xs">
                    <span className="text-slate-400 text-[11px] block mb-0.5">Đánh giá thời gian:</span>
                    <p
                      className={`font-semibold ${
                        report?.todayCheckin?.is_late
                          ? 'text-amber-400'
                          : report?.todayCheckin?.is_checked_in
                          ? 'text-emerald-400'
                          : 'text-slate-300'
                      }`}
                    >
                      {report?.todayCheckin?.delay_text}
                    </p>
                  </div>
                </div>
              </div>

              {/* Thẻ Lịch sử SOS & Cứu hộ */}
              <div
                data-testid="sos-history-card"
                className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 shadow-sm"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    🚨 Lịch sử Báo động SOS gần nhất:
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Tối đa 5 ca</span>
                </div>

                {report?.recentSOS && report.recentSOS.length > 0 ? (
                  <div className="space-y-3">
                    {report.recentSOS.map((incident) => (
                      <div
                        key={incident.id}
                        data-testid={`incident-${incident.id}`}
                        className={`p-3 rounded-xl border text-xs space-y-2 ${
                          incident.is_active
                            ? 'bg-rose-950/40 border-rose-600/50'
                            : 'bg-slate-900/80 border-slate-800'
                        }`}
                      >
                        {/* Hàng 1: Thời gian & Trạng thái */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span>{incident.is_active ? '🚨' : '🟢'}</span>
                            <span className="font-mono font-bold text-white">
                              {incident.created_at_formatted}
                            </span>
                          </div>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                              incident.is_active
                                ? 'bg-rose-900 text-rose-200 animate-pulse'
                                : 'bg-emerald-950 text-emerald-300 border border-emerald-800/40'
                            }`}
                          >
                            {incident.is_active ? 'ĐANG BÁO ĐỘNG' : 'ĐÃ AN TOÀN'}
                          </span>
                        </div>

                        {/* Hàng 2: Ai đã tiếp nhận cứu hộ */}
                        <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/50 space-y-1">
                          <span className="text-[10px] text-slate-400 font-bold uppercase block">
                            Con cháu đã tiếp nhận ({incident.acknowledged_by.length}):
                          </span>
                          {incident.acknowledged_by.length > 0 ? (
                            incident.acknowledged_by.map((ack, idx) => (
                              <div
                                key={idx}
                                className="flex justify-between items-center text-[11px] text-emerald-300 font-medium"
                              >
                                <span>
                                  ✓ {ack.caregiver_name} - {ack.relationship}
                                </span>
                                <span className="font-mono text-slate-400 text-[10px]">
                                  {ack.acknowledged_at}
                                </span>
                              </div>
                            ))
                          ) : (
                            <p className="text-[10px] text-rose-300/80 italic">
                              Chưa có con cháu nào bấm tiếp nhận ca này
                            </p>
                          )}
                        </div>

                        {/* Hàng 3: Ai đã giải quyết / Tắt còi */}
                        {incident.resolved_by ? (
                          <div className="flex items-center justify-between text-[11px] bg-emerald-950/30 border border-emerald-500/20 p-2 rounded-lg text-emerald-300">
                            <div>
                              <span className="text-[10px] text-slate-400 block">Đã tắt còi & xác nhận an toàn bởi:</span>
                              <strong>
                                🛡️ {incident.resolved_by.performer_name} ({incident.resolved_by.performer_role})
                              </strong>
                            </div>
                            <span className="font-mono text-slate-400 text-[10px]">
                              {incident.resolved_by.resolved_at}
                            </span>
                          </div>
                        ) : incident.is_active ? (
                          <p className="text-[10px] text-amber-400 italic">
                            ⏳ Ca cứu hộ vẫn đang mở, chưa được tắt còi an toàn.
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center text-slate-500 text-xs bg-slate-950/40 rounded-xl border border-slate-800/40">
                    Chưa có sự cố SOS nào được ghi nhận. Cụ vẫn luôn an toàn! 🎉
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* TAB 2: TOÀN BỘ CON CHÁU TRONG NHÀ */
            <div className="space-y-3" data-testid="family-members-tab">
              <p className="text-xs text-slate-400 leading-relaxed mb-2">
                Danh sách toàn bộ con cháu đang cùng nhận cảnh báo và cùng chăm sóc cho{' '}
                <strong className="text-white">{elderlyName}</strong>:
              </p>

              {report?.members && report.members.length > 0 ? (
                report.members.map((member) => (
                  <div
                    key={member.id}
                    data-testid={`member-card-${member.caregiver_id}`}
                    className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-2xl flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-bold text-sm">
                        {member.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-white font-bold text-xs">{member.full_name}</h4>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-700/50">
                            {member.relationship}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                          {member.phone || 'Chưa cập nhật SĐT'}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      {member.has_push_active ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-semibold bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-800/40">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Đã bật Push
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded-full border border-slate-800">
                          Chưa bật Push
                        </span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-slate-400 text-xs">
                  Chưa có con cháu nào liên kết với Cụ.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/40 text-center">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-bold rounded-xl transition-all"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

export default FamilyActivityModal;
