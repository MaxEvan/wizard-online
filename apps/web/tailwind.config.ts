import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Avenir Next", "ui-sans-serif", "system-ui"],
        body: ["Avenir", "ui-sans-serif", "system-ui"],
      },
      colors: {
        felt: "#0f5a47",
        ink: "#12202a",
        brass: "#c9a563",
        parchment: "#f7f0de",
      },
      boxShadow: {
        table: "0 24px 60px rgba(6, 31, 24, 0.28)",
      },
    },
  },
  plugins: [],
} satisfies Config;

