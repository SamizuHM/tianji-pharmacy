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
        background: "#f1f5f9",
        foreground: "#0f172a",
        card: "#ffffff",
        border: "#e2e8f0",
        primary: "#2563eb",
        primaryForeground: "#ffffff",
        secondary: "#f1f5f9",
        muted: "#64748b",
        accent: "#eef2ff",
        destructive: "#ef4444",
        success: "#10b981",
        warning: "#f97316",
        info: "#0ea5e9",
        sidebar: "#172554"
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
