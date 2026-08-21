import type { Config } from "tailwindcss";

/**
 * Brand tokens live here so Negrita's real palette can be swapped in one place.
 * `cream` = page background, `tomato` = primary accent, `charcoal` = text.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: {
          DEFAULT: "#FBF6EF",
          deep: "#F3EADB",
        },
        tomato: {
          DEFAULT: "#E0492E",
          dark: "#C13A22",
          soft: "#F3A791",
        },
        charcoal: {
          DEFAULT: "#2C2621",
          soft: "#5A5148",
        },
        basil: "#4B7B4B",
        gold: "#E8A427",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      /**
       * The app writes weights numerically (`font-600`), which is not a stock
       * Tailwind utility — without these keys those ~200 class names emit no
       * CSS at all and every heading renders at 400.
       */
      fontWeight: {
        400: "400",
        500: "500",
        600: "600",
        700: "700",
      },
      boxShadow: {
        card: "0 1px 2px rgba(44,38,33,0.06), 0 8px 24px -12px rgba(44,38,33,0.18)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
