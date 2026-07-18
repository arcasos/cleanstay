export default function Footer() {
  return (
    <footer className="border-t border-background-200 py-8">
      <div className="max-w-5xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <span className="font-semibold text-foreground-950 text-sm">클린콜</span>
            <p className="text-xs text-foreground-400 mt-0.5">STR 청소 디스패치 플랫폼</p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {['공급자 가입', '개발자 API', '이용약관', '개인정보처리방침'].map((link) => (
              <a
                key={link}
                href="#"
                className="text-xs text-foreground-600 hover:text-foreground-950 transition-colors duration-200 whitespace-nowrap cursor-pointer"
                onClick={(e) => { e.preventDefault(); /* TODO: 라우팅 */ }}
              >
                {link}
              </a>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-foreground-400 mt-6">
          프로토타입 &middot; <a href="#" className="hover:text-foreground-600 transition-colors duration-200 cursor-pointer" onClick={(e) => { e.preventDefault(); /* TODO: /_screens */ }}>화면 인덱스 보기</a>
        </p>
      </div>
    </footer>
  );
}