'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const TERMS_OF_USE = `
제1조 (목적)
본 약관은 삼양식품 기초원료구매팀이 운영하는 Palm Oil Manager 시스템(이하 "시스템")의 이용에 관한 제반 사항을 규정함을 목적으로 합니다.
Article 1 (Purpose) These Terms govern the use of the Palm Oil Manager system ("System") operated by the Raw Material Procurement Team of Samyang Foods.

제2조 (정의)
① "시스템"이란 팜유·유지류 구매 관리, FCPO 시세 분석, 재고 관리, 선구매 효과 분석 등의 기능을 제공하는 웹 기반 도구를 의미합니다.
② "이용자"란 본 약관에 동의하고 시스템에 접근하는 모든 사용자를 의미합니다.
Article 2 (Definitions) ① "System" refers to the web-based tool providing palm oil procurement, FCPO price analysis, inventory management, and prebuy effect analysis. ② "User" refers to anyone who agrees to these Terms and accesses the System.

제3조 (이용약관의 효력 및 변경)
① 본 약관은 이용자가 "동의합니다"를 선택함으로써 효력이 발생합니다.
② 운영팀은 관련 법령에 위배되지 않는 범위 내에서 약관을 변경할 수 있으며, 변경 시 시스템 내 공지합니다.
Article 3 (Effectiveness and Amendment) ① These Terms take effect when the User selects "I Agree." ② The operating team may amend these Terms within the scope of applicable laws, with notice provided in the System.

제4조 (이용자의 의무)
① 이용자는 시스템의 데이터를 업무 목적으로만 사용하여야 합니다.
② 이용자는 타인의 계정을 도용하거나 부정한 방법으로 시스템에 접근하여서는 안 됩니다.
③ 이용자는 시스템에서 취득한 정보를 외부에 무단 유출하여서는 안 됩니다.
Article 4 (User Obligations) ① Users shall use System data solely for business purposes. ② Users shall not misappropriate others' accounts or access the System through fraudulent means. ③ Users shall not disclose information obtained from the System to external parties without authorization.

제5조 (지적재산권)
① 시스템의 소프트웨어, 디자인, 데이터베이스 구조 등 일체의 지적재산권은 삼양식품에 귀속됩니다.
② 이용자는 시스템의 구성 요소를 복제, 수정, 배포, 역설계할 수 없습니다.
Article 5 (Intellectual Property) ① All intellectual property rights including software, design, and database structure belong to Samyang Foods. ② Users may not copy, modify, distribute, or reverse-engineer any component of the System.

제6조 (라이선스 제한)
① 시스템은 비독점적, 양도 불가, 재라이선스 불가의 제한적 사용 권한만을 부여합니다.
② 본 라이선스는 운영팀의 판단에 따라 언제든지 철회될 수 있습니다.
Article 6 (License Restrictions) ① The System grants only a non-exclusive, non-transferable, non-sublicensable limited right of use. ② This license may be revoked at any time at the discretion of the operating team.

제7조 (데이터 면책)
① 시스템에서 제공하는 시세 데이터, 분석 결과, AI 리포트 등은 참고 목적이며, 투자·거래 의사결정의 근거로 사용하여 발생한 손해에 대해 운영팀은 책임을 지지 않습니다.
② FCPO 정산가, MPOB 통계, 환율 정보 등은 외부 소스를 기반으로 하며, 정확성을 보장하지 않습니다.
Article 7 (Data Disclaimer) ① Market data, analysis results, and AI reports are for reference only; the operating team is not liable for damages arising from investment or trading decisions based on such information. ② FCPO settlement prices, MPOB statistics, exchange rates, etc. are sourced externally and accuracy is not guaranteed.

