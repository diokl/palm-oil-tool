'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !password) {
      setError('ID와 비밀번호를 모두 입력하세요');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        // Redirect to dashboard
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

        {/* Login Card */}
        <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">아이디</label>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="admin ID"
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
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 focus:bg-white focus:border-blue-300 transition-colors"
            />
          </div>

          {error && (
            <div className="text-rose-600 text-xs bg-rose-50 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p className="text-center text-slate-300 text-[10px] mt-6">
          Samyang Foods — Palm Oil Purchase Management System
        </p>
      </div>
    </div>
  );
}
