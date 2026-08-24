import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
      },
      colors: {
        navy: {
          950: "#061428",
          900: "#0B1F3A",
          800: "#132A4A",
          700: "#1C3A63",
          600: "#2A5290",
        },
        sky: {
          400: "#38BDF8",
          500: "#0EA5E9",
        },
        gold: {
          400: "#F5C542",
          500: "#E8B931",
        },
      },
      boxShadow: {
        card: "0 18px 40px -20px rgba(11, 31, 58, 0.35)",
        glow: "0 0 40px rgba(14, 165, 233, 0.25)",
      },
      backgroundImage: {
        "hero-grid":
          "radial-gradient(circle at 20% 20%, rgba(14,165,233,0.18), transparent 35%), radial-gradient(circle at 80% 0%, rgba(245,197,66,0.12), transparent 28%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
