const steps = [
  {
    num: '01',
    title: '체크아웃 이벤트',
    desc: '예약 시스템이 API로 발주 생성',
    image: 'https://readdy.ai/api/search-image?query=Modern%20laptop%20screen%20displaying%20clean%20API%20dashboard%20with%20data%20flowing%20between%20systems%2C%20minimalist%20tech%20interface%20with%20subtle%20graphs%20and%20connection%20nodes%2C%20soft%20warm%20white%20tones%2C%20clean%20desk%20setup%20with%20natural%20light%2C%20professional%20SaaS%20product%20photography%2C%20sleek%20modern%20workspace%20aesthetic&width=600&height=400&seq=how-api-01&orientation=landscape',
  },
  {
    num: '02',
    title: '콜 오퍼',
    desc: '지역·평점 기준으로 공급자에게 순차 오퍼',
    image: 'https://readdy.ai/api/search-image?query=Digital%20map%20interface%20showing%20location%20pins%20and%20route%20connections%20across%20a%20city%2C%20modern%20logistics%20dispatch%20dashboard%20on%20tablet%20screen%2C%20warm%20ambient%20lighting%2C%20clean%20minimalist%20UI%20design%2C%20soft%20shadows%2C%20professional%20operations%20center%20aesthetic%2C%20subtle%20geographic%20data%20visualization&width=600&height=400&seq=how-dispatch-02&orientation=landscape',
  },
  {
    num: '03',
    title: '청소·완료 증빙',
    desc: '체크리스트와 사진으로 완료 확인',
    image: 'https://readdy.ai/api/search-image?query=Professional%20cleaner%20in%20neat%20uniform%20making%20bed%20in%20bright%20modern%20hotel%20room%2C%20sunlight%20streaming%20through%20window%2C%20crisp%20white%20linens%2C%20cleaning%20checklist%20on%20tablet%20visible%2C%20warm%20natural%20light%2C%20pristine%20and%20organized%2C%20editorial%20hospitality%20photography%2C%20calm%20orderly%20atmosphere&width=600&height=400&seq=how-clean-03&orientation=landscape',
  },
  {
    num: '04',
    title: '자동 정산',
    desc: '결제·세금계산서·3.3% 원천징수까지',
    image: 'https://readdy.ai/api/search-image?query=Smartphone%20screen%20showing%20payment%20confirmation%20with%20digital%20invoice%20and%20tax%20document%2C%20clean%20minimalist%20financial%20interface%2C%20warm%20desk%20setting%20with%20subtle%20plant%20and%20coffee%2C%20modern%20fintech%20aesthetic%2C%20soft%20natural%20lighting%2C%20professional%20yet%20approachable%20atmosphere&width=600&height=400&seq=how-payment-04&orientation=landscape',
  },
];

export default function HowItWorks() {
  return (
    <section className="bg-white border-y border-background-200 py-14 md:py-16">
      <div className="max-w-5xl mx-auto px-6">
        {/* Section header */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-[3px] h-6 bg-primary-500 rounded-full" />
          <h2 className="text-base font-semibold text-foreground-950">작동 방식</h2>
        </div>

        {/* Steps grid - 2 columns on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {steps.map((step, i) => (
            <div key={step.num} className="flex gap-4 bg-background-50 rounded-lg p-4 items-start hover:shadow-sm transition-shadow duration-300 cursor-pointer group">
              {/* Step image */}
              <div className="w-[140px] h-[100px] flex-shrink-0 rounded-md overflow-hidden">
                <img
                  src={step.image}
                  alt={step.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              {/* Step content */}
              <div className="flex-1 min-w-0">
                <span className="inline-block px-2.5 py-0.5 text-[11px] font-semibold bg-primary-100 text-primary-700 rounded-full mb-2 whitespace-nowrap">
                  {step.num}
                </span>
                <h4 className="text-sm font-semibold text-foreground-950 mb-1">{step.title}</h4>
                <p className="text-xs text-foreground-600 leading-relaxed">{step.desc}</p>
              </div>
              {/* Arrow for desktop */}
              {i < steps.length - 1 && (
                <div className="hidden md:flex w-6 h-6 items-center justify-center text-foreground-300 flex-shrink-0 self-center">
                  <i className="ri-arrow-down-s-line text-lg" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}