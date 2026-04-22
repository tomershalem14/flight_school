import type { Config } from "tailwindcss";
import { tailwindPastelColors } from "./src/shared/pastelPalette";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#7BA3B5",
        /** Hover / pressed primary actions (legacy `--primary-dark`). */
        primaryDark: "#5D8A9E",
        background: "#FBFBF9",
        surface: "#FFFFFF",
        ink: "#42494D",
        muted: "#939B9F",
        line: "#F0F2F4",
        danger: "#EF4444",
        success: "#22C55E",
        warning: "#F59E0B",
        ...tailwindPastelColors(),
      },
      fontFamily: {
        heading: ["Quicksand", "system-ui", "sans-serif"],
        body: ["Nunito", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "16px",
        pill: "999px",
      },
      boxShadow: {
        airy: "0 10px 30px rgba(123, 163, 181, 0.08)",
      },
    },
  },
  plugins: [],
} satisfies Config;
