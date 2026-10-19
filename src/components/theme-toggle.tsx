"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const THEME_CYCLE = ["system", "dark", "light"] as const;

type ThemeChoice = (typeof THEME_CYCLE)[number];

const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "Ikut sistem",
  dark: "Gelap",
  light: "Terang",
};

function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return value !== undefined && (THEME_CYCLE as readonly string[]).includes(value);
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const current: ThemeChoice = mounted && isThemeChoice(theme) ? theme : "system";
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];

  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Ganti tema. Sekarang: ${THEME_LABEL[current]}. Klik untuk ${THEME_LABEL[next]}.`}
      title={`Tema: ${THEME_LABEL[current]} — klik untuk ${THEME_LABEL[next]}`}
    >
      {current === "dark" ? (
        <MoonIcon className="size-4" />
      ) : current === "light" ? (
        <SunIcon className="size-4" />
      ) : (
        <MonitorIcon className="size-4" />
      )}
    </Button>
  );
}
