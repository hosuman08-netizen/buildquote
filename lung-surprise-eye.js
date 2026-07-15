// site-log-intensity.js — 현장 음성 로그의 긴급도 점수를 산출하는 보조 엔진.
// 최근 음성 로그 활동을 기반으로 0..1 긴급도 점수를 반환한다(로그 우선순위/미리보기 반영).
// Usage: window.getP6LungSurprise() → 최근 긴급도 점수 반환

(function() {
  'use strict';

  // 최근 로그 긴급도의 이동 평균을 유지한다. 새 로그가 없으면 완만히 기본값으로 수렴.
  window.getP6LungSurprise = function() {
    try {
      const logs = JSON.parse(localStorage.getItem('p14_logs') || '[]');
      if (!logs.length) return 0.3;
      const recent = logs.slice(0, 5);
      const avg = recent.reduce((a, l) => a + (typeof l.surprise === 'number' ? l.surprise : 0.3), 0) / recent.length;
      return Math.max(0, Math.min(1, avg));
    } catch (e) {
      return 0.3;
    }
  };

  console.log('%c[SiteForge] 현장 음성 로그 긴급도 엔진 로드 완료.', 'color:#c5a46e');
})();
