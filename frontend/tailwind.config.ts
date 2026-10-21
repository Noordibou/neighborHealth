import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        nh: {
          cream: "#eef2ef",
          "cream-dark": "#dce5df",
          terracotta: "#b42318",
          "terracotta-dark": "#8c1a12",
          brown: "#1c2823",
          "brown-muted": "#516158",
          sand: "#d3ddd6",
          ink: "#121a17",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
