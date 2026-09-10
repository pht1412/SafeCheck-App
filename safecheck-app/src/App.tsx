import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import type { SystemState, UserProfile } from './types';
import { SirenPlayer, playChimeSound } from './utils/sirenPlayer';
import { authService } from './services/authService';
import { pushNotificationService } from './services/pushNotificationService';
import ElderlyScreen from './components/ElderlyScreen';
import CaregiverScreen from './components/CaregiverScreen';
import AuthScreen from './components/AuthScreen';

interface LinkedElderly {
  id: string;
  full_name: string;
  pairing_code: string;
  phone?: string | null;
}

export default function App() {
  // Quản lý phiên đăng nhập và hồ sơ người dùng
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);

  // Người lớn tuổi được kết nối với Con cháu
  const [linkedElderly, setLinkedElderly] = useState<LinkedElderly | null>(null);

  // States quản lý trạng thái nghiệp vụ SafeCheck
  const [systemState, setSystemState] = useState<SystemState>('Waiting');
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [pingCooldown, setPingCooldown] = useState<number>(0);
  const [batteryLevel] = useState<number>(85);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // States quản lý quy trình SOS chống bấm nhầm
  const [sosHolding, setSosHolding] = useState<boolean>(false);
  const [sosCountdown, setSosCountdown] = useState<number | null>(null);
  const [isSirenMuted, setIsSirenMuted] = useState<boolean>(false);

  const sosHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sosCountdownIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sirenRef = useRef<SirenPlayer | null>(null);

  const getTodayDate = () => new Date().toISOString().split('T')[0];

  // Tiện ích đa giác quan: Rung và Giọng nói tiếng Việt
  const triggerSensoryFeedback = (message: string) => {
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = 'vi-VN';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  };

  // 1. Kiểm tra Session tự động (Persistent Session)
  useEffect(() => {
    async function checkAuthSession() {
      try {
        const session = await authService.getSession();
        if (session?.user) {
          const profile = await authService.fetchProfile(session.user.id);
          setUserProfile(profile);
        }
      } catch (err) {
        console.error('Lỗi kiểm tra phiên đăng nhập:', err);
      } finally {
        setIsAuthChecking(false);
      }
    }

    checkAuthSession();

    // Lắng nghe sự kiện đăng nhập / đăng xuất
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT') {
          setUserProfile(null);
          setLinkedElderly(null);
        } else if (session?.user && !userProfile) {
          const profile = await authService.fetchProfile(session.user.id);
          setUserProfile(profile);
        }
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // 1b. Kiểm tra Deep-link SOS từ Web Push Notification (?sos=<sos_event_id>)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const sosId = urlParams.get('sos');
    if (sosId) {
      supabase
        .from('sos_events')
        .select('*')
        .eq('id', sosId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!error && data && data.status === 'active') {
            console.log('[SafeCheck Deep-Link] Kích hoạt sự kiện khẩn cấp từ URL:', sosId);
            setSystemState('Emergency');
            setIsSirenMuted(false);
          }
        });
    }
  }, []);

  // 2. Nếu là Con cháu (caregiver): Tìm Cụ đã liên kết trong family_links
  const fetchLinkedElderly = async (caregiverId: string) => {
    try {
      const { data } = await supabase
        .from('family_links')
        .select('elderly_id, relationship, profiles!elderly_id(id, full_name, pairing_code, phone)')
        .eq('caregiver_id', caregiverId)
        .eq('status', 'accepted')
        .maybeSingle();

      if (data && data.profiles) {
        setLinkedElderly(data.profiles as unknown as LinkedElderly);
      } else {
        setLinkedElderly(null);
      }
    } catch (err) {
      console.error('Lỗi lấy thông tin liên kết gia đình:', err);
      setLinkedElderly(null);
    }
  };

  const [hasLinkedCaregivers, setHasLinkedCaregivers] = useState<boolean>(false);

  // 2b. Nếu là Cụ (elderly): Kiểm tra xem đã có người thân nào liên kết chưa
  const fetchElderlyCaregivers = async (elderlyId: string) => {
    try {
      const { count, error } = await supabase
        .from('family_links')
        .select('*', { count: 'exact', head: true })
        .eq('elderly_id', elderlyId)
        .eq('status', 'accepted');

      if (!error && count !== null) {
        setHasLinkedCaregivers(count > 0);
      }
    } catch (err) {
      console.error('Lỗi kiểm tra người thân liên kết:', err);
    }
  };

  useEffect(() => {
    if (userProfile?.role === 'caregiver') {
      fetchLinkedElderly(userProfile.id);
    } else if (userProfile?.role === 'elderly') {
      setLinkedElderly(null);
      fetchElderlyCaregivers(userProfile.id);

      // Lắng nghe Realtime xem có con cháu nào vừa kết nối không
      const linkChannel = supabase
        .channel(`family-links-${userProfile.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'family_links',
            filter: `elderly_id=eq.${userProfile.id}`,
          },
          () => {
            fetchElderlyCaregivers(userProfile.id);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(linkChannel);
      };
    } else {
      setLinkedElderly(null);
      setHasLinkedCaregivers(false);
    }
  }, [userProfile]);

  // 3. Xác định mã gia đình động (Active Room Code)
  // - Nếu là Cụ: Mã phòng chính là pairing_code riêng của Cụ!
  // - Nếu là Con cháu: Mã phòng là pairing_code của Cụ đã kết nối (nếu có).
  const activeFamilyCode =
    userProfile?.role === 'elderly'
      ? userProfile.pairing_code || userProfile.id
      : linkedElderly?.pairing_code || null;

  // 4. Lấy dữ liệu điểm danh và Lắng nghe Realtime THEO ĐÚNG MÃ CỦA CỤ
  useEffect(() => {
    if (!activeFamilyCode) {
      setSystemState('Waiting');
      setCheckInTime(null);
      return;
    }

    setIsLoading(true);
    async function fetchStatus() {
      const today = getTodayDate();
      const { data, error } = await supabase
        .from('checkin_logs')
        .select('*')
        .eq('family_code', activeFamilyCode)
        .eq('log_date', today)
        .maybeSingle();

      if (data && !error) {
        setSystemState(data.status as SystemState);
        if (data.checkin_time) {
          const time = new Date(data.checkin_time).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          setCheckInTime(time);
        } else {
          setCheckInTime(null);
        }
      } else {
        setSystemState('Waiting');
        setCheckInTime(null);
      }
      setIsLoading(false);
    }

    fetchStatus();

    // Lắng nghe Realtime chỉ riêng cho Cụ này
    const channel = supabase
      .channel(`room-${activeFamilyCode}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'checkin_logs',
          filter: `family_code=eq.${activeFamilyCode}`,
        },
        (payload: any) => {
          const newRow = payload.new;
          if (newRow && newRow.log_date === getTodayDate() && newRow.status) {
            setSystemState(newRow.status as SystemState);
            if (newRow.checkin_time) {
              const time = new Date(newRow.checkin_time).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });
              setCheckInTime(time);
            } else {
              setCheckInTime(null);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeFamilyCode]);

  // Đếm ngược hồi chiêu nút Ping
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (pingCooldown > 0) {
      interval = setInterval(() => setPingCooldown((prev) => prev - 1), 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [pingCooldown]);

  // Quản lý còi hú khẩn cấp cho con cháu khi trạng thái là Emergency
  useEffect(() => {
    if (!sirenRef.current) {
      sirenRef.current = new SirenPlayer();
    }
    if (
      systemState === 'Emergency' &&
      !isSirenMuted &&
      userProfile?.role === 'caregiver' &&
      linkedElderly
    ) {
      sirenRef.current.start();
    } else {
      sirenRef.current.stop();
    }
    return () => {
      sirenRef.current?.stop();
    };
  }, [systemState, isSirenMuted, userProfile, linkedElderly]);

  // Phát chuông Ding-Dong và giọng nói khi Cụ nhận được chuông hỏi thăm (Ping)
  useEffect(() => {
    if (systemState === 'Ping_Requested' && userProfile?.role === 'elderly') {
      playChimeSound();
      const timer = setTimeout(() => {
        triggerSensoryFeedback(
          'Con cháu đang hỏi thăm, Cụ hãy chạm vào màn hình để con yên tâm nhé'
        );
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [systemState, userProfile]);

  // Bộ đếm 10 giây chống bấm nhầm SOS
  useEffect(() => {
    if (sosCountdown !== null && sosCountdown > 0) {
      sosCountdownIntervalRef.current = setTimeout(() => {
        setSosCountdown(sosCountdown - 1);
      }, 1000);
    } else if (sosCountdown === 0) {
      // Hết 10s mà cụ không hủy -> Kích hoạt SOS lên máy chủ và hú còi
      setSystemState('Emergency');
      setSosCountdown(null);
      setIsSirenMuted(false);
      triggerSensoryFeedback('Báo động khẩn cấp đã được gửi tới người thân');

      // 1. Tạo sự kiện vào bảng sos_events (Source of Truth) & Kích hoạt Web Push ngoại tuyến
      if (userProfile?.id && userProfile.role === 'elderly') {
        supabase
          .from('sos_events')
          .insert({
            elderly_id: userProfile.id,
            status: 'active',
            trigger_source: 'button',
          })
          .select()
          .single()
          .then(({ data: newEvent, error: insertErr }) => {
            if (newEvent && !insertErr) {
              console.log('[SafeCheck] Đã tạo sự kiện sos_events:', newEvent.id);
              pushNotificationService.sendEmergencyPush(newEvent.id);
            } else if (insertErr) {
              console.error('[SafeCheck] Lỗi tạo sos_events:', insertErr);
            }
          });
      }

      // 2. Kích hoạt Realtime cập nhật trạng thái phòng
      if (activeFamilyCode) {
        supabase.rpc('trigger_sos', { p_family_code: activeFamilyCode }).then(({ error }) => {
          if (error) console.error('Lỗi gọi trigger_sos:', error);
        });
      }
    }
    return () => {
      if (sosCountdownIntervalRef.current) clearTimeout(sosCountdownIntervalRef.current);
    };
  }, [sosCountdown, activeFamilyCode]);

  // Flow 1 & Flow 4: Điểm danh
  const handleCheckIn = async () => {
    if (!activeFamilyCode) {
      console.warn('handleCheckIn: Chưa có activeFamilyCode');
      return;
    }
    console.log('[SafeCheck] Đang gọi perform_checkin với family_code:', activeFamilyCode);
    const { data, error } = await supabase.rpc('perform_checkin', {
      p_family_code: activeFamilyCode,
    });

    if (error || !data?.success) {
      console.error('[SafeCheck] Lỗi perform_checkin:', {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
        data,
      });
      const errMsg = error 
        ? `[Mã lỗi ${error.code || 'RPC'}]: ${error.message}` 
        : (data?.message || 'Không thể điểm danh!');
      alert(`Lỗi điểm danh: ${errMsg}`);
      return;
    }
    console.log('[SafeCheck] Điểm danh thành công:', data);
    triggerSensoryFeedback('Điểm danh thành công, con cháu đã nhận được tin');
  };

  // Bắt đầu đè chuột giữ nút SOS (3 giây)
  const startSosHold = () => {
    if (sosCountdown !== null) return;
    setSosHolding(true);
    sosHoldTimerRef.current = setTimeout(() => {
      setSosHolding(false);
      setSosCountdown(10); // Đếm ngược 10 giây chống bấm nhầm
      triggerSensoryFeedback(
        'Đang chuẩn bị gửi báo động. Bạn có 10 giây để bấm hủy nếu chạm nhầm'
      );
    }, 3000);
  };

  const cancelSosHold = () => {
    setSosHolding(false);
    if (sosHoldTimerRef.current) clearTimeout(sosHoldTimerRef.current);
  };

  const abortSosCountdown = () => {
    setSosCountdown(null);
    if (sosCountdownIntervalRef.current) clearTimeout(sosCountdownIntervalRef.current);
    triggerSensoryFeedback('Đã hủy báo động');
  };

  // Flow 4: Con cháu gửi Ping
  const isPingAllowed = ['Waiting', 'Late', 'Safe'].includes(systemState);

  const handleSendPing = async () => {
    if (!isPingAllowed || pingCooldown > 0 || !activeFamilyCode) return;

    const { data, error } = await supabase.rpc('request_ping', {
      p_family_code: activeFamilyCode,
    });

    if (error || !data?.success) {
      console.error('[SafeCheck] Lỗi request_ping:', { error, data });
      alert(error?.message || data?.message || 'Không thể gửi chuông');
      return;
    }
    const isTester = userProfile?.email?.toLowerCase() === 'test01@gmail.com';
    setPingCooldown(isTester ? 10 : 15 * 60);
  };

  // Flow 5: Giải quyết / Tắt báo động
  const handleResolveAlarm = async () => {
    if (!activeFamilyCode) return;
    setSystemState('Safe');
    setIsSirenMuted(false);
    triggerSensoryFeedback('Đã tắt báo động, xác nhận an toàn');
    const { error } = await supabase.rpc('resolve_alarm', { p_family_code: activeFamilyCode });
    if (error) {
      console.error('[SafeCheck] Lỗi resolve_alarm:', error);
    }

    // Cập nhật trạng thái sự kiện sos_events sang 'resolved'
    if (userProfile?.id) {
      const targetElderlyId = userProfile.role === 'caregiver' ? linkedElderly?.id : userProfile.id;
      if (targetElderlyId) {
        supabase
          .from('sos_events')
          .update({
            status: 'resolved',
            resolved_at: new Date().toISOString(),
            resolved_by: userProfile.id,
          })
          .eq('elderly_id', targetElderlyId)
          .eq('status', 'active')
          .then(({ error: sosErr }) => {
            if (sosErr) console.error('[SafeCheck] Lỗi cập nhật sos_events resolved:', sosErr);
          });
      }
    }
  };

  // Dev Tool: Cập nhật trực tiếp trạng thái hôm nay
  const setManualStatus = async (status: SystemState) => {
    if (!activeFamilyCode) return;
    await supabase
      .from('checkin_logs')
      .update({ status })
      .eq('family_code', activeFamilyCode)
      .eq('log_date', getTodayDate());

    // NẾU TESTER BẤM SET SOS: Kích hoạt tạo sự kiện và phát Web Push thực tế
    if (status === 'Emergency') {
      const targetElderlyId = userProfile?.role === 'elderly' ? userProfile.id : linkedElderly?.id;
      if (targetElderlyId) {
        const { data: newEvent } = await supabase
          .from('sos_events')
          .insert({
            elderly_id: targetElderlyId,
            status: 'active',
            trigger_source: 'button',
          })
          .select()
          .single();

        if (newEvent) {
          console.log('[SafeCheck DevTool] Phát lệnh Web Push từ Dev Tool cho sự kiện:', newEvent.id);
          pushNotificationService.sendEmergencyPush(newEvent.id);
        }
      }
    } else if (status === 'Safe') {
      handleResolveAlarm();
    }
  };

  // Ghép nối gia đình (Con cháu gọi RPC connect_family)
  const handleConnectFamily = async (pairingCode: string, relationship: string) => {
    const { data, error } = await supabase.rpc('connect_family', {
      p_pairing_code: pairingCode,
      p_relationship: relationship,
    });

    if (error) {
      return { success: false, message: error.message || 'Lỗi kết nối máy chủ' };
    }
    if (!data?.success) {
      return { success: false, message: data?.message || 'Kết nối thất bại' };
    }

    // Refresh lại liên kết sau khi ghép nối thành công
    if (userProfile) {
      await fetchLinkedElderly(userProfile.id);
    }

    return { success: true, message: data.message };
  };

  // Đăng xuất
  const handleSignOut = async () => {
    await authService.signOut();
    setUserProfile(null);
    setLinkedElderly(null);
  };

  // 1. Màn hình chờ khi đang kiểm tra phiên đăng nhập
  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 font-sans">
        <div className="w-16 h-16 bg-emerald-600 rounded-3xl flex items-center justify-center animate-bounce mb-3 shadow-lg shadow-emerald-900/50">
          <span className="text-3xl">🛡️</span>
        </div>
        <p className="text-slate-400 text-sm animate-pulse">Đang kiểm tra bảo mật SafeCheck...</p>
      </div>
    );
  }

  // 2. Chưa đăng nhập -> Hiển thị AuthScreen (Mobile Form)
  if (!userProfile) {
    return <AuthScreen onAuthSuccess={(profile) => setUserProfile(profile)} />;
  }

  // 3. Đang tải dữ liệu điểm danh ban đầu
  if (isLoading && activeFamilyCode) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center font-sans">
        <p className="text-slate-400 animate-pulse">Đang đồng bộ dữ liệu hôm nay...</p>
      </div>
    );
  }

  // 4. ĐÃ ĐĂNG NHẬP: Điều hướng phân quyền Role (Role-based Navigation)
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-0 sm:p-4 flex flex-col items-center justify-center font-sans">
      {/* NẾU LÀ NGƯỜI LỚN TUỔI: Chỉ hiển thị duy nhất màn hình Cụ */}
      {userProfile.role === 'elderly' && (
        <ElderlyScreen
          systemState={systemState}
          checkInTime={checkInTime}
          batteryLevel={batteryLevel}
          sosHolding={sosHolding}
          sosCountdown={sosCountdown}
          elderlyName={userProfile.full_name}
          pairingCode={userProfile.pairing_code}
          hasLinkedCaregivers={hasLinkedCaregivers}
          onCheckIn={handleCheckIn}
          onStartSosHold={startSosHold}
          onCancelSosHold={cancelSosHold}
          onAbortSosCountdown={abortSosCountdown}
          onResolveAlarm={handleResolveAlarm}
        />
      )}

      {/* NẾU LÀ CON CHÁU: Chỉ hiển thị màn hình Dashboard theo dõi */}
      {userProfile.role === 'caregiver' && (
        <CaregiverScreen
          systemState={systemState}
          checkInTime={checkInTime}
          batteryLevel={batteryLevel}
          pingCooldown={pingCooldown}
          isPingAllowed={isPingAllowed}
          isSirenMuted={isSirenMuted}
          caregiverName={userProfile.full_name}
          linkedElderly={linkedElderly}
          isTester={userProfile.email?.toLowerCase() === 'test01@gmail.com'}
          onSendPing={handleSendPing}
          onResolveAlarm={handleResolveAlarm}
          onToggleMuteSiren={() => setIsSirenMuted(!isSirenMuted)}
          onManualStatus={setManualStatus}
          onSignOut={handleSignOut}
          onConnectFamily={handleConnectFamily}
        />
      )}
    </div>
  );
}