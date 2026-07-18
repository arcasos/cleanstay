const problems = [
  {
    icon: 'ri-smartphone-line',
    image: 'https://readdy.ai/api/search-image?query=Stressed%20person%20holding%20smartphone%20with%20multiple%20notification%20bubbles%20floating%20around%2C%20messy%20desk%20with%20scattered%20sticky%20notes%20and%20papers%2C%20warm%20indoor%20lighting%2C%20candid%20documentary%20style%20photography%2C%20subtle%20anxiety%20atmosphere%2C%20shallow%20depth%20of%20field%2C%20soft%20natural%20colors%2C%20realistic%20office%20scene&width=400&height=280&seq=problem-phone-1&orientation=landscape',
    title: '매번 전화·카톡으로 청소 요청',
    desc: '체크아웃마다 사람이 직접 연락',
  },
  {
    icon: 'ri-alert-line',
    image: 'https://readdy.ai/api/search-image?query=Empty%20hotel%20room%20with%20unmade%20bed%20and%20scattered%20towels%2C%20afternoon%20light%20casting%20long%20shadows%2C%20abandoned%20feeling%2C%20cleaning%20supplies%20visible%20in%20corner%2C%20realistic%20interior%20photography%2C%20warm%20melancholic%20tones%2C%20subtle%20sense%20of%20urgency%2C%20documentary%20style&width=400&height=280&seq=problem-empty-2&orientation=landscape',
    title: '펑크 나면 다음 게스트가 못 들어옴',
    desc: '대체 인력 찾을 시간이 없음',
  },
  {
    icon: 'ri-file-list-3-line',
    image: 'https://readdy.ai/api/search-image?query=Scattered%20spreadsheets%20and%20receipts%20on%20wooden%20desk%20with%20calculator%20and%20coffee%20mug%2C%20warm%20desk%20lamp%20lighting%2C%20organized%20chaos%20aesthetic%2C%20accounting%20paperwork%2C%20soft%20shadows%2C%20realistic%20office%20still%20life%20photography%2C%20warm%20amber%20tones%2C%20shallow%20depth%20of%20field&width=400&height=280&seq=problem-paper-3&orientation=landscape',
    title: '정산은 엑셀과 계좌이체',
    desc: '세금계산서·원천징수 수작업',
  },
];

export default function ProblemSection() {
  return (
    <section className="py-14 md:py-16">
      <div className="max-w-5xl mx-auto px-6">
        <p className="text-sm text-foreground-500 text-center mb-3 tracking-wide">지금은 이렇게 돌아갑니다</p>
        <h2 className="text-xl md:text-2xl font-semibold text-foreground-950 text-center mb-10">
          비효율적인 청소 관리, 이제 그만
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {problems.map((item) => (
            <div key={item.title} className="bg-white rounded-lg border border-background-200 overflow-hidden hover:shadow-md transition-shadow duration-300 cursor-pointer group">
              {/* Card image */}
              <div className="w-full h-[180px] overflow-hidden">
                <img
                  src={item.image}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              {/* Card content */}
              <div className="p-5">
                <div className="w-8 h-8 flex items-center justify-center text-foreground-400 mb-3 bg-background-50 rounded-lg">
                  <i className={`${item.icon} text-lg`} />
                </div>
                <h3 className="text-sm font-semibold text-foreground-950 mb-1.5">{item.title}</h3>
                <p className="text-xs text-foreground-600 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}