제8조 (비밀유지)
① 이용자는 시스템 접속 과정에서 취득한 구매 단가, 공급업체 정보, 재고 수량 등 영업비밀을 엄격히 비밀로 유지하여야 합니다.
② 본 조의 의무는 시스템 이용 종료 후에도 지속됩니다.
Article 8 (Confidentiality) ① Users must strictly maintain the confidentiality of trade secrets such as purchase prices, supplier information, and inventory quantities obtained through the System. ② The obligations under this Article shall survive termination of System use.

제9조 (접근 권한)
① 마스터 계정은 시스템의 모든 기능에 대한 읽기·쓰기 권한을 보유합니다.
② 일반 이용자는 읽기 전용 권한이 기본이며, 마스터 계정 관리자가 개별적으로 쓰기 권한을 부여할 수 있습니다.
③ 운영팀은 보안 사유 또는 업무상 필요에 따라 이용자의 접근 권한을 변경·제한할 수 있습니다.
Article 9 (Access Rights) ① Master accounts have full read-write access to all System functions. ② Regular users have read-only access by default; master administrators may individually grant write access. ③ The operating team may modify or restrict user access rights for security or business reasons.

제10조 (면책 및 손해배상)
① 이용자가 본 약관을 위반하여 삼양식품 또는 제3자에게 손해를 끼친 경우, 해당 이용자가 모든 책임을 부담합니다.
② 시스템의 기술적 장애, 데이터 유실, 외부 공격 등으로 인한 손해에 대해 운영팀은 고의 또는 중과실이 없는 한 책임을 지지 않습니다.
Article 10 (Indemnification and Liability) ① Users who violate these Terms and cause damage to Samyang Foods or third parties shall bear full responsibility. ② The operating team is not liable for damages caused by technical failures, data loss, or external attacks, absent intent or gross negligence.

제11조 (서비스 중단)
운영팀은 시스템 유지보수, 업그레이드, 보안 패치 등의 사유로 사전 공지 후 서비스를 일시 중단할 수 있습니다.
Article 11 (Service Interruption) The operating team may temporarily suspend the service with prior notice for maintenance, upgrades, security patches, etc.

제12조 (계정 관리)
① 이용자는 자신의 계정 정보를 안전하게 관리할 의무가 있으며, 제3자에게 공유하여서는 안 됩니다.
② 계정 도용, 비밀번호 유출 등이 발생한 경우 즉시 운영팀에 통보하여야 합니다.
③ 마스터 관리자는 보안 사유로 이용자의 비밀번호를 초기화하거나 계정을 삭제할 수 있습니다.
Article 12 (Account Management) ① Users are obligated to securely manage their account information and shall not share it with third parties. ② In case of account misuse or password leaks, users must immediately notify the operating team. ③ Master administrators may reset passwords or delete accounts for security reasons.

