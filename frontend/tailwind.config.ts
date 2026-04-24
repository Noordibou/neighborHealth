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
          cream: "#faf6ef",
          "cream-dark": "#f0e8dc",
          terracotta: "#c45c3e",
          "terracotta-dark": "#a34a32",
          brown: "#2c1810",
          "brown-muted": "#5c4033",
          sand: "#e8dfd4",
          ink: "#1a120e",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
