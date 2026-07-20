export default function AudienceSplit() {
  return (
    <section className="py-14 md:py-16">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-10">
          <h2 className="text-xl md:text-2xl font-semibold text-foreground-950">
            누구에게나 딱 맞는 방식
          </h2>
          <p className="text-sm text-foreground-500 mt-2">운영자와 공급자, 각자의 니즈에 맞춘 솔루션</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Left - Operator */}
          <div className="bg-white rounded-lg border border-background-200 overflow-hidden hover:shadow-md transition-shadow duration-300 cursor-pointer group">
            {/* Card image */}
            <div className="w-full h-[220px] overflow-hidden">
              <img
                src="https://readdy.ai/api/search-image?query=Modern%20accommodation%20management%20dashboard%20on%20large%20monitor%20showing%20multiple%20property%20listings%20and%20booking%20calendar%2C%20clean%20minimalist%20interface%20design%2C%20warm%20ambient%20office%20lighting%2C%20professional%20host%20workspace%20with%20plants%20and%20notebook%2C%20soft%20shadows%2C%20editorial%20tech%20workplace%20photography%2C%20serene%20productive%20atmosphere&width=800&height=500&seq=aud-operator&orientation=landscape"
                alt="숙박 운영자 대시보드 - 클린콜 호스트 솔루션"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
            </div>
            {/* Card content */}
            <div className="p-6">
              <span className="inline-block text-[11px] font-medium text-foreground-500 bg-background-100 px-2.5 py-1 rounded-full mb-4 whitespace-nowrap">
                숙박 운영자 &middot; 플랫폼
              </span>
              <h3 className="text-base font-semibold text-foreground-950 mb-4">
                체크아웃마다 청소를 자동 발주하세요
              </h3>
              <ul className="space-y-2.5 mb-6">
                {[
                  'REST API + Webhook으로 예약 시스템과 연동',
                  '미배차 시 백업 배차로 공실 리스크 제로',
                  '호스트 카드 자동 청구로 정산도 한 번에',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-foreground-600">
                    <span className="w-1 h-1 rounded-full bg-primary-500 mt-1.5 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="py-2.5 px-5 text-sm font-medium bg-primary-500 text-white rounded-md hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                onClick={() => { /* TODO: 도입 문의 */ }}
              >
                도입 문의
              </button>
            </div>
          </div>

          {/* Right - Provider */}
          <div className="bg-white rounded-lg border border-background-200 overflow-hidden hover:shadow-md transition-shadow duration-300 cursor-pointer group">
            {/* Card image */}
            <div className="w-full h-[220px] overflow-hidden">
              <img
                src="https://readdy.ai/api/search-image?query=Professional%20cleaning%20team%20of%20two%20people%20in%20matching%20uniforms%20with%20cleaning%20equipment%20cart%20in%20bright%20modern%20hotel%20corridor%2C%20warm%20natural%20light%20from%20windows%2C%20smiling%20confident%20expressions%2C%20pristine%20environment%2C%20editorial%20commercial%20photography%2C%20soft%20neutral%20tones%2C%20teamwork%20and%20reliability%20aesthetic&width=800&height=500&seq=aud-cleaner&orientation=landscape"
                alt="청소 공급자 팀 - 클린콜 파트너 솔루션"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
            </div>
            {/* Card content */}
            <div className="p-6">
              <span className="inline-block text-[11px] font-medium text-foreground-500 bg-background-100 px-2.5 py-1 rounded-full mb-4 whitespace-nowrap">
                청소 업체 &middot; 개인 파트너
              </span>
              <h3 className="text-base font-semibold text-foreground-950 mb-4">
                원하는 지역의 청소 콜만 받으세요
              </h3>
              <ul className="space-y-2.5 mb-6">
                {[
                  '활동지역 직접 선택으로 이동 동선 최소화',
                  '콜 수락 여부는 본인 결정, 강제 배정 없음',
                  '완료 후 정산, 3.3% 원천징수까지 처리',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-foreground-600">
                    <span className="w-1 h-1 rounded-full bg-primary-500 mt-1.5 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="py-2.5 px-5 text-sm font-medium bg-white text-foreground-950 border border-background-200 rounded-md hover:border-primary-500/40 hover:text-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                onClick={() => { /* TODO: 공급자 가입 */ }}
              >
                공급자 가입
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}