제13조 (준거법 및 분쟁 해결)
① 본 약관의 해석 및 적용에 관하여는 대한민국 법률을 준거법으로 합니다.
② 시스템 이용과 관련하여 분쟁이 발생한 경우, 서울중앙지방법원을 제1심 전속 관할 법원으로 합니다.
Article 13 (Governing Law and Dispute Resolution) ① These Terms shall be governed by the laws of the Republic of Korea. ② Any disputes arising from System use shall be subject to the exclusive jurisdiction of the Seoul Central District Court.
`.trim();

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Terms of use popup
  const [showTerms, setShowTerms] = useState(false);
  const [termsScrolledToBottom, setTermsScrolledToBottom] = useState(false);
  const [pendingLogin, setPendingLogin] = useState<{ id: string; password: string } | null>(null);

  const handleTermsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 30) {
      setTermsScrolledToBottom(true);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !password) {
      setError('ID와 비밀번호를 모두 입력하세요');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // First attempt login to check if terms are agreed
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        if (!data.termsAgreed) {
          // Show terms popup, keep credentials for re-login after agreement
          setPendingLogin({ id, password });
          setShowTerms(true);
          setTermsScrolledToBottom(false);
          setLoading(false);
          return;
        }
        // Redirect
        const params = new URLSearchParams(window.location.search);
        const from = params.get('from') || '/';
        router.push(from);
        router.refresh();
      } else {
        setError(data.error || '로그인에 실패했습니다');
      }
    } catch {
      setError('서버 연결에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const handleAgreeTerms = async () => {
    if (!pendingLogin) return;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...pendingLogin, agreeTerms: true }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowTerms(false);
        const params = new URLSearchParams(window.location.search);
        const from = params.get('from') || '/';
        router.push(from);
        router.refresh();
      } else {
        setError(data.error || '로그인에 실패했습니다');
        setShowTerms(false);
      }
    } catch {
      setError('서버 연결에 실패했습니다');
      setShowTerms(false);
    } finally {
      setLoading(false);
      setPendingLogin(null);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !password) {
      setError('아이디와 비밀번호를 모두 입력하세요');
      return;
    }
    if (password !== passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다');
      return;
    }
    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: id, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSuccess('회원가입이 완료되었습니다. 로그인하세요.');
        setMode('login');
        setPassword('');
        setPasswordConfirm('');
      } else {
        setError(data.error || '회원가입에 실패했습니다');
      }
    } catch {
      setError('서버 연결에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl shadow-lg mb-4">
            <span className="text-white text-2xl">🌴</span>
          </div>
          <h1 className="text-xl font-bold text-slate-800">Palm Oil Manager</h1>
          <p className="text-slate-400 text-xs mt-1">삼양식품 기초원료구매팀</p>
        </div>

        {/* Login / Register Card */}
        <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${mode === 'login' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            >
              로그인
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setError(''); setSuccess(''); }}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${mode === 'register' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            >
              회원가입
            </button>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">아이디</label>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder={mode === 'login' ? 'ID' : '3자 이상'}
              autoComplete="username"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 focus:bg-white focus:border-blue-300 transition-colors"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'login' ? '••••••••' : '6자 이상'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 focus:bg-white focus:border-blue-300 transition-colors"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1.5 block">비밀번호 확인</label>
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="비밀번호를 다시 입력"
                autoComplete="new-password"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 focus:bg-white focus:border-blue-300 transition-colors"
              />
            </div>
          )}

          {error && (
            <div className="text-rose-600 text-xs bg-rose-50 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {success && (
            <div className="text-emerald-600 text-xs bg-emerald-50 px-3 py-2 rounded-lg">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {loading
              ? (mode === 'login' ? '로그인 중...' : '가입 중...')
              : (mode === 'login' ? '로그인' : '회원가입')
            }
          </button>

          {mode === 'register' && (
            <p className="text-[10px] text-slate-400 text-center">
              가입 시 읽기 전용 권한이 부여됩니다. 쓰기 권한은 관리자에게 요청하세요.
            </p>
          )}
        </form>

        <p className="text-center text-slate-300 text-[10px] mt-6">
          Samyang Foods — Palm Oil Purchase Management System
        </p>
      </div>

      {/* Terms of Use Popup */}
      {showTerms && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="p-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">이용약관 / Terms of Use</h2>
              <p className="text-xs text-slate-500 mt-1">시스템 이용을 위해 약관에 동의해주세요</p>
            </div>
            <div
              className="flex-1 overflow-y-auto p-5 text-xs text-slate-600 leading-relaxed whitespace-pre-wrap"
              onScroll={handleTermsScroll}
            >
              {TERMS_OF_USE}
            </div>
            <div className="p-4 border-t border-slate-200 flex gap-3">
              <button
                onClick={() => { setShowTerms(false); setPendingLogin(null); }}
                className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50 transition-colors"
              >
                거부합니다
              </button>
              <button
                onClick={handleAgreeTerms}
                disabled={!termsScrolledToBottom || loading}
                className="flex-1 py-2.5 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? '처리 중...' : '동의합니다'}
              </button>
            </div>
            {!termsScrolledToBottom && (
              <p className="text-[10px] text-amber-600 text-center pb-3">
                약관을 끝까지 읽어주세요 (스크롤)
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
