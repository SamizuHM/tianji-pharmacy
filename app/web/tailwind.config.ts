import type { Config } from "tailwindcss";

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
        background: "#f6f4ee",
        foreground: "#1b1f18",
        card: "#fffdf8",
        border: "#ddd6c4",
        primary: "#1f6f54",
        primaryForeground: "#f8fffb",
        secondary: "#ebe5d7",
        muted: "#70685c",
        accent: "#f2c66d",
        destructive: "#b43f3f"
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.5rem"
      },
      boxShadow: {
        soft: "0 16px 40px rgba(31, 43, 27, 0.08)"
      },
      fontFamily: {
        sans: ["'Noto Sans SC'", "system-ui", "sans-serif"],
        display: ["'ZCOOL XiaoWei'", "'Noto Serif SC'", "serif"]
      }
    }
  },
  plugins: []
};

export default config;

