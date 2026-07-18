import { useState, useEffect } from 'react';

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav
      className={`sticky top-0 z-50 h-14 flex items-center transition-all duration-300 ${
        scrolled
          ? 'bg-white/90 backdrop-blur border-b border-background-200 shadow-sm'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-5xl mx-auto px-6 h-full flex items-center justify-between w-full">
        <a href="#" className="flex items-baseline gap-1.5">
          <span className={`font-semibold text-base transition-colors duration-300 ${scrolled ? 'text-foreground-950' : 'text-white'}`}>
            클린콜
          </span>
          <span className={`text-[11px] tracking-wider font-medium transition-colors duration-300 ${scrolled ? 'text-foreground-400' : 'text-white/50'}`}>
            CLEANCALL
          </span>
        </a>

        <div className="flex items-center gap-5">
          <a
            href="#service"
            className={`text-xs transition-colors duration-200 whitespace-nowrap cursor-pointer ${
              scrolled ? 'text-foreground-600 hover:text-foreground-950' : 'text-white/75 hover:text-white'
            }`}
          >
            서비스 소개
          </a>
          <a
            href="#provider"
            className={`text-xs transition-colors duration-200 whitespace-nowrap cursor-pointer ${
              scrolled ? 'text-foreground-600 hover:text-foreground-950' : 'text-white/75 hover:text-white'
            }`}
          >
            공급자 가입
          </a>
          <a
            href="#api"
            className={`text-xs transition-colors duration-200 whitespace-nowrap cursor-pointer ${
              scrolled ? 'text-foreground-600 hover:text-foreground-950' : 'text-white/75 hover:text-white'
            }`}
          >
            개발자 API
          </a>
          <button
            type="button"
            className={`py-1.5 px-3 text-xs rounded-md transition-all duration-200 whitespace-nowrap cursor-pointer ${
              scrolled
                ? 'bg-primary-500 text-white hover:bg-primary-600'
                : 'bg-white/15 text-white border border-white/25 hover:bg-white/25 backdrop-blur-sm'
            }`}
            onClick={() => { /* TODO: 도입 문의 */ }}
          >
            도입 문의
          </button>
        </div>
      </div>
    </nav>
  );
}