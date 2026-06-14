import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { Marquee } from "./components/Marquee";
import { Pillars } from "./components/Pillars";
import { Features } from "./components/Features";
import { Safety } from "./components/Safety";
import { Ai } from "./components/Ai";
import { Pricing } from "./components/Pricing";
import { ClosingCta } from "./components/ClosingCta";
import { Footer } from "./components/Footer";

export default function App() {
  return (
    <>
      <a
        href="#top"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:border-2 focus:border-line focus:bg-paper focus:px-4 focus:py-2 focus:font-mono focus:text-sm"
      >
        Skip to content
      </a>
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Pillars />
        <Features />
        <Safety />
        <Ai />
        <Pricing />
        <ClosingCta />
      </main>
      <Footer />
    </>
  );
}
