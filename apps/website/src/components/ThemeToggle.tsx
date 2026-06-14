import { useEffect, useState } from "react";
import { Sun, MoonStars } from "@phosphor-icons/react";
import { Button } from "./Button";

type Theme = "light" | "dark";

function current(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(current());
  }, []);

  function toggle() {
    const next: Theme = current() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("penta-theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  }

  return (
    <Button
      type="button"
      onClick={toggle}
      variant="ghost"
      size="icon"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className={className}
    >
      {theme === "dark" ? <Sun size={18} weight="bold" /> : <MoonStars size={18} weight="bold" />}
    </Button>
  );
}
