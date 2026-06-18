import { describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/lib/theme";

function Probe({ onReady }: { onReady: (t: ReturnType<typeof useTheme>) => void }) {
  const theme = useTheme();
  onReady(theme);
  return <span data-testid="theme">{theme.theme}</span>;
}

describe("ThemeProvider", () => {
  it("toggles the dark class on <html>", () => {
    let ctx!: ReturnType<typeof useTheme>;
    render(
      <ThemeProvider>
        <Probe onReady={(t) => (ctx = t)} />
      </ThemeProvider>,
    );
    act(() => ctx.setTheme("dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    act(() => ctx.setTheme("light"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
