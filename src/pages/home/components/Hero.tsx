export default function Hero() {
  return (
    <section className="relative min-h-[620px] flex items-center overflow-hidden">
      {/* Full-bleed background image */}
      <div className="absolute inset-0">
        <img
          src="https://readdy.ai/api/search-image?query=Modern%20minimalist%20Korean%20hotel%20suite%20interior%20with%20warm%20natural%20sunlight%20streaming%20through%20floor%20to%20ceiling%20windows%2C%20pristine%20white%20bedding%20on%20a%20wooden%20platform%20bed%2C%20soft%20beige%20and%20cream%20tones%2C%20peaceful%20zen%20atmosphere%2C%20clean%20architectural%20lines%2C%20subtle%20shadows%2C%20editorial%20interior%20design%20photography%2C%20high%20end%20accommodation%20aesthetic%2C%20uncluttered%20serene%20space&width=1600&height=900&seq=cleancall-hero-bg&orientation=landscape"
          alt="모던 호텔 스위트 인테리어 - 클린콜 청소 자동화 서비스"
          title="클린콜 STR 턴오버 청소 자동화 플랫폼"
          className="w-full h-full object-cover object-top"
        />
        {/* Dark gradient overlay for text readability */}
        <div className="absolute inset-0 bg-linear-to-b from-black/55 via-black/40 to-black/60" />
      </div>

      {/* Content */}
      <div className="relative w-full max-w-5xl mx-auto px-6 py-20">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 items-center">
          {/* Left - Text content */}
          <div className="md:col-span-7">
            <span className="inline-block px-3 py-1 text-xs font-medium bg-white/15 text-white border border-white/20 rounded-full whitespace-nowrap backdrop-blur-xs">
              STR 턴오버 청소 자동화
            </span>

            <h1 className="mt-6 text-3xl md:text-4xl font-semibold text-white leading-tight">
              게스트가 체크아웃하면,<br />
              청소가 <span className="text-accent-300">알아서 잡힙니다</span>
            </h1>

            <p className="mt-4 text-sm text-white/75 max-w-md leading-relaxed">
              예약 시스템에 API 한 번만 연결하면, 체크아웃 이벤트가 청소 발주가 되고 검증된 청소 공급자에게 콜이 나갑니다. 완료 사진까지 확인하고 정산됩니다.
            </p>

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                className="py-2.5 px-5 text-sm font-medium bg-white text-foreground-950 rounded-md hover:bg-background-100 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                onClick={() => { /* TODO: 도입 문의하기 */ }}
              >
                도입 문의하기
              </button>
              <button
                type="button"
                className="py-2.5 px-5 text-sm font-medium bg-white/10 text-white border border-white/25 rounded-md hover:bg-white/20 hover:border-white/40 transition-colors duration-200 whitespace-nowrap cursor-pointer backdrop-blur-xs"
                onClick={() => { /* TODO: 청소 공급자로 가입 */ }}
              >
                청소 공급자로 가입
              </button>
            </div>

            <p className="mt-3 text-xs text-white/50">
              설치 없음 &middot; 체크아웃 이벤트 1건이면 시작
            </p>
          </div>

          {/* Right - Mock Card */}
          <div className="md:col-span-5">
            <div className="bg-white rounded-lg border border-background-200 shadow-lg p-5 backdrop-blur-none">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-foreground-950">발주 #CC-2041</span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium bg-accent-100 text-accent-800 rounded-full whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-500" />
                  배차 완료
                </span>
              </div>

              {/* Property info */}
              <div className="space-y-1 mb-4">
                <p className="text-sm text-foreground-950 font-medium">역삼동 스테이 &middot; 원룸 24㎡</p>
                <p className="text-xs text-foreground-500">
                  체크아웃 07-20 11:00 &rarr; 체크인 07-21 15:00
                </p>
              </div>

              {/* Timeline */}
              <div className="space-y-0">
                {[
                  { label: '발주 접수', done: true },
                  { label: '콜 오퍼', done: true },
                  { label: '공급자 수락', done: true },
                  { label: '청소 완료', done: false },
                ].map((step, i) => (
                  <div key={step.label} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step.done ? 'bg-primary-500 text-white' : 'bg-background-200 text-foreground-400'}`}>
                        {step.done ? (
                          <i className="ri-check-line" />
                        ) : (
                          <span>{String(i + 1).padStart(2, '0')}</span>
                        )}
                      </div>
                      {i < 3 && (
                        <div className={`w-px h-6 ${step.done ? 'bg-primary-300' : 'bg-background-200'}`} />
                      )}
                    </div>
                    <span className={`text-xs pt-0.5 ${step.done ? 'text-foreground-700 font-medium' : 'text-foreground-400'}`}>
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="border-t border-background-200 pt-3 mt-4">
                <p className="text-xs text-foreground-500">
                  담당 공급자 김○○ &middot; 평점 4.8
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}