import Navbar from './components/Navbar';
import Hero from './components/Hero';
import ProblemSection from './components/ProblemSection';
import HowItWorks from './components/HowItWorks';
import AudienceSplit from './components/AudienceSplit';
import CTABand from './components/CTABand';
import Footer from './components/Footer';

export default function Home() {
  return (
    <div className="min-h-screen bg-background-50">
      <Navbar />
      <main>
        <Hero />
        <ProblemSection />
        <HowItWorks />
        <AudienceSplit />
        <CTABand />
      </main>
      <Footer />
    </div>
  );
}