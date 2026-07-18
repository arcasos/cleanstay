export default function CTABand() {
  return (
    <section className="py-14 md:py-16">
      <div className="max-w-5xl mx-auto px-6">
        <div className="relative rounded-lg overflow-hidden">
          {/* Background image */}
          <div className="absolute inset-0">
            <img
              src="https://readdy.ai/api/search-image?query=Warm%20inviting%20modern%20office%20meeting%20space%20with%20comfortable%20seating%20and%20soft%20ambient%20lighting%2C%20large%20windows%20with%20city%20view%2C%20professional%20consultation%20atmosphere%2C%20clean%20minimalist%20Korean%20interior%20design%2C%20subtle%20greenery%2C%20golden%20hour%20light%2C%20welcoming%20business%20environment%2C%20shallow%20depth%20of%20field&width=1600&height=600&seq=cta-bg&orientation=landscape"
              alt="클린콜 도입 상담"
              className="w-full h-full object-cover"
            />
            {/* Dark overlay */}
            <div className="absolute inset-0 bg-foreground-950/80" />
          </div>

          {/* Content */}
          <div className="relative p-8 md:p-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
            <div>
              <p className="text-lg md:text-xl font-semibold text-white">
                체크아웃 청소, 이번 주부터 자동으로
              </p>
              <p className="text-sm text-white/65 mt-1.5">
                연동 상담과 시범 운영을 도와드립니다
              </p>
            </div>
            <button
              type="button"
              className="py-2.5 px-5 text-sm font-medium bg-white text-foreground-950 rounded-md hover:bg-background-100 transition-colors duration-200 whitespace-nowrap cursor-pointer shrink-0"
              onClick={() => { /* TODO: 도입 문의하기 */ }}
            >
              도입 문의하기
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}