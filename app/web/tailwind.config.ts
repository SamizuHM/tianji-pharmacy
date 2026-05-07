import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "../../packages/shared/src/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        card: "hsl(var(--card) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        primary: "hsl(var(--primary) / <alpha-value>)",
        primaryForeground: "hsl(var(--primary-foreground) / <alpha-value>)",
        secondary: "hsl(var(--secondary) / <alpha-value>)",
        muted: "hsl(var(--muted) / <alpha-value>)",
        accent: "hsl(var(--accent) / <alpha-value>)",
        destructive: "hsl(var(--destructive) / <alpha-value>)",
        success: "hsl(var(--success) / <alpha-value>)",
        warning: "hsl(var(--warning) / <alpha-value>)",
        info: "hsl(var(--info) / <alpha-value>)",
        sidebar: "hsl(var(--sidebar) / <alpha-value>)"
      },
      borderRadius: {
        sm: "0.125rem",
        DEFAULT: "0.25rem",
        md: "0.375rem",
        lg: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem"
      },
      boxShadow: {
        soft: "0 4px 20px rgba(15, 23, 42, 0.06)",
        panel: "0 1px 3px rgba(15, 23, 42, 0.08)"
      },
      fontFamily: {
        sans: ["Inter", "'Noto Sans SC'", "system-ui", "sans-serif"],
        display: ["Inter", "'Noto Sans SC'", "system-ui", "sans-serif"],
        label: ["'Work Sans'", "Inter", "'Noto Sans SC'", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: [tailwindcssAnimate]
};

export default config;
